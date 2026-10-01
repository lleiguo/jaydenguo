"""Draws the app icon (intent 0004, plan N8.3, AUTH-3): a calendar page on
blue, nothing about the family. Run from ios/: python3 scripts/make-icon.py"""
from PIL import Image, ImageDraw

S = 1024
img = Image.new("RGB", (S, S))
top, bottom = (40, 120, 230), (20, 70, 170)
for y in range(S):
    t = y / (S - 1)
    ImageDraw.Draw(img).line([(0, y), (S, y)], fill=tuple(round(a + (b - a) * t) for a, b in zip(top, bottom)))
d = ImageDraw.Draw(img)
# The page, its header band and the two rings.
x0, y0, x1, y1 = 212, 250, 812, 820
d.rounded_rectangle([x0, y0, x1, y1], radius=90, fill="white")
d.rounded_rectangle([x0, y0, x1, y0 + 170], radius=90, fill=(255, 95, 80))
d.rectangle([x0, y0 + 90, x1, y0 + 170], fill=(255, 95, 80))
for cx in (372, 652):
    d.rounded_rectangle([cx - 28, y0 - 60, cx + 28, y0 + 60], radius=28, fill=(235, 240, 250))
# A 4 x 3 grid of days, one ringed.
cols, rows = 4, 3
gx0, gy0, gw, gh = x0 + 80, y0 + 230, (x1 - x0) - 160, (y1 - y0) - 300
for r in range(rows):
    for c in range(cols):
        cx = gx0 + gw * (c + 0.5) / cols
        cy = gy0 + gh * (r + 0.5) / rows
        rad = 34
        if (r, c) == (1, 2):
            d.ellipse([cx - rad - 22, cy - rad - 22, cx + rad + 22, cy + rad + 22], outline=(40, 120, 230), width=16)
        d.ellipse([cx - rad, cy - rad, cx + rad, cy + rad], fill=(40, 120, 230) if (r, c) == (1, 2) else (200, 210, 225))
img.save("HubApp/Assets.xcassets/AppIcon.appiconset/AppIcon.png")
