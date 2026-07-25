"use client";

import { useEffect, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { motion } from "motion/react";
import { toast } from "sonner";
import { HiOutlineCloudDownload } from "react-icons/hi";
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
import {
  singleDownloadSchema,
  type SingleDownloadInput,
} from "@/lib/validations";
import { useDownloadStore } from "@/store/download-store";
import {
  FormatSelect,
  ResolutionPicker,
  useStreamProbe,
} from "@/components/downloads/format-resolution-fields";

export function SingleDownloadForm() {
  const addOne = useDownloadStore((s) => s.addOne);
  const [format, setFormat] = useState("mp4");

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    control,
    formState: { errors, isSubmitting },
  } = useForm<SingleDownloadInput>({
    resolver: zodResolver(singleDownloadSchema),
    defaultValues: { title: "", url: "", format: "mp4", resolution: null },
  });

  const url = watch("url") || "";
  const { loading, probe, error, selectedUrl, setSelectedUrl } =
    useStreamProbe(url);

  useEffect(() => {
    setValue("format", format);
  }, [format, setValue]);

  useEffect(() => {
    if (!probe) return;
    const v = probe.variants.find((x) => x.url === selectedUrl);
    setValue("resolution", v?.label ?? null);
    if (selectedUrl && selectedUrl !== url && probe.isMaster) {
      // keep master url field as typed; download uses selected variant via resolution url override
    }
  }, [probe, selectedUrl, setValue, url]);

  const onSubmit = async (values: SingleDownloadInput) => {
    try {
      const downloadUrl =
        selectedUrl && probe?.isMaster ? selectedUrl : values.url;
      const variant = probe?.variants.find((x) => x.url === downloadUrl);
      await addOne({
        title: values.title,
        url: downloadUrl,
        format: values.format || format,
        resolution: variant?.label ?? values.resolution ?? null,
      });
      toast.success("Download queued", { description: values.title });
      reset({ title: "", url: "", format: "mp4", resolution: null });
      setFormat("mp4");
      setSelectedUrl(null);
    } catch {
      toast.error("Failed to start download");
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
    >
      <Card className="border-border/60 bg-card/70 shadow-lg backdrop-blur">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <HiOutlineCloudDownload className="h-5 w-5" />
            Single m3u8 download
          </CardTitle>
          <CardDescription>
            Title becomes the exact file name. Choose format and, if available,
            stream resolution. Processing stages (extract / combine / convert)
            show in the queue below.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-5" onSubmit={handleSubmit(onSubmit)}>
            <div className="space-y-2">
              <Label htmlFor="title">File name (title)</Label>
              <Input
                id="title"
                placeholder="My stream recording"
                autoComplete="off"
                {...register("title")}
              />
              {errors.title && (
                <p className="text-sm text-destructive">{errors.title.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="url">m3u8 link</Label>
              <Input
                id="url"
                placeholder="https://example.com/playlist.m3u8"
                autoComplete="off"
                className="font-mono text-sm"
                {...register("url")}
              />
              {errors.url && (
                <p className="text-sm text-destructive">{errors.url.message}</p>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Controller
                control={control}
                name="format"
                render={({ field }) => (
                  <FormatSelect
                    id="format"
                    value={field.value || format}
                    onChange={(v) => {
                      field.onChange(v);
                      setFormat(v);
                    }}
                  />
                )}
              />
              <ResolutionPicker
                loading={loading}
                variants={probe?.variants ?? []}
                selectedUrl={selectedUrl}
                onSelect={setSelectedUrl}
                error={error}
              />
            </div>

            <Button type="submit" disabled={isSubmitting || loading}>
              {isSubmitting ? "Queuing…" : "Start download"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}
