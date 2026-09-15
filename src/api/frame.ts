import type { FrameHeader } from "./types";

export interface WindowFrame {
  header: FrameHeader;
  times: Float64Array;
  mins: Float32Array;
  maxs: Float32Array;
}
export type FrameBytes = ArrayBuffer | Uint8Array | number[];
const invalid = (reason: string): never => { throw new Error(`Invalid SXK1 frame: ${reason}`); };
const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export function decodeFrame(input: FrameBytes): WindowFrame;
export function decodeFrame(input: FrameBytes, generation: number): WindowFrame;
export function decodeFrame(input: FrameBytes, generation?: number): WindowFrame | null {
  if (Array.isArray(input) && input.some(v => !Number.isInteger(v) || v < 0 || v > 255)) invalid("invalid byte");
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < 8 || bytes[0] !== 83 || bytes[1] !== 88 || bytes[2] !== 75 || bytes[3] !== 49) invalid("magic");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const offset = 8 + view.getUint32(4, true);
  if (offset > bytes.length) invalid("truncated header");
  const h: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(8, offset)));
  if (!h || typeof h !== "object" || Array.isArray(h)) invalid("header object required");
  const header = h as FrameHeader;
  if (typeof header.channel !== "string" || typeof header.unit !== "string" ||
    !count(header.buckets) || !count(header.full_count) || !count(header.generation) ||
    typeof header.win_start !== "number" || !Number.isFinite(header.win_start) ||
    typeof header.win_end !== "number" || !Number.isFinite(header.win_end) || header.win_end < header.win_start) invalid("header fields");
  const n = header.buckets;
  if (bytes.length - offset !== n * 16) invalid("payload length/buckets mismatch");
  if (generation !== undefined && header.generation !== generation) return null;
  // JSON is variable-length: typed-array views may be unaligned and host endian dependent.
  const times = new Float64Array(n), mins = new Float32Array(n), maxs = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    times[i] = view.getFloat64(offset + i * 8, true);
    if (!Number.isFinite(times[i]) || (i > 0 && times[i] < times[i - 1])) invalid("time order");
    mins[i] = view.getFloat32(offset + n * 8 + i * 4, true);
    maxs[i] = view.getFloat32(offset + n * 12 + i * 4, true);
    if (Number.isFinite(mins[i]) && Number.isFinite(maxs[i]) && mins[i] > maxs[i]) invalid("inverted envelope");
  }
  return { header, times, mins, maxs };
}


