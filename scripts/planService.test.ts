import assert from 'node:assert/strict';
import { getPlan, getPlanById, getFreePlan, getProPlan, refreshCache, PlanServiceError } from '../services/planService';

async function main() {
  assert.equal(typeof getPlan, 'function');
  assert.equal(typeof getPlanById, 'function');
  assert.equal(typeof getFreePlan, 'function');
  assert.equal(typeof getProPlan, 'function');
  assert.equal(typeof refreshCache, 'function');
  assert.equal(typeof PlanServiceError, 'function');

  console.log('Plan service API smoke test passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
