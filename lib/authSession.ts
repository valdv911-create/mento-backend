import crypto from 'node:crypto';
import { prisma } from './prisma';
import { createHash } from 'node:crypto';

export function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSessionRecord(input: {
  userId: string;
  token: string;
  userAgent?: string | null;
  ipAddress?: string | null;
  expiresAt: Date;
}) {
  return prisma.session.create({
    data: {
      userId: input.userId,
      tokenHash: hashToken(input.token),
      userAgent: input.userAgent ?? null,
      ipAddress: input.ipAddress ?? null,
      expiresAt: input.expiresAt,
    },
  });
}

export async function findSessionByToken(token: string) {
  return prisma.session.findFirst({
    where: { tokenHash: hashToken(token), revokedAt: null },
    include: { user: true },
  });
}

export async function revokeSession(sessionId: string) {
  await prisma.session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllUserSessions(userId: string) {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export function generateSecureToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}
