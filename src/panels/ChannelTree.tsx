import React, { useState } from "react";
import type { PanelProps } from "./registry";
import { useAppStore, isNonTerminalImportStage } from "../state/appStore";

export { isNonTerminalImportStage };

export const ChannelTree: React.FC<PanelProps> = () => {
  const dataset = useAppStore((s) => s.dataset);
  const checkedChannels = useAppStore((s) => s.checkedChannels);
  const toggleChannelAndPrioritize = useAppStore((s) => s.toggleChannelAndPrioritize);
  const prioritizeImport = useAppStore((s) => s.prioritizeImport);
  const importJobs = useAppStore((s) => s.importJobs);

  const [filter, setFilter] = useState("");

  const channels = dataset?.channels || [];
  const filtered = channels.filter(
    (c) =>
      c.name.toLowerCase().includes(filter.toLowerCase()) ||
      c.key.toLowerCase().includes(filter.toLowerCase())
  );

  const activeJob = Object.values(importJobs).find(
    (j) => j && isNonTerminalImportStage(j.stage)
  );

  const handleToggle = (key: string) => {
    void toggleChannelAndPrioritize(key);
  };

  const handlePrioritize = (key: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (activeJob) {
      void prioritizeImport(activeJob.job_id, [key]);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "var(--bg-panel)",
        color: "var(--text-primary)",
        fontSize: "12px",
      }}
    >
      <div
        style={{
          padding: "8px 12px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          gap: "8px",
        }}
      >
        <input
          type="text"
          placeholder="搜索通道…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{
            width: "100%",
            background: "var(--bg-app)",
            border: "1px solid var(--border)",
            borderRadius: "4px",
            color: "var(--text-primary)",
            padding: "4px 8px",
            fontSize: "12px",
          }}
        />
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            color: "var(--text-muted)",
            fontSize: "11px",
          }}
        >
          <span>已选: {checkedChannels.length}</span>
          <span>总计: {channels.length}</span>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
        {channels.length === 0 ? (
          <div
            style={{
              padding: "24px 16px",
              textAlign: "center",
              color: "var(--text-muted)",
              fontSize: "11px",
            }}
          >
            等待导入或打开数据集…
          </div>
        ) : (
          filtered.map((channel) => {
            const isChecked = checkedChannels.includes(channel.key);
            return (
              <div
                key={channel.key}
                onClick={() => handleToggle(channel.key)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "6px 12px",
                  cursor: "pointer",
                  background: isChecked ? "var(--bg-surface-active)" : "transparent",
                  borderLeft: isChecked ? "3px solid var(--accent)" : "3px solid transparent",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px", overflow: "hidden" }}>
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => {}}
                    style={{ cursor: "pointer" }}
                  />
                  <span
                    style={{
                      whiteSpace: "nowrap",
                      textOverflow: "ellipsis",
                      overflow: "hidden",
                      fontWeight: isChecked ? 600 : 400,
                    }}
                    title={channel.name}
                  >
                    {channel.name}
                  </span>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span style={{ color: "var(--text-muted)", fontSize: "11px" }}>
                    {channel.unit || ""}
                  </span>
                  {activeJob && (
                    <button
                      onClick={(e) => handlePrioritize(channel.key, e)}
                      style={{
                        background: "transparent",
                        border: "1px solid var(--border)",
                        borderRadius: "3px",
                        color: "var(--text-muted)",
                        fontSize: "10px",
                        padding: "1px 4px",
                        cursor: "pointer",
                      }}
                      title="优先构建此通道缓存"
                    >
                      优先
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
