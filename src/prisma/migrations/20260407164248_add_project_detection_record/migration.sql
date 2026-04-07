-- CreateTable
CREATE TABLE "ProjectDetectionRecord" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "projectId" INTEGER NOT NULL,
    "workLogId" INTEGER,
    "sequence" INTEGER NOT NULL,
    "testCategory" TEXT,
    "testItem" TEXT,
    "quantityText" TEXT,
    "detectDate" DATETIME,
    "reportNo" TEXT,
    "reportEditor" TEXT,
    "mainTester" TEXT,
    "reviewer" TEXT,
    "approver" TEXT,
    "remarks" TEXT,
    "srcTestItem" TEXT,
    "srcQuantityText" TEXT,
    "srcDetectDate" DATETIME,
    "srcMainTester" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProjectDetectionRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProjectDetectionRecord_workLogId_fkey" FOREIGN KEY ("workLogId") REFERENCES "WorkLog" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectDetectionRecord_workLogId_key" ON "ProjectDetectionRecord"("workLogId");
