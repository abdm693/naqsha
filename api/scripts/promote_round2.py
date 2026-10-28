"""Round 2 sample fixes, promoted in place (the samples keep their ids, so the landing and every untouched guest copy pick them
up: a copy made before the sample's new updated_at is refreshed on its next open). Dry run by default; --apply writes.

    uv run python scripts/promote_round2.py concept SAMPLE CONCEPT_ID DAY.png NIGHT.png [--tag=r4] [--apply]
        BE2-02: upload the new day/night images under new names (<id>-<tag>.png, never over an existing file) and point the
        concept at them (same id, same title; the project thumbnail follows when it showed the old image).
    uv run python scripts/promote_round2.py captions SAMPLE [--apply]
        BE-F1: plain British English captions (concept.summary) from CAPTIONS.
    uv run python scripts/promote_round2.py floors SAMPLE [--apply]
        BE-F5: the Brief's per-floor program from FLOORS (the upstairs master named), refused if it adds a problem.
    uv run python scripts/promote_round2.py version SAMPLE STAGING_PID VERSION_ID [--summary="..."] [--strict] [--apply]
        BE2-03: copy a passing version from a staging copy of SAMPLE into SAMPLE and make it current (its compliance is
        rechecked with today's rules first, keeping its open architect's notes; refuses a version with any LDA or livable
        fail, and with --strict also any warning or major architect's note). The staging passes after the sample's current
        version are folded into it (their changes, in order; parent = the sample's current version).
    uv run python scripts/promote_round2.py chat SAMPLE [--apply]
        BE2-03: the setup reply in the current voice, the "Here's what I understood" card rebuilt from the brief, and
        corner_stated on the brief (both sample messages say "mid-row").
    uv run python scripts/promote_round2.py verify SAMPLE

Only projects in the samples workspace are touched; nothing is deleted (old images and versions stay for rollback).
"""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

from app.agents import architect, intake
from app.compliance import lda
from app.store import blobs, db

APPLY = "--apply" in sys.argv
STRICT = "--strict" in sys.argv  # version: also refuse any warning or a major architect's note (not only failures)
SUMMARY = next((a.split("=", 1)[1] for a in sys.argv if a.startswith("--summary=")), "Updated to today's rules")
TAG = next((a.split("=", 1)[1] for a in sys.argv if a.startswith("--tag=")), "r2")  # concept: the new files' suffix
ARGS = [a for a in sys.argv[1:] if a not in ("--apply", "--strict") and not a.startswith(("--summary=", "--tag="))]

# Round 4 (BE-F1): each sample concept's caption (concept.summary) in plain British English, about 12 words.
CAPTIONS = {
    "p_5a5893a2bcaa": {
        "c_1f43b123ec11": "A floating upper floor in stone and warm timber slats over the car porch.",
        "c_0026dc7358eb": "A tall travertine wall beside recessed glass behind a vertical teak screen.",
        "c_4333ea54cc2c": "Stepped white volumes with a planted first-floor terrace and slim steel frames.",
        "c_509c756d9b65": "Interlocking brick blocks with a brick jaali screen over the upper windows.",
    },
    "p_1a42e70989af": {
        "c_ffb82b39c6a0": "A stucco stair tower and rubble-stone base frame a calm cream facade.",
        "c_25ba8b60d59f": "A deep two-storey front veranda with timber beams and smooth plaster walls.",
        "c_4b551383383d": "Stepped off-white plaster blocks with terracotta eaves and a two-car porch.",
        "c_44a512ecc5c9": "Ground-floor stucco arches carry a shaded upper terrace with iron balconies.",
    },
}


def say(*a):
    print(("APPLY " if APPLY else "DRY   ") + " ".join(str(x) for x in a))


async def sample(pid: str) -> dict:
    p = await db.get_project(pid)
    if not p or p.get("owner") != db.SAMPLES_OWNER:
        raise SystemExit(f"{pid}: not a sample")
    return p


async def concept(pid: str, cid: str, day: str, night: str):
    p = await sample(pid)
    cs = p.get("concepts") or []
    c = next((c for c in cs if c["id"] == cid), None)
    if not c:
        raise SystemExit(f"{cid}: no such concept on {pid}")
    folder = c["url"].removeprefix("/api/assets/").rsplit("/", 1)[0]
    day_path, night_path = f"{folder}/{cid}-{TAG}.png", f"{folder}/{cid}-{TAG}-night.png"
    say("concept", cid, c.get("title"), ":", c["url"], "->", f"/api/assets/{day_path}")
    say("        night:", c.get("night_url"), "->", f"/api/assets/{night_path}")
    say("        thumbnail moves:", p.get("thumbnail_url") == c["url"], "| selected:", p.get("selected_concept_id"))
    for path in (day_path, night_path):  # never overwrite a stored image (rollback keeps every earlier one)
        if await blobs.get(path):
            raise SystemExit(f"{path} already exists: pass another --tag=")
    if not APPLY:
        return
    day_url = await blobs.put(day_path, Path(day).read_bytes(), "image/png")
    night_url = await blobs.put(night_path, Path(night).read_bytes(), "image/png")
    new = {**c, "url": day_url, "night_url": night_url, "previous_url": c["url"], "previous_night_url": c.get("night_url"),
           "edited": f"mid-row: neighbours built against both side walls, one road in front ({TAG})"}
    fields = {"concepts": [new if x["id"] == cid else x for x in cs]}
    if p.get("thumbnail_url") == c["url"]:
        fields["thumbnail_url"] = day_url
    await db.update_project(pid, **fields)
    say("done; selected concept is still", p.get("selected_concept_id"))


# Round 4 (BE-F5): the Brief's per-floor program names the upstairs master (the app's format: master_bedroom:1, bedroom:2).
FLOORS = {
    "p_5a5893a2bcaa": {"first": ["master_bedroom:1", "bedroom:2", "bath:3"]},
    "p_1a42e70989af": {"first": ["master_bedroom:1", "bedroom:2", "bath:3"]},
}


async def floors(pid: str):
    """brief.floors from FLOORS (only the levels named there), re-checked against the current version (no new fails)."""
    p = await sample(pid)
    brief = {**(p.get("brief") or {})}
    new = [{**f, "rooms": FLOORS[pid][f["level"]]} if f.get("level") in FLOORS.get(pid, {}) else f for f in brief.get("floors") or []]
    for a, b in zip(brief.get("floors") or [], new):
        if a != b:
            say("floors", a.get("level"), a.get("rooms"), "->", b.get("rooms"))
    v = await db.get_version(pid, p["current_version_id"])
    before, after = lda.check(v["plan"], brief), lda.check(v["plan"], {**brief, "floors": new})
    bad = [c["id"] for c in after["checks"] if c["status"] != "pass" and c["id"] not in
           {x["id"] for x in before["checks"] if x["status"] != "pass"}]
    say("current version", v["id"], lda.status_line(after), "new problems:", bad)
    if bad:
        raise SystemExit("refusing floors that add a problem on the current version")
    if not APPLY:
        return
    await db.update_project(pid, brief={**brief, "floors": new}, envelope=intake.envelope_for({**brief, "floors": new}))
    say("done")


async def captions(pid: str):
    """Plain captions (concept.summary) for the sample's concepts, from CAPTIONS; titles, images and ids stay."""
    p = await sample(pid)
    plain = CAPTIONS.get(pid) or {}
    cs = p.get("concepts") or []
    for c in cs:
        if c["id"] in plain:
            say("caption", c["id"], c.get("title"), ":", json.dumps(c.get("summary")), "->", json.dumps(plain[c["id"]]))
    missing = set(plain) - {c["id"] for c in cs}
    if missing:
        raise SystemExit(f"no such concepts on {pid}: {sorted(missing)}")
    if not APPLY:
        return
    await db.update_project(pid, concepts=[{**c, "summary": plain[c["id"]], "previous_summary": c.get("summary")}
                                           if c["id"] in plain else c for c in cs])
    say("done")


def recheck(v: dict, brief: dict | None) -> dict:
    """Today's rules on the plan, plus the version's open architect's notes (a note that repeats an open rule is dropped):
    the honest report the sample will show."""
    rep = lda.check(v["plan"], brief)
    rows = [c for c in (v.get("compliance") or {}).get("checks", []) if lda.is_review(c) and c.get("status") != "pass"]
    return {**rep, "checks": rep["checks"] + architect.tidy_notes(rows, v["plan"], rep)}


async def version(pid: str, staging: str, vid: str):
    p = await sample(pid)
    s = await db.get_project(staging)
    if not s or s.get("cloned_from") != pid:
        raise SystemExit(f"{staging}: not a copy of {pid}")
    v = await db.get_version(staging, vid)
    if not v:
        raise SystemExit(f"{vid}: no such version on {staging}")
    rep = recheck(v, p.get("brief"))
    fails = [c["id"] for c in rep["checks"] if c["status"] == "fail"]
    warns = [c["id"] for c in rep["checks"] if c["status"] == "warn" and not lda.is_review(c)]
    majors = [c["id"] for c in rep["checks"] if lda.is_review(c) and c.get("severity") == "major"]
    say("version", vid, f"v{v.get('n')}", "recheck", lda.counts(rep), "fails", fails, "warns", warns, "major notes", majors)
    if fails:
        raise SystemExit("refusing a version with failures")
    if STRICT and (warns or majors):
        raise SystemExit("--strict: refusing a version with warnings or major architect's notes")
    known = {x["id"] for x in p.get("versions") or []}
    n = max([x.get("n") or 0 for x in p.get("versions") or []] + [0]) + 1
    entry = next((x for x in s.get("versions") or [] if x["id"] == vid), None) or {"id": vid}
    # the staging passes between the sample's current version and this one become one version: all their changes, in order
    chain, cur = [], v
    while cur and cur["id"] not in known:
        chain.insert(0, cur)
        cur = await db.get_version(staging, cur.get("parent_id")) if cur.get("parent_id") else None
    changes = [{**ch, "id": f"ch{i + 1}"} for i, ch in enumerate(ch for x in chain for ch in x.get("changes") or [])]
    entry = {**entry, "n": n, "summary": f"{SUMMARY} · {lda.status_line(rep)}"}
    say("sample", pid, p["name"], ": versions", [x["id"] for x in p.get("versions") or []], "+", entry)
    say("changes from", [x["id"] for x in chain], ":", [ch.get("summary") for ch in changes])
    if not APPLY:
        return
    await db.save_version(pid, {**v, "n": n, "compliance": rep, "promoted_from": staging, "changes": changes,
                                "parent_id": p.get("current_version_id"), "summary": entry["summary"]})
    fields = {"versions": [x for x in p.get("versions") or [] if x["id"] != vid] + [entry], "current_version_id": vid,
              "stage": "ready", "brief_changed": False}
    if v.get("thumbnail_url"):
        fields["thumbnail_url"] = v["thumbnail_url"]
    await db.update_project(pid, **fields)
    say("done:", pid, "current", vid, "(was", p.get("current_version_id"), ")", "already had it" if vid in known else "")


async def chat(pid: str):
    p = await sample(pid)
    brief = {**(p.get("brief") or {})}
    msgs = await db.list_messages(pid)
    first_user = next((m for m in msgs if m["role"] == "user"), {})
    said_corner = any(w in (first_user.get("text") or "").lower() for w in ("mid-row", "midrow", "mid row", "corner"))
    if said_corner and brief.get("corner_stated") is not True:
        brief["corner_stated"] = True
        brief["auto_filled"] = [a for a in brief.get("auto_filled") or [] if a != "corner"]
        say("brief: corner_stated -> True")
    reply = next((m for m in msgs if m["role"] == "assistant" and m.get("understood")), None)
    if not reply:
        raise SystemExit("no setup reply with a card")
    text = intake._complete_text({}, brief)
    sugg = intake._complete_suggestions({}, brief)
    card = intake.understood(brief)
    say("reply", reply["id"], ":", json.dumps(reply.get("text")), "->", json.dumps(text))
    say("suggestions", reply.get("suggestions"), "->", sugg)
    say("card assumptions", card["assumptions"], "| preferences", card["preferences"][:4], "…")
    if not APPLY:
        return
    await db.put_message(pid, {**reply, "text": text, "suggestions": sugg, "understood": card})
    if brief != p.get("brief"):
        await db.update_project(pid, brief=brief)
    else:
        await db.update_project(pid)  # bump updated_at so untouched copies refresh
    say("done")


async def verify(pid: str):
    p = await sample(pid)
    v = await db.get_version(pid, p["current_version_id"])
    rep = recheck(v, p.get("brief"))
    print(json.dumps({"id": pid, "name": p["name"], "current": p["current_version_id"], "n": v.get("n"),
                      "summary": next((x.get("summary") for x in p.get("versions") or [] if x["id"] == v["id"]), None),
                      "status_line": lda.status_line(rep),
                      "stored": lda.counts(v["compliance"]), "recheck": lda.counts(rep),
                      "stored_equals_recheck": lda.counts(v["compliance"]) == lda.counts(rep),
                      "fails": [c["id"] for c in rep["checks"] if c["status"] == "fail"],
                      "warns": [c["id"] for c in rep["checks"] if c["status"] == "warn" and not lda.is_review(c)],
                      "notes": [(c["id"], c.get("severity"), c["message"]) for c in rep["checks"] if lda.is_review(c)],
                      "concepts": [(c["id"], c.get("title"), c["url"], c.get("night_url")) for c in p.get("concepts") or []],
                      "corner_stated": (p.get("brief") or {}).get("corner_stated")}, indent=1, ensure_ascii=False))


if __name__ == "__main__":
    cmd = ARGS[0]
    fn = {"concept": concept, "captions": captions, "floors": floors, "version": version, "chat": chat, "verify": verify}[cmd]
    asyncio.run(fn(*ARGS[1:]))
