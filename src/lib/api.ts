import axios from "axios";
import type { DownloadRecord } from "@/types/download";

export const api = axios.create({
  baseURL: "/api",
  headers: { "Content-Type": "application/json" },
});

export type CreateDownloadPayload = {
  title: string;
  url: string;
  format?: string;
  resolution?: string | null;
  /** Original page URL for CDN Referer header */
  referer?: string | null;
};

export async function fetchDownloads() {
  const { data } = await api.get<{ downloads: DownloadRecord[] }>("/downloads");
  return data.downloads;
}

export async function createDownload(payload: CreateDownloadPayload) {
  const { data } = await api.post<{ download: DownloadRecord }>(
    "/downloads",
    payload,
  );
  return data.download;
}

export async function createBatchDownloads(items: CreateDownloadPayload[]) {
  const { data } = await api.post<{ downloads: DownloadRecord[] }>(
    "/downloads",
    { items },
  );
  return data.downloads;
}

export async function deleteDownload(id: string) {
  await api.delete(`/downloads/${id}`);
}

export async function retryDownload(id: string) {
  const { data } = await api.patch<{ download: DownloadRecord }>(
    `/downloads/${id}`,
    { action: "retry" },
  );
  return data.download;
}

export function fileDownloadUrl(id: string) {
  return `/api/downloads/${id}/file`;
}
