import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/app/lib/auth';
import logger from '@/lib/logger';
import {
  createNotification,
  getNotifications,
  clearNotifications,
} from '@/app/services/notificationService';

function parsePositiveInt(value: string | null, fallback: number) {
  const parsed = Number(value ?? '');
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export async function GET(req: Request) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(req.url);
    const page = parsePositiveInt(url.searchParams.get('page'), 1);
    const pageSize = parsePositiveInt(url.searchParams.get('pageSize'), 20);

    const result = await getNotifications(user.id, page, pageSize);
    return NextResponse.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    logger.error('Failed to fetch notifications', { error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await req.json();
    const title = typeof payload?.title === 'string' ? payload.title.trim() : '';
    const body = typeof payload?.body === 'string' ? payload.body.trim() : '';
    const type = typeof payload?.type === 'string' ? payload.type.trim() : '';
    const category = typeof payload?.category === 'string' ? payload.category.trim().toUpperCase() : undefined;
    const externalId = typeof payload?.externalId === 'string' ? payload.externalId.trim() : undefined;
    const icon = payload?.icon === undefined ? undefined : String(payload.icon).trim();
    const actionUrl = payload?.actionUrl === undefined ? undefined : String(payload.actionUrl).trim();
    const metadata = payload?.metadata;

    if (!title || !body || !type) {
      return NextResponse.json({ error: 'title, body, and type are required' }, { status: 400 });
    }

    const notification = await createNotification(user.id, {
      title,
      body,
      type,
      category,
      externalId,
      icon: icon || null,
      actionUrl: actionUrl || null,
      metadata: metadata ?? null,
    });

    return NextResponse.json({ notification }, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    logger.error('Failed to create notification', { error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const deletedCount = await clearNotifications(user.id);
    return NextResponse.json({ success: true, deletedCount });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    logger.error('Failed to clear notifications', { error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
