// SCUT 管理面板 v2：登录 / 记录（上传、下载、删除、归档）/ 日期备注 / 密钥分发
const app = document.getElementById("app");

let state = {
  loggedIn: false,
  tab: "records",
  records: [],
  notes: new Map(),
  tokens: [],
  notice: null,
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (response.status === 401) {
    state.loggedIn = false;
    render();
    throw new Error("登录已过期，请重新登录");
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || `请求失败 HTTP ${response.status}`);
  return body;
}

function setNotice(text, ok = false) {
  state.notice = text ? { text, ok } : null;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fmtSize(bytes) {
  const n = Number(bytes) || 0;
  if (n > 1024 * 1024 * 1024) return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (n > 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n > 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}

// ===== 渲染 =====

function render() {
  if (!state.loggedIn) return renderLogin();
  renderShell();
}

function renderLogin() {
  app.innerHTML = `
    <div class="topbar"><span class="logo f1">SCUT RACING TELEMETRY · ADMIN</span></div>
    <div class="wrap" style="max-width: 420px; margin-top: 60px;">
      <div class="card">
        <h3 class="f1">管理员登录</h3>
        <div class="kv"><label>管理密码</label><input id="login-password" type="password" autofocus /></div>
        <button class="primary" id="login-button" style="width: 100%;">登录</button>
        <div id="login-error" class="hint" style="color: var(--red); margin-top: 8px;"></div>
      </div>
    </div>`;
  const submit = async () => {
    const password = document.getElementById("login-password").value;
    try {
      await api("/api/v1/admin/login", { method: "POST", body: JSON.stringify({ password }) });
      state.loggedIn = true;
      await reload();
    } catch (error) {
      document.getElementById("login-error").textContent = error.message;
    }
  };
  document.getElementById("login-button").addEventListener("click", submit);
  document.getElementById("login-password").addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit();
  });
}

function renderShell() {
  const tabs = [
    ["records", "记录"],
    ["notes", "日期备注"],
    ["settings", "设置 · 密钥分发"],
  ];
  app.innerHTML = `
    <div class="topbar">
      <span class="logo f1">SCUT RACING TELEMETRY · ADMIN</span>
      <div class="tabs">${tabs.map(([key, label]) => `<button class="tab f1 ${state.tab === key ? "active" : ""}" data-tab="${key}">${label}</button>`).join("")}</div>
      <span class="spacer"></span>
      <button class="ghost" id="logout">登出</button>
    </div>
    <div class="wrap">
      ${state.notice ? `<div class="banner ${state.notice.ok ? "ok" : ""}">${esc(state.notice.text)}</div>` : ""}
      <div id="tab-content"></div>
    </div>`;
  app.querySelectorAll("[data-tab]").forEach((button) =>
    button.addEventListener("click", () => {
      state.tab = button.dataset.tab;
      setNotice(null);
      renderShell();
      renderTab();
    }),
  );
  document.getElementById("logout").addEventListener("click", async () => {
    await api("/api/v1/admin/logout", { method: "POST" }).catch(() => {});
    state.loggedIn = false;
    render();
  });
  renderTab();
}

function renderTab() {
  const root = document.getElementById("tab-content");
  if (state.tab === "records") renderRecords(root);
  else if (state.tab === "notes") renderNotes(root);
  else renderSettings(root);
}

// ===== 记录页 =====

function renderRecords(root) {
  const groups = new Map();
  for (const record of [...state.records].sort((a, b) => (a.record_date < b.record_date ? 1 : -1))) {
    const key = record.record_date || "未知日期";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  root.innerHTML = `
    <div class="card">
      <div style="display: flex; align-items: center; gap: 10px;">
        <h3 class="f1" style="margin: 0; flex: 1;">数据文件</h3>
        <input type="file" id="upload-input" accept=".xrk,.xrz" style="display: none;" />
        <button class="primary" id="upload-button">上传 XRK / XRZ</button>
      </div>
      <div class="hint" style="margin-top: 8px;">上传后服务器自动解析元数据并生成记录（同名文件按内容去重）。</div>
    </div>
    ${groups.size === 0 ? '<div class="card hint">云端还没有记录，先上传一个 .xrk / .xrz 文件。</div>' : ""}
    ${[...groups.entries()]
      .map(([date, rows]) => {
        const note = state.notes.get(date) || "";
        return `<div class="date-head"><span class="d f1">${esc(date)}</span>${note ? `<span class="n">📝 ${esc(note)}</span>` : ""}</div>
          ${rows.map(renderRecordRow).join("")}`;
      })
      .join("")}`;
  document.getElementById("upload-button").addEventListener("click", () => document.getElementById("upload-input").click());
  document.getElementById("upload-input").addEventListener("change", onUpload);
  root.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", onRecordAction));
}

function renderRecordRow(record) {
  const archived = Boolean(record.is_archived);
  return `
    <div class="row" data-hash="${esc(record.file_hash)}">
      <div class="meta">
        <div class="name">${esc(record.file_name)} ${archived ? '<span class="badge archived">已归档</span>' : ""}</div>
        <div class="sub">${esc(record.vehicle || "未知车辆")} · ${esc(record.racer || "未知车手")} · 开始于 ${esc(record.start_time || "--:--")} · ${fmtSize(record.file_size)}</div>
      </div>
      <button class="line" data-action="download" ${record.storage_key ? "" : "disabled"}>下载</button>
      <button class="line" data-action="archive">${archived ? "恢复" : "归档"}</button>
      <button class="line" data-action="delete">删除</button>
    </div>`;
}

async function onUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  setNotice(`正在上传并解析 ${file.name} …`, true);
  renderShell();
  try {
    const res = await fetch("/api/v1/admin/uploads", {
      method: "POST",
      headers: { "x-file-name": file.name, "content-type": "application/octet-stream" },
      body: file,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.error?.message || `上传失败 HTTP ${res.status}`);
    setNotice(body.duplicate ? `${file.name} 已存在（按内容去重，未重复登记）。` : `${file.name} 上传成功，已生成记录。`, true);
  } catch (error) {
    setNotice(`上传失败：${error.message}`);
  }
  await reload();
}

async function onRecordAction(event) {
  const row = event.target.closest(".row");
  const hash = row.dataset.hash;
  const record = state.records.find((r) => r.file_hash === hash);
  const action = event.target.dataset.action;
  try {
    if (action === "download") {
      window.open(`/api/v1/admin/files/${record.storage_key}?name=${encodeURIComponent(record.file_name)}`);
      return;
    }
    if (action === "archive") {
      await api(`/api/v1/admin/datasets/${hash}`, { method: "PATCH", body: JSON.stringify({ is_archived: !record.is_archived }) });
      setNotice(record.is_archived ? "已恢复。" : "已归档。", true);
    }
    if (action === "delete") {
      if (!window.confirm(`确认删除 ${record.file_name}？记录与服务器文件会一起删除，不可恢复。`)) return;
      await api(`/api/v1/admin/datasets/${hash}`, { method: "DELETE" });
      setNotice("已删除。", true);
    }
  } catch (error) {
    setNotice(`操作失败：${error.message}`);
  }
  await reload();
}

// ===== 日期备注页 =====

function renderNotes(root) {
  const dates = [...new Set(state.records.map((r) => r.record_date).filter(Boolean))].sort().reverse();
  root.innerHTML = `
    <div class="card">
      <h3 class="f1">日期备注</h3>
      <div class="hint">备注会同步显示在队员软件的记录列表上；留空保存即清除。</div>
    </div>
    ${dates.length === 0 ? '<div class="card hint">还没有任何记录日期。</div>' : ""}
    ${dates
      .map(
        (date) => `
      <div class="card" data-date="${esc(date)}">
        <h3 class="f1">${esc(date)}</h3>
        <textarea data-note>${esc(state.notes.get(date) || "")}</textarea>
        <div style="margin-top: 8px; text-align: right;"><button class="primary" data-save>保存备注</button></div>
      </div>`,
      )
      .join("")}`;
  root.querySelectorAll("[data-save]").forEach((button) =>
    button.addEventListener("click", async (event) => {
      const card = event.target.closest("[data-date]");
      const date = card.dataset.date;
      const note = card.querySelector("[data-note]").value;
      try {
        await api(`/api/v1/admin/date-notes/${date}`, { method: "PUT", body: JSON.stringify({ note }) });
        state.notes.set(date, note);
        setNotice(`${date} 备注已保存。`, true);
        renderShell();
        renderTab();
      } catch (error) {
        setNotice(`保存失败：${error.message}`);
        renderShell();
        renderTab();
      }
    }),
  );
}

// ===== 设置页（密钥分发） =====

function renderSettings(root) {
  const active = state.tokens.filter((t) => !t.revoked_at);
  root.innerHTML = `
    <div class="card copy-pair">
      <h3 class="f1">分发给队员</h3>
      <div class="hint">把下面两个值发给队员，队员在软件「设置 → 云端服务器」里填好即可连接。</div>
      <div class="kv"><label>服务器链接</label><input id="pair-link" readonly value="${esc(location.origin)}" /><button class="line" data-copy="pair-link">复制</button></div>
      <div class="kv"><label>访问密钥</label><select id="pair-token">${active.map((t) => `<option value="${esc(t.token)}">${esc(t.name)}</option>`).join("")}</select><button class="line" data-copy-select="pair-token">复制</button></div>
      ${active.length === 0 ? '<div class="hint" style="color: var(--red);">还没有可用密钥，先在下方生成。</div>' : ""}
    </div>
    <div class="card">
      <h3 class="f1">生成新密钥</h3>
      <div class="kv"><label>名称</label><input id="token-name" placeholder="例如：张三-笔记本" /><button class="primary" id="token-create">生成</button></div>
    </div>
    <div class="card">
      <h3 class="f1">全部密钥</h3>
      ${state.tokens.length === 0 ? '<div class="hint">还没有密钥。</div>' : ""}
      ${state.tokens
        .map(
          (t) => `
        <div class="row">
          <div class="meta">
            <div class="name">${esc(t.name)} ${t.revoked_at ? '<span class="badge archived">已吊销</span>' : '<span class="badge status-ok">有效</span>'}</div>
            <div class="sub mono">${esc(t.token)}</div>
          </div>
          <button class="line" data-copy-token="${esc(t.token)}">复制</button>
          ${t.revoked_at ? "" : `<button class="line" data-revoke="${t.id}">吊销</button>`}
        </div>`,
        )
        .join("")}
    </div>`;
  root.querySelectorAll("[data-copy]").forEach((button) =>
    button.addEventListener("click", async () => {
      const ok = await copyText(document.getElementById(button.dataset.copy).value);
      setNotice(ok ? "已复制。" : "复制失败，请手动选择文本。", ok);
      renderShell();
      renderTab();
    }),
  );
  root.querySelectorAll("[data-copy-select]").forEach((button) =>
    button.addEventListener("click", async () => {
      const ok = await copyText(document.getElementById(button.dataset.copySelect).value);
      setNotice(ok ? "已复制密钥。" : "复制失败，请手动复制。", ok);
      renderShell();
      renderTab();
    }),
  );
  root.querySelectorAll("[data-copy-token]").forEach((button) =>
    button.addEventListener("click", async () => {
      const ok = await copyText(button.dataset.copyToken);
      setNotice(ok ? "已复制密钥。" : "复制失败。", ok);
      renderShell();
      renderTab();
    }),
  );
  root.querySelectorAll("[data-revoke]").forEach((button) =>
    button.addEventListener("click", async () => {
      if (!window.confirm("吊销后该密钥立即失效，队员需要换新密钥。确认吊销？")) return;
      try {
        await api(`/api/v1/admin/tokens/${button.dataset.revoke}`, { method: "DELETE" });
        setNotice("已吊销。", true);
      } catch (error) {
        setNotice(`吊销失败：${error.message}`);
      }
      await reload();
    }),
  );
  document.getElementById("token-create").addEventListener("click", async () => {
    const name = document.getElementById("token-name").value.trim();
    if (!name) {
      setNotice("请填写密钥名称。");
      renderShell();
      renderTab();
      return;
    }
    try {
      await api("/api/v1/admin/tokens", { method: "POST", body: JSON.stringify({ name }) });
      setNotice(`密钥「${name}」已生成，可在列表中复制。`, true);
    } catch (error) {
      setNotice(`生成失败：${error.message}`);
    }
    await reload();
  });
}

// ===== 数据加载 =====

async function reload() {
  if (!state.loggedIn) {
    render();
    return;
  }
  try {
    const [datasetsBody, notesBody, tokensBody] = await Promise.all([
      api("/api/v1/datasets?include_archived=true"),
      api("/api/v1/date-notes"),
      api("/api/v1/admin/tokens"),
    ]);
    state.records = datasetsBody.datasets || [];
    state.notes = new Map((notesBody.date_notes || []).map((item) => [item.date_key, item.note]));
    state.tokens = tokensBody.tokens || [];
    setNotice(null);
  } catch (error) {
    setNotice(`加载失败：${error.message}`);
  }
  render();
}

render();
reload();
