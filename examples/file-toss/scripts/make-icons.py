#!/usr/bin/env python3
"""Draws every File Toss icon from one design. Needs rsvg-convert. Run from the app's folder."""
import subprocess

NAVY, NAVY_LIGHT, CORAL, PAPER, INK = '#1B1F3B', '#2C3263', '#FF6B4A', '#FFFFFF', '#1B1F3B'

# A real-looking corner of a QR code: three finder squares and a scatter of modules.
MODULES = """
1110111
1010101
0101110
1101001
0110111
1011010
0111101
"""


def finder(x, y, u, ink):
    return (
        f'<path fill-rule="evenodd" fill="{ink}" d="M{x} {y}h{7*u}v{7*u}h{-7*u}zM{x+u} {y+u}v{5*u}h{5*u}v{-5*u}z"/>'
        f'<rect x="{x+2*u}" y="{y+2*u}" width="{3*u}" height="{3*u}" fill="{ink}"/>'
    )


def code(x, y, u, ink):
    parts = [finder(x, y, u, ink), finder(x + 13 * u, y, u, ink), finder(x, y + 13 * u, u, ink)]
    rows = MODULES.split()
    for r, row in enumerate(rows):
        for c, bit in enumerate(row):
            if bit == '1':
                parts.append(f'<rect x="{x+(c+13)*u}" y="{y+(r+13)*u}" width="{u}" height="{u}" fill="{ink}"/>')
    for r, c in [(8, 2), (9, 5), (10, 0), (11, 3), (2, 9), (4, 11), (0, 8), (6, 10), (9, 9), (11, 11), (8, 14), (10, 17), (9, 19), (12, 8), (15, 9), (17, 11), (19, 8)]:
        parts.append(f'<rect x="{x+c*u}" y="{y+r*u}" width="{u}" height="{u}" fill="{ink}"/>')
    return ''.join(parts)


def sheet(paper, ink, fold):
    """A page with a folded corner, 400 wide and 500 tall, with its centre at the origin."""
    page = f'<path fill="{paper}" d="M-170 -250H90L200 -140V220a30 30 0 0 1 -30 30H-170a30 30 0 0 1 -30 -30V-220a30 30 0 0 1 30 -30z"/>'
    corner = f'<path fill="{fold}" d="M90 -250L200 -140H120a30 30 0 0 1 -30 -30z"/>'
    return page + corner + code(-147, -62, 14, ink)


def flight(colour):
    """The arc the page was thrown along, fading out behind it."""
    dots = [(120, 800, 22), (205, 745, 28), (295, 672, 34)]
    return ''.join(f'<circle cx="{x}" cy="{y}" r="{r}" fill="{colour}"/>' for x, y, r in dots)


def art(paper, ink, fold, colour, scale, shift=(0, 0)):
    dx, dy = shift
    return (
        f'<g transform="translate({512+dx} {512+dy}) scale({scale}) translate(-512 -512)">'
        f'{flight(colour)}'
        f'<g transform="translate(590 440) rotate(14)">{sheet(paper, ink, fold)}</g>'
        '</g>'
    )


def svg(body, defs=''):
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><defs>{defs}</defs>{body}</svg>'


GRADIENT = f'<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{NAVY_LIGHT}"/><stop offset="1" stop-color="{NAVY}"/></linearGradient>'
BACKGROUND = '<rect width="1024" height="1024" fill="url(#bg)"/>'
FOLD = '#D8DAE8'

ICONS = {
    'icon': svg(BACKGROUND + art(PAPER, INK, FOLD, CORAL, 0.92), GRADIENT),
    'android-icon-background': svg(BACKGROUND, GRADIENT),
    # Android crops to the middle two thirds, so this is smaller than the full icon.
    'android-icon-foreground': svg(art(PAPER, INK, FOLD, CORAL, 0.68)),
    # One colour, so the page's code is cut out of it rather than drawn on it.
    'android-icon-monochrome': svg(
        '<mask id="m"><rect width="1024" height="1024" fill="#000"/>'
        + art('#fff', '#000', '#fff', '#fff', 0.68)
        + '</mask><rect width="1024" height="1024" fill="#fff" mask="url(#m)"/>'
    ),
    'splash-icon': svg(art(PAPER, INK, FOLD, CORAL, 0.8)),
}

for name, source in ICONS.items():
    subprocess.run(['rsvg-convert', '-o', f'assets/{name}.png'], input=source.encode(), check=True)
