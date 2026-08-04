import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/app/lib/auth';
import logger from '@/lib/logger';
import { markAllAsRead } from '@/app/services/notificationService';

export async function POST(req: Request) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const updatedCount = await markAllAsRead(user.id);
    return NextResponse.json({ success: true, updatedCount });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    logger.error('Failed to mark all notifications as read', { error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  return POST(req);
}
