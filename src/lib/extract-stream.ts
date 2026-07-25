import type { ExtractResult } from "@/types/extract";
import { parseJsonStdout, runPython } from "@/lib/python-runner";

export type { ExtractResult };

type PythonExtractPayload = ExtractResult & { error?: string };

export type ExtractOptions = {
  /** Force Playwright deep scrape (JS + network + iframes). Default true for page URLs. */
  deep?: boolean;
  /** Disable browser scrape entirely */
  noBrowser?: boolean;
};

/**
 * Server-side only. Never runs in the browser (avoids CORS).
 * Uses Python static HTML first, then Playwright headless Chromium for JS-loaded streams.
 */
export async function extractStreamFromUrl(
  inputUrl: string,
  options: ExtractOptions = {},
): Promise<ExtractResult> {
  const url = inputUrl.trim();
  if (!url) throw new Error("Enter a valid http(s) URL");

  const deep = options.deep !== false; // default ON for richer scrape
  const args = ["--url", url];
  if (options.noBrowser) args.push("--no-browser");
  else if (deep) args.push("--deep");

  // Browser scrape can take a while (includes TLS retries)
  const timeoutMs = options.noBrowser ? 90_000 : 150_000;

  const { code, stdout, stderr } = await runPython(
    "extract_stream.py",
    args,
    { timeoutMs },
  );

  let payload: PythonExtractPayload;
  try {
    payload = parseJsonStdout<PythonExtractPayload>(stdout);
  } catch {
    throw new Error(
      stderr.trim() ||
        `extract_stream.py returned invalid JSON (exit ${code})`,
    );
  }

  if (payload.error) {
    throw new Error(payload.error);
  }

  if (code !== 0 && !payload.m3u8Url && payload.source !== "none") {
    throw new Error(payload.error || `extract_stream.py exited with ${code}`);
  }

  return {
    pageUrl: payload.pageUrl,
    title: payload.title ?? null,
    m3u8Url: payload.m3u8Url ?? null,
    candidates: Array.isArray(payload.candidates) ? payload.candidates : [],
    source: payload.source ?? "none",
    warnings: Array.isArray(payload.warnings) ? payload.warnings : [],
    method: payload.method ?? null,
  };
}
