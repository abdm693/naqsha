"""Revision end to end as a guest: copy a sample, pin two comments (one blocked by the bylaws), revise, then a typed change.
Usage: python scripts/e2e_revise.py base_url sample_pid"""
import json, sys, time, uuid
import httpx

BASE, SAMPLE = sys.argv[1], sys.argv[2]
H = {"X-Naqsha-User": "e2e-" + uuid.uuid4().hex[:12]}
t0 = time.time()
say = lambda *a: print(f"[{time.time()-t0:5.0f}s]", *a, flush=True)


def sse(path, body):
    with httpx.stream("POST", BASE + path, json=body, headers=H, timeout=None) as r:
        r.raise_for_status()
        ev = None
        for line in r.iter_lines():
            if line.startswith("event:"):
                ev = line[6:].strip()
            elif line.startswith("data:"):
                yield ev, json.loads(line[5:])


c = httpx.Client(base_url=BASE, headers=H, timeout=600)
p = c.post(f"/api/projects/{SAMPLE}/clone", json={}).json()
pid, vid = p["id"], p["current_version_id"]
v = c.get(f"/api/projects/{pid}/versions/{vid}").json()
rooms = {r["type"]: r for r in v["plan"]["rooms"]}
say("copy", pid, v.get("summary"))
kitchen = next(r for r in v["plan"]["rooms"] if r["type"] == "kitchen")
porch = next(r for r in v["plan"]["rooms"] if r["type"] == "porch")
ids = []
for r, text in ((kitchen, "Can the kitchen be a little bigger? I cook for the whole family."),
                (porch, "Extend the car porch forward by 5 feet so two cars fit.")):
    cm = c.post(f"/api/projects/{pid}/comments", json={"version_id": vid, "text": text, "camera": {"position": [0, 10, 20], "target": [0, 0, 0]},
                "anchor": {"position": [0, 1, 0], "normal": [0, 0, 1], "level": r["level"], "room": r["id"], "kind": "floor"}}).json()
    ids.append(cm["id"]); say("comment", cm["id"], text)
for ev, d in sse(f"/api/projects/{pid}/revise", {"version_id": vid, "comment_ids": ids}):
    if ev == "stage":
        say("stage:", d.get("message"))
    elif ev == "comment":
        cm = d["comment"]; say("ANSWER", cm.get("status"), (cm.get("resolution") or "")[:200])
    elif ev == "version":
        say("VERSION", d["version"]["n"], d["version"].get("summary"), [ch["summary"][:80] for ch in d["version"].get("changes") or []])
    elif ev == "error":
        say("ERROR", d)
p = c.get(f"/api/projects/{pid}").json()
vid2 = p["current_version_id"]
for ev, d in sse(f"/api/projects/{pid}/revise", {"version_id": vid2, "instruction": "Make the drawing room a bit wider."}):
    if ev == "stage":
        say("stage:", d.get("message"))
    elif ev == "version":
        vv = d["version"]; say("VERSION", vv["n"], vv.get("summary"), (vv.get("source") or {}).get("answer", "")[:300])
    elif ev == "error":
        say("ERROR", d)
print("PID", pid, "GUEST", H["X-Naqsha-User"])
