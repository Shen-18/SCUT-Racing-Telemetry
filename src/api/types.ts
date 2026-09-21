// Generated from telemetry-ipc specta contract; do not edit manually.
export type ImportStage = "ReadingMetadata" | "ReadingChannels" | "BuildingRawCache" | "BuildingPyramid" | "Ready" | "Failed" | "Cancelled" | "Duplicate";
export interface ImportStatus { job_id:number; stage:ImportStage; progress:number; file_hash:string; meta_ready:boolean; error:string|null }
export interface FrameHeader { channel:string; unit:string; buckets:number; win_start:number; win_end:number; full_count:number; generation:number }
export interface WindowFrame { header:FrameHeader; times:Float64Array; mins:Float32Array; maxs:Float32Array }
export interface ChannelMeta { key:string; name:string; unit:string; source:string; dtype:string; sample_rate_hz:number }
export interface SessionMeta {
  file_path:string;
  file_type:string;
  session:string;
  vehicle:string;
  racer:string;
  championship:string;
  comment:string;
  date:string;
  start_time:string;
  sample_rate_hz:number;
  duration:number;
}
export interface DatasetMeta { id:number; file_hash:string; file_size?:number; meta:SessionMeta; channels:ChannelMeta[] }
export interface SampleRange { start:number; end:number }
export interface QueuedImport { job_id:number|null; file_name:string; status:"queued"|"duplicate"|"failed"; message:string|null }
export interface RecordSummary {
  file_hash:string;
  file_name:string;
  file_type:string;
  session:string;
  vehicle:string;
  racer:string;
  record_date:string;
  start_time:string;
  duration:number;
  channel_count:number;
  file_size:number;
  source_mtime_unix:number;
  cache_state:string;
}



