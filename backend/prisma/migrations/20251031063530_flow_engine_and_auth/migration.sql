/*
  Warnings:

  - You are about to drop the column `title` on the `conversations` table. All the data in the column will be lost.
  - You are about to drop the column `channel` on the `messages` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[key,userId,flowId]` on the table `user_data` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `flowId` to the `user_data` table without a default value. This is not possible if the table is not empty.
  - Added the required column `type` to the `user_data` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "public"."messages_channel_idx";

-- DropIndex
DROP INDEX "public"."user_data_userId_key_key";

-- AlterTable
ALTER TABLE "conversations" DROP COLUMN "title",
ADD COLUMN     "channel" TEXT NOT NULL DEFAULT 'n/a';

-- AlterTable
ALTER TABLE "messages" DROP COLUMN "channel",
ADD COLUMN     "flowId" TEXT;

-- AlterTable
ALTER TABLE "user_data" ADD COLUMN     "flowId" TEXT NOT NULL,
ADD COLUMN     "type" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "flows" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "definition" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_flow" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,

    CONSTRAINT "user_flow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "operationType" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "conversationId" TEXT NOT NULL,
    "inReplyTo" TEXT NOT NULL,
    "cost" DECIMAL(10,6) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admins" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'admin',
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admins_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "flows_slug_idx" ON "flows"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "flows_slug_key" ON "flows"("slug");

-- CreateIndex
CREATE INDEX "user_flow_userId_idx" ON "user_flow"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_flow_userId_key" ON "user_flow"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "admins_username_key" ON "admins"("username");

-- CreateIndex
CREATE INDEX "conversations_channel_idx" ON "conversations"("channel");

-- CreateIndex
CREATE UNIQUE INDEX "user_data_key_userId_flowId_key" ON "user_data"("key", "userId", "flowId");

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "flows"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_data" ADD CONSTRAINT "user_data_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "flows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_flow" ADD CONSTRAINT "user_flow_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_flow" ADD CONSTRAINT "user_flow_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "flows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_inReplyTo_fkey" FOREIGN KEY ("inReplyTo") REFERENCES "messages"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
