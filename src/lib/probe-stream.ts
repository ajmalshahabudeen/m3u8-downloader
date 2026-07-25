import type { ProbeResult } from "@/types/download";
import { parseJsonStdout, runPython } from "@/lib/python-runner";

type PythonProbe = ProbeResult & { error?: string };

/** Server-side probe of m3u8 master/media playlists via Python. */
export async function probeStreamUrl(inputUrl: string): Promise<ProbeResult> {
  const url = inputUrl.trim();
  if (!url) throw new Error("Enter a valid URL");

  const { code, stdout, stderr } = await runPython(
    "probe_stream.py",
    ["--url", url],
    { timeoutMs: 45_000 },
  );

  let payload: PythonProbe;
  try {
    payload = parseJsonStdout<PythonProbe>(stdout);
  } catch {
    throw new Error(
      stderr.trim() || `probe_stream.py returned invalid JSON (exit ${code})`,
    );
  }

  if (payload.error) throw new Error(payload.error);

  return {
    url: payload.url,
    isMaster: Boolean(payload.isMaster),
    variants: Array.isArray(payload.variants) ? payload.variants : [],
    warnings: Array.isArray(payload.warnings) ? payload.warnings : [],
  };
}
