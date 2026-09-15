import React from "react";
import type { PanelProps } from "./registry";

export const CommentsPanel: React.FC<PanelProps> = () => {
  return (
    <div
      style={{
        padding: "12px",
        height: "100%",
        background: "var(--bg-panel)",
        color: "var(--text-primary)",
        fontSize: "12px",
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: "8px" }}>批注 (Comments)</div>
      <div style={{ color: "var(--text-muted)", fontSize: "11px" }}>
        双击图表或在此添加事件批注（Step 11 功能预留）。
      </div>
    </div>
  );
};
