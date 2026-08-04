import { prisma } from '../lib/prisma';

async function main() {
  const user = await prisma.user.create({
    data: {
      email: `debug-tx-${Date.now()}@example.com`,
      password: 'pw',
      name: 'debug',
    },
  });

  try {
    const result = await prisma.$transaction(async (tx) => {
      const count = await tx.user.findMany({ where: { id: user.id } });
      const log = await tx.usageLog.create({
        data: {
          userId: user.id,
          feature: 'chat',
          provider: 'Gemini',
          requestId: `debug-${Date.now()}`,
          modelUsed: 'gemini',
          planName: 'FREE',
          success: true,
          tokensInput: 0,
          tokensOutput: 0,
          secondsUsed: 0,
          providerCostUSD: 0,
          userChargeUSD: 0,
          profitUSD: 0,
        },
      });
      return { count: count.length, logId: log.id };
    });
    console.log(result);
  } finally {
    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
    await prisma.usageLog.deleteMany({ where: { userId: user.id } }).catch(() => undefined);
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});