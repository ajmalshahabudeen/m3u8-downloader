"use client";

import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion, AnimatePresence } from "motion/react";
import axios from "axios";
import { toast } from "sonner";
import {
  HiOutlineSearch,
  HiOutlineDownload,
  HiOutlineCollection,
  HiOutlineCheckCircle,
} from "react-icons/hi";
import {
  Loader2,
  Play,
  Clock,
  User,
  CheckSquare,
  Square,
  Sparkles,
  ArrowDownToLine,
  ListVideo,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { FormatSelect } from "@/components/downloads/format-resolution-fields";
import { useDownloadStore } from "@/store/download-store";
import type { OutputFormat } from "@/types/download";
import type {
  YouTubePlaylistAnalyzeResult,
  YouTubePlaylistItem,
} from "@/app/api/youtube-playlist/analyze/route";

const formSchema = z.object({
  url: z.string().trim().url("Enter a valid YouTube playlist or video URL"),
});

type FormValues = z.infer<typeof formSchema>;

const QUALITIES = [
  { value: "best", label: "Best available" },
  { value: "1080", label: "≤ 1080p Full HD" },
  { value: "720", label: "≤ 720p HD" },
  { value: "480", label: "≤ 480p SD" },
  { value: "360", label: "≤ 360p" },
  { value: "worst", label: "Audio Only / Smallest" },
] as const;

function formatSeconds(secs?: number | null): string {
  if (!secs || secs <= 0) return "--:--";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function YouTubePlaylistForm() {
  const setDownloads = useDownloadStore((s) => s.setDownloads);
  const downloads = useDownloadStore((s) => s.downloads);

  const [analyzing, setAnalyzing] = useState(false);
  const [queuing, setQueuing] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [playlistResult, setPlaylistResult] =
    useState<YouTubePlaylistAnalyzeResult | null>(null);

  // Download Options
  const [format, setFormat] = useState<OutputFormat>("mp4");
  const [quality, setQuality] = useState("best");
  const [referer, setReferer] = useState("");
  const [cookies, setCookies] = useState("");

  // Search & Selection
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [queuedItemIds, setQueuedItemIds] = useState<Set<string>>(new Set());

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { url: "" },
  });

  const progressHint = useMemo(() => {
    if (!analyzing) return "";
    if (elapsed < 3) return "Fetching YouTube playlist structure…";
    if (elapsed < 8) return "Extracting video titles & video IDs…";
    if (elapsed < 20) return "Parsing large playlist entries…";
    return "Analyzing playlist items — hang tight…";
  }, [analyzing, elapsed]);

  async function onAnalyze(values: FormValues) {
    setAnalyzing(true);
    setPlaylistResult(null);
    setSearchQuery("");
    setSelectedIds(new Set());
    setQueuedItemIds(new Set());
    setElapsed(0);

    const timer = window.setInterval(() => {
      setElapsed((prev) => prev + 1);
    }, 1000);

    try {
      const { data } = await axios.post(
        "/api/youtube-playlist/analyze",
        {
          url: values.url,
          referer: referer.trim() || undefined,
          cookies: cookies.trim() || undefined,
        },
        { timeout: 150_000 },
      );

      const result = data.result as YouTubePlaylistAnalyzeResult;
      setPlaylistResult(result);

      if (result.videos && result.videos.length > 0) {
        // Select all by default
        const allIds = new Set(
          result.videos
            .map((v) => v.id || v.url)
            .filter(Boolean) as string[],
        );
        setSelectedIds(allIds);
        toast.success(
          `Found ${result.videos.length} video${result.videos.length === 1 ? "" : "s"} in playlist`,
        );
      } else {
        toast.error("No videos found in this playlist");
      }
    } catch (error) {
      const msg = axios.isAxiosError(error)
        ? (error.response?.data as { error?: string; detail?: string })?.detail ||
          (error.response?.data as { error?: string })?.error ||
          error.message
        : error instanceof Error
          ? error.message
          : "Playlist analyze failed";
      toast.error(msg);
    } finally {
      window.clearInterval(timer);
      setAnalyzing(false);
    }
  }

  // Filtered list based on search query
  const filteredVideos = useMemo(() => {
    if (!playlistResult?.videos) return [];
    if (!searchQuery.trim()) return playlistResult.videos;
    const q = searchQuery.toLowerCase().trim();
    return playlistResult.videos.filter(
      (v) =>
        v.title.toLowerCase().includes(q) ||
        (v.uploader && v.uploader.toLowerCase().includes(q)),
    );
  }, [playlistResult, searchQuery]);

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredVideos.length) {
      setSelectedIds(new Set());
    } else {
      const newSet = new Set(
        filteredVideos.map((v) => v.id || v.url).filter(Boolean) as string[],
      );
      setSelectedIds(newSet);
    }
  };

  const toggleSelectItem = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedIds(next);
  };

  // Queue a single video
  async function downloadSingleVideo(item: YouTubePlaylistItem) {
    const key = item.id || item.url;
    setQueuing(true);
    try {
      const { data } = await axios.post(
        "/api/all-video",
        {
          url: item.url,
          title: item.title,
          format,
          quality,
          engine: "auto",
          referer: referer.trim() || undefined,
          cookies: cookies.trim() || undefined,
        },
        { timeout: 60_000 },
      );

      if (data.download) {
        setDownloads([
          data.download,
          ...downloads.filter((d) => d.id !== data.download.id),
        ]);
      }
      setQueuedItemIds((prev) => new Set([...prev, key]));
      toast.success(`Queued: "${item.title}"`);
    } catch (error) {
      const msg = axios.isAxiosError(error)
        ? (error.response?.data as { error?: string })?.error || error.message
        : error instanceof Error
          ? error.message
          : "Queue failed";
      toast.error(msg);
    } finally {
      setQueuing(false);
    }
  }

  // Queue all selected videos sequentially
  async function downloadSelectedVideos() {
    if (!playlistResult?.videos) return;

    const itemsToQueue = playlistResult.videos.filter((v) =>
      selectedIds.has(v.id || v.url),
    );

    if (itemsToQueue.length === 0) {
      toast.error("Please select at least one video to download");
      return;
    }

    setQueuing(true);
    try {
      const batchPayload = {
        items: itemsToQueue.map((item) => ({
          url: item.url,
          title: item.title,
          format,
          quality,
          engine: "auto",
        })),
        referer: referer.trim() || undefined,
        cookies: cookies.trim() || undefined,
      };

      const { data } = await axios.post(
        "/api/youtube-playlist/batch-queue",
        batchPayload,
        { timeout: 90_000 },
      );

      if (Array.isArray(data.downloads)) {
        setDownloads([
          ...data.downloads,
          ...downloads.filter(
            (d) => !data.downloads.some((newD: { id: string }) => newD.id === d.id),
          ),
        ]);
      }

      const newlyQueuedKeys = new Set(
        itemsToQueue.map((v) => v.id || v.url).filter(Boolean) as string[],
      );
      setQueuedItemIds((prev) => new Set([...prev, ...newlyQueuedKeys]));

      toast.success(
        `Successfully queued ${itemsToQueue.length} video${itemsToQueue.length === 1 ? "" : "s"} — server will download one by one automatically`,
      );
    } catch (error) {
      const msg = axios.isAxiosError(error)
        ? (error.response?.data as { error?: string })?.error || error.message
        : error instanceof Error
          ? error.message
          : "Batch queue failed";
      toast.error(msg);
    } finally {
      setQueuing(false);
    }
  }

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <Card className="border-border/60 bg-card/70 backdrop-blur">
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="flex items-center gap-2 text-xl">
                <ListVideo className="h-5 w-5 text-red-500" />
                YouTube Playlist Downloader
              </CardTitle>
              <Badge variant="destructive" className="bg-red-600 text-white hover:bg-red-700">
                YouTube
              </Badge>
              <Badge variant="secondary">Flat Extract · Auto Sequential Queue</Badge>
            </div>
            <CardDescription>
              Paste any YouTube <strong>playlist</strong> link (or channel videos list).
              All video names will be extracted automatically so you can download individual
              videos or auto-download the full playlist sequentially.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <form onSubmit={handleSubmit(onAnalyze)} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="yt-url">YouTube Playlist URL</Label>
                <Input
                  id="yt-url"
                  placeholder="https://www.youtube.com/playlist?list=PL... or https://www.youtube.com/watch?v=...&list=PL..."
                  disabled={analyzing || queuing}
                  {...register("url")}
                />
                {errors.url && (
                  <p className="text-sm text-destructive">{errors.url.message}</p>
                )}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <FormatSelect
                  value={format}
                  onChange={(v) => setFormat(v as OutputFormat)}
                  id="yt-format"
                />

                <div className="space-y-2">
                  <Label htmlFor="yt-quality">Quality</Label>
                  <Select
                    value={quality}
                    onValueChange={setQuality}
                    disabled={analyzing || queuing}
                  >
                    <SelectTrigger id="yt-quality" className="w-full">
                      <SelectValue placeholder="Quality" />
                    </SelectTrigger>
                    <SelectContent>
                      {QUALITIES.map((q) => (
                        <SelectItem key={q.value} value={q.value}>
                          {q.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="yt-referer">Referer (optional)</Label>
                  <Input
                    id="yt-referer"
                    value={referer}
                    onChange={(e) => setReferer(e.target.value)}
                    placeholder="https://www.youtube.com"
                    disabled={analyzing || queuing}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="yt-cookies">cookies.txt (optional)</Label>
                  <Textarea
                    id="yt-cookies"
                    value={cookies}
                    onChange={(e) => setCookies(e.target.value)}
                    placeholder="# Netscape HTTP Cookie File&#10;for private / age-gated playlists"
                    className="min-h-10.5 font-mono text-xs"
                    disabled={analyzing || queuing}
                  />
                </div>
              </div>

              {analyzing && (
                <div className="space-y-2 rounded-lg border border-border/60 bg-muted/30 p-4">
                  <div className="flex items-center gap-2 text-sm">
                    <Loader2 className="h-4 w-4 animate-spin text-red-500" />
                    <span className="font-medium">{progressHint}</span>
                    <span className="ml-auto font-mono text-xs text-muted-foreground">
                      {elapsed}s
                    </span>
                  </div>
                  <Progress value={Math.min(95, 10 + elapsed * 5)} className="h-1.5" />
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Button
                  type="submit"
                  disabled={analyzing || queuing}
                  className="bg-red-600 text-white hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-700"
                >
                  {analyzing ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Analyzing Playlist…
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-2 h-4 w-4" />
                      Analyze Playlist
                    </>
                  )}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </motion.div>

      {playlistResult && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
          <Card className="border-border/60 bg-card/70 backdrop-blur">
            <CardHeader className="pb-4">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <HiOutlineCollection className="h-5 w-5 text-red-500" />
                    <CardTitle className="text-xl font-bold">
                      {playlistResult.title || "YouTube Playlist"}
                    </CardTitle>
                  </div>
                  <CardDescription className="flex flex-wrap items-center gap-3 text-xs">
                    {playlistResult.uploader && (
                      <span className="flex items-center gap-1">
                        <User className="h-3.5 w-3.5" />
                        {playlistResult.uploader}
                      </span>
                    )}
                    <span className="flex items-center gap-1 font-semibold text-foreground">
                      <ListVideo className="h-3.5 w-3.5" />
                      {playlistResult.playlistCount || filteredVideos.length} videos found
                    </span>
                  </CardDescription>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <Label htmlFor="yt-results-quality" className="text-xs text-muted-foreground">
                      Quality:
                    </Label>
                    <Select
                      value={quality}
                      onValueChange={setQuality}
                      disabled={queuing}
                    >
                      <SelectTrigger id="yt-results-quality" className="h-9 w-37.5 text-xs">
                        <SelectValue placeholder="Quality" />
                      </SelectTrigger>
                      <SelectContent>
                        {QUALITIES.map((q) => (
                          <SelectItem key={q.value} value={q.value} className="text-xs">
                            {q.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <Button
                    type="button"
                    onClick={downloadSelectedVideos}
                    disabled={queuing || selectedIds.size === 0}
                    className="bg-red-600 text-white hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-700"
                  >
                    {queuing ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Queuing {selectedIds.size} Videos…
                      </>
                    ) : (
                      <>
                        <ArrowDownToLine className="mr-2 h-4 w-4" />
                        Download {selectedIds.size} Selected ({QUALITIES.find((q) => q.value === quality)?.label || quality})
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </CardHeader>

            <CardContent className="space-y-4">
              {/* Filter bar and select toggle */}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-t pt-4">
                <div className="relative flex-1 max-w-sm">
                  <HiOutlineSearch className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search video titles…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9 text-xs"
                  />
                </div>

                <div className="flex items-center gap-3 text-xs">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={toggleSelectAll}
                    className="h-8 gap-1.5 text-xs"
                  >
                    {selectedIds.size === filteredVideos.length && filteredVideos.length > 0 ? (
                      <>
                        <CheckSquare className="h-3.5 w-3.5 text-red-500" />
                        Deselect All ({filteredVideos.length})
                      </>
                    ) : (
                      <>
                        <Square className="h-3.5 w-3.5" />
                        Select All ({filteredVideos.length})
                      </>
                    )}
                  </Button>

                  <span className="text-muted-foreground">
                    Selected: <strong>{selectedIds.size}</strong> / {filteredVideos.length}
                  </span>
                </div>
              </div>

              {/* Videos list */}
              <div className="space-y-2 max-h-150 overflow-y-auto pr-1">
                <AnimatePresence>
                  {filteredVideos.map((video, idx) => {
                    const key = video.id || video.url;
                    const isSelected = selectedIds.has(key);
                    const isQueued = queuedItemIds.has(key);

                    return (
                      <motion.div
                        key={key + idx}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className={`flex flex-col sm:flex-row sm:items-center gap-3 rounded-lg border p-3 transition-colors ${
                          isSelected
                            ? "border-red-500/40 bg-red-500/5 dark:bg-red-500/10"
                            : "border-border/60 bg-muted/20 hover:bg-muted/40"
                        }`}
                      >
                        {/* Checkbox */}
                        <div className="flex items-center gap-3 shrink-0">
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleSelectItem(key)}
                            id={`check-${key}`}
                          />
                          <span className="w-6 font-mono text-xs font-semibold text-muted-foreground">
                            #{video.index || idx + 1}
                          </span>
                        </div>

                        {/* Thumbnail */}
                        <div className="relative h-16 w-28 shrink-0 overflow-hidden rounded border bg-slate-950">
                          {video.thumbnail ? (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img
                              src={video.thumbnail}
                              alt={video.title}
                              className="h-full w-full object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                              <Play className="h-6 w-6" />
                            </div>
                          )}
                          {video.duration && (
                            <span className="absolute bottom-1 right-1 rounded bg-black/80 px-1 py-0.5 font-mono text-[10px] text-white">
                              {formatSeconds(video.duration)}
                            </span>
                          )}
                        </div>

                        {/* Title & info */}
                        <div className="min-w-0 flex-1 space-y-1">
                          <a
                            href={video.url}
                            target="_blank"
                            rel="noreferrer"
                            className="block font-medium text-sm text-foreground hover:text-red-500 line-clamp-2 transition-colors"
                            title={video.title}
                          >
                            {video.title}
                          </a>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            {video.uploader && (
                              <span className="flex items-center gap-1">
                                <User className="h-3 w-3" />
                                {video.uploader}
                              </span>
                            )}
                            {video.duration && (
                              <span className="flex items-center gap-1 font-mono">
                                <Clock className="h-3 w-3" />
                                {formatSeconds(video.duration)}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-2 shrink-0 sm:ml-auto">
                          {isQueued ? (
                            <Badge
                              variant="secondary"
                              className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 gap-1"
                            >
                              <HiOutlineCheckCircle className="h-3.5 w-3.5" />
                              Queued
                            </Badge>
                          ) : (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={queuing}
                              onClick={() => downloadSingleVideo(video)}
                              className="h-8 gap-1 text-xs hover:border-red-500 hover:text-red-500"
                            >
                              <HiOutlineDownload className="h-3.5 w-3.5" />
                              Download
                            </Button>
                          )}
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>

                {filteredVideos.length === 0 && (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    No videos matched standard search filter.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}
    </div>
  );
}
