import fs from "node:fs";
import path from "node:path";
import { formatMeta } from "@/types/download";

export function getDownloadsDir() {
  const dir =
    process.env.DOWNLOADS_DIR ??
    path.join(/* turbopackIgnore: true */ process.cwd(), "downloads");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Keep the user title as the filename — no IDs appended. */
export function sanitizeFileName(title: string) {
  const base = title
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .replace(/^\.+/, "")
    .slice(0, 180);

  return base.length > 0 ? base : "video";
}

/**
 * Build output path using title + format extension only.
 * If the file already exists, append " (1)", " (2)", … before the extension.
 */
export function buildOutputPath(title: string, format: string) {
  const meta = formatMeta(format);
  const base = sanitizeFileName(title);
  const dir = getDownloadsDir();

  let fileName = `${base}.${meta.ext}`;
  let filePath = path.join(dir, fileName);
  let n = 1;
  while (fs.existsSync(filePath)) {
    fileName = `${base} (${n}).${meta.ext}`;
    filePath = path.join(dir, fileName);
    n += 1;
    if (n > 9999) break;
  }

  return { fileName, filePath };
}
