import { NextResponse } from 'next/server';
import { prisma } from '../../../../lib/prisma';
import { signToken, normalizeEmail, recordSecurityEvent, buildUserSummary, applyAuthCookies } from '../../../lib/auth';
import { findSessionByToken, generateSecureToken, hashToken } from '../../../../lib/authSession';
import { buildCorsHeaders } from '../../../../lib/securityHeaders';

const CORS_METHODS = 'POST, OPTIONS';

export async function OPTIONS(req: Request) {
  const corsHeaders = buildCorsHeaders(req.headers.get('origin'));
  return new NextResponse(null, { status: 204, headers: { ...corsHeaders, 'Access-Control-Allow-Methods': CORS_METHODS } });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const refreshToken = typeof body?.refreshToken === 'string' ? body.refreshToken.trim() : '';
    if (!refreshToken) {
      return NextResponse.json({ error: 'Refresh token required' }, { status: 400, headers: { ...buildCorsHeaders(req.headers.get('origin')), 'Access-Control-Allow-Methods': CORS_METHODS } });
    }

    const sessionRecord = await findSessionByToken(refreshToken);

    if (!sessionRecord || sessionRecord.expiresAt.getTime() <= Date.now()) {
      return NextResponse.json({ error: 'Refresh token expired' }, { status: 401, headers: { ...buildCorsHeaders(req.headers.get('origin')), 'Access-Control-Allow-Methods': CORS_METHODS } });
    }

    const user = sessionRecord.user;
    const accessToken = signToken(user.id, normalizeEmail(user.email), { expiresInSeconds: 15 * 60 });
    const rotatedRefreshToken = generateSecureToken();

    await prisma.session.update({
      where: { id: sessionRecord.id },
      data: {
        revokedAt: new Date(),
        replacedBySessionId: sessionRecord.id,
        updatedAt: new Date(),
      },
    });

    await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(rotatedRefreshToken),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        userAgent: req.headers.get('user-agent') ?? null,
        ipAddress: req.headers.get('x-forwarded-for') ?? null,
      },
    });

    await recordSecurityEvent(user.id, 'token_refresh', { ip: req.headers.get('x-forwarded-for') ?? null });

    const response = NextResponse.json({
      token: accessToken,
      refreshToken: rotatedRefreshToken,
      user: buildUserSummary(user),
    }, { headers: { ...buildCorsHeaders(req.headers.get('origin')), 'Access-Control-Allow-Methods': CORS_METHODS } });
    applyAuthCookies(response, {
      accessToken,
      refreshToken: rotatedRefreshToken,
      isProduction: process.env.NODE_ENV === 'production',
    });
    return response;
  } catch (error) {
    return NextResponse.json({ error: 'Unable to refresh session' }, { status: 500, headers: { ...buildCorsHeaders(req.headers.get('origin')), 'Access-Control-Allow-Methods': CORS_METHODS } });
  }
}
