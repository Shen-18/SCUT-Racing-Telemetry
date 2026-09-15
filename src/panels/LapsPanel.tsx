import React, { useEffect, useState } from "react";
import type { PanelProps } from "./registry";
import { useAppStore } from "../state/appStore";
import { getLaps, type LapInfo } from "../api/client";

export const LapsPanel: React.FC<PanelProps> = () => {
  const dataset = useAppStore((s) => s.dataset);
  const [laps, setLaps] = useState<LapInfo[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (!dataset) {
      setLaps([]);
      return;
    }
    void getLaps(dataset.id)
      .then((next) => {
        if (!cancelled) setLaps(next);
      })
      .catch(() => {
        if (!cancelled) setLaps([]);
      });
    return () => {
      cancelled = true;
    };
  }, [dataset]);

  return (
    <div
      style={{
        padding: "12px",
        height: "100%",
        background: "var(--bg-panel)",
        color: "var(--text-primary)",
        fontSize: "12px",
        overflowY: "auto",
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: "8px" }}>圈速分析 (Laps)</div>
      {laps.length === 0 ? (
        <div style={{ color: "var(--text-muted)", fontSize: "11px" }}>暂无圈速数据</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
          <thead>
            <tr style={{ color: "var(--text-muted)", borderBottom: "1px solid var(--border)" }}>
              <th style={{ textAlign: "left", padding: "4px" }}>圈号</th>
              <th style={{ textAlign: "right", padding: "4px" }}>起始时间</th>
              <th style={{ textAlign: "right", padding: "4px" }}>圈速时长</th>
            </tr>
          </thead>
          <tbody>
            {laps.map((lap) => (
              <tr key={lap.index} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                <td style={{ padding: "4px" }}>Lap {lap.index}</td>
                <td style={{ textAlign: "right", padding: "4px" }}>{lap.start.toFixed(2)}s</td>
                <td style={{ textAlign: "right", padding: "4px" }}>{lap.duration.toFixed(3)}s</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};
