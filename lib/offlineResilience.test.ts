import test from 'node:test';
import assert from 'node:assert/strict';
import { createOfflineResilienceManager } from './offlineResilience';

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.has(key) ? this.values.get(key)! : null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

test('queues work offline and retries once the connection returns', async () => {
  const storage = new MemoryStorage();
  const manager = createOfflineResilienceManager({
    storage,
    storageKey: 'test-offline-queue',
    isOnline: false,
    baseDelayMs: 5,
    maxDelayMs: 20,
  });

  let attempts = 0;
  const task = await manager.enqueue({
    type: 'chat',
    payload: { message: 'hello' },
    maxAttempts: 2,
  }, async () => {
    attempts += 1;
    if (attempts === 1) {
      throw new Error('offline');
    }
    return { ok: true };
  });

  assert.equal(task.status, 'queued');
  assert.equal(attempts, 0);

  manager.setOnline(true);

  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(attempts, 2);
  const persisted = storage.getItem('test-offline-queue');
  assert.ok(persisted);
});
