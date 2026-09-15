import React from "react";
import type { PanelProps } from "./registry";
import { useAppStore } from "../state/appStore";

export const StatsPanel: React.FC<PanelProps> = () => {
  const currentFrame = useAppStore((s) => s.currentFrame);
  const checkedChannels = useAppStore((s) => s.checkedChannels);

  let minVal = "—";
  let maxVal = "—";
  if (currentFrame && currentFrame.mins.length > 0) {
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < currentFrame.mins.length; i++) {
      if (Number.isFinite(currentFrame.mins[i])) {
        if (currentFrame.mins[i] < min) min = currentFrame.mins[i];
      }
      if (Number.isFinite(currentFrame.maxs[i])) {
        if (currentFrame.maxs[i] > max) max = currentFrame.maxs[i];
      }
    }
    if (Number.isFinite(min)) minVal = min.toFixed(2);
    if (Number.isFinite(max)) maxVal = max.toFixed(2);
  }

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
      <div style={{ fontWeight: 600, marginBottom: "8px" }}>统计分析 (Stats)</div>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid var(--border-subtle)", paddingBottom: "4px" }}>
          <span style={{ color: "var(--text-muted)" }}>活跃通道</span>
          <span>{currentFrame ? currentFrame.header.channel : checkedChannels[0] || "—"}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid var(--border-subtle)", paddingBottom: "4px" }}>
          <span style={{ color: "var(--text-muted)" }}>视口最小值</span>
          <span>{minVal}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid var(--border-subtle)", paddingBottom: "4px" }}>
          <span style={{ color: "var(--text-muted)" }}>视口最大值</span>
          <span>{maxVal}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid var(--border-subtle)", paddingBottom: "4px" }}>
          <span style={{ color: "var(--text-muted)" }}>桶样本数</span>
          <span>{currentFrame ? currentFrame.header.buckets : "—"}</span>
        </div>
      </div>
    </div>
  );
};
