import React, { useEffect, useMemo, useState } from "react";
import { useAppStore } from "../state/appStore";
import * as client from "../api/client";
import { getDatasetDuration } from "../api/dataset";
import { buildChannelColorMap, resolveColor } from "../theme/channelColors";
import { useCursorValues } from "../hooks/useCursorValues";

// B.4-P5 rev.5 通道详情（右栏下半，滚动）：每勾选通道一张卡。
// 当前值 = CursorValues（节流 hook），F1 Display 700 24px；
// MIN/MAX/AVG = 全程统计（Stats 命令 Rust 侧计算，300ms 防抖）。

function formatStat(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  if (Number.isInteger(value)) return value.toFixed(0);
  return value.toFixed(2);
}

function formatCurrentValue(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "--";
  if (Math.abs(value) >= 1000) return value.toFixed(0);
  if (Number.isInteger(value)) return value.toFixed(0);
  return value.toFixed(2);
}

interface ChannelStats {
  min: number;
  max: number;
  mean: number;
  std_dev: number;
}

export const StatsPanel: React.FC = () => {
  const dataset = useAppStore((s) => s.dataset);
  const activeRange = useAppStore((s) => s.activeRange);
  const checkedChannels = useAppStore((s) => s.checkedChannels);
  const cursorT = useAppStore((s) => s.cursorT);
  const rangeStart = activeRange?.start ?? 0;
  const duration = activeRange?.end ?? (dataset ? getDatasetDuration(dataset) : 0);

  const [stats, setStats] = useState<Record<string, ChannelStats>>({});
  const [statsError, setStatsError] = useState<string | null>(null);

  const colorMap = useMemo(
    () => buildChannelColorMap(dataset?.channels.map((c) => c.name) ?? []),
    [dataset]
  );
  const channelByKey = useMemo(() => {
    const map = new Map<string, { name: string; unit: string }>();
    for (const channel of dataset?.channels ?? []) {
      map.set(channel.key, { name: channel.name, unit: channel.unit });
    }
    return map;
  }, [dataset]);

  const ordered = checkedChannels.filter((key) => channelByKey.has(key));
  const signature = ordered.join("\u0000");
  const cursorValues = useCursorValues(dataset?.id ?? null, ordered, cursorT, duration);

  // 全程统计：勾选集合/数据集变化后 300ms 防抖请求（全程口径 0..duration）
  useEffect(() => {
    if (!dataset || ordered.length === 0) {
      setStats({});
      setStatsError(null);
      return;
    }
    const stateRef = { cancelled: false, timer: 0 };
    stateRef.timer = globalThis.setTimeout(() => {
      client
        .getStats(dataset.id, [...ordered], rangeStart, duration)
        .then((result) => {
          if (!stateRef.cancelled) {
            setStats(result);
            setStatsError(null);
          }
        })
        .catch((err: unknown) => {
          if (!stateRef.cancelled) {
            setStatsError(err instanceof Error ? err.message : String(err));
          }
        });
    }, 300);
    return () => {
      stateRef.cancelled = true;
      globalThis.clearTimeout(stateRef.timer);
    };
  }, [dataset?.id, signature, rangeStart, duration]);

  if (!dataset) {
    return (
      <div style={{ padding: "12px 14px", color: "var(--dim2)", fontSize: "12px", fontWeight: 600 }}>
        未加载数据集
      </div>
    );
  }

  return (
    <div data-testid="channel-details" style={{ color: "var(--text)" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          fontFamily: '"F1 Display", "Microsoft YaHei", sans-serif',
          fontWeight: 700,
          fontSize: "12px",
          letterSpacing: "2px",
          color: "var(--dim)",
          padding: "12px 14px 8px",
        }}
      >
        <span style={{ width: "3px", height: "12px", background: "var(--red)", display: "inline-block", flex: "none" }} />
        CHANNEL DETAIL
      </div>
      {statsError && (
        <div style={{ margin: "0 14px 8px", borderLeft: "3px solid var(--red)", background: "var(--bg2)", padding: "6px 10px", fontSize: "11px", color: "var(--dim)" }}>
          {statsError}
        </div>
      )}
      {ordered.length === 0 ? (
        <div style={{ padding: "12px 14px", color: "var(--dim2)", fontSize: "12px", fontWeight: 600 }}>
          勾选通道后显示详情 / SELECT CHANNELS
        </div>
      ) : (
        ordered.map((key) => {
          const meta = channelByKey.get(key)!;
          const color = resolveColor(colorMap[meta.name] ?? "var(--dim)");
          const stat = stats[key];
          return (
            <div
              key={key}
              style={{ padding: "10px 14px", borderBottom: "1px solid rgba(127,127,127,0.35)" }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                <span style={{ width: "3px", height: "12px", background: color, display: "inline-block", flex: "none" }} />
                <span style={{ fontWeight: 700, fontSize: "12px", letterSpacing: "1.5px" }}>{meta.name}</span>
                <span style={{ marginLeft: "auto", color: "var(--dim2)", fontSize: "11px", fontWeight: 600 }}>
                  {meta.unit}
                </span>
              </div>
              <div className="f1 tnum" style={{ fontWeight: 700, fontSize: "24px", lineHeight: 1 }}>
                {formatCurrentValue(cursorValues[key])}
                {meta.unit && (
                  <span
                    style={{
                      fontFamily: "Titillium, 'Microsoft YaHei', sans-serif",
                      fontSize: "11px",
                      color: "var(--dim)",
                      fontWeight: 700,
                      marginLeft: "4px",
                    }}
                  >
                    {meta.unit}
                  </span>
                )}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "6px", marginTop: "8px" }}>
                {(
                  [
                    ["MIN", formatStat(stat?.min), "var(--green)"],
                    ["MAX", formatStat(stat?.max), "var(--red)"],
                    ["AVG", formatStat(stat?.mean), "var(--text)"],
                  ] as const
                ).map(([label, value, colorValue]) => (
                  <div key={label} style={{ background: "var(--bg2)", padding: "5px 8px" }}>
                    <div style={{ fontSize: "9px", color: "var(--dim2)", letterSpacing: "1.5px", fontWeight: 600 }}>
                      {label}
                    </div>
                    <div className="tnum" style={{ fontWeight: 700, fontSize: "13px", marginTop: "2px", color: colorValue }}>
                      {value}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
};
