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
/** Prefer Redis/Celery workers. Set QUEUE_BACKEND=inline to force in-process. */
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

/** In-process fallback when Redis/Celery is unavailable. */
async function processDownloadInline(id: string) {
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

    const streamUrl = download.url;
    const referer = download.referer?.trim() || "";

    console.log(
      `[download:inline] id=${id} format=${download.format} prefer=${prefer}`,
    );

    const pyArgs = [
      "--url",
      streamUrl,
      "--output",
      filePath,
      "--format",
      download.format || "mp4",
      "--prefer",
      prefer,
      "--timeout",
      String(Math.max(60, Math.floor(DOWNLOAD_TIMEOUT_MS / 1000))),
    ];
    if (referer) {
      pyArgs.push("--referer", referer);
    }

    const { code, stdout, stderr } = await runPython(
      "download_stream.py",
      pyArgs,
      {
        timeoutMs: DOWNLOAD_TIMEOUT_MS + 15_000,
        onStderrLine: (line) => {
          const stageMatch = line.match(/^STAGE\s+(\S+)\s+(.+)$/i);
          if (stageMatch) {
            const stage = stageMatch[1].toLowerCase();
            const label = stageMatch[2].trim();
            void setStage(id, stage, label).catch(() => undefined);
            return;
          }
          const m = line.match(/^PROGRESS\s+(\d+)/i);
          if (!m) return;
          const next = Number(m[1]);
          if (!Number.isFinite(next) || next <= lastProgress) return;
          lastProgress = next;
          void prisma.download
            .update({
              where: { id },
              data: { progress: next },
            })
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

    if (!result.ok) {
      throw new Error(result.error || "Download failed");
    }

    if (!fs.existsSync(filePath)) {
      throw new Error("Download finished but output file was not created");
    }

    const stats = fs.statSync(filePath);
    if (stats.size <= 0) {
      throw new Error("Download finished with empty output file");
    }

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
    console.error(`[download:inline] failed id=${id}:`, message);

    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch {
        // ignore
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
      void processDownloadInline(next.id)
        .catch((err) => {
          console.error("Inline download worker error", err);
        })
        .finally(() => {
          active -= 1;
          void pumpInlineQueue();
        });
    }
  } finally {
    pumping = false;
  }
}

/**
 * Enqueue pending downloads onto Celery/Redis workers (process-isolated).
 * Falls back to in-process pump if broker is down or QUEUE_BACKEND=inline.
 */
export async function pumpDownloadQueue() {
  if (QUEUE_BACKEND === "inline") {
    await pumpInlineQueue();
    return;
  }

  const pending = await prisma.download.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    take: 50,
    select: { id: true },
  });

  if (pending.length === 0) return;

  const ids = pending.map((p) => p.id);
  const result = await enqueueDownloadJobs(ids);

  if (result.ok) {
    console.log(
      `[queue] enqueued ${result.tasks.length} job(s) via Celery/Redis`,
    );
    // Mark stage label so UI shows they're waiting on the worker pool
    await prisma.download.updateMany({
      where: { id: { in: ids }, status: "PENDING" },
      data: {
        stage: "queued",
        stageLabel: "Queued on worker…",
      },
    });
    return;
  }

  console.warn(
    `[queue] Celery enqueue failed (${result.error}) — falling back to inline workers`,
  );
  await pumpInlineQueue();
}

export function enqueueDownloads() {
  void pumpDownloadQueue().catch((err) => {
    console.error("[queue] pump failed", err);
  });
}
