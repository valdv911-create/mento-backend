/**
 * SECURE ERROR HANDLER
 * Returns safe, structured error responses that never expose:
 * - API keys or tokens
 * - Internal system details
 * - Database information
 * - File paths or system architecture
 * - Sensitive configuration
 *
 * Implements fail-secure design:
 * - Default to safe, generic error messages
 * - Log detailed errors internally only
 * - Return structured errors for client-side handling
 * - Support error tracking without information leakage
 */

export type SafeErrorCode = 
  | 'invalid_input'
  | 'injection_detected'
  | 'abuse_detected'
  | 'rate_limited'
  | 'unauthorized'
  | 'server_error'
  | 'unavailable'
  | 'validation_failed';

export interface SecureErrorResponse {
  error: string; // Safe message for user
  code: SafeErrorCode; // Machine-readable code
  requestId: string; // For tracking
  status: number; // HTTP status
  retryAfter?: number; // For rate limits
  userMessage?: string; // Additional safe info
}

export interface ErrorContext {
  requestId: string;
  userId?: string;
  ip?: string;
  timestamp: number;
  originalError?: Error;
  details?: Record<string, unknown>;
}

/**
 * Safe error messages (never reveal internals)
 */
const SAFE_ERROR_MESSAGES = {
  invalid_input: 'Your input could not be processed. Please check and try again.',
  injection_detected: 'Your request contains patterns we cannot process. Please rephrase your message.',
  abuse_detected: 'Your request appears to violate our usage policies. Please try a different approach.',
  rate_limited: 'You are making requests too quickly. Please wait a moment and try again.',
  unauthorized: 'You are not authorized to perform this action.',
  server_error: 'We encountered an issue processing your request. Please try again shortly.',
  unavailable: 'The service is temporarily unavailable. Please try again in a few moments.',
  validation_failed: 'Your request could not be validated. Please check the format and try again.',
};

/**
 * Map error types to safe responses
 */
const ERROR_TYPE_MAPPING: Record<string, { code: SafeErrorCode; status: number }> = {
  'invalid_input': { code: 'invalid_input', status: 400 },
  'injection_detected': { code: 'injection_detected', status: 400 },
  'abuse_detected': { code: 'abuse_detected', status: 400 },
  'rate_limited': { code: 'rate_limited', status: 429 },
  'unauthorized': { code: 'unauthorized', status: 401 },
  'server_error': { code: 'server_error', status: 500 },
  'unavailable': { code: 'unavailable', status: 503 },
  'validation_failed': { code: 'validation_failed', status: 400 },
};

/**
 * Create safe error response
 */
export function createSecureError(
  errorType: SafeErrorCode,
  context: ErrorContext,
  options?: {
    retryAfter?: number;
    userMessage?: string;
  }
): SecureErrorResponse {
  const mapping = ERROR_TYPE_MAPPING[errorType] || ERROR_TYPE_MAPPING.server_error;
  const safeMessage = SAFE_ERROR_MESSAGES[errorType] || SAFE_ERROR_MESSAGES.server_error;

  return {
    error: safeMessage,
    code: errorType,
    requestId: context.requestId,
    status: mapping.status,
    retryAfter: options?.retryAfter,
    userMessage: options?.userMessage,
  };
}

/**
 * Validate and sanitize error for external consumption
 */
function getErrorMessage(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    return typeof message === 'string' ? message : undefined;
  }
  return undefined;
}

export function sanitizeErrorForClient(error: unknown, requestId: string): SecureErrorResponse {
  // Never expose actual error message
  const message = getErrorMessage(error);
  if (message?.includes('API') ||
      message?.includes('key') ||
      message?.includes('token') ||
      message?.includes('secret')) {
    return createSecureError('server_error', { requestId, timestamp: Date.now() });
  }

  // Default to server error
  return createSecureError('server_error', { requestId, timestamp: Date.now() });
}

/**
 * Format error response with safe structure
 */
export function formatSecureErrorResponse(error: SecureErrorResponse): Record<string, unknown> {
  return {
    error: error.error,
    code: error.code,
    requestId: error.requestId,
    ...(error.retryAfter && { retryAfter: error.retryAfter }),
    ...(error.userMessage && { details: error.userMessage }),
  };
}

/**
 * Check if error message is safe to expose
 */
export function isSafeToExpose(message: string): boolean {
  const unsafePatterns = [
    /api[_-]?key/i,
    /token/i,
    /secret/i,
    /password/i,
    /database/i,
    /query/i,
    /sql/i,
    /connection[_-]?string/i,
    /host/i,
    /port/i,
    /user/i,
    /pass/i,
    /bearer/i,
    /authorization/i,
    /endpoint/i,
    /path/i,
  ];

  return !unsafePatterns.some((pattern) => pattern.test(message));
}

/**
 * Redact sensitive information from error details
 */
export function redactSensitiveData(data: unknown): unknown {
  if (typeof data === 'string') {
    return data
      .replace(/(api[_-]?key|token|secret|password|authorization)([^\n\r]*)/gi, '[REDACTED]')
      .replace(/\b[\w.-]+@[\w.-]+\.\w+\b/g, '[EMAIL REDACTED]')
      .replace(/\b\d{3}[.-]?\d{3}[.-]?\d{4}\b/g, '[PHONE REDACTED]')
      .replace(/\b\d{3}[.-]?\d{2}[.-]?\d{4}\b/g, '[SSN REDACTED]');
  }

  if (Array.isArray(data)) {
    return data.map((item) => redactSensitiveData(item));
  }

  if (typeof data === 'object' && data !== null) {
    const redacted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      const lowerKey = key.toLowerCase();
      if (
        lowerKey.includes('key') ||
        lowerKey.includes('token') ||
        lowerKey.includes('secret') ||
        lowerKey.includes('password') ||
        lowerKey.includes('authorization') ||
        lowerKey.includes('url') ||
        lowerKey.includes('connection') ||
        lowerKey.includes('email') ||
        lowerKey.includes('phone')
      ) {
        redacted[key] = '[REDACTED]';
      } else {
        redacted[key] = redactSensitiveData(value);
      }
    }
    return redacted;
  }

  return data;
}

/**
 * Error tracking code generator (safe for client)
 */
export function generateErrorCode(requestId: string, errorType: SafeErrorCode): string {
  // Generate a safe tracking code that doesn't expose details
  return `ERR-${errorType.toUpperCase()}-${requestId.slice(-8)}`;
}

/**
 * Create standardized error response object
 */
export function createStandardErrorResponse(
  code: SafeErrorCode,
  context: ErrorContext,
  options?: {
    retryAfter?: number;
    userMessage?: string;
  }
): Record<string, unknown> {
  const secure = createSecureError(code, context, options);
  return formatSecureErrorResponse(secure);
}

/**
 * HTTP error response builder
 */
export function buildHttpErrorResponse(
  statusCode: number,
  error: SafeErrorCode,
  requestId: string,
  options?: {
    retryAfter?: number;
    userMessage?: string;
  }
): { status: number; body: Record<string, unknown>; headers: Record<string, string> } {
  return {
    status: statusCode,
    body: createStandardErrorResponse(error, { requestId, timestamp: Date.now() }, options),
    headers: {
      ...(options?.retryAfter && { 'Retry-After': String(options.retryAfter) }),
      'Content-Type': 'application/json',
    },
  };
}

/**
 * Log full error details internally (never expose to client)
 */
export function logFullErrorDetails(context: ErrorContext, logger: { error: (message: string, details: unknown) => void }): void {
  if (!context.originalError) return;

  logger.error('Full error details (internal only)', {
    requestId: context.requestId,
    userId: context.userId,
    ip: context.ip,
    timestamp: new Date(context.timestamp).toISOString(),
    errorType: context.originalError.constructor.name,
    errorMessage: context.originalError.message,
    stack: context.originalError.stack,
    details: redactSensitiveData(context.details),
  });
}

/**
 * Determine HTTP status code from error type
 */
export function getHttpStatus(errorCode: SafeErrorCode): number {
  const mapping = ERROR_TYPE_MAPPING[errorCode];
  return mapping?.status || 500;
}

/**
 * Create error response with rate limit headers
 */
export function createRateLimitError(
  requestId: string,
  retryAfterSeconds: number
): Record<string, unknown> {
  return {
    error: 'Rate limit exceeded. Please wait before making another request.',
    code: 'rate_limited',
    requestId,
    retryAfter: retryAfterSeconds,
    message: `Try again in ${retryAfterSeconds} seconds`,
  };
}
