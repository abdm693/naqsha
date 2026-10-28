"""The revision agent's tools enforce the planning rules: no edit may add a failure the version didn't have."""
from app.agents.reviser_adk import Workspace


def _ws(plans):
    v = {"plan": plans["example"], "sections": [{"name": "furnish_f_bed3", "layer": "furniture", "code": "// bed\n"}]}
    return Workspace(v, [{"id": "c1", "text": "Bigger window in Bedroom 3", "anchor": {"room": "f_bed3"}}], {"bedrooms": 4})


def test_check_plan_ops_refuses_a_new_livability_failure(plans):
    ws = _ws(plans)
    tools = {f.__name__: f for f in ws.tools()}
    bad = [{"op": "upsert", "collection": "openings", "item": {"id": "x", "level": "first", "type": "door", "at": [12, 50],
                                                             "width_ft": 3, "height_ft": 7, "between": ["f_bed3", "f_terrace"]}},
           {"op": "upsert", "collection": "openings", "item": {"id": "y", "level": "first", "type": "door", "at": [12, 19],
                                                             "width_ft": 3, "height_ft": 7, "between": ["f_bed2", "f_master"]}}]
    res = tools["check_plan_ops"](bad)
    assert not res["ok"] and any("opens directly into" in p for p in res["new_problems"])
    assert tools["apply_plan_ops"](bad)["applied"] is False and not ws.plan_changed


def test_harmless_edit_applies_and_streams_events(plans):
    ws = _ws(plans)
    tools = {f.__name__: f for f in ws.tools()}
    win = next(o for o in ws.plan["openings"] if o["id"] == "f_bed3_w")
    ok = [{"op": "upsert", "collection": "openings", "item": {**win, "width_ft": 8}}]
    assert tools["check_plan_ops"](ok)["ok"]
    assert tools["apply_plan_ops"](ok)["applied"] and ws.plan_changed
    assert [e[0] for e in ws.events].count("plan") == 1
    assert tools["finish"]([{"summary": "Widened the window", "kind": "plan"}], [])["ok"] is False   # must resolve c1
    assert tools["finish"]([{"summary": "Widened the window", "kind": "plan"}],
                           [{"comment_id": "c1", "status": "resolved", "resolution": "The window is now 8 ft."}])["ok"]
    assert ws.finished and ws.section_label("furnish_f_bed3") == "the furniture in Bedroom 3"


def test_a_stalled_agent_step_times_out_so_the_fallback_runs():
    """A model call that never answers must not leave a revision running forever: the guard raises, main.py falls back."""
    import asyncio

    import pytest

    from app.agents.reviser_adk import stall_guard

    closed = []

    async def agent(hang_after: int):
        try:
            for i in range(5):
                if i == hang_after:
                    await asyncio.sleep(3600)
                yield i
        finally:
            closed.append(True)

    async def collect(hang_after):
        return [e async for e in stall_guard(agent(hang_after), stall_s=0.05)]

    assert asyncio.run(collect(99)) == [0, 1, 2, 3, 4]
    with pytest.raises(TimeoutError):
        asyncio.run(collect(2))
    assert closed == [True, True]
