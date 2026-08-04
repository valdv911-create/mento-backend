import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyAppError, classifyChatErrorState, createApiErrorResponse } from './errorHandling';

test('classifies retryable provider failures with a friendly code', () => {
  const result = classifyAppError(new Error('Gemini timed out'), { status: 504, source: 'gemini' });

  assert.equal(result.category, 'timeout');
  assert.equal(result.code, 'timeout');
  assert.equal(result.retryable, true);
  assert.equal(result.loggingLevel, 'warn');
  assert.match(result.message, /temporarily unavailable/i);
});

test('builds a consistent API error payload with correlation metadata', () => {
  const response = createApiErrorResponse('Validation failed', { requestId: 'req-123', status: 400, code: 'validation_error' });

  assert.equal(response.success, false);
  assert.equal(response.error.code, 'validation_error');
  assert.equal(response.error.requestId, 'req-123');
  assert.equal(response.error.retryable, false);
  assert.equal(response.error.message, 'Validation failed');
});

test('maps chat failures to friendly states for offline, timeout, rate-limit, unavailable, and cancel', () => {
  assert.equal(classifyChatErrorState(new Error('Failed to fetch')).kind, 'offline');
  assert.equal(classifyChatErrorState(new Error('timed out waiting for response')).kind, 'timeout');
  assert.equal(classifyChatErrorState(new Error('rate limit exceeded')).kind, 'rate_limit');
  assert.equal(classifyChatErrorState(new Error('provider unavailable')).kind, 'provider_unavailable');
  assert.equal(classifyChatErrorState(new DOMException('The operation was aborted', 'AbortError')).kind, 'cancelled');
});
