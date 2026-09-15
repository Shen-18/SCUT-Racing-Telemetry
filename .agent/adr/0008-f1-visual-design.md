# ADR 0008 — UI 视觉定稿为 F1 官方风格（D16）

状态：已采纳（2026-09-15，负责人逐条拍板）。

## 决策

正式软件 UI 以 `design-demos/08-f1-data-analysis.html`（负责人已审核 demo）+ `design-demos/DESIGN-SPEC.md` 为唯一设计基准；施工手册附录 B 重写为 rev.5。要点：

1. **视觉**：F1 官方风格——黑白灰为主，红 `#E10600` 唯一主色且有明确使用边界清单（B.1）；Formula1 Display + Titillium 字体体系；通道固定色板（SPEED=前景色、RPM/THROTTLE/BRAKE/STEERING/GEAR/LAT G 各一色），四处联动（列表色条/曲线/图例/详情）。
2. **主题**：双主题保留。深色（默认）= F1 红黑；浅色 = 红+白（黑白互换、红与彩色语义不变、语义色加深保对比度）。SPEED 曲线 = `var(--text)`，随主题反转。
3. **布局**：固定三栏 Grid（280/弹性/310），左右栏宽可拖拽调整（220–420 / 240–480）；54px 顶栏 + 2px 红分隔线；时间轴（110px）位于中栏底部；**状态栏 24px 保留**；移除 dockview 自由停靠（D2 的 dockview 依赖、C3 的 dockview 承载条款由本 ADR 取代）；`save_layout`/`load_layout` 后端命令保留，预设退化为左右栏显隐+栏宽。
4. **交互**：数据游标全局唯一（store `cursorT`），默认 t=0、按住拖动移动、禁 hover 跟随；图表区滚轮 = 焦点缩放 ×1.18；时间轴平移窗口跟手；新增播放（0.05s/帧循环）。rev.4 的框选缩放与 hover 十字线废止。
5. **面板**：圈速面板（P4）取消，圈数据仅经文件卡片 LAPS chip 与紫色最快圈展示；StatsPanel 改造为通道详情卡（全程统计 MIN/MAX/AVG + F1 Display 24px 当前值）。

## 理由

负责人对 demo 逐条审核定稿；F1 Live Timing 视觉语言成熟、克制且识别度高，与专业遥测工具的数据密度诉求兼容。固定三栏 + 可拖栏宽在保证 demo 视觉还原的同时保留 dockview 的实际价值（用户自定义空间），并移除一个重型依赖。游标改为拖拽模型是遥测分析的主流交互（MoTeC/RaceStudio 亦然），且避免 hover 十字线与拖拽游标两套指针语义冲突。

## 影响与边界

- 现存 Step 5 rev.4 界面由 **Step 5R** 重构（五个阶段 R1–R5）；Step 5 历史验收记录不改写。
- rev.4 附录 B 的蓝色令牌、C1–C8 循环色板、+4 偏移对比规则废止；对比模式改同通道色 + 虚线。
- **字体版权**：Formula1 Display 版权属 Formula One Motorsport（FOM），仅限车队内部工具使用；**对外发布版必须替换为授权显示字体**。Titillium 为 OFL 开源，可随软件分发。字体文件放 `src/assets/fonts/`，不在版本库外传播 demo 的 base64 内嵌版本。
- 文件卡片 SIZE chip 需要 `DatasetMeta` 增加文件大小字段（后端 `fs::metadata`，Step 5R R2 前补）；弯道编号无数据源，第一版不绘制（留作未来赛道定义文件功能）。
- 现有涉及 hover 游标、时间轴平移算法、旧 token 的测试断言需按 B.11/B.1 调整。
