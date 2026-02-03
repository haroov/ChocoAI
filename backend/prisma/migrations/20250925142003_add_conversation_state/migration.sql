-- CreateTable
CREATE TABLE "public"."conversation_state" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "intentConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "role" TEXT,
    "signupStatus" TEXT NOT NULL DEFAULT 'pending',
    "signupError" TEXT,
    "lastPromptedStage" TEXT,
    "fields" JSONB,
    "timestamps" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversation_state_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "conversation_state_conversationId_key" ON "public"."conversation_state"("conversationId");

-- AddForeignKey
ALTER TABLE "public"."conversation_state" ADD CONSTRAINT "conversation_state_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "public"."conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
