-- CreateTable
CREATE TABLE "auth_tokens" (
    "id" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organisation_info" (
    "id" TEXT NOT NULL,
    "einOrRegNum" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "data" JSONB NOT NULL,

    CONSTRAINT "organisation_info_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "auth_tokens_target_idx" ON "auth_tokens"("target");

-- CreateIndex
CREATE UNIQUE INDEX "auth_tokens_target_key" ON "auth_tokens"("target");

-- CreateIndex
CREATE INDEX "organisation_info_einOrRegNum_region_idx" ON "organisation_info"("einOrRegNum", "region");

-- CreateIndex
CREATE INDEX "organisation_info_einOrRegNum_idx" ON "organisation_info"("einOrRegNum");

-- CreateIndex
CREATE UNIQUE INDEX "organisation_info_einOrRegNum_region_key" ON "organisation_info"("einOrRegNum", "region");
