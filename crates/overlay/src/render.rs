use crate::{
    bindings::{GpsRoute, OverlayFrame},
    layout::{DemoFrame, RenderConfig, GREEN, RED, WHITE},
};
use ab_glyph::{point, Font, FontArc, PxScale, ScaleFont};
use std::{
    collections::HashMap,
    f32::consts::PI,
    fs,
    io::Cursor,
    path::Path,
    sync::{Mutex, OnceLock},
};
use thiserror::Error;
use tiny_skia::{Color, FillRule, Paint, PathBuilder, Pixmap, PixmapPaint, Stroke, Transform};
const LOGO: &[u8] = include_bytes!("../assets/logo_white.png");
const REG: &[u8] = include_bytes!("../assets/Formula1-Display-Regular.ttf");
const BOLD: &[u8] = include_bytes!("../assets/Formula1-Display-Bold.ttf");
const SECTIONS: [f32; 8] = [0., 305., 600., 800., 1215., 1371., 1570., 1920.];
const GPS_BASE_WIDTH: f64 = 285.;
const GPS_BASE_HEIGHT: f64 = 158.;

#[derive(Debug, Clone, Default)]
pub struct RenderContext {
    pub gps: Option<GpsGeometry>,
    pub vehicle: String,
    pub racer: String,
}

#[derive(Debug, Clone, Default)]
pub struct GpsGeometry {
    pub points: Vec<(f32, f32)>,
    raw_points: Vec<(f64, f64)>,
    origin_lat: f64,
    origin_lon: f64,
    scale: f64,
    center_x: f64,
    center_y: f64,
    map_width: f64,
    map_height: f64,
}

impl GpsGeometry {
    pub fn from_route(route: &GpsRoute) -> Option<Self> {
        if route.points.len() < 2 {
            return None;
        }
        let origin_lat = median(route.points.iter().map(|point| point.latitude));
        let origin_lon = median(route.points.iter().map(|point| point.longitude));
        let latitude_factor = origin_lat.to_radians().cos();
        let raw: Vec<(f64, f64)> = route
            .points
            .iter()
            .map(|point| {
                (
                    (point.longitude - origin_lon) * 111_320. * latitude_factor,
                    -(point.latitude - origin_lat) * 111_320.,
                )
            })
            .collect();
        let mut geometry = Self {
            points: Vec::new(),
            raw_points: raw,
            origin_lat,
            origin_lon,
            scale: 1.,
            center_x: 0.,
            center_y: 0.,
            map_width: GPS_BASE_WIDTH,
            map_height: GPS_BASE_HEIGHT,
        };
        geometry.refit_for_map(GPS_BASE_WIDTH, GPS_BASE_HEIGHT);
        Some(geometry)
    }

    /// Refit the complete route into the exact available map rectangle.
    /// Python recomputes this for `(w, h)` on the bottom bar, so the Rust
    /// renderer must not stretch a fixed 285×158 normalization into it.
    pub fn refit_for_map(&mut self, width: f64, height: f64) {
        if self.raw_points.is_empty() || width <= 0. || height <= 0. {
            return;
        }
        let min_x = self
            .raw_points
            .iter()
            .map(|point| point.0)
            .fold(f64::INFINITY, f64::min);
        let max_x = self
            .raw_points
            .iter()
            .map(|point| point.0)
            .fold(f64::NEG_INFINITY, f64::max);
        let min_y = self
            .raw_points
            .iter()
            .map(|point| point.1)
            .fold(f64::INFINITY, f64::min);
        let max_y = self
            .raw_points
            .iter()
            .map(|point| point.1)
            .fold(f64::NEG_INFINITY, f64::max);
        let span_x = (max_x - min_x).max(1e-6);
        let span_y = (max_y - min_y).max(1e-6);
        self.scale = ((width - 8.) / span_x).min((height - 8.) / span_y);
        self.center_x = (max_x + min_x) / 2.;
        self.center_y = (max_y + min_y) / 2.;
        self.map_width = width;
        self.map_height = height;
        self.points = self
            .raw_points
            .iter()
            .map(|point| {
                (
                    ((point.0 - self.center_x) * self.scale + width / 2.) as f32 / width as f32,
                    ((point.1 - self.center_y) * self.scale + height / 2.) as f32 / height as f32,
                )
            })
            .collect();
    }

    fn project(&self, latitude: f32, longitude: f32) -> Option<(f32, f32)> {
        if !latitude.is_finite() || !longitude.is_finite() {
            return None;
        }
        let latitude_factor = self.origin_lat.to_radians().cos();
        let x = (longitude as f64 - self.origin_lon) * 111_320. * latitude_factor;
        let y = -(latitude as f64 - self.origin_lat) * 111_320.;
        Some((
            ((x - self.center_x) * self.scale + self.map_width / 2.) as f32 / self.map_width as f32,
            ((y - self.center_y) * self.scale + self.map_height / 2.) as f32
                / self.map_height as f32,
        ))
    }
}

/// Exact map size from the Python bottom-bar layout for a render canvas.
pub fn gps_map_size(config: RenderConfig) -> (f64, f64) {
    let scale = config.width as f64 / 1920.;
    let section_width = 305. * scale;
    let padding = 15. * scale;
    let bar_height = 172. * scale;
    (
        (285. * scale).min(section_width - 2. * padding),
        (158. * scale).min(bar_height - 26. * scale),
    )
}

fn median(values: impl Iterator<Item = f64>) -> f64 {
    let mut values: Vec<f64> = values.collect();
    values.sort_by(f64::total_cmp);
    let middle = values.len() / 2;
    if values.len() % 2 == 0 {
        (values[middle - 1] + values[middle]) / 2.0
    } else {
        values[middle]
    }
}

struct RenderAssets {
    regular: FontArc,
    bold: FontArc,
}

static RENDER_ASSETS: OnceLock<RenderAssets> = OnceLock::new();

fn render_assets() -> &'static RenderAssets {
    RENDER_ASSETS.get_or_init(|| RenderAssets {
        regular: FontArc::try_from_slice(REG).expect("embedded regular font is valid"),
        bold: FontArc::try_from_slice(BOLD).expect("embedded bold font is valid"),
    })
}

static LOGO_SOURCE: OnceLock<Pixmap> = OnceLock::new();
static LOGO_SIZES: OnceLock<Mutex<HashMap<u32, Pixmap>>> = OnceLock::new();

fn logo_source() -> &'static Pixmap {
    LOGO_SOURCE.get_or_init(|| {
        let decoder = png::Decoder::new(Cursor::new(LOGO));
        let mut reader = decoder.read_info().expect("embedded logo is valid");
        let mut buffer = vec![0; reader.output_buffer_size()];
        let info = reader
            .next_frame(&mut buffer)
            .expect("embedded logo decodes");
        let mut pixels = Vec::with_capacity(info.buffer_size());
        for pixel in buffer[..info.buffer_size()].chunks_exact(4) {
            let alpha = pixel[3] as u16;
            pixels.extend([
                ((pixel[0] as u16 * alpha + 127) / 255) as u8,
                ((pixel[1] as u16 * alpha + 127) / 255) as u8,
                ((pixel[2] as u16 * alpha + 127) / 255) as u8,
                pixel[3],
            ]);
        }
        let size = tiny_skia::IntSize::from_wh(info.width, info.height)
            .expect("embedded logo has a valid size");
        Pixmap::from_vec(pixels, size).expect("embedded logo pixels are valid")
    })
}
#[derive(Debug, Error)]
pub enum RenderError {
    #[error("create output: {0}")]
    CreateOutput(#[source] std::io::Error),
    #[error("encode png: {0}")]
    Encode(String),
    #[error("write png: {0}")]
    Write(#[source] std::io::Error),
    #[error("asset: {0}")]
    Asset(String),
}
#[derive(Debug, Clone)]
pub struct RenderReport {
    pub width: u32,
    pub height: u32,
    pub bytes: Vec<u8>,
}
pub fn render_demo_png(path: impl AsRef<Path>) -> Result<RenderReport, RenderError> {
    render_png(path, DemoFrame::sample())
}

pub fn render_png(path: impl AsRef<Path>, f: DemoFrame) -> Result<RenderReport, RenderError> {
    render_png_with_config(path, f, RenderConfig::default())
}

pub fn render_png_with_config(
    path: impl AsRef<Path>,
    f: DemoFrame,
    config: RenderConfig,
) -> Result<RenderReport, RenderError> {
    render_png_with_context(path, f, config, &RenderContext::default())
}

pub fn render_png_with_context(
    path: impl AsRef<Path>,
    f: DemoFrame,
    config: RenderConfig,
    context: &RenderContext,
) -> Result<RenderReport, RenderError> {
    let pm = draw_frame(&f, config, context)?;
    let bytes = pm
        .encode_png()
        .map_err(|e| RenderError::Encode(e.to_string()))?;
    if let Some(parent) = path.as_ref().parent() {
        fs::create_dir_all(parent).map_err(RenderError::CreateOutput)?;
    }
    fs::write(path, &bytes).map_err(RenderError::Write)?;
    Ok(RenderReport {
        width: config.width,
        height: config.height,
        bytes,
    })
}

pub fn render_rgba(frame: &OverlayFrame, config: RenderConfig) -> Result<Vec<u8>, RenderError> {
    render_rgba_with_context(frame, config, &RenderContext::default())
}

pub fn render_rgba_with_context(
    frame: &OverlayFrame,
    config: RenderConfig,
    context: &RenderContext,
) -> Result<Vec<u8>, RenderError> {
    let demo = DemoFrame {
        time_seconds: frame.video_time,
        speed_kmh: frame.speed_kmh,
        soc_percent: frame.soc_percent,
        voltage: frame.voltage,
        power_kw: frame.power_kw,
        current_a: frame.current_a,
        steer_deg: frame.steer_deg,
        throttle_percent: frame.throttle_percent,
        brake_percent: frame.brake_percent,
        g_x: frame.g_x,
        g_y: frame.g_y,
        gps_latitude: frame.gps_latitude,
        gps_longitude: frame.gps_longitude,
        torque_nm: frame.torque_nm,
    };
    render_rgba_with_context_for_demo(&demo, config, context)
}

pub fn render_overlay_png_with_context(
    path: impl AsRef<Path>,
    frame: &OverlayFrame,
    config: RenderConfig,
    context: &RenderContext,
) -> Result<RenderReport, RenderError> {
    let demo = DemoFrame {
        time_seconds: frame.video_time,
        speed_kmh: frame.speed_kmh,
        soc_percent: frame.soc_percent,
        voltage: frame.voltage,
        power_kw: frame.power_kw,
        current_a: frame.current_a,
        steer_deg: frame.steer_deg,
        throttle_percent: frame.throttle_percent,
        brake_percent: frame.brake_percent,
        g_x: frame.g_x,
        g_y: frame.g_y,
        gps_latitude: frame.gps_latitude,
        gps_longitude: frame.gps_longitude,
        torque_nm: frame.torque_nm,
    };
    let pm = draw_frame(&demo, config, context)?;
    let bytes = pm
        .encode_png()
        .map_err(|error| RenderError::Encode(error.to_string()))?;
    if let Some(parent) = path.as_ref().parent() {
        fs::create_dir_all(parent).map_err(RenderError::CreateOutput)?;
    }
    fs::write(path, &bytes).map_err(RenderError::Write)?;
    Ok(RenderReport {
        width: config.width,
        height: config.height,
        bytes,
    })
}

pub fn render_rgba_with_config(
    frame: &DemoFrame,
    config: RenderConfig,
) -> Result<Vec<u8>, RenderError> {
    render_rgba_with_context_for_demo(frame, config, &RenderContext::default())
}

fn render_rgba_with_context_for_demo(
    frame: &DemoFrame,
    config: RenderConfig,
    context: &RenderContext,
) -> Result<Vec<u8>, RenderError> {
    // tiny-skia stores premultiplied RGBA; FFmpeg expects straight RGBA.
    let mut pixels = draw_frame(frame, config, context)?.data().to_vec();
    for pixel in pixels.chunks_exact_mut(4) {
        let alpha = pixel[3] as u32;
        if alpha > 0 && alpha < 255 {
            for component in &mut pixel[..3] {
                *component = ((*component as u32 * 255 + alpha / 2) / alpha).min(255) as u8;
            }
        }
    }
    Ok(pixels)
}

#[cfg(test)]
mod tests {
    use super::{display_name, fmt_clock, fmt_num, gforce_labels, median};

    #[test]
    fn missing_numbers_are_rendered_as_an_em_dash() {
        assert_eq!(fmt_num(f32::NAN, 1), "—");
        assert_eq!(fmt_num(f32::INFINITY, 0), "—");
    }

    #[test]
    fn gforce_labels_use_the_current_frame_values() {
        assert_eq!(
            gforce_labels(0.812, -0.437),
            ("X 0.81".into(), "-0.44".into())
        );
    }

    #[test]
    fn missing_clock_is_rendered_as_an_em_dash() {
        assert_eq!(fmt_clock(f32::NAN), "—");
    }

    #[test]
    fn empty_metadata_name_is_rendered_as_an_em_dash() {
        assert_eq!(display_name(" SCUT-24 "), "SCUT-24");
        assert_eq!(display_name(""), "—");
    }

    #[test]
    fn gps_median_matches_numpy_for_even_routes() {
        assert_eq!(median([1.0, 3.0].into_iter()), 2.0);
    }
}

fn draw_frame(
    frame: &DemoFrame,
    config: RenderConfig,
    context: &RenderContext,
) -> Result<Pixmap, RenderError> {
    if !config.validate() {
        return Err(RenderError::Asset("invalid render dimensions".into()));
    }
    let mut pm = Pixmap::new(config.width, config.height)
        .ok_or_else(|| RenderError::Asset("canvas".into()))?;
    let assets = render_assets();
    let reg = &assets.regular;
    let bold = &assets.bold;
    let s = config.width as f32 / 1920.;
    draw_logo(&mut pm, s)?;
    timing(
        &mut pm,
        s,
        *frame,
        config.width as f32,
        &reg,
        &bold,
        context,
    );
    bottom(
        &mut pm,
        s,
        *frame,
        config.width as f32,
        config.height as f32,
        reg,
        bold,
        context,
    );
    Ok(pm)
}

fn p(c: [u8; 4]) -> Paint<'static> {
    let mut x = Paint::default();
    x.set_color(Color::from_rgba8(c[0], c[1], c[2], c[3]));
    x.anti_alias = true;
    x
}
fn col(g: u8, a: f32) -> [u8; 4] {
    [g, g, g, a.clamp(0., 255.) as u8]
}
fn alpha(c: [u8; 4], o: f32) -> [u8; 4] {
    [c[0], c[1], c[2], (c[3] as f32 * o).clamp(0., 255.) as u8]
}
fn rect(pm: &mut Pixmap, x: f32, y: f32, w: f32, h: f32, c: [u8; 4]) {
    if let Some(r) = tiny_skia::Rect::from_xywh(x, y, w, h) {
        pm.fill_rect(r, &p(c), Transform::identity(), None)
    }
}
fn rect_outline(pm: &mut Pixmap, x: f32, y: f32, w: f32, h: f32, width: f32, c: [u8; 4]) {
    if let Some(r) = tiny_skia::Rect::from_xywh(x, y, w, h) {
        let mut q = PathBuilder::new();
        q.push_rect(r);
        if let Some(q) = q.finish() {
            pm.stroke_path(
                &q,
                &p(c),
                &Stroke {
                    width,
                    ..Default::default()
                },
                Transform::identity(),
                None,
            );
        }
    }
}
fn round(
    pm: &mut Pixmap,
    x: f32,
    y: f32,
    w: f32,
    h: f32,
    r: f32,
    fill: [u8; 4],
    outline: [u8; 4],
    width: f32,
) {
    let k = 0.5522848;
    let mut q = PathBuilder::new();
    q.move_to(x + r, y);
    q.line_to(x + w - r, y);
    q.cubic_to(x + w - r + k * r, y, x + w, y + r - k * r, x + w, y + r);
    q.line_to(x + w, y + h - r);
    q.cubic_to(
        x + w,
        y + h - r + k * r,
        x + w - r + k * r,
        y + h,
        x + w - r,
        y + h,
    );
    q.line_to(x + r, y + h);
    q.cubic_to(x + r - k * r, y + h, x, y + h - r + k * r, x, y + h - r);
    q.line_to(x, y + r);
    q.cubic_to(x, y + r - k * r, x + r - k * r, y, x + r, y);
    q.close();
    if let Some(q) = q.finish() {
        pm.fill_path(&q, &p(fill), FillRule::Winding, Transform::identity(), None);
        pm.stroke_path(
            &q,
            &p(outline),
            &Stroke {
                width,
                ..Default::default()
            },
            Transform::identity(),
            None,
        )
    }
}
fn line(pm: &mut Pixmap, a: (f32, f32), b: (f32, f32), w: f32, c: [u8; 4]) {
    let mut q = PathBuilder::new();
    q.move_to(a.0, a.1);
    q.line_to(b.0, b.1);
    if let Some(q) = q.finish() {
        pm.stroke_path(
            &q,
            &p(c),
            &Stroke {
                width: w,
                ..Default::default()
            },
            Transform::identity(),
            None,
        )
    }
}

fn polyline(pm: &mut Pixmap, points: impl IntoIterator<Item = (f32, f32)>, w: f32, c: [u8; 4]) {
    let mut path = PathBuilder::new();
    let mut has_point = false;
    for point in points {
        if has_point {
            path.line_to(point.0, point.1);
        } else {
            path.move_to(point.0, point.1);
            has_point = true;
        }
    }
    if let Some(path) = path.finish() {
        pm.stroke_path(
            &path,
            &p(c),
            &Stroke {
                width: w,
                ..Default::default()
            },
            Transform::identity(),
            None,
        );
    }
}
fn ellipse(pm: &mut Pixmap, cx: f32, cy: f32, rx: f32, ry: f32, c: [u8; 4], fill: bool, w: f32) {
    if let Some(r) = tiny_skia::Rect::from_xywh(cx - rx, cy - ry, rx * 2., ry * 2.) {
        let mut q = PathBuilder::new();
        q.push_oval(r);
        if let Some(q) = q.finish() {
            if fill {
                pm.fill_path(&q, &p(c), FillRule::Winding, Transform::identity(), None)
            } else {
                pm.stroke_path(
                    &q,
                    &p(c),
                    &Stroke {
                        width: w,
                        ..Default::default()
                    },
                    Transform::identity(),
                    None,
                )
            }
        }
    }
}
fn arc(pm: &mut Pixmap, cx: f32, cy: f32, r: f32, a0: f32, a1: f32, w: f32, c: [u8; 4]) {
    let mut q = PathBuilder::new();
    let n = ((a1 - a0).abs() / 10.).ceil() as usize;
    for i in 0..=n {
        let a = (a0 + (a1 - a0) * i as f32 / n as f32) * PI / 180.;
        let z = (cx + r * a.cos(), cy + r * a.sin());
        if i == 0 {
            q.move_to(z.0, z.1)
        } else {
            q.line_to(z.0, z.1)
        }
    }
    if let Some(q) = q.finish() {
        pm.stroke_path(
            &q,
            &p(c),
            &Stroke {
                width: w,
                ..Default::default()
            },
            Transform::identity(),
            None,
        )
    }
}
#[derive(Clone, Copy)]
enum A {
    LA,
    LS,
    LM,
    MA,
    MM,
    MT,
    RA,
    RM,
}
fn tw(f: &FontArc, t: &str, z: f32) -> f32 {
    let s = f.as_scaled(PxScale::from(z));
    t.chars().map(|c| s.h_advance(s.glyph_id(c))).sum()
}
fn fmt_num(v: f32, d: usize) -> String {
    if v.is_finite() {
        format!("{v:.d$}")
    } else {
        "—".into()
    }
}

fn display_name(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        "—".into()
    } else {
        trimmed.into()
    }
}

fn gforce_labels(g_x: f32, g_y: f32) -> (String, String) {
    (format!("X {}", fmt_num(g_x, 2)), fmt_num(g_y, 2))
}
fn fmt_clock(v: f32) -> String {
    if !v.is_finite() || v < 0. {
        return "—".into();
    }
    let m = (v / 60.).floor() as u32;
    format!("{m}:{:04.1}", v - m as f32 * 60.)
}

fn fmt_steer(v: f32) -> String {
    if v.is_finite() {
        format!("{v:+.0}°")
    } else {
        "—".into()
    }
}

fn finite_or_zero(value: f32) -> f32 {
    if value.is_finite() {
        value
    } else {
        0.
    }
}
fn text(
    pm: &mut Pixmap,
    f: &FontArc,
    t: &str,
    z: f32,
    x: f32,
    y: f32,
    c: [u8; 4],
    a: A,
    shadow: bool,
) {
    let s = f.as_scaled(PxScale::from(z));
    let w = tw(f, t, z);
    let xx = match a {
        A::LA | A::LS | A::LM => x,
        A::MA | A::MM | A::MT => x - w / 2.,
        A::RA | A::RM => x - w,
    };
    let base = match a {
        A::LS => y,
        A::LA | A::MA | A::RA | A::MT => y + s.ascent(),
        _ => y + (s.ascent() + s.descent()) / 2.,
    };
    if shadow {
        glyphs(pm, f, t, z, xx + 0.8, base + 0.8, [0, 0, 0, 110]);
    }
    glyphs(pm, f, t, z, xx, base, c)
}
fn glyphs(pm: &mut Pixmap, f: &FontArc, t: &str, z: f32, x: f32, b: f32, c: [u8; 4]) {
    let s = f.as_scaled(PxScale::from(z));
    let mut pen = x;
    for ch in t.chars() {
        let mut g = s.scaled_glyph(ch);
        g.position = point(pen, b);
        if let Some(o) = f.outline_glyph(g) {
            let bb = o.px_bounds();
            o.draw(|gx, gy, v| {
                let x = bb.min.x as i32 + gx as i32;
                let y = bb.min.y as i32 + gy as i32;
                if x >= 0 && y >= 0 && x < pm.width() as i32 && y < pm.height() as i32 {
                    let i = ((y as u32 * pm.width() + x as u32) * 4) as usize;
                    let d = pm.data_mut();
                    let sa = (c[3] as f32 * v) as u16;
                    let inv = 255 - sa;
                    d[i] = (((c[0] as u16 * sa) + (d[i] as u16 * inv)) / 255) as u8;
                    d[i + 1] = (((c[1] as u16 * sa) + (d[i + 1] as u16 * inv)) / 255) as u8;
                    d[i + 2] = (((c[2] as u16 * sa) + (d[i + 2] as u16 * inv)) / 255) as u8;
                    d[i + 3] = (sa + (d[i + 3] as u16 * inv) / 255).min(255) as u8;
                }
            })
        }
        pen += s.h_advance(s.glyph_id(ch))
    }
}
fn draw_logo(pm: &mut Pixmap, s: f32) -> Result<(), RenderError> {
    let source = logo_source();
    let h = (56. * s).round() as u32;
    let cache = LOGO_SIZES.get_or_init(|| Mutex::new(HashMap::new()));
    let mut cache = cache
        .lock()
        .map_err(|_| RenderError::Asset("logo cache poisoned".into()))?;
    let out = cache.entry(h).or_insert_with(|| {
        let w = (source.width() as f32 * h as f32 / source.height() as f32).round() as u32;
        let mut scaled = Pixmap::new(w, h).expect("logo target has a valid size");
        scaled.draw_pixmap(
            0,
            0,
            source.as_ref(),
            &PixmapPaint::default(),
            Transform::from_scale(
                h as f32 / source.height() as f32,
                h as f32 / source.height() as f32,
            ),
            None,
        );
        scaled
    });
    pm.draw_pixmap(
        (60. * s) as i32,
        (48. * s) as i32,
        out.as_ref(),
        &PixmapPaint {
            opacity: 0.95,
            ..Default::default()
        },
        Transform::identity(),
        None,
    );
    Ok(())
}
fn timing(
    pm: &mut Pixmap,
    s: f32,
    f: DemoFrame,
    canvas_width: f32,
    reg: &FontArc,
    bold: &FontArc,
    context: &RenderContext,
) {
    let x = canvas_width - 60. * s - 370. * s;
    let y = 48. * s;
    let w = 370. * s;
    let h = 60. * s;
    round(pm, x, y, w, h, 10. * s, [8, 10, 14, 86], col(255, 52.), s);
    text(
        pm,
        reg,
        "TIME",
        10. * s,
        x + 22. * s,
        y + 10. * s,
        col(255, 132.),
        A::LA,
        true,
    );
    line(
        pm,
        (x + w - 170. * s, y + 12. * s),
        (x + w - 170. * s, y + h - 12. * s),
        s,
        col(255, 42.),
    );
    text(
        pm,
        reg,
        &display_name(&context.vehicle),
        15. * s,
        x + w - 22. * s,
        y + 15. * s,
        col(255, 197.),
        A::RA,
        true,
    );
    text(
        pm,
        reg,
        &display_name(&context.racer),
        15. * s,
        x + w - 22. * s,
        y + 37. * s,
        col(255, 150.),
        A::RA,
        true,
    );
    let clock = fmt_clock(f.time_seconds);
    text(
        pm,
        bold,
        &clock,
        37. * s,
        x + 22. * s,
        y + h / 2. + 8. * s,
        WHITE,
        A::LM,
        true,
    )
}
fn bottom(
    pm: &mut Pixmap,
    s: f32,
    f: DemoFrame,
    canvas_width: f32,
    canvas_height: f32,
    reg: &FontArc,
    bold: &FontArc,
    context: &RenderContext,
) {
    let o = 0.95;
    let h = 172. * s;
    let oy = canvas_height - h;
    let top = oy + 12. * s;
    let ch = h - 32. * s;
    let ty = oy + h - 20. * s;
    let p = 15. * s;
    rect(pm, 0., oy, canvas_width, h, [8, 10, 14, 95]);
    line(pm, (0., oy), (canvas_width, oy), s, col(57, 242.));
    let e = |i: usize| SECTIONS[i] * s;
    for (i, extra) in [(1, 0.), (2, 0.), (3, 0.), (4, 10.), (5, 0.), (6, 0.)] {
        line(
            pm,
            (e(i) + extra * s, top - 2. * s),
            (e(i) + extra * s, oy + h - 30. * s),
            s,
            col(235, 38.),
        );
    }
    // GPS: the route is built once from every finite raw sample. Only the
    // current position is projected per frame.
    let x0 = e(0);
    let x1 = e(1);
    let mw = (285. * s).min(x1 - x0 - 2. * p);
    let mh = (158. * s).min(h - 26. * s);
    let mx = x0 + p + (x1 - x0 - 2. * p - mw) / 2.;
    let my = top + (h - 16. * s - mh) / 2.;
    if let Some(gps) = &context.gps {
        polyline(
            pm,
            gps.points
                .iter()
                .map(|point| (mx + point.0 * mw, my + point.1 * mh)),
            2. * s,
            col(157, 242.),
        );
        if let Some((x, y)) = gps.project(f.gps_latitude, f.gps_longitude) {
            ellipse(
                pm,
                mx + x * mw,
                my + y * mh,
                3. * s,
                3. * s,
                alpha(RED, o),
                true,
                0.,
            );
        }
    }
    // battery
    let x0 = e(1);
    let x1 = e(2);
    let cw = 116. * s;
    let bx = x0 + (x1 - x0 - cw - 76. * s) / 2.;
    let rh = (ch - 4. * s) / 2.;
    for (k, t) in ["SOC", "VOLT", "POWER", "CURRENT"].iter().enumerate() {
        text(
            pm,
            reg,
            t,
            12. * s,
            bx + (k % 2) as f32 * cw,
            top + 10. * s + (k / 2) as f32 * rh,
            col(138, 242.),
            A::LA,
            true,
        )
    }
    let values = [
        (fmt_num(f.soc_percent, 0), "%"),
        (fmt_num(f.voltage, 1), "V"),
        (fmt_num(f.power_kw, 1), "kW"),
        (fmt_num(f.current_a, 1), "A"),
    ];
    for (k, (v, u)) in values.iter().enumerate() {
        let x = bx + (k % 2) as f32 * cw;
        let y = top + 10. * s + (k / 2) as f32 * rh;
        text(pm, bold, v, 26. * s, x, y + 15. * s, WHITE, A::LA, true);
        text(
            pm,
            reg,
            u,
            12. * s,
            x + tw(bold, v, 26. * s) + 6. * s,
            y + 27. * s,
            col(142, 242.),
            A::LS,
            true,
        )
    }
    text(
        pm,
        reg,
        "BATTERY",
        12.0 * s,
        (x0 + x1) / 2.,
        ty,
        col(152, 145.),
        A::MA,
        true,
    );
    // steer
    let x0 = e(2);
    let x1 = e(3);
    let r = 50. * s;
    let cx = (x0 + x1) / 2.;
    let cy = top + ch / 2. - 3. * s;
    arc(pm, cx, cy, r, 110., 430., 4. * s, col(71, 242.));
    for t in [-1., -0.5, 0., 0.5, 1.] {
        let a = (270. - t * 160.) * PI / 180.;
        line(
            pm,
            (cx + (r - 7. * s) * a.cos(), cy + (r - 7. * s) * a.sin()),
            (cx + r * a.cos(), cy + r * a.sin()),
            s,
            col(114, 242.),
        )
    }
    text(
        pm,
        reg,
        "L",
        11. * s,
        cx - r - 6. * s,
        cy,
        col(124, 242.),
        A::RM,
        true,
    );
    text(
        pm,
        reg,
        "R",
        11. * s,
        cx + r + 6. * s,
        cy,
        col(124, 242.),
        A::LM,
        true,
    );
    text(
        pm,
        reg,
        "STEER",
        12.0 * s,
        cx,
        ty,
        col(152, 145.),
        A::MA,
        true,
    );
    let steer = finite_or_zero(f.steer_deg);
    let a = (270. - (steer / 160.) * 160.) * PI / 180.;
    let px = cx + r * a.cos();
    let py = cy + r * a.sin();
    arc(
        pm,
        cx,
        cy,
        r,
        270.,
        270. - steer / 160. * 160.,
        4. * s,
        alpha(GREEN, o),
    );
    ellipse(pm, px, py, 4. * s, 4. * s, alpha(GREEN, o), true, 0.);
    text(
        pm,
        bold,
        &fmt_steer(f.steer_deg),
        22. * s,
        cx,
        cy + 2. * s,
        WHITE,
        A::MM,
        true,
    );
    // speed
    let x0 = e(3);
    let x1 = e(4);
    let fs = 80. * s;
    let dw = tw(reg, "0", fs);
    let bx0 = x0 + 12. * s + (dw * 3.).round() + 10. * s;
    let bx1 = x1 - p;
    let by = top + 69. * s;
    text(
        pm,
        reg,
        "km/h",
        16. * s,
        bx0,
        top + 44. * s,
        col(157, 242.),
        A::LS,
        true,
    );
    rect(pm, bx0, by - 7. * s, bx1 - bx0, 14. * s, col(52, 242.));
    for (k, t) in [0, 30, 60, 90, 120].iter().enumerate() {
        let x = bx0 + (bx1 - bx0) * k as f32 / 4.;
        line(pm, (x, by + 11. * s), (x, by + 15. * s), s, col(109, 242.));
        text(
            pm,
            reg,
            &t.to_string(),
            10. * s,
            x,
            by + 17. * s,
            col(147, 242.),
            A::MA,
            true,
        )
    }
    text(
        pm,
        reg,
        &fmt_num(f.speed_kmh, 0),
        fs,
        x0 + p + 10. * s,
        top + ch / 2. + 5. * s,
        WHITE,
        A::LM,
        true,
    );
    rect(
        pm,
        bx0,
        by - 7. * s,
        (bx1 - bx0) * (finite_or_zero(f.speed_kmh) / 120.).clamp(0., 1.),
        14. * s,
        [255, 255, 255, 219],
    );
    text(
        pm,
        reg,
        "SPEED",
        12.0 * s,
        (x0 + x1) / 2.,
        ty,
        col(152, 145.),
        A::MA,
        true,
    );
    // pedals
    let x0 = e(4);
    let x1 = e(5);
    let bh = ch - 14. * s;
    let sw = (x1 - x0 - 2. * p) / 2.;
    let bw = 24. * s;
    let pin = ((sw - bw - 5. * s - 26. * s) / 2.).max(0.);
    for (k, (lab, val, c)) in [
        ("THR", f.throttle_percent, GREEN),
        ("BRK", f.brake_percent, RED),
    ]
    .iter()
    .enumerate()
    {
        let bx = x0 + p + 2. * s + k as f32 * sw + pin + if k == 1 { 14. * s } else { 0. };
        let by = top + 2. * s + bh;
        rect_outline(pm, bx, by - bh, bw, bh, s, col(76, 242.));
        let fill = (finite_or_zero(*val) / 100.).clamp(0., 1.);
        rect(
            pm,
            bx + 1. * s,
            by - fill * (bh - 2. * s),
            bw - 2. * s,
            fill * (bh - 2. * s),
            alpha(*c, o),
        );
        text(
            pm,
            reg,
            "%",
            10. * s,
            bx + bw + 5. * s,
            by - bh / 2. + 9. * s,
            col(138, 242.),
            A::LM,
            false,
        );
        text(
            pm,
            bold,
            &fmt_num(*val, 0),
            16. * s,
            bx + bw + 5. * s,
            by - bh / 2. - 9. * s,
            WHITE,
            A::LM,
            false,
        );
        text(
            pm,
            reg,
            lab,
            12. * s,
            bx + bw / 2.,
            ty,
            col(152, 145.),
            A::MA,
            true,
        )
    }
    // g force
    let x0 = e(5);
    let r = 52. * s;
    let cx = x0 + p + 59. * s + r;
    let cy = top + 70. * s;
    ellipse(pm, cx, cy, r * 0.62, r * 0.62, col(76, 242.), false, s);
    ellipse(pm, cx, cy, r, r, col(76, 242.), false, s);
    line(pm, (cx - r, cy), (cx + r, cy), s, col(52, 242.));
    line(pm, (cx, cy - r), (cx, cy + r), s, col(52, 242.));
    ellipse(
        pm,
        cx - (-finite_or_zero(f.g_y)).clamp(-2., 2.) * r / 2.,
        cy + finite_or_zero(f.g_x).clamp(-2., 2.) * r / 2.,
        6. * s,
        6. * s,
        alpha(RED, o),
        true,
        0.,
    );
    let (x_label, y_value) = gforce_labels(f.g_x, f.g_y);
    text(
        pm,
        bold,
        &x_label,
        13. * s,
        cx,
        cy - r - 7. * s,
        col(255, 195.),
        A::MA,
        true,
    );
    text(
        pm,
        bold,
        "Y",
        13. * s,
        cx - r - 22. * s,
        cy - 11. * s,
        col(255, 195.),
        A::MA,
        true,
    );
    text(
        pm,
        bold,
        &y_value,
        13. * s,
        cx - r - 22. * s,
        cy,
        WHITE,
        A::MT,
        true,
    );
    text(
        pm,
        reg,
        "G-FORCE",
        12.0 * s,
        (e(5) + 10. * s + e(6)) / 2. + 2. * s,
        ty,
        col(152, 145.),
        A::MA,
        true,
    );
    // torque
    let x0 = e(6);
    let x1 = e(7);
    let bh = ch - 14. * s;
    let sw = (x1 - x0 - 2. * p - 12. * s) / 4.;
    let bw = 30. * s;
    let pin = ((sw - bw - 5. * s - 40. * s) / 2.).max(0.);
    for (k, (lab, val)) in [
        ("FL", f.torque_nm[0]),
        ("FR", f.torque_nm[1]),
        ("RL", f.torque_nm[2]),
        ("RR", f.torque_nm[3]),
    ]
    .iter()
    .enumerate()
    {
        let torque = *val;
        let gx = x0 + p + 12. * s + k as f32 * sw + pin;
        let by = top + 2. * s + bh;
        let neg = bh * 0.25;
        let zero = by - neg;
        rect_outline(pm, gx, by - bh, bw, bh, s, col(90, 242.));
        line(pm, (gx + s, zero), (gx + bw - s, zero), s, col(142, 242.));
        if torque.is_finite() {
            if torque >= 0. {
                let height = (torque / 20.).clamp(0., 1.) * (bh - neg - s);
                if height >= s {
                    rect(
                        pm,
                        gx + s,
                        zero - height,
                        bw - 2. * s,
                        height,
                        alpha(GREEN, o),
                    );
                }
            } else {
                let height = (-torque / 10.).clamp(0., 1.) * (neg - s);
                if height >= s {
                    rect(pm, gx + s, zero + s, bw - 2. * s, height, alpha(RED, o));
                }
            }
        }
        text(
            pm,
            bold,
            &fmt_num(*val, 1),
            16. * s,
            gx + bw + 5. * s,
            by - bh / 2. - 9. * s,
            WHITE,
            A::LM,
            true,
        );
        text(
            pm,
            reg,
            "Nm",
            10. * s,
            gx + bw + 5. * s,
            by - bh / 2. + 9. * s,
            col(138, 242.),
            A::LM,
            true,
        );
        text(
            pm,
            reg,
            lab,
            12. * s,
            gx + bw / 2.,
            ty,
            col(152, 145.),
            A::MA,
            true,
        )
    }
}
