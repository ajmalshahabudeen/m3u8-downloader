-- AlterTable
ALTER TABLE "Download" ADD COLUMN "jobType" TEXT NOT NULL DEFAULT 'hls';
ALTER TABLE "Download" ADD COLUMN "engine" TEXT;
ALTER TABLE "Download" ADD COLUMN "extractor" TEXT;
ALTER TABLE "Download" ADD COLUMN "cookiePath" TEXT;
ALTER TABLE "Download" ADD COLUMN "playlist" BOOLEAN NOT NULL DEFAULT 0;
ALTER TABLE "Download" ADD COLUMN "ytdlpFormat" TEXT;
