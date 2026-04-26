-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "digestSentAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ThrottleOverride" (
    "id" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "bypass" BOOLEAN NOT NULL DEFAULT false,
    "multiplier" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "reason" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ThrottleOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ThrottleOverride_target_key" ON "ThrottleOverride"("target");

-- CreateIndex
CREATE INDEX "ThrottleOverride_expiresAt_idx" ON "ThrottleOverride"("expiresAt");

-- CreateIndex
CREATE INDEX "Notification_digestSentAt_readAt_idx" ON "Notification"("digestSentAt", "readAt");

-- AddForeignKey
ALTER TABLE "ThrottleOverride" ADD CONSTRAINT "ThrottleOverride_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
