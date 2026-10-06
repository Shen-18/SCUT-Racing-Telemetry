use std::path::PathBuf;
use xrk_meta::extract;

fn fixture(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../Data")
        .join(name)
}

/// 金标准由真实文件实测得出。AGX.xrk 尾部带有 RS3 追加的覆盖帧（RCR=AGX_26），
/// 按「后出现者覆盖」语义应取尾部值——与 RS3/桌面端打开该文件的显示一致。
#[test]
fn agx_xrk_golden() {
    let meta = extract(&fixture("AGX.xrk")).expect("AGX.xrk 应可解析");
    assert_eq!(meta.record_date, "2026-01-25");
    assert_eq!(meta.start_time, "13:56:23");
    assert_eq!(meta.vehicle, "A03_AF25");
    // 头部 RCR="Hongyu Huang"，尾部追加 RCR="AGX_26" 覆盖之
    assert_eq!(meta.racer, "AGX_26");
    // 采样流格式未逆向，时长兜底 0，由桌面端导入后的索引同步补齐
    assert_eq!(meta.duration_seconds, 0.0);
}

#[test]
fn du_xrk_parses_with_valid_structure() {
    let meta = extract(&fixture("Du.xrk")).expect("Du.xrk 应可解析");
    assert_eq!(meta.record_date.len(), 10);
    assert!(meta.record_date.starts_with("20"));
    assert_eq!(meta.start_time.len(), 8);
}

#[test]
fn xrz_input_matches_xrk() {
    let direct = extract(&fixture("AGX.xrk")).expect("AGX.xrk 直读");
    // 模拟 .xrz：zlib(AGX.xrk)
    let raw = std::fs::read(fixture("AGX.xrk")).unwrap();
    let mut encoder = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::new(6));
    std::io::Write::write_all(&mut encoder, &raw).unwrap();
    let compressed = encoder.finish().unwrap();
    let via_xrz = xrk_meta::extract_bytes(&compressed).expect("zlib 压缩流应可解析");
    assert_eq!(direct, via_xrz);
}

#[test]
fn corrupt_file_fails_cleanly() {
    let dir = std::env::temp_dir().join("xrk-meta-corrupt-test");
    std::fs::create_dir_all(&dir).unwrap();
    let p = dir.join("corrupt.xrk");
    std::fs::write(&p, b"not an xrk at all").unwrap();
    assert!(extract(&p).is_err());
}
