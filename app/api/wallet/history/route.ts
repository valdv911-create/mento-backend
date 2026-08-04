import { NextResponse } from 'next/server';
import { getUserFromRequest } from '../../../lib/auth';
import { getWalletHistory } from '../../../../services/economicsService';

export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const history = await getWalletHistory(user.id);
  return NextResponse.json({ history });
}
