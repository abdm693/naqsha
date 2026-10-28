"""The architect's self-review bookkeeping (BE-08), the build that starts during the review (BE-26), and open comments that
follow a new version (BE-11). No model calls."""
import asyncio
import copy
import re

from app.agents import architect, reviser
from app.compliance import lda
from app.store import db


def test_review_issues_become_plain_warnings(plans):
    plan = plans["example"]
    issues = [{"severity": "major", "rooms": ["f_bath2", "f_bed2"], "problem": "f_bath2 is cramped next to f_bed2_door.",
               "fix": "Widen f_bath2 by 1 ft."},
              {"severity": "minor", "rooms": [], "problem": "The lounge could take a wider window."}]
    rep = architect.with_review(lda.check(plan), issues, plan)
    notes = [c for c in rep["checks"] if c["id"].startswith("review.")]
    assert [c["id"] for c in notes] == ["review.1", "review.2"]
    assert all(c["status"] == "warn" and c["category"] == "livable" for c in notes)
    assert not re.search(r"\b[gf]_[a-z0-9_]+", notes[0]["message"]), notes[0]["message"]
    assert "Bath 2" in notes[0]["message"] and notes[0]["element_ids"] == ["f_bath2", "f_bed2"]
    assert architect.review_note_count(rep) == 2
    assert rep["ok"] == lda.check(plan)["ok"]              # warnings never turn a passing plan into a failing one
    # applying the review again replaces the notes instead of piling them up
    assert architect.review_note_count(architect.with_review(rep, issues[:1], plan)) == 1


def test_a_revision_counts_only_if_it_touches_a_major_issue(plans):
    plan = plans["example"]
    same = copy.deepcopy(plan)
    assert architect.changed_rooms(plan, same) == set()
    moved = copy.deepcopy(plan)
    next(o for o in moved["openings"] if o["id"] == "f_bath2_v")["width_ft"] = 2.5
    changed = architect.changed_rooms(plan, moved)
    assert changed == {"f_bath2"}
    major = {"severity": "major", "rooms": ["f_bath2"], "problem": "x"}
    other = {"severity": "major", "rooms": ["g_kitchen"], "problem": "y"}
    assert architect.addresses(major, changed) and not architect.addresses(other, changed)
    assert architect.addresses({"severity": "major", "problem": "z"}, changed)        # no rooms named: any change
    assert not architect.addresses({"severity": "major", "problem": "z"}, set())


def test_background_buffers_events_until_followed():
    async def gen():
        yield "stage", {"stage": "build"}
        await asyncio.sleep(0)
        yield "section", {"index": 0}
        yield "_result", {"sections": [1]}

    async def go():
        bg = architect.Background(gen())
        await asyncio.sleep(0.01)            # it runs before anyone follows
        assert bg.task.done()
        return [ev async for ev in bg.follow()]
    evs = asyncio.run(go())
    assert [e for e, _ in evs] == ["stage", "section", "_result"]

    async def boom():
        yield "stage", {}
        raise RuntimeError("stalled")

    async def go2():
        out = []
        try:
            async for ev in architect.Background(boom()).follow():
                out.append(ev)
        except RuntimeError as e:
            out.append(str(e))
        return out
    assert asyncio.run(go2())[-1] == "stalled"


def test_finalize_moves_open_comments_to_the_new_version(monkeypatch):
    moved, comments = [], {"c1": {"id": "c1", "status": "open"}, "c2": {"id": "c2", "status": "open"}}

    async def get_project(pid):
        return {"id": pid, "versions": [{"id": "v1", "n": 1}], "current_version_id": "v1"}

    async def save_version(pid, v):
        return v

    async def update_comment(pid, cid, **f):
        comments[cid].update(f)
        return comments[cid]

    async def add_reply(pid, cid, r):
        return {**comments[cid], "replies": [r]}

    async def update_project(pid, **f):
        return f

    async def move_open_comments(pid, a, b):
        moved.append((a, b))
        return 1
    for name, fn in (("get_project", get_project), ("save_version", save_version), ("update_comment", update_comment),
                     ("add_reply", add_reply), ("update_project", update_project), ("move_open_comments", move_open_comments)):
        monkeypatch.setattr(db, name, fn)

    async def go():
        return [ev async for ev in reviser.finalize({"id": "p1"}, {"id": "v1", "plan": {}}, {}, [], {"checks": []}, [],
                                                     {"c1": {"status": "resolved", "resolution": "Done."}}, [comments["c1"]],
                                                     None, "adk")]
    evs = asyncio.run(go())
    new_vid = next(d["version"]["id"] for e, d in evs if e == "version")
    assert moved == [("v1", new_vid)]
    assert comments["c1"]["status"] == "resolved" and comments["c2"]["status"] == "open"


def _stub_planning(plans, monkeypatch, drafts, fix):
    """make_plan with no model calls: `drafts` plans come back from the drafting call, and `fix` stands in for the fixer."""
    queue = [copy.deepcopy(d) for d in drafts]

    async def ask(contents, thinking=None, attempts=2):
        yield "result", (queue.pop(0), "")

    async def no_concept(project):
        return None
    monkeypatch.setattr(architect, "_ask_plan", ask)
    monkeypatch.setattr(architect, "_concept_spec", no_concept)
    monkeypatch.setattr(architect.config, "PLAN_DRAFTS", len(drafts))
    monkeypatch.setattr(architect.fixer, "fix", fix)


def test_the_best_draft_is_fixed_and_a_failed_fixer_keeps_it(plans, monkeypatch):
    seen = {}

    async def fix(plan, brief, prepare, **k):
        seen["fails"] = lda.counts(lda.check(plan, brief))["fail"]
        yield "_result", {"plan": plan, "report": lda.check(plan, brief), "steps": 1, "kept": 0}
    broken = copy.deepcopy(plans["example"])
    broken["rooms"] = [r for r in broken["rooms"] if r.get("type") != "bath"]
    _stub_planning(plans, monkeypatch, [broken, plans["example"]], fix)
    brief = {"plot": {"width_ft": 35, "depth_ft": 65, "area_marla": 10.1, "corner": False}, "bedrooms": 5}

    async def go():
        return [ev async for ev in architect.make_plan({"id": "p1", "brief": brief})]
    evs = asyncio.run(go())
    result = next(d for e, d in evs if e == "_result")
    assert seen["fails"] == lda.counts(lda.check(architect.prepare(copy.deepcopy(plans["example"]), brief)[0], brief))["fail"]
    assert result["chosen_attempt"] == 1
    assert "plan.program.bedrooms" in {c["id"] for c in result["report"]["checks"] if c["status"] == "fail"}


def test_each_kept_fixer_edit_is_a_numbered_attempt(plans, monkeypatch):
    async def fix(plan, brief, prepare, **k):
        rep = lda.check(plan, brief)
        for _ in range(2):
            yield "edit", {"fixed": 1, "failures": 1, "summary": ["Bedrooms"]}
            yield "plan", {"plan": plan}
            yield "compliance", {"report": rep}
        yield "_result", {"plan": plan, "report": rep, "steps": 2, "kept": 2}
    _stub_planning(plans, monkeypatch, [plans["example"]], fix)
    brief = {"plot": {"width_ft": 35, "depth_ft": 65, "area_marla": 10.1, "corner": False}, "bedrooms": 5}

    async def go():
        return [ev async for ev in architect.make_plan({"id": "p1", "brief": brief})]
    evs = asyncio.run(go())
    fixes = [d["message"] for e, d in evs if e == "stage" and d["stage"] == "fix"]
    assert fixes[0].startswith("Fixing 1 problem, one checked edit")
    assert [d["attempt"] for e, d in evs if e == "compliance"] == [1, 2, 3]
    assert next(d for e, d in evs if e == "_result")["chosen_attempt"] == 3


def test_revisions_keep_review_notes_about_untouched_rooms(plans):
    plan = plans["example"]
    issues = [{"severity": "major", "rooms": ["f_bath2"], "problem": "Bath 2 is cramped."},
              {"severity": "minor", "rooms": ["g_kitchen"], "problem": "The kitchen window is small."}]
    v = {"plan": plan, "compliance": architect.with_review(lda.check(plan), issues, plan)}
    moved = copy.deepcopy(plan)
    next(o for o in moved["openings"] if o["id"] == "f_bath2_v")["width_ft"] = 2.5
    rep = reviser.carry_review_notes(v, moved, lda.check(moved))
    notes = [c for c in rep["checks"] if c["id"].startswith("review.")]
    assert [c["element_ids"] for c in notes] == [["g_kitchen"]]


class FakeRun:
    """The design pipeline around the review, with no model calls: a late plan (every attempt used), a build that streams
    one section, and an in-memory store."""

    def __init__(self, plans, monkeypatch, review):
        self.saved = {}
        plan = copy.deepcopy(plans["example"])
        self.brief = {"plot": {"width_ft": 35, "depth_ft": 65, "area_marla": 10.1, "corner": False}, "facing": "N"}
        report = lda.check(plan, self.brief)

        async def make_plan(project):
            yield "stage", {"stage": "plan", "message": "Laying out the floors…"}
            yield "_result", {"plan": plan, "report": report, "first": None, "chosen_attempt": 3,
                              "history": [{"attempt": i} for i in (1, 2, 3)]}

        async def write_design(project, plan, extra=None):
            yield "stage", {"stage": "build", "message": "Building the 3D model…"}
            await asyncio.sleep(0.01)
            yield "section", {"section": {"name": "structure", "layer": "structure", "code": ""}, "index": 0}
            yield "_result", {"sections": [{"name": "structure", "layer": "structure", "code": ""}]}

        async def self_review(*a, **k):
            raise AssertionError("a late run makes no revision")
            yield  # pragma: no cover

        def no_model(*a, **k):
            raise AssertionError("no model call on the late path besides the critique")

        async def plan_images(pid, run_id, plan):
            return []

        async def update_project(pid, **f):
            return f

        async def get_project(pid):
            return {"id": pid, "versions": [], "brief": self.brief}

        async def save_version(pid, v):
            self.saved = v
            return v
        monkeypatch.setattr(architect, "make_plan", make_plan)
        monkeypatch.setattr(architect, "write_design", write_design)
        monkeypatch.setattr(architect, "self_review", self_review)
        monkeypatch.setattr(architect, "review", review)
        monkeypatch.setattr(architect.llm, "stream_json", no_model)
        monkeypatch.setattr(architect, "_plan_images", plan_images)
        for name, fn in (("update_project", update_project), ("get_project", get_project), ("save_version", save_version)):
            monkeypatch.setattr(db, name, fn)

    def run(self):
        async def go():
            return [ev async for ev in architect.design({"id": "p1", "brief": self.brief})]
        return asyncio.run(go())


def test_a_late_run_still_gets_the_critique(plans, monkeypatch):
    """BE3-04: a run that used every plan attempt still stores a review (approve or revise) whose open issues are listed with
    the checks as "Architect's review" rows; no revision is made."""
    async def review(project, plan, report):
        return {"verdict": "revise", "summary": "The powder room faces the lounge.",
                "issues": [{"severity": "major", "rooms": ["g_powder"], "problem": "g_powder opens toward the sofa.",
                            "fix": "Turn its door to the side wall."}]}
    fake = FakeRun(plans, monkeypatch, review)
    evs = fake.run()
    v = next(d["version"] for e, d in evs if e == "version")
    rev = v["review"]
    assert rev["verdict"] == "revise" and rev["applied"] is False and rev["revision"] == "skipped_time" and rev["open_issues"] == 1
    rows = [c for c in v["compliance"]["checks"] if c["id"].startswith("review.")]
    assert len(rows) == 1 and rows[0]["title"] == "Architect's review: needs a change" and rows[0]["message"] == "Powder room opens toward the sofa."
    assert v["plan"] == plans["example"] and [s["name"] for s in v["sections"]] == ["structure"]
    stages = [d["message"] for e, d in evs if e == "stage" and d["stage"] == "review"]
    assert stages[0] == "Reviewing the drawings like an architect…" and "1 point to look at" in stages[-1]
    shown = [d["report"] for e, d in evs if e == "compliance"]
    assert shown and architect.review_note_count(shown[-1]) == 1


def test_a_late_critique_that_runs_over_is_left_out(plans, monkeypatch):
    async def review(project, plan, report):
        await asyncio.sleep(5)
    monkeypatch.setattr(architect.config, "REVIEW_CRITIQUE_S", 0.05)
    fake = FakeRun(plans, monkeypatch, review)
    v = next(d["version"] for e, d in fake.run() if e == "version")
    assert v["review"]["verdict"] == "skipped" and v["review"]["reason"] == "timeout" and v["review"]["revision"] == "skipped_time"
    assert not architect.review_note_count(v["compliance"]) and v["sections"]


def test_the_review_names_sides_not_compass_points(plans, monkeypatch):
    sent = []

    async def stream(model, contents, system, max_tokens=None, **k):
        sent.append((system, " ".join(p.text for p in contents[0].parts if getattr(p, "text", None))))
        yield "result", ({"verdict": "approve", "summary": "Works.", "issues": []}, "")
    monkeypatch.setattr(architect.llm, "stream_json", stream)
    out = asyncio.run(architect.review({"brief": {"facing": "N"}}, plans["example"], lda.check(plans["example"])))
    assert out["verdict"] == "approve"
    system, text = sent[0]
    assert "ORIENTATION: The road (front) is at the bottom of every sheet; the plot faces north (its road side)." in text
    assert "never compass points" in text and "Never use compass points" in " ".join(system.split())
    assert "the plot faces south-east" in architect.orientation({}, {"site": {"facing": "SE"}})


def test_example_is_what_the_planner_copies(plans):
    """The few-shot example every plan starts from: every bath has a ventilator on its own outside wall."""
    rep = lda.check(plans["example"])
    vents = [c for c in rep["checks"] if c["id"].startswith("room.vent")]
    assert vents and all(c["status"] == "pass" for c in vents)


# --- round 4: one honest report (BE-F4) ---------------------------------------------------------------------------------------
def _ten_marla():
    from conftest import load
    return load("plan-sample-10-marla-r3.json"), load("brief-sample-10-marla-r3.json"), load("review-sample-10-marla-r3.json")


def test_a_note_that_repeats_a_rule_is_dropped():
    """The 10 marla's review.3 ("Bath 2 sits directly over the drawing room…") repeats the open rule
    plan.structure.wet_over_dry:f_bath2: only the rule's row is shown. Notes about other things stay."""
    plan, brief, issues = _ten_marla()
    rep = architect.with_review(lda.check(plan, brief), issues, plan)
    notes = {c["id"]: c for c in rep["checks"] if c["id"].startswith("review.")}
    assert "plan.structure.wet_over_dry:f_bath2" in {c["id"] for c in rep["checks"] if c["status"] == "warn"}
    assert sorted(notes) == ["review.1", "review.3"]            # review.3 here is the powder-room note (issue 3 of 3)
    assert not any("over the front-left corner" in c["message"] for c in notes.values())
    # same rooms but another subject: kept (a note naming only the door's rooms is not the door-width rule)
    keep = {"severity": "minor", "rooms": ["f_bath2", "g_drawing"], "problem": "Bath 2 has no space for a shower screen."}
    assert "Bath 2 has no space" in str(architect.review_checks([keep], plan, lda.check(plan, brief)))


def test_review_notes_are_one_plain_sentence_in_feet_and_inches():
    plan, brief, issues = _ten_marla()
    rep = architect.with_review(lda.check(plan, brief), issues, plan)
    kitchen = next(c for c in rep["checks"] if c["id"] == "review.1")
    assert kitchen["message"] == ("Placing the open kitchen and dirty kitchen side-by-side makes both rooms 6′ wide by 15′3″ "
                                  "deep.")
    assert "Suggested" not in kitchen["message"] and "12′ × 6′6″ dirty kitchen" in kitchen["fix"]
    for c in rep["checks"]:
        if c["id"].startswith("review."):
            assert len(c["message"]) <= 160 and c["message"].count(". ") == 0 and c["message"].endswith(".")
            assert not re.search(r"\d\.\d+ ?ft|\bft\b", c["message"] + c["fix"]), c
            assert not re.search(r"\b(Drawing Room|Open Kitchen|Dirty Kitchen|TV Lounge|Stair Hall)\b", c["message"] + c["fix"])
    assert architect.feet_text("15.25 ft deep") == "15′3″ deep" and architect.feet_text("a 12 x 6.5 ft room") == "a 12′ × 6′6″ room"
    assert architect.feet_text("a 0.5 ft gap, 225 sq ft") == "a 6″ gap, 225 sq ft"
    assert architect.one_sentence("The lobby has no door; guests walk through the drawing room to reach the lounge, which "
                                  "is awkward every single day for a family that entertains often and wants privacy.") \
        == "The lobby has no door; guests walk through the drawing room to reach the lounge."


def test_status_line_matches_the_app():
    """'A/B LDA · C/D livable · N architect's notes': warns are not passes, review notes counted apart (10 marla today)."""
    plan, brief, issues = _ten_marla()
    rep = architect.with_review(lda.check(plan, brief), issues, plan)
    assert architect._status(rep) == "36/36 LDA · 10/12 livable · 2 architect's notes"
    assert architect.review_note_count(rep) == 2
