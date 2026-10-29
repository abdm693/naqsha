"""Generate the footage scenes (compositions/ft-*.html) and the root index.html from one timeline spec.

Every time below is GLOBAL composition seconds unless named *_local. Footage is real, unedited screen capture of
the live app; each <video> picks a source range with data-media-start and a constant data-playback-rate (<= 10x),
or plays a pre-built time-lapse proxy (scripts/prep_timelapse.py) for the two runs that need more than 10x.
Motion-graphic scenes (hook, title, cards, argon, code, arch, endcard) are hand-authored in compositions/.
"""
from __future__ import annotations

import html
import json
import math
import re
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COMP = ROOT / "compositions"
FONTS = (ROOT / "scripts/brand.css").read_text()

# Window geometry: footage plays in a floating app window on the limestone canvas.
WX, WY, WW, WH = 128, 118, 1664, 936
K = WW / 1920

CLIP = {
    "a": "a_landing_hero_to_portal.mp4", "b": "b_setup_one_message.mp4", "c": "c_concepts_day_night.mp4",
    "d1tl": "d1_tl.mp4", "d2": "d2_plan_compliance_print.mp4", "d3": "d3_live_house_first_look.mp4",
    "e": "e_sample_orbit_night_render.mp4", "f": "f_walk_like_a_game.mp4",
    "g1": "g1_owner_pin_comment_and_share.mp4", "g2": "g2_client_link_comment.mp4",
    "g3": "g3_owner_sees_client_comment.mp4", "h": "h_revise_from_comments.mp4", "htl": "h_tl.mp4",
    "i": "i_ask_bar_typed_change.mp4", "x": "x_bonus_villa_orbit_day_night.mp4",
    "y": "y_bonus_after_revision_walk.mp4",
}


def fmt_rate(r: float) -> str:
    s = str(round(r)) if r >= 3 else f"{r:.1f}".rstrip("0").rstrip(".")
    return f"sped up {s}×"


def pose(z: float, fx: float, fy: float):
    s = K * z
    tx = min(0.0, max(WW - s * 1920, WW / 2 - s * fx))
    ty = min(0.0, max(WH - s * 1080, WH / 2 - s * fy))
    return round(tx, 2), round(ty, 2), round(s, 5)


def ramp_consumed(points, t_end):
    """Source seconds consumed by a log-interpolated rate lane from 0 to t_end."""
    tot = 0.0
    pts = sorted(points)
    for (t0, v0), (t1, v1) in zip(pts, pts[1:]):
        if t0 >= t_end:
            break
        t1c = min(t1, t_end)
        d = t1c - t0
        if abs(v1 - v0) < 1e-9:
            tot += v0 * d
        else:
            r = v1 / v0
            span = t1 - t0
            # integral of v0 * r^(u/span) du from 0..d
            tot += v0 * span / math.log(r) * (r ** (d / span) - 1)
    if t_end > pts[-1][0]:
        tot += pts[-1][1] * (t_end - pts[-1][0])
    return tot


class Scene:
    def __init__(self, sid, start, chapter, end=None):
        self.id, self.start, self.chapter = sid, start, chapter
        self.segs, self.poses, self.over, self.badges, self.clocks = [], [], [], [], []
        self.cursor = start
        self.end = end

    # --- footage -------------------------------------------------------------------------------
    def seg(self, clip, a, b, rate=None, dur=None, badge="auto", lane=None, mask=None):
        if lane is not None:  # speed ramp: solve duration so the lane consumes exactly b-a
            lo, hi = 0.1, (b - a)
            for _ in range(80):
                mid = (lo + hi) / 2
                if ramp_consumed(lane, mid) < (b - a):
                    lo = mid
                else:
                    hi = mid
            dur, rate = hi, None
        elif dur is None:
            dur = (b - a) / rate
        else:
            rate = (b - a) / dur
        s = dict(clip=clip, a=a, b=b, rate=rate, dur=dur, t=self.cursor, lane=lane)
        self.segs.append(s)
        if mask:  # our own label over the app's project header (hides its score pill on sample footage)
            text = mask if isinstance(mask, str) else mask[0]
            self.over.append(dict(kind="mask", a=self.cursor, b=self.cursor + dur, text=text, x=10, y=10, w=420, h=60))
        if badge == "auto" and rate is not None and rate > 1.05:
            self.badges.append((self.cursor, self.cursor + dur, fmt_rate(rate)))
        elif badge not in (None, "auto"):
            self.badges.append((self.cursor, self.cursor + dur, badge))
        self.cursor += dur
        return s

    def at_src(self, s, src):
        """Global time at which segment s shows source second src (constant-rate segments)."""
        return s["t"] + (src - s["a"]) / s["rate"]

    # --- camera / overlays ---------------------------------------------------------------------
    def cam(self, t, z, fx=960, fy=540, d=0.0, ease="power2.inOut"):
        self.poses.append((t, z, fx, fy, d, ease))

    def badge(self, a, b, text):
        self.badges.append((a, b, text))

    def clock(self, a, b, mapping, fmt="mmss", label="real time"):
        self.clocks.append(dict(a=a, b=b, map=mapping, fmt=fmt, label=label))

    def lower(self, a, b, title, sub="", ai=True, tag="AI at work", anchor="bl", width=None):
        self.over.append(dict(kind="lower", a=a, b=b, title=title, sub=sub, ai=ai, tag=tag, anchor=anchor, width=width))

    def steps(self, a, b, marks, labels=("Plan", "Check", "Fix", "Self-review", "Build")):
        """A pipeline strip; marks = [(t, set_of_active_indices, n_done_before)]."""
        self.over.append(dict(kind="steps", a=a, b=b, marks=marks, labels=labels))

    def quote(self, a, b, tag, title, body, foot="", anchor="tl", width=900, y=None):
        self.over.append(dict(kind="quote", a=a, b=b, tag=tag, title=title, body=body, foot=foot, anchor=anchor, width=width, y=y))

    def rules(self, a, b, rows, title="Rules check", tag="", anchor="br", width=560):
        """A live compliance card: rows of (label, [(t, value, tone), ...]); each value shows from its t."""
        self.over.append(dict(kind="rules", a=a, b=b, rows=rows, title=title, tag=tag, anchor=anchor, width=width))

    def callout(self, a, b, text, sub="", anchor="br", tone="ink", x=None, y=None, tag="", width=None):
        self.over.append(dict(kind="callout", a=a, b=b, text=text, sub=sub, anchor=anchor, tone=tone, x=x, y=y, tag=tag, width=width))

    def stat(self, a, b, big, label, anchor="br", x=None, y=None):
        self.over.append(dict(kind="stat", a=a, b=b, big=big, label=label, anchor=anchor, x=x, y=y))

    def ring(self, a, b, x, y, w, h, tone="accent"):
        self.over.append(dict(kind="ring", a=a, b=b, x=x, y=y, w=w, h=h, tone=tone))

    def log(self, a, b, title, lines, anchor="tr", width=720, dim=True):
        self.over.append(dict(kind="log", a=a, b=b, title=title, lines=lines, anchor=anchor, width=width, dim=dim))

    def statement(self, a, b, text, sub=""):
        self.over.append(dict(kind="statement", a=a, b=b, text=text, sub=sub))

    @property
    def dur(self):
        return round((self.end if self.end else self.cursor) - self.start, 3)


# =====================================================================================================
# VOICE (v2 script, hi-in-csagent-11) and word timings
# =====================================================================================================
def vo_dur(name):
    with wave.open(str(ROOT / "assets/voice" / f"{name}.wav")) as w:
        return w.getnframes() / w.getframerate()


VD = {f"vo{n:02d}": vo_dur(f"vo{n:02d}") for n in range(1, 15)}
WORDS = {k: json.loads((ROOT / "scripts/words" / f"{k}.words.json").read_text()) for k in VD}


def W(vo, i, edge="start"):
    """Local time of word i in a voice line (Whisper word timings, scripts/words/)."""
    return WORDS[vo][i][edge]


# Split points inside a line: the middle of the pause between two sentences (Whisper word timings), so each
# sentence can sit on its own footage. The words are unchanged; only the pause between two sentences grows.
def gap_mid(name, i):
    """Cut point between word i and word i+1: 120 ms before the next word's measured onset (first 10 ms frame above
    -32 dBFS after the longest quiet run), so each part starts just before its first word and the pause stays with the
    part before it. Whisper word ends are unreliable, so the cut is placed on the audio itself."""
    import numpy as np
    with wave.open(str(ROOT / "assets/voice" / f"{name}.wav")) as w:
        sr = w.getframerate()
        x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float64) / 32768.0
    hop = int(sr * 0.01)
    a, b = int((W(name, i) + 0.2) / 0.01), int((W(name, i + 1) + 0.3) / 0.01)
    db = [20 * np.log10(np.sqrt(np.mean(x[k * hop:(k + 1) * hop] ** 2)) + 1e-9) for k in range(a, b)]
    run, best = None, (0, 0)
    for k, v in enumerate(db + [0.0]):
        if v < -40 and run is None:
            run = k
        elif v >= -40 and run is not None:
            if k - run > best[1] - best[0]:
                best = (run, k)
            run = None
    onset = next((k for k in range(best[1], len(db)) if db[k] > -32), best[1])
    cut = max(best[0] + 2, onset - 12)
    return round((a + cut) * 0.01, 3)


SPLITS = {"vo08": [gap_mid("vo08", 28), gap_mid("vo08", 40), gap_mid("vo08", 53)],
          "vo09": [gap_mid("vo09", 8), gap_mid("vo09", 16), gap_mid("vo09", 26)],
          "vo14": [gap_mid("vo14", 54)]}
VOC = []  # (clip id, line, global start, offset of the part inside the line, duration)
PARTS = ROOT / "assets/voice/parts"


def write_parts():
    """Each part of a split line is its own file (25 ms fades at the cuts), so every voice clip plays from 0 and the
    music carve measures exactly what is placed."""
    import subprocess
    PARTS.mkdir(exist_ok=True)
    for name, cuts in SPLITS.items():
        edges = [0.0] + cuts + [VD[name]]
        for k in range(len(edges) - 1):
            a, b = edges[k], edges[k + 1]
            d = b - a
            fades = []
            if k > 0:
                fades.append("afade=t=in:st=0:d=0.025")
            if k < len(edges) - 2:
                fades.append(f"afade=t=out:st={d - 0.025:.3f}:d=0.025")
            af = ",".join([f"atrim=start={a}:end={b}", "asetpts=PTS-STARTPTS"] + fades)
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(ROOT / "assets/voice" / f"{name}.wav"), "-af", af,
                            "-c:a", "pcm_s16le", str(PARTS / f"{name}{'abcd'[k]}.wav")], check=True)


def vo(name, t, part=None):
    """Place line `name` (or one part of a split line) at global time t; returns t."""
    if part is None:
        VOC.append((name, name, t, 0.0, VD[name]))
        return t
    cuts = [0.0] + SPLITS[name] + [VD[name]]
    a, b = cuts[part], cuts[part + 1]
    VOC.append((f"{name}{'abcd'[part]}", name, t, a, b - a))
    return t


def vo_end(cid):
    c = next(c for c in VOC if c[0] == cid)
    return c[2] + c[4]


def at(name, i, part=None, edge="start"):
    """Global time of word i of a placed line."""
    for cid, nm, t, ms, d in VOC:
        if nm == name and (part is None or cid.endswith("abcd"[part])):
            if ms <= W(name, i, edge) <= ms + d + 0.01:
                return t + W(name, i, edge) - ms
    raise KeyError((name, i))


# =====================================================================================================
# TIMELINE (global seconds)
# =====================================================================================================
S: list[Scene] = []
CARD_DUR = 1.8
CARDS = []  # (start, number, title, attribution)
MG = []  # (id, file, start, end)
TL_PLAN = {}  # time-lapse proxy phases, read by prep_timelapse.py


def card(t, num, title, attr):
    CARDS.append((round(t, 3), num, title, attr))
    return t + CARD_DUR


# --- Hook + title (motion graphics) -----------------------------------------------------------------
SAMPLE = ("Sample home · 10 marla", 334)
HOOK_END = 16.6
MG.append(("mg-hook", "compositions/mg-hook.html", 0.0, HOOK_END))
vo("vo01", 0.6)
TITLE = HOOK_END - 0.1
MG.append(("mg-title", "compositions/mg-title.html", TITLE, TITLE + 6.0))
vo("vo02", TITLE + 0.35)

# --- Landing: who it is for -----------------------------------------------------------------------------
sc = Scene("ft-landing", TITLE + 5.8, "Naqsha · live on Cloud Run")
s1 = sc.seg("a", 0.4, 2.9, 1.0, badge=None)
s2 = sc.seg("a", 41.4, 44.2, 1.0, badge=None)
vo("vo03", sc.start + 0.15)
sc.cam(sc.start, 1.8, 800, 330)
sc.cam(sc.start + 0.02, 1.86, 785, 330, d=s1["dur"] - 0.05, ease="none")
sc.cam(s2["t"], 1.5, 960, 513)
sc.cam(s2["t"] + 0.02, 1.58, 960, 513, d=s2["dur"] - 0.05, ease="none")
sc.callout(s1["t"] + 0.25, s1["t"] + s1["dur"] - 0.05, "For families planning a home",
           "a home they can walk through and share before they build", anchor="bl", width=1040)
sc.callout(s2["t"] + 0.2, s2["t"] + s2["dur"] - 0.05, "For architects and builders",
           "a checked, walkable design for the first client meeting", anchor="bl")
S.append(sc)
t = card(sc.start + sc.dur - 0.3, "01", "Describe the home once", "Google ADK setup agent · Gemini 3.8 Flash")

# --- 01 Setup agent ---------------------------------------------------------------------------------
sc = Scene("ft-setup", t - 0.2, "01 · Setup agent")
T0 = sc.start
s1 = sc.seg("b", 4.0, 18.4, 5.0)
s2 = sc.seg("b", 18.4, 23.4, 1.0, badge="real time")
s3 = sc.seg("b", 33.8, 39.5, 2.5)
s4 = sc.seg("b", 39.5, 49.6, 1.9)
s5 = sc.seg("b", 49.8, 57.4, 4.0)
vo("vo04", T0 + 0.3)
sc.cam(T0, 1.9, 711, 280)
sc.cam(s2["t"], 1.9, 711, 280)
sc.cam(s2["t"] + 0.15, 1.0, 960, 540, d=0.7)
sc.cam(sc.at_src(s2, 21.6), 1.85, 430, 420, d=0.9)
sc.cam(s3["t"], 1.75, 330, 560)
sc.cam(s4["t"] + 0.6, 1.85, 1500, 330, d=0.8)
sc.cam(sc.at_src(s4, 44.6), 1.3, 1180, 560, d=0.9)
sc.cam(s5["t"], 1.7, 960, 300)
sc.clock(s2["t"], s2["t"] + s2["dur"], [(s2["t"], 0.0), (sc.at_src(s2, 22.0), 3.6)], fmt="sec", label="reply")
sc.lower(at("vo04", 9) - 0.2, s2["t"] + s2["dur"] - 0.2, "Google ADK setup agent · Gemini 3.8 Flash",
         "reads one message, then calls update_brief, the envelope tool and present_understanding", tag="Agent at work")
sc.ring(s3["t"] + 0.1, s3["t"] + s3["dur"] - 0.05, 14, 495, 420, 225)
sc.callout(s3["t"] + 0.2, s3["t"] + s3["dur"] - 0.05, "Guaranteed: the rules Argon must pass",
           "bylaws and livability, set by the setup agent", anchor="br", tag="Prototype rules: LDA, Lahore")
sc.ring(s4["t"] + 0.7, sc.at_src(s4, 44.5), 1300, 245, 420, 185)
sc.ring(sc.at_src(s4, 44.9), s5["t"], 870, 170, 245, 415)
sc.ring(sc.at_src(s4, 44.9), s5["t"], 1300, 735, 410, 215)
sc.callout(s4["t"] + 0.75, sc.at_src(s4, 44.5), "Blue plastic tank · roof kept clear for solar", anchor="bl")
sc.callout(sc.at_src(s4, 44.9), s5["t"], "Buildable area worked out: 30′ × 48′",
           "up to 70% coverage, from the authority’s bylaws", anchor="bl", tag="Prototype rules: LDA, Lahore")
sc.callout(s5["t"] + 0.2, sc.cursor - 0.1, "Rooms on each floor, editable", anchor="bl")
S.append(sc)
t = card(sc.start + sc.dur - 0.3, "02", "Four concepts, day and night", "Gemini 3.1 Flash Image")

# --- 02 Concepts ----------------------------------------------------------------------------------------
sc = Scene("ft-concepts", t - 0.2, "02 · Concepts")
T0 = sc.start
lane = [(0, 1.0), (0.6, 1.0), (1.4, 6.0), (2.9, 6.0), (3.6, 2.2)]
s1 = sc.seg("c", 3.0, 26.4, lane=lane, badge=None)
sc.badge(s1["t"] + 0.6, s1["t"] + 2.9, "sped up 6×")
sc.badge(s1["t"] + 2.9, s1["t"] + s1["dur"], "sped up 2.2×")
s2 = sc.seg("c", 27.0, 31.0, 2.0)
s3 = sc.seg("c", 39.0, 49.5, 4.5)
s4 = sc.seg("c", 49.5, 55.0, 3.0)
s5 = sc.seg("c", 66.8, 72.7, 1.5)
vo("vo05", T0 + 0.3)
vo("vo06", s5["t"] - 0.2)  # "Pick one" lands on the lightbox
sc.cam(T0, 1.22, 960, 470)
sc.cam(T0 + 0.05, 1.0, 960, 540, d=1.6)
sc.cam(s2["t"], 1.1, 960, 560)
sc.cam(s2["t"] + 0.02, 1.16, 960, 560, d=s2["dur"] - 0.05, ease="none")
sc.cam(s3["t"], 1.0, 960, 540)
sc.cam(s5["t"], 1.06, 960, 560)
sc.cam(s5["t"] + 0.02, 1.16, 960, 560, d=s5["dur"] - 0.1, ease="none")
mp = []
for k in range(0, 41):
    tl_ = s1["dur"] * k / 40
    mp.append((s1["t"] + tl_, max(0.0, 3.0 + ramp_consumed(lane, tl_) - 3.3)))
sc.clock(s1["t"], s2["t"] + s2["dur"], mp + [(s2["t"], 22.6)], fmt="mmss", label="elapsed")
sc.lower(T0 + 0.6, T0 + 4.6, "Gemini 3.1 Flash Image", "four exterior concepts · same camera and light", tag="AI at work")
sc.stat(s2["t"] + 0.05, s2["t"] + s2["dur"] - 0.05, "23 s", "4 concepts, from one click")
sc.callout(s4["t"] + 0.05, s4["t"] + s4["dur"] - 0.05, "The same four, at night · about 8 s", anchor="br")
sc.callout(s5["t"] + 0.3, s5["t"] + s5["dur"], "Pick one · “Plan this one”", anchor="bl")
sc.callout(at("vo06", 3) - 0.15, s5["t"] + s5["dur"], "Gemini 4 Argon", "the architect agent takes over", anchor="tr")
S.append(sc)
t = card(sc.start + sc.dur - 0.3, "03", "An architect agent that checks its own work",
         "Gemini 4 Argon · plan, check, fix, self-review")

# --- How Argon designs (MG) -> 03 design run, rules check, review, print --------------------------------------
argon_end = at("vo06", 57) - 0.1  # "Argon fixes whatever fails" plays on the graphic; cut to the run on "On this run"
MG.append(("mg-argon", "compositions/mg-argon.html", round(t - 0.2, 3), round(argon_end, 3)))
ARGON_START = t - 0.2

sc = Scene("ft-design", argon_end, "03 · Architect agent")
T0 = sc.start
vo06_end = vo_end("vo06")
# d1 proxy phases, timed to the words: fix 15 issues | 5 | review | build | saved
pA = at("vo06", 66) - 0.05 - T0           # "...to 5"
pB = at("vo06", 69) - T0 - pA             # "...then to none"
pC = vo06_end - 0.2 - T0 - pA - pB        # self-review until the line ends
pD, pE = 1.4, 1.2
pA, pB, pC = (round(x * 30) / 30 for x in (pA, pB, pC))  # whole frames, so the proxy concat stays in sync
TL_PLAN["d1_tl.mp4"] = {"src": "d1_design_run_realtime.mp4",
                        "segs": [[54.1, 104.6, round(pA, 3)], [104.6, 157.5, round(pB, 3)], [157.5, 178.1, round(pC, 3)],
                                 [178.1, 277.2, pD], [277.2, 283.4, pE]]}
d1len = pA + pB + pC + pD + pE
s1 = sc.seg("d1tl", 0.0, d1len, 1.0, badge=None)
acc = 0.0
for a_, b_, d_ in TL_PLAN["d1_tl.mp4"]["segs"]:
    sc.badge(T0 + acc, T0 + acc + d_, fmt_rate((b_ - a_) / d_))
    acc += d_
vo("vo07", vo06_end + 0.45)
s2 = sc.seg("d2", 20.3, 28.8, 2.5)
s2r = sc.seg("d2", 38.5, 43.5, 2.0)
s3 = sc.seg("d2", 49.0, 74.5, 6.5)
tA, tB, tC, tD, tE = T0, T0 + pA, T0 + pA + pB, T0 + pA + pB + pC, T0 + pA + pB + pC + pD
sc.cam(T0, 1.25, 1060, 520)
sc.cam(tB, 1.3, 1060, 500, d=0.8)
sc.cam(tC + 0.2, 1.35, 1060, 470, d=1.0)
sc.cam(tD, 1.25, 1060, 520, d=0.6)
sc.cam(tE, 1.0, 960, 540, d=0.6)
sc.cam(s2["t"], 1.5, 1690, 668)
sc.cam(s2["t"] + 0.02, 1.6, 1690, 668, d=s2["dur"] - 0.05, ease="none")  # the panel, below its header line
sc.cam(s2r["t"], 1.3, 1290, 700)
sc.cam(s2r["t"] + 0.02, 1.36, 1290, 700, d=s2r["dur"] - 0.05, ease="none")
sc.cam(s3["t"], 1.0, 960, 540)
sc.cam(s3["t"] + 1.2, 1.18, 960, 560, d=1.0)
sc.clock(T0, s2["t"], [(tA, 53.4), (tB, 103.9), (tC, 156.8), (tD, 177.4), (tE, 276.5)], fmt="mmss", label="elapsed")
sc.steps(T0 + 0.1, s2["t"] - 0.1, [(T0, {1, 2}, 1), (tC, {3}, 3), (tD, {4}, 4), (tE, set(), 5)])
sc.lower(T0 + 0.3, tC - 0.1, "Gemini 4 Argon · architect agent", "fixes what the rules engine flags, then checks again",
         tag="Agent at work", width=980)
sc.quote(tC + 0.1, tD + 0.3, "Agent at work · self-review", "Argon reads a drawing of its own plan",
         "“Guests in the drawing room or TV lounge & dining have no toilet access without walking through the "
         "parents’ bedroom.”", foot="one of its 4 review notes, from this run’s report", anchor="bl", width=980)
sc.rules(T0 + 0.2, tE, [
    ("Bylaw checks", [(T0 + 0.2, "33/36", "fail"), (tC, "36/36", "pass")]),
    ("Issues to fix", [(T0 + 0.2, "15", "fail"), (tB, "5", "fail"), (tC, "0", "pass")]),
    ("Livable home", [(T0 + 0.2, "checking…", "ink"), (tC, "10/13 · 3 to check", "ink")]),
    ("Self-review", [(T0 + 0.2, "waiting", "ink"), (tC, "reviewing…", "ink"), (tD, "4 notes", "pass")]),
], title="Rules check", tag="Prototype rules: LDA, Lahore", width=620)
sc.stat(tE + 0.05, s2["t"] + 0.6, "4:37", "min · from the click to a checked, dimensioned plan")
sc.callout(s2["t"] + 0.9, s2["t"] + s2["dur"] - 0.05, "Passes all 36 bylaw checks",
           "setbacks 11/11 · room sizes 9/9 · daylight 9/9 · ventilation 4/4 · stairs 2/2 · access 1/1",
           anchor="bl", tag="Prototype rules: LDA, Lahore", width=1000)
sc.callout(s2r["t"] + 0.15, s2r["t"] + s2r["dur"] - 0.05, "Argon’s own review: 4 architect’s notes",
           "plus 3 livability points left for a person to check", anchor="bl")
sc.callout(s3["t"] + 0.3, sc.cursor - 0.05, "Ready to print · 6 sheets at 1:100",
           "plans, room schedule and compliance report, for the contractor and the authority file", anchor="bl", width=1180)
S.append(sc)
t = card(sc.start + sc.dur - 0.3, "04", "The house, inside and out", "Gemini 4 Argon writes it as code")
CARD4 = t - CARD_DUR

# --- 3D written as code (MG) -> 04 the house, inside and out -----------------------------------------------
CODE_DUR = 5.35
MG.append(("mg-code", "compositions/mg-code.html", round(t - 0.2, 3), round(t - 0.2 + CODE_DUR, 3)))
vo("vo08", t + 0.1, part=0)
sc = Scene("ft-house", t - 0.2 + CODE_DUR - 0.2, "04 · Inside and out")
T0 = sc.start
s1 = sc.seg("d3", 3.2, 12.6, 2.0)
s2 = sc.seg("e", 11.0, 37.6, 9.0, mask=SAMPLE)
s3 = sc.seg("e", 52.7, 66.5, 3.0, mask=SAMPLE)
s4 = sc.seg("e", 81.5, 85.6, 1.6, mask=SAMPLE)
s4b = sc.seg("e", 92.25, 92.9, 0.3, mask=SAMPLE)
s5 = sc.seg("e", 100.6, 111.0, 2.4)
s6 = sc.seg("e", 115.0, 119.4, 2.7)
vo("vo08", s2["t"] + s2["dur"] - 1.0, part=1)    # "Orbit the outside" on the orbit, "night" lands on night
vo("vo08", s4["t"] + 0.2, part=2)                # "Cut away a floor to see every room furnished at its real size."
vo("vo08", s5["t"] - 0.25, part=3)               # "Any view can become a photoreal render…"
sc.cam(T0, 1.12, 960, 560)
sc.cam(T0 + 0.02, 1.24, 960, 560, d=s1["dur"] - 0.05, ease="none")
sc.cam(s2["t"], 1.0, 960, 540)
sc.cam(s2["t"] + 0.02, 1.08, 960, 540, d=s2["dur"] - 0.05, ease="none")
sc.cam(s3["t"], 1.22, 940, 500)
sc.cam(s3["t"] + 0.02, 1.36, 940, 470, d=s3["dur"] - 0.05, ease="none")
sc.cam(s4["t"], 1.72, 1035, 480)
sc.cam(s4["t"] + 0.02, 1.8, 1035, 480, d=s4["dur"] + s4b["dur"] - 0.05, ease="none")
sc.cam(s5["t"], 1.0, 960, 540)
sc.cam(s5["t"] + 0.6, 1.14, 960, 560, d=1.2)
sc.cam(s6["t"], 1.14, 960, 560)
sc.clock(s5["t"], s6["t"] + 1.2, [(sc.at_src(s5, 100.9), 0.0), (sc.at_src(s5, 110.4), 9.5)], fmt="sec", label="render")
sc.lower(T0 + 0.2, T0 + s1["dur"] - 0.1, "Written as code by Gemini 4 Argon",
         "28 sections · structure, facade, furniture in every room · assembled live", tag="Agent at work")
sc.callout(s2["t"] + 0.2, s2["t"] + s2["dur"] - 0.05, "Orbit the outside", "neighbours ghost out of the way", anchor="bl")
sc.callout(s3["t"] + 0.1, s3["t"] + s3["dur"] - 0.05, "Night: every room lit from inside",
           "plus the garden and street lights", anchor="bl")
sc.callout(s4["t"] + 0.15, s4["t"] + s4["dur"] - 0.05, "Ground floor, cut away",
           "drawing room, TV lounge and dining, both kitchens, parents’ bedroom", anchor="bl")
sc.callout(s4b["t"] + 0.05, s4b["t"] + s4b["dur"] - 0.05, "First floor, cut away",
           "three bedrooms and the family lounge, furnished", anchor="bl")
sc.lower(s5["t"] + 0.3, s5["t"] + s5["dur"] - 0.3, "Render this view · Gemini 3.1 Flash Image",
         "a photoreal render of this exact view", tag="AI at work")
sc.stat(sc.at_src(s5, 110.4) + 0.1, s6["t"] + s6["dur"] - 0.1, "9.5 s", "AI render of the exact view")
S.append(sc)
t = card(sc.start + sc.dur - 0.3, "05", "Walk through every room", "the furnished rooms, up to the roof")

# --- 05 Walk -------------------------------------------------------------------------------------------
sc = Scene("ft-walk", t - 0.2, "05 · Walk through · sample home")
T0 = sc.start
w1 = sc.seg("f", 4.8, 9.4, 2.2, mask=SAMPLE)
w2 = sc.seg("f", 24.0, 29.0, 2.5, mask=SAMPLE)
w2b = sc.seg("f", 37.0, 46.0, 3.6, mask=SAMPLE)
w3 = sc.seg("f", 48.6, 55.4, 3.4, mask=SAMPLE)
w4 = sc.seg("f", 55.4, 59.8, 2.2, mask=SAMPLE)
w4b = sc.seg("g1", 4.4, 9.3, 1.9, mask=SAMPLE)
w5 = sc.seg("f", 87.6, 89.83, 2.4, mask=SAMPLE)
w5s = sc.seg("f", 89.83, 90.23, 0.4, badge="slow motion 0.4×", mask=SAMPLE)   # the climb passes the glass guard
w5b = sc.seg("f", 90.23, 92.2, 2.4, mask=SAMPLE)
w6 = sc.seg("f", 92.2, 97.0, 2.4, mask=SAMPLE)
vo("vo09", T0 + 0.3, part=0)                 # "You can also walk through it in first person."
vo("vo09", max(w2["t"] + 0.35, vo_end("vo09a") + 0.25), part=1)           # "The lounge and dining room are already furnished."
vo("vo09", w3["t"] + 0.1, part=2)            # "The room list takes you straight to the bedrooms upstairs."
vo("vo09", w5["t"] - 0.3, part=3)            # "Then take the stairs, past the glass guard, out onto the roof."
for s in (w1, w2, w2b, w3, w4, w4b, w5, w5b, w6):
    sc.cam(s["t"], 1.0, 960, 540)
    sc.cam(s["t"] + 0.02, 1.06, 960, 540, d=s["dur"] - 0.05, ease="none")
sc.cam(w5s["t"], 1.06, 960, 540)
sc.cam(w5s["t"] + 0.02, 1.12, 960, 560, d=w5s["dur"] - 0.05, ease="none")
sc.callout(T0 + 0.2, w2["t"] + 1.2, "First-person walk", "at eye height, room by room", anchor="tl", x=380, y=36)
sc.callout(w2["t"] + 1.3, w2b["t"] + w2b["dur"] - 0.05, "TV lounge and dining, furnished", anchor="bl")
sc.callout(w3["t"] + 0.2, w3["t"] + w3["dur"] - 0.05, "Room list: “master bed”", anchor="bl")
sc.callout(w4["t"] + 0.1, w4["t"] + w4["dur"] - 0.05, "Master bedroom", "balcony doors, wood panelling", anchor="bl")
sc.callout(w4b["t"] + 0.1, w4b["t"] + w4b["dur"] - 0.05, "Bedroom 3, furnished", "bed, side table, desk and chair", anchor="bl")
sc.callout(w5["t"] + 0.1, w5["t"] + w5["dur"] - 0.05, "Room list: “roof”", "up the stairs", anchor="bl")
sc.callout(w5s["t"] + 0.02, w5s["t"] + w5s["dur"] - 0.02, "Glass guard on the stair, family lounge upstairs",
           "a railing at every drop is one of the livability checks", anchor="bl")
sc.callout(w5b["t"] + 0.05, w5b["t"] + w5b["dur"] - 0.05, "Out the roof door", anchor="bl")
sc.callout(w6["t"] + 0.1, w6["t"] + w6["dur"] - 0.1, "On the roof: stair tower and parapets", anchor="bl")
S.append(sc)
t = card(sc.start + sc.dur - 0.3, "06", "Comments become revisions", "Google ADK revision agent · Gemini 4 Argon · 9 tools")

# --- 06 Comments, client link, ADK revision --------------------------------------------------------------
sc = Scene("ft-collab", t - 0.2, "06 · Comments, revisions")
T0 = sc.start
H_TL = 7.0
TL_PLAN["h_tl.mp4"] = {"src": "h_revise_from_comments.mp4", "segs": [[15.0, 333.5, H_TL]]}
g1a = sc.seg("g1", 12.6, 18.4, 2.2, mask=SAMPLE)
g1b = sc.seg("g1", 52.0, 58.5, 2.5, mask=SAMPLE)
g2 = sc.seg("g2", 29.4, 37.0, 2.0)
g3a = sc.seg("g3", 1.5, 9.0, 2.5, mask=SAMPLE)
g3b = sc.seg("g3", 12.5, 14.5, 2.0, mask=SAMPLE)
h1 = sc.seg("h", 4.6, 15.0, 3.4, mask=SAMPLE)
h2 = sc.seg("htl", 0.0, H_TL, 1.0, badge=f"sped up {round((333.5 - 15.0) / H_TL)}×", mask=SAMPLE)
h3 = sc.seg("h", 364.4, 380.0, 5.6, mask=SAMPLE)
h4 = sc.seg("h", 401.6, 409.4, 1.5, mask=SAMPLE)
h5 = sc.seg("h", 409.4, 416.3, 3.8, mask=SAMPLE)
vo("vo10", T0 + 0.2)
vo("vo11", max(h1["t"] + 0.15, vo_end("vo10") + 0.7))
sc.cam(g1a["t"], 1.55, 962, 540)
sc.cam(g1b["t"], 1.75, 960, 330)
sc.cam(g2["t"], 1.55, 960, 740)
sc.cam(g3a["t"], 1.0, 960, 540)
sc.cam(g3a["t"] + 0.75, 1.7, 1700, 380, d=0.8)
sc.cam(h1["t"], 1.45, 1700, 560)
sc.cam(h2["t"], 1.12, 820, 560)
sc.cam(h3["t"], 1.62, 1560, 520)
sc.cam(h4["t"], 1.0, 960, 540)
sc.cam(h4["t"] + 0.35, 2.0, 850, 600, d=0.9)
sc.cam(h5["t"], 2.0, 850, 600)
sc.cam(h5["t"] + 0.1, 1.9, 850, 830, d=0.6)
sc.clock(h2["t"], h2["t"] + h2["dur"], [(h2["t"], 0.4), (h2["t"] + h2["dur"], 318.9)], fmt="mmss", label="elapsed")
sc.callout(g1a["t"] + 0.3, g1a["t"] + g1a["dur"], "Note pinned to “Window glass, Bedroom 3”", anchor="bl")
sc.callout(g1b["t"] + 0.1, g1b["t"] + g1b["dur"], "Client link", "anyone with it can view and comment", anchor="bl")
sc.lower(g2["t"] + 0.1, g2["t"] + g2["dur"] - 0.1, "Client view · second browser", "asks her name once, then she comments", ai=False)
sc.callout(g3a["t"] + 0.8, g3b["t"] + g3b["dur"] - 0.1, "Arrives for the owner, live", "Ammi · Client: “Can the kitchen be bigger?”", anchor="bl")
sc.callout(h1["t"] + 0.2, h1["t"] + h1["dur"] - 0.1, "Revise with all 3 notes", "the owner’s two and the client’s one", anchor="bl")
sc.lower(h2["t"] + 0.15, h2["t"] + h2["dur"] - 0.1, "Google ADK revision agent · Gemini 4 Argon · 9 tools",
         "tests each edit with check_plan_ops before it applies it", tag="Agent at work")
step = H_TL / 6
sc.log(h2["t"] + 0.2, h2["t"] + h2["dur"], "Revision agent · tool calls", [
    (h2["t"] + 0.2, "Reading your 3 notes…", ""),
    (h2["t"] + step * 1, "Looking at Bedroom 3, Rear Terrace, Car Porch…", "get_rooms"),
    (h2["t"] + step * 2, "Checking the change against the rules…", "check_plan_ops"),
    (h2["t"] + step * 3.2, "All 47 checks pass", "apply_plan_ops"),
    (h2["t"] + step * 4.2, "Updating the furniture…", "write_section"),
    (h2["t"] + step * 5.3, "Version 4 saved", "finish"),
], anchor="tr", width=700)
sc.callout(h3["t"] + 0.2, h3["t"] + h3["dur"] - 0.1, "Before / after",
           "window 6′ → 9′ · kitchen 7′6″ → 9′ · plan and 3D updated by the agent", anchor="bl")
sc.callout(h4["t"] + 0.5, h4["t"] + h4["dur"] - 0.1, "Refused, with a reason",
           "the porch stays behind the 10′ front setback; it offers to extend it inward instead",
           anchor="bl", tone="fail", width=1180)
sc.callout(h5["t"] + 0.3, h5["t"] + h5["dur"] - 0.05, "Ammi’s kitchen · Done", "9′ × 15′3″", anchor="bl", tone="pass")
S.append(sc)
t = sc.start + sc.dur

# --- 07 Typed change (the same ADK agent) -------------------------------------------------------------------
sc = Scene("ft-ask", t, "07 · Typed changes")
T0 = sc.start
i1 = sc.seg("i", 3.8, 8.2, 1.5, mask=SAMPLE)
i2 = sc.seg("i", 206.2, 217.0, 3.0, badge="time cut · sped up 3×", mask=SAMPLE)
i3 = sc.seg("i", 217.0, 226.4, 2.0, mask=SAMPLE)
vo("vo12", T0 + 0.15)
sc.cam(i1["t"], 1.8, 850, 960)
sc.cam(i2["t"], 1.0, 960, 540)
sc.cam(i2["t"] + 1.2, 1.9, 840, 330, d=0.8)
sc.callout(i1["t"] + 0.1, i1["t"] + i1["dur"] - 0.05, "Typed change · same ADK revision agent", "“Make the kitchen bigger”",
           anchor="tl")
sc.callout(i2["t"] + 0.1, i2["t"] + 1.15, "Agent run cut · it took about 10 min", anchor="bl")
sc.callout(at("vo12", 14) - 0.1, sc.cursor - 0.1, "It explains the trade-off",
           "1′ from the parents’ bedroom; the other rooms were already at their minimum widths", anchor="bl", width=1180)
sc.stat(at("vo12", 24) - 0.1, sc.cursor - 0.1, "37/37", "bylaw checks · 10/10 livable · Version 5", x=1130, y=230)
S.append(sc)
COLLAB_END = sc.start + sc.dur

# --- Architecture (MG) ------------------------------------------------------------------------------------
ARCH_START = COLLAB_END - 0.3
vo("vo13", ARCH_START + 0.55)
ARCH_END = ARCH_START + 0.55 + VD["vo13"] + 1.1
MG.append(("mg-arch", "compositions/mg-arch.html", round(ARCH_START, 3), round(ARCH_END, 3)))

# --- Outro: who it helps, bylaws as data -------------------------------------------------------------------
sc = Scene("ft-outro", ARCH_END - 0.25, "Who it helps")
T0 = sc.start
V5 = ("Sample home · Version 5", 334)
o1 = sc.seg("y", 4.5, 10.5, 2.0, mask=V5)
o2 = sc.seg("y", 22.5, 29.1, 2.2, mask=V5)
o3 = sc.seg("x", 50.8, 63.6, 3.2, mask=("Sample villa · 1 kanal", 270))
vo("vo14", T0 + 0.25, part=0)
vo("vo14", vo_end("vo14a") + 1.3, part=1)
END_START = at("vo14", 55) - 0.35  # "Naqsha is live today." -> end card
o4 = sc.seg("x", 16.7, 16.7 + 4.0 * max(0.5, END_START + 0.25 - sc.cursor), 4.0, mask=("Sample villa · 1 kanal", 270))
for s in (o1, o2, o3, o4):
    sc.cam(s["t"], 1.0, 960, 540)
    sc.cam(s["t"] + 0.02, 1.05, 960, 540, d=s["dur"] - 0.05, ease="none")
sc.callout(at("vo14", 0) - 0.1, at("vo14", 9, edge="end") + 0.2, "For families",
           "walk through the home before it is built", anchor="bl")
sc.callout(at("vo14", 10) - 0.05, at("vo14", 19, edge="end") + 0.1, "For architects",
           "a checked, walkable design in the first client meeting", anchor="bl")
sc.callout(at("vo14", 20), at("vo14", 29, edge="end") + 0.25, "For builders",
           "a 1:100 drawing set that passes the local bylaw checks", anchor="bl")
sc.log(at("vo14", 30) - 0.1, sc.cursor, "Bylaws as data", [
    (at("vo14", 33), "LDA, Lahore · the prototype’s rules"),
    (at("vo14", 47), "More development authorities in Pakistan · next"),
    (at("vo14", 52), "Other countries · after that"),
], anchor="tr", width=820, dim=False)
S.append(sc)

TOTAL = round(max(c[2] + c[4] for c in VOC) + 3.0, 2)
MG.append(("mg-end", "compositions/mg-end.html", round(END_START, 3), TOTAL))

# Sound design (global start, file, volume)
SFX = [
    (at("vo01", 31) - 0.15, "impact-bass-1.mp3", 0.55),   # REJECTED stamp on "returned"
    (HOOK_END - 0.25 - 10.0, "riser.mp3", 0.22),          # builds to the title hit
    (HOOK_END - 0.3, "impact-bass-2.mp3", 0.5),           # title
    (TITLE + 5.75, "whoosh-short.mp3", 0.35),              # title -> landing
] + [(c[0] - (0.35 if c[1] == "04" else 0.05), "whoosh.mp3", 0.2 if c[1] == "04" else 0.32) for c in CARDS] + [
    (ARGON_START - 0.1, "whoosh-short.mp3", 0.25),
    (tB, "click-soft.mp3", 0.25), (tC, "click-soft.mp3", 0.25), (tE, "chime.mp3", 0.2),   # rules check ticks, saved
    (h2["t"] + step * 5.3, "chime.mp3", 0.18),                                             # Version 4 saved
    (ARCH_START - 0.05, "whoosh.mp3", 0.32), (ARCH_END - 0.3, "whoosh-short.mp3", 0.3), (END_START - 0.05, "whoosh.mp3", 0.32),
]
for sc_ in S:
    for o in sc_.over:
        if o["kind"] == "stat":
            SFX.append((o["a"], "pop.mp3", 0.32))
        if o["kind"] == "callout" and o["tone"] == "fail":
            SFX.append((o["a"], "click-soft.mp3", 0.4))
        if o["kind"] == "callout" and o["tone"] == "pass":
            SFX.append((o["a"], "chime.mp3", 0.22))


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


def render_scene(sc: Scene) -> str:
    sid, T0 = sc.id, sc.start
    L = lambda t: round(t - T0, 3)  # noqa: E731
    vids, rings, overs, js = [], [], [], []
    for n, s in enumerate(sc.segs):
        attrs = [f'id="{sid}-v{n}"', f'src="assets/footage/{CLIP[s["clip"]]}"', f'data-start="{L(s["t"])}"',
                 f'data-duration="{round(s["dur"], 3)}"', f'data-media-start="{s["a"]}"',
                 f'data-track-index="{n % 2}"', 'data-hf-media-start-basis="local"', "muted", "playsinline"]
        if s["lane"]:
            lane = {"version": 1, "lanes": [{"target": "rate", "points": [{"t": t, "v": v} for t, v in s["lane"]]}]}
            attrs.append(f"data-automation='{json.dumps(lane)}'")
        elif s["rate"] and abs(s["rate"] - 1) > 1e-6:
            attrs.append(f'data-playback-rate="{round(s["rate"], 5)}"')
        vids.append(f'<video {" ".join(attrs)} class="vid"></video>')

    # camera poses
    js.append(f'const cam = document.getElementById("{sid}-cam");')
    first = True
    for (t, z, fx, fy, d, ease) in sorted(sc.poses, key=lambda p: p[0]):
        tx, ty, s = pose(z, fx, fy)
        if first:
            js.append(f'tl.set(cam, {{x:{tx}, y:{ty}, scale:{s}, transformOrigin:"0 0"}}, 0);')
            first = False
        if d <= 0:
            js.append(f'tl.set(cam, {{x:{tx}, y:{ty}, scale:{s}}}, {L(t)});')
        else:
            js.append(f'tl.to(cam, {{x:{tx}, y:{ty}, scale:{s}, duration:{d}, ease:"{ease}"}}, {L(t)});')

    # badges (merge consecutive identical labels)
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
        js.append(f'tl.fromTo("#{sid}-b{n}", {{opacity:0, y:10}}, {{opacity:1, y:0, duration:0.22, ease:"power3.out"}}, {L(a)});')
        js.append(f'tl.to("#{sid}-b{n}", {{opacity:0, y:-8, duration:0.16, ease:"power2.in"}}, {max(L(a) + 0.25, L(b) - 0.16)});')

    # clocks
    clock_html = []
    for n, c in enumerate(sc.clocks):
        cid = f"{sid}-c{n}"
        clock_html.append(f'<div class="clock" id="{cid}">{ICON_CLOCK}<span class="cv" id="{cid}-v">0:00</span>'
                          f'<span class="cl">{esc(c["label"])}</span></div>')
        mp = [[round(L(t), 4), round(v, 3)] for t, v in c["map"]]
        js.append(f'''(function(){{ const el=document.getElementById("{cid}-v"); const mp={json.dumps(mp)}; const fmt="{c["fmt"]}";
  const f=(x)=>{{ let v; if(x<=mp[0][0]) v=mp[0][1]; else if(x>=mp[mp.length-1][0]) v=mp[mp.length-1][1]; else {{ for(let i=0;i<mp.length-1;i++){{ if(x>=mp[i][0]&&x<=mp[i+1][0]){{ const u=(x-mp[i][0])/(mp[i+1][0]-mp[i][0]); v=mp[i][1]+u*(mp[i+1][1]-mp[i][1]); break; }} }} }}
    if(fmt==="sec") return v.toFixed(1)+" s"; const s=Math.round(v); return Math.floor(s/60)+":"+String(s%60).padStart(2,"0"); }};
  const p={{t:0}}; tl.fromTo(p,{{t:0}},{{t:{sc.dur}, duration:{sc.dur}, ease:"none", onUpdate:()=>{{ el.textContent=f(p.t); }}}},0); }})();''')
        js.append(f'tl.fromTo("#{cid}", {{opacity:0, x:-12}}, {{opacity:1, x:0, duration:0.25, ease:"power3.out"}}, {L(c["a"])});')
        js.append(f'tl.to("#{cid}", {{opacity:0, duration:0.2}}, {L(c["b"]) - 0.2});')

    # overlays
    for n, o in enumerate(sc.over):
        oid = f"{sid}-o{n}"
        a, b = L(o["a"]), L(o["b"])
        if o["kind"] == "mask":
            rings.append(f'<div class="mask" id="{oid}" data-layout-allow-occlusion style="left:{o["x"]}px;top:{o["y"]}px;width:{o["w"]}px;height:{o["h"]}px;">'
                         f'<span class="mk-dot"></span>{esc(o["text"])}</div>')
            js.append(f'tl.set("#{oid}", {{opacity:1}}, {a});')
            js.append(f'tl.set("#{oid}", {{opacity:0}}, {b});')
        elif o["kind"] == "ring":
            col = {"accent": "#2747F5", "fail": "#C8281E", "pass": "#0E7A55"}[o["tone"]]
            rings.append(f'<div class="ring" id="{oid}" style="left:{o["x"]}px;top:{o["y"]}px;width:{o["w"]}px;'
                         f'height:{o["h"]}px;border-color:{col};"></div>')
            js.append(f'tl.fromTo("#{oid}", {{opacity:0, scale:1.08}}, {{opacity:1, scale:1, duration:0.35, ease:"power3.out"}}, {a});')
            js.append(f'tl.to("#{oid}", {{opacity:0, duration:0.2}}, {b - 0.2});')
        elif o["kind"] == "lower":
            tag = '<span class="ai-tag">' + ICON_SPARK + esc(o["tag"]) + '</span>' if o["ai"] else ""
            lpos = anchor_css(o.get("anchor", "bl")) + (f'max-width:{o["width"]}px;' if o.get("width") else "")
            overs.append(f'<div class="lower{" ai" if o["ai"] else ""}" id="{oid}" style="{lpos}"><div class="lt-in">{tag}'
                         f'<div class="lt-title">{esc(o["title"])}</div>'
                         + (f'<div class="lt-sub">{esc(o["sub"])}</div>' if o["sub"] else "") + "</div></div>")
            js.append(f'tl.fromTo("#{oid}", {{clipPath:"inset(0 100% 0 0 round 22px)", x:-24}}, {{clipPath:"inset(0 0% 0 0 round 22px)", x:0, duration:0.55, ease:"power3.out"}}, {a});')
            js.append(f'tl.fromTo("#{oid} .lt-in > *", {{opacity:0, y:14}}, {{opacity:1, y:0, duration:0.4, stagger:0.08, ease:"power2.out"}}, {a + 0.15});')
            js.append(f'tl.to("#{oid}", {{clipPath:"inset(0 0% 100% 0 round 22px)", duration:0.35, ease:"power2.in"}}, {b - 0.35});')
        elif o["kind"] == "callout":
            tone = o["tone"]
            dot = {"ink": "#2747F5", "fail": "#C8281E", "pass": "#0E7A55"}[tone]
            cw = f'max-width:{o["width"]}px;' if o.get("width") else ""
            ctag = f'<div class="c-tag">{esc(o["tag"])}</div>' if o.get("tag") else ""
            overs.append(f'<div class="callout t-{tone}" id="{oid}" style="{anchor_css(o["anchor"], o["x"], o["y"])}{cw}">'
                         f'<span class="cdot" style="background:{dot}"></span><div>{ctag}<div class="c-text">{esc(o["text"])}</div>'
                         + (f'<div class="c-sub">{esc(o["sub"])}</div>' if o["sub"] else "") + "</div></div>")
            js.append(f'tl.fromTo("#{oid}", {{opacity:0, y:22, scale:0.96}}, {{opacity:1, y:0, scale:1, duration:0.42, ease:"back.out(1.6)"}}, {a});')
            js.append(f'tl.to("#{oid}", {{opacity:0, y:12, duration:0.22, ease:"power2.in"}}, {max(a + 0.45, b - 0.22)});')
        elif o["kind"] == "stat":
            overs.append(f'<div class="stat" id="{oid}" style="{anchor_css(o["anchor"], o.get("x"), o.get("y"))}"><div class="s-big">{esc(o["big"])}</div>'
                         f'<div class="s-label">{esc(o["label"])}</div></div>')
            js.append(f'tl.fromTo("#{oid}", {{opacity:0, scale:0.8, y:30}}, {{opacity:1, scale:1, y:0, duration:0.55, ease:"back.out(1.8)"}}, {a});')
            js.append(f'tl.fromTo("#{oid} .s-label", {{opacity:0, x:-16}}, {{opacity:1, x:0, duration:0.4, ease:"power2.out"}}, {a + 0.25});')
            js.append(f'tl.to("#{oid}", {{opacity:0, scale:0.96, duration:0.25, ease:"power2.in"}}, {b - 0.25});')
        elif o["kind"] == "log":
            lines = "".join(f'<div class="lg-line" id="{oid}-l{k}"><span class="lg-dot"></span><div>{esc(ln[1])}'
                            + (f'<div class="lg-tool">{esc(ln[2])}</div>' if len(ln) > 2 and ln[2] else "") + '</div></div>'
                            for k, ln in enumerate(o["lines"]))
            overs.append(f'<div class="log" id="{oid}" style="{anchor_css(o["anchor"])}width:{o["width"]}px;"><div class="lg-title">{ICON_SPARK}'
                         f'{esc(o["title"])}</div>{lines}</div>')
            js.append(f'tl.fromTo("#{oid}", {{opacity:0, x:30}}, {{opacity:1, x:0, duration:0.45, ease:"power3.out"}}, {a});')
            for k, ln in enumerate(o["lines"]):
                t = ln[0]
                js.append(f'tl.fromTo("#{oid}-l{k}", {{opacity:0, x:18}}, {{opacity:1, x:0, duration:0.3, ease:"power2.out"}}, {L(t)});')
                if k > 0 and o["dim"]:
                    js.append(f'tl.to("#{oid}-l{k-1}", {{opacity:0.45, duration:0.25}}, {L(t)});')
                    js.append(f'tl.set("#{oid}-l{k-1} .lg-dot", {{backgroundColor:"#0E7A55"}}, {L(t)});')
            js.append(f'tl.to("#{oid}", {{opacity:0, x:20, duration:0.25, ease:"power2.in"}}, {b - 0.25});')
        elif o["kind"] == "rules":
            col = {"ink": "#111113", "fail": "#C8281E", "pass": "#0E7A55"}
            rows_html = []
            for r, (label, vals) in enumerate(o["rows"]):
                spans = "".join(f'<span class="ru-v" id="{oid}-r{r}v{k}" style="color:{col[tone]}">{esc(v)}</span>'
                                for k, (_, v, tone) in enumerate(vals))
                rows_html.append(f'<div class="ru-row"><span class="ru-k">{esc(label)}</span><span class="ru-vs" data-layout-allow-overlap>{spans}</span></div>')
                for k, (tv, _, _) in enumerate(vals):
                    ta = max(a, L(tv))
                    js.append(f'tl.fromTo("#{oid}-r{r}v{k}", {{opacity:0, y:10}}, {{opacity:1, y:0, duration:0.25, ease:"power2.out"}}, {ta});')
                    if k + 1 < len(vals):
                        js.append(f'tl.to("#{oid}-r{r}v{k}", {{opacity:0, y:-10, duration:0.18, ease:"power2.in"}}, {max(ta + 0.26, L(vals[k + 1][0]) - 0.05)});')
            tag = f'<div class="ru-tag">{esc(o["tag"])}</div>' if o["tag"] else ""
            overs.append(f'<div class="rules" id="{oid}" style="{anchor_css(o["anchor"])}width:{o["width"]}px;"><div class="ru-head">{ICON_SPARK}'
                         f'<span>{esc(o["title"])}</span></div>{tag}{"".join(rows_html)}</div>')
            js.append(f'tl.fromTo("#{oid}", {{opacity:0, x:30}}, {{opacity:1, x:0, duration:0.45, ease:"power3.out"}}, {a});')
            js.append(f'tl.to("#{oid}", {{opacity:0, x:20, duration:0.25, ease:"power2.in"}}, {b - 0.25});')
        elif o["kind"] == "steps":
            pills = "".join(f'<div class="sp" id="{oid}-p{k}"><span class="sp-n">{k + 1}</span>{esc(lab)}</div>'
                            for k, lab in enumerate(o["labels"]))
            overs.append(f'<div class="steps" id="{oid}">{pills}</div>')
            js.append(f'tl.fromTo("#{oid}", {{opacity:0, y:-12}}, {{opacity:1, y:0, duration:0.35, ease:"power3.out"}}, {a});')
            for (tm, active, done) in o["marks"]:
                for k in range(len(o["labels"])):
                    st_ = ("on" if k in active else "done" if k < done else "todo")
                    css = {"on": 'backgroundColor:"#2747F5", color:"#FFFFFF", borderColor:"#2747F5"',
                           "done": 'backgroundColor:"#E3F3EC", color:"#0B6446", borderColor:"#BFE3D2"',
                           "todo": 'backgroundColor:"#FFFFFF", color:"#6E6E73", borderColor:"#DADAD4"'}[st_]
                    js.append(f'tl.set("#{oid}-p{k}", {{{css}}}, {max(0.0, L(tm))});')
            js.append(f'tl.to("#{oid}", {{opacity:0, duration:0.25}}, {b - 0.25});')
        elif o["kind"] == "quote":
            qpos = anchor_css(o["anchor"], None if o["y"] is None else 36, o["y"]) + f'max-width:{o["width"]}px;'
            overs.append(f'<div class="quote" id="{oid}" style="{qpos}"><div class="q-tag">{ICON_SPARK}{esc(o["tag"])}</div>'
                         f'<div class="q-title">{esc(o["title"])}</div><div class="q-body">{esc(o["body"])}</div>'
                         + (f'<div class="q-foot">{esc(o["foot"])}</div>' if o["foot"] else "") + '</div>')
            js.append(f'tl.fromTo("#{oid}", {{clipPath:"inset(0 100% 0 0 round 22px)", x:-24}}, {{clipPath:"inset(0 0% 0 0 round 22px)", x:0, duration:0.5, ease:"power3.out"}}, {a});')
            js.append(f'tl.fromTo("#{oid} > *", {{opacity:0, y:12}}, {{opacity:1, y:0, duration:0.35, stagger:0.08, ease:"power2.out"}}, {a + 0.12});')
            js.append(f'tl.to("#{oid}", {{clipPath:"inset(0 0% 100% 0 round 22px)", duration:0.35, ease:"power2.in"}}, {b - 0.35});')
        elif o["kind"] == "statement":
            overs.append(f'<div class="statement" id="{oid}"><div class="st-text">{esc(o["text"])}</div></div>')
            js.append(f'tl.fromTo("#{oid}", {{opacity:0, y:30}}, {{opacity:1, y:0, duration:0.6, ease:"power3.out"}}, {a});')

    # entrance: window settles, chip pops
    js.insert(0, f'tl.fromTo("#{sid}-win", {{scale:1.035}}, {{scale:1, duration:0.7, ease:"power3.out"}}, 0);')
    js.insert(1, f'tl.fromTo("#{sid}-chip", {{scale:0.94}}, {{scale:1, duration:0.35, ease:"back.out(1.7)"}}, 0);')
    js.insert(2, f'tl.fromTo("#{sid}-chap", {{opacity:0, x:20}}, {{opacity:1, x:0, duration:0.4, ease:"power3.out"}}, 0.25);')
    js.insert(3, f'tl.fromTo("#{sid}-live", {{opacity:1}}, {{opacity:0.35, duration:0.6, repeat:{max(1, int(sc.dur / 0.6) - 1)}, yoyo:true, ease:"sine.inOut"}}, 0);')

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
#{sid} .bslot {{ position:relative; width:430px; height:60px; }}
#{sid} .badge {{ position:absolute; left:0; top:0; height:60px; display:flex; align-items:center; gap:10px; padding:0 22px 0 16px; border-radius:999px; background:#2747F5; color:#fff; font-size:32px; font-weight:600; white-space:nowrap; opacity:0; }}
#{sid} .badge.rt {{ background:#0E7A55; }}
#{sid} .badge.sl {{ background:#46464B; }}
#{sid} .badge svg, #{sid} .clock svg {{ width:30px; height:30px; flex:none; }}
#{sid} .cslot {{ position:relative; width:370px; height:60px; }}
#{sid} .clock {{ position:absolute; left:0; top:0; height:60px; display:flex; align-items:center; gap:10px; padding:0 22px 0 16px; border-radius:999px; background:#FFFFFF; color:#111113; font-size:32px; font-weight:600; border:2px solid #CFCFC8; white-space:nowrap; opacity:0; }}
#{sid} .clock .cv {{ font-family:"Geist Mono", monospace; font-variant-numeric:tabular-nums; font-weight:600; }}
#{sid} .clock .cl {{ color:#46464B; font-weight:500; }}
#{sid} .chap {{ margin-left:auto; font-family:"Geist Mono", monospace; font-size:32px; font-weight:500; color:#46464B; white-space:nowrap; }}
#{sid} .win {{ position:absolute; left:{WX}px; top:{WY}px; width:{WW}px; height:{WH}px; border-radius:28px; overflow:hidden; background:#F6F6F3; box-shadow:0 0 0 2px rgba(17,17,19,.07), 0 40px 90px -30px rgba(17,17,19,.42); transform-origin:50% 50%; }}
#{sid} .cam {{ position:absolute; left:0; top:0; width:1920px; height:1080px; transform-origin:0 0; will-change:transform; }}
#{sid} .vid {{ position:absolute; left:0; top:0; width:1920px; height:1080px; object-fit:cover; }}
#{sid} .ring {{ position:absolute; border:5px solid #2747F5; border-radius:16px; box-shadow:0 0 0 8px rgba(39,71,245,.16); opacity:0; }}
#{sid} .lower {{ position:absolute; max-width:1180px; padding:26px 34px 28px; border-radius:22px; background:rgba(17,17,19,.86); color:#F5F5F7; box-shadow:0 24px 60px -20px rgba(0,0,0,.55); clip-path:inset(0 100% 0 0 round 22px); }}
#{sid} .lower .ai-tag {{ display:inline-flex; align-items:center; gap:10px; font-family:"Geist Mono", monospace; font-size:32px; font-weight:500; color:#9DB0FF; margin-bottom:8px; }}
#{sid} .lower .ai-tag svg {{ width:30px; height:30px; }}
#{sid} .lower .lt-title {{ font-size:44px; font-weight:650; letter-spacing:-0.02em; line-height:1.12; }}
#{sid} .lower .lt-sub {{ font-size:32px; font-weight:450; color:#C9C9D1; margin-top:8px; line-height:1.25; }}
#{sid} .callout {{ position:absolute; display:flex; align-items:flex-start; gap:18px; max-width:1100px; padding:22px 30px 24px 26px; border-radius:20px; background:#FFFFFF; box-shadow:0 0 0 2px rgba(17,17,19,.08), 0 26px 60px -22px rgba(17,17,19,.45); opacity:0; }}
#{sid} .callout .cdot {{ width:18px; height:18px; border-radius:50%; margin-top:14px; flex:none; box-shadow:0 0 0 6px rgba(39,71,245,.14); }}
#{sid} .callout .c-text {{ font-size:38px; font-weight:620; letter-spacing:-0.015em; line-height:1.18; }}
#{sid} .callout .c-sub {{ font-size:32px; font-weight:450; color:#46464B; margin-top:6px; line-height:1.25; }}
#{sid} .callout.t-fail {{ box-shadow:0 0 0 3px rgba(200,40,30,.55), 0 26px 60px -22px rgba(17,17,19,.45); }}
#{sid} .callout.t-fail .c-text {{ color:#A3241B; }}
#{sid} .callout.t-pass .c-text {{ color:#0B6446; }}
#{sid} .stat {{ position:absolute; padding:26px 40px 30px; border-radius:26px; background:#2747F5; color:#fff; box-shadow:0 30px 70px -24px rgba(39,71,245,.6); opacity:0; transform-origin:100% 100%; }}
#{sid} .stat .s-big {{ font-size:124px; font-weight:700; letter-spacing:-0.05em; line-height:0.95; font-variant-numeric:tabular-nums; }}
#{sid} .stat .s-label {{ font-size:34px; font-weight:500; color:#DCE3FF; margin-top:10px; }}
#{sid} .log {{ position:absolute; width:720px; padding:24px 28px 18px; border-radius:22px; background:rgba(17,17,19,.88); color:#F5F5F7; box-shadow:0 24px 60px -20px rgba(0,0,0,.55); opacity:0; }}
#{sid} .log .lg-title {{ display:flex; align-items:center; gap:10px; font-family:"Geist Mono", monospace; font-size:32px; color:#9DB0FF; margin-bottom:12px; }}
#{sid} .log .lg-title svg {{ width:30px; height:30px; }}
#{sid} .log .lg-line {{ display:flex; align-items:flex-start; gap:14px; font-size:32px; line-height:1.25; padding:6px 0; opacity:0; }}
#{sid} .log .lg-dot {{ width:14px; height:14px; border-radius:50%; background:#7D93FF; margin-top:13px; flex:none; }}
#{sid} .rules {{ position:absolute; padding:24px 28px 14px; border-radius:22px; background:#FFFFFF; color:#111113; box-shadow:0 0 0 2px rgba(17,17,19,.08), 0 26px 60px -22px rgba(17,17,19,.45); opacity:0; }}
#{sid} .rules .ru-head {{ display:flex; align-items:center; gap:10px; font-size:36px; font-weight:650; letter-spacing:-0.015em; }}
#{sid} .rules .ru-head svg {{ width:30px; height:30px; color:#2747F5; }}
#{sid} .rules .ru-tag {{ display:inline-block; margin-top:10px; padding:4px 14px; border-radius:999px; background:#EEF1FE; color:#1F3BD0; font-family:"Geist Mono", monospace; font-size:30px; font-weight:500; }}
#{sid} .rules .ru-row {{ display:flex; align-items:center; justify-content:space-between; gap:20px; padding:12px 0; border-top:2px solid #ECECE8; margin-top:10px; }}
#{sid} .rules .ru-k {{ font-size:32px; font-weight:500; color:#46464B; white-space:nowrap; }}
#{sid} .rules .ru-vs {{ position:relative; display:block; flex:1; height:42px; }}
#{sid} .rules .ru-v {{ position:absolute; right:0; top:0; font-family:"Geist Mono", monospace; font-size:31px; font-weight:600; white-space:nowrap; opacity:0; }}
#{sid} .mask {{ position:absolute; display:flex; align-items:center; gap:12px; padding:0 20px 0 78px; border-radius:999px; background:#FFFFFF; color:#111113; font-size:26px; font-weight:620; letter-spacing:-0.01em; white-space:nowrap; box-shadow:0 0 0 2px rgba(17,17,19,.10), 0 8px 22px -10px rgba(17,17,19,.45); opacity:0; }}
#{sid} .mask .mk-dot {{ width:12px; height:12px; border-radius:50%; background:#2747F5; flex:none; }}
#{sid} .callout .c-tag {{ display:inline-block; margin:2px 0 8px; padding:3px 14px; border-radius:999px; background:#EEF1FE; color:#1F3BD0; font-family:"Geist Mono", monospace; font-size:28px; font-weight:500; }}
#{sid} .log .lg-tool {{ font-family:"Geist Mono", monospace; font-size:28px; color:#9DB0FF; margin-top:2px; }}
#{sid} .steps {{ position:absolute; left:36px; top:36px; display:flex; gap:10px; opacity:0; }}
#{sid} .steps .sp {{ display:flex; align-items:center; gap:10px; height:56px; padding:0 20px 0 12px; border-radius:999px; border:2px solid #DADAD4; background:#FFFFFF; color:#6E6E73; font-size:30px; font-weight:600; white-space:nowrap; box-shadow:0 10px 26px -14px rgba(17,17,19,.45); }}
#{sid} .steps .sp-n {{ display:flex; align-items:center; justify-content:center; width:32px; height:32px; border-radius:50%; background:rgba(17,17,19,.08); font-family:"Geist Mono", monospace; font-size:24px; }}
#{sid} .quote {{ position:absolute; padding:24px 32px 26px; border-radius:22px; background:rgba(17,17,19,.9); color:#F5F5F7; box-shadow:0 24px 60px -20px rgba(0,0,0,.55); clip-path:inset(0 100% 0 0 round 22px); }}
#{sid} .quote .q-tag {{ display:flex; align-items:center; gap:10px; font-family:"Geist Mono", monospace; font-size:30px; color:#9DB0FF; }}
#{sid} .quote .q-tag svg {{ width:28px; height:28px; }}
#{sid} .quote .q-title {{ font-size:40px; font-weight:650; letter-spacing:-0.02em; margin-top:6px; }}
#{sid} .quote .q-body {{ font-size:34px; line-height:1.28; color:#FFFFFF; margin-top:12px; padding-left:20px; border-left:4px solid #7D93FF; }}
#{sid} .quote .q-foot {{ font-size:30px; color:#C9C9D1; margin-top:10px; }}
#{sid} .statement {{ position:absolute; left:0; right:0; bottom:0; padding:60px 64px 56px; background:linear-gradient(180deg, rgba(17,17,19,0) 0%, rgba(17,17,19,.78) 55%); opacity:0; }}
#{sid} .statement .st-text {{ font-size:84px; font-weight:650; letter-spacing:-0.035em; color:#fff; line-height:1.02; }}
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


ICON_FF = ('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" '
           'stroke-linejoin="round"><path d="M4 6l7 6-7 6V6z"/><path d="M13 6l7 6-7 6V6z"/></svg>')
ICON_CLOCK = ('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">'
              '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2"/><path d="M9 2h6"/></svg>')
ICON_SPARK = ('<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2c.6 4.9 2.6 7.6 7.8 8.6v.8c-5.2 1-7.2 3.7-7.8 '
              '8.6h-.8c-.6-4.9-2.6-7.6-7.8-8.6v-.8c5.2-1 7.2-3.7 7.8-8.6z"/></svg>')

# =====================================================================================================
# MOTION-GRAPHIC scenes (hand-authored files) + chapter cards (one file, per-instance variables)
# =====================================================================================================
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
#{cid} .ghost {{ position:absolute; right:60px; top:120px; font-family:"Geist", sans-serif; font-size:640px; font-weight:700; line-height:1; color:transparent; -webkit-text-stroke:4px rgba(39,71,245,.16); letter-spacing:-0.06em; }}
#{cid} .box {{ position:absolute; left:160px; top:0; bottom:0; width:1460px; display:flex; flex-direction:column; justify-content:center; }}
#{cid} .num {{ display:flex; align-items:center; gap:24px; font-family:"Geist Mono", monospace; font-size:44px; font-weight:600; color:#2747F5; }}
#{cid} .rule {{ display:block; width:220px; height:4px; background:#2747F5; transform-origin:0 50%; }}
#{cid} .title {{ margin-top:30px; font-size:116px; font-weight:660; letter-spacing:-0.048em; line-height:1.0; }}
#{cid} .title .w {{ display:inline-block; }}
#{cid} .attr {{ margin-top:46px; display:inline-flex; align-self:flex-start; align-items:center; gap:16px; height:78px; padding:0 34px 0 26px; border-radius:999px; background:#111113; color:#F5F5F7; font-family:"Geist Mono", monospace; font-size:36px; font-weight:500; }}
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
tl.fromTo("#{cid}-wrap", {{ clipPath:"inset(0% 0% 0% 100%)" }}, {{ clipPath:"inset(0% 0% 0% 0%)", duration:0.45, ease:"power3.inOut" }}, 0);
tl.fromTo("#{cid}-edge", {{ x:1920, opacity:1 }}, {{ x:-16, duration:0.45, ease:"power3.inOut" }}, 0);
tl.fromTo("#{cid}-bg", {{ x:0 }}, {{ x:-50, duration:{CARD_DUR}, ease:"none" }}, 0);
tl.fromTo("#{cid}-ghost", {{ x:80, opacity:0 }}, {{ x:0, opacity:1, duration:1.4, ease:"power2.out" }}, 0.1);
tl.fromTo("#{cid}-num", {{ opacity:0, y:20 }}, {{ opacity:1, y:0, duration:0.4, ease:"power3.out" }}, 0.22);
tl.fromTo("#{cid}-rule", {{ scaleX:0 }}, {{ scaleX:1, duration:0.6, ease:"power3.out" }}, 0.3);
tl.fromTo("#{cid}-title .w", {{ opacity:0, y:60 }}, {{ opacity:1, y:0, duration:0.5, stagger:0.06, ease:"power3.out" }}, 0.3);
tl.fromTo("#{cid}-attr", {{ opacity:0, y:24, scale:0.95 }}, {{ opacity:1, y:0, scale:1, duration:0.45, ease:"back.out(1.7)" }}, 0.62);
tl.fromTo("#{cid}-wrap", {{ y:0 }}, {{ y:-30, duration:0.45, ease:"power2.in" }}, {CARD_DUR - 0.45});
tl.to("#{cid}-wrap", {{ clipPath:"inset(0% 0% 100% 0%)", duration:0.45, ease:"power3.in" }}, {CARD_DUR - 0.45});
window.__timelines["{cid}"] = tl;
}})();
</script>
</template>
</body></html>
"""


def sfx_dur(f):
    import subprocess
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0",
                          str(ROOT / "assets/sfx" / f)], capture_output=True, text=True).stdout.strip()
    return round(float(out) - 0.01, 3)


def render_index():
    hosts = []
    z = 10
    for sc in S:
        hosts.append(f'<div id="host-{sc.id}" data-composition-id="{sc.id}" data-composition-src="compositions/{sc.id}.html" '
                     f'data-start="{sc.start}" data-duration="{sc.dur}" data-track-index="1" data-width="1920" data-height="1080" '
                     f'style="z-index:{z}"></div>')
    for sid, src, a, b in MG:
        hosts.append(f'<div id="host-{sid}" data-composition-id="{sid}" data-composition-src="{src}" data-start="{a}" '
                     f'data-duration="{round(b - a, 3)}" data-track-index="2" data-width="1920" data-height="1080" style="z-index:30"></div>')
    for n, (a, num, title, attr) in enumerate(CARDS):
        cid = f"mg-card{n + 1}"
        hosts.append(f'<div id="host-{cid}" data-composition-id="{cid}" data-composition-src="compositions/{cid}.html" '
                     f'data-start="{a}" data-duration="{CARD_DUR}" data-track-index="3" '
                     f'data-width="1920" data-height="1080" style="z-index:40"></div>')
    audio = []
    for k, (cid, name, t, ms, d) in enumerate(VOC):
        src = f"assets/voice/{name}.wav" if cid == name else f"assets/voice/parts/{cid}.wav"
        audio.append(f'<audio id="{cid}" src="{src}" data-start="{round(t, 3)}" data-duration="{round(d, 3)}" '
                     f'data-track-index="{10 + (k % 2)}" data-audio-group="voiceover" data-volume="1"></audio>')
    audio.append(f'<audio id="music" src="assets/music/bed.wav" data-start="0" data-duration="{TOTAL}" data-track-index="12" '
                 f'data-audio-group="music" data-volume="0.55"></audio>')
    for k, (t, f, v) in enumerate(sorted(SFX)):
        audio.append(f'<audio id="sfx{k:02d}" src="assets/sfx/{f}" data-start="{round(t, 3)}" data-duration="{sfx_dur(f)}" data-track-index="{13 + (k % 3)}" '
                     f'data-audio-group="sfx" data-volume="{v}"></audio>')
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=1920, height=1080" />
<title>Naqsha · demo</title>
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


def sync_mg_durations():
    """Hand-authored motion-graphic roots carry their own data-duration: keep it equal to the host slot."""
    for sid, src, a, b in MG:
        p = ROOT / src
        txt = p.read_text()
        new = re.sub(rf'(id="{sid}" data-composition-id="{sid}"[^>]*?data-duration=")[0-9.]+(")', rf"\g<1>{round(b - a, 3)}\g<2>", txt)
        if new != txt:
            p.write_text(new)


if __name__ == "__main__":
    write_parts()
    for sc in S:
        (COMP / f"{sc.id}.html").write_text(render_scene(sc))
        print(f"{sc.id:12s} {sc.start:7.2f} → {sc.start + sc.dur:7.2f}  ({sc.dur:.2f}s)  segs={len(sc.segs)}")
    for n, c in enumerate(CARDS):
        (COMP / f"mg-card{n + 1}.html").write_text(render_card(n, c[1], c[2], c[3]))
    sync_mg_durations()
    (ROOT / "index.html").write_text(render_index())
    (ROOT / "scripts/timelapse_plan.json").write_text(json.dumps(TL_PLAN, indent=1))
    for sid, src, a, b in MG:
        print(f"{sid:12s} {a:7.2f} → {b:7.2f}  ({b - a:.2f}s)")
    print("cards:", [(round(c[0], 2), round(c[0] + CARD_DUR, 2)) for c in CARDS])
    print("VO:", [(c[0], round(c[2], 2), round(c[2] + c[4], 2)) for c in VOC])
    print("TOTAL", TOTAL)
