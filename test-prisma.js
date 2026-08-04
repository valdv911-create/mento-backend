import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();

  console.log("✅ Prisma client created");

  const users = await prisma.user.count();

  console.log("Users:", users);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
});