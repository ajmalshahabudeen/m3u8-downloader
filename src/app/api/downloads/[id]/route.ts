import { NextResponse } from "next/server";
import fs from "node:fs";
import { prisma } from "@/lib/prisma";
import { enqueueDownloads } from "@/lib/download-worker";
import { serializeDownload } from "@/types/download";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const download = await prisma.download.findUnique({ where: { id } });
  if (!download) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ download: serializeDownload(download) });
}

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  const download = await prisma.download.findUnique({ where: { id } });
  if (!download) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (download.filePath && fs.existsSync(download.filePath)) {
    try {
      fs.unlinkSync(download.filePath);
    } catch (error) {
      console.warn("Failed to delete file", download.filePath, error);
    }
  }

  await prisma.download.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const download = await prisma.download.findUnique({ where: { id } });
  if (!download) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));

  if (body?.action === "retry") {
    if (download.status !== "FAILED") {
      return NextResponse.json(
        { error: "Only failed downloads can be retried" },
        { status: 400 },
      );
    }

    const updated = await prisma.download.update({
      where: { id },
      data: {
        status: "PENDING",
        stage: "queued",
        stageLabel: "Queued",
        progress: 0,
        error: null,
        fileName: null,
        filePath: null,
        fileSize: null,
      },
    });

    enqueueDownloads();
    return NextResponse.json({ download: serializeDownload(updated) });
  }

  return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
}
