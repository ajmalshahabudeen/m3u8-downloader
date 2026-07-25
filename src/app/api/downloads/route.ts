import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { enqueueDownloads } from "@/lib/download-worker";
import {
  batchDownloadSchema,
  singleDownloadSchema,
} from "@/lib/validations";
import { serializeDownload } from "@/types/download";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const downloads = await prisma.download.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return NextResponse.json({
    downloads: downloads.map(serializeDownload),
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (body && Array.isArray(body.items)) {
      const parsed = batchDownloadSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "Validation failed", details: parsed.error.flatten() },
          { status: 400 },
        );
      }

      const created = await prisma.$transaction(
        parsed.data.items.map((item) =>
          prisma.download.create({
            data: {
              title: item.title,
              url: item.url,
              format: item.format ?? "mp4",
              resolution: item.resolution || null,
              status: "PENDING",
              stage: "queued",
              stageLabel: "Queued",
            },
          }),
        ),
      );

      enqueueDownloads();
      return NextResponse.json(
        { downloads: created.map(serializeDownload) },
        { status: 201 },
      );
    }

    const parsed = singleDownloadSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const created = await prisma.download.create({
      data: {
        title: parsed.data.title,
        url: parsed.data.url,
        format: parsed.data.format ?? "mp4",
        resolution: parsed.data.resolution || null,
        status: "PENDING",
        stage: "queued",
        stageLabel: "Queued",
      },
    });

    enqueueDownloads();
    return NextResponse.json(
      { download: serializeDownload(created) },
      { status: 201 },
    );
  } catch (error) {
    console.error("POST /api/downloads", error);
    const message =
      error instanceof Error ? error.message : "Failed to create download";
    // Surface schema-mismatch hints clearly
    const hint = message.includes("does not exist")
      ? " Database schema is outdated — restart the container so migrations/db push can run (or rebuild with FORCE_BUILD=1)."
      : "";
    return NextResponse.json(
      { error: `Failed to create download.${hint}`, detail: message },
      { status: 500 },
    );
  }
}
