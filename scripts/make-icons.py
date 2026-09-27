"""Draws the app icons (plan M1.12): a plain calendar glyph on blue, nothing
personal (spec AUTH-3). Standard library only; re-run to regenerate."""
import struct
import zlib

BLUE = (29, 78, 216)
WHITE = (255, 255, 255)
RED = (209, 36, 47)


def draw(size, safe):
    # `safe` shrinks the glyph into the maskable-icon safe zone.
    px = [[BLUE] * size for _ in range(size)]
    s = size * (0.56 if safe else 0.7)
    x0 = (size - s) / 2
    y0 = (size - s) / 2 + size * 0.02
    x1, y1 = x0 + s, y0 + s
    top = y0 + s * 0.24
    radius = s * 0.08

    def inside_rounded(x, y):
        if not (x0 <= x <= x1 and y0 <= y <= y1):
            return False
        cx = min(max(x, x0 + radius), x1 - radius)
        cy = min(max(y, y0 + radius), y1 - radius)
        return (x - cx) ** 2 + (y - cy) ** 2 <= radius**2

    for y in range(size):
        for x in range(size):
            if inside_rounded(x + 0.5, y + 0.5):
                px[y][x] = RED if y + 0.5 < top else WHITE
    # A 3x2 grid of day squares.
    cell = s * 0.16
    gap = (s - 3 * cell) / 4
    for r in range(2):
        for c in range(3):
            cx0 = x0 + gap + c * (cell + gap)
            cy0 = top + (y1 - top - 2 * cell) / 3 * (r + 1) + r * cell
            for y in range(int(cy0), int(cy0 + cell)):
                for x in range(int(cx0), int(cx0 + cell)):
                    px[y][x] = BLUE
    return px


def png(px):
    h, w = len(px), len(px[0])
    raw = b"".join(b"\x00" + bytes(v for p in row for v in p) for row in px)
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


for name, size, safe in [
    ("icon-192.png", 192, False),
    ("icon-512.png", 512, False),
    ("maskable-512.png", 512, True),
    ("apple-touch-icon.png", 180, False),
]:
    with open(f"public/icons/{name}", "wb") as f:
        f.write(png(draw(size, safe)))
print("icons written")
