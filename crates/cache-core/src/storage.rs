use crate::Blob;
use crate::{CacheError, CacheManifest, Result};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

static NEXT: AtomicU64 = AtomicU64::new(0);
pub(crate) fn validate_hash(hash: &str) -> Result<()> {
    if hash.len() != 64
        || !hash
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
    {
        return Err(CacheError::Invalid(
            "expected lowercase SHA-256 identity".into(),
        ));
    }
    Ok(())
}
pub(crate) fn safe_child(parent: &Path, name: &str) -> Result<PathBuf> {
    let p = parent.join(name);
    if let Ok(meta) = fs::symlink_metadata(&p) {
        if meta.file_type().is_symlink() || !p.canonicalize()?.starts_with(parent.canonicalize()?) {
            return Err(CacheError::Invalid(
                "cache path escapes through a link".into(),
            ));
        }
    }
    Ok(p)
}
pub(crate) fn directory(parent: &Path, name: &str) -> Result<PathBuf> {
    let p = safe_child(parent, name)?;
    fs::create_dir_all(&p)?;
    Ok(p)
}
pub(crate) struct WriterLock(PathBuf);
impl WriterLock {
    pub fn acquire(path: &Path) -> Result<Self> {
        let p = safe_child(path, "writer.lock")?;
        match OpenOptions::new().write(true).create_new(true).open(&p) {
            Ok(_) => Ok(Self(p)),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Err(CacheError::Busy),
            Err(e) => Err(e.into()),
        }
    }
}
impl Drop for WriterLock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}
pub(crate) fn atomic_write(parent: &Path, name: &str, bytes: &[u8]) -> Result<()> {
    let target = safe_child(parent, name)?;
    let temp = safe_child(
        parent,
        &format!(
            ".tmp-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ),
    )?;
    let result = (|| -> Result<()> {
        let mut f = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        drop(f);
        fs::rename(&temp, &target)?;
        #[cfg(unix)]
        File::open(parent)?.sync_all()?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}
pub(crate) fn publish_manifest(path: &Path, manifest: &CacheManifest) -> Result<()> {
    atomic_write(path, "manifest.json", &serde_json::to_vec(manifest)?)
}

// Integrity-framed blocks permit bounded, checked random reads without hashing
// an entire channel on the interactive path. The final block is not padded.
const BLOCK: u64 = 4096;
pub(crate) fn publish_blob(path: &Path, extension: &str, data: &[u8]) -> Result<Blob> {
    let mut bytes = Vec::with_capacity(data.len() + data.len().div_ceil(BLOCK as usize) * 32 + 16);
    bytes.extend_from_slice(b"SCB1");
    bytes.extend_from_slice(&1u32.to_le_bytes());
    bytes.extend_from_slice(&(data.len() as u64).to_le_bytes());
    for chunk in data.chunks(BLOCK as usize) {
        bytes.extend_from_slice(chunk);
        bytes.extend_from_slice(&Sha256::digest(chunk));
    }
    let checksum = format!("{:x}", Sha256::digest(&bytes));
    let channels = safe_child(path, "channels")?;
    atomic_write(&channels, &format!("{checksum}.{extension}"), &bytes)?;
    Ok(Blob {
        checksum,
        bytes: data.len() as u64,
    })
}

pub(crate) struct BlobReader {
    file: File,
    len: u64,
    block: u64,
    buffer: Vec<u8>,
}
impl BlobReader {
    pub fn open(path: &Path, blob: &Blob, extension: &str) -> Result<Self> {
        validate_hash(&blob.checksum)?;
        let channels = safe_child(path, "channels")?;
        let file = File::open(safe_child(
            &channels,
            &format!("{}.{}", blob.checksum, extension),
        )?)?;
        let mut out = Self {
            file,
            len: blob.bytes,
            block: u64::MAX,
            buffer: Vec::new(),
        };
        let mut header = [0; 16];
        out.file.read_exact(&mut header)?;
        let expected = blob
            .bytes
            .checked_add(
                blob.bytes
                    .div_ceil(BLOCK)
                    .checked_mul(32)
                    .ok_or_else(|| invalid("size overflow"))?,
            )
            .and_then(|n| n.checked_add(16))
            .ok_or_else(|| invalid("size overflow"))?;
        if &header[..4] != b"SCB1"
            || header[4..8] != 1u32.to_le_bytes()
            || header[8..] != blob.bytes.to_le_bytes()
            || out.file.metadata()?.len() != expected
        {
            return Err(invalid("blob header/length mismatch"));
        }
        Ok(out)
    }
    pub fn read(&mut self, offset: u64, len: usize) -> Result<Vec<u8>> {
        if offset
            .checked_add(len as u64)
            .is_none_or(|end| end > self.len)
        {
            return Err(invalid("read outside blob"));
        }
        let mut result = Vec::with_capacity(len);
        let mut pos = offset;
        while result.len() < len {
            let block = pos / BLOCK;
            if self.block != block {
                let n = (self.len - block * BLOCK).min(BLOCK) as usize;
                self.file.seek(SeekFrom::Start(16 + block * (BLOCK + 32)))?;
                self.buffer.resize(n, 0);
                self.file.read_exact(&mut self.buffer)?;
                let mut hash = [0; 32];
                self.file.read_exact(&mut hash)?;
                if Sha256::digest(&self.buffer)[..] != hash {
                    return Err(invalid("block checksum mismatch"));
                }
                self.block = block;
            }
            let start = (pos % BLOCK) as usize;
            let n = (len - result.len()).min(self.buffer.len() - start);
            result.extend_from_slice(&self.buffer[start..start + n]);
            pos += n as u64;
        }
        Ok(result)
    }
    pub fn f64(&mut self, offset: u64) -> Result<f64> {
        Ok(f64::from_le_bytes(
            self.read(offset, 8)?.try_into().unwrap(),
        ))
    }
    pub fn f32(&mut self, offset: u64) -> Result<f32> {
        Ok(f32::from_le_bytes(
            self.read(offset, 4)?.try_into().unwrap(),
        ))
    }
}
pub(crate) fn invalid(message: &str) -> CacheError {
    CacheError::Invalid(message.into())
}

pub(crate) fn upper_bound(
    reader: &mut BlobReader,
    offset: u64,
    stride: u64,
    count: u64,
    t: f64,
) -> Result<u64> {
    let (mut lo, mut hi) = (0, count);
    while lo < hi {
        let mid = lo + (hi - lo) / 2;
        let value = reader.f64(offset + mid * stride)?;
        if !value.is_finite() {
            return Err(invalid("non-finite timestamp"));
        }
        if value <= t {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    Ok(lo)
}

/// Return the first sample whose timestamp is greater than or equal to `t`.
///
/// Window reads use this lower bound so a frame never contains a synthetic
/// point just before the requested range.  Cursor reads intentionally keep
/// their step-hold semantics and continue to use `upper_bound`.
pub(crate) fn lower_bound(
    reader: &mut BlobReader,
    offset: u64,
    stride: u64,
    count: u64,
    t: f64,
) -> Result<u64> {
    let (mut lo, mut hi) = (0, count);
    while lo < hi {
        let mid = lo + (hi - lo) / 2;
        let value = reader.f64(offset + mid * stride)?;
        if !value.is_finite() {
            return Err(invalid("non-finite timestamp"));
        }
        if value < t {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    Ok(lo)
}
