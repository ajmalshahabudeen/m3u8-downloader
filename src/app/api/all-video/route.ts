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

const bodySchema = z.object({
  url: z.string().trim().url("Enter a valid URL"),
  title: z.string().trim().max(200).optional().nullable(),
  format: outputFormatSchema.optional().default("mp4"),
  quality: z.string().trim().max(120).optional().nullable(),
  engine: z
    .enum(["auto", "ytdlp", "ffmpeg", "direct", "extract_hls"])
    .optional()
    .default("auto"),
  referer: z.string().trim().url().optional().nullable().or(z.literal("")),
  playlist: z.boolean().optional().default(false),
  ytdlpFormat: z.string().trim().max(200).optional().nullable(),
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

    const title =
      (parsed.data.title || "").trim() ||
      "All video download";

    const created = await prisma.download.create({
      data: {
        title,
        url: parsed.data.url,
        referer: parsed.data.referer?.trim() || null,
        format: parsed.data.format ?? "mp4",
        resolution: parsed.data.quality?.trim() || "best",
        status: "PENDING",
        stage: "queued",
        stageLabel: "Queued",
        jobType: "all_video",
        engine: parsed.data.engine || "auto",
        playlist: Boolean(parsed.data.playlist),
        ytdlpFormat: parsed.data.ytdlpFormat?.trim() || null,
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
      } catch (e) {
        await prisma.download.update({
          where: { id: created.id },
          data: {
            status: "FAILED",
            stage: "failed",
            stageLabel: "Failed",
            error:
              e instanceof Error ? e.message : "Invalid cookies.txt",
          },
        });
        return NextResponse.json(
          {
            error:
              e instanceof Error ? e.message : "Invalid cookies.txt",
          },
          { status: 400 },
        );
      }
    }

    enqueueDownloads();

    const fresh = await prisma.download.findUnique({ where: { id: created.id } });
    return NextResponse.json(
      {
        download: serializeDownload(fresh || created),
        disclaimer:
          "Only download content you have the right to access. DRM services are not supported.",
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("POST /api/all-video", error);
    const message =
      error instanceof Error ? error.message : "Failed to queue download";
    return NextResponse.json(
      { error: "Failed to queue download", detail: message },
      { status: 500 },
    );
  }
}
