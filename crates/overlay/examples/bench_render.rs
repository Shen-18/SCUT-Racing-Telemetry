use overlay::{render_rgba, OverlayFrame, RenderConfig};
use std::{sync::Arc, thread, time::Instant};

fn main() {
    let frame = Arc::new(OverlayFrame {
        video_time: 1.0,
        data_time: 1.0,
        active: true,
        speed_kmh: 80.0,
        soc_percent: 70.0,
        voltage: 550.0,
        power_kw: 20.0,
        current_a: 40.0,
        steer_deg: 3.0,
        throttle_percent: 40.0,
        brake_percent: 0.0,
        g_x: 0.2,
        g_y: -0.1,
        gps_latitude: f32::NAN,
        gps_longitude: f32::NAN,
        torque_nm: [2.0; 4],
        rpm: [1000.0; 4],
    });
    let config = RenderConfig {
        width: 2560,
        height: 1440,
    };
    for workers in [1usize, 4, 8] {
        let start = Instant::now();
        let mut handles = Vec::new();
        for _ in 0..workers {
            let frame = Arc::clone(&frame);
            handles.push(thread::spawn(move || {
                for _ in 0..5 {
                    let _ = render_rgba(&frame, config).unwrap();
                }
            }));
        }
        for handle in handles {
            handle.join().unwrap();
        }
        let elapsed = start.elapsed().as_secs_f64();
        println!(
            "workers={workers} frames={} elapsed={elapsed:.3}s fps={:.2}",
            workers * 5,
            workers as f64 * 5.0 / elapsed
        );
    }
}
