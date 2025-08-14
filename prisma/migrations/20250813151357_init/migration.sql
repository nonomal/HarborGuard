-- CreateTable
CREATE TABLE "images" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "registry" TEXT,
    "digest" TEXT NOT NULL,
    "platform" TEXT,
    "sizeBytes" BIGINT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "scans" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "imageId" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL,
    "finishedAt" DATETIME,
    "sizeBytes" BIGINT,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "trivy" JSONB,
    "grype" JSONB,
    "syft" JSONB,
    "dockle" JSONB,
    "metadata" JSONB,
    "reportsDir" TEXT,
    "scannerVersions" JSONB,
    "scanConfig" JSONB,
    "errorMessage" TEXT,
    "vulnerabilityCount" JSONB,
    "riskScore" INTEGER,
    "complianceScore" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "scans_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "images" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "images_digest_key" ON "images"("digest");

-- CreateIndex
CREATE INDEX "images_name_tag_idx" ON "images"("name", "tag");

-- CreateIndex
CREATE INDEX "images_registry_name_tag_idx" ON "images"("registry", "name", "tag");

-- CreateIndex
CREATE INDEX "images_digest_idx" ON "images"("digest");

-- CreateIndex
CREATE UNIQUE INDEX "scans_requestId_key" ON "scans"("requestId");

-- CreateIndex
CREATE INDEX "scans_requestId_idx" ON "scans"("requestId");

-- CreateIndex
CREATE INDEX "scans_status_idx" ON "scans"("status");

-- CreateIndex
CREATE INDEX "scans_startedAt_idx" ON "scans"("startedAt");

-- CreateIndex
CREATE INDEX "scans_imageId_idx" ON "scans"("imageId");
