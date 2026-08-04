import { prisma } from '../lib/prisma';
import { ensureUserBillingSetup } from '../services/economicsService';

async function main() {
  const users = await prisma.user.findMany({
    where: {
      OR: [{ wallet: null }, { liveTutorWallet: null }],
    },
    select: { id: true },
  });

  if (!users.length) {
    console.log('No users require billing backfill.');
    return;
  }

  for (const user of users) {
    await ensureUserBillingSetup(user.id);
  }

  console.log(`Backfill complete for ${users.length} user(s).`);
}

main().catch((error) => {
  console.error('Billing backfill failed:', error);
  process.exit(1);
});
