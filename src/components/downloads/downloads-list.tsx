"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  FiDownload,
  FiRefreshCw,
  FiTrash2,
  FiExternalLink,
} from "react-icons/fi";
import { DownloadStatusBadge } from "@/components/downloads/status-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { fileDownloadUrl } from "@/lib/api";
import { useDownloadStore } from "@/store/download-store";
import type { DownloadRecord } from "@/types/download";

function formatBytes(bytes: number | null) {
  if (!bytes || bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function DownloadsList({
  emptyMessage = "No downloads yet.",
}: {
  emptyMessage?: string;
}) {
  const { downloads, loading, load, remove, retry } = useDownloadStore();

  // Track unselected item IDs so all new/existing items default to checked (selected)
  const [unselectedIds, setUnselectedIds] = useState<Set<string>>(new Set());
  const [isBatchSaving, setIsBatchSaving] = useState(false);

  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      void load();
    }, 2000);
    return () => clearInterval(timer);
  }, [load]);

  const onDelete = async (item: DownloadRecord) => {
    try {
      await remove(item.id);
      toast.success(`Removed “${item.title}”`);
    } catch {
      toast.error("Failed to delete download");
    }
  };

  const onRetry = async (item: DownloadRecord) => {
    try {
      await retry(item.id);
      toast.message(`Retrying “${item.title}”`);
    } catch {
      toast.error("Failed to retry download");
    }
  };

  const toggleItem = (id: string) => {
    setUnselectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectedDownloads = downloads.filter(
    (item) => !unselectedIds.has(item.id)
  );

  const selectedCompletedDownloads = selectedDownloads.filter(
    (item) => item.status === "COMPLETED"
  );

  const allSelected =
    downloads.length > 0 && downloads.every((item) => !unselectedIds.has(item.id));
  const someSelected =
    selectedDownloads.length > 0 && !allSelected;

  const toggleAll = () => {
    if (allSelected) {
      // Unselect all current items
      setUnselectedIds(new Set(downloads.map((item) => item.id)));
    } else {
      // Select all
      setUnselectedIds(new Set());
    }
  };

  const onAutoSaveToDownloads = async () => {
    if (selectedCompletedDownloads.length === 0) {
      toast.error("No completed downloads selected to save.");
      return;
    }

    setIsBatchSaving(true);
    toast.info(`Saving ${selectedCompletedDownloads.length} file(s) to Downloads...`);

    let count = 0;
    for (const item of selectedCompletedDownloads) {
      try {
        const link = document.createElement("a");
        link.href = fileDownloadUrl(item.id);
        if (item.fileName) {
          link.download = item.fileName;
        }
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        count++;

        if (count < selectedCompletedDownloads.length) {
          await new Promise((resolve) => setTimeout(resolve, 350));
        }
      } catch (err) {
        console.error("Failed saving file:", item.title, err);
      }
    }

    setIsBatchSaving(false);
    toast.success(`Triggered download for ${count} file(s)!`);
  };

  if (loading && downloads.length === 0) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (downloads.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-card/60 backdrop-blur shadow-sm">
      {/* Top action bar for batch operations */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/30 px-4 py-3">
        <div className="flex items-center gap-3">
          <Checkbox
            id="select-all-downloads"
            checked={allSelected ? true : someSelected ? "indeterminate" : false}
            onCheckedChange={() => toggleAll()}
            aria-label="Select all downloads"
          />
          <label
            htmlFor="select-all-downloads"
            className="cursor-pointer select-none text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            {selectedDownloads.length} of {downloads.length} selected
          </label>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="default"
            size="sm"
            disabled={isBatchSaving || selectedCompletedDownloads.length === 0}
            onClick={() => void onAutoSaveToDownloads()}
            className="bg-primary text-primary-foreground hover:bg-primary/90 shadow-xs transition-all"
          >
            <FiDownload className={`mr-1.5 h-4 w-4 ${isBatchSaving ? "animate-bounce" : ""}`} />
            {isBatchSaving
              ? "Saving..."
              : `Auto-Save to Downloads (${selectedCompletedDownloads.length})`}
          </Button>
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10 px-4 text-center">
              <Checkbox
                checked={allSelected ? true : someSelected ? "indeterminate" : false}
                onCheckedChange={() => toggleAll()}
                aria-label="Select all"
              />
            </TableHead>
            <TableHead>Title / file</TableHead>
            <TableHead className="hidden md:table-cell">Status</TableHead>
            <TableHead className="w-45">Progress</TableHead>
            <TableHead className="hidden lg:table-cell">Format</TableHead>
            <TableHead className="hidden xl:table-cell">Size</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {downloads.map((item) => {
            const isSelected = !unselectedIds.has(item.id);
            return (
              <TableRow
                key={item.id}
                className={isSelected ? "bg-muted/15" : undefined}
              >
                <TableCell className="w-10 px-4 text-center">
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => toggleItem(item.id)}
                    aria-label={`Select ${item.title}`}
                  />
                </TableCell>
                <TableCell>
                  <div className="flex flex-col gap-1">
                    <span className="font-medium leading-tight">{item.title}</span>
                    <div className="flex flex-wrap gap-1">
                      {item.jobType === "all_video" && (
                        <span className="rounded bg-indigo-500/15 px-1.5 py-0.5 font-mono text-[10px] text-indigo-600 dark:text-indigo-300">
                          all-video
                        </span>
                      )}
                      {item.engine && (
                        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                          {item.engine}
                        </span>
                      )}
                    </div>
                    {item.fileName && (
                      <span className="font-mono text-xs text-muted-foreground">
                        {item.fileName}
                      </span>
                    )}
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex max-w-70 items-center gap-1 truncate text-xs text-muted-foreground hover:text-foreground"
                    >
                      <FiExternalLink className="shrink-0" />
                      {item.url}
                    </a>
                    {item.resolution && (
                      <span className="text-xs text-muted-foreground">
                        Quality: {item.resolution}
                      </span>
                    )}
                    <div className="md:hidden">
                      <DownloadStatusBadge
                        status={item.status}
                        label={item.stageLabel}
                      />
                    </div>
                    {item.error && (
                      <p className="text-xs text-destructive">{item.error}</p>
                    )}
                  </div>
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <div className="space-y-1">
                    <DownloadStatusBadge
                      status={item.status}
                      label={item.stageLabel || item.status}
                    />
                    <p className="text-[11px] capitalize text-muted-foreground">
                      {item.stage?.replace(/_/g, " ")}
                    </p>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="space-y-1">
                    <Progress value={item.progress} className="h-2" />
                    <span className="text-xs text-muted-foreground">
                      {item.stageLabel || "Working"} · {item.progress}%
                    </span>
                  </div>
                </TableCell>
                <TableCell className="hidden font-mono text-xs uppercase text-muted-foreground lg:table-cell">
                  {item.format || "mp4"}
                </TableCell>
                <TableCell className="hidden text-sm text-muted-foreground xl:table-cell">
                  {formatBytes(item.fileSize)}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    {item.status === "COMPLETED" && (
                      <Button variant="ghost" size="icon" asChild title="Save file to downloads">
                        <a
                          href={fileDownloadUrl(item.id)}
                          download={item.fileName || undefined}
                        >
                          <FiDownload className="h-4 w-4" />
                        </a>
                      </Button>
                    )}
                    {item.status === "FAILED" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => void onRetry(item)}
                        title="Retry download"
                      >
                        <FiRefreshCw className="h-4 w-4" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => void onDelete(item)}
                      title="Delete entry"
                    >
                      <FiTrash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

