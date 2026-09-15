import type { DatasetMeta } from "./types";

export function getDatasetDuration(dataset: DatasetMeta | null | undefined): number {
  const duration = dataset?.meta.duration;
  return typeof duration === "number" && Number.isFinite(duration) && duration > 0
    ? duration
    : 1;
}

export function getDatasetFileName(dataset: DatasetMeta | null | undefined): string {
  const path = dataset?.meta.file_path.trim() ?? "";
  if (!path) return "Dataset";
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}
