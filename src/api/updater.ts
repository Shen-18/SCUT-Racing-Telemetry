// 软件更新：类型与转发层。IPC 实现统一收口在 client.ts（依赖契约边界）。
// 服务端发布源：/api/v1/updates/latest（管理面板「软件发布」维护）。
// 签名校验由插件强制执行（公钥在 tauri.conf.json，私钥仅在发版构建时使用）。

import * as client from "./client";

export interface UpdateInfo {
  version: string;
  notes: string;
}

export type UpdateProgress =
  | { event: "started"; contentLength: number | null }
  | { event: "progress"; downloaded: number; contentLength: number | null }
  | { event: "finished" };

/** 当前软件版本（tauri.conf.json 的 version） */
export async function getCurrentVersion(): Promise<string> {
  return client.getAppVersion();
}

/** 检查更新：无新版返回 null（服务端不可达/无发布时也静默返回 null） */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  return client.checkForUpdate();
}

/** 下载并安装（NSIS 静默安装）；完成后由调用方负责退出/重启 */
export async function downloadAndInstall(onProgress?: (p: UpdateProgress) => void): Promise<void> {
  return client.downloadAndInstallUpdate((p) =>
    onProgress?.(p as UpdateProgress),
  );
}
