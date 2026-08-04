import assert from 'node:assert/strict';
import { normalizeEmail, validatePasswordStrength, getSensitiveActionRequirements } from '../app/lib/auth';

function run() {
  const normalized = normalizeEmail('  User@Example.COM  ');
  assert.equal(normalized, 'user@example.com');

  const strong = validatePasswordStrength('Str0ng!Pass123');
  assert.equal(strong.isValid, true);

  const weak = validatePasswordStrength('short');
  assert.equal(weak.isValid, false);

  const googleUser = {
    authProvider: 'google',
    password: '$2a$12$abcdefghijklmnopqrstuv',
    lastOAuthReauthAt: new Date(Date.now() - 5 * 60 * 1000),
  };
  const req = getSensitiveActionRequirements(googleUser as { authProvider: string; password: string; lastOAuthReauthAt: Date | null }, new Date());
  assert.equal(req.requiresPasswordConfirmation, true);
  assert.equal(req.requiresRecentOAuthReauth, false);

  const staleGoogleUser = {
    authProvider: 'google',
    password: '$2a$12$abcdefghijklmnopqrstuv',
    lastOAuthReauthAt: new Date(Date.now() - 20 * 60 * 1000),
  };
  const staleReq = getSensitiveActionRequirements(staleGoogleUser as { authProvider: string; password: string; lastOAuthReauthAt: Date | null }, new Date());
  assert.equal(staleReq.requiresRecentOAuthReauth, true);

  const emailUser = {
    authProvider: 'email',
    password: '$2a$12$abcdefghijklmnopqrstuv',
  };
  const reqEmail = getSensitiveActionRequirements(emailUser as { authProvider: string; password: string }, new Date());
  assert.equal(reqEmail.requiresPasswordConfirmation, true);
  assert.equal(reqEmail.requiresRecentOAuthReauth, false);

  console.log('auth security tests passed');
}

run();
