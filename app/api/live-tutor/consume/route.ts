import { NextResponse } from 'next/server';
import { closeRealtimeSession, completeSimliSessionLifecycle } from '../../../../services/simliService';
import {
  AIRequestGatewayError,
  authenticateAIRequest,
  enforceAIGatewayRateLimit,
  executeAIRequest,
  getClientIp,
  buildAIRequestId,
} from '../../../../lib/aiSecurityGateway';
import { buildCorsHeaders } from '../../../../lib/securityHeaders';
import logger from '../../../../lib/logger';

const CORS_METHODS = 'POST, OPTIONS';

export async function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: { ...buildCorsHeaders(req.headers.get('origin')), 'Access-Control-Allow-Methods': CORS_METHODS } });
}

export async function POST(req: Request) {
  try {
    const user = await authenticateAIRequest(req);
    const clientIp = getClientIp(req);
    await enforceAIGatewayRateLimit(user.id, clientIp);

    let body: { seconds?: unknown; streamId?: unknown; status?: unknown; reason?: unknown } | null = null;
    try {
      body = (await req.json()) as { seconds?: unknown; streamId?: unknown; status?: unknown; reason?: unknown };
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400, headers: { ...buildCorsHeaders(req.headers.get('origin')), 'Access-Control-Allow-Methods': CORS_METHODS } });
    }

    const seconds = typeof body?.seconds === 'number' && body.seconds > 0 ? Math.floor(body.seconds) : 60;
    const streamId = typeof body?.streamId === 'string' && body.streamId.trim() ? body.streamId.trim() : undefined;
    const status = typeof body?.status === 'string' ? body.status : undefined;
    const reason = typeof body?.reason === 'string' && body.reason.trim() ? body.reason.trim() : undefined;
    const requestId = buildAIRequestId('live-tutor-consume');

    if (status && streamId && ['completed','failed','disconnected'].includes(status)) {
      await completeSimliSessionLifecycle(streamId, {
        status: status as 'completed' | 'failed' | 'disconnected',
        secondsUsed: seconds,
        reason,
      });
      return NextResponse.json({ ok: true, status, streamId }, { headers: { ...buildCorsHeaders(req.headers.get('origin')), 'Access-Control-Allow-Methods': CORS_METHODS } });
    }

    const { result, billingDecision } = await executeAIRequest({
      user,
      clientIp,
      feature: 'live_tutor',
      provider: 'Simli',
      amount: seconds,
      requestId,
      metadata: { seconds, streamId: streamId ?? null },
      pending: true,
      callback: async ({ billingDecision }) => ({ remaining: billingDecision.remainingUsage ?? 0 }),
    });

    if (billingDecision.remainingUsage !== null && billingDecision.remainingUsage <= 0 && streamId) {
      try {
        await closeRealtimeSession(streamId).catch(() => undefined);
      } catch {
        // ignore close errors
      }
    }

    return NextResponse.json({ remaining: (result as { remaining?: number }).remaining ?? 0, billing: billingDecision }, { headers: { ...buildCorsHeaders(req.headers.get('origin')), 'Access-Control-Allow-Methods': CORS_METHODS } });
  } catch (err: unknown) {
    if (err instanceof AIRequestGatewayError) {
      return NextResponse.json(err.body, { status: err.status, headers: { ...buildCorsHeaders(req.headers.get('origin')), 'Access-Control-Allow-Methods': CORS_METHODS } });
    }
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    logger.error('Live tutor consume failed', { error: err });
    return NextResponse.json({ error: message }, { status: 500, headers: { ...buildCorsHeaders(req.headers.get('origin')), 'Access-Control-Allow-Methods': CORS_METHODS } });
  }
}
