import { beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FileCard, FileCardView, formatFileSize, highlightFileName, pickBestLap } from "./FileCard";
import { useAppStore } from "../state/appStore";
import type { DatasetMeta, LapInfo } from "../api/client";
const meta = (overrides: Partial<DatasetMeta["meta"]> = {}): DatasetMeta["meta"] => ({
  file_path: "D:\\Data\\MADRING_FP2_R2.xrk",
  file_type: "xrk",
  session: "Madring",
  vehicle: "SCUT-24 EVO",
  racer: "LIN",
  championship: "FSAE",
  comment: "",
  date: "2026-09-15",
  start_time: "09:30:00",
  sample_rate_hz: 500,
  duration: 1196.3,
  ...overrides,
});

const dataset = (overrides: Partial<DatasetMeta> = {}): DatasetMeta => ({
  id: 1,
  file_hash: "hash-file-card",
  file_size: 86_404_526,
  meta: meta(),
  channels: [],
  ...overrides,
});

beforeEach(() => {
  useAppStore.setState({ dataset: null });
});

describe("highlightFileName", () => {
  it("highlights the session keyword inside the file name", () => {
    const segs = highlightFileName("MADRING_FP2_R2.XRK", "FP2");
    expect(segs).toEqual([
      { text: "MADRING_", hot: false },
      { text: "FP2", hot: true },
      { text: "_R2.XRK", hot: false },
    ]);
  });

  it("matches case-insensitively and drops empty leading segment", () => {
    const segs = highlightFileName("MADRING_FP2_R2.XRK", "madring");
    expect(segs).toEqual([
      { text: "MADRING", hot: true },
      { text: "_FP2_R2.XRK", hot: false },
    ]);
  });

  it("skips keywords shorter than 3 chars or without a match", () => {
    expect(highlightFileName("AGX.xrk", "ag")).toEqual([{ text: "AGX.xrk", hot: false }]);
    expect(highlightFileName("AGX.xrk", "zzz")).toEqual([{ text: "AGX.xrk", hot: false }]);
  });
});

describe("formatFileSize", () => {
  it("formats bytes, KB, MB and GB", () => {
    expect(formatFileSize(512)).toBe("512B");
    expect(formatFileSize(2048)).toBe("2.0KB");
    expect(formatFileSize(86_404_526)).toBe("82.4MB");
    expect(formatFileSize(2 * 1024 * 1024 * 1024)).toBe("2.0GB");
  });

  it("handles invalid input", () => {
    expect(formatFileSize(Number.NaN)).toBe("—");
    expect(formatFileSize(-1)).toBe("—");
  });
});

describe("pickBestLap", () => {
  it("selects the shortest lap duration", () => {
    const laps: LapInfo[] = [
      { index: 0, start: 0, duration: 103.5 },
      { index: 1, start: 110, duration: 102.871 },
      { index: 2, start: 220, duration: 104.2 },
    ];
    expect(pickBestLap(laps)?.index).toBe(1);
    expect(pickBestLap([])).toBeNull();
  });
});

describe("FileCard", () => {
  it("renders nothing without a dataset", () => {
    expect(renderToStaticMarkup(<FileCard />)).toBe("");
  });

  it("renders file name, chips and metadata rows", () => {
    const html = renderToStaticMarkup(<FileCardView dataset={dataset()} laps={null} />);
    expect(html).toContain("DATA FILE");
    expect(html).toContain("MADRING_");
    expect(html).toContain("500Hz");
    expect(html).toContain("—"); // laps 未加载
    expect(html).toContain("82.4MB");
    expect(html).toContain("车手 Driver");
    expect(html).toContain("LIN");
    expect(html).toContain("19:56.300");
    expect(html).not.toContain("最快圈");
  });

  it("omits channel-count and best-lap rows (removed by owner)", () => {
    const laps: LapInfo[] = [
      { index: 0, start: 0, duration: 103.5 },
      { index: 1, start: 110, duration: 102.871 },
    ];
    const html = renderToStaticMarkup(<FileCardView dataset={dataset()} laps={laps} />);
    expect(html).not.toContain("最快圈");
    expect(html).not.toContain("通道 Channels");
    // LAPS chip 仍在（圈数来自 chips，不重复成行）
    expect(html).toContain("LAPS");
  });

  it("highlights the session keyword in red within the file name", () => {
    useAppStore.setState({ dataset: dataset() });
    const html = renderToStaticMarkup(<FileCardView dataset={dataset()} laps={null} />);
    expect(html).toContain("var(--red)");
    expect(html).toContain("FP2");
  });
});
