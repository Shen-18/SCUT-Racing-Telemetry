import React, { useRef, useState, useEffect, useCallback } from "react";
import { useAppStore } from "../state/appStore";
import { getDatasetDuration } from "../api/dataset";
import * as client from "../api/client";
import type { WindowFrame } from "../api/types";
import type { SampleRange } from "../utils/sampleRange";

const TIMELINE_PAN_INTERVAL_MS = 50;

/** 拖动灵敏度倍率（走查：用户反馈幅度太小）。 */
export const TIMELINE_PAN_SENSITIVITY = 3;

export function timelinePanThrottleDelay(lastDispatchAt: number, now: number): number {
  if (lastDispatchAt <= 0) return 0;
  return Math.max(0, TIMELINE_PAN_INTERVAL_MS - (now - lastDispatchAt));
}

export function calculateTimelinePan(
  deltaX: number,
  trackWidth: number,
  duration: number,
  origWindow: { start: number; end: number },
  domainStart = 0,
): { start: number; end: number } {
  if (trackWidth <= 0 || duration <= 0) return origWindow;
  const span = Math.max(0.001, origWindow.end - origWindow.start);
  // 灵敏度 ×3（负责人走查：原来拖着几乎不动）
  const dt = ((deltaX * TIMELINE_PAN_SENSITIVITY) / trackWidth) * duration;
  let newStart = origWindow.start + dt;
  let newEnd = origWindow.end + dt;

  const domainEnd = domainStart + duration;
  if (newStart < domainStart) {
    newStart = domainStart;
    newEnd = Math.min(domainEnd, domainStart + span);
  } else if (newEnd > domainEnd) {
    newEnd = domainEnd;
    newStart = Math.max(domainStart, domainEnd - span);
  }
  return { start: newStart, end: newEnd };
}

export interface TimelineBarProps {
  window?: { start: number; end: number };
  duration?: number;
  cursorT?: number;
}

export const TimelineBar: React.FC<TimelineBarProps> = (props) => {
  const storeWindow = useAppStore((s) => s.window);
  const storeCursorT = useAppStore((s) => s.cursorT);
  const storeDataset = useAppStore((s) => s.dataset);
  const setWindow = useAppStore((s) => s.setWindow);
  const activeRange = useAppStore((s) => s.activeRange);

  const windowRange = props.window ?? storeWindow;
  const cursorT = props.cursorT ?? storeCursorT;
  const domain: SampleRange = activeRange ?? {
    start: 0,
    end: props.duration ?? (storeDataset ? getDatasetDuration(storeDataset) : Math.max(1, windowRange.end)),
  };
  const duration = Math.max(0.001, domain.end - domain.start);

  const trackRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const lastDispatchAtRef = useRef(0);
  const pendingWindowRef = useRef<{ start: number; end: number } | null>(null);
  const panTimerRef = useRef<number | undefined>();
  const dragStartRef = useRef<{ clientX: number; origWindow: { start: number; end: number } }>({
    clientX: 0,
    origWindow: { start: 0, end: 1 },
  });


  const resetZoom = () => {
    setWindow({ start: domain.start, end: domain.end });
  };

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setIsDragging(true);
    dragStartRef.current = {
      clientX: e.clientX,
      origWindow: { ...windowRange },
    };
  }, [windowRange]);

  useEffect(() => {
    if (!isDragging) return;

    const dispatchPan = (nextWindow: { start: number; end: number }) => {
      const now = Date.now();
      const delay = timelinePanThrottleDelay(lastDispatchAtRef.current, now);
      pendingWindowRef.current = nextWindow;
      if (delay === 0) {
        pendingWindowRef.current = null;
        lastDispatchAtRef.current = now;
        setWindow(nextWindow);
      } else if (panTimerRef.current === undefined) {
        panTimerRef.current = globalThis.setTimeout(() => {
          panTimerRef.current = undefined;
          const pending = pendingWindowRef.current;
          pendingWindowRef.current = null;
          if (pending) {
            lastDispatchAtRef.current = Date.now();
            setWindow(pending);
          }
        }, delay);
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      const track = trackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      const deltaX = e.clientX - dragStartRef.current.clientX;
      const nextWindow = calculateTimelinePan(
        deltaX,
        rect.width,
        duration,
        dragStartRef.current.origWindow,
        domain.start
      );
      dispatchPan(nextWindow);
    };

    const handleMouseUp = () => {
      if (panTimerRef.current !== undefined) {
        globalThis.clearTimeout(panTimerRef.current);
        panTimerRef.current = undefined;
      }
      const pending = pendingWindowRef.current;
      pendingWindowRef.current = null;
      if (pending) {
        lastDispatchAtRef.current = Date.now();
        setWindow(pending);
      }
      setIsDragging(false);
    };

    globalThis.addEventListener("mousemove", handleMouseMove);
    globalThis.addEventListener("mouseup", handleMouseUp);
    return () => {
      globalThis.removeEventListener("mousemove", handleMouseMove);
      globalThis.removeEventListener("mouseup", handleMouseUp);
      if (panTimerRef.current !== undefined) {
        globalThis.clearTimeout(panTimerRef.current);
        panTimerRef.current = undefined;
      }
    };
  }, [isDragging, duration, domain.start, setWindow]);

  // Click on track outside slider to jump / center viewport
  const handleTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const track = trackRef.current;
    if (!track || isDragging) return;
    const rect = track.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickT = domain.start + (clickX / rect.width) * duration;
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

  // ---- canvas 层（B.4 rev.5）：110px 画布 + 红窗口框 + 缩略曲线 + 白色游标 ----
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const generation = useAppStore((s) => s.generation);
  const [thumb, setThumb] = useState<WindowFrame | null>(null);

  useEffect(() => {
    const host = trackRef.current;
    if (!host || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const rect = host.getBoundingClientRect();
      setSize({ w: Math.max(1, Math.floor(rect.width)), h: Math.max(1, Math.floor(rect.height)) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  // 缩略曲线 = 默认速度通道的全程包络（一次粗采样，供画布画底噪）
  useEffect(() => {
    if (!storeDataset || duration <= 0) {
      setThumb(null);
      return;
    }
    const channel = client.selectDefaultSpeedChannel(storeDataset.channels);
    if (!channel) {
      setThumb(null);
      return;
    }
    let cancelled = false;
    client
      .windowSeries(storeDataset.id, channel, domain.start, domain.end, 480, generation)
      .then((frame) => {
        if (!cancelled) setThumb(frame);
      })
      .catch(() => {
        if (!cancelled) setThumb(null);
      });
    return () => {
      cancelled = true;
    };
  }, [storeDataset, domain.start, domain.end, duration, generation]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.w <= 1 || size.h <= 1) return;
    const dpr = globalThis.devicePixelRatio || 1;
    canvas.width = Math.floor(size.w * dpr);
    canvas.height = Math.floor(size.h * dpr);
    const g = canvas.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);

    const style = getComputedStyle(document.documentElement);
    const read = (name: string, fallback: string) =>
      style.getPropertyValue(name).trim() || fallback;
    const bg = read("--bg2", "#1B1B27");
    const line = read("--line", "#38384A");
    const red = read("--red", "#E10600");
    const white = read("--text", "#FFFFFF");
    const dim = read("--dim", "#9B9BAD");

    g.clearRect(0, 0, size.w, size.h);
    g.fillStyle = bg;
    g.fillRect(0, 0, size.w, size.h);

    const padX = 10;
    const top = 10;
    const bottom = 18;
    const trackW = Math.max(1, size.w - padX * 2);
    const x = (t: number) => padX + ((t - domain.start) / duration) * trackW;
    const baseY = size.h - bottom;

    // 缩略曲线（速度包络中线，暗色打底）
    if (thumb && thumb.times.length > 1) {
      let minV = Number.POSITIVE_INFINITY;
      let maxV = Number.NEGATIVE_INFINITY;
      for (let i = 0; i < thumb.times.length; i++) {
        const lo = thumb.mins[i];
        const hi = thumb.maxs[i];
        if (!Number.isFinite(lo) && !Number.isFinite(hi)) continue;
        const a = Number.isFinite(lo) ? lo : hi;
        const b = Number.isFinite(hi) ? hi : lo;
        if (a < minV) minV = a;
        if (b > maxV) maxV = b;
      }
      if (Number.isFinite(minV) && Number.isFinite(maxV)) {
        const span = Math.max(1e-6, maxV - minV);
        const plotH = Math.max(1, baseY - top);
        const y = (v: number) => baseY - ((v - minV) / span) * plotH;
        g.strokeStyle = dim;
        g.globalAlpha = 0.55;
        g.lineWidth = 1;
        g.beginPath();
        let started = false;
        for (let i = 0; i < thumb.times.length; i++) {
          const lo = thumb.mins[i];
          const hi = thumb.maxs[i];
          const loOk = Number.isFinite(lo);
          const hiOk = Number.isFinite(hi);
          if (!loOk && !hiOk) {
            started = false;
            continue;
          }
          const mid = loOk && hiOk ? (lo + hi) / 2 : loOk ? lo : hi;
          const px = x(thumb.times[i]);
          const py = y(mid);
          if (!started) {
            g.moveTo(px, py);
            started = true;
          } else {
            g.lineTo(px, py);
          }
        }
        g.stroke();
        g.globalAlpha = 1;
      }
    }

    // 基线
    g.strokeStyle = line;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(padX, baseY + 0.5);
    g.lineTo(padX + trackW, baseY + 0.5);
    g.stroke();

    // 红窗口框（当前视口）
    const wl = x(windowRange.start);
    const wr = x(windowRange.end);
    const boxW = Math.max(2, wr - wl);
    g.fillStyle = "rgba(225,6,0,0.16)";
    g.fillRect(wl, top, boxW, Math.max(1, baseY - top));
    g.strokeStyle = red;
    g.lineWidth = 1;
    g.strokeRect(wl + 0.5, top + 0.5, boxW - 1, Math.max(1, baseY - top) - 1);

    // 白色游标（实线 2px）
    const cx = Math.max(padX, Math.min(padX + trackW, x(cursorT)));
    g.strokeStyle = white;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(cx, 4);
    g.lineTo(cx, baseY + 6);
    g.stroke();
  }, [size, thumb, windowRange.start, windowRange.end, cursorT, domain.start, duration, isDragging]);

  return (
    <div
      className="timeline-bar"
      style={{
        height: "var(--timeline-height, 110px)",
        flex: "none",
        background: "var(--bg2)",
        borderTop: "1px solid var(--line)",
        display: "flex",
        flexDirection: "column",
        padding: "6px 12px 8px",
        gap: "4px",
        fontSize: "11px",
        color: "var(--dim)",
        userSelect: "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "10px", flex: "none" }}>
        <span className="f1" style={{ fontWeight: 700, letterSpacing: "1.5px", color: "var(--dim)" }}>
          TIMELINE
        </span>
        <button
          onClick={resetZoom}
          style={{
            background: "transparent",
            border: "1px solid var(--line)",
            color: "var(--dim)",
            padding: "1px 8px",
            fontSize: "10px",
            fontWeight: 700,
            letterSpacing: "1px",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
          title="Reset zoom"
        >
          RESET
        </button>
        <span className="timeline-bar__metrics tnum" style={{ marginLeft: "auto", color: "var(--dim2)" }}>
          VIEW: {windowRange.start.toFixed(2)}s ~ {windowRange.end.toFixed(2)}s (
          {(windowRange.end - windowRange.start).toFixed(2)}s) · CURSOR: {cursorT.toFixed(3)}s
        </span>
      </div>

      <div
        ref={trackRef}
        data-testid="timeline-track"
        onMouseDown={handleMouseDown}
        onClick={handleTrackClick}
        style={{
          flex: 1,
          minHeight: 0,
          position: "relative",
          overflow: "hidden",
          border: "1px solid var(--line)",
          cursor: isDragging ? "grabbing" : "grab",
        }}
      >
        <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
      </div>
    </div>
  );
};
