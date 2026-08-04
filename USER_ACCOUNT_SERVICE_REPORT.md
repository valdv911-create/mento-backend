# UserAccountService implementation report

## Summary
- Added a centralized account creation service at services/userAccountService.ts.
- Refactored the email signup route to use the service for all creation logic.
- Refactored the Google OAuth route to use the service for both new-account creation and existing-user reauth updates.
- The service provisions the required onboarding state in one transaction: user record, UserWallet, LiveTutorWallet, notification preferences, and user settings.
- Google OAuth users are created with an empty password so they cannot sign in with a password.
- Duplicate emails are rejected with a dedicated error type.

## Files changed
- services/userAccountService.ts
- app/api/signup/route.ts
- app/api/oauth/google/route.ts
- prisma/schema.prisma
- scripts/userAccountService.test.ts

## Verification
- Prisma schema validation: passed via `npx prisma validate`.
- TypeScript compile check: passed via `npx tsc --noEmit --pretty false`.
- Runtime test execution is currently blocked by the existing local Prisma bootstrap issue in lib/prisma.ts under the workspace’s current Node/ESM setup (`top-level await` in CJS compilation path).

## Migration note
- Prisma migration generation was attempted, but the current database environment rejects the change because the existing User table already has rows and the schema change would require a non-default `updatedAt` backfill.
- The implementation is ready for the normal deployment path, but the database change should be applied in a controlled migration with a backfill strategy for existing rows.

## Security audit highlights
- Passwords are hashed with bcrypt before persistence for email signups.
- Google OAuth accounts are created without a usable password to prevent password-based sign-in.
- Duplicate emails are rejected before a create can complete.
- Account creation is transactional, so wallet and preference provisioning is rolled back if user creation fails.
- The service is now the single path for account creation, reducing drift between routes.
