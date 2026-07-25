"use client";

import { useEffect, useState } from "react";
import { useFieldArray, useForm, Controller, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { motion } from "motion/react";
import { toast } from "sonner";
import { FiPlus, FiTrash2 } from "react-icons/fi";
import { HiOutlineViewGridAdd } from "react-icons/hi";
import { z } from "zod";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { downloadItemSchema } from "@/lib/validations";
import { useDownloadStore } from "@/store/download-store";
import { OUTPUT_FORMATS } from "@/types/download";
import { useStreamProbe } from "@/components/downloads/format-resolution-fields";

const batchFormSchema = z.object({
  items: z
    .array(downloadItemSchema)
    .min(1, "Add at least one row")
    .max(50, "Maximum 50 rows"),
});

type BatchFormValues = z.infer<typeof batchFormSchema>;

function BatchRowExtras({
  index,
  control,
  setValue,
}: {
  index: number;
  control: ReturnType<typeof useForm<BatchFormValues>>["control"];
  setValue: ReturnType<typeof useForm<BatchFormValues>>["setValue"];
}) {
  const url = useWatch({ control, name: `items.${index}.url` }) || "";
  const format =
    useWatch({ control, name: `items.${index}.format` }) || "mp4";
  const { loading, probe, selectedUrl, setSelectedUrl } = useStreamProbe(url);

  useEffect(() => {
    if (!selectedUrl || !probe?.isMaster) return;
    const v = probe.variants.find((x) => x.url === selectedUrl);
    if (v) {
      setValue(`items.${index}.resolution`, v.label);
      // Store chosen variant URL by replacing when submitting — keep field as typed;
      // we'll map on submit. Also stash on resolution field with label.
    }
  }, [selectedUrl, probe, index, setValue]);

  // expose selectedUrl via data attribute on wrapper for submit mapping
  return (
    <div
      className="flex flex-col gap-1"
      data-row-index={index}
      data-selected-url={selectedUrl || ""}
    >
      <Controller
        control={control}
        name={`items.${index}.format`}
        render={({ field }) => (
          <Select
            value={field.value || format}
            onValueChange={field.onChange}
          >
            <SelectTrigger className="h-8 w-[110px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OUTPUT_FORMATS.map((f) => (
                <SelectItem key={f.value} value={f.value}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />
      {loading ? (
        <span className="text-[10px] text-muted-foreground">Probing…</span>
      ) : probe && probe.variants.length > 1 ? (
        <Select
          value={selectedUrl || undefined}
          onValueChange={(v) => {
            setSelectedUrl(v);
            const variant = probe.variants.find((x) => x.url === v);
            setValue(`items.${index}.resolution`, variant?.label ?? null);
            setValue(`items.${index}.url`, v);
          }}
        >
          <SelectTrigger className="h-8 w-[140px] font-mono text-[10px]">
            <SelectValue placeholder="Resolution" />
          </SelectTrigger>
          <SelectContent>
            {probe.variants.map((v) => (
              <SelectItem key={v.id + v.url} value={v.url}>
                {v.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <span className="text-[10px] text-muted-foreground">
          {probe?.variants[0]?.label || "—"}
        </span>
      )}
    </div>
  );
}

export function BatchDownloadForm() {
  const addMany = useDownloadStore((s) => s.addMany);

  const {
    control,
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<BatchFormValues>({
    resolver: zodResolver(batchFormSchema),
    defaultValues: {
      items: [
        { title: "", url: "", format: "mp4", resolution: null },
        { title: "", url: "", format: "mp4", resolution: null },
      ],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: "items",
  });

  const onSubmit = async (values: BatchFormValues) => {
    try {
      await addMany(
        values.items.map((item) => ({
          title: item.title,
          url: item.url,
          format: item.format || "mp4",
          resolution: item.resolution ?? null,
        })),
      );
      toast.success(`Queued ${values.items.length} downloads`);
      reset({
        items: [
          { title: "", url: "", format: "mp4", resolution: null },
          { title: "", url: "", format: "mp4", resolution: null },
        ],
      });
    } catch {
      toast.error("Failed to queue batch downloads");
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
            <HiOutlineViewGridAdd className="h-5 w-5" />
            Batch m3u8 downloads
          </CardTitle>
          <CardDescription>
            Title = file name. Pick format and resolution per row when the
            playlist is a multi-quality master.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
            <div className="overflow-x-auto rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    <TableHead>Title / file name</TableHead>
                    <TableHead>m3u8 link</TableHead>
                    <TableHead className="w-[160px]">Format / quality</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {fields.map((field, index) => (
                    <TableRow key={field.id}>
                      <TableCell className="text-muted-foreground">
                        {index + 1}
                      </TableCell>
                      <TableCell>
                        <Input
                          placeholder="Episode 1"
                          {...register(`items.${index}.title`)}
                        />
                        {errors.items?.[index]?.title && (
                          <p className="mt-1 text-xs text-destructive">
                            {errors.items[index]?.title?.message}
                          </p>
                        )}
                      </TableCell>
                      <TableCell>
                        <Input
                          className="font-mono text-xs"
                          placeholder="https://…/playlist.m3u8"
                          {...register(`items.${index}.url`)}
                        />
                        {errors.items?.[index]?.url && (
                          <p className="mt-1 text-xs text-destructive">
                            {errors.items[index]?.url?.message}
                          </p>
                        )}
                      </TableCell>
                      <TableCell>
                        <BatchRowExtras
                          index={index}
                          control={control}
                          setValue={setValue}
                        />
                      </TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={fields.length <= 1}
                          onClick={() => remove(index)}
                        >
                          <FiTrash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  append({
                    title: "",
                    url: "",
                    format: "mp4",
                    resolution: null,
                  })
                }
              >
                <FiPlus className="mr-2 h-4 w-4" />
                Add row
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting
                  ? "Queuing…"
                  : `Start ${fields.length} download${fields.length === 1 ? "" : "s"}`}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}
