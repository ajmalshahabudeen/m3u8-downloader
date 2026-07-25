"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion } from "motion/react";
import { toast } from "sonner";
import { HiOutlineLink, HiOutlineSearchCircle } from "react-icons/hi";
import { FiCheck, FiCopy, FiDownload } from "react-icons/fi";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/lib/api";
import { useDownloadStore } from "@/store/download-store";
import type { ExtractResult } from "@/types/extract";
import type { ProbeResult } from "@/types/download";
import {
  FormatSelect,
  ResolutionPicker,
} from "@/components/downloads/format-resolution-fields";

const schema = z.object({
  url: z.string().trim().url("Enter a valid video page or m3u8 URL"),
});

type FormValues = z.infer<typeof schema>;

export function ExtractForm() {
  const addOne = useDownloadStore((s) => s.addOne);
  const [result, setResult] = useState<ExtractResult | null>(null);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [format, setFormat] = useState("mp4");
  const [deepMode, setDeepMode] = useState(true);
  const [extracting, setExtracting] = useState(false);
  const [probing, setProbing] = useState(false);
  const [queuing, setQueuing] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { url: "" },
  });

  const onExtract = async (values: FormValues) => {
    setExtracting(true);
    setResult(null);
    setProbe(null);
    setSelected(null);
    try {
      // Server-side extract (Python + optional Playwright) — never browser fetch (CORS)
      const { data } = await api.post<{ result: ExtractResult }>(
        "/extract",
        {
          url: values.url,
          deep: deepMode,
        },
        { timeout: deepMode ? 120_000 : 45_000 },
      );
      const r = data.result;
      setResult(r);
      setTitle(r.title || "");

      const m3u8 = r.m3u8Url;
      if (m3u8) {
        setSelected(m3u8);
        setProbing(true);
        try {
          const probeRes = await api.post<{ result: ProbeResult }>("/probe", {
            url: m3u8,
          });
          setProbe(probeRes.data.result);
          const first = probeRes.data.result.variants[0];
          if (first) setSelected(first.url);
        } catch {
          // keep selected m3u8
        } finally {
          setProbing(false);
        }
        const via =
          r.source === "browser"
            ? "headless browser (JS + network)"
            : r.source === "html"
              ? "static HTML"
              : "direct link";
        toast.success(`Stream found via ${via}`);
      } else {
        toast.message("No m3u8 link found", {
          description: r.warnings[0],
        });
      }
    } catch (error) {
      const msg =
        (error as { response?: { data?: { error?: string } } })?.response?.data
          ?.error ||
        (error instanceof Error ? error.message : "Extract failed");
      toast.error(msg);
    } finally {
      setExtracting(false);
    }
  };

  const onDownload = async () => {
    if (!selected) {
      toast.error("Select an m3u8 link first");
      return;
    }
    const finalTitle = title.trim() || "Extracted stream";
    setQueuing(true);
    try {
      const variant = probe?.variants.find((v) => v.url === selected);
      await addOne({
        title: finalTitle,
        url: selected,
        format: format || "mp4",
        resolution: variant?.label ?? null,
      });
      toast.success("Download queued", { description: finalTitle });
    } catch (error) {
      const msg =
        (error as { response?: { data?: { error?: string; details?: unknown } } })
          ?.response?.data?.error ||
        (error instanceof Error ? error.message : "Failed to queue download");
      console.error("queue download failed", error);
      toast.error(msg);
    } finally {
      setQueuing(false);
    }
  };

  const copyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Copied m3u8 link");
    } catch {
      toast.error("Could not copy");
    }
  };

  const candidates =
    probe && probe.variants.length > 0
      ? probe.variants.map((v) => ({ url: v.url, label: v.label }))
      : (result?.candidates ?? []).map((c) => ({ url: c, label: c }));

  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
      >
        <Card className="border-border/60 bg-card/70 shadow-lg backdrop-blur">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <HiOutlineSearchCircle className="h-5 w-5" />
              Extract from video URL
            </CardTitle>
            <CardDescription>
              Paste a page URL. Extraction runs <strong>entirely on the
              server</strong>{" "}
              (Python). With <em>Deep JS scrape</em> enabled, a headless Chromium
              loads the page like a real browser: executes JS, walks iframes, and
              intercepts network <span className="font-mono">.m3u8</span> requests
              — no client-side iframe (that hits CORS).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-5" onSubmit={handleSubmit(onExtract)}>
              <div className="space-y-2">
                <Label htmlFor="page-url">Video page URL</Label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <div className="relative flex-1">
                    <HiOutlineLink className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="page-url"
                      className="pl-9 font-mono text-sm"
                      placeholder="https://example.com/watch/… or …/playlist.m3u8"
                      autoComplete="off"
                      {...register("url")}
                    />
                  </div>
                  <Button type="submit" disabled={extracting}>
                    {extracting
                      ? deepMode
                        ? "Deep scraping (JS)…"
                        : "Extracting…"
                      : "Extract"}
                  </Button>
                </div>
                {errors.url && (
                  <p className="text-sm text-destructive">{errors.url.message}</p>
                )}
              </div>

              <label className="flex cursor-pointer items-start gap-3 rounded-lg border bg-muted/30 p-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={deepMode}
                  onChange={(e) => setDeepMode(e.target.checked)}
                />
                <span>
                  <span className="font-medium">Deep JS scrape (recommended)</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    Uses headless Chromium on the server to catch streams injected
                    by JavaScript players, XHR/fetch, and nested iframes. Slower
                    (~15–60s) but much more complete.
                  </span>
                </span>
              </label>
            </form>
          </CardContent>
        </Card>
      </motion.div>

      {result && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
          <Card className="border-border/60 bg-card/70 backdrop-blur">
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-lg">Result</CardTitle>
                <Badge variant="outline" className="font-mono text-xs">
                  source: {result.source}
                </Badge>
                {result.method && (
                  <Badge variant="outline" className="font-mono text-xs">
                    {result.method}
                  </Badge>
                )}
                <Badge variant="secondary" className="font-mono text-xs">
                  server-side
                </Badge>
              </div>
              <CardDescription className="font-mono text-xs break-all">
                {result.pageUrl}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="extracted-title">File name (title)</Label>
                <Input
                  id="extracted-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Video title"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <FormatSelect value={format} onChange={setFormat} id="ex-format" />
                <ResolutionPicker
                  loading={probing}
                  variants={probe?.variants ?? []}
                  selectedUrl={selected}
                  onSelect={setSelected}
                />
              </div>

              {candidates.length > 0 ? (
                <div className="space-y-2">
                  <Label>m3u8 candidates</Label>
                  <div className="overflow-hidden rounded-xl border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-12" />
                          <TableHead>Stream</TableHead>
                          <TableHead className="w-24 text-right">Copy</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {candidates.map((c) => {
                          const isSel = selected === c.url;
                          return (
                            <TableRow
                              key={c.url}
                              className={isSel ? "bg-muted/50" : undefined}
                              onClick={() => setSelected(c.url)}
                            >
                              <TableCell>
                                <span className="flex h-5 w-5 items-center justify-center rounded-full border">
                                  {isSel && (
                                    <FiCheck className="h-3 w-3 text-primary" />
                                  )}
                                </span>
                              </TableCell>
                              <TableCell>
                                <div className="space-y-0.5">
                                  <div className="text-sm font-medium">
                                    {c.label}
                                  </div>
                                  <code className="block max-w-[480px] truncate font-mono text-xs text-muted-foreground">
                                    {c.url}
                                  </code>
                                </div>
                              </TableCell>
                              <TableCell className="text-right">
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void copyLink(c.url);
                                  }}
                                >
                                  <FiCopy className="h-4 w-4" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              ) : (
                <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                  No m3u8 playlist was found in the page source (server fetch).
                </p>
              )}

              {result.warnings.length > 0 && (
                <ul className="list-inside list-disc space-y-1 text-xs text-muted-foreground">
                  {result.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}

              <Button
                type="button"
                disabled={!selected || queuing}
                onClick={() => void onDownload()}
              >
                <FiDownload className="mr-2 h-4 w-4" />
                {queuing ? "Queuing…" : `Start download (.${format})`}
              </Button>
            </CardContent>
          </Card>
        </motion.div>
      )}
    </div>
  );
}
