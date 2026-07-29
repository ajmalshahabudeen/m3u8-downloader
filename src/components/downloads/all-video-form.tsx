"use client";

import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion } from "motion/react";
import axios from "axios";
import { toast } from "sonner";
import {
  HiOutlineGlobeAlt,
  HiOutlineShieldExclamation,
  HiOutlineSparkles,
} from "react-icons/hi";
import { Loader2 } from "lucide-react";
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
import type { AllVideoAnalyzeResult, OutputFormat } from "@/types/download";

const formSchema = z.object({
  url: z.string().trim().url("Enter a valid http(s) URL"),
});

type FormValues = z.infer<typeof formSchema>;

const QUALITIES = [
  { value: "best", label: "Best available" },
  { value: "1080", label: "≤ 1080p" },
  { value: "720", label: "≤ 720p" },
  { value: "480", label: "≤ 480p" },
  { value: "360", label: "≤ 360p" },
  { value: "worst", label: "Worst (smallest)" },
] as const;

const ENGINES = [
  { value: "auto", label: "Auto (recommended)" },
  { value: "ytdlp", label: "yt-dlp" },
  { value: "ffmpeg", label: "ffmpeg / HLS" },
  { value: "direct", label: "Direct HTTP" },
  { value: "extract_hls", label: "Page extract → HLS" },
] as const;

export function AllVideoForm() {
  const setDownloads = useDownloadStore((s) => s.setDownloads);
  const downloads = useDownloadStore((s) => s.downloads);
  const [analyzing, setAnalyzing] = useState(false);
  const [queuing, setQueuing] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [analysis, setAnalysis] = useState<AllVideoAnalyzeResult | null>(null);
  const [title, setTitle] = useState("");
  const [format, setFormat] = useState<OutputFormat>("mp4");
  const [quality, setQuality] = useState("best");
  const [engine, setEngine] = useState("auto");
  const [playlist, setPlaylist] = useState(false);
  const [referer, setReferer] = useState("");
  const [cookies, setCookies] = useState("");
  const [useAi, setUseAi] = useState(true);
  const [ytdlpFormat, setYtdlpFormat] = useState("");

  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { url: "" },
  });

  const progressHint = useMemo(() => {
    if (!analyzing) return "";
    if (elapsed < 3) return "Classifying URL…";
    if (elapsed < 10) return "Probing extractors (yt-dlp / HLS)…";
    if (elapsed < 30) return "Still working — site metadata can be slow…";
    return "Deep analyze — hang tight…";
  }, [analyzing, elapsed]);

  async function onAnalyze(values: FormValues) {
    setAnalyzing(true);
    setAnalysis(null);
    setElapsed(0);
    const started = Date.now();
    const timer = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - started) / 1000));
    }, 250);
    try {
      const { data } = await axios.post(
        "/api/all-video/analyze",
        {
          url: values.url,
          referer: referer.trim() || undefined,
          cookies: cookies.trim() || undefined,
          useAi,
        },
        { timeout: 150_000 },
      );
      const result = data.result as AllVideoAnalyzeResult;
      setAnalysis(result);
      if (result.title) setTitle(result.title);
      if (result.engine && result.engine !== "none") {
        setEngine(result.engine === "extract_hls" ? "auto" : result.engine);
      }
      if (!result.ok) {
        toast.error(result.error || "Could not analyze URL");
      } else {
        toast.success("Analysis complete");
      }
    } catch (error) {
      const msg = axios.isAxiosError(error)
        ? (error.response?.data as { error?: string; detail?: string })?.detail ||
          (error.response?.data as { error?: string })?.error ||
          error.message
        : error instanceof Error
          ? error.message
          : "Analyze failed";
      toast.error(msg);
    } finally {
      window.clearInterval(timer);
      setAnalyzing(false);
    }
  }

  async function onQueue() {
    const url = getValues("url")?.trim();
    if (!url) {
      toast.error("Enter a URL first");
      return;
    }
    if (analysis && analysis.ok === false && analysis.classification?.blocked) {
      toast.error(analysis.error || "This URL is blocked");
      return;
    }
    setQueuing(true);
    try {
      const { data } = await axios.post(
        "/api/all-video",
        {
          url,
          title: title.trim() || analysis?.title || "All video download",
          format,
          quality,
          engine,
          playlist,
          referer: referer.trim() || undefined,
          cookies: cookies.trim() || undefined,
          ytdlpFormat: ytdlpFormat.trim() || undefined,
        },
        { timeout: 60_000 },
      );
      if (data.download) {
        setDownloads([data.download, ...downloads.filter((d) => d.id !== data.download.id)]);
      }
      toast.success("Queued on worker pool");
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

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <Card className="border-border/60 bg-card/70 backdrop-blur">
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="flex items-center gap-2 text-xl">
                <HiOutlineGlobeAlt className="h-5 w-5" />
                All-video downloader
              </CardTitle>
              <Badge variant="secondary">yt-dlp · HLS · direct</Badge>
            </div>
            <CardDescription>
              Paste any <strong>public</strong> page or media URL (YouTube, X/Twitter,
              Vimeo, direct MP4, m3u8, …). DRM services (Netflix, Crunchyroll, …) are
              blocked on purpose.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <form onSubmit={handleSubmit(onAnalyze)} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="av-url">Public video or page URL</Label>
                <Input
                  id="av-url"
                  placeholder="https://www.youtube.com/watch?v=… or https://x.com/…/status/…"
                  disabled={analyzing || queuing}
                  {...register("url")}
                />
                {errors.url && (
                  <p className="text-sm text-destructive">{errors.url.message}</p>
                )}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="av-referer">Referer (optional)</Label>
                  <Input
                    id="av-referer"
                    value={referer}
                    onChange={(e) => setReferer(e.target.value)}
                    placeholder="https://example.com/watch/1"
                    disabled={analyzing || queuing}
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="av-use-ai"
                      checked={useAi}
                      onCheckedChange={(v) => setUseAi(v === true)}
                      disabled={analyzing || queuing}
                    />
                    <Label
                      htmlFor="av-use-ai"
                      className="inline-flex cursor-pointer items-center gap-2 font-normal"
                    >
                      <HiOutlineSparkles className="h-4 w-4" />
                      AI assist when unsure
                    </Label>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Uses CLASSIFY_AI_URL/KEY if configured; otherwise rules only.
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="av-cookies">cookies.txt (optional, Netscape format)</Label>
                <Textarea
                  id="av-cookies"
                  value={cookies}
                  onChange={(e) => setCookies(e.target.value)}
                  placeholder="# Netscape HTTP Cookie File&#10;…"
                  className="min-h-24 font-mono text-xs"
                  disabled={analyzing || queuing}
                />
                <p className="text-xs text-muted-foreground">
                  For age-gates / login walls — use <em>your</em> browser export only.
                  Stored under data/cookies for this job.
                </p>
              </div>

              {analyzing && (
                <div className="space-y-2 rounded-lg border border-border/60 bg-muted/30 p-4">
                  <div className="flex items-center gap-2 text-sm">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="font-medium">{progressHint}</span>
                    <span className="ml-auto font-mono text-xs text-muted-foreground">
                      {elapsed}s
                    </span>
                  </div>
                  <Progress value={Math.min(95, 8 + elapsed * 3)} className="h-1.5" />
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={analyzing || queuing}>
                  {analyzing ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Analyzing…
                    </>
                  ) : (
                    "Analyze"
                  )}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </motion.div>

      {analysis && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="border-border/60 bg-card/70 backdrop-blur">
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-lg">Result</CardTitle>
                <Badge variant={analysis.ok ? "secondary" : "destructive"}>
                  {analysis.ok ? "ready" : "blocked / failed"}
                </Badge>
                {analysis.engine && (
                  <Badge variant="outline" className="font-mono text-xs">
                    engine: {analysis.engine}
                  </Badge>
                )}
                {analysis.extractor && (
                  <Badge variant="outline" className="font-mono text-xs">
                    {analysis.extractor}
                  </Badge>
                )}
                {analysis.classification?.confidence != null && (
                  <Badge variant="outline" className="font-mono text-xs">
                    conf {(analysis.classification.confidence * 100).toFixed(0)}%
                  </Badge>
                )}
              </div>
              <CardDescription className="space-y-1">
                {analysis.classification?.reason && (
                  <span className="block text-xs">
                    {analysis.classification.reason}
                  </span>
                )}
                {analysis.disclaimer && (
                  <span className="flex items-start gap-1 text-xs text-amber-600 dark:text-amber-400">
                    <HiOutlineShieldExclamation className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {analysis.disclaimer}
                  </span>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {!analysis.ok && (
                <p className="text-sm text-destructive">
                  {analysis.error || "Unsupported URL"}
                </p>
              )}

              <div className="space-y-2">
                <Label htmlFor="av-title">File name (title)</Label>
                <Input
                  id="av-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Video title"
                  disabled={queuing}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <FormatSelect
                  value={format}
                  onChange={(v) => setFormat(v as OutputFormat)}
                  id="av-format"
                />
                <div className="space-y-2">
                  <Label htmlFor="av-quality">Quality</Label>
                  <Select
                    value={quality}
                    onValueChange={setQuality}
                    disabled={queuing}
                  >
                    <SelectTrigger id="av-quality" className="w-full">
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
                  <Label htmlFor="av-engine">Engine</Label>
                  <Select
                    value={engine}
                    onValueChange={setEngine}
                    disabled={queuing}
                  >
                    <SelectTrigger id="av-engine" className="w-full">
                      <SelectValue placeholder="Engine" />
                    </SelectTrigger>
                    <SelectContent>
                      {ENGINES.map((e) => (
                        <SelectItem key={e.value} value={e.value}>
                          {e.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2 pt-6">
                    <Checkbox
                      id="av-playlist"
                      checked={playlist}
                      onCheckedChange={(v) => setPlaylist(v === true)}
                      disabled={queuing}
                    />
                    <Label
                      htmlFor="av-playlist"
                      className="cursor-pointer font-normal leading-snug"
                    >
                      Download full playlist (if URL is a playlist)
                    </Label>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="av-ytdlp">Custom yt-dlp format (optional)</Label>
                <Input
                  id="av-ytdlp"
                  value={ytdlpFormat}
                  onChange={(e) => setYtdlpFormat(e.target.value)}
                  placeholder="e.g. bv*[height<=720]+ba/b"
                  className="font-mono text-xs"
                  disabled={queuing}
                />
              </div>

              {analysis.formats && analysis.formats.length > 0 && (
                <div className="space-y-2">
                  <Label>Detected formats (info)</Label>
                  <div className="max-h-40 overflow-auto rounded-md border p-2 font-mono text-xs">
                    {analysis.formats.slice(0, 15).map((f, i) => (
                      <div key={i} className="truncate text-muted-foreground">
                        {f.label || f.id || "format"}
                        {f.height ? ` · ${f.height}p` : ""}
                        {f.ext ? ` · ${f.ext}` : ""}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(analysis.warnings || []).length > 0 && (
                <ul className="list-inside list-disc text-xs text-muted-foreground">
                  {analysis.warnings!.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              )}

              <Button
                type="button"
                onClick={() => void onQueue()}
                disabled={queuing || analyzing || analysis.classification?.blocked}
              >
                {queuing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Queuing…
                  </>
                ) : (
                  "Queue download"
                )}
              </Button>
            </CardContent>
          </Card>
        </motion.div>
      )}
    </div>
  );
}
