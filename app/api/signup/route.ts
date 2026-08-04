import { NextResponse } from 'next/server';
import logger from '../../../lib/logger';
import { signToken, normalizeEmail, validatePasswordStrength, buildUserSummary, recordSecurityEvent, applyAuthCookies } from '../../lib/auth';
import { createSessionRecord, generateSecureToken } from '../../../lib/authSession';
import { createNotification } from '../../services/notificationService';
import { createEmailAccount, DuplicateEmailError, InvalidAccountInputError } from '../../../services/userAccountService';

export async function POST(req: Request) {
  try {
    const { email, password, confirmPassword, name } = await req.json();
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail || typeof password !== 'string' || !password.trim()) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }
    if (typeof confirmPassword !== 'string' || confirmPassword !== password) {
      return NextResponse.json({ error: 'Password confirmation must match.' }, { status: 400 });
    }

    const passwordPolicy = validatePasswordStrength(password);
    if (!passwordPolicy.isValid) {
      return NextResponse.json({ error: passwordPolicy.reasons.join(' ') }, { status: 400 });
    }

    let accountResult;
    try {
      accountResult = await createEmailAccount({
        email: normalizedEmail,
        password,
        name,
      });
    } catch (error) {
      if (error instanceof DuplicateEmailError) {
        return NextResponse.json({ error: 'Email already exists' }, { status: 409 });
      }
      if (error instanceof InvalidAccountInputError) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }

    const user = accountResult.user;
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
    await recordSecurityEvent(user.id, 'signup_completed', { email: normalizedEmail });

    // best-effort welcome notification
    try {
      await createNotification(user.id, {
        title: 'Welcome to Mento',
        body: `Thanks for signing up${user.name ? `, ${user.name}` : ''}!`,
        type: 'welcome',
      });
    } catch {
      // ignore notification errors
    }

    const response = NextResponse.json({
      token: accessToken,
      refreshToken: refreshTokenValue,
      sessionExpiresAt: sessionExpiresAt.toISOString(),
      user: buildUserSummary(user),
    }, { status: 201 });
    applyAuthCookies(response, {
      accessToken,
      refreshToken: refreshTokenValue,
      isProduction: process.env.NODE_ENV === 'production',
    });
    return response;
  } catch (err: unknown) {
    logger.error('Signup error', { error: err });
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
