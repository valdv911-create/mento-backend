import { prisma } from '../lib/prisma';
import { WalletServiceError, downgradePlan, upgradePlan } from '../services/walletService';

async function main() {
  const email = `billing-upgrade-test-${Date.now()}@example.com`;
  const user = await prisma.user.create({
    data: {
      email,
      password: 'test-password',
      name: 'Billing Upgrade Test',
    },
  });

  try {
    let threw = false;
    try {
      await upgradePlan(user.id, 'INVALID_PLAN');
    } catch (error) {
      threw = error instanceof WalletServiceError && error.code === 'INVALID_PLAN';
    }

    if (!threw) {
      throw new Error('Expected invalid plan names to be rejected');
    }

    const upgraded = await upgradePlan(user.id, 'PRO');
    if (upgraded.planName !== 'PRO') {
      throw new Error(`Expected PRO plan after upgrade, got ${upgraded.planName}`);
    }

    const downgraded = await downgradePlan(user.id, 'FREE');
    if (downgraded.planName !== 'FREE') {
      throw new Error(`Expected FREE plan after downgrade, got ${downgraded.planName}`);
    }

    console.log('Billing upgrade/downgrade test passed');
  } finally {
    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
