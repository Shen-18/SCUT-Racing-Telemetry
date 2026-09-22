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

export function zoomWindowAt(
  window: { start: number; end: number },
  anchor: number,
  deltaY: number,
): { start: number; end: number } {
  const span = window.end - window.start;
  if (!Number.isFinite(span) || span <= 0 || !Number.isFinite(anchor)) return window;
  const factor = deltaY < 0 ? 0.8 : 1.25;
  const nextSpan = Math.max(Number.EPSILON, span * factor);
  const ratio = (anchor - window.start) / span;
  const start = anchor - ratio * nextSpan;
  return { start, end: start + nextSpan };
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
      ready: [
        (u) => {
          const handleWheel: EventListener = (rawEvent) => {
            const event = rawEvent as WheelEvent;
            if (!u.over || !onWindowChange) return;
            event.preventDefault();
            const rect = u.over.getBoundingClientRect();
            const x = event.clientX - rect.left;
            const anchor = u.posToVal(x, "x");
            const min = u.scales.x.min;
            const max = u.scales.x.max;
            if (min == null || max == null) return;
            onWindowChange(zoomWindowAt({ start: min, end: max }, anchor, event.deltaY));
          };
          u.over.addEventListener("wheel", handleWheel, { passive: false });
          (u as uPlot & { __scutWheel?: EventListener }).__scutWheel = handleWheel;
        },
      ],
      destroy: [
        (u) => {
          const handleWheel = (u as uPlot & { __scutWheel?: EventListener }).__scutWheel;
          if (handleWheel) u.over.removeEventListener("wheel", handleWheel);
        },
      ],
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

// ---- 堆叠图表（B.4-P2 rev.5 / B.5）：每勾选通道一张图，垂直堆叠 ----

/**
 * 显式 Y 轴范围：只取有限值，上下各留 10% 余量；常数序列 ±0.5 兜底，
 * 空/全 NaN 给 0..1。避免 uPlot 自适应在孤点与 NaN 上抖动（accx/accy 走查项）。
 */
export function yRangeFromData(data: uPlot.AlignedData, seriesIdx = 1): [number, number] {
  const values = (data[seriesIdx] ?? []) as (number | null)[];
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const v of values) {
    if (v == null || !Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) return [min - 0.5, max + 0.5];
  const pad = (max - min) * 0.1;
  return [min - pad, max + pad];
}

/** 单线渲染：窗口包络取中线，不画包络带（负责人走查：中间的点与带宽都删掉）。 */
export function frameToSingleLine(frame: WindowFrame): uPlot.AlignedData {
  const times = Array.from(frame.times);
  const mids: (number | null)[] = times.map((_, i) => {
    const lo = frame.mins[i] as number | undefined;
    const hi = frame.maxs[i] as number | undefined;
    const loOk = lo != null && Number.isFinite(lo);
    const hiOk = hi != null && Number.isFinite(hi);
    if (!loOk && !hiOk) return null;
    if (!loOk) return hi as number;
    if (!hiOk) return lo as number;
    return ((lo as number) + (hi as number)) / 2;
  });
  return [times, mids];
}

export interface StackedPlotOptionsParams {
  channel: string;
  unit?: string;
  /** 曲线颜色（已 resolveColor 的实色）。 */
  color?: string;
  width?: number;
  height?: number;
  /** 仅堆叠中最后一张图显示 x 轴刻度。 */
  xAxisVisible?: boolean;
  theme?: PlotTheme;
}

/**
 * 堆叠区单张图的 uPlot 配置：单条线、无数据点、缺口直连（spanGaps）。
 * x 域由调用方随后用 setScale 控制（窗口变化时先平移，数据到达再重建）。
 */
export function createStackedOptions({
  channel,
  unit,
  color,
  width = 600,
  height = 120,
  xAxisVisible = false,
  theme = getPlotTheme(),
}: StackedPlotOptionsParams): uPlot.Options {
  const stroke = color ?? theme.accent;
  return {
    width,
    height,
    padding: [8, 8, xAxisVisible ? 0 : 4, 0],
    legend: { show: false },
    scales: {
      x: {
        time: false,
        auto: false,
      },
      y: {
        auto: false,
        range: (u) => yRangeFromData(u.data, 1),
      },
    },
    series: [
      {
        label: "Time",
        value: (_u, v) => (v == null ? "—" : `${v.toFixed(3)}s`),
      },
      {
        label: channel,
        stroke,
        width: 1.5,
        spanGaps: true,
        points: { show: false },
        value: (_u, v) => (v == null ? "—" : unit ? `${v.toFixed(2)} ${unit}` : v.toFixed(2)),
      },
    ],
    axes: [
      {
        scale: "x",
        show: true,
        size: xAxisVisible ? undefined : 0,
        stroke: theme.textMuted,
        grid: { stroke: theme.borderSubtle, width: 1 },
        ticks: { show: xAxisVisible, stroke: theme.border, width: 1 },
        values: (_u, vals) => (xAxisVisible ? formatAxisValues(vals, "s") : vals.map(() => "")),
      },
      {
        scale: "y",
        size: 74,
        stroke: theme.textMuted,
        grid: { stroke: theme.borderSubtle, width: 1 },
        ticks: { stroke: theme.border, width: 1 },
        values: (_u, vals) => formatAxisValues(vals, unit ? ` ${unit}` : ""),
      },
    ],
    cursor: {
      sync: { key: SCUT_SYNC_KEY },
      drag: { x: false, y: false, setScale: false },
      points: { show: false },
      x: false,
      y: false,
    },
  };
}
