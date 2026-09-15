# SCUT Racing Telemetry v1.0 施工手册（rev.4 · 性能数据层定稿版）

## 工作进度维护约束（2026-09-11 起）

- **开工前**：阅读 [工作进度](工作进度.md) 的“当前状态”及最近日志，确认当前 Step、已完成边界和剩余事项，再按本手册实施。
- **每次工作结束或交接前**：由主 agent 在该文件末尾的日志区追加一条记录（包括失败、阻塞、仅文档修改），并同步“当前状态”。按模板写明实际工作、涉及文件、验证结果与证据、未完成项和下一步；不把计划写成已完成。
- **记录口径**：保留历史日志，纠错通过新条目说明；历史证据不改写成新结果。进度只在此文件维护，其他文档用链接引用。
- **测试分工**：按负责人要求，所有测试及动态验收通过 agy-staff 执行，主 agent 负责主代码与证据核对。Windows 默认使用 `powershell`；调用失败须记录阻塞，不擅自改为主 agent 跑测试。job 成功不等于验收成功，必须核对实际命令退出码与日志。

> **rev.4.2 开工修订（2026-09-11）**：本文定义新 Tauri v1.0（技术框架仍是 Tauri v2），旧实现称 Python legacy。旧代码只读参考根为 `D:\Desktop\SCUTRacing\code\scut_telemetry\`；读取 `xrk_dll.py`、`models.py`、`parser.py` 和同级 `../tests/`，不修改旧仓库。Gemini 文档是旧行为参考，Rust 公共类型以本文 Step 2 为准；CSV 是物理真值，旧 Python 是兼容性参照，两者不能混为一谈。
>
> **已裁决的边界**：保留 Rust `TelemetryDataset.series`，不复制 Python 的 DataFrame/随机 UUID；缓存身份用源文件 hash，数据库记录 id 按 store 契约。`DerivedGps` 对应旧 `derived:gps_raw`；`ChannelMeta` 补 `dtype: ChannelDType`（Time/Numeric/Flag/Text），文本不进入 f32 数值缓存，须显式报告不支持或保留独立元数据。文件采样率放 `SessionMeta`，单通道采样率放 `ChannelSeries`，不用于重采样。`ImportStage` 定义于 cache-core，IPC 引用它，禁止反向依赖。core 的 export.rs 仅格式化到 `std::io::Write`，文件选择、创建和落盘在 Tauri/应用边界执行。Step 10 新目录 `src/api/analysis/` 为统计/圈速调用适配层。Step 14 包含 ADR-0007，便携包位于 `target/release/bundle/portable/`。
>
> **开工验证而非已通过声明**：Step 1 锁定依赖并编译核查 MSRV；Step 3 按 DLL 实际加载错误检查 VC90 CRT/SxS，Step 14 在干净 Windows x64 验证，不从第三方站下载散装 msvcr90.dll。技能以 `C:\Users\Shen\.agents\skills` 为主源，Codex 缺项才同步；`verification-before-completion` 已存在并已同步，`superpowers` 是流程族称呼，实际入口为 `superpower`/`using-superpowers`。agy 调用以调用手册的 Codex 适配节为准，后台执行尚须独立冒烟验证。
>
> **rev.4.3（2026-09-11）WiFi 设备下载立项**：新增 **Step 13「WiFi 设备下载」**（经记录仪 WiFi 把 .xrk 下载到资料库原始文件目录，Ready 后自动 `StartImport` 入库）；新增冻结决策 **D15**（WiFi 下载 = 文件获取通道，不是 `TelemetrySource`，D4 不变）；新 crate `device-link`（workspace 产品构件 9 个、含 golden-tests 合计 10 个）；**原 Step 13「发布硬化」顺移为 Step 14，原 Step 14「双文件对比」顺移为 Step 15**（全文交叉引用已同步）；新 ADR-0008 于 Step 13 开工前立项。任务编号按立项顺序：WiFi 下载 = T09。

> **用法**：从 Step 1 开始顺序执行。每个 Step 讲清：做什么 → 谁做 → 怎么做 → 先写哪些测试 → 接口 → 验收标准 → 审查重点。
> 文档不规定工期，进度由负责人掌管；步骤顺序是硬约束（标注"可并行"的除外）。
> 文档族： **本文件（唯一执行依据）**。
> rev.4 相对 rev.3 的手术区：新增第 1 章性能数据层（金字塔缓存 + Job 化导入 + 结构不变量）；Step 2/4/5/9/13 相应重写；新增技能映射（0.7）；**附录 B 为自包含完整 UI 设计规范（B.0~B.10），Step 5/7/8/9B/10/11/13/14 内联各步美学规格；全文自包含——执行本手册无需查阅任何前版文档**；协议补全：`StartImportBatch`/`CacheRootStatus` 命令、`channel_building` 错误语义、StartImport 幂等与轮询节奏。
>
> **rev.4.1（2026-09-11）事实性修订**：大文件冒烟样本正式登记为 `Data/test_large.xrk`（AiM 官方 XRK，47,123,474 字节 = 47.12MB；**项目当前无 200MB 级样本**）。D3/D9/D13/第 1.6 节/Step 3/Step 13/风险登记册中「200MB」的表述统一改为以该文件为准；D3 与附录 C 的验证资产清单同步补充。**注意**：D13 证据门的结论强度以 47MB 为上限。
>
> **路径约定（负责人规定）**：代码根目录 = `D:\Desktop\SCUTRacingTelemetry\`；前端源码在 `src/`，Rust 部分按 cargo 惯例放 `src-tauri/` 与 `crates/`；构建产物在 `target/`，最终打包 exe 及全部依赖（AiM DLL 等）输出到 `target/release/`。验证资产统一放 `Data/`。AiM 官方组件统一放 `TestMatLabXRK/`，内部结构固定（见下表，**不可重命名或移动**）。设计文档统一命名 `<软件名>_<时间>_<文档本名>.markdown` 放 `.agent/`。
>
> **AiM 官方组件目录结构**（只读，全部由 AiM 官方提供）：
> ```
> TestMatLabXRK/
> ├── DLL-2022/
> │   └── MatLabXRK-2022-64-ReleaseU.dll    ← 主解析 DLL（8.4MB，唯一要 libloading 加载的文件）
> ├── 64/
> │   ├── libiconv-2.dll                     ← 主 DLL 的运行时依赖（4 个）
> │   ├── libxml2-2.dll                         SetDllDirectoryW 须指向此目录
> │   ├── libz.dll                               使主 DLL 能隐式定位到这些依赖
> │   └── pthreadVC2_x64.dll
> ├── inc/
> │   └── MatLabXRK.h                        ← C 头文件（45 个导出函数的权威签名）
> ├── test.xrk / tesz.xrz                   ← AiM 官方测试样本
> └── TestMatLabXRK-2022.sln + *.cpp/h       ← AiM 官方 C++ 示例工程（参考用，不编译）
> ```

---

## 第 0 章 总则

### 0.1 冻结决策（不再讨论）

| # | 结论 |
|---|------|
| D1 | AI 团队开发：主 agent 写骨架与契约，subagent 写功能模块，负责人检查点验收 |
| D2 | React 18 + TS(strict) + Tailwind 3.4 + dockview 4.x + uPlot 1.6；Rust 1.78+；Tauri 2.x；Vite 6；zustand 5 |
| D3 | Python v1 冻结；验证资产 = `Data/AGX.*`、`Data/Du.*`（两者与 RaceStudio3 导出 CSV 均为真值来源）+ **`Data/test_large.xrk`（大文件冒烟样本，47.12MB）** |
| D4 | 预留 `TelemetrySource` trait，v1.0 只实现文件源 |
| D5 | GPS 赛道图 Canvas 2D 自绘 |
| D6 | CSV/parser 的 golden 真值 = RaceStudio3 官方导出 CSV（不信 Python 版输出）；Step 3 `aim-ffi` 的 DLL 数值 golden 例外使用 AiM 官方 DLL 输出 fixture，二者不混用 |
| D7 | 仅 Windows x64；core crate 与 Tauri 解耦备未来 Web 端 |
| D8 | 旧资料库一次性 ETL 迁移（`migrate-v1`） |
| D9 | 大文件冒烟样本 = **`Data/test_large.xrk`（47.12MB）**：发布前冒烟、D13 证据门、多图表拖放全部以它为准。项目现无 200MB 级样本，故该证据门的结论强度以 47MB 为上限；日后拿到更大文件应登记进本表并重跑 Step 14 |
| C1 | 垂直切片打底 + 挂载点扩展：先主干、后挂载，没有"合并日"只有"验收日" |
| C2 | 骨架与契约由主 agent 独写，subagent 不碰 |
| C3 | GUI 以 v1 为参考重新设计，dockview 承载，默认"分析预设"（附录 B）**（D16 修订：dockview 已移除，改固定三栏可拖调宽布局，见附录 B rev.5）** |
| C4 | 中文 UI；通道名/单位保留英文；深色优先 + 浅色切换 |
| C5 | 双文件对比排最后（Step 15） |
| C6 | **subagent 是角色不是具体产品**：当前由 Antigravity（agy）担任（`gemini-3.8-flash` + `effort=high`，可多实例并行互验），但可随时替换为其他 subagent 后端；调用方式集中在 0.2，正文一律只写 "subagent" |
| **D10** | **缓存策略：原始文件（XRK/CSV）是数据本体，永远保留、永不被软件修改；缓存默认全保留、不设硬上限**；提供手动清理入口（单数据集/全部）与可选上限设置（默认关闭）；缓存永不进入备份/上传范围（衍生品，可重建） |
| **D11** | **导入全部 Job 化**：后台执行、分阶段进度、符合设计风格的进度条、可取消、中断可续建；**点击优先**——用户点开某文件/通道，构建队列立即优先它；元数据与概览尽早可见 |
| **D12** | **性能验收不写数值指标**，改用五条结构不变量 I1~I5（第 1.6 节）+ 最终手感冒烟；理由：结构可审代码，数字要测且为时尚早 |
| **D13** | AiM DLL 进程隔离（aim-worker.exe）**缓行**：先进程内 actor + Job API，Step 14 用 `Data/test_large.xrk`（47.12MB，见 D9）实测裁决——DLL 崩溃/泄漏/无法取消才升级隔离，届时只换 Job 执行后端，接口零变化 |
| **D14** | 技能使用制度化（0.7）：skill 由主 agent 运行，subagent 拿到的是蒸馏后的任务卡 |
| **D15** | **WiFi 设备下载 = 文件获取通道，不是 `TelemetrySource`**（D4 不变）：下载仅把设备上的 .xrk 落盘到资料库原始文件目录，Ready 后壳层自动 `StartImport` 入库（Step 13）；协议细节以负责人反编译规格（`.agent/` 独立规格文档）为唯一依据；真机联调为负责人人工验收项 |
| **D16** | **UI 视觉与布局定稿 = F1 官方风格**（2026-09-15）：`design-demos/08-f1-data-analysis.html`（负责人已审核）+ `design-demos/DESIGN-SPEC.md` 为唯一设计基准，附录 B 重写为 rev.5；**固定三栏可拖调宽布局取代 dockview 自由停靠**（取代 D2 的 dockview 依赖与 C3 的 dockview 承载条款；移除前端 dockview 依赖，`save_layout`/`load_layout` 后端命令保留，预设退化为左右栏显隐+栏宽）；双主题保留并改为 F1 红+黑/红+白；状态栏保留；圈速面板取消；游标交互模型改为"按住拖动、禁 hover 跟随"（B.11）；现存界面由 Step 5R 重构，Step 5 历史 rev.4 验收记录不改写 |

### 0.2 角色与工具

- **主 agent** = WorkBuddy 主会话：骨架、契约、派单、终审、合并、打包；按 0.7 调用技能。
- **subagent** = 承担功能模块开发/交叉评审的角色（C6：角色与实现解耦）。**当前后端 = Antigravity（agy）**，两条调用通道：
  1. **agy-staff 员工角色（任务卡与评审的首选通道）**：`bash ~/.agents/agy-staff/agy.sh <persona> [flags] --prompt "<任务卡>"`
     - 角色映射：**实现类任务卡 → `implement`**（直接改工作区）；**交叉评审 → `review`**；调研 → `research`；快速问答 → `ask`；兜底 → `staffer`；
     - **必须显式传 `--effort high`**（默认按角色区分：ask=low、review/staffer=medium、research/implement=high，不满足"一律 high"的长期指令）；长任务卡用 `--prompt-file`；
     - 后台角色（implement/review/research/staffer）返回 job id，用 `agy.sh wait <job-id> --timeout 20m` 收结果，天然支持多实例并行；追问用 `--conversation <conversation-id>`；
     - **WorkBuddy 沙箱硬限制（实测）**：后台角色必须带 `dangerouslyDisableSandbox: true` 运行（detached 进程与状态锁 rename 在默认沙箱内会被杀/拒绝）；`ask` 是唯一能在默认沙箱跑的；网络由 `agy.sh` 自动走 7897 代理；
     - 任务状态与产物记录在当前仓库 `.agy-staff/` 目录。
  2. **MCP `agy_ask`（同步一问一答备用通道）**：
     ```
     mcp__antigravity__agy_ask(model="gemini-3.8-flash", effort="high",
         add_dir=["D:\\Desktop\\SCUTRacingTelemetry"], timeout=600(Rust)/900(前端))
     ```
     （MCP schema 未含 effort 的过渡期走桥接器 API 直调，效果等价。）
  - subagent 单次执行无对话记忆（agy-staff 可用 `--continue` 续聊），**任务卡仍一律自包含**（0.4 模板），不依赖续聊。
- **负责人** = 人类：掌管进度，在 Step 5/9/14 检查点验收；性能最终由负责人在 Step 14 手感验收（D12）。

### 0.3 编码铁律（CI 强制）

1. 先写失败测试再写实现（没看红不写码）；
2. 只写本 Step 的 allowed paths；契约文件只读，改契约提 ADR；
3. Rust 库代码禁 `unwrap`/`panic!`；TS 禁 `any`，strict 模式；
4. `unsafe` 只许在 `aim-ffi`，每块 ≤10 行附 `// SAFETY:`；
5. 单文件 ≤400 行（测试 ≤600 行），超限需 ADR 豁免；
6. 时间戳 `f64`、物理量 `f32`；
7. 类型只从契约层 import，禁止重复定义；
8. 新依赖必须进 `.agent/contracts/dependencies.md` 白名单；
9. **全量数据不出 Rust 边界**；交互路径只走 pyramid（I1/I4）；
10. 原始文件只读，永不写回（D10）。

### 0.4 subagent 任务卡 prompt 模板

```
[角色] 你是 SCUT Racing Telemetry v1 的模块开发 subagent，负责 <模块>。
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
2. 交叉审：另一个 subagent 实例读任务卡 + git diff（当前经 `agy-staff review` 角色），输出 PASS 或 ISSUES（Critical/Major/Minor）；
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
| 派实现类任务卡 | `agy-staff implement`（当前后端） | subagent 直接改工作区；卡内容按 0.4 |
| 派交叉评审 | `agy-staff review`（当前后端） | 对接 0.5 第 2 级 |
| 派调研/问答 | `agy-staff research` / `agy-staff ask`（当前后端） | 注意 `agy-staff ask` 外的角色须关沙箱（0.2） |

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
- **容量账**：每通道 raw = 12n 字节；pyramid 各级几何求和 ≈ 16n；合计 ≈ 28n/通道。150 通道 × 200 万点的极端文件 ≈ 8.4GB——**默认全保留（D10），空间不设限**；
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

五条的逻辑保证：I1~I5 全过，卡顿在数学上不可能发生；Step 14 只做手感冒烟（`Data/test_large.xrk` + 多图表拖放，负责人手感裁决）+ 内存观察，不测帧率数字。

---

## Step 1：仓库地基（M0）

**做什么**：建立工程根目录 monorepo 骨架、CI 检查链、契约目录。交付：可启动的空白 Tauri 窗口 + 全绿检查脚本。
**执行者**：主 agent（开工前调 `superpowers` 确认流程）。

**怎么做**：
1. 建目录拓扑（附录 C），初始化 cargo workspace（8 个业务 crate 空壳：`telemetry-core`/`cache-core`/`aim-ffi`/`csv-parser`/`telemetry-store`/`telemetry-ipc`/`migrate-v1`/`device-link` + `src-tauri` 壳，产品 members 共 9 个，另纳入 tests/golden-tests 验证 crate，workspace 合计 10 个；`cache-core` 独立成 crate 以便未来 Web 端复用，见 Step 9A；`device-link` 见 Step 13 / rev.4.3）与 pnpm workspace；
2. 根 `Cargo.toml` 统一 `[workspace.dependencies]`（serde 1、thiserror 2、specta 2.0-rc、rusqlite 0.32、libloading 0.8、memmap2 0.9、rayon 1.10、fast-float 0.2、rustfft 6、dashmap 6、tauri 2）；
3. `tests/tooling/check.ps1` 六道关：rustfmt → clippy `-D warnings` → cargo test → tsc → eslint `--max-warnings 0` → golden 套件（`cargo test -p golden-tests`）；
4. `.agent/adr/`：0001 总架构 / 0002 IPC 协议（含 Job API）/ 0003 SoA 模型 / **0004 金字塔缓存协议（scb-pyr v1 + 磁盘布局 + 状态机）** / 0005 测试策略 / **0006 缓存保留与备份策略（D10）** / **0007 便携分发与 D13 证据门**；
5. `.agent/contracts/dependencies.md` 白名单初始化（Rust 侧见第 2 条 + 前端侧与 D2 一致：react 18、react-dom、dockview 4.x、uplot 1.6、zustand 5、tailwind 3.4、vite 6、typescript、eslint、vitest）；
6. `pnpm dev` 空白窗口截图存档。

**接口**（冻结：依赖方向，CI 强制）：
```
telemetry-core  （叶子，禁依赖 tauri 与任何业务 crate）
cache-core      → telemetry-core        （金字塔/缓存格式/状态机，无桌面依赖）
aim-ffi         → telemetry-core
csv-parser      → telemetry-core
device-link     → telemetry-core        （Step 13，WiFi 下载协议状态机，无桌面依赖）
telemetry-store → telemetry-core, cache-core（SQLite + Job 记录 + 缓存索引）
telemetry-ipc   → telemetry-core, telemetry-store, cache-core
src-tauri       → 以上全部（薄壳，禁业务逻辑）
前端 src/       → 后端只经 src/api/client.ts
```

**验收标准**：
- [ ] `pnpm dev` 空白窗口启动（截图）；`tests/tooling/check.ps1` 全绿
- [ ] ADR 0001~0007 齐；白名单生效（故意加违规依赖被拦下的证明）；依赖方向检查生效（故意加一条跨层依赖被 CI 拦下的证明）

**审查重点**：ADR 只写决策与理由；check.ps1 真串了六道关。

---

## Step 2：核心数据模型与算法（telemetry-core）

**做什么**：全系统唯一内存数据模型 + 全部纯算法，**含金字塔构建与查询**。交付：crate 测试全绿。
**执行者**：主 agent（TDD）。

**怎么做**：
1. 先写测试（每个算法至少一个"已知输入→已知输出"）：
   - 既有：`ChannelSeries` 行为、ECEF 参考点、匀速积分、统计已知分布、`rmse_and_corr` 恒等/反相；
   - **新增 pyramid**：20 点手工序列 → 构建后断言各层桶数与 (time,min,max) 精确值；不规则时间戳序列分层正确；`query_pyramid` 按像素选层正确（窗口大→粗层，窗口小→raw）；尖峰点必然出现在某层 min 或 max 中（包络不丢）；
2. 实现 `models.rs` / `downsample.rs` / `pyramid.rs` / `gps.rs` / `stats.rs`；`align.rs` 只签名（Step 15 补齐）；
3. pub 项全 doc comment，示例进 `cargo test --doc`；
4. 铁律核查：无 `unwrap`、无 `std::fs`、无 tauri 依赖。

**接口**（冻结，全文；同时复制进 `.agent/contracts/core-api.md`）：

```rust
pub type DatasetId = u64;

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize, specta::Type)]
pub enum ChannelSource { Standard, Gps, GpsRaw, DerivedGps, DerivedCalc, Csv }

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize, specta::Type)]
pub enum ChannelDType { Time, Numeric, Flag, Text }

pub struct ChannelMeta {
    pub dtype: ChannelDType,
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

/// D4：实时数传预留。v1.0 只有 XRK/CSV 两个文件实现。
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

// align.rs（Step 15 前只签名）
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
   - 连续打开/关闭 50 次 → 句柄计数不增长（用进程句柄数与测试包装层的 open/close 配对计数断言；`library_test_on_open_files()` 仅返回诊断字符串，不作数值计数）；
   - **golden 用例**：以 AiM DLL 的官方 GPS 插值通道 `GPS Speed (AiM Interpolated)` 作为 Step 3 真值；读取 `AGX.xrk` 的该通道，与固定的官方输出 fixture 逐点相对误差 ≤1e-4。`AGX.csv` 仅用于 CSV 元数据资产校验，不作为 DLL 数值真值；
2. 实现 `AimDll`（内部 struct，`!Send + !Sync`）：
   - **加载顺序**（两步，顺序不可颠倒）：
     ① `SetDllDirectoryW` 指向**依赖目录** `TestMatLabXRK/64/`（使主 DLL 能隐式找到 libxml2/libiconv/libz/pthreadVC2）；
     ② `libloading::Library::new` 加载**主 DLL** `TestMatLabXRK/DLL-2022/MatLabXRK-2022-64-ReleaseU.dll`；
     **注意**：主 DLL 和依赖 DLL 分属两个目录，不可混淆；
   - 45 个导出签名（附录 A），字符串参数 `*const c_char`（mbcs 编码，与 v1 一致）；
   - **数据类型注意**：DLL 所有采样函数（`get_channel_samples` / `get_GPS_channel_samples` 等）的 `ptimes` 和 `pvalues` 参数均为 `double*`（C `double` = Rust `f64`）；写入 `ChannelSeries.values: Vec<f32>` 时需做 `f64 as f32` 有损转换（精度对遥测数据足够），`times: Vec<f64>` 则直接存；
3. 实现 `AimActor`：单线程 + `std::sync::mpsc`，所有 DLL 调用封装成消息排队执行；`open_xrk` 返回 `Future`（内部 oneshot 回传）；
4. 解析流程（对齐 v1 行为）：`open_file` → `get_session_duration`（为 0 时用 laps 推算）→ `get_channels_count` 族读标准通道；`get_GPS_raw_channel_*` 读取原始 GPS 并按旧代码 ECEF 派生；同时保留 AiM 官方 GPS 插值通道，并标记为 `GPS (AiM Interpolated)` 诊断来源，不用同名通道静默覆盖派生结果；由 raw 派生的 `GPS Speed` 积分派生 `Distance on GPS Speed`；通道时间戳排序一次（铁律）；
5. golden fixture 生成（一次性）：从 AiM DLL 读取 `AGX.xrk` 的 `GPS Speed (AiM Interpolated)` 官方输出 → 存 `tests/golden/agx_speed.bin`（f64×2 序列 + sha256）；Step 3 测试加载并逐点比对。另产出 `tests/golden/agx_csv_meta.json`（由 `AGX.csv` 生成的通道名/单位/采样率清单，供 Step 6 的 CSV 元数据 golden 用例消费），但该 CSV fixture 不参与 Step 3 DLL 数值真值判定。

**接口**（冻结）：

```rust
pub struct AimActor { /* mpsc::Sender + JoinHandle，私有 */ }

impl AimActor {
    /// 启动 actor 线程并加载 DLL。
    /// `dll_path` = 主 DLL 路径（如 `TestMatLabXRK/DLL-2022/MatLabXRK-2022-64-ReleaseU.dll`）；
    /// 内部自动以 `dll_path` 的兄弟目录 `../64/` 调 `SetDllDirectoryW` 注入依赖搜索路径。
    pub fn spawn(dll_path: &std::path::Path) -> Result<Self, TelemetryError>;

    /// 打开 XRK/XRZ 并解析为 TelemetryDataset。
    /// GPS 从 gps_raw ECEF 派生（调 telemetry_core::gps），保留独立时间轴。
    pub fn open_xrk(&self, path: std::path::PathBuf)
        -> impl std::future::Future<Output = Result<TelemetryDataset, TelemetryError>> + Send;

    /// 分段备用：只读指定圈（get_lap_channel_samples 族），大文件（`Data/test_large.xrk` 量级）整读失败时降级用（D13 证据门若触发也靠它先顶着）。
    pub fn open_xrk_laps(&self, path: std::path::PathBuf, laps: Vec<u32>)
        -> impl std::future::Future<Output = Result<TelemetryDataset, TelemetryError>> + Send;
}
impl Drop for AimActor { /* close_file_i + 通知线程退出 + join */ }

// 内部（不导出）：struct AimDll —— 45 个 extern 签名（附录 A），仅存在 actor 线程。
```

**验收标准**：
- [ ] golden：AGX 的 AiM 官方 `GPS Speed (AiM Interpolated)` 输出与固定 fixture 误差 ≤1e-4；Du 至少完成加载与通道存在性验证
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
    EstimateOffset { id_a: u64, id_b: u64, channel: String, start: f64, end: f64 }, // Step 15
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
- **前端导入-打开闭环**：`StartImport` 返回 `JobId` → 轮询 `ImportStatus` 获取 `file_hash`（`meta_ready` 为 true 时即可用）→ 用 `file_hash` 调 `OpenDataset` 拿到 `DatasetMeta` → 后续 `WindowSeries`/`CursorValues` 用 `DatasetMeta` 中的 `id`；
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
2. 实现：`api/client.ts`（按 Step 4 新命令全文）；`state/appStore.ts`（增加 `generation`、`importJobs`）；`plot/uPlotFactory.ts`（多图 X 联动 sync key 固定 `scut`）；`components/ImportProgressBar.tsx`（附录 B.7）；`AppShell` / `PlotStack` / `TimelineBar` 占位；
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
export function estimateOffset(idA: number, idB: number, channel: string, start: number, end: number): Promise<number> // Step 15
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
- [ ] vitest 全绿；`tests/tooling/check` 全绿
- [ ] **点击优先实测**：导入大文件途中勾选某通道，该通道构建被插队（日志/状态证明）

**审查重点**：generation 丢弃逻辑；进度条是否走令牌（无硬编码色）。

---

## Step 5R：F1 视觉定稿重构（D16 溯源回补）— 主 agent

**做什么**：现存前端壳按附录 B rev.5 重构，作为 Step 6+ 全部前端工作的新基线。Step 5 历史 rev.4 验收记录不改写；本步只重构视觉/布局/交互，不动后端协议。
**执行者**：主 agent（骨架与契约自写，C2）；负责人检查点验收。
**阶段**（每轮跑 `pnpm typecheck && pnpm lint && pnpm test`，全轮毕跑 `tests/tooling/check.ps1`）：
1. **R1 令牌层**：字体资产拷入 `src/assets/fonts/` + `@font-face`；`src/theme/tokens.css` 按 B.1 重写双主题（含 rev.4 旧 token 兼容别名过渡）；`src/theme/channelColors.ts` 通道固定色板 + SPEED 前景色派生 + 保留池分配；
2. **R2 壳层**：AppShell 重写（54px 顶栏 + 2px 红分隔线、logo 斜切红块、ghost/主按钮、状态灯）；固定三栏 Grid + 两条拖宽分割条（store 新增 `leftWidth`/`rightWidth`，范围按 B.2）；状态栏保留 F1 化；移除 dockview 依赖（D16），registry 面板组件架构保留、改挂固定容器；左栏 = 文件卡片（B.4-P1 上半）+ 通道列表；
3. **R3 中栏**：PlotStack 多通道堆叠（每勾选通道一图 `flex:1` 均分、图间 1px 分隔、左上图例）；游标模型 B.11（按住拖动、禁 hover 跟随）；滚轮焦点缩放 ×1.18；TimelineBar 移入中栏底部 110px（`--bg2` 底、红窗口框、窗口跟手平移，重写 `calculateTimelinePan` 与其单测）；
4. **R4 右栏**：赛道图 300px（白管赛道 + 红色车箭头 + 尾迹 + HUD + 缩放钮，B.4-P6，无 GPS 空态）；通道详情卡（原 StatsPanel 改造：F1 Display 24px 当前值 + MIN/MAX/AVG 全程统计三格，经 `Stats`/`CursorValues` 命令，B.4-P5）；registry 移除 laps 面板（P4 取消）、comments 默认隐藏（预设可开）；
5. **R5 播放**：顶栏 PLAY/PAUSE + 0.05s/帧游标推进（窗口内循环）+ 空格快捷键 + `CursorValues` 节流合并（B.9）。
**UI 规格**：全部按附录 B rev.5 与 `design-demos/DESIGN-SPEC.md` 逐条落地；走查 B.10（重点第 3 条双主题、第 4 条红色边界）。
**验收标准**：
- [ ] 真实 AGX 导入 → 勾选多通道 → 堆叠出图 → 拖动游标 → 滚轮缩放 → 时间轴平移全程手感冒烟；
- [ ] 双主题切换无残留截图归档；红色边界合规自查表；
- [ ] 现有 vitest 全绿（涉及 hover 游标/时间轴平移/旧 token 的断言按 B.11 与 B.1 调整）；`tests/tooling/check.ps1` 全绿。
**边界**：资料库主页（P8）、批注（P7）、对比（P9）不在本步；通道详情统计走既有 `Stats` 命令（全程口径 = start=0/end=duration），不改后端接口。

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
- 交互全集（按 B.11 定稿；rev.4 的框选缩放与 hover 十字线废止）：图表区按住拖动 = 移动全局数据游标（按下即跳、实时跟随、松手停留）；滚轮 = 以鼠标横向位置为焦点缩放时间窗（×1.18/÷1.18，最小 2s、最大全程）；左轴上滚轮 = 该图 Y 独立缩放、双击复位保留；游标虚线/交点/图例当前值随游标刷新（rAF 节流，**直接写 DOM 不经 React 重渲染**）；拖图标题调图序（写回 `channelOrder`）；三态按附录 B.4-P2/P3 实现，走查单 = B.4 的事件清单逐项。

**UI 规格（本步，引用附录 B）**：
- 坐标轴/网格/曲线线宽/阶跃对齐按 B.5 落地参数；**min/max 包络两档渲染**（正常 band 12% 填充 + 上下缘线；交互期降级中线 1px，停手恢复）——这既是 I4 性能行为也是视觉验收项；
- 数据游标线/游标交点/左上图例样式按 B.5（游标虚线、图例容器、tabular-nums 瞬时值不抖）；
- 时间轴视觉按 B.4-P3（缩略曲线配色、窗口框/手柄/框外遮罩；圈刻标随 P4 取消），且位于**中栏底部 110px**（非壳层底部），平移为窗口跟手（B.11）；
- 图标题栏与「构建中」占位按 B.4-P2；
- 走查：B.10 第 1/3/4/5 条。

**接口**（Worker 协议 rev.4 版）：
```ts
export type WorkerIn  = { type:'window'; reqId:number; generation:number; id:number;
                          channel:string; start:number; end:number; pixels:number }
export type WorkerOut = { type:'frame'; reqId:number; generation:number; frame:WindowFrame }
                      | { type:'error'; reqId:number; code:string; message:string }
// generation 不一致即丢弃；同 channel 同 generation 内只保留最新 reqId。
// code='channel_building' → 显示"构建中"占位 + 调 PrioritizeImport；其他 code → 显示错误红框。
```

**验收标准**：
- [ ] 长记录（样例由负责人提供）4 图拖放：交互全程不读 raw 全量（日志断言）、过期帧全被丢弃（vitest）
- [ ] P2/P3 走查单全过；三级验收通过
- [ ] **不写帧率数字**——由 Step 14 负责人手感验收（D12）

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
- 通道树视觉按 B.4-P1 rev.5（行 = checkbox 14×14 + 3px 色条 + Titillium 700 12px 通道名 + 单位；选中 = `--bg2` 底 + 3px `--red` 左边条；组头与 sticky 搜索保留）；文件卡片位于左栏上部（RATE/LAPS/SIZE chips 与紫色最快圈；圈速面板已取消，P4）；
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
    pub fn begin_import(&self, source: &Path, identity: SourceIdentity) -> Result<(ImportSession, tokio::sync::mpsc::Receiver<ImportProgress>), CacheError>;
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

pub struct ImportSession { /* 构建器：写 temp → 原子改名 → 更新 manifest 状态；持有 progress_tx 报告进度 */ }
impl ImportSession {
    pub fn write_meta(&mut self, meta: &SessionMeta, channels: &[ChannelMeta]) -> Result<(), CacheError>;
    pub fn write_channel(&mut self, key: &str, series: &ChannelSeries) -> Result<(), CacheError>; // 内部同步建 pyramid
    pub fn write_laps(&mut self, laps: &[LapInfo]) -> Result<(), CacheError>;
    pub fn finish(self) -> Result<DatasetCache, CacheError>;
    pub fn abort(self);  // 清理 temp，状态回滚
}

/// 构建进度事件（由 ImportSession 在每个阶段推送，壳层据此填充 ImportStatus.progress）
#[derive(Clone, Debug)]
pub enum ImportProgress {
    Stage(ImportStage),                  // 阶段切换
    ChannelDone { index: usize, total: usize }, // 第 index 个通道完成（按通道加权进度 = index/total）
}
/// `CacheRoot::begin_import` 返回 `(ImportSession, tokio::sync::mpsc::Receiver<ImportProgress>)`，
/// 壳层在 tokio 任务中消费 receiver 并更新 `ImportStatus.progress`。

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

**做什么**：通道详情面板（B.4-P5 rev.5；圈速面板 P4 已取消，D16）。
**执行者**：subagent；allowed paths = `src/api/analysis/`、`src/components/StatsPanel.tsx`（改造为通道详情卡列表）。

**派单要点**：
- 粘贴契约：Step 2 的 `stats.rs` + Step 4 的 `Stats`/`CursorValues` 命令 + 附录 B.4-P5（`Laps` 命令保留给文件卡片 chips 与未来对比模式，不在本步 UI）；
- 必须先写的失败测试：全程统计请求参数组装（start=0/end=duration）；详情卡随勾选通道增删；当前值随游标刷新（节流）；
- 实现要求：统计经 `Stats` 命令在 **Rust 侧全分辨率**计算（不传原始数组到前端再算 = Critical）；**MIN/MAX/AVG 为全程口径**（非窗口内），300ms 防抖取消失效请求；当前值经 `CursorValues` 随游标实时更新；数值 tabular-nums。

**UI 规格（本步，引用附录 B）**：详情卡按 B.4-P5（3×12 通道色条标题行、F1 Display 700 24px 当前值、MIN 绿/MAX 红/AVG 白三格 `--bg2` 底、**全程统计**）。走查：B.10 第 1/4/5 条。

**验收**：统计值与 golden 参考矩阵（由 AGX.csv 预算出）容差 1e-4；长任务期间 UI 可交互（实测证明）；三级验收通过。

**审查重点**：统计是否在 Rust 侧算；防抖是否取消过期请求。

---

## Step 11（T06，可并行组 B）：赛道图 + 导出 — 派 subagent

**做什么**：GPS 赛道图（B.4-P6）与 CSV/PNG 导出；注释面板（P7，可裁）。
**执行者**：subagent；allowed paths = `src/track/`、`crates/telemetry-core/src/export.rs`、`src/components/TrackMapPanel.tsx`、`src/components/CommentsPanel.tsx`。

**派单要点**：
- 粘贴契约：Step 2 的 `gps.rs` + Step 4 的 `ExportCsv` 命令 + 附录 B.4-P6/P7；
- 必须先写的失败测试：经纬度→本地平面投影（等比、居中、留边距）；速度→热力色带映射边界值；导出 CSV 的表头/单位行/时间格式与 v1 `parser.py` 输出逐字节对比（RaceStudio3 兼容）；
- 实现要求：Canvas 2D；白管赛道渲染（外描/内描双层，B.4-P6）；红色车箭头随 `cursorT` 联动 + 尾迹 + HUD；等比缩放+平移（滚轮缩放、拖拽平移、26×26 缩放钮）；Speed 热力着色实现为可选开关（默认关，B.4-P6）；无 GPS 通道显示占位文案；导出 CSV 必须能被 RaceStudio3 打开（人工确认项）；PNG 导出 = 当前图表区截图；
- rev.4 增量：轨迹数据经 `read_window_frame` 取 pyramid 层（GPS 通道也在塔内）。

**接口**：无新增（`export.rs` 为 telemetry-core 内部新文件，对外仍走 `ExportCsv` 命令）。

**UI 规格（本步，引用附录 B）**：赛道图按 B.4-P6 rev.5（白管赛道 = 外描 `--text` 90% 7px + 内描 `--bg` 4px；红色起终点线 3×16px；红色车箭头随游标 + 白 35% 尾迹 + HUD（T·CROSSTIME/SPEED）+ 右上纵排 26×26 缩放钮；弯道编号无数据源不绘制；无 GPS 空态文案；等比投影按纬度修正）；导出 PNG = 当前画布原样截图，不做额外排版。走查：B.10 第 1/3/4 条。

**验收**：轨迹渲染与 golden 截图对比像素容差 2% 内；导出 CSV 被 RaceStudio3 成功打开（人工确认截图）；三级验收通过。

**审查重点**：投影是否等比（经纬度直接当 x/y 会变形，需按纬度修正）；导出浮点格式与 v1 一致性。

---

## Step 12（T07）：迁移工具 + e2e — 派 subagent

**做什么**：`migrate-v1`（v1 Python 版 SQLite → JSON → 新库）与端到端冒烟测试。
**执行者**：subagent；allowed paths = `crates/migrate-v1/`、`tests/e2e/`。

**派单要点**：
- 粘贴契约：Step 9A 的 schema 与 `Store` API；
- 迁移流程：读 v1 库（只读模式打开，绝不写回）→ 导出 JSON 中间件 → 写入新 schema；输出对账单（v1 记录数、v1 记录数、注释数、不一致明细）；工具一次性使用，不进主程序；
- e2e（WebdriverIO + tauri 驱动）路径：启动 → 导入 AGX（等进度条 Ready）→ 打开 → 勾 Speed → 缩放 → 导出 CSV 到临时目录 → 断言文件存在且非空；另加一条：导入途中取消 → 再导入 → 能续建或干净重来；
- v1 库测试资产位置 = `tests/fixtures/v1_library.db`（由原 Python 工程 `code/library/library.db` 快照导入，只读模式打开，绝不写回）；e2e 依赖（WebdriverIO + tauri-driver）必须进 `.agent/contracts/dependencies.md` 白名单并注明理由（0.3-8）。

**验收**：迁移对账单：记录数/注释数一致（或差异有逐条解释）；e2e 冒烟全绿；三级验收通过。

**审查重点**：v1 库只读（绝不写回）；e2e 不追求覆盖率，只保主路径。

---

## Step 13（T09）：WiFi 设备下载 —— rev.4.3 新增

**做什么**：经 AiM 记录仪的 WiFi 通道（RS3 同款链路）把设备上的 .xrk 下载到资料库原始文件目录，**下载完成自动 `StartImport` 入库**（D15）。用户视角闭环：资料库「从设备下载」→ 选设备 → 选文件 → 下载进度条（B.7）→ 导入进度条（B.7）→ 记录卡片自动出现。
**执行者**：主 agent 写 IPC 增量契约与下载→导入串联（C2）；subagent 实现 `device-link` crate 与设备 UI；**真机联调 = 负责人人工验收项**。
**前置**：Step 4（IPC）、Step 9A/9B（导入管线与资料库）已合并；设备协议细节以负责人反编译规格（`.agent/` 独立规格文档，冻结后引用）为唯一依据，本文不复制协议字段。

**派单要点**（subagent 部分，按 0.4 模板）：
- allowed paths = `crates/device-link/`、`src/components/device/`、`src/components/library/`（仅加「从设备下载」入口，最小 diff）；契约文件（`telemetry-ipc/`、`src-tauri/` 串联）只读，由主 agent 写；
- 粘贴契约：本步接口块全文 + Step 4 的 `Request`/`ImportStatus` 枚举 + 附录 B.3 对话框规范 + B.4-P8 + B.7；
- 必须先写的失败测试：即「怎么做」第 1 条全部用例，先跑红再实现；
- 交付证据：验收命令输出 + mock 设备联调录屏 + 修改文件清单 + 阻塞问题。

**怎么做**：
1. 先写测试（全部打 mock 设备，不依赖真机）：
   - 协议帧编解码往返；坏校验/未知响应 → 显式报错，**绝不写入半成品**；
   - 断点续传：下载 60% 断开 → 重连按字节 offset 续传，最终文件 sha256 与源端一致；
   - 取消：下载中 `CancelDeviceDownload` → temp 清理，目标目录无半成品；
   - 串联：`StartDeviceDownload` Ready → 自动触发 `StartImport` → `ImportStatus` 推进 → records 新增一行（`stored_path` = 下载目录）；Failed/Cancelled **不**触发导入；
   - 重复下载同一远程文件 → `StartImport` 幂等命中（同 hash 立即 Ready，不重建缓存）；
2. 实现 `device-link` crate（纯逻辑：禁 tauri；**禁 `std::fs` 直写最终目录**——写 temp 后原子改名）：
   - `DeviceTransport` trait 抽象传输层（真机 = tokio TCP，测试 = 内存 mock），协议状态机与传输解耦；
   - 设备发现、握手、远程文件列表、分块下载 + offset 续传（协议字段以反编译规格为准）；
3. IPC 增量（主 agent，ADR-0008 立项后落码）：见本步接口块；
4. 串联（src-tauri 壳层编排）：`StartDeviceDownload` 的 Job 到 Ready → 壳层内部调 `StartImport(下载路径)`；前端只渲染两条 B.7 进度条（下载→导入），无需自行判断；
   - **导入即建档**：`StartImport` Ready 时 `upsert_record`——手动导入与设备下载共用同一条建档路径（若 Step 9A 实现未含此行为，本步由主 agent 一并补齐，Step 9 正文不改）；
   - 下载落盘目录 = 资料库原始文件目录（`records.stored_path` 约定；若 Step 9A 未冻结该目录，本步由主 agent 冻结为可配置项，默认 `%USERPROFILE%/Documents/SCUTRacingTelemetry/Library/`）；
5. UI：资料库 P8 导入区加第四项「从设备下载」（与 多选/文件夹/递归 并列，附录 B.4-P8 已同步）+ 设备选择对话框（B.3 对话框规范）：
   - 扫描中 = 骨架条；未发现设备 = 空态「未找到记录仪，确认电脑与设备接入同一 WiFi」+ 重试按钮；
   - 文件列表 = 名称/日期/大小，多选；下载与导入进度均走 B.7；完成后 `ListRecords` 刷新，卡片自动出现。

**接口**（冻结增量；依赖方向 `device-link → telemetry-core` 已并入 Step 1 契约块）：

```rust
// device-link（新 crate，纯逻辑，零 tauri 依赖）
pub struct DeviceInfo { pub name: String, pub model: String, pub addr: String }
pub struct RemoteFile { pub name: String, pub size: u64, pub recorded_at: String }

/// 传输抽象：真机 = tokio TCP，测试 = 内存 mock。协议状态机只依赖本 trait。
pub trait DeviceTransport: Send + Sync { /* connect / send / recv / close */ }

pub struct DeviceClient { /* 协议状态机，私有 */ }
impl DeviceClient {
    pub fn scan(timeout: std::time::Duration) -> Result<Vec<DeviceInfo>, DeviceError>;
    pub fn connect(dev: &DeviceInfo, transport: std::sync::Arc<dyn DeviceTransport>) -> Result<Self, DeviceError>;
    pub fn list_files(&mut self) -> Result<Vec<RemoteFile>, DeviceError>;
    /// 分块下载到 dest_temp（调用方负责校验与原子改名）；
    /// resume_from = 已收字节数；progress 回调已收总字节，返回最终字节数。
    pub fn download(&mut self, file: &RemoteFile, dest_temp: &std::path::Path,
                    resume_from: u64, progress: impl FnMut(u64)) -> Result<u64, DeviceError>;
}

#[derive(Debug, thiserror::Error)]
pub enum DeviceError { /* Io(#[from] std::io::Error), Protocol(String), Checksum, NotFound, Cancelled */ }
```

```rust
// telemetry-ipc：Request 增量（ADR-0008 生效后并入 Step 4 枚举）
ScanDevices,                                                            // → Vec<DeviceInfo>
ListDeviceFiles { device_addr: String },                                // → Vec<RemoteFile>
StartDeviceDownload { device_addr: String, remote_names: Vec<String> }, // → JobId；Ready 后壳层自动 StartImport
CancelDeviceDownload { job_id: u64 },
DeviceDownloadStatus { job_id: u64 },                                   // → DownloadStatus
// DownloadStatus 形状复用 ImportStatus：
// stage = Scanning | Downloading | Importing | Ready | Failed | Cancelled；progress 0..1 按字节加权
```

**验收标准**：
- [ ] mock 设备全链路测试绿（发现/列表/下载/续传/取消/校验/自动入库/幂等重下）
- [ ] **真机联调（负责人签字式确认）**：与记录仪同网 → 设备列表正确 → 下载一份已知 .xrk → 与 RS3 下载的同一文件 sha256 一致 → 资料库卡片自动出现且可正常打开出图
- [ ] D10 核查：下载件落资料库原始文件目录而非缓存根；缓存根内无原始文件副本
- [ ] 三级验收通过；B.10 第 1/2 条走查（对话框三态截图归档）

**审查重点**：下载是否只写 temp 再原子改名；断点 offset 按字节校验而非按文件名猜测；串联只在 `DownloadStatus=Ready` 后触发；`device-link` 确实零 tauri 依赖；**法律边界——仅限自有设备与自有数据的互操作，不复制 RS3 专有代码与授权逻辑，官方公开接口可用时优先**。

---

## Step 14：发布硬化 — 主 agent（负责人验收）

**做什么**：压测冒烟、打包、离线验证、D13 证据门裁决。交付：发布候选。

**怎么做**：
1. **大文件样本冒烟**（样本 = `Data/test_large.xrk`，47.12MB，见 D9；D12：不测帧率，只做三项）：
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

## Step 15（T08，最后）：双文件对比 — 派 subagent

**做什么**：B 文件加载、手动/自动（FFT）对齐、对比视图与预设（B.4-P9）。**故意排最后：只依赖已冻结契约，不反向影响主干。**
**执行者**：subagent（1~2 实例）；allowed paths = `src/components/ComparePanel.tsx`、`src/plot/compare/`、`crates/telemetry-core/src/align.rs`。

**派单要点**：
- 粘贴契约：Step 2 的 `estimate_offset` + Step 4 的 `EstimateOffset` 命令 + 附录 B.4-P9 + B.5 对比模式段；
- 必须先写的失败测试：合成信号（已知偏移 0.37s 的两条正弦+噪声，**样例由负责人提供**）FFT 估计误差 <1 采样间隔；窗口不含重叠段时的报错路径；
- 实现要求：顶栏「对比模式」进入；B 文件选择器（复用资料库记录）；偏移量显示 + 手动微调（±0.001s 步进按钮与直接输入）；「自动对齐」按钮（选通道，默认 GPS Speed）；叠图/分图开关；对比预设可保存恢复（复用 layouts 表）；B 数据集曲线虚线渲染 + 色板 +4 偏移（B.5）；数据通路同走 pyramid。

**UI 规格（本步，引用附录 B）**：对比模式视觉按 B.4-P9 与 B.5——A/B 标识（3×12 红实条/红空心条）、B 曲线 `dash [6,4]` 1.25px 同通道色（rev.5 废止 +4 偏移轮转）、偏移量等宽显示与 24×24 微调钮、叠图/分图分段控件；**暗色主题下虚线可读性为人工确认项**。走查：B.10 第 1/3/4 条。

**验收**：AGX vs Du 对齐结果与 v1 行为容差内一致（并排截图）；对比预设保存/恢复正确；三级验收通过。

**审查重点**：FFT 前是否做了重采样对齐（两通道采样率不同时）。

---

## 附录 A：AiM DLL 导出清单（45 个，实测枚举）

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
set_GPS_sample_freq, get_logger_id, library_test_on_open_files, get_library_date, get_library_time,
get_device_id, get_number_of_devices
```

## 附录 B：UI 设计规范（rev.5 · F1 官方风格定稿版，唯一美学依据）

> 本附录是全部 UI 工作的唯一美学依据。**设计基准 = `design-demos/08-f1-data-analysis.html`（负责人已审核 demo）+ `design-demos/DESIGN-SPEC.md`（含 2026-09-15 第 9 节落地决策）**；正文与 demo 冲突时以 DESIGN-SPEC 第 9 节为准。rev.4 的蓝色系令牌、dockview 自由停靠布局、hover 十字线交互全部废止；Step 5 曾按 rev.4 验收的历史记录不改写，现存界面由 Step 5R 按本附录重构（D16）。

### B.0 设计原则

1. **F1 官方风格**：深黑底、硬朗几何、斜切点缀、宽扁大写标题；浅色主题为红+白（推导规则见 B.1）；
2. **克制（硬规则）**：全页黑白灰为主，红色是唯一主色且只出现在 B.1 红色边界清单内的位置；无大面积彩色、无渐变、无阴影堆砌；
3. **Display 字体只给重点**：字符少且重要的位置（比赛名/文件名/详情当前值大数字）用 Formula1 Display Bold，其余一切用 Titillium；满屏 Display = 花哨；
4. **数据密度优先**：屏幕 ≥90% 给数据，≤10% 给 chrome；任何"为了好看"牺牲信息密度的设计一律打回；
5. **通道固定色板**：色条 → 曲线 → 图例 → 详情色条，四处同色一一对应；颜色只承载语义（红 = 功能焦点、紫 = 最快圈、绿 = MIN、红 = MAX 双关）；
6. **中文 UI**（C4）：界面文案全中文；通道名/单位/数值保留英文原文；**一切状态可见**——任何面板必须有空/加载/错误三态，不允许白屏；
7. **动效只给反馈，不给表演**：hover/进度/播放有反馈；数据渲染零动画（曲线出现不做入场效果）。

### B.1 设计令牌（双主题：F1 红+黑 / 红+白）

**实现形式**：CSS 变量挂 `:root[data-theme="dark"|"light"]`，深色默认，经 Tailwind token 映射消费。组件只允许 `var(--token)` 或 token 类，**禁硬编码色值**（CI grep 白名单：通道色板与保留池、Canvas 内按 token 派生色）。

**基础 Token**：

| token | 深色（默认） | 浅色 | 用途 |
|---|---|---|---|
| bg | `#15151E` | `#FFFFFF` | 页面主底（F1 官方暗底） |
| bg2 | `#1B1B27` | `#F2F2F6` | 次级面板：顶栏、时间轴底、通道选中行、MIN/MAX/AVG 格 |
| panel | `#202030` | `#E9E9F0` | 三级面板：缩放按钮底、chip 底 |
| line | `#38384A` | `#D6D6E0` | 全部分隔线、边框、滚动条 thumb |
| red | `#E10600` | `#E10600` | F1 官方红，唯一主色（边界见下） |
| text | `#FFFFFF` | `#15151E` | 主文字 |
| dim | `#9B9BAD` | `#6A6A7D` | 次级文字：表格左列、副标题、图例通道名 |
| dim2 | `#6A6A7D` | `#9B9BAD` | 三级文字：单位、刻度、通道单位 |

**语义色（仅此数种 + 状态色）**：

| 语义 | 深色 | 浅色 | 用途 |
|---|---|---|---|
| 最快圈 | `#B14BF4` | `#8F3BD9` | 文件卡片「最快圈」数值（F1 语义 session best） |
| MIN | `#43B02A` | `#2E8B1F` | 详情卡 MIN 格数值 |
| MAX | `#E10600` | `#E10600` | 详情卡 MAX 格数值（与主色同红） |
| 状态灯/进度 | green `#43B02A` / orange `#FF8001` / red | 同深色 | 状态灯、进度条阶段色 |

**红色使用边界（硬规则）**：红 `#E10600` 只允许出现在——①logo 底色；②顶栏底部 2px 分隔线；③主按钮底；④通道选中态 3px 左边条；⑤时间轴窗口框（含两端手柄）；⑥赛道图车箭头 + 起终点线；⑦文件名高亮片段；⑧MAX 数值；⑨分割条 hover/拖拽态；⑩进度条填充（导入进度 = 功能焦点）。**其余一切**白曲线/灰网格/白灰文字；ghost 按钮 hover 边框变红允许。

**通道色板（固定，不随主题变）**：SPEED 白 / RPM `#B14BF4` 紫 / THROTTLE `#43B02A` 绿 / BRAKE `#E10600` 红 / STEERING `#28F3D2` 青 / GEAR `#FFD100` 黄 / LAT G `#FF8001` 橙。**SPEED 是"前景色通道"**：取 `var(--text)`（深色白、浅色 `#15151E`），其余通道色两主题同色（读图习惯不随主题漂移）。未匹配通道从保留池（蓝 `#3A9BFF`、粉 `#FF5D8F`、青绿 `#00D9B0`…）顺序取色并记入分配表。对比模式 B 数据集：同通道色 + 虚线（B.5），不再使用 +4 偏移轮转。

**字体**：
- 家族：Formula1 Display（400/700，标题及重点区域）+ Titillium（400/600/700，正文）；中文回退 `'Microsoft YaHei'`；等宽（时间戳/hash/偏移量）：`"Cascadia Mono", Consolas, monospace`；
- 字体文件放 `src/assets/fonts/`（源文件 = `design-demos/fonts/`，Titillium 为 OFL 开源）；
- **逐位置字号/字重/字距/颜色规格以 `design-demos/DESIGN-SPEC.md` 3.2 逐位置字体规格表为唯一依据**（本附录不重复罗列）；
- **一切数值 `font-variant-numeric: tabular-nums`**（表格、图例、详情、状态栏、轴标签）；
- **版权边界（ADR-0008）**：Formula1 Display 版权属 FOM，仅限车队内部工具使用；对外发布版必须替换为授权显示字体。

**几何与动效**：
- 分隔线统一 1px；面板/按钮直角（chip/输入框圆角 ≤2px；禁用更大圆角）；
- 间距 4px 基栅，只用 2/4/6/8/10/12/14/16 档；面板内边距 12–14px；
- 动效时长：hover 100ms / 进度与淡入淡出 250ms / Ready 淡出 1.5s；缓动 `cubic-bezier(0.2, 0, 0, 1)`；**禁止 >300ms 动画与弹性缓动**；
- z-index 阶梯：内容 0 → 面板内浮层 10 → 下拉/右键菜单 100 → tooltip 200 → 对话框 300 → 全局横幅 400。

### B.2 布局系统

```
┌──────────────────────────────────────────────────────────────┐
│ 顶栏 54px（--bg2 底 + 底部 2px --red 分隔线）                  │
│ logo斜切红块 · 文件名+副标题 · spacer · PLAY · EXPORT ·       │
│ ADD COMPARE · ◐主题 · 状态灯                                   │
├─────────┬──────────────────────────────────┬─────────────────┤
│ 左栏     │ 中栏（弹性）                       │ 右栏             │
│ 可拖调宽 │ ┌────────────────────────────┐  │ 可拖调宽         │
│ 默认280  │ │ 图表堆叠区 flex:1             │  │ 默认310         │
│ 220-420 │ │ 每勾选通道一图，均分高度        │  │ 240-480        │
│         │ │ (min 60px，图间 1px --line)   │  │                 │
│ 文件卡片 │ ├────────────────────────────┤  │ 赛道图 300px     │
│ +       │ │ 时间轴 110px（顶部 2px --red） │  │ +               │
│ 通道列表 │ └────────────────────────────┘  │ 通道详情(滚动)    │
│ (滚动)   │                                │                 │
├─────────┴──────────────────────────────────┴─────────────────┤
│ 状态栏 24px：t= | 视口 | 通道 勾选/总数 | 缓存状态 | 代际        │
└──────────────────────────────────────────────────────────────┘
```

- `body`：`overflow:hidden`、`user-select:none`、底色 `--bg`、默认字体 Titillium 13px；
- 主区 CSS Grid：`grid-template-columns: var(--left-w,280px) 1fr var(--right-w,310px)`；三栏均 `min-height:0`（防溢出）；
- **栏宽拖拽调整**：左右两条分割条视觉 1px `--line`、命中区 6px，hover 与拖拽中变 `--red`；左栏范围 220–420、右栏 240–480；宽度状态入 store（`leftWidth`/`rightWidth`），持久化后续走 `save_layout`；
- 左栏右边框 1px `--line`；右栏左边框 1px `--line`；时间轴顶部 2px `--red` 分隔；状态栏顶部 1px `--line`；
- **顶栏 54px**（`--bg2` 底）：左→右 = logo（红底白字斜切块）→ 文件名（F1 Display 700 15px，关键词红）+ 副标题（Titillium 600 12px/2px `--dim`）→ flex spacer → PLAY（播放中变 ❚❚ PAUSE 红底主按钮）→ EXPORT → ADD COMPARE（Step 15 前禁用置灰）→ ◐ 主题切换 ghost 钮 → 状态灯；
- **导入入口（Step 9B 资料库落地前的过渡）**：无数据集时顶栏中部 = ghost 样式路径输入框 + 导入主按钮；有数据集后该位置显示文件名 + 副标题；
- **状态栏 24px 保留**：`--bg2` 底、顶部 1px `--line`、11px `--dim`、tabular-nums、项间 1px 竖分隔线；
- 最小可用窗口 960×600；宽度 <1100px 时左右栏可经预设收起（预设 = 显示/隐藏左右栏 + 栏宽，存 layouts 表）。

### B.3 通用组件规范

- **ghost 按钮**：透明底、1px `--line` 边框、padding 7px 16px、Titillium 700 12px/1.5px 字距、`--text` 色；hover 边框变 `--red`（文字不变色）；
- **主按钮**：`--red` 底 + 同色边框 + 白字 + 斜切（外层 `skewX(-10deg)`、内层 `skewX(10deg)` 反斜切，文字正、块斜，同 logo 手法）；
- **logo**：红底白字 F1 Display 700 15px/1px 字距、padding 6px 14px、斜切块；
- **chip**：`--panel` 底 + 1px `--line` 边框；标签 Titillium 600 11px `--dim` / 数值 700 `--text`；用于 RATE/LAPS/SIZE 等；
- **分区标题**：3×12px 红色小块 + F1 Display 700 12px/2px `--dim`（DATA FILE / CHANNELS / CHANNEL DETAIL）；右侧可挂计数徽章（如 `86 CH`，白色）；
- **checkbox**：14×14、1.5px `--dim2` 边框空心；选中 = 边框变 `--text` + 内部 inset 2px 实心块（深色白块/浅色黑块）；半选态横杠；
- **通道行**：`[勾选框 14×14][3px 色条][通道名 Titillium 700 12px][···单位 600 11px --dim2]`，padding 8px 14px、gap 10px；选中 = `--bg2` 背景 + 3px `--red` 左边条；hover = `--bg2`；
- **元数据表**：两列，左列 Titillium 400 12px `--dim` / 右列 600 12px `--text` 右对齐；
- **tooltip**：`--panel` 底 + 1px `--line` 边、12px、延迟 400ms、指针偏移 8px；带快捷键格式 `动作 (Ctrl+O)`；
- **右键菜单**：`--panel` 底、项高 26px、危险项红字、分隔 1px `--line`、禁用项 `--dim2`；
- **滚动条**：宽 6px、thumb `--line`、轨道透明；图表区无滚动条（缩放替代滚动）；
- **对话框/二次确认**：宽 ≤400px、`--bg2` 底 + 1px `--line` 边、标题 F1 Display 700 14px、按钮右对齐（主操作在右）；不可逆操作双保险（确认钮文案写清后果、不抢默认焦点）；
- **三态视觉规范（全面板统一）**：空态 = 居中 Titillium 600 `--dim2` 文案（中英对照，如「从左侧勾选通道以显示图表 / SELECT CHANNELS」）+ 可选主操作；加载 = 骨架屏（`--panel` 色块按真实内容轮廓，250ms 呼吸），禁转圈 spinner；错误 = 顶部通栏（红 3px 左条 + 13px 人话摘要 + `重试` + `详情` 折叠）；面板级错误 = 1px 红描边框 + 居中摘要；
- **状态灯**（顶栏右端）：8px 圆点；导入中 orange 250ms 呼吸 / 失败 red / 就绪 green；tooltip 显示详情。

### B.4 面板规格（P1~P9：职责/构成/事件/数据/三态/视觉）

- **P1 文件卡片 + 通道列表（左栏）**：上 = 文件卡片（`padding: 0 14px 12px`，底 1px 分隔线）：①分区标题 DATA FILE；②文件名 F1 Display 700 15px，`word-break:break-all`，关键词片段红（如 `MADRING_FP2_R2` 中的 `FP2`）；③chips 一行 `RATE 500Hz` `LAPS 14` `SIZE 82.4MB`；④元数据表：车手/赛车/时长/通道数/最快圈（紫色）。下 = 通道列表（占满剩余高度，6px 滚动条）：行规格见 B.3；点击行 = 勾选切换 → 联动中栏图表增删 + 右栏详情增删（+ `PrioritizeImport`，D11）。保留搜索过滤（防抖 150ms，匹配 name/unit）与 STANDARD/GPS/DERIVED 分组组头（组头 Titillium 600 10px `--dim` 大写）；保留右键 `仅显示此项`/`导出此通道 CSV`。三态：空 = 引导导入；加载 = 骨架行；错误 = 通栏+重试。
- **P2 PlotStack（中栏图表堆叠）**：每勾选通道一图，`flex:1` 均分（`min-height:60px`），图间 1px `--line` 分隔；每图 = uPlot canvas（absolute 铺满）+ 左上角图例 DOM（`top:5px; left:10px`，3×11px 色条 + 通道名 10px/1px `--dim` + 当前值 11px 通道色 + 单位 9px `--dim2`，`pointer-events:none`）；图表区 `cursor:ew-resize`；无勾选通道 = 居中提示「从左侧勾选通道以显示图表 / SELECT CHANNELS」（`--dim2`）；「构建中」占位 = 骨架波形 + 12px `--dim2` 文案（Step 8 点击优先闭环）；交互全集见 B.11（拖动 = 移游标、滚轮 = 缩放；框选缩放废止）；每通道独立 windowSeries 请求（generation 各自校验丢弃）；保留通道拖到图上叠加第二 Y 轴（≤2）与拖标题调序（写回 `channelOrder`，rev.4 行为，视觉 F1 化）。
- **P3 TimelineBar（中栏底部 110px，`--bg2` 底）**：全程速度缩略曲线 `--dim` 40% 透明 1px（全程数据下采样）；窗口外遮罩 `--bg` 72% 透明；窗口框 `--red` 2px 描边 + 两端 4px 宽红色手柄；窗口起止时间白字 11px 框内左右下角；数据游标位置 `--text` 1.5px 竖线全程可见；右上提示 `DRAG = PAN · WHEEL = ZOOM`（10px `--dim2`）；无文件整体 `--dim2` 30% 禁交互；手势见 B.11。
- **P4 圈速面板：已取消（2026-09-15，负责人决定）**。圈数据仅经文件卡片 LAPS chip 与紫色最快圈数值展示；后端 `Laps` 命令保留（chips/未来对比模式仍用）。
- **P5 通道详情（右栏下半，滚动）**：每勾选通道一张卡片（`padding: 10px 14px`，卡片间 50% 透明分隔线）：①标题行 = 3×12px 通道色条 + 通道名 12px/700 + 右侧单位；②当前值 = **F1 Display 700 24px `--text`** + 小号单位（右栏唯一 Display 数值），随游标实时更新（`CursorValues`，节流见 B.9）；③三格 grid（gap 6px）MIN/MAX/AVG——格子 `--bg2` 底，标签 9px/1.5px `--dim2`，数值 13px 700，MIN 绿/MAX 红/AVG 白；**统计为全程口径**（非窗口内），经 `Stats` 命令 Rust 侧计算，300ms 防抖取消失效请求。
- **P6 TrackMapPanel（右栏上 300px，border-bottom 分隔）**：白管赛道 = 外描 `--text` 90% 7px + 内描 `--bg` 4px（空心管效果，`lineJoin/lineCap: round`）；红色起终点线 3×16px；**红色车箭头**（前 9px 后 6px 舵形、白 1px 描边、按切线角旋转），位置随 `cursorT`；白色 35% 尾迹 2.5px（游标前 ~11s）；**HUD**（左上 `pointer-events:none`）：T·CROSSTIME（`m:ss.mmm`）与 SPEED 两组「标签 10px `--dim` + 数值 22px `--text`」；**缩放按钮**（右上纵排 26×26 `--panel` 底 1px `--line` 边）：＋－⟲，hover 边框与字符变红，0.6×–3× 步进 1.25×，⟲ 复位；画布留白 `min(w,h)×0.82×zoom` 居中偏上；无 GPS = 空态文案「该记录无 GPS 数据」；弯道编号无数据源不绘制（DESIGN-SPEC 9.4，留作未来赛道定义文件）；等比投影（按纬度修正）；Speed 热力着色降级为后续可选开关（默认关）。
- **P7 CommentsPanel**（可裁）：保持 rev.4 行为（时间锚定 CRUD、新增取游标时间、点锚点跳游标）；视觉 token 化（时间锚点 = 等宽 12px 红色）。
- **P8 LibraryHome**：独立路由非面板。搜索 + 记录卡片网格 + 导入（多选/文件夹/递归/从设备下载）+ 右键（打开/导出/删除/清理缓存）；双击进分析视图。**视觉**：卡片网格（最小宽 240px、间距 12px）：`--bg2` 底直角 + 1px `--line` 边、padding 12px；首行文件名 Titillium 700 13px（关键词红），次行 `车手 · 车辆 · 日期` 12px `--dim`，底部 chip 行（时长/通道数/缓存状态）；hover 边框变 `--red`；空库大引导 = 居中 48px 图标 +「导入遥测文件开始分析」+ 红底主按钮；导入中走 B.7；错误横幅重试。
- **P9 ComparePanel**（Step 15）：B 文件选择器、偏移显示/微调（±0.001s、24×24 微调钮）、自动对齐（FFT）、叠图/分图分段控件；A/B 标识 = 3×12 红色实色条（A）/ 空心条（B）前置徽标。

### B.5 图表渲染美学专项（uPlot/Canvas 落地参数，对齐 demo 手绘规格）

| 项 | 值 |
|---|---|
| 绘图区 padding | 左 34（y 刻度）/ 右 8 / 上 26（图例空间）/ 下 14（x 刻度） |
| 水平网格线 | 4 条（含顶底），`--line` 55% 透明 1px |
| y 刻度 | 3 等分（min+range×k/3），右对齐，Titillium 600 10px `--dim2`，按通道 dec 保留小数 |
| x 刻度 | 自适应步长：跨度 >40s→10s / >15s→5s / >6s→2s / 否则 1s，格式 `12s` |
| y 轴范围 | 窗口内 min/max ±12% 余量；GEAR/BRAKE/THROTTLE 从 0 起、顶部 +10% 余量 |
| 曲线 | 通道色 1.5px round join；**金字塔 min/max 包络渲染**（正常 = band 填充同色 12% + 上下缘 1px；交互期降级中线 1px，停手 100ms 防抖后精刷恢复——I4 双速，兼视觉验收项）；阶跃通道 step 左对齐 |
| 数据游标线 | `--text` 55% 虚线 `[4,4]` 全高；**仅游标在窗口内时绘制** |
| 游标交点 | 半径 3.5px 通道色实心圆（仅游标在窗口内时绘制） |
| uPlot hover | **关闭自带 hover 十字线与 tooltip**（游标模型见 B.11）；图表区 `cursor:ew-resize` |
| DPR | `devicePixelRatio` 适配 |

- **对比模式**：B 曲线 `dash [6,4]`、线宽 1.25px、同通道色；分图模式 B 图标题栏带 B 徽标；**暗色主题下虚线可读性为人工确认项**；
- **对比度**：轴标签/徽标等小字在两主题下 ≥4.5:1（浅色语义色已加深，新增自定义色须自查）。

### B.6 主题系统实现规范

- 双主题（深色默认，C4）；CSS 变量挂 `:root[data-theme]`，切换只改根属性，**零组件重挂载**，全量替换 <150ms 无闪烁；
- **Canvas/uPlot 内取色必须经 `getComputedStyle` 读令牌**，主题切换后触发一次重绘（禁缓存旧色）；SPEED 曲线 = `--text` 派生，随主题自动反转；
- 首次启动跟随系统，用户手动改过以用户为准并持久化；
- CI 检查：硬编码 hex grep，白名单（通道色板/保留池）之外为零。

### B.7 导入进度条 `ImportProgressBar`（D11）

- **位置**：顶栏红分隔线之下通栏，高 22px；多 Job 纵向堆叠（最多显 3 条，超出合并「+N 个任务」）；
- **构成**：阶段中文文案（`读取元数据…`/`读取通道…`/`构建数据缓存…`/`构建图表索引…`/`就绪`/`已取消`/`失败`）+ 4px 进度条（**填充 `--red`**（红色边界第 ⑩ 条），轨道 `--panel`）+ 百分比 + 取消钮（✕，hover 变红加粗）；
- **样式**：`--bg2` 底、1px `--line` 下边线、文字 12px（阶段名 `--dim`、文件名 `--text`）；Ready 后 1.5s 淡出自动消失；Failed 常驻直到手动关闭（红 3px 左边条）；
- **行为**：同 rev.4——点击条目 → `PrioritizeImport` + 定位；取消 → `CancelImport`；进度条宽度 250ms linear 跟随真实进度，**禁假滚动条**；三态完整（无任务不渲染 / 导入中 / 失败重试）。

### B.8 动效与微交互清单

- **允许**：hover 边框/底色 100ms；进度条宽度 250ms linear；构建中徽标/状态灯呼吸 250ms；Ready 淡出 1.5s；骨架屏呼吸；可拖元素 grab/grabbing 光标；播放游标逐帧推进；
- **禁止**：曲线绘制入场动画、数字滚动动画、页面切换转场、弹性缓动、任何 >300ms 的动效。

### B.9 快捷键与性能预算

快捷键：`Ctrl+O` 打开 / `Ctrl+L` 资料库 / `Ctrl+D` 主题 / `空格` 播放/暂停 / `←→` 游标逐点 / `Shift+←→` 跨圈 / `Home` 复位缩放 / `1~9` 预设。性能预算（B.4 旧数值指标）**按 D12 庢止**，替换为第 1.6 节结构不变量 I1~I5；**播放期间 `CursorValues` 调用必须节流合并（≤20 次/s）**，游标值可由已加载窗口帧内插近似 + 停手精查。

### B.10 设计验收走查单（每个 UI Step 交付必过）

1. 令牌检查：grep 无硬编码色值/字号/圆角（白名单除外）；
2. 三态截图：空/加载/错误各一张归档；
3. 双主题截图对比：token 互换无残留（浅色无白字白底、深色无黑字黑底）；Canvas/uPlot 随主题重绘、SPEED 曲线随 `--text` 反转；
4. **红色边界合规**：全页截图对照 B.1 红色清单逐项核对，清单之外出现红色 = 打回；
5. 两主题下小字对比度抽查（轴标签、chip、dim2 文字）；
6. tabular-nums 生效：图例/详情/状态栏数值逐帧刷新宽度不抖（录屏或实测）；
7. 键盘可达：Tab 焦点环可见，B.9 快捷键全表生效；
8. 高分屏（150%/200% 缩放）下 1px 线不发虚、布局不错位；
9. B.8 禁令零违反。

### B.11 交互核心约定（游标模型与手势，负责人逐条拍板）

- **数据游标（cursorT）**：默认 t=0，**不随鼠标悬停移动**（禁止 hover 跟随）；移动方式 = 在图表区按住鼠标拖动（按下即跳到该点，拖动实时跟随，松手停留）；游标是全局唯一状态（store），驱动：每个图表的虚线 + 交点 + 图例当前值、右栏详情卡当前值、赛道图车辆位置 + 尾迹 + HUD、时间轴白色游标线、状态栏 t=；
- 游标超出当前窗口时：图表不画线，但详情/赛道仍显示该时刻数据（clamp 到全程范围）；
- **图表区手势**：滚轮（上/下）= 缩放时间窗——以鼠标横向位置为焦点，每档 ×1.18 / ÷1.18，窗口最小 2s、最大全程，缩放后焦点保持在原时间点；按住拖动 = 移动数据游标；框选缩放废止；
- **时间轴手势**：按住拖动 = 平移时间窗，**窗口跟手**（位移按窗口宽度换算，鼠标右拖 → 窗口右移，类似拖地图；触边 clamp）；滚轮 = 缩放时间窗（焦点 = 鼠标位置，与图表区一致）；
- **播放**：▶ PLAY = 游标以 0.05s/帧（≈20fps）从窗口起点扫到窗口终点，循环；出窗重置到窗口起点；播放中按钮变 `❚❚ PAUSE` 且红色主按钮样式；空格键同效；
- 通道行点击：勾选/取消，图表与详情即时增删（无动画要求），导入中联动 `PrioritizeImport`（D11）。

## 附录 C：仓库结构（rev.4 · 工业标准规范）

```text
SCUTRacingTelemetry/
├── ⚙️ 项目全局配置与依赖清单（根目录）
│   ├── Cargo.toml                  # Workspace 根配置（统领 8 个 crates 与 src-tauri）
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
│   ├── aim-ffi/                    # [Step 3] AiM DLL 桥接 actor（唯一 unsafe crate，45 个导出函数封装）
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
│   ├── migrate-v1/                 # [Step 12] 旧库迁移工具（读取 v1 SQLite 并写入新架构，一次性工具）
│   │   ├── Cargo.toml
│   │   └── src/{main.rs, migrate.rs, verify.rs}
│   └── device-link/                # [Step 13] AiM 记录仪 WiFi 下载（协议状态机 + 断点续传，零 tauri 依赖）
│       ├── Cargo.toml
│       └── src/{lib.rs, protocol.rs, client.rs, transport.rs}
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
│   │   └── compare/                # [Step 15] 对比模式曲线渲染扩展
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
│   │   ├── ComparePanel.tsx        # [Step 15/P9] 双文件对比面板
│   │   ├── device/                 # [Step 13] 设备下载对话框（扫描/设备列表/文件选择）
│   │   └── library/                # [Step 9B/P8] 资料库主页与卡片组件
│   ├── theme/                      # [Step 8] 双主题（深色/浅色）切换驱动
│   └── hooks/                      # 自定义 Hook（useHotkeys 等快捷键驱动）
│
├── 📦 验证资产与硬件依赖（自包含，只读）
│   ├── Data/                       # 实测基准资产（AGX.xrk/csv、Du.xrk/csv、test_large.xrk 大文件冒烟样本、SCUTRacing.ico 等）
│   └── TestMatLabXRK/              # AiM 官方组件（只读，结构固定，不可移动）
│       ├── DLL-2022/               # 主解析 DLL
│       │   └── MatLabXRK-2022-64-ReleaseU.dll
│       ├── 64/                     # 主 DLL 运行时依赖（libiconv/libxml2/libz/pthreadVC2）
│       └── inc/                    # C 头文件（MatLabXRK.h，导出函数权威签名）
│
├── 🧪 测试套件与验证夹具（tests/）
│   ├── golden/                     # 真值比对夹具（AGX 速度基准二进制、CSV 元数据 JSON）
│   ├── fixtures/                   # 测试样本（含 v1_library.db 旧库快照）
│   └── e2e/                        # [Step 12] WebdriverIO + tauri-driver 端到端自动化脚本
│
├── 📚 架构文档与契约
│   ├── .agent/                     # 施工手册（本文件唯一执行依据）
│   └── .agent/
│       ├── adr/                    # 架构决策记录（0001~0008；0008 = WiFi 设备下载，Step 13 开工前立项）
│       └── contracts/              # core-api.md、dependencies.md 依赖白名单
│
├── 🛠️ 工程化脚本（tests/tooling/）
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
| DLL 在大文件（`Data/test_large.xrk`，47.12MB）下崩溃 | 低 | D13 证据门：触发则 aim-worker.exe 立项，`open_xrk_laps` 先顶；**样本仅 47MB，证据强度有限，更大样本到手后需复测** |
| dockview×uPlot 尺寸同步 | 中 | Step 5 切片内验证 |
| ECEF 派生 GPS 与 CSV 不一致 | 中 | 保留原始时间轴，对齐共同有效时间点核对单位和容差；不得自动换数据源 |
| WiFi 下载中断/弱网（赛道环境） | 中 | 分块 + 按字节 offset 断点续传；取消即清 temp；失败可重试 |
| 设备协议版本差异（不同型号记录仪） | 中 | 协议以负责人反编译规格为唯一依据；未知响应显式报错，不猜测 |
| 反编译协议的法律/授权边界 | 中 | 仅限自有设备与自有数据的互操作；不复制 RS3 专有代码与授权逻辑；官方公开接口可用时优先 |
| Webview2 旧系统缺失 | 低 | embedBootstrapper + 启动检测 |

---

*手册 rev.4 冻结于 2026-09-10。进度由负责人掌管；结构性变更走 ADR，不改本文。*





## Step 1 目录与验收修订（2026-09-11）

仓库根为 `D:/Desktop/SCUTRacingTelemetry`，目录约束统一见 `.agent/contracts/workspace-layout.md`。非根发现必需的前端配置迁至 `config/frontend/`，验收日志/报告/截图进入 `.agent/evidence/step1/`。不修改 `D:/Desktop/SCUTRacing`。产品九构件（含 rev.4.3 新增的 `device-link`）外加 `tests/golden-tests` 验证构件，因此 workspace 十成员；保留 `cargo test -p golden-tests` 标准关卡。ADR-0007 记录便携分发与 D13 证据门；Step 1 不提前实现 Step 14 打包。Python 3.11+ 仅用于依赖检查工具，不进入产品运行时。


## 目录约束最终覆盖（2026-09-11）

目录位置以 `.agent/工作区目录说明.md` 为唯一依据；若本文旧拓扑示意冲突，以该文件为准。全部项目文档在 `.agent/`，测试脚本为 `tests/tooling/`，机器白名单为 `config/contracts/dependencies.json`，前端产物为 `target/frontend/`。不再创建根 docs/scripts/dist
