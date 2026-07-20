#!/usr/bin/env python3
"""Generate Elelany's app icon as a 2048px PNG (downscaled to 1024 by sips).
Pure standard library: no Pillow / ImageMagick needed."""
import math, struct, zlib, sys

S = 2048                      # supersample resolution (downscaled later)
MARGIN = 160                  # transparent border around the rounded square
RADIUS = 384                  # corner radius of the rounded square
x0, y0 = MARGIN, MARGIN
x1, y1 = S - MARGIN, S - MARGIN

TOP = (253, 186, 116)         # #fdba74 peach
BOT = (234, 88, 12)           # #ea580c orange
WHITE = (255, 255, 255)

# --- geometry of the "E" (centered) -----------------------------------
cx = cy = S // 2
h, w, t = 940, 660, 184
ex0, ex1 = cx - w // 2, cx + w // 2
ey0, ey1 = cy - h // 2, cy + h // 2
mid0, mid1 = cy - t // 2, cy + t // 2
mid_right = ex0 + int(w * 0.82)

def e_spans(y):
    """White x-spans of the letter E for a given row y (or [])."""
    if not (ey0 <= y < ey1):
        return []
    if y0 <= y - 0 and (ey0 <= y < ey0 + t):          # top bar
        return [(ex0, ex1)]
    if ey1 - t <= y < ey1:                             # bottom bar
        return [(ex0, ex1)]
    if mid0 <= y < mid1:                               # middle bar
        return [(ex0, mid_right)]
    return [(ex0, ex0 + t)]                            # vertical stem

def lerp(a, b, f):
    return tuple(int(round(a[i] + (b[i] - a[i]) * f)) for i in range(3))

raw = bytearray()
transparent_row = bytes(S * 4)

for y in range(S):
    if not (y0 <= y < y1):
        raw.append(0)                 # PNG filter byte (none)
        raw += transparent_row
        continue

    # rounded-corner horizontal inset for this row
    inset = 0
    dt, db = y - y0, (y1 - 1) - y
    if dt < RADIUS:
        d = RADIUS - dt
        inset = max(inset, RADIUS - int(math.sqrt(max(0, RADIUS * RADIUS - d * d))))
    if db < RADIUS:
        d = RADIUS - db
        inset = max(inset, RADIUS - int(math.sqrt(max(0, RADIUS * RADIUS - d * d))))
    lx, rx = x0 + inset, x1 - inset

    f = (y - y0) / (y1 - y0)
    r, g, b = lerp(TOP, BOT, f)

    row = bytearray(transparent_row)
    fill = bytes((r, g, b, 255)) * (rx - lx)
    row[lx * 4:rx * 4] = fill

    for sx, sxe in e_spans(y):
        sx = max(sx, lx); sxe = min(sxe, rx)
        if sxe > sx:
            row[sx * 4:sxe * 4] = bytes((*WHITE, 255)) * (sxe - sx)

    raw.append(0)
    raw += row

def chunk(tag, data):
    return (struct.pack(">I", len(data)) + tag + data +
            struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

png = b"\x89PNG\r\n\x1a\n"
png += chunk(b"IHDR", struct.pack(">IIBBBBB", S, S, 8, 6, 0, 0, 0))
png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
png += chunk(b"IEND", b"")

out = sys.argv[1] if len(sys.argv) > 1 else "icon-2048.png"
with open(out, "wb") as f:
    f.write(png)
print("wrote", out, len(png), "bytes")
