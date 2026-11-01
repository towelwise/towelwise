"""Regenerates ide/icons/win32/* from ide/icons/towelwise.png. A dev tool, not run by the build.

Needs Pillow. Run from the repo root: python ide/icons/make_icons.py
"""
from pathlib import Path

from PIL import Image

here = Path(__file__).parent
source = Image.open(here / "towelwise.png").convert("RGBA")
out = here / "win32"
out.mkdir(exist_ok=True)

source.save(out / "code.ico", sizes=[(s, s) for s in (16, 24, 32, 48, 64, 128, 256)])
for size in (150, 70):
    source.resize((size, size), Image.LANCZOS).save(out / f"code_{size}x{size}.png")
