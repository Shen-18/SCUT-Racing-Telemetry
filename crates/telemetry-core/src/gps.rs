//! WGS84 projection and left-endpoint distance integration.
const A: f64 = 6_378_137.0;
const F: f64 = 1.0 / 298.257223563;
/// Convert ECEF metres to latitude/longitude degrees and altitude metres.
pub fn ecef_to_geodetic(x: &[f32], y: &[f32], z: &[f32]) -> (Vec<f64>, Vec<f64>, Vec<f32>) {
    let e2 = F * (2.0 - F);
    let mut latitudes = Vec::new();
    let mut longitudes = Vec::new();
    let mut altitudes = Vec::new();
    for ((&xx, &yy), &zz) in x.iter().zip(y).zip(z) {
        let p = (xx as f64).hypot(yy as f64);
        if p == 0.0 && zz == 0.0 {
            latitudes.push(f64::NAN);
            longitudes.push(f64::NAN);
            altitudes.push(f32::NAN);
            continue;
        }
        let mut lat = (zz as f64).atan2(p * (1.0 - e2));
        for _ in 0..8 {
            let s = lat.sin();
            let r = A / (1.0 - e2 * s * s).sqrt();
            let h = if lat.cos().abs() > 1e-12 {
                p / lat.cos() - r
            } else {
                zz.abs() as f64 - r * (1.0 - e2)
            };
            lat = (zz as f64).atan2(p * (1.0 - e2 * r / (r + h)));
        }
        let s = lat.sin();
        let r = A / (1.0 - e2 * s * s).sqrt();
        latitudes.push(lat.to_degrees());
        longitudes.push((yy as f64).atan2(xx as f64).to_degrees());
        altitudes.push(
            (if lat.cos().abs() > 1e-12 {
                p / lat.cos() - r
            } else {
                zz.abs() as f64 - r * (1.0 - e2)
            }) as f32,
        );
    }
    (latitudes, longitudes, altitudes)
}
/// Integrate speed using the previous sample over each positive interval.
pub fn integrate_distance(times: &[f64], speed: &[f32]) -> Vec<f64> {
    let n = times.len().min(speed.len());
    let mut d = vec![0.0; n];
    for i in 1..n {
        let dt = times[i] - times[i - 1];
        d[i] = d[i - 1]
            + if dt.is_finite() && dt > 0.0 && speed[i - 1].is_finite() {
                dt * speed[i - 1] as f64
            } else {
                0.0
            };
    }
    d
}
