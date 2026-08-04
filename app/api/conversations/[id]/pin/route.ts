import { NextResponse } from 'next/server';
import { getUserFromRequest } from '../../../../lib/auth';
import { pinConversation, validateConversationOwnership } from '../../../../../lib/conversationDb';
import { warn } from '../../../../../lib/logger';

/**
 * POST /api/conversations/[id]/pin
 *
 * Pin a conversation. Pinned conversations appear at the top of the drawer.
 *
 * Response:
 *   { success: true }
 */

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: conversationId } = await context.params;

    // Validate ownership
    const owns = await validateConversationOwnership(conversationId, user.id);
    if (!owns) {
      warn('Unauthorized pin attempt', { userId: user.id, conversationId });
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    await pinConversation(conversationId);

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    warn('Error pinning conversation', { error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
