'use client';

import { useEffect, useState } from 'react';

interface NotificationItem {
  id: string;
  title: string;
  body: string;
  type: string;
  category: string;
  icon?: string | null;
  actionUrl?: string | null;
  isRead: boolean;
  createdAt: string;
}

interface NotificationsResponse {
  notifications?: NotificationItem[];
}

interface UnreadCountResponse {
  unreadCount?: number;
}

function getStoredToken(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const fromLocalStorage = window.localStorage.getItem('mento_token')?.trim();
  if (fromLocalStorage) {
    return fromLocalStorage;
  }

  const match = document.cookie.match(/(?:^|; )mento_access_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('Content-Type', 'application/json');
  const token = getStoredToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(path, {
    ...init,
    headers,
  });

  if (!response.ok) {
    let payload: { error?: string } | null = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    throw new Error(payload?.error ?? 'Request failed');
  }

  return response.json() as Promise<T>;
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'just now';
  }

  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMinutes = Math.max(1, Math.round(diffMs / 60000));

  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }

  const diffDays = Math.round(diffHours / 24);
  return `${diffDays}d ago`;
}

export default function NotificationCenter() {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    const token = getStoredToken();
    if (!token) {
      setNotifications([]);
      setUnreadCount(0);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const [notificationsPayload, unreadPayload] = await Promise.all([
        apiRequest<NotificationsResponse>('/api/notifications'),
        apiRequest<UnreadCountResponse>('/api/notifications/unread-count'),
      ]);

      setNotifications(notificationsPayload.notifications ?? []);
      setUnreadCount(unreadPayload.unreadCount ?? 0);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to load notifications');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      void refresh();
    }, 0);
    const intervalId = window.setInterval(() => {
      void refresh();
    }, 60000);
    return () => {
      window.clearTimeout(timerId);
      window.clearInterval(intervalId);
    };
  }, []);

  const handleMarkAsRead = async (notificationId: string) => {
    const previous = notifications;
    setNotifications((current) => current.map((item) => item.id === notificationId ? { ...item, isRead: true } : item));
    setUnreadCount((current) => Math.max(0, current - 1));

    try {
      await apiRequest<{ success: boolean }>('/api/notifications/read', {
        method: 'POST',
        body: JSON.stringify({ notificationId }),
      });
    } catch (requestError) {
      setNotifications(previous);
      setUnreadCount((current) => current + 1);
      setError(requestError instanceof Error ? requestError.message : 'Unable to mark notification as read');
    }
  };

  const handleMarkAllAsRead = async () => {
    const previous = notifications;
    setNotifications((current) => current.map((item) => ({ ...item, isRead: true })));
    setUnreadCount(0);

    try {
      await apiRequest<{ success: boolean; updatedCount?: number }>('/api/notifications/read-all', {
        method: 'POST',
      });
    } catch (requestError) {
      setNotifications(previous);
      setUnreadCount(previous.filter((item) => !item.isRead).length);
      setError(requestError instanceof Error ? requestError.message : 'Unable to mark all notifications as read');
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className="relative rounded-full border border-zinc-800 bg-zinc-900/80 p-2 text-zinc-300 transition hover:border-zinc-700 hover:text-white"
        aria-label="Open notifications"
      >
        🔔
        {unreadCount > 0 ? (
          <span className="absolute -right-1 -top-1 inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1.5 text-[10px] font-semibold text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        ) : (
          <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border border-zinc-950 bg-amber-400" />
        )}
      </button>

      {isOpen ? (
        <div className="absolute right-0 top-12 z-50 w-88 rounded-2xl border border-zinc-800 bg-zinc-950/95 p-3 shadow-2xl shadow-black/40 backdrop-blur">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-white">Notifications</p>
              <p className="text-xs text-zinc-500">
                {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
              </p>
            </div>
            {unreadCount > 0 ? (
              <button
                type="button"
                onClick={handleMarkAllAsRead}
                className="text-xs font-medium text-cyan-400 transition hover:text-cyan-300"
              >
                Mark all read
              </button>
            ) : null}
          </div>

          {isLoading ? (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 px-3 py-4 text-sm text-zinc-400">
              Loading notifications…
            </div>
          ) : error ? (
            <div className="rounded-xl border border-rose-900/40 bg-rose-950/20 px-3 py-4 text-sm text-rose-300">
              {error}
            </div>
          ) : notifications.length === 0 ? (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 px-3 py-4 text-sm text-zinc-400">
              No notifications yet.
            </div>
          ) : (
            <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
              {notifications.map((notification) => (
                <div
                  key={notification.id}
                  className={`rounded-xl border px-3 py-3 transition ${notification.isRead ? 'border-zinc-800 bg-zinc-900/60' : 'border-cyan-900/50 bg-cyan-950/20'}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-white">{notification.title}</span>
                        {!notification.isRead ? <span className="h-2.5 w-2.5 rounded-full bg-cyan-400" /> : null}
                      </div>
                      <p className="mt-1 text-sm text-zinc-300">{notification.body}</p>
                      <div className="mt-2 flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-zinc-500">
                        <span>{notification.type}</span>
                        <span>•</span>
                        <span>{formatTimestamp(notification.createdAt)}</span>
                      </div>
                    </div>
                    {!notification.isRead ? (
                      <button
                        type="button"
                        onClick={() => void handleMarkAsRead(notification.id)}
                        className="shrink-0 text-xs font-medium text-cyan-400 transition hover:text-cyan-300"
                      >
                        Read
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
