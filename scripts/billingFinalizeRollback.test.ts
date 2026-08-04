import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function loadDotenv() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  const envContent = fs.readFileSync(envPath, 'utf-8');
  for (const line of envContent.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([^=]+)=([\s\S]*)$/);
    if (!match) continue;
    const key = match[1].trim();
    let value = match[2].trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadDotenv();

console.log('DOTENV LOADED DATABASE_URL:', process.env.DATABASE_URL);
console.log('DATABASE_URL starts with "', process.env.DATABASE_URL?.slice(0, 12), '"');
console.log('startsWith postgres://', process.env.DATABASE_URL?.startsWith('postgresql://'));
console.log('startsWith prisma://', process.env.DATABASE_URL?.startsWith('prisma://'));

async function main() {
  const { prisma } = await import('../lib/prisma');
  const { finalizeUsage, reserveUsage, rollbackUsage } = await import('../services/billingService');
  const email = `billing-finalize-${Date.now()}@example.com`;
  const user = await prisma.user.create({
    data: {
      email,
      password: 'billing-finalize',
      name: 'Billing Finalize Rollback Test',
    },
  });

  const freePlan = await prisma.plan.findUnique({ where: { name: 'FREE' } });
  if (!freePlan) throw new Error('FREE plan not found');

  try {
    const requestId = `pending-${Date.now()}`;
    const reserved = await reserveUsage({
      userId: user.id,
      feature: 'chat',
      amount: 1,
      provider: 'Gemini',
      requestId,
      pending: true,
    });

    assert.equal(reserved.allowed, true, 'Pending reservation should allow the call to proceed');

    const finalized = await finalizeUsage({
      userId: user.id,
      feature: 'chat',
      amount: 1,
      provider: 'Gemini',
      requestId,
    });

    assert.equal(finalized.allowed, true, 'Finalize should preserve the reservation success status');

    const ledger = await prisma.usageLog.findUnique({ where: { provider_requestId: { provider: 'Gemini', requestId } } });
    assert.ok(ledger, 'Ledger entry should exist after pending reservation');
    assert.equal(ledger?.success, true, 'Finalize should flip the pending ledger entry to success=true');

    const rolledBack = await rollbackUsage({
      userId: user.id,
      feature: 'chat',
      amount: 1,
      provider: 'Gemini',
      requestId,
    });

    assert.equal(rolledBack.allowed, true, 'Rollback should report the existing finalized reservation without breaking the flow');

    const secondRequestId = `rollback-${Date.now()}`;
    const rollbackReservation = await reserveUsage({
      userId: user.id,
      feature: 'chat',
      amount: 1,
      provider: 'Gemini',
      requestId: secondRequestId,
      pending: true,
    });

    assert.equal(rollbackReservation.allowed, true, 'Pending rollback reservation should be accepted');

    const rollbackDecision = await rollbackUsage({
      userId: user.id,
      feature: 'chat',
      amount: 1,
      provider: 'Gemini',
      requestId: secondRequestId,
    });

    assert.equal(rollbackDecision.allowed, false, 'Rollback should mark the reservation as failed/rolled back');

    const rollbackLedger = await prisma.usageLog.findUnique({ where: { provider_requestId: { provider: 'Gemini', requestId: secondRequestId } } });
    assert.ok(rollbackLedger, 'Rollback ledger entry should exist');
    assert.equal(rollbackLedger?.success, false, 'Rollback should set the pending ledger entry to success=false');

    console.log('Billing finalize/rollback regression test passed');
  } finally {
    await prisma.usageLog.deleteMany({ where: { userId: user.id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
