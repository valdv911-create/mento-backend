import { NextResponse } from 'next/server';
import { prisma } from '../../../lib/prisma';

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({
      status: 'ok',
      message: 'Mento API is running',
      timestamp: new Date().toISOString(),
      checks: { database: 'ok' },
    });
  } catch (error) {
    return NextResponse.json({
      status: 'degraded',
      message: 'Mento API is running but database checks failed',
      timestamp: new Date().toISOString(),
      checks: { database: 'unavailable' },
    }, { status: 503 });
  }
}
