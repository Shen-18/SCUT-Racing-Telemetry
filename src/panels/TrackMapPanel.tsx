import React, { useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "../state/appStore";
import * as client from "../api/client";
import type { WindowFrame } from "../api/types";
import { getDatasetDuration } from "../api/dataset";
import { formatClockTime } from "../utils/time";
import { fullFraction } from "../utils/viewport";
import { resolveColor } from "../theme/channelColors";

// B.4-P6 rev.5 赛道图（右栏上 300px）：单线轨迹 + 红色起终点 + 红色车箭头
// + 尾迹 + HUD（TIME / SPEED）+ 右上缩放钮。
// 数据 = GPS Latitude/Longitude 全程包络（桶中线近似轨迹，等比投影按纬度修正）。
// 弯道编号无数据源不绘制（DESIGN-SPEC 9.4）。

const ZOOM_MIN = 0.6;
const ZOOM_MAX = 3;
const ZOOM_STEP = 1.25;
const TRAIL_SECONDS = 11;

interface TrackPoint {
  x: number;
  y: number;
}

function findChannelKey(
  channels: Array<{ key: string; name: string }>,
  pattern: RegExp
): string | null {
  const matches = channels.filter((c) => pattern.test(c.name));
  if (matches.length === 0) return null;
  const real = matches.find((c) => !c.name.includes("(AiM Interpolated)"));
  return (real ?? matches[0]).key;
}

function fitCanvas(cv: HTMLCanvasElement): [CanvasRenderingContext2D, number, number] {
  const dpr = globalThis.devicePixelRatio || 1;
  const w = cv.clientWidth;
  const h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
  }
  const g = cv.getContext("2d")!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return [g, w, h];
}

export const TrackMapPanel: React.FC = () => {
  const dataset = useAppStore((s) => s.dataset);
  const cursorT = useAppStore((s) => s.cursorT);
  const theme = useAppStore((s) => s.theme);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(1);
  const [latFrame, setLatFrame] = useState<WindowFrame | null>(null);
  const [lonFrame, setLonFrame] = useState<WindowFrame | null>(null);
  const [speedFrame, setSpeedFrame] = useState<WindowFrame | null>(null);

  const duration = dataset ? getDatasetDuration(dataset) : 0;

  const latKey = useMemo(
    () => (dataset ? findChannelKey(dataset.channels, /latitude/i) : null),
    [dataset]
  );
  const lonKey = useMemo(
    () => (dataset ? findChannelKey(dataset.channels, /longitude/i) : null),
    [dataset]
  );
  const speedKey = useMemo(() => {
    if (!dataset) return null;
    return client.selectDefaultSpeedChannel(dataset.channels) ?? dataset.channels[0]?.key ?? null;
  }, [dataset]);

  // 全程包络拉取（数据集变化时一次）
  useEffect(() => {
    setLatFrame(null);
    setLonFrame(null);
    setSpeedFrame(null);
    if (!dataset || duration <= 0 || !latKey || !lonKey) return;
    let cancelled = false;
    client
      .windowSeries(dataset.id, latKey, 0, duration, 1024, 0)
      .then((f) => !cancelled && setLatFrame(f))
      .catch(() => undefined);
    client
      .windowSeries(dataset.id, lonKey, 0, duration, 1024, 0)
      .then((f) => !cancelled && setLonFrame(f))
      .catch(() => undefined);
    if (speedKey) {
      client
        .windowSeries(dataset.id, speedKey, 0, duration, 512, 0)
        .then((f) => !cancelled && setSpeedFrame(f))
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [dataset?.id]);

  // 轨迹点（等比投影，米制）——包络桶中线近似
  const track: TrackPoint[] = useMemo(() => {
    if (!latFrame || !lonFrame || latFrame.times.length === 0) return [];
    const n = Math.min(latFrame.times.length, lonFrame.times.length);
    if (n < 2) return [];
    let latMin = Infinity;
    let latMax = -Infinity;
    let lonMin = Infinity;
    let lonMax = -Infinity;
    for (let i = 0; i < n; i++) {
      const la = (latFrame.mins[i] + latFrame.maxs[i]) / 2;
      const lo = (lonFrame.mins[i] + lonFrame.maxs[i]) / 2;
      if (Number.isFinite(la) && Number.isFinite(lo)) {
        if (la < latMin) latMin = la;
        if (la > latMax) latMax = la;
        if (lo < lonMin) lonMin = lo;
        if (lo > lonMax) lonMax = lo;
      }
    }
    if (!Number.isFinite(latMin) || latMax - latMin < 1e-9) return [];
    const lat0 = (latMin + latMax) / 2;
    const mPerDegLat = 110540;
    const mPerDegLon = 111320 * Math.cos((lat0 * Math.PI) / 180);
    const points: TrackPoint[] = [];
    for (let i = 0; i < n; i++) {
      const la = (latFrame.mins[i] + latFrame.maxs[i]) / 2;
      const lo = (lonFrame.mins[i] + lonFrame.maxs[i]) / 2;
      if (!Number.isFinite(la) || !Number.isFinite(lo)) continue;
      points.push({
        x: ((lo - lonMin) * mPerDegLon) / ((latMax - latMin) * mPerDegLat || 1),
        y: 1 - (la - latMin) / (latMax - latMin),
      });
    }
    return points;
  }, [latFrame, lonFrame]);

  // 绘制
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const [g, w, h] = fitCanvas(cv);
    g.clearRect(0, 0, w, h);
    const style = getComputedStyle(document.documentElement);
    const red = resolveColor("var(--red)", style);
    const text = resolveColor("var(--text)", style);
    const dim = resolveColor("var(--dim)", style);
    const dim2 = resolveColor("var(--dim2)", style);

    if (track.length < 2) {
      g.fillStyle = dim2;
      g.font = "600 12px Titillium, 'Microsoft YaHei', sans-serif";
      g.textAlign = "center";
      g.fillText(dataset ? "该记录无 GPS 数据 / NO GPS DATA" : "未加载数据集", w / 2, h / 2);
      return;
    }

    // 归一化：轨迹占 min(w,h)×0.82×zoom，居中偏上
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of track) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const spanX = Math.max(1e-9, maxX - minX);
    const spanY = Math.max(1e-9, maxY - minY);
    const scale = Math.min(w, h) * 0.82 * zoom;
    const contentW = (spanX / Math.max(spanX, spanY)) * scale;
    const contentH = (spanY / Math.max(spanX, spanY)) * scale;
    const ox = (w - contentW) / 2 - (minX / Math.max(spanX, spanY)) * scale;
    const oy = (h - 24 - contentH) / 2 - (minY / Math.max(spanX, spanY)) * scale;
    const P = (p: TrackPoint): [number, number] => [
      ox + (p.x / Math.max(spanX, spanY)) * scale,
      oy + (p.y / Math.max(spanX, spanY)) * scale,
    ];

    g.lineJoin = "round";
    g.lineCap = "round";
    // 轨迹单线（负责人走查：白管双层已删，只留一条线）
    g.beginPath();
    track.forEach((p, i) => {
      const [x, y] = P(p);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    });
    g.strokeStyle = withAlpha(text, 0.9);
    g.lineWidth = 1.5;
    g.stroke();
    // 起终点线（红 2×10）
    const [sx, sy] = P(track[0]);
    g.fillStyle = red;
    g.fillRect(sx - 1, sy - 5, 2, 10);
    // 车辆 + 尾迹
    const frac = fullFraction(cursorT, duration);
    const carIdx = Math.min(track.length - 1, Math.floor(frac * track.length));
    const trailCount = Math.max(
      1,
      Math.min(carIdx + 1, Math.round((TRAIL_SECONDS / Math.max(duration, 1e-9)) * track.length))
    );
    g.strokeStyle = withAlpha(text, 0.35);
    g.lineWidth = 1.5;
    g.beginPath();
    for (let k = trailCount; k >= 0; k--) {
      const idx = Math.max(0, carIdx - k);
      const [x, y] = P(track[idx]);
      if (k === trailCount) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    const [cx, cy] = P(track[carIdx]);
    const nextIdx = Math.min(track.length - 1, carIdx + 1);
    const prevIdx = Math.max(0, carIdx - 1);
    const angle = Math.atan2(
      P(track[nextIdx])[1] - P(track[prevIdx])[1],
      P(track[nextIdx])[0] - P(track[prevIdx])[0]
    );
    g.save();
    g.translate(cx, cy);
    g.rotate(angle);
    g.fillStyle = red;
    g.beginPath();
    g.moveTo(5.5, 0);
    g.lineTo(-3.5, 3);
    g.lineTo(-1.8, 0);
    g.lineTo(-3.5, -3);
    g.closePath();
    g.fill();
    g.strokeStyle = text;
    g.lineWidth = 1;
    g.stroke();
    g.restore();
    void dim;
  }, [track, cursorT, duration, zoom, theme, dataset]);

  // HUD 速度（全程速度包络中线，按游标比例取最近桶）
  const hudSpeed = useMemo(() => {
    if (!speedFrame || speedFrame.times.length === 0 || duration <= 0) return null;
    const idx = Math.min(
      speedFrame.times.length - 1,
      Math.floor(fullFraction(cursorT, duration) * speedFrame.times.length)
    );
    const v = (speedFrame.mins[idx] + speedFrame.maxs[idx]) / 2;
    return Number.isFinite(v) ? Math.round(v) : null;
  }, [speedFrame, cursorT, duration]);

  const zoomButtons: Array<{ label: string; action: () => void; title: string }> = [
    { label: "＋", action: () => setZoom((z) => Math.min(ZOOM_MAX, z * ZOOM_STEP)), title: "放大" },
    { label: "－", action: () => setZoom((z) => Math.max(ZOOM_MIN, z / ZOOM_STEP)), title: "缩小" },
    { label: "⟲", action: () => setZoom(1), title: "复位" },
  ];

  return (
    <div
      data-testid="track-map"
      style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}
    >
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
      {/* HUD（左上） */}
      <div style={{ position: "absolute", top: "10px", left: "12px", pointerEvents: "none", zIndex: 2 }}>
        <div style={{ fontWeight: 700, fontSize: "10px", letterSpacing: "2px", color: "var(--dim)" }}>
          TIME
        </div>
        <div className="tnum" style={{ fontWeight: 700, fontSize: "22px", color: "var(--text)" }}>
          {formatClockTime(cursorT)}
        </div>
        <div style={{ fontWeight: 700, fontSize: "10px", letterSpacing: "2px", color: "var(--dim)", marginTop: "6px" }}>
          SPEED
        </div>
        <div className="tnum" style={{ fontWeight: 700, fontSize: "22px", color: "var(--text)" }}>
          {hudSpeed ?? "--"} <span style={{ fontSize: "11px", color: "var(--dim)", fontWeight: 700 }}>km/h</span>
        </div>
      </div>
      {/* 缩放按钮（右上纵排） */}
      <div style={{ position: "absolute", top: "10px", right: "10px", display: "flex", flexDirection: "column", gap: "4px", zIndex: 2 }}>
        {zoomButtons.map((btn) => (
          <button
            key={btn.label}
            onClick={btn.action}
            title={btn.title}
            className="ghost-button"
            style={{
              width: "26px",
              height: "26px",
              background: "var(--panel)",
              border: "1px solid var(--line)",
              color: "var(--text)",
              fontWeight: 700,
              fontSize: "13px",
              cursor: "pointer",
              padding: 0,
            }}
          >
            {btn.label}
          </button>
        ))}
      </div>
    </div>
  );
};

function withAlpha(color: string, alpha: number): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!hex) return color;
  const value = parseInt(hex[1], 16);
  return `rgba(${(value >> 16) & 0xff},${(value >> 8) & 0xff},${value & 0xff},${alpha})`;
}
