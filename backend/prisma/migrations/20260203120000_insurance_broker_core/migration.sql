-- CreateEnum
CREATE TYPE "LegalIdType" AS ENUM ('HP', 'AM', 'TZ', 'EIN');

-- CreateEnum
CREATE TYPE "CustomerAccessRole" AS ENUM ('owner', 'admin', 'viewer');

-- CreateEnum
CREATE TYPE "InsuranceCaseStatus" AS ENUM (
  'draft',
  'collectingInfo',
  'submittedToCarrier',
  'awaitingCarrier',
  'awaitingCustomer',
  'issued',
  'cancelled'
);

-- CreateEnum
CREATE TYPE "InsuranceCoverageType" AS ENUM (
  'structure',
  'contents',
  'thirdParty',
  'employersLiability',
  'specialRisks',
  'professionalLiability',
  'paramedical',
  'productLiability',
  'other'
);

-- CreateEnum
CREATE TYPE "InsuranceRequirementStatus" AS ENUM ('needed', 'requested', 'received', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "InsuranceRequirementRequestedBy" AS ENUM ('broker', 'carrier');

-- CreateEnum
CREATE TYPE "EmailDirection" AS ENUM ('inbound', 'outbound');

-- CreateEnum
CREATE TYPE "EmailProvider" AS ENUM ('mailgun', 'sendgrid', 'other');

-- CreateEnum
CREATE TYPE "PdfDocumentStatus" AS ENUM (
  'draft',
  'generated',
  'sentToCarrier',
  'sentToCustomer',
  'receivedFromCarrier',
  'archived'
);

-- CreateTable
CREATE TABLE "customers" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "displayName" TEXT NOT NULL,
  "legalIdType" "LegalIdType" NOT NULL,
  "legalId" TEXT NOT NULL,
  "country" TEXT NOT NULL DEFAULT 'IL',
  "industry" TEXT,
  "addressJson" JSONB,
  "notes" TEXT,
  CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_users" (
  "customerId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "accessRole" "CustomerAccessRole" NOT NULL DEFAULT 'owner',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_users_pkey" PRIMARY KEY ("customerId", "userId")
);

-- CreateTable
CREATE TABLE "insurance_carriers" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "contactEmails" TEXT[],
  "inboundMatch" JSONB,
  CONSTRAINT "insurance_carriers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insurance_cases" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "status" "InsuranceCaseStatus" NOT NULL DEFAULT 'draft',
  "summary" TEXT,
  "customerId" TEXT NOT NULL,
  "carrierId" TEXT NOT NULL,
  "conversationId" TEXT,
  "createdByUserId" TEXT,
  CONSTRAINT "insurance_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insurance_coverages" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "caseId" TEXT NOT NULL,
  "coverageType" "InsuranceCoverageType" NOT NULL,
  "details" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "sumInsured" DECIMAL(14,2),
  "deductible" DECIMAL(14,2),
  "currency" TEXT NOT NULL DEFAULT 'ILS',
  CONSTRAINT "insurance_coverages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insurance_requirements" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "caseId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "status" "InsuranceRequirementStatus" NOT NULL DEFAULT 'needed',
  "requestedBy" "InsuranceRequirementRequestedBy" NOT NULL DEFAULT 'broker',
  "dueAt" TIMESTAMP(3),
  "metadata" JSONB,
  CONSTRAINT "insurance_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_messages" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "direction" "EmailDirection" NOT NULL,
  "provider" "EmailProvider" NOT NULL,
  "providerMessageId" TEXT,
  "inReplyTo" TEXT,
  "references" TEXT[],
  "threadKey" TEXT,
  "from" TEXT NOT NULL,
  "to" TEXT[],
  "cc" TEXT[],
  "subject" TEXT NOT NULL,
  "bodyText" TEXT,
  "bodyHtml" TEXT,
  "rawPayload" JSONB,
  "matchedLegalIdType" "LegalIdType",
  "matchedLegalId" TEXT,
  "carrierId" TEXT,
  "customerId" TEXT,
  "caseId" TEXT,
  CONSTRAINT "email_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_attachments" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "emailMessageId" TEXT NOT NULL,
  "filename" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL,
  "content" BYTEA NOT NULL,
  CONSTRAINT "email_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pdf_templates" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "carrierId" TEXT,
  "name" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "fileBytes" BYTEA NOT NULL,
  "fieldMapping" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "pdf_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pdf_documents" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "caseId" TEXT NOT NULL,
  "templateId" TEXT,
  "status" "PdfDocumentStatus" NOT NULL DEFAULT 'draft',
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL DEFAULT 'application/pdf',
  "sizeBytes" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL,
  "fileBytes" BYTEA NOT NULL,
  CONSTRAINT "pdf_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customers_legalIdType_legalId_idx" ON "customers"("legalIdType", "legalId");

-- CreateIndex
CREATE UNIQUE INDEX "customers_legalIdType_legalId_country_key" ON "customers"("legalIdType", "legalId", "country");

-- CreateIndex
CREATE INDEX "customer_users_userId_idx" ON "customer_users"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "insurance_carriers_slug_key" ON "insurance_carriers"("slug");

-- CreateIndex
CREATE INDEX "insurance_cases_customerId_status_idx" ON "insurance_cases"("customerId", "status");

-- CreateIndex
CREATE INDEX "insurance_cases_carrierId_status_idx" ON "insurance_cases"("carrierId", "status");

-- CreateIndex
CREATE INDEX "insurance_cases_conversationId_idx" ON "insurance_cases"("conversationId");

-- CreateIndex
CREATE INDEX "insurance_coverages_caseId_coverageType_idx" ON "insurance_coverages"("caseId", "coverageType");

-- CreateIndex
CREATE UNIQUE INDEX "insurance_requirements_caseId_key_key" ON "insurance_requirements"("caseId", "key");

-- CreateIndex
CREATE INDEX "insurance_requirements_caseId_status_idx" ON "insurance_requirements"("caseId", "status");

-- CreateIndex
CREATE INDEX "email_messages_provider_providerMessageId_idx" ON "email_messages"("provider", "providerMessageId");

-- CreateIndex
CREATE INDEX "email_messages_caseId_createdAt_idx" ON "email_messages"("caseId", "createdAt");

-- CreateIndex
CREATE INDEX "email_messages_customerId_createdAt_idx" ON "email_messages"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "email_messages_carrierId_createdAt_idx" ON "email_messages"("carrierId", "createdAt");

-- CreateIndex
CREATE INDEX "email_messages_threadKey_idx" ON "email_messages"("threadKey");

-- CreateIndex
CREATE INDEX "email_attachments_emailMessageId_idx" ON "email_attachments"("emailMessageId");

-- CreateIndex
CREATE INDEX "email_attachments_sha256_idx" ON "email_attachments"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "pdf_templates_carrierId_name_version_key" ON "pdf_templates"("carrierId", "name", "version");

-- CreateIndex
CREATE INDEX "pdf_templates_carrierId_active_idx" ON "pdf_templates"("carrierId", "active");

-- CreateIndex
CREATE INDEX "pdf_documents_caseId_createdAt_idx" ON "pdf_documents"("caseId", "createdAt");

-- CreateIndex
CREATE INDEX "pdf_documents_templateId_idx" ON "pdf_documents"("templateId");

-- CreateIndex
CREATE INDEX "pdf_documents_sha256_idx" ON "pdf_documents"("sha256");

-- AddForeignKey
ALTER TABLE "customer_users" ADD CONSTRAINT "customer_users_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_users" ADD CONSTRAINT "customer_users_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurance_cases" ADD CONSTRAINT "insurance_cases_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurance_cases" ADD CONSTRAINT "insurance_cases_carrierId_fkey"
  FOREIGN KEY ("carrierId") REFERENCES "insurance_carriers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurance_cases" ADD CONSTRAINT "insurance_cases_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurance_cases" ADD CONSTRAINT "insurance_cases_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurance_coverages" ADD CONSTRAINT "insurance_coverages_caseId_fkey"
  FOREIGN KEY ("caseId") REFERENCES "insurance_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurance_requirements" ADD CONSTRAINT "insurance_requirements_caseId_fkey"
  FOREIGN KEY ("caseId") REFERENCES "insurance_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_carrierId_fkey"
  FOREIGN KEY ("carrierId") REFERENCES "insurance_carriers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_caseId_fkey"
  FOREIGN KEY ("caseId") REFERENCES "insurance_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_attachments" ADD CONSTRAINT "email_attachments_emailMessageId_fkey"
  FOREIGN KEY ("emailMessageId") REFERENCES "email_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pdf_templates" ADD CONSTRAINT "pdf_templates_carrierId_fkey"
  FOREIGN KEY ("carrierId") REFERENCES "insurance_carriers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pdf_documents" ADD CONSTRAINT "pdf_documents_caseId_fkey"
  FOREIGN KEY ("caseId") REFERENCES "insurance_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pdf_documents" ADD CONSTRAINT "pdf_documents_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "pdf_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

