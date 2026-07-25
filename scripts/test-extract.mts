import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import path from "node:path";

const root = process.cwd();
const script = path.join(root, "python", "extract_stream.py");

function resolvePython() {
  if (process.env.PYTHON_BIN) return process.env.PYTHON_BIN.split(/\s+/);
  if (process.platform === "win32") {
    const py = spawnSync("py", ["-3", "-c", "import bs4,requests"], {
      encoding: "utf8",
      windowsHide: true,
    });
    if (py.status === 0) return ["py", "-3"];
  }
  return [process.platform === "win32" ? "python" : "python3"];
}

function runExtract(url: string) {
  const py = resolvePython();
  const r = spawnSync(py[0]!, [...py.slice(1), script, "--url", url], {
    encoding: "utf8",
    cwd: root,
    windowsHide: true,
  });
  if (r.error) throw r.error;
  const line = (r.stdout || "").trim().split(/\r?\n/).filter(Boolean).pop();
  if (!line) throw new Error(r.stderr || "no stdout");
  return JSON.parse(line);
}

async function main() {
  const direct = runExtract(
    "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
  );
  console.log("direct", JSON.stringify(direct));

  const html = `<!doctype html><html><head>
    <title>Demo Video | Site</title>
    <meta property="og:title" content="OG Demo Stream" />
  </head><body>
    <script>var u="https://cdn.example.com/path/master.m3u8?token=abc";</script>
  </body></html>`;

  const server = createServer((_req, res) => {
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(html);
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no port");
  const scraped = runExtract(`http://127.0.0.1:${addr.port}/watch`);
  console.log("html", JSON.stringify(scraped, null, 2));
  server.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
