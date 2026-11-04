"""Generate TareMate PWA icons. Run: uv run --python .venv tools/make_icons.py"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent.parent / "icons"
OUT.mkdir(exist_ok=True)
BG, LCD, INK, ACC = (11, 18, 32), (200, 214, 170), (40, 110, 230), (242, 169, 0)


def font(size):
    for name in ("arialbd.ttf", "DejaVuSans-Bold.ttf", "arial.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def icon(size, maskable=False):
    img = Image.new("RGB", (size, size), BG)
    d = ImageDraw.Draw(img)
    pad = size * (0.2 if maskable else 0.1)
    # LCD panel
    x0, y0, x1, y1 = pad, size * 0.3, size - pad, size * 0.7
    d.rounded_rectangle((x0, y0, x1, y1), radius=size * 0.05, fill=LCD, outline=INK, width=max(2, size // 64))
    f = font(int((y1 - y0) * 0.62))
    text = "25.0"
    w = d.textlength(text, font=f)
    d.text(((size - w) / 2, y0 + (y1 - y0) * 0.14), text, font=f, fill=INK)
    # progress bar under the panel
    by = size * 0.76
    d.rounded_rectangle((x0, by, x1, by + size * 0.06), radius=size * 0.03, fill=(40, 52, 80))
    d.rounded_rectangle((x0, by, x0 + (x1 - x0) * 0.8, by + size * 0.06), radius=size * 0.03, fill=ACC)
    return img


icon(192).save(OUT / "icon-192.png")
icon(512).save(OUT / "icon-512.png")
icon(512, maskable=True).save(OUT / "icon-maskable-512.png")
print("icons written to", OUT)
