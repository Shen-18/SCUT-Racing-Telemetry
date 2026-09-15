# ADR 0005 — 测试与证据分层

状态：已采纳（2026-09-11）；实现按施工步骤推进。

## 决策
tests/tooling/check.ps1 先跑依赖契约/负例测试，再依次执行 rustfmt、clippy -D warnings、workspace tests、tsc、eslint --max-warnings 0、cargo test -p golden-tests。每条原生命令检查退出码；失败记录后继续其余关卡，最终非零。

## 理由
文件存在与空测试不能证明业务正确。依赖检查采用标准 TOML 解析而非格式匹配，负例只改临时副本；日志包含实际违规拦截，避免污染真实仓库。

## 影响与边界
Step 1 golden 验证数据证据清单及 fixture 完整性，不宣称 CSV/XRK 算法通过；真实数值比较待解析实现按 CSV 真值加入。窗口截图、命令输出、审查报告在 .agent/evidence/step1；没有 Rust/Tauri 运行证据时必须标未通过。Python 3.11+ 是检查工具依赖（标准库 tomllib），不进产品 runtime。
