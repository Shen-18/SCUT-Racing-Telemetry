//! Foundation evidence checks, not yet a numerical telemetry golden suite.
#[cfg(test)]
mod tests {
    #[test]
    fn legacy_fixture_matches_recorded_source_identity() {
        let bytes = include_bytes!("../../fixtures/v1_library.db");
        let identity = include_str!("../../golden/v1-library.identity");
        let hash = bytes.iter().fold(14_695_981_039_346_656_037_u64, |h, b| {
            (h ^ u64::from(*b)).wrapping_mul(1_099_511_628_211)
        });
        assert_eq!(format!("{} {:016x}", bytes.len(), hash), identity.trim());
        assert!(
            bytes.starts_with(b"SQLite format 3\0"),
            "fixture must be a real SQLite database"
        );
    }
}
