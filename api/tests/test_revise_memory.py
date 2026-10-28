"""A revision keeps what earlier comments got (BE-F3) and answers in plain feet and inches (BE-F8). No model calls."""
import asyncio
import copy

from app.agents import reviser, reviser_adk
from app.compliance import lda, planning
from app.store import db
from conftest import load

WARDROBE = "make the master dressing room big enough for a proper wardrobe"


def _plans():
    parent = load("plan-sample-10-marla-r3.json")       # v3: the master glass (f_master_slide) is 9 ft after Sana's comment
    narrowed = copy.deepcopy(parent)                      # v4's draft: the agent narrowed it to 7 ft for the wardrobe
    next(o for o in narrowed["openings"] if o["id"] == "f_master_slide")["width_ft"] = 7
    return parent, narrowed


SANA = {"id": "cm_sana", "text": "Can the master bedroom glass to the balcony be wider?", "status": "resolved", "n": 3,
        "resolution": "The master glass is now 9 ft.", "author": {"name": "Sana"}, "targets": ["f_master_slide"],
        "anchor": {"room": "f_master"}}


def _slide(plan):
    return next(o for o in plan["openings"] if o["id"] == "f_master_slide")["width_ft"]


def test_what_this_run_was_asked_for():
    plan = load("plan-sample-10-marla-r3.json")
    asked = reviser.targeted_now(plan, [], WARDROBE)
    assert {"f_master_dress", "f_master"} <= asked and "f_master_slide" not in asked     # a room, not its glass
    assert "f_master_slide" in reviser.targeted_now(plan, [], "make the master windows smaller")
    pinned = {"id": "c1", "text": "Narrow this please", "anchor": {"element_id": "f_master_slide"}}
    assert "f_master_slide" in reviser.targeted_now(plan, [pinned], None)
    assert "f_bed2" not in reviser.targeted_now(plan, [], "open up the outdoor seating")   # "outdoor" is not a door


def test_an_earlier_answer_is_put_back_when_nothing_asked_to_change_it():
    parent, narrowed = _plans()
    brief = load("brief-sample-10-marla-r3.json")
    rep = lda.check(narrowed, brief)
    plan, report, restored, kept = reviser.keep_earlier(parent, narrowed, rep, brief, [SANA], [], WARDROBE)
    assert _slide(plan) == 9 and not kept and [r["id"] for r in restored] == ["f_master_slide"]
    assert not reviser.new_failures(rep, report)
    # the family asked for the glass itself: it stays as the agent made it
    plan, _, restored, _ = reviser.keep_earlier(parent, narrowed, rep, brief, [SANA], [], "make the master window narrower")
    assert _slide(plan) == 7 and not restored


def test_when_a_rule_needs_it_the_earlier_thread_is_told(monkeypatch):
    parent, narrowed = _plans()
    brief = load("brief-sample-10-marla-r3.json")
    rep = lda.check(narrowed, brief)
    real = lda.check

    def check(plan, brief=None):  # pretend the 9 ft glass leaves the dressing no wardrobe wall
        out = real(plan, brief)
        if _slide(plan) == 9:
            out["checks"].append({"id": "plan.room.dressing_wall:f_master_dress", "status": "warn", "category": "livable",
                                  "message": "Master Dressing has no solid wall for a wardrobe."})
        return out
    monkeypatch.setattr(reviser.lda, "check", check)
    plan, _, restored, kept = reviser.keep_earlier(parent, narrowed, rep, brief, [SANA], [], WARDROBE)
    assert _slide(plan) == 7 and not restored and kept[0]["comment"]["id"] == "cm_sana"
    text = reviser.kept_reply(kept[0], 4, WARDROBE)
    assert text.startswith("Version 4 narrowed the sliding door between Master Bedroom and Master Balcony to 7′")
    assert "(it was 9′)" in text and "no solid wall for a wardrobe" in text


def test_finalize_stores_the_answer_and_keeps_the_earlier_glass(monkeypatch):
    parent, narrowed = _plans()
    brief = load("brief-sample-10-marla-r3.json")
    store = {"versions": {"v3": {"id": "v3", "n": 3, "plan": parent, "parent_id": None,
                                 "changes": [{"id": "ch1", "summary": "Widened the master glass to 9 ft", "kind": "plan",
                                              "targets": ["f_master_slide"], "comment_ids": ["cm_sana"]}],
                                 "compliance": lda.check(parent, brief), "sections": []}},
             "comments": {"cm_sana": {**{k: SANA[k] for k in ("id", "text", "status", "resolution", "author", "anchor")},
                                      "resolved_in_version": "v3", "replies": []}},
             "project": {"id": "p1", "versions": [{"id": "v1", "n": 1}, {"id": "v2", "n": 2}, {"id": "v3", "n": 3}],
                         "current_version_id": "v3"}}

    async def get_project(pid):
        return copy.deepcopy(store["project"])

    async def get_version(pid, vid):
        return copy.deepcopy(store["versions"].get(vid))

    async def save_version(pid, v):
        store["versions"][v["id"]] = v
        return v

    async def list_comments(pid, version_id=None):
        return [copy.deepcopy(c) for c in store["comments"].values()]

    async def add_reply(pid, cid, r):
        store["comments"][cid]["replies"].append(r)
        return copy.deepcopy(store["comments"][cid])

    async def update_project(pid, **f):
        store["project"].update(f)
        return store["project"]

    async def nothing(*a, **k):
        return 0
    for name, fn in (("get_project", get_project), ("get_version", get_version), ("save_version", save_version),
                     ("list_comments", list_comments), ("add_reply", add_reply), ("update_project", update_project),
                     ("move_open_comments", nothing), ("update_comment", nothing)):
        monkeypatch.setattr(db, name, fn)
    rep = lda.check(narrowed, brief)
    resolutions = {"request": {"status": "resolved", "resolution": "The master dressing is now 6′ × 5′6″ with a 4′ wardrobe wall."}}

    async def go():
        return [ev async for ev in reviser.finalize({"id": "p1", "brief": brief}, store["versions"]["v3"], narrowed, [], rep,
                                                     [], resolutions, [], WARDROBE, "adk")]
    evs = asyncio.run(go())
    v = next(d["version"] for e, d in evs if e == "version")
    assert v["n"] == 4 and _slide(v["plan"]) == 9                       # v4 keeps the 9 ft glass Sana asked for
    assert v["source"]["comment_ids"] == [] and v["source"]["instruction"] == WARDROBE
    assert v["source"]["answer"].startswith("The master dressing is now") and "as agreed on an earlier comment" in v["source"]["answer"]
    assert v["summary"].startswith("“make the master dressing room") and " LDA · " in v["summary"]
    assert store["project"]["versions"][-1]["summary"] == v["summary"]
    assert not store["comments"]["cm_sana"]["replies"]                   # put back, so nothing to explain in Sana's thread


def test_the_reviser_is_told_the_solar_area_and_the_wardrobe_minimum():
    plan = load("plan-sample-villa-r3.json")
    text = reviser.solar_text(plan)
    assert text.startswith("SOLAR AREA (roof, solar panels): x 2–28 ft, y 16–34 ft (26′ × 18′, 468 sq ft)")
    assert "no pergola" in text
    ready = reviser.solar_text(load("plan-sample-10-marla-r3.json"))
    assert ready.startswith("SOLAR AREA (roof, solar ready): the whole roof except the stair tower and the tank")
    for prompt in (reviser.REVISE_SYSTEM, reviser_adk.INSTRUCTION):
        assert "one solid wall at least 4′ long" in prompt and "Never claim a" in prompt and "SOLAR AREA" in prompt
        assert "feet and inches" in prompt
    lines = reviser.answers_text([{**SANA, "status": "resolved"}], [{"n": 2, "instruction": "bigger kitchen", "answer": "Done."}])
    assert lines.startswith("EARLIER ANSWERS (keep these unless the new request conflicts; if it does, say which one and why):")
    assert "v3, Sana (resolved)" in lines and "(changed: f_master_slide)" in lines and "v2, a typed request" in lines


def test_a_dressing_with_no_wardrobe_wall_is_flagged():
    """BE-F8: a dressing big enough on paper, but with doors and glass on every wall, gets a warning."""
    plan = load("plan-sample-10-marla-r3.json")
    ix = planning.PlanIndex(plan)
    assert planning.longest_solid_wall(ix, "f_master_dress") >= 4
    d = next(r for r in plan["rooms"] if r["id"] == "f_master_dress")["rect"]   # 5.5 x 5.5 at (24.5, 22.5)
    x0, y0, x1, y1 = d["x"], d["y"], d["x"] + d["w"], d["y"] + d["d"]
    for i, (at, w) in enumerate((([x0 + 2.75, y1], 3.5), ([x1, y0 + 2.75], 3.5), ([x0 + 2.75, y0], 3.5), ([x0, y0 + 2.75], 3.5))):
        plan["openings"].append({"id": f"t_win{i}", "level": "first", "type": "window", "at": at, "width_ft": w, "height_ft": 4,
                                 "between": ["f_master_dress", "exterior"]})
    by = {c["id"]: c for c in lda.check(plan)["checks"]}
    c = by["plan.room.dressing_wall:f_master_dress"]
    assert c["status"] == "warn" and "no solid wall for a wardrobe" in c["message"] and c["limit"] == 4
