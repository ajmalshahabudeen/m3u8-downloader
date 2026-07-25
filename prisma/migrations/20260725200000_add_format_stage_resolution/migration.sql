-- AlterTable
ALTER TABLE "Download" ADD COLUMN "format" TEXT NOT NULL DEFAULT 'mp4';
ALTER TABLE "Download" ADD COLUMN "resolution" TEXT;
ALTER TABLE "Download" ADD COLUMN "stage" TEXT NOT NULL DEFAULT 'queued';
ALTER TABLE "Download" ADD COLUMN "stageLabel" TEXT NOT NULL DEFAULT 'Queued';
