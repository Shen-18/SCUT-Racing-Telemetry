use telemetry_core::{ChannelDType, ChannelSource, SessionMeta};
use telemetry_ipc::{decode_json, encode_json, ChannelMeta, DatasetMeta};

#[test]
fn dataset_metadata_exposes_handle_identity_session_and_ordered_channels_without_samples() {
    let core = telemetry_core::ChannelMeta {
        key: "speed#2".into(),
        name: "Speed".into(),
        unit: "km/h".into(),
        source: ChannelSource::Gps,
        dtype: ChannelDType::Numeric,
        sample_rate_hz: 20.0,
    };
    let dataset = DatasetMeta {
        id: 42,
        file_hash: "sha256:abc".into(),
        file_size: 626_948,
        meta: SessionMeta {
            session: "测试".into(),
            duration: 12.5,
            sample_rate_hz: 100.0,
            ..Default::default()
        },
        channels: vec![ChannelMeta::from(&core)],
    };
    let bytes = encode_json(&dataset).unwrap();
    let decoded: DatasetMeta = decode_json(&bytes).unwrap();
    assert_eq!(decoded.id, 42);
    assert_eq!(decoded.file_hash, "sha256:abc");
    assert_eq!(decoded.file_size, 626_948);
    assert_eq!(decoded.meta.session, "测试");
    assert_eq!(decoded.meta.duration, 12.5);
    assert_eq!(decoded.meta.sample_rate_hz, 100.0);
    assert_eq!(decoded.channels.len(), 1);
    let value = serde_json::to_value(&decoded).unwrap();
    assert_eq!(value.as_object().unwrap().len(), 5);
    assert_eq!(
        value["channels"][0],
        serde_json::json!({
            "key":"speed#2", "name":"Speed", "unit":"km/h", "source":"Gps",
            "dtype":"Numeric", "sample_rate_hz":20.0,
        })
    );
    assert_eq!(encode_json(&decoded).unwrap(), bytes);
}

#[test]
fn text_channel_metadata_retains_dtype_instead_of_coercing_to_numeric() {
    let channel = telemetry_core::ChannelMeta {
        key: "note".into(),
        name: "Note".into(),
        unit: "".into(),
        source: ChannelSource::Csv,
        dtype: ChannelDType::Text,
        sample_rate_hz: 0.0,
    };
    let dto = ChannelMeta::from(&channel);
    let decoded: ChannelMeta = decode_json(&encode_json(&dto).unwrap()).unwrap();
    assert!(matches!(decoded.dtype, ChannelDType::Text));
    assert!(matches!(decoded.source, ChannelSource::Csv));
}
