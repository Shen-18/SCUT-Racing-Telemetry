/// 启动窗口尺寸与屏幕可用区求交集。
/// 返回 None 表示可用区不可用（无显示器信息），调用方应保持期望尺寸。
pub fn fit_into_area(want_w: u32, want_h: u32, area_w: u32, area_h: u32) -> Option<(u32, u32)> {
    if area_w == 0 || area_h == 0 {
        return None;
    }
    Some((want_w.min(area_w), want_h.min(area_h)))
}

#[cfg(test)]
mod tests {
    use super::fit_into_area;

    #[test]
    fn keeps_expected_size_when_it_fits() {
        assert_eq!(fit_into_area(1280, 680, 1463, 891), Some((1280, 680)));
    }

    #[test]
    fn shrinks_to_work_area_when_too_big() {
        assert_eq!(fit_into_area(1920, 1080, 1463, 891), Some((1463, 891)));
    }

    #[test]
    fn clamps_each_axis_independently() {
        assert_eq!(fit_into_area(1920, 600, 1463, 891), Some((1463, 600)));
    }

    #[test]
    fn reports_unavailable_work_area() {
        assert_eq!(fit_into_area(1280, 680, 0, 0), None);
    }
}
