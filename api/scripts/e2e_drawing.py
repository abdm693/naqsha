"""End-to-end from an uploaded drawing: upload sheets -> brief -> concepts (drawn from the drawing) -> design.
Usage: python scripts/e2e_drawing.py base_url sheet1.png [sheet2.png ...]"""
import base64, json, sys, time, uuid
import httpx

BASE, sheets = sys.argv[1], sys.argv[2:]
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
pid = c.post("/api/projects", json={"name": "From a drawing"}).json()["id"]
say("project", pid)
imgs = ["data:image/png;base64," + base64.b64encode(open(f, "rb").read()).decode() for f in sheets]
r = c.post(f"/api/projects/{pid}/drawing", json={"images": imgs})
say("upload", r.status_code)
p = r.json()
imp = p.get("imported") or {}
say("imported rooms", imp.get("rooms"), "levels", (imp.get("layout") or {}).get("levels"))
say("brief", json.dumps(p.get("brief"))[:700])
for ev, d in sse(f"/api/projects/{pid}/intake", {"action": "skip_all"}):
    if ev == "message":
        say("naqsha:", d.get("text", "")[:200])
cons = []
for ev, d in sse(f"/api/projects/{pid}/concepts", {"count": 2}):
    if ev == "concept.started" and d["index"] == 0:
        say("concepts from design:", d.get("from_design"))
    if ev == "concept":
        cons.append(d["concept"]); say("concept", d["concept"].get("title"), d["concept"]["url"])
c.post(f"/api/projects/{pid}/concepts/{cons[0]['id']}/select")
for ev, d in sse(f"/api/projects/{pid}/design", {}):
    if ev == "stage":
        say("stage:", d.get("message"))
    elif ev == "version":
        v = d["version"]; say("VERSION", v["id"], v["summary"], len(v["sections"]), "sections")
        json.dump(v, open(f"/tmp/e2e-{pid}.json", "w"))
    elif ev == "error":
        say("ERROR", d)
print("PID", pid)
