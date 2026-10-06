use overlay::{render_png_with_config, render_rgba, DemoFrame, OverlayFrame, RenderConfig};

#[test]
fn renderer_accepts_configured_canvas_sizes_and_raw_rgba_frames() {
    let config = RenderConfig {
        width: 1920,
        height: 1080,
    };
    let frame = OverlayFrame {
        video_time: 1.,
        data_time: 1.,
        active: true,
        speed_kmh: 80.,
        soc_percent: 72.,
        voltage: 557.,
        power_kw: 11.,
        current_a: 69.,
        steer_deg: 4.,
        throttle_percent: 25.,
        brake_percent: 0.,
        g_x: 0.2,
        g_y: -0.1,
        gps_latitude: f32::NAN,
        gps_longitude: f32::NAN,
        torque_nm: [2., 2., 3., 3.],
        rpm: [1000., 1000., 1200., 1200.],
    };
    let rgba = render_rgba(&frame, config).unwrap();
    assert_eq!(rgba.len(), 1920 * 1080 * 4);
    assert!(rgba.chunks_exact(4).any(|pixel| pixel[3] > 0));

    let path = std::env::temp_dir().join(format!("overlay-configured-{}.png", std::process::id()));
    let report = render_png_with_config(&path, DemoFrame::sample(), config).unwrap();
    assert_eq!((report.width, report.height), (1920, 1080));
    assert!(report.bytes.starts_with(b"\x89PNG"));
    let _ = std::fs::remove_file(path);
}
