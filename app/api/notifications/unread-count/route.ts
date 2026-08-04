import { NextResponse } from 'next/server';
import { getUserFromRequest } from '../../../lib/auth';
import logger from '../../../../lib/logger';
import { getUnreadCount } from '../../../services/notificationService';

export async function GET(req: Request) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const unreadCount = await getUnreadCount(user.id);
    return NextResponse.json({ unreadCount });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    logger.error('Failed to fetch unread notification count', { error: message });
    return NextResponse.json({ unreadCount: 0, error: message }, { status: 200 });
  }
}
