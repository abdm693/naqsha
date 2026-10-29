"""Voice the Nebius-edition script with gemini-3.8-flash-tts and the prebuilt voice "hi-in-csagent-11" (the voice of
the earlier Naqsha film), on Vertex AI generate_content.

Vertex rejects system_instruction for this model, so the delivery note goes in front of the line as a short
parenthetical (the form that the model reliably does not read aloud). Every take is listen-checked:
  - Whisper word timings (`npx hyperframes transcribe`) and a blind gemini-3.8-flash transcript; a script word counts
    as wrong only when BOTH transcribers miss it (each one alone mishears names now and then);
  - any spoken part of the delivery note in EITHER transcript fails the take (Gemini alone once missed a whole
    spoken style note that Whisper caught), and so does a take far longer or shorter than the line should be;
  - gemini-3.8-flash judges "Naqsha" (NUK-shah), extra words and audible glitches.
Up to 5 takes per line; takes 4-5 spell Naqsha phonetically. Accepted takes are trimmed of edge silence and
normalised to -16 LUFS / -1.5 dBTP, 48 kHz mono -> assets/voice/voNN.wav; their Whisper word timings ->
scripts/words/voNN.words.json (build.py places scenes on them). Report: scripts/vo_check.json.

Placeholders like {lda_pass} are filled from scripts/numbers.json before synthesis.

  GOOGLE_APPLICATION_CREDENTIALS=~/.config/gcloud-naqsha-nebius-adc/application_default_credentials.json \\
    /Users/abdullahmoazzam/Code/naqsha-nebius/api/.venv/bin/python -I scripts/gen_vo.py [ids...]
"""
from __future__ import annotations

import concurrent.futures as cf
import difflib
import json
import os
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
WORDS = HERE / "words"
TMP = ROOT / ".vo-tmp"
REPORT = HERE / "vo_check.json"

PROJECT, LOCATION = "naqsha-nebius-424e", "global"
TTS_MODEL, JUDGE_MODEL, VOICE = "gemini-3.8-flash-tts", "gemini-3.8-flash", "hi-in-csagent-11"
NOTE = ("(Voice: a young Pakistani tech founder from Lahore, modern educated Pakistani English accent, warm, lively, "
        "conversational, a natural smile in the voice, brisk at about 160 words per minute.)")
STYLE_WORDS = ("voice", "pakistani", "tech founder", "accent", "words per minute", "smile", "lahore", "conversational",
               "lively", "brisk")
MAX_TRIES = 5
PHONETIC = {"Naqsha": "Nuqsha"}  # used on the last two takes if the name keeps coming out wrong

os.environ.setdefault("GOOGLE_APPLICATION_CREDENTIALS",
                      str(Path.home() / ".config/gcloud-naqsha-nebius-adc/application_default_credentials.json"))
from google import genai  # noqa: E402
from google.genai import types as T  # noqa: E402

client = genai.Client(vertexai=True, project=PROJECT, location=LOCATION)


def lines() -> list[dict]:
    nums = json.loads((HERE / "numbers.json").read_text())
    out = []
    for ln in json.loads((HERE / "vo_lines.json").read_text()):
        out.append({**ln, "text": ln["text"].format(**{k: v for k, v in nums.items() if not k.startswith("_")})})
    return out


def _retry(fn, what, tries=6):
    for k in range(tries):
        try:
            return fn()
        except Exception as e:  # rate limits / transient 5xx
            msg = str(e)
            if k == tries - 1 or not any(c in msg for c in ("429", "500", "502", "503", "504", "RESOURCE_EXHAUSTED",
                                                              "UNAVAILABLE", "deadline", "timed out", "empty")):
                raise
            wait = 10 * (k + 1)
            print(f"  {what}: transient error ({type(e).__name__}: {msg[:80]}), retry in {wait}s", flush=True)
            time.sleep(wait)


def synth(text: str, out: Path) -> float:
    def call():
        r = client.models.generate_content(
            model=TTS_MODEL, contents=NOTE + "\n" + text,
            config=T.GenerateContentConfig(
                response_modalities=["AUDIO"],
                speech_config=T.SpeechConfig(voice_config=T.VoiceConfig(
                    prebuilt_voice_config=T.PrebuiltVoiceConfig(voice_name=VOICE)))))
        part = r.candidates[0].content.parts[0].inline_data
        if not part or not part.data:
            raise RuntimeError("UNAVAILABLE: empty audio")
        return part.data
    data = _retry(call, "tts")
    if data[:4] == b"RIFF":
        out.write_bytes(data)
    else:  # raw 24 kHz 16-bit mono PCM
        with wave.open(str(out), "wb") as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(24000); w.writeframes(data)
    with wave.open(str(out)) as w:
        return w.getnframes() / w.getframerate()


# ---- transcripts --------------------------------------------------------------------------------------------------
_ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split()
_TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()


def _num(n: int) -> str:
    if n < 20:
        return _ONES[n]
    if n < 100:
        return _TENS[n // 10] + ("" if n % 10 == 0 else " " + _ONES[n % 10])
    if n < 1000:
        return _ONES[n // 100] + " hundred" + ("" if n % 100 == 0 else " " + _num(n % 100))
    return str(n)


ALIAS = {"naksha": "naqsha", "nuksha": "naqsha", "nakhsha": "naqsha", "naqshah": "naqsha", "nuqsha": "naqsha",
         "nakshaa": "naqsha", "nakshah": "naqsha", "nemo": "nemotron", "nematron": "nemotron", "nemetron": "nemotron",
         "nebbius": "nebius", "nebias": "nebius", "nebiyus": "nebius", "tavili": "tavily", "tavilly": "tavily",
         "taveli": "tavily", "cda's": "cda", "facades": "facade", "façade": "facade"}


def norm(s: str) -> list[str]:
    s = s.lower().replace("’", "'").replace("‘", "'").replace("façade", "facade")
    s = re.sub(r"\bnemo\s*tron\b", "nemotron", s)
    s = re.sub(r"\b3d\b", " three d ", s)
    s = re.sub(r"\bc\.?\s*d\.?\s*a\.?\b", " cda ", s)
    s = re.sub(r"\b(\d{1,3})\b", lambda m: " " + _num(int(m.group(1))) + " ", s)
    s = s.replace("-", " ")
    s = re.sub(r"[^a-z0-9' ]+", " ", s)
    return [ALIAS.get(w.strip("'"), w.strip("'")) for w in s.split() if w.strip("'")]


def whisper(wav: Path, tag: str) -> list[dict]:
    d = TMP / tag
    d.mkdir(parents=True, exist_ok=True)
    subprocess.run(["npx", "hyperframes", "transcribe", str(wav), "-d", str(d), "--json"], cwd=ROOT,
                   capture_output=True, text=True, check=True)
    return json.loads((d / "transcript.json").read_text())


BLIND_Q = ("Transcribe this English speech verbatim, every word exactly as spoken from the very start to the very end, "
           "including any words that seem out of place or any instructions that are read aloud. Reply as JSON: "
           "{\"transcript\": \"...\"}")
JUDGE_Q = """You are checking a synthetic voice-over take against its script.

SCRIPT (what the speaker was asked to say):
\"\"\"{text}\"\"\"

The voice was also given a hidden delivery note in parentheses, which must NOT be spoken aloud. It began: "(Voice: a young Pakistani tech founder..."

Listen to the whole audio and reply as JSON with these keys:
- "extra_spoken": list of words or phrases spoken that are not in the script (empty list if none).
- "style_direction_spoken": true if any part of a delivery note (voice, accent, tone, pace, "words per minute", etc.) is spoken aloud.
- "naqsha_said": if the product name "Naqsha" occurs in the script, a rough respelling of how it is pronounced (e.g. "NUK-shah", "NAK-sha"); otherwise null.
- "naqsha_vowel": if "Naqsha" occurs in the script, its first vowel: "cut" (the short u of cut/nut, so it sounds like NUK-shah), "cat" (NAK-sha), "father" (NAAK-sha) or "other"; otherwise null.
- "naqsha_ok": true if "Naqsha" is absent from the script, or if it is said as two syllables with the first vowel of "cut" (NUK-shah); false otherwise (other vowel, three syllables, mangled or skipped).
- "artefacts": list of audible glitches, cut-off words, garbling, long dead air, or robotic artefacts (empty if none).
- "delivery": one short line on accent, energy and pace.
"""


def gemini_json(audio: bytes, prompt: str) -> dict:
    part = T.Part.from_bytes(data=audio, mime_type="audio/wav")

    def call():
        r = client.models.generate_content(model=JUDGE_MODEL, contents=[part, prompt],
                                           config=T.GenerateContentConfig(response_mime_type="application/json",
                                                                          temperature=0))
        if not r.text:
            raise RuntimeError("UNAVAILABLE: empty judge response")
        return json.loads(r.text)
    return _retry(call, "judge")


def _ops(a, b):
    return [o for o in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes() if o[0] != "equal"]


def _missed(a, b) -> set[int]:
    bad = set()
    for op, i1, i2, _j1, _j2 in _ops(a, b):
        if op in ("delete", "replace"):
            bad.update(range(i1, i2))
    return bad


def _inserted(a, b) -> list[str]:
    return [" ".join(b[j1:j2]) for op, i1, i2, j1, j2 in _ops(a, b) if op == "insert"
            or (op == "replace" and (j2 - j1) > (i2 - i1) + 1)]


def check(wav: Path, text: str, tag: str) -> dict:
    audio = wav.read_bytes()
    words = whisper(wav, tag)
    wt = " ".join(w["text"] for w in words)
    blind = gemini_json(audio, BLIND_Q).get("transcript", "")
    j = gemini_json(audio, JUDGE_Q.format(text=text))
    a, w_, g_ = norm(text), norm(wt), norm(blind)
    both_missed = sorted(_missed(a, w_) & _missed(a, g_))
    ins_w, ins_g = _inserted(a, w_), _inserted(a, g_)
    style_hit = [k for k in STYLE_WORDS if k in " ".join(w_) or k in " ".join(g_)]
    style_hit = [k for k in style_hit if k not in " ".join(a)]
    speech = (words[-1]["end"] - words[0]["start"]) if words else 0.0
    expect = len(a) / (160 / 60)
    j.update(whisper=wt, blind=blind, missed=[a[i] for i in both_missed], inserted_whisper=ins_w, inserted_gemini=ins_g,
             style_hit=style_hit, speech_s=round(speech, 2), expect_s=round(expect, 2),
             similarity=round(difflib.SequenceMatcher(None, a, w_).ratio(), 4))
    reasons = []
    if both_missed:
        reasons.append("missed words")
    if style_hit or j.get("style_direction_spoken"):
        reasons.append("style spoken")
    if any(len(x.split()) >= 2 for x in ins_w) or (ins_w and ins_g):
        reasons.append("extra words")
    if not (0.6 * expect <= speech <= 1.4 * expect):
        reasons.append("duration")
    if "naqsha" in a and (not j.get("naqsha_ok", True) or j.get("naqsha_vowel") not in (None, "cut")):
        reasons.append("naqsha")
    if j.get("artefacts"):
        reasons.append("artefacts")
    j["reasons"], j["pass"] = reasons, not reasons
    return j


# ---- normalise ------------------------------------------------------------------------------------------------------
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
        say = text
        if k >= 4:
            for a_, b_ in PHONETIC.items():
                say = say.replace(a_, b_)
        raw = RAW / f"{lid}.take{k}.wav"
        secs = synth(say, raw)
        j = check(raw, text, f"{lid}-t{k}")
        j.update(take=k, raw=raw.name, secs=round(secs, 2), said=say)
        takes.append(j)
        print(f"{lid} take {k}: {secs:5.2f}s speech {j['speech_s']}/{j['expect_s']} sim {j['similarity']:.3f} "
              f"naqsha {j.get('naqsha_said')} pass {j['pass']} {j['reasons']}", flush=True)
        if j["pass"]:
            break
    best = next((t for t in takes if t["pass"]), None) or max(takes, key=lambda t: (-len(t["reasons"]), t["similarity"]))
    final_raw = RAW / f"{lid}.wav"
    final_raw.write_bytes((RAW / best["raw"]).read_bytes())
    dur = finish(final_raw, OUT / f"{lid}.wav")
    words = whisper(OUT / f"{lid}.wav", f"{lid}-final")
    (WORDS / f"{lid}.words.json").write_text(json.dumps(words, indent=1))
    return {"id": lid, "text": text, "accepted_take": best["take"], "pass": best["pass"], "duration": round(dur, 3),
            "takes": takes}


def main(argv: list[str]) -> None:
    for d in (RAW, WORDS, TMP):
        d.mkdir(parents=True, exist_ok=True)
    todo = lines()
    if argv:
        todo = [l for l in todo if l["id"] in argv]
    report = json.loads(REPORT.read_text()) if REPORT.exists() else {}
    with cf.ThreadPoolExecutor(3) as ex:
        for r in ex.map(do_line, todo):
            report[r["id"]] = r
            REPORT.write_text(json.dumps(dict(sorted(report.items())), indent=1, ensure_ascii=False))
            print(f"== {r['id']}: take {r['accepted_take']} pass={r['pass']} {r['duration']:.2f}s", flush=True)
    bad = [k for k, v in sorted(report.items()) if not v["pass"]]
    stale = [l["id"] for l in lines() if report.get(l["id"], {}).get("text") != l["text"]]
    print("ALL PASS" if not bad else f"FAILED CHECK: {bad}", "| stale (text changed, re-voice):", stale or "none")


if __name__ == "__main__":
    main(sys.argv[1:])
