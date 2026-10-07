# 依赖契约

机器权威清单：根目录下 `config/contracts/dependencies.json`。新增或变更直接依赖必须同时审阅本契约与 ADR；禁止仅更新 package.json。

- Rust 根 workspace.dependencies 统一版本；业务 manifest 外部依赖必须 workspace=true。
- roots 为八业务 crate + Tauri 壳 + golden 测试，共十成员；新增 `overlay` 为独立渲染 crate。
- 所有普通/dev/build/target 条件依赖均检查；Rust 别名解析 package，禁止跨层路径、git 来源和 patch/replace 绕过。
- dependencies.json.edges 是允许集合，不强迫空壳安装尚不需要的包。telemetry-core 不依赖业务 crate/tauri；只有壳可依赖 tauri/tauri-build。
- 前端除产品依赖外允许 @types/react、@types/react-dom、@vitejs/plugin-react、@tauri-apps/cli、@eslint/js、typescript-eslint：分别用于类型、构建、桌面启动和实际 TS lint，不是新产品架构。
- Python 3.11+ 仅用于标准库 TOML 校验；不引入 Python 产品运行时。pnpm 11.19.0；MSVC Rust stable + rustfmt/clippy，Cargo.lock/pnpm-lock.yaml 固定解析结果。
- 前端只允许 src/api/client.ts 引用 Tauri；当前静态保护检查 package 字符串与全局 IPC 标识，不能替代动态拼接等人工审查。

执行 `tests/tooling/verify-dependencies.ps1`；负例测试修改临时 fixture，不修改工作区。命令原始证据见 .agent/evidence/step1。

PostCSS 8 为 Tailwind/Vite 配置直接依赖，版本同机器清单；未引入新增 UI 产品包。

## 当前实现注记（2026-09-24）

- 实际运行链路是 `telemetry-core` → `aim-ffi`/`csv-parser` → `cache-core` → `telemetry-ipc` → `src-tauri` → `src/api/client.ts`。
- `telemetry-store` 目前只有 foundation crate 壳，`migrate-v1` 目前只有 placeholder main；二者仍保留在 workspace 作为规划模块，不应被误认为已启用的运行时服务。
- `telemetry-ipc` 当前只依赖 `telemetry-core`；`config/contracts/dependencies.json` 中保留的 cache/store 方向属于允许的未来边，不能当作当前实际调用关系。
- `src-tauri/src/main.rs` 目前仍承载 command 实现和注册；附录中规划的 `src-tauri/src/commands/` 目录尚未落地。
- `overlay` 当前只依赖图形/字体/PNG 相关库，输出固定示例帧；Tauri 通过 `src-tauri/src/overlay.rs` 调用，真实通道映射和视频编码尚未接入。
