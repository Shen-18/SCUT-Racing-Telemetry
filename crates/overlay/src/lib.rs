pub mod bindings;
mod layout;
mod render;
pub mod timeline;

pub use bindings::{
    resolve_candidate, sample_frame, BindingConfig, BindingError, GpsPoint, GpsRoute, OverlayFrame,
    SampleSeries, SeriesSampler, UnitKind,
};
pub use layout::{DemoFrame, RenderConfig};
pub use render::{
    gps_map_size, render_demo_png, render_overlay_png_with_context, render_png,
    render_png_with_config, render_png_with_context, render_rgba, render_rgba_with_config,
    render_rgba_with_context, GpsGeometry, RenderContext, RenderError, RenderReport,
};
pub use timeline::{
    build_timeline, parse_seconds, render_indices, solve_alignment, Alignment, OutputTimeline,
    SyncAnchor, TimelineConfig, TimelineError,
};
