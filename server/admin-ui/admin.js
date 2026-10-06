// SCUT 管理面板 v2：登录 / 记录（上传、下载、删除、归档）/ 日期备注 / 密钥分发
const app = document.getElementById("app");

let state = {
  loggedIn: false,
  tab: "records",
  records: [],
  notes: new Map(),
  tokens: [],
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

// 与桌面端一致：m:ss.d
function fmtDuration(t) {
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return "--:--.-";
  const m = Math.floor(n / 60);
  const s = n - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
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
          <span>开始时间</span><span>车手</span><span>车辆</span><span>时长</span><span>操作</span>
        </div>
        <div style="flex: 1; overflow-y: auto; min-height: 0;">
          ${
            visible.length === 0
              ? '<div style="padding: 32px; text-align: center; color: var(--dim); font-weight: 700; letter-spacing: 1.5px;">没有匹配的记录</div>'
              : visible.map(renderRecordRow).join("")
          }
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

function renderRecordRow(record) {
  const checked = state.selected.has(record.file_hash);
  return `
    <div class="grid-row" data-hash="${esc(record.file_hash)}">
      <span class="checkbox ${checked ? "checked" : ""}" data-check="${esc(record.file_hash)}" title="勾选以批量删除"></span>
      <span class="dim" title="文件时间 ${esc(new Date((record.source_mtime_unix || 0) * 1000).toLocaleString())}">${esc(record.start_time || "—")}</span>
      <span class="cell" title="${esc(record.racer || "")}">${esc(record.racer || "—")}</span>
      <span class="dim" title="${esc(record.vehicle || "")}">${esc(record.vehicle || "—")}</span>
      <span>${fmtDuration(record.duration)}</span>
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
    <div class="card copy-pair">
      <h3 class="f1">分发给队员</h3>
      <div class="hint">第一步：复制服务器链接；第二步：从下面任选一个有效密钥复制，发给队员。生成的都是可用的，一条密钥给一位队员，吊销某个不影响其他人。</div>
      <div class="kv"><label>服务器链接</label><input id="pair-link" readonly value="${esc(location.origin)}" /><button class="line" data-copy="pair-link">复制链接</button></div>
    </div>
    <div class="card">
      <h3 class="f1">生成新密钥</h3>
      <div class="kv"><label>名称</label><input id="token-name" placeholder="例如：张三-笔记本" /><button class="primary" id="token-create">生成</button></div>
    </div>
    <div class="card">
      <h3 class="f1">全部密钥（${active.length} 个有效 / ${state.tokens.length} 个）</h3>
      ${state.tokens.length === 0 ? '<div class="hint">还没有密钥，先在上方生成一个。</div>' : ""}
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
