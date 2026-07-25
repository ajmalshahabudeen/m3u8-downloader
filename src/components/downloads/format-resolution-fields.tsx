"use client";

import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { OUTPUT_FORMATS, type ProbeResult, type StreamVariant } from "@/types/download";
import { cn } from "@/lib/utils";

export function FormatSelect({
  value,
  onChange,
  id,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  id?: string;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      <Label htmlFor={id}>Output format</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder="Format" />
        </SelectTrigger>
        <SelectContent>
          {OUTPUT_FORMATS.map((f) => (
            <SelectItem key={f.value} value={f.value}>
              {f.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function useStreamProbe(url: string) {
  const [loading, setLoading] = useState(false);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);

  useEffect(() => {
    const trimmed = url.trim();
    if (!trimmed || !trimmed.startsWith("http")) {
      setProbe(null);
      setSelectedUrl(null);
      setError(null);
      return;
    }

    // Debounce probe
    const t = setTimeout(() => {
      void (async () => {
        setLoading(true);
        setError(null);
        try {
          const { data } = await api.post<{ result: ProbeResult }>("/probe", {
            url: trimmed,
          });
          setProbe(data.result);
          const first = data.result.variants[0];
          setSelectedUrl(first?.url ?? trimmed);
        } catch (e) {
          setProbe(null);
          setSelectedUrl(trimmed);
          setError(
            (e as { response?: { data?: { error?: string } } })?.response?.data
              ?.error || "Could not probe resolutions",
          );
        } finally {
          setLoading(false);
        }
      })();
    }, 500);

    return () => clearTimeout(t);
  }, [url]);

  return { loading, probe, error, selectedUrl, setSelectedUrl };
}

export function ResolutionPicker({
  loading,
  variants,
  selectedUrl,
  onSelect,
  error,
}: {
  loading: boolean;
  variants: StreamVariant[];
  selectedUrl: string | null;
  onSelect: (url: string) => void;
  error?: string | null;
}) {
  if (loading) {
    return (
      <div className="space-y-2">
        <Label>Resolution</Label>
        <Skeleton className="h-9 w-full" />
        <p className="text-xs text-muted-foreground">Probing stream variants…</p>
      </div>
    );
  }

  if (!variants.length) {
    return error ? (
      <p className="text-xs text-muted-foreground">
        {error} — download will use the URL as-is.
      </p>
    ) : null;
  }

  if (variants.length === 1 && !variants[0]?.resolution) {
    return (
      <p className="text-xs text-muted-foreground">
        Single stream detected — no resolution choice needed.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <Label>Resolution / quality</Label>
      <div className="flex flex-wrap gap-2">
        {variants.map((v) => {
          const active = selectedUrl === v.url;
          return (
            <Button
              key={v.id + v.url}
              type="button"
              size="sm"
              variant={active ? "default" : "outline"}
              onClick={() => onSelect(v.url)}
              className="font-mono text-xs"
            >
              {v.label}
            </Button>
          );
        })}
      </div>
      {error && <p className="text-xs text-muted-foreground">{error}</p>}
    </div>
  );
}
