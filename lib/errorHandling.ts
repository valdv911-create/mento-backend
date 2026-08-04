export type AppErrorCategory = 'validation' | 'authentication' | 'authorization' | 'database' | 'network' | 'ai_provider' | 'billing' | 'file_upload' | 'timeout' | 'rate_limit' | 'external_api' | 'configuration' | 'internal_server' | 'unknown';

export interface AppErrorShape {
  category: AppErrorCategory;
  code: string;
  message: string;
  developerMessage: string;
  httpStatus: number;
  retryable: boolean;
  loggingLevel: 'info' | 'warn' | 'error';
  requestId?: string;
  source?: string;
}

export interface ApiErrorPayload {
  success: false;
  error: {
    code: string;
    message: string;
    requestId?: string;
    retryable: boolean;
    details?: unknown;
  };
}

export type ChatErrorKind = 'offline' | 'timeout' | 'rate_limit' | 'provider_unavailable' | 'cancelled' | 'unknown';

export interface ChatErrorState {
  kind: ChatErrorKind;
  title: string;
  message: string;
  retryable: boolean;
}

const DEFAULTS: Record<AppErrorCategory, Omit<AppErrorShape, 'category' | 'code'>> = {
  validation: { message: 'Your request could not be validated.', developerMessage: 'Input validation failed.', httpStatus: 400, retryable: false, loggingLevel: 'warn' },
  authentication: { message: 'Please sign in again to continue.', developerMessage: 'Authentication failed.', httpStatus: 401, retryable: false, loggingLevel: 'warn' },
  authorization: { message: 'You do not have permission to perform that action.', developerMessage: 'Authorization failed.', httpStatus: 403, retryable: false, loggingLevel: 'warn' },
  database: { message: 'We could not complete that request right now.', developerMessage: 'Database operation failed.', httpStatus: 503, retryable: true, loggingLevel: 'error' },
  network: { message: 'We are having trouble reaching the service.', developerMessage: 'Network request failed.', httpStatus: 502, retryable: true, loggingLevel: 'warn' },
  ai_provider: { message: 'The AI service is temporarily unavailable. Please try again shortly.', developerMessage: 'AI provider returned an error.', httpStatus: 502, retryable: true, loggingLevel: 'error' },
  billing: { message: 'Your access to that feature is currently unavailable.', developerMessage: 'Billing or quota check failed.', httpStatus: 402, retryable: false, loggingLevel: 'warn' },
  file_upload: { message: 'The uploaded file could not be processed.', developerMessage: 'File upload or validation failed.', httpStatus: 400, retryable: false, loggingLevel: 'warn' },
  timeout: { message: 'The request is temporarily unavailable. Please try again shortly.', developerMessage: 'Timeout while waiting for upstream service.', httpStatus: 504, retryable: true, loggingLevel: 'warn' },
  rate_limit: { message: 'Too many requests. Please wait a moment and try again.', developerMessage: 'Rate limit exceeded.', httpStatus: 429, retryable: true, loggingLevel: 'warn' },
  external_api: { message: 'A connected service is currently unavailable.', developerMessage: 'External API request failed.', httpStatus: 502, retryable: true, loggingLevel: 'error' },
  configuration: { message: 'The service is not configured correctly.', developerMessage: 'Configuration error.', httpStatus: 500, retryable: false, loggingLevel: 'error' },
  internal_server: { message: 'We hit an unexpected issue. Please try again shortly.', developerMessage: 'Unexpected server error.', httpStatus: 500, retryable: true, loggingLevel: 'error' },
  unknown: { message: 'Something went wrong. Please try again shortly.', developerMessage: 'Unhandled application error.', httpStatus: 500, retryable: true, loggingLevel: 'error' },
};

function normalizeStatus(fallback: number, status?: number): number {
  return typeof status === 'number' && Number.isFinite(status) ? status : fallback;
}

export function classifyAppError(error: unknown, context: { status?: number; source?: string; requestId?: string } = {}): AppErrorShape {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error';
  const status = context?.status;
  const source = context?.source?.toLowerCase() || 'unknown';

  const lower = message.toLowerCase();

  if (/invalid json|invalid input|malformed|required/.test(lower)) {
    return { category: 'validation', code: 'validation_error', message: DEFAULTS.validation.message, developerMessage: message, httpStatus: normalizeStatus(DEFAULTS.validation.httpStatus, status), retryable: false, loggingLevel: 'warn', requestId: context?.requestId, source };
  }

  if (/unauthorized|authentication|jwt|token|sign in|login/.test(lower)) {
    return { category: 'authentication', code: 'authentication_failed', message: DEFAULTS.authentication.message, developerMessage: message, httpStatus: normalizeStatus(DEFAULTS.authentication.httpStatus, status), retryable: false, loggingLevel: 'warn', requestId: context?.requestId, source };
  }

  if (/forbidden|permission|not allowed/.test(lower)) {
    return { category: 'authorization', code: 'authorization_failed', message: DEFAULTS.authorization.message, developerMessage: message, httpStatus: normalizeStatus(DEFAULTS.authorization.httpStatus, status), retryable: false, loggingLevel: 'warn', requestId: context?.requestId, source };
  }

  if (/prisma|database|connection|deadlock/i.test(lower) || status === 503) {
    return { category: 'database', code: 'database_error', message: DEFAULTS.database.message, developerMessage: message, httpStatus: normalizeStatus(DEFAULTS.database.httpStatus, status), retryable: true, loggingLevel: 'error', requestId: context?.requestId, source };
  }

  if (/rate limit|too many requests|quota/.test(lower) || status === 429) {
    return { category: 'rate_limit', code: 'rate_limit_exceeded', message: DEFAULTS.rate_limit.message, developerMessage: message, httpStatus: normalizeStatus(DEFAULTS.rate_limit.httpStatus, status), retryable: true, loggingLevel: 'warn', requestId: context?.requestId, source };
  }

  if (/timeout|timed out|deadline/i.test(lower) || status === 504) {
    return { category: 'timeout', code: 'timeout', message: DEFAULTS.timeout.message, developerMessage: message, httpStatus: normalizeStatus(DEFAULTS.timeout.httpStatus, status), retryable: true, loggingLevel: 'warn', requestId: context?.requestId, source };
  }

  if (/gemini|ai provider|provider|model not found|service unavailable|temporarily unavailable|overloaded|quota/i.test(lower) || source === 'gemini') {
    return { category: 'ai_provider', code: 'ai_provider_error', message: DEFAULTS.ai_provider.message, developerMessage: message, httpStatus: normalizeStatus(DEFAULTS.ai_provider.httpStatus, status), retryable: true, loggingLevel: 'error', requestId: context?.requestId, source };
  }

  if (/billing|usage|plan|payment|insufficient/i.test(lower)) {
    return { category: 'billing', code: 'billing_error', message: DEFAULTS.billing.message, developerMessage: message, httpStatus: normalizeStatus(DEFAULTS.billing.httpStatus, status), retryable: false, loggingLevel: 'warn', requestId: context?.requestId, source };
  }

  if (/file|upload|image/i.test(lower) && /invalid|failed|missing/.test(lower)) {
    return { category: 'file_upload', code: 'file_upload_error', message: DEFAULTS.file_upload.message, developerMessage: message, httpStatus: normalizeStatus(DEFAULTS.file_upload.httpStatus, status), retryable: false, loggingLevel: 'warn', requestId: context?.requestId, source };
  }

  if (/network|fetch failed|econn|socket hang up|connection reset|offline/i.test(lower) || status === 502) {
    return { category: 'network', code: 'network_error', message: DEFAULTS.network.message, developerMessage: message, httpStatus: normalizeStatus(DEFAULTS.network.httpStatus, status), retryable: true, loggingLevel: 'warn', requestId: context?.requestId, source };
  }

  if (/config|environment variable|not configured/.test(lower)) {
    return { category: 'configuration', code: 'configuration_error', message: DEFAULTS.configuration.message, developerMessage: message, httpStatus: normalizeStatus(DEFAULTS.configuration.httpStatus, status), retryable: false, loggingLevel: 'error', requestId: context?.requestId, source };
  }

  return { category: 'internal_server', code: 'internal_error', message: DEFAULTS.internal_server.message, developerMessage: message, httpStatus: normalizeStatus(DEFAULTS.internal_server.httpStatus, status), retryable: true, loggingLevel: 'error', requestId: context?.requestId, source };
}

export function createApiErrorResponse(message: string, options: { status?: number; code?: string; requestId?: string; retryable?: boolean; details?: unknown } = {}) : ApiErrorPayload {
  const status = options.status ?? 500;
  const code = options.code ?? 'internal_error';
  const retryable = options.retryable ?? (status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504);

  return {
    success: false,
    error: {
      code,
      message,
      requestId: options.requestId,
      retryable,
      details: options.details,
    },
  };
}

export function classifyChatErrorState(error: unknown): ChatErrorState {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const normalized = message.toLowerCase();

  if (!message || /failed to fetch|network|offline|connection lost|load failed/i.test(normalized)) {
    return {
      kind: 'offline',
      title: 'You’re offline',
      message: 'Your message is safe and will be ready to send again when your connection returns.',
      retryable: true,
    };
  }

  if (/abort|cancelled|canceled|operation was aborted/i.test(normalized)) {
    return {
      kind: 'cancelled',
      title: 'Request cancelled',
      message: 'The chat request was cancelled, and your conversation stays intact.',
      retryable: true,
    };
  }

  if (/rate limit|too many requests|quota|429/i.test(normalized)) {
    return {
      kind: 'rate_limit',
      title: 'You’re sending requests a bit too quickly',
      message: 'Please wait a moment and try again. Your recent messages are still here.',
      retryable: true,
    };
  }

  if (/timeout|timed out|deadline/i.test(normalized)) {
    return {
      kind: 'timeout',
      title: 'The request took too long',
      message: 'That reply didn’t finish in time. Please try again and we’ll keep your conversation intact.',
      retryable: true,
    };
  }

  if (/temporarily unavailable|service unavailable|provider unavailable|provider error|unavailable/i.test(normalized)) {
    return {
      kind: 'provider_unavailable',
      title: 'The assistant is temporarily unavailable',
      message: 'We couldn’t complete that reply right now. Please try again in a moment.',
      retryable: true,
    };
  }

  return {
    kind: 'unknown',
    title: 'Something went wrong',
    message: 'We couldn’t finish that reply right now. Please try again shortly.',
    retryable: true,
  };
}
