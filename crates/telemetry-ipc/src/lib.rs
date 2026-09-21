use serde::{Deserialize, Serialize};
use specta::Type;

mod types;
pub use types::{
    ChannelMeta, ChannelStatsDto, DatasetMeta, ExportOutcome, FrameHeader, RecordSummary,
    SampleRange,
};

#[derive(Clone, Debug, Serialize, Deserialize, Type, PartialEq)]
#[serde(tag = "cmd", rename_all = "snake_case")]
pub enum Request {
    StartImport {
        path: String,
    },
    StartImportBatch {
        paths: Vec<String>,
        recursive: bool,
    },
    ImportStatus {
        job_id: u64,
    },
    CancelImport {
        job_id: u64,
    },
    PrioritizeImport {
        job_id: u64,
        channels: Vec<String>,
    },
    OpenDataset {
        file_hash: String,
    },
    CloseDataset {
        id: u64,
    },
    DatasetMeta {
        id: u64,
    },
    WindowSeries {
        id: u64,
        channel: String,
        start: f64,
        end: f64,
        pixels: u32,
        generation: u64,
    },
    CursorValues {
        id: u64,
        channels: Vec<String>,
        t: f64,
    },
    Laps {
        id: u64,
    },
    Stats {
        id: u64,
        channels: Vec<String>,
        start: f64,
        end: f64,
    },
    ListRecords {
        query: String,
    },
    DeleteRecord {
        record_id: i64,
    },
    ExportCsv {
        id: u64,
        channels: Vec<String>,
        start: f64,
        end: f64,
        out_path: String,
    },
    Comments {
        record_id: i64,
    },
    AddComment {
        record_id: i64,
        t: f64,
        text: String,
    },
    DeleteComment {
        id: i64,
    },
    SaveLayout {
        name: String,
        json: String,
    },
    LoadLayout {
        name: String,
    },
    EstimateOffset {
        id_a: u64,
        id_b: u64,
        channel: String,
        start: f64,
        end: f64,
    },
    PurgeCache {
        file_hash: Option<String>,
    },
    CacheRootStatus,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "PascalCase")]
pub enum ImportStage {
    ReadingMetadata,
    ReadingChannels,
    BuildingRawCache,
    BuildingPyramid,
    Ready,
    Failed,
    Cancelled,
    /// 重复记录：库内已存在同 CSV 内容 hash 的 Ready 缓存（D17 去重），终态。
    Duplicate,
}

impl ImportStage {
    pub fn is_terminal(self) -> bool {
        matches!(
            self,
            Self::Ready | Self::Failed | Self::Cancelled | Self::Duplicate
        )
    }

    pub fn can_transition_to(self, next: Self) -> bool {
        if self.is_terminal() {
            return false;
        }
        matches!(
            (self, next),
            (
                Self::ReadingMetadata,
                Self::ReadingChannels | Self::Duplicate | Self::Failed | Self::Cancelled
            ) | (
                Self::ReadingChannels,
                Self::BuildingRawCache | Self::Duplicate | Self::Failed | Self::Cancelled
            ) | (
                Self::BuildingRawCache,
                Self::BuildingPyramid | Self::Duplicate | Self::Failed | Self::Cancelled
            ) | (
                Self::BuildingPyramid,
                Self::Ready | Self::Duplicate | Self::Failed | Self::Cancelled
            )
        )
    }

    pub fn transition(self, next: Self) -> Result<Self, CmdError> {
        if self.can_transition_to(next) {
            Ok(next)
        } else {
            Err(CmdError {
                code: "invalid_stage_transition".into(),
                message: format!("cannot transition from {self:?} to {next:?}"),
            })
        }
    }
}

/// import_files 的单文件结果（queued = 已建 job 轮询；duplicate/failed 无 job）。
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct QueuedImport {
    pub job_id: Option<u64>,
    pub file_name: String,
    /// "queued" | "duplicate" | "failed"
    pub status: String,
    pub message: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type, PartialEq)]
pub struct ImportStatus {
    pub job_id: u64,
    pub stage: ImportStage,
    pub progress: f32,
    pub file_hash: String,
    pub meta_ready: bool,
    pub error: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, Type, PartialEq, Eq)]
pub struct CacheRootStatus {
    pub cache_bytes: u64,
    pub db_path: String,
    pub mem_rss_bytes: u64,
    pub active_jobs: u32,
}
#[derive(Clone, Debug, Serialize, Deserialize, Type, PartialEq, Eq)]
pub struct CmdError {
    pub code: String,
    pub message: String,
}

pub fn encode_json<T: Serialize>(value: &T) -> Result<Vec<u8>, IpcError> {
    serde_json::to_vec(value).map_err(IpcError::Json)
}
pub fn decode_json<T: for<'de> Deserialize<'de>>(bytes: &[u8]) -> Result<T, IpcError> {
    serde_json::from_slice(bytes).map_err(IpcError::Json)
}

mod frame;
pub use frame::{decode_frame, encode_frame, DecodedFrame, IpcError};

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn request_round_trip() {
        let r = Request::WindowSeries {
            id: 1,
            channel: "GPS Speed".into(),
            start: 0.,
            end: 1.,
            pixels: 10,
            generation: 2,
        };
        assert_eq!(
            decode_json::<Request>(&encode_json(&r).unwrap()).unwrap(),
            r
        );
    }
    #[test]
    fn frame_round_trip() {
        let h = serde_json::json!({"channel":"speed", "unit":"km/h", "buckets":2,
            "win_start":0.0, "win_end":1.0, "full_count":2, "generation":7});
        let b = encode_frame(&h, &[0., 1.], &[1., 2.], &[3., 4.]).unwrap();
        let (raw, t, lo, hi) = decode_frame(&b).unwrap();
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&raw).unwrap()["generation"],
            7
        );
        assert_eq!(t, [0., 1.]);
        assert_eq!(lo, [1., 2.]);
        assert_eq!(hi, [3., 4.]);
    }
    #[test]
    fn stage_machine_rejects_terminal_and_skips() {
        assert_eq!(
            ImportStage::ReadingMetadata
                .transition(ImportStage::ReadingChannels)
                .unwrap(),
            ImportStage::ReadingChannels
        );
        assert!(ImportStage::ReadingMetadata
            .transition(ImportStage::Ready)
            .is_err());
        assert!(ImportStage::Ready.transition(ImportStage::Failed).is_err());
    }

    #[test]
    fn rejects_mismatched_arrays() {
        assert!(encode_frame(&(), &[0.], &[], &[]).is_err());
    }
}
