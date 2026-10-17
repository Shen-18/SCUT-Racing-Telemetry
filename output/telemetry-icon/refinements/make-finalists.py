from pathlib import Path
import json
import math
import zipfile
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).parent
OUT = ROOT / "finalists"
OUT.mkdir(exist_ok=True)
SOURCE = ROOT / "SCUTRacingTelemetry-2-navy-slanted-v2.png"
SIZES = [16,24,32,48,64,128,256]
S = 3
RESAMPLE = Image.Resampling.LANCZOS
source = Image.open(SOURCE).convert("RGBA")
rgb = np.asarray(source)[:,:,:3].astype(float)

# Recover antialias coverage against the navy backdrop. The white wordmarks
# are isolated spatially, preserving the original custom letter shapes.
def wordmark(box):
    x0,y0,x1,y1 = box
    pixels = rgb[y0:y1,x0:x1]
    coverage = np.clip((pixels.min(axis=2)-46)/207,0,1)
    coverage[coverage < .025] = 0
    return Image.fromarray(np.uint8(coverage*255))

scut = wordmark((60,413,1002,613))
racing = wordmark((76,674,1175,868))
font = ImageFont.truetype("C:/Windows/Fonts/arial.ttf",24)
smallfont = ImageFont.truetype("C:/Windows/Fonts/arial.ttf",17)

def make_icon(height, lean, gap):
    n=1024*S
    # Retain the original tile palette as a smooth navy fill; the source's
    # near-opaque alpha and stray edge pixels are replaced with a clean contour.
    tile=Image.new("RGBA",(n,n),(1,46,109,255))
    shape=Image.new("L",(n,n),0)
    ImageDraw.Draw(shape).rounded_rectangle((16*S,24*S,1008*S,1000*S),radius=200*S,fill=255)
    tile.putalpha(shape)
    width=890
    letter_w=717
    bar_w=32
    bar_gap=13
    shear=round(height*lean)
    bar_group=shear+3*bar_w+2*bar_gap
    total=letter_w+gap+bar_group
    left=(1024-total)/2
    top=round((1024-(height+54+157))/2)
    # Width is fixed, height is compressed. Retain the original source's
    # horizontal shear displacement so the letter stems do not become upright.
    original_slope=.49
    scaled_slope=original_slope*letter_w/scut.width*scut.height/height
    delta=lean-scaled_slope
    m=scut.resize((letter_w*S,height*S),RESAMPLE)
    m=m.transform(m.size,Image.Transform.AFFINE,(1,delta, -delta*(height*S-1)/2,0,1,0),Image.Resampling.BICUBIC)
    tile.paste((253,253,253,255),(round(left*S),top*S,round(left*S)+m.width,top*S+m.height),m)
    draw=ImageDraw.Draw(tile)
    bars=[]
    for i,color in enumerate([(0,108,252,255),(252,42,24,255),(87,247,49,255)]):
        x=left+letter_w+gap+i*(bar_w+bar_gap)
        points=[(x+shear,top),(x+shear+bar_w,top),(x+bar_w,top+height),(x,top+height)]
        draw.polygon([(round(px*S),round(py*S)) for px,py in points],fill=color)
        bars.append(points)
    r=racing.resize((round(total*S),157*S),RESAMPLE)
    ry=(top+height+54)*S
    tile.paste((253,253,253,255),(round(left*S),ry,round(left*S)+r.width,ry+r.height),r)
    icon=tile.resize((1024,1024),RESAMPLE)
    return icon,dict(scut_height=height,scut_width=letter_w,lean_from_vertical_degrees=round(math.degrees(math.atan(lean)),2),row_gap=54,bar_width=bar_w,bar_gap=bar_gap,bar_polygon_coordinates=bars,lockup_width=total)

def main():
    variants=[("A-subtle",137,.48,18),("B-balanced",128,.50,18),("C-low-profile",121,.52,18)]
    reports=[]
    icons=[]
    for name,h,lean,gap in variants:
        icon,details=make_icon(h,lean,gap)
        stem="SCUTRacingTelemetry-"+name
        icon.save(OUT/(stem+".png"),optimize=True)
        icon.save(OUT/(stem+".ico"),format="ICO",sizes=[(s,s) for s in SIZES])
        reports.append(dict(name=name,png_size=[1024,1024],ico_sizes=SIZES,**details))
        icons.append((name,icon))
    sheet=Image.new("RGB",(1800,760),(233,237,243))
    draw=ImageDraw.Draw(sheet)
    labels=["A / subtle compression","B / balanced (recommended)","C / lower profile"]
    for i,((name,icon),label) in enumerate(zip(icons,labels)):
        x=30+i*595
        draw.text((x,24),label,font=font,fill=(25,38,58))
        thumb=icon.resize((535,535),RESAMPLE)
        sheet.paste(thumb,(x,72),thumb)
        sx=x
        for size in [64,32,16]:
            t=icon.resize((size,size),RESAMPLE)
            sheet.paste(t,(sx,640+(64-size)//2),t)
            draw.text((sx+size+7,662),str(size)+"px",font=smallfont,fill=(62,75,94))
            sx+=170
    sheet.save(OUT/"comparison-finalists.png",optimize=True)
    (OUT/"export-report.json").write_text(json.dumps(reports,indent=2),encoding="utf-8")
    (OUT/"design-notes.md").write_text("""# SCUT Racing Telemetry finalists — 2026-10-14

Local deterministic pixel refinement of the existing slanted-v2 master. No image generation API was used.

Preserved the custom SCUT and Racing lettering, Racing underline, navy palette, and right-side blue/red/green order. Extracted the existing letter silhouettes, reduced SCUT height, and adjusted the shear to match the new parallel bars. Rebuilt the tile with a smooth navy fill and clean transparent rounded corners, removing source grain and near-opaque alpha. Each top row (SCUT plus bars) matches the Racing row width. SCUT text alone is narrower than Racing to make room for the right-side bars, consistent with the actual previous design.

A: SCUT height 137 px, bar lean 25.64 degrees. B: 128 px, 26.57 degrees (recommended). C: 121 px, 27.47 degrees. All three bars have the same height, width, spacing, and top/bottom alignment as SCUT. PNG: 1024 x 1024 RGBA. ICO frames: 16, 24, 32, 48, 64, 128, 256.

Application icon configuration was not changed. Reproduce with ../make-finalists.py.
""",encoding="utf-8")
    with zipfile.ZipFile(OUT/"SCUTRacingTelemetry-finalists.zip","w",zipfile.ZIP_DEFLATED) as z:
        for p in sorted(OUT.iterdir()):
            if p.suffix in [".png",".ico",".json",".md"]: z.write(p,p.name)
    print(json.dumps(reports,indent=2))

if __name__ == "__main__": main()
