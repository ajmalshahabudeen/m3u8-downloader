import fs from "node:fs";
import path from "node:path";
import { getDownloadsDir, sanitizeFileName } from "@/lib/paths";

export type DownloadFileRef = {
  id?: string;
  title?: string | null;
  fileName?: string | null;
  filePath?: string | null;
  cookiePath?: string | null;
};

/**
 * Robustly purges physical files associated with a download record from disk.
 * Cleans up primary output files, cookie files, auxiliary extension files (.part, .ytdl, .aria2, .temp, etc.),
 * and any stream fragment files in the downloads directory.
 */
export function purgeDownloadFiles(download: DownloadFileRef): void {
  const dir = getDownloadsDir();

  // 1. Delete explicit filePath if provided
  if (download.filePath) {
    deleteFileWithAuxiliary(download.filePath);
  }

  // 2. Delete explicit cookiePath if provided
  if (download.cookiePath && fs.existsSync(download.cookiePath)) {
    try {
      fs.unlinkSync(download.cookiePath);
    } catch {
      /* ignore */
    }
  }

  // 3. Collect base file names to search for in downloads directory
  const baseNames = new Set<string>();

  if (download.fileName) {
    const nameWithoutExt = path.parse(download.fileName).name;
    if (nameWithoutExt) baseNames.add(nameWithoutExt);
    baseNames.add(download.fileName);
  }

  if (download.filePath) {
    const parsed = path.parse(download.filePath);
    if (parsed.name) baseNames.add(parsed.name);
  }

  if (download.title) {
    const sanitized = sanitizeFileName(download.title);
    if (sanitized) baseNames.add(sanitized);
  }

  // 4. Scan downloads directory for any matching files or temporary fragments
  if (fs.existsSync(dir)) {
    try {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        for (const base of baseNames) {
          if (!base || base.length < 2) continue;

          // Match exact file, base name with extensions, numbered copies "Base (1).ext", or temp prefixes "Base.part"
          if (
            file === base ||
            file.startsWith(base + ".") ||
            file.startsWith(base + " (") ||
            file.startsWith(base + "_")
          ) {
            const targetPath = path.join(dir, file);
            deleteFileWithAuxiliary(targetPath);
          }
        }
      }
    } catch (err) {
      console.warn("Failed scanning downloads directory during cleanup:", err);
    }
  }
}

/**
 * Purges all leftover or orphaned files in the downloads directory when clearing the whole queue.
 */
export function purgeAllDownloadsDirFiles(): void {
  const dir = getDownloadsDir();
  if (!fs.existsSync(dir)) return;

  try {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      // Keep directory entries or .gitkeep if any, remove files
      const fullPath = path.join(dir, file);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          fs.rmSync(fullPath, { recursive: true, force: true });
        } else {
          fs.unlinkSync(fullPath);
        }
      } catch (err) {
        console.warn("Failed removing file in purgeAllDownloadsDirFiles:", fullPath, err);
      }
    }
  } catch (err) {
    console.warn("Failed purging all downloads directory:", err);
  }
}

/**
 * Safely delete a file and any auxiliary extension variations (.part, .ytdl, .aria2, .temp, .m3u8, .ts, etc.).
 */
function deleteFileWithAuxiliary(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        fs.rmSync(filePath, { recursive: true, force: true });
      } else {
        fs.unlinkSync(filePath);
      }
    }
  } catch (e) {
    console.warn("Failed unlinking file:", filePath, e);
  }

  // Also remove common temporary/partial extensions appended to filePath
  const extensionsToClean = [
    ".part",
    ".ytdl",
    ".aria2",
    ".temp",
    ".tmp",
    ".unconfirmed",
    ".m3u8",
    ".ts",
    ".f137.mp4",
    ".f140.m4a",
    ".f251.webm",
  ];

  for (const ext of extensionsToClean) {
    const tempPath = filePath + ext;
    if (fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath);
      } catch {
        /* ignore */
      }
    }
  }
}
