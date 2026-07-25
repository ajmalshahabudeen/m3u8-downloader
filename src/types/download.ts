export const OUTPUT_FORMATS = [
  { value: "mp4", label: "MP4", ext: "mp4", mime: "video/mp4" },
  { value: "mkv", label: "MKV", ext: "mkv", mime: "video/x-matroska" },
  { value: "ts", label: "TS (MPEG-TS)", ext: "ts", mime: "video/mp2t" },
  { value: "webm", label: "WebM", ext: "webm", mime: "video/webm" },
  { value: "mov", label: "MOV", ext: "mov", mime: "video/quicktime" },
  { value: "mp3", label: "MP3 (audio)", ext: "mp3", mime: "audio/mpeg" },
  { value: "m4a", label: "M4A (audio)", ext: "m4a", mime: "audio/mp4" },
] as const;

export type OutputFormat = (typeof OUTPUT_FORMATS)[number]["value"];

export function formatMeta(format: string) {
  return (
    OUTPUT_FORMATS.find((f) => f.value === format) ?? OUTPUT_FORMATS[0]
  );
}

export type DownloadStatus =
  | "PENDING"
  | "PROBING"
  | "EXTRACTING"
  | "DOWNLOADING"
  | "COMBINING"
  | "CONVERTING"
  | "FINALIZING"
  | "COMPLETED"
  | "FAILED";

export interface DownloadRecord {
  id: string;
  title: string;
  url: string;
  referer: string | null;
  format: string;
  resolution: string | null;
  status: DownloadStatus;
  stage: string;
  stageLabel: string;
  progress: number;
  fileName: string | null;
  filePath: string | null;
  error: string | null;
  fileSize: number | null;
  createdAt: string;
  updatedAt: string;
}

export function serializeDownload(download: {
  id: string;
  title: string;
  url: string;
  referer?: string | null;
  format: string;
  resolution: string | null;
  status: DownloadStatus;
  stage: string;
  stageLabel: string;
  progress: number;
  fileName: string | null;
  filePath: string | null;
  error: string | null;
  fileSize: number | null;
  createdAt: Date;
  updatedAt: Date;
}): DownloadRecord {
  return {
    id: download.id,
    title: download.title,
    url: download.url,
    referer: download.referer ?? null,
    format: download.format,
    resolution: download.resolution,
    status: download.status,
    stage: download.stage,
    stageLabel: download.stageLabel,
    progress: download.progress,
    fileName: download.fileName,
    filePath: download.filePath,
    error: download.error,
    fileSize: download.fileSize,
    createdAt: download.createdAt.toISOString(),
    updatedAt: download.updatedAt.toISOString(),
  };
}

export type StreamVariant = {
  id: string;
  url: string;
  bandwidth?: number | null;
  resolution?: string | null;
  codecs?: string | null;
  label: string;
};

export type ProbeResult = {
  url: string;
  isMaster: boolean;
  variants: StreamVariant[];
  warnings: string[];
};
