import { prisma } from '../lib/prisma';
import { reserveUsage } from '../services/billingService';

async function main() {
  const user = await prisma.user.create({
    data: {
      email: `debug-reserve-${Date.now()}@example.com`,
      password: 'pw',
      name: 'debug reserve',
    },
  });

  try {
    const result = await reserveUsage({
      userId: user.id,
      feature: 'chat',
      amount: 1,
      provider: 'Gemini',
      requestId: `debug-reserve-${Date.now()}`,
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error);
    throw error;
  } finally {
    await prisma.usageLog.deleteMany({ where: { userId: user.id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
    await prisma.$disconnect();
  }
}

main().catch(() => process.exit(1));