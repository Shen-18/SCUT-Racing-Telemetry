//! Temporal alignment estimation using cross-correlation.

/// Estimate time offset of `b` relative to `a` within the given window.
/// Implementation is deferred to Step 15.
pub fn estimate_offset(
    _: &crate::ChannelSeries,
    _: &crate::ChannelSeries,
    _: (f64, f64),
) -> Result<f64, crate::TelemetryError> {
    Err(crate::TelemetryError::Parse(
        "alignment deferred to Step 15".into(),
    ))
}
