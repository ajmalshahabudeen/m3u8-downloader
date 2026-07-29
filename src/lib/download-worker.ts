import fs from "node:fs";
import { prisma } from "@/lib/prisma";
import { buildOutputPath } from "@/lib/paths";
import { parseJsonStdout, runPython } from "@/lib/python-runner";
import { enqueueDownloadJobs } from "@/lib/queue";
import type { DownloadStatus } from "@/types/download";

const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT_DOWNLOADS ?? 2);
const DOWNLOAD_TIMEOUT_MS = Number(
  process.env.DOWNLOAD_TIMEOUT_MS ?? 30 * 60 * 1000,
);
const DOWNLOADER_PREF = (process.env.DOWNLOADER ?? "ffmpeg").toLowerCase();
const QUEUE_BACKEND = (process.env.QUEUE_BACKEND ?? "celery").toLowerCase();

let active = 0;
let pumping = false;

type DownloadPyResult =
  | { ok: true; tool: string; output: string; fileSize: number; format?: string }
  | { ok: false; error: string };

const STAGE_TO_STATUS: Record<string, DownloadStatus> = {
  queued: "PENDING",
  probing: "PROBING",
  extracting: "EXTRACTING",
  downloading: "DOWNLOADING",
  combining: "COMBINING",
  converting: "CONVERTING",
  finalizing: "FINALIZING",
  completed: "COMPLETED",
  failed: "FAILED",
};

async function setStage(
  id: string,
  stage: string,
  stageLabel: string,
  progress?: number,
) {
  const status = STAGE_TO_STATUS[stage] ?? "DOWNLOADING";
  await prisma.download.update({
    where: { id },
    data: {
      status,
      stage,
      stageLabel,
      ...(typeof progress === "number" ? { progress } : {}),
    },
  });
}

async function processHlsInline(id: string) {
  const download = await prisma.download.findUnique({ where: { id } });
  if (!download) return;

  const { fileName, filePath } = buildOutputPath(
    download.title,
    download.format || "mp4",
  );

  await prisma.download.update({
    where: { id },
    data: {
      status: "PROBING",
      stage: "probing",
      stageLabel: "Probing stream (inline)",
      progress: 1,
      fileName,
      filePath,
      error: null,
    },
  });

  try {
    let lastProgress = 1;
    const prefer =
      DOWNLOADER_PREF === "downloadm3u8" ? "downloadm3u8" : "ffmpeg";
    const pyArgs = [
      "--url",
      download.url,
      "--output",
      filePath,
      "--format",
      download.format || "mp4",
      "--prefer",
      prefer,
      "--timeout",
      String(Math.max(60, Math.floor(DOWNLOAD_TIMEOUT_MS / 1000))),
    ];
    if (download.referer?.trim()) {
      pyArgs.push("--referer", download.referer.trim());
    }

    const { code, stdout, stderr } = await runPython(
      "download_stream.py",
      pyArgs,
      {
        timeoutMs: DOWNLOAD_TIMEOUT_MS + 15_000,
        onStderrLine: (line) => {
          const stageMatch = line.match(/^STAGE\s+(\S+)\s+(.+)$/i);
          if (stageMatch) {
            void setStage(id, stageMatch[1].toLowerCase(), stageMatch[2].trim());
            return;
          }
          const m = line.match(/^PROGRESS\s+(\d+)/i);
          if (!m) return;
          const next = Number(m[1]);
          if (!Number.isFinite(next) || next <= lastProgress) return;
          lastProgress = next;
          void prisma.download
            .update({ where: { id }, data: { progress: next } })
            .catch(() => undefined);
        },
      },
    );

    let result: DownloadPyResult;
    try {
      result = parseJsonStdout<DownloadPyResult>(stdout);
    } catch {
      throw new Error(
        stderr.trim() || `download_stream.py invalid JSON (exit ${code})`,
      );
    }
    if (!result.ok) throw new Error(result.error || "Download failed");
    if (!fs.existsSync(filePath)) {
      throw new Error("Download finished but output file was not created");
    }
    const stats = fs.statSync(filePath);
    if (stats.size <= 0) throw new Error("Empty output file");

    await prisma.download.update({
      where: { id },
      data: {
        status: "COMPLETED",
        stage: "completed",
        stageLabel: "Completed",
        progress: 100,
        fileName,
        filePath,
        fileSize: result.fileSize || stats.size,
        error: null,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown download error";
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch {
        /* ignore */
      }
    }
    await prisma.download.update({
      where: { id },
      data: {
        status: "FAILED",
        stage: "failed",
        stageLabel: "Failed",
        progress: 0,
        error: message,
      },
    });
  }
}

async function processAllVideoInline(id: string) {
  const download = await prisma.download.findUnique({ where: { id } });
  if (!download) return;

  const { fileName, filePath } = buildOutputPath(
    download.title,
    download.format || "mp4",
  );

  await prisma.download.update({
    where: { id },
    data: {
      status: "PROBING",
      stage: "probing",
      stageLabel: "Analyzing media (inline)",
      progress: 1,
      fileName,
      filePath,
      error: null,
    },
  });

  try {
    let lastProgress = 1;
    const pyArgs = [
      "--mode",
      "download",
      "--url",
      download.url,
      "--output",
      filePath,
      "--format",
      download.format || "mp4",
      "--quality",
      download.resolution || "best",
      "--engine",
      download.engine || "auto",
      "--timeout",
      String(Math.max(60, Math.floor(DOWNLOAD_TIMEOUT_MS / 1000))),
      "--no-ai",
    ];
    if (download.referer?.trim()) pyArgs.push("--referer", download.referer.trim());
    if (download.cookiePath?.trim())
      pyArgs.push("--cookies", download.cookiePath.trim());
    if (download.playlist) pyArgs.push("--playlist");
    if (download.ytdlpFormat?.trim())
      pyArgs.push("--ytdlp-format", download.ytdlpFormat.trim());

    const { code, stdout, stderr } = await runPython(
      "all_video_download.py",
      pyArgs,
      {
        timeoutMs: DOWNLOAD_TIMEOUT_MS + 30_000,
        onStderrLine: (line) => {
          const stageMatch = line.match(/^STAGE\s+(\S+)\s+(.+)$/i);
          if (stageMatch) {
            void setStage(id, stageMatch[1].toLowerCase(), stageMatch[2].trim());
            return;
          }
          const m = line.match(/^PROGRESS\s+(\d+)/i);
          if (!m) return;
          const next = Number(m[1]);
          if (!Number.isFinite(next) || next <= lastProgress) return;
          lastProgress = next;
          void prisma.download
            .update({ where: { id }, data: { progress: next } })
            .catch(() => undefined);
        },
      },
    );

    type AllRes = {
      ok: boolean;
      error?: string;
      output?: string;
      fileSize?: number;
      engine?: string;
      extractor?: string;
      title?: string;
    };
    let result: AllRes;
    try {
      result = parseJsonStdout<AllRes>(stdout);
    } catch {
      throw new Error(
        stderr.trim() || `all_video_download.py invalid JSON (exit ${code})`,
      );
    }
    if (!result.ok) throw new Error(result.error || "Download failed");

    const outPath = result.output || filePath;
    if (!fs.existsSync(outPath)) {
      throw new Error("Output file missing");
    }
    const stats = fs.statSync(outPath);
    await prisma.download.update({
      where: { id },
      data: {
        status: "COMPLETED",
        stage: "completed",
        stageLabel: "Completed",
        progress: 100,
        fileName: outPath.split(/[/\\]/).pop() || fileName,
        filePath: outPath,
        fileSize: result.fileSize || stats.size,
        engine: result.engine || download.engine,
        extractor: result.extractor || download.extractor,
        error: null,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown download error";
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch {
        /* ignore */
      }
    }
    await prisma.download.update({
      where: { id },
      data: {
        status: "FAILED",
        stage: "failed",
        stageLabel: "Failed",
        progress: 0,
        error: message,
      },
    });
  }
}

async function pumpInlineQueue() {
  if (pumping) return;
  pumping = true;
  try {
    while (true) {
      if (active >= MAX_CONCURRENT) break;
      const next = await prisma.download.findFirst({
        where: { status: "PENDING" },
        orderBy: { createdAt: "asc" },
      });
      if (!next) break;

      const claimed = await prisma.download.updateMany({
        where: { id: next.id, status: "PENDING" },
        data: {
          status: "PROBING",
          stage: "probing",
          stageLabel: "Starting (inline)…",
          progress: 1,
        },
      });
      if (claimed.count === 0) continue;

      active += 1;
      const job =
        next.jobType === "all_video"
          ? processAllVideoInline(next.id)
          : processHlsInline(next.id);
      void job
        .catch((err) => console.error("Inline worker error", err))
        .finally(() => {
          active -= 1;
          void pumpInlineQueue();
        });
    }
  } finally {
    pumping = false;
  }
}

export async function pumpDownloadQueue() {
  if (QUEUE_BACKEND === "inline") {
    await pumpInlineQueue();
    return;
  }

  const pending = await prisma.download.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    take: 50,
    select: { id: true, jobType: true },
  });
  if (pending.length === 0) return;

  const hlsIds = pending.filter((p) => p.jobType !== "all_video").map((p) => p.id);
  const allIds = pending.filter((p) => p.jobType === "all_video").map((p) => p.id);

  let anyOk = false;
  if (hlsIds.length) {
    const r = await enqueueDownloadJobs(hlsIds, "download");
    if (r.ok) {
      anyOk = true;
      await prisma.download.updateMany({
        where: { id: { in: hlsIds }, status: "PENDING" },
        data: { stage: "queued", stageLabel: "Queued on worker…" },
      });
      console.log(`[queue] enqueued ${hlsIds.length} HLS job(s)`);
    } else {
      console.warn(`[queue] HLS enqueue failed: ${r.error}`);
    }
  }
  if (allIds.length) {
    const r = await enqueueDownloadJobs(allIds, "all-video");
    if (r.ok) {
      anyOk = true;
      await prisma.download.updateMany({
        where: { id: { in: allIds }, status: "PENDING" },
        data: { stage: "queued", stageLabel: "Queued on worker…" },
      });
      console.log(`[queue] enqueued ${allIds.length} all-video job(s)`);
    } else {
      console.warn(`[queue] all-video enqueue failed: ${r.error}`);
    }
  }

  if (!anyOk) {
    console.warn("[queue] Celery unavailable — inline fallback");
    await pumpInlineQueue();
  }
}

export function enqueueDownloads() {
  void pumpDownloadQueue().catch((err) => {
    console.error("[queue] pump failed", err);
  });
}
