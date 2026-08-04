import { NextResponse } from 'next/server';
import { getUserFromRequest } from '../../../lib/auth';
import { createConversation } from '../../../../lib/conversationDb';
import { info, warn } from '../../../../lib/logger';
import { buildCorsHeaders } from '../../../../lib/securityHeaders';

const CORS_METHODS = 'POST, OPTIONS';

export async function OPTIONS(req: Request) {
  info('Chat start preflight', {
    origin: req.headers.get('origin') ?? null,
  });
  return new NextResponse(null, {
    status: 204,
    headers: { ...buildCorsHeaders(req.headers.get('origin')), 'Access-Control-Allow-Methods': CORS_METHODS },
  });
}

/**
 * POST /api/chat/start
 *
 * Start a new conversation for the authenticated user.
 *
 * Response:
 *   { conversationId: string }
 */

export async function POST(req: Request) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: { ...buildCorsHeaders(req.headers.get('origin')), 'Access-Control-Allow-Methods': CORS_METHODS } });
    }

    const conversation = await createConversation(user.id);
    info('New conversation created', { userId: user.id, conversationId: conversation.id });

    return NextResponse.json({ conversationId: conversation.id }, { headers: { ...buildCorsHeaders(req.headers.get('origin')), 'Access-Control-Allow-Methods': CORS_METHODS } });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    warn('Error creating conversation', { error: message });
    return NextResponse.json({ error: message }, { status: 500, headers: { ...buildCorsHeaders(req.headers.get('origin')), 'Access-Control-Allow-Methods': CORS_METHODS } });
  }
}
