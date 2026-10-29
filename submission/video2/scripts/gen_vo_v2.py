"""Voice the v2 demo script with gemini-3.8-flash-tts and the prebuilt persona voice "hi-in-csagent-11".

Gemini Developer API through the key loader in submission/video/clone_voice.py (the key is never printed).
Every line is synthesised, listen-checked by gemini-3.8-flash (transcript vs script, no spoken style direction,
"Naqsha" said NUK-shah) and re-synthesised up to 4 tries. Accepted lines are trimmed of edge silence and
loudness-normalised to -16 LUFS / -1.5 dBTP, 48 kHz mono, into assets/voice/voNN.wav (raw takes in assets/voice/raw/).

  .../api/.venv/bin/python -I gen_vo_v2.py [ids...]
  .../api/.venv/bin/python -I gen_vo_v2.py --check <wav> <id>      # listen-check one file against a script line
"""
from __future__ import annotations

import base64
import concurrent.futures as cf
import difflib
import importlib.util
import json
import re
import subprocess
import sys
import time
import wave
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
OUT = ROOT / "assets" / "voice"
RAW = OUT / "raw"
REPORT = HERE / "vo_check_v2.json"

_spec = importlib.util.spec_from_file_location("cv", str(ROOT.parent / "clone_voice.py"))
cv = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cv)
cv._key()  # fail fast if no key (never printed)
client = cv._client()

TTS_MODEL = "gemini-3.8-flash-tts"
JUDGE_MODEL = "gemini-3.8-flash"
VOICE = "hi-in-csagent-11"
STYLE = ("Speak English with a modern, educated Pakistani accent, like a young tech founder from Lahore or Karachi showing "
         "their own product to a room of judges: warm, expressive and conversational, with lively, varied intonation and a "
         "natural smile in the voice; medium-brisk pace, about 160 words per minute. Sound like a real person talking, "
         "never theatrical or like a movie trailer.")
MAX_TRIES = 4


def _retry(fn, what, tries=6):
    for k in range(tries):
        try:
            return fn()
        except Exception as e:  # rate limits / transient 5xx
            msg = str(e)
            if k == tries - 1 or not any(c in msg for c in ("429", "500", "502", "503", "504", "RESOURCE_EXHAUSTED",
                                                              "UNAVAILABLE", "deadline", "timed out")):
                raise
            wait = 15 * (k + 1)
            print(f"  {what}: transient error ({type(e).__name__}), retry in {wait}s", flush=True)
            time.sleep(wait)


def synth(text: str, out: Path) -> float:
    def call():
        return client.interactions.create(
            model=TTS_MODEL,
            input=[{"type": "user_input", "content": [{"type": "text", "text": text,
                                                         "annotations": [{"type": "speech_metadata", "style": STYLE}]}]}],
            response_format={"type": "audio"},
            generation_config={"speech_config": [{"voice": VOICE}]},
        )
    it = _retry(call, "tts")
    pcm = base64.b64decode(it.output_audio.data)
    if pcm[:4] == b"RIFF":
        out.write_bytes(pcm)
    else:  # raw 24 kHz 16-bit mono PCM
        with wave.open(str(out), "wb") as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(24000); w.writeframes(pcm)
    with wave.open(str(out)) as w:
        return w.getnframes() / w.getframerate()


# ---- listen check ---------------------------------------------------------------------------------------------
_NUM = {"3.8": "three point eight", "3.1": "three point one", "3d": "three d", "4": "four"}


_ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split()
_TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()


def _words(n: int) -> str:
    if n < 20:
        return _ONES[n]
    if n < 100:
        return _TENS[n // 10] + ("" if n % 10 == 0 else " " + _ONES[n % 10])
    if n < 1000:
        return _ONES[n // 100] + " hundred" + ("" if n % 100 == 0 else " " + _words(n % 100))
    return str(n)


def norm(s: str) -> list[str]:
    s = s.lower().replace("’", "'").replace("‘", "'")
    s = re.sub(r"\b1\s*:\s*100\b", " one to one hundred ", s)
    s = re.sub(r"\b3\.8\b", " three point eight ", s)
    s = re.sub(r"\b3\.1\b", " three point one ", s)
    s = re.sub(r"\b3d\b", " three d ", s)
    s = re.sub(r"\b(\d{1,3})\b", lambda m: " " + _words(int(m.group(1))) + " ", s)
    s = s.replace("-", " ")
    s = re.sub(r"\bset back\b", "setback", s)
    s = re.sub(r"\bby law", "bylaw", s)
    s = re.sub(r"\bphoto real\b", "photoreal", s)
    s = re.sub(r"[^a-z0-9' ]+", " ", s)
    alias = {"liveability": "livability", "ami": "ammi", "naksha": "naqsha", "nuksha": "naqsha", "nakshah": "naqsha", "naqshah": "naqsha", "nuqsha": "naqsha"}
    return [alias.get(w.strip("'"), w.strip("'")) for w in s.split() if w.strip("'")]


JUDGE_Q = """You are checking a synthetic voice-over take against its script.

SCRIPT (what the speaker was asked to say):
\"\"\"{text}\"\"\"

The voice was also given a hidden delivery direction, which must NOT be spoken aloud. It began: "Speak English with a modern, educated Pakistani accent..."

Listen to the audio and reply as JSON with these keys:
- "transcript": an exact verbatim transcript of what is spoken, every word, written as words (write numbers the way they are said, e.g. "three point eight", "thirty-six", "one to one hundred").
- "missing_or_changed": list of script words or phrases that were skipped, swapped or changed (empty list if none).
- "extra_spoken": list of words or phrases spoken that are not in the script (empty list if none).
- "style_direction_spoken": true if any part of a delivery direction (accent, tone, pace, "words per minute", etc.) is spoken aloud.
- "naqsha_said": if the word "Naqsha" occurs in the script, describe how it is pronounced, as a rough respelling (e.g. "NUK-shah", "NAK-sha", "NAWK-sha"); otherwise null.
- "naqsha_ok": true if "Naqsha" is absent from the script, or if it is said as two syllables close to "NUK-shah" (first syllable like "nuck"/"nuk" or "nuq", second "shah"/"sha"); false if mangled (e.g. "nack-ZHA", "nak-SHAY", "nashka", three syllables, or skipped).
- "artefacts": list of audible glitches, cut-off words, garbling, long dead air, or robotic artefacts (empty if none).
- "delivery": one short line on accent and delivery.
"""


BLIND_Q = ("Transcribe this English speech verbatim, every word exactly as spoken, including any words that seem out of "
           "place. Write numbers as digits only when the speaker says a version number like 3.8; otherwise as words. "
           "Reply as JSON: {\"transcript\": \"...\"}")


def judge(wav: Path, text: str) -> dict:
    from google.genai import types
    audio = types.Part.from_bytes(data=wav.read_bytes(), mime_type="audio/wav")

    def call(prompt):
        def _c():
            r = client.models.generate_content(
                model=JUDGE_MODEL, contents=[audio, prompt],
                config=types.GenerateContentConfig(response_mime_type="application/json", temperature=0))
            if not r.text:
                raise RuntimeError("UNAVAILABLE: empty judge response")
            return json.loads(r.text)
        return _c
    blind = _retry(call(BLIND_Q), "transcribe")  # blind first, so the script cannot bias the transcript
    j = _retry(call(JUDGE_Q.format(text=text)), "judge")
    j["blind_transcript"] = blind.get("transcript", "")
    a, b = norm(text), norm(j["blind_transcript"])
    j["similarity"] = round(difflib.SequenceMatcher(None, a, b).ratio(), 4)
    j["word_diff"] = [f"{op}: {' '.join(a[i1:i2])!r} -> {' '.join(b[j1:j2])!r}"
                      for op, i1, i2, j1, j2 in difflib.SequenceMatcher(None, a, b).get_opcodes() if op != "equal"]
    bad_style = bool(j.get("style_direction_spoken")) or any(
        k in " ".join(b) for k in ("pakistani accent", "words per minute", "tech founder", "movie trailer"))
    strict = not any(op.startswith(("insert", "delete", "replace")) for op in j["word_diff"])
    j["pass"] = (strict and j["similarity"] >= 0.95 and not bad_style and bool(j.get("naqsha_ok", True))
                 and len(j.get("missing_or_changed") or []) <= 1 and not (j.get("extra_spoken") or [])
                 and not (j.get("artefacts") or []))
    # a single trivial word swap the transcriber reports is tolerated only when the text diff agrees it is tiny
    if j["pass"] and j.get("missing_or_changed") and j["similarity"] < 0.985:
        j["pass"] = False
    return j


# ---- normalise --------------------------------------------------------------------------------------------------
def finish(raw: Path, out: Path) -> float:
    """Trim edge silence (keep ~0.12 s head, ~0.25 s tail), loudnorm -16 LUFS / -1.5 dBTP, 48 kHz mono s16."""
    af = ("silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.12,"
          "areverse,silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.25,areverse,"
          "loudnorm=I=-16:TP=-1.5:LRA=11")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(raw), "-af", af, "-ar", "48000", "-ac", "1",
                    "-sample_fmt", "s16", str(out)], check=True)
    with wave.open(str(out)) as w:
        return w.getnframes() / w.getframerate()


def do_line(ln: dict) -> dict:
    lid, text = ln["id"], ln["text"]
    takes = []
    for k in range(1, MAX_TRIES + 1):
        raw = RAW / f"{lid}.take{k}.wav"
        secs = synth(text, raw)
        j = judge(raw, text)
        j.update(take=k, raw=raw.name, secs=round(secs, 2))
        takes.append(j)
        print(f"{lid} take {k}: {secs:5.2f}s sim {j['similarity']:.3f} naqsha {j.get('naqsha_said')} "
              f"style_spoken {j.get('style_direction_spoken')} pass {j['pass']}", flush=True)
        if j["pass"]:
            break
    best = next((t for t in takes if t["pass"]), None) or max(takes, key=lambda t: (t["similarity"], -len(t.get("artefacts") or [])))
    final_raw = RAW / f"{lid}.wav"
    final_raw.write_bytes((RAW / best["raw"]).read_bytes())
    dur = finish(final_raw, OUT / f"{lid}.wav")
    return {"id": lid, "accepted_take": best["take"], "pass": best["pass"], "duration": round(dur, 3), "takes": takes}


def judge_final(lines: list[dict]) -> None:
    """Re-check the accepted raw take of every line and record it (used after an interrupted run)."""
    report = json.loads(REPORT.read_text()) if REPORT.exists() else {}
    for ln in lines:
        raw = RAW / f"{ln['id']}.wav"
        j = judge(raw, ln["text"])
        prev = report.get(ln["id"], {})
        with wave.open(str(OUT / f"{ln['id']}.wav")) as w:
            dur = w.getnframes() / w.getframerate()
        report[ln["id"]] = {"id": ln["id"], "accepted_take": prev.get("accepted_take"), "pass": j["pass"],
                            "duration": round(dur, 3), "final_check": j, "takes": prev.get("takes", [])}
        print(f"{ln['id']}: final check sim {j['similarity']:.3f} naqsha {j.get('naqsha_said')} pass {j['pass']}", flush=True)
    REPORT.write_text(json.dumps(dict(sorted(report.items())), indent=1, ensure_ascii=False))


def _bad_spans(a: list[str], b: list[str]) -> set[int]:
    """Script word indices that transcript b does not reproduce."""
    bad = set()
    for op, i1, i2, _j1, _j2 in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        if op != "equal":
            bad.update(range(i1, max(i2, i1 + 1)))
    return bad


def consensus(lines: list[dict]) -> None:
    """Two independent transcribers (the blind Gemini pass and the Whisper word timings in words/) must BOTH miss a
    script word before it counts as a real error: each one alone mishears names and numbers now and then."""
    report = json.loads(REPORT.read_text())
    bad_lines = []
    for ln in lines:
        a = norm(ln["text"])
        g = norm(report[ln["id"]]["final_check"]["blind_transcript"])
        wfile = HERE / "words" / f"{ln['id']}.words.json"
        w = norm(" ".join(x["text"] for x in json.loads(wfile.read_text())))
        both = sorted(_bad_spans(a, g) & _bad_spans(a, w))
        words = [a[i] for i in both if i < len(a)]
        r = report[ln["id"]]
        fc = r["final_check"]
        ok = not words and not fc.get("style_direction_spoken") and fc.get("naqsha_ok", True) and not fc.get("artefacts")
        r["consensus"] = {"issues": words, "pass": ok, "naqsha_said": fc.get("naqsha_said")}
        print(f"{ln['id']}: consensus issues {words or 'none'}  style_spoken {fc.get('style_direction_spoken')} "
              f"naqsha {fc.get('naqsha_said')}  pass {ok}")
        if not ok:
            bad_lines.append(ln["id"])
    REPORT.write_text(json.dumps(dict(sorted(report.items())), indent=1, ensure_ascii=False))
    print("CONSENSUS PASS" if not bad_lines else f"CONSENSUS FAIL: {bad_lines}")


def main(argv: list[str]) -> None:
    lines = json.loads((HERE / "vo_lines.json").read_text())
    if argv[:1] == ["--consensus"]:
        consensus(lines)
        return
    if argv[:1] == ["--judge-final"]:
        judge_final([l for l in lines if not argv[1:] or l["id"] in argv[1:]])
        return
    if argv[:1] == ["--check"]:
        wav, lid = Path(argv[1]), argv[2]
        text = next(l["text"] for l in lines if l["id"] == lid)
        print(json.dumps(judge(wav, text), indent=1))
        return
    RAW.mkdir(parents=True, exist_ok=True)
    if argv:
        lines = [l for l in lines if l["id"] in argv]
    report = json.loads(REPORT.read_text()) if REPORT.exists() else {}
    with cf.ThreadPoolExecutor(3) as ex:
        for r in ex.map(do_line, lines):
            report[r["id"]] = r
            REPORT.write_text(json.dumps(dict(sorted(report.items())), indent=1, ensure_ascii=False))
            print(f"== {r['id']}: take {r['accepted_take']} pass={r['pass']} {r['duration']:.2f}s", flush=True)
    bad = [k for k, v in sorted(report.items()) if not v["pass"]]
    print("ALL PASS" if not bad else f"FAILED CHECK: {bad}")


if __name__ == "__main__":
    main(sys.argv[1:])
