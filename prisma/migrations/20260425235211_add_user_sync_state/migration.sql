-- CreateTable
CREATE TABLE "UserSyncState" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "applicationsVersion" INTEGER NOT NULL DEFAULT 0,
    "tailoringVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSyncState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserSyncState_userId_key" ON "UserSyncState"("userId");

-- CreateIndex
CREATE INDEX "UserSyncState_updatedAt_idx" ON "UserSyncState"("updatedAt" DESC);

-- AddForeignKey
ALTER TABLE "UserSyncState" ADD CONSTRAINT "UserSyncState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
