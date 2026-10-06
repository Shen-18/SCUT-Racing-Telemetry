//! AiM XRK/XRZ 元数据提取。
//!
//! 格式知识来源：RS3 逆向文档（D:/Desktop/RS3/XRK_METADATA_REVERSE_ENGINEERING.md §2.1 帧封装）
//! 与真实文件实测（Data/AGX.xrk、Data/Du.xrk）。
//!
//! .xrk = 一串信道帧 `<h<TAG><len u32 LE><seq><0x3e><payload><0x3c><TAG><chk16><0x3e>`；
//! 头部区依次出现 CNF(内嵌 CHS 通道记录)/RCR/VEH/CMP/VTY/NDV/RACM/VET/SRC/iSLV/ENF/TRK/TMD/TMT/ODO，
//! 之后是原始采样流（非帧）。RS3 采用「尾部追加覆盖」语义：同名 tag 后出现者生效，
//! 因此扫描全文件并取最后一次出现的元数据帧；校验和按宽松处理（只验结构不验 chk16，实测样例有出入）。
//!
//! 已知字段语义（够建索引即可，不做详尽解析）：
//! - TMD = "MM/DD/YYYY\0"（美式日期，如 01/25/2026）→ record_date = "YYYY-MM-DD"
//! - TMT = "HH:MM:SS\0" → start_time
//! - VEH/RCR = 车辆/车手
//! - 时长不解析（采样流格式未逆向），固定兜底 0；桌面端导入同一文件
//!   后经索引同步（按 file_hash 幂等覆盖）会把真实时长补上。

use serde::Serialize;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Default, PartialEq)]
pub struct Meta {
    #[serde(rename = "record_date")]
    pub record_date: String,
    #[serde(rename = "start_time")]
    pub start_time: String,
    #[serde(rename = "duration_seconds")]
    pub duration_seconds: f64,
    pub vehicle: String,
    pub racer: String,
}

#[derive(Debug)]
pub struct ExtractError(pub String);

impl std::fmt::Display for ExtractError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl std::error::Error for ExtractError {}

const FRAME_MAGIC: [u8; 2] = [0x3c, 0x68]; // "<h"

/// 提取元数据；接受 .xrk 原文件或 .xrz（zlib 压缩，头两字节 0x78 0x01）。
pub fn extract(path: &Path) -> Result<Meta, ExtractError> {
    let raw = std::fs::read(path).map_err(|e| ExtractError(format!("读取文件失败: {e}")))?;
    extract_bytes(&raw)
}

pub fn extract_bytes(raw: &[u8]) -> Result<Meta, ExtractError> {
    let buf = decompress_if_needed(raw)?;
    if buf.len() < 12 || buf[0] != FRAME_MAGIC[0] || buf[1] != FRAME_MAGIC[1] {
        return Err(ExtractError("不是 XRK 帧流（缺少 <h 帧头）".into()));
    }

    let mut meta = Meta::default();
    let mut off = 0usize;
    while off + 12 <= buf.len() {
        match frame_at(&buf, off) {
            Some((tag, payload)) => {
                match &tag {
                    b"TMD\x00" => meta.record_date = us_date_to_iso(payload),
                    b"TMT\x00" => meta.start_time = ascii_trim(payload),
                    b"VEH\x00" => meta.vehicle = ascii_trim(payload),
                    b"RCR\x00" => meta.racer = ascii_trim(payload),
                    _ => {}
                }
                off += 20 + payload.len();
            }
            // 原始采样流区：逐字节推进，继续寻找可能被 RS3 追加的尾部元数据帧
            None => off += 1,
        }
    }
    Ok(meta)
}

/// .xrz = zlib(.xrk)；AiM 固定 78 01，但按通用 zlib 头判断（0x78 且 (b0<<8|b1) % 31 == 0）
fn decompress_if_needed(raw: &[u8]) -> Result<Vec<u8>, ExtractError> {
    let is_zlib =
        raw.len() >= 2 && raw[0] == 0x78 && (u16::from(raw[0]) << 8 | u16::from(raw[1])) % 31 == 0;
    if is_zlib {
        let mut decoder = flate2::read::ZlibDecoder::new(raw);
        use std::io::Read;
        let mut out = Vec::new();
        decoder
            .read_to_end(&mut out)
            .map_err(|e| ExtractError(format!("XRZ 解压失败: {e}")))?;
        Ok(out)
    } else {
        Ok(raw.to_vec())
    }
}

/// 在 off 处校验一个完整信道帧；返回 (tag, payload)。宽松校验：帧头/长度/帧尾 tag 一致性。
fn frame_at(buf: &[u8], off: usize) -> Option<([u8; 4], &[u8])> {
    if off + 12 > buf.len() || buf[off] != FRAME_MAGIC[0] || buf[off + 1] != FRAME_MAGIC[1] {
        return None;
    }
    let len = u32::from_le_bytes([buf[off + 6], buf[off + 7], buf[off + 8], buf[off + 9]]) as usize;
    let total = 20usize.checked_add(len)?;
    if off + total > buf.len() || buf[off + 0x0b] != b'>' {
        return None;
    }
    let tag = [buf[off + 2], buf[off + 3], buf[off + 4], buf[off + 5]];
    let footer = &buf[off + 12 + len..off + total];
    if footer[0] != b'<' || footer[1..5] != tag || footer[7] != b'>' {
        return None;
    }
    Some((tag, &buf[off + 12..off + 12 + len]))
}

/// 在 CNF 载荷（本身是内嵌帧流）中收集 CHS 通道序号
/// TMD 载荷 "MM/DD/YYYY\0" → "YYYY-MM-DD"；解析失败返回空串
fn us_date_to_iso(payload: &[u8]) -> String {
    let text = ascii_trim(payload);
    let parts: Vec<&str> = text.split('/').collect();
    if parts.len() != 3 || parts[0].len() != 2 || parts[2].len() != 4 {
        return String::new();
    }
    format!("{}-{}-{}", parts[2], parts[0], parts[1])
}

fn ascii_trim(payload: &[u8]) -> String {
    let end = payload
        .iter()
        .position(|&b| b == 0)
        .unwrap_or(payload.len());
    String::from_utf8_lossy(&payload[..end]).trim().to_string()
}
