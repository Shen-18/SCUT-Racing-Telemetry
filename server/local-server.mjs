import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, join, extname } from "node:path";
import { resolveServerConfig } from "./config.mjs";
import { createDatabase } from "./db.mjs";
import { saveUpload } from "./storage.mjs";
import { normalizeDatasetInput, normalizeDatasetInputs, normalizeDateNote } from "./validation.mjs";

const config = resolveServerConfig();
const adminRoot = resolve("server/admin-ui");

const sendJson = (response, status, value) => {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,PUT,PATCH,OPTIONS",
    "access-control-allow-headers": "content-type",
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

async function createApp(db) {
  return createServer(async (request, response) => {
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,PUT,PATCH,OPTIONS",
        "access-control-allow-headers": "content-type",
      });
      response.end();
      return;
    }

    const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
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

      if (url.pathname === "/api/v1/datasets" && request.method === "GET") {
        const datasets = await db.listDatasets({
          fileHash: url.searchParams.get("file_hash"),
          includeArchived: url.searchParams.get("include_archived") === "true",
        });
        sendJson(response, 200, { datasets });
        return;
      }

      if (url.pathname === "/api/v1/date-notes" && request.method === "GET") {
        sendJson(response, 200, { date_notes: await db.listDateNotes() });
        return;
      }

      const dateNote = url.pathname.match(/^\/api\/v1\/date-notes\/(.+)$/);
      if (dateNote && request.method === "GET") {
        sendJson(response, 200, await db.getDateNote(assertDateKey(dateNote[1])));
        return;
      }

      if (url.pathname === "/api/v1/admin/datasets" && request.method === "POST") {
        const dataset = normalizeDatasetInput(await readBody(request));
        await db.upsertDataset(dataset);
        sendJson(response, 201, { ok: true, file_hash: dataset.file_hash });
        return;
      }

      if (url.pathname === "/api/v1/admin/datasets/bulk" && request.method === "POST") {
        const body = await readBody(request);
        const datasets = normalizeDatasetInputs(body.datasets);
        await db.upsertDatasets(datasets);
        sendJson(response, 201, { ok: true, count: datasets.length });
        return;
      }

      if (url.pathname === "/api/v1/admin/uploads" && request.method === "POST") {
        const upload = await saveUpload(request);
        sendJson(response, 201, { ok: true, ...upload });
        return;
      }

      const archive = url.pathname.match(/^\/api\/v1\/admin\/datasets\/([^/]+)$/);
      if (archive && request.method === "PATCH") {
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
        const dateKey = assertDateKey(adminDateNote[1]);
        const note = normalizeDateNote((await readBody(request)).note);
        sendJson(response, 200, { ok: true, ...(await db.saveDateNote(dateKey, note)) });
        return;
      }

      sendError(response, 404, "not_found", "接口不存在");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendError(response, 400, "request_failed", message);
    }
  });
}

let db;
let server;
try {
  db = await createDatabase(config.databaseUrl);
  server = await createApp(db);
} catch (error) {
  console.error("SCUT 同步服务启动失败：无法连接 PostgreSQL。", error instanceof Error ? error.message : error);
  console.error("请先启动 PostgreSQL，或运行：pwsh server/start-server.ps1 -StartDatabase");
  process.exit(1);
}

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

export { createApp };
