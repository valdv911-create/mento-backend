import { NextResponse } from 'next/server';
import { getUserFromRequest } from '../../../../lib/auth';
import { prisma } from '../../../../../lib/prisma';
import logger from '../../../../../lib/logger';

/**
 * POST /api/chat/message/edit
 * Edit the text of a message in a conversation (auth required)
 */
export async function POST(req: Request) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { messageId, text } = body;

    if (!messageId || typeof messageId !== 'string') {
      return NextResponse.json({ error: 'Invalid messageId' }, { status: 400 });
    }

    if (!text || typeof text !== 'string' || !text.trim()) {
      return NextResponse.json({ error: 'Invalid text' }, { status: 400 });
    }

    // Fetch the message to verify conversation ownership
    const message = await prisma.conversationMessage.findUnique({
      where: { id: messageId },
      include: { conversation: { select: { userId: true } } }
    });

    if (!message) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    }

    // Verify user owns the conversation
    if (message.conversation.userId !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Only allow editing user messages
    if (message.role !== 'user') {
      return NextResponse.json({ error: 'Cannot edit assistant messages' }, { status: 400 });
    }

    // Update the message
    const updated = await prisma.conversationMessage.update({
      where: { id: messageId },
      data: { text: text.trim() }
    });

    return NextResponse.json({ success: true, message: updated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    logger.error('Edit message failed', { error: err });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
