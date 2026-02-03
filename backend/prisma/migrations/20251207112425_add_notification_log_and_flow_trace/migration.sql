-- CreateTable
CREATE TABLE "flow_traces" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "flowSlug" TEXT NOT NULL,
    "stageSlug" TEXT NOT NULL,
    "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "fieldsCollected" TEXT[],
    "toolsExecuted" JSONB[],
    "errorsEncountered" JSONB[],
    "userDataSnapshot" JSONB,

    CONSTRAINT "flow_traces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_logs" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "messageId" TEXT,
    "error" TEXT,
    "provider" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "flow_traces_conversationId_idx" ON "flow_traces"("conversationId");

-- CreateIndex
CREATE INDEX "flow_traces_flowSlug_stageSlug_idx" ON "flow_traces"("flowSlug", "stageSlug");

-- CreateIndex
CREATE INDEX "flow_traces_enteredAt_idx" ON "flow_traces"("enteredAt");

-- CreateIndex
CREATE INDEX "notification_logs_conversationId_idx" ON "notification_logs"("conversationId");

-- CreateIndex
CREATE INDEX "notification_logs_createdAt_idx" ON "notification_logs"("createdAt");

-- CreateIndex
CREATE INDEX "notification_logs_idempotencyKey_idx" ON "notification_logs"("idempotencyKey");

-- AddForeignKey
ALTER TABLE "flow_traces" ADD CONSTRAINT "flow_traces_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
