import fs from "node:fs";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { formatMeta } from "@/types/download";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const download = await prisma.download.findUnique({ where: { id } });

  if (!download) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (download.status !== "COMPLETED" || !download.filePath) {
    return NextResponse.json(
      { error: "File is not ready for download" },
      { status: 400 },
    );
  }

  if (!fs.existsSync(download.filePath)) {
    return NextResponse.json(
      { error: "File missing on disk" },
      { status: 404 },
    );
  }

  const meta = formatMeta(download.format || "mp4");
  const stat = fs.statSync(download.filePath);
  const stream = fs.createReadStream(download.filePath);
  const fileName =
    download.fileName ?? `${download.title}.${meta.ext}`;

  const webStream = new ReadableStream({
    start(controller) {
      stream.on("data", (chunk) => {
        const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
        controller.enqueue(new Uint8Array(buf));
      });
      stream.on("end", () => controller.close());
      stream.on("error", (err) => controller.error(err));
    },
    cancel() {
      stream.destroy();
    },
  });

  return new NextResponse(webStream, {
    headers: {
      "Content-Type": meta.mime,
      "Content-Length": String(stat.size),
      "Content-Disposition": `attachment; filename="${fileName.replace(/"/g, "")}"`,
      "Cache-Control": "no-store",
    },
  });
}
