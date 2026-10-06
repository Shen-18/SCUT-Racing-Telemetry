import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_DATABASE_URL, resolveServerConfig } from "./config.mjs";
import { safeUploadName } from "./storage.mjs";
import { normalizeDatasetInput, normalizeDatasetInputs } from "./validation.mjs";

test("server config uses the PostgreSQL connection string and local defaults", () => {
  assert.deepEqual(
    resolveServerConfig({}).databaseUrl,
    DEFAULT_DATABASE_URL,
  );
  assert.deepEqual(
    resolveServerConfig({ SCUT_SYNC_PORT: "9123", SCUT_DATABASE_URL: "postgres://demo", SCUT_ADMIN_PASSWORD: "pw" }),
    {
      port: 9123,
      databaseUrl: "postgres://demo",
      host: "127.0.0.1",
      adminPassword: "pw",
    },
  );
});

test("dataset input validates the metadata required by the cloud index", () => {
  assert.throws(
    () => normalizeDatasetInput({ file_hash: "only-hash" }),
    /缺少必要字段/,
  );

  const dataset = normalizeDatasetInput({
    file_hash: "abc123",
    file_name: "session.csv",
    file_type: "csv",
    record_date: "2026-10-05",
    start_time: "09:30:00",
    session: "A",
    vehicle: "A04_AF26",
    racer: "Zicheng Yang",
    championship: "SCUT Racing",
    duration: "12.5",
    sample_rate_hz: "500",
    file_size: "1024",
    source_mtime_unix: "1760000000",
  });

  assert.equal(dataset.duration, 12.5);
  assert.equal(dataset.sample_rate_hz, 500);
  assert.equal(dataset.file_size, 1024);
  assert.equal(dataset.source_mtime_unix, 1760000000);
});

test("uploaded file names are reduced to safe local names", () => {
  assert.equal(safeUploadName("..\\raw\\session 01.xrk"), "session_01.xrk");
  assert.equal(safeUploadName(""), "upload.bin");
});

test("dataset fields may be empty strings but must exist", () => {
  const dataset = normalizeDatasetInput({
    file_hash: "abc123",
    file_name: "session.xrk",
    file_type: "xrk",
    record_date: "2026-10-05",
    start_time: "09:30:00",
    session: "",
    vehicle: "",
    racer: "",
    championship: "",
  });
  assert.equal(dataset.vehicle, "");
  assert.equal(dataset.sample_rate_hz, 0);

  assert.throws(
    () => normalizeDatasetInput({ file_hash: "abc123", file_name: "a.xrk" }),
    /缺少必要字段/,
  );
});

test("bulk sync validates the whole list before any write", () => {
  const valid = { file_hash: "h1", file_name: "a.xrk", file_type: "xrk", record_date: "2026-10-05", start_time: "09:30:00", session: "A", vehicle: "V", racer: "R", championship: "" };
  assert.equal(normalizeDatasetInputs([valid, { ...valid, file_hash: "h2" }]).length, 2);

  assert.throws(() => normalizeDatasetInputs("nope"), /必须是数组/);
  assert.throws(() => normalizeDatasetInputs([]), /不能为空/);
  assert.throws(() => normalizeDatasetInputs([valid, { ...valid, file_hash: 42 }]), /缺少必要字段/);
});

// ===== 鉴权与令牌路由（fake-db + 真实 HTTP） =====

import { createApp } from "./local-server.mjs";
import { sha256Hex } from "./auth.mjs";

function makeFakeDb() {
  const sessions = new Map();
  const tokens = new Map();
  const datasets = new Map();
  const accounts = new Map();
  const releases = [];
  let idSeq = 1;
  return {
    sessions,
    tokens,
    datasets,
    async health() {
      return "fake";
    },
    async listDatasets({ fileHash = null, includeArchived = false } = {}) {
      let rows = [...datasets.values()];
      if (fileHash) rows = rows.filter((r) => r.file_hash === fileHash);
      if (!includeArchived) rows = rows.filter((r) => !r.is_archived);
      return rows;
    },
    async upsertDataset(d) {
      datasets.set(d.file_hash, { ...d });
    },
    async upsertDatasets(list) {
      for (const d of list) datasets.set(d.file_hash, { ...d });
      return list.length;
    },
    async archiveDataset(hash, archived) {
      const row = datasets.get(hash);
      if (!row) return null;
      row.is_archived = archived;
      return { file_hash: hash, is_archived: archived };
    },
    async listDateNotes() {
      return [];
    },
    async getDateNote(key) {
      return { date_key: key, note: "", updated_at: null };
    },
    async saveDateNote(key, note) {
      return { date_key: key, note, updated_at: 0 };
    },
    async createAdminSession(hash, accountId, expiresAt) {
      sessions.set(hash, { token_hash: hash, account_id: accountId, expires_at: expiresAt });
    },
    async deleteAdminSessionsForAccount(accountId, exceptHash) {
      for (const [key, row] of [...sessions]) {
        if (row.account_id === accountId && key !== exceptHash) sessions.delete(key);
      }
    },
    async adminAccountsEmpty() {
      return accounts.size === 0;
    },
    async createAdminAccount({ username, passwordHash }) {
      const row = { id: idSeq++, username, password_hash: passwordHash, created_at: 0 };
      accounts.set(username, row);
      return { ...row };
    },
    async getAdminAccount(username) {
      return accounts.get(username) ?? null;
    },
    async getAdminAccountById(id) {
      for (const row of accounts.values()) if (row.id === id) return { ...row };
      return null;
    },
    async listAdminAccounts() {
      return [...accounts.values()].map((r) => ({ id: r.id, username: r.username, created_at: r.created_at }));
    },
    async deleteAdminAccount(id) {
      for (const [key, row] of [...accounts]) {
        if (row.id === id) {
          accounts.delete(key);
          // 与真实实现一致：删除账号时级联吊销其全部会话
          for (const [sk, sr] of [...sessions]) {
            if (sr.account_id === id) sessions.delete(sk);
          }
          return { id };
        }
      }
      return null;
    },
    async countAdminAccounts() {
      return accounts.size;
    },
    async updateAdminPassword(id, passwordHash) {
      for (const row of accounts.values()) {
        if (row.id === id) {
          row.password_hash = passwordHash;
          return { id };
        }
      }
      return null;
    },
    async getAdminSession(hash) {
      return sessions.get(hash) ?? null;
    },
    async deleteAdminSession(hash) {
      sessions.delete(hash);
    },
    async purgeExpiredAdminSessions() {},
    async createClientToken({ name, token }) {
      const row = { id: idSeq++, name, token, created_at: 0, last_used_at: null, revoked_at: null };
      tokens.set(token, row);
      return { ...row };
    },
    async listClientTokens() {
      return [...tokens.values()].map((r) => ({ ...r }));
    },
    async revokeClientToken(id) {
      for (const row of tokens.values()) {
        if (row.id === id && row.revoked_at === null) {
          row.revoked_at = 1;
          return { id };
        }
      }
      return null;
    },
    async deleteClientToken(id) {
      for (const [key, row] of [...tokens]) {
        if (row.id === id) {
          tokens.delete(key);
          return { id };
        }
      }
      return null;
    },
    async getClientToken(token) {
      return tokens.get(token) ?? null;
    },
    async touchClientToken() {},
    async getDatasetByHash(hash) {
      return datasets.get(hash) ?? null;
    },
    async deleteDataset(hash) {
      const row = datasets.get(hash);
      if (!row) return null;
      datasets.delete(hash);
      return { ...row };
    },
    async createRelease({ tag, title, notes, draft }) {
      const row = { id: idSeq++, tag, title, notes, installer_key: null, installer_name: "", installer_hash: null, signature: "", draft: Boolean(draft), created_at: 0, published_at: draft ? null : 0 };
      releases.push(row);
      return { ...row };
    },
    async listReleases() {
      return releases.map((r) => ({ ...r }));
    },
    async getRelease(id) {
      return releases.find((r) => r.id === id) ?? null;
    },
    async getReleaseByTag(tag) {
      return releases.find((r) => r.tag === tag) ?? null;
    },
    async getReleaseByInstallerHash(hash) {
      return releases.find((r) => r.installer_hash === hash) ?? null;
    },
    async updateRelease(id, { title, notes, draft }) {
      const row = releases.find((r) => r.id === id);
      if (!row) return null;
      if (title !== undefined) row.title = title;
      if (notes !== undefined) row.notes = notes;
      if (draft !== undefined) {
        row.draft = draft;
        row.published_at = draft ? null : 0;
      }
      return { ...row };
    },
    async setReleaseInstaller(id, { installerKey, installerName, installerHash }) {
      const row = releases.find((r) => r.id === id);
      if (!row) return null;
      row.installer_key = installerKey;
      row.installer_name = installerName;
      row.installer_hash = installerHash;
      return { id };
    },
    async setReleaseSignature(id, signature) {
      const row = releases.find((r) => r.id === id);
      if (!row) return null;
      row.signature = signature;
      return { id };
    },
    async deleteRelease(id) {
      const i = releases.findIndex((r) => r.id === id);
      if (i < 0) return null;
      return releases.splice(i, 1)[0];
    },
    async latestPublishedRelease() {
      const ok = releases.filter((r) => !r.draft && r.installer_hash && r.signature);
      if (ok.length === 0) return null;
      ok.sort((a, b) => {
        const pa = a.tag.split(".").map(Number);
        const pb = b.tag.split(".").map(Number);
        for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pb[i] - pa[i];
        return b.published_at - a.published_at;
      });
      return ok[0];
    },
  };
}

async function startServer(deps) {
  const db = makeFakeDb();
  const app = await createApp(db, deps);
  await new Promise((resolve) => app.listen(0, "127.0.0.1", resolve));
  const port = app.address().port;
  return { db, port, uploadRoot: deps.uploadRoot, close: () => app.close() };
}

const req = (port, path, options = {}) =>
  fetch(`http://127.0.0.1:${port}${path}`, {
    ...options,
    headers: { connection: "close", ...(options.headers || {}) },
  });

const login = (port, password) =>
  req(port, "/api/v1/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });

test("wrong admin passwords rate-limit the source IP", async () => {
  const srv = await startServer({ adminPassword: "secret" });
  try {
    for (let i = 0; i < 5; i++) {
      assert.equal((await login(srv.port, "wrong")).status, 401);
    }
    assert.equal((await login(srv.port, "secret")).status, 429);
  } finally {
    srv.close();
  }
});

test("admin session cookie grants access and logout revokes it", async () => {
  const srv = await startServer({ adminPassword: "secret" });
  try {
    const res = await login(srv.port, "secret");
    assert.equal(res.status, 200);
    const cookie = res.headers.get("set-cookie").split(";")[0];
    assert.match(cookie, /^scut_admin_session=/);

    assert.equal((await req(srv.port, "/api/v1/admin/tokens")).status, 401);
    assert.equal((await req(srv.port, "/api/v1/admin/tokens", { headers: { cookie } })).status, 200);
    // 管理员会话也能通过客户端守卫（面板展示数据用）
    assert.equal((await req(srv.port, "/api/v1/datasets", { headers: { cookie } })).status, 200);

    await req(srv.port, "/api/v1/admin/logout", { method: "POST", headers: { cookie } });
    assert.equal((await req(srv.port, "/api/v1/admin/tokens", { headers: { cookie } })).status, 401);
  } finally {
    srv.close();
  }
});

test("client tokens grant dataset access and revocation takes effect", async () => {
  const srv = await startServer({ adminPassword: "secret" });
  try {
    const cookie = (await login(srv.port, "secret")).headers.get("set-cookie").split(";")[0];

    const created = await req(srv.port, "/api/v1/admin/tokens", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "张三" }),
    });
    assert.equal(created.status, 201);
    const { token: row } = await created.json();
    assert.match(row.token, /^scut_/);
    assert.equal(row.name, "张三");

    const listed = await (await req(srv.port, "/api/v1/admin/tokens", { headers: { cookie } })).json();
    assert.equal(listed.tokens.length, 1);
    assert.equal(listed.tokens[0].token, row.token);

    assert.equal((await req(srv.port, "/api/v1/datasets")).status, 401);
    assert.equal(
      (await req(srv.port, "/api/v1/datasets", { headers: { authorization: `Bearer ${row.token}` } })).status,
      200,
    );

    assert.equal(
      (await req(srv.port, `/api/v1/admin/tokens/${row.id}`, { method: "DELETE", headers: { cookie } })).status,
      200,
    );
    assert.equal(
      (await req(srv.port, "/api/v1/datasets", { headers: { authorization: `Bearer ${row.token}` } })).status,
      401,
    );
  } finally {
    srv.close();
  }
});

test("admin routes return 503 when no admin password is configured", async () => {
  const srv = await startServer({});
  try {
    assert.equal((await login(srv.port, "x")).status, 503);
    assert.equal((await req(srv.port, "/api/v1/admin/tokens")).status, 503);
  } finally {
    srv.close();
  }
});

test("expired admin sessions are rejected", async () => {
  const srv = await startServer({ adminPassword: "secret" });
  try {
    const token = "expired-token";
    srv.db.sessions.set(sha256Hex(token), { token_hash: sha256Hex(token), expires_at: 1 });
    assert.equal(
      (await req(srv.port, "/api/v1/admin/tokens", { headers: { cookie: `scut_admin_session=${token}` } })).status,
      401,
    );
  } finally {
    srv.close();
  }
});

// ===== 上传解析入库 + 下载/删除 =====

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const okExtractor = async () => ({
  record_date: "2026-01-25",
  start_time: "13:56:23",
  duration_seconds: 0,
  vehicle: "TEST",
  racer: "SMOKE",
});

test("admin upload parses xrk and creates an indexed record", async () => {
  const srv = await startServer({
    adminPassword: "secret",
    uploadRoot: fs.mkdtempSync(path.join(os.tmpdir(), "scut-upload-")),
    runExtractor: okExtractor,
  });
  try {
    const cookie = (await login(srv.port, "secret")).headers.get("set-cookie").split(";")[0];
    const res = await req(srv.port, "/api/v1/admin/uploads", {
      method: "POST",
      headers: { cookie, "x-file-name": "session01.xrk", "content-type": "application/octet-stream" },
      body: Buffer.from("fake-xrk-bytes"),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    const hash = createHash("sha256").update("fake-xrk-bytes").digest("hex");
    assert.equal(body.file_hash, hash);

    const row = srv.db.datasets.get(hash);
    assert.equal(row.vehicle, "TEST");
    assert.equal(row.racer, "SMOKE");
    assert.equal(row.record_date, "2026-01-25");
    assert.equal(row.storage_key, `${hash}.xrk`);
    assert.ok(fs.existsSync(path.join(srv.uploadRoot, row.storage_key)));

    // 同内容重复上传 → duplicate
    const dup = await req(srv.port, "/api/v1/admin/uploads", {
      method: "POST",
      headers: { cookie, "x-file-name": "session01.xrk" },
      body: Buffer.from("fake-xrk-bytes"),
    });
    assert.equal(dup.status, 200);
    assert.equal((await dup.json()).duplicate, true);

    // 管理员下载
    const file = await req(srv.port, `/api/v1/admin/files/${hash}.xrk?name=session01.xrk`, { headers: { cookie } });
    assert.equal(file.status, 200);
    assert.equal(await file.text(), "fake-xrk-bytes");
  } finally {
    srv.close();
  }
});

test("upload with failing extractor is rejected and leaves no file", async () => {
  const srv = await startServer({
    adminPassword: "secret",
    uploadRoot: fs.mkdtempSync(path.join(os.tmpdir(), "scut-upload-")),
    runExtractor: async () => {
      throw new Error("不是 XRK 帧流");
    },
  });
  try {
    const cookie = (await login(srv.port, "secret")).headers.get("set-cookie").split(";")[0];
    const res = await req(srv.port, "/api/v1/admin/uploads", {
      method: "POST",
      headers: { cookie, "x-file-name": "broken.xrk" },
      body: Buffer.from("broken"),
    });
    assert.equal(res.status, 422);
    const hash = createHash("sha256").update("broken").digest("hex");
    assert.ok(!fs.existsSync(path.join(srv.uploadRoot, `${hash}.xrk`)));
    assert.ok(!srv.db.datasets.has(hash));
  } finally {
    srv.close();
  }
});

test("upload rejects non xrk/xrz types", async () => {
  const srv = await startServer({ adminPassword: "secret", runExtractor: okExtractor });
  try {
    const cookie = (await login(srv.port, "secret")).headers.get("set-cookie").split(";")[0];
    const res = await req(srv.port, "/api/v1/admin/uploads", {
      method: "POST",
      headers: { cookie, "x-file-name": "notes.csv" },
      body: Buffer.from("a,b"),
    });
    assert.equal(res.status, 415);
  } finally {
    srv.close();
  }
});

test("client downloads by file hash and deletion removes record and file", async () => {
  const srv = await startServer({
    adminPassword: "secret",
    uploadRoot: fs.mkdtempSync(path.join(os.tmpdir(), "scut-upload-")),
    runExtractor: okExtractor,
  });
  try {
    const cookie = (await login(srv.port, "secret")).headers.get("set-cookie").split(";")[0];
    const created = await req(srv.port, "/api/v1/admin/tokens", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: " downloader" }),
    });
    const { token: tokenRow } = await created.json();

    await req(srv.port, "/api/v1/admin/uploads", {
      method: "POST",
      headers: { cookie, "x-file-name": "session01.xrk" },
      body: Buffer.from("fake-xrk-bytes"),
    });
    const hash = createHash("sha256").update("fake-xrk-bytes").digest("hex");

    const denied = await req(srv.port, `/api/v1/files/${hash}`);
    assert.equal(denied.status, 401);
    const file = await req(srv.port, `/api/v1/files/${hash}`, {
      headers: { authorization: `Bearer ${tokenRow.token}` },
    });
    assert.equal(file.status, 200);
    assert.equal(await file.text(), "fake-xrk-bytes");

    const del = await req(srv.port, `/api/v1/admin/datasets/${hash}`, { method: "DELETE", headers: { cookie } });
    assert.equal(del.status, 200);
    assert.ok(!fs.existsSync(path.join(srv.uploadRoot, `${hash}.xrk`)));
    assert.equal(
      (await req(srv.port, `/api/v1/files/${hash}`, { headers: { authorization: `Bearer ${tokenRow.token}` } }))
        .status,
      404,
    );
  } finally {
    srv.close();
  }
});

// ===== 多管理员与密码修改 =====

test("admin can change own password; old one stops working", async () => {
  const srv = await startServer({ adminPassword: "secret" });
  try {
    const cookie = (await login(srv.port, "secret")).headers.get("set-cookie").split(";")[0];

    const wrongCurrent = await req(srv.port, "/api/v1/admin/password", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ current: "nope", next: "newpass1" }),
    });
    assert.equal(wrongCurrent.status, 401);

    const changed = await req(srv.port, "/api/v1/admin/password", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ current: "secret", next: "newpass1" }),
    });
    assert.equal(changed.status, 200);

    // 旧密码失效
    assert.equal((await login(srv.port, "secret")).status, 401);
    // 新密码可用
    assert.equal((await login(srv.port, "newpass1")).status, 200);
  } finally {
    srv.close();
  }
});

test("multiple admin accounts: add, log in as another admin, delete rules", async () => {
  const srv = await startServer({ adminPassword: "secret" });
  try {
    const cookie = (await login(srv.port, "secret")).headers.get("set-cookie").split(";")[0];

    // 添加第二位管理员
    const added = await req(srv.port, "/api/v1/admin/accounts", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ username: "deputy", password: "123456" }),
    });
    assert.equal(added.status, 201);

    // deputy 能登录并以自己身份访问管理接口
    const deputyLogin = await req(srv.port, "/api/v1/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "deputy", password: "123456" }),
    });
    assert.equal(deputyLogin.status, 200);
    const deputyCookie = deputyLogin.headers.get("set-cookie").split(";")[0];
    assert.equal((await req(srv.port, "/api/v1/admin/tokens", { headers: { cookie: deputyCookie } })).status, 200);

    // 列表带 current 标识
    const listed = await (await req(srv.port, "/api/v1/admin/accounts", { headers: { cookie: deputyCookie } })).json();
    assert.equal(listed.accounts.length, 2, JSON.stringify(listed));
    assert.equal(listed.accounts.find((a) => a.username === "deputy").id, listed.current);

    // 不能删自己
    const selfId = listed.accounts.find((a) => a.username === "deputy").id;
    assert.equal(
      (await req(srv.port, `/api/v1/admin/accounts/${selfId}`, { method: "DELETE", headers: { cookie: deputyCookie } }))
        .status,
      400,
    );

    // admin 删除 deputy → deputy 会话立即失效
    const deputyId = listed.accounts.find((a) => a.username === "deputy").id;
    assert.equal(
      (await req(srv.port, `/api/v1/admin/accounts/${deputyId}`, { method: "DELETE", headers: { cookie } })).status,
      200,
    );
    assert.equal((await req(srv.port, "/api/v1/admin/tokens", { headers: { cookie: deputyCookie } })).status, 401);
    assert.equal(
      (
        await req(srv.port, "/api/v1/admin/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ username: "deputy", password: "123456" }),
        })
      ).status,
      401,
    );
  } finally {
    srv.close();
  }
});

test("session check endpoint validates existing cookies without re-login", async () => {
  const srv = await startServer({ adminPassword: "secret" });
  try {
    // 未登录 → 401
    assert.equal((await req(srv.port, "/api/v1/admin/session")).status, 401);
    // 登录后带 Cookie → 返回用户名
    const cookie = (await login(srv.port, "secret")).headers.get("set-cookie").split(";")[0];
    const res = await req(srv.port, "/api/v1/admin/session", { headers: { cookie } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.username, "admin");
  } finally {
    srv.close();
  }
});

// ===== 软件发布（releases）与更新检查 =====

const SIG = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZQ==" + "x".repeat(64);

async function publishFullRelease(port, cookie, tag, uploadRoot, { draft = false } = {}) {
  const created = await req(port, "/api/v1/admin/releases", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ tag, title: `rel ${tag}`, notes: "修复若干问题", draft: true }),
  });
  const id = (await created.json()).release.id;
  await req(port, `/api/v1/admin/releases/${id}/installer`, {
    method: "PUT",
    headers: { cookie, "x-file-name": `setup-${tag}.exe` },
    body: Buffer.from(`installer-${tag}`),
  });
  await req(port, `/api/v1/admin/releases/${id}/signature`, {
    method: "PUT",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ signature: SIG }),
  });
  if (!draft) {
    const pub = await req(port, `/api/v1/admin/releases/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ draft: false }),
    });
    assert.equal(pub.status, 200);
  }
  return id;
}

test("release publish flow: create, attach assets, publish, latest.json shape", async () => {
  const srv = await startServer({
    adminPassword: "secret",
    uploadRoot: fs.mkdtempSync(path.join(os.tmpdir(), "scut-rel-")),
    runExtractor: okExtractor,
  });
  try {
    const cookie = (await login(srv.port, "secret")).headers.get("set-cookie").split(";")[0];

    // 无发布时 latest 404
    assert.equal((await req(srv.port, "/api/v1/updates/latest")).status, 404);

    // tag 格式校验
    assert.equal(
      (
        await req(srv.port, "/api/v1/admin/releases", {
          method: "POST",
          headers: { "content-type": "application/json", cookie },
          body: JSON.stringify({ tag: "not-a-version" }),
        })
      ).status,
      400,
    );
    // 重复 tag 409
    await publishFullRelease(srv.port, cookie, "1.0.1", srv.uploadRoot, { draft: true });
    assert.equal(
      (
        await req(srv.port, "/api/v1/admin/releases", {
          method: "POST",
          headers: { "content-type": "application/json", cookie },
          body: JSON.stringify({ tag: "v1.0.1" }),
        })
      ).status,
      409,
    );

    // 未带资产的草稿不能发布
    const bare = await req(srv.port, "/api/v1/admin/releases", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ tag: "1.0.2" }),
    });
    const bareId = (await bare.json()).release.id;
    assert.equal(
      (await req(srv.port, `/api/v1/admin/releases/${bareId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ draft: false }),
      })).status,
      400,
    );

    // 把之前的 1.0.1 草稿发布；再完整发布 1.0.3 → latest 应取 1.0.3
    const draftList = await (await req(srv.port, "/api/v1/admin/releases", { headers: { cookie } })).json();
    const draft101 = draftList.releases.find((r) => r.tag === "1.0.1");
    await req(srv.port, `/api/v1/admin/releases/${draft101.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ draft: false }),
    });
    await publishFullRelease(srv.port, cookie, "1.0.3", srv.uploadRoot);

    const latest = await req(srv.port, "/api/v1/updates/latest");
    assert.equal(latest.status, 200);
    const body = await latest.json();
    assert.equal(body.version, "1.0.3");
    assert.match(body.notes, /修复若干问题/);
    const platform = body.platforms["windows-x86_64"];
    assert.match(platform.signature, /^dW50cnVzdGVk/);
    assert.match(platform.url, /\/api\/v1\/updates\/files\/[0-9a-f]{64}$/);

    // 公开下载安装包且内容正确
    const hash = platform.url.split("/").pop();
    const dl = await req(srv.port, `/api/v1/updates/files/${hash}`);
    assert.equal(dl.status, 200);
    assert.equal(await dl.text(), "installer-1.0.3");

    // 撤下 1.0.2 → latest 回退到 1.0.1
    const rel = await (await req(srv.port, "/api/v1/admin/releases", { headers: { cookie } })).json();
    const rel2 = rel.releases.find((r) => r.tag === "1.0.3");
    await req(srv.port, `/api/v1/admin/releases/${rel2.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ draft: true }),
    });
    const latest2 = await (await req(srv.port, "/api/v1/updates/latest")).json();
    assert.equal(latest2.version, "1.0.1"); // 撤下 1.0.3 后回退到已发布的 1.0.1
  } finally {
    srv.close();
  }
});
