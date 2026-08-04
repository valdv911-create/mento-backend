import { NextResponse } from 'next/server';
import { prisma } from '../../../lib/prisma';
import logger from '../../../lib/logger';
import { signToken, normalizeEmail, verifyPassword, buildUserSummary, incrementFailedLoginAttempts, resetFailedLoginAttempts, recordSecurityEvent, applyAuthCookies, getClientIp, getLoginPolicyState } from '../../lib/auth';
import { createNotification } from '../../services/notificationService';
import { createSessionRecord, generateSecureToken } from '../../../lib/authSession';
import { buildCorsHeaders } from '../../../lib/securityHeaders';

const CORS_METHODS = 'POST, OPTIONS';

export async function OPTIONS(req: Request) {
  logger.info('Login OPTIONS preflight', {
    origin: req.headers.get('origin'),
  });
  const corsHeaders = buildCorsHeaders(req.headers.get('origin'));
  return new NextResponse(null, {
    status: 204,
    headers: {
      ...corsHeaders,
      'Access-Control-Allow-Methods': CORS_METHODS,
    },
  });
}

export async function POST(req: Request) {
  logger.info('Login POST received', {
    origin: req.headers.get('origin'),
  });

  try {
    const { email, password } = await req.json();
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400, headers: { ...buildCorsHeaders(req.headers.get('origin')), 'Access-Control-Allow-Methods': CORS_METHODS } });
    }

    const user = await prisma.user.findFirst({
      where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
    });
    if (!user) {
      logger.info('Login lookup result', { found: false });
      await recordSecurityEvent(null, 'login_failed', { email: normalizedEmail, reason: 'user_not_found' });
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401, headers: { ...buildCorsHeaders(req.headers.get('origin')), 'Access-Control-Allow-Methods': CORS_METHODS } });
    }

    const policyState = getLoginPolicyState(user);
    if (!policyState.allowed) {
      return NextResponse.json({ error: 'Account temporarily locked. Please try again later.' }, { status: 423, headers: { ...buildCorsHeaders(req.headers.get('origin')), 'Access-Control-Allow-Methods': CORS_METHODS } });
    }

    logger.info('Login lookup result', { found: true, userId: user.id });
    const passwordFieldExists = typeof user.password === 'string' && user.password.trim().length > 0;
    logger.info('Login password field status', { userId: user.id, passwordFieldExists });

    if (!passwordFieldExists) {
      return NextResponse.json(
        { error: 'This account was created with Google. Please continue with Google or set a password.' },
        { status: 401, headers: { ...buildCorsHeaders(req.headers.get('origin')), 'Access-Control-Allow-Methods': CORS_METHODS } }
      );
    }

    const match = await verifyPassword(password, user.password);
    logger.info('Login password compare result', { userId: user.id, match });
    if (!match) {
      await incrementFailedLoginAttempts(user.id);
      const clientIp = getClientIp(req);
      await recordSecurityEvent(user.id, 'login_failed', { email: normalizedEmail, reason: 'invalid_password', ipAddress: clientIp });
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401, headers: { ...buildCorsHeaders(req.headers.get('origin')), 'Access-Control-Allow-Methods': CORS_METHODS } });
    }

    await resetFailedLoginAttempts(user.id);
    const clientIp = getClientIp(req);
    const accessToken = signToken(user.id, normalizedEmail, { expiresInSeconds: 15 * 60 });
    const refreshTokenValue = generateSecureToken();
    const sessionExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await createSessionRecord({
      userId: user.id,
      token: refreshTokenValue,
      userAgent: req.headers.get('user-agent') ?? null,
      ipAddress: req.headers.get('x-forwarded-for') ?? null,
      expiresAt: sessionExpiresAt,
    });
    await recordSecurityEvent(user.id, 'login_success', { email: normalizedEmail, ipAddress: clientIp });

    // best-effort security notification on successful login
    try {
      await createNotification(user.id, {
        title: 'New sign-in detected',
        body: `We detected a new sign-in to your account. If this wasn't you, change your password.`,
        type: 'security',
      });
    } catch (e) {
      // ignore
    }

    const response = NextResponse.json({
      token: accessToken,
      refreshToken: refreshTokenValue,
      sessionExpiresAt: sessionExpiresAt.toISOString(),
      user: buildUserSummary(user),
    }, { headers: { ...buildCorsHeaders(req.headers.get('origin')), 'Access-Control-Allow-Methods': CORS_METHODS } });
    applyAuthCookies(response, {
      accessToken,
      refreshToken: refreshTokenValue,
      isProduction: process.env.NODE_ENV === 'production',
    });
    return response;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    logger.error('Login error', { error: err });
    return NextResponse.json({ error: message }, { status: 500, headers: { ...buildCorsHeaders(req.headers.get('origin')), 'Access-Control-Allow-Methods': CORS_METHODS } });
  }
}
