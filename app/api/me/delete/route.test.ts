import test from 'node:test';
import assert from 'node:assert/strict';
import { POST } from './route';

test('account deletion route rejects unauthenticated requests', async () => {
  const request = new Request('https://example.com/api/me/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirmationText: 'delete my account' }),
  });

  const response = await POST(request);
  assert.equal(response.status, 401);

  const body = await response.json();
  assert.deepEqual(body, { error: 'Unauthorized' });
});
