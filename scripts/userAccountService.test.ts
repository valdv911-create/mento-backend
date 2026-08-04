import assert from 'node:assert/strict';
import test from 'node:test';
import { prisma } from '../lib/prisma';
import { createEmailAccount, createGoogleOAuthAccount, DuplicateEmailError } from '../services/userAccountService';

test('createEmailAccount provisions wallets, subscription and default preferences', async () => {
  const email = `email-service-${Date.now()}@example.com`;

  try {
    const result = await createEmailAccount({
      email,
      password: 'TestPassword123!',
      name: 'Email Service User',
    });

    assert.equal(result.user.email, email);
    assert.ok(result.user.password.length > 0);

    const wallet = await prisma.userWallet.findUnique({ where: { userId: result.user.id } });
    const tutorWallet = await prisma.liveTutorWallet.findUnique({ where: { userId: result.user.id } });
    const prefs = await prisma.notificationPreference.findUnique({ where: { userId: result.user.id } });
    const settings = await prisma.userSetting.findUnique({ where: { userId: result.user.id } });

    assert.ok(wallet);
    assert.ok(tutorWallet);
    assert.ok(prefs);
    assert.ok(settings);
    assert.equal(wallet?.subscriptionStatus, 'active');
    assert.equal(prefs?.emailEnabled, true);
    assert.equal(settings?.theme, 'system');
  } finally {
    await prisma.user.deleteMany({ where: { email } });
  }
});

test('createGoogleOAuthAccount creates a user without a usable password', async () => {
  const email = `google-service-${Date.now()}@example.com`;

  try {
    const result = await createGoogleOAuthAccount({
      email,
      name: 'Google Service User',
    });

    assert.equal(result.user.email, email);
    assert.equal(result.user.authProvider, 'google');
    assert.equal(result.user.password, '');
  } finally {
    await prisma.user.deleteMany({ where: { email } });
  }
});

test('createEmailAccount rejects duplicate emails', async () => {
  const email = `duplicate-service-${Date.now()}@example.com`;

  await createEmailAccount({ email, password: 'TestPassword123!', name: 'Duplicate User' });

  try {
    await createEmailAccount({ email, password: 'AnotherPassword123!', name: 'Duplicate User 2' });
    assert.fail('Expected duplicate email to be rejected');
  } catch (error) {
    assert.ok(error instanceof DuplicateEmailError);
  } finally {
    await prisma.user.deleteMany({ where: { email } });
  }
});
