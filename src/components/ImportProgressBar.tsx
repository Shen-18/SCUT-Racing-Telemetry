import React from "react";
import type { ImportStage, ImportStatus } from "../api/types";

export const STAGE_LABELS: Record<ImportStage, string> = {
  ReadingMetadata: "读取元数据",
  ReadingChannels: "读取通道数据",
  BuildingRawCache: "构建原始缓存",
  BuildingPyramid: "构建金字塔索引",
  Ready: "就绪",
  Failed: "导入失败",
  Cancelled: "已取消",
};

export interface ImportProgressBarProps {
  status: ImportStatus;
  onCancel?: () => void;
}

export const ImportProgressBar: React.FC<ImportProgressBarProps> = ({ status, onCancel }) => {
  const percent = Math.round(Math.min(1, Math.max(0, status.progress)) * 100);
  const stageLabel = STAGE_LABELS[status.stage] ?? status.stage;
  const isFailed = status.stage === "Failed";
  const isReady = status.stage === "Ready";
  const isRunning =
    status.stage === "ReadingMetadata" ||
    status.stage === "ReadingChannels" ||
    status.stage === "BuildingRawCache" ||
    status.stage === "BuildingPyramid";

  const fillColor = isFailed
    ? "var(--status-error)"
    : isReady
      ? "var(--status-ready)"
      : "var(--accent)";

  return (
    <div
      className="import-progress-bar"
      style={{
        background: "var(--bg-panel)",
        borderBottom: "1px solid var(--border)",
        padding: "6px 16px",
        fontSize: "12px",
        color: "var(--text-primary)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "4px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              background: fillColor,
              display: "inline-block",
            }}
          />
          <span style={{ fontWeight: 600 }}>{stageLabel}</span>
          {status.error ? (
            <span style={{ color: "var(--status-error)" }}>— {status.error}</span>
          ) : (
            <span style={{ color: "var(--text-muted)" }}>
              {status.file_hash ? `(${status.file_hash.slice(0, 8)})` : ""}
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span style={{ color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>
            {percent}%
          </span>
          {isRunning && onCancel && (
            <button
              onClick={onCancel}
              style={{
                background: "transparent",
                border: "1px solid var(--border)",
                color: "var(--text-muted)",
                borderRadius: "4px",
                padding: "2px 8px",
                cursor: "pointer",
                fontSize: "11px",
              }}
            >
              取消
            </button>
          )}
        </div>
      </div>
      <div
        style={{
          width: "100%",
          height: "4px",
          background: "var(--bg-app)",
          borderRadius: "2px",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${percent}%`,
            height: "100%",
            background: fillColor,
            transition: "width 200ms ease-out",
          }}
        />
      </div>
    </div>
  );
};
