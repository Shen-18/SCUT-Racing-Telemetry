# ADR 0001 — 总架构与仓库边界

状态：已采纳（2026-09-11）；实现按施工步骤推进。

## 决策
采用 Tauri v2 薄壳 + Rust 业务 workspace + React 18。七个业务 crate、一个桌面壳、一个 golden 验证 crate，共九个 workspace members；测试 crate 不计入八个产品构件。依赖允许方向由 dependencies.json 冻结，叶子 telemetry-core 无桌面/业务依赖。配置集中 config/frontend，报告集中 .agent/evidence；保留工具要求的根 manifest/lock/index。

## 理由
核心算法须能在非桌面环境复用，边界限制比约定口号更可靠。验证包进入同一 workspace 可保证 cargo test -p golden-tests 正常工作，解决原手册八成员与测试命令的矛盾。

## 影响与边界
不引入完整业务接口空实现；Step 2 开始实现 core，Step 4/5 接 IPC。不得为整理目录而破坏默认 Cargo/Tauri/技能发现路径。
