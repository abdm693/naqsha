"""Builds the Naqsha (Nebius edition) demo film: index.html and compositions/*.html from one scene list.

Footage is real, unedited screen capture of the deployed app (submission/capture/capture.mjs, Playwright at 1920×1080),
played in a window on the limestone ground with a constant playback rate per scene. Narration: Gemini TTS lines in
assets/voice (submission/video_work/tts.py). Scene lengths follow the narration.
"""
from __future__ import annotations

import html
import json
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COMP = ROOT / "compositions"
COMP.mkdir(exist_ok=True)

GROUND, INK, INK2, ACCENT, NV = "#f3f2ee", "#16161a", "#5b5b63", "#2b44f0", "#76b900"
FONTS = """@font-face { font-family: "Geist"; src: url("assets/fonts/Geist-Variable.woff2") format("woff2"); font-weight: 100 900; }
@font-face { font-family: "Geist Mono"; src: url("assets/fonts/GeistMono-Variable.woff2") format("woff2"); font-weight: 100 900; }
@font-face { font-family: "Noto Nastaliq Urdu"; src: url("assets/fonts/NotoNastaliqUrdu.ttf") format("truetype"); font-weight: 400 700; }"""

FULL, DRAW = "assets/footage/full.mp4", "assets/footage/drawing.mp4"
# when each step happened in the recordings (capture.mjs writes these logs next to the webm)
MARKS = {name: {m["what"]: m["t"] for m in json.loads((ROOT / "scripts" / f"{name}.json").read_text())} for name in ("full", "drawing")}
F, D = MARKS["full"], MARKS["drawing"]
WX, WY, WW, WH = 178, 172, 1564, 880  # the app window on the ground


def vo_len(vid: str) -> float:
    with wave.open(str(ROOT / "assets/voice" / f"{vid}.wav")) as w:
        return w.getnframes() / w.getframerate()


# kind, id, voice line, extra seconds after the line, then the scene's own fields
SCENES = [
    dict(kind="hook", id="hook", vo="vo01", pad=1.4),
    dict(kind="title", id="title", vo="vo02", pad=1.2),
    dict(kind="clip", id="brief", vo="vo03", pad=1.0, src=FULL, a=F["workspace"] - 0.7, b=F["rules box"],
         title="One message fills the brief", tag="Setup agent · Nemotron 3 Super · Google ADK"),
    dict(kind="clip", id="rules", vo="vo04", pad=1.0, src=FULL, a=F["rules box"] - 1.0, b=F["decide for me"],
         title="Islamabad's rules, looked up on the web", tag="Tavily search + extract → Nemotron 3 Ultra → cited rule pack",
         zoom=dict(x=1310, y=600, w=600, h=420, at=0.35, k=2.0)),
    dict(kind="clip", id="drawing", vo="vo05", pad=1.0, src=DRAW, a=D["workspace"] - 1.2, b=D["decide for me"] - 1.0,
         title="Or start from your own drawing", tag="Nemotron 3.5 Super VL reads every room"),
    dict(kind="clip", id="concepts", vo="vo06", pad=1.6, src=DRAW, a=D["concepts in"] - 14.0, b=D["concepts in"] + 7.0,
         title="Four exteriors", tag="Gemini image model · drawn from the plan"),
    dict(kind="clip", id="plan", vo="vo07", pad=1.2, src=FULL, a=F["plan view"], b=F["house view"],
         title="An architect agent that checks its own work",
         tag="Nemotron 3 Ultra · 3 drafts · rules engine · fixer agent with tool calls"),
    dict(kind="clip", id="build", vo="vo08", pad=1.0, src=FULL, a=F["house view"], b=F["house view"] + 21.0,
         title="The 3D model, written as code", tag="Nemotron 3 Ultra · design.js from the concept's feature checklist"),
    dict(kind="clip", id="match", vo="vo09", pad=1.4, src=FULL, a=F["match popover"] - 1.5, b=F["match popover"] + 5.5,
         title="Checked against the concept", tag="Nemotron 3.5 Super VL compares, Ultra rebuilds what's missing",
         zoom=dict(x=0, y=170, w=760, h=600, at=0.2, k=1.5)),
    dict(kind="clip", id="photos", vo="vo10", pad=1.0, src=FULL, a=F["photos done"] - 3.0, b=F["photo 4"] + 2.5,
         title="Photos from every angle, made from the model", tag="Each photo starts from a capture of the 3D model"),
    dict(kind="clip", id="walk", vo="vo11", pad=1.2, src=FULL, a=F["walk"] + 5.0, b=F["walked"],
         title="Walk through it", tag="First person, room by room"),
    dict(kind="arch", id="arch", vo="vo12", pad=1.4),
    dict(kind="end", id="end", vo="vo13", pad=3.0),
]

LEAD = 0.5  # the line starts this far into its scene


def head(sid: str, extra_css: str = "") -> str:
    return f"""<template>
<style>
{FONTS}
#root {{ position: absolute; inset: 0; background: {GROUND}; font-family: "Geist", sans-serif; color: {INK}; overflow: hidden; }}
{extra_css}
</style>
<div id="root" data-composition-id="{sid}" data-width="1920" data-height="1080">"""


def tail(sid: str, js: str) -> str:
    return f"""</div>
<script>
const tl = gsap.timeline({{ paused: true }});
{js}
window.__timelines["{sid}"] = tl;
</script>
</template>
"""


def clip_scene(s: dict, dur: float) -> str:
    sid = s["id"]
    span = s["b"] - s["a"]
    rate = max(0.25, min(10.0, round(span / max(1.0, dur - 0.2), 3)))
    z = s.get("zoom")
    css = f"""
#{sid}-win {{ position: absolute; left: {WX}px; top: {WY}px; width: {WW}px; height: {WH}px; border-radius: 18px; overflow: hidden;
  box-shadow: 0 30px 80px rgba(20,20,30,.18), 0 2px 8px rgba(20,20,30,.10); background: #fff; }}
#{sid}-cam {{ position: absolute; inset: 0; transform-origin: 0 0; }}
#{sid}-vid {{ position: absolute; left: 0; top: 0; width: {WW}px; height: {WH}px; object-fit: cover; }}
#{sid}-title {{ position: absolute; left: {WX}px; top: 30px; font-size: 46px; font-weight: 620; letter-spacing: -0.03em; }}
#{sid}-tag {{ position: absolute; left: {WX}px; top: 98px; font: 500 28px "Geist", sans-serif; color: {INK2};
  display: flex; align-items: center; gap: 12px; }}
#{sid}-tag i {{ width: 10px; height: 10px; border-radius: 5px; background: {NV}; display: inline-block; }}
#{sid}-live {{ position: absolute; left: {WX + 20}px; top: {WY + WH - 52}px; font: 600 18px "Geist Mono", monospace; color: #fff;
  background: rgba(22,22,26,.72); padding: 6px 12px; border-radius: 8px; letter-spacing: .02em; }}"""
    out = head(sid, css)
    out += f"""
  <div id="{sid}-title" class="clip" data-start="0" data-duration="{dur:.2f}" data-track-index="2">{html.escape(s['title'])}</div>
  <div id="{sid}-tag" class="clip" data-start="0" data-duration="{dur:.2f}" data-track-index="3"><i></i>{html.escape(s['tag'])}</div>
  <div id="{sid}-win">
    <div id="{sid}-cam">
      <video id="{sid}-vid" class="clip" src="{s['src']}" data-start="0" data-duration="{dur:.2f}" data-media-start="{s['a']:.2f}"
        data-playback-rate="{rate}" data-track-index="0" muted playsinline></video>
    </div>
  </div>
  <div id="{sid}-live" data-layout-ignore class="clip" data-start="0" data-duration="{dur:.2f}" data-track-index="4">LIVE APP · {('real time' if rate <= 1.05 else f'sped up {rate:.1f}×') if rate >= 0.95 else f'slowed {rate:.2f}×'}</div>"""
    js = f"""tl.fromTo("#{sid}-title", {{ opacity: 0, y: 14 }}, {{ opacity: 1, y: 0, duration: 0.45, ease: "power3.out" }}, 0.1);
tl.fromTo("#{sid}-tag", {{ opacity: 0 }}, {{ opacity: 1, duration: 0.45, ease: "power2.out" }}, 0.3);
tl.fromTo("#{sid}-win", {{ y: 26, scale: 0.985 }}, {{ y: 0, scale: 1, duration: 0.55, ease: "power3.out" }}, 0);"""
    if z:
        # push in on one part of the window: scale k about the window, keeping (x, y, w, h) (in 1920×1080 capture px) in frame
        k = z["k"]
        sx = WW / 1920
        cx, cy = (z["x"] + z["w"] / 2) * sx, (z["y"] + z["h"] / 2) * sx
        tx, ty = WW / 2 - cx * k, WH / 2 - cy * k
        tx = min(0, max(WW - WW * k, tx)); ty = min(0, max(WH - WH * k, ty))
        t_in = z["at"] * dur
        js += f"""
tl.fromTo("#{sid}-cam", {{ x: 0, y: 0, scale: 1 }}, {{ x: {tx:.1f}, y: {ty:.1f}, scale: {k}, duration: 0.6, ease: "power2.inOut" }}, {t_in:.2f});"""
    return out + tail(sid, js)


def hook_scene(dur: float) -> str:
    sid = "hook"
    css = f"""
#hook-sheet {{ position: absolute; left: 660px; top: 90px; width: 600px; height: 900px; background: #fbfaf6; border-radius: 6px;
  box-shadow: 0 30px 70px rgba(20,20,30,.16); overflow: hidden; }}
#hook-sheet img {{ position: absolute; left: 0; top: 0; width: 600px; height: 900px; object-fit: contain; }}
#hook-l1, #hook-l2 {{ position: absolute; left: 120px; width: 470px; font-size: 44px; font-weight: 620; letter-spacing: -0.03em; line-height: 1.08; }}
#hook-l1 {{ top: 330px; }} #hook-l2 {{ top: 520px; color: {INK2}; font-size: 34px; font-weight: 520; }}
#hook-note {{ position: absolute; left: 1330px; top: 360px; width: 470px; font: 600 30px "Geist", sans-serif; color: #c4321d; line-height: 1.2; }}
#hook-note small {{ display: block; font: 500 28px "Geist Mono", monospace; color: #c4321d; margin-top: 10px; opacity: .85; }}
#hook-stamp {{ position: absolute; left: 760px; top: 440px; padding: 12px 30px; border: 6px solid #c4321d; color: #c4321d;
  font: 800 64px "Geist", sans-serif; letter-spacing: .06em; transform: rotate(-12deg); border-radius: 10px; background: rgba(251,250,246,.8); }}
#hook-ring {{ position: absolute; left: 905px; top: 150px; width: 330px; height: 110px; border: 5px solid #c4321d; border-radius: 50%; }}"""
    out = head(sid, css) + f"""
  <div id="hook-sheet" data-layout-allow-overflow class="clip" data-start="0" data-duration="{dur:.2f}" data-track-index="0"><img src="assets/img/plan-ground.png" alt=""></div>
  <div id="hook-l1" class="clip" data-start="0" data-duration="{dur:.2f}" data-track-index="1">Most families build a house once.</div>
  <div id="hook-l2" class="clip" data-start="0" data-duration="{dur:.2f}" data-track-index="2">The plan goes back and forth for weeks.</div>
  <div id="hook-ring" class="clip" data-start="0" data-duration="{dur:.2f}" data-track-index="3"></div>
  <div id="hook-note" class="clip" data-start="0" data-duration="{dur:.2f}" data-track-index="4">Returned by the authority<small>Rear open space 7′ — check the bylaw</small></div>
  <div id="hook-stamp" class="clip" data-start="0" data-duration="{dur:.2f}" data-track-index="5">RETURNED</div>"""
    js = f"""tl.fromTo("#hook-sheet", {{ y: 40, rotation: -2 }}, {{ y: 0, rotation: 0, duration: 0.9, ease: "power3.out" }}, 0);
tl.fromTo("#hook-sheet img", {{ scale: 1 }}, {{ scale: 1.06, duration: {dur:.2f}, ease: "none" }}, 0);
tl.fromTo("#hook-l1", {{ opacity: 1, y: 0 }}, {{ opacity: 1, y: 0, duration: 0.01 }}, 0);
tl.fromTo("#hook-l2", {{ opacity: 0, y: 16 }}, {{ opacity: 1, y: 0, duration: 0.5, ease: "power3.out" }}, 3.4);
tl.fromTo("#hook-ring", {{ opacity: 0, scale: 1.3 }}, {{ opacity: 1, scale: 1, duration: 0.35, ease: "back.out(2)" }}, 7.0);
tl.fromTo("#hook-note", {{ opacity: 0, x: -10 }}, {{ opacity: 1, x: 0, duration: 0.45, ease: "power3.out" }}, 7.3);
tl.fromTo("#hook-stamp", {{ opacity: 0, scale: 2.2 }}, {{ opacity: 1, scale: 1, duration: 0.28, ease: "power4.in" }}, 9.4);"""
    return out + tail(sid, js)


def title_scene(dur: float) -> str:
    sid = "title"
    css = f"""
#title-mark {{ position: absolute; left: 50%; top: 300px; width: 120px; height: 120px; margin-left: -60px; }}
#title-word {{ position: absolute; left: 0; right: 0; top: 450px; text-align: center; font-size: 132px; font-weight: 660; letter-spacing: -0.05em; }}
#title-urdu {{ font-family: "Noto Nastaliq Urdu", serif; font-size: 70px; color: {ACCENT}; margin-left: 28px; vertical-align: 14px; }}
#title-line {{ position: absolute; left: 0; right: 0; top: 650px; text-align: center; font-size: 36px; font-weight: 500; color: {INK2}; letter-spacing: -0.01em; }}
#title-line b {{ color: {INK}; font-weight: 640; }}
#title-chip {{ position: absolute; left: 50%; top: 740px; transform: translateX(-50%); display: flex; gap: 14px; }}
#title-chip span {{ font: 600 28px "Geist", sans-serif; padding: 10px 18px; border-radius: 10px; background: #fff; box-shadow: 0 2px 10px rgba(0,0,0,.06); }}
#title-chip span i {{ display: inline-block; width: 10px; height: 10px; border-radius: 5px; background: {NV}; margin-right: 10px; }}"""
    out = head(sid, css) + f"""
  <img id="title-mark" class="clip" data-start="0" data-duration="{dur:.2f}" data-track-index="0" src="assets/img/naqsha-mark.svg" alt="">
  <div id="title-word" data-layout-allow-overflow class="clip" data-start="0" data-duration="{dur:.2f}" data-track-index="1">Naqsha<span id="title-urdu">نقشہ</span></div>
  <div id="title-line" class="clip" data-start="0" data-duration="{dur:.2f}" data-track-index="2">Agents that design a family's home, <b>checked against the bylaws</b></div>
  <div id="title-chip" class="clip" data-start="0" data-duration="{dur:.2f}" data-track-index="3"><span><i></i>NVIDIA Nemotron</span><span>Nebius Token Factory</span><span>Tavily</span></div>"""
    js = """tl.fromTo("#title-mark", { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.6, ease: "back.out(1.7)" }, 0.1);
tl.fromTo("#title-word", { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.6, ease: "power3.out" }, 0.35);
tl.fromTo("#title-line", { opacity: 0 }, { opacity: 1, duration: 0.5, ease: "power2.out" }, 1.1);
tl.fromTo("#title-chip span", { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.4, stagger: 0.18, ease: "power3.out" }, 3.2);
tl.fromTo("#title-word", { scale: 1 }, { scale: 1.035, duration: 8, ease: "none" }, 1.0);"""
    return out + tail(sid, js)


ARCH_ROWS = [
    ("Nemotron 3 Ultra", "nvidia/Nemotron-3-Ultra-550b-a55b", "plans · fixes with tool calls · writes the 3D code · rule packs · revisions"),
    ("Nemotron 3 Super", "nvidia/nemotron-3-super-120b-a12b", "the setup conversation (Google ADK agent, 6 tools)"),
    ("Nemotron 3.5 Super VL", "nvidia/Nemotron-3.5-Super-VL", "reads drawings · concept checklist · checks the build · reviews plans"),
    ("Tavily", "search + extract", "finds each city's building rules, with sources"),
    ("Rules engine", "deterministic Python", "LDA bylaws + livable-home rules, or a researched pack"),
]


def arch_scene(dur: float) -> str:
    sid = "arch"
    css = f"""
#arch-h {{ position: absolute; left: 180px; top: 120px; font-size: 54px; font-weight: 640; letter-spacing: -0.035em; }}
#arch-h small {{ display: block; font-size: 28px; font-weight: 500; color: {INK2}; letter-spacing: -0.01em; margin-top: 12px; }}
.arch-row {{ position: absolute; left: 180px; width: 1560px; height: 118px; background: #fff; border-radius: 16px;
  box-shadow: 0 2px 14px rgba(0,0,0,.05); display: flex; align-items: center; padding: 0 34px; gap: 34px; }}
.arch-row b {{ width: 400px; font-size: 32px; font-weight: 640; letter-spacing: -0.02em; display: flex; align-items: center; gap: 14px; }}
.arch-row b i {{ width: 12px; height: 12px; border-radius: 6px; background: {NV}; display: inline-block; }}
.arch-row b i.g {{ background: {INK2}; }}
.arch-row code {{ width: 470px; font: 500 21px "Geist Mono", monospace; color: {INK2}; }}
.arch-row.on {{ box-shadow: 0 0 0 3px {ACCENT}, 0 10px 30px rgba(43,68,240,.12); }}
.arch-row span {{ flex: 1; font-size: 28px; color: {INK}; }}"""
    rows = ""
    for i, (name, mid, what) in enumerate(ARCH_ROWS):
        dot = "" if i < 3 else ' class="g"'
        rows += (f'\n  <div id="arch-r{i}" class="clip arch-row" data-start="0" data-duration="{dur:.2f}" data-track-index="{i + 1}" '
                 f'style="top:{330 + i * 136}px"><b><i{dot}></i>{html.escape(name)}</b><code data-layout-ignore>{html.escape(mid)}</code><span>{html.escape(what)}</span></div>')
    out = head(sid, css) + f"""
  <div id="arch-h" class="clip" data-start="0" data-duration="{dur:.2f}" data-track-index="0">Every text and vision model runs on Nebius Token Factory<small>Ultra for the heavy reasoning, Super and VL for the fast and visual calls</small></div>{rows}"""
    js = """tl.fromTo("#arch-h", { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.5, ease: "power3.out" }, 0.1);
tl.fromTo(".arch-row", { opacity: 0, x: -24 }, { opacity: 1, x: 0, duration: 0.45, stagger: 0.6, ease: "power3.out" }, 0.6);
for (const [i, at] of [[0, 2.9], [1, 6.4], [2, 8.8], [3, 11.6], [4, 13.2]]) {
  tl.fromTo(`#arch-r${i}`, { scale: 1 }, { scale: 1.02, duration: 0.35, ease: "power2.out" }, at);
  tl.set(`#arch-r${i}`, { className: "clip arch-row on" }, at);
  if (i < 4) tl.set(`#arch-r${i}`, { className: "clip arch-row" }, at + 2.3);
  tl.to(`#arch-r${i}`, { scale: 1, duration: 0.35, ease: "power2.inOut" }, at + 2.3);
}"""
    return out + tail(sid, js)


def end_scene(dur: float) -> str:
    sid = "end"
    css = f"""
#end-mark {{ position: absolute; left: 50%; top: 250px; width: 110px; height: 110px; margin-left: -55px; }}
#end-word {{ position: absolute; left: 0; right: 0; top: 390px; text-align: center; font-size: 110px; font-weight: 660; letter-spacing: -0.05em; }}
#end-links {{ position: absolute; left: 0; right: 0; top: 580px; text-align: center; font: 500 32px "Geist Mono", monospace; color: {INK}; line-height: 1.7; }}
#end-links small {{ display: block; font: 500 30px "Geist", sans-serif; color: {INK2}; margin-top: 18px; }}"""
    out = head(sid, css) + f"""
  <img id="end-mark" class="clip" data-start="0" data-duration="{dur:.2f}" data-track-index="0" src="assets/img/naqsha-mark.svg" alt="">
  <div id="end-word" class="clip" data-start="0" data-duration="{dur:.2f}" data-track-index="1">Naqsha</div>
  <div id="end-links" class="clip" data-start="0" data-duration="{dur:.2f}" data-track-index="2">naqsha-963839790554.us-central1.run.app<br>github.com/abdm693/naqsha<small>Open source · AGPL-3.0 · Pivot Analytix</small></div>"""
    js = """tl.fromTo("#end-mark", { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.6, ease: "back.out(1.7)" }, 0.1);
tl.fromTo("#end-word", { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.55, ease: "power3.out" }, 0.3);
tl.fromTo("#end-links", { opacity: 0 }, { opacity: 1, duration: 0.5, ease: "power2.out" }, 1.0);
tl.fromTo("#end-word", { scale: 1 }, { scale: 1.04, duration: 6, ease: "none" }, 1.5);"""
    return out + tail(sid, js)


def build() -> None:
    t = 0.0
    hosts, audio = [], []
    for s in SCENES:
        dur = round(LEAD + vo_len(s["vo"]) + s["pad"], 2)
        sid = s["id"]
        maker = {"hook": lambda: hook_scene(dur), "title": lambda: title_scene(dur), "arch": lambda: arch_scene(dur),
                 "end": lambda: end_scene(dur), "clip": lambda: clip_scene(s, dur)}[s["kind"]]
        (COMP / f"{sid}.html").write_text(maker())
        hosts.append(f'    <div id="{sid}" data-composition-id="{sid}" data-composition-src="compositions/{sid}.html" data-start="{t:.2f}" '
                     f'data-duration="{dur:.2f}" data-track-index="1" data-track-kind="graphics" data-width="1920" data-height="1080"></div>')
        audio.append(f'    <audio id="{s["vo"]}" class="clip" src="assets/voice/{s["vo"]}.wav" data-start="{t + LEAD:.2f}" data-duration="{vo_len(s['vo']):.2f}" data-track-index="5" data-volume="1"></audio>')
        s["_t"], s["_dur"] = t, dur
        t += dur
    total = round(t, 2)
    sfx = []
    for s in SCENES[2:]:  # a soft whoosh on each cut into a new scene
        sfx.append(f'    <audio id="sfx-{s["id"]}" class="clip" src="assets/sfx/whoosh-short.mp3" data-start="{max(0, s["_t"] - 0.15):.2f}" data-duration="0.57" data-track-index="7" data-volume="0.35"></audio>')
    stamp = next(s for s in SCENES if s["id"] == "hook")["_t"] + 9.4
    sfx.append(f'    <audio id="sfx-stamp" class="clip" src="assets/sfx/pop.mp3" data-start="{stamp:.2f}" data-duration="0.5" data-track-index="8" data-volume="0.6"></audio>')
    page = f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      * {{ margin: 0; padding: 0; box-sizing: border-box; }}
      html, body {{ margin: 0; width: 1920px; height: 1080px; overflow: hidden; background: {GROUND}; }}
      #ground {{ position: absolute; inset: 0; background: {GROUND}; }}
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="{total}" data-width="1920" data-height="1080">
    <div id="ground"></div>
{chr(10).join(hosts)}
{chr(10).join(audio)}
    <audio id="music" class="clip" src="assets/music/bed.wav" data-start="0" data-duration="{total}" data-track-index="6" data-volume="0.16" data-fade-out="4"></audio>
{chr(10).join(sfx)}
    </div>
    <script>
      const tl = gsap.timeline({{ paused: true }});
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
"""
    (ROOT / "index.html").write_text(page)
    (ROOT / "scripts" / "timeline.json").write_text(json.dumps([{"id": s["id"], "start": s["_t"], "dur": s["_dur"]} for s in SCENES], indent=1))
    print(f"total {total:.1f}s; scenes:", ", ".join(f"{s['id']} {s['_t']:.1f}+{s['_dur']:.1f}" for s in SCENES))


if __name__ == "__main__":
    build()
