import React, { useCallback, useEffect, useRef, useState } from "react";

// 三栏布局拖宽分割条（手册附录 B.2 rev.5）
// 视觉 1px --line、命中区 6px，hover 与拖拽中变 --red（样式见 index.css）。
// 拖拽位移经 rAF 节流后写入 store，避免高频重渲染。

export interface ColumnSplitterProps {
  /** 向右拖动时宽度增加（left）或减少（right） */
  side: "left" | "right";
  startWidth: number;
  minWidth: number;
  maxWidth: number;
  onResize: (width: number) => void;
}

export function columnWidthFromDrag(
  side: "left" | "right",
  startWidth: number,
  deltaX: number
): number {
  return side === "left" ? startWidth + deltaX : startWidth - deltaX;
}

export function clampSplitterWidth(width: number, minWidth: number, maxWidth: number): number {
  if (!Number.isFinite(width)) return minWidth;
  return Math.max(minWidth, Math.min(maxWidth, Math.round(width)));
}

export const ColumnSplitter: React.FC<ColumnSplitterProps> = ({
  side,
  startWidth,
  minWidth,
  maxWidth,
  onResize,
}) => {
  const [dragging, setDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; width: number } | null>(null);
  const pendingWidthRef = useRef<number | null>(null);
  const rafRef = useRef<number>(0);

  const flushPending = useCallback(() => {
    rafRef.current = 0;
    if (pendingWidthRef.current === null) return;
    onResize(pendingWidthRef.current);
    pendingWidthRef.current = null;
  }, [onResize]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      if (!dragStartRef.current) return;
      const raw = columnWidthFromDrag(
        side,
        dragStartRef.current.width,
        e.clientX - dragStartRef.current.x
      );
      pendingWidthRef.current = clampSplitterWidth(raw, minWidth, maxWidth);
      if (!rafRef.current) {
        rafRef.current = globalThis.requestAnimationFrame(flushPending);
      }
    };
    const onUp = () => setDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (rafRef.current) {
        globalThis.cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
    };
  }, [dragging, side, minWidth, maxWidth, flushPending]);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    dragStartRef.current = { x: e.clientX, width: startWidth };
    setDragging(true);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      className={`column-splitter${dragging ? " column-splitter--drag" : ""}`}
      data-side={side}
      onMouseDown={handleMouseDown}
      onDoubleClick={() =>
        onResize(clampSplitterWidth((minWidth + maxWidth) / 2, minWidth, maxWidth))
      }
    >
      <span className="column-splitter__line" />
    </div>
  );
};
