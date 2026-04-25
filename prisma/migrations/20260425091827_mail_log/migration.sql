-- CreateEnum
CREATE TYPE "MailType" AS ENUM ('VERIFICATION', 'PASSWORD_RESET', 'OTHER');

-- CreateEnum
CREATE TYPE "MailStatus" AS ENUM ('SENT', 'FAILED');

-- CreateTable
CREATE TABLE "MailLog" (
    "id" TEXT NOT NULL,
    "type" "MailType" NOT NULL,
    "status" "MailStatus" NOT NULL,
    "recipient" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "fromEmail" TEXT,
    "providerId" TEXT,
    "errorMessage" TEXT,
    "sentryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MailLog_status_createdAt_idx" ON "MailLog"("status", "createdAt");

-- CreateIndex
CREATE INDEX "MailLog_recipient_createdAt_idx" ON "MailLog"("recipient", "createdAt");
