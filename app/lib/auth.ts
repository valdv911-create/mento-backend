import { AsyncLocalStorage } from 'node:async_hooks';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { loadAndValidateEnvironment, getJwtSecret as getConfiguredJwtSecret } from '../../lib/env';
import logger from '../../lib/logger';
import { NextResponse } from 'next/server';
import type { ResponseCookies } from 'next/dist/server/web/spec-extension/cookies';

loadAndValidateEnvironment();
const isProduction = process.env.NODE_ENV === 'production';
const JWT_SECRET = getConfiguredJwtSecret();
const resolvedJwtSecret = JWT_SECRET;
const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

function getJwtSecret(): string | undefined {
  return resolvedJwtSecret;
}

function ensureJwtSecret(): string {
  if (!resolvedJwtSecret) {
    throw new Error('JWT_SECRET must be configured');
  }
  return resolvedJwtSecret;
}

const JWT_ALGORITHM = 'HS256';
const PASSWORD_MIN_LENGTH = 12;
const RECENT_OAUTH_REAUTH_MS = 15 * 60 * 1000;
const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const userContext = new AsyncLocalStorage<string | null>();

export interface JwtPayload {
  sub: string;
  email: string;
  iat: number;
  exp: number;
}

export interface PasswordValidationResult {
  isValid: boolean;
  reasons: string[];
}

export interface SensitiveActionRequirements {
  requiresPasswordConfirmation: boolean;
  requiresRecentOAuthReauth: boolean;
  recentOAuthReauthWindowMs: number;
}

export interface LoginPolicyState {
  allowed: boolean;
  reason: 'allowed' | 'account_locked' | 'invalid_credentials';
  lockoutRemainingSeconds: number;
}

export function getClientIp(req: Request) {
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (forwarded) return forwarded;
  return req.headers.get('x-real-ip')?.trim() || '';
}

export function getLoginPolicyState(user: { failedLoginAttempts?: number | null; lockedAt?: Date | string | null }) {
  const lockedAt = user?.lockedAt ? new Date(user.lockedAt) : null;
  const now = Date.now();
  if (lockedAt && lockedAt.getTime() > now) {
    return {
      allowed: false,
      reason: 'account_locked' as const,
      lockoutRemainingSeconds: Math.ceil(Math.max(0, lockedAt.getTime() - now) / 1000),
    };
  }
  return {
    allowed: true,
    reason: 'allowed' as const,
    lockoutRemainingSeconds: 0,
  };
}

export async function getUserFromRequest(req: Request) {
  const authHeader = req.headers.get('authorization')?.trim() || '';
  const authHeaderExists = authHeader.length > 0;
  const authScheme = authHeaderExists ? authHeader.split(' ')[0] : 'none';
  logger.info('Auth header inspection', { authHeaderExists, authScheme });

  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    logger.warn('Auth rejected: invalid scheme');
    userContext.enterWith(null);
    return null;
  }

  const token = authHeader.slice(7).trim();
  const tokenPresent = token.length > 0;
  logger.info('Bearer token inspection', { tokenPresent });
  if (!tokenPresent) {
    logger.warn('Auth rejected: missing token');
    userContext.enterWith(null);
    return null;
  }

  logger.info('JWT verification started');
  try {
    const jwtSecret = getJwtSecret();
    if (!jwtSecret) {
      logger.warn('JWT_SECRET not configured: auth verification is disabled');
      userContext.enterWith(null);
      return null;
    }
    const payload = jwt.verify(token, jwtSecret, { algorithms: [JWT_ALGORITHM] });
    const decodedUserId = typeof payload === 'object' && payload !== null ? (payload as Partial<JwtPayload>).sub ?? null : null;
    const decodedEmail = typeof payload === 'object' && payload !== null ? (payload as Partial<JwtPayload>).email ?? null : null;
    logger.info('JWT verification succeeded', {
      decodedUserId,
      decodedEmail,
      algorithm: JWT_ALGORITHM,
      secretConfigured: Boolean(JWT_SECRET),
    });

    if (typeof payload !== 'object' || payload === null || typeof (payload as Partial<JwtPayload>).sub !== 'string') {
      logger.warn('Auth rejected: invalid JWT payload');
      userContext.enterWith(null);
      return null;
    }

    const userId = (payload as JwtPayload).sub;
    const email = (payload as JwtPayload).email;
    logger.info('JWT payload extracted', { userId, email });

    let user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user && typeof email === 'string') {
      const normalizedEmail = normalizeEmail(email);
      if (normalizedEmail) {
        user = await prisma.user.findFirst({
          where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
        });
        if (user) {
          logger.info('JWT fallback user found by email', { email: normalizedEmail, fallbackUserId: user.id });
        }
      }
    }

    const userFound = Boolean(user);
    logger.info('User lookup result', { userFound, userId, userEmail: user?.email ?? null });
    if (!userFound || !user) {
      logger.warn('Auth rejected: user lookup failed');
      userContext.enterWith(null);
      return null;
    }

    userContext.enterWith(user.id);
    return user;
  } catch (error: unknown) {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.warn('JWT verification failed', {
      errorName,
      errorMessage,
      tokenPresent,
    });
    userContext.enterWith(null);
    return null;
  }
}

export function normalizeEmail(email: string | null | undefined) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

export function isAdminUser(user: { email?: string | null; authProvider?: string | null; role?: string | null }) {
  const configuredAdminEmails = process.env.ADMIN_EMAILS?.split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean) ?? [];
  const normalizedEmail = normalizeEmail(user.email);

  if (user.authProvider === 'admin') {
    return true;
  }

  if (typeof user.role === 'string' && user.role.trim().toLowerCase() === 'admin') {
    return true;
  }

  return normalizedEmail.length > 0 && configuredAdminEmails.includes(normalizedEmail);
}

export function validatePasswordStrength(password: string): PasswordValidationResult {
  const reasons: string[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) {
    reasons.push(`Password must be at least ${PASSWORD_MIN_LENGTH} characters long.`);
  }
  if (!/[A-Z]/.test(password)) {
    reasons.push('Password must contain an uppercase letter.');
  }
  if (!/[a-z]/.test(password)) {
    reasons.push('Password must contain a lowercase letter.');
  }
  if (!/\d/.test(password)) {
    reasons.push('Password must contain a number.');
  }
  if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)) {
    reasons.push('Password must contain a symbol.');
  }
  return { isValid: reasons.length === 0, reasons };
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, passwordHash: string | null | undefined) {
  if (!passwordHash || !passwordHash.trim()) return false;
  return bcrypt.compare(password, passwordHash);
}

export function getSensitiveActionRequirements(user: { authProvider?: string | null; lastOAuthReauthAt?: Date | string | null }, now = new Date()): SensitiveActionRequirements {
  const lastOAuthReauthAt = user.lastOAuthReauthAt ? new Date(user.lastOAuthReauthAt) : null;
  const isGoogleUser = user.authProvider === 'google' || user.authProvider === 'mixed';
  const recentOAuthReauth = lastOAuthReauthAt ? now.getTime() - lastOAuthReauthAt.getTime() <= RECENT_OAUTH_REAUTH_MS : false;
  return {
    requiresPasswordConfirmation: true,
    requiresRecentOAuthReauth: isGoogleUser && !recentOAuthReauth,
    recentOAuthReauthWindowMs: RECENT_OAUTH_REAUTH_MS,
  };
}

export function requireUserScope(requestedUserId: string | null | undefined) {
  const activeUserId = getActiveUserId();
  if (!activeUserId || !requestedUserId || activeUserId !== requestedUserId) {
    throw new Error('Forbidden');
  }
  return activeUserId;
}

export function buildUserSummary(user: { id: string; email: string; name?: string | null }) {
  return { id: user.id, email: user.email, name: user.name ?? null };
}

export function signToken(userId: string, email: string, options?: { expiresInSeconds?: number }) {
  const jwtSecret = ensureJwtSecret();
  const expiresInSeconds = options?.expiresInSeconds ?? ACCESS_TOKEN_TTL_SECONDS;
  return jwt.sign({ sub: userId, email }, jwtSecret, { expiresIn: expiresInSeconds, algorithm: JWT_ALGORITHM });
}

export function signRefreshToken(userId: string, email: string) {
  const jwtSecret = ensureJwtSecret();
  return jwt.sign({ sub: userId, email, type: 'refresh' }, jwtSecret, {
    expiresIn: REFRESH_TOKEN_TTL_SECONDS,
    algorithm: JWT_ALGORITHM,
  });
}

export function isTokenExpired(expirationUnixSeconds: number | null | undefined) {
  if (typeof expirationUnixSeconds !== 'number') return true;
  return Math.floor(Date.now() / 1000) >= expirationUnixSeconds;
}

export function buildAuthCookieOptions(params: { isProduction: boolean; maxAgeSeconds: number; path?: string }): Parameters<ResponseCookies['set']>[2] {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: params.isProduction,
    path: params.path ?? '/',
    maxAge: params.maxAgeSeconds,
    domain: params.isProduction ? undefined : undefined,
  };
}

export function applyAuthCookies(
  response: NextResponse,
  params: { accessToken: string; refreshToken: string; isProduction: boolean; accessMaxAgeSeconds?: number; refreshMaxAgeSeconds?: number; path?: string }
) {
  response.cookies.set('mento_access_token', params.accessToken, buildAuthCookieOptions({
    isProduction: params.isProduction,
    maxAgeSeconds: params.accessMaxAgeSeconds ?? ACCESS_TOKEN_TTL_SECONDS,
    path: params.path,
  }));
  response.cookies.set('mento_refresh_token', params.refreshToken, buildAuthCookieOptions({
    isProduction: params.isProduction,
    maxAgeSeconds: params.refreshMaxAgeSeconds ?? REFRESH_TOKEN_TTL_SECONDS,
    path: params.path,
  }));
  return response;
}

export async function recordSecurityEvent(userId: string | null, eventType: string, details: Record<string, unknown> = {}) {
  try {
    await prisma.securityEvent.create({ data: { userId, eventType, severity: 'info', details: details as Prisma.InputJsonValue } });
  } catch (error) {
    logger.warn('Security event persistence failed', { error });
  }
}

export async function incrementFailedLoginAttempts(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return null;

  const failedLoginAttempts = user.failedLoginAttempts + 1;
  const shouldLockout = failedLoginAttempts >= MAX_FAILED_LOGIN_ATTEMPTS;
  const nextLockedAt = shouldLockout ? new Date(Date.now() + LOCKOUT_DURATION_MS) : user.lockedAt;
  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      failedLoginAttempts,
      lastFailedLoginAt: new Date(),
      lockedAt: nextLockedAt,
    },
  });

  return updated;
}

export async function resetFailedLoginAttempts(userId: string) {
  await prisma.user.update({
    where: { id: userId },
    data: {
      failedLoginAttempts: 0,
      lockedAt: null,
      lastLoginAt: new Date(),
    },
  });
}

export function getActiveUserId() {
  return userContext.getStore() ?? null;
}

export function getUserContextForPrisma() {
  return getActiveUserId();
}
