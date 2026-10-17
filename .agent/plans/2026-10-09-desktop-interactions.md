# 桌面交互与 Overlay 布局实施计划

**目标：** 顺序完成用户提出的四项桌面改动，最后仅构建工作目录 EXE。

**实现：** 复用现有导航、ColumnSplitter、本地 SQL 备注和缓存归档。保持现有字体、主题及未提交改动；不新增依赖、不改云端或 NSIS。

## 步骤

- [x] 1. AppShell 设置入口在设置页变 BACK，返回进入前的页面；index.css 给 DATABASE/OVERLAY 文字增加每次进入悬停仅一次的红/蓝扫光。
- [x] 2. 读取现有云端记录证明原路径失效；records.rs/main.rs 优先定位 source.xrk/xrz/csv，兼容旧原文件和归档目录，并处理 Explorer 不接受的扩展路径前缀。
- [x] 3. LibraryView 记录右键和备注列接入编辑对话框，复用 saveRecordNote 写本地 SQL。保存后立即更新当前列表，选中文本不关闭，操作列维持下载/删除。
- [x] 4. OverlaySelector 与操作台复用两条细 ColumnSplitter，右栏默认缩至 220px，布局设置独立保存；记录选择改为小方框和蓝色高亮，移除 SELECT/SELECTED。
- [x] 5. 做必要路径复现与类型/构建检查，核对 EXE 更新时间及 NSIS 文件未改变，交用户实测。

整体 pnpm build:exe 的自动审批两次超时，普通沙箱亦因 helper 错误不能启动。拆成已安装 Vite 生成前端，再 cargo build --release -p scut-racing-telemetry --features custom-protocol，构建成功。EXE：2026-10-09 11:20:22，18,564,096 字节；1.3.0 NSIS 与签名时间仍为 2026-10-08，未重建。类型检查通过；未启动 GUI 或执行全量测试。

用户已要求按上述顺序实施，且此前明确由用户承担完整 GUI 测试；不增加无关测试或审批步骤。
