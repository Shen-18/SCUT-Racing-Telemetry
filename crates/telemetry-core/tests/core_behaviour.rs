use telemetry_core::*;
fn series(t: &[f64], v: &[f32]) -> ChannelSeries {
    ChannelSeries {
        times: t.to_vec(),
        values: v.to_vec(),
    }
}
#[test]
fn model_uses_paired_length_and_ignores_unpaired_time() {
    let s = series(&[0., 4., 999.], &[2., 3.]);
    assert_eq!(s.len(), 2);
    assert!(!s.is_empty());
    let mut dataset = TelemetryDataset::default();
    dataset.series.insert("speed".into(), s);
    dataset.series.insert("empty".into(), series(&[1000.], &[]));
    assert_eq!(dataset.max_time(), 4.);
    assert!(dataset.channel("speed").is_some());
    assert!(dataset.channel("missing").is_none());
}
#[test]
fn distance_known_constant_and_left_hold() {
    assert_eq!(
        integrate_distance(&[0., 1., 3.], &[2., 2., 2.]),
        vec![0., 2., 6.]
    );
    assert_eq!(
        integrate_distance(&[0., 1., 3.], &[2., 4., 8.]),
        vec![0., 2., 10.]
    );
    assert_eq!(
        integrate_distance(&[0., 1., 1., 3.], &[2., 4., f32::NAN, 8.]),
        vec![0., 2., 2., 2.]
    );
}
#[test]
fn stats_known_population_distribution_and_missing_values() {
    let s = series(&[0., 1., 2., 3., 4.], &[1., 2., 3., 4., f32::NAN]);
    let r = channel_stats(&s, (0., 4.));
    assert_eq!((r.min, r.max, r.mean), (1., 4., 2.5));
    assert!((r.std - 1.118033988749895).abs() < 1e-12);
    assert!(channel_stats(&s, (8., 9.)).mean.is_nan());
}
#[test]
fn comparison_identity_inverse_and_resampling() {
    let a = series(&[0., 1., 2.], &[0., 1., 2.]);
    let b = series(&[0., 2.], &[0., 2.]);
    let c = series(&[0., 1., 2.], &[2., 1., 0.]);
    assert_eq!(rmse_and_corr(&a, &a, (0., 2.)), (0., 1.));
    assert_eq!(rmse_and_corr(&a, &b, (0., 2.)), (0., 1.));
    let (rmse, corr) = rmse_and_corr(&a, &c, (0., 2.));
    assert!((rmse - (8.0_f64 / 3.).sqrt()).abs() < 1e-12);
    assert_eq!(corr, -1.);
}
#[test]
fn comparison_never_extrapolates_or_pairs_by_index() {
    let a = series(&[0., 1., 2.], &[0., 1., 2.]);
    let b = series(&[1., 2., 3.], &[1., 2., 100.]);
    assert_eq!(rmse_and_corr(&a, &b, (0., 3.)), (0., 1.));
    assert!(rmse_and_corr(&a, &b, (7., 9.)).0.is_nan());
}
#[test]
fn downsample_keeps_real_neighbors_and_inclusive_end() {
    let q = minmax_buckets(
        &[0., 1., 2., 3., 4., 5.],
        &[9., 3., 8., 2., 6., 99.],
        1.,
        4.,
        2,
    );
    assert_eq!(q.times, vec![0., 1., 3., 5.]);
    assert_eq!(q.mins, vec![9., 3., 2., 99.]);
    assert_eq!(q.maxs, vec![9., 8., 6., 99.]);
    assert!(minmax_buckets(&[0.], &[1.], 0., 1., 0).times.is_empty());
}
#[test]
fn ecef_known_equator_pole_and_invalid_origin() {
    let (lat, lon, alt) = ecef_to_geodetic(
        &[6378137., 0., 0.],
        &[0., 6378137., 0.],
        &[0., 0., 6356752.5],
    );
    assert!(lat[0].abs() < 1e-8 && lon[0].abs() < 1e-8 && alt[0].abs() < 1e-3);
    assert!((lon[1] - 90.).abs() < 1e-8);
    assert!((lat[2] - 90.).abs() < 1e-8 && alt[2].abs() < 0.5);
    assert!(ecef_to_geodetic(&[0.], &[0.], &[0.]).0[0].is_nan());
}
#[test]
fn alignment_is_explicitly_unavailable() {
    assert!(estimate_offset(
        &ChannelSeries::default(),
        &ChannelSeries::default(),
        (0., 1.)
    )
    .is_err());
}
#[test]
fn rmse_and_corr_handles_non_sample_window_endpoints() {
    let a = series(&[0., 10.], &[0., 10.]);
    let b = series(&[0., 10.], &[0., 10.]);
    let (rmse, corr) = rmse_and_corr(&a, &b, (2., 8.));
    assert_eq!(rmse, 0.);
    assert_eq!(corr, 1.);

    let c = series(&[0., 5., 10.], &[0., 5., 10.]);
    let (rmse, corr) = rmse_and_corr(&a, &c, (2.5, 7.5));
    assert_eq!(rmse, 0.);
    assert_eq!(corr, 1.);

    let (rmse_rev, corr_rev) = rmse_and_corr(&c, &a, (2.5, 7.5));
    assert_eq!(rmse_rev, 0.);
    assert_eq!(corr_rev, 1.);
}
#[test]
fn rmse_and_corr_handles_leading_nan_and_isolated_nan() {
    let a = series(&[0., 1., 2.], &[f32::NAN, 1., 2.]);
    let b = series(&[0., 1., 2.], &[0., 1., 2.]);
    let (rmse, corr) = rmse_and_corr(&a, &b, (0., 2.));
    assert_eq!(rmse, 0.);
    assert_eq!(corr, 1.);

    let a_mid = series(&[0., 1., 2.], &[0., f32::NAN, 2.]);
    let (rmse_mid, corr_mid) = rmse_and_corr(&a_mid, &b, (0., 2.));
    assert_eq!(rmse_mid, 0.);
    assert_eq!(corr_mid, 1.);

    let a_tail = series(&[0., 1., 2.], &[0., 1., f32::NAN]);
    let (rmse_tail, corr_tail) = rmse_and_corr(&a_tail, &b, (0., 2.));
    assert_eq!(rmse_tail, 0.);
    assert_eq!(corr_tail, 1.);

    let a_all_nan = series(&[0., 1.], &[f32::NAN, f32::NAN]);
    let (rmse_nan, corr_nan) = rmse_and_corr(&a_all_nan, &b, (0., 1.));
    assert!(rmse_nan.is_nan());
    assert!(corr_nan.is_nan());
}
#[test]
fn rmse_and_corr_ignores_unpaired_tail_timestamps() {
    let a = series(&[0., 1., 2., 99., 100.], &[0., 1., 2.]);
    let b = series(&[0., 1., 2.], &[0., 1., 2.]);
    let (rmse, corr) = rmse_and_corr(&a, &b, (0., 50.));
    assert_eq!(rmse, 0.);
    assert_eq!(corr, 1.);

    let b_extra_val = series(&[0., 1., 2.], &[0., 1., 2., 999., 1000.]);
    let (rmse2, corr2) = rmse_and_corr(&a, &b_extra_val, (0., 2.));
    assert_eq!(rmse2, 0.);
    assert_eq!(corr2, 1.);

    let stat = channel_stats(&a, (0., 50.));
    assert_eq!((stat.min, stat.max, stat.mean), (0., 2., 1.));
}
