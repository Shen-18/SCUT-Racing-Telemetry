import { create } from "zustand";
import type { DatasetMeta, ImportStatus, WindowFrame, ImportStage } from "../api/client";
import * as client from "../api/client";
import { getDatasetDuration } from "../api/dataset";

export interface AppState {
  dataset: DatasetMeta | null;
  checkedChannels: string[];
  channelOrder: string[];
  window: { start: number; end: number };
  cursorT: number;
  theme: "dark" | "light";
  layoutPreset: string;
  generation: number;
  importJobs: Record<number, ImportStatus>;
  currentFrame: WindowFrame | null;
  openingFileHash: string | null;

  openDataset(fileHash: string): Promise<void>;
  setWindow(w: { start: number; end: number }): void;
  setCursor(t: number): void;
  toggleChannel(key: string): void;
  toggleChannelAndPrioritize(key: string): Promise<void>;
  reorderChannels(order: string[]): void;
  setTheme(t: "dark" | "light"): void;
  bumpGeneration(): void;
  startImport(path: string): Promise<number>;
  prioritizeImport(jobId: number, channels: string[]): Promise<void>;
  applyFrame(frame: WindowFrame): boolean;
  updateImportStatus(status: ImportStatus): void;
}

export function isNonTerminalImportStage(stage: ImportStage): boolean {
  return (
    stage === "ReadingMetadata" ||
    stage === "ReadingChannels" ||
    stage === "BuildingRawCache" ||
    stage === "BuildingPyramid"
  );
}

export const useAppStore = create<AppState>((set, get) => ({
  dataset: null,
  checkedChannels: [],
  channelOrder: [],
  window: { start: 0, end: 1 },
  cursorT: 0,
  theme: "dark",
  layoutPreset: "default",
  generation: 0,
  importJobs: {},
  currentFrame: null,
  openingFileHash: null,

  bumpGeneration() {
    set((state) => ({ generation: state.generation + 1 }));
  },

  setWindow(w: { start: number; end: number }) {
    set((state) => ({
      window: w,
      generation: state.generation + 1,
    }));
  },

  setCursor(t: number) {
    set({ cursorT: t });
  },

  toggleChannel(key: string) {
    set((state) => {
      const exists = state.checkedChannels.includes(key);
      const checkedChannels = exists
        ? state.checkedChannels.filter((k) => k !== key)
        : [...state.checkedChannels, key];
      return { checkedChannels };
    });
  },

  async toggleChannelAndPrioritize(key: string): Promise<void> {
    get().toggleChannel(key);
    const isNowChecked = get().checkedChannels.includes(key);
    if (!isNowChecked) return;

    const activeJob = Object.values(get().importJobs).find((j) =>
      j && isNonTerminalImportStage(j.stage)
    );
    if (activeJob) {
      await get().prioritizeImport(activeJob.job_id, [key]);
    }
  },

  reorderChannels(order: string[]) {
    set({ channelOrder: order });
  },

  setTheme(t: "dark" | "light") {
    set({ theme: t });
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-theme", t);
    }
  },

  applyFrame(frame: WindowFrame): boolean {
    if (frame.header.generation !== get().generation) {
      // Stale / expired frame: discard
      return false;
    }
    set({ currentFrame: frame });
    return true;
  },

  async openDataset(fileHash: string): Promise<void> {
    const meta = await client.openDataset(fileHash);
    const channels = meta.channels || [];
    const channelKeys = channels.map((c) => c.key);
    const defaultSpeedKey = client.selectDefaultSpeedChannel(channels);
    const initialChecked = defaultSpeedKey
      ? [defaultSpeedKey]
      : channelKeys.length > 0
        ? [channelKeys[0]]
        : [];
    const duration = getDatasetDuration(meta);

    set((state) => ({
      dataset: meta,
      checkedChannels: initialChecked,
      channelOrder: channelKeys,
      window: { start: 0, end: duration },
      generation: state.generation + 1,
      currentFrame: null,
      openingFileHash: null,
    }));
  },

  async startImport(path: string): Promise<number> {
    const jobId = await client.startImport(path);
    set((state) => ({
      importJobs: {
        ...state.importJobs,
        [jobId]: {
          job_id: jobId,
          stage: "ReadingMetadata",
          progress: 0,
          file_hash: "",
          meta_ready: false,
          error: null,
        },
      },
    }));
    return jobId;
  },

  async prioritizeImport(jobId: number, channels: string[]): Promise<void> {
    await client.prioritizeImport(jobId, channels);
  },

  updateImportStatus(status: ImportStatus) {
    set((state) => ({
      importJobs: {
        ...state.importJobs,
        [status.job_id]: status,
      },
    }));
    const shouldOpen =
      status.meta_ready &&
      status.file_hash &&
      get().dataset?.file_hash !== status.file_hash &&
      get().openingFileHash !== status.file_hash;
    if (shouldOpen) {
      set({ openingFileHash: status.file_hash });
      void get()
        .openDataset(status.file_hash)
        .catch(() => set({ openingFileHash: null }));
    }
  },
}));
