import { NextResponse } from 'next/server';
import { prisma } from '../../../../lib/prisma';
import logger from '../../../../lib/logger';
import { getUserFromRequest, normalizeEmail, verifyPassword, buildUserSummary, getSensitiveActionRequirements } from '../../../lib/auth';

export async function POST(req: Request) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { password, email } = await req.json();
    const normalizedEmail = normalizeEmail(email);
    if (typeof password !== 'string' || !password.trim()) {
      return NextResponse.json({ error: 'Password confirmation is required.' }, { status: 400 });
    }
    if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return NextResponse.json({ error: 'A valid email is required.' }, { status: 400 });
    }

    const passwordMatches = await verifyPassword(password, user.password);
    if (!passwordMatches) {
      return NextResponse.json({ error: 'Incorrect password.' }, { status: 401 });
    }

    const actionRequirements = getSensitiveActionRequirements(user);
    if (actionRequirements.requiresRecentOAuthReauth) {
      return NextResponse.json({ error: 'Please re-authenticate with Google recently before changing your email.' }, { status: 403 });
    }

    const existing = await prisma.user.findFirst({
      where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
    });
    if (existing && existing.id !== user.id) {
      return NextResponse.json({ error: 'Email already in use.' }, { status: 409 });
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { email: normalizedEmail },
    });

    return NextResponse.json({ user: buildUserSummary(updated) });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Email change failed.';
    logger.error('Email change failed', { error });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
