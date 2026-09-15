import uPlot from "uplot";
import type { WindowFrame } from "../api/types";

export const SCUT_SYNC_KEY = "scut";
export const scutSync = uPlot.sync(SCUT_SYNC_KEY);

export interface CreatePlotOptionsParams {
  channel: string;
  unit?: string;
  width?: number;
  height?: number;
  stroke?: string;
  theme?: PlotTheme;
  onWindowChange?: (w: { start: number; end: number }) => void;
  onCursorChange?: (t: number) => void;
}

export interface PlotTheme {
  accent: string;
  accentSubtle: string;
  textMuted: string;
  border: string;
  borderSubtle: string;
}

export interface PlotIdentity {
  channel: string;
  unit?: string;
  theme?: string;
}

export function requiresPlotRebuild(
  previous: PlotIdentity | null,
  next: PlotIdentity
): boolean {
  return previous === null ||
    previous.channel !== next.channel ||
    previous.unit !== next.unit ||
    previous.theme !== next.theme;
}

interface CssPropertyReader {
  getPropertyValue(name: string): string;
}

export function getPlotTheme(style?: CssPropertyReader): PlotTheme {
  const source = style ??
    (typeof document !== "undefined" ? getComputedStyle(document.documentElement) : undefined);
  const read = (name: string, fallback: string) => source?.getPropertyValue(name).trim() || fallback;
  return {
    accent: read("--accent", "#378ADD"),
    accentSubtle: read("--accent-subtle", "rgba(55, 138, 221, 0.15)"),
    textMuted: read("--text-muted", "#8B909A"),
    border: read("--border", "rgba(255, 255, 255, 0.15)"),
    borderSubtle: read("--border-subtle", "rgba(255, 255, 255, 0.08)"),
  };
}

export function frameToAlignedData(frame: WindowFrame): uPlot.AlignedData {
  return [
    Array.from(frame.times),
    Array.from(frame.mins),
    Array.from(frame.maxs),
  ];
}

export function formatAxisValues(values: number[], suffix = ""): string[] {
  const finite = values.filter(Number.isFinite);
  const span = finite.length > 1 ? Math.abs(finite.at(-1)! - finite[0]) : 0;
  const step = finite.length > 1 ? span / (finite.length - 1) : span;
  const decimals = step >= 1 || step === 0
    ? 1
    : Math.min(4, Math.max(1, Math.ceil(-Math.log10(step)) + 1));
  return values.map((value) => `${value.toFixed(decimals)}${suffix}`);
}

export function createPlotOptions({
  channel,
  unit,
  width = 600,
  height = 200,
  stroke,
  theme = getPlotTheme(),
  onWindowChange,
  onCursorChange,
}: CreatePlotOptionsParams): uPlot.Options {
  return {
    width,
    height,
    scales: {
      x: {
        time: false,
        auto: false,
      },
      y: {
        auto: true,
      },
    },
    series: [
      {
        label: "Time",
        value: (_u, v) => (v == null ? "—" : `${v.toFixed(3)}s`),
      },
      {
        label: channel,
        stroke: stroke ?? theme.accent,
        width: 1.5,
        value: (_u, v) => (v == null ? "—" : unit ? `${v.toFixed(2)} ${unit}` : v.toFixed(2)),
      },
      {
        label: `${channel} max`,
        stroke: stroke ?? theme.accent,
        width: 1,
        value: (_u, v) => (v == null ? "—" : unit ? `${v.toFixed(2)} ${unit}` : v.toFixed(2)),
      },
    ],
    bands: [{ series: [1, 2], fill: theme.accentSubtle }],
    axes: [
      {
        scale: "x",
        stroke: theme.textMuted,
        grid: { stroke: theme.borderSubtle, width: 1 },
        ticks: { stroke: theme.border, width: 1 },
        values: (_u, vals) => formatAxisValues(vals, "s"),
      },
      {
        scale: "y",
        size: 90,
        stroke: theme.textMuted,
        grid: { stroke: theme.borderSubtle, width: 1 },
        ticks: { stroke: theme.border, width: 1 },
        values: (_u, vals) => formatAxisValues(vals, unit ? ` ${unit}` : ""),
      },
    ],
    cursor: {
      sync: {
        key: SCUT_SYNC_KEY,
      },
      drag: {
        x: true,
        y: false,
        setScale: false,
      },
      points: {
        size: 6,
        width: 2,
      },
    },
    hooks: {
      setSelect: [
        (u) => {
          const min = u.posToVal(u.select.left, "x");
          const max = u.posToVal(u.select.left + u.select.width, "x");
          if (Number.isFinite(min) && Number.isFinite(max) && max > min) {
            u.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
            onWindowChange?.({ start: min, end: max });
          }
        },
      ],
      setCursor: [
        (u) => {
          const idx = u.cursor.idx;
          if (idx != null && u.data[0] && idx in u.data[0]) {
            const t = u.data[0][idx];
            if (typeof t === "number") {
              onCursorChange?.(t);
            }
          }
        },
      ],
    },
  };
}

export function createPlot(
  target: HTMLElement,
  data: uPlot.AlignedData,
  options?: Partial<uPlot.Options>
): uPlot {
  const defaultOpts = createPlotOptions({ channel: "Series" });
  const merged: uPlot.Options = { ...defaultOpts, ...options };
  return new uPlot(merged, data, target);
}

export function resizePlot(plot: uPlot, width: number, height: number): void {
  if (plot && typeof plot.setSize === "function") {
    plot.setSize({ width, height });
  }
}
