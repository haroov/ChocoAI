-- CreateTable
CREATE TABLE "flow_history" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flow_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "flow_history_userId_flowId_idx" ON "flow_history"("userId", "flowId");

-- CreateIndex
CREATE INDEX "flow_history_userId_idx" ON "flow_history"("userId");

-- AddForeignKey
ALTER TABLE "flow_history" ADD CONSTRAINT "flow_history_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_history" ADD CONSTRAINT "flow_history_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "flows"("id") ON DELETE CASCADE ON UPDATE CASCADE;
