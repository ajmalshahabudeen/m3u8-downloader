import { NextResponse } from "next/server";
import { z } from "zod";
import { extractStreamFromUrl } from "@/lib/extract-stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Allow long Playwright scrapes
export const maxDuration = 180;

const bodySchema = z.object({
  url: z.string().trim().url("Enter a valid URL"),
  /** Force headless Chromium deep scrape (default true) */
  deep: z.boolean().optional().default(true),
  noBrowser: z.boolean().optional().default(false),
});

export async function POST(request: Request) {
  try {
    const json = await request.json();
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const result = await extractStreamFromUrl(parsed.data.url, {
      deep: parsed.data.deep,
      noBrowser: parsed.data.noBrowser,
    });
    return NextResponse.json({ result });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to extract stream info";
    console.error("POST /api/extract", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
