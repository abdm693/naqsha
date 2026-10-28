"""End-to-end through the local API as a guest: setup chat -> concepts -> select -> design. Prints the stream as it goes.
Usage: python scripts/e2e.py "<first message>" [base_url]"""
import json, sys, time, uuid
import httpx

BASE = sys.argv[2] if len(sys.argv) > 2 else "http://127.0.0.1:8080"
H = {"X-Naqsha-User": "e2e-" + uuid.uuid4().hex[:12]}
t0 = time.time()


def say(*a):
    print(f"[{time.time()-t0:5.0f}s]", *a, flush=True)


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
p = c.post("/api/projects", json={"name": "E2E home"}).json()
pid = p["id"]
say("project", pid)
for ev, d in sse(f"/api/projects/{pid}/intake", {"message": sys.argv[1]}):
    say("intake", ev, json.dumps(d)[:500])
for _ in range(3):
    p = c.get(f"/api/projects/{pid}").json()
    if p.get("intake_complete"):
        break
    for ev, d in sse(f"/api/projects/{pid}/intake", {"action": "skip_all"}):
        say("skip_all", ev, json.dumps(d)[:300])
p = c.get(f"/api/projects/{pid}").json()
say("brief:", json.dumps(p.get("brief"))[:800])
cons = []
for ev, d in sse(f"/api/projects/{pid}/concepts", {"count": int(__import__("os").environ.get("NCON", "2"))}):
    if ev == "concept":
        cons.append(d["concept"]); say("concept", d["concept"]["title"], d["concept"]["url"])
    elif ev in ("concept.failed", "error"):
        say(ev, d)
c.post(f"/api/projects/{pid}/concepts/{cons[0]['id']}/select")
for ev, d in sse(f"/api/projects/{pid}/design", {}):
    if ev == "stage":
        say("stage:", d.get("message"))
    elif ev == "section":
        say("section", d["section"]["name"], len(d["section"]["code"]))
    elif ev == "compliance":
        rep = d["report"]; say("compliance", sum(1 for x in rep["checks"] if x["status"] == "fail"), "fails")
    elif ev == "version":
        v = d["version"]; say("VERSION", v["id"], v["summary"], len(v["sections"]), "sections")
        json.dump(v, open(f"/tmp/e2e-{pid}.json", "w"))
    elif ev == "error":
        say("ERROR", d)
print("PID", pid)
