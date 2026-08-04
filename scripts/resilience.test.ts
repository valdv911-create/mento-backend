import assert from 'node:assert/strict';
import { sanitizeForLogging, getClientErrorMessage, retryWithBackoff } from '../lib/resilience';

async function run() {
  const sanitized = sanitizeForLogging({ apiKey: 'secret', password: 'abc', safe: 'ok' });
  assert.equal(sanitized.apiKey, '[REDACTED]');
  assert.equal(sanitized.password, '[REDACTED]');
  assert.equal(sanitized.safe, 'ok');

  const clientMessage = getClientErrorMessage('Provider returned apiKey=abc', 'Service temporarily unavailable');
  assert.equal(clientMessage, 'Provider returned apiKey=abc');

  let attempts = 0;
  const result = await retryWithBackoff(async () => {
    attempts += 1;
    if (attempts < 3) {
      throw new Error('transient');
    }
    return 'ok';
  }, { retries: 3, baseDelayMs: 1, maxDelayMs: 1, timeoutMs: 100 });

  assert.equal(result, 'ok');
  assert.equal(attempts, 3);

  console.log('resilience tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
