/*
  Warnings:

  - You are about to drop the column `plan` on the `UserWallet` table. All the data in the column will be lost.
  - Added the required column `planId` to the `UserWallet` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "UserWallet" DROP COLUMN "plan",
ADD COLUMN     "planId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "monthlyMessages" INTEGER,
    "monthlyImages" INTEGER,
    "liveTutorMinutes" INTEGER,
    "features" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Plan_name_key" ON "Plan"("name");

-- AddForeignKey
ALTER TABLE "UserWallet" ADD CONSTRAINT "UserWallet_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
