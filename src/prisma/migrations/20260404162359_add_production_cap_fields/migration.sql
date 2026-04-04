-- CreateTable
CREATE TABLE "Staff" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "role" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Contract" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "contractNo" TEXT,
    "clientName" TEXT,
    "partyB" TEXT,
    "filePath" TEXT,
    "signedDate" DATETIME,
    "notes" TEXT,
    "pricingMode" TEXT NOT NULL DEFAULT 'unit',
    "areaPricingAmount" REAL,
    "areaPricingArea" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Project" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT '进行中',
    "phase" TEXT,
    "contractId" INTEGER,
    "contractLinkedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Project_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PriceItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "contractId" INTEGER NOT NULL,
    "testItemName" TEXT NOT NULL,
    "quantity" REAL,
    "unit" TEXT,
    "unitPrice" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PriceItem_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InternalPrice" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "testItemName" TEXT NOT NULL,
    "unit" TEXT,
    "unitPrice" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "WorkLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "workDate" DATETIME NOT NULL,
    "projectId" INTEGER,
    "testContent" TEXT NOT NULL,
    "quantity" REAL NOT NULL,
    "unit" TEXT,
    "rawText" TEXT,
    "remarks" TEXT,
    "allocationShare" REAL,
    "manualTotalValue" REAL,
    "manualValueNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkLog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WorkLogStaff" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "workLogId" INTEGER NOT NULL,
    "staffId" INTEGER NOT NULL,
    CONSTRAINT "WorkLogStaff_workLogId_fkey" FOREIGN KEY ("workLogId") REFERENCES "WorkLog" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkLogStaff_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProductionValue" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "workLogId" INTEGER,
    "reportId" INTEGER,
    "staffId" INTEGER NOT NULL,
    "value" REAL NOT NULL,
    "unitPriceUsed" REAL NOT NULL,
    "priceSource" TEXT NOT NULL,
    "calculationMode" TEXT NOT NULL DEFAULT 'unit',
    "roleType" TEXT,
    "workloadQuantity" REAL,
    "workloadShare" REAL,
    "exceeded" BOOLEAN NOT NULL DEFAULT false,
    "originalValue" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductionValue_workLogId_fkey" FOREIGN KEY ("workLogId") REFERENCES "WorkLog" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProductionValue_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "TestReport" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProductionValue_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TestReport" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "reportNo" TEXT,
    "projectId" INTEGER,
    "testContent" TEXT NOT NULL,
    "reportDate" DATETIME,
    "quantity" REAL NOT NULL DEFAULT 1,
    "unit" TEXT,
    "remarks" TEXT,
    "rawText" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TestReport_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReportRole" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "reportId" INTEGER NOT NULL,
    "roleType" TEXT NOT NULL,
    "staffId" INTEGER NOT NULL,
    CONSTRAINT "ReportRole_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "TestReport" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReportRole_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkLogStaff_workLogId_staffId_key" ON "WorkLogStaff"("workLogId", "staffId");

-- CreateIndex
CREATE UNIQUE INDEX "ReportRole_reportId_roleType_staffId_key" ON "ReportRole"("reportId", "roleType", "staffId");
