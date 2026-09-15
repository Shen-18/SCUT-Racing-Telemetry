//! Import scheduling independent of the desktop runtime.
use std::collections::{HashSet, VecDeque};
use telemetry_ipc::{CmdError, ImportStage, ImportStatus};

pub struct ImportJob {
    pub status: ImportStatus,
    pub pending: VecDeque<String>,
    pub claimed: HashSet<String>,
}

impl ImportJob {
    pub fn new(id: u64) -> Self {
        Self {
            status: ImportStatus {
                job_id: id,
                stage: ImportStage::ReadingMetadata,
                progress: 0.0,
                file_hash: String::new(),
                meta_ready: false,
                error: None,
            },
            pending: VecDeque::new(),
            claimed: HashSet::new(),
        }
    }

    pub fn transition(&mut self, next: ImportStage) -> Result<(), CmdError> {
        self.status.stage = self.status.stage.transition(next)?;
        Ok(())
    }

    pub fn enqueue(&mut self, channels: impl IntoIterator<Item = String>) {
        for channel in channels {
            if !self.claimed.contains(&channel) && !self.pending.contains(&channel) {
                self.pending.push_back(channel);
            }
        }
    }

    pub fn prioritize(&mut self, channels: &[String]) {
        for channel in channels.iter().rev() {
            if let Some(index) = self.pending.iter().position(|key| key == channel) {
                self.pending.remove(index);
                self.pending.push_front(channel.clone());
            }
        }
    }

    pub fn claim_next(&mut self) -> Option<String> {
        if self.status.stage.is_terminal() {
            return None;
        }
        let channel = self.pending.pop_front()?;
        self.claimed.insert(channel.clone());
        Some(channel)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ready_requires_every_stage_and_rejects_further_work() {
        let mut job = ImportJob::new(3);
        assert!(job.transition(ImportStage::Ready).is_err());
        for stage in [
            ImportStage::ReadingChannels,
            ImportStage::BuildingRawCache,
            ImportStage::BuildingPyramid,
            ImportStage::Ready,
        ] {
            job.transition(stage).unwrap();
        }
        job.enqueue(["unclaimed".into()]);
        assert!(job.claim_next().is_none());
        assert!(job.transition(ImportStage::Cancelled).is_err());
        assert_eq!(job.status.stage, ImportStage::Ready);
    }

    #[test]
    fn priority_preserves_order_without_duplicate_or_repeated_work() {
        let mut job = ImportJob::new(1);
        job.enqueue(["a", "b", "c", "b"].map(String::from));
        job.prioritize(&["c".into(), "b".into(), "c".into(), "unknown".into()]);
        assert_eq!(job.claim_next().as_deref(), Some("c"));
        job.enqueue(["c".into()]);
        job.prioritize(&["c".into()]);
        assert_eq!(job.claim_next().as_deref(), Some("b"));
        assert_eq!(job.claim_next().as_deref(), Some("a"));
        assert_eq!(job.claim_next(), None);
    }

    #[test]
    fn cancelled_job_never_claims_more_work_or_revives() {
        let mut job = ImportJob::new(2);
        job.enqueue(["a".into()]);
        job.transition(ImportStage::Cancelled).unwrap();
        assert!(job.claim_next().is_none());
        assert!(job.transition(ImportStage::ReadingChannels).is_err());
    }
}
