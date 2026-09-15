import React from "react";
import type { PanelProps } from "./registry";

export const TrackMapPanel: React.FC<PanelProps> = () => {
  return (
    <div
      style={{
        padding: "12px",
        height: "100%",
        background: "var(--bg-panel)",
        color: "var(--text-primary)",
        fontSize: "12px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: "8px" }}>赛道轨迹图 (Track Map)</div>
      <div style={{ color: "var(--text-muted)", fontSize: "11px", textAlign: "center" }}>
        GPS 轨迹图将在此渲染（Step 11 功能预留）。
      </div>
    </div>
  );
};
