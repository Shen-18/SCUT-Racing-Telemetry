use telemetry_core::*;
#[test]
fn twenty_points_have_exact_single_level_per_512_rule() {
    let t: Vec<_> = (0..20).map(f64::from).collect();
    let v = [
        5., 1., 3., 9., 0., 2., -1., 7., 4., 4., 8., 6., -2., -3., 10., 1., 5., 2., 0., 11.,
    ];
    let p = build_pyramid(&t, &v);
    assert_eq!(p.levels.len(), 1);
    assert_eq!(p.levels[0].factor, 2);
    assert_eq!(
        p.levels[0].times,
        vec![0., 2., 4., 6., 8., 10., 12., 14., 16., 18.]
    );
    let extrema: Vec<_> = p.levels[0].minmax.iter().map(|m| (m.min, m.max)).collect();
    assert_eq!(
        extrema,
        vec![
            (1., 5.),
            (3., 9.),
            (0., 2.),
            (-1., 7.),
            (4., 4.),
            (6., 8.),
            (-3., -2.),
            (1., 10.),
            (2., 5.),
            (0., 11.)
        ]
    );
}
#[test]
fn irregular_times_and_partial_bucket_are_preserved() {
    let p = build_pyramid(&[0., 0.1, 2., 2.1, 50.], &[4., 8., -1., 5., 9.]);
    assert_eq!(p.levels[0].times, vec![0., 2., 50.]);
    assert_eq!(p.levels[0].minmax[2].min, 9.);
    let singleton = build_pyramid(&[7.], &[8.]);
    assert_eq!(singleton.levels.len(), 1);
    assert_eq!(singleton.levels[0].times, vec![7.]);
}
#[test]
fn multilayer_counts_values_and_spikes_are_exact() {
    let t: Vec<_> = (0..4097).map(f64::from).collect();
    let mut v = vec![0.; 4097];
    v[3] = 99.;
    v[4096] = -17.;
    let p = build_pyramid(&t, &v);
    assert_eq!(
        p.levels
            .iter()
            .map(|l| (l.factor, l.times.len()))
            .collect::<Vec<_>>(),
        vec![(2, 2049), (4, 1025), (8, 513), (16, 257)]
    );
    for l in &p.levels {
        assert_eq!(l.times[0], 0.);
        assert_eq!(l.minmax[0].min, 0.);
        assert!(l.minmax.iter().any(|m| m.max == 99.));
        assert_eq!(l.times.last(), Some(&4096.));
        assert_eq!(l.minmax.last().map(|m| m.min), Some(-17.));
    }
}
#[test]
fn query_selects_finest_eligible_or_raw() {
    let t: Vec<_> = (0..4096).map(f64::from).collect();
    let p = build_pyramid(&t, &vec![1.; 4096]);
    let q = query_pyramid(&p, 0., 4095., 300);
    assert!(q.is_some());
    if let Some(q) = q {
        assert_eq!(q.times.len(), 512);
        assert_eq!(q.times[1], 8.);
    }
    assert!(query_pyramid(&p, 0., 4., 300).is_none());
    assert!(query_pyramid(&p, 0., 4095., 0).is_none());
    assert!(query_pyramid(&p, 10., 1., 100).is_none());
}
#[test]
fn query_keeps_bucket_covering_left_boundary() {
    let t: Vec<_> = (0..4096).map(f64::from).collect();
    let mut v = vec![0.; 4096];
    v[7] = 99.;
    let p = build_pyramid(&t, &v);
    let q = query_pyramid(&p, 7., 4095., 300);
    assert!(q.is_some());
    if let Some(q) = q {
        assert_eq!(q.times.first(), Some(&0.));
        assert_eq!(q.maxs.first(), Some(&99.));
    }
}
