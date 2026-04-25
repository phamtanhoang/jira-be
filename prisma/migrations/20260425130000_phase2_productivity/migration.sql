-- CreateEnum
CREATE TYPE "IssueLinkType" AS ENUM ('BLOCKS', 'RELATES', 'DUPLICATES', 'CLONED_FROM');

-- AlterTable
ALTER TABLE "Issue"
ADD COLUMN "originalEstimate" INTEGER,
ADD COLUMN "remainingEstimate" INTEGER;

-- CreateTable
CREATE TABLE "SavedFilter" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedFilter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SavedFilter_projectId_shared_idx" ON "SavedFilter"("projectId", "shared");

-- CreateIndex
CREATE INDEX "SavedFilter_ownerId_idx" ON "SavedFilter"("ownerId");

-- AddForeignKey
ALTER TABLE "SavedFilter" ADD CONSTRAINT "SavedFilter_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedFilter" ADD CONSTRAINT "SavedFilter_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "IssueLink" (
    "id" TEXT NOT NULL,
    "sourceIssueId" TEXT NOT NULL,
    "targetIssueId" TEXT NOT NULL,
    "type" "IssueLinkType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssueLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IssueLink_sourceIssueId_targetIssueId_type_key" ON "IssueLink"("sourceIssueId", "targetIssueId", "type");

-- CreateIndex
CREATE INDEX "IssueLink_sourceIssueId_idx" ON "IssueLink"("sourceIssueId");

-- CreateIndex
CREATE INDEX "IssueLink_targetIssueId_idx" ON "IssueLink"("targetIssueId");

-- AddForeignKey
ALTER TABLE "IssueLink" ADD CONSTRAINT "IssueLink_sourceIssueId_fkey" FOREIGN KEY ("sourceIssueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueLink" ADD CONSTRAINT "IssueLink_targetIssueId_fkey" FOREIGN KEY ("targetIssueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "IssueTemplate" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "IssueType" NOT NULL DEFAULT 'TASK',
    "descriptionHtml" TEXT,
    "defaultPriority" "IssuePriority",
    "defaultLabels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IssueTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IssueTemplate_projectId_name_key" ON "IssueTemplate"("projectId", "name");

-- CreateIndex
CREATE INDEX "IssueTemplate_projectId_idx" ON "IssueTemplate"("projectId");

-- AddForeignKey
ALTER TABLE "IssueTemplate" ADD CONSTRAINT "IssueTemplate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
