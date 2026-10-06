# SQLite 总索引前三阶段实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 SQLite 总索引，幂等迁移现有 manifest.json，并让数据库页面从 SQLite 查询记录。

**Architecture:** `telemetry-store` 负责 SQLite 连接、结构迁移、manifest 入库和记录查询。`cache-core` 继续管理 raw、pyramid 和 manifest；Tauri 启动时对账，导入完成后更新索引。前端继续调用现有 `list_records` IPC，不感知存储实现变化。

**Tech Stack:** Rust 2021、Tauri 2、rusqlite bundled、serde、Vitest、现有 cache-core 与 telemetry-ipc。

**Spec:** `docs/superpowers/specs/2026-10-02-sqlite-store-design.md`

## Global Constraints

- SQLite 文件固定在当前数据根目录的 `telemetry.db`。
- raw、pyramid 和 manifest.json 保留在 `data/datasets/<hash>/`。
- 迁移按 file_hash 幂等，不能删除或覆盖现有缓存。
- 数据库页面的 IPC 返回结构保持兼容。
- Git 提交备注使用中文。

---

### Task 1: 实现 telemetry-store SQLite 基础层

**Files:**
- Modify: `Cargo.toml`
- Modify: `crates/telemetry-store/Cargo.toml`
- Modify: `crates/telemetry-store/src/lib.rs`
- Test: `crates/telemetry-store/src/lib.rs` 内的单元测试

**Interfaces:**
- Produces `TelemetryStore::open(path)`, `TelemetryStore::upsert_manifest(manifest, dataset_path)`, `TelemetryStore::reconcile_cache(cache_root)` 和 `TelemetryStore::list_records(query)`。
- `list_records` 返回 `telemetry_ipc::RecordSummary`，保持现有前端字段。

- [ ] **Step 1: Write failing tests** for schema creation, idempotent upsert, search, and manifest reconciliation.
- [ ] **Step 2: Run `cargo test -p telemetry-store` and verify the missing API/schema failure.**
- [ ] **Step 3: Add bundled rusqlite, schema migrations, transaction-based upsert, and case-insensitive record search.**
- [ ] **Step 4: Run `cargo test -p telemetry-store` and verify all store tests pass.**
- [ ] **Step 5: Commit with `数据库：实现 SQLite 总索引基础层`.**

### Task 2: 启动迁移与导入后索引更新

**Files:**
- Modify: `src-tauri/src/state.rs`
- Modify: `src-tauri/src/imports.rs`
- Modify: `src-tauri/src/main.rs`
- Modify: `src-tauri/src/records.rs`
- Modify: `src-tauri/Cargo.toml`
- Test: `src-tauri/src/state.rs` and store integration coverage

**Interfaces:**
- `AppState` owns an `Arc<TelemetryStore>`.
- `AppState::new` opens `<cache_root>/telemetry.db` and reconciles existing manifests before returning.
- `list_records` calls the store and maps store errors to `CmdError`.

- [ ] **Step 1: Write a failing state/integration test** proving an existing manifest is visible through the store after `AppState::new`.
- [ ] **Step 2: Run the targeted Rust test and verify it fails because startup does not create or reconcile the database.**
- [ ] **Step 3: Initialize the store in `AppState`, reconcile valid manifests, and update the store after XRK/CSV import reaches its ready state.**
- [ ] **Step 4: Replace directory scanning in `records.rs` with `TelemetryStore::list_records`, preserving search fields and source-mtime ordering.**
- [ ] **Step 5: Run `cargo test -p scut-racing-telemetry` and workspace Rust checks.**
- [ ] **Step 6: Commit with `数据库：接入启动迁移与导入索引`.**

### Task 3: 数据库页面查询切换验证

**Files:**
- Modify: `src/api/client.ts` only if IPC argument or response typing needs correction
- Modify: relevant library loading code only if it assumes filesystem scanning
- Test: `src/components/LibraryView.test.tsx` or `src/api/client.test.ts`

**Interfaces:**
- `client.listRecords(query)` remains the public frontend call.
- No frontend component reads `manifest.json` directly.

- [ ] **Step 1: Add a failing frontend test** that the library requests `list_records` and renders the returned database row unchanged.
- [ ] **Step 2: Run the targeted Vitest test and verify the failure if the current assumptions do not hold.**
- [ ] **Step 3: Make only the minimal frontend typing or loading adjustment required by the unchanged IPC response.**
- [ ] **Step 4: Run the full frontend test suite and `pnpm typecheck`.**
- [ ] **Step 5: Run a release build smoke check and inspect that `data/telemetry.db` is created beside the installed executable.**
- [ ] **Step 6: Commit with `数据库：让数据库页面读取 SQLite 索引`.**

## Self-review checklist

- 迁移失败只跳过无效 manifest，不能删除缓存目录。
- 重复启动和重复导入不会新增重复记录。
- manifest 仍由 cache-core 校验，SQLite 不取代缓存文件。
- `local_record_notes`、日期备注和云端同步留在后续阶段，没有混入本次范围。
