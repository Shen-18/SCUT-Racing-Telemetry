use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SyncAnchor {
    pub data_seconds: f64,
    pub video_seconds: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Alignment {
    pub scale: f64,
    pub offset_seconds: f64,
}

#[derive(Debug, Clone)]
pub struct TimelineConfig {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub render_fps: u32,
    pub timeline_fps: f64,
    pub output_start: f64,
    pub duration: Option<f64>,
    pub source_end: f64,
    pub padding_head_seconds: f64,
    pub padding_tail_seconds: f64,
    pub offset_seconds: f64,
    pub anchors: Vec<SyncAnchor>,
}

impl Default for TimelineConfig {
    fn default() -> Self {
        Self {
            width: 2560,
            height: 1440,
            fps: 100,
            render_fps: 20,
            timeline_fps: 100.,
            output_start: 0.,
            duration: None,
            source_end: 0.,
            padding_head_seconds: 5.,
            padding_tail_seconds: 5.,
            offset_seconds: 0.,
            anchors: Vec::new(),
        }
    }
}

#[derive(Debug, Error, PartialEq)]
pub enum TimelineError {
    #[error("width and height must be positive even numbers")]
    InvalidDimensions,
    #[error("this layout requires a 16:9 canvas")]
    InvalidAspectRatio,
    #[error("fps must be between 1 and 240")]
    InvalidFps,
    #[error("render_fps must divide fps exactly")]
    InvalidRenderFps,
    #[error("timeline_fps must be positive")]
    InvalidTimelineFps,
    #[error("padding seconds must be finite and nonnegative")]
    InvalidPadding,
    #[error("output_start must be finite and nonnegative")]
    InvalidOutputStart,
    #[error("duration must be finite and positive")]
    InvalidDuration,
    #[error("source_end must be finite and nonnegative")]
    InvalidSourceEnd,
    #[error("supply zero, one or two sync anchors")]
    TooManyAnchors,
    #[error("use anchors or offset_seconds, not both")]
    ConflictingSync,
    #[error("sync anchors must increase in both clocks")]
    InvalidAnchors,
    #[error("sync values must be finite")]
    InvalidSync,
    #[error("timecode is invalid")]
    InvalidTimecode,
}

impl TimelineConfig {
    pub fn validate(&self) -> Result<(), TimelineError> {
        if self.width == 0 || self.height == 0 || self.width % 2 != 0 || self.height % 2 != 0 {
            return Err(TimelineError::InvalidDimensions);
        }
        if ((self.width as f64 / self.height as f64) - 16. / 9.).abs() > 0.001 {
            return Err(TimelineError::InvalidAspectRatio);
        }
        if !(1..=240).contains(&self.fps) {
            return Err(TimelineError::InvalidFps);
        }
        if self.render_fps == 0 || self.render_fps > self.fps || self.fps % self.render_fps != 0 {
            return Err(TimelineError::InvalidRenderFps);
        }
        if !self.timeline_fps.is_finite() || self.timeline_fps <= 0. {
            return Err(TimelineError::InvalidTimelineFps);
        }
        if !self.output_start.is_finite() || self.output_start < 0. {
            return Err(TimelineError::InvalidOutputStart);
        }
        if !self.source_end.is_finite() || self.source_end < 0. {
            return Err(TimelineError::InvalidSourceEnd);
        }
        if !self.padding_head_seconds.is_finite()
            || !self.padding_tail_seconds.is_finite()
            || self.padding_head_seconds < 0.
            || self.padding_tail_seconds < 0.
        {
            return Err(TimelineError::InvalidPadding);
        }
        if let Some(duration) = self.duration {
            if !duration.is_finite() || duration <= 0. {
                return Err(TimelineError::InvalidDuration);
            }
        }
        if self.anchors.len() > 2 {
            return Err(TimelineError::TooManyAnchors);
        }
        if !self.anchors.is_empty() && self.offset_seconds != 0. {
            return Err(TimelineError::ConflictingSync);
        }
        Ok(())
    }
}

#[derive(Debug, Clone)]
pub struct OutputTimeline {
    pub alignment: Alignment,
    pub fps: u32,
    pub render_fps: u32,
    pub width: u32,
    pub height: u32,
    pub output_start: f64,
    pub head_frames: usize,
    pub content_frames: usize,
    pub tail_frames: usize,
    pub frame_count: usize,
    pub content_duration: f64,
}

impl OutputTimeline {
    pub fn frame_time(&self, index: usize) -> f64 {
        self.output_start + index as f64 / self.fps as f64
    }

    pub fn content_video_time(&self, index: usize) -> f64 {
        self.output_start + (index as f64 - self.head_frames as f64) / self.fps as f64
    }

    pub fn data_time(&self, index: usize) -> f64 {
        (self.content_video_time(index) - self.alignment.offset_seconds) / self.alignment.scale
    }

    pub fn overlay_active(&self, index: usize) -> bool {
        index >= self.head_frames && index < self.head_frames + self.content_frames
    }

    pub fn is_padding(&self, index: usize) -> bool {
        !self.overlay_active(index)
    }
}

pub fn parse_seconds(value: &str, timeline_fps: f64) -> Result<f64, TimelineError> {
    if !timeline_fps.is_finite() || timeline_fps <= 0. {
        return Err(TimelineError::InvalidTimelineFps);
    }
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.contains(';') {
        return Err(TimelineError::InvalidTimecode);
    }
    let parts: Vec<&str> = trimmed.split(':').collect();
    let result = match parts.as_slice() {
        [seconds] => seconds
            .parse::<f64>()
            .map_err(|_| TimelineError::InvalidTimecode)?,
        [hours, minutes, seconds] => {
            let h = hours
                .parse::<f64>()
                .map_err(|_| TimelineError::InvalidTimecode)?;
            let m = minutes
                .parse::<f64>()
                .map_err(|_| TimelineError::InvalidTimecode)?;
            let sec = seconds
                .parse::<f64>()
                .map_err(|_| TimelineError::InvalidTimecode)?;
            if h < 0. || m < 0. || sec < 0. || m >= 60. || sec >= 60. {
                return Err(TimelineError::InvalidTimecode);
            }
            h * 3600. + m * 60. + sec
        }
        [hours, minutes, seconds, frames] => {
            if timeline_fps.fract() != 0. {
                return Err(TimelineError::InvalidTimecode);
            }
            let h = hours
                .parse::<i64>()
                .map_err(|_| TimelineError::InvalidTimecode)?;
            let m = minutes
                .parse::<i64>()
                .map_err(|_| TimelineError::InvalidTimecode)?;
            let sec = seconds
                .parse::<i64>()
                .map_err(|_| TimelineError::InvalidTimecode)?;
            let frame = frames
                .parse::<i64>()
                .map_err(|_| TimelineError::InvalidTimecode)?;
            if h < 0
                || m < 0
                || sec < 0
                || frame < 0
                || m >= 60
                || sec >= 60
                || frame as f64 >= timeline_fps
            {
                return Err(TimelineError::InvalidTimecode);
            }
            h as f64 * 3600. + m as f64 * 60. + sec as f64 + frame as f64 / timeline_fps
        }
        _ => return Err(TimelineError::InvalidTimecode),
    };
    if !result.is_finite() || result < 0. {
        return Err(TimelineError::InvalidTimecode);
    }
    Ok(result)
}

pub fn solve_alignment(config: &TimelineConfig) -> Result<Alignment, TimelineError> {
    config.validate()?;
    let alignment = match config.anchors.as_slice() {
        [] => Alignment {
            scale: 1.,
            offset_seconds: config.offset_seconds,
        },
        [one] => Alignment {
            scale: 1.,
            offset_seconds: one.video_seconds - one.data_seconds,
        },
        [first, second] => {
            if first.data_seconds >= second.data_seconds
                || first.video_seconds >= second.video_seconds
            {
                return Err(TimelineError::InvalidAnchors);
            }
            let scale = (second.video_seconds - first.video_seconds)
                / (second.data_seconds - first.data_seconds);
            Alignment {
                scale,
                offset_seconds: first.video_seconds - scale * first.data_seconds,
            }
        }
        _ => return Err(TimelineError::TooManyAnchors),
    };
    if !alignment.scale.is_finite()
        || alignment.scale <= 0.
        || !alignment.offset_seconds.is_finite()
    {
        return Err(TimelineError::InvalidSync);
    }
    Ok(alignment)
}

pub fn build_timeline(config: &TimelineConfig) -> Result<OutputTimeline, TimelineError> {
    let alignment = solve_alignment(config)?;
    let length = config.duration.unwrap_or_else(|| {
        alignment.scale * config.source_end + alignment.offset_seconds - config.output_start
    });
    if !length.is_finite() || length <= 0. {
        return Err(TimelineError::InvalidDuration);
    }
    let content_frames = ((length * config.fps as f64) - 1e-8).ceil() as usize;
    let head_frames = (config.padding_head_seconds * config.fps as f64).round() as usize;
    let tail_frames = (config.padding_tail_seconds * config.fps as f64).round() as usize;
    Ok(OutputTimeline {
        alignment,
        fps: config.fps,
        render_fps: config.render_fps,
        width: config.width,
        height: config.height,
        output_start: config.output_start,
        head_frames,
        content_frames,
        tail_frames,
        frame_count: head_frames + content_frames + tail_frames,
        content_duration: content_frames as f64 / config.fps as f64,
    })
}

pub fn render_indices(
    frame_count: usize,
    output_fps: u32,
    render_fps: u32,
) -> Result<Vec<usize>, TimelineError> {
    if render_fps == 0 || output_fps == 0 || output_fps % render_fps != 0 {
        return Err(TimelineError::InvalidRenderFps);
    }
    let step = (output_fps / render_fps) as usize;
    Ok((0..frame_count).step_by(step).collect())
}
