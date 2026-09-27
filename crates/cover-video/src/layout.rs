pub const CANVAS_WIDTH: u32 = 2560;
pub const CANVAS_HEIGHT: u32 = 1440;
pub const WHITE: [u8; 4] = [255, 255, 255, 255];
pub const GREEN: [u8; 4] = [0, 232, 54, 255];
pub const RED: [u8; 4] = [255, 64, 48, 255];

#[derive(Clone, Copy)]
pub struct DemoFrame {
    pub time_seconds: f32,
    pub speed_kmh: f32,
    pub soc_percent: f32,
    pub voltage: f32,
    pub power_kw: f32,
    pub current_a: f32,
    pub steer_deg: f32,
    pub throttle_percent: f32,
    pub brake_percent: f32,
    pub g_x: f32,
    pub g_y: f32,
    pub torque_nm: [f32; 4],
}
impl DemoFrame {
    pub const fn sample() -> Self {
        Self {
            time_seconds: 65.4,
            speed_kmh: 50.0,
            soc_percent: f32::NAN,
            voltage: 557.0,
            power_kw: 11.5,
            current_a: 69.6,
            steer_deg: 83.0,
            throttle_percent: 25.0,
            brake_percent: 16.0,
            g_x: 0.54,
            g_y: -0.25,
            torque_nm: [2.4, 2.1, 4.4, 4.4],
        }
    }
}
