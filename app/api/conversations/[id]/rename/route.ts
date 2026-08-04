import { NextResponse } from 'next/server';
import { getUserFromRequest } from '../../../../lib/auth';
import { updateConversationTitle, validateConversationOwnership } from '../../../../../lib/conversationDb';
import { warn } from '../../../../../lib/logger';
import { buildCorsHeaders } from '../../../../../lib/securityHeaders';

const CORS_METHODS = 'POST, OPTIONS';

export async function OPTIONS(req: Request) {
  return new NextResponse(null, {
    status: 204,
    headers: { ...buildCorsHeaders(req.headers.get('origin')), 'Access-Control-Allow-Methods': CORS_METHODS },
  });
}

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: { ...buildCorsHeaders(req.headers.get('origin')), 'Access-Control-Allow-Methods': CORS_METHODS } });
    }

    const { id: conversationId } = await context.params;
    const body = await req.json().catch(() => ({}));
    const title = typeof body?.title === 'string' ? body.title : '';

    const owns = await validateConversationOwnership(conversationId, user.id);
    if (!owns) {
      warn('Unauthorized rename attempt', { userId: user.id, conversationId });
      return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: { ...buildCorsHeaders(req.headers.get('origin')), 'Access-Control-Allow-Methods': CORS_METHODS } });
    }

    if (!title.trim()) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400, headers: { ...buildCorsHeaders(req.headers.get('origin')), 'Access-Control-Allow-Methods': CORS_METHODS } });
    }

    await updateConversationTitle(conversationId, title);
    return NextResponse.json({ success: true }, { headers: { ...buildCorsHeaders(req.headers.get('origin')), 'Access-Control-Allow-Methods': CORS_METHODS } });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    warn('Error renaming conversation', { error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
