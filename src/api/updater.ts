// 软件更新：封装 tauri-plugin-updater 的检查/下载/安装。
// 服务端发布源：/api/v1/updates/latest（管理面板「软件发布」维护）。
// 签名校验由插件强制执行（公钥在 tauri.conf.json，私钥仅在发版构建时使用）。

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
  const { getVersion } = await import("@tauri-apps/api/app");
  return getVersion();
}

/** 检查更新：无新版返回 null；服务端不可达/无发布时也返回 null（静默语义） */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check();
  if (!update) return null;
  return { version: update.version, notes: update.body ?? "" };
}

/** 下载并安装（NSIS 静默安装）；完成后由调用方负责退出/重启 */
export async function downloadAndInstall(onProgress?: (p: UpdateProgress) => void): Promise<void> {
  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check();
  if (!update) throw new Error("没有可用更新");
  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        onProgress?.({ event: "started", contentLength: event.data.contentLength ?? null });
        break;
      case "Progress":
        onProgress?.({ event: "progress", downloaded: event.data.chunkLength, contentLength: null });
        break;
      case "Finished":
        onProgress?.({ event: "finished" });
        break;
    }
  });
}
