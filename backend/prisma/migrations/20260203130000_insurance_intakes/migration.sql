-- CreateTable
CREATE TABLE "insurance_intakes" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "caseId" TEXT NOT NULL,
    "schemaId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "source" TEXT,
    "createdByUserId" TEXT,

    CONSTRAINT "insurance_intakes_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "insurance_cases" ADD COLUMN "latestIntakeId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "insurance_intakes_caseId_version_key" ON "insurance_intakes"("caseId", "version");

-- CreateIndex
CREATE INDEX "insurance_intakes_caseId_createdAt_idx" ON "insurance_intakes"("caseId", "createdAt");

-- CreateIndex
CREATE INDEX "insurance_intakes_schemaId_idx" ON "insurance_intakes"("schemaId");

-- CreateIndex
CREATE INDEX "insurance_cases_latestIntakeId_idx" ON "insurance_cases"("latestIntakeId");

-- AddForeignKey
ALTER TABLE "insurance_intakes" ADD CONSTRAINT "insurance_intakes_caseId_fkey"
  FOREIGN KEY ("caseId") REFERENCES "insurance_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurance_intakes" ADD CONSTRAINT "insurance_intakes_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurance_cases" ADD CONSTRAINT "insurance_cases_latestIntakeId_fkey"
  FOREIGN KEY ("latestIntakeId") REFERENCES "insurance_intakes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

