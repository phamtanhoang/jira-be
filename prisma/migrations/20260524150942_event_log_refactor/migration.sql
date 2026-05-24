-- AlterTable
ALTER TABLE "RequestLog" ADD COLUMN     "event" TEXT,
ADD COLUMN     "metadata" JSONB;

-- CreateIndex
CREATE INDEX "RequestLog_event_createdAt_idx" ON "RequestLog"("event", "createdAt");
