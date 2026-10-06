use overlay::{
    build_timeline, parse_seconds, render_indices, resolve_candidate, sample_frame,
    solve_alignment, BindingConfig, SampleSeries, SeriesSampler, SyncAnchor, TimelineConfig,
    TimelineError, UnitKind,
};

fn parity_config() -> TimelineConfig {
    TimelineConfig {
        duration: Some(2.0),
        padding_head_seconds: 0.1,
        padding_tail_seconds: 0.1,
        source_end: 2.0,
        anchors: vec![
            SyncAnchor {
                data_seconds: 5.0,
                video_seconds: 12.4,
            },
            SyncAnchor {
                data_seconds: 105.0,
                video_seconds: 112.5,
            },
        ],
        ..TimelineConfig::default()
    }
}

#[test]
fn timeline_matches_python_padding_and_anchor_rules() {
    let timeline = build_timeline(&parity_config()).unwrap();
    assert_eq!(timeline.width, 2560);
    assert_eq!(timeline.height, 1440);
    assert_eq!(timeline.fps, 100);
    assert_eq!(timeline.render_fps, 20);
    assert_eq!(timeline.head_frames, 10);
    assert_eq!(timeline.content_frames, 200);
    assert_eq!(timeline.tail_frames, 10);
    assert_eq!(timeline.frame_count, 220);
    assert!((timeline.alignment.scale - 1.001).abs() < 1e-12);
    assert!((timeline.alignment.offset_seconds - 7.395).abs() < 1e-12);
    assert!((timeline.frame_time(10) - 0.1).abs() < 1e-12);
    assert!((timeline.data_time(10) - (-7.387612387612388)).abs() < 1e-12);
    assert!(!timeline.overlay_active(0));
    assert!(timeline.overlay_active(10));
    assert!(!timeline.overlay_active(210));
}

#[test]
fn render_indices_and_timecodes_match_python() {
    assert_eq!(
        render_indices(1000, 100, 20).unwrap(),
        (0..1000).step_by(5).collect::<Vec<_>>()
    );
    assert_eq!(parse_seconds("00:00:12:10", 25.).unwrap(), 12.4);
    assert_eq!(parse_seconds("01:02:03.5", 100.).unwrap(), 3723.5);
    assert_eq!(
        parse_seconds("1:02.5", 100.),
        Err(TimelineError::InvalidTimecode)
    );
    assert_eq!(
        parse_seconds("00:00:12:10", 29.97),
        Err(TimelineError::InvalidTimecode)
    );
    assert_eq!(
        parse_seconds("00:61:00", 100.),
        Err(TimelineError::InvalidTimecode)
    );
}

#[test]
fn non_default_dimensions_and_fps_are_valid_configurations() {
    let config = TimelineConfig {
        width: 1920,
        height: 1080,
        fps: 60,
        render_fps: 20,
        duration: Some(1.),
        source_end: 1.,
        ..TimelineConfig::default()
    };
    let timeline = build_timeline(&config).unwrap();
    assert_eq!(
        (
            timeline.width,
            timeline.height,
            timeline.fps,
            timeline.render_fps
        ),
        (1920, 1080, 60, 20)
    );
    assert_eq!(timeline.frame_count, 660);
}

#[test]
fn invalid_fps_divisibility_is_rejected() {
    let config = TimelineConfig {
        fps: 59,
        render_fps: 20,
        duration: Some(1.),
        source_end: 1.,
        ..TimelineConfig::default()
    };
    assert_eq!(
        solve_alignment(&config),
        Err(TimelineError::InvalidRenderFps)
    );
}

#[test]
fn bindings_match_python_resolution_and_interpolation_rules() {
    let columns = vec![
        "FL Motor Torque".to_string(),
        "VehSpd".to_string(),
        "Motor Torque FL".to_string(),
    ];
    assert_eq!(
        resolve_candidate(&["VehSpd".into()], &columns).unwrap(),
        Some("VehSpd".into())
    );
    assert_eq!(
        resolve_candidate(&["FL Torque".into()], &columns).unwrap(),
        None
    );
    assert_eq!(
        resolve_candidate(&["Motor Torque FL".into()], &columns).unwrap(),
        Some("Motor Torque FL".into())
    );

    let series = SampleSeries {
        times: vec![0., 1., 1., 2., 5.],
        values: vec![0., 10., 14., 20., 50.],
    };
    let sampler = SeriesSampler::default()
        .with_kind("VehSpd".into(), "m/s".into(), series, UnitKind::Speed)
        .unwrap();
    let config = BindingConfig {
        slots: [("speed".into(), "VehSpd".into())].into_iter().collect(),
        max_gap_seconds: 2.0,
    };
    let timeline = build_timeline(&TimelineConfig {
        duration: Some(1.),
        source_end: 2.,
        padding_head_seconds: 0.,
        padding_tail_seconds: 0.,
        ..TimelineConfig::default()
    })
    .unwrap();
    let frame = sample_frame(&sampler, &timeline, 50, &config).unwrap();
    assert!((frame.speed_kmh - 21.6).abs() < 1e-5);
    let gap_config = BindingConfig {
        max_gap_seconds: 1.0,
        ..config
    };
    let timeline_gap = build_timeline(&TimelineConfig {
        duration: Some(4.),
        source_end: 5.,
        padding_head_seconds: 0.,
        padding_tail_seconds: 0.,
        ..TimelineConfig::default()
    })
    .unwrap();
    let gap_frame = sample_frame(&sampler, &timeline_gap, 300, &gap_config).unwrap();
    assert!(gap_frame.speed_kmh.is_nan());
}
