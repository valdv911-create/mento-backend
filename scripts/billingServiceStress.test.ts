import assert from 'node:assert/strict';
import { prisma } from '../lib/prisma';
import { reserveUsage } from '../services/billingService';

async function main() {
  const email = `billing-stress-${Date.now()}@example.com`;
  const user = await prisma.user.create({
    data: {
      email,
      password: 'stress-test',
      name: 'Billing Stress Test',
    },
  });

  const freePlan = await prisma.plan.findUnique({ where: { name: 'FREE' } });
  if (!freePlan) throw new Error('FREE plan not found');

  const originalLimit = freePlan.messageLimit;
  const testLimit = 10;

  try {
    await prisma.plan.update({ where: { id: freePlan.id }, data: { messageLimit: testLimit } });

    const requests = Array.from({ length: 100 }, (_, index) =>
      reserveUsage({
        userId: user.id,
        feature: 'chat',
        amount: 1,
        provider: 'Gemini',
        requestId: `stress-${Date.now()}-${index}`,
      }),
    );

    const settled = await Promise.allSettled(requests);
    const errors = settled.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (errors.length > 0) {
      console.error('Stress test encountered errors', errors.map((err) => err.reason));
      throw errors[0].reason;
    }

    const results = settled.filter((result): result is PromiseFulfilledResult<typeof requests[number] extends Promise<infer T> ? T : never> => result.status === 'fulfilled').map((result) => result.value);

    const allowedCount = results.filter((result) => result.allowed).length;
    const deniedCount = results.filter((result) => !result.allowed).length;
    console.log({ allowedCount, deniedCount });

    assert.equal(allowedCount, testLimit, `Expected exactly ${testLimit} allowed requests`);
    assert.equal(deniedCount, 100 - testLimit, `Expected ${100 - testLimit} denied requests`);

    const successLedgerCount = await prisma.usageLog.count({ where: { userId: user.id, feature: 'chat', success: true } });
    const totalLedgerCount = await prisma.usageLog.count({ where: { userId: user.id, feature: 'chat' } });

    assert.equal(successLedgerCount, testLimit, 'Success ledger count must equal test limit');
    assert.equal(totalLedgerCount, 100, 'Total ledger count must equal number of simulated requests');

    console.log('Billing stress test passed');
  } finally {
    await prisma.usageLog.deleteMany({ where: { userId: user.id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
    await prisma.plan.update({ where: { id: freePlan.id }, data: { messageLimit: originalLimit } }).catch(() => undefined);
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
