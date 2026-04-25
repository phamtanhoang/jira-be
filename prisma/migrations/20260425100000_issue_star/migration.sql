-- CreateTable
CREATE TABLE "IssueStar" (
    "issueId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssueStar_pkey" PRIMARY KEY ("issueId", "userId")
);

-- CreateIndex
CREATE INDEX "IssueStar_userId_createdAt_idx" ON "IssueStar"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "IssueStar" ADD CONSTRAINT "IssueStar_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueStar" ADD CONSTRAINT "IssueStar_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
