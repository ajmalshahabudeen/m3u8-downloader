import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { enqueueDownloads } from "@/lib/download-worker";
import {
  allVideoEnabled,
  checkAllVideoRateLimits,
  saveCookiesFile,
} from "@/lib/all-video";
import { outputFormatSchema } from "@/lib/validations";
import { serializeDownload } from "@/types/download";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const itemSchema = z.object({
  url: z.string().trim().url("Enter a valid URL"),
  title: z.string().trim().max(250).optional().nullable(),
  format: outputFormatSchema.optional().default("mp4"),
  quality: z.string().trim().max(120).optional().nullable(),
  engine: z
    .enum(["auto", "ytdlp", "ffmpeg", "direct", "extract_hls"])
    .optional()
    .default("auto"),
  ytdlpFormat: z.string().trim().max(200).optional().nullable(),
});

const bodySchema = z.object({
  items: z.array(itemSchema).min(1, "Provide at least one video item"),
  referer: z.string().trim().url().optional().nullable().or(z.literal("")),
  cookies: z.string().optional().nullable(),
});

export async function POST(request: Request) {
  if (!allVideoEnabled()) {
    return NextResponse.json(
      { error: "All-video downloader is disabled (ALL_VIDEO_ENABLED=0)" },
      { status: 403 },
    );
  }

  try {
    const limitErr = await checkAllVideoRateLimits();
    if (limitErr) {
      return NextResponse.json({ error: limitErr }, { status: 429 });
    }

    const body = await request.json();
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const createdDownloads = [];

    for (const item of parsed.data.items) {
      const title = (item.title || "").trim() || "YouTube Video Download";

      const created = await prisma.download.create({
        data: {
          title,
          url: item.url,
          referer: parsed.data.referer?.trim() || null,
          format: item.format ?? "mp4",
          resolution: item.quality?.trim() || "best",
          status: "PENDING",
          stage: "queued",
          stageLabel: "Queued",
          jobType: "all_video",
          engine: item.engine || "auto",
          playlist: false,
          ytdlpFormat: item.ytdlpFormat?.trim() || null,
        },
      });

      if (parsed.data.cookies?.trim()) {
        try {
          const cookiePath = saveCookiesFile(created.id, parsed.data.cookies);
          await prisma.download.update({
            where: { id: created.id },
            data: { cookiePath },
          });
          created.cookiePath = cookiePath;
        } catch {
          /* ignore cookie save errors per video */
        }
      }

      createdDownloads.push(serializeDownload(created));
    }

    enqueueDownloads();

    return NextResponse.json(
      {
        downloads: createdDownloads,
        count: createdDownloads.length,
        message: `Successfully queued ${createdDownloads.length} videos from playlist`,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("POST /api/youtube-playlist/batch-queue", error);
    const message =
      error instanceof Error ? error.message : "Failed to queue playlist downloads";
    return NextResponse.json(
      { error: "Failed to queue playlist downloads", detail: message },
      { status: 500 },
    );
  }
}
