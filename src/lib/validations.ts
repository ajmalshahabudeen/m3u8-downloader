import { z } from "zod";
import { OUTPUT_FORMATS } from "@/types/download";

const formatValues = OUTPUT_FORMATS.map((f) => f.value) as [
  string,
  ...string[],
];

export const outputFormatSchema = z.enum(formatValues);

export const downloadItemSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Title is required")
    .max(200, "Title must be 200 characters or less"),
  url: z
    .string()
    .trim()
    .url("Enter a valid URL")
    .refine(
      (value) =>
        value.includes(".m3u8") ||
        value.includes("m3u8") ||
        value.startsWith("http"),
      "URL should point to an m3u8 stream",
    ),
  format: outputFormatSchema,
  resolution: z.string().trim().max(120).optional().nullable(),
});

export const singleDownloadSchema = downloadItemSchema;

export const batchDownloadSchema = z.object({
  items: z
    .array(downloadItemSchema)
    .min(1, "Add at least one download")
    .max(50, "Maximum 50 downloads at once"),
});

export const probeSchema = z.object({
  url: z.string().trim().url("Enter a valid URL"),
});

export type DownloadItemInput = z.infer<typeof downloadItemSchema>;
export type SingleDownloadInput = z.infer<typeof singleDownloadSchema>;
export type BatchDownloadInput = z.infer<typeof batchDownloadSchema>;
