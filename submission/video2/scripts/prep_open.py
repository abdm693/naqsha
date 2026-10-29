"""Assets for the opening (mg-cold, mg-hook, mg-title): brand marks, full-bleed shots, grain and the plan outline.

Logos come from official sources only (media-use logo resolve: theSVG / simple-icons; Nebius wordmark from nebius.com);
they are copied, never redrawn. Run once: python3 scripts/prep_open.py
"""
import json
import shutil
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
REPO = ROOT.parent.parent
IMG = ROOT / "assets/img"
FOOT = ROOT / "assets/footage"
MEDIA = ROOT / ".media/images"
SCRATCH_NEBIUS = Path(__file__).with_name("nebius-wordmark.svg")   # decoded from nebius.com's footer logo

BRAND = {"nvidia.svg": MEDIA / "logo_001.svg", "nebius-mark.svg": MEDIA / "logo_002.svg",
         "tavily.svg": MEDIA / "logo_003.svg", "gemini.svg": MEDIA / "logo_004.svg"}


def brand():
    out = IMG / "brand"
    out.mkdir(parents=True, exist_ok=True)
    for name, src in BRAND.items():
        if src.exists():
            shutil.copy(src, out / name)
    if SCRATCH_NEBIUS.exists():
        shutil.move(SCRATCH_NEBIUS, out / "nebius.svg")


def photos():
    out = IMG / "photos"
    out.mkdir(parents=True, exist_ok=True)
    for v in ("front", "corner", "garden", "aerial"):
        shutil.copy(REPO / "submission" / f"gallery-{v}.jpg", out / f"{v}.jpg")


def clip(name, src_t, dur, rate):
    """A full-bleed shot of the 3D viewer: the app's chrome and hint line cropped away, sped up, 1080p."""
    crop = "crop=1520:855:200:100,scale=1920:1080:flags=lanczos"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-ss", str(src_t), "-t", str(dur * rate),
                    "-i", str(FOOT / "full-022242.mp4"), "-an",
                    "-vf", f"{crop},setpts=PTS/{rate},fps=30", "-c:v", "libx264", "-crf", "16",
                    "-preset", "slow", "-g", "15", "-pix_fmt", "yuv420p", str(FOOT / f"{name}.mp4")], check=True)


def grain():
    from PIL import Image
    import random
    rnd = random.Random(7)
    im = Image.new("L", (512, 512))
    im.putdata([max(0, min(255, int(rnd.gauss(128, 46)))) for _ in range(512 * 512)])
    im.save(IMG / "grain.png")


def plan():
    """Rooms of the sample house (p_a8d80f29e8cd, v1) as boxes in plot feet, for the canvas build-up."""
    src = HERE / "open_plan.src.json"
    p = json.loads(src.read_text())
    lv = {l["id"]: l for l in p["levels"]}
    open_types = {"lawn", "porch", "terrace", "balcony", "driveway", "court", "courtyard", "garden", "open", "open_space"}
    rooms = []
    for r in p["rooms"]:
        L = lv[r["level"]]
        x, y, w, d = (r["rect"][k] for k in ("x", "y", "w", "d"))
        kind = "open" if r.get("type") in open_types else "room"
        rooms.append({"n": r["name"], "f": L["index"], "x": x, "y": y, "w": w, "d": d,
                      "z": L["elevation_ft"], "h": L["height_ft"] if kind == "room" else 3.5, "k": kind})
    site = p["site"]
    out = {"plot": site["plot"], "setbacks": site["setbacks_ft"], "rooms": rooms,
           "rooms_n": sum(1 for r in rooms if r["k"] == "room"), "floors": 2}
    (HERE / "open_plan.json").write_text(json.dumps(out, separators=(",", ":")))
    print("plan:", len(rooms), "boxes,", out["rooms_n"], "rooms")


if __name__ == "__main__":
    brand()
    photos()
    clip("open_night", 748.6, 1.0, 1.7)
    clip("open_walk", 766.0, 1.0, 1.4)
    grain()
    plan()
