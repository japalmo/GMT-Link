-- CreateTable
CREATE TABLE "points_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "points_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_achievements" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "achievementKey" TEXT NOT NULL,
    "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_achievements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_achievements_userId_achievementKey_key" ON "user_achievements"("userId", "achievementKey");

-- AddForeignKey
ALTER TABLE "points_logs" ADD CONSTRAINT "points_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
