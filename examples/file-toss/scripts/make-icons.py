#!/usr/bin/env python3
"""Makes every File Toss icon from docs/logo.png. Needs Pillow and numpy. Run from the app's folder."""
import numpy as np
from PIL import Image

SOURCE = '../../docs/logo.png'
SIZE = 1024

# The logo's flat background. app.json uses it too, as #121735.
NAVY = np.array([18, 23, 53], dtype=float)
# The background has a little noise, up to about 2% brighter than NAVY. Anything below this is background.
NOISE = 0.03

# The smallest circle around the artwork, in the logo's pixels, leaving out the very end of the fading trail.
CENTRE = (620, 640)
RADIUS = 520

# Android shows the middle 66 of the icon's 108 dp on every launcher shape.
SAFE_RADIUS = SIZE * 33 / 108
SPLASH_RADIUS = SIZE * 0.4


def matte(logo):
    """Lifts the art off the navy. Laid back over NAVY, the result looks the same as the logo."""
    pixels = np.asarray(logo, dtype=float)
    alpha = ((pixels - NAVY) / (255 - NAVY)).max(axis=2)
    alpha = np.clip((alpha - NOISE) / (1 - NOISE), 0, 1)[..., None]
    colour = (pixels - (1 - alpha) * NAVY) / np.maximum(alpha, 1 / 255)
    rgba = np.concatenate([np.clip(colour, 0, 255), alpha * 255], axis=2)
    return Image.fromarray(rgba.round().astype(np.uint8), 'RGBA')


def placed(art, radius):
    """The art on a clear square, with the artwork's circle centred and scaled to radius."""
    scale = radius / RADIUS
    side = round(art.width * scale)
    small = art.resize((side, side), Image.LANCZOS)
    canvas = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    canvas.paste(small, (round(SIZE / 2 - CENTRE[0] * scale), round(SIZE / 2 - CENTRE[1] * scale)))
    return canvas


def one_colour(image):
    """White, keeping only the shape. Android tints this to match the wallpaper."""
    white = Image.new('RGBA', image.size, (255, 255, 255, 0))
    white.putalpha(image.getchannel('A'))
    return white


logo = Image.open(SOURCE).convert('RGB')
art = matte(logo)
foreground = placed(art, SAFE_RADIUS)

logo.resize((SIZE, SIZE), Image.LANCZOS).save('assets/icon.png', optimize=True)
Image.new('RGB', (SIZE, SIZE), tuple(int(c) for c in NAVY)).save('assets/android-icon-background.png', optimize=True)
foreground.save('assets/android-icon-foreground.png', optimize=True)
one_colour(foreground).save('assets/android-icon-monochrome.png', optimize=True)
placed(art, SPLASH_RADIUS).save('assets/splash-icon.png', optimize=True)
