-- CreateTable
CREATE TABLE "qa_bug_reports" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT,
    "reporterUserId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "severity" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "expected" TEXT NOT NULL,
    "actual" TEXT NOT NULL,
    "reproSteps" TEXT,
    "personaTestId" TEXT,
    "environment" TEXT,
    "debugBundle" JSONB,
    "tags" TEXT[],
    "screenshots" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qa_bug_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "qa_bug_reports_conversationId_idx" ON "qa_bug_reports"("conversationId");

-- CreateIndex
CREATE INDEX "qa_bug_reports_status_idx" ON "qa_bug_reports"("status");

-- CreateIndex
CREATE INDEX "qa_bug_reports_createdAt_idx" ON "qa_bug_reports"("createdAt");

-- AddForeignKey
ALTER TABLE "qa_bug_reports" ADD CONSTRAINT "qa_bug_reports_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

