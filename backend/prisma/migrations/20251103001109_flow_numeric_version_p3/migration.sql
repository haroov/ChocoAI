/*
  Warnings:

  - You are about to drop the column `versionTmp` on the `flows` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "flows" DROP COLUMN "versionTmp",
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;
