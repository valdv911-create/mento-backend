import logger from '../lib/logger';
import { getCircuitBreaker, retryWithBackoff, getClientErrorMessage, getProviderRetryOptions, sanitizeForLogging } from '../lib/resilience';
import { getSimliApiKey, getSimliAvatarId, getSimliVoiceId, getSimliApiUrl } from '../lib/env';
import { finalizeUsage, rollbackUsage } from './billingService';
import { incrementMonitoringFailure, observeMonitoringLatency } from '../lib/monitoring';
import '../lib/metrics';

export interface SimliStreamingSession {
  token: string;
  streamId: string;
  sessionId?: string;
  avatarId?: string;
  expiresAt?: string;
  connected?: boolean;
  status?: 'active' | 'disconnected' | 'reconnecting' | 'ended';
}

interface SessionRecord extends SimliStreamingSession {
  createdAt: string;
  lastHeartbeatAt?: string;
  billingRequestId?: string;
  userId?: string;
  secondsReserved?: number;
  secondsConsumed?: number;
  billingFinalized?: boolean;
}

const simliBreaker = getCircuitBreaker('simli', 3, 30000);
const simliProviderOptions = getProviderRetryOptions('simli');

const activeSessions = new Map<string, SessionRecord>();

function requireSimliConfig(): { apiKey: string; avatarId: string; voiceId: string } {
  const apiKey = getSimliApiKey();
  const avatarId = getSimliAvatarId();
  const voiceId = getSimliVoiceId();

  if (!apiKey || !avatarId || !voiceId) {
    logger.warn('Simli service configuration missing.', { missingApiKey: !apiKey, missingAvatarId: !avatarId, missingVoiceId: !voiceId });
    throw new Error('Server configuration error: SIMLI_API_KEY, SIMLI_AVATAR_ID, and SIMLI_VOICE_ID are required.');
  }

  return { apiKey, avatarId, voiceId };
}

function requireSimliApiKey(): string {
  const apiKey = getSimliApiKey();
  if (!apiKey) {
    logger.warn('SIMLI_API_KEY is not configured.');
    throw new Error('Server configuration error: SIMLI_API_KEY environment variable is missing.');
  }
  return apiKey;
}

function buildSimliError(message: string, status = 500): Error & { status: number } {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

function getJsonMessage(json: unknown): string | undefined {
  if (typeof json !== 'object' || json === null) return undefined;
  const payload = json as { error?: { message?: unknown }; message?: unknown };
  const errorMessage = typeof payload.error?.message === 'string' ? payload.error.message : undefined;
  if (errorMessage) return errorMessage;
  return typeof payload.message === 'string' ? payload.message : undefined;
}

function extractSessionInfo(json: unknown): SimliStreamingSession {
  const payload = typeof json === 'object' && json !== null ? (json as Record<string, unknown>) : {};
  const data = typeof payload.data === 'object' && payload.data !== null ? (payload.data as Record<string, unknown>) : undefined;
  const token = (data?.token as string | undefined) ?? (payload.token as string | undefined);
  if (!token || typeof token !== 'string') {
    throw buildSimliError('Simli session creation succeeded but did not return a valid token.', 502);
  }

  const streamId = (data?.stream_id as string | undefined) ?? (payload.stream_id as string | undefined) ?? (payload.streamId as string | undefined);
  if (!streamId || typeof streamId !== 'string') {
    throw buildSimliError('Simli session creation succeeded but did not return a valid stream_id.', 502);
  }

  const expiresAt = (data?.expires_at as string | undefined) ?? (payload.expiresAt as string | undefined) ?? (payload.expires_at as string | undefined);
  const sessionId = (data?.session_id as string | undefined) ?? (payload.sessionId as string | undefined) ?? (payload.session_id as string | undefined);
  const avatarId = (data?.avatar_id as string | undefined) ?? (payload.avatarId as string | undefined) ?? (payload.avatar_id as string | undefined);

  return {
    token,
    streamId,
    ...(sessionId ? { sessionId } : {}),
    ...(avatarId ? { avatarId } : {}),
    ...(expiresAt ? { expiresAt } : {}),
    connected: true,
    status: 'active',
  };
}

function saveSession(session: SimliStreamingSession | SessionRecord) {
  if (!session?.streamId) return;
  activeSessions.set(session.streamId, {
    ...session,
    createdAt: 'createdAt' in session && typeof session.createdAt === 'string' ? session.createdAt : new Date().toISOString(),
    lastHeartbeatAt: 'lastHeartbeatAt' in session && typeof session.lastHeartbeatAt === 'string' ? session.lastHeartbeatAt : new Date().toISOString(),
  } as SessionRecord);
}

function removeSession(streamId: string) {
  activeSessions.delete(streamId);
}

function getSession(streamId: string): SessionRecord | undefined {
  if (!streamId) return undefined;
  return activeSessions.get(streamId);
}

export function getActiveSimliSession(streamId: string): SimliStreamingSession | undefined {
  return getSession(streamId);
}

export async function createSimliStreamingAvatarSession(options: {
  requestId?: string;
  userId?: string;
  secondsReserved?: number;
} = {}): Promise<SimliStreamingSession> {
  const { apiKey, avatarId, voiceId } = requireSimliConfig();
  if (simliBreaker.isOpen()) {
    throw new Error('Simli is temporarily unavailable. Please try again shortly.');
  }

  logger.info('Creating Simli session', { provider: 'simli' });
  const startedAt = Date.now();

  try {
    const response = await retryWithBackoff(async () => {
      const apiUrl = getSimliApiUrl();
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'text_stream',
          avatar_id: avatarId,
          voice_id: voiceId,
          text: 'Live tutor session initializing.',
        }),
      });

      if (!res.ok) {
        const rawResponse = await res.text();
        let json: unknown;
        try { json = rawResponse ? JSON.parse(rawResponse) : {}; } catch { json = { raw: rawResponse }; }
        const error = new Error((json as { error?: { message?: string }; message?: string } | null | undefined)?.error?.message || (json as { error?: { message?: string }; message?: string } | null | undefined)?.message || 'Simli request failed');
        (error as Error & { status: number }).status = res.status;
        throw error;
      }
      return res;
    }, {
      ...simliProviderOptions,
      retries: simliProviderOptions.retries,
      baseDelayMs: simliProviderOptions.baseDelayMs,
      maxDelayMs: simliProviderOptions.maxDelayMs,
      timeoutMs: simliProviderOptions.timeoutMs,
      provider: 'simli',
    });

    const rawResponse = await response.text();
    let json: unknown;
    try {
      json = rawResponse ? JSON.parse(rawResponse) : {};
    } catch {
      logger.error('Simli invalid JSON response', { provider: 'simli', responsePreview: rawResponse.slice(0, 200) });
      simliBreaker.recordFailure();
      throw buildSimliError('Simli avatar realtime creation returned an unexpected response.', 502);
    }

    if (!response.ok) {
      logger.error('Simli session creation failed', { provider: 'simli', status: response.status, payload: sanitizeForLogging(json) });
      const errorMessage = (json as { error?: { message?: string }; message?: string } | null | undefined)?.error?.message || (json as { error?: { message?: string }; message?: string } | null | undefined)?.message || JSON.stringify(json) || 'Simli avatar realtime request failed.';
      simliBreaker.recordFailure();
      throw buildSimliError(`Simli session creation failed: ${errorMessage}`, response.status);
    }

    const sessionInfo = extractSessionInfo(json);
    logger.info('Simli session created', { provider: 'simli', streamId: sessionInfo.streamId });
    saveSession({
      ...sessionInfo,
      billingRequestId: options.requestId,
      userId: options.userId,
      secondsReserved: options.secondsReserved ?? 60,
      secondsConsumed: 0,
      billingFinalized: false,
    });
    simliBreaker.recordSuccess();
    observeMonitoringLatency('simli', Date.now() - startedAt, { provider: 'simli', operation: 'create_session' });
    return sessionInfo;
  } catch (error: unknown) {
    simliBreaker.recordFailure();
    const rawMessage = typeof error === 'object' && error !== null && 'message' in error ? (error as { message?: unknown }).message : undefined;
    const message = getClientErrorMessage(typeof rawMessage === 'string' ? rawMessage : undefined, 'Simli is temporarily unavailable. Please try again shortly.');
    logger.error('Simli session creation error', { provider: 'simli', error: sanitizeForLogging(error) });
    observeMonitoringLatency('simli', Date.now() - startedAt, { provider: 'simli', operation: 'create_session', status: 'error' });
    incrementMonitoringFailure('tutor', { provider: 'simli', reason: 'session_creation' });
    throw new Error(message);
  }
}

export async function markSimliSessionConnected(streamId: string): Promise<void> {
  const session = getSession(streamId);
  if (!session) return;
  const nextSession: SessionRecord = {
    ...session,
    createdAt: session.createdAt ?? new Date().toISOString(),
    connected: true,
    status: 'active' as const,
    lastHeartbeatAt: new Date().toISOString(),
  };
  activeSessions.set(streamId, nextSession);
}

export async function markSimliSessionDisconnected(streamId: string, reason?: string): Promise<void> {
  const session = getSession(streamId);
  if (!session) return;
  const nextSession: SessionRecord = {
    ...session,
    createdAt: session.createdAt ?? new Date().toISOString(),
    connected: false,
    status: 'disconnected' as const,
    lastHeartbeatAt: new Date().toISOString(),
  };
  if (reason) {
    logger.warn('Simli session disconnected', { provider: 'simli', streamId, reason });
  }
  activeSessions.set(streamId, nextSession);
}

export async function reconnectSimliSession(streamId: string): Promise<SimliStreamingSession> {
  const previousSession = getSession(streamId);
  const replacement = await createSimliStreamingAvatarSession({
    requestId: previousSession?.billingRequestId,
    userId: previousSession?.userId,
    secondsReserved: previousSession?.secondsReserved ?? 60,
  });
  if (previousSession?.streamId) {
    removeSession(previousSession.streamId);
  }
  saveSession({ ...replacement, connected: false, status: 'reconnecting' });
  return replacement;
}

export async function sendRealtimeText(streamId: string, text: string): Promise<string> {
  if (!text || typeof text !== 'string') throw buildSimliError('Text must be a non-empty string', 400);
  const apiKey = requireSimliApiKey();
  const apiUrl = getSimliApiUrl();

  if (simliBreaker.isOpen()) {
    throw new Error('Simli is temporarily unavailable. Please try again shortly.');
  }

  let targetStreamId = streamId;
  let session: SessionRecord | undefined = getSession(targetStreamId);
  if (!session) {
    logger.warn('Simli service: sendRealtimeText called with unknown streamId, creating new session.', { streamId });
    const createdSession = await createSimliStreamingAvatarSession();
    session = {
      ...createdSession,
      createdAt: new Date().toISOString(),
      lastHeartbeatAt: new Date().toISOString(),
    };
    targetStreamId = session.streamId;
  }

  const url = `${apiUrl}/${encodeURIComponent(targetStreamId)}/text`;

  const timeoutMs = Math.max(1000, simliProviderOptions.timeoutMs ?? 8000);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const raw = await res.text();
  let json: unknown;
  try {
    json = raw ? JSON.parse(raw) : {};
  } catch {
    logger.error('Simli sendRealtimeText: invalid JSON response', { provider: 'simli', responsePreview: raw.slice(0, 200) });
    throw buildSimliError('Invalid JSON response from Simli text endpoint.', 502);
  }

  if (res.ok) {
    return targetStreamId;
  }

  if (res.status === 401 || res.status === 404 || res.status === 410) {
    try {
      const newSession = await reconnectSimliSession(targetStreamId);
      const retryUrl = `${apiUrl}/${encodeURIComponent(newSession.streamId)}/text`;
      const timeoutMs = Math.max(1000, simliProviderOptions.timeoutMs ?? 8000);
      const retryRes = await fetch(retryUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const retryRaw = await retryRes.text();
      let retryJson: unknown;
      try {
        retryJson = retryRaw ? JSON.parse(retryRaw) : {};
      } catch {
        logger.error('Simli sendRealtimeText (retry): invalid JSON response', { provider: 'simli', responsePreview: retryRaw.slice(0, 200) });
        throw buildSimliError('Invalid JSON response from Simli text endpoint (retry).', 502);
      }

      if (retryRes.ok) {
        return newSession.streamId;
      }

      throw buildSimliError(`Simli text send failed after reconnect: ${getJsonMessage(retryJson) ?? retryRes.status}`, retryRes.status);
    } catch (err: unknown) {
      const reconnectMessage = typeof err === 'object' && err !== null && 'message' in err ? (err as { message?: unknown }).message : undefined;
      logger.error('Simli service: reconnect attempt failed.', { provider: 'simli', error: sanitizeForLogging(reconnectMessage ?? err) });
      throw buildSimliError('Simli session expired and reconnect failed.', 502);
    }
  }

  const errMsg = getJsonMessage(json) || JSON.stringify(json) || 'Simli text send failed.';
  throw buildSimliError(`Simli text send failed: ${errMsg}`, res.status);
}

export async function completeSimliSessionLifecycle(streamId: string, options: {
  status: 'completed' | 'failed' | 'disconnected';
  secondsUsed?: number;
  reason?: string;
}): Promise<void> {
  const session = getSession(streamId);
  if (!session) return;

  const secondsUsed = Math.max(0, Math.floor(options.secondsUsed ?? 0));
  if (session.billingRequestId && session.userId && !session.billingFinalized) {
    try {
      if (options.status === 'disconnected') {
        await markSimliSessionDisconnected(streamId, options.reason);
        return;
      }

      if (options.status === 'failed') {
        await rollbackUsage({
          userId: session.userId,
          feature: 'live_tutor',
          amount: secondsUsed || (session.secondsReserved ?? 60),
          provider: 'Simli',
          requestId: session.billingRequestId,
          metadata: { streamId, status: options.status, reason: options.reason ?? 'Session failed' },
          pending: true,
        });
      } else {
        await finalizeUsage({
          userId: session.userId,
          feature: 'live_tutor',
          amount: secondsUsed || (session.secondsReserved ?? 60),
          provider: 'Simli',
          requestId: session.billingRequestId,
          metadata: { streamId, status: options.status, reason: options.reason ?? 'Session ended' },
          pending: true,
          secondsUsed,
        });
      }

      const updatedSession = getSession(streamId);
      if (updatedSession) {
        activeSessions.set(streamId, { ...updatedSession, billingFinalized: true });
      }
    } catch (error) {
      logger.warn('Simli session billing lifecycle update failed', { provider: 'simli', streamId, error: sanitizeForLogging(error) });
    }
  }

  await closeRealtimeSession(streamId);
}

export async function closeRealtimeSession(streamId: string): Promise<void> {
  if (!streamId) return;
  const apiKey = requireSimliApiKey();
  const apiUrl = getSimliApiUrl();
  const closeUrl = `${apiUrl}/${encodeURIComponent(streamId)}/close`;
  try {
    const timeoutMs = Math.max(1000, simliProviderOptions.timeoutMs ?? 8000);
    const res = await fetch(closeUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });

    const raw = await res.text();
    let json: unknown;
    try {
      json = raw ? JSON.parse(raw) : {};
    } catch {
      json = { raw };
    }

    if (res.ok) {
      removeSession(streamId);
      return;
    }

    if (res.status === 404 || res.status === 405) {
      const delUrl = `${apiUrl}/${encodeURIComponent(streamId)}`;
      const timeoutMs = Math.max(1000, simliProviderOptions.timeoutMs ?? 8000);
      const delRes = await fetch(delUrl, { method: 'DELETE', headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(timeoutMs) });
      if (delRes.ok) {
        removeSession(streamId);
        return;
      }
      throw buildSimliError('Simli session close/delete failed.', delRes.status);
    }

    throw buildSimliError(`Simli session close failed: ${getJsonMessage(json) ?? res.status}`, res.status);
  } catch (err: unknown) {
    const closeErrorMessage = typeof err === 'object' && err !== null && 'message' in err ? (err as { message?: unknown }).message : undefined;
    logger.error('Simli service: session close error', { provider: 'simli', error: sanitizeForLogging(closeErrorMessage ?? err) });
    removeSession(streamId);
    throw err;
  }
}

export async function shutdownActiveSimliSessions(): Promise<void> {
  const sessions = [...activeSessions.values()];
  if (sessions.length === 0) return;

  await Promise.allSettled(sessions.map((session) => completeSimliSessionLifecycle(session.streamId, {
    status: 'failed',
    secondsUsed: session.secondsConsumed ?? 0,
    reason: 'Server shutdown',
  })));
}

export async function getAvailableAvatars(): Promise<unknown> {
  const apiKey = requireSimliApiKey();
  const apiUrl = getSimliApiUrl();
  const timeoutMs = Math.max(1000, simliProviderOptions.timeoutMs ?? 8000);
  const url = `${apiUrl.replace(/\/sessions$/u, '')}/avatars`;
  const res = await fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  const raw = await res.text();
  let json: unknown;
  try {
    json = raw ? JSON.parse(raw) : {};
  } catch {
    logger.warn('Simli avatars: invalid JSON response', { provider: 'simli', responsePreview: raw.slice(0, 200) });
    throw buildSimliError('Invalid JSON response from Simli avatars endpoint.', 502);
  }

  if (!res.ok) {
    const payload = typeof json === 'object' && json !== null ? (json as { error?: unknown; message?: unknown }) : undefined;
    throw buildSimliError(`Simli avatars request failed: ${typeof payload?.error === 'string' ? payload.error : typeof payload?.message === 'string' ? payload.message : res.status}`, res.status);
  }

  return json;
}

export async function getAvailableVoices(): Promise<unknown> {
  const apiKey = requireSimliApiKey();
  const apiUrl = getSimliApiUrl();
  const timeoutMs = Math.max(1000, simliProviderOptions.timeoutMs ?? 8000);
  const url = `${apiUrl.replace(/\/sessions$/u, '')}/voices`;
  const res = await fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  const raw = await res.text();
  let json: unknown;
  try {
    json = raw ? JSON.parse(raw) : {};
  } catch {
    logger.warn('Simli voices: invalid JSON response', { provider: 'simli', responsePreview: raw.slice(0, 200) });
    throw buildSimliError('Invalid JSON response from Simli voices endpoint.', 502);
  }

  if (!res.ok) {
    const payload = typeof json === 'object' && json !== null ? (json as { error?: unknown; message?: unknown }) : undefined;
    throw buildSimliError(`Simli voices request failed: ${typeof payload?.error === 'string' ? payload.error : typeof payload?.message === 'string' ? payload.message : res.status}`, res.status);
  }

  return json;
}
