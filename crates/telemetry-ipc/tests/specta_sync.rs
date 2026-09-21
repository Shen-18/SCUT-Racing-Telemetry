use std::fs;

use specta::TypeCollection;
use telemetry_ipc::{
    CacheRootStatus, ChannelMeta, CmdError, DatasetMeta, FrameHeader, ImportStage, ImportStatus,
    RecordSummary, Request,
};

#[test]
fn rust_specta_contract_and_checked_typescript_surface_stay_in_sync() {
    let mut collection = TypeCollection::default();
    collection
        .register::<Request>()
        .register::<ImportStage>()
        .register::<ImportStatus>()
        .register::<CacheRootStatus>()
        .register::<CmdError>()
        .register::<FrameHeader>()
        .register::<ChannelMeta>()
        .register::<DatasetMeta>()
        .register::<RecordSummary>();

    let rust_contract = format!("{collection:?}");
    for name in [
        "Request",
        "ImportStage",
        "ImportStatus",
        "CacheRootStatus",
        "CmdError",
        "FrameHeader",
        "ChannelMeta",
        "DatasetMeta",
        "RecordSummary",
    ] {
        assert!(
            rust_contract.contains(name),
            "specta collection is missing Rust type {name}: {rust_contract}"
        );
    }

    let ts_path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../src/api/types.ts");
    let ts = fs::read_to_string(ts_path).expect("generated TypeScript contract is present");
    assert!(ts.contains("Generated from telemetry-ipc specta contract"));
    for declaration in [
        "export type ImportStage",
        "export interface ImportStatus",
        "export interface FrameHeader",
        "export interface ChannelMeta",
        "export interface DatasetMeta",
        "export interface RecordSummary",
        "export interface WindowFrame",
    ] {
        assert!(
            ts.contains(declaration),
            "TypeScript contract is missing {declaration}"
        );
    }
    for field in [
        "generation:number",
        "job_id:number",
        "file_hash:string",
        "file_size:number",
        "file_name:string",
        "channels:ChannelMeta[]",
    ] {
        assert!(
            ts.contains(field),
            "TypeScript contract is missing field {field}"
        );
    }
}
