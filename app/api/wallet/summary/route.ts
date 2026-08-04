import { NextResponse } from 'next/server';
import { getUserFromRequest } from '../../../lib/auth';
import logger from '../../../../lib/logger';
import { getWalletSummary } from '../../../../services/walletService';
import { getUsage } from '../../../../services/usageService';
import { canGenerateImage } from '../../../../services/billingService';

export async function GET(req: Request) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const userId = user.id;
    const wallet = await getWalletSummary(userId);
    const imageUsage = await getUsage(userId, 'image', 'day');
    const billingDecision = await canGenerateImage(userId);

    return NextResponse.json({
      currentPlan: wallet.planName,
      todaysImageUsage: imageUsage.used,
      fairUseEnabled: wallet.fairUseEnabled,
      liveTutorBalance: wallet.liveTutorMinutesBalance,
      subscriptionStatus: wallet.liveTutorEnabled ? 'enabled' : 'disabled',
      upgradeAvailable: billingDecision.upgradeAvailable,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    logger.error('Wallet summary failed', { error: err });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
