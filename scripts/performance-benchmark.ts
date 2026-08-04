import { performance } from 'node:perf_hooks';
import fs from 'node:fs';
import { PrismaClient } from '@prisma/client';

const databaseUrl = fs.readFileSync('.env', 'utf8')
  .split(/\r?\n/)
  .find((line) => line.startsWith('DATABASE_URL='))
  ?.slice('DATABASE_URL='.length)
  .trim()
  .replace(/^"|"$/g, '');
if (databaseUrl) process.env.DATABASE_URL = databaseUrl;

const runs = Number(process.env.PERF_RUNS ?? 20);

async function benchmark(label: string, query: () => Promise<unknown>) {
  let result: unknown;
  const startedAt = performance.now();
  for (let run = 0; run < runs; run += 1) {
    result = await query();
  }
  const totalMs = performance.now() - startedAt;
  const avgMs = totalMs / runs;
  const bytes = Buffer.byteLength(JSON.stringify(result ?? null));
  return { label, runs, totalMs, avgMs, bytes };
}

async function main() {
  const prisma = new PrismaClient();
  const user = await prisma.user.findFirst({
    where: { conversations: { some: { messages: { some: {} } } } },
    select: { id: true },
  });
  if (!user) {
    console.log('No users found; benchmark skipped.');
    await prisma.$disconnect();
    return;
  }

  const current = await benchmark('chats-current-full-message', () => prisma.conversation.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: 'desc' },
    include: {
      messages: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  }));

  const optimized = await benchmark('chats-narrow-message-select', () => prisma.conversation.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: 'desc' },
    include: {
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { role: true, text: true, createdAt: true },
      },
    },
  }));

  const latencyImprovement = ((current.avgMs - optimized.avgMs) / current.avgMs) * 100;
  const payloadReduction = ((current.bytes - optimized.bytes) / current.bytes) * 100;
  console.table([current, optimized]);
  console.log(JSON.stringify({
    latencyImprovementPercent: Number(latencyImprovement.toFixed(2)),
    payloadReductionPercent: Number(payloadReduction.toFixed(2)),
  }));

  await prisma.$disconnect();
}

void main();
