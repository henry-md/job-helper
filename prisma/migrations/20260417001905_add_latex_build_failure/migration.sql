-- CreateTable
CREATE TABLE "LatexBuildFailure" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "latexCode" TEXT NOT NULL,
    "error" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LatexBuildFailure_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LatexBuildFailure_userId_createdAt_idx" ON "LatexBuildFailure"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "LatexBuildFailure_createdAt_idx" ON "LatexBuildFailure"("createdAt" DESC);

-- AddForeignKey
ALTER TABLE "LatexBuildFailure" ADD CONSTRAINT "LatexBuildFailure_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
