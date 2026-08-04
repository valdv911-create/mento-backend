import Redis from 'ioredis';
import { rateLimitAllowed, rateLimitDenied, rateLimitHits } from './metrics';
import { getRedisUrl } from './env';

const REDIS_URL = getRedisUrl();
let redis: Redis | null = null;

if (REDIS_URL) {
  try {
    redis = new Redis(REDIS_URL);
    // Define a Lua-backed atomic sliding window command for accuracy under concurrency
    try {
      redis.defineCommand('slidingWindowAtomic', {
        numberOfKeys: 1,
        lua: `
          -- ARGV: nowTs, minTs, windowMs, member, limit
          local key = KEYS[1]
          local nowTs = tonumber(ARGV[1])
          local minTs = tonumber(ARGV[2])
          local windowMs = tonumber(ARGV[3])
          local member = ARGV[4]
          local limit = tonumber(ARGV[5])
          redis.call('ZADD', key, nowTs, member)
          redis.call('ZREMRANGEBYSCORE', key, 0, minTs)
          local cnt = redis.call('ZCARD', key)
          redis.call('PEXPIRE', key, windowMs + 1000)
          local earliest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
          local earliestTs = -1
          if earliest and #earliest >= 2 then
            earliestTs = earliest[2]
          end
          return {tostring(cnt), tostring(earliestTs)}
        `
      });
    } catch (e) {
      // defineCommand may throw on some environments; ignore and fall back to multi
      console.warn('Could not define slidingWindowAtomic command:', e);
    }
  } catch (err) {
    console.warn('Failed to connect to Redis for rate limiter:', err);
    redis = null;
  }
}

// Fallback in-memory stores (per-process)
const inMemoryWindows: Map<string, number[]> = new Map();
const inMemoryCooldown: Map<string, number> = new Map();

function pruneWindow(arr: number[], windowMs: number) {
  const cutoff = Date.now() - windowMs;
  while (arr.length && arr[0] < cutoff) arr.shift();
}

export async function ensureCooldown(userId: string, cooldownMs: number): Promise<{ ok: boolean; retryAfterSec?: number }> {
  if (redis) {
    const key = `rl:cooldown:${userId}`;
    // SET key NX PX cooldownMs
    const res = await redis.set(key, '1', 'PX', cooldownMs, 'NX');
    if (res === 'OK') return { ok: true };
    const ttl = await redis.pttl(key);
    rateLimitDenied.inc({ type: 'cooldown' });
    rateLimitHits.inc({ type: 'cooldown' });
    return { ok: false, retryAfterSec: Math.ceil(Math.max(ttl, 0) / 1000) };
  }

  // In-memory fallback
  const last = inMemoryCooldown.get(userId) ?? 0;
  const since = Date.now() - last;
  if (since < cooldownMs) {
    return { ok: false, retryAfterSec: Math.ceil((cooldownMs - since) / 1000) };
  }
  inMemoryCooldown.set(userId, Date.now());
  rateLimitAllowed.inc({ type: 'cooldown' });
  return { ok: true };
}

export async function ensureSlidingWindow(id: string, limit: number, windowSeconds: number, keyPrefix = 'rl:window'): Promise<{ ok: boolean; retryAfterSec?: number }> {
  const windowMs = windowSeconds * 1000;
  const redisKey = `${keyPrefix}:${id}`;

  if (redis) {
    const nowTs = Date.now();
    const min = nowTs - windowMs;
    const member = `${nowTs}-${Math.random().toString(36).slice(2, 10)}`;
    // If the atomic command exists, call it; otherwise fallback to multi txn
    const slidingWindowAtomic = (redis as Redis & { slidingWindowAtomic?: (key: string, nowTs: string, minTs: string, windowMs: string, member: string, limit: string) => Promise<[string, string]> }).slidingWindowAtomic;
    if (typeof slidingWindowAtomic === 'function') {
      try {
        const res = await slidingWindowAtomic(redisKey, nowTs.toString(), min.toString(), windowMs.toString(), member, limit.toString());
        // res -> [count, earliestTs]
        const card = Number(res[0] ?? 0);
        const earliestTs = Number(res[1] ?? -1);
        if (card > limit) {
          rateLimitDenied.inc({ type: 'sliding' });
          rateLimitHits.inc({ type: 'sliding' });
          const retryAfter = Math.ceil(Math.max(earliestTs + windowMs - nowTs, 0) / 1000);
          return { ok: false, retryAfterSec: retryAfter };
        }
        rateLimitAllowed.inc({ type: 'sliding' });
        return { ok: true };
      } catch (e) {
        console.warn('slidingWindowAtomic command failed, falling back to txn:', e);
      }
    }

    // fallback transaction
    const tx = redis.multi();
    tx.zadd(redisKey, nowTs, member);
    tx.zremrangebyscore(redisKey, 0, min);
    tx.zcard(redisKey);
    tx.pexpire(redisKey, windowMs + 1000);
    const res = await tx.exec();
    if (!res) return { ok: true };
    const card = res[2] && res[2][1] ? Number(res[2][1]) : 0;
    if (card > limit) {
      const earliest = await redis.zrange(redisKey, 0, 0, 'WITHSCORES');
      const earliestTs = earliest && earliest.length >= 2 ? Number(earliest[1]) : nowTs;
      const retryAfter = Math.ceil(Math.max(earliestTs + windowMs - nowTs, 0) / 1000);
      return { ok: false, retryAfterSec: retryAfter };
    }
    return { ok: true };
  }

  // In-memory fallback
  const arr = inMemoryWindows.get(id) ?? [];
  pruneWindow(arr, windowMs);
  if (arr.length >= limit) {
    rateLimitDenied.inc({ type: 'sliding' });
    rateLimitHits.inc({ type: 'sliding' });
    const retryAfterSec = Math.ceil((arr[0] + windowMs - Date.now()) / 1000);
    return { ok: false, retryAfterSec };
  }
  arr.push(Date.now());
  inMemoryWindows.set(id, arr);
  rateLimitAllowed.inc({ type: 'sliding' });
  return { ok: true };
}

export async function shutdown() {
  if (redis) {
    await redis.quit();
    redis = null;
  }
}

// Daily quota enforcement: messages per day per user
const inMemoryDaily: Map<string, { day: string; count: number }> = new Map();

function todayKeySuffix() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${(d.getUTCMonth() + 1).toString().padStart(2, '0')}-${d.getUTCDate().toString().padStart(2, '0')}`;
}

function secondsUntilTomorrowUTC() {
  const now = new Date();
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return Math.ceil((tomorrow.getTime() - now.getTime()) / 1000);
}

export async function ensureDailyQuota(userId: string, limitPerDay: number): Promise<{ ok: boolean; remaining?: number }> {
  const day = todayKeySuffix();
  const key = `rl:daily:${userId}:${day}`;
  if (redis) {
    const val = await redis.incr(key);
    if (val === 1) {
      await redis.expire(key, secondsUntilTomorrowUTC());
    }
    if (limitPerDay >= 0 && val > limitPerDay) {
      rateLimitDenied.inc({ type: 'daily' });
      rateLimitHits.inc({ type: 'daily' });
      return { ok: false, remaining: 0 };
    }
    rateLimitAllowed.inc({ type: 'daily' });
    return { ok: true, remaining: limitPerDay - val };
  }

  // In-memory fallback
  const cur = inMemoryDaily.get(userId);
  if (!cur || cur.day !== day) {
    inMemoryDaily.set(userId, { day, count: 1 });
    if (limitPerDay >= 0) {
      rateLimitAllowed.inc({ type: 'daily' });
      return { ok: true, remaining: limitPerDay - 1 };
    }
    rateLimitAllowed.inc({ type: 'daily' });
    return { ok: true, remaining: Infinity };
  }
  cur.count += 1;
  if (limitPerDay >= 0 && cur.count > limitPerDay) {
    rateLimitDenied.inc({ type: 'daily' });
    rateLimitHits.inc({ type: 'daily' });
    return { ok: false, remaining: 0 };
  }
  rateLimitAllowed.inc({ type: 'daily' });
  return { ok: true, remaining: limitPerDay - cur.count };
}

const rateLimiterApi = {
  ensureCooldown,
  ensureSlidingWindow,
  shutdown,
};

export default rateLimiterApi;
