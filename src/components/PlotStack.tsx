import React, { useEffect, useMemo, useRef, useState } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { useAppStore } from "../state/appStore";
import * as client from "../api/client";
import type { WindowFrame } from "../api/types";
import {
  createStackedOptions,
  frameToSingleLine,
  resizePlot,
} from "../plot/uPlotFactory";
import { buildChannelColorMap, resolveColor } from "../theme/channelColors";
import { cursorFraction, zoomAtViewport } from "../utils/viewport";
import { useCursorValues } from "../hooks/useCursorValues";
import { getDatasetDuration } from "../api/dataset";

// B.4-P2 rev.5 图表堆叠：每勾选通道一图 flex:1 均分，图间 1px 分隔，左上图例。
// 交互（B.11）：按住拖动 = 移动全局数据游标（禁 hover 跟随）；
// 滚轮 = 以鼠标横向位置为焦点缩放时间窗（×1.18/÷1.18，最小 2s）。

const ZOOM_FACTOR = 1.18;
const MAX_VISIBLE_SAMPLE_POINTS = 500;
// 两阶段取数：窗口一变先发金字塔低清预览（拖动中按节流合并），停顿后
// 再发 raw 精确请求。若每次窗口变化都整窗全样本拉取，拖动会形成请求风暴，
// 最新数据永远排在队尾 —— 新露出的区域要等很久才被填充。
const PREVIEW_THROTTLE_MS = 60;
const RAW_DEBOUNCE_MS = 200;
// 最粗金字塔层 ≤512 桶，预览像素低于 256 会选不出层级（budget = pixels*2）。
const PREVIEW_PIXELS_MIN = 512;
const PREVIEW_PIXELS_MAX = 1024;

function previewThrottleDelay(lastFireAt: number, now: number): number {
  if (lastFireAt <= 0) return 0;
  return Math.max(0, PREVIEW_THROTTLE_MS - (now - lastFireAt));
}

function formatChannelValue(value: number | undefined, unit: string): string {
  if (value === undefined || !Number.isFinite(value)) return "--";
  const decimals = Number.isInteger(value) ? 0 : 2;
  return `${value.toFixed(decimals)}${unit ? ` ${unit}` : ""}`;
}

interface ChannelChartProps {
  datasetId: number;
  channelKey: string;
  channelName: string;
  unit: string;
  color: string;
  /** 堆叠中最后一张图才画 x 轴刻度。 */
  isLast: boolean;
  cursorValue: number | undefined;
  duration: number;
  domainStart: number;
  detailFocusKey: string | null;
  minWindowSeconds: number;
}

const ChannelChart: React.FC<ChannelChartProps> = ({
  datasetId,
  channelKey,
  channelName,
  unit,
  color,
  isLast,
  cursorValue,
  duration,
  domainStart,
  detailFocusKey,
  minWindowSeconds,
}) => {
  const window = useAppStore((s) => s.window);
  const generation = useAppStore((s) => s.generation);
  const cursorT = useAppStore((s) => s.cursorT);
  const setCursor = useAppStore((s) => s.setCursor);
  const setZoomWindow = useAppStore((s) => s.setZoomWindow);
  const theme = useAppStore((s) => s.theme);
  // 仅作为依赖触发"导入中通道构建完成 → 重拉";fire 内部用 getState 读取,
  // 避免闭包过期。导入轮询期间每次状态更新都会重发请求,与既有行为一致。
  const importJobs = useAppStore((s) => s.importJobs);

  const containerRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const [frame, setFrame] = useState<WindowFrame | null>(null);
  const [loading, setLoading] = useState(false);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, setPlotLayoutVersion] = useState(0);
  const draggingRef = useRef(false);
  const lastCursorLeftRef = useRef<number | null>(null);
  const aliveRef = useRef(true);
  const previewLastFireRef = useRef(0);
  const previewTimerRef = useRef<number | undefined>(undefined);
  const previewPendingRef = useRef<{
    datasetId: number;
    channelKey: string;
    start: number;
    end: number;
    generation: number;
  } | null>(null);

  const plotOverRect = (): DOMRect | null => plotRef.current?.over.getBoundingClientRect() ?? null;

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      if (previewTimerRef.current !== undefined) {
        globalThis.clearTimeout(previewTimerRef.current);
        previewTimerRef.current = undefined;
      }
    };
  }, []);

  const previewPixels = () =>
    Math.min(PREVIEW_PIXELS_MAX, Math.max(PREVIEW_PIXELS_MIN, containerRef.current?.clientWidth || 600));

  const firePreviewRequest = (
    req: { datasetId: number; channelKey: string; start: number; end: number; generation: number }
  ) => {
    previewLastFireRef.current = Date.now();
    setLoading(true);
    setError(null);
    setBuilding(false);
    client
      .windowSeries(req.datasetId, req.channelKey, req.start, req.end, previewPixels(), req.generation)
      .then((next) => {
        if (!aliveRef.current) return;
        setLoading(false);
        if (next.header.generation !== useAppStore.getState().generation) return; // 过期帧
        setFrame(next);
      })
      .catch((err: unknown) => {
        if (!aliveRef.current) return;
        setLoading(false);
        const code = (err as { code?: string })?.code;
        if (code === "channel_building") {
          setBuilding(true);
          const activeJob = Object.values(useAppStore.getState().importJobs).find((j) => !j.error);
          if (activeJob) void useAppStore.getState().prioritizeImport(activeJob.job_id, [req.channelKey]);
          return;
        }
        setError(err instanceof Error ? err.message : String(err));
      });
  };

  // 阶段一：金字塔低清预览。连续窗口变化按节流合并（leading + trailing），
  // 响应仍按 generation 校验，过期帧直接丢弃。
  useEffect(() => {
    const pending = { datasetId, channelKey, start: window.start, end: window.end, generation };
    previewPendingRef.current = pending;
    const delay = previewThrottleDelay(previewLastFireRef.current, Date.now());
    if (delay === 0) {
      if (previewTimerRef.current !== undefined) {
        globalThis.clearTimeout(previewTimerRef.current);
        previewTimerRef.current = undefined;
      }
      previewPendingRef.current = null;
      firePreviewRequest(pending);
      return;
    }
    if (previewTimerRef.current === undefined) {
      previewTimerRef.current = globalThis.setTimeout(() => {
        previewTimerRef.current = undefined;
        const queued = previewPendingRef.current;
        previewPendingRef.current = null;
        if (queued && aliveRef.current) firePreviewRequest(queued);
      }, delay);
    }
  }, [datasetId, channelKey, window.start, window.end, generation, importJobs]);

  // 阶段二：窗口停顿后发 raw 精确请求（u32::MAX = 每个真实样本）。
  // 静默替换预览帧；错误由预览阶段负责上报。
  useEffect(() => {
    const reqGen = generation;
    const timer = globalThis.setTimeout(() => {
      client
        .windowSeries(datasetId, channelKey, window.start, window.end, 0xffffffff, reqGen)
        .then((next) => {
          if (!aliveRef.current) return;
          if (next.header.generation !== useAppStore.getState().generation) return;
          setFrame(next);
          setError(null);
          setBuilding(false);
          setLoading(false);
        })
        .catch(() => undefined);
    }, RAW_DEBOUNCE_MS);
    return () => globalThis.clearTimeout(timer);
  }, [datasetId, channelKey, window.start, window.end, generation, importJobs]);

  // uPlot 实例：通道/单位/主题/颜色变化时重建
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (!frame) {
      if (plotRef.current) {
        plotRef.current.destroy();
        plotRef.current = null;
      }
      return;
    }
    const width = container.clientWidth || 600;
    const height = container.clientHeight || 120;
    const options = createStackedOptions({
      channel: channelName,
      unit,
      color,
      width,
      height,
      xAxisVisible: isLast,
      showPoints: frame.times.length <= MAX_VISIBLE_SAMPLE_POINTS,
    });
    options.scales = {
      ...options.scales,
      x: { time: false, auto: false, min: window.start, max: window.end },
    };
    if (plotRef.current) {
      plotRef.current.destroy();
      plotRef.current = null;
    }
    container.querySelector(".uplot")?.remove();
    plotRef.current = new uPlot(options, frameToSingleLine(frame), container);
    setPlotLayoutVersion((version) => version + 1);
    return () => {
      plotRef.current?.destroy();
      plotRef.current = null;
    };
  }, [frame, channelName, unit, color, isLast, theme]);

  // 窗口变化（数据未到时）：先平移 x 域，避免空白
  useEffect(() => {
    plotRef.current?.setScale("x", { min: window.start, max: window.end });
  }, [window.start, window.end]);

  // ResizeObserver 自适应
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !plotRef.current) return;
    const observer = new ResizeObserver(() => {
      const rect = container.getBoundingClientRect();
      if (rect.width > 20 && rect.height > 20) {
        resizePlot(plotRef.current!, Math.floor(rect.width), Math.floor(rect.height));
        setPlotLayoutVersion((version) => version + 1);
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [frame !== null]);

  // B.11 手势：拖动 = 游标；滚轮 = 焦点缩放
  const fractionFromEvent = (clientX: number): number => {
    const rect = plotOverRect();
    if (!rect || rect.width <= 0 || clientX < rect.left || clientX > rect.right) return -1;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const f = fractionFromEvent(e.clientX);
    if (f < 0) return;
    draggingRef.current = true;
    setCursor(window.start + f * (window.end - window.start));
    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return;
      const frac = fractionFromEvent(ev.clientX);
      if (frac < 0) return;
      setCursor(window.start + frac * (window.end - window.start));
    };
    const onUp = () => {
      draggingRef.current = false;
      window_remove_listeners();
    };
    const window_remove_listeners = () => {
      globalThis.removeEventListener("mousemove", onMove);
      globalThis.removeEventListener("mouseup", onUp);
    };
    globalThis.addEventListener("mousemove", onMove);
    globalThis.addEventListener("mouseup", onUp);
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const f = fractionFromEvent(e.clientX);
    if (f < 0) return;
    const next = zoomAtViewport(
      window,
      duration,
      f,
      e.deltaY > 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR,
      minWindowSeconds,
      domainStart
    );
    setZoomWindow(next);
  };

  const frac = cursorFraction(cursorT, window);
  const span = window.end - window.start;
  // frame 可能属于上一个窗口（拖动中响应未到）。MIN/MAX 标记只有在
  // frame 与当前视口一致时才画，否则 min/max 时间点会被 clamp 贴到边缘。
  const frameIsCurrent = frame !== null
    && frame.header.win_start === window.start
    && frame.header.win_end === window.end;
  const extrema = detailFocusKey === channelKey && frameIsCurrent
    ? (() => {
        let minT: number | null = null;
        let maxT: number | null = null;
        let min = Infinity;
        let max = -Infinity;
        for (let i = 0; i < frame.times.length; i += 1) {
          const lo = Number(frame.mins[i]);
          const hi = Number(frame.maxs[i]);
          const value = Number.isFinite(lo) && Number.isFinite(hi) ? (lo + hi) / 2 : Number.isFinite(lo) ? lo : hi;
          if (!Number.isFinite(value)) continue;
          if (value < min) { min = value; minT = frame.times[i]; }
          if (value > max) { max = value; maxT = frame.times[i]; }
        }
        return { minT, maxT };
      })()
    : null;
  const cursorLineLeft = (() => {
    if (frac === null) return null;
    const outer = containerRef.current?.getBoundingClientRect();
    const over = plotOverRect();
    // Keep the last correct screen position while uPlot replaces its overlay.
    // Using a percentage of the outer card here would place the line in the
    // Y-axis margin and cause the visible jump during wheel zoom.
    if (!outer || !over || over.width <= 0) return lastCursorLeftRef.current;
    const left = over.left - outer.left + frac * over.width;
    lastCursorLeftRef.current = left;
    return left;
  })();

  return (
    <div
      data-testid="stacked-chart"
      style={{
        flex: 1,
        minHeight: "60px",
        position: "relative",
        borderBottom: "1px solid var(--line)",
        cursor: "ew-resize",
        overflow: "hidden",
      }}
      onMouseDown={handleMouseDown}
      onWheel={handleWheel}
    >
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
      {extrema && plotOverRect() && (
        <>
          {([ [extrema.minT, "var(--green)", "MIN"], [extrema.maxT, "var(--red)", "MAX"] ] as const).map(([time, color, label]) => {
            if (time === null || span <= 0) return null;
            const f = Math.max(0, Math.min(1, (time - window.start) / span));
            const outer = containerRef.current!.getBoundingClientRect();
            const over = plotOverRect()!;
            const left = over.left - outer.left + f * over.width;
            return <div key={label} style={{ position: "absolute", left, top: 0, bottom: 0, borderLeft: `1px dashed ${color}`, pointerEvents: "none", zIndex: 2 }}><span style={{ position: "absolute", top: 2, left: 3, color, fontSize: 9, fontWeight: 700 }}>{label}</span></div>;
          })}
        </>
      )}
      {/* 左上图例：色条 + 通道名 + 当前值 + 单位 */}
      <div
        style={{
          position: "absolute",
          top: "5px",
          left: "66px",
          zIndex: 2,
          pointerEvents: "none",
          display: "flex",
          alignItems: "center",
          gap: "6px",
          background: "var(--bg2, rgba(15,15,15,0.75))",
          padding: "1px 6px",
          borderRadius: "3px",
        }}
      >
        <span style={{ width: "3px", height: "11px", background: color, display: "inline-block", flex: "none" }} />
        <span style={{ fontWeight: 700, fontSize: "10px", letterSpacing: "1px", color: "var(--dim)" }}>
          {channelName}
        </span>
        <span className="tnum" style={{ fontWeight: 700, fontSize: "11px", color }}>
          {formatChannelValue(cursorValue, unit)}
        </span>
        {unit && (
          <span style={{ fontWeight: 600, fontSize: "9px", color: "var(--dim2)" }}>{unit}</span>
        )}
        {loading && <span style={{ fontSize: "9px", color: "var(--dim2)" }}>加载中…</span>}
        {building && <span style={{ fontSize: "9px", color: "var(--orange)", fontWeight: 700 }}>构建中…</span>}
        {error && <span style={{ fontSize: "9px", color: "var(--red)", fontWeight: 700 }}>{error}</span>}
      </div>
      {/* 数据游标线：红色实线 */}
      {cursorLineLeft !== null && (
        <div
          data-testid="cursor-line"
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: `${cursorLineLeft}px`,
            width: 0,
            borderLeft: "2px solid var(--red, #E10600)",
            pointerEvents: "none",
            zIndex: 1,
          }}
        />
      )}
      {span > 0 && null}
    </div>
  );
};

export const PlotStack: React.FC = () => {
  const dataset = useAppStore((s) => s.dataset);
  const activeRange = useAppStore((s) => s.activeRange);
  const detailFocusKey = useAppStore((s) => s.detailFocusKey);
  const checkedChannels = useAppStore((s) => s.checkedChannels);
  const cursorT = useAppStore((s) => s.cursorT);
  const domainStart = activeRange?.start ?? 0;
  const domainEnd = activeRange?.end ?? (dataset ? getDatasetDuration(dataset) : 0);
  const duration = Math.max(0, domainEnd - domainStart);

  const colorMap = useMemo(
    () => buildChannelColorMap(dataset?.channels.map((c) => c.name) ?? []),
    [dataset]
  );

  const checkedSet = useMemo(() => new Set(checkedChannels), [checkedChannels]);
  const channelByKey = useMemo(() => {
    const map = new Map<string, { name: string; unit: string }>();
    for (const channel of dataset?.channels ?? []) {
      map.set(channel.key, { name: channel.name, unit: channel.unit });
    }
    return map;
  }, [dataset]);

  const ordered = (dataset?.channels ?? [])
    .filter((channel) => checkedSet.has(channel.key))
    .map((channel) => channel.key);
  const sampleRates = ordered
    .map((key) => dataset?.channels.find((channel) => channel.key === key)?.sample_rate_hz ?? 0)
    .filter((rate) => Number.isFinite(rate) && rate > 0);
  const minWindowSeconds = sampleRates.length > 0 ? 20 / Math.max(...sampleRates) : 2;
  const cursorValues = useCursorValues(
    dataset?.id ?? null,
    ordered,
    cursorT,
    duration
  );

  if (!dataset) {
    return (
      <div
        style={{
          flex: 1,
          display: "grid",
          placeItems: "center",
          color: "var(--dim2)",
          fontWeight: 600,
          letterSpacing: "1px",
          fontSize: "13px",
          textAlign: "center",
        }}
      >
        未加载数据集 · 请在资料库导入或双击记录
      </div>
    );
  }

  if (ordered.length === 0) {
    return (
      <div
        data-testid="charts-empty"
        style={{
          flex: 1,
          display: "grid",
          placeItems: "center",
          color: "var(--dim2)",
          fontWeight: 600,
          letterSpacing: "1px",
          fontSize: "13px",
          textAlign: "center",
        }}
      >
        从左侧勾选通道以显示图表 / SELECT CHANNELS
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, minWidth: 0, overflow: "hidden", width: "100%" }}>
      {ordered.map((key, index) => {
        const meta = channelByKey.get(key)!;
        const rawColor = colorMap[meta.name] ?? "var(--dim)";
        const color = resolveColor(rawColor);
        return (
          <ChannelChart
            key={key}
            datasetId={dataset.id}
            channelKey={key}
            channelName={meta.name}
            unit={meta.unit}
            color={color}
            isLast={index === ordered.length - 1}
            cursorValue={cursorValues[key]}
            duration={duration}
            domainStart={domainStart}
            detailFocusKey={detailFocusKey}
            minWindowSeconds={minWindowSeconds}
          />
        );
      })}
      {checkedSet.size !== ordered.length && null}
    </div>
  );
};
