import assert from 'node:assert/strict';
import { getWallet, getLiveTutorWallet, ensureWallet, ensureLiveTutorWallet, addMinutes, consumeMinutes, upgradePlan, downgradePlan } from '../services/walletService';

async function main() {
  assert.equal(typeof getWallet, 'function');
  assert.equal(typeof getLiveTutorWallet, 'function');
  assert.equal(typeof ensureWallet, 'function');
  assert.equal(typeof ensureLiveTutorWallet, 'function');
  assert.equal(typeof addMinutes, 'function');
  assert.equal(typeof consumeMinutes, 'function');
  assert.equal(typeof upgradePlan, 'function');
  assert.equal(typeof downgradePlan, 'function');

  console.log('Wallet service API smoke test passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
