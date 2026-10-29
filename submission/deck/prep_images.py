"""Crop the real app screens and photos for the deck, and round their corners.

Corners are painted in the slide's background colour (limestone or ink), so the
files stay small JPEGs. Run from anywhere: python3 prep_images.py

assets/frames/ holds stills taken from the capture videos in submission/capture/out/:
  ffmpeg -ss 42 -i collab-064824.webm -frames:v 1 assets/frames/collab-42.jpg   (pin card)
  ffmpeg -ss 48 -i collab-064824.webm -frames:v 1 assets/frames/collab-48.jpg   (share dialog)
  ffmpeg -ss 250 -i collab-064824.webm -frames:v 1 assets/frames/collab-250.jpg (revision answer)
  ffmpeg -ss 20 -i client-060707.webm -frames:v 1 assets/frames/client-20.jpg   (Ammi's comment)
"""
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
SCREENS = REPO / "docs" / "screens"
SUB = REPO / "submission"
FRAMES = HERE / "assets" / "frames"
OUT = HERE / "assets" / "img"
OUT.mkdir(parents=True, exist_ok=True)

LIME = (0xF3, 0xF2, 0xEE)
INK = (0x11, 0x11, 0x13)
WHITE = (0xFF, 0xFF, 0xFF)


def crop(src, box=None, aspect=None):
    im = Image.open(src).convert("RGB")
    if box:
        x, y, w, h = box
        if aspect and h is None:
            h = round(w / aspect)
        im = im.crop((x, y, x + w, y + h))
    return im


def rounded(im, bg, radius_frac=0.035, max_w=1600):
    if im.width > max_w:
        im = im.resize((max_w, round(im.height * max_w / im.width)), Image.LANCZOS)
    r = max(6, round(min(im.size) * radius_frac))
    s = 4  # supersample the mask for smooth corners
    mask = Image.new("L", (im.width * s, im.height * s), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, im.width * s - 1, im.height * s - 1), radius=r * s, fill=255
    )
    mask = mask.resize(im.size, Image.LANCZOS)
    base = Image.new("RGB", im.size, bg)
    base.paste(im, (0, 0), mask)
    return base


def save(im, name, q=90):
    im.save(OUT / name, quality=q, optimize=True)
    print(name, im.size)


# Cover: the front photo, cropped tall for a full-bleed right panel (7.33 x 7.5 in).
front = Image.open(SUB / "gallery-front.jpg").convert("RGB")
w = round(front.height * 7.333 / 7.5)
cx = 690
save(front.crop((cx - w // 2, 0, cx + w // 2, front.height)), "cover-front.jpg")

# Team slide: the aerial photo, cropped tall for a full-bleed right panel (5.6 x 7.5 in).
aerial = Image.open(SUB / "gallery-aerial.jpg").convert("RGB")
w = round(aerial.height * 5.6 / 7.5)
cx = 700
save(aerial.crop((cx - w // 2, 0, cx + w // 2, aerial.height)), "team-aerial.jpg")

# Results slide: the corner photo, an inset panel on ink (4.83 x 4.8 in).
corner = Image.open(SUB / "gallery-corner.jpg").convert("RGB")
w = round(corner.height * 4.83 / 4.8)
cx = 760
save(rounded(corner.crop((cx - w // 2, 0, cx + w // 2, corner.height)), INK, 0.03), "results-corner.jpg")

# Journey tiles: one aspect for all nine (2.3 x 1.45 in).
TA = 2.3 / 1.45
tiles = {
    "j1-brief.jpg": (SCREENS / "rules.jpg", (40, 112, 290, None)),
    "j2-rules.jpg": (SCREENS / "rules.jpg", (978, 506, 300, None)),
    "j3-drawing.jpg": (SCREENS / "drawing.jpg", (514, 520, 460, None)),
    "j4-concepts.jpg": (SCREENS / "concepts.jpg", (230, 160, 980, None)),
    "j5-plan.jpg": (SCREENS / "plan.jpg", (470, 100, 500, None)),
    "j6-house.jpg": (SCREENS / "house.jpg", (180, 40, 1120, None)),
    "j7-match.jpg": (SCREENS / "match.jpg", (8, 150, 640, None)),
    "j8-photos.jpg": (SCREENS / "photos.jpg", (300, 70, 860, None)),
    "j9-walk.jpg": (SCREENS / "walk.jpg", (240, 40, 1000, None)),
}
for name, (src, box) in tiles.items():
    save(rounded(crop(src, box, TA), LIME, 0.05), name)

# Full screens on limestone.
for name in ["match"]:
    save(rounded(crop(SCREENS / f"{name}.jpg"), LIME, 0.025), f"{name}-lime.jpg")

# Full screens on ink.
for name in ["house"]:
    save(rounded(crop(SCREENS / f"{name}.jpg"), INK, 0.025), f"{name}-ink.jpg")

# The brief, as one chat bubble with the agent's reply (solution slide).
save(rounded(crop(SCREENS / "rules.jpg", (20, 120, 300, 192)), WHITE, 0.06), "brief-bubble.jpg")

# The fixers' countdown card on the plan screen.
save(rounded(crop(SCREENS / "plan.jpg", (548, 108, 346, 78)), WHITE, 0.12), "plan-countdown.jpg")

# Photos made from the 3D model, on limestone.
for g in ["front", "corner", "garden", "aerial"]:
    save(rounded(crop(SUB / f"gallery-{g}.jpg"), LIME, 0.03), f"photo-{g}.jpg")

# Collaboration stills from the capture videos (collab-064824.webm, client-060707.webm).
collab = {
    "collab-pin.jpg": (FRAMES / "collab-42.jpg", (756, 332, 408, 416)),
    "collab-client.jpg": (FRAMES / "client-20.jpg", (766, 516, 388, 446)),
    "collab-share.jpg": (FRAMES / "collab-48.jpg", (690, 90, 540, 475)),
    "collab-revise.jpg": (FRAMES / "collab-250.jpg", (22, 895, 405, 172)),
}
for name, (src, box) in collab.items():
    save(rounded(crop(src, box), LIME, 0.04), name, q=93)

# Tavily slide: the brief chat and the researched CDA rules, as two legible portrait crops of rules.jpg.
save(rounded(crop(SCREENS / "rules.jpg", (8, 52, 318, 672)), LIME, 0.04), "rules-chat.jpg")
save(rounded(crop(SCREENS / "rules.jpg", (972, 48, 300, 680)), LIME, 0.04), "rules-brief.jpg")

# The two sheets uploaded in the demo (the e2e fixtures the capture script uploads), and the app's "rooms read" card.
for f in ["plan-ground", "plan-first"]:
    save(rounded(crop(REPO / "e2e" / "fixtures" / f"{f}.png"), LIME, 0.03), f"sheet-{f}.jpg")
save(rounded(crop(SCREENS / "drawing.jpg", (515, 628, 455, 92)), LIME, 0.08), "drawing-read.jpg")
