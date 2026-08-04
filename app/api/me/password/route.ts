import { NextResponse } from 'next/server';
import { prisma } from '../../../../lib/prisma';
import logger from '../../../../lib/logger';
import { getUserFromRequest, normalizeEmail, hashPassword, validatePasswordStrength, verifyPassword, getSensitiveActionRequirements } from '../../../lib/auth';

export async function POST(req: Request) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { currentPassword, newPassword, confirmPassword } = await req.json();
    if (typeof currentPassword !== 'string' || !currentPassword.trim()) {
      return NextResponse.json({ error: 'Current password is required.' }, { status: 400 });
    }
    if (typeof newPassword !== 'string' || !newPassword.trim()) {
      return NextResponse.json({ error: 'New password is required.' }, { status: 400 });
    }
    if (typeof confirmPassword !== 'string' || confirmPassword !== newPassword) {
      return NextResponse.json({ error: 'New passwords must match.' }, { status: 400 });
    }

    const currentPasswordMatches = await verifyPassword(currentPassword, user.password);
    if (!currentPasswordMatches) {
      return NextResponse.json({ error: 'Current password is incorrect.' }, { status: 401 });
    }

    const actionRequirements = getSensitiveActionRequirements(user);
    if (actionRequirements.requiresRecentOAuthReauth) {
      return NextResponse.json({ error: 'Please re-authenticate with Google recently before changing your password.' }, { status: 403 });
    }

    const passwordPolicy = validatePasswordStrength(newPassword);
    if (!passwordPolicy.isValid) {
      return NextResponse.json({ error: passwordPolicy.reasons.join(' ') }, { status: 400 });
    }

    const normalizedEmail = normalizeEmail(user.email);
    const hashed = await hashPassword(newPassword);
    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashed, email: normalizedEmail },
    });

    // notify user about password change (best-effort)
    try {
      const { createNotification } = await import('../../../services/notificationService');
      await createNotification(user.id, {
        title: 'Password changed',
        body: 'Your account password was recently changed. If this wasn\'t you, please contact support.',
        type: 'security',
      });
    } catch {
      // ignore
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    logger.error('Password change failed', { error });
    const message = error instanceof Error ? error.message : 'Password change failed.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
