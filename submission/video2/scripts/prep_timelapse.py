"""Build the >10x time-lapse proxies (HyperFrames playback-rate caps at 10x). Frames are decimated, never blended."""
import json, subprocess, sys
from pathlib import Path
A = Path(__file__).resolve().parent.parent / "assets/footage"
JOBS = {
    # d1 design run: (src_in, src_out, out_dur) per phase, concatenated
    "d1_tl.mp4": ("d1_design_run_realtime.mp4", [(0.7, 54.1, 2.2), (54.1, 104.6, 3.6), (104.6, 157.5, 1.4),
                                                 (157.5, 178.1, 3.0), (178.1, 277.2, 4.4), (277.2, 283.4, 1.5)]),
    # h revise agent run, real time 15.0 -> 333.5 squeezed into 8.5 s
    "h_tl.mp4": ("h_revise_from_comments.mp4", [(15.0, 333.5, 8.5)]),
}
PLAN = Path(__file__).resolve().parent / "timelapse_plan.json"  # written by build.py, timed to the voice-over
if PLAN.exists():
    JOBS = {k: (v["src"], [tuple(x) for x in v["segs"]]) for k, v in json.loads(PLAN.read_text()).items()}
for out, (src, segs) in JOBS.items():
    parts, labels = [], []
    for i, (a, b, d) in enumerate(segs):
        sp = (b - a) / d
        parts.append(f"[0:v]trim=start={a}:end={b},setpts=(PTS-STARTPTS)/{sp:.6f},fps=30[v{i}]")
        labels.append(f"[v{i}]")
    fc = ";".join(parts) + ";" + "".join(labels) + f"concat=n={len(segs)}:v=1:a=0[out]"
    cmd = ["ffmpeg", "-v", "error", "-y", "-i", str(A / src), "-filter_complex", fc, "-map", "[out]",
           "-c:v", "libx264", "-crf", "16", "-preset", "medium", "-pix_fmt", "yuv420p", "-r", "30", str(A / out)]
    subprocess.run(cmd, check=True)
    dur = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(A / out)],
                         capture_output=True, text=True).stdout.strip()
    print(out, dur, "expected", sum(d for _, _, d in segs))
