-- Add missing Plan columns for the current Prisma schema
ALTER TABLE "Plan"
ADD COLUMN "chatModel" TEXT NOT NULL DEFAULT 'gemini-2.5-flash-lite',
ADD COLUMN "fairUseEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "imageDailyLimit" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN "liveTutorEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 0;

-- Add missing UsageLog fields from the current Prisma schema
ALTER TABLE "UsageLog"
ADD COLUMN "metadata" JSONB,
ADD COLUMN "modelUsed" TEXT,
ADD COLUMN "planName" TEXT,
ADD COLUMN "success" BOOLEAN NOT NULL DEFAULT true;

-- Create the missing unique constraint index for UsageLog
CREATE UNIQUE INDEX "UsageLog_provider_requestId_key" ON "UsageLog"("provider", "requestId");
