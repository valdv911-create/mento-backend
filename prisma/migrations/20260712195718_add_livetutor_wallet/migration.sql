/*
  Warnings:

  - You are about to drop the column `liveTutorMinutes` on the `Plan` table. All the data in the column will be lost.
  - You are about to drop the column `monthlyImages` on the `Plan` table. All the data in the column will be lost.
  - You are about to drop the column `monthlyMessages` on the `Plan` table. All the data in the column will be lost.
  - You are about to drop the column `learningCredits` on the `UserWallet` table. All the data in the column will be lost.
  - You are about to drop the column `liveTutorCredits` on the `UserWallet` table. All the data in the column will be lost.
  - You are about to drop the column `renewalDate` on the `UserWallet` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Plan" DROP COLUMN "liveTutorMinutes",
DROP COLUMN "monthlyImages",
DROP COLUMN "monthlyMessages",
ADD COLUMN     "imageLimit" INTEGER,
ADD COLUMN     "messageLimit" INTEGER,
ALTER COLUMN "price" DROP DEFAULT;

-- AlterTable
ALTER TABLE "UserWallet" DROP COLUMN "learningCredits",
DROP COLUMN "liveTutorCredits",
DROP COLUMN "renewalDate";

-- DropEnum
DROP TYPE "BillingPlan";

-- CreateTable
CREATE TABLE "LiveTutorWallet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "minutesBalance" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveTutorWallet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LiveTutorWallet_userId_key" ON "LiveTutorWallet"("userId");

-- AddForeignKey
ALTER TABLE "LiveTutorWallet" ADD CONSTRAINT "LiveTutorWallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
