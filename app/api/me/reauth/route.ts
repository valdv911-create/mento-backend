import { NextResponse } from 'next/server';
import { prisma } from '../../../../lib/prisma';
import logger from '../../../../lib/logger';
import { getUserFromRequest, normalizeEmail, verifyPassword, hashPassword } from '../../../lib/auth';

export async function POST(req: Request) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { password } = await req.json();
    if (typeof password !== 'string' || !password.trim()) {
      return NextResponse.json({ error: 'Password is required.' }, { status: 400 });
    }

    const passwordMatches = await verifyPassword(password, user.password);
    if (!passwordMatches) {
      return NextResponse.json({ error: 'Incorrect password.' }, { status: 401 });
    }

    const normalizedEmail = normalizeEmail(user.email);
    const hashed = await hashPassword(password);
    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashed, email: normalizedEmail, lastOAuthReauthAt: new Date() },
    });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'OAuth reauthentication failed.';
    logger.error('OAuth reauth failed', { error });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
