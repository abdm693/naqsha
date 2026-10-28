"""Transcribe each narration line and measure its speech span and longest pause (Gemini on Vertex AI)."""
import wave, array, json, sys
from pathlib import Path
from google import genai
from google.genai import types
c = genai.Client(vertexai=True, project="naqsha-nebius-424e", location="global")
only = set(sys.argv[1:])
for f in sorted(Path("vo").glob("*.wav")):
    if only and f.stem not in only:
        continue
    w = wave.open(str(f)); a = array.array("h", w.readframes(w.getnframes())); sr = w.getframerate()
    win = sr // 10; e = [max(abs(x) for x in a[i:i + win]) for i in range(0, len(a), win)]
    voiced = [i for i, v in enumerate(e) if v > 800]
    longest = run = 0
    for v in e[voiced[0]:voiced[-1]]:
        run = run + 1 if v <= 800 else 0; longest = max(longest, run)
    r = c.models.generate_content(model="gemini-3.5-flash", contents=[types.Part.from_bytes(data=f.read_bytes(), mime_type="audio/wav"),
                                                                     "Transcribe exactly. Text only."])
    print(f.stem, f"{len(a)/sr:.1f}s voiced {voiced[0]/10:.1f}-{voiced[-1]/10:.1f} longest_pause {longest/10:.1f}s |", (r.text or "").strip()[:240], flush=True)
