"""Fit the Lyria music bed (assets/music/bed.wav, ours) to this film's timeline.

bed.wav was assembled from five Lyria 2 clips at 110.3 BPM; its sections (seconds in bed.wav):
  hook_a 0-16.45 | main_b 16.45-101.19 | main_b2 101.19-149.81 | main_b 149.81-193.64 | break_b 193.64-213.33 |
  finale_b 213.33-234.91 (ends on its own 2 s fade)
build.py writes scripts/bed_plan.json with this film's boundaries; each target span takes a source span that starts on
a section downbeat (or, for the hook, ends exactly on the title hit), joined with short equal-power crossfades.

  python3 scripts/fit_bed.py      -> assets/music/bed_fit.wav
"""
import json
from pathlib import Path

import numpy as np
import soundfile as sf

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
SR = 48000
XF = 0.35


def main():
    plan = json.loads((HERE / "bed_plan.json").read_text())
    y, sr = sf.read(ROOT / "assets/music/bed.wav")
    assert sr == SR, sr
    total = plan["total"]
    out = np.zeros((int(total * SR) + SR, y.shape[1]))
    for k, p in enumerate(plan["pieces"]):
        a, b, src = p["at"], p["until"], p["src"]  # target [a, b) <- bed.wav from src
        fin = p.get("fin", XF if k else 0.3)
        fout = p.get("fout", XF)
        n = int((b - a + fout) * SR)
        s0 = int(src * SR)
        piece = y[s0:s0 + n].copy()
        if len(piece) < n:
            piece = np.pad(piece, ((0, n - len(piece)), (0, 0)))
        t = np.arange(n) / SR
        piece *= np.sqrt(np.clip(t / max(fin, 1e-3), 0, 1))[:, None]
        piece *= np.sqrt(np.clip((n / SR - t) / max(fout, 1e-3), 0, 1))[:, None]
        start = int(a * SR)
        out[start:start + n] += piece[: len(out) - start]
        print(f"{p['name']:8s} {a:7.2f}-{b:7.2f} <- bed {src:7.2f}")
    out = out[: int(total * SR)]
    out *= 0.89 / max(1e-6, np.abs(out).max())
    sf.write(ROOT / "assets/music/bed_fit.wav", out, SR, subtype="PCM_16")
    print("bed_fit.wav", round(len(out) / SR, 2), "s")


if __name__ == "__main__":
    main()
