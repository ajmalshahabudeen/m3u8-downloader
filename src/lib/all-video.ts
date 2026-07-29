import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";

const cwd = /* turbopackIgnore: true */ process.cwd();

export function allVideoEnabled() {
  return (process.env.ALL_VIDEO_ENABLED ?? "1") !== "0";
}

export function maxAllVideoConcurrent() {
  return Math.max(1, Number(process.env.ALL_VIDEO_MAX_CONCURRENT ?? 3));
}

export function maxAllVideoPerHour() {
  return Math.max(1, Number(process.env.ALL_VIDEO_MAX_PER_HOUR ?? 30));
}

export function cookiesDir() {
  const dir =
    process.env.COOKIES_DIR ??
    path.join(cwd, "data", "cookies");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Returns error message if rate-limited, else null. */
export async function checkAllVideoRateLimits(): Promise<string | null> {
  const concurrent = await prisma.download.count({
    where: {
      jobType: "all_video",
      status: {
        in: [
          "PENDING",
          "PROBING",
          "EXTRACTING",
          "DOWNLOADING",
          "COMBINING",
          "CONVERTING",
          "FINALIZING",
        ],
      },
    },
  });
  if (concurrent >= maxAllVideoConcurrent()) {
    return `Too many active all-video jobs (max ${maxAllVideoConcurrent()}). Wait for some to finish.`;
  }

  const since = new Date(Date.now() - 60 * 60 * 1000);
  const lastHour = await prisma.download.count({
    where: {
      jobType: "all_video",
      createdAt: { gte: since },
    },
  });
  if (lastHour >= maxAllVideoPerHour()) {
    return `Hourly all-video limit reached (max ${maxAllVideoPerHour()}/hour). Try later.`;
  }
  return null;
}

export function saveCookiesFile(jobId: string, content: string): string {
  const clean = content.replace(/^\uFEFF/, "").trim();
  if (!clean) throw new Error("Empty cookies file");
  // Basic Netscape cookies header check (soft)
  if (
    !clean.includes("# Netscape") &&
    !clean.includes("http") &&
    clean.split("\n").length < 2
  ) {
    throw new Error("Cookies must be Netscape cookies.txt format");
  }
  const filePath = path.join(cookiesDir(), `${jobId}.txt`);
  fs.writeFileSync(filePath, clean, "utf8");
  return filePath;
}
