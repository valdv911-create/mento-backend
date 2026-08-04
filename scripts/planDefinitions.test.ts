import assert from 'node:assert/strict';
import { AI_CONFIG } from '../app/lib/aiConfig';
import { refreshCache, getFreePlan, getProPlan } from '../services/planService';

async function main() {
  const plans = await refreshCache();
  const planNames = plans.map((plan) => plan.name).sort();
  assert.deepEqual(planNames, ['FREE', 'PRO']);

  const freePlan = await getFreePlan();
  const proPlan = await getProPlan();

  assert.equal(freePlan.features.chatModel, AI_CONFIG.CHAT_MODEL);
  assert.equal(freePlan.features.imageModel, AI_CONFIG.IMAGE_MODEL);
  assert.equal(freePlan.features.chatWindowMinutes, 180);
  assert.equal(freePlan.features.chatWindowLimit, 100);
  assert.equal(freePlan.features.imageDailyLimit, 2);
  assert.equal(freePlan.features.liveTutorEnabled, false);

  assert.equal(proPlan.features.chatModel, AI_CONFIG.CHAT_MODEL);
  assert.equal(proPlan.features.imageModel, AI_CONFIG.IMAGE_MODEL);
  assert.equal(proPlan.features.chatWindowMinutes, 180);
  assert.equal(proPlan.features.chatWindowLimit, 200);
  assert.equal(proPlan.features.proChatDailyLimit, 100);
  assert.equal(proPlan.features.imageDailyLimit, 10);
  assert.equal(proPlan.features.liveTutorEnabled, true);

  console.log('Plan definition regression test passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
