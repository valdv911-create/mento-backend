import assert from 'node:assert/strict';
import { logUsage, getUsage, remainingUsage, resetTime, isLimitReached } from '../services/usageService';

async function main() {
  assert.equal(typeof logUsage, 'function');
  assert.equal(typeof getUsage, 'function');
  assert.equal(typeof remainingUsage, 'function');
  assert.equal(typeof resetTime, 'function');
  assert.equal(typeof isLimitReached, 'function');

  console.log('Usage service API smoke test passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
