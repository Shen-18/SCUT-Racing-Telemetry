import { describe, expect, it } from "vitest";
import { decodeFrame } from "./frame";

export function wireFrame(generation = 7, overrides = {}, samples = [12, 24]) {
  const header = new TextEncoder().encode(JSON.stringify({ channel: "Speed", unit: "km/h",
    buckets: samples.length, win_start: 0, win_end: 2, full_count: 100, generation, ...overrides }));
  const bytes = new Uint8Array(8 + header.length + samples.length * 16);
  bytes.set([83, 88, 75, 49]);
  const view = new DataView(bytes.buffer);
  view.setUint32(4, header.length, true);
  bytes.set(header, 8);
  samples.forEach((v, i) => {
    view.setFloat64(8 + header.length + i * 8, i, true);
    view.setFloat32(8 + header.length + samples.length * 8 + i * 4, v, true);
    view.setFloat32(8 + header.length + samples.length * 12 + i * 4, v + 1, true);
  });
  return bytes;
}

describe("SXK1 decoder", () => {
  it("decodes little endian unaligned arrays and retains metadata", () => {
    const frame = decodeFrame(wireFrame());
    expect(frame.header).toMatchObject({ generation: 7, unit: "km/h", full_count: 100 });
    expect([...frame.times]).toEqual([0, 1]);
    expect([...frame.mins]).toEqual([12, 24]);
    expect([...frame.maxs]).toEqual([13, 25]);
  });
  it("supports byte-array IPC, ArrayBuffer and offset views", () => {
    const bytes = wireFrame();
    const padded = new Uint8Array(bytes.length + 3); padded.set(bytes, 3);
    for (const input of [Array.from(bytes), bytes.buffer, padded.subarray(3)]) {
      expect(decodeFrame(input).header.generation).toBe(7);
    }
  });
  it("discards mismatched generations", () => {
    expect(decodeFrame(wireFrame(), 8)).toBeNull();
    expect(decodeFrame(wireFrame(), 7)?.header.generation).toBe(7);
  });
  it("rejects bad magic, truncated header/payload and trailing bytes", () => {
    const badMagic = wireFrame(); badMagic[0] = 0;
    for (const bytes of [new Uint8Array(), badMagic, wireFrame().slice(0, 9), wireFrame().slice(0, -1),
      new Uint8Array([...wireFrame(), 0])]) expect(() => decodeFrame(bytes)).toThrow();
  });
  it("rejects malformed JSON and invalid required header fields", () => {
    const json = wireFrame(); json[8] = 255;
    expect(() => decodeFrame(json)).toThrow();
    for (const fields of [{ buckets: 3 }, { generation: -1 }, { generation: 1.5 },
      { full_count: -1 }, { unit: null }, { channel: 42 }, { win_end: -1 }, { win_start: null }]) {
      expect(() => decodeFrame(wireFrame(7, fields))).toThrow();
    }
  });
  it("rejects unsorted/nonfinite times but keeps missing samples as gaps", () => {
    const bytes = wireFrame(); const view = new DataView(bytes.buffer);
    view.setFloat64(8 + view.getUint32(4, true), Infinity, true);
    expect(() => decodeFrame(bytes)).toThrow();
    expect(Number.isNaN(decodeFrame(wireFrame(7, {}, [NaN])).mins[0])).toBe(true);
  });
});
