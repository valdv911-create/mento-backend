import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCorsHeaders, isAllowedOrigin } from '../../lib/securityHeaders';

test('allows configured origins and echoes them back', () => {
  const previous = process.env.ALLOWED_ORIGINS;
  process.env.ALLOWED_ORIGINS = 'https://app.example.com,https://admin.example.com';

  try {
    assert.equal(isAllowedOrigin('https://app.example.com'), true);
    assert.equal(isAllowedOrigin('https://evil.example.com'), false);

    const headers = buildCorsHeaders('https://app.example.com');
    assert.equal(headers['Access-Control-Allow-Origin'], 'https://app.example.com');
    assert.equal(headers['Vary'], 'Origin');
  } finally {
    if (previous === undefined) {
      delete process.env.ALLOWED_ORIGINS;
    } else {
      process.env.ALLOWED_ORIGINS = previous;
    }
  }
});

test('omits CORS allow-origin for untrusted origins', () => {
  const headers = buildCorsHeaders('https://evil.example.com');
  assert.equal(headers['Access-Control-Allow-Origin'], undefined);
});
