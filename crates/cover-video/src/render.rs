use crate::layout::{DemoFrame, CANVAS_HEIGHT, CANVAS_WIDTH, GREEN, RED, WHITE};
use ab_glyph::{point, Font, FontArc, PxScale, ScaleFont};
use std::{f32::consts::PI, fs, io::Cursor, path::Path};
use thiserror::Error;
use tiny_skia::{Color, FillRule, Paint, PathBuilder, Pixmap, PixmapPaint, Stroke, Transform};
const LOGO: &[u8] = include_bytes!("../assets/logo_white.png");
const REG: &[u8] = include_bytes!("../assets/Formula1-Display-Regular.ttf");
const BOLD: &[u8] = include_bytes!("../assets/Formula1-Display-Bold.ttf");
const SECTIONS: [f32; 8] = [0., 305., 600., 800., 1215., 1371., 1570., 1920.];
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
    let mut pm = Pixmap::new(CANVAS_WIDTH, CANVAS_HEIGHT)
        .ok_or_else(|| RenderError::Asset("canvas".into()))?;
    let reg = FontArc::try_from_slice(REG).map_err(|e| RenderError::Asset(e.to_string()))?;
    let bold = FontArc::try_from_slice(BOLD).map_err(|e| RenderError::Asset(e.to_string()))?;
    let s = CANVAS_WIDTH as f32 / 1920.;
    let f = DemoFrame::sample();
    draw_logo(&mut pm, s)?;
    timing(&mut pm, s, f, &reg, &bold);
    bottom(&mut pm, s, f, &reg, &bold);
    let bytes = pm
        .encode_png()
        .map_err(|e| RenderError::Encode(e.to_string()))?;
    if let Some(p) = path.as_ref().parent() {
        fs::create_dir_all(p).map_err(RenderError::CreateOutput)?;
    }
    fs::write(path, &bytes).map_err(RenderError::Write)?;
    Ok(RenderReport {
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        bytes,
    })
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
        "--".into()
    }
}
fn fmt_clock(v: f32) -> String {
    let m = (v / 60.).floor() as u32;
    format!("{m}:{:04.1}", v - m as f32 * 60.)
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
    let mut r = png::Decoder::new(Cursor::new(LOGO))
        .read_info()
        .map_err(|e| RenderError::Asset(e.to_string()))?;
    let mut b = vec![0; r.output_buffer_size()];
    let i = r
        .next_frame(&mut b)
        .map_err(|e| RenderError::Asset(e.to_string()))?;
    let mut v = Vec::with_capacity(i.buffer_size());
    for c in b[..i.buffer_size()].chunks_exact(4) {
        let a = c[3] as u16;
        v.extend([
            ((c[0] as u16 * a + 127) / 255) as u8,
            ((c[1] as u16 * a + 127) / 255) as u8,
            ((c[2] as u16 * a + 127) / 255) as u8,
            c[3],
        ])
    }
    let z = tiny_skia::IntSize::from_wh(i.width, i.height)
        .ok_or_else(|| RenderError::Asset("logo size".into()))?;
    let src = Pixmap::from_vec(v, z).ok_or_else(|| RenderError::Asset("logo data".into()))?;
    let h = (56. * s).round() as u32;
    let w = (i.width as f32 * h as f32 / i.height as f32).round() as u32;
    let mut out = Pixmap::new(w, h).ok_or_else(|| RenderError::Asset("logo target".into()))?;
    out.draw_pixmap(
        0,
        0,
        src.as_ref(),
        &PixmapPaint::default(),
        Transform::from_scale(h as f32 / i.height as f32, h as f32 / i.height as f32),
        None,
    );
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
fn timing(pm: &mut Pixmap, s: f32, f: DemoFrame, reg: &FontArc, bold: &FontArc) {
    let x = 2560. - 60. * s - 370. * s;
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
        "e04",
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
        "Lin Jiaxuan",
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
fn bottom(pm: &mut Pixmap, s: f32, f: DemoFrame, reg: &FontArc, bold: &FontArc) {
    let o = 0.95;
    let h = 172. * s;
    let oy = 1440. - h;
    let top = oy + 12. * s;
    let ch = h - 32. * s;
    let ty = oy + h - 20. * s;
    let p = 15. * s;
    rect(pm, 0., oy, 2560., h, [8, 10, 14, 95]);
    line(pm, (0., oy), (2560., oy), s, col(57, 242.));
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
    // GPS (same widget box, fixed demo trace)
    let x0 = e(0);
    let x1 = e(1);
    let mw = (285. * s).min(x1 - x0 - 2. * p);
    let mh = (158. * s).min(h - 26. * s);
    let mx = x0 + p + (x1 - x0 - 2. * p - mw) / 2.;
    let my = top + (h - 16. * s - mh) / 2.;
    // Normalized trace sampled from the source CSV with widgets.py's route()
    // projection (same 285×158 local map coordinate system).
    let pts = [
        (0.3040, 0.6407),
        (0.3017, 0.6433),
        (0.2994, 0.6420),
        (0.2987, 0.6386),
        (0.2987, 0.6337),
        (0.2929, 0.5972),
        (0.2983, 0.5345),
        (0.3173, 0.4383),
        (0.3475, 0.3025),
        (0.3947, 0.1101),
        (0.5156, 0.0283),
        (0.5969, 0.2218),
        (0.5309, 0.5765),
        (0.6703, 0.5691),
        (0.7173, 0.2153),
        (0.8026, 0.3766),
        (0.7092, 0.7251),
        (0.4722, 0.9301),
        (0.2610, 0.6751),
        (0.3063, 0.3062),
        (0.3496, 0.1417),
        (0.3590, 0.1174),
        (0.4074, 0.0548),
        (0.5150, 0.0720),
        (0.5561, 0.2449),
        (0.4838, 0.5152),
        (0.6160, 0.6194),
        (0.6714, 0.2392),
        (0.7761, 0.3375),
        (0.7009, 0.6983),
        (0.4881, 0.9711),
        (0.2601, 0.7225),
        (0.2506, 0.4560),
        (0.3344, 0.1337),
        (0.3474, 0.1089),
        (0.4269, 0.0523),
        (0.5478, 0.1577),
        (0.4792, 0.4321),
        (0.5710, 0.6545),
        (0.6542, 0.3275),
        (0.7546, 0.2839),
        (0.7212, 0.6501),
        (0.5446, 0.9533),
        (0.2863, 0.7821),
        (0.2299, 0.5113),
        (0.3244, 0.1424),
        (0.5111, 0.0948),
        (0.4758, 0.4045),
        (0.5458, 0.6686),
        (0.6385, 0.3565),
        (0.7443, 0.2831),
        (0.7072, 0.6679),
        (0.5479, 0.9604),
        (0.2743, 0.7708),
        (0.2242, 0.5105),
        (0.2854, 0.2655),
        (0.2889, 0.2582),
        (0.2934, 0.2577),
        (0.2970, 0.2521),
        (0.3028, 0.2444),
        (0.3019, 0.2367),
        (0.3074, 0.2347),
        (0.3173, 0.2404),
        (0.3137, 0.2521),
        (0.3075, 0.2651),
        (0.3106, 0.2815),
        (0.3298, 0.2400),
        (0.4889, 0.0727),
        (0.5394, 0.3403),
        (0.5370, 0.6955),
        (0.6624, 0.4273),
        (0.7516, 0.2612),
        (0.7707, 0.5637),
        (0.6184, 0.9182),
        (0.3445, 0.8570),
        (0.2488, 0.7005),
        (0.2107, 0.6717),
        (0.1968, 0.6685),
        (0.1978, 0.6629),
        (0.1973, 0.6600),
    ];
    for q in pts.windows(2) {
        line(
            pm,
            (mx + q[0].0 * mw, my + q[0].1 * mh),
            (mx + q[1].0 * mw, my + q[1].1 * mh),
            2. * s,
            col(157, 242.),
        )
    }
    ellipse(
        pm,
        mx + 0.2822 * mw,
        my + 0.3178 * mh,
        3. * s,
        3. * s,
        alpha(RED, o),
        true,
        0.,
    );
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
    let a = (270. - (f.steer_deg / 160.) * 160.) * PI / 180.;
    let px = cx + r * a.cos();
    let py = cy + r * a.sin();
    arc(
        pm,
        cx,
        cy,
        r,
        270.,
        270. - f.steer_deg / 160. * 160.,
        4. * s,
        alpha(GREEN, o),
    );
    ellipse(pm, px, py, 4. * s, 4. * s, alpha(GREEN, o), true, 0.);
    text(
        pm,
        bold,
        &format!("{:+.0}°", f.steer_deg),
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
        (bx1 - bx0) * (f.speed_kmh / 120.).clamp(0., 1.),
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
        rect(
            pm,
            bx + 1. * s,
            by - (val / 100.) * (bh - 2. * s),
            bw - 2. * s,
            (val / 100.) * (bh - 2. * s),
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
            &format!("{val:0.0}"),
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
        cx - (-f.g_y).clamp(-2., 2.) * r / 2.,
        cy + f.g_x.clamp(-2., 2.) * r / 2.,
        6. * s,
        6. * s,
        alpha(RED, o),
        true,
        0.,
    );
    text(
        pm,
        bold,
        "X 0.54",
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
        "-0.25",
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
        let gx = x0 + p + 12. * s + k as f32 * sw + pin;
        let by = top + 2. * s + bh;
        let neg = bh * 0.25;
        let zero = by - neg;
        rect_outline(pm, gx, by - bh, bw, bh, s, col(90, 242.));
        line(pm, (gx + s, zero), (gx + bw - s, zero), s, col(142, 242.));
        rect(
            pm,
            gx + s,
            zero - (*val / 20.) * (bh - neg - s),
            bw - 2. * s,
            (*val / 20.) * (bh - neg - s),
            alpha(GREEN, o),
        );
        text(
            pm,
            bold,
            &format!("{val:0.1}"),
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
