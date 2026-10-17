# 历史归档（2026-10-09）

历史材料保留过去的决策、完整规格和记录；当前维护入口是 [项目文档](../../README.md)。以下原文不覆盖当前代码与用户要求。

| 内容 | 完整原文 |
| --- | --- |
| 施工手册 | [Tauri 施工手册](agent/Workbuddy_20260910_0008_Tauri_v2_Construction_Manual.markdown) |
| 完整工作日志 | [工作进度](agent/工作进度.md) |
| 决策与算法契约 | [ADR](agent/adr/README.md)、[核心契约](agent/contracts/core-api.md) |
| 依赖和夹具来源 | [依赖](agent/contracts/dependencies.md)、[Golden](agent/contracts/golden-fixtures.md) |
| SQLite | [设计](docs/superpowers/specs/2026-10-02-sqlite-store-design.md)、[计划](docs/superpowers/plans/2026-10-03-sqlite-index-migration.md) |
| Overlay | [规格](docs/superpowers/specs/2026-10-03-overlay-video-export-parity.md)、[计划](docs/superpowers/plans/2026-10-03-overlay-video-export-parity.md) |
| 管理员与分发 | [设计](docs/superpowers/specs/2026-10-06-admin-panel-and-access-keys-design.md)、[计划](docs/superpowers/plans/2026-10-06-admin-panel-and-cloud-distribution.md) |
| 数据同步 | [完整方案](agent/plans/2026-10-07-数据同步方案.md) |
| 旧目录与架构盘点 | [目录](agent/工作区目录说明.md)、[审阅](agent/architecture-review.md) |
| 工具调用 | [agy-staff 历史手册](agent/agy-staff-调用手册.md)，不是当前委派要求 |
| 原公开入口 | [根 README](reference/root-README.md)、[server README](reference/server-README.md) |

含凭据的 v5 交接完整原件保存在本地 private/，Git 忽略；公开旧入口仅说明去向，当前摘要不复制真实密码/令牌/私钥。

[原文校验清单](原文校验清单.json) 包含原路径、归档路径、SHA-256。29 份历史正文均保留并校验；其中 2 份在并行凭据整理中修订，清单同时记录初始校验和与当前版本，未恢复明文；reference 另存两份原 README。历史 evidence 仍在 .agent/evidence，本轮未移动。

原文中的旧路径、命令和历史链接保持原样；失效历史路径按清单定位。详细遗留约束可追溯，旧“待实施”、pyramid 主路径、无鉴权、多阶段构建等描述不能视为当前事实。
