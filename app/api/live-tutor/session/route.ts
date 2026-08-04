import { NextResponse } from 'next/server';
import { createSimliStreamingAvatarSession, closeRealtimeSession } from '../../../../services/simliService';
import {
  AIRequestGatewayError,
  authenticateAIRequest,
  enforceAIGatewayRateLimit,
  executeAIRequest,
  getClientIp,
  buildAIRequestId,
} from '../../../../lib/aiSecurityGateway';
import logger from '../../../../lib/logger';

export async function GET(req: Request) {
  try {
    const user = await authenticateAIRequest(req);
    const clientIp = getClientIp(req);
    await enforceAIGatewayRateLimit(user.id, clientIp);

    const requestId = buildAIRequestId('simli-session');
    const { result: session, billingDecision } = await executeAIRequest({
      user,
      clientIp,
      feature: 'live_tutor',
      provider: 'Simli',
      amount: 60,
      requestId,
      metadata: { streamType: 'avatar-session' },
      pending: true,
      callback: async () => await createSimliStreamingAvatarSession(),
    });

    if (billingDecision.remainingUsage !== null && billingDecision.remainingUsage <= 0) {
      try {
        await closeRealtimeSession(session.streamId).catch(() => undefined);
      } catch {
        // ignore cleanup errors
      }
    }

    return NextResponse.json({
      accessToken: session.token,
      streamId: session.streamId,
      sessionId: session.sessionId,
      avatarId: session.avatarId,
      expiresAt: session.expiresAt,
      billing: billingDecision,
    });
  } catch (error: unknown) {
    if (error instanceof AIRequestGatewayError) {
      return NextResponse.json(error.body, { status: error.status });
    }

    const message = error instanceof Error ? error.message : 'Internal Server Error';
    const status = (error as { status?: number })?.status ?? 500;

    logger.error('Simli session request failed', { error: message });
    return NextResponse.json({ error: message }, { status });
  }
}
