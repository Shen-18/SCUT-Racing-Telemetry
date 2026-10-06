import React, { useEffect, useState } from "react";
import { useAppStore } from "../state/appStore";
import { checkRemoteHealth, normalizeRemoteBaseUrl } from "../api/remote";
import { checkForUpdate, downloadAndInstall, getCurrentVersion, type UpdateInfo } from "../api/updater";
import { invoke as invokeCmd } from "../api/client";

export type SettingsScope = "database" | "overlay";

interface SettingsViewProps {
  scope?: SettingsScope;
}

const CARD_STYLE: React.CSSProperties = {
  background: "var(--bg2)",
  border: "1px solid var(--line)",
  padding: "16px 18px",
};

export const SettingsView: React.FC<SettingsViewProps> = ({ scope = "database" }) => {
  const rememberSelectedChannels = useAppStore((state) => state.rememberSelectedChannels);
  const setRememberSelectedChannels = useAppStore((state) => state.setRememberSelectedChannels);
  const accentColor = scope === "overlay" ? "#2A4A98" : "var(--red)";
  const [remoteUrl, setRemoteUrl] = useState(() => {
    try {
      return localStorage.getItem("scut.remote-server-url") || "http://127.0.0.1:8787";
    } catch {
      return "http://127.0.0.1:8787";
    }
  });
  const [remoteStatus, setRemoteStatus] = useState<"idle" | "checking" | "connected" | "failed">("idle");
  const [remoteMessage, setRemoteMessage] = useState("");

  const saveRemoteUrl = (value: string) => {
    setRemoteUrl(value);
    setRemoteStatus("idle");
    setRemoteMessage("");
    try {
      localStorage.setItem("scut.remote-server-url", normalizeRemoteBaseUrl(value));
    } catch {
      // Embedded webviews may disable local storage; the current session still works.
    }
  };

  const testRemote = async () => {
    const baseUrl = normalizeRemoteBaseUrl(remoteUrl);
    if (!baseUrl) return;
    setRemoteStatus("checking");
    setRemoteMessage("");
    try {
      const health = await checkRemoteHealth(baseUrl);
      setRemoteStatus("connected");
      setRemoteMessage(`${health.database} · ${health.service}`);
    } catch (error) {
      setRemoteStatus("failed");
      setRemoteMessage(error instanceof Error ? error.message : String(error));
    }
  };

  // 软件更新控件
  const [appVersion, setAppVersion] = useState("…");
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updateState, setUpdateState] = useState<"idle" | "checking" | "downloading" | "ready">("idle");
  const [updateMessage, setUpdateMessage] = useState("");

  useEffect(() => {
    getCurrentVersion()
      .then(setAppVersion)
      .catch(() => setAppVersion("未知"));
  }, []);

  const runCheck = async () => {
    setUpdateState("checking");
    setUpdateMessage("");
    try {
      const info = await checkForUpdate();
      setUpdateInfo(info);
      setUpdateState("idle");
      setUpdateMessage(info ? `发现新版本 v${info.version}` : "当前已是最新版本。");
    } catch (error) {
      setUpdateState("idle");
      setUpdateInfo(null);
      setUpdateMessage(`检查失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const runInstall = async () => {
    setUpdateState("downloading");
    setUpdateMessage("正在下载更新…");
    try {
      await downloadAndInstall((progress) => {
        if (progress.event === "progress") {
          const mb = (progress.downloaded / 1024 / 1024).toFixed(1);
          setUpdateMessage(`正在下载更新… ${mb} MB`);
        }
      });
      setUpdateState("ready");
      setUpdateMessage("更新下载完成，软件即将关闭——重新打开即为新版本。");
      setTimeout(async () => {
        await invokeCmd("exit_app");
      }, 2500);
    } catch (error) {
      setUpdateState("idle");
      setUpdateMessage(`更新失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return (
    <section
      data-testid="settings-view"
      style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "28px", color: "var(--text)" }}
    >
      <div style={{ maxWidth: "760px", margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "9px", marginBottom: "18px" }}>
          <span style={{ width: "3px", height: "16px", background: accentColor }} />
          <h1 style={{ margin: 0, fontFamily: '"F1 Display", "Microsoft YaHei", sans-serif', fontSize: "16px", letterSpacing: "2px" }}>
            设置
          </h1>
        </div>

        {scope === "database" ? (
          <>
            <div style={CARD_STYLE} data-testid="database-settings">
              <div style={{ fontWeight: 700, fontSize: "14px", marginBottom: "4px" }}>通道选择</div>
              <div style={{ color: "var(--dim2)", fontSize: "12px", lineHeight: 1.6, marginBottom: "14px" }}>
                开启后，打开同一条数据进行分析时，会恢复上次选择的通道。
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer", userSelect: "none" }}>
                <input
                  data-testid="remember-selected-channels-toggle"
                  type="checkbox"
                  checked={rememberSelectedChannels}
                  onChange={(event) => setRememberSelectedChannels(event.target.checked)}
                />
                <span style={{ fontWeight: 700, fontSize: "13px" }}>记住上次选择的通道</span>
                <span style={{ color: "var(--dim2)", fontSize: "11px" }}>{rememberSelectedChannels ? "已开启" : "默认关闭"}</span>
              </label>
            </div>
            <div style={{ ...CARD_STYLE, marginTop: "12px" }} data-testid="remote-server-settings">
              <div style={{ fontWeight: 700, fontSize: "14px", marginBottom: "4px" }}>云端服务器</div>
              <div style={{ color: "var(--dim2)", fontSize: "12px", lineHeight: 1.6, marginBottom: "12px" }}>
                填写云端 API 地址。当前桌面端只读取数据集索引和管理员维护的日期备注，不会上传本地数据。
              </div>
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <input
                  data-testid="remote-server-url"
                  value={remoteUrl}
                  onChange={(event) => saveRemoteUrl(event.target.value)}
                  placeholder="http://127.0.0.1:8787"
                  style={{ flex: 1, minWidth: 0, background: "var(--bg)", border: "1px solid var(--line)", color: "var(--text)", padding: "7px 9px" }}
                />
                <button
                  data-testid="remote-server-test"
                  type="button"
                  onClick={() => void testRemote()}
                  disabled={remoteStatus === "checking"}
                  style={{ flex: "none", padding: "7px 12px", background: "transparent", border: "1px solid var(--line)", color: "var(--text)", cursor: remoteStatus === "checking" ? "default" : "pointer" }}
                >
                  {remoteStatus === "checking" ? "连接中…" : "测试连接"}
                </button>
              </div>
              {remoteMessage && (
                <div style={{ marginTop: "8px", color: remoteStatus === "connected" ? "var(--text)" : "var(--red)", fontSize: "11px" }}>
                  {remoteStatus === "connected" ? "已连接：" : "连接失败："}{remoteMessage}
                </div>
              )}
            </div>
            <div style={{ ...CARD_STYLE, marginTop: "12px" }} data-testid="software-update-settings">
              <div style={{ fontWeight: 700, fontSize: "14px", marginBottom: "4px" }}>软件更新</div>
              <div style={{ color: "var(--dim2)", fontSize: "12px", lineHeight: 1.6, marginBottom: "12px" }}>
                当前版本 <strong style={{ color: "var(--text)" }}>v{appVersion}</strong>。更新由云端服务器分发，安装包经签名校验后自动安装。
              </div>
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <button
                  data-testid="check-update"
                  type="button"
                  onClick={() => (updateInfo && updateState !== "downloading" && updateState !== "ready" ? void runInstall() : void runCheck())}
                  disabled={updateState === "checking" || updateState === "downloading"}
                  style={{ flex: "none", padding: "7px 12px", background: updateInfo ? "var(--red)" : "transparent", border: "1px solid " + (updateInfo ? "var(--red)" : "var(--line)"), color: updateInfo ? "#fff" : "var(--text)", cursor: updateState === "checking" || updateState === "downloading" ? "default" : "pointer" }}
                >
                  {updateState === "checking" ? "检查中…" : updateState === "downloading" ? "下载中…" : updateInfo ? "立即更新" : "检查更新"}
                </button>
                {updateMessage && (
                  <span style={{ color: updateState === "ready" ? "var(--text)" : "var(--dim2)", fontSize: "11px" }}>{updateMessage}</span>
                )}
              </div>
            </div>
          </>
        ) : (
          <div style={CARD_STYLE} data-testid="overlay-settings">
            <div style={{ fontWeight: 700, fontSize: "14px" }}>Overlay 设置</div>
            <div style={{ color: "var(--dim2)", fontSize: "12px", lineHeight: 1.6, marginTop: "4px" }}>Overlay 专属选项将在这里配置。</div>
          </div>
        )}
      </div>
    </section>
  );
};
