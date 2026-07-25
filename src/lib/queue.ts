import { parseJsonStdout, runPython } from "@/lib/python-runner";

export type EnqueueDownloadResult =
  | {
      ok: true;
      type: "download";
      tasks: { downloadId: string; taskId: string }[];
      backend: "celery";
    }
  | { ok: false; error: string };

/**
 * Push download job(s) onto Redis via Celery (process-isolated Python workers).
 * Returns ok:false if Redis/worker broker is unavailable — caller may fall back.
 */
export async function enqueueDownloadJobs(
  ids: string | string[],
): Promise<EnqueueDownloadResult> {
  const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
  if (list.length === 0) {
    return { ok: false, error: "No download ids" };
  }

  const args = ["--type", "download", ...list.flatMap((id) => ["--id", id])];

  try {
    const { code, stdout, stderr } = await runPython("enqueue_job.py", args, {
      timeoutMs: 15_000,
    });
    let payload: EnqueueDownloadResult & { tasks?: unknown };
    try {
      payload = parseJsonStdout(stdout);
    } catch {
      return {
        ok: false,
        error:
          stderr.trim() ||
          `enqueue_job.py invalid JSON (exit ${code})`,
      };
    }
    if (!payload.ok) {
      return { ok: false, error: payload.error || "enqueue failed" };
    }
    return {
      ok: true,
      type: "download",
      tasks: (payload as { tasks: { downloadId: string; taskId: string }[] })
        .tasks,
      backend: "celery",
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function enqueueRequeuePending(): Promise<void> {
  try {
    await runPython(
      "enqueue_job.py",
      ["--type", "requeue-pending"],
      { timeoutMs: 15_000 },
    );
  } catch (error) {
    console.warn("[queue] requeue-pending failed", error);
  }
}
