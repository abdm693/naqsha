"""Generate the whole film from one timeline spec: the footage scenes (compositions/ft-*.html), the chapter cards
(compositions/mg-card*.html), the motion graphics (compositions/mg-*.html, from the hand-made templates in
scripts/mg/ with their cue times and numbers filled in), the time-lapse proxies, the fitted music bed and index.html.

Every time below is GLOBAL composition seconds unless named otherwise. Footage is real, unedited screen capture of the
live app (Playwright, scripts/footage.json names the recordings). Source times come ONLY from the recordings' step logs,
read by step NAME (F("plan view"), D("read")), so a re-recorded run with the same step names drops straight in.
Facts that are shown or spoken come ONLY from scripts/numbers.json. Scene timing follows the voice: every scene and
cue is placed on the Whisper word timings of the voice-over (scripts/words/).

  python3 scripts/build.py          (then: node scripts/carve/carve.mjs --comp index.html --bed music --strength 0.7)
"""
from __future__ import annotations

import difflib
import hashlib
import html
import json
import re
import subprocess
import wave
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
COMP = ROOT / "compositions"
FOOT = ROOT / "assets/footage"
FONTS = (HERE / "brand.css").read_text()
NUM = {k: v for k, v in json.loads((HERE / "numbers.json").read_text()).items() if not k.startswith("_")}
CFG = json.loads((HERE / "footage.json").read_text())

# Window geometry: footage plays in a floating app window on the limestone canvas.
WX, WY, WW, WH = 128, 118, 1664, 936
K = WW / 1920
CARD_DUR = 1.9

CLIP = {"full": f"{CFG['full']}.mp4", "drawing": f"{CFG['drawing']}.mp4", "tl_wait": "tl_wait.mp4", "tl_plan": "tl_plan.mp4"}


# =====================================================================================================
# STEP LOGS (by name)
# =====================================================================================================
def _steps(name):
    marks = json.loads((FOOT / f"{name}.json").read_text())
    out = {}
    for m in marks:
        out.setdefault(m["what"], m["t"])
    return out


_FULL, _DRAW = _steps(CFG["full"]), _steps(CFG["drawing"])


def F(name):
    """Source second of a named step in the full run."""
    if name not in _FULL:
        raise SystemExit(f"step '{name}' missing from {CFG['full']}.json (have: {list(_FULL)})")
    return _FULL[name]


def D(name):
    """Source second of a named step in the drawing run."""
    if name not in _DRAW:
        raise SystemExit(f"step '{name}' missing from {CFG['drawing']}.json (have: {list(_DRAW)})")
    return _DRAW[name]


def media_dur(f):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(f)],
                         capture_output=True, text=True).stdout.strip()
    return float(out)


FULL_LEN = media_dur(FOOT / CLIP["full"])


# =====================================================================================================
# helpers
# =====================================================================================================
def fmt_rate(r: float) -> str:
    if r < 0.95:
        return f"slowed {r:.1f}×".replace(".0×", "×")
    s = str(round(r)) if r >= 3 else f"{r:.1f}".rstrip("0").rstrip(".")
    return f"sped up {s}×"


def pose(z: float, fx: float, fy: float):
    s = K * z
    tx = min(0.0, max(WW - s * 1920, WW / 2 - s * fx))
    ty = min(0.0, max(WH - s * 1080, WH / 2 - s * fy))
    return round(tx, 2), round(ty, 2), round(s, 5)


class Scene:
    def __init__(self, sid, start, chapter):
        self.id, self.start, self.chapter = sid, round(start, 3), chapter
        self.segs, self.poses, self.over, self.badges, self.clocks = [], [], [], [], []
        self.cursor = self.start

    def seg(self, clip, a, b, rate=None, dur=None, badge="auto"):
        if dur is None:
            dur = (b - a) / rate
        else:
            rate = (b - a) / dur
        assert rate <= 10.0 + 1e-6, f"{self.id}: rate {rate:.1f} > 10, use a proxy"
        s = dict(clip=clip, a=round(a, 3), b=round(b, 3), rate=rate, dur=dur, t=self.cursor)
        self.segs.append(s)
        if badge == "auto":
            badge = "real time" if abs(rate - 1) < 0.05 else fmt_rate(rate)
        if badge:
            self.badges.append((self.cursor, self.cursor + dur, badge))
        self.cursor += dur
        return s

    def at_src(self, s, src):
        """Global time at which segment s shows source second src."""
        return s["t"] + (src - s["a"]) / s["rate"]

    def end_of(self, s):
        return s["t"] + s["dur"]

    def cam(self, t, z, fx=960, fy=540, d=0.0, ease="power2.inOut"):
        self.poses.append((t, z, fx, fy, d, ease))

    def badge(self, a, b, text):
        self.badges.append((a, b, text))

    def clock(self, a, b, mapping, fmt="mmss", label="elapsed"):
        self.clocks.append(dict(a=a, b=b, map=mapping, fmt=fmt, label=label))

    def lower(self, a, b, title, sub="", tag="Agent at work", anchor="bl", width=None):
        self.over.append(dict(kind="lower", a=a, b=b, title=title, sub=sub, tag=tag, anchor=anchor, width=width))

    def steps(self, a, b, marks, labels=("Draft ×3", "Check", "Fix", "Build", "Match")):
        """A pipeline strip; marks = [(t, set_of_active_indices, n_done_before)]."""
        self.over.append(dict(kind="steps", a=a, b=b, marks=marks, labels=labels))

    def callout(self, a, b, text, sub="", anchor="bl", tone="ink", x=None, y=None, tag="", width=None):
        self.over.append(dict(kind="callout", a=a, b=b, text=text, sub=sub, anchor=anchor, tone=tone, x=x, y=y, tag=tag, width=width))

    def flow(self, a, b, items, tag="", anchor="bl"):
        """A row of chips joined by arrows (e.g. Tavily -> Nemotron -> rule pack), revealed one by one."""
        self.over.append(dict(kind="flow", a=a, b=b, items=items, tag=tag, anchor=anchor))

    def stat(self, a, b, big, label, anchor="br", x=None, y=None):
        self.over.append(dict(kind="stat", a=a, b=b, big=big, label=label, anchor=anchor, x=x, y=y))

    def ring(self, a, b, x, y, w, h, tone="accent"):
        """A ring around a UI element; x, y, w, h in capture pixels (it rides the camera)."""
        self.over.append(dict(kind="ring", a=a, b=b, x=x, y=y, w=w, h=h, tone=tone))

    @property
    def dur(self):
        return round(self.cursor - self.start, 3)


# =====================================================================================================
# VOICE and word timings (Whisper, scripts/words/), aligned to the script text that was voiced
# =====================================================================================================
_ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split()
_TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()


def _num(n):
    if n < 20:
        return _ONES[n]
    if n < 100:
        return _TENS[n // 10] + ("" if n % 10 == 0 else " " + _ONES[n % 10])
    return _ONES[n // 100] + " hundred" + ("" if n % 100 == 0 else " " + _num(n % 100))


def toks(s):
    s = s.lower().replace("’", "'").replace("%", " percent")
    s = re.sub(r"\bnemo\s*tron\b", "nemotron", s)
    s = re.sub(r"\b3d\b", " three d ", s)
    s = re.sub(r"\b(\d{1,3})\b", lambda m: " " + _num(int(m.group(1))) + " ", s)
    s = re.sub(r"[^a-z0-9' ]+", " ", s.replace("-", " "))
    return [w.strip("'") for w in s.split() if w.strip("'")]


LINES = {l["id"]: l["text"].format(**NUM) for l in json.loads((HERE / "vo_lines.json").read_text())}
_report = json.loads((HERE / "vo_check.json").read_text()) if (HERE / "vo_check.json").exists() else {}
for _id, _t in LINES.items():
    if _report.get(_id, {}).get("text") != _t:
        print(f"WARNING: {_id} was voiced from different text; run gen_vo.py {_id}")


def vo_dur(name):
    with wave.open(str(ROOT / "assets/voice" / f"{name}.wav")) as w:
        return w.getnframes() / w.getframerate()


VD = {k: vo_dur(k) for k in LINES}
WORDS = {k: json.loads((HERE / "words" / f"{k}.words.json").read_text()) for k in LINES}
_ALIGN = {}


def _align(vo):
    """Script token index -> (start, end) in the voice file, via a diff of the script against the Whisper words."""
    if vo in _ALIGN:
        return _ALIGN[vo]
    script = toks(LINES[vo])
    wt, wtimes = [], []
    for w in WORDS[vo]:
        for tk in toks(w["text"]):
            wt.append(tk)
            wtimes.append((w["start"], w["end"]))
    m = {}
    for blk in difflib.SequenceMatcher(None, script, wt, autojunk=False).get_matching_blocks():
        for k in range(blk.size):
            m[blk.a + k] = wtimes[blk.b + k]
    # unmatched script words: interpolate from neighbours
    out = []
    for i in range(len(script)):
        if i in m:
            out.append(m[i])
            continue
        prev = max([j for j in m if j < i], default=None)
        nxt = min([j for j in m if j > i], default=None)
        if prev is not None and nxt is not None:
            f = (i - prev) / (nxt - prev)
            t = m[prev][1] + f * (m[nxt][0] - m[prev][1])
        elif prev is not None:
            t = m[prev][1]
        else:
            t = m[nxt][0] if nxt is not None else 0.0
        out.append((t, t))
    _ALIGN[vo] = (script, out)
    return _ALIGN[vo]


def W(vo, phrase, nth=0, edge="start"):
    """Local time (in the voice file) of the first token of `phrase` in line `vo` (its nth occurrence)."""
    script, times = _align(vo)
    p = toks(phrase)
    hits = [i for i in range(len(script) - len(p) + 1) if script[i:i + len(p)] == p]
    if len(hits) <= nth:
        raise SystemExit(f"'{phrase}' not in {vo}: {LINES[vo]}")
    i = hits[nth] + (len(p) - 1 if edge == "end" else 0)
    return times[i][0 if edge == "start" else 1]


VOC = []  # (clip id, line, global start, duration)


def vo(name, t):
    VOC.append((name, name, round(t, 3), VD[name]))
    return t


def vo_start(name):
    return next(c[2] for c in VOC if c[0] == name)


def vo_end(name):
    c = next(c for c in VOC if c[0] == name)
    return c[2] + c[3]


def at(name, phrase, nth=0, edge="start"):
    """Global time of a phrase in a placed line."""
    return vo_start(name) + W(name, phrase, nth, edge)


# =====================================================================================================
# TIMELINE (global seconds)
# =====================================================================================================
S: list[Scene] = []
CARDS = []  # (start, number, title, attribution)
MG = {}     # id -> dict(start, end, cues)
TL = {}     # time-lapse proxies: name -> {"src", "segs": [[a, b, out_dur], ...]}


def card(t, num, title, attr):
    CARDS.append((round(t, 3), num, title, attr))
    return t + CARD_DUR


def steps_marks(*pairs):
    return list(pairs)


# --- 1 Hook + 2 title (motion graphics) ------------------------------------------------------------------------
vo("vo01", 0.9)
HOOK_END = round(vo_end("vo01") + 1.9, 3)
MG["mg-hook"] = dict(start=0.0, end=HOOK_END, cues=dict(
    l1=at("vo01", "Most") - 0.05, l2=at("vo01", "The plan") - 0.1, weeks=at("vo01", "weeks") - 0.1,
    l4=at("vo01", "nobody") - 0.1, stamp=at("vo01", "sends it back") - 0.05))
TITLE = HOOK_END - 0.1
vo("vo02", TITLE + 0.4)
TITLE_END = round(vo_end("vo02") + 1.25, 3)
MG["mg-title"] = dict(start=TITLE, end=TITLE_END, cues=dict(
    tag=at("vo02", "agentic") - 0.35, nemotron=at("vo02", "NVIDIA Nemotron") - 0.05, nebius=at("vo02", "Nebius") - 0.1))
t = card(TITLE_END - 0.25, "01", "Describe the home once", "Setup agent · Nemotron 3 Super")

# --- 3 Setup agent ------------------------------------------------------------------------------------------------
sc = Scene("ft-setup", t - 0.2, "01 · Setup agent")
T0 = sc.start
vo("vo03", T0 + 0.25)
s1 = sc.seg("full", F("workspace"), F("sent") + 0.3, 2.0)
brief_src = F("rules box") - 0.35            # the brief and the rule box land together, just before this step mark
pop_at = max(sc.cursor + 1.6, at("vo03", "the brief") - 0.15)   # the brief pops in on "...turns it into the brief"
d_wait = round(round((pop_at - sc.cursor) * 30) / 30, 3)
TL["tl_wait"] = {"src": CLIP["full"], "segs": [[round(F("sent") + 0.3, 3), round(brief_src, 3), d_wait]]}
s2 = sc.seg("tl_wait", 0.0, d_wait, 1.0, badge=fmt_rate((brief_src - F("sent") - 0.3) / d_wait))
s3 = sc.seg("full", brief_src, brief_src + 1.4, 1.0)
sc.cam(T0, 1.95, 712, 290)
sc.cam(T0 + 0.02, 2.05, 712, 300, d=s1["dur"] - 0.05, ease="none")
sc.cam(s2["t"], 1.0, 960, 540)
sc.cam(s2["t"] + 0.05, 1.45, 560, 330, d=0.6)
sc.cam(s3["t"] + 0.3, 1.7, 1500, 330, d=0.6)
sc.clock(s2["t"], sc.cursor, [(s2["t"], 0.0), (s3["t"], brief_src - F("sent") - 0.3)], fmt="sec", label="brief + rules")
sc.lower(s2["t"] + 0.1, sc.cursor - 0.1, "Setup agent · Nemotron 3 Super",
         "a Google ADK agent with tools: it reads the message and fills in the brief")
sc.ring(s3["t"] + 0.9, sc.cursor - 0.05, 1306, 120, 384, 250)
S.append(sc)
SFX_TYPING = (s1["t"], s1["dur"])
BRIEF_POP = s3["t"] + 0.05

# --- 4 City rules, researched -----------------------------------------------------------------------------------------
sc = Scene("ft-rules", sc.cursor, "02 · City rules")
T0 = sc.start
vo("vo04", max(vo_end("vo03") + 0.45, T0 + 0.2))
r_a, r_b = brief_src + 1.4, F("decide for me") - 0.25
r_dur = vo_end("vo04") + 0.45 - T0
s4 = sc.seg("full", r_a, r_b, dur=r_dur)
sc.cam(T0, 2.2, 1500, 190)
sc.cam(at("vo04", "CDA's") - 0.25, 1.95, 1497, 790, d=0.75)
sc.cam(at("vo04", "cites") - 0.35, 2.35, 1497, 905, d=0.6)
sc.ring(T0 + 0.15, at("vo04", "CDA's") - 0.3, 1404, 162, 290, 56)
sc.ring(at("vo04", "CDA's") + 0.35, at("vo04", "cites") - 0.4, 1306, 678, 386, 186)
sc.ring(at("vo04", "cites") + 0.2, sc.cursor - 0.05, 1306, 866, 386, 98)
sc.flow(at("vo04", "Tavily") - 0.2, sc.cursor - 0.05, ["Tavily search + extract", "Nemotron 3 Ultra", "cited rule pack"],
        tag="CDA rules · Islamabad")
S.append(sc)
t = card(sc.cursor - 0.25, "03", "Or start from your drawing", "Nemotron 3.5 Super VL")

# --- 5 Drawing upload ------------------------------------------------------------------------------------------------
sc = Scene("ft-drawing", t - 0.2, "03 · Your drawing")
T0 = sc.start
vo("vo05", T0 + 0.2)
d1 = sc.seg("drawing", D("uploaded") - 0.2, D("read") + 3.6, 1.0)
t_read = sc.at_src(d1, D("read"))
sc.cam(T0, 2.4, 1076, 690)
sc.cam(t_read + 0.15, 1.0, 960, 540, d=0.5)
sc.cam(t_read + 0.75, 1.45, 1180, 640, d=0.7)
sc.clock(T0, t_read + 1.0, [(sc.at_src(d1, D("uploaded")), 0.0), (t_read, D("read") - D("uploaded"))], fmt="sec", label="reading")
sc.lower(T0 + 0.3, t_read - 0.1, "Nemotron 3.5 Super VL", "reads the uploaded plan, room by room", tag="Vision model at work")
sc.ring(t_read + 1.3, sc.cursor - 0.05, 690, 836, 600, 126)
sc.callout(t_read + 0.3, sc.cursor - 0.05, f"Read {NUM['rooms_read']} rooms on {NUM['floors_read']} floors",
           "the design keeps the family’s layout", anchor="tl")
S.append(sc)

# --- 6 Concepts ------------------------------------------------------------------------------------------------------
sc = Scene("ft-concepts", sc.cursor, "04 · Concepts")
T0 = sc.start
c_end = F("plan view") - 0.12
c1 = sc.seg("full", F("concepts view"), c_end - 4.0, dur=3.6)
c2 = sc.seg("full", c_end - 4.0, c_end, 1.0)
# "...and Nemotron 3 Ultra starts work as the architect" lands as the concepts scene hands over to the diagram
vo("vo06", max(vo_end("vo05") + 0.5, T0 + 0.15, sc.cursor + 0.3 - W("vo06", "Nemotron 3 Ultra")))
sc.cam(T0, 1.0, 960, 540)
sc.cam(c2["t"], 1.05, 960, 520)
sc.cam(c2["t"] + 0.05, 1.18, 900, 430, d=c2["dur"] - 0.1, ease="none")
sc.clock(T0, sc.cursor, [(T0, 0.0), (c2["t"], c_end - 4.0 - F("concepts view")), (sc.cursor, c_end - F("concepts view"))])
sc.lower(T0 + 0.25, c2["t"] - 0.05, "Gemini image model", "four exterior concepts, drawn from the brief", tag="Images")
sc.ring(c2["t"] + 0.2, sc.cursor - 0.05, 336, 148, 430, 30)
sc.callout(c2["t"] + 0.25, sc.cursor - 0.05, "Decide for me", "Naqsha picks the strongest concept and starts the plan",
           anchor="br")
S.append(sc)

# --- 7 How Nemotron 3 Ultra designs a home (MG) -------------------------------------------------------------------------
NEMO_START = round(min(sc.cursor, at("vo06", "Nemotron 3 Ultra") - 0.3), 3)
sc.cursor = max(NEMO_START + 0.25, sc.cursor)  # the concept scene ends under the graphic's wipe
vo("vo07", vo_end("vo06") + 0.3)
NEMO_END = round(at("vo07", "testing") - 0.1, 3)
MG["mg-nemotron"] = dict(start=NEMO_START, end=NEMO_END, cues=dict(
    draft=at("vo07", "drafts") - 0.1, check=at("vo07", "rules engine") - 0.1, fix=at("vo07", "fixer") - 0.1))

# --- 8 Design run: plan + fixer (time-lapse) -> 3D written as code -> built in the browser ------------------------------
BUILD_TAIL = 50.0          # last seconds of the plan view: Ultra streams the 3D code ("Building the 3D model ... parts")
pv, hv = F("plan view"), F("house view")
pA = (pv + 1.0, pv + 33.0, 1.5)                               # reading the brief, 3 drafts in parallel
sc = Scene("ft-design", NEMO_END, "05 · Architect agent")
T0 = sc.start
fix_end = vo_end("vo07") + 2.6                                # the fixer's countdown, then a beat on the stat
pB = (pv + 33.0, hv - BUILD_TAIL, round(round((fix_end - T0 - pA[2]) * 30) / 30, 3))
vo("vo08", fix_end - 0.05)
# "Then Ultra writes the house in 3D as code" over the real run streaming its parts (pC) ->
# "section by section, from a checklist of every feature in the concept" on the code graphic (MG) ->
# "Your browser builds it as it arrives" on the house assembling.
pC_dur = round(round(max(2.0, at("vo08", "section by section") - 0.15 - fix_end) * 30) / 30, 3)
pC = (hv - BUILD_TAIL, hv - 0.05, pC_dur)
TL["tl_plan"] = {"src": CLIP["full"], "segs": [[round(a, 3), round(b, 3), d] for a, b, d in (pA, pB, pC)]}
p1 = sc.seg("tl_plan", 0.0, pA[2], 1.0, badge=fmt_rate((pA[1] - pA[0]) / pA[2]))
p2 = sc.seg("tl_plan", pA[2], pA[2] + pB[2], 1.0, badge=fmt_rate((pB[1] - pB[0]) / pB[2]))
tB = p2["t"]
sc.cam(T0, 1.0, 960, 540)
sc.cam(tB, 1.45, 960, 430, d=0.5)
sc.cam(tB + pB[2] * 0.4, 2.5, 985, 950, d=0.7)
sc.clock(T0, sc.cursor, [(T0, pA[0] - pv), (tB, pB[0] - pv), (sc.cursor, pB[1] - pv)])
sc.steps(T0 + 0.05, sc.cursor, [(T0, {0}, 0), (tB, {2}, 2)])
sc.lower(T0 + 0.15, tB + pB[2] * 0.4 + 0.2, "Fixer agent · Nemotron 3 Ultra", "check_edits, then apply_edits", width=1060)
sc.ring(tB + pB[2] * 0.4 + 0.7, sc.cursor - 0.1, 735, 958, 505, 50)
LDA_STAT = at("vo07", f"{NUM['lda_pass']} of") - 0.1
sc.stat(LDA_STAT, sc.cursor - 0.05, f"{NUM['lda_pass']}/{NUM['lda_total']}", "bylaw checks pass", anchor="tr")
S.append(sc)

sc = Scene("ft-build", sc.cursor, "06 · 3D as code")
T0 = sc.start
p3 = sc.seg("tl_plan", pA[2] + pB[2], pA[2] + pB[2] + pC[2], 1.0, badge=fmt_rate((pC[1] - pC[0]) / pC[2]))
sc.cam(T0, 2.6, 960, 190)
sc.clock(T0, sc.cursor, [(T0, pC[0] - pv), (sc.cursor, pC[1] - pv)])
sc.steps(T0, sc.cursor, [(T0, {3}, 3)])
sc.lower(T0 + 0.1, sc.cursor - 0.05, "Ultra streams the 3D code", "parts arrive one by one", width=1100)
S.append(sc)

CODE_START = round(sc.cursor - 0.2, 3)
CODE_END = round(max(CODE_START + 3.4, at("vo08", "Your browser") - 0.3), 3)
MG["mg-code"] = dict(start=CODE_START, end=CODE_END, cues=dict(list=at("vo08", "from a checklist") - 0.1))

sc = Scene("ft-house", CODE_END - 0.2, "06 · 3D as code")
T0 = sc.start
b_end = hv + 10.3
HV_SHOWN = hv + 1.8   # the house view needs ~1.7 s after the route change before the 3D canvas replaces the plan
p4 = sc.seg("full", HV_SHOWN, b_end, dur=max(7.4, vo_end("vo08") + 2.6 - sc.cursor))
sc.cam(T0, 1.0, 960, 540)
sc.cam(T0 + 0.05, 1.3, 1000, 560, d=p4["dur"] - 0.1, ease="power1.inOut")
sc.clock(T0, sc.cursor, [(T0, HV_SHOWN - pv), (sc.cursor, b_end - pv)])
sc.steps(T0, sc.cursor, [(T0, {3}, 3)])
sc.callout(T0 + 0.3, sc.cursor - 0.05, "Built in your browser", "each section appears as it arrives", anchor="bl")
S.append(sc)
HOUSE_UP = p4["t"] + p4["dur"] * 0.6

# --- 9 Match: the 3D model against the concept ------------------------------------------------------------------------
sc = Scene("ft-match", sc.cursor, "07 · Concept match")
T0 = sc.start
vo("vo09", max(vo_end("vo08") + 0.5, T0 + 0.2))
m_a, m_b = b_end, F("match score") - 0.4
m_dur = max((m_b - m_a) / 10.0, at("vo09", "Here") - 0.15 - T0)
e1 = sc.seg("full", m_a, m_b, dur=m_dur)
e2 = sc.seg("full", m_b, F("match popover") + 4.6, dur=max(3.0, vo_end("vo09") + 1.9 - sc.cursor))
pop_t = sc.at_src(e2, F("match popover"))
sc.cam(T0, 1.3, 760, 640)
sc.cam(T0 + 0.02, 1.36, 760, 650, d=e1["dur"] - 0.05, ease="none")
sc.cam(pop_t - 0.1, 1.5, 420, 520, d=0.6)
sc.clock(T0, e2["t"], [(T0, m_a - pv), (e2["t"], m_b - pv)])
sc.steps(T0, sc.cursor, [(T0, {4}, 4), (pop_t, set(), 5)])
sc.lower(T0 + 0.15, e2["t"] - 0.05, "Nemotron 3.5 Super VL · match check",
         "compares the 3D model with the concept, feature by feature, and the facade is rebuilt where it differs",
         tag="Vision model at work", width=1000, anchor="br")
sc.ring(pop_t + 0.45, sc.cursor - 0.05, 120, 222, 252, 66)
sc.stat(at("vo09", f"{NUM['match_before']}") - 0.15, sc.cursor - 0.05, f"{NUM['match_before']}% → {NUM['match_after']}%",
        "of the concept is in the 3D model", anchor="br")
S.append(sc)
MATCH_STAT = at("vo09", f"{NUM['match_before']}") - 0.15
t = card(sc.cursor - 0.25, "08", "Photos from every angle", "Gemini image model · from 3D captures")

# --- 10 Photos from every angle ----------------------------------------------------------------------------------------
sc = Scene("ft-photos", t - 0.2, "08 · Photos")
T0 = sc.start
vo("vo10", T0 + 0.2)
g1 = sc.seg("full", F("photos panel") + 0.3, F("photos done") + 3.4, 5.0)
g2 = sc.seg("full", F("photo enlarged") - 0.15, F("photo 4") + 2.3, 1.3)
sc.cam(T0, 1.27, 960, 470)
sc.cam(g2["t"], 1.0, 960, 540)
sc.cam(g2["t"] + 0.02, 1.08, 960, 520, d=g2["dur"] - 0.05, ease="none")
sc.clock(T0, g2["t"], [(T0, 0.3), (g2["t"], F("photos done") + 3.4 - F("photos panel"))], fmt="mmss", label="photos")
sc.lower(T0 + 0.2, g1["t"] + g1["dur"] - 0.1, "Gemini image model", "each capture of the 3D model becomes a photo",
         tag="Images")
names = ["Front", "Street corner", "Garden", "Aerial"]
marks_ = [F("photo enlarged"), F("photo 2"), F("photo 3"), F("photo 4")]
for k, (nm, m0) in enumerate(zip(names, marks_)):
    a_ = sc.at_src(g2, m0) + 0.12
    b_ = sc.at_src(g2, marks_[k + 1]) - 0.05 if k < 3 else sc.cursor - 0.05
    sc.callout(a_, b_, nm, "same house, same materials" if k == 1 else "", anchor="bl")
S.append(sc)
PHOTOS_DONE = sc.at_src(g1, F("photos done"))

# --- 11 Walk through ----------------------------------------------------------------------------------------------------
sc = Scene("ft-walk", sc.cursor, "09 · Walk-through")
T0 = sc.start
vo("vo11", max(vo_end("vo10") + 0.5, T0 + 0.4))
w1 = sc.seg("full", F("walk") + 1.2, min(F("walked") - 4.0, FULL_LEN - 0.2), 1.0)
sc.cam(T0, 1.0, 960, 540)
sc.cam(T0 + 0.02, 1.08, 960, 540, d=w1["dur"] - 0.05, ease="none")
sc.callout(T0 + 0.3, sc.cursor - 0.1, "First-person walk", "in the browser, room by room", anchor="bl")
S.append(sc)

# --- 12 Architecture (MG) --------------------------------------------------------------------------------------------------
ARCH_START = round(sc.cursor - 0.25, 3)
vo("vo12", ARCH_START + 0.55)
ARCH_END = round(vo_end("vo12") + 2.4, 3)
MG["mg-arch"] = dict(start=ARCH_START, end=ARCH_END, cues=dict(
    ultra=at("vo12", "Ultra") - 0.1, super=at("vo12", "Super runs") - 0.1, vl=at("vo12", "The vision") - 0.1,
    nebius=at("vo12", "All of it") - 0.05))

# --- Outro: who it is for -> 13 end card ---------------------------------------------------------------------------------
sc = Scene("ft-outro", ARCH_END - 0.25, "Who it’s for")
T0 = sc.start
vo("vo13", T0 + 0.8)
END_START = round(at("vo13", "Naqsha") - 0.3, 3)
o1 = sc.seg("full", F("orbit") - 2.3, F("orbit"), 1.0)
o2 = sc.seg("full", F("photo 2") + 0.2, F("photo 2") + 2.2, 1.0)
o3 = sc.seg("full", F("walk") + 7.0, F("walk") + 7.0 + 1.2 * max(0.8, END_START + 0.25 - sc.cursor), 1.2)
for s in (o1, o2, o3):
    sc.cam(s["t"], 1.0, 960, 540)
    sc.cam(s["t"] + 0.02, 1.06, 960, 540, d=s["dur"] - 0.05, ease="none")
sc.callout(at("vo13", "Families") - 0.1, at("vo13", "architects") - 0.2, "For families", "see the home before you build it")
sc.callout(at("vo13", "architects") - 0.1, sc.cursor - 0.05, "For architects", "a checked design for the first meeting")
S.append(sc)

TOTAL = round(vo_end("vo13") + 4.0, 2)
MG["mg-end"] = dict(start=END_START, end=TOTAL, cues=dict(open=at("vo13", "Open source") - 0.05))

# Music: the Lyria bed, re-fitted (scripts/fit_bed.py)
BED_PLAN = {"total": TOTAL, "pieces": [
    {"name": "hook", "at": 0.0, "until": HOOK_END, "src": round(16.45 - HOOK_END, 3), "fin": 0.4, "fout": 0.05},
    {"name": "main", "at": HOOK_END, "until": ARCH_START, "src": 16.45, "fin": 0.05},
    {"name": "break", "at": ARCH_START, "until": END_START - 0.2, "src": 193.64},
    {"name": "finale", "at": END_START - 0.2, "until": TOTAL - 2.8, "src": 213.33, "fout": 2.8},
]}

# Sound design (global start, file, volume)
SFX = [
    (MG["mg-hook"]["cues"]["stamp"] + 0.2, "impact-bass-1.mp3", 0.5),     # REJECTED stamp
    (HOOK_END - 0.3, "impact-bass-2.mp3", 0.45),                           # title hit
    (SFX_TYPING[0] + 0.1, "typing.mp3", 0.16),
    (BRIEF_POP, "pop.mp3", 0.28),
    (NEMO_START - 0.05, "whoosh.mp3", 0.3),
    (CODE_START - 0.05, "whoosh-short.mp3", 0.28),
    (ARCH_START - 0.05, "whoosh.mp3", 0.3),
    (END_START - 0.05, "whoosh.mp3", 0.3),
    (HOUSE_UP, "sparkle.mp3", 0.2),
    (PHOTOS_DONE, "sparkle.mp3", 0.2),
] + [(c[0] - 0.05, "whoosh-short.mp3", 0.3) for c in CARDS]
for sc_ in S:
    for o in sc_.over:
        if o["kind"] == "stat":
            SFX.append((o["a"], "pop.mp3", 0.3))


# =====================================================================================================
# TIME-LAPSE PROXIES (HyperFrames playback rate caps at 10x; frames are decimated, never blended)
# =====================================================================================================
def make_proxies():
    for name, job in TL.items():
        out = FOOT / f"{name}.mp4"
        key = hashlib.sha1(json.dumps(job, sort_keys=True).encode()).hexdigest()[:12]
        stamp = FOOT / f"{name}.plan.json"
        if out.exists() and stamp.exists() and json.loads(stamp.read_text()).get("key") == key:
            continue
        parts, labels = [], []
        for i, (a, b, d) in enumerate(job["segs"]):
            sp = (b - a) / d
            parts.append(f"[0:v]trim=start={a}:end={b},setpts=(PTS-STARTPTS)/{sp:.6f},fps=30[v{i}]")
            labels.append(f"[v{i}]")
        fc = ";".join(parts) + ";" + "".join(labels) + f"concat=n={len(job['segs'])}:v=1:a=0[out]"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(FOOT / job["src"]), "-filter_complex", fc, "-map", "[out]",
                        "-c:v", "libx264", "-crf", "17", "-preset", "medium", "-g", "30", "-pix_fmt", "yuv420p", "-r", "30",
                        str(out)], check=True)
        stamp.write_text(json.dumps({"key": key, **job}, indent=1))
        print(f"proxy {out.name}: {media_dur(out):.2f}s (planned {sum(d for _, _, d in job['segs']):.2f}s)")


# =====================================================================================================
# RENDER footage scenes
# =====================================================================================================
def esc(s):
    return html.escape(s, quote=True)


def anchor_css(anchor, x=None, y=None):
    if x is not None:
        return f"left:{x}px;top:{y}px;"
    return {"bl": "left:36px;bottom:36px;", "br": "right:36px;bottom:36px;",
            "tl": "left:36px;top:36px;", "tr": "right:36px;top:36px;"}[anchor]


ICON_FF = ('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" '
           'stroke-linejoin="round"><path d="M4 6l7 6-7 6V6z"/><path d="M13 6l7 6-7 6V6z"/></svg>')
ICON_CLOCK = ('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">'
              '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2"/><path d="M9 2h6"/></svg>')
ICON_SPARK = ('<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2c.6 4.9 2.6 7.6 7.8 8.6v.8c-5.2 1-7.2 3.7-7.8 '
              '8.6h-.8c-.6-4.9-2.6-7.6-7.8-8.6v-.8c5.2-1 7.2-3.7 7.8-8.6z"/></svg>')
ICON_ARROW = ('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" '
              'stroke-linejoin="round"><path d="M4 12h15M13 6l6 6-6 6"/></svg>')


def render_scene(sc: Scene) -> str:
    sid, T0 = sc.id, sc.start
    L = lambda t: round(t - T0, 3)  # noqa: E731
    vids, rings, overs, js = [], [], [], []
    for n, s in enumerate(sc.segs):
        attrs = [f'id="{sid}-v{n}"', f'src="assets/footage/{CLIP[s["clip"]]}"', f'data-start="{L(s["t"])}"',
                 f'data-duration="{round(s["dur"], 3)}"', f'data-media-start="{s["a"]}"',
                 f'data-track-index="{n % 2}"', 'data-hf-media-start-basis="local"', "muted", "playsinline"]
        if abs(s["rate"] - 1) > 1e-6:
            attrs.append(f'data-playback-rate="{round(s["rate"], 5)}"')
        vids.append(f'<video {" ".join(attrs)} class="vid"></video>')

    js.append(f'const cam = document.getElementById("{sid}-cam");')
    first = True
    for (t, z, fx, fy, d, ease) in sorted(sc.poses, key=lambda p: p[0]):
        tx, ty, s = pose(z, fx, fy)
        if first:
            js.append(f'tl.set(cam, {{x:{tx}, y:{ty}, scale:{s}, transformOrigin:"0 0"}}, 0);')
            first = False
        if d <= 0:
            js.append(f'tl.set(cam, {{x:{tx}, y:{ty}, scale:{s}}}, {max(0.0, L(t))});')
        else:
            js.append(f'tl.to(cam, {{x:{tx}, y:{ty}, scale:{s}, duration:{d}, ease:"{ease}"}}, {max(0.0, L(t))});')

    merged = []
    for a, b, text in sorted(sc.badges):
        if merged and merged[-1][2] == text and abs(merged[-1][1] - a) < 0.05:
            merged[-1] = (merged[-1][0], b, text)
        else:
            merged.append((a, b, text))
    badge_html = []
    for n, (a, b, text) in enumerate(merged):
        cls = "badge rt" if text == "real time" else "badge sl" if text.startswith("slow") else "badge"
        icon = ICON_CLOCK if (text == "real time" or text.startswith("slow")) else ICON_FF
        badge_html.append(f'<div class="{cls}" id="{sid}-b{n}">{icon}<span>{esc(text)}</span></div>')
        js.append(f'tl.fromTo("#{sid}-b{n}", {{opacity:0, y:10}}, {{opacity:1, y:0, duration:0.2, ease:"power3.out"}}, {max(0.0, L(a))});')
        if n < len(merged) - 1:
            js.append(f'tl.to("#{sid}-b{n}", {{opacity:0, y:-8, duration:0.14, ease:"power2.in"}}, {max(L(a) + 0.22, L(b) - 0.14)});')

    clock_html = []
    for n, c in enumerate(sc.clocks):
        cid = f"{sid}-c{n}"
        clock_html.append(f'<div class="clock" id="{cid}">{ICON_CLOCK}<span class="cv" id="{cid}-v">0:00</span>'
                          f'<span class="cl">{esc(c["label"])}</span></div>')
        mp = [[round(L(t), 4), round(v, 3)] for t, v in c["map"]]
        js.append(f'''(function(){{ const el=document.getElementById("{cid}-v"); const mp={json.dumps(mp)}; const fmt="{c["fmt"]}";
  const f=(x)=>{{ let v; if(x<=mp[0][0]) v=mp[0][1]; else if(x>=mp[mp.length-1][0]) v=mp[mp.length-1][1]; else {{ for(let i=0;i<mp.length-1;i++){{ if(x>=mp[i][0]&&x<=mp[i+1][0]){{ const u=(x-mp[i][0])/Math.max(1e-6,(mp[i+1][0]-mp[i][0])); v=mp[i][1]+u*(mp[i+1][1]-mp[i][1]); break; }} }} }}
    if(fmt==="sec") return v.toFixed(1)+" s"; const s=Math.round(v); return Math.floor(s/60)+":"+String(s%60).padStart(2,"0"); }};
  const p={{t:0}}; tl.fromTo(p,{{t:0}},{{t:{sc.dur}, duration:{sc.dur}, ease:"none", onUpdate:()=>{{ el.textContent=f(p.t); }}}},0); }})();''')
        js.append(f'tl.fromTo("#{cid}", {{opacity:0, x:-12}}, {{opacity:1, x:0, duration:0.22, ease:"power3.out"}}, {max(0.0, L(c["a"]))});')
        js.append(f'tl.to("#{cid}", {{opacity:0, duration:0.18}}, {max(L(c["a"]) + 0.3, L(c["b"]) - 0.18)});')

    for n, o in enumerate(sc.over):
        oid = f"{sid}-o{n}"
        a, b = max(0.0, L(o["a"])), L(o["b"])
        if o["kind"] == "ring":
            col = {"accent": "#2747F5", "fail": "#C8281E", "pass": "#0E7A55"}[o["tone"]]
            rings.append(f'<div class="ring" id="{oid}" style="left:{o["x"]}px;top:{o["y"]}px;width:{o["w"]}px;'
                         f'height:{o["h"]}px;border-color:{col};"></div>')
            js.append(f'tl.fromTo("#{oid}", {{opacity:0, scale:1.08}}, {{opacity:1, scale:1, duration:0.32, ease:"power3.out"}}, {a});')
            js.append(f'tl.to("#{oid}", {{opacity:0, duration:0.18}}, {max(a + 0.35, b - 0.18)});')
        elif o["kind"] == "lower":
            lpos = anchor_css(o.get("anchor", "bl")) + (f'max-width:{o["width"]}px;' if o.get("width") else "")
            overs.append(f'<div class="lower" id="{oid}" style="{lpos}"><div class="lt-in"><span class="ai-tag">{ICON_SPARK}{esc(o["tag"])}</span>'
                         f'<div class="lt-title">{esc(o["title"])}</div>'
                         + (f'<div class="lt-sub">{esc(o["sub"])}</div>' if o["sub"] else "") + "</div></div>")
            js.append(f'tl.fromTo("#{oid}", {{clipPath:"inset(0 100% 0 0 round 22px)", x:-24}}, {{clipPath:"inset(0 0% 0 0 round 22px)", x:0, duration:0.45, ease:"power3.out"}}, {a});')
            js.append(f'tl.fromTo("#{oid} .lt-in > *", {{opacity:0, y:14}}, {{opacity:1, y:0, duration:0.35, stagger:0.07, ease:"power2.out"}}, {a + 0.12});')
            js.append(f'tl.to("#{oid}", {{clipPath:"inset(0 0% 100% 0 round 22px)", duration:0.3, ease:"power2.in"}}, {max(a + 0.6, b - 0.3)});')
        elif o["kind"] == "callout":
            dot = {"ink": "#2747F5", "fail": "#C8281E", "pass": "#0E7A55"}[o["tone"]]
            cw = f'max-width:{o["width"]}px;' if o.get("width") else ""
            ctag = f'<div class="c-tag">{esc(o["tag"])}</div>' if o.get("tag") else ""
            overs.append(f'<div class="callout t-{o["tone"]}" id="{oid}" style="{anchor_css(o["anchor"], o["x"], o["y"])}{cw}">'
                         f'<span class="cdot" style="background:{dot}"></span><div>{ctag}<div class="c-text">{esc(o["text"])}</div>'
                         + (f'<div class="c-sub">{esc(o["sub"])}</div>' if o["sub"] else "") + "</div></div>")
            js.append(f'tl.fromTo("#{oid}", {{opacity:0, y:22, scale:0.96}}, {{opacity:1, y:0, scale:1, duration:0.38, ease:"back.out(1.6)"}}, {a});')
            js.append(f'tl.to("#{oid}", {{opacity:0, y:12, duration:0.2, ease:"power2.in"}}, {max(a + 0.42, b - 0.2)});')
        elif o["kind"] == "flow":
            chips = []
            for k, it in enumerate(o["items"]):
                if k:
                    chips.append(f'<span class="fl-ar" id="{oid}-a{k}">{ICON_ARROW}</span>')
                chips.append(f'<span class="fl-chip{" last" if k == len(o["items"]) - 1 else ""}" id="{oid}-i{k}">{esc(it)}</span>')
            ftag = f'<div class="c-tag">{esc(o["tag"])}</div>' if o["tag"] else ""
            overs.append(f'<div class="flow" id="{oid}" style="{anchor_css(o["anchor"])}">{ftag}<div class="fl-row">{"".join(chips)}</div></div>')
            js.append(f'tl.fromTo("#{oid}", {{opacity:0, y:22}}, {{opacity:1, y:0, duration:0.35, ease:"power3.out"}}, {a});')
            for k in range(len(o["items"])):
                js.append(f'tl.fromTo("#{oid}-i{k}", {{opacity:0, x:-14}}, {{opacity:1, x:0, duration:0.3, ease:"power2.out"}}, {a + 0.15 + k * 0.45});')
                if k:
                    js.append(f'tl.fromTo("#{oid}-a{k}", {{opacity:0, x:-8}}, {{opacity:1, x:0, duration:0.25, ease:"power2.out"}}, {a + 0.0 + k * 0.45});')
            js.append(f'tl.to("#{oid}", {{opacity:0, y:12, duration:0.2, ease:"power2.in"}}, {max(a + 1.6, b - 0.2)});')
        elif o["kind"] == "stat":
            overs.append(f'<div class="stat" id="{oid}" style="{anchor_css(o["anchor"], o.get("x"), o.get("y"))}"><div class="s-big">{esc(o["big"])}</div>'
                         f'<div class="s-label">{esc(o["label"])}</div></div>')
            js.append(f'tl.fromTo("#{oid}", {{opacity:0, scale:0.8, y:30}}, {{opacity:1, scale:1, y:0, duration:0.5, ease:"back.out(1.8)"}}, {a});')
            js.append(f'tl.fromTo("#{oid} .s-label", {{opacity:0, x:-16}}, {{opacity:1, x:0, duration:0.35, ease:"power2.out"}}, {a + 0.22});')
            js.append(f'tl.to("#{oid}", {{opacity:0, scale:0.96, duration:0.22, ease:"power2.in"}}, {max(a + 0.8, b - 0.22)});')
        elif o["kind"] == "steps":
            pills = "".join(f'<div class="sp" id="{oid}-p{k}"><span class="sp-n">{k + 1}</span>{esc(lab)}</div>'
                            for k, lab in enumerate(o["labels"]))
            overs.append(f'<div class="steps" id="{oid}">{pills}</div>')
            js.append(f'tl.fromTo("#{oid}", {{opacity:0, y:-12}}, {{opacity:1, y:0, duration:0.3, ease:"power3.out"}}, {a});')
            for (tm, active, done) in o["marks"]:
                for k in range(len(o["labels"])):
                    st_ = ("on" if k in active else "done" if k < done else "todo")
                    css = {"on": 'backgroundColor:"#2747F5", color:"#FFFFFF", borderColor:"#2747F5"',
                           "done": 'backgroundColor:"#E3F3EC", color:"#0B6446", borderColor:"#BFE3D2"',
                           "todo": 'backgroundColor:"#FFFFFF", color:"#6E6E73", borderColor:"#DADAD4"'}[st_]
                    js.append(f'tl.set("#{oid}-p{k}", {{{css}}}, {max(0.0, L(tm))});')

    js.insert(0, f'tl.fromTo("#{sid}-win", {{scale:1.03}}, {{scale:1, duration:0.6, ease:"power3.out"}}, 0);')
    js.insert(1, f'tl.fromTo("#{sid}-chap", {{opacity:0, x:20}}, {{opacity:1, x:0, duration:0.35, ease:"power3.out"}}, 0.15);')
    js.insert(2, f'tl.fromTo("#{sid}-live", {{opacity:1}}, {{opacity:0.35, duration:0.6, repeat:{max(1, int(sc.dur / 0.6) - 1)}, yoyo:true, ease:"sine.inOut"}}, 0);')

    body = "\n".join(js)
    return f"""<!doctype html>
<html lang="en"><head><meta charset="UTF-8" /></head>
<body>
<template id="{sid}-template">
<style>
{FONTS}
#{sid} {{ position:absolute; inset:0; width:100%; height:100%; font-family:"Geist", sans-serif; color:#111113; }}
#{sid} .topbar {{ position:absolute; left:{WX}px; top:34px; width:{WW}px; height:66px; display:flex; align-items:center; gap:16px; }}
#{sid} .chip {{ display:flex; align-items:center; gap:14px; height:60px; padding:0 26px 0 22px; border-radius:999px; background:#111113; color:#F5F5F7; font-size:32px; font-weight:600; letter-spacing:0.01em; box-shadow:0 10px 30px -12px rgba(17,17,19,.5); white-space:nowrap; }}
#{sid} .chip .dot {{ width:16px; height:16px; border-radius:50%; background:#FF453A; box-shadow:0 0 0 5px rgba(255,69,58,.22); }}
#{sid} .chip .muted {{ color:#C9C9D1; font-weight:500; }}
#{sid} .bslot {{ position:relative; width:330px; height:60px; }}
#{sid} .badge {{ position:absolute; left:0; top:0; height:60px; display:flex; align-items:center; gap:10px; padding:0 22px 0 16px; border-radius:999px; background:#2747F5; color:#fff; font-size:32px; font-weight:600; white-space:nowrap; opacity:0; }}
#{sid} .badge.rt {{ background:#0E7A55; }}
#{sid} .badge.sl {{ background:#46464B; }}
#{sid} .badge svg, #{sid} .clock svg {{ width:30px; height:30px; flex:none; }}
#{sid} .cslot {{ position:relative; width:420px; height:60px; }}
#{sid} .clock {{ position:absolute; left:0; top:0; height:60px; display:flex; align-items:center; gap:10px; padding:0 22px 0 16px; border-radius:999px; background:#FFFFFF; color:#111113; font-size:32px; font-weight:600; border:2px solid #CFCFC8; white-space:nowrap; opacity:0; }}
#{sid} .clock .cv {{ font-family:"Geist Mono", monospace; font-variant-numeric:tabular-nums; font-weight:600; }}
#{sid} .clock .cl {{ color:#46464B; font-weight:500; }}
#{sid} .chap {{ margin-left:auto; font-family:"Geist Mono", monospace; font-size:32px; font-weight:500; color:#46464B; white-space:nowrap; }}
#{sid} .win {{ position:absolute; left:{WX}px; top:{WY}px; width:{WW}px; height:{WH}px; border-radius:28px; overflow:hidden; background:#F6F6F3; box-shadow:0 0 0 2px rgba(17,17,19,.07), 0 40px 90px -30px rgba(17,17,19,.42); transform-origin:50% 50%; }}
#{sid} .cam {{ position:absolute; left:0; top:0; width:1920px; height:1080px; transform-origin:0 0; will-change:transform; }}
#{sid} .vid {{ position:absolute; left:0; top:0; width:1920px; height:1080px; object-fit:cover; }}
#{sid} .ring {{ position:absolute; border:5px solid #2747F5; border-radius:14px; box-shadow:0 0 0 8px rgba(39,71,245,.16); opacity:0; }}
#{sid} .lower {{ position:absolute; max-width:1180px; padding:24px 32px 26px; border-radius:22px; background:rgba(17,17,19,.88); color:#F5F5F7; box-shadow:0 24px 60px -20px rgba(0,0,0,.55); clip-path:inset(0 100% 0 0 round 22px); }}
#{sid} .lower .ai-tag {{ display:inline-flex; align-items:center; gap:10px; font-family:"Geist Mono", monospace; font-size:30px; font-weight:500; color:#9DB0FF; margin-bottom:6px; }}
#{sid} .lower .ai-tag svg {{ width:28px; height:28px; }}
#{sid} .lower .lt-title {{ font-size:44px; font-weight:650; letter-spacing:-0.02em; line-height:1.12; }}
#{sid} .lower .lt-sub {{ font-size:32px; font-weight:450; color:#C9C9D1; margin-top:8px; line-height:1.25; }}
#{sid} .callout {{ position:absolute; display:flex; align-items:flex-start; gap:18px; max-width:1100px; padding:22px 30px 24px 26px; border-radius:20px; background:#FFFFFF; box-shadow:0 0 0 2px rgba(17,17,19,.08), 0 26px 60px -22px rgba(17,17,19,.45); opacity:0; }}
#{sid} .callout .cdot {{ width:18px; height:18px; border-radius:50%; margin-top:14px; flex:none; box-shadow:0 0 0 6px rgba(39,71,245,.14); }}
#{sid} .callout .c-text {{ font-size:40px; font-weight:630; letter-spacing:-0.015em; line-height:1.16; }}
#{sid} .callout .c-sub {{ font-size:32px; font-weight:450; color:#46464B; margin-top:6px; line-height:1.25; }}
#{sid} .c-tag {{ display:inline-block; margin:2px 0 8px; padding:3px 14px; border-radius:999px; background:#EEF1FE; color:#1F3BD0; font-family:"Geist Mono", monospace; font-size:28px; font-weight:500; }}
#{sid} .flow {{ position:absolute; padding:20px 26px 24px; border-radius:22px; background:#FFFFFF; box-shadow:0 0 0 2px rgba(17,17,19,.08), 0 26px 60px -22px rgba(17,17,19,.45); opacity:0; }}
#{sid} .flow .fl-row {{ display:flex; align-items:center; gap:12px; }}
#{sid} .flow .fl-chip {{ height:62px; display:flex; align-items:center; padding:0 22px; border-radius:999px; background:#111113; color:#F5F5F7; font-size:34px; font-weight:600; white-space:nowrap; }}
#{sid} .flow .fl-chip.last {{ background:#2747F5; }}
#{sid} .flow .fl-ar {{ display:flex; color:#2747F5; }}
#{sid} .flow .fl-ar svg {{ width:36px; height:36px; }}
#{sid} .stat {{ position:absolute; padding:24px 38px 28px; border-radius:26px; background:#2747F5; color:#fff; box-shadow:0 30px 70px -24px rgba(39,71,245,.6); opacity:0; transform-origin:100% 0%; }}
#{sid} .stat .s-big {{ font-size:120px; font-weight:700; letter-spacing:-0.05em; line-height:0.95; font-variant-numeric:tabular-nums; white-space:nowrap; }}
#{sid} .stat .s-label {{ font-size:34px; font-weight:500; color:#DCE3FF; margin-top:10px; white-space:nowrap; }}
#{sid} .steps {{ position:absolute; left:36px; top:36px; display:flex; gap:10px; opacity:0; }}
#{sid} .steps .sp {{ display:flex; align-items:center; gap:10px; height:56px; padding:0 20px 0 12px; border-radius:999px; border:2px solid #DADAD4; background:#FFFFFF; color:#6E6E73; font-size:30px; font-weight:600; white-space:nowrap; box-shadow:0 10px 26px -14px rgba(17,17,19,.45); }}
#{sid} .steps .sp-n {{ display:flex; align-items:center; justify-content:center; width:32px; height:32px; border-radius:50%; background:rgba(17,17,19,.08); font-family:"Geist Mono", monospace; font-size:28px; }}
</style>
<div id="{sid}" data-composition-id="{sid}" data-width="1920" data-height="1080" data-duration="{sc.dur}">
  <div class="topbar">
    <div class="chip" id="{sid}-chip"><span class="dot" id="{sid}-live"></span><span>LIVE</span><span class="muted">· real product</span></div>
    <div class="bslot">{"".join(badge_html)}</div>
    <div class="cslot">{"".join(clock_html)}</div>
    <div class="chap" id="{sid}-chap">{esc(sc.chapter)}</div>
  </div>
  <div class="win" id="{sid}-win">
    <div class="cam" id="{sid}-cam" data-layout-allow-overflow>
      {chr(10).join(vids)}
      {"".join(rings)}
    </div>
    {"".join(overs)}
  </div>
</div>
<script>
(function(){{
const tl = gsap.timeline({{ paused: true }});
{body}
window.__timelines["{sid}"] = tl;
}})();
</script>
</template>
</body></html>
"""


def render_card(n, num, title, attr):
    cid = f"mg-card{n + 1}"
    words = "".join(f'<span class="w">{esc(w)}</span> ' for w in title.split(" "))
    return f"""<!doctype html>
<html lang="en"><head><meta charset="UTF-8" /></head>
<body>
<template id="{cid}-template">
<style>
{FONTS}
#{cid} {{ position:absolute; inset:0; width:100%; height:100%; overflow:hidden; font-family:"Geist", sans-serif; color:#111113; }}
#{cid} .wrap {{ position:absolute; inset:0; }}
#{cid} .bg {{ position:absolute; inset:-60px; background-color:#F6F6F3;
  background-image: radial-gradient(1000px 760px at 85% 50%, rgba(39,71,245,.12), rgba(39,71,245,0) 70%),
    linear-gradient(rgba(17,17,19,.055) 2px, transparent 2px), linear-gradient(90deg, rgba(17,17,19,.055) 2px, transparent 2px),
    linear-gradient(rgba(17,17,19,.03) 1px, transparent 1px), linear-gradient(90deg, rgba(17,17,19,.03) 1px, transparent 1px);
  background-size:100% 100%, 240px 240px, 240px 240px, 48px 48px, 48px 48px; }}
#{cid} .ghost {{ position:absolute; right:60px; top:120px; font-size:640px; font-weight:700; line-height:1; color:transparent; -webkit-text-stroke:4px rgba(39,71,245,.16); letter-spacing:-0.06em; }}
#{cid} .box {{ position:absolute; left:160px; top:0; bottom:0; width:1460px; display:flex; flex-direction:column; justify-content:center; }}
#{cid} .num {{ display:flex; align-items:center; gap:24px; font-family:"Geist Mono", monospace; font-size:44px; font-weight:600; color:#2747F5; }}
#{cid} .rule {{ display:block; width:220px; height:4px; background:#2747F5; transform-origin:0 50%; }}
#{cid} .title {{ margin-top:30px; font-size:116px; font-weight:660; letter-spacing:-0.048em; line-height:1.0; }}
#{cid} .title .w {{ display:inline-block; }}
#{cid} .attr {{ margin-top:46px; display:inline-flex; align-self:flex-start; align-items:center; gap:16px; height:78px; padding:0 34px 0 26px; border-radius:999px; background:#111113; color:#F5F5F7; font-family:"Geist Mono", monospace; font-size:36px; font-weight:500; white-space:nowrap; }}
#{cid} .attr svg {{ width:34px; height:34px; color:#9DB0FF; }}
#{cid} .edge {{ position:absolute; top:0; bottom:0; left:0; width:16px; background:#2747F5; }}
</style>
<div id="{cid}" data-composition-id="{cid}" data-width="1920" data-height="1080" data-duration="{CARD_DUR}">
  <div class="wrap" id="{cid}-wrap">
    <div class="bg" id="{cid}-bg" data-layout-allow-overflow></div>
    <div class="ghost" id="{cid}-ghost" data-layout-ignore>{num}</div>
    <div class="box">
      <div class="num" id="{cid}-num"><span>{num}</span><span class="rule" id="{cid}-rule"></span></div>
      <div class="title" id="{cid}-title">{words}</div>
      <div class="attr" id="{cid}-attr">{ICON_SPARK}<span>{esc(attr)}</span></div>
    </div>
  </div>
  <div class="edge" id="{cid}-edge"></div>
</div>
<script>
(function(){{
const tl = gsap.timeline({{ paused: true }});
tl.fromTo("#{cid}-wrap", {{ clipPath:"inset(0% 0% 0% 100%)" }}, {{ clipPath:"inset(0% 0% 0% 0%)", duration:0.4, ease:"power3.inOut" }}, 0);
tl.fromTo("#{cid}-edge", {{ x:1920, opacity:1 }}, {{ x:-16, duration:0.4, ease:"power3.inOut" }}, 0);
tl.fromTo("#{cid}-bg", {{ x:0 }}, {{ x:-50, duration:{CARD_DUR}, ease:"none" }}, 0);
tl.fromTo("#{cid}-ghost", {{ x:80, opacity:0 }}, {{ x:0, opacity:1, duration:1.2, ease:"power2.out" }}, 0.1);
tl.fromTo("#{cid}-num", {{ opacity:0, y:20 }}, {{ opacity:1, y:0, duration:0.35, ease:"power3.out" }}, 0.18);
tl.fromTo("#{cid}-rule", {{ scaleX:0 }}, {{ scaleX:1, duration:0.5, ease:"power3.out" }}, 0.25);
tl.fromTo("#{cid}-title .w", {{ opacity:0, y:60 }}, {{ opacity:1, y:0, duration:0.42, stagger:0.05, ease:"power3.out" }}, 0.25);
tl.fromTo("#{cid}-attr", {{ opacity:0, y:24, scale:0.95 }}, {{ opacity:1, y:0, scale:1, duration:0.4, ease:"back.out(1.7)" }}, 0.5);
tl.fromTo("#{cid}-wrap", {{ y:0 }}, {{ y:-30, duration:0.4, ease:"power2.in" }}, {CARD_DUR - 0.4});
tl.to("#{cid}-wrap", {{ clipPath:"inset(0% 0% 100% 0%)", duration:0.4, ease:"power3.in" }}, {CARD_DUR - 0.4});
window.__timelines["{cid}"] = tl;
}})();
</script>
</template>
</body></html>
"""


def render_mg(sid, spec):
    """Fill a hand-made template (scripts/mg/<id>.html): duration, cue times (local seconds) and {{numbers}}."""
    src = (HERE / "mg" / f"{sid}.html").read_text()
    dur = round(spec["end"] - spec["start"], 3)
    cues = {k: round(v - spec["start"], 3) for k, v in spec["cues"].items()}
    for k, v in cues.items():
        assert 0 <= v <= dur, f"{sid}: cue {k} at {v} outside 0..{dur}"
    out = src.replace("__DUR__", str(dur)).replace("__CUES__", json.dumps(cues))
    out = re.sub(r"\{\{(\w+)\}\}", lambda m: str(NUM[m.group(1)]), out)
    return out


def sfx_dur(f):
    return round(media_dur(ROOT / "assets/sfx" / f) - 0.01, 3)


def render_index():
    hosts = []
    for sc in S:
        hosts.append(f'<div id="host-{sc.id}" data-composition-id="{sc.id}" data-composition-src="compositions/{sc.id}.html" '
                     f'data-start="{sc.start}" data-duration="{sc.dur}" data-track-index="1" data-track-kind="graphics" '
                     f'data-width="1920" data-height="1080" style="z-index:10"></div>')
    for sid, spec in MG.items():
        hosts.append(f'<div id="host-{sid}" data-composition-id="{sid}" data-composition-src="compositions/{sid}.html" '
                     f'data-start="{round(spec["start"], 3)}" data-duration="{round(spec["end"] - spec["start"], 3)}" '
                     f'data-track-index="2" data-track-kind="graphics" data-width="1920" data-height="1080" style="z-index:30"></div>')
    for n, (a, num, title, attr) in enumerate(CARDS):
        cid = f"mg-card{n + 1}"
        hosts.append(f'<div id="host-{cid}" data-composition-id="{cid}" data-composition-src="compositions/{cid}.html" '
                     f'data-start="{a}" data-duration="{CARD_DUR}" data-track-index="3" data-track-kind="graphics" '
                     f'data-width="1920" data-height="1080" style="z-index:40"></div>')
    audio = []
    for k, (cid, name, t, d) in enumerate(VOC):
        audio.append(f'<audio id="{cid}" src="assets/voice/{name}.wav" data-start="{round(t, 3)}" data-duration="{round(d, 3)}" '
                     f'data-track-index="{10 + (k % 2)}" data-audio-group="voiceover" data-volume="1"></audio>')
    audio.append(f'<audio id="music" src="assets/music/bed_fit.wav" data-start="0" data-duration="{TOTAL}" data-track-index="12" '
                 f'data-audio-group="music" data-volume="0.5"></audio>')
    for k, (t, f, v) in enumerate(sorted(SFX)):
        audio.append(f'<audio id="sfx{k:02d}" src="assets/sfx/{f}" data-start="{round(t, 3)}" '
                     f'data-duration="{min(sfx_dur(f), SFX_TYPING[1]) if f == "typing.mp3" else sfx_dur(f)}" '
                     f'data-track-index="{13 + (k % 3)}" data-audio-group="sfx" data-volume="{v}"></audio>')
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=1920, height=1080" />
<title>Naqsha · Nebius edition demo</title>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<style>
{FONTS}
* {{ margin:0; padding:0; box-sizing:border-box; }}
html, body {{ width:1920px; height:1080px; overflow:hidden; background:#F6F6F3; }}
#root {{ position:relative; width:100%; height:100%; overflow:hidden; font-family:"Geist", sans-serif; }}
#root > div[data-composition-src] {{ position:absolute; inset:0; }}
#bg {{ position:absolute; inset:-120px; background-color:#F6F6F3;
  background-image:
    radial-gradient(1200px 800px at 18% 12%, rgba(39,71,245,.10), rgba(39,71,245,0) 70%),
    radial-gradient(900px 700px at 92% 96%, rgba(39,71,245,.07), rgba(39,71,245,0) 70%),
    linear-gradient(rgba(17,17,19,.055) 2px, transparent 2px),
    linear-gradient(90deg, rgba(17,17,19,.055) 2px, transparent 2px),
    linear-gradient(rgba(17,17,19,.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(17,17,19,.03) 1px, transparent 1px);
  background-size: 100% 100%, 100% 100%, 240px 240px, 240px 240px, 48px 48px, 48px 48px; }}
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-width="1920" data-height="1080" data-duration="{TOTAL}"
     data-fx-chain='{{"version":1,"nodes":[{{"type":"truepeak","id":"m1","params":{{"ceiling":-1.5}}}}]}}'>
  <div id="bg"></div>
  {chr(10).join("  " + h for h in hosts)}
  {chr(10).join("  " + a for a in audio)}
</div>
<script>
(function(){{
const tl = gsap.timeline({{ paused: true }});
tl.fromTo("#bg", {{ x:0, y:0 }}, {{ x:-96, y:-48, duration:{TOTAL}, ease:"none" }}, 0);
window.__timelines["main"] = tl;
}})();
</script>
</body>
</html>
"""


if __name__ == "__main__":
    make_proxies()
    for f in COMP.glob("ft-*.html"):
        f.unlink()
    for f in COMP.glob("mg-card*.html"):
        f.unlink()
    for sc in S:
        (COMP / f"{sc.id}.html").write_text(render_scene(sc))
        print(f"{sc.id:12s} {sc.start:7.2f} → {sc.start + sc.dur:7.2f}  ({sc.dur:5.2f}s)  {sc.chapter}")
    for n, c in enumerate(CARDS):
        (COMP / f"mg-card{n + 1}.html").write_text(render_card(n, c[1], c[2], c[3]))
    for sid, spec in MG.items():
        (COMP / f"{sid}.html").write_text(render_mg(sid, spec))
        print(f"{sid:12s} {spec['start']:7.2f} → {spec['end']:7.2f}  ({spec['end'] - spec['start']:5.2f}s)")
    (HERE / "bed_plan.json").write_text(json.dumps(BED_PLAN, indent=1))
    subprocess.run(["python3", str(HERE / "fit_bed.py")], check=True)
    (ROOT / "index.html").write_text(render_index())
    print("cards:", [(c[1], round(c[0], 2)) for c in CARDS])
    print("VO:", [(c[0], round(c[2], 2), round(c[2] + c[3], 2)) for c in VOC])
    print("TOTAL", TOTAL)
