# Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
"""The installable app's extra images, made only from images already in the repo (no renders, no downloads):

  brand/emblem/emblem-maskable-512.png  the emblem inside the central 80% safe zone on the app's #04060a, so Android's
                                        adaptive icon shapes (circle, squircle, teardrop) never cut the radar ring
  brand/social/screen-narrow.jpg        720x1280, from brand/hero/hero-tall.jpg  (the manifest's form_factor "narrow")
  brand/social/screen-wide.jpg          1280x800, from brand/hero/hero-wide.jpg  (form_factor "wide")
                                        (JPEG: they are photographs, a third of the PNG size; the install sheet downloads them)

manifest.webmanifest names them; test/whatsnew.test.mjs checks the sizes it declares. Run from the repo root:
  python brand/tools/pwa_images.py
"""
import os
from PIL import Image, PngImagePlugin

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BG = (4, 6, 10)            # #04060a, the manifest's background_color
SAFE = 0.78                # the emblem's ring spans this share of the icon (the safe zone is a circle of 80%)
NOTE = 'Copyright (c) 2026 Destin Jones. Open Overwatch (https://github.com/destinjones/open-overwatch), MIT License.'


def p(*parts):
    return os.path.join(ROOT, *parts)


def save(im, path):
    info = PngImagePlugin.PngInfo()
    info.add_text('Author', 'Destin Jones')
    info.add_text('Copyright', NOTE)
    if path.endswith('.jpg'):
        im.save(path, quality=85, optimize=True, progressive=True, comment=NOTE.encode())   # the COM segment
    else:
        im.save(path, optimize=True, pnginfo=info)
    print(os.path.relpath(path, ROOT), im.size, os.path.getsize(path) // 1024, 'KB')


def maskable(size=512):
    src = Image.open(p('brand', 'emblem', 'emblem-1024.png')).convert('RGBA')
    box = src.getchannel('A').point(lambda a: 255 if a > 8 else 0).getbbox()   # the ring itself, not the transparent margin
    ring = src.crop(box)
    scale = SAFE * size / max(ring.size)
    ring = ring.resize((round(ring.width * scale), round(ring.height * scale)), Image.LANCZOS)
    out = Image.new('RGBA', (size, size), BG + (255,))
    out.alpha_composite(ring, ((size - ring.width) // 2, (size - ring.height) // 2))
    save(out.convert('RGB'), p('brand', 'emblem', 'emblem-maskable-512.png'))


def cover(src, w, h, dest):
    """Scale to fill w x h and crop the middle (the hero images are already the right shape, near enough)."""
    im = Image.open(p(*src)).convert('RGB')
    s = max(w / im.width, h / im.height)
    im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    x, y = (im.width - w) // 2, (im.height - h) // 2
    save(im.crop((x, y, x + w, y + h)), p(*dest))


if __name__ == '__main__':
    maskable()
    cover(('brand', 'hero', 'hero-tall.jpg'), 720, 1280, ('brand', 'social', 'screen-narrow.jpg'))
    cover(('brand', 'hero', 'hero-wide.jpg'), 1280, 800, ('brand', 'social', 'screen-wide.jpg'))
