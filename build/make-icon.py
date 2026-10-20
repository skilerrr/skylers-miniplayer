#!/usr/bin/env python3
"""Generate Skyler's Miniplayer app icons.

Design: rounded glass tile with a vertical gradient, a bold white pixel eighth-note,
a small cyan sparkle and three EQ bars (the "now playing" cue).

Two hand-drawn pixel grids are used so the icon stays legible at every size:
  * GRID_BIG   32x32 -> 256 / 128 / 64 px entries
  * GRID_SMALL 16x16 -> 48 / 32 / 24 / 16 px entries

Outputs (committed to the repo):
  build/icon.ico   multi-size Windows icon (16, 24, 32, 48, 64, 128, 256)
  build/icon.png   512x512 preview / non-Windows icon

Run:  python build/make-icon.py
"""
from __future__ import annotations

import os
import pathlib
import struct
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"
# Optional per-size PNG dumps for visual diffing (not committed):
#   MINIPLAYER_ICON_PREVIEW=<dir> python build/make-icon.py
PREVIEW_DIR = pathlib.Path(os.environ["MINIPLAYER_ICON_PREVIEW"]) if "MINIPLAYER_ICON_PREVIEW" in os.environ else None

# --- palette -----------------------------------------------------------------
PALETTE = {
    "4": (0x23, 0x2D, 0x3D, 255),  # tile gradient, top
    "3": (0x1A, 0x23, 0x31, 255),
    "2": (0x12, 0x1A, 0x26, 255),
    "1": (0x0B, 0x0F, 0x16, 255),  # tile gradient, bottom
    "5": (0x3A, 0x47, 0x5C, 255),  # tile edge
    "H": (0x8E, 0xA8, 0xC9, 160),  # glass highlight
    "W": (0xFF, 0xFF, 0xFF, 255),  # note
    "C": (0x38, 0xBD, 0xF8, 255),  # cyan  (EQ bar 1 / sparkle)
    "M": (0x34, 0xD3, 0x99, 255),  # mint  (EQ bar 2)
    "A": (0xFF, 0x4D, 0x6D, 255),  # coral (EQ bar 3)
}


def rounded_tile(size: int, x0: int, y0: int, x1: int, y1: int, cut: int = 1):
    """Rounded rectangle pixel set; `cut` = extra corner pixels removed per side."""
    pixels = set()
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            if (x - x0) + (y - y0) < cut + 1:          # top-left
                continue
            if (x1 - x) + (y - y0) < cut + 1:          # top-right
                continue
            if (x - x0) + (y1 - y) < cut + 1:          # bottom-left
                continue
            if (x1 - x) + (y1 - y) < cut + 1:          # bottom-right
                continue
            pixels.add((x, y))
    return pixels


def build_grid(size: int, art) -> Image.Image:
    """Render one pixel grid. `art(x, y) -> key | None` places the foreground."""
    tile = rounded_tile(size, 1 if size == 16 else 2, 1 if size == 16 else 2,
                        size - 2, size - 2, cut=1)
    inner = {(x, y) for (x, y) in tile
             if all((x + dx, y + dy) in tile for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))}
    ys = sorted({y for _, y in tile})
    y_min, y_max = ys[0], ys[-1]

    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    px = img.load()
    for (x, y) in tile:
        if (x, y) not in inner:
            px[x, y] = PALETTE["5"]                                    # edge
            continue
        t = (y - y_min) / max(1, (y_max - y_min))
        band = "4" if t < 0.22 else "3" if t < 0.5 else "2" if t < 0.78 else "1"
        px[x, y] = PALETTE[band]

    # glass highlight: one light row near the top, inset from the corners
    for x in range(y_min + 5, size - (y_min + 5)):
        if (x, y_min + 1) in inner:
            px[x, y_min + 1] = PALETTE["H"]

    for (x, y) in art(size):
        px[x, y] = PALETTE[art(size)[(x, y)]]
    return img


def art_big(size: int) -> dict:
    a = {}
    # eighth-note head (bottom left)
    for x in range(10, 14): a[(x, 19)] = "W"
    for x in range(9, 15):  a[(x, 20)] = "W"
    for x in range(8, 16):  a[(x, 21)] = "W"; a[(x, 22)] = "W"
    for x in range(9, 15):  a[(x, 23)] = "W"
    for x in range(10, 14): a[(x, 24)] = "W"
    # stem + flag
    for y in range(6, 20): a[(14, y)] = "W"; a[(15, y)] = "W"
    for x in range(16, 21): a[(x, 6)] = "W"
    for x in range(18, 22): a[(x, 7)] = "W"
    for x in range(19, 22): a[(x, 8)] = "W"
    for x in range(20, 22): a[(x, 9)] = "W"; a[(x, 10)] = "W"
    # sparkle (cyan plus sign)
    a[(24, 11)] = "C"; a[(23, 12)] = "C"; a[(24, 12)] = "W"
    a[(25, 12)] = "C"; a[(24, 13)] = "C"
    # EQ bars, baseline y=28
    for y in range(25, 29): a[(20, y)] = "C"; a[(21, y)] = "C"
    for y in range(23, 29): a[(23, y)] = "M"; a[(24, y)] = "M"
    for y in range(26, 29): a[(26, y)] = "A"; a[(27, y)] = "A"
    return a


def art_small(size: int) -> dict:
    a = {}
    # head
    for x in range(4, 7):   a[(x, 10)] = "W"
    for x in range(3, 8):   a[(x, 11)] = "W"; a[(x, 12)] = "W"
    for x in range(4, 7):   a[(x, 13)] = "W"
    # stem + flag
    for y in range(4, 11):  a[(6, y)] = "W"; a[(7, y)] = "W"
    for x in range(8, 11):  a[(x, 3)] = "W"
    for x in range(9, 12):  a[(x, 4)] = "W"
    for x in range(10, 12): a[(x, 5)] = "W"
    # EQ bars, baseline y=13
    for y in range(9, 14):  a[(9, y)] = "C"; a[(10, y)] = "C"
    for y in range(10, 14): a[(12, y)] = "A"; a[(13, y)] = "A"
    return a


GRIDS = {32: (build_grid, art_big), 16: (build_grid, art_small)}

# target size -> (source grid size, integer scale or None for nearest fit)
ENTRIES = [
    (256, 32, 8),
    (128, 32, 4),
    (64, 32, 2),
    (48, 16, 3),
    (32, 32, 1),
    (24, 16, None),
    (16, 16, 1),
]


def render(target: int) -> Image.Image:
    src_size, scale = next((s, k) for (t, s, k) in ENTRIES if t == target)
    base = build_grid(src_size, GRIDS[src_size][1])
    if scale is None:
        return base.resize((target, target), Image.NEAREST)
    return base.resize((src_size * scale, src_size * scale), Image.NEAREST)


def bmp_entry(img: Image.Image) -> bytes:
    """32bpp BITMAPINFOHEADER + AND mask, as required inside an .ico."""
    w, h = img.size
    rgba = img.convert("RGBA")
    header = struct.pack("<IiiHHIIiiII", 40, w, h * 2, 1, 32, 0, 0, 0, 0, 0, 0)
    body = bytearray()
    for y in range(h - 1, -1, -1):                       # bottom-up
        for x in range(w):
            r, g, b, a = rgba.getpixel((x, y))
            body += bytes((b, g, r, a))
    mask_row = ((w + 31) // 32) * 4
    mask = bytearray()
    for y in range(h - 1, -1, -1):
        row = bytearray(mask_row)
        for x in range(w):
            if rgba.getpixel((x, y))[3] < 128:
                row[x // 8] |= 0x80 >> (x % 8)
        mask += row
    return header + bytes(body) + bytes(mask)


def main() -> None:
    BUILD.mkdir(exist_ok=True)
    from io import BytesIO

    entries = []
    for target, _src, _scale in sorted(ENTRIES, reverse=True):
        img = render(target)
        if target >= 256:
            buf = BytesIO()
            img.save(buf, format="PNG", optimize=True)
            payload = buf.getvalue()
        else:
            payload = bmp_entry(img)
        entries.append((target, payload))
        if PREVIEW_DIR is not None:
            PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
            img.save(PREVIEW_DIR / f"_icon_{target}.png")
        print(f"  {target:>3}x{target:<3} {len(payload):>7,} bytes")

    count = len(entries)
    offset = 6 + 16 * count
    header = struct.pack("<HHH", 0, 1, count)
    directory = bytearray()
    blob = bytearray()
    for target, payload in entries:
        w = 0 if target >= 256 else target
        h = 0 if target >= 256 else target
        directory += struct.pack("<BBBBHHII", w, h, 0, 0, 1, 32, len(payload), offset)
        blob += payload
        offset += len(payload)

    ico = BUILD / "icon.ico"
    ico.write_bytes(header + bytes(directory) + bytes(blob))
    print(f"icon.ico  {ico.stat().st_size:,} bytes, {count} sizes")

    icon_png = BUILD / "icon.png"
    render(256).resize((512, 512), Image.NEAREST).save(icon_png)
    print(f"icon.png  {icon_png.stat().st_size:,} bytes, 512x512")


if __name__ == "__main__":
    main()
