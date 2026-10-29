"""Convert the Playwright captures named in scripts/footage.json (1920x1080 webm, variable frame rate) to constant
30 fps H.264 MP4 with a keyframe every second (-g 30, fast seeking) in assets/footage/, and copy each step log
(<name>.json: [{"t": seconds, "what": step name}]) next to it. Skips files that are already up to date."""
import json, shutil, subprocess
from pathlib import Path
HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
CFG = json.loads((HERE / "footage.json").read_text())
SRC = (HERE / CFG["capture_dir"]).resolve()
OUT = ROOT / "assets/footage"
OUT.mkdir(parents=True, exist_ok=True)
for flow in ("full", "drawing"):
    name = CFG[flow]
    src, mp4, js = SRC / f"{name}.webm", OUT / f"{name}.mp4", OUT / f"{name}.json"
    shutil.copyfile(SRC / f"{name}.json", js)
    if mp4.exists() and mp4.stat().st_mtime > src.stat().st_mtime:
        print("up to date:", mp4.name); continue
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-vf", "fps=30", "-c:v", "libx264", "-crf", "17",
                    "-preset", "fast", "-g", "30", "-keyint_min", "30", "-sc_threshold", "0", "-pix_fmt", "yuv420p",
                    "-an", "-movflags", "+faststart", str(mp4)], check=True)
    print("converted:", mp4.name)
