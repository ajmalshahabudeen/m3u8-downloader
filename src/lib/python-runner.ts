import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const cwd = /* turbopackIgnore: true */ process.cwd();

let cachedPython: string | null = null;

function canImportBs4(bin: string, extraArgs: string[] = []) {
  const r = spawnSync(bin, [...extraArgs, "-c", "import bs4,requests"], {
    encoding: "utf8",
    timeout: 8000,
    windowsHide: true,
  });
  return r.status === 0;
}

export function getPythonBin() {
  if (process.env.PYTHON_BIN) return process.env.PYTHON_BIN;
  if (cachedPython) return cachedPython;

  if (process.platform === "win32") {
    if (canImportBs4("py", ["-3"])) {
      cachedPython = "py -3";
      return cachedPython;
    }
    for (const c of ["python", "python3"]) {
      if (canImportBs4(c)) {
        cachedPython = c;
        return c;
      }
    }
    cachedPython = "python";
    return cachedPython;
  }

  for (const c of ["python3", "python"]) {
    if (canImportBs4(c)) {
      cachedPython = c;
      return c;
    }
  }
  cachedPython = "python3";
  return cachedPython;
}

export type PythonScriptName =
  | "extract_stream.py"
  | "download_stream.py"
  | "probe_stream.py"
  | "enqueue_job.py";

export function getPythonScript(name: PythonScriptName) {
  const overrideDir = process.env.PYTHON_SCRIPTS_DIR;
  const candidates = [
    overrideDir ? path.join(overrideDir, name) : null,
    path.join(cwd, "python", name),
    path.join(cwd, "scripts", "python", name),
    `/app/python/${name}`,
  ].filter(Boolean) as string[];

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error(
    `Python script not found: ${name}. Looked in: ${candidates.join(", ")}`,
  );
}

export type PythonRunResult = {
  code: number | null;
  stdout: string;
  stderr: string;
};

export function runPython(
  scriptName: PythonScriptName,
  args: string[],
  options?: {
    timeoutMs?: number;
    onStderrLine?: (line: string) => void;
  },
): Promise<PythonRunResult> {
  const binSpec = getPythonBin();
  const script = getPythonScript(scriptName);
  const timeoutMs = options?.timeoutMs ?? 60_000;

  const parts = binSpec.split(/\s+/);
  const command = parts[0]!;
  const prefixArgs = parts.slice(1);

  return new Promise((resolve, reject) => {
    const child = spawn(command, [...prefixArgs, script, ...args], {
      cwd,
      env: process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
      finish(() =>
        reject(
          new Error(
            `Python ${scriptName} timed out after ${Math.round(timeoutMs / 1000)}s`,
          ),
        ),
      );
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      if (options?.onStderrLine) {
        for (const line of text.split(/\r?\n/)) {
          if (line.trim()) options.onStderrLine(line);
        }
      }
    });

    child.on("error", (err) => finish(() => reject(err)));
    child.on("close", (code) => {
      finish(() => resolve({ code, stdout, stderr }));
    });
  });
}

export function parseJsonStdout<T>(stdout: string): T {
  const text = stdout.trim();
  if (!text) throw new Error("Python produced empty stdout");

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const last = lines[lines.length - 1] ?? text;

  try {
    return JSON.parse(last) as T;
  } catch {
    return JSON.parse(text) as T;
  }
}
