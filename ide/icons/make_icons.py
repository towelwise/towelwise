"""Regenerates ide/icons/win32/* from ide/icons/towelwise.png. A dev tool, not run by the build.

The source picture sits on a solid dark background. This takes that background out, so the executable
and taskbar icon are transparent, and writes a preview on a checkerboard next to the output.

Needs Pillow. Run from the repo root: python -I ide/icons/make_icons.py
"""
from pathlib import Path

from PIL import Image

here = Path(__file__).parent
source = Image.open(here / "towelwise.png").convert("RGBA")

# The background is the corner colour. Flood fill from the picture's border to find the background that
# is connected to the outside, so the figure keeps its own shading; only that background goes transparent.
# The one-pixel soft edge around the figure is partly background, so its colour is un-blended and its
# alpha eased, which avoids a dark fringe.
from collections import deque

bg = source.getpixel((0, 0))[:3]
width, height = source.size
src = source.load()


def distance(x, y):
    # How far the brightest channel is ABOVE the background. Anti-aliasing can leave edge pixels a little
    # darker than the background (an undershoot); those count as background, not as figure, so no grey speckle.
    r, g, b, _ = src[x, y]
    return max(r - bg[0], g - bg[1], b - bg[2])


outside = set()
queue = deque((x, y) for x in range(width) for y in (0, height - 1))
queue.extend((x, y) for y in range(height) for x in (0, width - 1))
while queue:
    x, y = queue.popleft()
    if (x, y) in outside or not (0 <= x < width and 0 <= y < height) or distance(x, y) > 14:
        continue
    outside.add((x, y))
    queue.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))

clear = source.copy()
dst = clear.load()
EDGE = 120  # how far from the background colour a pixel must be to count as fully figure
for y in range(height):
    for x in range(width):
        if (x, y) in outside:
            dst[x, y] = (0, 0, 0, 0)
            continue
        touches = any(((x + dx, y + dy) in outside) for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))
        if touches:
            alpha = min(1.0, max(distance(x, y), 1) / EDGE)
            r, g, b, _ = src[x, y]
            dst[x, y] = tuple(
                max(0, min(255, round((c - (1 - alpha) * q) / alpha))) for c, q in zip((r, g, b), bg)
            ) + (round(alpha * 255),)

out = here / "win32"
out.mkdir(exist_ok=True)
clear.save(out / "code.ico", sizes=[(s, s) for s in (16, 24, 32, 48, 64, 128, 256)])
for size in (150, 70):
    clear.resize((size, size), Image.LANCZOS).save(out / f"code_{size}x{size}.png")

# A look at the result on light and dark squares, kept out of the repo's inputs.
preview = Image.new("RGBA", (clear.width * 2, clear.height), (255, 255, 255, 255))
preview.paste(Image.new("RGBA", (clear.width, clear.height), (32, 32, 32, 255)), (clear.width, 0))
for i in range(2):
    preview.alpha_composite(clear, (i * clear.width, 0))
preview.save(here / "preview-transparent.png")
