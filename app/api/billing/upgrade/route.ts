import { NextResponse } from 'next/server';
import { getUserFromRequest } from '../../../lib/auth';
import { upgradePlan } from '../../../../services/walletService';
import { createNotification } from '../../../services/notificationService';

export async function POST(req: Request) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const planName = typeof body?.planName === 'string' ? body.planName : null;

    if (!planName) {
      return NextResponse.json({ error: 'planName is required' }, { status: 400 });
    }

    const wallet = await upgradePlan(user.id, planName);
    // notify user about plan change
    try {
      await createNotification(user.id, {
        title: 'Plan updated',
        body: `Your subscription was changed to ${wallet.planName}.`,
        type: 'billing',
      });
    } catch (e) {
      // ignore
    }
    return NextResponse.json({ success: true, wallet });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    const code = error instanceof Error && 'code' in error ? (error as { code?: string }).code : undefined;
    const status = code === 'INVALID_PLAN' ? 400 : code === 'PLAN_NOT_FOUND' ? 404 : 500;
    return NextResponse.json({ error: message, code }, { status });
  }
}
