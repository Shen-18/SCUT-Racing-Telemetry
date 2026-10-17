import React from "react";
import { useAppStore } from "../state/appStore";

export interface CloudSyncDialogProps {
  onDismiss(): void;
}

/** 云端数据同步确认弹窗（手动同步用）：发现 N 条新数据 → 下载 / 稍后再说 */
export const CloudSyncDialog: React.FC<CloudSyncDialogProps> = ({ onDismiss }) => {
  const newFiles = useAppStore((s) => s.cloudSync.newFiles);
  const runCloudSync = useAppStore((s) => s.runCloudSync);
  const preview = newFiles.slice(0, 5);
  const hidden = newFiles.length - preview.length;

  return (
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
        data-testid="cloud-sync-dialog"
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ width: "3px", height: "16px", background: "var(--red)" }} />
          <span style={{ fontFamily: '"F1 Display", "Microsoft YaHei", sans-serif', fontWeight: 700, fontSize: "15px", letterSpacing: "1.5px" }}>
            有 {newFiles.length} 条新数据
          </span>
        </div>
        <div style={{ marginTop: "12px", fontSize: "12px", color: "var(--dim2)", lineHeight: 1.9 }}>
          {preview.map((file) => (
            <div key={file.file_hash} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              · {file.file_name}
            </div>
          ))}
          {hidden > 0 && <div>…等共 {newFiles.length} 个文件，下载后自动导入</div>}
        </div>
        <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end", marginTop: "16px" }}>
          <button
            onClick={onDismiss}
            style={{ background: "transparent", border: "1px solid var(--line)", color: "var(--dim2)", padding: "7px 14px", font: "inherit", cursor: "pointer" }}
          >
            稍后再说
          </button>
          <button
            data-testid="cloud-sync-confirm"
            onClick={() => void runCloudSync()}
            style={{ background: "var(--red)", border: "1px solid var(--red)", color: "#fff", fontWeight: 700, padding: "7px 16px", font: "inherit", cursor: "pointer" }}
          >
            下载
          </button>
        </div>
      </div>
    </div>
  );
};
