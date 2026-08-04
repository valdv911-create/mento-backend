import assert from 'node:assert/strict';
import { prisma } from '../lib/prisma';
import { reserveUsage } from '../services/billingService';

async function main() {
  const email = `billing-concurrency-${Date.now()}@example.com`;
  const user = await prisma.user.create({
    data: {
      email,
      password: 'test-password',
      name: 'Billing Concurrency Test',
    },
  });

  const freePlan = await prisma.plan.findUnique({ where: { name: 'FREE' } });
  if (!freePlan) {
    throw new Error('FREE plan not found');
  }

  const originalMessageLimit = freePlan.messageLimit;

  try {
    await prisma.plan.update({
      where: { id: freePlan.id },
      data: { messageLimit: 1 },
    });

    const requests = Array.from({ length: 2 }, (_, index) => reserveUsage({
      userId: user.id,
      feature: 'chat',
      amount: 1,
      provider: 'Gemini',
      requestId: `concurrency-${Date.now()}-${index}`,
    }));

    const settled = await Promise.allSettled(requests);
    const errors = settled
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => result.reason);
    if (errors.length > 0) {
      console.error('Concurrency test encountered request errors', errors);
      throw errors[0];
    }

    const results = settled
      .filter((result): result is PromiseFulfilledResult<typeof requests[number] extends Promise<infer T> ? T : never> => result.status === 'fulfilled')
      .map((result) => result.value);

    const allowedCount = results.filter((result) => result.allowed).length;
    const deniedCount = results.filter((result) => !result.allowed).length;

    assert.equal(allowedCount, 1, 'Only one concurrent reservation should be allowed when the plan limit is 1');
    assert.equal(deniedCount, 1, 'One concurrent reservation should be denied when the plan limit is reached');

    const successLedgerCount = await prisma.usageLog.count({
      where: {
        userId: user.id,
        feature: 'chat',
        success: true,
      },
    });
    const totalLedgerCount = await prisma.usageLog.count({
      where: {
        userId: user.id,
        feature: 'chat',
      },
    });

    assert.equal(successLedgerCount, 1, 'Exactly one successful ledger entry should be created for the reservation');
    assert.equal(totalLedgerCount, 2, 'Exactly one accepted and one denied ledger entry should be created for concurrent reservation attempts');

    console.log('Billing concurrency regression test passed');
  } finally {
    await prisma.plan.update({
      where: { id: freePlan.id },
      data: { messageLimit: originalMessageLimit },
    }).catch(() => undefined);

    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
