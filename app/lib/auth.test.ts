import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAuthCookieOptions, getClientIp, getLoginPolicyState, isAdminUser, isTokenExpired } from './auth';
import { sanitizeForLogging } from '../../lib/sanitize';

test('buildAuthCookieOptions applies secure defaults in production', () => {
  const options = buildAuthCookieOptions({ isProduction: true, maxAgeSeconds: 3600, path: '/api/auth' });
  assert.ok(options);

  assert.equal(options?.httpOnly, true);
  assert.equal(options?.sameSite, 'lax');
  assert.equal(options?.secure, true);
  assert.equal(options?.path, '/api/auth');
  assert.equal(options?.maxAge, 3600);
});

test('isTokenExpired detects expired tokens', () => {
  const expired = isTokenExpired(Math.floor(Date.now() / 1000) - 10);
  const active = isTokenExpired(Math.floor(Date.now() / 1000) + 600);

  assert.equal(expired, true);
  assert.equal(active, false);
});

test('getLoginPolicyState blocks locked accounts and exposes remaining lockout time', () => {
  const state = getLoginPolicyState({
    failedLoginAttempts: 5,
    lockedAt: new Date(Date.now() + 60_000),
  });

  assert.equal(state.allowed, false);
  assert.equal(state.reason, 'account_locked');
  assert.ok(state.lockoutRemainingSeconds >= 55);
});

test('getLoginPolicyState allows unlocked accounts with low failure counts', () => {
  const state = getLoginPolicyState({
    failedLoginAttempts: 2,
    lockedAt: null,
  });

  assert.equal(state.allowed, true);
  assert.equal(state.reason, 'allowed');
  assert.equal(state.lockoutRemainingSeconds, 0);
});

test('getClientIp extracts the left-most forwarded address', () => {
  const request = new Request('https://example.com/api/login', {
    headers: {
      'x-forwarded-for': '198.51.100.10, 10.0.0.1',
    },
  });

  assert.equal(getClientIp(request), '198.51.100.10');
});

test('isAdminUser honors explicit admin markers and configured admin emails', () => {
  const previous = process.env.ADMIN_EMAILS;
  process.env.ADMIN_EMAILS = 'admin@example.com';

  try {
    assert.equal(isAdminUser({ email: 'admin@example.com' }), true);
    assert.equal(isAdminUser({ email: 'user@example.com' }), false);
    assert.equal(isAdminUser({ authProvider: 'admin' }), true);
    assert.equal(isAdminUser({ role: 'admin' }), true);
  } finally {
    if (previous === undefined) {
      delete process.env.ADMIN_EMAILS;
    } else {
      process.env.ADMIN_EMAILS = previous;
    }
  }
});

test('sanitizeForLogging redacts secrets embedded in strings and objects', () => {
  const payload = {
    authorization: 'Bearer super-secret-token',
    refreshToken: 'refresh-token-value',
    nested: {
      password: 'hunter2',
      headers: {
        cookie: 'session=abc123',
      },
    },
  };

  const sanitized = sanitizeForLogging(payload);
  assert.deepEqual(sanitized, {
    authorization: '[REDACTED]',
    refreshToken: '[REDACTED]',
    nested: {
      password: '[REDACTED]',
      headers: {
        cookie: '[REDACTED]',
      },
    },
  });
});
