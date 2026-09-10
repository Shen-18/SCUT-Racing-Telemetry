# SCUT Racing Telemetry v2.0 施工手册（rev.4 · 性能数据层定稿版）

> **用法**：从 Step 1 开始顺序执行。每个 Step 讲清：做什么 → 谁做 → 怎么做 → 先写哪些测试 → 接口 → 验收标准 → 审查重点。
> 文档不规定工期，进度由负责人掌管；步骤顺序是硬约束（标注"可并行"的除外）。
> 文档族：`Gemini_...`（草案，存档）→ `Workbuddy_..._1621_...`（决策层）→ `Workbuddy_..._1647_...`（rev.3，**已被本文件取代**）→ **本文件（唯一执行依据）**。
> rev.4 相对 rev.3 的手术区：新增第 1 章性能数据层（金字塔缓存 + Job 化导入 + 结构不变量）；Step 2/4/5/9/13 相应重写；新增技能映射（0.7）；**附录 B 为自包含完整 UI 设计规范（B.0~B.10），Step 5/7/8/9B/10/11/13/14 内联各步美学规格；全文自包含——执行本手册无需查阅任何前版文档**；协议补全：`StartImportBatch`/`CacheRootStatus` 命令、`channel_building` 错误语义、StartImport 幂等与轮询节奏。
>
> **路径约定（负责人规定）**：代码根目录 = `D:\Desktop\SCUTRacingTelemetry\`；前端源码在 `src/`，Rust 部分按 cargo 惯例放 `src-tauri/` 与 `crates/`；构建产物在 `target/`，最终打包 exe 及全部依赖（AiM DLL 等）输出到 `target/release/`。验证资产统一放 `Data/`，AiM 官方 DLL 放在 `TestMatLabXRK/64/`。设计文档统一命名 `<软件名>_<时间>_<文档本名>.markdown` 放 `.agent/`。

---

## 第 0 章 总则

### 0.1 冻结决策（不再讨论）

| # | 结论 |
|---|------|
| D1 | AI 团队开发：主 agent 写骨架与契约，subagent 写功能模块，负责人检查点验收 |
| D2 | React 18 + TS(strict) + Tailwind 3.4 + dockview 4.x + uPlot 1.6；Rust 1.78+；Tauri 2.x；Vite 6；zustand 5 |
| D3 | Python v1 冻结；`Data/AGX.*`、`Data/Du.*` 与 RaceStudio3 导出 CSV 是验证资产 |
| D4 | 预留 `TelemetrySource` trait，v2.0 只实现文件源 |
| D5 | GPS 赛道图 Canvas 2D 自绘 |
| D6 | golden 真值 = RaceStudio3 官方导出 CSV（不信 Python 版输出） |
| D7 | 仅 Windows x64；core crate 与 Tauri 解耦备未来 Web 端 |
| D8 | 旧资料库一次性 ETL 迁移（`migrate-v1`） |
| D9 | 200MB 实测样本用于发布前冒烟 |
| C1 | 垂直切片打底 + 挂载点扩展：先主干、后挂载，没有"合并日"只有"验收日" |
| C2 | 骨架与契约由主 agent 独写，subagent 不碰 |
| C3 | GUI 以 v1 为参考重新设计，dockview 承载，默认"分析预设"（附录 B） |
| C4 | 中文 UI；通道名/单位保留英文；深色优先 + 浅色切换 |
| C5 | 双文件对比排最后（Step 14） |
| C6 | **subagent 是角色不是具体产品**：当前由 Antigravity（agy）担任（`gemini-3.8-flash` + `effort=high`，可多实例并行互验），但可随时替换为其他 subagent 后端；调用方式集中在 0.2，正文一律只写 "subagent" |
| **D10** | **缓存策略：原始文件（XRK/CSV）是数据本体，永远保留、永不被软件修改；缓存默认全保留、不设硬上限**；提供手动清理入口（单数据集/全部）与可选上限设置（默认关闭）；缓存永不进入备份/上传范围（衍生品，可重建） |
| **D11** | **导入全部 Job 化**：后台执行、分阶段进度、符合设计风格的进度条、可取消、中断可续建；**点击优先**——用户点开某文件/通道，构建队列立即优先它；元数据与概览尽早可见 |
| **D12** | **性能验收不写数值指标**，改用五条结构不变量 I1~I5（第 1.6 节）+ 最终手感冒烟；理由：结构可审代码，数字要测且为时尚早 |
| **D13** | AiM DLL 进程隔离（aim-worker.exe）**缓行**：先进程内 actor + Job API，Step 13 用 200MB 实测裁决——DLL 崩溃/泄漏/无法取消才升级隔离，届时只换 Job 执行后端，接口零变化 |
| **D14** | 技能使用制度化（0.7）：skill 由主 agent 运行，subagent 拿到的是蒸馏后的任务卡 |

### 0.2 角色与工具

- **主 agent** = WorkBuddy 主会话：骨架、契约、派单、终审、合并、打包；按 0.7 调用技能。
- **subagent** = 承担功能模块开发/交叉评审的角色（C6：角色与实现解耦）。**当前后端 = Antigravity（agy）**，两条调用通道：
  1. **agy-staff 员工角色（任务卡与评审的首选通道）**：`bash ~/.agents/agy-staff/agy.sh <persona> [flags] --prompt "<任务卡>"`
     - 角色映射：**实现类任务卡 → `implementer`**（直接改工作区）；**交叉评审 → `reviewer`**；调研 → `researcher`；快速问答 → `ask`；兜底 → `staffer`；
     - **必须显式传 `--effort high`**（其默认是 `gemini-3.8-flash-medium`，不满足"一律 high"的长期指令）；长任务卡用 `--prompt-file`；
     - 后台角色（implementer/reviewer/researcher/staffer）返回 job id，用 `agy.sh wait <job-id> --timeout 20m` 收结果，天然支持多实例并行；追问用 `--continue <conversation-id>`；
     - **WorkBuddy 沙箱硬限制（实测）**：后台角色必须带 `dangerouslyDisableSandbox: true` 运行（detached 进程与状态锁 rename 在默认沙箱内会被杀/拒绝）；`ask` 是唯一能在默认沙箱跑的；网络由 `agy.sh` 自动走 7897 代理；
     - 任务状态与产物记录在当前仓库 `.agy-staff/` 目录。
  2. **MCP `agy_ask`（同步一问一答备用通道）**：
     ```
     mcp__antigravity__agy_ask(model="gemini-3.8-flash", effort="high",
         add_dir=["D:\\Desktop\\SCUTRacingTelemetry"], timeout=600(Rust)/900(前端))
     ```
     （MCP schema 未含 effort 的过渡期走桥接器 API 直调，效果等价。）
  - subagent 单次执行无对话记忆（agy-staff 可用 `--continue` 续聊），**任务卡仍一律自包含**（0.4 模板），不依赖续聊。
- **负责人** = 人类：掌管进度，在 Step 5/9/13 检查点验收；性能最终由负责人在 Step 13 手感验收（D12）。

### 0.3 编码铁律（CI 强制）

1. 先写失败测试再写实现（没看红不写码）；
2. 只写本 Step 的 allowed paths；契约文件只读，改契约提 ADR；
3. Rust 库代码禁 `unwrap`/`panic!`；TS 禁 `any`，strict 模式；
4. `unsafe` 只许在 `aim-ffi`，每块 ≤10 行附 `// SAFETY:`；
5. 单文件 ≤400 行（测试 ≤600 行），超限需 ADR 豁免；
6. 时间戳 `f64`、物理量 `f32`；
7. 类型只从契约层 import，禁止重复定义；
8. 新依赖必须进 `docs/contracts/dependencies.md` 白名单；
9. **全量数据不出 Rust 边界**；交互路径只走 pyramid（I1/I4）；
10. 原始文件只读，永不写回（D10）。

### 0.4 subagent 任务卡 prompt 模板

```
[角色] 你是 SCUT Racing Telemetry v2 的模块开发 subagent，负责 <模块>。
[背景] PySide6 赛车遥测工具重写为 Tauri 2.0 + Rust + React。主干已过验收，
       性能数据层（pyramid 缓存 + Job 导入）已就位，你挂载在冻结契约上。
[允许写入] 只允许创建/修改：<allowed paths>。其他任何文件只读。
[只读契约] <粘贴对应 Step 的接口代码原文>
[必须先写的失败测试] <清单，先跑红>
[实现要求] <行为要点、算法约束、三态处理>
[验收命令] <必须全绿的命令序列>
[交付证据] ①验收命令完整输出 ②实测说明（如要求）③修改文件清单 ④阻塞问题
[禁止] 改契约 / 白名单外依赖 / unsafe / unwrap / any / 全量数据传前端 / 写原始文件
```

### 0.5 验收纪律（三级，全过才算完成）

1. 交付者自证：验收命令输出 + 实测说明/截图 + 文件清单；
2. 交叉审：另一个 subagent 实例读任务卡 + git diff（当前经 `agy-reviewer` 角色），输出 PASS 或 ISSUES（Critical/Major/Minor）；
3. 主 agent 终审：契约零变更、行数预算、本地复跑验收命令，全过才合并。
升级规则：同卡两轮 Critical → 换更强后端/模型一轮 → 主 agent 亲自实现并复盘。

### 0.6 并行规则

- 并行 Step 可同时派单；同时运行的 subagent ≤3 个、间隔 ≥5 秒、allowed paths 不相交；
- 单卡 >15 分钟无输出 → 主 agent 介入（agy-staff：`agy.sh status <job-id>` + `--log-file` 查真因）；
- 派单前查代理出口节点（机房段会被 Google 拒，先换节点）；
- 后端瞬时错误（如 agy 的 eligibility Bad Gateway 502）→ 重试即可，最多×2。

### 0.7 技能映射（D14：主 agent 在各阶段必须调用的 skill）

| 阶段 | skill | 用途 |
|------|-------|------|
| 每个实现 Step 开工前 | `superpowers` | TDD 纪律、流程确认 |
| 任务切分/派单 | `to-tickets` 思想 | 任务卡 = ticket，声明阻塞边 |
| 模块形状拿不准（如 pyramid 模块） | `codebase-design` | 深模块/小接口评审 |
| 领域词汇与 ADR | `domain-modeling` | Dataset/Channel/Pyramid/CacheManifest/ImportJob 进词汇表 |
| 实现中 | `tdd` | 缓存协议、窗口读取、金字塔构建全部测试先行 |
| 交付后 | `code-review` | 两段式评审（对接 0.5） |
| 声称完成前 | `verification-before-completion` | 没证据不算完 |
| v0 若需止痛 | `diagnosing-bugs` | 先建"一条命令复现卡顿"的反馈环再动手 |
| 未知调研（如 DLL 行为） | `research` | 后台查证，产出带引用的文档 |
| 派实现类任务卡 | `agy-implementer`（当前后端） | subagent 直接改工作区；卡内容按 0.4 |
| 派交叉评审 | `agy-reviewer`（当前后端） | 对接 0.5 第 2 级 |
| 派调研/问答 | `agy-researcher` / `agy-ask`（当前后端） | 注意 `agy-ask` 外的角色须关沙箱（0.2） |

---

## 第 1 章 性能数据层（rev.4 核心新增）

> 解决三个真实痛点：①长记录拖动时间轴卡；②多图表缩放/拖动集中卡；③XRK 首开慢、重开也慢。
> 核心思想一句话：**让渲染成本只取决于屏幕像素宽度，与总点数无关——这是结构保证，不是优化技巧。**

### 1.1 四层数据层

```
原始文件（XRK/CSV）            ← 数据本体，只读，备份/上传的唯一真身（D10）
   ↓ 首开时一次性解析（Job 后台）
Raw 缓存（每通道 .raw 文件）     ← f64 时间 + f32 值，mmap 读取，十字线取值的数据源
   ↓ 后台构建（同 Job）
Pyramid 缓存（每通道 .pyr 文件） ← 多级 min/max，一切渲染路径的唯一数据源
   +
telemetry.db（SQLite）          ← 元数据/索引/缓存状态机/圈速/注释/布局/Job 记录
```

### 1.2 磁盘布局

```
<缓存根>/                       （默认 %APPDATA%/SCUTRacingTelemetry/cache，可配置）
├── telemetry.db
└── datasets/<file-hash>/
    ├── manifest.json          版本、源文件身份(hash+mtime+size)、状态机、每通道进度、checksum
    ├── channels/<key>.raw     [header][f64 times ×n][f32 values ×n]，mmap 直读
    ├── channels/<key>.pyr     [header][level 表][各级 (f64 time, f32 min, f32 max) 块]
    ├── laps.bin
    └── temp/                  构建中的临时文件，中断后据此续建或清理
```

### 1.3 金字塔协议（scb-pyr v1，冻结）

- **层级**：Level 0 = 原始采样；Level k 的每桶聚合 2^k 个相邻原始点，存 `(time, min, max)`——time 取桶内首样本时间（不规则采样下最稳）；层数建到桶数 ≤512 为止；
- **为什么 min/max**：峰谷包络永不丢尖峰（均值类降采样会吞掉传感器毛刺，遥测不能接受）；
- **容量账**：每通道 raw = 12n 字节；pyramid 各级几何求和 ≈ 16n；合计 ≈ 28n/通道。150 通道 × 200 万点的极端文件 ≈ 840MB——**默认全保留（D10），空间不设限**；
- **查询**：按 `窗口范围 × 屏幕像素宽` 选层——选"窗口内桶数 ≤ 2×像素"的最细层；比 Level 0 更细直接读 raw；
- **版本与校验**：manifest 记格式版本 + 每通道 checksum；版本不符/校验失败 → 标记 Invalid 并自动重建对应部分，绝不错用。

### 1.4 缓存状态机与 Job 模型

```
数据集状态：Missing → MetadataReady → RawPartial → RawReady → PyramidPartial → Ready
           （任意阶段可 → Failed(含错误信息) / 中断后续建）
Job 阶段：  ReadingMetadata → ReadingChannels → BuildingRawCache
           → BuildingPyramid → Ready | Failed | Cancelled
```

**Job 内的构建顺序（点击优先的实现基础）**：
1. 元数据 + 通道清单（最早，`ReadingChannels` 完成即可见）；
2. 总览金字塔（512 桶，让时间轴和概览立即可拖）；
3. **优先队列里的通道**（用户点开的文件/勾选查看的通道，`PrioritizeImport` 动态插入队首）；
4. 其余通道按序补齐。

**导入进度条**（前端组件，规格见附录 B.7）：符合令牌风格，显示阶段中文文案 + 百分比 + 取消；多 Job 堆叠；`Ready` 后自动消失。

### 1.5 保留与备份策略（D10 展开）

| 对象 | 保留策略 | 备份/上传 |
|------|----------|-----------|
| 原始 XRK/CSV | **永远保留，软件只读** | ✅ 备份/上传的唯一内容 |
| `.pyr` pyramid | 永驻（图表秒出来源） | ❌ 衍生品，可重建 |
| `.raw` raw 缓存 | 默认保留；CSV 的可佛系（重解析快），XRK 的优先留 | ❌ 同上 |
| `telemetry.db` | 永驻（用户数据：注释/布局/索引） | ✅ 体积小，SQLite 在线备份一条命令快照 |
| 缓存清理 | 手动入口：单数据集/全部；可选上限设置（默认关） | — |

与未来 Web 端（D7）的关系：pyramid 正是 Web 前端流式渲染最想要的格式——服务端复用同一套 Rust core 构建同样的缓存，协议零改动。

### 1.6 结构不变量（D12：替代数值性能指标的验收标准）

| # | 不变量 | 审查方式 |
|---|--------|---------|
| I1 | 任一帧渲染成本只取决于像素宽度，不取决于总点数 | pyramid 查询路径代码审查 |
| I2 | 主线程/GUI 线程永不执行全分辨率扫描 | 调用链审查 + CI grep |
| I3 | 缓存命中打开永不反序列化完整数据集（按通道懒开） | `DatasetCache` 接口形态即证据 |
| I4 | 交互路径（十字线/拖动）永不触发全通道重采样：拖动用粗层+请求合并+generation 丢过期，停手防抖后细层精刷 | 前端数据通路审查 |
| I5 | 首开永不阻塞 UI（Job 化 + 元数据先行） | Job API 形态 + 手测 |

五条的逻辑保证：I1~I5 全过，卡顿在数学上不可能发生；Step 13 只做手感冒烟（200MB + 多图表拖放，负责人手感裁决）+ 内存观察，不测帧率数字。

---

## Step 1：仓库地基（M0）

**做什么**：建立工程根目录 monorepo 骨架、CI 检查链、契约目录。交付：可启动的空白 Tauri 窗口 + 全绿检查脚本。
**执行者**：主 agent（开工前调 `superpowers` 确认流程）。

**怎么做**：
1. 建目录拓扑（附录 C），初始化 cargo workspace（7 个 crate 空壳：`telemetry-core`/`cache-core`/`aim-ffi`/`csv-parser`/`telemetry-store`/`telemetry-ipc`/`migrate-v1`；`cache-core` 独立成 crate 以便未来 Web 端复用，见 Step 9A）与 pnpm workspace；
2. 根 `Cargo.toml` 统一 `[workspace.dependencies]`（serde 1、thiserror 2、specta 2.0-rc、rusqlite 0.32、libloading 0.8、memmap2 0.9、rayon 1.10、fast-float 0.2、rustfft 6、dashmap 6、tauri 2）；
3. `scripts/check.ps1` 六道关：rustfmt → clippy `-D warnings` → cargo test → tsc → eslint `--max-warnings 0` → golden 套件（`cargo test -p golden-tests`）；
4. `docs/adr/`：0001 总架构 / 0002 IPC 协议（含 Job API）/ 0003 SoA 模型 / **0004 金字塔缓存协议（scb-pyr v1 + 磁盘布局 + 状态机）** / 0005 测试策略 / **0006 缓存保留与备份策略（D10）**；
5. `docs/contracts/dependencies.md` 白名单初始化（Rust 侧见第 2 条 + 前端侧与 D2 一致：react 18、react-dom、dockview 4.x、uplot 1.6、zustand 5、tailwind 3.4、vite 6、typescript、eslint、vitest）；
6. `pnpm dev` 空白窗口截图存档。

**接口**（冻结：依赖方向，CI 强制）：
```
telemetry-core  （叶子，禁依赖 tauri 与任何业务 crate）
cache-core      → telemetry-core        （金字塔/缓存格式/状态机，无桌面依赖）
aim-ffi         → telemetry-core
csv-parser      → telemetry-core
telemetry-store → telemetry-core, cache-core（SQLite + Job 记录 + 缓存索引）
telemetry-ipc   → telemetry-core, telemetry-store, cache-core
src-tauri       → 以上全部（薄壳，禁业务逻辑）
前端 src/       → 后端只经 src/api/client.ts
```

**验收标准**：
- [ ] `pnpm dev` 空白窗口启动（截图）；`scripts/check.ps1` 全绿
- [ ] ADR 0001~0006 齐；白名单生效（故意加违规依赖被拦下的证明）；依赖方向检查生效（故意加一条跨层依赖被 CI 拦下的证明）

**审查重点**：ADR 只写决策与理由；check.ps1 真串了六道关。

---

## Step 2：核心数据模型与算法（telemetry-core）

**做什么**：全系统唯一内存数据模型 + 全部纯算法，**含金字塔构建与查询**。交付：crate 测试全绿。
**执行者**：主 agent（TDD）。

**怎么做**：
1. 先写测试（每个算法至少一个"已知输入→已知输出"）：
   - 既有：`ChannelSeries` 行为、ECEF 参考点、匀速积分、统计已知分布、`rmse_and_corr` 恒等/反相；
   - **新增 pyramid**：20 点手工序列 → 构建后断言各层桶数与 (time,min,max) 精确值；不规则时间戳序列分层正确；`query_pyramid` 按像素选层正确（窗口大→粗层，窗口小→raw）；尖峰点必然出现在某层 min 或 max 中（包络不丢）；
2. 实现 `models.rs` / `downsample.rs` / `pyramid.rs` / `gps.rs` / `stats.rs`；`align.rs` 只签名（Step 14 补齐）；
3. pub 项全 doc comment，示例进 `cargo test --doc`；
4. 铁律核查：无 `unwrap`、无 `std::fs`、无 tauri 依赖。

**接口**（冻结，全文；同时复制进 `docs/contracts/core-api.md`）：

```rust
pub type DatasetId = u64;

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize, specta::Type)]
pub enum ChannelSource { Standard, Gps, GpsRaw, DerivedGps, DerivedCalc, Csv }

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct ChannelMeta {
    pub key: String,          // 唯一键；重名时 "Name (2)"
    pub name: String,         // 显示名，保留英文原样
    pub unit: String,
    pub source: ChannelSource,
    pub sample_rate_hz: f32,
}

#[derive(Clone, Debug, Default)]
pub struct ChannelSeries {
    pub times: Vec<f64>,      // 单调递增（载入时排序一次，此后只读）
    pub values: Vec<f32>,
}
impl ChannelSeries {
    pub fn len(&self) -> usize { self.times.len().min(self.values.len()) }
    pub fn is_empty(&self) -> bool { self.len() == 0 }
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct LapInfo { pub index: u32, pub start: f64, pub duration: f64 }

#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct SessionMeta {
    pub file_path: std::path::PathBuf,
    pub file_type: String,            // "xrk" | "csv"
    pub session: String, pub vehicle: String, pub racer: String,
    pub championship: String, pub comment: String,
    pub date: String, pub start_time: String,
    pub sample_rate_hz: f32, pub duration: f64,
}

#[derive(Clone, Debug, Default)]
pub struct TelemetryDataset {
    pub meta: SessionMeta,
    pub channels: Vec<ChannelMeta>,    // 顺序即文件 header 顺序
    pub series: std::collections::HashMap<String, ChannelSeries>,
    pub laps: Vec<LapInfo>,
}
impl TelemetryDataset {
    pub fn channel(&self, key: &str) -> Option<&ChannelSeries>;
    pub fn max_time(&self) -> f64;
}

#[derive(Debug, thiserror::Error)]
pub enum TelemetryError {
    #[error("io: {0}")] Io(#[from] std::io::Error),
    #[error("parse: {0}")] Parse(String),
    #[error("dll: {0}")] Dll(String),
    #[error("not found: {0}")] NotFound(String),
}

/// D4：实时数传预留。v2.0 只有 XRK/CSV 两个文件实现。
pub trait TelemetrySource: Send + Sync {
    fn open(&self, path: &std::path::Path) -> Result<TelemetryDataset, TelemetryError>;
}

// downsample.rs（运行时备用；渲染主路径已改为预建 pyramid，此函数供统计/导出等场景）
pub struct MinMaxFrame { pub times: Vec<f64>, pub mins: Vec<f32>, pub maxs: Vec<f32> }
/// [start,end] 窗口内均分为 buckets 列，每列取 (min,max)；
/// 窗口外首尾各保留一个真实样本，保证 step 曲线边界值正确。
pub fn minmax_buckets(times: &[f64], values: &[f32], start: f64, end: f64, buckets: usize) -> MinMaxFrame;

// pyramid.rs（渲染主路径）
#[derive(Clone, Copy, Debug, Default, serde::Serialize, serde::Deserialize)]
pub struct MinMax { pub min: f32, pub max: f32 }

#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize)]
pub struct PyramidLevel {
    pub factor: u32,          // 每桶聚合的原始点数 = 2^level
    pub times: Vec<f64>,      // 每桶代表时间 = 桶内首样本时间
    pub minmax: Vec<MinMax>,
}

#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize)]
pub struct ChannelPyramid { pub levels: Vec<PyramidLevel> }  // levels[0] 即 Level1(2x)，原始层不入塔

/// 构建：从 Level1(2x) 起逐层倍增，直到该层桶数 ≤ 512。
pub fn build_pyramid(times: &[f64], values: &[f32]) -> ChannelPyramid;

/// 查询：选"窗口内桶数 ≤ 2×pixels"的最细层；窗口比 Level1 还细时返回 None（调用方读 raw）。
pub fn query_pyramid(pyr: &ChannelPyramid, start: f64, end: f64, pixels: u32) -> Option<MinMaxFrame>;

// gps.rs
pub fn ecef_to_geodetic(x: &[f32], y: &[f32], z: &[f32]) -> (Vec<f64>, Vec<f64>, Vec<f32>); // lat,lon(deg),alt(m)
pub fn integrate_distance(times: &[f64], speed_mps: &[f32]) -> Vec<f64>;

// stats.rs
#[derive(Clone, Debug, serde::Serialize, specta::Type)]
pub struct ChannelStats { pub min: f32, pub max: f32, pub mean: f64, pub std: f64 }
pub fn channel_stats(s: &ChannelSeries, window: (f64, f64)) -> ChannelStats;
/// 重采样到公共时间轴后的 RMSE 与 Pearson 相关系数
pub fn rmse_and_corr(a: &ChannelSeries, b: &ChannelSeries, window: (f64, f64)) -> (f64, f64);

// align.rs（Step 14 前只签名）
/// FFT 互相关估计 b 相对 a 的时间偏移（秒，正值=b 滞后）
pub fn estimate_offset(a: &ChannelSeries, b: &ChannelSeries, window: (f64, f64)) -> Result<f64, TelemetryError>;
```

**验收标准**：
- [ ] 全部单测 + doc test 绿，clippy 零警告
- [ ] pyramid 四组新用例（分层精确值/不规则时间/选层/尖峰不丢）齐
- [ ] CI grep：无 `unwrap`、无 `std::fs`、无 tauri 依赖

**审查重点**：`query_pyramid` 的选层边界条件；不规则采样下桶代表时间的取值（首样本，不是中点）。

---

## Step 3：AiM DLL 桥（aim-ffi）

**做什么**：Rust 侧唯一碰 DLL 的地方，把 `MatLabXRK-2022-64-ReleaseU.dll` 封装成线程安全的 actor。交付：`open_xrk(AGX.xrk)` 返回完整 `TelemetryDataset` 且过 golden。（它的输出喂给 Job 构建缓存，不直接进前端。）
**执行者**：主 agent（TDD）。

**怎么做**：
1. **先写测试**（真实文件驱动）：
   - 打开 `Data/AGX.xrk` → 通道数 >0、`GPS Speed` 存在、laps 非空、duration >0；
   - 打开 `Data/Du.xrk` 同上；
   - 路径含中文/空格（复制样本到临时目录改名）能打开；
   - 连续打开/关闭 50 次 → 句柄计数不增长（用 `get_file_state` 或进程句柄数断言）；
   - **golden 用例**：`GPS Speed` 通道重采样对齐 `AGX.csv` 后逐点相对误差 ≤1e-4（fixture 见第 5 条）；
2. 实现 `AimDll`（内部 struct，`!Send + !Sync`）：`SetDllDirectoryW` 指向 DLL 依赖目录（`TestMatLabXRK/64/`），再 `libloading::Library::new`；46 个导出签名（附录 A），字符串参数 `*const c_char`（mbcs 编码，与 v1 一致）；
3. 实现 `AimActor`：单线程 + `std::sync::mpsc`，所有 DLL 调用封装成消息排队执行；`open_xrk` 返回 `Future`（内部 oneshot 回传）；
4. 解析流程（对齐 v1 行为）：`open_file` → `get_session_duration`（为 0 时用 laps 推算）→ `get_channels_count` 族读标准通道；`get_GPS_channel_*` 族读**官方插值 GPS**（首选），缺失回退 `get_GPS_raw_channel_*` + `ecef_to_geodetic`；由 `GPS Speed` 积分派生 `Distance on GPS Speed`；通道时间戳排序一次（铁律）；
5. golden fixture 生成（一次性）：小脚本读 `AGX.csv`/`Du.csv` 的 Time+Speed 列 → 存 `tests/golden/agx_speed.bin`（f64×2 序列 + sha256）；测试里加载比对；同时产出 `tests/golden/agx_csv_meta.json`（通道名/单位/采样率清单，Step 6 的 CSV 元数据 golden 用例消费）。

**接口**（冻结）：

```rust
pub struct AimActor { /* mpsc::Sender + JoinHandle，私有 */ }

impl AimActor {
    /// 启动 actor 线程并加载 DLL（先 SetDllDirectoryW 注入依赖目录）。
    pub fn spawn(dll_path: &std::path::Path) -> Result<Self, TelemetryError>;

    /// 打开 XRK/XRZ 并解析为 TelemetryDataset。
    /// GPS 优先官方插值通道，缺失回退 ECEF 推算（调 telemetry_core::gps）。
    pub fn open_xrk(&self, path: std::path::PathBuf)
        -> impl std::future::Future<Output = Result<TelemetryDataset, TelemetryError>> + Send;

    /// 分段备用：只读指定圈（get_lap_channel_samples 族），200MB 整读失败时降级用（D13 证据门若触发也靠它先顶着）。
    pub fn open_xrk_laps(&self, path: std::path::PathBuf, laps: Vec<u32>)
        -> impl std::future::Future<Output = Result<TelemetryDataset, TelemetryError>> + Send;
}
impl Drop for AimActor { /* close_file_i + 通知线程退出 + join */ }

// 内部（不导出）：struct AimDll —— 46 个 extern 签名（附录 A），仅存在 actor 线程。
```

**验收标准**：
- [ ] golden：AGX、Du 两文件 Speed 通道误差 ≤1e-4
- [ ] 50 次打开/关闭无句柄泄漏；中文/空格路径通过
- [ ] `cargo clippy -p aim-ffi -- -D warnings` 绿；unsafe 块每块 ≤10 行附 SAFETY；全仓 grep 证明 unsafe 只在本 crate
- [ ] 故意传不存在路径/损坏文件 → 返回 `TelemetryError::Dll` 而非 panic

**审查重点**：actor 是否真的串行（有无第二条线程碰 DLL）；mbcs 编码；`open_xrk_laps` 是否真用了 lap 族函数（不是整读后切片）。

---

## Step 4：通信协议与 Tauri 薄壳（telemetry-ipc + src-tauri）—— rev.4 重写

**做什么**：冻结前后端协议（**含 Job API**），实现壳层命令路由。交付：前端可 `StartImport` 导入 AGX 并轮询到 `Ready`，随后 `OpenDataset` + `WindowSeries` 出图。
**执行者**：主 agent。

**怎么做**：
1. 先写测试：Request 全变体 serde 往返；帧编解码往返；specta→TS 同步 CI diff；Job 状态机迁移合法性（如 `Ready` 后拒绝再迁移）；
2. `telemetry-ipc`：命令枚举 + `CmdError` + 帧编解码；
3. `src-tauri`：`AppState` 增加 `jobs: DashMap<JobId, ImportJob>`；导入在 tokio 任务里跑，按 1.4 的构建顺序执行（元数据→总览→优先队列→其余）；`PrioritizeImport` 重排队列；`WindowSeries` 改为经 `cache_core::DatasetCache::read_window_frame` 读取（**不再现场 minmax**）；
4. `tauri.conf.json`：窗口 1440×900、标题、图标（`Data/SCUTRacing.ico`）、NSIS + Webview2 `embedBootstrapper`。

**接口**（冻结，rev.4 版）：

```rust
#[derive(serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(tag = "cmd", rename_all = "snake_case")]
pub enum Request {
    // —— 导入（Job 化，D11）——
    StartImport      { path: String },                              // → JobId（幂等，见协议语义补充）
    StartImportBatch { paths: Vec<String>, recursive: bool },       // → Vec<JobId>；文件夹由 Rust 侧展开（P8 多选/文件夹/递归导入）
    ImportStatus     { job_id: u64 },                               // → ImportStatus
    CancelImport     { job_id: u64 },
    PrioritizeImport { job_id: u64, channels: Vec<String> },        // 点击优先；空数组=只优先该文件本身
    // —— 数据集（缓存命中后懒开，I3）——
    OpenDataset      { file_hash: String },                         // → DatasetMeta（只读 manifest+元数据）
    CloseDataset     { id: u64 },
    DatasetMeta      { id: u64 },
    WindowSeries     { id: u64, channel: String, start: f64, end: f64, pixels: u32,
                       generation: u64 },                           // → 二进制帧（generation 回显，I4）
    CursorValues     { id: u64, channels: Vec<String>, t: f64 },    // → Vec<f32>（raw mmap 二分）
    Laps             { id: u64 },
    Stats            { id: u64, channels: Vec<String>, start: f64, end: f64 },
    // —— 资料库 / 注释 / 布局 ——
    ListRecords { query: String }, DeleteRecord { record_id: i64 },
    ExportCsv { id: u64, channels: Vec<String>, start: f64, end: f64, out_path: String },
    Comments { record_id: i64 }, AddComment { record_id: i64, t: f64, text: String },
    DeleteComment { id: i64 },
    SaveLayout { name: String, json: String }, LoadLayout { name: String },
    EstimateOffset { id_a: u64, id_b: u64, channel: String, start: f64, end: f64 }, // Step 14
    PurgeCache { file_hash: Option<String> },                       // D10 清理入口；None=全部
    CacheRootStatus,                                                // → CacheRootStatus（状态栏/P8：缓存占用、RSS、活动 Job 数）
}

#[derive(serde::Serialize, serde::Deserialize, specta::Type)]
pub struct ImportStatus {
    pub job_id: u64,
    pub stage: ImportStage,     // ReadingMetadata|ReadingChannels|BuildingRawCache|BuildingPyramid|Ready|Failed|Cancelled
    pub progress: f32,          // 0..1（按通道加权）
    pub file_hash: String,
    pub meta_ready: bool,       // true 时前端即可显示元数据+通道清单（D11）
    pub error: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize, specta::Type)]
pub struct CacheRootStatus {
    pub cache_bytes: u64,        // 缓存根目录占用字节（状态栏"缓存状态"、P8 清理入口显示）
    pub db_path: String,
    pub mem_rss_bytes: u64,      // 进程 RSS（状态栏"内存"）
    pub active_jobs: u32,
}

#[derive(serde::Serialize, specta::Type)]
pub struct CmdError { pub code: String, pub message: String }
```

**协议语义补充（冻结）**：
- `StartImport` **幂等**：目标文件缓存已 Ready → 返回的 Job 立即置 Ready（元数据直接读缓存，不重建）。顶栏「打开文件」与"二开秒开"共用此入口，前端无需判断"是否已导入"；
- `WindowSeries`/`CursorValues` 命中未就绪通道（数据集 `RawPartial`/`PyramidPartial`）→ 返回 `CmdError{ code: "channel_building", .. }`，**不得**现场阻塞构建；前端据此渲染"构建中"占位（B.4-P2）并调 `PrioritizeImport`（Step 8 闭环）；
- `ImportStatus` 为拉取式：导入进行中每 250ms 轮询，进入终态（Ready/Failed/Cancelled）即停轮；`CacheRootStatus` 低频轮询（5s）供状态栏与 P8 清理入口。

二进制帧（little-endian；header 含 generation 回显）：
```
0     4    magic 0x314B5853 ("SXK1")
4     4    header_len (u32)
8     ..   header JSON: {"channel","unit","buckets","win_start","win_end","full_count","generation"}
..         8×N times f64 | 4×N mins f32 | 4×N maxs f32
```

```rust
// src-tauri 结构约定（≤600 行）
struct AppState {
    store: telemetry_store::Store,
    cache: cache_core::CacheRoot,
    aim: aim_ffi::AimActor,
    datasets: dashmap::DashMap<u64, std::sync::Arc<cache_core::DatasetCache>>, // 懒开句柄，不是全量数据
    jobs: dashmap::DashMap<u64, ImportJob>,
    next_id: std::sync::atomic::AtomicU64,
}
```

**验收标准**：
- [ ] serde/帧/TS 同步测试绿；Job 状态机非法迁移被拒测试绿
- [ ] dev 窗口真实调通：StartImport(AGX) → ImportStatus 阶段推进可见（`meta_ready` 先变 true）→ Ready → OpenDataset → WindowSeries 出帧
- [ ] `WindowSeries` 走 `read_window_frame`（grep 证明无现场全量 minmax）；handler 无业务逻辑

**审查重点**：优先队列实现（`PrioritizeImport` 是否真能插到队首）；`OpenDataset` 是否只读 manifest（I3）。

---

## Step 5：前端骨架与垂直切片验收 —— 总检查点

**做什么**：前端壳 + 端到端打通**新数据通路**。交付：**导入 AGX → 进度条分阶段推进、元数据先可见 → Ready 后出 Speed 曲线 → 拖动/缩放流畅**。
**执行者**：主 agent；**负责人检查点验收**。

**怎么做**：
1. 先写测试（vitest）：`decodeFrame`（含 generation 回显）；`appStore` 的 `bumpGeneration` 与过期丢弃；进度条阶段文案映射；
2. 实现：`api/client.ts`（按 Step 4 新命令全文）；`state/appStore.ts`（增加 `generation`、`importJobs`）；`plot/uPlotFactory.ts`（多图 X 联动 sync key 固定 `scut`）；`components/ImportProgressBar.tsx`（附录 B.7）；`AppShell` / `ChannelPlot` / `TimelineBar` 占位；
3. dockview `onDidLayoutChange` → `uPlot.setSize` 接线验证；
4. 切片走查 + golden 复核（曲线与 RaceStudio3 目视一致）。

**UI 规格（本步，引用附录 B）**：
- 本步把 **B.1 令牌表全量落地为 CSS 变量**（深色先行），后续所有 Step 只消费不新增；
- 壳层 chrome 按 B.2 尺寸与 B.3 组件规范：顶栏 40px 五段构成（含状态灯）、状态栏 24px 竖分隔线、dockview 分割条/标签页/拖拽镜像样式；
- `ImportProgressBar` 按 B.7 接入顶栏下方，阶段文案映射进 vitest；
- 走查：B.10 第 1/2/6 条。

**接口**（冻结，全文；`types.ts` 由 specta 生成）：
```ts
// src/api/client.ts —— 唯一 invoke 入口；组件禁 import '@tauri-apps/api/*'
export interface FrameHeader { channel: string; unit: string; buckets: number;
  win_start: number; win_end: number; full_count: number; generation: number }
export interface WindowFrame { header: FrameHeader; times: Float64Array; mins: Float32Array; maxs: Float32Array }
// 内部：decodeFrame(buf: ArrayBuffer): WindowFrame —— 按 Step 4 帧格式（含 generation 回显）

export function startImport(path: string): Promise<number>
export function startImportBatch(paths: string[], recursive: boolean): Promise<number[]>
export function importStatus(jobId: number): Promise<ImportStatus>
export function cancelImport(jobId: number): Promise<void>
export function prioritizeImport(jobId: number, channels: string[]): Promise<void>
export function openDataset(fileHash: string): Promise<DatasetMeta>
export function closeDataset(id: number): Promise<void>
export function datasetMeta(id: number): Promise<DatasetMeta>
export function windowSeries(id: number, channel: string, start: number, end: number,
                             pixels: number, generation: number): Promise<WindowFrame>
export function cursorValues(id: number, channels: string[], t: number): Promise<number[]>
export function getLaps(id: number): Promise<LapInfo[]>
export function getStats(id: number, channels: string[], start: number, end: number): Promise<Record<string, ChannelStats>>
export function listRecords(query: string): Promise<Record_[]>
export function deleteRecord(recordId: number): Promise<void>
export function exportCsv(id: number, channels: string[], start: number, end: number, outPath: string): Promise<void>
export function getComments(recordId: number): Promise<Comment[]>
export function addComment(recordId: number, t: number, text: string): Promise<number>
export function deleteComment(id: number): Promise<void>
export function saveLayout(name: string, json: string): Promise<void>
export function loadLayout(name: string): Promise<string | null>
export function estimateOffset(idA: number, idB: number, channel: string, start: number, end: number): Promise<number> // Step 14
export function purgeCache(fileHash: string | null): Promise<number>
export function cacheRootStatus(): Promise<CacheRootStatus>

// src/state/appStore.ts（zustand）—— 跨面板通信只允许经这里，禁止自定义事件总线
interface AppState {
  dataset: DatasetMeta | null
  checkedChannels: string[]
  channelOrder: string[]
  window: { start: number; end: number }
  cursorT: number
  theme: 'dark' | 'light'
  layoutPreset: string
  generation: number                       // 每次视口变更 bump；帧 header 回显不一致即丢弃（I4）
  importJobs: Record<number, ImportStatus>
  openDataset(fileHash: string): Promise<void>
  setWindow(w: { start: number; end: number }): void   // 唯一窗口写入口，全部面板订阅此处
  setCursor(t: number): void
  toggleChannel(key: string): void
  reorderChannels(order: string[]): void
  setTheme(t: 'dark' | 'light'): void
  bumpGeneration(): void
  startImport(path: string): Promise<number>
  prioritizeImport(jobId: number, channels: string[]): Promise<void>  // 点击优先（D11）
}

// src/panels/registry.ts —— 新面板 = 数组加一项 + 实现组件；不许改别人的项
export interface PanelProps { api: DockviewApi }
export interface PanelDef {
  id: string                    // 'channel-tree' | 'plot-stack' | 'laps' | 'stats' | 'comments' | 'track-map'
  title: string
  component: React.FC<PanelProps>
  defaultLocation: 'left' | 'right' | 'center'
  minWidth?: number
}
export const PANELS: PanelDef[]
```

**验收标准（切片不过，后续 Step 不开工）**：
- [ ] 导入 AGX 全程：进度条阶段推进符合附录 B.7 样式；`meta_ready` 后通道清单先可见
- [ ] Ready 后 Speed 曲线正确；拖动窗口流畅无白屏；面板拖拽图表自适应
- [ ] vitest 全绿；`scripts/check` 全绿
- [ ] **点击优先实测**：导入大文件途中勾选某通道，该通道构建被插队（日志/状态证明）

**审查重点**：generation 丢弃逻辑；进度条是否走令牌（无硬编码色）。

---

## Step 6（T01，可并行组 A）：CSV 解析器 — 派 subagent

**做什么**：RaceStudio3 CSV 的全量高速解析，补齐第二条文件通路。交付：`csv-parser` crate + golden 通过。
**执行者**：subagent，主 agent 派单与终审；allowed paths = `crates/csv-parser/`。

**派单要点**（按 0.4 模板填充）：
- 粘贴契约：Step 2 接口全文 + 本 Step 接口块；
- 必须先写的失败测试：
  1. `AGX.csv` → 通道数、单位行、20Hz 时间轴与 golden fixture（`tests/golden/agx_csv_meta.json`，Step 3 生成脚本顺带产出）一致；
  2. `;` 与 `\t` 分隔方言样本（自制小文件）；
  3. GB18030 编码样本（含中文元数据行）；
  4. 欧式小数逗号样本（`1,5` → 1.5，与千分位区分规则：含 `.` 不替换）；
  5. 缺单位行/空行/尾行不全的容错样本；
- 实现管线（指定）：memmap 映射 → 编码检测（utf-8-sig/utf-8/gb18030/cp1252 顺序试）→ 方言嗅探（`,;\t`，以表头行命中为准）→ 表头（`Time` 首列）与单位行定位 → rayon 按行块并行 → fast-float 列解析 → 组装 `TelemetryDataset`（`ChannelSource::Csv`）；
- rev.4 增量：`parse_csv` 的输出进入 Job 缓存管线（导入 CSV 也建 raw+pyramid——D10 下 CSV 的 raw 可佛系，但 pyramid 必建）；
- 交付证据：验收命令输出 + `cargo bench` 吞吐数字 + 文件清单。

**接口**（冻结）：
```rust
pub struct CsvSource;
impl telemetry_core::TelemetrySource for CsvSource {
    fn open(&self, path: &std::path::Path) -> Result<telemetry_core::TelemetryDataset, telemetry_core::TelemetryError>;
}
pub fn parse_csv(path: &std::path::Path) -> Result<telemetry_core::TelemetryDataset, telemetry_core::TelemetryError>;
```

**验收标准**：
- [ ] 5 类测试全绿；`cargo fmt --check && cargo clippy -- -D warnings && cargo test && cargo bench` 全绿
- [ ] 吞吐 ≥200MB/s（不达标不阻断，登记实测值）
- [ ] 交叉审 PASS 无 Critical；主 agent 终审合并

**审查重点**：欧式小数逗号与千分位的判别逻辑；并行解析时列顺序保证（rayon 分块后必须按原序拼装）。

---

## Step 7（T02，可并行组 A）：图表堆叠 + 总览时间轴 — 派 subagent

**做什么**：完整图表交互与总览时间轴，**数据全部走 pyramid 通路**（附录 B.4-P2/P3、B.9）。
**执行者**：subagent；allowed paths = `src/plot/`、`src/components/PlotStack.tsx`、`src/components/TimelineBar.tsx`。

**派单要点**：
- 双速交互（I4）：拖动/缩放进行中 → 每视口变更 `bumpGeneration`，请求用 `pixels` 实宽但允许后端选粗层，**合并请求**（同通道拖动中只保留最新）；停手 100ms 防抖 → 发一次精细请求（同像素，后端自然选更细层）；
- 十字线取值改走 `CursorValues` 命令（raw mmap 二分），不再 Worker 本地缓存全分辨率；
- 拖动中禁止：重复算全部 Y 轴、刷新所有图例、重建图表对象（只更新窗口数据）；可见图先刷、次要图下一帧；
- 交互全集：滚轮 X 缩放（鼠标为中心，factor=0.85^steps）、左轴上滚轮 = 该图 Y 独立缩放、左键拖动框选 X、双击复位 X+Y、鼠标移动 = 十字线（全部图同步竖线 + 图例瞬时值刷新，rAF 节流，**直接写 DOM 不经 React 重渲染**）、拖图标题调图序（写回 `channelOrder`）；三态按附录 B.4-P2/P3 实现，走查单 = B.4 的事件清单逐项。

**UI 规格（本步，引用附录 B）**：
- 坐标轴/网格/曲线线宽/阶跃对齐按 B.5 落地参数；**min/max 包络两档渲染**（正常 band 12% 填充 + 上下缘线；交互期降级中线 1px，停手恢复）——这既是 I4 性能行为也是视觉验收项；
- 十字线与跟随图例样式按 B.5（dashed 竖线、图例容器、tabular-nums 瞬时值不抖）；
- 时间轴视觉按 B.4-P3（缩略曲线配色、窗口框/手柄/框外遮罩/圈刻标）；
- 图标题栏与「构建中」占位按 B.4-P2；
- 走查：B.10 第 1/3/4/5 条。

**接口**（Worker 协议 rev.4 版）：
```ts
export type WorkerIn  = { type:'window'; reqId:number; generation:number; id:number;
                          channel:string; start:number; end:number; pixels:number }
export type WorkerOut = { type:'frame'; reqId:number; generation:number; frame:WindowFrame }
                      | { type:'error'; reqId:number; message:string }
// generation 不一致即丢弃；同 channel 同 generation 内只保留最新 reqId。
```

**验收标准**：
- [ ] 长记录（样例由负责人提供）4 图拖放：交互全程不读 raw 全量（日志断言）、过期帧全被丢弃（vitest）
- [ ] P2/P3 走查单全过；三级验收通过
- [ ] **不写帧率数字**——由 Step 13 负责人手感验收（D12）

**审查重点**：拖动中是否有任何全量扫描路径；防抖是否吞掉最后一次精刷。

---

## Step 8（T03，可并行组 A）：通道树 + 主题 + 快捷键 — 派 subagent

**做什么**：左侧通道树面板（B.4-P1）、双主题系统（B.6）、全局快捷键（B.9）。
**执行者**：subagent；allowed paths = `src/components/ChannelTreePanel.tsx`、`src/theme/`、`src/hooks/useHotkeys.ts`。

**派单要点**：
- 粘贴契约：Step 5 的 `appStore`/`registry` 段落 + 附录 B.4-P1 + B.1 令牌表 + B.9 快捷键表；
- 必须先写的失败测试：搜索过滤（大小写不敏感、匹配 name 与 unit）；勾选/取消写回 store；拖拽排序写 `channelOrder`；主题切换后 token 变量全量替换（无残留硬编码色，用检查脚本断言）；
- 实现要求：三段分组树（标准/GPS/派生，按 `ChannelSource` 归组）；每项 = checkbox + 英文通道名 + 单位 + 采样率徽标（`20Hz`/`100Hz`）；搜索防抖 150ms；通道拖到已有图上 → 该图叠加第二 Y 轴（上限 2 轴，超出提示）；右键菜单 = `仅显示此项` / `导出此通道 CSV`（后者调 `exportCsv`）；主题：Tailwind token 全量覆盖（B.1 色值表），禁硬编码色值，切换瞬时无闪烁（CSS 变量方案，不重挂载组件）；
- **rev.4 增量**：勾选某通道时若其 pyramid 未就绪（数据集 `PyramidPartial`），该图显示"构建中"占位并自动调 `PrioritizeImport`（D11 点击优先的前端闭环）。

**接口**：无新增（`PANELS` 数组增加 `channel-tree` 项，registry 见 Step 5）。

**UI 规格（本步，引用附录 B）**：
- 通道树视觉按 B.4-P1（组头 11px 大写字距、项高 24px、已勾选项左侧 2px 曲线色条、sticky 搜索框、拖拽 chip 镜像）；
- 主题切换按 B.6（零重挂载、<150ms、Canvas 取色经 `getComputedStyle` 并随主题重绘）；
- 「构建中」占位 = B.3 骨架波形 + B.4-P2 文案；
- 走查：B.10 全条（本步是主题系统落地方，负全责）。

**验收**：上述测试与占位/优先调用测试全绿；快捷键全表生效；B.10 走查单全过；三级验收通过。

---

## Step 9（T04，可并行组 B）：分层缓存 —— rev.4 重写为 9A + 9B

### Step 9A：cache-core + telemetry-store（主 agent 主写，subagent 辅助测试）

**做什么**：实现第 1 章的全部持久化机制。这是性能数据层的心脏，属主干（C2）。
**怎么做**（主 agent；派 1 个 subagent 并行补测试矩阵）：
1. 先写测试：
   - `.raw`/`.pyr` 文件写读往返（含 NaN、空通道、非 UTF8 通道名、奇数长度）；
   - manifest 状态机迁移与非法迁移拒绝；中断续建（模拟写到一半删 temp 外文件 → 从状态恢复）；
   - checksum 损坏 → 标记 Invalid 并触发对应通道重建，不错用；
   - `read_window_frame` 选层正确（与 `query_pyramid` 对拍）；`read_cursor_values` 边界；
   - SQLite：records/comments/layouts CRUD、级联删、schema_version 不符拒绝；
2. 实现 `cache-core`：`CacheRoot` / `DatasetCache` / `CacheManifest` / raw 与 pyr 文件格式（ADR-0004）/ mmap 读取；
3. 实现 `telemetry-store`：SQLite（schema 见本 Step 接口块）+ Job 记录表 + 缓存索引；
4. 切换 Step 4 壳层到真实现，**壳层 diff 应为零**（验证抽象正确）。

**接口**（冻结）：
```rust
// cache-core
pub struct CacheRoot { /* 缓存根目录 */ }
impl CacheRoot {
    pub fn open(path: &Path) -> Result<Self, CacheError>;
    pub fn dataset(&self, file_hash: &str) -> Result<DatasetCache, CacheError>;       // 懒开（I3）
    pub fn begin_import(&self, source: &Path, identity: SourceIdentity) -> Result<ImportSession, CacheError>;
    pub fn purge(&self, file_hash: Option<&str>) -> Result<u64, CacheError>;          // 返回释放字节数（D10）
}

pub struct DatasetCache { /* manifest + 文件句柄，无全量数据 */ }
impl DatasetCache {
    pub fn manifest(&self) -> &CacheManifest;               // 状态机、通道清单、checksum
    pub fn read_window_frame(&self, key: &str, start: f64, end: f64, pixels: u32) -> Result<MinMaxFrame, CacheError>;
    pub fn read_cursor_values(&self, keys: &[String], t: f64) -> Result<Vec<f32>, CacheError>; // raw mmap 二分
    pub fn channel_meta(&self) -> &[ChannelMeta];
    pub fn laps(&self) -> &[LapInfo];
}

pub struct ImportSession { /* 构建器：写 temp → 原子改名 → 更新 manifest 状态 */ }
impl ImportSession {
    pub fn write_meta(&mut self, meta: &SessionMeta, channels: &[ChannelMeta]) -> Result<(), CacheError>;
    pub fn write_channel(&mut self, key: &str, series: &ChannelSeries) -> Result<(), CacheError>; // 内部同步建 pyramid
    pub fn write_laps(&mut self, laps: &[LapInfo]) -> Result<(), CacheError>;
    pub fn finish(self) -> Result<DatasetCache, CacheError>;
    pub fn abort(self);  // 清理 temp，状态回滚
}

pub struct SourceIdentity { pub hash: String, pub mtime: u64, pub size: u64 }  // 源文件身份（备份恢复后防错用）
#[derive(Debug, thiserror::Error)] pub enum CacheError { /* Io, Codec, Invalid, VersionMismatch */ }

// telemetry-store（SQLite）
pub struct Store { /* rusqlite::Connection 私有 */ }

#[derive(Clone, Debug, serde::Serialize, specta::Type)]
pub struct Record { pub id: i64, pub stored_path: String, pub original_name: String,
    pub duration_s: f64, pub sample_rate_hz: f32, pub racer: String, pub vehicle: String,
    pub session_date: String, pub imported_at: String }
#[derive(Clone, Debug, serde::Serialize, specta::Type)]
pub struct Comment { pub id: i64, pub record_id: i64, pub t: f64, pub text: String, pub created_at: String }

impl Store {
    pub fn open(path: &std::path::Path) -> Result<Self, StoreError>;   // 自动建表 + schema 迁移
    pub fn upsert_record(&self, rec: &Record) -> Result<i64, StoreError>;
    pub fn list_records(&self, query: &str) -> Result<Vec<Record>, StoreError>;
    pub fn delete_record(&self, id: i64) -> Result<(), StoreError>;
    pub fn comments(&self, record_id: i64) -> Result<Vec<Comment>, StoreError>;
    pub fn add_comment(&self, record_id: i64, t: f64, text: &str) -> Result<i64, StoreError>;
    pub fn delete_comment(&self, id: i64) -> Result<(), StoreError>;
    pub fn save_layout(&self, name: &str, json: &str) -> Result<(), StoreError>;
    pub fn load_layout(&self, name: &str) -> Result<Option<String>, StoreError>;
}
#[derive(Debug, thiserror::Error)]
pub enum StoreError { /* Sqlite(#[from] rusqlite::Error), Codec(String) */ }
```

```sql
-- telemetry.db schema（meta 初始：schema_version='2'）
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS records(
  id INTEGER PRIMARY KEY, stored_path TEXT UNIQUE NOT NULL, original_name TEXT NOT NULL,
  file_hash TEXT, duration_s REAL, sample_rate_hz REAL,
  racer TEXT, vehicle TEXT, session_date TEXT, imported_at TEXT NOT NULL,
  cache_file_mtime INTEGER, cache_file_size INTEGER);
CREATE TABLE IF NOT EXISTS comments(
  id INTEGER PRIMARY KEY, record_id INTEGER NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  t REAL NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS layouts(name TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at TEXT NOT NULL);
```

**验收标准**：
- [ ] 测试矩阵全绿（含中断续建与校验损坏两条"脏路径"）
- [ ] 壳层零 diff 切换；二次打开 AGX 明显快于首开（日志时间戳对比，**只作冒烟记录，不设数值门槛**）
- [ ] 三级验收通过；**负责人检查点**：确认首开/二开体验差异符合 D11 预期

### Step 9B：资料库主页 + 导入工作流 UI — 派 subagent

**做什么**：资料库主页（附录 B.4-P8 全量实现）与导入工作流 UI。
**执行者**：subagent；allowed paths = `src/components/library/`。

**派单要点**：
- 粘贴契约：Step 4 相关命令（`StartImport`/`ImportStatus`/`CancelImport`/`PrioritizeImport`/`ListRecords`/`DeleteRecord`/`PurgeCache`）+ Step 9A 的 `Record` 类型 + 附录 B.4-P8 + B.7；
- 必须先写的失败测试：搜索过滤（文件名/车手/车辆，大小写不敏感）；双击卡片 → 打开流程参数正确；缓存状态徽标三态映射；删除/清理缓存的二次确认流程；
- 实现要求：搜索 + 记录卡片网格 + 导入（多选/文件夹/递归，入口走 `StartImport`/`StartImportBatch`）+ 右键（打开/导出/删除/清理缓存 `PurgeCache`，二次确认）；卡片显示缓存状态徽标（Ready/构建中/未缓存）；进度条（B.7）+ 取消接 `CancelImport`；P8 三态全部实现（空库引导 / 导入中全局进度可取消 / 错误横幅重试）。

**UI 规格（本步，引用附录 B）**：
- 资料库主页视觉按 B.4-P8（卡片网格 240px/12px 间距、卡片三段构成、缓存状态徽标 B.3、空库大引导、hover 升层）；
- 进度条按 B.7；清理缓存二次确认对话框按 B.3（确认钮写清后果、不抢默认焦点）；
- 走查：B.10 第 1/2/3 条。

**验收**：P8 三态走查 + 状态徽标与清理入口测试。

---

## Step 10（T05，可并行组 B）：统计 + 圈速 — 派 subagent

**做什么**：统计面板（B.4-P5）与圈速面板（B.4-P4）。
**执行者**：subagent；allowed paths = `src/services/`、`src/components/StatsPanel.tsx`、`src/components/LapPanel.tsx`。

**派单要点**：
- 粘贴契约：Step 2 的 `stats.rs`/`LapInfo` + Step 4 的 `Stats`/`Laps`/`CursorValues` 命令 + 附录 B.4-P4/P5；
- 必须先写的失败测试：统计请求参数组装；多选两通道后追加 RMSE/相关系数区；圈速行点击 → `setWindow` 参数正确；
- 实现要求：统计经 `Stats` 命令在 **Rust 侧全分辨率**计算（不传原始数组到前端再算 = Critical）；窗口变化 300ms 防抖（取消失效请求）；最优圈 success 徽标；表格数值 tabular-nums。

**UI 规格（本步，引用附录 B）**：两面板表格按 B.3 表格规范 + B.4-P4/P5（圈时 tabular-nums、最优行 success 徽标、当前窗口覆盖行 accent-dim、通道列 8×8 色块、防抖等待期数值 50% 透明）。走查：B.10 第 1/5 条。

**验收**：统计值与 golden 参考矩阵（由 AGX.csv 预算出）容差 1e-4；长任务期间 UI 可交互（实测证明）；三级验收通过。

**审查重点**：统计是否在 Rust 侧算；防抖是否取消过期请求。

---

## Step 11（T06，可并行组 B）：赛道图 + 导出 — 派 subagent

**做什么**：GPS 赛道图（B.4-P6）与 CSV/PNG 导出；注释面板（P7，可裁）。
**执行者**：subagent；allowed paths = `src/track/`、`crates/telemetry-core/src/export.rs`、`src/components/TrackMapPanel.tsx`。

**派单要点**：
- 粘贴契约：Step 2 的 `gps.rs` + Step 4 的 `ExportCsv` 命令 + 附录 B.4-P6/P7；
- 必须先写的失败测试：经纬度→本地平面投影（等比、居中、留边距）；速度→热力色带映射边界值；导出 CSV 的表头/单位行/时间格式与 v1 `parser.py` 输出逐字节对比（RaceStudio3 兼容）；
- 实现要求：Canvas 2D；轨迹按 Speed 热力着色（B.1 色带）；十字线红点联动（订阅 `cursorT`）；等比缩放+平移（滚轮缩放、拖拽平移）；圈起止标开关；无 GPS 通道显示占位文案；导出 CSV 必须能被 RaceStudio3 打开（人工确认项）；PNG 导出 = 当前图表区截图；
- rev.4 增量：轨迹数据经 `read_window_frame` 取 pyramid 层（GPS 通道也在塔内）。

**接口**：无新增（`export.rs` 为 telemetry-core 内部新文件，对外仍走 `ExportCsv` 命令）。

**UI 规格（本步，引用附录 B）**：赛道图按 B.4-P6（bg-app 底无底图、轨迹 3px round cap/join、Speed 热力色带按 B.1 四色、sRGB 插值、起点 success 圆/终点白圈、十字线联动红点、无 GPS 空态文案）；导出 PNG = 当前画布原样截图，不做额外排版。走查：B.10 第 1/3 条。

**验收**：轨迹渲染与 golden 截图对比像素容差 2% 内；导出 CSV 被 RaceStudio3 成功打开（人工确认截图）；三级验收通过。

**审查重点**：投影是否等比（经纬度直接当 x/y 会变形，需按纬度修正）；导出浮点格式与 v1 一致性。

---

## Step 12（T07）：迁移工具 + e2e — 派 subagent

**做什么**：`migrate-v1`（v1 Python 版 SQLite → JSON → 新库）与端到端冒烟测试。
**执行者**：subagent；allowed paths = `crates/migrate-v1/`、`tests/e2e/`。

**派单要点**：
- 粘贴契约：Step 9A 的 schema 与 `Store` API；
- 迁移流程：读 v1 库（只读模式打开，绝不写回）→ 导出 JSON 中间件 → 写入新 schema；输出对账单（v1 记录数、v2 记录数、注释数、不一致明细）；工具一次性使用，不进主程序；
- e2e（WebdriverIO + tauri 驱动）路径：启动 → 导入 AGX（等进度条 Ready）→ 打开 → 勾 Speed → 缩放 → 导出 CSV 到临时目录 → 断言文件存在且非空；另加一条：导入途中取消 → 再导入 → 能续建或干净重来；
- v1 库测试资产位置 = `tests/fixtures/v1_library.db`（由原 Python 工程 `code/library/library.db` 快照导入，只读模式打开，绝不写回）；e2e 依赖（WebdriverIO + tauri-driver）必须进 `docs/contracts/dependencies.md` 白名单并注明理由（0.3-8）。

**验收**：迁移对账单：记录数/注释数一致（或差异有逐条解释）；e2e 冒烟全绿；三级验收通过。

**审查重点**：v1 库只读（绝不写回）；e2e 不追求覆盖率，只保主路径。

---

## Step 13：发布硬化 — 主 agent（负责人验收）

**做什么**：压测冒烟、打包、离线验证、D13 证据门裁决。交付：发布候选。

**怎么做**：
1. **200MB 样本冒烟**（D12：不测帧率，只做三项）：
   - 首开全程 UI 可交互（导入 Job 化证明，I5）；
   - 二开后多图表（≥6 图）拖放缩放，**负责人手感裁决**"顺/不顺"；
   - 内存观察：连开 3 个数据集，任务管理器读数无阶梯式泄漏；
   - **D13 证据门**：若上述过程中 DLL 崩溃/泄漏/无法取消 → 触发 aim-worker.exe 进程隔离立项（只换 Job 执行后端，接口零变化）；否则记录在案，不做；
2. 打包：便携 zip + NSIS + Webview2 `embedBootstrapper`；
3. 两台干净机器（含一台断网）全流程实装；
4. 发布说明：缓存目录位置与清理方法、备份范围说明（原始文件 + telemetry.db，缓存可重建）、已知限制。

**验收标准**：
- [ ] 冒烟三项负责人签字式确认；D13 裁决记录在 ADR-0007
- [ ] 双机器（含离线）安装运行通过
- [ ] **附录 B.10 设计验收走查单全过**（双主题截图、三态截图、高分屏截图归档）

---

## Step 14（T08，最后）：双文件对比 — 派 subagent

**做什么**：B 文件加载、手动/自动（FFT）对齐、对比视图与预设（B.4-P9）。**故意排最后：只依赖已冻结契约，不反向影响主干。**
**执行者**：subagent（1~2 实例）；allowed paths = `src/components/ComparePanel.tsx`、`src/plot/compare/`、`crates/telemetry-core/src/align.rs`。

**派单要点**：
- 粘贴契约：Step 2 的 `estimate_offset` + Step 4 的 `EstimateOffset` 命令 + 附录 B.4-P9 + B.5 对比模式段；
- 必须先写的失败测试：合成信号（已知偏移 0.37s 的两条正弦+噪声，**样例由负责人提供**）FFT 估计误差 <1 采样间隔；窗口不含重叠段时的报错路径；
- 实现要求：顶栏「对比模式」进入；B 文件选择器（复用资料库记录）；偏移量显示 + 手动微调（±0.001s 步进按钮与直接输入）；「自动对齐」按钮（选通道，默认 GPS Speed）；叠图/分图开关；对比预设可保存恢复（复用 layouts 表）；B 数据集曲线虚线渲染 + 色板 +4 偏移（B.5）；数据通路同走 pyramid。

**UI 规格（本步，引用附录 B）**：对比模式视觉按 B.4-P9 与 B.5——A/B 徽标（实色块/空心块）、B 曲线 `dash [6,4]` 1.25px、色板 +4 偏移、偏移量等宽显示与 24×24 微调钮、叠图/分图分段控件；**暗色主题下虚线可读性为人工确认项**。走查：B.10 第 1/3 条。

**验收**：AGX vs Du 对齐结果与 v1 行为容差内一致（并排截图）；对比预设保存/恢复正确；三级验收通过。

**审查重点**：FFT 前是否做了重采样对齐（两通道采样率不同时）。

---

## 附录 A：AiM DLL 导出清单（46 个，实测枚举）

```
open_file, open_file_with_licence, close_file_i, close_file_n, get_last_open_error,
get_vehicle_name, get_track_name, get_racer_name, get_championship_name, get_session_type_name,
get_date_and_time, get_laps_count, get_lap_info, get_session_duration,
get_channels_count, get_channel_name, get_channel_name_no_spaces, get_channel_units,
get_channel_samples_count, get_channel_samples,
get_GPS_channels_count, get_GPS_channel_name, get_GPS_channel_name_no_spaces,
get_GPS_channel_units, get_GPS_channel_samples_count, get_GPS_channel_samples,
get_GPS_raw_channels_count, get_GPS_raw_channel_name, get_GPS_raw_channel_name_no_spaces,
get_GPS_raw_channel_units, get_GPS_raw_channel_samples_count, get_GPS_raw_channel_samples,
get_lap_channel_samples_count, get_lap_channel_samples,
get_lap_GPS_channel_samples_count, get_lap_GPS_channel_samples,
get_lap_GPS_raw_channel_samples_count, get_lap_GPS_raw_channel_samples,
set_GPS_sample_freq, get_file_stat, get_file_state, get_library_date, get_library_time,
get_device_id, get_number_of_devices
```

## 附录 B：UI 设计规范（rev.4 自包含版，唯一美学依据）

> 本附录是全部 UI 工作的唯一美学依据，自包含、不再引用 rev.3。各 Step 正文只写该步特有要点，通用规则一律以本附录为准；冲突时以本附录为准。

### B.0 设计原则

1. **数据密度优先**：这是工程师工具，不是演示网站。屏幕 ≥90% 给数据，≤10% 给 chrome（顶栏/边框/按钮）；任何"为了好看"而牺牲信息密度的设计一律打回；
2. **克制的装饰**：无阴影、无渐变、无插画、无圆角滥用。视觉层级只有三种手段——底色阶梯、字色阶梯、0.5px 分隔线；
3. **暗夜仪表 heritage**：默认深色，气质对齐 RaceStudio / MoTeC i2 类专业遥测软件——黑灰底、单一高亮色、曲线用高饱和色；
4. **颜色只承载语义**：accent = 可操作/当前焦点，success = 最优/就绪，danger = 错误/不可逆操作，muted = 次要信息；禁止用颜色做纯装饰；
5. **中文 UI**（C4）：界面文案全中文；通道名/单位/数值保留英文原文；**一切状态可见**——任何面板必须有空/加载/错误三态，不允许白屏；
6. **动效只给反馈，不给表演**：hover/开关/进度有动效；数据渲染零动画（曲线出现不做入场效果）。

### B.1 设计令牌（双主题）

**实现形式**：CSS 变量挂 `:root[data-theme="dark"|"light"]`，经 Tailwind token 映射消费。组件只允许 `var(--token)` 或 token 类，**禁硬编码色值**（CI grep 白名单：曲线色板、热力色带、Canvas 内取色）。

**底色与文字**：

| token | 深色（默认） | 浅色 | 用途 |
|---|---|---|---|
| bg-app | `#14161B` | `#F5F6F8` | 应用底色 |
| bg-panel | `#1B1D23` | `#FFFFFF` | 面板/卡片 |
| bg-raised | `#23262E` | `#FFFFFF`（配 border） | 浮层：菜单/tooltip/对话框/进度条轨道 |
| bg-hover | `#262A33` | `#EEF0F3` | hover 底色 |
| bg-active | `#2C313B` | `#E4E7EC` | 按下/选中底色 |
| border | `#2A2E37` | `#E2E4E9` | 分隔线、描边 |
| border-strong | `#3A3F4B` | `#C9CDD4` | 表头下线、输入框失焦描边 |
| text-primary | `#E6E8EB` | `#1B1D23` | 正文/数值 |
| text-muted | `#8B909A` | `#5F636B` | 次要文字、单位、轴标签 |
| text-faint | `#5A5F6A` | `#9AA0A8` | 占位、禁用文字 |

**语义色**：

| token | 深色 | 浅色 | 用途 |
|---|---|---|---|
| accent | `#378ADD` | `#185FA5` | 主操作、焦点、窗口框、进度填充、当前项 |
| accent-dim | accent 12% 透明 | 同 | 选中底色、窗口框填充 |
| danger | `#E24B4A` | `#D85A30` | 错误、删除、失败左边条 |
| success | `#1D9E75` | `#0F6E56` | 最优圈徽标、缓存 Ready 徽标 |
| warning | `#D97706` | `#B45309` | 构建中提示、非致命告警 |
| focus-ring | accent 40% 透明 | 同 | 键盘焦点环（2px 外描边） |

**曲线色板**（与 v1 一致，按勾选顺序循环，两主题同色——读图习惯不随主题漂移）：
`C1 #EF4444 / C2 #22C55E / C3 #3B82F6 / C4 #F59E0B / C5 #A855F7 / C6 #14B8A6 / C7 #EC4899 / C8 #84CC16`
- 对比模式 B 数据集：同色板 **+4 位偏移**（B 的第 1 条曲线用 C5）并叠加虚线（B.5）；
- 热力色带（赛道图轨迹、未来热力图）：`#3B82F6 → #22C55E → #F59E0B → #EF4444`（蓝→绿→黄→红），sRGB 插值。

**字体**：
- 字族：`"Segoe UI", "Microsoft YaHei", "PingFang SC", system-ui, sans-serif`；等宽（时间戳/十六进制/帧偏移）：`"Cascadia Mono", Consolas, monospace`；
- **一切数值 `font-variant-numeric: tabular-nums`**（表格、图例、状态栏、轴标签）——逐帧刷新不抖动；
- 字号阶梯（只用这五档）：11px 轴标签/徽标 | 12px 面板标题/次要文字 | 13px 正文/表格 | 14px 区块标题 | 20px 大数字（仅资料库统计）；
- 字重：常规 400 / 强调 600；**禁用 ≤300 细体**（暗色底下发虚）。

**几何与动效**：
- 圆角：面板/卡片 6px；按钮/输入/徽标 4px；tooltip/菜单 6px；禁用更大圆角；
- 边框：分隔线统一 0.5px（高 DPI 用 1px 50% 透明实现同观感）；输入框 1px；
- 间距：4px 基栅，只用 2/4/8/12/16/24 六档；面板内边距 12px，工具条内边距 8px；
- 动效时长：hover 100ms / 折叠与开关 150ms / 进度与淡入淡出 250ms；缓动 `cubic-bezier(0.2, 0, 0, 1)`；**禁止 >300ms 动画与弹性缓动**；
- z-index 阶梯：内容 0 → 面板内浮层 10 → 下拉/右键菜单 100 → tooltip 200 → 对话框 300 → 全局横幅 400。

### B.2 布局系统

```
┌──────────────────────────────────────────────────────────────────────┐
│ 顶栏: ☰ 资料库 | 打开文件 | 预设[分析▾] | 主题◐ | 文件名 - 车手  状态灯 │ 40px
├──────────┬───────────────────────────────────────────────┬───────────┤
│ 通道树    │   图表堆叠区（dockview 主区）                  │ 上下文面板 │
│ (dockview)│  每选中通道一图：Y轴+曲线+跟随图例+关闭钮        │ 圈速|统计| │
│ 220px    │                                               │ 注释      │
│          │                                               │ 48px⇔260px│
├──────────┴───────────────────────────────────────────────┴───────────┤
│ 总览时间轴（固定，不进 dockview）: 缩略曲线+[可拖窗口]+圈标          │ 64px     │
├──────────────────────────────────────────────────────────────────────┤
│ 状态栏: t= | 窗口 | 采样率 | 通道数 | 缓存状态 | 内存                │ 24px     │
└──────────────────────────────────────────────────────────────────────┘
```

- **顶栏 40px**：内边距 0 12px，底边 0.5px border；左→右固定顺序：资料库 / 打开文件 / 预设下拉 / 主题切换 / 中部文件名-车手（13px，文件名 600、车手 muted）/ 右端状态灯；
- **通道树**：默认 220px，可拖范围 180~320px；
- **上下文面板**：48px 图标条 ⇔ 260px 展开，切换 150ms；
- **总览时间轴**：固定 64px，顶边 0.5px border，**不进 dockview**；
- **状态栏 24px**：11px muted，项间 0.5px 竖分隔线，数值 tabular-nums；
- **dockview**：分割条视觉 2px（命中区 6px），hover 变 accent；标签页高 28px，激活标签 2px accent 底边；拖拽镜像 60% 透明；
- **预设**：`分析`（默认，上图）/ `全图`（隐藏左右栏）/ 自定义（存 layouts 表，顶栏下拉切换）；
- **最小可用窗口 960×600**；宽度 <1100px 时通道树自动收起为图标条。

### B.3 通用组件规范

- **按钮**：高 28px、padding 0 12px、圆角 4px、13px。primary = accent 底白字；ghost = 透明底 + hover bg-hover（工具条默认）；icon 钮 24×24；danger 仅用于删除/清理等不可逆操作——常显 ghost，hover 才显 danger 字色；
- **输入/搜索框**：高 28px、bg-app 底、1px border、圆角 4px；聚焦 border 变 accent + focus-ring；占位 text-faint；
- **checkbox**：14×14、圆角 2px、勾选 accent 底白勾；半选态横杠；
- **表格**：行高 28px；表头 12px muted、下 0.5px border-strong；**数字右对齐 tabular-nums，文本左对齐，单位 muted**；行 hover bg-hover；选中行 accent-dim 底 + 左侧 2px accent 条；**禁用斑马纹**；
- **徽标 badge**：高 16px、padding 0 6px、圆角 3px、11px；样式 = 语义底色 15% 透明 + 语义色文字（中性信息如采样率用 muted）；用于：采样率、缓存状态（Ready=success / 构建中=accent 呼吸 / 未缓存=muted）、最优圈；
- **tooltip**：bg-raised + 0.5px border、圆角 6px、12px、延迟 400ms、指针偏移 8px；带快捷键的项格式 `动作 (Ctrl+O)`；
- **右键菜单**：bg-raised、圆角 6px、项高 26px、icon 14px、危险项 danger 字色、分隔线 0.5px、禁用项 text-faint；
- **滚动条**：宽 8px、滑块 bg-raised（hover border-strong）、轨道透明；图表区无滚动条（缩放替代滚动）；
- **对话框/二次确认**：宽 ≤400px、bg-panel + 0.5px border、标题 14px/600、按钮右对齐（主操作在右）；**不可逆操作双保险**（如清理缓存：确认钮文案写清后果如"确认清理"，且不放默认焦点）；
- **三态视觉规范（全面板统一）**：
  - 空态：居中图标（32px muted）+ 13px muted 文案 + 可选主操作按钮；禁止孤零零一句"暂无数据"；
  - 加载：**骨架屏** = bg-raised 圆角条按真实内容轮廓排布（图表 = 轴线框 + 波形占位；表格 = 行条；卡片 = 卡片轮廓），250ms 呼吸（透明度 0.6⇔1）；禁用转圈 spinner；
  - 错误：顶部通栏横幅（danger 左边条 3px + 13px 摘要（人话，不含堆栈）+ `重试` 按钮 + `详情` 折叠）；面板级错误 = 0.5px danger 描边框 + 居中摘要；
- **状态灯**（顶栏右端）：6px 圆点，success = 缓存就绪 / accent 250ms 呼吸 = 构建中 / danger = 错误；tooltip 显示详情。

### B.4 面板规格（P1~P9：职责/构成/事件/数据/三态/视觉）

- **P1 ChannelTreePanel**：选通道定图序。搜索框（防抖 150ms）+ 三段分组树（标准/GPS/派生，按 `ChannelSource` 归组）。事件：勾选增图/取消减图/拖到图上叠第二 Y 轴（≤2）/右键 = 仅显示此项·导出此通道。数据 = DatasetMeta.channels。三态：空 = 引导+打开按钮；加载 = 骨架行；错误 = 横幅+重试。**视觉**：组头 11px muted 大写字母 + 0.08em 字距（`STANDARD / GPS / DERIVED`）；项高 24px = checkbox + 英文名 13px + 单位 muted + 右侧采样率徽标；已勾选项左侧 2px 色条 = 该通道曲线色；搜索框 sticky 置顶；拖拽镜像 = 通道名 chip（accent 描边）。
- **P2 PlotStack**：主视图多图 X 联动。事件：滚轮 X 缩放（鼠标中心，0.85^steps）/左轴滚轮 Y 缩放/左键框选 X/双击复位/移动 = 十字线（rAF 节流直写 DOM）/拖标题调序。数据 = pyramid 帧 + `CursorValues`。三态：空 =「请选择左侧通道以显示图表」；加载 = 骨架波形；错误 = 红框+摘要。**视觉**：每图默认高 160px（图间分隔可拖）；图标题栏 28px = 8×8 通道色块 + 通道名 13px + 单位 muted + 关闭 ✕（hover 才显）；Y 轴 80px；网格只画水平主刻度（0.5px border 30% 透明），不画竖网格；「构建中」占位 = 骨架波形 + 12px muted 文案（Step 8 的点击优先闭环）。
- **P3 TimelineBar**：固定底部。全程缩略（512 桶）+ 窗口框 + 圈刻标；双击全程；无文件灰化。**视觉**：缩略曲线 = 主通道 min/max 包络（text-muted 50%，10% 透明填充，不抢主图）；窗口框 = accent-dim 填充 + 1px accent 边，左右手柄 4px 宽圆角 2px accent 实心（hover 增宽至 6px）；框外遮罩 bg-app 60%；圈刻标 = 底部 8px 高 tick，最优圈 success 色；无文件时整体 muted 30% 且禁交互。
- **P4 LapPanel**：表 `圈|开始|圈时|Δ最优`；点行跳窗口。**视觉**：圈时 tabular-nums；Δ最优 格式 `+x.xxx`（最优行显示 success 徽标「最优」）；当前窗口覆盖的行 accent-dim 底。
- **P5 StatsPanel**：表 `通道|min|max|avg|std`（当前窗口，300ms 防抖）；选两行追加 `RMSE|相关系数`。**视觉**：通道列前置 8×8 曲线色块；数值右对齐 tabular-nums；**防抖等待期数值 50% 透明**（表示"过期待刷新"）；RMSE 区上方 0.5px 分隔线 + 12px muted 标题。
- **P6 TrackMapPanel**：Canvas 2D；等比缩放+平移；圈起止标开关。无 GPS =「该记录无 GPS 数据」。**视觉**：背景 bg-app，无底图无网格（D5）；轨迹线宽 3px（round cap/join），按 Speed 热力色带（B.1）；起点 6px success 实心圆、终点 6px 白圈（1.5px 描边）；十字线联动点 = 5px `#EF4444` 实心圆 + 2px bg-panel 描边。
- **P7 CommentsPanel**（可裁）：时间锚定评论 CRUD，新增取当前十字线时间。**视觉**：列表项 = 时间锚点（accent 12px 等宽，点击跳十字线）+ 正文 13px；hover 才显编辑/删除 icon 钮。
- **P8 LibraryHome**：独立路由非面板。搜索 + 记录卡片网格 + 导入（多选/文件夹/递归）+ 右键（打开/导出/删除/清理缓存）；双击进分析视图。**视觉**：卡片网格（最小宽 240px，间距 12px）：bg-panel、圆角 6px、padding 12px；首行文件名 13px/600，次行 `车手 · 车辆 · 日期` 12px muted，底部徽标行（时长 / 通道数 / 缓存状态徽标按 B.3）；hover 升 bg-hover + border 变 border-strong；空库大引导 = 居中 48px 图标 +「导入遥测文件开始分析」+ primary 按钮；导入中走 B.7 全局进度条；错误横幅重试。
- **P9 ComparePanel**（Step 14）：B 文件选择器、偏移显示/微调（±0.001s）、自动对齐（FFT）、叠图/分图。**视觉**：顶栏「对比模式」进入后右侧出现 B 选择器（复用资料库记录）；偏移量 = 等宽 `±x.xxx s`，微调钮 24×24；叠图/分图 = 分段控件（高 24px、bg-app 底、选中段 accent-dim）；A/B 标识 = 图标题栏前置徽标（A = accent 实色块 / B = accent 空心块）。

### B.5 图表渲染美学专项（uPlot/Canvas 落地参数）

- **坐标轴**：轴线 0.5px border；刻度朝外长 4px；标签 11px muted tabular-nums；左轴宽 80px，`enableAutoSIPrefix: false`（数量级由通道单位表达）；网格仅水平主刻度（0.5px，border 色 30% 透明）；
- **曲线**：线宽 1.5px、round join；阶跃通道（挡位/开关量）`paths: step` 左对齐；**min/max 包络两档渲染**——正常态 = band 填充同色 12% + 上下缘 1px 同色线；交互期（拖动/缩放中）降级为中线 1px 单线，停手精刷后恢复包络（与 I4 双速一致，属性能行为也是视觉验收项）；
- **十字线与图例**：rAF 节流直写 DOM；竖线 1px dashed(4,4) text-muted 60%；图例 = 每图右上角，bg-panel 85% + 圆角 4px + padding 4px 8px，行构成 = 色块 + 通道名 + 瞬时值（tabular-nums，逐帧刷新宽度不抖）；
- **对比模式**：B 曲线 `dash [6,4]`、线宽 1.25px、色板 +4 偏移；分图模式 B 图标题栏带 B 徽标；**暗色主题下虚线可读性为人工确认项**；
- **对比度**：轴标签/徽标等小字在暗色下 ≥4.5:1（令牌已保证；新增自定义色须自查）。

### B.6 主题系统实现规范

- CSS 变量挂 `:root[data-theme]`，切换只改根属性，**零组件重挂载**，全量替换 <150ms 无闪烁；
- **Canvas/uPlot 内取色必须经 `getComputedStyle` 读令牌**，主题切换后触发一次重绘（禁缓存旧色）；
- 默认深色（C4）；首次启动跟随系统，用户手动改过后以用户为准并持久化；
- CI 检查：硬编码 hex grep，白名单（曲线色板/热力色带）之外为零。

### B.7 导入进度条 `ImportProgressBar`（D11）

- **位置**：顶栏下方通栏，高 22px；多 Job 时纵向堆叠（最多显 3 条，超出合并为"+N 个任务"）；
- **构成**：阶段中文文案（`读取元数据…`/`读取通道…`/`构建数据缓存…`/`构建图表索引…`/`就绪`/`已取消`/`失败`）+ 4px 进度条（accent 填充，bg-raised 底）+ 百分比 + 取消钮（✕，hover 变 danger）；
- **样式**：`bg-panel` 底、`border` 下边线、文字 12px `text-muted`（阶段名）/ `text-primary`（文件名），Ready 后 1.5s 淡出自动消失，Failed 常驻直到手动关闭（danger 色左边条 3px）；
- **行为**：点击条目 → 跳转到该数据集（即 `PrioritizeImport` + 定位）；取消 → `CancelImport`，状态变 `已取消`，temp 由后端清理；进度条宽度 250ms linear 跟随真实进度，**禁假滚动条**；
- **三态**：无任务时整体不渲染；导入中正常显示；失败显示错误摘要 + `重试` 按钮。

### B.8 动效与微交互清单

- **允许**：hover 底色 100ms；面板折叠/展开 150ms；进度条宽度 250ms linear；构建中徽标/状态灯呼吸 250ms；Ready 淡出 1.5s；骨架屏呼吸；拖拽中镜像 60% 透明、可拖元素 grab/grabbing 光标；
- **禁止**：曲线绘制动画、数字滚动动画、页面切换转场、弹性缓动、任何 >300ms 的动效。

### B.9 快捷键与性能预算

快捷键：`Ctrl+O` 打开 / `Ctrl+L` 资料库 / `Ctrl+D` 主题 / `←→` 十字线逐点 / `Shift+←→` 跨圈 / `Home` 复位缩放 / `1~9` 预设。
性能预算（B.4 旧数值指标）**按 D12 废止**，替换为第 1.6 节结构不变量 I1~I5。

### B.10 设计验收走查单（每个 UI Step 交付必过）

1. 令牌检查：grep 无硬编码色值/字号/圆角（白名单除外）；
2. 三态截图：空/加载/错误各一张归档；
3. 双主题截图对比：无残留暗色块/亮文字、无重挂载闪烁；
4. 暗色下小字对比度抽查（轴标签、徽标）；
5. tabular-nums 生效：图例/状态栏数值逐帧刷新宽度不抖（录屏或实测）；
6. 键盘可达：Tab 焦点环可见，B.9 快捷键全表生效；
7. 高分屏（150%/200% 缩放）下 0.5px 线不发虚、布局不错位；
8. B.8 禁令零违反。

## 附录 C：仓库结构（rev.4 · 工业标准规范）

```text
SCUTRacingTelemetry/
├── ⚙️ 项目全局配置与依赖清单（根目录）
│   ├── Cargo.toml                  # Workspace 根配置（统领 7 个 crates 与 src-tauri）
│   ├── Cargo.lock                  # Rust 依赖版本精确锁定
│   ├── package.json                # 前端根配置（React 18 + TS + Tailwind + Vite 脚本）
│   ├── pnpm-workspace.yaml         # pnpm 工作区定义
│   ├── pnpm-lock.yaml              # 前端依赖版本精确锁定
│   ├── tsconfig.json               # TypeScript strict 全局编译规则
│   ├── vite.config.ts              # Vite 6 开发服务器与打包配置
│   ├── tailwind.config.js          # Tailwind 3.4 设计令牌配置（严格映射附录 B.1）
│   ├── .gitignore                  # 忽略 target/、node_modules/、dist/ 与临时缓存
│   └── README.md                   # 项目简介与开发启动指引
│
├── 💻 Rust 核心与服务层（crates/，业务引擎纯逻辑，禁依赖 Tauri）
│   ├── telemetry-core/             # [Step 2] 核心数据模型、纯算法、SoA 序列、pyramid 构建与选层、GPS 投影、统计
│   │   ├── Cargo.toml
│   │   └── src/{lib.rs, models.rs, pyramid.rs, downsample.rs, gps.rs, stats.rs, align.rs}
│   ├── cache-core/                 # [Step 9A] 金字塔与原始数据磁盘布局、.raw/.pyr 编解码、mmap 快速切片、状态机
│   │   ├── Cargo.toml
│   │   └── src/{lib.rs, root.rs, dataset.rs, session.rs, manifest.rs, raw.rs, pyr.rs}
│   ├── aim-ffi/                    # [Step 3] AiM DLL 桥接 actor（唯一 unsafe crate，46 个导出函数封装）
│   │   ├── Cargo.toml
│   │   └── src/{lib.rs, actor.rs, dll.rs, ffi.rs}
│   ├── csv-parser/                 # [Step 6] 极速 CSV 解析引擎（mmap、编码探测、方言嗅探、rayon 并行分块）
│   │   ├── Cargo.toml
│   │   └── src/{lib.rs, parse.rs, dialect.rs, encoding.rs}
│   ├── telemetry-store/            # [Step 9A] SQLite 持久化层（元数据、Job 记录、圈速、用户布局、注释）
│   │   ├── Cargo.toml
│   │   └── src/{lib.rs, store.rs, schema.rs, record.rs, comment.rs, layout.rs}
│   ├── telemetry-ipc/              # [Step 4] 前后端通信契约、命令枚举、二进制帧编解码、specta 类型导出
│   │   ├── Cargo.toml
│   │   └── src/{lib.rs, cmd.rs, frame.rs, types.rs}
│   └── migrate-v1/                 # [Step 12] 旧库迁移工具（读取 v1 SQLite 并写入新架构，一次性工具）
│       ├── Cargo.toml
│       └── src/{main.rs, migrate.rs, verify.rs}
│
├── 🖥️ 桌面外壳宿主（src-tauri/，Tauri 胶水层）
│   ├── Cargo.toml                  # 依赖上述业务 crate 与 tauri 2.x
│   ├── tauri.conf.json             # 窗口 1440×900、标题、图标、NSIS 安装包配置、DLL bundle 资源映射
│   ├── capabilities/               # Tauri 2 权限与安全能力声明
│   ├── icons/                      # 应用多尺寸图标集合
│   └── src/
│       ├── main.rs                 # 桌面宿主启动入口
│       ├── state.rs                # AppState 全局状态管理（DashMap 缓存句柄、Job 任务队列）
│       └── commands/               # Tauri Command 路由实现（将请求派发至各 crate）
│
├── 🎨 前端界面与渲染层（src/，纯 React/TS 渲染与交互）
│   ├── main.tsx                    # React 应用挂载入口
│   ├── App.tsx                     # 根组件（dockview 宿主与预设布局装配）
│   ├── index.css                   # 全局样式（注入附录 B.1 令牌 CSS 变量）
│   ├── api/                        # [Step 5] 后端调用门面
│   │   ├── client.ts               # 唯一 invoke 入口与二进制帧解析器（禁止组件直接调 tauri）
│   │   └── types.ts                # 由 specta 自动导出的后端强类型定义
│   ├── state/                      # [Step 5] 全局状态管理
│   │   └── appStore.ts             # zustand 单一状态源（窗口视口、generation、活动通道、Job）
│   ├── plot/                       # [Step 7] uPlot 图表封装与双速渲染
│   │   ├── uPlotFactory.ts         # uPlot 实例构建、X 轴联动配置、主题色同步
│   │   ├── worker.ts               # Web Worker 窗口化数据取帧
│   │   └── compare/                # [Step 14] 对比模式曲线渲染扩展
│   ├── track/                      # [Step 11] GPS 赛道图 Canvas 2D 渲染引擎
│   ├── panels/                     # dockview 面板注册与预设
│   │   └── registry.ts             # [Step 5] 面板注册中心（PANELS 数组）
│   ├── components/                 # UI 视图组件
│   │   ├── AppShell.tsx            # 顶栏 40px、状态栏 24px
│   │   ├── ImportProgressBar.tsx   # [Step 5/B.7] 导入进度条组件
│   │   ├── ChannelTreePanel.tsx    # [Step 8/P1] 通道选择树
│   │   ├── PlotStack.tsx           # [Step 7/P2] 多图堆叠区
│   │   ├── TimelineBar.tsx         # [Step 7/P3] 底部固定时间轴
│   │   ├── LapPanel.tsx            # [Step 10/P4] 圈速分析面板
│   │   ├── StatsPanel.tsx          # [Step 10/P5] 窗口通道统计面板
│   │   ├── TrackMapPanel.tsx       # [Step 11/P6] 赛道轨迹回放面板
│   │   ├── CommentsPanel.tsx       # [Step 11/P7] 时间锚定注释面板
│   │   ├── ComparePanel.tsx        # [Step 14/P9] 双文件对比面板
│   │   └── library/                # [Step 9B/P8] 资料库主页与卡片组件
│   ├── theme/                      # [Step 8] 双主题（深色/浅色）切换驱动
│   └── hooks/                      # 自定义 Hook（useHotkeys 等快捷键驱动）
│
├── 📦 验证资产与硬件依赖（自包含，只读）
│   ├── Data/                       # 实测基准资产（AGX.xrk/csv、Du.xrk/csv、SCUTRacing.ico 等）
│   └── TestMatLabXRK/              # AiM 官方依赖
│       └── 64/                     # 64 位 DLL（MatLabXRK-2022-64-ReleaseU.dll 等）
│
├── 🧪 测试套件与验证夹具（tests/）
│   ├── golden/                     # 真值比对夹具（AGX 速度基准二进制、CSV 元数据 JSON）
│   ├── fixtures/                   # 测试样本（含 v1_library.db 旧库快照）
│   └── e2e/                        # [Step 12] WebdriverIO + tauri-driver 端到端自动化脚本
│
├── 📚 架构文档与契约
│   ├── .agent/                     # 施工手册（本文件唯一执行依据）
│   └── docs/
│       ├── adr/                    # 架构决策记录（0001~0006）
│       └── contracts/              # core-api.md、dependencies.md 依赖白名单
│
├── 🛠️ 工程化脚本（scripts/）
│   ├── check.ps1                   # 六道关 CI 检查脚本（fmt/clippy/test/tsc/eslint/golden）
│   └── bundle-dll.ps1              # 打包时同步 AiM DLL 至产物目录脚本
│
└── 🚀 构建输出（target/，机器自动生成，禁止提交至 Git）
    ├── debug/                      # 开发调试版本
    └── release/                    # 最终优化正式版
        ├── SCUTRacingTelemetry.exe # 主执行文件
        ├── *.dll                   # AiM 官方 DLL 依赖（同目录就绪）
        └── bundle/nsis/            # 最终安装包（SCUTRacingTelemetry_Setup.exe）
```

## 风险登记册（rev.4 更新）

| 风险 | 等级 | 缓解 |
|------|:---:|------|
| 骨架延期阻塞全部 subagent | 高 | 切片范围已砍最小；延期优先保切片 |
| pyramid 协议设计缺陷导致缓存推倒重建 | 中 | ADR-0004 先评审后落码；manifest 版本化，坏了自动重建不致命 |
| subagent 后端调用失败（代理/配额/节点） | 中 | 0.6 流程；升级规则（0.5）；后端可整体替换（C6） |
| subagent 单次无记忆偏离契约 | 中 | 任务卡自包含粘贴契约原文；交叉审 + 契约 diff |
| 中断续建的脏状态 | 中 | Step 9A 测试矩阵强制覆盖；temp 原子改名 |
| 缓存盘满（用户长年不清理） | 低 | D10 可选上限设置 + 清理入口；发布说明引导 |
| DLL 在 200MB 下崩溃 | 低 | D13 证据门：触发则 aim-worker.exe 立项，`open_xrk_laps` 先顶 |
| dockview×uPlot 尺寸同步 | 中 | Step 5 切片内验证 |
| 官方插值 GPS 与 CSV 不一致 | 中 | 双路径交叉校验，以 CSV 为真值，回退 ECEF |
| Webview2 旧系统缺失 | 低 | embedBootstrapper + 启动检测 |

---

*手册 rev.4 冻结于 2026-09-10。进度由负责人掌管；结构性变更走 ADR，不改本文。*
