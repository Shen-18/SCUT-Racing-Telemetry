import React from "react";
import type { UpdateInfo } from "../api/updater";

export interface UpdateDialogProps {
  info: UpdateInfo;
  state: "idle" | "downloading" | "ready";
  message: string;
  onInstall(): void;
  onDismiss(): void;
}

/** 更新弹窗（启动检查与手动检查共用）：版本 + 标题/备注 + 稍后 + 立即更新 */
export const UpdateDialog: React.FC<UpdateDialogProps> = ({ info, state, message, onInstall, onDismiss }) => (
  <div
    style={{
      position: "fixed", inset: 0, zIndex: 100,
      background: "rgba(10, 11, 16, 0.72)",
      display: "grid", placeItems: "center",
    }}
  >
    <div
      style={{
        width: "460px", background: "var(--bg2)", border: "1px solid var(--line)",
        padding: "20px 22px", color: "var(--text)",
      }}
      data-testid="update-dialog"
    >
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <span style={{ width: "3px", height: "16px", background: "var(--red)" }} />
        <span style={{ fontFamily: '"F1 Display", "Microsoft YaHei", sans-serif', fontWeight: 700, fontSize: "15px", letterSpacing: "1.5px" }}>
          发现新版本 v{info.version}
        </span>
      </div>
      {info.notes.trim() && (
        <div style={{ marginTop: "12px", whiteSpace: "pre-wrap", fontSize: "13px", lineHeight: 1.8, background: "var(--bg)", border: "1px solid var(--line)", padding: "10px 12px" }}>
          {info.notes}
        </div>
      )}
      {message && (
        <div style={{ marginTop: "10px", color: state === "ready" ? "var(--text)" : "var(--dim2)", fontSize: "12px" }}>
          {message}
        </div>
      )}
      <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end", marginTop: "16px" }}>
        <button
          onClick={onDismiss}
          disabled={state === "downloading"}
          style={{ background: "transparent", border: "1px solid var(--line)", color: "var(--dim2)", padding: "7px 14px", font: "inherit", cursor: "pointer" }}
        >
          稍后提醒我
        </button>
        <button
          onClick={onInstall}
          disabled={state === "downloading" || state === "ready"}
          style={{ background: "var(--red)", border: "1px solid var(--red)", color: "#fff", fontWeight: 700, padding: "7px 16px", font: "inherit", cursor: "pointer" }}
        >
          {state === "downloading" ? "下载中…" : "立即更新"}
        </button>
      </div>
    </div>
  </div>
);
