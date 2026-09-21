export interface SampleRange {
  start: number;
  end: number;
}

export function getSampleRange(values: ArrayLike<number>): SampleRange | null {
  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < values.length; index += 1) {
    const value = Number(values[index]);
    if (!Number.isFinite(value)) continue;
    start = Math.min(start, value);
    end = Math.max(end, value);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return { start, end };
}

export function clampToSampleRange(value: number, range: SampleRange | null): number {
  if (!range || !Number.isFinite(value)) return range?.start ?? value;
  return Math.max(range.start, Math.min(range.end, value));
}

export function clampWindowToSampleRange(window: SampleRange, range: SampleRange | null): SampleRange {
  if (!range) return window;
  const rangeSpan = Math.max(0, range.end - range.start);
  const requestedSpan = Math.max(0, window.end - window.start);
  const span = Math.min(requestedSpan, rangeSpan);
  if (span === 0) return { start: range.start, end: range.end };
  let start = Math.max(range.start, Math.min(range.end - span, window.start));
  if (!Number.isFinite(start)) start = range.start;
  return { start, end: start + span };
}
