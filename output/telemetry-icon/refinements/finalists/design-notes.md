# SCUT Racing Telemetry finalists — 2026-10-14

Local deterministic pixel refinement of the existing slanted-v2 master. No image generation API was used.

Preserved the custom SCUT and Racing lettering, Racing underline, navy palette, and right-side blue/red/green order. Extracted the existing letter silhouettes, reduced SCUT height, and adjusted the shear to match the new parallel bars. Rebuilt the tile with a smooth navy fill and clean transparent rounded corners, removing source grain and near-opaque alpha. Each top row (SCUT plus bars) matches the Racing row width. SCUT text alone is narrower than Racing to make room for the right-side bars, consistent with the actual previous design.

A: SCUT height 137 px, bar lean 25.64 degrees. B: 128 px, 26.57 degrees (recommended). C: 121 px, 27.47 degrees. All three bars have the same height, width, spacing, and top/bottom alignment as SCUT. PNG: 1024 x 1024 RGBA. ICO frames: 16, 24, 32, 48, 64, 128, 256.

Application icon configuration was not changed. Reproduce with ../make-finalists.py.
