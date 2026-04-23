-- CreateEnum
CREATE TYPE "LogLevel" AS ENUM ('INFO', 'WARN', 'ERROR');

-- CreateTable
CREATE TABLE "RequestLog" (
    "id" TEXT NOT NULL,
    "level" "LogLevel" NOT NULL DEFAULT 'INFO',
    "source" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "route" TEXT,
    "statusCode" INTEGER,
    "durationMs" INTEGER,
    "userId" TEXT,
    "userEmail" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "requestBody" JSONB,
    "requestQuery" JSONB,
    "responseBody" JSONB,
    "errorMessage" TEXT,
    "errorStack" TEXT,
    "breadcrumbs" JSONB,
    "sentryEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequestLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RequestLog_createdAt_idx" ON "RequestLog"("createdAt");

-- CreateIndex
CREATE INDEX "RequestLog_userId_createdAt_idx" ON "RequestLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "RequestLog_level_createdAt_idx" ON "RequestLog"("level", "createdAt");

-- CreateIndex
CREATE INDEX "RequestLog_statusCode_idx" ON "RequestLog"("statusCode");
