import React, { useEffect, useRef, useState } from "react";
import { ColumnSplitter, clampSplitterWidth } from "./ColumnSplitter";

export const ResizableColumns: React.FC<{
  storageKey: string;
  defaultLeft: number;
  defaultRight?: number;
  minLeft?: number;
  minCenter?: number;
  left: React.ReactNode;
  center: React.ReactNode;
  right: React.ReactNode;
}> = ({ storageKey, defaultLeft, defaultRight = 220, minLeft = 180, minCenter = 460, left, center, right }) => {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [sizes, setSizes] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null") as { left?: number; right?: number } | null;
      return {
        left: typeof saved?.left === "number" && Number.isFinite(saved.left) ? saved.left : defaultLeft,
        right: typeof saved?.right === "number" && Number.isFinite(saved.right) ? saved.right : defaultRight,
      };
    } catch { return { left: defaultLeft, right: defaultRight }; }
  });
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const resize = () => setWidth(element.clientWidth);
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(sizes)); } catch { /* 当前会话仍可拖动 */ }
  }, [sizes, storageKey]);

  const available = width > 0 ? width - 12 - minCenter : Infinity;
  const leftWidth = clampSplitterWidth(sizes.left, minLeft, Math.max(minLeft, Math.min(440, available - 180)));
  const rightWidth = clampSplitterWidth(sizes.right, 180, Math.max(180, Math.min(400, available - leftWidth)));
  return (
    <div
      ref={container}
      className="overlay-columns"
      style={{ flex: 1, minHeight: 0, minWidth: 0, display: "grid", gridTemplateColumns: `${leftWidth}px 6px minmax(0, 1fr) 6px ${rightWidth}px` }}
    >
      {left}
      <ColumnSplitter side="left" startWidth={leftWidth} minWidth={minLeft} maxWidth={Math.max(minLeft, Math.min(440, available - rightWidth))} onResize={(value) => setSizes((previous) => ({ ...previous, left: value }))} />
      {center}
      <ColumnSplitter side="right" startWidth={rightWidth} minWidth={180} maxWidth={Math.max(180, Math.min(400, available - leftWidth))} onResize={(value) => setSizes((previous) => ({ ...previous, right: value }))} />
      {right}
    </div>
  );
};
