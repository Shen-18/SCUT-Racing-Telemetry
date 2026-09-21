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
}) => {
  const window = useAppStore((s) => s.window);
  const generation = useAppStore((s) => s.generation);
  const cursorT = useAppStore((s) => s.cursorT);
  const setCursor = useAppStore((s) => s.setCursor);
  const setWindow = useAppStore((s) => s.setWindow);
  const theme = useAppStore((s) => s.theme);
  const importJobs = useAppStore((s) => s.importJobs);
  const prioritizeImport = useAppStore((s) => s.prioritizeImport);

  const containerRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const [frame, setFrame] = useState<WindowFrame | null>(null);
  const [loading, setLoading] = useState(false);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const draggingRef = useRef(false);

  // 数据请求：每通道独立，generation 过期丢弃
  useEffect(() => {
    let cancelled = false;
    const reqGen = generation;
    const width = containerRef.current?.clientWidth || 600;
    const pixels = Math.max(128, Math.min(4096, width));
    setLoading(true);
    setError(null);
    setBuilding(false);
    client
      .windowSeries(datasetId, channelKey, window.start, window.end, pixels, reqGen)
      .then((next) => {
        if (cancelled) return;
        setLoading(false);
        if (next.header.generation !== useAppStore.getState().generation) return; // 过期帧
        setFrame(next);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoading(false);
        const code = (err as { code?: string })?.code;
        if (code === "channel_building") {
          setBuilding(true);
          const activeJob = Object.values(importJobs).find((j) => !j.error);
          if (activeJob) void prioritizeImport(activeJob.job_id, [channelKey]);
          return;
        }
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [datasetId, channelKey, window.start, window.end, generation, importJobs, prioritizeImport]);

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
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [frame !== null]);

  // B.11 手势：拖动 = 游标；滚轮 = 焦点缩放
  const fractionFromEvent = (clientX: number): number => {
    const rect = containerRef.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    const f = fractionFromEvent(e.clientX);
    setCursor(window.start + f * (window.end - window.start));
    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return;
      const frac = fractionFromEvent(ev.clientX);
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
    const next = zoomAtViewport(window, duration, f, e.deltaY > 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR);
    setWindow(next);
  };

  const frac = cursorFraction(cursorT, window);
  const span = window.end - window.start;

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
      {/* 数据游标线（B.11：仅窗内绘制，虚线 --text 55%） */}
      {frac !== null && (
        <div
          style={{
            position: "absolute",
            top: "26px",
            bottom: "14px",
            left: `calc(${(frac * 100).toFixed(3)}%)`,
            width: 0,
            borderLeft: "1px dashed rgba(127,127,127,0.9)",
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
  const checkedChannels = useAppStore((s) => s.checkedChannels);
  const cursorT = useAppStore((s) => s.cursorT);
  const duration = activeRange?.end ?? (dataset ? getDatasetDuration(dataset) : 0);

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

  const ordered = checkedChannels.filter((key) => channelByKey.has(key));
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
          />
        );
      })}
      {checkedSet.size !== ordered.length && null}
    </div>
  );
};
