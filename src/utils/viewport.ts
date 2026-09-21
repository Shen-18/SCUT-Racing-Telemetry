// 时间窗视口运算（手册附录 B.11 交互约定）
// zoomAt：以鼠标横向位置为焦点缩放，焦点保持在原时间点；窗口最小 2s、最大全程。
// panViewport：窗口跟手平移（鼠标右拖 → 窗口右移），位移按窗口宽度换算，触边 clamp。

export interface Viewport {
  start: number;
  end: number;
}

export const MIN_WINDOW_S = 2;

export function clampViewport(vp: Viewport, duration: number, minSpan = MIN_WINDOW_S): Viewport {
  const durationSafe = duration > 0 ? duration : minSpan;
  let span = Math.min(Math.max(vp.end - vp.start, minSpan), durationSafe);
  const start = Math.min(Math.max(vp.start, 0), durationSafe - span);
  // duration 太小时（< minSpan）允许窗口小于 minSpan 而不是溢出
  if (durationSafe < minSpan) span = durationSafe;
  return { start, end: start + span };
}

export function zoomAtViewport(
  vp: Viewport,
  duration: number,
  focal: number,
  factor: number
): Viewport {
  const f = Math.min(1, Math.max(0, focal));
  const span = Math.max(0, vp.end - vp.start);
  const anchor = vp.start + f * span;
  const nextSpan = span * factor;
  const clamped = clampViewport({ start: anchor - f * nextSpan, end: anchor + (1 - f) * nextSpan }, duration);
  return clamped;
}

export function panViewport(
  vp: Viewport,
  duration: number,
  deltaFraction: number
): Viewport {
  const span = Math.max(0, vp.end - vp.start);
  const dt = deltaFraction * span;
  return clampViewport({ start: vp.start + dt, end: vp.end + dt }, duration);
}

/** 游标时间 → 绘图区比例 [0,1]；窗外返回 null（图表不画线）。 */
export function cursorFraction(t: number, vp: Viewport): number | null {
  const span = vp.end - vp.start;
  if (span <= 0) return null;
  const f = (t - vp.start) / span;
  return f >= 0 && f <= 1 ? f : null;
}

/** 全程比例 [0,1]（时间轴游标线 / 赛道图车辆索引用，clamp 到范围内）。 */
export function fullFraction(t: number, duration: number): number {
  if (duration <= 0) return 0;
  return Math.min(1, Math.max(0, t / duration));
}
