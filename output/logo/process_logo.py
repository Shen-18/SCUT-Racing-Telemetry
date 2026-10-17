from collections import deque
from pathlib import Path
import json

import numpy as np
from PIL import Image, ImageFilter, ImageOps


ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent
source = ImageOps.exif_transpose(Image.open(ROOT / 'Logo.jpg')).convert('RGB')
rgb = np.asarray(source, dtype=np.float32)
saturation = rgb.max(axis=2) - rgb.min(axis=2)
foreground = (saturation > 55) & (rgb.min(axis=2) < 190)
projection = foreground.sum(axis=1) > 35
indices = np.flatnonzero(projection)
splits = np.flatnonzero(np.diff(indices) > 25) + 1
rows = np.split(indices, splits)
assert len(rows) == 3, f'Expected three logo rows, found {len(rows)}'

alpha = np.zeros(rgb.shape[:2], dtype=np.float32)
colors = []
for row in rows:
    start = max(0, int(row[0]) - 12)
    end = min(rgb.shape[0], int(row[-1]) + 13)
    band = rgb[start:end]
    strong = foreground[start:end]
    color = np.median(band[strong], axis=0)
    colors.append(color.tolist())
    direction = 255.0 - color
    coverage = ((255.0 - band) @ direction) / np.dot(direction, direction)
    # Reject low-saturation white paper/JPEG ringing before recovering coverage.
    coverage[saturation[start:end] < 18] = 0
    alpha[start:end] = np.clip(coverage, 0, 1)

# Remove isolated JPEG noise, preserving every substantive letter and bar.
binary = alpha >= 0.5
seen = np.zeros(binary.shape, dtype=bool)
height, width = binary.shape
components = []
keep = np.zeros(binary.shape, dtype=bool)
for sy, sx in zip(*np.nonzero(binary)):
    if seen[sy, sx]:
        continue
    queue = deque([(int(sy), int(sx))])
    seen[sy, sx] = True
    pixels = []
    while queue:
        y, x = queue.popleft()
        pixels.append((y, x))
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < height and 0 <= nx < width and binary[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True
                queue.append((ny, nx))
    if len(pixels) >= 24:
        components.append(len(pixels))
        ys, xs = zip(*pixels)
        keep[ys, xs] = True

assert components and min(components) >= 24
# Allow a narrow antialiasing boundary around the kept shapes.
support = Image.fromarray((keep * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(5))
alpha[np.asarray(support) == 0] = 0
mask = Image.fromarray(np.round(alpha * 255).astype(np.uint8))
bbox = mask.point(lambda value: 255 if value > 24 else 0).getbbox()
assert bbox
left, top, right, bottom = bbox
margin = 24
crop = (max(0, left - margin), max(0, top - margin), min(width, right + margin), min(height, bottom + margin))
mask = mask.crop(crop)

def clean_mask(size):
    # Smooth source-pixel stair steps, then restore a narrow, crisp coverage edge.
    scaled = mask.resize(size, Image.Resampling.BICUBIC)
    ratio = size[0] / mask.width
    scaled = scaled.filter(ImageFilter.GaussianBlur(0.6 * ratio))
    coverage = np.asarray(scaled, dtype=np.float32) / 255.0
    coverage = np.clip((coverage - 0.16) / 0.68, 0, 1)
    return Image.fromarray(np.round(coverage * 255).astype(np.uint8))

sizes = {'SCUTRacing-white.png': mask.size, 'SCUTRacing-white-4k.png': (4096, round(mask.height * 4096 / mask.width))}
report = {'source_size': source.size, 'crop': crop, 'row_colors': colors, 'component_count': len(components), 'outputs': {}}
for name, size in sizes.items():
    final_mask = clean_mask(size)
    final = Image.new('RGBA', size, (255, 255, 255, 0))
    final.putalpha(final_mask)
    final.save(OUT / name, optimize=True)
    verified = np.asarray(Image.open(OUT / name))
    assert verified.shape[2] == 4
    assert np.all(verified[..., :3] == 255), 'All RGB values must be pure white'
    assert verified[..., 3].min() == 0 and verified[..., 3].max() == 255
    assert np.any((verified[..., 3] > 0) & (verified[..., 3] < 255)), 'Antialiasing required'
    assert np.all(verified[0, :, 3] == 0) and np.all(verified[-1, :, 3] == 0)
    assert np.all(verified[:, 0, 3] == 0) and np.all(verified[:, -1, 3] == 0)
    report['outputs'][name] = {'size': size, 'bytes': (OUT / name).stat().st_size}

preview_logo = Image.open(OUT / 'SCUTRacing-white-4k.png')
preview_logo.thumbnail((1500, 1000), Image.Resampling.LANCZOS)
preview = Image.new('RGBA', (preview_logo.width + 96, preview_logo.height + 96), '#202329')
preview.alpha_composite(preview_logo, (48, 48))
preview.convert('RGB').save(OUT / 'SCUTRacing-white-preview.png', optimize=True)
(OUT / 'processing-report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report, indent=2))
