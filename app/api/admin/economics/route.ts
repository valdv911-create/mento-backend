import { NextResponse } from 'next/server';
import { getUserFromRequest, isAdminUser } from '../../../lib/auth';
import { getEconomicsStats } from '../../../../services/economicsService';

export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isAdminUser(user)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const stats = await getEconomicsStats();
  return NextResponse.json({ stats });
}
