import { NextResponse } from 'next/server';
import { getUserFromRequest } from '../../../lib/auth';
import { getWalletUsage } from '../../../../services/economicsService';

export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const usage = await getWalletUsage(user.id);
  return NextResponse.json({ usage });
}
