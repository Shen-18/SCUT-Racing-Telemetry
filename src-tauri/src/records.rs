use telemetry_ipc::RecordSummary;
use telemetry_store::TelemetryStore;

pub fn list_records(
    store: &TelemetryStore,
    query: &str,
) -> Result<Vec<RecordSummary>, telemetry_store::StoreError> {
    store.list_records(query)
}
