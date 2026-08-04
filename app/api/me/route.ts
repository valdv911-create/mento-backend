import { NextResponse } from 'next/server';
import { getUserFromRequest, buildUserSummary } from '../../lib/auth';

export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.json({ user: buildUserSummary(user) });
}
