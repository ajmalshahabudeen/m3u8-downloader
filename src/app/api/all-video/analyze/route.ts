import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJsonStdout, runPython } from "@/lib/python-runner";
import { allVideoEnabled } from "@/lib/all-video";
import type { AllVideoAnalyzeResult } from "@/types/download";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

const bodySchema = z.object({
  url: z.string().trim().url("Enter a valid URL"),
  referer: z.string().trim().url().optional().nullable().or(z.literal("")),
  cookies: z.string().optional().nullable(),
  useAi: z.boolean().optional().default(true),
});

export async function POST(request: Request) {
  if (!allVideoEnabled()) {
    return NextResponse.json(
      { error: "All-video downloader is disabled (ALL_VIDEO_ENABLED=0)" },
      { status: 403 },
    );
  }

  try {
    const body = await request.json();
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const args = [
      "--mode",
      "analyze",
      "--url",
      parsed.data.url,
    ];
    if (parsed.data.referer?.trim()) {
      args.push("--referer", parsed.data.referer.trim());
    }
    if (!parsed.data.useAi) {
      args.push("--no-ai");
    }

    // Temp cookies for analyze only
    let cookiePath: string | undefined;
    if (parsed.data.cookies?.trim()) {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const dir =
        process.env.COOKIES_DIR ||
        path.join(/* turbopackIgnore: true */ process.cwd(), "data", "cookies");
      fs.mkdirSync(dir, { recursive: true });
      cookiePath = path.join(dir, `analyze-${Date.now()}.txt`);
      fs.writeFileSync(cookiePath, parsed.data.cookies.trim(), "utf8");
      args.push("--cookies", cookiePath);
    }

    const { code, stdout, stderr } = await runPython(
      "all_video_download.py",
      args,
      { timeoutMs: 120_000 },
    );

    if (cookiePath) {
      try {
        const fs = await import("node:fs");
        fs.unlinkSync(cookiePath);
      } catch {
        /* ignore */
      }
    }

    let result: AllVideoAnalyzeResult;
    try {
      result = parseJsonStdout<AllVideoAnalyzeResult>(stdout);
    } catch {
      return NextResponse.json(
        {
          error: "Analyze failed",
          detail: stderr.trim() || `Invalid JSON (exit ${code})`,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({ result });
  } catch (error) {
    console.error("POST /api/all-video/analyze", error);
    return NextResponse.json(
      {
        error: "Analyze failed",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
