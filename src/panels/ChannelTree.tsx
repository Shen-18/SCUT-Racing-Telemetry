import React, { useMemo, useState } from "react";
import { useAppStore, isNonTerminalImportStage } from "../state/appStore";
import { buildChannelColorMap } from "../theme/channelColors";

export { isNonTerminalImportStage };

// 通道列表（手册附录 B.4-P1 下半 / DESIGN-SPEC 4.3）
// 行 = checkbox 14×14 + 3px 色条 + 通道名 Titillium 700 12px + 单位；
// 选中 = --bg2 底 + 3px --red 左边条；点击行 = 勾选切换（导入中联动点击优先）。

const PANEL_TITLE_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  fontFamily: '"F1 Display", "Microsoft YaHei", sans-serif',
  fontWeight: 700,
  fontSize: "12px",
  letterSpacing: "2px",
  color: "var(--dim)",
  padding: "12px 14px 8px",
  flex: "none",
};

const RED_BLOCK_STYLE: React.CSSProperties = {
  width: "3px",
  height: "12px",
  background: "var(--red)",
  display: "inline-block",
  flex: "none",
};

function Checkbox({ checked }: { checked: boolean }) {
  return (
    <span
      style={{
        width: "14px",
        height: "14px",
        border: `1.5px solid ${checked ? "var(--text)" : "var(--dim2)"}`,
        flex: "none",
        position: "relative",
        display: "inline-block",
      }}
    >
      {checked && (
        <span
          style={{
            position: "absolute",
            inset: "2px",
            background: "var(--text)",
          }}
        />
      )}
    </span>
  );
}

export const ChannelTree: React.FC = () => {
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
  // 已勾选通道置顶固定：单独成区、不随下方列表滚动（负责人走查）
  const pinned = filtered.filter((c) => checkedChannels.includes(c.key));
  const rest = filtered.filter((c) => !checkedChannels.includes(c.key));

  // 通道色板按数据集全序构建（与勾选无关，保持确定性）
  const colorMap = useMemo(
    () => buildChannelColorMap(channels.map((c) => c.name)),
    [channels]
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

  const renderRow = (channel: (typeof channels)[number]) => {
            const isChecked = checkedChannels.includes(channel.key);
            const color = colorMap[channel.name] ?? "var(--dim)";
            return (
              <div
                key={channel.key}
                onClick={() => handleToggle(channel.key)}
                title={channel.name}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  padding: "8px 14px",
                  cursor: "pointer",
                  background: isChecked ? "var(--bg2)" : "transparent",
                  borderLeft: isChecked ? "3px solid var(--red)" : "3px solid transparent",
                }}
              >
                <Checkbox checked={isChecked} />
                <span
                  style={{
                    width: "3px",
                    height: "12px",
                    background: color,
                    flex: "none",
                    display: "inline-block",
                  }}
                />
                <span
                  style={{
                    whiteSpace: "nowrap",
                    textOverflow: "ellipsis",
                    overflow: "hidden",
                    fontWeight: 700,
                    fontSize: "12px",
                    letterSpacing: "0.5px",
                  }}
                >
                  {channel.name}
                </span>
                <span
                  style={{
                    marginLeft: "auto",
                    color: "var(--dim2)",
                    fontSize: "11px",
                    fontWeight: 600,
                    flex: "none",
                  }}
                >
                  {channel.unit || ""}
                </span>
                {activeJob && (
                  <button
                    onClick={(e) => handlePrioritize(channel.key, e)}
                    style={{
                      background: "transparent",
                      border: "1px solid var(--line)",
                      borderRadius: "2px",
                      color: "var(--dim)",
                      fontSize: "10px",
                      fontWeight: 700,
                      padding: "1px 5px",
                      cursor: "pointer",
                      flex: "none",
                    }}
                    title="Prioritize this channel"
                  >
                    优先
                  </button>
                )}
              </div>
            );
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
        color: "var(--text)",
      }}
    >
      <div style={PANEL_TITLE_STYLE}>
        <span style={RED_BLOCK_STYLE} />
        CHANNELS
        <span
          className="tnum"
          style={{ marginLeft: "auto", color: "var(--text)", fontFamily: "inherit" }}
        >
          {channels.length} CH
        </span>
      </div>

      <div style={{ padding: "0 14px 8px", flex: "none" }}>
        <input
          type="text"
          placeholder="Search channels…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{
            width: "100%",
            background: "var(--bg)",
            border: "1px solid var(--line)",
            borderRadius: "2px",
            color: "var(--text)",
            padding: "5px 8px",
            fontSize: "12px",
          }}
        />
      </div>

      {pinned.length > 0 && (
        <div
          data-testid="channel-pinned"
          style={{ flex: "none", borderBottom: "1px solid var(--line)" }}
        >
          {pinned.map((channel) => renderRow(channel))}
        </div>
      )}

      <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
        {channels.length === 0 ? (
          <div
            style={{
              padding: "24px 16px",
              textAlign: "center",
              color: "var(--dim2)",
              fontSize: "12px",
              fontWeight: 600,
            }}
          >
            等待导入或打开数据集…
          </div>
        ) : (
          rest.map((channel) => {
            const isChecked = checkedChannels.includes(channel.key);
            const color = colorMap[channel.name] ?? "var(--dim)";
            return (
              <div
                key={channel.key}
                onClick={() => handleToggle(channel.key)}
                title={channel.name}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  padding: "8px 14px",
                  cursor: "pointer",
                  background: isChecked ? "var(--bg2)" : "transparent",
                  borderLeft: isChecked ? "3px solid var(--red)" : "3px solid transparent",
                }}
              >
                <Checkbox checked={isChecked} />
                <span
                  style={{
                    width: "3px",
                    height: "12px",
                    background: color,
                    flex: "none",
                    display: "inline-block",
                  }}
                />
                <span
                  style={{
                    whiteSpace: "nowrap",
                    textOverflow: "ellipsis",
                    overflow: "hidden",
                    fontWeight: 700,
                    fontSize: "12px",
                    letterSpacing: "0.5px",
                  }}
                >
                  {channel.name}
                </span>
                <span
                  style={{
                    marginLeft: "auto",
                    color: "var(--dim2)",
                    fontSize: "11px",
                    fontWeight: 600,
                    flex: "none",
                  }}
                >
                  {channel.unit || ""}
                </span>
                {activeJob && (
                  <button
                    onClick={(e) => handlePrioritize(channel.key, e)}
                    style={{
                      background: "transparent",
                      border: "1px solid var(--line)",
                      borderRadius: "2px",
                      color: "var(--dim)",
                      fontSize: "10px",
                      fontWeight: 700,
                      padding: "1px 5px",
                      cursor: "pointer",
                      flex: "none",
                    }}
                    title="Prioritize this channel"
                  >
                    优先
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
