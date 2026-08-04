-- AlterTable
ALTER TABLE "User" ADD COLUMN     "authProvider" TEXT NOT NULL DEFAULT 'email',
ADD COLUMN     "lastOAuthReauthAt" TIMESTAMP(3),
ALTER COLUMN "password" SET DEFAULT '';
