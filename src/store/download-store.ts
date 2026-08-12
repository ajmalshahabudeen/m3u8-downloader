"use client";

import { create } from "zustand";
import type { DownloadRecord } from "@/types/download";
import {
  createBatchDownloads,
  createDownload,
  deleteBatchDownloads,
  deleteDownload,
  fetchDownloads,
  retryDownload,
  type CreateDownloadPayload,
} from "@/lib/api";

interface DownloadState {
  downloads: DownloadRecord[];
  loading: boolean;
  error: string | null;
  setDownloads: (downloads: DownloadRecord[]) => void;
  load: () => Promise<void>;
  addOne: (payload: CreateDownloadPayload) => Promise<DownloadRecord>;
  addMany: (items: CreateDownloadPayload[]) => Promise<void>;
  remove: (id: string) => Promise<void>;
  removeMany: (ids?: string[]) => Promise<void>;
  retry: (id: string) => Promise<void>;
}

export const useDownloadStore = create<DownloadState>((set, get) => ({
  downloads: [],
  loading: false,
  error: null,

  setDownloads: (downloads) => set({ downloads }),

  load: async () => {
    set({ loading: true, error: null });
    try {
      const downloads = await fetchDownloads();
      set({ downloads, loading: false });
    } catch (error) {
      set({
        loading: false,
        error:
          error instanceof Error ? error.message : "Failed to load downloads",
      });
    }
  },

  addOne: async (payload) => {
    const download = await createDownload(payload);
    set({ downloads: [download, ...get().downloads] });
    return download;
  },

  addMany: async (items) => {
    const created = await createBatchDownloads(items);
    set({ downloads: [...created, ...get().downloads] });
  },

  remove: async (id) => {
    await deleteDownload(id);
    set({ downloads: get().downloads.filter((d) => d.id !== id) });
  },

  removeMany: async (ids) => {
    await deleteBatchDownloads(ids);
    if (!ids || ids.length === 0) {
      set({ downloads: [] });
    } else {
      const setIds = new Set(ids);
      set({ downloads: get().downloads.filter((d) => !setIds.has(d.id)) });
    }
  },

  retry: async (id) => {
    const updated = await retryDownload(id);
    set({
      downloads: get().downloads.map((d) => (d.id === id ? updated : d)),
    });
  },
}));
