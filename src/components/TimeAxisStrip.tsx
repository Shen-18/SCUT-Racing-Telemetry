import React, { useEffect, useRef, useState } from "react";
import { useAppStore } from "../state/appStore";
import { getDatasetDuration } from "../api/dataset";
import type { SampleRange } from "../utils/sampleRange";
import { cursorFraction } from "../utils/viewport";
import { calculateTimelinePan } from "./TimelineBar";

// 堆叠图表区底部的 x 轴时间轴（附录 B.11 rev.2）：
// - 刻度与绘图区 1:1 对齐（左偏移 = 共享 y 轴宽度，右缩进 = 堆叠图 padding[1]）；
// - 按住左键拖动 = 沿时间轴平移选区（当前视窗窗口），与 TimelineBar 拖动同一套
//   灵敏度/钳制逻辑（calculateTimelinePan）；原地点击（位移 <3px）= 窗口居中到点击时刻。

const AXIS_RIGHT_PAD = 8;
const TICK_MIN_SPACING_PX = 64;
const DRAG_THRESHOLD_PX = 3;

/** 把任意步长向上取整到 1-2-5 × 10^n 的"好看"刻度步长。 */
export function niceTimeStep(rawStep: number): number {
  if (!Number.isFinite(rawStep) || rawStep <= 0) return 1;
  const base = Math.pow(10, Math.floor(Math.log10(rawStep)));
  for (const m of [1, 2, 5, 10]) {
    const step = m * base;
    if (step >= rawStep) return step;
  }
  return 10 * base;
}

export function formatTimeTick(t: number, decimals: number): string {
  return t
    .toFixed(decimals)
    .replace(/(\.\d*?[1-9])0+$/, "$1")
    .replace(/\.0+$/, "");
}

export interface TimeAxisTick {
  t: number;
  label: string;
}

/**
 * 在 [start, end] 上按 plotWidth 生成时间刻度（步长保证相邻标签 ≥64px）。
 * 刻度落在步长整数倍上，滚动窗口时标签值连续变化、位置稳定。
 */
export function computeTimeAxisTicks(
  start: number,
  end: number,
  plotWidth: number,
): TimeAxisTick[] {
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end <= start ||
    !Number.isFinite(plotWidth) ||
    plotWidth <= 0
  ) {
    return [];
  }
  const rawStep = ((end - start) * TICK_MIN_SPACING_PX) / plotWidth;
  const step = niceTimeStep(rawStep);
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  const firstK = Math.ceil(start / step);
  const ticks: TimeAxisTick[] = [];
  for (let k = firstK; k * step <= end + step * 1e-6; k += 1) {
    const t = k * step;
    ticks.push({ t, label: `${formatTimeTick(t, decimals)}s` });
    if (ticks.length >= 200) break;
  }
  return ticks;
}

export interface TimeAxisStripProps {
  /** 与堆叠图共享的 y 轴宽度：刻度从这里起算才能与绘图区对齐。 */
  yAxisWidth: number;
  /** 覆盖 store（单测用）。 */
  window?: SampleRange;
  domain?: SampleRange;
  cursorT?: number;
}

export const TimeAxisStrip: React.FC<TimeAxisStripProps> = ({
  yAxisWidth,
  window: windowOverride,
  domain: domainOverride,
  cursorT: cursorOverride,
}) => {
  const storeWindow = useAppStore((s) => s.window);
  const storeCursorT = useAppStore((s) => s.cursorT);
  const storeDataset = useAppStore((s) => s.dataset);
  const activeRange = useAppStore((s) => s.activeRange);
  const setWindow = useAppStore((s) => s.setWindow);

  const windowRange = windowOverride ?? storeWindow;
  const cursorT = cursorOverride ?? storeCursorT;
  const domain: SampleRange = domainOverride ?? {
    start: activeRange?.start ?? 0,
    end:
      activeRange?.end ??
      (storeDataset ? getDatasetDuration(storeDataset) : Math.max(1, windowRange.end)),
  };
  const duration = Math.max(0, domain.end - domain.start);

  const trackRef = useRef<HTMLDivElement>(null);
  const [plotWidth, setPlotWidth] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{
    clientX: number;
    origWindow: SampleRange;
    plotWidth: number;
    domainStart: number;
    duration: number;
  } | null>(null);
  const didDragRef = useRef(false);

  // 绘图区宽度 = 时间轴宽度 - y 轴宽 - 右缩进，与堆叠图 padding [12, 8, 12, 0] 对齐
  useEffect(() => {
    const host = trackRef.current;
    if (!host || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const width = host.getBoundingClientRect().width;
      setPlotWidth(Math.max(0, width - yAxisWidth - AXIS_RIGHT_PAD));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, [yAxisWidth]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0 || duration <= 0 || plotWidth <= 0) return;
    e.stopPropagation();
    e.preventDefault();
    dragStartRef.current = {
      clientX: e.clientX,
      origWindow: { ...windowRange },
      plotWidth,
      domainStart: domain.start,
      duration,
    };
    didDragRef.current = false;
    setIsDragging(true);
  };

  useEffect(() => {
    if (!isDragging) return;
    const start = dragStartRef.current;
    if (!start) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - start.clientX;
      if (Math.abs(deltaX) >= DRAG_THRESHOLD_PX) didDragRef.current = true;
      setWindow(
        calculateTimelinePan(deltaX, start.plotWidth, start.duration, start.origWindow, start.domainStart),
      );
    };
    const handleMouseUp = () => {
      dragStartRef.current = null;
      setIsDragging(false);
      // click 在 mouseup 之后派发；若松开点不在本条上则没有 click，
      // 延后一拍重置，避免吞掉下一次正常点击（与 TimelineBar 同套路）。
      globalThis.setTimeout(() => {
        didDragRef.current = false;
      }, 0);
    };
    globalThis.addEventListener("mousemove", handleMouseMove);
    globalThis.addEventListener("mouseup", handleMouseUp);
    return () => {
      globalThis.removeEventListener("mousemove", handleMouseMove);
      globalThis.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, setWindow]);

  // 原地点击（未拖动）：窗口中心对齐点击时刻（与 TimelineBar 点击轨道一致）
  const handleTrackClick = (e: React.MouseEvent) => {
    if (didDragRef.current) {
      didDragRef.current = false;
      return;
    }
    const host = trackRef.current;
    if (!host || duration <= 0 || plotWidth <= 0) return;
    const rect = host.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left - yAxisWidth) / plotWidth));
    const clickT = domain.start + frac * duration;
    const span = windowRange.end - windowRange.start;
    const half = span / 2;
    let newStart = clickT - half;
    let newEnd = clickT + half;
    if (newStart < domain.start) {
      newStart = domain.start;
      newEnd = Math.min(domain.end, domain.start + span);
    } else if (newEnd > domain.end) {
      newEnd = domain.end;
      newStart = Math.max(domain.start, domain.end - span);
    }
    setWindow({ start: newStart, end: newEnd });
  };

  const ticks = computeTimeAxisTicks(windowRange.start, windowRange.end, plotWidth);
  const span = windowRange.end - windowRange.start;
  const cursorFrac = cursorT != null ? cursorFraction(cursorT, windowRange) : null;

  return (
    <div
      ref={trackRef}
      data-testid="time-axis-strip"
      onMouseDown={handleMouseDown}
      onClick={handleTrackClick}
      style={{
        flex: "none",
        height: "20px",
        position: "relative",
        overflow: "hidden",
        userSelect: "none",
        cursor: isDragging ? "grabbing" : "grab",
        touchAction: "none",
      }}
    >
      {ticks.map((tick) => {
        const f = span > 0 ? (tick.t - windowRange.start) / span : 0;
        // 标签按字符宽估算半宽，把首尾刻度夹回可视区内，避免被 overflow 裁掉一半
        const half = (tick.label.length * 6.2) / 2;
        const raw = yAxisWidth + f * plotWidth;
        const left = Math.min(
          yAxisWidth + plotWidth - half,
          Math.max(yAxisWidth + half, raw),
        );
        return (
          <span
            key={tick.t}
            data-testid="time-axis-tick"
            style={{
              position: "absolute",
              left: `${left}px`,
              top: 0,
              bottom: 0,
              display: "flex",
              alignItems: "center",
              transform: "translateX(-50%)",
              fontSize: "10px",
              fontWeight: 600,
              color: "var(--dim2)",
              pointerEvents: "none",
              whiteSpace: "nowrap",
            }}
          >
            {tick.label}
          </span>
        );
      })}
      {cursorFrac !== null && (
        <div
          data-testid="time-axis-cursor"
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: `${yAxisWidth + cursorFrac * plotWidth}px`,
            width: 0,
            borderLeft: "1px solid var(--red, #E10600)",
            pointerEvents: "none",
          }}
        />
      )}
    </div>
  );
};
