import test from 'node:test';
import assert from 'node:assert/strict';
import { getCircuitBreaker } from './resilience';

test('circuit breaker transitions through open and half-open states', () => {
  const breaker = getCircuitBreaker('test-breaker-half-open', 1, 10);

  breaker.recordFailure();
  assert.equal(breaker.getState(), 'open');
  assert.equal(breaker.isOpen(), true);

  breaker.recordSuccess();
  assert.equal(breaker.getState(), 'closed');
});
