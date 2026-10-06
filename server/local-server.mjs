import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { readFile, stat, unlink } from "node:fs/promises";
import { resolve, join, extname } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveServerConfig } from "./config.mjs";
import { createDatabase } from "./db.mjs";
import { safeUploadName, saveUpload, uploadRootDir } from "./storage.mjs";
import { normalizeDatasetInput, normalizeDatasetInputs, normalizeDateNote } from "./validation.mjs";
import {
  clearedSessionCookie,
  clientIp,
  createRateLimiter,
  hashPassword,
  randomToken,
  readCookie,
  requireAdmin,
  requireToken,
  sessionCookie,
  sha256Hex,
  verifyPassword,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
} from "./auth.mjs";

const adminRoot = resolve("server/admin-ui");

const sendJson = (response, status, value, extraHeaders = {}) => {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type,authorization",
    ...extraHeaders,
  });
  response.end(body);
};

const sendError = (response, status, code, message) => sendJson(response, status, { error: { code, message } });

const readBody = async (request) => {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1_000_000) throw new Error("请求体过大");
  }
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    throw new Error("请求体不是有效 JSON");
  }
};

const mimeType = (path) => ({
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
}[extname(path)] || "application/octet-stream");

async function serveAdminAsset(response, pathname) {
  const relative = pathname === "/admin" || pathname === "/admin/" ? "index.html" : pathname.replace(/^\/admin\//, "");
  if (relative.includes("..") || relative.includes("\\")) {
    sendError(response, 400, "invalid_path", "无效的管理员页面路径");
    return;
  }
  try {
    const path = join(adminRoot, relative);
    const body = await readFile(path);
    response.writeHead(200, { "content-type": mimeType(path), "cache-control": "no-store" });
    response.end(body);
  } catch {
    sendError(response, 404, "not_found", "管理员页面不存在");
  }
}

function assertDateKey(value) {
  const dateKey = decodeURIComponent(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) throw new Error("日期必须使用 YYYY-MM-DD 格式");
  return dateKey;
}

async function createApp(db, deps = {}) {
  const adminPassword = deps.adminPassword ?? "";
  const limiter = createRateLimiter();
  // 引导：账号表为空且配置了初始密码时，创建首个管理员账号（之后的密码改动都在数据库里）
  if (adminPassword && (await db.adminAccountsEmpty())) {
    await db.createAdminAccount({ username: "admin", passwordHash: hashPassword(adminPassword) });
  }
  const uploadRoot = deps.uploadRoot;
  // 生产默认调用 PATH 上的 xrk-meta（容器内 /app/bin）；测试注入 stub
  const runExtractor =
    deps.runExtractor ??
    ((filePath) =>
      new Promise((resolvePromise, rejectPromise) => {
        execFile("xrk-meta", [filePath], { windowsHide: true }, (error, stdout, stderr) => {
          if (error) {
            rejectPromise(new Error(stderr?.trim() || `xrk-meta 执行失败 (${error.code ?? "?"})`));
            return;
          }
          try {
            resolvePromise(JSON.parse(stdout));
          } catch {
            rejectPromise(new Error("xrk-meta 输出不是有效 JSON"));
          }
        });
      }));

  const sendFile = async (response, filePath, downloadName) => {
    let statInfo;
    try {
      statInfo = await stat(filePath);
    } catch {
      sendError(response, 404, "not_found", "文件不存在");
      return;
    }
    response.writeHead(200, {
      "content-type": "application/octet-stream",
      "content-length": statInfo.size,
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`,
    });
    createReadStream(filePath).pipe(response);
  };

  return createServer(async (request, response) => {
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
        "access-control-allow-headers": "content-type,authorization",
      });
      response.end();
      return;
    }

    const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
    // 管理接口守卫：未配置管理密码 → 503；未登录 → 401；通过则返回会话行
    const guardAdmin = async () => {
      if (!adminPassword) {
        sendError(response, 503, "admin_password_not_set", "服务端未配置 SCUT_ADMIN_PASSWORD");
        return null;
      }
      const session = await requireAdmin(request, db);
      if (!session) {
        sendError(response, 401, "unauthorized", "请先登录管理面板");
        return null;
      }
      return session;
    };
    // 客户端接口守卫：有效令牌或管理员会话均可（管理面板同源展示数据用）
    const guardToken = async () => {
      if (await requireToken(request, db)) return true;
      if (await requireAdmin(request, db)) return true;
      sendError(response, 401, "unauthorized", "需要访问密钥");
      return false;
    };

    try {
      if (url.pathname === "/health" && request.method === "GET") {
        const database = await db.health();
        sendJson(response, 200, { ok: true, service: "scut-racing-telemetry-sync", database, time: new Date().toISOString() });
        return;
      }

      if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) {
        await serveAdminAsset(response, url.pathname);
        return;
      }

      // 会话自检：页面加载时验证已有 Cookie，避免刷新即见登录页
      if (url.pathname === "/api/v1/admin/session" && request.method === "GET") {
        if (!adminPassword) {
          sendError(response, 503, "admin_password_not_set", "服务端未配置 SCUT_ADMIN_PASSWORD");
          return;
        }
        const session = await requireAdmin(request, db);
        if (!session) {
          sendError(response, 401, "unauthorized", "未登录");
          return;
        }
        const account = await db.getAdminAccountById(session.account_id);
        sendJson(response, 200, { ok: true, username: account?.username ?? "admin" });
        return;
      }

      if (url.pathname === "/api/v1/admin/login" && request.method === "POST") {
        if (!adminPassword) {
          sendError(response, 503, "admin_password_not_set", "服务端未配置 SCUT_ADMIN_PASSWORD");
          return;
        }
        const lock = limiter.check(clientIp(request));
        if (lock.locked) {
          sendError(response, 429, "too_many_attempts", `尝试过多，请 ${lock.retryAfter} 秒后再试`);
          return;
        }
        const body = await readBody(request);
        const username = String(body.username ?? "admin").trim() || "admin";
        const account = await db.getAdminAccount(username);
        if (!account || !verifyPassword(body.password ?? "", account.password_hash)) {
          limiter.fail(clientIp(request));
          sendError(response, 401, "invalid_credentials", "用户名或密码错误");
          return;
        }
        limiter.reset(clientIp(request));
        const token = randomToken();
        const now = Math.floor(Date.now() / 1000);
        await db.createAdminSession(sha256Hex(token), account.id, now + SESSION_TTL_SECONDS);
        await db.purgeExpiredAdminSessions(now);
        sendJson(response, 200, { ok: true, username: account.username }, { "set-cookie": sessionCookie(token) });
        return;
      }

      // 多管理员：列出 / 添加 / 删除（不能删自己，至少保留一个）
      if (url.pathname === "/api/v1/admin/accounts" && request.method === "GET") {
        const session = await guardAdmin();
        if (!session) return;
        sendJson(response, 200, { accounts: await db.listAdminAccounts(), current: session.account_id });
        return;
      }

      if (url.pathname === "/api/v1/admin/accounts" && request.method === "POST") {
        const session = await guardAdmin();
        if (!session) return;
        const body = await readBody(request);
        const username = String(body.username ?? "").trim();
        const password = String(body.password ?? "");
        if (username.length < 2 || username.length > 24 || /\s/.test(username)) {
          sendError(response, 400, "invalid_username", "用户名需要 2-24 个字符且不含空格");
          return;
        }
        if (password.length < 6) {
          sendError(response, 400, "invalid_password", "密码至少 6 位");
          return;
        }
        if (await db.getAdminAccount(username)) {
          sendError(response, 409, "username_taken", "该用户名已存在");
          return;
        }
        const row = await db.createAdminAccount({ username, passwordHash: hashPassword(password) });
        sendJson(response, 201, { account: row });
        return;
      }

      const deleteAccount = url.pathname.match(/^\/api\/v1\/admin\/accounts\/(\d+)$/);
      if (deleteAccount && request.method === "DELETE") {
        const session = await guardAdmin();
        if (!session) return;
        const id = Number(deleteAccount[1]);
        if (id === session.account_id) {
          sendError(response, 400, "cannot_delete_self", "不能删除当前登录的账号");
          return;
        }
        if ((await db.countAdminAccounts()) <= 1) {
          sendError(response, 400, "last_account", "至少保留一个管理员账号");
          return;
        }
        const row = await db.deleteAdminAccount(id);
        if (!row) {
          sendError(response, 404, "account_not_found", "找不到该账号");
          return;
        }
        sendJson(response, 200, { ok: true });
        return;
      }

      // 修改当前登录账号的密码（改完吊销该账号的其他会话）
      if (url.pathname === "/api/v1/admin/password" && request.method === "PUT") {
        const session = await guardAdmin();
        if (!session) return;
        const body = await readBody(request);
        const account = await db.getAdminAccountById(session.account_id);
        if (!account || !verifyPassword(body.current ?? "", account.password_hash)) {
          sendError(response, 401, "invalid_credentials", "当前密码不正确");
          return;
        }
        const next = String(body.next ?? "");
        if (next.length < 6) {
          sendError(response, 400, "invalid_password", "新密码至少 6 位");
          return;
        }
        await db.updateAdminPassword(account.id, hashPassword(next));
        await db.deleteAdminSessionsForAccount(account.id, sha256Hex(readCookie(request, SESSION_COOKIE) || " "));
        sendJson(response, 200, { ok: true });
        return;
      }

      if (url.pathname === "/api/v1/admin/logout" && request.method === "POST") {
        const token = (request.headers.cookie || "")
          .split(";")
          .map((part) => part.trim())
          .find((part) => part.startsWith("scut_admin_session="));
        if (token) await db.deleteAdminSession(sha256Hex(token.split("=").slice(1).join("=")));
        sendJson(response, 200, { ok: true }, { "set-cookie": clearedSessionCookie() });
        return;
      }

      if (url.pathname === "/api/v1/admin/tokens" && request.method === "GET") {
        if (!(await guardAdmin())) return;
        sendJson(response, 200, { tokens: await db.listClientTokens() });
        return;
      }

      if (url.pathname === "/api/v1/admin/tokens" && request.method === "POST") {
        if (!(await guardAdmin())) return;
        const body = await readBody(request);
        const name = String(body.name ?? "").trim();
        if (!name) {
          sendError(response, 400, "invalid_name", "令牌名称不能为空");
          return;
        }
        const row = await db.createClientToken({ name, token: `scut_${randomToken()}` });
        sendJson(response, 201, { token: row });
        return;
      }

      const revokeToken = url.pathname.match(/^\/api\/v1\/admin\/tokens\/(\d+)$/);
      if (revokeToken && request.method === "DELETE") {
        if (!(await guardAdmin())) return;
        const row = await db.deleteClientToken(Number(revokeToken[1]));
        if (!row) {
          sendError(response, 404, "token_not_found", "找不到令牌");
          return;
        }
        sendJson(response, 200, { ok: true, deleted: true });
        return;
      }

      if (url.pathname === "/api/v1/datasets" && request.method === "GET") {
        if (!(await guardToken())) return;
        const datasets = await db.listDatasets({
          fileHash: url.searchParams.get("file_hash"),
          includeArchived: url.searchParams.get("include_archived") === "true",
        });
        sendJson(response, 200, { datasets });
        return;
      }

      if (url.pathname === "/api/v1/date-notes" && request.method === "GET") {
        if (!(await guardToken())) return;
        sendJson(response, 200, { date_notes: await db.listDateNotes() });
        return;
      }

      const dateNote = url.pathname.match(/^\/api\/v1\/date-notes\/(.+)$/);
      if (dateNote && request.method === "GET") {
        if (!(await guardToken())) return;
        sendJson(response, 200, await db.getDateNote(assertDateKey(dateNote[1])));
        return;
      }

      if (url.pathname === "/api/v1/admin/datasets" && request.method === "POST") {
        if (!(await guardAdmin())) return;
        const dataset = normalizeDatasetInput(await readBody(request));
        await db.upsertDataset(dataset);
        sendJson(response, 201, { ok: true, file_hash: dataset.file_hash });
        return;
      }

      if (url.pathname === "/api/v1/admin/datasets/bulk" && request.method === "POST") {
        if (!(await guardAdmin())) return;
        const body = await readBody(request);
        const datasets = normalizeDatasetInputs(body.datasets);
        await db.upsertDatasets(datasets);
        sendJson(response, 201, { ok: true, count: datasets.length });
        return;
      }

      if (url.pathname === "/api/v1/admin/uploads" && request.method === "POST") {
        if (!(await guardAdmin())) return;
        const uploadName = safeUploadName(request.headers["x-file-name"]);
        const ext = extname(uploadName).toLowerCase();
        if (![".xrk", ".xrz"].includes(ext)) {
          sendError(response, 415, "unsupported_type", "仅支持 .xrk / .xrz 文件");
          return;
        }
        const upload = await saveUpload(request, uploadRoot);
        // 同内容去重：已索引的 hash 直接返回，不再解析
        if (await db.getDatasetByHash(upload.file_hash)) {
          sendJson(response, 200, { ok: true, duplicate: true, file_hash: upload.file_hash, file_name: upload.file_name });
          return;
        }
        let meta;
        try {
          meta = await runExtractor(upload.path);
        } catch (error) {
          await unlink(upload.path).catch(() => {});
          sendError(response, 422, "extract_failed", `遥测文件解析失败：${error instanceof Error ? error.message : String(error)}`);
          return;
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(meta.record_date || "")) {
          await unlink(upload.path).catch(() => {});
          sendError(response, 422, "extract_failed", "无法从文件中解析出记录日期");
          return;
        }
        const dataset = normalizeDatasetInput({
          file_hash: upload.file_hash,
          file_name: upload.file_name,
          file_type: upload.file_type,
          record_date: meta.record_date,
          start_time: meta.start_time || "",
          session: "",
          vehicle: meta.vehicle || "",
          racer: meta.racer || "",
          championship: "",
          duration: Number(meta.duration_seconds) || 0,
          sample_rate_hz: 0,
          file_size: upload.file_size,
          source_mtime_unix: Math.floor(Date.now() / 1000),
          storage_key: upload.storage_key,
        });
        await db.upsertDataset(dataset);
        sendJson(response, 201, { ok: true, file_hash: upload.file_hash, file_name: upload.file_name, dataset });
        return;
      }

      // 管理员按 storage_key 下载原始文件
      const adminFile = url.pathname.match(/^\/api\/v1\/admin\/files\/([0-9a-f]{64}\.[a-z0-9]+)$/);
      if (adminFile && request.method === "GET") {
        if (!(await guardAdmin())) return;
        const storageKey = adminFile[1];
        await sendFile(response, resolve(uploadRoot || uploadRootDir(), storageKey), url.searchParams.get("name") || storageKey);
        return;
      }

      // 队员按 file_hash 下载数据文件（走索引找 storage_key）
      const clientFile = url.pathname.match(/^\/api\/v1\/files\/([0-9a-f]{64})$/);
      if (clientFile && request.method === "GET") {
        if (!(await guardToken())) return;
        const dataset = await db.getDatasetByHash(clientFile[1]);
        if (!dataset || !dataset.storage_key) {
          sendError(response, 404, "file_not_found", "该记录没有可下载的文件");
          return;
        }
        await sendFile(
          response,
          resolve(uploadRoot || uploadRootDir(), dataset.storage_key),
          dataset.file_name || dataset.storage_key,
        );
        return;
      }

      // 删除记录及其关联文件
      const deleteDatasetRoute = url.pathname.match(/^\/api\/v1\/admin\/datasets\/([^/]+)$/);
      if (deleteDatasetRoute && request.method === "DELETE") {
        if (!(await guardAdmin())) return;
        const fileHash = decodeURIComponent(deleteDatasetRoute[1]);
        const removed = await db.deleteDataset(fileHash);
        if (!removed) {
          sendError(response, 404, "dataset_not_found", "找不到数据集");
          return;
        }
        if (removed.storage_key && /^[0-9a-f]{64}\.[a-z0-9]+$/.test(removed.storage_key)) {
          await unlink(resolve(uploadRoot || uploadRootDir(), removed.storage_key)).catch(() => {});
        }
        sendJson(response, 200, { ok: true, file_hash: fileHash });
        return;
      }

      const archive = url.pathname.match(/^\/api\/v1\/admin\/datasets\/([^/]+)$/);
      if (archive && request.method === "PATCH") {
        if (!(await guardAdmin())) return;
        const body = await readBody(request);
        const result = await db.archiveDataset(decodeURIComponent(archive[1]), Boolean(body.is_archived));
        if (!result) {
          sendError(response, 404, "dataset_not_found", "找不到数据集");
          return;
        }
        sendJson(response, 200, { ok: true, ...result });
        return;
      }

      const adminDateNote = url.pathname.match(/^\/api\/v1\/admin\/date-notes\/(.+)$/);
      if (adminDateNote && request.method === "PUT") {
        if (!(await guardAdmin())) return;
        const dateKey = assertDateKey(adminDateNote[1]);
        const note = normalizeDateNote((await readBody(request)).note);
        sendJson(response, 200, { ok: true, ...(await db.saveDateNote(dateKey, note)) });
        return;
      }

      // ===== 软件发布（releases）=====
      if (url.pathname === "/api/v1/admin/releases" && request.method === "GET") {
        if (!(await guardAdmin())) return;
        sendJson(response, 200, { releases: await db.listReleases() });
        return;
      }

      if (url.pathname === "/api/v1/admin/releases" && request.method === "POST") {
        if (!(await guardAdmin())) return;
        const body = await readBody(request);
        const tag = String(body.tag ?? "").trim();
        if (!/^v?\d+\.\d+(-[\w.]+)?$/i.test(tag)) {
          sendError(response, 400, "invalid_tag", "版本号格式应为 1.0（两位，可带 v 前缀与 -后缀）");
          return;
        }
        const normalizedTag = tag.replace(/^v/i, "");
        if (await db.getReleaseByTag(normalizedTag)) {
          sendError(response, 409, "tag_taken", `版本 ${normalizedTag} 已存在`);
          return;
        }
        const release = await db.createRelease({
          tag: normalizedTag,
          title: String(body.title ?? "").trim(),
          notes: String(body.notes ?? ""),
          draft: body.draft !== false,
        });
        sendJson(response, 201, { release });
        return;
      }

      // 上传安装包（.exe 原始字节流，复用内容寻址存储）
      const releaseInstaller = url.pathname.match(/^\/api\/v1\/admin\/releases\/(\d+)\/installer$/);
      if (releaseInstaller && request.method === "PUT") {
        if (!(await guardAdmin())) return;
        const release = await db.getRelease(Number(releaseInstaller[1]));
        if (!release) {
          sendError(response, 404, "release_not_found", "找不到该发布记录");
          return;
        }
        const uploadName = safeUploadName(request.headers["x-file-name"]);
        if (!uploadName.toLowerCase().endsWith(".exe")) {
          sendError(response, 415, "unsupported_type", "安装包必须是 .exe 文件");
          return;
        }
        const upload = await saveUpload(request, uploadRoot);
        await db.setReleaseInstaller(release.id, {
          installerKey: upload.storage_key,
          installerName: upload.file_name,
          installerHash: upload.file_hash,
        });
        sendJson(response, 201, { ok: true, installer_hash: upload.file_hash, file_size: upload.file_size });
        return;
      }

      // 上传签名（.sig 文本内容）
      const releaseSignature = url.pathname.match(/^\/api\/v1\/admin\/releases\/(\d+)\/signature$/);
      if (releaseSignature && request.method === "PUT") {
        if (!(await guardAdmin())) return;
        const release = await db.getRelease(Number(releaseSignature[1]));
        if (!release) {
          sendError(response, 404, "release_not_found", "找不到该发布记录");
          return;
        }
        const signature = (await readBody(request)).signature ?? "";
        const text = String(signature).trim();
        if (text.length < 32 || !/^[\w+/=\s.-]+$/.test(text)) {
          sendError(response, 400, "invalid_signature", "签名内容不是合法的 .sig 文本");
          return;
        }
        await db.setReleaseSignature(release.id, text);
        sendJson(response, 200, { ok: true });
        return;
      }

      const patchRelease = url.pathname.match(/^\/api\/v1\/admin\/releases\/(\d+)$/);
      if (patchRelease && request.method === "PATCH") {
        if (!(await guardAdmin())) return;
        const release = await db.getRelease(Number(patchRelease[1]));
        if (!release) {
          sendError(response, 404, "release_not_found", "找不到该发布记录");
          return;
        }
        const body = await readBody(request);
        // 发布前置校验：安装包和签名必须齐备
        if (body.draft === false && (!release.installer_hash || !release.signature)) {
          sendError(response, 400, "release_incomplete", "发布前必须上传安装包和签名文件");
          return;
        }
        const updated = await db.updateRelease(release.id, {
          title: body.title !== undefined ? String(body.title).trim() : undefined,
          notes: body.notes !== undefined ? String(body.notes) : undefined,
          draft: body.draft !== undefined ? Boolean(body.draft) : undefined,
        });
        sendJson(response, 200, { release: updated });
        return;
      }

      const deleteReleaseRoute = url.pathname.match(/^\/api\/v1\/admin\/releases\/(\d+)$/);
      if (deleteReleaseRoute && request.method === "DELETE") {
        if (!(await guardAdmin())) return;
        const removed = await db.deleteRelease(Number(deleteReleaseRoute[1]));
        if (!removed) {
          sendError(response, 404, "release_not_found", "找不到该发布记录");
          return;
        }
        // 安装包是内容寻址存储，删除记录后文件留存在 uploads（同名重传会复用），不阻塞
        sendJson(response, 200, { ok: true });
        return;
      }

      // ===== 队员端更新检查（公开：版本号与签名不敏感，包本身有签名防篡改）=====
      if (url.pathname === "/api/v1/updates/latest" && request.method === "GET") {
        const release = await db.latestPublishedRelease();
        if (!release) {
          sendError(response, 404, "no_release", "暂无可用更新");
          return;
        }
        sendJson(response, 200, {
          version: release.tag,
          notes: release.notes || release.title,
          pub_date: new Date((release.published_at || 0) * 1000).toISOString(),
          platforms: {
            "windows-x86_64": {
              signature: release.signature,
              url: `${url.origin}/api/v1/updates/files/${release.installer_hash}`,
            },
          },
        });
        return;
      }

      // 更新包公开下载（hash 不可猜；内容签名防篡改）
      const updateFile = url.pathname.match(/^\/api\/v1\/updates\/files\/([0-9a-f]{64})$/);
      if (updateFile && request.method === "GET") {
        const release = await db.getReleaseByInstallerHash(updateFile[1]);
        if (!release || !release.installer_key) {
          sendError(response, 404, "file_not_found", "安装包不存在");
          return;
        }
        await sendFile(
          response,
          resolve(uploadRoot || uploadRootDir(), release.installer_key),
          release.installer_name || release.installer_key,
        );
        return;
      }

      sendError(response, 404, "not_found", "接口不存在");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendError(response, 400, "request_failed", message);
    }
  });
}

// 仅作为入口执行时才连接数据库；被测试 import 时不做任何启动动作
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const config = resolveServerConfig();
  let db;
  try {
    db = await createDatabase(config.databaseUrl);
  } catch (error) {
    console.error("SCUT 同步服务启动失败：无法连接 PostgreSQL。", error instanceof Error ? error.message : error);
    console.error("请先启动 PostgreSQL，或运行：pwsh server/start-server.ps1 -StartDatabase");
    process.exit(1);
  }
  const server = await createApp(db, { adminPassword: config.adminPassword });
  server.listen(config.port, config.host, () => {
    console.log(`SCUT 同步服务已启动: http://${config.host}:${config.port}`);
    console.log(`PostgreSQL: ${config.databaseUrl.replace(/:\/\/([^:]+):[^@]+@/, "://$1:***@")}`);
    console.log(`管理员页面: http://${config.host}:${config.port}/admin`);
  });
  const close = async () => {
    server.close();
    await db.close();
    process.exit(0);
  };
  process.on("SIGINT", close);
  process.on("SIGTERM", close);
}

export { createApp };
