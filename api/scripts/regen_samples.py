"""Regenerate a sample home through the HTTP API exactly as a guest would (setup → concepts → night → design → revise).

    uv run python scripts/regen_samples.py setup  A|B  --out DIR
    uv run python scripts/regen_samples.py design A|B  --out DIR --concept c_xxx [--tries 3]

`setup` creates the project, sends ONE rich setup message, makes four concepts and their night versions, and downloads the day
images to DIR for picking. `design` selects the picked concept, runs /design until the version has 0 LDA and 0 livable FAILs
(up to --tries), then adds two walkthrough comments (one doable, one that breaks LDA) and runs /revise, checking v2 stays clean.
Everything is logged with timings to DIR/<key>.log and the state to DIR/<key>.json. Needs a local API (API env var, default
http://127.0.0.1:8096) and a guest id (GUEST env var or DIR/guest.txt).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import uuid
from pathlib import Path

import httpx

API = os.environ.get("API", "http://127.0.0.1:8096")
M = 0.3048

SAMPLES = {
    "A": {
        "name": "Sample · 10 marla modern home, Johar Town",
        "message": (
            "We have a 10 marla plot in Johar Town (LDA), 35 x 65 ft, mid-row, facing north. We want a two-storey Modern "
            "Contemporary house with 4 bedrooms, every one with an attached bath. One bedroom is on the ground floor for my "
            "parents; the other three are upstairs. On the ground floor we need a drawing room, a TV lounge, an open kitchen "
            "plus a separate dirty kitchen, and my parents' bedroom. Upstairs, three bedrooms with attached baths. A 1-car porch "
            "and a small front lawn. A plastic water tank on the roof, and please keep the roof solar-ready so we can add "
            "panels later."),
        "answers": {"authority": ["LDA"], "plot": ["plot:35x65", "corner:false"], "corner": ["corner:false"], "facing": ["facing:N"],
                    "storeys": ["storeys:2"], "bedrooms": ["bedrooms:4"], "water_tank": ["tank:plastic"], "solar": ["solar:ready"],
                    "style": ["style:Modern Contemporary"],
                    "floors": ["floor:ground=drawing,tv_lounge,kitchen,dirty_kitchen,bedroom:1,bath:1",
                               "floor:first=bedroom:3,bath:3"]},
    },
    "B": {
        "name": "Sample · 1 kanal Spanish villa",
        "message": (
            "1 kanal plot in an LDA scheme in Lahore, 50 x 90 ft, mid-row, facing south. Two storeys, Spanish style. Five "
            "bedrooms, each with an attached bath: two on the ground floor and three upstairs. Downstairs we want a drawing "
            "room, a dining room, a TV lounge, a kitchen with a dirty kitchen, a prayer room and a servant quarter. A 2-car "
            "porch and a roof terrace. A concrete water tank, and solar panels on the roof."),
        "answers": {"authority": ["LDA"], "plot": ["plot:50x90", "corner:false"], "corner": ["corner:false"], "facing": ["facing:S"],
                    "storeys": ["storeys:2"], "bedrooms": ["bedrooms:5"], "water_tank": ["tank:concrete"], "solar": ["solar:panels"],
                    "style": ["style:Spanish"],
                    "floors": ["floor:ground=drawing,dining,tv_lounge,kitchen,dirty_kitchen,prayer,servant_quarter,bedroom:2,bath:2",
                               "floor:first=bedroom:3,bath:3"]},
    },
    "COMMENTS": [
        {"text": "Please make the master bedroom window bigger, we want much more morning light.", "room_kind": "master"},
        {"text": "Can we extend the car porch 4 ft forward into the front lawn?", "room_kind": "porch"},
    ],
}


class Log:
    def __init__(self, path: Path):
        self.path, self.t0 = path, time.monotonic()

    def __call__(self, *a):
        line = f"[{time.strftime('%H:%M:%S')} +{time.monotonic() - self.t0:7.1f}s] " + " ".join(str(x) for x in a)
        print(line, flush=True)
        with self.path.open("a") as f:
            f.write(line + "\n")


def client(guest: str) -> httpx.Client:
    return httpx.Client(base_url=API, headers={"X-Naqsha-User": guest},
                        timeout=httpx.Timeout(connect=10, read=600, write=60, pool=10))


def sse(c: httpx.Client, method: str, path: str, body: dict | None = None):
    """Yield (event, data) from an SSE response (POST or GET)."""
    with c.stream(method, path, json=body) as r:
        if r.status_code == 204:
            return
        if r.status_code >= 400:
            r.read()
            raise RuntimeError(f"{method} {path} -> {r.status_code}: {r.text[:400]}")
        ev, data = None, []
        for line in r.iter_lines():
            if line.startswith("event:"):
                ev = line[6:].strip()
            elif line.startswith("data:"):
                data.append(line[5:].strip())
            elif line == "" and ev:
                yield ev, json.loads("\n".join(data) or "{}")
                ev, data = None, []


def fails(report: dict) -> dict:
    out = {"lda": [], "livable": []}
    for ch in report.get("checks", []):
        if ch["status"] == "fail":
            out.setdefault(ch.get("category", "lda"), []).append(ch["id"])
    return out


def counts(report: dict) -> dict:
    out: dict = {}
    for ch in report.get("checks", []):
        d = out.setdefault(ch.get("category", "lda"), {"pass": 0, "warn": 0, "fail": 0, "total": 0})
        d["total"] += 1
        d[ch["status"]] += 1
    return out


def save(state: dict, out: Path, key: str):
    (out / f"{key}.json").write_text(json.dumps(state, indent=1, ensure_ascii=False))


def load(out: Path, key: str) -> dict:
    p = out / f"{key}.json"
    return json.loads(p.read_text()) if p.exists() else {}


# --- setup ------------------------------------------------------------------------------------------------------------
def intake_turn(c, pid, log, **body):
    msgs, brief, complete = [], None, False
    for ev, data in sse(c, "POST", f"/api/projects/{pid}/intake", body):
        if ev == "message" and data.get("role") == "assistant":
            msgs.append(data)
            log("  assistant:", data.get("text", "")[:300], "| field:", data.get("field"), "| input:", data.get("input"))
        elif ev in ("brief", "intake.complete"):
            brief = data.get("brief")
            complete = complete or ev == "intake.complete"
        elif ev == "error":
            raise RuntimeError(data)
    return msgs, brief, complete


def do_setup(key: str, out: Path, guest: str):
    spec = SAMPLES[key]
    log = Log(out / f"{key}.log")
    c = client(guest)
    st = load(out, key)
    t = time.monotonic()
    p = c.post("/api/projects", json={"name": spec["name"]}).json()
    pid = p["id"]
    st.update(key=key, pid=pid, guest=guest, name=spec["name"], timings={})
    save(st, out, key)
    log("created", pid, p["name"])
    intake_turn(c, pid, log, action="start")
    log("user:", spec["message"])
    t1 = time.monotonic()
    msgs, brief, complete = intake_turn(c, pid, log, message=spec["message"])
    st["timings"]["setup_message_s"] = round(time.monotonic() - t1, 1)
    turns = 1
    while not complete and turns < 6:  # answer any follow-up the way the family would (tap the widget)
        field = (msgs[-1] if msgs else {}).get("field")
        chips = spec["answers"].get(field)
        log(f"follow-up asked for {field!r}; answering with {chips or 'You decide'}")
        if chips:
            msgs, brief, complete = intake_turn(c, pid, log, message=", ".join(chips), chips=chips)
        else:
            msgs, brief, complete = intake_turn(c, pid, log, action="skip_question")
        turns += 1
    st["setup_turns"] = turns
    st["timings"]["setup_s"] = round(time.monotonic() - t, 1)
    st["brief"] = brief
    st["setup_complete"] = complete
    if msgs and msgs[-1].get("understood"):
        st["understood"] = msgs[-1]["understood"]
    log("setup complete:", complete, "turns:", turns)
    log("brief:", json.dumps({k: v for k, v in (brief or {}).items() if v not in (None, [], "")}, ensure_ascii=False))
    save(st, out, key)
    if not complete:
        raise SystemExit("setup did not complete")

    t = time.monotonic()
    concepts = []
    for ev, data in sse(c, "POST", f"/api/projects/{pid}/concepts", {"count": 4}):
        if ev == "concept":
            cc = data["concept"]
            concepts.append(cc)
            log("concept", data["index"], cc["id"], cc.get("title"), "-", (cc.get("summary") or "")[:120])
        elif ev == "concept.failed":
            log("concept failed", data)
        elif ev == "error":
            raise RuntimeError(data)
    st["timings"]["concepts_s"] = round(time.monotonic() - t, 1)
    t = time.monotonic()
    night = {}
    for ev, data in sse(c, "POST", f"/api/projects/{pid}/concepts/night", {}):
        if ev == "concept":
            night[data["concept"]["id"]] = data["concept"].get("night_url")
            log("night", data["concept"]["id"], data["concept"].get("night_url"))
        elif ev in ("concept.failed", "error"):
            log("night", ev, data)
    st["timings"]["night_s"] = round(time.monotonic() - t, 1)
    for cc in concepts:
        cc["night_url"] = night.get(cc["id"]) or cc.get("night_url")
        img = c.get(cc["url"])
        f = out / f"{key}_{cc['id']}.{'jpg' if 'jpeg' in img.headers.get('content-type', '') else 'png'}"
        f.write_bytes(img.content)
        cc["local"] = str(f)
    st["concepts"] = concepts
    save(st, out, key)
    log("concepts saved:", [(cc["id"], cc.get("title"), bool(cc.get("night_url"))) for cc in concepts])


# --- design + revise -----------------------------------------------------------------------------------------------
def run_stream(c, method, path, body, log, kind):
    """Follow a design/revise run; re-attach with GET /run if the connection drops. Returns (version, error)."""
    version, error, attached = None, None, False
    for _ in range(5):
        try:
            it = sse(c, method, path, body) if not attached else sse(c, "GET", path.rsplit("/", 1)[0] + "/run")
            for ev, data in it:
                if ev == "stage":
                    log(f"  [{kind}] stage {data.get('stage')}: {data.get('message')}")
                elif ev == "compliance":
                    log(f"  [{kind}] compliance attempt {data.get('attempt')}: {counts(data['report'])}")
                elif ev == "changes":
                    for ch in data.get("changes") or []:
                        log(f"  [{kind}] change {ch.get('id')}: {ch.get('summary')} {ch.get('comment_ids')}")
                elif ev == "comment":
                    cm = data.get("comment") or {}
                    log(f"  [{kind}] comment {cm.get('id')} -> {cm.get('status')}: {cm.get('resolution')}")
                elif ev == "version":
                    version = data["version"]
                elif ev == "error":
                    error = data
                    log(f"  [{kind}] ERROR {data}")
            return version, error
        except (httpx.HTTPError, RuntimeError) as e:
            if isinstance(e, RuntimeError) and "->" in str(e):
                raise
            log(f"  [{kind}] stream dropped ({type(e).__name__}: {e}); re-attaching")
            attached = True
            time.sleep(5)
    return version, error or {"message": "gave up re-attaching"}


def anchor_for(plan: dict, kind: str) -> dict:
    rooms = plan["rooms"]
    if kind == "master":
        r = (next((r for r in rooms if r["type"] == "master_bedroom"), None)
             or next((r for r in rooms if r["type"] == "bedroom" and "master" in r["name"].lower()), None)
             or next(r for r in rooms if r["type"] in ("bedroom", "master_bedroom")))
        what = "window"
    else:
        r = next((r for r in rooms if r["type"] == "porch"), None) or next(r for r in rooms if r["type"] in ("driveway", "lawn"))
        what = "slab"
    lv = next(l for l in plan["levels"] if l["id"] == r["level"])
    q = r["rect"]
    cx, cy = q["x"] + q["w"] / 2, q["y"] + q["d"] / 2
    y_front = q["y"]  # the road side is plan y < 0
    pos = [round(cx * M, 3), round((lv["elevation_ft"] + 5) * M, 3), round(-y_front * M, 3)]
    W, D = plan["site"]["plot"]["width_ft"], plan["site"]["plot"]["depth_ft"]
    return {"anchor": {"position": pos, "normal": [0, 0, 1], "level": r["level"], "room": r["id"], "kind": what,
                       "label": f"{r['name']} {what}"},
            "camera": {"position": [round(cx * M, 3), round((lv["elevation_ft"] + 18) * M, 3), 14],
                       "target": [round(cx * M, 3), round((lv["elevation_ft"] + 5) * M, 3), round(-cy * M, 3)]},
            "room": r["id"], "W": W, "D": D}


def do_design(key: str, out: Path, guest: str, concept: str, tries: int):
    log = Log(out / f"{key}.log")
    st = load(out, key)
    pid = st["pid"]
    c = client(guest)
    sel = c.post(f"/api/projects/{pid}/concepts/{concept}/select")
    sel.raise_for_status()
    st["selected_concept_id"] = concept
    log("selected concept", concept)
    st.setdefault("designs", [])
    passing = None
    for i in range(1, tries + 1):
        t = time.monotonic()
        log(f"design try {i}")
        v, err = run_stream(c, "POST", f"/api/projects/{pid}/design", {}, log, f"design{i}")
        dt = round(time.monotonic() - t, 1)
        if not v:
            log(f"design try {i} produced no version ({err}) in {dt}s")
            st["designs"].append({"try": i, "error": err, "seconds": dt})
            save(st, out, key)
            continue
        f = fails(v["compliance"])
        rec = {"try": i, "version_id": v["id"], "n": v["n"], "seconds": dt, "counts": counts(v["compliance"]), "fails": f,
               "fix_history": [{k: h.get(k) for k in ("attempt", "fail", "warn", "counts") if k in h} for h in v.get("fix_history") or []],
               "review": {k: (v.get("review") or {}).get(k) for k in ("verdict", "summary", "applied", "rejected_because")},
               "plan_images": v.get("plan_images")}
        st["designs"].append(rec)
        save(st, out, key)
        log(f"design try {i}: {v['id']} v{v['n']} in {dt}s counts={rec['counts']} fails={f} review={rec['review']}")
        if not f["lda"] and not f["livable"]:
            passing = v
            break
    if not passing:
        st["result"] = "no passing design"
        save(st, out, key)
        raise SystemExit(f"{key}: no passing design after {tries} tries")
    st["v1"] = passing["id"]

    # walkthrough comments, then the ADK revision
    plan = passing["plan"]
    cids = []
    for spec in SAMPLES["COMMENTS"]:
        a = anchor_for(plan, spec["room_kind"])
        r = c.post(f"/api/projects/{pid}/comments", json={"version_id": passing["id"], "text": spec["text"], "anchor": a["anchor"],
                                                           "camera": a["camera"]})
        r.raise_for_status()
        cm = r.json()
        cids.append(cm["id"])
        log("comment", cm["id"], "on", a["room"], ":", spec["text"])
    st["comment_ids"] = cids
    save(st, out, key)
    t = time.monotonic()
    v2, err = run_stream(c, "POST", f"/api/projects/{pid}/revise", {"version_id": passing["id"], "comment_ids": cids}, log, "revise")
    dt = round(time.monotonic() - t, 1)
    if not v2:
        st["revise"] = {"error": err, "seconds": dt}
        save(st, out, key)
        raise SystemExit(f"{key}: revise failed: {err}")
    f2 = fails(v2["compliance"])
    comments = c.get(f"/api/projects/{pid}/comments").json()["comments"]
    st["revise"] = {"version_id": v2["id"], "n": v2["n"], "agent": v2.get("agent"), "seconds": dt, "counts": counts(v2["compliance"]),
                    "fails": f2, "changes": v2.get("changes"),
                    "comments": [{"id": x["id"], "status": x.get("status"), "resolution": x.get("resolution"), "text": x["text"]}
                                 for x in comments]}
    st["result"] = "pass" if not f2["lda"] and not f2["livable"] else "v2 has fails"
    save(st, out, key)
    log(f"revise: {v2['id']} v{v2['n']} agent={v2.get('agent')} in {dt}s counts={st['revise']['counts']} fails={f2}")
    for x in st["revise"]["comments"]:
        log(f"  comment {x['id']} {x['status']}: {x['resolution']}")
    log("RESULT", st["result"])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["setup", "design"])
    ap.add_argument("key", choices=["A", "B"])
    ap.add_argument("--out", required=True)
    ap.add_argument("--concept")
    ap.add_argument("--tries", type=int, default=3)
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    gf = out / "guest.txt"
    guest = os.environ.get("GUEST") or (gf.read_text().strip() if gf.exists() else None)
    if not guest:
        guest = str(uuid.uuid4())
        gf.write_text(guest)
    if a.cmd == "setup":
        do_setup(a.key, out, guest)
    else:
        if not a.concept:
            sys.exit("--concept is required")
        do_design(a.key, out, guest, a.concept, a.tries)


if __name__ == "__main__":
    main()
