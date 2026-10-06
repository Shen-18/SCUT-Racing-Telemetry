export interface TrackGeometryInput {
  width: number;
  height: number;
  topInset: number;
  bottomInset: number;
  leftInset: number;
  rightInset: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  zoom: number;
}

export interface TrackGeometry {
  scaleX: number;
  scaleY: number;
  contentWidth: number;
  contentHeight: number;
  originX: number;
  originY: number;
}

export function observeTrackResize(element: Element, repaint: () => void): () => void {
  if (typeof ResizeObserver === "undefined") return () => undefined;
  const observer = new ResizeObserver(() => repaint());
  observer.observe(element);
  return () => observer.disconnect();
}

/** Fit the track into the usable canvas area with one physical scale. */
export function fitTrackGeometry(input: TrackGeometryInput): TrackGeometry {
  const spanX = Math.max(1e-9, input.maxX - input.minX);
  const spanY = Math.max(1e-9, input.maxY - input.minY);
  const usableWidth = Math.max(1, input.width - input.leftInset - input.rightInset);
  const usableHeight = Math.max(1, input.height - input.topInset - input.bottomInset);
  const scale = Math.min(usableWidth / spanX, usableHeight / spanY) * Math.max(0.01, input.zoom);
  const contentWidth = spanX * scale;
  const contentHeight = spanY * scale;
  return {
    scaleX: scale,
    scaleY: scale,
    contentWidth,
    contentHeight,
    originX: input.leftInset + (usableWidth - contentWidth) / 2 - input.minX * scale,
    originY: input.topInset + (usableHeight - contentHeight) / 2 - input.minY * scale,
  };
}
