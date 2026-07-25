import { NextResponse } from "next/server";
import { probeSchema } from "@/lib/validations";
import { probeStreamUrl } from "@/lib/probe-stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const json = await request.json();
    const parsed = probeSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const result = await probeStreamUrl(parsed.data.url);
    return NextResponse.json({ result });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to probe stream";
    console.error("POST /api/probe", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
