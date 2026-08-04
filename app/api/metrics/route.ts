import { NextResponse } from 'next/server';
import { metricsText } from '../../../lib/metrics';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const body = await metricsText();
    return new NextResponse(body, { status: 200, headers: { 'Content-Type': 'text/plain; version=0.0.4' } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to gather metrics';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
