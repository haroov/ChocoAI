/*
  Warnings:

  - The `status` column on the `api_calls` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "public"."api_calls" ADD COLUMN     "attempt" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "corrId" TEXT,
ADD COLUMN     "endpoint" TEXT,
ADD COLUMN     "method" TEXT,
ADD COLUMN     "model" TEXT,
ADD COLUMN     "runId" TEXT,
ADD COLUMN     "service" TEXT,
ADD COLUMN     "statusText" TEXT,
ADD COLUMN     "stepRunId" TEXT,
ADD COLUMN     "tokensIn" INTEGER,
ADD COLUMN     "tokensOut" INTEGER,
DROP COLUMN "status",
ADD COLUMN     "status" INTEGER;

-- AlterTable
ALTER TABLE "public"."events" ADD COLUMN     "channel" TEXT;

-- AlterTable
ALTER TABLE "public"."messages" ADD COLUMN     "channel" TEXT;

-- AlterTable
ALTER TABLE "public"."project_config" ADD COLUMN     "features" JSONB NOT NULL DEFAULT '{"newRunner": false, "mockModeRibbon": false}';

-- CreateTable
CREATE TABLE "public"."settings" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "currentVersionId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."settings_versions" (
    "id" TEXT NOT NULL,
    "settingsId" TEXT NOT NULL DEFAULT 'global',
    "version" INTEGER NOT NULL,
    "models" JSONB NOT NULL DEFAULT '{"primary": "gpt-4o-mini", "fallback": "gpt-4o", "timeoutMs": 8000, "retries": 2, "stream": true}',
    "flow" JSONB NOT NULL DEFAULT '{"retry": {"tries": 3, "baseDelayMs": 1000}}',
    "features" JSONB NOT NULL DEFAULT '{"newRunner": false, "parallelSteps": false, "mockMode": false}',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "settings_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."memories" (
    "id" BIGSERIAL NOT NULL,
    "scope" TEXT NOT NULL,
    "tenantId" TEXT,
    "userId" TEXT,
    "sessionId" TEXT,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "ttlAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "settings_versions_settingsId_createdAt_idx" ON "public"."settings_versions"("settingsId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "settings_versions_settingsId_version_key" ON "public"."settings_versions"("settingsId", "version");

-- CreateIndex
CREATE INDEX "idx_mem_lookup" ON "public"."memories"("scope", "tenantId", "userId", "sessionId", "key");

-- CreateIndex
CREATE INDEX "idx_mem_ttl" ON "public"."memories"("ttlAt");

-- CreateIndex
CREATE INDEX "api_calls_corrId_runId_idx" ON "public"."api_calls"("corrId", "runId");

-- CreateIndex
CREATE INDEX "api_calls_createdAt_idx" ON "public"."api_calls"("createdAt");

-- CreateIndex
CREATE INDEX "events_channel_idx" ON "public"."events"("channel");

-- CreateIndex
CREATE INDEX "messages_channel_idx" ON "public"."messages"("channel");

-- AddForeignKey
ALTER TABLE "public"."settings" ADD CONSTRAINT "settings_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "public"."settings_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."settings_versions" ADD CONSTRAINT "settings_versions_settingsId_fkey" FOREIGN KEY ("settingsId") REFERENCES "public"."settings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
