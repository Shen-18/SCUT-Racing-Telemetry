// SCUT 管理面板 v2：登录（多管理员）/ 记录（上传、下载、删除）/ 日期备注 / 密钥分发
const app = document.getElementById("app");

let state = {
  loggedIn: false,
  tab: "records",
  records: [],
  notes: new Map(),
  tokens: [],
  adminAccounts: [],
  currentAdminId: null,
  notice: null,
  // 记录页状态（对齐本地 DATABASE 页）
  selectedGroup: null,
  query: "",
  selected: new Set(),
  editingDate: null,
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

function notePreview(note, maxLength = 72) {
  const compact = String(note || "").replace(/\s+/g, " ").trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 1)}…` : compact;
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
        <div class="kv"><label>用户名</label><input id="login-username" type="text" value="admin" /></div>
        <div class="kv"><label>密码</label><input id="login-password" type="password" autofocus /></div>
        <button class="primary" id="login-button" style="width: 100%;">登录</button>
        <div id="login-error" class="hint" style="color: var(--red); margin-top: 8px;"></div>
      </div>
    </div>`;
  const submit = async () => {
    const username = document.getElementById("login-username").value.trim();
    const password = document.getElementById("login-password").value;
    try {
      await api("/api/v1/admin/login", { method: "POST", body: JSON.stringify({ username, password }) });
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
  else renderSettings(root);
}

// ===== 记录页（复刻本地 DATABASE 页：左分组列表 + 右数据明细网格；无详情查看） =====

function renderRecords(root) {
  const dates = [...new Set(state.records.map((r) => r.record_date).filter(Boolean))].sort().reverse();
  const query = state.query.trim().toLowerCase();
  const visible = state.records.filter((r) => {
    if (state.selectedGroup && r.record_date !== state.selectedGroup) return false;
    if (!query) return true;
    return (
      (r.file_name || "").toLowerCase().includes(query) ||
      (r.racer || "").toLowerCase().includes(query) ||
      (r.vehicle || "").toLowerCase().includes(query)
    );
  });
  const allSelected = visible.length > 0 && visible.every((r) => state.selected.has(r.file_hash));

  root.innerHTML = `
    <div class="layout">
      <aside class="left-col">
        <div class="group-row ${state.selectedGroup === null ? "active" : ""}" data-group="">
          <span class="gname f1">全部</span><span></span>
          <span class="gcount">${state.records.length}</span>
        </div>
        ${dates
          .map((date) => {
            const rows = state.records.filter((r) => r.record_date === date);
            const note = state.notes.get(date) || "";
            const editing = state.editingDate === date;
            return `
            <div class="group-row ${state.selectedGroup === date ? "active" : ""}" data-group="${esc(date)}">
              <span class="gname f1" title="${esc(date)}">${esc(date)}</span>
              <span class="gnote ${note ? "" : "gnone"}" data-edit-note="${esc(date)}" title="点击编辑当天备注">${editing ? "编辑中…" : note ? esc(notePreview(note, 24)) : "＋备注"}</span>
              <span class="gcount">${rows.length}</span>
            </div>
            ${
              editing
                ? `<div class="note-editor">
                     <textarea id="note-editor-text">${esc(note)}</textarea>
                     <div style="display: flex; gap: 6px; justify-content: flex-end; margin-top: 6px;">
                       <button class="line" data-cancel-note="${esc(date)}">取消</button>
                       <button class="primary" data-save-note="${esc(date)}">保存</button>
                     </div>
                   </div>`
                : ""
            }`;
          })
          .join("")}
      </aside>
      <section class="right-pane">
        <div class="detail-header">
          <span class="title f1">数据明细</span>
          ${state.records.length > 0 ? '<input class="search" id="library-search" placeholder="搜索车手 / 车辆…" />' : ""}
          <span class="count f1">${visible.length} 条记录${state.selectedGroup ? ` · ${esc(state.selectedGroup)}` : ""}</span>
          <span style="flex: 1;"></span>
          ${state.selected.size > 0 ? `<span style="color: var(--red); font-weight: 700; font-size: 11px; letter-spacing: 1px;">已选 ${state.selected.size} 条</span><button class="line" id="delete-selected">删除所选</button>` : ""}
          <input type="file" id="upload-input" accept=".xrk,.xrz" style="display: none;" />
          <button class="primary" id="upload-button">上传文件</button>
        </div>
        ${
          state.records.length === 0
            ? emptyStateHtml()
            : `
        <div class="grid-header">
          <span class="checkbox ${allSelected ? "checked" : state.selected.size > 0 ? "partial" : ""}" id="select-all" title="全选 / 全不选"></span>
          <span>开始时间</span><span>车手</span><span>车辆</span><span>操作</span>
        </div>
        <div style="flex: 1; overflow-y: auto; min-height: 0;" id="record-rows">
          ${renderRecordRowsHtml(visible)}
        </div>`
        }
      </section>
    </div>`;

  root.querySelectorAll(".group-row").forEach((row) =>
    row.addEventListener("click", () => {
      state.selectedGroup = row.dataset.group || null;
      renderShell();
      renderTab();
    }),
  );
  const search = document.getElementById("library-search");
  if (search) {
    search.value = state.query;
    search.addEventListener("input", () => {
      state.query = search.value;
      renderShell();
      renderTab();
      const again = document.getElementById("library-search");
      if (again) {
        again.focus();
        again.setSelectionRange(again.value.length, again.value.length);
      }
    });
  }
  const selectAll = document.getElementById("select-all");
  if (selectAll)
    selectAll.addEventListener("click", () => {
      if (allSelected) visible.forEach((r) => state.selected.delete(r.file_hash));
      else visible.forEach((r) => state.selected.add(r.file_hash));
      renderShell();
      renderTab();
    });
  root.querySelectorAll("[data-check]").forEach((box) =>
    box.addEventListener("click", () => {
      const hash = box.dataset.check;
      if (state.selected.has(hash)) state.selected.delete(hash);
      else state.selected.add(hash);
      renderShell();
      renderTab();
    }),
  );
  root.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", onRecordAction));
  // 当天备注：点击备注位进入编辑（与桌面右键菜单等价，网页版用点击更顺手）
  root.querySelectorAll("[data-edit-note]").forEach((el) =>
    el.addEventListener("click", (event) => {
      event.stopPropagation();
      state.editingDate = el.dataset.editNote;
      renderShell();
      renderTab();
    }),
  );
  root.querySelectorAll("[data-save-note]").forEach((button) =>
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      const date = button.dataset.saveNote;
      const note = document.getElementById("note-editor-text").value;
      try {
        await api(`/api/v1/admin/date-notes/${date}`, { method: "PUT", body: JSON.stringify({ note }) });
        state.notes.set(date, note);
        state.editingDate = null;
        setNotice(`${date} 备注已保存。`, true);
      } catch (error) {
        setNotice(`保存失败：${error.message}`);
      }
      renderShell();
      renderTab();
    }),
  );
  root.querySelectorAll("[data-cancel-note]").forEach((button) =>
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      state.editingDate = null;
      renderShell();
      renderTab();
    }),
  );
  const deleteSelected = document.getElementById("delete-selected");
  if (deleteSelected)
    deleteSelected.addEventListener("click", async () => {
      const hashes = [...state.selected];
      if (!window.confirm(`确认删除所选 ${hashes.length} 条记录？记录与服务器文件会一起删除，不可恢复。`)) return;
      let okCount = 0;
      for (const hash of hashes) {
        try {
          await api(`/api/v1/admin/datasets/${hash}`, { method: "DELETE" });
          state.selected.delete(hash);
          okCount += 1;
        } catch (error) {
          setNotice(`删除失败：${error.message}`);
          break;
        }
      }
      if (okCount > 0) setNotice(`已删除 ${okCount} 条记录。`, true);
      await reload();
    });
  document.getElementById("upload-button").addEventListener("click", () => document.getElementById("upload-input").click());
  document.getElementById("upload-input").addEventListener("change", onUpload);
}

function emptyStateHtml() {
  return `
    <div class="empty-state">
      <div class="db-logo"><span>DB</span></div>
      <div class="f1" style="font-weight: 700; font-size: 14px; letter-spacing: 1.5px;">上传遥测数据以开始</div>
      <div class="f1" style="font-size: 11px; letter-spacing: 1px; margin-top: 6px;">点击「上传文件」选择 .xrk / .xrz 文件</div>
    </div>`;
}

// 记录行集合：全部视图下按日期分节（条头样式对齐桌面 OVERLAY 选择页）
function renderRecordRowsHtml(visible) {
  if (visible.length === 0) {
    return '<div style="padding: 32px; text-align: center; color: var(--dim); font-weight: 700; letter-spacing: 1.5px;">没有匹配的记录</div>';
  }
  if (state.selectedGroup !== null) {
    return visible.map(renderRecordRow).join("");
  }
  // 按日期分节，节内按开始时间正序
  const buckets = new Map();
  for (const record of visible) {
    const key = record.record_date || "未知日期";
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(record);
  }
  const sections = [...buckets.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  return sections
    .map(([date, rows]) => {
      rows.sort((a, b) => (a.start_time > b.start_time ? 1 : -1));
      return `
      <section>
        <div class="date-band">
          <span class="date-band-bar"></span><span>${esc(date === "未知日期" ? "未知日期" : date)}</span>
          <span class="date-band-count">${rows.length} 条</span>
        </div>
        ${rows.map(renderRecordRow).join("")}
      </section>`;
    })
    .join("");
}

function renderRecordRow(record) {
  const checked = state.selected.has(record.file_hash);
  return `
    <div class="grid-row" data-hash="${esc(record.file_hash)}">
      <span class="checkbox ${checked ? "checked" : ""}" data-check="${esc(record.file_hash)}" title="勾选以批量删除"></span>
      <span class="dim" title="文件时间 ${esc(new Date((record.source_mtime_unix || 0) * 1000).toLocaleString())}">${esc(record.start_time || "—")}</span>
      <span class="cell" title="${esc(record.racer || "")}">${esc(record.racer || "—")}</span>
      <span class="dim" title="${esc(record.vehicle || "")}">${esc(record.vehicle || "—")}</span>
      <span class="row-actions">
        <button class="icon-btn" data-action="download" data-hash="${esc(record.file_hash)}" ${record.storage_key ? "" : "disabled"} title="下载原始文件">⬇</button>
        <button class="icon-btn danger" data-action="delete" data-hash="${esc(record.file_hash)}" title="删除记录与文件">✕</button>
      </span>
    </div>`;
}

async function onRecordAction(event) {
  const hash = event.target.dataset.hash;
  const record = state.records.find((r) => r.file_hash === hash);
  if (!record) return;
  const action = event.target.dataset.action;
  try {
    if (action === "download") {
      window.open(`/api/v1/admin/files/${record.storage_key}?name=${encodeURIComponent(record.file_name)}`);
      return;
    }
    if (action === "delete") {
      if (!window.confirm(`确认删除 ${record.file_name}？记录与服务器文件会一起删除，不可恢复。`)) return;
      await api(`/api/v1/admin/datasets/${hash}`, { method: "DELETE" });
      state.selected.delete(hash);
      setNotice("已删除。", true);
    }
  } catch (error) {
    setNotice(`操作失败：${error.message}`);
  }
  await reload();
}

// ===== 设置页（密钥分发） =====

function renderSettings(root) {
  const active = state.tokens.filter((t) => !t.revoked_at);
  root.innerHTML = `
    <div class="card">
      <h3 class="f1">服务器地址</h3>
      <div class="kv"><label>链接</label><input id="pair-link" readonly value="${esc(location.origin)}" /><button class="line" data-copy="pair-link">复制</button></div>
    </div>
    <div class="card">
      <h3 class="f1">密钥分发</h3>
      <div class="kv"><label>新密钥名称</label><input id="token-name" placeholder="例如：张三-笔记本" /><button class="primary" id="token-create">生成</button></div>
      ${state.tokens.length === 0 ? '<div class="hint">还没有密钥，生成后复制发给队员。</div>' : ""}
      ${state.tokens
        .map(
          (t) => `
        <div class="row">
          <div class="meta">
            <div class="name">${esc(t.name)} ${t.revoked_at ? '<span class="badge archived">已吊销</span>' : '<span class="badge status-ok">有效</span>'}</div>
            <div class="sub mono">${esc(t.token)}</div>
          </div>
          <button class="line" data-copy-token="${esc(t.token)}" ${t.revoked_at ? "disabled" : ""}>复制</button>
          ${t.revoked_at ? "" : `<button class="line" data-revoke="${t.id}">吊销</button>`}
        </div>`,
        )
        .join("")}
    </div>
    <div class="card">
      <h3 class="f1">修改我的密码</h3>
      <div class="kv"><label>当前密码</label><input id="pw-current" type="password" /></div>
      <div class="kv"><label>新密码</label><input id="pw-next" type="password" placeholder="至少 6 位" /></div>
      <div style="text-align: right;"><button class="primary" id="pw-save">修改密码</button></div>
    </div>
    <div class="card">
      <h3 class="f1">管理员账号（${state.adminAccounts.length}）</h3>
      <div class="kv"><label>用户名</label><input id="admin-username" placeholder="2-24 字符，无空格" /><input id="admin-password" type="password" placeholder="密码（至少 6 位）" style="flex: 1;" /><button class="primary" id="admin-add">添加</button></div>
      ${state.adminAccounts
        .map(
          (a) => `
        <div class="row">
          <div class="meta">
            <div class="name">${esc(a.username)} ${a.id === state.currentAdminId ? '<span class="badge status-ok">当前登录</span>' : ""}</div>
            <div class="sub">添加于 ${esc(new Date((a.created_at || 0) * 1000).toLocaleDateString())}</div>
          </div>
          <button class="line" data-del-admin="${a.id}" ${a.id === state.currentAdminId ? "disabled" : ""} title="${a.id === state.currentAdminId ? "不能删除当前登录的账号" : "删除该管理员"}">删除</button>
        </div>`,
        )
        .join("")}
      <div class="hint" style="margin-top: 8px;">每位管理员都能登录本面板；删除账号会立即吊销其所有登录会话。</div>
    </div>`;

  root.querySelectorAll("[data-copy]").forEach((button) =>
    button.addEventListener("click", async () => {
      const ok = await copyText(document.getElementById(button.dataset.copy).value);
      setNotice(ok ? "链接已复制。" : "复制失败，请手动选择文本。", ok);
      renderShell();
      renderTab();
    }),
  );
  root.querySelectorAll("[data-copy-token]").forEach((button) =>
    button.addEventListener("click", async () => {
      const ok = await copyText(button.dataset.copyToken);
      setNotice(ok ? "密钥已复制，发给队员即可。" : "复制失败，请手动复制。", ok);
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
      setNotice(`密钥「${name}」已生成，在下方复制发给队员。`, true);
    } catch (error) {
      setNotice(`生成失败：${error.message}`);
    }
    await reload();
  });
  document.getElementById("pw-save").addEventListener("click", async () => {
    const current = document.getElementById("pw-current").value;
    const next = document.getElementById("pw-next").value;
    try {
      await api("/api/v1/admin/password", { method: "PUT", body: JSON.stringify({ current, next }) });
      setNotice("密码已修改，其他设备的登录已被踢下线。", true);
      renderShell();
      renderTab();
    } catch (error) {
      setNotice(`修改失败：${error.message}`);
      renderShell();
      renderTab();
    }
  });
  document.getElementById("admin-add").addEventListener("click", async () => {
    const username = document.getElementById("admin-username").value.trim();
    const password = document.getElementById("admin-password").value;
    try {
      await api("/api/v1/admin/accounts", { method: "POST", body: JSON.stringify({ username, password }) });
      setNotice(`管理员「${username}」已添加。`, true);
    } catch (error) {
      setNotice(`添加失败：${error.message}`);
    }
    await reload();
  });
  root.querySelectorAll("[data-del-admin]").forEach((button) =>
    button.addEventListener("click", async () => {
      if (!window.confirm("删除该管理员？其所有登录会话会立即失效。")) return;
      try {
        await api(`/api/v1/admin/accounts/${button.dataset.delAdmin}`, { method: "DELETE" });
        setNotice("已删除。", true);
      } catch (error) {
        setNotice(`删除失败：${error.message}`);
      }
      await reload();
    }),
  );
}

async function onUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  setNotice(`正在上传并解析 ${file.name} …`, true);
  renderShell();
  renderTab();
  try {
    const res = await fetch("/api/v1/admin/uploads", {
      method: "POST",
      headers: { "x-file-name": encodeURIComponent(file.name), "content-type": "application/octet-stream" },
      body: file,
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 401) {
      state.loggedIn = false;
      render();
      return;
    }
    if (!res.ok) throw new Error(body?.error?.message || `上传失败 HTTP ${res.status}`);
    setNotice(body.duplicate ? `${file.name} 已存在（按内容去重，未重复登记）。` : `${file.name} 上传成功，已生成记录。`, true);
  } catch (error) {
    setNotice(`上传失败：${error.message}`);
  }
  await reload();
}

// ===== 数据加载 =====

async function reload() {
  if (!state.loggedIn) {
    render();
    return;
  }
  try {
    const [datasetsBody, notesBody, tokensBody, accountsBody] = await Promise.all([
      api("/api/v1/datasets?include_archived=true"),
      api("/api/v1/date-notes"),
      api("/api/v1/admin/tokens"),
      api("/api/v1/admin/accounts"),
    ]);
    state.records = datasetsBody.datasets || [];
    state.notes = new Map((notesBody.date_notes || []).map((item) => [item.date_key, item.note]));
    state.tokens = tokensBody.tokens || [];
    state.adminAccounts = accountsBody.accounts || [];
    state.currentAdminId = accountsBody.current;
    setNotice(null);
  } catch (error) {
    setNotice(`加载失败：${error.message}`);
  }
  render();
}

render();
reload();
