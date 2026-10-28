"""Revision: walkthrough comments and/or a typed request → plan edits + code-section edits → checks → new Version.

reviser_adk.py (an ADK tool-using agent) is the main path; `revise` here is the single-shot safety net. Both share
`finalize`, which saves the version, records each comment's resolution and posts it as a reply from Naqsha in the thread.
Plan edits must not add any LDA or livability failure that the version didn't already have.
"""
from __future__ import annotations

import copy
import json
import logging
import re
from typing import AsyncIterator

from google.genai import types

from .. import config, llm
from ..compliance import lda, planning
from ..store import blobs, db
from .architect import BUILD_SYSTEM, CONTRACTS, _read, _status, changed_rooms, prepare, tidy_notes

log = logging.getLogger("naqsha.reviser")
NAQSHA = {"id": "naqsha", "name": "Naqsha", "role": "agent"}

# How Naqsha answers, and the rooms and roof areas it must not quietly take away (BE-F8; both revisers).
ANSWER_RULES = """- Each resolution says what changed in one or two sentences, sizes in feet and inches (10′, 12′ × 14′6″). Never claim a
  check you didn't run: say a rule passes only when the plan check said so, and never say the roof stays clear for solar if
  anything now stands on it.
- Dressing rooms: at least 5′ across and 25 sq ft, with one solid wall at least 4′ long (no door or window in it) for the
  wardrobe. Never grow a bedroom into its dressing; take the space from elsewhere, or say why not.
- Roof additions (pergola, canopy, seating, planters): place them outside the SOLAR AREA and say where they stand; if one has to
  overlap it, say how many sq ft of the solar area it takes."""

REVISE_SYSTEM = """You are Naqsha's architect, revising a house design after the family's 3D walkthrough. Each comment is pinned
to a spot in the 3D model (room, element, level) and comes with a snapshot of what they were looking at. A REQUEST is a change
the family typed without a pin.

Return ONE JSON object:
{
  "changes": [{"id": "ch1", "summary": "Enlarged the master bedroom window to 10 ft", "kind": "plan" | "section",
               "targets": ["f_master_w1"], "comment_ids": ["..."]}],
  "plan_ops": [ // edits to the BuildingPlan (feet, same conventions); omit or [] when the layout doesn't change
     {"op": "upsert", "collection": "rooms" | "openings" | "stairs" | "levels", "item": { ...full object with id... }},
     {"op": "remove", "collection": "rooms" | "openings" | "stairs" | "levels", "id": "..."},
     {"op": "set", "path": "roof.parapet_ft" | "site.boundary_wall.front_height_ft" | "style.palette" | ..., "value": ...}
  ],
  "sections": [ // design.js sections to ADD or REPLACE (full code of each), same rules as the original design.js
     {"name": "furnish_f_master", "layer": "furniture", "code": "..."}
  ],
  "remove_sections": ["custom_old_pergola"],
  "resolutions": [{"comment_id": "...", "status": "resolved" | "partial" | "rejected",
                   "resolution": "One or two friendly sentences: what changed, or why not (cite the rule) and the alternative."}]
}

Rules:
- Address EVERY comment with exactly one resolution (the REQUEST has comment_id "request").
- Prefer the smallest change that satisfies the comment. Keep everything else identical.
- Layout changes are plan_ops and must keep every LDA rule and livability rule (bedrooms open onto circulation, one door per
  bath, stairs with landings reaching the roof under the stair tower). If a request would break a rule, don't do it: mark it
  "rejected" (or "partial" with a compliant alternative) and name the rule in plain words.
- Visual changes (materials, colours, furniture, facade details, lighting) replace the relevant design.js sections.
- If you change a room's size or position, also replace its furnish_<room_id> section so the furniture fits.
- The `structure` section rebuilds walls, openings, stairs and slabs from the plan automatically.
- EARLIER ANSWERS stay: don't undo what an earlier comment or request got unless the new one conflicts; then say which one
  and why in its resolution.
""" + ANSWER_RULES


def apply_ops(plan: dict, ops: list[dict]) -> dict:
    p = copy.deepcopy(plan)
    for op in ops or []:
        kind = op.get("op")
        if kind in ("upsert", "remove"):
            col = p.setdefault(op.get("collection", "rooms"), [])
            oid = (op.get("item") or {}).get("id") if kind == "upsert" else op.get("id")
            idx = next((i for i, x in enumerate(col) if x.get("id") == oid), None)
            if kind == "remove":
                if idx is not None:
                    col.pop(idx)
            elif idx is not None:
                col[idx] = {**col[idx], **op["item"]}
            else:
                col.append(op["item"])
        elif kind == "set" and op.get("path"):
            cur, keys = p, op["path"].split(".")
            for k in keys[:-1]:
                cur = cur.setdefault(k, {})
            cur[keys[-1]] = op.get("value")
    return p


def merge_sections(old: list[dict], new: list[dict], remove: list[str]) -> list[dict]:
    out = [s for s in old if s["name"] not in set(remove or [])]
    order = {s["name"]: i for i, s in enumerate(out)}
    for s in new or []:
        s = {"name": s["name"], "layer": s.get("layer", "custom"), "code": s.get("code", "")}
        if s["name"] in order:
            out[order[s["name"]]] = s
        else:
            # keep canonical ordering: insert before landscape/lighting for furniture/facade/interior/custom
            tail = next((i for i, x in enumerate(out) if x["name"] in ("landscape", "lighting")), len(out))
            out.insert(tail, s)
            order = {x["name"]: i for i, x in enumerate(out)}
    return out


def fail_ids(report: dict) -> set[str]:
    return {c["id"] for c in (report or {}).get("checks", []) if c["status"] == "fail"}


def new_failures(base: dict, cand: dict) -> list[dict]:
    """Failures in `cand` that the base version didn't have (a revision may never add one)."""
    old = fail_ids(base)
    return [c for c in cand.get("checks", []) if c["status"] == "fail" and c["id"] not in old]


def reading_line(comments: list[dict], instruction: str | None) -> str:
    """The first narration line: "Reading your request…", "Reading your 2 notes…", "Reading your note and your request…"."""
    n = len(comments)
    notes = (f"your {n} notes" if n > 1 else "your note") if n else ""
    what = " and ".join(x for x in (notes, "your request" if instruction else "") if x)
    return f"Reading {what or 'the design'}…"


def pseudo_request(instruction: str) -> dict:
    return {"id": "request", "text": instruction, "anchor": {}, "status": "open"}


async def snapshot_parts(comments: list[dict]) -> list:
    parts: list = []
    for c in comments[:8]:  # snapshots give the architect the view the family had
        if c.get("snapshot_url"):
            got = await blobs.get(c["snapshot_url"].removeprefix("/api/assets/"))
            if got:
                parts += [types.Part.from_text(text=f"Snapshot for comment {c['id']}:"), types.Part.from_bytes(data=got[0], mime_type=got[1])]
    return parts


def comment_brief(comments: list[dict]) -> list[dict]:
    return [{"id": c["id"], "text": c["text"], "where": {k: (c.get("anchor") or {}).get(k) for k in ("level", "room", "element_id", "kind", "label")
                                                         if (c.get("anchor") or {}).get(k)},
             **({"replies": [r.get("text") for r in c.get("replies") or []][-3:]} if c.get("replies") else {})} for c in comments]


def note_addressed(note: dict, changed: set[str]) -> bool:
    """Whether a revision changed what a review note is about: at least half of the rooms it names (a door moved on one of
    three rooms is not an answer), or anything at all when it names none."""
    rooms = [r for r in note.get("element_ids") or [] if isinstance(r, str)]
    if not changed:
        return False
    if not rooms:
        return True
    return 2 * len(set(rooms) & changed) >= len(set(rooms))


def carry_review_notes(version: dict, plan: dict, report: dict) -> dict:
    """The architect's open review notes (review.<n> warnings) stay on the revised version unless the revision changed what
    they are about, so the house never looks all-clear while they are still open."""
    notes = [c for c in (version.get("compliance") or {}).get("checks", []) if lda.is_review(c)]
    if not notes:
        return report
    changed = changed_rooms(version.get("plan") or {}, plan)
    keep = [c for c in notes if not note_addressed(c, changed)]
    rest = [c for c in report.get("checks", []) if not lda.is_review(c)]
    return {**report, "checks": rest + tidy_notes(keep, plan, {"checks": rest})}


# --- earlier answers: what the family already agreed stays agreed (BE-F3) -------------------------------------------------------
async def lineage(pid: str, version: dict, limit: int = 40) -> list[dict]:
    """The version and its ancestors (parent_id), newest first."""
    out, cur, seen = [], version, set()
    while cur and cur.get("id") not in seen and len(out) < limit:
        out.append(cur)
        seen.add(cur["id"])
        cur = await db.get_version(pid, cur["parent_id"]) if cur.get("parent_id") else None
    return out


async def earlier_answers(pid: str, chain: list[dict]) -> list[dict]:
    """Every comment resolved (or partly) in the lineage, with Naqsha's answer, the version that answered it (`n`) and the
    plan elements that version changed for it (`targets`: its changes' targets, and the element the comment was pinned to)."""
    by_id = {v["id"]: v for v in chain}
    out = []
    for c in await db.list_comments(pid):
        v = by_id.get(c.get("resolved_in_version") or "")
        if not v or c.get("status") not in ("resolved", "partial") or c.get("kind") == "approval":
            continue
        targets = [t for ch in v.get("changes") or [] if c["id"] in (ch.get("comment_ids") or []) for t in ch.get("targets") or []]
        if (el := (c.get("anchor") or {}).get("element_id")):
            targets.append(el)
        out.append({**c, "n": v.get("n"), "targets": list(dict.fromkeys(t for t in targets if isinstance(t, str)))})
    return out


def earlier_requests(chain: list[dict]) -> list[dict]:
    """The typed requests in the lineage and their answers (oldest first)."""
    return [{"n": v.get("n"), "instruction": (v.get("source") or {}).get("instruction"), "answer": (v.get("source") or {}).get("answer")}
            for v in reversed(chain) if (v.get("source") or {}).get("instruction")]


def answers_text(answers: list[dict], requests: list[dict]) -> str:
    """The reviser's context: what earlier versions already promised."""
    lines = []
    for a in answers:
        who = (a.get("author") or {}).get("name") or "the family"
        lines.append(f"- v{a.get('n')}, {who} ({a.get('status')}): “{a.get('text')}” → “{a.get('resolution') or ''}”"
                     + (f" (changed: {', '.join(a['targets'])})" if a.get("targets") else ""))
    for r in requests:
        lines.append(f"- v{r.get('n')}, a typed request: “{r.get('instruction')}”" + (f" → “{r['answer']}”" if r.get("answer") else ""))
    if not lines:
        return ""
    return ("EARLIER ANSWERS (keep these unless the new request conflicts; if it does, say which one and why):\n"
            + "\n".join(lines[-20:]) + "\n\n")


def solar_text(plan: dict) -> str:
    """The solar keep-clear area for the reviser (plan.roof.solar.rect, or the clear roof when no rect is drawn)."""
    solar = (plan.get("roof") or {}).get("solar") or {}
    if not solar.get("mode"):
        return ""
    r = solar.get("rect")
    if isinstance(r, dict) and all(k in r for k in ("x", "y", "w", "d")):
        x, y, w, d = (float(r[k]) for k in ("x", "y", "w", "d"))
        where = (f"x {x:g}–{x + w:g} ft, y {y:g}–{y + d:g} ft ({planning.fmt(w)} × {planning.fmt(d)}, {w * d:.0f} sq ft)")
    else:
        try:
            free, _ = planning.roof_free_area(planning.PlanIndex(plan))
        except Exception:
            free = 0.0
        where = f"the whole roof except the stair tower and the tank (about {free:.0f} sq ft clear now)"
    return (f"SOLAR AREA (roof, solar {solar['mode']}): {where}. Keep it clear: no pergola, canopy, room, tank or seating "
            f"there.\n")


async def context_text(pid: str, version: dict) -> str:
    """EARLIER ANSWERS for the reviser's prompt (empty when there are none, or when reading them fails)."""
    try:
        chain = await lineage(pid, version)
        return answers_text(await earlier_answers(pid, chain), earlier_requests(chain))
    except Exception:
        log.exception("reading earlier answers failed")
        return ""


OPENING_WORDS = ("window", "glass", "glazing", "door", "slider", "sliding", "ventilator", "opening", "arch")


GENERIC = {"room", "rooms", "bedroom", "bath", "bathroom", "kitchen", "lounge", "hall", "space", "area", "floor", "open", "the",
            "and", "with", "first", "ground", "upper", "lower", "front", "back", "rear", "side", "main"}


def _mentioned(plan: dict, text: str, seed: set[str]) -> set[str]:
    """Rooms and openings a piece of text asks about: ids written out, rooms by name or by a distinctive word of their name
    ("master" for Master Bedroom), and the openings of those rooms (and of `seed`) when it talks about a window or door."""
    text = (text or "").lower()
    ids = set(seed)
    if not text:
        return ids
    words = set(re.findall(r"[a-z0-9']+", text))
    for r in plan.get("rooms") or []:
        name = str(r.get("name") or "").lower()
        own = {w for w in re.findall(r"[a-z0-9']+", name) if len(w) >= 4 and w not in GENERIC}
        if r.get("id") and (r["id"].lower() in text or (name and name in text) or own & words):
            ids.add(r["id"])
    ids |= {o["id"] for o in plan.get("openings") or [] if o.get("id") and o["id"].lower() in text}
    if any(w in OPENING_WORDS or w[:-1] in OPENING_WORDS or w[:-2] in OPENING_WORDS for w in words):
        ids |= {o["id"] for o in plan.get("openings") or [] if o.get("id") and set(o.get("between") or []) & ids}
    return ids


def targeted_now(plan: dict, comments: list[dict], instruction: str | None) -> set[str]:
    """What this run was asked to change (never what the agent says it changed): each comment's pin (room and element) and
    what its text names, and what the typed request names. Erring wide only means fewer things are put back."""
    ids: set[str] = set()
    for c in comments:
        a = c.get("anchor") or {}
        pin = {x for x in (a.get("room"), a.get("element_id")) if isinstance(x, str)}
        ids |= _mentioned(plan, str(c.get("text") or ""), pin)
    return ids | _mentioned(plan, instruction or "", set())


def _area(r: dict) -> float:
    rect = r.get("rect") or {}
    return float(rect.get("w") or 0) * float(rect.get("d") or 0)


def shrunk(parent: dict, plan: dict, ids: set[str]) -> list[tuple[str, str, dict, dict]]:
    """Openings narrower and rooms smaller than in the parent plan, among `ids`: (kind, id, before, after)."""
    out = []
    for col, size in (("openings", lambda o: float(o.get("width_ft") or 0)), ("rooms", _area)):
        old = {x.get("id"): x for x in parent.get(col) or []}
        for x in plan.get(col) or []:
            o = old.get(x.get("id"))
            if o and x["id"] in ids and size(x) + 1e-6 < size(o):
                out.append((col, x["id"], o, x))
    return out


def element_name(plan: dict, col: str, el: dict) -> str:
    """"the window between Master Bedroom and the balcony" / "master bedroom": never an id."""
    if col == "openings":
        return planning.PlanIndex(plan).oname(el)
    return planning.in_sentence(el.get("name") or str(el.get("type") or "room").replace("_", " "))


def size_text(col: str, el: dict) -> str:
    if col == "openings":
        return planning.fmt(float(el.get("width_ft") or 0))
    r = el.get("rect") or {}
    return f"{planning.fmt(float(r.get('w') or 0))} × {planning.fmt(float(r.get('d') or 0))}"


def keep_earlier(parent: dict, plan: dict, report: dict, brief: dict, answers: list[dict], comments: list[dict],
                 instruction: str | None) -> tuple[dict, dict, list[dict], list[dict]]:
    """The guard after the plan is revised: a window narrowed or a room made smaller that an earlier answered comment had
    changed, and that nothing in this run asked for, is put back as it was in the parent (re-checked: only when that adds
    no failure or warning). Returns (plan, report, restored, kept): kept are the ones a rule forced, each with the earlier
    comment it touches, for a reply in that thread."""
    owners: dict[str, dict] = {}
    for a in sorted(answers, key=lambda a: a.get("n") or 0):  # the latest answer about an element speaks for it
        for t in a.get("targets") or []:
            owners[t] = a
    asked = targeted_now(plan, comments, instruction)
    restored, kept = [], []
    for col, eid, before, after in shrunk(parent, plan, set(owners) - asked):
        cand = copy.deepcopy(plan)
        items = cand.get(col) or []
        i = next(k for k, x in enumerate(items) if x.get("id") == eid)
        items[i] = ({**items[i], "width_ft": before.get("width_ft"), "at": before.get("at", items[i].get("at"))}
                    if col == "openings" else {**items[i], "rect": copy.deepcopy(before.get("rect"))})
        rep = lda.check(cand, brief)
        bad = {c["id"] for c in report.get("checks", []) if c["status"] in ("fail", "warn")}
        worse = [c for c in rep["checks"] if c["status"] in ("fail", "warn") and c["id"] not in bad and not lda.is_review(c)]
        item = {"col": col, "id": eid, "before": before, "after": after, "comment": owners[eid],
                "name": element_name(parent, col, before), "was": size_text(col, before), "now": size_text(col, after)}
        if worse:
            kept.append({**item, "why": worse[0].get("message", "")})
        else:
            plan, report = cand, {**rep, "checks": rep["checks"] + [c for c in report.get("checks", []) if lda.is_review(c)]}
            restored.append(item)
    return plan, report, restored, kept


def kept_reply(k: dict, n: int, instruction: str | None) -> str:
    """Naqsha's note in the earlier thread: "Version 4 narrowed the master bedroom window to 8′ (it was 10′) …"."""
    verb = "narrowed" if k["col"] == "openings" else "made"
    what = f"{k['name']} to {k['now']}" if k["col"] == "openings" else f"{k['name']} smaller ({k['now']})"
    why = f" to make “{instruction[:80]}” work" if instruction else ""
    return f"Version {n} {verb} {what}{why} (it was {k['was']}); keeping it as it was would break a rule: {k['why']}"


async def finalize(project: dict, version: dict, plan: dict, sections: list[dict], report: dict, changes: list[dict],
                   resolutions: dict[str, dict], comments: list[dict], instruction: str | None,
                   agent: str) -> AsyncIterator[tuple[str, dict]]:
    """Save the revised version, resolve each comment and post the resolution as a reply from Naqsha. Earlier answers are
    kept: a window or room an earlier comment had changed is put back if this run shrank it without being asked, or the
    earlier thread is told why not."""
    pid = project["id"]
    real = {c["id"] for c in comments}
    for ch in changes:  # the typed request isn't a comment: flag it instead of counting it
        ids = list(ch.get("comment_ids") or [])
        if "request" in ids or (instruction and not ids):
            ch["from_request"] = True
        ch["comment_ids"] = [i for i in ids if i in real]
    restored: list[dict] = []
    kept: list[dict] = []
    if plan is not version.get("plan") and plan != version.get("plan"):
        try:
            answers = await earlier_answers(pid, await lineage(pid, version))
            if answers:
                plan, report, restored, kept = keep_earlier(version["plan"], plan, report, project.get("brief") or {}, answers,
                                                            comments, instruction)
                if restored:
                    yield "plan", {"plan": plan, "attempt": 1}
                    yield "compliance", {"report": report, "attempt": 1}
        except Exception:  # the guard never sinks a revision
            log.exception("keeping earlier answers failed")
    yield "changes", {"changes": changes}
    report = carry_review_notes(version, plan, report)
    yield "stage", {"stage": "save", "message": "Saving the revised version…"}
    fresh = await db.get_project(pid)
    n = len(fresh.get("versions") or []) + 1
    req = resolutions.get("request")
    if instruction and req is not None and (restored or kept):
        extra = [f"I kept {r['name']} at {r['was']}, as agreed on an earlier comment." for r in restored] + \
                [f"To make room, {k['name']} is now {k['now']} (it was {k['was']}); I've said so on that earlier comment."
                 for k in kept]
        req["resolution"] = " ".join([str(req.get("resolution") or "").strip()] + extra).strip()
    answer = (req or {}).get("resolution") if instruction else None
    src = (f"From {len(comments)} comment{'s' if len(comments) != 1 else ''}" if comments else "") + \
          ((" and your request" if comments else f"“{instruction[:60]}”") if instruction else "")
    summary = f"{src} · {_status(report)}" if src else _status(report)
    new_v = {"id": db.new_id("v_"), "n": n, "created_at": db.now(), "parent_id": version["id"], "plan": plan, "sections": sections,
             "compliance": report, "changes": changes, "status": "ready", "agent": agent, "summary": summary,
             "source": {"comment_ids": [c["id"] for c in comments], "instruction": instruction,
                        **({"answer": answer} if answer else {})}}
    await db.save_version(pid, new_v)
    for c in comments:
        r = resolutions.get(c["id"]) or {"status": "partial", "resolution": "I looked at this; no change was needed."}
        status = r.get("status") if r.get("status") in ("resolved", "partial", "rejected") else "partial"
        reply = {"id": db.new_id("rp_"), "author": NAQSHA, "text": r.get("resolution") or "", "created_at": db.now(),
                 "status": status, "version_id": new_v["id"]}
        await db.update_comment(pid, c["id"], status=status, resolution=r.get("resolution"), resolved_in_version=new_v["id"])
        upd = await db.add_reply(pid, c["id"], reply)
        if upd:
            yield "comment", {"comment": upd}
    for k in kept:  # the earlier thread hears what changed and why
        reply = {"id": db.new_id("rp_"), "author": NAQSHA, "text": kept_reply(k, n, instruction), "created_at": db.now(),
                 "status": k["comment"].get("status"), "version_id": new_v["id"]}
        upd = await db.add_reply(pid, k["comment"]["id"], reply)
        if upd:
            yield "comment", {"comment": upd}
    if instruction and req:
        yield "stage", {"stage": "changes", "message": req.get("resolution") or "Done."}
    await db.update_project(pid, versions=(fresh.get("versions") or []) + [{"id": new_v["id"], "n": n, "created_at": new_v["created_at"],
                                                                           "status": "ready", "summary": summary}],
                            current_version_id=new_v["id"], stage="ready", brief_changed=False)
    # Comments left out of this revision (unticked, or posted while it ran) stay open: they follow the new version so they
    # can still be seen and applied. The current version moves first, so a note posted now lands on the new one anyway.
    parents = {version["id"], fresh.get("current_version_id")} - {None, new_v["id"]}
    for vid in parents:
        try:
            await db.move_open_comments(pid, vid, new_v["id"])
        except Exception:
            log.exception("moving open comments from %s failed", vid)
    yield "version", {"version": new_v}


async def revise(project: dict, version: dict, comments: list[dict], instruction: str | None = None) -> AsyncIterator[tuple[str, dict]]:
    """Single-shot revision (the safety net when the ADK agent fails)."""
    pid = project["id"]
    brief = project.get("brief") or {}
    await db.update_project(pid, stage="revising")
    yield "stage", {"stage": "changes", "message": reading_line(comments, instruction)}
    parts = await snapshot_parts(comments)
    env = lda.envelope(brief["plot"]["width_ft"], brief["plot"]["depth_ft"], brief.get("authority") or "LDA") if brief.get("plot") else {}
    env.pop("_band", None)
    sections_txt = "\n".join(f"// @section {s['name']} [{s['layer']}]\n{s['code']}// @end" for s in version["sections"])
    cm = comment_brief(comments)
    earlier = await context_text(pid, version)
    prompt = (f"HOUSE SDK REFERENCE:\n{_read(CONTRACTS / 'house-sdk.d.ts')}\n\nLDA ENVELOPE: {json.dumps(env)}\n\n"
              f"CURRENT PLAN:\n{json.dumps(version['plan'], separators=(',', ':'))}\n\nCURRENT design.js:\n{sections_txt}\n\n"
              + solar_text(version["plan"]) + earlier
              + (f"WALKTHROUGH COMMENTS:\n{json.dumps(cm, indent=1)}\n\n" if cm else "")
              + (f"REQUEST (comment_id \"request\"): {instruction}\n\n" if instruction else "") + "Return the revision JSON now.")
    system = REVISE_SYSTEM + "\n\n" + BUILD_SYSTEM.split("Rules:")[-1]
    rev: dict = {}
    async for kind, val in llm.stream_json(config.MODEL_ARCHITECT, [types.Content(role="user", parts=parts + [types.Part.from_text(text=prompt)])],
                                           system, max_tokens=65536):
        if kind == "progress":
            yield "progress", {"chars": val}
        else:
            rev = val[0]
    changes = rev.get("changes") or []
    plan = version["plan"]
    base = lda.check(plan, brief)
    report = base
    resolutions = {r["comment_id"]: r for r in rev.get("resolutions") or [] if r.get("comment_id")}
    if rev.get("plan_ops"):
        yield "stage", {"stage": "compliance", "message": "Checking the changed layout against the LDA and livability rules…"}
        candidate, _ = prepare(apply_ops(plan, rev["plan_ops"]), brief)
        cand_report = lda.check(candidate, brief)
        broken = new_failures(base, cand_report)
        if not broken:
            plan, report = candidate, cand_report
        else:  # roll back plan edits and explain
            why = "; ".join(c["message"] for c in broken)[:400]
            for ch in changes:
                if ch.get("kind") == "plan":
                    for cid in ch.get("comment_ids", []) or ["request"]:
                        resolutions[cid] = {"comment_id": cid, "status": "rejected",
                                            "resolution": f"I couldn't make this layout change without breaking a rule: {why}"}
            changes = [ch for ch in changes if ch.get("kind") != "plan"]
        yield "plan", {"plan": plan, "attempt": 1}
        yield "compliance", {"report": report, "attempt": 1}
    sections = merge_sections(version["sections"], rev.get("sections") or [], rev.get("remove_sections") or [])
    changed = {s["name"] for s in rev.get("sections") or []}
    for i, s in enumerate(sections):
        if s["name"] in changed:
            yield "section", {"section": s, "index": i}
    async for ev in finalize(project, version, plan, sections, report, changes, resolutions, comments, instruction, "single"):
        yield ev
