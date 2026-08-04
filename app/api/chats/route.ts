import { NextResponse } from 'next/server';
import { getUserFromRequest } from '../../lib/auth';
import { prisma } from '../../../lib/prisma';
import logger from '../../../lib/logger';

/**
 * GET /api/chats
 * Returns all conversations for the authenticated user with lightweight metadata.
 */
export async function GET(req: Request) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const convs = await prisma.conversation.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: 'desc' },
      include: {
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { role: true, text: true, createdAt: true },
        },
      },
    });

    const result = convs.map((c) => ({
      id: c.id,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      lastMessage: c.messages?.[0] ? { role: c.messages[0].role, text: c.messages[0].text, createdAt: c.messages[0].createdAt } : null,
    }));

    return NextResponse.json({ chats: result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    logger.error('Chats fetch failed', { error: err });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export default GET;
