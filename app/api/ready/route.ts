import { NextResponse } from 'next/server';
import fs from 'fs';
import os from 'os';
import { prisma } from '../../../lib/prisma';
import { runGeminiStartupHealthCheck } from '../../../services/geminiService';
import { getActiveSimliSession } from '../../../services/simliService';
import { getCircuitBreaker } from '../../../lib/resilience';

const geminiBreaker = getCircuitBreaker('gemini', 5, 30000);
const simliBreaker = getCircuitBreaker('simli', 3, 30000);
const stripeBreaker = getCircuitBreaker('payment:stripe', 3, 60000);
const mpesaBreaker = getCircuitBreaker('payment:mpesa', 3, 60000);

function getDiskHealth() {
  try {
    const stats = fs.statfsSync(process.cwd());
    const availableBytes = stats.bavail * stats.bsize;
    const totalBytes = stats.blocks * stats.bsize;
    const usedPercent = Math.round((1 - availableBytes / totalBytes) * 100);
    return {
      status: usedPercent < 90 ? 'ok' : 'warn',
      totalBytes,
      availableBytes,
      usedPercent,
    };
  } catch {
    return { status: 'warn', totalBytes: 0, availableBytes: 0, usedPercent: 0 };
  }
}

function getMemoryHealth() {
  const total = os.totalmem();
  const free = os.freemem();
  const usedPercent = Math.round((1 - free / total) * 100);
  return {
    status: usedPercent < 90 ? 'ok' : 'warn',
    totalBytes: total,
    availableBytes: free,
    usedPercent,
  };
}

export async function GET() {
  const startedAt = Date.now();
  const checks: Record<string, unknown> = {};

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = { status: 'ok' };
  } catch {
    checks.database = { status: 'fail' };
  }

  try {
    const geminiHealth = await runGeminiStartupHealthCheck();
    checks.gemini = geminiHealth;
  } catch {
    checks.gemini = { status: 'fail', success: false };
  }

  checks.simli = {
    status: simliBreaker.isOpen() ? 'fail' : 'ok',
    circuitState: simliBreaker.getState(),
    activeSessions: getActiveSimliSession('') ? 1 : 0,
  };

  checks.redis = { status: 'not_configured' };
  checks.paymentProviders = {
    stripe: { status: stripeBreaker.isOpen() ? 'fail' : 'ok', circuitState: stripeBreaker.getState() },
    mpesa: { status: mpesaBreaker.isOpen() ? 'fail' : 'ok', circuitState: mpesaBreaker.getState() },
  };
  checks.disk = getDiskHealth();
  checks.memory = getMemoryHealth();

  const allHealthy = [checks.database, checks.gemini, checks.simli, checks.paymentProviders].every((value) => {
    if (!value || typeof value !== 'object') return false;
    if (Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    const status = typeof record.status === 'string' ? record.status : undefined;
    return status === 'ok' || status === 'not_configured';
  });

  return NextResponse.json({
    status: allHealthy ? 'ready' : 'degraded',
    timestamp: new Date().toISOString(),
    latencyMs: Date.now() - startedAt,
    checks,
  }, { status: allHealthy ? 200 : 503 });
}
