use crate::FrameHeader;
use serde::Serialize;
use thiserror::Error;

const MAGIC: [u8; 4] = *b"SXK1";

#[derive(Debug, Error)]
pub enum IpcError {
    #[error("invalid frame: {0}")]
    InvalidFrame(String),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
}

fn invalid(message: &str) -> IpcError {
    IpcError::InvalidFrame(message.into())
}

fn validate_header(header: &FrameHeader) -> Result<usize, IpcError> {
    if !header.win_start.is_finite()
        || !header.win_end.is_finite()
        || header.win_start > header.win_end
    {
        return Err(invalid("window must be finite and ordered"));
    }
    usize::try_from(header.buckets).map_err(|_| invalid("bucket count too large"))
}

/// Encode a manual-contract header and little-endian SoA payload.
/// Accepts serializable headers for compatibility, but validates the exact FrameHeader schema.
/// Non-finite measurements are preserved: NaN represents missing telemetry, not bad framing.
pub fn encode_frame<T: Serialize>(
    header: &T,
    times: &[f64],
    mins: &[f32],
    maxs: &[f32],
) -> Result<Vec<u8>, IpcError> {
    if times.len() != mins.len() || times.len() != maxs.len() {
        return Err(invalid("array lengths differ"));
    }
    let json = serde_json::to_vec(header)?;
    let typed: FrameHeader = serde_json::from_slice(&json)?;
    if validate_header(&typed)? != times.len() {
        return Err(invalid("bucket count differs from payload"));
    }
    let header_len = u32::try_from(json.len()).map_err(|_| invalid("header too large"))?;
    let capacity = times
        .len()
        .checked_mul(16)
        .and_then(|n| n.checked_add(json.len()))
        .and_then(|n| n.checked_add(8))
        .ok_or_else(|| invalid("frame length overflow"))?;
    let mut out = Vec::new();
    out.try_reserve_exact(capacity)
        .map_err(|_| invalid("frame allocation failed"))?;
    out.extend_from_slice(&MAGIC);
    out.extend_from_slice(&header_len.to_le_bytes());
    out.extend_from_slice(&json);
    for v in times {
        out.extend_from_slice(&v.to_le_bytes());
    }
    for v in mins.iter().chain(maxs) {
        out.extend_from_slice(&v.to_le_bytes());
    }
    Ok(out)
}

/// The validated original JSON header followed by decoded times, minima and maxima.
pub type DecodedFrame = (Vec<u8>, Vec<f64>, Vec<f32>, Vec<f32>);

/// Reject malformed headers, overflow, truncation and trailing bytes before allocating arrays.
pub fn decode_frame(bytes: &[u8]) -> Result<DecodedFrame, IpcError> {
    if bytes.len() < 8 || bytes[..4] != MAGIC {
        return Err(invalid("bad magic or truncated prefix"));
    }
    let header_len = u32::from_le_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]);
    let header_end = usize::try_from(header_len)
        .ok()
        .and_then(|n| n.checked_add(8))
        .filter(|end| *end <= bytes.len())
        .ok_or_else(|| invalid("truncated header"))?;
    let header: FrameHeader = serde_json::from_slice(&bytes[8..header_end])?;
    let n = validate_header(&header)?;
    let payload_len = n
        .checked_mul(16)
        .ok_or_else(|| invalid("payload length overflow"))?;
    let payload = &bytes[header_end..];
    if payload.len() != payload_len {
        return Err(invalid("payload length differs from bucket count"));
    }
    let times = payload[..n * 8]
        .as_chunks::<8>()
        .0
        .iter()
        .map(|c| f64::from_le_bytes([c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7]]))
        .collect();
    let floats = |slice: &[u8]| {
        slice
            .as_chunks::<4>()
            .0
            .iter()
            .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
            .collect()
    };
    Ok((
        bytes[8..header_end].to_vec(),
        times,
        floats(&payload[n * 8..n * 12]),
        floats(&payload[n * 12..]),
    ))
}
