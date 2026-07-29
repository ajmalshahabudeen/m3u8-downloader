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
  jobType: string;
  engine: string | null;
  extractor: string | null;
  playlist: boolean;
  ytdlpFormat: string | null;
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
  jobType?: string | null;
  engine?: string | null;
  extractor?: string | null;
  playlist?: boolean | null;
  ytdlpFormat?: string | null;
  cookiePath?: string | null;
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
    jobType: download.jobType ?? "hls",
    engine: download.engine ?? null,
    extractor: download.extractor ?? null,
    playlist: Boolean(download.playlist),
    ytdlpFormat: download.ytdlpFormat ?? null,
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
  segmentCount?: number;
  durationSec?: number | null;
};

export type ProbeResult = {
  url: string;
  isMaster: boolean;
  variants: StreamVariant[];
  warnings: string[];
  segmentCount?: number;
  durationSec?: number | null;
};

export type AllVideoAnalyzeResult = {
  ok: boolean;
  url?: string;
  title?: string | null;
  engine?: string | null;
  extractor?: string | null;
  isPlaylist?: boolean;
  playlistCount?: number;
  duration?: number | null;
  thumbnail?: string | null;
  formats?: Array<{
    id?: string | null;
    label?: string;
    height?: number | null;
    ext?: string | null;
    resolution?: string | null;
    tbr?: number | null;
    note?: string | null;
    url?: string;
  }>;
  classification?: {
    engine?: string;
    confidence?: number;
    reason?: string;
    needs_cookies?: boolean;
    is_drm_likely?: boolean;
    blocked?: boolean;
    error_code?: string | null;
    ai?: { used?: boolean; model?: string; reason?: string; error?: string };
  };
  warnings?: string[];
  disclaimer?: string;
  error?: string;
  error_code?: string;
  resolvedUrl?: string;
};
