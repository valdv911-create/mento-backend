import { NextResponse } from 'next/server';
import { PrismaClientValidationError } from '@prisma/client/runtime/library';
import { signToken, normalizeEmail, buildUserSummary, recordSecurityEvent, applyAuthCookies } from '../../../lib/auth';
import { createSessionRecord, generateSecureToken } from '../../../../lib/authSession';
import { retryWithBackoff, sanitizeForLogging } from '../../../../lib/resilience';
import logger from '../../../../lib/logger';
import { createNotification } from '../../../../app/services/notificationService';
import { buildCorsHeaders } from '../../../../lib/securityHeaders';
import { createGoogleOAuthAccount } from '../../../../services/userAccountService';
import { getSupabaseUrl, getSupabaseClientKey } from '../../../../lib/env';

const CORS_METHODS = 'POST, OPTIONS';

const SUPABASE_URL = getSupabaseUrl();
const SUPABASE_API_KEY = getSupabaseClientKey();

if (!SUPABASE_URL || !SUPABASE_API_KEY) {
  throw new Error('SUPABASE_URL and SUPABASE_API_KEY must be configured for Google OAuth route.');
}

export async function OPTIONS(req: Request) {
  return new NextResponse(null, {
    status: 204,
    headers: { ...buildCorsHeaders(req.headers.get('origin')), 'Access-Control-Allow-Methods': CORS_METHODS },
  });
}

export async function POST(req: Request) {
  try {
    const { access_token: incomingAccessToken } = await req.json();
    if (!incomingAccessToken?.trim()) {
      return NextResponse.json(
        { error: 'Supabase access token is required' },
        { status: 400, headers: { ...buildCorsHeaders(req.headers.get('origin')), 'Access-Control-Allow-Methods': CORS_METHODS } }
      );
    }

    if (!SUPABASE_URL || !SUPABASE_API_KEY) {
      return NextResponse.json(
        { error: 'Google sign-in is temporarily unavailable.' },
        { status: 503, headers: { ...buildCorsHeaders(req.headers.get('origin')), 'Access-Control-Allow-Methods': CORS_METHODS } }
      );
    }

    const supabaseResponse = await retryWithBackoff(async () => fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${incomingAccessToken}`,
        ...(SUPABASE_API_KEY ? { apikey: SUPABASE_API_KEY } : {}),
      },
    }), { retries: 2, baseDelayMs: 300, maxDelayMs: 1500, timeoutMs: 8000 });

    if (!supabaseResponse.ok) {
      const errorText = await supabaseResponse.text();
      logger.error('Supabase user verification failed', {
        status: supabaseResponse.status,
        errorPreview: errorText.slice(0, 200),
      });
      return NextResponse.json(
        { error: 'Invalid Supabase access token' },
        { status: 401, headers: { ...buildCorsHeaders(req.headers.get('origin')), 'Access-Control-Allow-Methods': CORS_METHODS } }
      );
    }

    const supabaseUser = await supabaseResponse.json();

    const verifiedUserId = typeof supabaseUser?.id === 'string' ? supabaseUser.id : null;
    const verifiedEmail = normalizeEmail(supabaseUser?.email);
    const verifiedName =
      typeof supabaseUser?.user_metadata?.full_name === 'string' && supabaseUser.user_metadata.full_name.trim()
        ? supabaseUser.user_metadata.full_name.trim()
        : typeof supabaseUser?.user_metadata?.name === 'string' && supabaseUser.user_metadata.name.trim()
        ? supabaseUser.user_metadata.name.trim()
        : verifiedEmail.split('@')[0];

    logger.info('Supabase access token accepted', { verifiedEmail });

    if (!verifiedUserId || !verifiedEmail) {
      logger.error('Invalid Supabase verification response', { verifiedUserId, verifiedEmail, supabaseUser: sanitizeForLogging(supabaseUser) });
      return NextResponse.json(
        { error: 'Invalid Supabase access token' },
        { status: 401, headers: { ...buildCorsHeaders(req.headers.get('origin')), 'Access-Control-Allow-Methods': CORS_METHODS } }
      );
    }

    logger.info('Verified Supabase profile', { verifiedEmail, verifiedName, verifiedUserId });

    const accountResult = await createGoogleOAuthAccount({
      email: verifiedEmail,
      name: verifiedName,
    });
    const user = accountResult.user;
    const createdNewUser = accountResult.created;

    logger.info('OAuth user linked', {
      verifiedEmail,
      existingUserFound: !accountResult.created,
      createdNewUser,
      returnedUserId: user.id,
    });

    const accessToken = signToken(user.id, verifiedEmail, { expiresInSeconds: 15 * 60 });
    const refreshTokenValue = generateSecureToken();
    const sessionExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await createSessionRecord({
      userId: user.id,
      token: refreshTokenValue,
      userAgent: req.headers.get('user-agent') ?? null,
      ipAddress: req.headers.get('x-forwarded-for') ?? null,
      expiresAt: sessionExpiresAt,
    });
    await recordSecurityEvent(user.id, 'oauth_login_success', { email: verifiedEmail, provider: 'google' });
    logger.info('OAuth JWT generated', { userId: user.id });
      // notify user on new account creation via Google or reauth
      try {
        if (createdNewUser) {
          await createNotification(user.id, {
            title: 'Welcome to Mento (Google)',
            body: `Welcome ${user.name ?? user.email}! Your account was created with Google sign-in.`,
            type: 'welcome',
          });
        } else {
          await createNotification(user.id, {
            title: 'Google re-authenticated',
            body: 'You recently re-authenticated with Google.',
            type: 'security',
          });
        }
      } catch {
        // ignore
      }

      const response = NextResponse.json(
        {
          token: accessToken,
          refreshToken: refreshTokenValue,
          sessionExpiresAt: sessionExpiresAt.toISOString(),
          user: buildUserSummary(user),
        },
        { headers: { ...buildCorsHeaders(req.headers.get('origin')), 'Access-Control-Allow-Methods': CORS_METHODS } }
      );
      applyAuthCookies(response, {
        accessToken,
        refreshToken: refreshTokenValue,
        isProduction: process.env.NODE_ENV === 'production',
      });
      return response;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    const errorMeta: Record<string, unknown> = { error: sanitizeForLogging(err) };

    if (err instanceof PrismaClientValidationError) {
      const prismaDetails = err as PrismaClientValidationError & { code?: string; clientVersion?: string };
      errorMeta.prismaErrorType = 'PrismaClientValidationError';
      errorMeta.prismaErrorMessage = err.message;
      errorMeta.prismaMeta = {
        code: prismaDetails.code,
        clientVersion: prismaDetails.clientVersion,
      };
    }

    if (err instanceof Error && 'stack' in err) {
      errorMeta.stack = err.stack;
    }

    logger.error('Google OAuth error', errorMeta);
    return NextResponse.json({ error: message }, { status: 500, headers: { ...buildCorsHeaders(req.headers.get('origin')), 'Access-Control-Allow-Methods': CORS_METHODS } });
  }
}

