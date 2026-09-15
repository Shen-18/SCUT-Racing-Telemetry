use telemetry_ipc::{decode_frame, encode_frame, FrameHeader};

fn header(buckets: u32) -> serde_json::Value {
    serde_json::json!({"channel":"GPS Speed", "unit":"km/h", "buckets":buckets,
        "win_start":0.0, "win_end":2.0, "full_count":100, "generation":7})
}

// Build independently of the encoder so decoder defects cannot cancel encoder defects.
fn wire(json: &[u8], payload: &[u8]) -> Vec<u8> {
    let mut bytes = b"SXK1".to_vec();
    bytes.extend_from_slice(&(json.len() as u32).to_le_bytes());
    bytes.extend_from_slice(json);
    bytes.extend_from_slice(payload);
    bytes
}

#[test]
fn rejects_malformed_header_even_when_payload_length_is_valid() {
    for json in [b"not json".as_slice(), b"{}", b"null", b"[]", b"\xff"] {
        assert!(decode_frame(&wire(json, &[])).is_err(), "accepted {json:?}");
    }
}

#[test]
fn bucket_count_must_match_payload_on_both_boundaries() {
    assert!(encode_frame(&header(2), &[0.0], &[1.0], &[2.0]).is_err());
    for count in [0, 2, u32::MAX] {
        let json = serde_json::to_vec(&header(count)).unwrap();
        assert!(decode_frame(&wire(&json, &[0; 16])).is_err());
    }
}

#[test]
fn encoder_rejects_incomplete_headers_and_invalid_windows() {
    assert!(encode_frame(&serde_json::json!({"generation":7}), &[], &[], &[]).is_err());
    let mut h: FrameHeader = serde_json::from_value(header(0)).unwrap();
    for (start, end) in [(2.0, 1.0), (f64::NAN, 1.0), (0.0, f64::INFINITY)] {
        h.win_start = start;
        h.win_end = end;
        assert!(encode_frame(&h, &[], &[], &[]).is_err());
    }
    let mut json = header(0);
    json["win_start"] = serde_json::json!(3.0);
    assert!(decode_frame(&wire(&serde_json::to_vec(&json).unwrap(), &[])).is_err());
}

#[test]
fn exact_manual_header_and_little_endian_soa_fixture() {
    let json = br#"{"channel":"GPS Speed","unit":"km/h","buckets":2,"win_start":0.0,"win_end":2.0,"full_count":100,"generation":7}"#;
    // Times 0.5, 1.5; minima -2, 3; maxima 4, 5. Literal IEEE-754 bytes.
    let payload = [
        0, 0, 0, 0, 0, 0, 224, 63, 0, 0, 0, 0, 0, 0, 248, 63, 0, 0, 0, 192, 0, 0, 64, 64, 0, 0,
        128, 64, 0, 0, 160, 64,
    ];
    let fixture = wire(json, &payload);
    let typed: FrameHeader = serde_json::from_slice(json).unwrap();
    assert_eq!(serde_json::to_value(&typed).unwrap(), header(2));
    let encoded = encode_frame(&typed, &[0.5, 1.5], &[-2.0, 3.0], &[4.0, 5.0]).unwrap();
    assert_eq!(encoded, fixture);
    let (raw, times, mins, maxs) = decode_frame(&fixture).unwrap();
    assert_eq!(serde_json::from_slice::<FrameHeader>(&raw).unwrap(), typed);
    assert_eq!(times, [0.5, 1.5]);
    assert_eq!(mins, [-2.0, 3.0]);
    assert_eq!(maxs, [4.0, 5.0]);
}

#[test]
fn rejects_every_truncation_trailing_data_and_bad_prefix() {
    let full = wire(&serde_json::to_vec(&header(1)).unwrap(), &[0; 16]);
    for length in 0..full.len() {
        assert!(decode_frame(&full[..length]).is_err(), "length={length}");
    }
    for extra in [1, 4, 8, 16, 32] {
        let mut bytes = full.clone();
        bytes.resize(bytes.len() + extra, 0);
        assert!(decode_frame(&bytes).is_err(), "extra={extra}");
    }
    let mut bad = full.clone();
    bad[0] = b'X';
    assert!(decode_frame(&bad).is_err());
    bad = full;
    bad[4..8].copy_from_slice(&u32::MAX.to_le_bytes());
    assert!(decode_frame(&bad).is_err());
}

#[test]
fn empty_frames_and_missing_measurements_are_not_malformed() {
    let bytes = encode_frame(&header(0), &[], &[], &[]).unwrap();
    let (_, t, lo, hi) = decode_frame(&bytes).unwrap();
    assert!(t.is_empty() && lo.is_empty() && hi.is_empty());
    let bytes = encode_frame(&header(1), &[0.0], &[f32::NAN], &[f32::NAN]).unwrap();
    let (_, _, lo, hi) = decode_frame(&bytes).unwrap();
    assert!(lo[0].is_nan() && hi[0].is_nan());
}

#[test]
fn rejects_wrong_header_field_types_missing_extra_and_duplicate_fields() {
    for field in [
        "channel",
        "unit",
        "buckets",
        "win_start",
        "win_end",
        "full_count",
        "generation",
    ] {
        let mut value = header(0);
        value.as_object_mut().unwrap().remove(field);
        assert!(decode_frame(&wire(&serde_json::to_vec(&value).unwrap(), &[])).is_err());
        value = header(0);
        value[field] = serde_json::Value::Null;
        assert!(decode_frame(&wire(&serde_json::to_vec(&value).unwrap(), &[])).is_err());
    }
    for bad in [
        serde_json::json!(-1),
        serde_json::json!(1.5),
        serde_json::json!(4294967296_u64),
    ] {
        let mut value = header(0);
        value["buckets"] = bad;
        assert!(decode_frame(&wire(&serde_json::to_vec(&value).unwrap(), &[])).is_err());
    }
    let mut value = header(0);
    value["extra"] = serde_json::json!(true);
    assert!(decode_frame(&wire(&serde_json::to_vec(&value).unwrap(), &[])).is_err());
    let duplicate = br#"{"channel":"a","unit":"","buckets":0,"win_start":0,"win_end":1,"full_count":0,"generation":1,"generation":2}"#;
    assert!(decode_frame(&wire(duplicate, &[])).is_err());
}

#[test]
fn rejects_each_mismatched_array() {
    for (t, lo, hi) in [
        (vec![0.0], vec![], vec![]),
        (vec![], vec![1.0], vec![]),
        (vec![], vec![], vec![1.0]),
    ] {
        assert!(encode_frame(&header(0), &t, &lo, &hi).is_err());
    }
}
