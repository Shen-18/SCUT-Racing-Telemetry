import React, { useRef, useState, useEffect, useCallback } from "react";
import { useAppStore } from "../state/appStore";
import { getDatasetDuration } from "../api/dataset";

const TIMELINE_PAN_INTERVAL_MS = 50;

export function timelinePanThrottleDelay(lastDispatchAt: number, now: number): number {
  if (lastDispatchAt <= 0) return 0;
  return Math.max(0, TIMELINE_PAN_INTERVAL_MS - (now - lastDispatchAt));
}

export function calculateTimelinePan(
  deltaX: number,
  trackWidth: number,
  duration: number,
  origWindow: { start: number; end: number }
): { start: number; end: number } {
  if (trackWidth <= 0 || duration <= 0) return origWindow;
  const span = Math.max(0.001, origWindow.end - origWindow.start);
  const dt = (deltaX / trackWidth) * duration;
  let newStart = origWindow.start + dt;
  let newEnd = origWindow.end + dt;

  if (newStart < 0) {
    newStart = 0;
    newEnd = Math.min(duration, span);
  } else if (newEnd > duration) {
    newEnd = duration;
    newStart = Math.max(0, duration - span);
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

  const windowRange = props.window ?? storeWindow;
  const cursorT = props.cursorT ?? storeCursorT;
  const duration = props.duration ?? (storeDataset ? getDatasetDuration(storeDataset) : Math.max(1, windowRange.end));

  const trackRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const lastDispatchAtRef = useRef(0);
  const pendingWindowRef = useRef<{ start: number; end: number } | null>(null);
  const panTimerRef = useRef<number | undefined>();
  const dragStartRef = useRef<{ clientX: number; origWindow: { start: number; end: number } }>({
    clientX: 0,
    origWindow: { start: 0, end: 1 },
  });

  const leftPercent = Math.max(0, Math.min(100, (windowRange.start / duration) * 100));
  const widthPercent = Math.max(0.5, Math.min(100, ((windowRange.end - windowRange.start) / duration) * 100));
  const cursorPercent = Math.max(0, Math.min(100, (cursorT / duration) * 100));

  const resetZoom = () => {
    setWindow({ start: 0, end: duration });
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
        dragStartRef.current.origWindow
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
  }, [isDragging, duration, setWindow]);

  // Click on track outside slider to jump / center viewport
  const handleTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const track = trackRef.current;
    if (!track || isDragging) return;
    const rect = track.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickT = (clickX / rect.width) * duration;
    const span = windowRange.end - windowRange.start;
    const half = span / 2;
    let newStart = clickT - half;
    let newEnd = clickT + half;
    if (newStart < 0) {
      newStart = 0;
      newEnd = Math.min(duration, span);
    } else if (newEnd > duration) {
      newEnd = duration;
      newStart = Math.max(0, duration - span);
    }
    setWindow({ start: newStart, end: newEnd });
  };

  return (
    <div
      className="timeline-bar"
      style={{
        height: "36px",
        background: "var(--bg-panel)",
        borderTop: "1px solid var(--border)",
        display: "flex",
        alignItems: "center",
        padding: "0 16px",
        gap: "16px",
        fontSize: "11px",
        color: "var(--text-muted)",
        userSelect: "none",
      }}
    >
      <div className="timeline-bar__title" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
        <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>时间轴</span>
        <button
          onClick={resetZoom}
          style={{
            background: "transparent",
            border: "1px solid var(--border)",
            color: "var(--text-muted)",
            borderRadius: "3px",
            padding: "2px 6px",
            fontSize: "10px",
            cursor: "pointer",
          }}
          title="重置缩放"
        >
          重置
        </button>
      </div>

      <div
        ref={trackRef}
        data-testid="timeline-track"
        onClick={handleTrackClick}
        style={{
          flex: 1,
          minWidth: "80px",
          height: "16px",
          background: "var(--bg-app)",
          borderRadius: "4px",
          position: "relative",
          overflow: "hidden",
          border: "1px solid var(--border-subtle)",
          cursor: "pointer",
        }}
      >
        {/* Active window indicator / slider */}
        <div
          data-testid="timeline-slider"
          onMouseDown={handleMouseDown}
          style={{
            position: "absolute",
            left: `${leftPercent}%`,
            width: `${widthPercent}%`,
            top: 0,
            bottom: 0,
            background: "var(--accent-subtle)",
            borderLeft: "2px solid var(--accent)",
            borderRight: "2px solid var(--accent)",
            cursor: isDragging ? "grabbing" : "grab",
            zIndex: 2,
          }}
        />
        {/* Cursor indicator */}
        <div
          style={{
            position: "absolute",
            left: `${cursorPercent}%`,
            top: 0,
            bottom: 0,
            width: "2px",
            background: "var(--status-ready)",
            zIndex: 3,
            pointerEvents: "none",
          }}
        />
      </div>

      <div className="timeline-bar__metrics" style={{ display: "flex", gap: "12px", fontVariantNumeric: "tabular-nums" }}>
        <span>
          视口: {windowRange.start.toFixed(2)}s ~ {windowRange.end.toFixed(2)}s (
          {(windowRange.end - windowRange.start).toFixed(2)}s)
        </span>
        <span>游标: {cursorT.toFixed(3)}s</span>
        <span>总长: {duration.toFixed(2)}s</span>
      </div>
    </div>
  );
};
