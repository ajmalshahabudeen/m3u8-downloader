import { Badge } from "@/components/ui/badge";
import type { DownloadStatus } from "@/types/download";
import { cn } from "@/lib/utils";

const styles: Record<DownloadStatus, { className: string }> = {
  PENDING: {
    className:
      "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
  },
  PROBING: {
    className:
      "bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30",
  },
  EXTRACTING: {
    className:
      "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-500/30",
  },
  DOWNLOADING: {
    className: "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30",
  },
  COMBINING: {
    className:
      "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/30",
  },
  CONVERTING: {
    className:
      "bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300 border-fuchsia-500/30",
  },
  FINALIZING: {
    className:
      "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30",
  },
  COMPLETED: {
    className:
      "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  },
  FAILED: {
    className: "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30",
  },
};

export function DownloadStatusBadge({
  status,
  label,
}: {
  status: DownloadStatus;
  label?: string | null;
}) {
  const cfg = styles[status] ?? styles.PENDING;
  return (
    <Badge variant="outline" className={cn("font-medium", cfg.className)}>
      {label || status.replace(/_/g, " ")}
    </Badge>
  );
}
