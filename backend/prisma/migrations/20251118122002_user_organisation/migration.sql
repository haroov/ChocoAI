-- CreateTable
CREATE TABLE "user_organisation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,

    CONSTRAINT "user_organisation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_organisation_userId_organisationId_key" ON "user_organisation"("userId", "organisationId");

-- AddForeignKey
ALTER TABLE "user_organisation" ADD CONSTRAINT "user_organisation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_organisation" ADD CONSTRAINT "user_organisation_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisation_info"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
