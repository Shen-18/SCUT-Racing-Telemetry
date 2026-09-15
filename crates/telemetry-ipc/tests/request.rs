use telemetry_ipc::{decode_json, encode_json, Request};
#[test]
fn every_request_variant_round_trips() {
    let requests = vec![
        Request::StartImport {
            path: "x.xrk".into(),
        },
        Request::StartImportBatch {
            paths: vec!["a.xrk".into()],
            recursive: true,
        },
        Request::ImportStatus { job_id: 1 },
        Request::CancelImport { job_id: 1 },
        Request::PrioritizeImport {
            job_id: 1,
            channels: vec!["Speed".into()],
        },
        Request::OpenDataset {
            file_hash: "a".repeat(64),
        },
        Request::CloseDataset { id: 1 },
        Request::DatasetMeta { id: 1 },
        Request::WindowSeries {
            id: 1,
            channel: "Speed".into(),
            start: 0.,
            end: 1.,
            pixels: 100,
            generation: 2,
        },
        Request::CursorValues {
            id: 1,
            channels: vec!["Speed".into()],
            t: 1.,
        },
        Request::Laps { id: 1 },
        Request::Stats {
            id: 1,
            channels: vec!["Speed".into()],
            start: 0.,
            end: 1.,
        },
        Request::ListRecords { query: "q".into() },
        Request::DeleteRecord { record_id: 1 },
        Request::ExportCsv {
            id: 1,
            channels: vec!["Speed".into()],
            start: 0.,
            end: 1.,
            out_path: "o.csv".into(),
        },
        Request::Comments { record_id: 1 },
        Request::AddComment {
            record_id: 1,
            t: 1.,
            text: "x".into(),
        },
        Request::DeleteComment { id: 1 },
        Request::SaveLayout {
            name: "n".into(),
            json: "{}".into(),
        },
        Request::LoadLayout { name: "n".into() },
        Request::EstimateOffset {
            id_a: 1,
            id_b: 2,
            channel: "Speed".into(),
            start: 0.,
            end: 1.,
        },
        Request::PurgeCache { file_hash: None },
        Request::CacheRootStatus,
    ];
    assert_eq!(requests.len(), 23);
    for request in requests {
        assert_eq!(
            decode_json::<Request>(&encode_json(&request).unwrap()).unwrap(),
            request
        );
    }
}
