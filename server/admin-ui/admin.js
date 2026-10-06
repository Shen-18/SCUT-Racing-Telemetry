const $ = (selector) => document.querySelector(selector);
const message = $("#message");

function showMessage(text, error = false) {
  message.textContent = text;
  message.hidden = false;
  message.className = `message${error ? " error" : ""}`;
  window.setTimeout(() => { message.hidden = true; }, 2600);
}

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { "content-type": "application/json", ...(options.headers || {}) }, ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || `请求失败 HTTP ${response.status}`);
  return body;
}

function renderNotes(notes) {
  const root = $("#note-list");
  root.replaceChildren();
  if (notes.length === 0) {
    root.innerHTML = '<div class="muted">还没有日期备注。</div>';
    return;
  }
  for (const item of notes) {
    const row = document.createElement("div");
    row.className = "note-row";
    const date = document.createElement("strong");
    date.textContent = item.date_key;
    const value = document.createElement("span");
    value.textContent = item.note;
    const edit = document.createElement("button");
    edit.textContent = "编辑";
    row.append(date, value, edit);
    edit.addEventListener("click", () => {
      $("#note-date").value = item.date_key;
      $("#note-value").value = item.note;
      $("#note-value").focus();
    });
    root.append(row);
  }
}

function renderDatasets(datasets) {
  const root = $("#dataset-list");
  root.replaceChildren();
  if (datasets.length === 0) {
    root.innerHTML = '<div class="muted">还没有登记数据集。</div>';
    return;
  }
  for (const item of datasets) {
    const row = document.createElement("div");
    row.className = "dataset-row";
    const date = document.createElement("span");
    date.textContent = item.record_date;
    const file = document.createElement("span");
    file.title = item.file_hash;
    file.textContent = `${item.file_name} · ${item.file_hash}`;
    const racer = document.createElement("span");
    racer.textContent = item.racer || "—";
    const vehicle = document.createElement("span");
    vehicle.textContent = item.vehicle || "—";
    const toggle = document.createElement("button");
    toggle.textContent = item.is_archived ? "恢复" : "归档";
    row.append(date, file, racer, vehicle, toggle);
    toggle.addEventListener("click", async () => {
      try {
        await api(`/api/v1/admin/datasets/${encodeURIComponent(item.file_hash)}`, { method: "PATCH", body: JSON.stringify({ is_archived: !item.is_archived }) });
        await load();
        showMessage(item.is_archived ? "数据集已恢复" : "数据集已归档");
      } catch (error) { showMessage(error.message, true); }
    });
    root.append(row);
  }
}

async function load() {
  const [notes, datasets] = await Promise.all([
    api("/api/v1/date-notes"),
    api("/api/v1/datasets?include_archived=true"),
  ]);
  renderNotes(notes.date_notes);
  renderDatasets(datasets.datasets);
}

$("#note-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const date = $("#note-date").value;
    await api(`/api/v1/admin/date-notes/${encodeURIComponent(date)}`, { method: "PUT", body: JSON.stringify({ note: $("#note-value").value }) });
    await load();
    showMessage("日期备注已保存");
  } catch (error) { showMessage(error.message, true); }
});

$("#upload-button").addEventListener("click", async () => {
  const file = $("#upload-file").files?.[0];
  if (!file) { showMessage("请先选择原始文件", true); return; }
  try {
    const response = await fetch("/api/v1/admin/uploads", {
      method: "POST",
      headers: { "content-type": "application/octet-stream", "x-file-name": file.name },
      body: file,
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body?.error?.message || `上传失败 HTTP ${response.status}`);
    const form = $("#dataset-form");
    form.elements.file_hash.value = body.file_hash;
    form.elements.file_name.value = body.file_name;
    form.elements.file_type.value = body.file_type;
    form.elements.file_size.value = body.file_size;
    form.dataset.storageKey = body.storage_key;
    showMessage(`上传完成：${body.file_name}`);
  } catch (error) { showMessage(error.message, true); }
});

$("#dataset-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    data.storage_key = event.currentTarget.dataset.storageKey || null;
    await api("/api/v1/admin/datasets", { method: "POST", body: JSON.stringify(data) });
    event.currentTarget.reset();
    delete event.currentTarget.dataset.storageKey;
    await load();
    showMessage("数据集索引已保存");
  } catch (error) { showMessage(error.message, true); }
});

api("/health")
  .then((health) => { $("#server-state").textContent = `已连接 · ${health.database}`; return load(); })
  .catch((error) => { $("#server-state").textContent = "连接失败"; showMessage(error.message, true); });
