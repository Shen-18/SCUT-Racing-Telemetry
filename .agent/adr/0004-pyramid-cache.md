# ADR 0004 — scb-pyr v1 与缓存状态

状态：已采纳（2026-09-11）；实现按施工步骤推进。

## 决策
磁盘根默认 %APPDATA%/SCUTRacingTelemetry/cache（可配置）。telemetry.db 存索引/用户数据；datasets/<file-hash>/ 下为 manifest.json、channels/<key>.raw、channels/<key>.pyr、laps.bin、temp/。raw 为 header + f64 times + f32 values；pyr 为 header + level 表 + (f64 time,f32 min,f32 max) 块。manifest 保存格式版本、源 hash/mtime/size、阶段、每通道进度和 checksum。

## 理由
min/max 包络保留尖峰，渲染成本按像素而非总样本数增长；raw 留给精确值查询，磁盘缓存避免重开完整解析。文件临时写入再原子发布，坏版本/校验失败标 Invalid 并重建，不静默读坏缓存。

## 影响与边界
Level 0 为 raw，Level k 聚合 2^k 原始点，time 取桶首时间，直到桶数≤512；查询选窗口桶数≤2×像素的最细层，更细读 raw。Missing → MetadataReady → RawPartial → RawReady → PyramidPartial → Ready，任意阶段可 Failed；中断按每通道进度恢复。先元数据、概览、点击优先通道、其余通道。二进制头偏移和实现测试属于 Step 9A，不能把本 ADR 当已实现证明。
