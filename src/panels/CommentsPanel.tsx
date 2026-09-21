import React from "react";

export const CommentsPanel: React.FC = () => {
  return (
    <div
      style={{
        padding: "12px",
        height: "100%",
        background: "var(--bg)",
        color: "var(--text)",
        fontSize: "12px",
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: "8px" }}>批注 (Comments)</div>
      <div style={{ color: "var(--dim2)", fontSize: "11px" }}>
        双击图表或在此添加事件批注（Step 11 功能预留）。
      </div>
    </div>
  );
};
