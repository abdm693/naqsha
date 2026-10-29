"""Naqsha planning rules: deterministic livability checks on a BuildingPlan.

These are the objective rules from docs/review/architecture-rules.md Part A (P-01 to P-26): openings that really sit on
the wall they claim, rooms that are independent (a bedroom never opens into another bedroom), every room reachable through
circulation, stairs that reach the roof under a stair tower whose door is at the top landing, and adherence to the brief
(bedroom count, rooms per floor, attached baths, solar-ready roof). Every check has category "livable", a plain-English
`message` for the family and a `fix` hint that the fix loop feeds back to the planner.

Units are plan feet and the conventions of contracts/plan.ts. The module is standalone (no I/O), so lda.check() and the
revision agent's tools can both call it.
"""
from __future__ import annotations

import logging
import math
import re
from collections import defaultdict, deque
from typing import Iterable

log = logging.getLogger("naqsha.planning")

EPS = 0.05
PRIVATE = {"bedroom", "master_bedroom", "guest_bedroom", "servant"}
BEDROOMS = {"bedroom", "master_bedroom", "guest_bedroom"}
WET = {"bath", "powder"}
CIRC = {"lobby", "corridor", "stair"}
LIVING = {"lounge", "dining", "drawing", "prayer", "study"}
SERVICE = {"kitchen", "dirty_kitchen", "laundry", "store"}
KITCHENS = {"kitchen", "dirty_kitchen"}
OPEN = {"porch", "balcony", "terrace", "lawn", "driveway", "open_space", "courtyard"}
GROUND_OUT = {"porch", "lawn", "driveway", "open_space", "courtyard"}  # connect to the street at ground level
DOORS = {"main_door", "door", "double_door", "sliding_door", "arch", "garage_door"}
HINGED = {"main_door", "door", "double_door"}
GLAZED = {"window", "corner_window", "sliding_door", "ventilator"}
HABITABLE = {"drawing", "lounge", "dining", "bedroom", "master_bedroom", "guest_bedroom", "study", "servant"}
SKY_OK = {"open_space", "courtyard", "lawn", "driveway"}  # open to the sky; a room of any other type above roofs it over
KIND_WORD = {"main_door": "main door", "door": "door", "double_door": "double door", "sliding_door": "sliding door",
             "arch": "arch", "garage_door": "garage door", "window": "window", "corner_window": "corner window",
             "ventilator": "ventilator"}
BED_KEYS = ("bedroom", "bed", "bedrooms", "master_bedroom", "master", "guest_bedroom", "guest")

REF = "Naqsha planning rule"
IBC = "IBC 2021"
EXT, ROOF, MUMTY = "EXT", "ROOF", "MUMTY"

Rect = tuple[float, float, float, float]  # x0, y0, x1, y1


# --- geometry -----------------------------------------------------------------------------------------------------
def rect_of(r: dict) -> Rect:
    q = r["rect"] if "rect" in r else r
    x, y, w, d = float(q["x"]), float(q["y"]), float(q["w"]), float(q["d"])
    return (x, y, x + w, y + d)


def area(a: Rect) -> float:
    return max(0.0, a[2] - a[0]) * max(0.0, a[3] - a[1])


def inter(a: Rect, b: Rect) -> Rect | None:
    r = (max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3]))
    return r if r[2] > r[0] + 1e-9 and r[3] > r[1] + 1e-9 else None


def overlap_area(a: Rect, b: Rect) -> float:
    i = inter(a, b)
    return area(i) if i else 0.0


def within(a: Rect, b: Rect, tol: float = 0.1) -> bool:
    """a lies inside b."""
    return a[0] >= b[0] - tol and a[1] >= b[1] - tol and a[2] <= b[2] + tol and a[3] <= b[3] + tol


def contains(a: Rect, x: float, y: float, tol: float = 0.0) -> bool:
    return a[0] - tol <= x <= a[2] + tol and a[1] - tol <= y <= a[3] + tol


def union_rect(*rs: Rect) -> Rect:
    return (min(r[0] for r in rs), min(r[1] for r in rs), max(r[2] for r in rs), max(r[3] for r in rs))


def union_area(rects: list[Rect]) -> float:
    """Exact area of a union of axis-aligned rects (coordinate compression)."""
    if not rects:
        return 0.0
    xs = sorted({r[0] for r in rects} | {r[2] for r in rects})
    ys = sorted({r[1] for r in rects} | {r[3] for r in rects})
    total = 0.0
    for i in range(len(xs) - 1):
        for j in range(len(ys) - 1):
            cx, cy = (xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2
            if any(r[0] <= cx <= r[2] and r[1] <= cy <= r[3] for r in rects):
                total += (xs[i + 1] - xs[i]) * (ys[j + 1] - ys[j])
    return total


def shared_edge(a: Rect, b: Rect, tol: float = 0.05):
    """(axis, c, lo, hi) when rects a and b touch along a segment longer than tol. axis "x": the edge runs along x at
    y=c; axis "y": it runs along y at x=c."""
    for ca, cb in ((a[2], b[0]), (a[0], b[2])):
        if abs(ca - cb) <= tol:
            lo, hi = max(a[1], b[1]), min(a[3], b[3])
            if hi - lo > tol:
                return ("y", (ca + cb) / 2, lo, hi)
    for ca, cb in ((a[3], b[1]), (a[1], b[3])):
        if abs(ca - cb) <= tol:
            lo, hi = max(a[0], b[0]), min(a[2], b[2])
            if hi - lo > tol:
                return ("x", (ca + cb) / 2, lo, hi)
    return None


def sides(a: Rect) -> dict[str, tuple[str, float, float, float, tuple[int, int]]]:
    """side -> (axis, c, lo, hi, outward normal)."""
    return {"front": ("x", a[1], a[0], a[2], (0, -1)), "back": ("x", a[3], a[0], a[2], (0, 1)),
            "left": ("y", a[0], a[1], a[3], (-1, 0)), "right": ("y", a[2], a[1], a[3], (1, 0))}


def fmt(v: float) -> str:
    """Feet and inches: 3′6″."""
    v = max(0.0, float(v))
    feet = int(v + 1e-9)
    inches = round((v - feet) * 12)
    if inches == 12:
        feet, inches = feet + 1, 0
    return f"{feet}′{inches}″" if inches else f"{feet}′"


def ft(v: float) -> str:
    return f"{v:.1f}".rstrip("0").rstrip(".") + " ft"


def _and(items: list[str]) -> str:
    """"A", "A and B", "A, B and C"."""
    items = [str(i) for i in items]
    return items[0] if len(items) == 1 else ", ".join(items[:-1]) + f" and {items[-1]}" if items else ""


# --- the plan, indexed -------------------------------------------------------------------------------------------
class PlanIndex:
    """Indexes a BuildingPlan once: levels, rooms, opening validity, the circulation graph and stair geometry."""

    def __init__(self, plan: dict):
        self.plan = plan
        site = plan.get("site") or {}
        plot = site.get("plot") or {}
        self.W, self.D = float(plot.get("width_ft") or 0), float(plot.get("depth_ft") or 0)
        self.sb = {"front": 0.0, "rear": 0.0, "left": 0.0, "right": 0.0,
                   **{k: float(v or 0) for k, v in (site.get("setbacks_ft") or {}).items()}}
        self.levels = sorted([lv for lv in plan.get("levels") or [] if lv.get("id")], key=lambda lv: lv.get("index", 0))
        self.lv = {lv["id"]: lv for lv in self.levels}
        self.rooms = [r for r in plan.get("rooms") or [] if r.get("id") and _rect_ok(r.get("rect"))]
        self.by_id = {r["id"]: r for r in self.rooms}
        self.R = {r["id"]: rect_of(r) for r in self.rooms}
        self.openings = [o for o in plan.get("openings") or [] if o.get("id") and _pt_ok(o.get("at"))
                         and isinstance(o.get("between"), list) and len(o["between"]) == 2]
        self.stairs = [s for s in plan.get("stairs") or [] if s.get("id") and _rect_ok(s.get("rect"))]
        self.roof = plan.get("roof") or {}
        self.roof_id = self._roof_level()
        self.storeys = [lv["id"] for lv in self.levels if lv["id"] != self.roof_id and any(
            r.get("level") == lv["id"] and r.get("type") not in OPEN for r in self.rooms)]
        self.top = self.storeys[-1] if self.storeys else None
        self.ground = next((lv["id"] for lv in self.levels if lv.get("index") == 0), self.storeys[0] if self.storeys else "ground")
        m = self.roof.get("mumty")
        self.mumty: Rect | None = rect_of(m) if m and _rect_ok(m.get("rect")) else None
        self.info = {o["id"]: self._opening_info(o) for o in self.openings}
        self.open_pairs = self._open_to_pairs()
        self._graph()

    # levels ---------------------------------------------------------------------------------
    def _roof_level(self) -> str | None:
        for lv in self.levels:
            if lv["id"] == "roof" or "roof" in str(lv.get("name", "")).lower():
                return lv["id"]
        return self.levels[-1]["id"] if len(self.levels) > 1 else None

    def lname(self, lid: str | None) -> str:
        lv = self.lv.get(lid or "")
        return (lv or {}).get("name") or (lid or "?")

    def name(self, rid: str) -> str:
        """A room's name for messages (never a raw id)."""
        if rid == EXT:
            return "outside"
        if rid == ROOF:
            return "the roof"
        if rid == MUMTY:
            return "the stair tower"
        r = self.by_id.get(rid)
        if not r:
            return "a room that isn't in the plan"
        return r.get("name") or str(r.get("type") or "room").replace("_", " ").capitalize()

    def oname(self, o: dict) -> str:
        """An opening in plain words, never its id: "the door between Bedroom 3 and the Lounge", "the Bath 2 ventilator",
        "the main door"."""
        kind = KIND_WORD.get(str(o.get("type") or ""), "opening")
        if o.get("type") == "main_door":
            return "the main door"
        named = [b for b in o.get("between") or [] if b != "exterior"]
        names = [self.name(b) for b in named]
        if len(names) == 2 and names[0] != names[1]:
            return f"the {kind} between {names[0]} and {names[1]}"
        if names:
            return f"the {names[0]} {kind}"
        return f"a {kind}"

    def sname(self, s: dict) -> str:
        """A stair in plain words: "Ground → first stair", "First → roof stair"."""
        def short(lid):
            n = re.sub(r"\s*floor\s*$", "", self.lname(lid), flags=re.I).strip() or str(lid)
            return n
        a, b = short(s.get("from_level")), short(s.get("to_level"))
        return f"{a[:1].upper() + a[1:].lower()} → {b.lower()} stair"

    def type(self, rid: str) -> str:
        return (self.by_id.get(rid) or {}).get("type", "")

    def level_index(self, lid: str | None) -> int:
        return int((self.lv.get(lid or "") or {}).get("index", 0) or 0)

    def covers_above(self, lid: str | None) -> list[tuple[str, Rect]]:
        """Rooms with a floor slab on any level above `lid` (rooms, porches, balconies, terraces; not voids or gardens)."""
        i = self.level_index(lid)
        return [(r["id"], self.R[r["id"]]) for r in self.rooms
                if self.level_index(r.get("level")) > i and r.get("type") not in SKY_OK]

    def covered_area(self, rid: str) -> tuple[float, list[str]]:
        """How much of an open-to-sky room (open_space, courtyard...) has a slab over it on a higher level, and by what."""
        a = self.R[rid]
        lid = self.by_id[rid].get("level")
        hits = [(cid, inter(a, cr)) for cid, cr in self.covers_above(lid)]
        hits = [(cid, i) for cid, i in hits if i and area(i) > 0.25]
        return union_area([i for _, i in hits]), [cid for cid, _ in hits]

    def sky_lit(self, o: dict, outside: str | None) -> bool:
        """Whether the daylight zone in front of an opening (its width × 3 ft into `outside`) is open to the sky. Only
        open-air rooms at the ground (open_space, courtyard, lawn, driveway) can be roofed over by a higher floor."""
        if not outside or self.type(outside) not in SKY_OK:
            return True
        x, y = float(o["at"][0]), float(o["at"][1])
        w = max(float(o.get("width_ft") or 0), 1.0)
        zone = (x - w / 2, y - 3.0, x + w / 2, y + 3.0) if _horizontal(self, o) else (x - 3.0, y - w / 2, x + 3.0, y + w / 2)
        zone = inter(zone, self.R[outside])
        if not zone:
            return True
        lid = self.by_id[outside].get("level")
        cov = union_area([i for _, cr in self.covers_above(lid) if (i := inter(zone, cr))])
        return cov < 0.5 * area(zone)

    def level_rooms(self, lid: str) -> list[dict]:
        return [r for r in self.rooms if r.get("level") == lid]

    def room_at(self, lid: str, x: float, y: float, exclude: Iterable[str] = (), enclosed: bool | None = None) -> str | None:
        best = None
        for r in self.level_rooms(lid):
            if r["id"] in exclude:
                continue
            if enclosed is True and r.get("type") in OPEN:
                continue
            if contains(self.R[r["id"]], x, y, 1e-6):
                a = area(self.R[r["id"]])
                key = (r.get("type") in OPEN, a)  # prefer enclosed, then the smallest
                if best is None or key < best[0]:
                    best = (key, r["id"])
        return best[1] if best else None

    def on_party_line(self, axis: str, c: float, lo: float, hi: float) -> str | None:
        """The plot side whose boundary this edge lies on, when that side has a zero setback (a party wall)."""
        if axis == "y":
            if abs(c) <= 0.4 and self.sb["left"] <= EPS:
                return "left"
            if abs(c - self.W) <= 0.4 and self.sb["right"] <= EPS:
                return "right"
        else:
            if abs(c - self.D) <= 0.4 and self.sb["rear"] <= EPS:
                return "rear"
        return None

    # openings ---------------------------------------------------------------------------------
    def _opening_info(self, o: dict) -> dict:
        """Validity of an opening (P-01, P-02, P-03): which rooms it really joins, on which wall."""
        lid = o.get("level")
        a_id, b_id = o["between"]
        x, y = float(o["at"][0]), float(o["at"][1])
        w = float(o.get("width_ft") or 0)
        info = {"valid": False, "kind": "pair", "rooms": [], "problems": [], "warns": [], "outside": None}
        named = [b for b in (a_id, b_id) if b != "exterior"]
        on = self.oname(o)
        On = on[:1].upper() + on[1:]
        kind = KIND_WORD.get(str(o.get("type") or ""), "opening")
        for rid in named:
            r = self.by_id.get(rid)
            if not r:
                info["problems"].append(("same_level", f"{On} joins a room that isn't in the plan."))
                return info
            if r.get("level") != lid:
                info["problems"].append(("same_level", f"A {kind} on the {self.lname(lid)} joins {self.name(rid)}, which is on "
                                         f"the {self.lname(r.get('level'))}. Openings can only join rooms on the same floor."))
                return info
        if not named:
            info["problems"].append(("on_edge", f"A {kind} on the {self.lname(lid)} does not name a room."))
            return info
        if len(named) == 2:
            A, B = self.by_id[a_id], self.by_id[b_id]
            e = shared_edge(self.R[a_id], self.R[b_id])
            info["rooms"] = [a_id, b_id]
            if not e:
                info["problems"].append(("on_edge", f"{A['name']} and {B['name']} don't share a wall, so the {kind} between them "
                                                    f"can't be built."))
                return info
            axis, c, lo, hi = e
            across, along = (abs(y - c), x) if axis == "x" else (abs(x - c), y)
            info["edge"] = e
            if across > 0.75 or not (lo - 0.25 <= along <= hi + 0.25):
                info["problems"].append(("on_edge", f"{On} is not on the wall the two rooms share."))
                return info
            if o.get("type") != "corner_window" and hi - lo < w + 0.25:
                info["problems"].append(("on_edge", f"{On} ({fmt(w)}) doesn't fit the {fmt(hi - lo)} wall the two rooms share."))
                return info
            if along - w / 2 < lo - 0.25 or along + w / 2 > hi + 0.25:
                info["problems"].append(("on_edge", f"{On} runs past the end of the wall the two rooms share."))
                return info
            if along - w / 2 < lo + 0.3 - 1e-6 or along + w / 2 > hi - 0.3 + 1e-6:
                info["warns"].append(f"{On} sits tight against a corner; leave about 4 in for the frame.")
            info["valid"] = True
            return info
        # one room + exterior
        info["kind"] = "ext"
        rid = named[0]
        A = self.by_id[rid]
        info["rooms"] = [rid]
        best = None
        for side, (axis, c, lo, hi, n) in sides(self.R[rid]).items():
            across, along = (abs(y - c), x) if axis == "x" else (abs(x - c), y)
            if across <= 0.75 and lo - 0.25 <= along <= hi + 0.25 and (best is None or across < best[0]):
                best = (across, side, axis, c, lo, hi, n, along)
        if not best:
            info["problems"].append(("on_edge", f"{On} is not on an outside wall of {A['name']}."))
            return info
        _, side, axis, c, lo, hi, n, along = best
        info["side"] = side
        px, py = (along, c) if axis == "x" else (c, along)
        ox, oy = px + n[0] * 0.4, py + n[1] * 0.4
        out = self.room_at(lid, ox, oy, exclude=[rid])
        if out and self.type(out) not in OPEN:
            info["problems"].append(("on_edge", f"{On} is drawn to the outside but {A['name']}'s {side} wall faces "
                                                f"{self.name(out)}."))
            return info
        party = self.on_party_line(axis, c, lo, hi)
        if party and not out and o.get("type") != "arch":
            info["problems"].append(("party_wall", f"{On} is on the {party} party wall. The neighbour builds right against it."))
            return info
        if lid not in (self.ground, self.roof_id) and o.get("type") in DOORS and not out:
            info["problems"].append(("door_to_drop", f"{On} leads straight out of the {self.lname(lid)} with nothing to step "
                                                     f"onto."))
            return info
        if w > 0 and o.get("type") != "corner_window" and hi - lo < w - 0.25:
            info["problems"].append(("on_edge", f"{On} ({fmt(w)}) is wider than {A['name']}'s {fmt(hi - lo)} {side} wall."))
            return info
        info["outside"] = out
        info["valid"] = True
        return info

    def _open_to_pairs(self) -> dict[tuple[str, str], dict]:
        pairs: dict[tuple[str, str], dict] = {}
        for r in self.rooms:
            for other in r.get("open_to") or []:
                key = tuple(sorted((r["id"], other)))
                if key in pairs:
                    continue
                b = self.by_id.get(other)
                res = {"valid": False, "problem": None, "edge": None}
                if not b or b.get("level") != r.get("level"):
                    res["problem"] = (f"{r['name']} is open to {self.name(other)}, which is not on the same floor." if b else
                                      f"{r['name']} is open to a room that isn't in the plan.")
                else:
                    e = shared_edge(self.R[r["id"]], self.R[other])
                    if not e or e[3] - e[2] < 3.0:
                        res["problem"] = (f"{r['name']} is open to {b['name']} but they don't share a wall at least 3 ft long, "
                                          f"so no connection is built.")
                    elif r.get("type") in PRIVATE | WET or b.get("type") in PRIVATE | WET:
                        res["problem"] = f"{r['name']} can't be open-plan to {b['name']}; bedrooms and baths need doors."
                        res["edge"] = e
                    elif {r.get("type"), b.get("type")} & KITCHENS and {r.get("type"), b.get("type")} & (PRIVATE | WET):
                        res["problem"] = f"{r['name']} can't be open to {b['name']}."
                    else:
                        res["valid"], res["edge"] = True, e
                pairs[key] = res
        return pairs

    # graph ------------------------------------------------------------------------------------
    def _graph(self) -> None:
        self.adj: dict[str, set[str]] = defaultdict(set)       # every connection, incl. stairs
        self.door_adj: dict[str, set[str]] = defaultdict(set)  # doors and open_to only
        self.door_ops: dict[str, list[dict]] = defaultdict(list)

        def link(a, b, door=True):
            if not a or not b or a == b:
                return
            self.adj[a].add(b)
            self.adj[b].add(a)
            if door:
                self.door_adj[a].add(b)
                self.door_adj[b].add(a)

        for o in self.openings:
            inf = self.info[o["id"]]
            if not inf["valid"] or o.get("type") not in DOORS:
                continue
            if inf["kind"] == "pair":
                a, b = inf["rooms"]
                link(a, b)
                self.door_ops[a].append(o)
                self.door_ops[b].append(o)
            else:
                a = inf["rooms"][0]
                tgt = inf["outside"] or (EXT if o.get("level") == self.ground else ROOF if o.get("level") == self.roof_id else None)
                link(a, tgt)
                self.door_ops[a].append(o)
        for (a, b), res in self.open_pairs.items():
            if res["valid"]:
                link(a, b)
        for r in self.rooms:
            if r.get("level") == self.ground and r.get("type") in GROUND_OUT:
                link(r["id"], EXT)
            if r.get("level") == self.roof_id and r.get("type") in OPEN:
                link(r["id"], ROOF)
        self.stair_nodes: dict[str, tuple[str | None, str | None]] = {}
        for s in self.stairs:
            sr = rect_of(s)
            cx, cy = (sr[0] + sr[2]) / 2, (sr[1] + sr[3]) / 2
            a = self.room_at(s.get("from_level"), cx, cy, enclosed=True)
            b = None
            if s.get("to_level") == self.roof_id:
                b = self.room_at(self.roof_id, cx, cy, enclosed=True) if self.roof_id else None
                if not b:
                    b = MUMTY if self.mumty and contains(self.mumty, cx, cy) else ROOF
            else:
                b = self.room_at(s.get("to_level"), cx, cy, enclosed=True)
            self.stair_nodes[s["id"]] = (a, b)
            link(a, b, door=False)
        if self.mumty:
            link(MUMTY, ROOF, door=False)

    def bfs(self, starts: Iterable[str], terminal: set[str] | None = None, blocked: set[str] | None = None,
            adj: dict | None = None) -> dict[str, str | None]:
        """Breadth-first search; returns node -> parent. Terminal nodes are entered but not expanded."""
        adj = adj or self.adj
        terminal, blocked = terminal or set(), blocked or set()
        par: dict[str, str | None] = {}
        q = deque()
        for s in starts:
            if s and s not in par:
                par[s] = None
                q.append(s)
        while q:
            u = q.popleft()
            if u in terminal and par[u] is not None:
                continue
            for v in adj.get(u, ()):
                if v in par or v in blocked:
                    continue
                par[v] = u
                q.append(v)
        return par

    # stairs -----------------------------------------------------------------------------------
    def stair_geo(self, s: dict) -> dict:
        """Mirror of the engine's layoutStair (docs/review/architecture-rules.md A.1)."""
        r = rect_of(s)
        frm, to = self.lv.get(s.get("from_level")), self.lv.get(s.get("to_level"))
        rise = (float(to["elevation_ft"]) - float(frm["elevation_ft"])) if frm and to else 11.0
        riser = float(s.get("riser_in") or 7)
        n = max(1, round(rise * 12 / riser)) if riser > 0 else 1
        start = s.get("start", "+y")
        along_y = start in ("+y", "-y")
        length = (r[3] - r[1]) if along_y else (r[2] - r[0])
        breadth = (r[2] - r[0]) if along_y else (r[3] - r[1])
        kind = s.get("kind", "dogleg")
        # E = the edge where the first riser is; a dog-leg starts AND arrives there, a straight flight arrives opposite.
        e_side = {"+y": "front", "-y": "back", "+x": "left", "-x": "right"}[start] if start in ("+y", "-y", "+x", "-x") else "front"
        far_side = {"front": "back", "back": "front", "left": "right", "right": "left"}[e_side]
        return {"rect": r, "rise": rise, "N": n, "riser_in": rise * 12 / n, "T": max(float(s.get("tread_in") or 10), 10) / 12,
                "tread_in": float(s.get("tread_in") or 0), "length": length, "breadth": breadth, "kind": kind, "start": start,
                "e_side": e_side, "arrive_side": e_side if kind == "dogleg" else far_side, "width": float(s.get("width_ft") or 0)}

    def strip(self, r: Rect, side: str, depth: float) -> Rect:
        """The strip of `depth` ft just outside rect r on `side`."""
        x0, y0, x1, y1 = r
        return {"front": (x0, y0 - depth, x1, y0), "back": (x0, y1, x1, y1 + depth),
                "left": (x0 - depth, y0, x0, y1), "right": (x1, y0, x1 + depth, y1)}[side]


def _rect_ok(r) -> bool:
    try:
        return r is not None and float(r["w"]) > 0 and float(r["d"]) > 0 and math.isfinite(float(r["x"])) and math.isfinite(float(r["y"]))
    except (KeyError, TypeError, ValueError):
        return False


def _pt_ok(p) -> bool:
    try:
        return len(p) == 2 and all(math.isfinite(float(v)) for v in p)
    except (TypeError, ValueError):
        return False


# --- daylight (used by lda.glazing) -----------------------------------------------------------------------------------
def valid_glazing(ix: PlanIndex, room_id: str) -> float:
    """Glazing (sq ft) that really lights the room: a valid opening on the room's own wall, same level, to the outside or
    to a same-level porch, balcony, terrace or open space (P-01, P-02, P-03, P-16). An open space or courtyard only lights a
    window where it is open to the sky: a room, terrace or balcony on a higher floor over it roofs it over."""
    total = 0.0
    for o in ix.openings:
        if room_id not in o["between"] or o.get("type") not in GLAZED:
            continue
        inf = ix.info[o["id"]]
        if not inf["valid"]:
            continue
        if inf["kind"] == "pair":
            other = next(r for r in inf["rooms"] if r != room_id) if len(set(inf["rooms"])) > 1 else None
            if not other or ix.type(other) not in OPEN:
                continue
        else:
            other = inf.get("outside")
        if not ix.sky_lit(o, other):
            continue
        total += float(o.get("width_ft") or 0) * float(o.get("height_ft") or 0)
    return total


# --- normalisation (deterministic repairs before checking) ---------------------------------------------------------
def drop_open_edge_openings(plan: dict) -> list[str]:
    """Doors and arches between two rooms that are open-plan to each other (open_to): the 3D engine builds no wall on that
    edge, so the opening is never built and shows up as "Opening not built". Drop them. Returns their ids."""
    ix = PlanIndex(plan)
    gone = [o["id"] for o in ix.openings if ix.info[o["id"]]["kind"] == "pair" and len(set(ix.info[o["id"]]["rooms"])) == 2
            and ix.open_pairs.get(tuple(sorted(ix.info[o["id"]]["rooms"])), {}).get("valid")]
    if gone:
        plan["openings"] = [o for o in plan.get("openings") or [] if o.get("id") not in set(gone)]
    return gone


def normalize(plan: dict) -> list[str]:
    """Deterministic repairs of small slips that don't change the design: snap each opening onto the wall it names and
    slide it along that wall so it fits with jambs. Returns a list of what was changed."""
    ix = PlanIndex(plan)
    changed = []
    for o in ix.openings:
        a_id, b_id = o["between"]
        if "exterior" in (a_id, b_id) or a_id not in ix.R or b_id not in ix.R:
            continue
        if ix.by_id[a_id].get("level") != o.get("level") or ix.by_id[b_id].get("level") != o.get("level"):
            continue
        e = shared_edge(ix.R[a_id], ix.R[b_id])
        if not e:
            continue
        axis, c, lo, hi = e
        w = float(o.get("width_ft") or 0)
        x, y = float(o["at"][0]), float(o["at"][1])
        along = x if axis == "x" else y
        if hi - lo >= w + 0.6:
            along2 = min(max(along, lo + 0.3 + w / 2), hi - 0.3 - w / 2)
        elif hi - lo >= w:
            along2 = (lo + hi) / 2
        else:
            along2 = along
        new = [round(along2, 2), round(c, 2)] if axis == "x" else [round(c, 2), round(along2, 2)]
        if abs(new[0] - x) > 0.01 or abs(new[1] - y) > 0.01:
            o["at"] = new
            changed.append(o["id"])
    return changed


# --- the checks ------------------------------------------------------------------------------------------------------
class _Out:
    def __init__(self):
        self.checks: list[dict] = []
        self.seen: set[str] = set()

    def add(self, cid: str, title: str, status: str, message: str, ids=(), fix: str | None = None, ref: str | None = None,
            value=None, limit=None, unit: str | None = None):
        if cid in self.seen:
            return
        self.seen.add(cid)
        c = {"id": cid, "title": title, "status": status, "message": message, "category": "livable",
             "rule_ref": ref or REF, "element_ids": [i for i in ids if i and i not in (EXT, ROOF, MUMTY)]}
        if value is not None:
            c["value"] = value
        if limit is not None:
            c["limit"] = limit
        if unit:
            c["unit"] = unit
        if fix:
            c["fix"] = fix
        self.checks.append(c)


FRONT_SLACK_FT = 3.0
FRONT_FACERS = {"bedroom", "master_bedroom", "guest_bedroom", "lounge", "drawing", "dining", "study", "balcony", "terrace"}


def _massing(ix: PlanIndex, out: _Out) -> None:
    """The house reads as a full facade from the road: each upper floor comes forward to the ground floor's building line
    (with a room or a balcony), and the front of every floor is a room people live in."""
    def front(lid: str, types: set[str] | None = None) -> tuple[float, str] | None:
        rs = [(ix.R[r["id"]][1], r["id"]) for r in ix.level_rooms(lid)
              if r.get("type") not in {"lawn", "driveway", "open_space", "courtyard", "porch"}
              and (types is None or r.get("type") in types)]
        return min(rs) if rs else None
    levels = [lv for lv in ix.levels if lv["id"] != ix.roof_id and lv.get("index", 0) >= 0]
    ground = next((lv for lv in levels if lv.get("index") == 0), None)
    g = front(ground["id"]) if ground else None
    if not g:
        return
    for lv in levels:
        if lv.get("index", 0) < 1:
            continue
        f = front(lv["id"])
        if not f:
            continue
        gap = f[0] - g[0]
        name = ix.lname(lv["id"])
        out.add(f"plan.massing.front:{lv['id']}", f"{name} facade", "fail" if gap > FRONT_SLACK_FT else "pass",
                f"The {name.lower()} starts {gap:g} ft behind the ground floor's front, so from the road the house reads as a "
                f"stepped box." if gap > FRONT_SLACK_FT else f"The {name.lower()} comes forward to the building line.",
                ids=[f[1]], value=round(gap, 2), limit=FRONT_SLACK_FT, unit="ft",
                fix=f"Bring the {name.lower()}'s front rooms (a bedroom, the lounge or a balcony over the porch) forward to "
                    f"y = {g[0]:g} ft, the ground floor's building line, and move the open roof or terrace to the back.")
        lead = front(lv["id"], FRONT_FACERS)
        if lead and gap <= FRONT_SLACK_FT and lead[0] - f[0] > 8:
            out.add(f"plan.massing.front_rooms:{lv['id']}", f"{name} front rooms", "warn",
                    f"The front of the {name.lower()} is a service room ({ix.name(f[1])}); bedrooms and lounges should face "
                    f"the road.", ids=[f[1]], fix="Swap it with a bedroom or the lounge, or put a balcony in front of it.")


def check(plan: dict, brief: dict | None = None) -> list[dict]:
    """All Naqsha planning rules for a plan (and optionally the brief it should honour)."""
    out = _Out()
    try:
        ix = PlanIndex(plan)
    except Exception as e:  # malformed plan: report it rather than crash the pipeline
        log.exception("planning index failed")
        out.add("plan.malformed", "Plan structure", "fail", f"The plan could not be read ({type(e).__name__}).")
        return out.checks
    for rule in (_openings, _clash, _open_to, _privacy, _baths, _wc_on_entry, _reach, _routes, _main_door, _widths, _dead_ends,
                 _porch, _solid_walls, _bath_sizes, _dressing_sizes, _covered_open, _stairs, _mumty, _roof_services, _program,
                 _wet_over_dry, _massing):
        try:
            if rule in (_roof_services, _program, _porch):
                rule(ix, out, brief or {})
            else:
                rule(ix, out)
        except Exception:  # one broken rule must not hide the others
            log.exception("planning rule %s failed", rule.__name__)
    # One named rule per family, shown as a pass when none of its detailed checks failed (the failures speak for themselves).
    families = [
        ("plan.rule.independence", "Rooms are independent", ("plan.privacy", "plan.circulation.balcony_links_bedrooms"),
         "Bedrooms open only onto a corridor, lobby, lounge, balcony or their own bath; no two bedrooms share a balcony; a "
         "dressing opens only into its own bedroom; baths have one door."),
        ("plan.rule.circulation", "Every room has a proper way in", ("plan.circulation", "plan.open_to"),
         "Every room is reached through circulation, never through a bedroom or bath, and the family reaches the lounge "
         "without crossing the drawing room."),
        ("plan.rule.stairs", "Stairs reach every floor and the roof", ("plan.stair",),
         "One stacked stair climbs to every floor and the roof, with a 3 ft landing at the foot and the top."),
        ("plan.rule.roof_door", "The roof door is at the top of the stair", ("plan.roof.mumty",),
         "The stair tower covers the stair and its top landing, and its door opens beside that landing."),
        ("plan.rule.openings", "Doors and windows fit their walls", ("plan.opening",),
         "Every door and window sits on a wall the two rooms share, on the same floor, and fits inside it."),
    ]
    if brief:
        families.append(("plan.rule.brief", "Rooms match your brief", ("plan.program",),
                         "The bedrooms, baths and rooms on each floor follow the brief."))
    failed = [c["id"] for c in out.checks if c["status"] == "fail"]
    for cid, title, prefixes, msg in families:
        if not any(f.startswith(prefixes) for f in failed):
            out.add(cid, title, "pass", msg)
    try:
        _promised(ix, out)
    except Exception:
        log.exception("planning rule _promised failed")
    return out.checks


def sentence_case(name: str) -> str:
    """"Master Bedroom" -> "Master bedroom", "TV Lounge" -> "TV lounge", "Bath 2" stays (web/src/app/plan/model.ts)."""
    words = str(name or "").strip().split()

    def keep(w: str) -> bool:
        letters = re.sub(r"[^A-Za-z]", "", w)
        return (len(letters) >= 2 and letters == letters.upper()) or bool(re.search(r"\d", w))
    return " ".join(w[:1].upper() + w[1:] if i == 0 else w if keep(w) else w.lower() for i, w in enumerate(words))


def in_sentence(name: str) -> str:
    """A room name inside a sentence: "Master Bedroom" -> "master bedroom", "TV Lounge" -> "TV lounge"."""
    s = sentence_case(name)
    return s if re.match(r"^.[A-Z]", s) else s[:1].lower() + s[1:]


def _promised(ix: PlanIndex, out: _Out) -> None:
    """The livable rules DESIGN.md promises on every plan that the app would otherwise derive itself
    (web/src/app/plan/compliance.ts livableChecks: same ids, titles and messages), so the server and the app count the same
    rows. Railings and door swings are the engine's guarantees; passages are read from the plan."""
    out.add("livable.railings", "Every stair edge and void has a railing", "pass",
            "A 3′6″ railing is built along every stair edge, void and balcony.", ids=[s["id"] for s in ix.stairs])
    out.add("livable.doors", "Doors are clear of furniture", "pass", "Furniture keeps out of every door swing.")
    narrow = [r for r in ix.rooms if r.get("type") in ("corridor", "lobby")
              and min(ix.R[r["id"]][2] - ix.R[r["id"]][0], ix.R[r["id"]][3] - ix.R[r["id"]][1]) < 3]
    out.add("livable.paths", "A clear 3 ft path to every door", "fail" if narrow else "pass",
            ", ".join(f"{sentence_case(r.get('name') or r['id'])} is "
                      f"{fmt(min(ix.R[r['id']][2] - ix.R[r['id']][0], ix.R[r['id']][3] - ix.R[r['id']][1]))} wide"
                      for r in narrow) + " (needs 3 ft)." if narrow else "Every passage is at least 3 ft wide.",
            ids=[r["id"] for r in narrow], fix="Make every corridor and lobby at least 4 ft wide." if narrow else None)


# P-01 .. P-03 ---------------------------------------------------------------------------------------------------------
def _openings(ix: PlanIndex, out: _Out) -> None:
    hints = {
        "same_level": "Delete it. If the room needs daylight, put a window on its own outside wall or add a light well beside it.",
        "on_edge": "Put every door and window on a wall the two rooms really share, 0.5 to 1 ft from a corner; the wall must be "
                   "at least the opening width + 0.6 ft long.",
        "party_wall": "Move it to a wall that faces the front, the rear or the side open space.",
        "door_to_drop": "Add a balcony or terrace room outside it, or turn it into a window.",
    }
    titles = {"same_level": "Opening on the wrong floor", "on_edge": "Opening placement", "party_wall": "Opening on a party wall",
              "door_to_drop": "Door to nowhere"}
    for o in ix.openings:
        inf = ix.info[o["id"]]
        for code, msg in inf["problems"]:
            rid = f"plan.opening.{code}:{o['id']}"
            out.add(rid, titles[code], "fail", msg, ids=[o["id"], *inf.get("rooms", [])], fix=hints[code],
                    ref=f"{REF} P-0{'1' if code == 'same_level' else '3' if code == 'party_wall' else '2'}")


GAP = 0.3  # the 3D engine keeps this much wall between two openings on one wall run (frames), or moves/skips the later one


def _wall_line(ix: PlanIndex, o: dict) -> tuple[str, float] | None:
    inf = ix.info.get(o["id"]) or {}
    if inf.get("edge"):
        return inf["edge"][0], inf["edge"][1]
    if inf.get("side") and inf.get("rooms"):
        axis, c, *_ = sides(ix.R[inf["rooms"][0]])[inf["side"]]
        return axis, c
    return None


def _clash(ix: PlanIndex, out: _Out) -> None:
    """P-02b: two openings on the same wall of a room must keep the engine's spacing, or the later one is moved or not built
    (the main door that never appeared in 3D)."""
    order = {o["id"]: i for i, o in enumerate(ix.openings)}
    groups: dict[tuple, list[tuple[float, float, dict]]] = defaultdict(list)
    for o in ix.openings:
        inf = ix.info[o["id"]]
        if not inf["valid"] or o.get("type") == "corner_window":
            continue
        line = _wall_line(ix, o)
        encl = tuple(sorted(r for r in inf["rooms"] if ix.type(r) not in OPEN))
        if not line or not encl:
            continue
        axis, c = line
        along = float(o["at"][0]) if axis == "x" else float(o["at"][1])
        w = float(o.get("width_ft") or 0)
        groups[(o.get("level"), encl, axis, round(c * 2) / 2)].append((along - w / 2, along + w / 2, o))
    for items in groups.values():
        for i in range(len(items)):
            for j in range(i + 1, len(items)):
                a0, a1, oa = items[i]
                b0, b1, ob = items[j]
                gap = max(b0 - a1, a0 - b1)
                if gap >= GAP - 1e-6:
                    continue
                first, later = sorted((oa, ob), key=lambda o: order[o["id"]])
                door = oa.get("type") in DOORS or ob.get("type") in DOORS
                nl, nf = ix.oname(later), ix.oname(first)
                how = "overlap" if gap < 0 else "touch" if gap <= 0.04 else f"are only {max(1, round(gap * 12))} in apart"
                out.add(f"plan.opening.clash:{later['id']}", "Openings too close", "fail" if door else "warn",
                        f"{nl[:1].upper() + nl[1:]} and {nf} {how} on the same wall; the frames need at least 4 in of wall "
                        f"between them, so one would be moved or left out.", ids=[later["id"], first["id"]],
                        fix=f"Slide {later['id']} or {first['id']} along the wall so at least 0.5 ft of wall stays between them "
                            f"(or make one narrower).", ref=f"{REF} P-02")


# P-04 ----------------------------------------------------------------------------------------------------------------
def _open_to(ix: PlanIndex, out: _Out) -> None:
    for (a, b), res in ix.open_pairs.items():
        if not res["valid"]:
            out.add(f"plan.open_to:{a}:{b}", "Open-plan link", "fail", res["problem"], ids=[a, b],
                    fix="Use open_to only between living rooms or circulation on the same floor that share a wall at least 3 ft "
                        "long; bedrooms and baths get doors.", ref=f"{REF} P-04")


# P-05, P-09 ---------------------------------------------------------------------------------------------------------
def _privacy(ix: PlanIndex, out: _Out) -> None:
    for r in ix.rooms:
        t = r.get("type")
        if t not in PRIVATE:
            continue
        rid = r["id"]
        for nb in sorted(ix.door_adj.get(rid, ())):
            nt = ix.type(nb)
            bad = None
            if nt in PRIVATE:
                bad = f"{r['name']} opens directly into {ix.name(nb)}. Bedrooms must open onto a corridor, lobby, lounge or their own bath or balcony."
            elif nt in SERVICE:
                bad = f"{r['name']} opens into the {ix.name(nb).lower()}. A bedroom never opens into a kitchen, laundry or store."
            elif nt in WET and len([x for x in ix.door_adj.get(nb, ()) if x != EXT]) > 1:
                bad = f"{r['name']} shares {ix.name(nb)} with another room. An attached bath opens only into its own bedroom."
            elif nt == "drawing" and t not in ("guest_bedroom", "servant"):
                bad = f"{r['name']} opens into the drawing room, where guests sit."
            elif nt == "prayer":
                bad = f"{r['name']} opens through the prayer room. Keep the prayer room off the way into a bedroom."
            if bad and nt in PRIVATE and f"plan.privacy.bedroom_door:{nb}:{rid}" in out.seen:
                continue  # one finding per pair of bedrooms
            if bad:
                out.add(f"plan.privacy.bedroom_door:{rid}:{nb}", "Bedroom privacy", "fail", bad, ids=[rid, nb],
                        fix=f"Give {r['name']} its own door onto a corridor, lobby or lounge; if it touches none, add a corridor "
                            f"at least 4 ft wide along the bedrooms.", ref=f"{REF} P-05")
        if t == "servant":
            continue
        ok_targets = CIRC | {"lounge", "dining"} | ({"drawing"} if t == "guest_bedroom" else set())
        if not any(ix.type(nb) in ok_targets for nb in ix.door_adj.get(rid, ())):
            via = sorted({ix.name(nb) for nb in ix.door_adj.get(rid, ()) if ix.type(nb) not in WET | {"dressing"}})
            msg = (f"{r['name']} has no door to a corridor, lobby or lounge" +
                   (f"; it is entered only from {', '.join(via)}." if via else "."))
            out.add(f"plan.privacy.bedroom_access:{rid}", "Bedroom entrance", "fail", msg, ids=[rid],
                    fix=f"Give {r['name']} a door onto circulation (corridor, lobby, stair hall) or the family lounge.",
                    ref=f"{REF} P-05")
    _dressings(ix, out)
    _shared_outdoors(ix, out)


DECK = {"balcony", "terrace", "porch"}


def _shared_outdoors(ix: PlanIndex, out: _Out) -> None:
    """P-09: balconies and terraces that touch (a shared edge of 1 ft or more) are one open deck; if two bedrooms open onto
    the same deck, one bedroom can be entered from the other without crossing circulation."""
    decks = [r for r in ix.rooms if r.get("type") in DECK and r.get("level") not in (ix.ground, ix.roof_id)]
    seen: set[str] = set()
    for r in decks:
        if r["id"] in seen:
            continue
        comp, q = [], deque([r["id"]])
        seen.add(r["id"])
        while q:
            u = q.popleft()
            comp.append(u)
            for v in decks:
                if v["id"] in seen or v.get("level") != ix.by_id[u].get("level"):
                    continue
                e = shared_edge(ix.R[u], ix.R[v["id"]])
                if e and e[3] - e[2] >= 1.0 - 1e-6:
                    seen.add(v["id"])
                    q.append(v["id"])
        beds = sorted({nb for d in comp for nb in ix.door_adj.get(d, ()) if ix.type(nb) in PRIVATE})
        if len(beds) < 2:
            continue
        comp.sort()
        where = ix.name(comp[0]) + " connects" if len(comp) == 1 else f"{_and([ix.name(d) for d in comp])} touch, so they connect"
        out.add(f"plan.circulation.balcony_links_bedrooms:{comp[0]}", "Shared balcony", "fail",
                f"{where} {_and([ix.name(b) for b in beds])}: one bedroom can be entered from another without crossing a "
                f"corridor or lounge.",
                ids=[*comp, *beds], fix="Give each bedroom its own balcony that touches no other bedroom's balcony (keep a "
                "room or a gap of at least 1 ft between them), or open the shared one onto the lounge or a corridor and not "
                "into more than one bedroom.", ref=f"{REF} P-09")


def _dressings(ix: PlanIndex, out: _Out) -> None:
    """P-05b: a dressing (or walk-in closet) belongs to one bedroom: it opens only into that bedroom and/or its own bath."""
    for r in ix.rooms:
        closet = r.get("type") not in PRIVATE | WET | OPEN | CIRC and re.search(r"closet|walk.?in|wardrobe", r.get("name", ""), re.I)
        if r.get("type") != "dressing" and not closet:
            continue
        rid = r["id"]
        nbs = sorted(n for n in ix.door_adj.get(rid, ()) if n != EXT)
        if not nbs:
            continue  # no door at all: the reach rule reports it
        beds = [n for n in nbs if ix.type(n) in PRIVATE]
        baths = [n for n in nbs if ix.type(n) in WET]
        others = [n for n in nbs if n not in beds and n not in baths]
        owner = beds[0] if len(beds) == 1 else None
        if not beds:
            via = {m for b in baths for m in ix.door_adj.get(b, ()) if ix.type(m) in PRIVATE}
            owner = next(iter(via)) if len(via) == 1 else None
        shared_bath = [b for b in baths if any(m not in (rid, owner, EXT) for m in ix.door_adj.get(b, ()))]
        if others:
            msg = f"{r['name']} opens to {', '.join(ix.name(n) for n in others)}; a dressing opens only into its own bedroom."
        elif len(beds) > 1:
            msg = f"{r['name']} opens into both {ix.name(beds[0])} and {ix.name(beds[1])}; a dressing belongs to one bedroom."
        elif owner is None:
            msg = f"{r['name']} has no door from a bedroom."
        elif shared_bath:
            msg = f"{r['name']} opens into {ix.name(shared_bath[0])}, which other rooms use too."
        else:
            continue
        own = f" {ix.name(owner)}" if owner else " its bedroom"
        out.add(f"plan.privacy.dressing:{rid}", "Dressing off its bedroom", "fail", msg, ids=[rid, *nbs],
                fix=f"Give {r['name']} one door, into{own} (or that bedroom's own bath); move any door to a lounge or corridor "
                    f"onto the bedroom instead.", ref=f"{REF} P-05")


# P-06 ----------------------------------------------------------------------------------------------------------------
def _baths(ix: PlanIndex, out: _Out) -> None:
    for r in ix.rooms:
        if r.get("type") not in WET:
            continue
        rid, t = r["id"], r.get("type")
        nbs = [nb for nb in ix.door_adj.get(rid, ()) if nb != EXT]
        if not nbs:
            if not ix.door_adj.get(rid):
                out.add(f"plan.privacy.bath_door:{rid}", "Bath door", "fail", f"{r['name']} has no door.", ids=[rid],
                        fix="Give it one door into its bedroom or onto circulation.", ref=f"{REF} P-06")
            continue
        if len(nbs) > 1:
            out.add(f"plan.privacy.bath_door:{rid}", "Bath door", "fail",
                    f"{r['name']} has {len(nbs)} doors ({', '.join(ix.name(n) for n in nbs)}). A bath opens into one room only.",
                    ids=[rid, *nbs], fix="Keep one door: into its own bedroom, or onto a corridor or lobby for a common bath.",
                    ref=f"{REF} P-06")
            continue
        nb = nbs[0]
        nt = ix.type(nb)
        allowed = PRIVATE | {"dressing"} | CIRC | {"lounge"} | ({"drawing"} if t == "powder" else set())
        if nt == "dining":
            # A powder room or common bath whose only door frames the dining table: guests eat facing the WC door.
            out.add(f"plan.privacy.wc_into_dining:{rid}", "Toilet off the dining", "fail",
                    f"{r['name']} opens straight into {ix.name(nb)}, so the toilet door faces the dining table.", ids=[rid, nb],
                    fix=f"Open {r['name']} off a lobby, passage or the lounge instead of {ix.name(nb)}, or put a small lobby "
                        f"(at least 4 ft deep) in front of its door.", ref=f"{REF} P-06")
        elif nt not in allowed:
            out.add(f"plan.privacy.bath_door:{rid}", "Bath door", "fail", f"{r['name']} opens into {ix.name(nb)}.",
                    ids=[rid, nb], fix="Open it into its own bedroom, a corridor, a lobby or the lounge; never a kitchen, store, "
                                       "prayer room or another bath.", ref=f"{REF} P-06")
        if "master" in (rid + " " + r.get("name", "")).lower() and nt not in ("master_bedroom", "dressing"):
            out.add(f"plan.privacy.master_bath:{rid}", "Master bath", "fail",
                    f"{r['name']} does not open into the master bedroom.", ids=[rid, nb],
                    fix="Put the master bath's only door on the wall it shares with the master bedroom (or its dressing).",
                    ref=f"{REF} P-06")


# P-06b ---------------------------------------------------------------------------------------------------------------
WC_CONE_DEG, WC_CONE_FT = 30.0, 15.0  # a WC door this close to the main door's line of sight is in view from the porch
# an entrance lobby shallower than this, with this many doors or more (the main door included), is a pinch point
LOBBY_MIN_DEPTH, LOBBY_DOORS = 5.0, 4


def _span(o: dict, axis: str) -> tuple[float, float]:
    u = float(o["at"][0]) if axis == "x" else float(o["at"][1])
    w = float(o.get("width_ft") or 0)
    return u - w / 2, u + w / 2


def _wc_on_entry(ix: PlanIndex, out: _Out) -> None:
    """P-06b (purdah): from the open main door, guests on the porch must not look straight into a WC. A powder room or common
    bath whose door opens into the room the main door opens into (the lobby, lounge or drawing room) fails when that door
    faces the main door from the opposite wall with the two door spans overlapping across the room, or lies within about 30°
    of the main door's line and within 15 ft of it."""
    mains = [o for o in _main_doors(ix) if o.get("level") == ix.ground and ix.info[o["id"]]["valid"]]
    if not mains:
        return
    m = mains[0]
    inside = _inside_of(ix, m)
    line = _wall_line(ix, m)
    if not inside or not line:
        return
    axis, c = line
    ir = ix.R[inside]
    # the main door's line of sight: square to its wall, into the room it opens into
    if axis == "x":
        n = (0.0, 1.0 if (ir[1] + ir[3]) / 2 > c else -1.0)
    else:
        n = (1.0 if (ir[0] + ir[2]) / 2 > c else -1.0, 0.0)
    mx, my = float(m["at"][0]), float(m["at"][1])
    m0, m1 = _span(m, axis)
    for o in ix.door_ops.get(inside, []):
        if o is m or o.get("type") not in DOORS:
            continue
        inf = ix.info[o["id"]]
        if inf["kind"] != "pair":
            continue
        wc = next((r for r in inf["rooms"] if r != inside), None)
        if not wc or ix.type(wc) not in WET:
            continue  # its door opens into the entry room, so it is a powder room or a common bath, never an attached one
        dl = _wall_line(ix, o)
        if not dl:
            continue
        dx, dy = float(o["at"][0]), float(o["at"][1])
        vx, vy = dx - mx, dy - my
        fwd = vx * n[0] + vy * n[1]
        if fwd <= 0.5:
            continue  # on the main door's own wall, or behind it
        facing = False
        if dl[0] == axis:  # a parallel wall across the room: the two door spans overlap when projected across it
            d0, d1 = _span(o, axis)
            facing = min(m1, d1) - max(m0, d0) > 0.05
        dist = math.hypot(vx, vy)
        angle = math.degrees(math.atan2(abs(vx * n[1] - vy * n[0]), fwd))
        in_line = dist <= WC_CONE_FT + 1e-6 and angle <= WC_CONE_DEG + 1e-6
        if not (facing or in_line):
            continue
        wn, rn = ix.name(wc), ix.name(inside)
        where = (f"its door faces the main door across the {rn}" if facing else
                 f"its door is {ft(dist)} from the main door, almost in line with it, in the {rn}")
        out.add(f"plan.privacy.wc_on_entry:{wc}", "Toilet in view of the main door", "fail",
                f"From the main door you look straight into the {wn}: {where}, so guests at the door see the WC.",
                ids=[wc, o["id"], m["id"], inside],
                fix=f"Move the {wn} door to a side wall of the {rn}, out of the main door's line of sight (or round a corner), "
                    f"or turn the lobby so the two doors don't face each other; from the porch, guests should see a wall.",
                ref=f"{REF} P-06")
    if ix.type(inside) == "lobby":
        x0, y0, x1, y1 = ir
        doors = [o for o in ix.door_ops.get(inside, []) if o.get("type") in DOORS]
        depth = min(x1 - x0, y1 - y0)
        if depth + 1e-6 < LOBBY_MIN_DEPTH and len(doors) >= LOBBY_DOORS:
            out.add(f"plan.circulation.lobby_crowded:{inside}", "Entrance lobby", "warn",
                    f"The {ix.name(inside)} is only {fmt(depth)} deep but {len(doors)} doors open off it; their swings meet and "
                    f"there is no room to greet a guest or put down a bag.", ids=[inside, *[o["id"] for o in doors]],
                    fix="Make the entrance lobby at least 5 ft deep, or move one of its doors to the lounge or a passage.",
                    ref=f"{REF} P-13")


# P-08 ----------------------------------------------------------------------------------------------------------------
VOID_TYPES = {"open_space", "courtyard"}


def is_void(ix: PlanIndex, rid: str) -> bool:
    """An upper-floor open_space (or courtyard) over a court: at least half of it lies over open-to-sky ground below (an
    open_space or courtyard on a lower level, itself possibly a void). It is a hole in the floor with a railing, not a
    floor, so it needs no way in (the engine's definition: it builds no slab there and rails its edges)."""
    r = ix.by_id.get(rid)
    if not r or r.get("type") not in VOID_TYPES or ix.level_index(r.get("level")) <= ix.level_index(ix.ground):
        return False
    a = ix.R[rid]
    lid_i = ix.level_index(r.get("level"))
    below = [ix.R[x["id"]] for x in ix.rooms
             if x.get("type") in VOID_TYPES and ix.level_index(x.get("level")) < lid_i and x["id"] != rid]
    over = union_area([i for b in below if (i := inter(a, b))])
    return area(a) > 0 and over >= 0.5 * area(a)


def _reach(ix: PlanIndex, out: _Out) -> None:
    terminal = {r["id"] for r in ix.rooms if r.get("type") in PRIVATE | WET | {"dressing"}}
    free = ix.bfs([EXT], terminal=terminal)
    anyway = ix.bfs([EXT])
    for r in ix.rooms:
        rid, t = r["id"], r.get("type")
        if rid in free:
            continue
        if r.get("level") == ix.roof_id and t in OPEN:
            continue  # roof decks: covered by the stair checks
        nbs = [n for n in ix.door_adj.get(rid, ()) if n != EXT]
        if t in WET | {"dressing"} and len(nbs) == 1 and ix.type(nbs[0]) in PRIVATE | {"dressing"}:
            continue  # attached bath / dressing
        if t in ("balcony", "terrace") and len(nbs) == 1 and ix.type(nbs[0]) in PRIVATE:
            continue  # a bedroom's own balcony
        if t in OPEN and r.get("level") == ix.ground:
            continue
        if is_void(ix, rid):
            continue  # open to the court below: nobody walks on it (the engine rails its edges)
        if rid in anyway:
            path, cur = [], anyway[rid]
            while cur and cur != EXT:
                if cur in terminal:
                    path.append(ix.name(cur))
                cur = anyway.get(cur)
            via = ", ".join(reversed(path)) or "another private room"
            out.add(f"plan.circulation.reach_through_private:{rid}", "Reached through a private room", "fail",
                    f"{r['name']} can only be reached through {via}.", ids=[rid],
                    fix=f"Give {r['name']} a door onto circulation (corridor, lobby, stair hall or lounge).", ref=f"{REF} P-08")
        else:
            status = "warn" if t in OPEN else "fail"
            out.add(f"plan.circulation.unreachable:{rid}", "No way in", status,
                    f"{r['name']} on the {ix.lname(r.get('level'))} has no way in.", ids=[rid],
                    fix=f"Add a door from {r['name']} to the room next to it, on a wall they share.", ref=f"{REF} P-08")


# P-10, P-11 ---------------------------------------------------------------------------------------------------------------
def _main_doors(ix: PlanIndex) -> list[dict]:
    return [o for o in ix.openings if o.get("type") == "main_door"]


def _inside_of(ix: PlanIndex, o: dict) -> str | None:
    inf = ix.info[o["id"]]
    if not inf["valid"]:
        return None
    cands = [r for r in inf["rooms"] if ix.type(r) not in OPEN]
    return cands[0] if cands else None


def _routes(ix: PlanIndex, out: _Out) -> None:
    mains = [o for o in _main_doors(ix) if o.get("level") == ix.ground]
    inside = next((x for x in (_inside_of(ix, o) for o in mains) if x), None)
    lounges = {r["id"] for r in ix.level_rooms(ix.ground) if r.get("type") == "lounge"}
    if inside and lounges and inside not in lounges:
        outdoor = {r["id"] for r in ix.rooms if r.get("type") in OPEN} | {EXT, ROOF, MUMTY}
        terminal = {r["id"] for r in ix.rooms if r.get("type") in PRIVATE | WET | SERVICE | {"drawing"}}
        seen = ix.bfs([inside], terminal=terminal, blocked=outdoor)
        if not (set(seen) & lounges):
            through = "the drawing room" if any(ix.type(n) == "drawing" for n in ix.bfs([inside], blocked=outdoor)) else "other rooms"
            out.add("plan.circulation.family_route", "Family route", "fail",
                    f"From the main door the family lounge can only be reached through {through}.", ids=[inside, *lounges],
                    fix="Join the entrance lobby to the lounge with a door or arch on a wall they share, or put the main door into "
                        "the lounge.", ref=f"{REF} P-10")
    drawings = [r["id"] for r in ix.level_rooms(ix.ground) if r.get("type") == "drawing"]
    if drawings:
        allowed = {r["id"] for r in ix.rooms if r.get("type") in GROUND_OUT | {"lobby", "corridor"} and r.get("level") == ix.ground}
        terminal = set(drawings)
        seen = ix.bfs([EXT], terminal=terminal, blocked={r["id"] for r in ix.rooms if r["id"] not in allowed | terminal})
        if not set(seen) & terminal:
            out.add("plan.circulation.guest_route", "Guest route", "warn",
                    "Guests can't reach the drawing room without walking through the family's rooms.", ids=drawings,
                    fix="Give the drawing room a door from the porch or the entrance lobby.", ref=f"{REF} P-11")


# P-12 ----------------------------------------------------------------------------------------------------------------
def _main_door(ix: PlanIndex, out: _Out) -> None:
    mains = _main_doors(ix)
    if not mains:
        out.add("plan.circulation.main_door", "Main door", "fail", "The house has no main door.",
                fix="Add one main_door on the ground floor from the porch (or outside) into a lobby or the lounge.", ref=f"{REF} P-12")
        return
    if len(mains) > 1:
        out.add("plan.circulation.main_door", "Main door", "fail", f"The plan has {len(mains)} main doors; a house has one.",
                ids=[o["id"] for o in mains], fix="Keep one main_door; make the others ordinary doors.", ref=f"{REF} P-12")
    o = mains[0]
    if o.get("level") != ix.ground:
        out.add("plan.circulation.main_door", "Main door", "fail", f"The main door is on the {ix.lname(o.get('level'))}.",
                ids=[o["id"]], fix="Put the main door on the ground floor.", ref=f"{REF} P-12")
        return
    inside = _inside_of(ix, o)
    if inside and ix.type(inside) == "drawing":
        out.add("plan.circulation.main_door_room", "Main door", "warn",
                "The main door opens into the drawing room, so the family passes through the guests' room.", ids=[o["id"], inside],
                fix="Open the main door into a lobby or the lounge; give the drawing room its own door.", ref=f"{REF} P-12")
    elif inside and ix.type(inside) not in CIRC | {"lounge"}:
        out.add("plan.circulation.main_door_room", "Main door", "fail", f"The main door opens into {ix.name(inside)}.",
                ids=[o["id"], inside], fix="Open the main door into a lobby, corridor, stair hall or the lounge.", ref=f"{REF} P-12")


# P-13 ----------------------------------------------------------------------------------------------------------------
def _widths(ix: PlanIndex, out: _Out) -> None:
    for r in ix.rooms:
        if r.get("type") in ("corridor", "lobby"):
            x0, y0, x1, y1 = ix.R[r["id"]]
            clear = min(x1 - x0, y1 - y0) - 0.375
            if clear < 3.0 - 1e-6:
                out.add(f"plan.circulation.width:{r['id']}", "Passage width", "fail",
                        f"{r['name']} is only {fmt(clear)} clear; people need at least 3 ft to pass.", ids=[r["id"]],
                        fix="Make corridors and lobbies at least 4 ft wide (centre-line).", ref=f"{REF} P-13", value=round(clear, 2),
                        limit=3.0, unit="ft")
            elif clear < 3.5 - 1e-6:
                out.add(f"plan.circulation.width:{r['id']}", "Passage width", "warn",
                        f"{r['name']} is {fmt(clear)} clear; 3′6″ is comfortable.", ids=[r["id"]], ref=f"{REF} P-13",
                        value=round(clear, 2), limit=3.5, unit="ft")
    for o in ix.openings:
        if o.get("type") not in HINGED | {"sliding_door", "arch"}:
            continue
        w = float(o.get("width_ft") or 0)
        rooms = [ix.type(r) for r in o["between"] if r in ix.by_id]
        need = 3.5 if o.get("type") == "main_door" else 2.5 if set(rooms) & (WET | {"store", "dressing"}) else 3.0 \
            if set(rooms) & (HABITABLE | {"kitchen"}) else 2.5
        if w + 1e-6 < need:
            on = ix.oname(o)
            out.add(f"plan.circulation.door_width:{o['id']}", "Door width", "warn",
                    f"{on[:1].upper() + on[1:]} is {fmt(w)} wide; {fmt(need)} is the comfortable minimum here.", ids=[o["id"]],
                    fix=f"Make {o['id']} at least {need:g} ft wide.", ref=f"{REF} P-13", value=w, limit=need, unit="ft")


# P-14 ----------------------------------------------------------------------------------------------------------------
def _dead_ends(ix: PlanIndex, out: _Out) -> None:
    for r in ix.rooms:
        if r.get("type") not in ("corridor", "lobby"):
            continue
        n = len(ix.adj.get(r["id"], ()))
        if n < 2:
            out.add(f"plan.circulation.dead_end:{r['id']}", "Dead-end passage", "fail",
                    f"{r['name']} leads nowhere ({n} connection{'s' if n != 1 else ''}).", ids=[r["id"]],
                    fix="A corridor or lobby joins at least two rooms; merge it into a room or add the missing doors.",
                    ref=f"{REF} P-14")


# P-15 (lite) ---------------------------------------------------------------------------------------------------------
CAR_W, CAR_L, WALK = 9.0, 18.0, 3.5  # a parking bay per car, and the walkway past the cars to the door
# The 3D engine (web/src/engine/furniture/parking.ts porchBays, contracts/engine-notes.md) lets a parked car's tail stand up to
# 4 ft out over the porch's open drive-in edge (onto the driveway or the front open space), so a row of cars fits a porch
# 14 ft deep there; the plan rule counts bays the same way, so the compliance sheet and the as-built note agree.
OVERHANG = 4.0
BIKE_W, BIKE_L = 3.0, 7.0  # a motorbike bay, clear of the cars and the walkway
OUTDOOR = {"lawn", "driveway", "open_space", "courtyard"}  # the engine's "outdoor" rooms (plan/model.ts roomCat)


def bays(w: float, d: float) -> int:
    """How many 9 × 18 ft car bays fit in a w × d rect (cars side by side and/or one behind the other, either way round)."""
    f = lambda a, b: int((a + 1e-6) // CAR_W) * int((b + 1e-6) // CAR_L)  # noqa: E731
    return max(f(w, d), f(d, w))


def edge_bays(along: float, deep: float, overhang: float = 0.0) -> int:
    """Bays for cars driving in across a porch edge `along` ft long into a porch `deep` ft deep, as the engine lays them out:
    9 ft wide each; one row 18 ft deep, or deep - overhang with the tails standing out over the open edge (at most 4 ft); two
    rows nose to tail in a porch 36 ft deep."""
    across = int((along + 1e-6) // CAR_W)
    rows = 2 if deep + 1e-6 >= 2 * CAR_L else 1 if deep + min(max(overhang, 0.0), OVERHANG) + 1e-6 >= CAR_L else 0
    return across * rows


def _edge_probe(r: Rect, side: str) -> tuple[float, float]:
    x0, y0, x1, y1 = r
    return {"front": ((x0 + x1) / 2, y0 - 0.5), "back": ((x0 + x1) / 2, y1 + 0.5), "left": (x0 - 0.5, (y0 + y1) / 2),
            "right": (x1 + 0.5, (y0 + y1) / 2)}[side]


def car_edge(ix: PlanIndex, rid: str) -> tuple[str, float, str | None] | None:
    """The porch edge cars drive in across, picked as the engine does (parking.ts porchBays: a driveway beyond it scores
    best, then open ground, the front edge preferred; an enclosed room beyond rules it out); how far a car's tail may stand
    out over it (up to 4 ft, within the plot); and the type of room beyond it (None: open ground). None when no edge is
    open."""
    x0, y0, x1, y1 = ix.R[rid]
    room = {"front": y0 - 0.3, "back": (ix.D - y1) if ix.D else OVERHANG, "left": x0, "right": (ix.W - x1) if ix.W else OVERHANG}
    best = None
    for side in ("front", "back", "left", "right"):  # the engine's order on a tie
        o = ix.room_at(ix.ground, *_edge_probe(ix.R[rid], side), exclude=[rid])
        t = ix.type(o) if o else None
        score = ((6 if t == "driveway" else 2) + (3 if side == "front" else 0)) if o is None or t in OUTDOOR else -10
        if best is None or score > best[0]:
            best = (score, side, t)
    if best[0] < 0:
        return None
    return best[1], max(0.0, min(OVERHANG, room[best[1]])), best[2]


def brief_cars(brief: dict) -> int:
    """Cars the brief asks to park (car_porch:N)."""
    n = 0
    for sp in brief.get("spaces") or []:
        k, _, v = str(sp).partition(":")
        if k.strip() == "car_porch":
            try:
                n = max(n, int(float(v)) if v else 1)
            except ValueError:
                n = max(n, 1)
    return n


BIKE_RE = re.compile(r"motor\s*-?\s*(bike|cycle)|\bbikes?\b|scooty|scooter", re.I)


def brief_bike(brief: dict) -> bool:
    """Whether the family wants a motorbike parked in the porch ("porch for 1 car plus a motorbike")."""
    if any(str(s).split(":")[0].strip().lower() in ("motorbike", "bike", "motorcycle") for s in brief.get("spaces") or []):
        return True
    said = " ".join([str(p) for p in brief.get("preferences") or []] + [str(brief.get("notes") or "")])
    return bool(BIKE_RE.search(said))


def _named_cars(r: dict) -> int:
    name = str(r.get("name") or "").lower()
    m = re.search(r"(\d)\s*-?\s*car", name)
    if m:
        return int(m.group(1))
    return 1 if r.get("type") == "garage" or re.search(r"\bcar|garage|parking", name) else 0


def _door_reachable(ix: PlanIndex, pr: Rect, door: dict, cars: int, edge: tuple | None = None) -> bool:
    """Whether `cars` bays (cars nose-in across the drive-in edge `edge`, side by side; the road edge when not given) fit in
    the porch while a 3′6″ path along its depth stays clear and reaches `door` (at least 3 ft of the door's width on the
    path)."""
    x0, y0, x1, y1 = pr
    side, oh = (edge[0], edge[1]) if edge else ("front", 0.0)
    along_x = side in ("front", "back")
    lo, hi_ = (x0, x1) if along_x else (y0, y1)
    deep = (y1 - y0) if along_x else (x1 - x0)
    if deep + min(oh, OVERHANG) + 1e-6 < CAR_L:  # cars can't park nose-in: only the area test applies
        return True
    inf = ix.info.get(door["id"]) or {}
    w = float(door.get("width_ft") or 0)
    u = float(door["at"][0] if along_x else door["at"][1])
    wall = (inf.get("edge") or ("x",))[0] if inf.get("kind") == "pair" else ("y" if inf.get("side") in ("left", "right") else "x")
    if wall == ("y" if along_x else "x"):  # a door on a wall the cars drive in along: the path runs along that side
        return int((hi_ - lo - WALK + 1e-6) // CAR_W) >= cars
    need = min(3.0, w)
    c, hi = max(lo, u - w / 2 + need - WALK), min(hi_ - WALK, u + w / 2 - need)
    while c <= hi + 1e-6:
        if int((c - lo + 1e-6) // CAR_W) + int((hi_ - c - WALK + 1e-6) // CAR_W) >= cars:
            return True
        c += 0.25
    return False


def _porch(ix: PlanIndex, out: _Out, brief: dict) -> None:
    """P-15: the car porch parks every car the family asked for (9 × 18 ft a car, or 14 ft deep where the tail stands out
    over the open drive-in edge, as the engine parks it), with a 3′6″ walkway past them to the door, and a 3 × 7 ft motorbike
    bay clear of both when the brief mentions a motorbike."""
    want = brief_cars(brief)
    bike = brief_bike(brief)
    porches = [r for r in ix.level_rooms(ix.ground) if r.get("type") in ("porch", "garage")]
    cars_for = {r["id"]: _named_cars(r) for r in porches}
    car_porches = [r for r in porches if cars_for[r["id"]]]
    if not car_porches and want and porches:
        big = max(porches, key=lambda r: area(ix.R[r["id"]]))
        car_porches, cars_for[big["id"]] = [big], 0
    if not car_porches:
        return
    spare = max(0, want - sum(cars_for[r["id"]] for r in car_porches))
    big = max(car_porches, key=lambda r: area(ix.R[r["id"]]))
    cars_for[big["id"]] += spare
    for r in car_porches:
        cars = max(1, cars_for[r["id"]])
        x0, y0, x1, y1 = ix.R[r["id"]]
        width, depth = x1 - x0, y1 - y0
        edge = car_edge(ix, r["id"])
        if edge:
            along, deep = (width, depth) if edge[0] in ("front", "back") else (depth, width)
            oh = edge[1]
            fits = edge_bays(along, deep, oh)
            room_ok = edge_bays(along - WALK, deep, oh) >= cars or edge_bays(along, deep - WALK) >= cars
        else:  # no open edge to drive in across: the plain area test
            along, deep, oh = width, depth, 0.0
            fits = bays(width, depth)
            room_ok = bays(width - WALK, depth) >= cars or bays(width, depth - WALK) >= cars
        plural = "s" if cars > 1 else ""
        bike_ft = " (plus 3 ft for the motorbike)" if bike and r is big else ""
        if fits < cars:
            short = (f" ({fmt(CAR_L - oh)} deep where its tail can stand out over the "
                     f"{'driveway' if edge[2] == 'driveway' else 'open front'})") if edge and oh >= 1.0 and deep + 1e-6 < CAR_L else ""
            out.add(f"plan.circulation.porch:{r['id']}", "Car porch", "fail",
                    f"{r['name']} is {fmt(width)} × {fmt(depth)}, so it parks {fits} of the {cars} car{plural} asked for; each "
                    f"car needs a 9 × 18 ft bay{short}.", ids=[r["id"]],
                    fix=f"Make {r['name']} at least {cars * CAR_W + WALK:g} ft wide × {CAR_L:g} ft deep ({cars} car{plural} side "
                        f"by side plus a 3.5 ft walkway){bike_ft}, or {CAR_W + WALK:g} ft wide × {cars * CAR_L:g} ft deep for cars "
                        f"one behind the other.", ref=f"{REF} P-15", value=fits, limit=cars, unit="cars")
            continue
        doors = [o for o in ix.door_ops.get(r["id"], []) if o.get("type") in HINGED]
        mains = [o for o in doors if o.get("type") == "main_door"]
        if doors and room_ok and not any(_door_reachable(ix, ix.R[r["id"]], o, cars, edge) for o in mains or doors):
            d = (mains or doors)[0]
            on = ix.oname(d)
            out.add(f"plan.circulation.porch_walkway:{r['id']}", "Walkway past the car", "fail",
                    f"With {cars} car{plural} parked in {r['name']}, no 3′6″ path is left from the gate to {on}: the door sits "
                    f"where the car has to stand.", ids=[r["id"], d["id"]],
                    fix=f"Move {d['id']} to one end of the porch's back wall (its edge within 3.5 ft of a side wall) or onto the "
                        f"porch's side wall, so the car{plural} park beside a 3.5 ft path that reaches the door.",
                    ref=f"{REF} P-15")
            continue
        if doors and not room_ok:
            out.add(f"plan.circulation.porch_walkway:{r['id']}", "Walkway past the car", "fail",
                    f"{r['name']} is {fmt(width)} × {fmt(depth)}: {cars} car{plural} plus a 3′6″ walkway to {ix.oname(doors[0])} "
                    f"need {fmt(cars * CAR_W + WALK)} × {fmt(CAR_L)} (or {fmt(cars * CAR_W)} × {fmt(CAR_L + WALK)}).",
                    ids=[r["id"], doors[0]["id"]],
                    fix=f"Widen {r['id']} to {cars * CAR_W + WALK:g} ft (or deepen it to {CAR_L + WALK:g} ft) so a 3.5 ft path runs "
                        f"past the parked car{plural} to the door; keep the door on that path, not behind a bay.",
                    ref=f"{REF} P-15")
            continue
        if bike and r is big:
            rows = 2 if cars > max(1, int((along - WALK + 1e-6) // CAR_W)) else 1
            beside = along - math.ceil(cars / rows) * CAR_W - WALK + 1e-6 >= BIKE_W and deep + 1e-6 >= BIKE_L
            behind = deep - rows * CAR_L + 1e-6 >= BIKE_W and along + 1e-6 >= BIKE_L
            if not (beside or behind):
                out.add(f"plan.circulation.porch_bike:{r['id']}", "Motorbike in the porch", "warn",
                        f"{r['name']} ({fmt(width)} × {fmt(depth)}) has no 3 × 7 ft space left for the motorbike once the "
                        f"car{plural} and the 3′6″ walkway to the door are in.", ids=[r["id"]],
                        fix=f"Make {r['name']} 3 ft wider (at least {cars * CAR_W + WALK + BIKE_W:g} ft for {cars} car{plural} side "
                            f"by side, the walkway and a motorbike) or 3 ft deeper than the car{plural} need ({CAR_L + BIKE_W:g} ft), "
                            f"so a 3 × 7 ft motorbike bay sits clear of the cars and the walkway.", ref=f"{REF} P-15")


# P-16b ---------------------------------------------------------------------------------------------------------------
def _covered_open(ix: PlanIndex, out: _Out) -> None:
    """An open space or courtyard is open to the sky: a room, terrace or balcony on a higher floor over it turns it into a
    dark covered slot, and the windows facing it no longer light anything."""
    for r in ix.rooms:
        if r.get("type") not in ("open_space", "courtyard"):
            continue
        a = area(ix.R[r["id"]])
        cov, by = ix.covered_area(r["id"])
        if a <= 0 or cov < 0.5 * a:
            continue
        lit = sorted({x for o in ix.openings if r["id"] in o["between"] and o.get("type") in GLAZED
                      for x in o["between"] if x not in (r["id"], "exterior")})
        what = f", so the {_and([ix.name(x) for x in lit])} windows face a roofed slot" if lit else ""
        out.add(f"plan.open_space.covered:{r['id']}", "Courtyard open to the sky", "fail",
                f"{r['name']} is under the {_and(sorted({ix.name(b) for b in by}))} above ({cov:.0f} of {a:.0f} sq ft "
                f"covered){what}.",
                ids=[r["id"], *by, *lit],
                fix=f"Leave {r['id']} open to the sky, with a guard around the opening above: on every higher floor, keep the "
                    f"area over it free of rooms, terraces and balconies (an open_space void with a railing), or move the "
                    f"windows to an outside wall.", ref=f"{REF} P-16")


# P-17 ----------------------------------------------------------------------------------------------------------------
SOLID_TARGET = {"lounge": 8.0, "drawing": 8.0, "bedroom": 9.0, "guest_bedroom": 9.0, "master_bedroom": 10.0}


def longest_solid_wall(ix: PlanIndex, rid: str) -> float:
    """The longest run of solid wall in a room (feet): each side less its doors and windows (with 6 in of frame each side)
    and its open-plan edges."""
    r = ix.by_id[rid]
    best = 0.0
    for side, (axis, c, lo, hi, _) in sides(ix.R[rid]).items():
        cuts = []
        for o in ix.openings:
            if rid not in o["between"] or o.get("level") != r.get("level"):
                continue
            x, y = float(o["at"][0]), float(o["at"][1])
            across, along = (abs(y - c), x) if axis == "x" else (abs(x - c), y)
            if across <= 0.75 and lo - 0.5 <= along <= hi + 0.5:
                w = float(o.get("width_ft") or 0)
                cuts.append((along - w / 2 - 0.5, along + w / 2 + 0.5))
        for (a, b), res in ix.open_pairs.items():
            if rid in (a, b) and res.get("edge") and res["valid"]:
                eax, ec, elo, ehi = res["edge"]
                if eax == axis and abs(ec - c) < 0.1:
                    cuts.append((elo, ehi))
        cur = lo
        for a, b in sorted(cuts):
            if a > cur:
                best = max(best, min(a, hi) - cur)
            cur = max(cur, b)
        if hi > cur:
            best = max(best, hi - cur)
    return best


def _solid_walls(ix: PlanIndex, out: _Out) -> None:
    for r in ix.rooms:
        target = SOLID_TARGET.get(r.get("type", ""))
        if not target:
            continue
        rid = r["id"]
        best = longest_solid_wall(ix, rid)
        if best + 1e-6 < target:
            out.add(f"plan.room.solid_wall:{rid}", "Wall for the bed or TV", "fail" if best < 7 - 1e-6 else "warn",
                    f"{r['name']}'s longest solid wall is {fmt(best)}; the {'bed' if 'bed' in r['type'] else 'TV and sofa'} "
                    f"wall needs {fmt(target)}.", ids=[rid], fix="Move doors to the room's corners and put the windows on one wall.",
                    ref=f"{REF} P-17", value=round(best, 1), limit=target, unit="ft")


# P-18 .. P-22 -------------------------------------------------------------------------------------------------------------
def _stairs(ix: PlanIndex, out: _Out) -> None:
    seq = list(ix.storeys) + ([ix.roof_id] if ix.roof_id else [])
    by_pair: dict[tuple[str, str], dict] = {}
    for s in ix.stairs:
        by_pair.setdefault((s.get("from_level"), s.get("to_level")), s)
    for a, b in zip(seq, seq[1:]):
        if (a, b) not in by_pair:
            out.add(f"plan.stair.continuity:{a}:{b}", "Stair to every floor", "fail",
                    f"There is no stair from the {ix.lname(a)} to the {ix.lname(b) if b != ix.roof_id else 'roof'}.",
                    fix=f"Add a stair from {a} to {b}, stacked exactly on the stair below (same rect, kind and start).",
                    ref=f"{REF} P-18")
    if ix.stairs:
        s0 = ix.stairs[0]
        r0 = rect_of(s0)
        for s in ix.stairs[1:]:
            r = rect_of(s)
            if max(abs(r[i] - r0[i]) for i in range(4)) > 0.25 or s.get("kind") != s0.get("kind") or s.get("start") != s0.get("start"):
                out.add(f"plan.stair.stacked:{s['id']}", "Stairs stacked", "fail",
                        f"The {ix.sname(s).lower()} is not stacked on the {ix.sname(s0).lower()}.",
                        ids=[s["id"], s0["id"]], fix="Give every stair the same rect, kind and start so they stack in one stair hall.",
                        ref=f"{REF} P-18")
    for s in ix.stairs:
        g = ix.stair_geo(s)
        r = g["rect"]
        frm, to = s.get("from_level"), s.get("to_level")
        sn = ix.sname(s)
        # P-19 containment
        home = [x for x in ix.level_rooms(frm) if x.get("type") in ("stair", "lobby") and within(r, ix.R[x["id"]], 0.15)]
        if not home:
            hit = [x["name"] for x in ix.level_rooms(frm) if overlap_area(r, ix.R[x["id"]]) > 0.5 and x.get("type") not in ("stair", "lobby")]
            out.add(f"plan.stair.containment:{s['id']}", "Stair inside its hall", "fail",
                    f"The {sn.lower()} is not inside a stair hall" + (f"; it cuts into {', '.join(hit)}." if hit else "."),
                    ids=[s["id"]], fix="Put the stair rect fully inside a room of type stair (or lobby) on its from_level.",
                    ref=f"{REF} P-19")
        if to != ix.roof_id:
            for x in ix.level_rooms(to):
                if overlap_area(r, ix.R[x["id"]]) > 0.5 and x.get("type") not in CIRC:
                    out.add(f"plan.stair.containment:{s['id']}:{x['id']}", "Stair inside its hall", "fail",
                            f"The stairwell of the {sn.lower()} cuts into {x['name']} on the {ix.lname(to)}.", ids=[s["id"], x["id"]],
                            fix="Upstairs, the stair rect must sit inside the stair hall too; keep bedrooms off the stairwell.",
                            ref=f"{REF} P-19")
        # P-20 geometry
        T, n = g["T"], g["N"]
        problems = []
        if g["riser_in"] > 7.5 + 1e-6:
            problems.append(f"risers of {g['riser_in']:.2f} in are steeper than 7.5 in")
        need_len = None
        if g["kind"] == "dogleg":
            n1 = math.ceil(n / 2)
            if n1 > 15:
                problems.append(f"{n1} risers in one flight (max 15)")
            if g["breadth"] < 4.9:
                problems.append(f"{fmt(g['breadth'])} is too narrow for a dog-leg")
            elif g["breadth"] + 1e-6 < 2 * g["width"] + 0.15:
                problems.append(f"{fmt(g['breadth'])} wide can't fit two {fmt(g['width'])} flights")
            need_len = (n1 - 1) * T + max(g["width"], 3.0)
        elif g["kind"] == "straight":
            if n > 15:
                problems.append(f"{n} risers in one straight flight (max 15); use a dog-leg")
            need_len = (n - 1) * T
        else:  # l_shape
            n1 = math.ceil(n / 2)
            need_len = (n1 - 1) * T + g["width"]
            need_b = (n - n1 - 1) * T + g["width"]
            if g["breadth"] + 1e-6 < need_b:
                problems.append(f"the second flight needs {fmt(need_b)} of breadth, the rect gives {fmt(g['breadth'])}")
        if need_len and g["length"] + 0.05 < need_len:
            problems.append(f"{fmt(g['length'])} is too short for the treads plus a {fmt(max(g['width'], 3.0))} mid-landing "
                            f"(needs {fmt(need_len)})")
        if problems:
            out.add(f"plan.stair.geometry:{s['id']}", f"{sn} geometry", "fail", f"{sn}: " + "; ".join(problems) + ".",
                    ids=[s["id"]], fix="For 11 ft floor-to-floor: 19 risers of 6.95 in, 10 in treads, 3.5 ft flights, so a "
                                       "dog-leg rect of 7.5 ft × 11 ft along `start`.", ref=f"{REF} P-20 / {IBC} §1011.6",
                    value=round(g["length"], 2), limit=round(need_len or 0, 2), unit="ft")
        # P-21 landings
        _landing(ix, out, s, g, frm, "foot")
        if to != ix.roof_id:
            _landing(ix, out, s, g, to, "arrival")
        # P-22 doors opening onto the stairwell, private stair rooms
        for lid in {frm, to} - {ix.roof_id}:
            for x in ix.level_rooms(lid):
                if x.get("type") in PRIVATE and overlap_area(r, ix.R[x["id"]]) > 0.5:
                    out.add(f"plan.stair.private:{s['id']}:{x['id']}", "Stair in a bedroom", "fail",
                            f"The {sn.lower()} runs through {x['name']}.", ids=[s["id"], x["id"]],
                            fix="Stairs live in a stair hall that is circulation, never inside a bedroom.", ref=f"{REF} P-22")
        if to != ix.roof_id:
            void = r  # the arriving stair's rect on the upper floor is treads or void
            for o in ix.openings:
                if o.get("level") != to or o.get("type") not in DOORS:
                    continue
                if overlap_area(_approach(ix, o), void) > 1.0:
                    on = ix.oname(o)
                    out.add(f"plan.stair.door_on_void:{o['id']}", "Door onto the stairwell", "fail",
                            f"{on[:1].upper() + on[1:]} on the {ix.lname(to)} opens straight onto the stairwell.",
                            ids=[o["id"], s["id"]],
                            fix="Move the door so it opens onto the 3.5 ft landing strip, not over the flights.", ref=f"{REF} P-22")
    _doors_under_flights(ix, out)


def _approach(ix: PlanIndex, o: dict, depth: float = 2.0) -> Rect:
    """The opening's width × `depth` ft on both sides of its wall: where you stand to go through it."""
    w = float(o.get("width_ft") or 0)
    x0, y0 = float(o["at"][0]), float(o["at"][1])
    return (x0 - w / 2, y0 - depth, x0 + w / 2, y0 + depth) if _horizontal(ix, o) else (x0 - depth, y0 - w / 2, x0 + depth, y0 + w / 2)


def _doors_under_flights(ix: PlanIndex, out: _Out) -> None:
    """P-22b: on a stair's own floor (from_level), a door whose opening or approach lies under the flights or the mid-landing
    leads into the underside of the stair (5–6 ft of headroom under a dog-leg's landing): you can't walk through it. Doors on
    the foot-landing strip, where the first riser starts, are the way onto the stair and are fine."""
    for s in ix.stairs:
        g = ix.stair_geo(s)
        r = g["rect"]
        frm = s.get("from_level")
        foot = ix.strip(r, g["e_side"], 3.5)
        for o in ix.openings:
            if o.get("level") != frm or o.get("type") not in DOORS or not ix.info[o["id"]]["valid"]:
                continue
            if f"plan.stair.door_on_void:{o['id']}" in out.seen or f"plan.stair.door_under_flight:{o['id']}" in out.seen:
                continue
            x0, y0 = float(o["at"][0]), float(o["at"][1])
            if contains(foot, x0, y0, 0.4) and not contains(r, x0, y0, -0.1):
                continue
            if overlap_area(_approach(ix, o), r) > 0.5 or contains(r, x0, y0, -0.1):
                on = ix.oname(o)
                out.add(f"plan.stair.door_under_flight:{o['id']}", "Door under the stair", "fail",
                        f"{on[:1].upper() + on[1:]} on the {ix.lname(frm)} opens under the {ix.sname(s).lower()}, where the "
                        f"flights and the mid-landing leave no headroom; nobody can walk through it.", ids=[o["id"], s["id"]],
                        fix="Move the door off the stair rect and its 2 ft approach (onto the landing strip at the stair's start "
                            "edge, or another wall), or flip the dog-leg's start so the mid-landing isn't over it.",
                        ref=f"{REF} P-22")


def _horizontal(ix: PlanIndex, o: dict) -> bool:
    """True when the opening sits on a wall that runs along x."""
    inf = ix.info.get(o["id"]) or {}
    if inf.get("edge"):
        return inf["edge"][0] == "x"
    if inf.get("side"):
        return inf["side"] in ("front", "back")
    return True


def _landing(ix: PlanIndex, out: _Out, s: dict, g: dict, lid: str, which: str) -> None:
    side = g["e_side"] if which == "foot" else g["arrive_side"]
    r = g["rect"]
    key = (lid, side, tuple(round(v, 1) for v in r))
    done = out.__dict__.setdefault("landings", set())
    if key in done:  # stacked stairs share one landing strip per floor: report it once
        return
    done.add(key)
    hall = ix.room_at(lid, (r[0] + r[2]) / 2, (r[1] + r[3]) / 2, enclosed=True)
    ok_rooms = {x["id"] for x in ix.level_rooms(lid) if x.get("type") in CIRC}
    if hall:
        ok_rooms.add(hall)
        for (a, b), res in ix.open_pairs.items():
            if res["valid"] and hall in (a, b):
                other = b if a == hall else a
                if ix.type(other) in CIRC | LIVING:
                    ok_rooms.add(other)
    # clear depth: how far beyond the edge every sample point stays inside an allowed room
    depth = 0.0
    step = 0.25
    while depth < 3.0 - 1e-9:
        strip = ix.strip(r, side, depth + step)
        band = strip
        xs = _samples(band[0], band[2])
        ys = _samples(band[1], band[3])
        if side in ("front", "back"):
            yy = band[1] if side == "front" else band[3]
            pts = [(x, yy) for x in xs]
        else:
            xx = band[0] if side == "left" else band[2]
            pts = [(xx, y) for y in ys]
        if all((ix.room_at(lid, px, py, enclosed=True) or "") in ok_rooms for px, py in pts):
            depth += step
        else:
            break
    if depth + 1e-6 < 3.0:
        what = "at its foot" if which == "foot" else "where it arrives"
        out.add(f"plan.stair.landing:{s['id']}:{lid}", "Stair landing", "fail",
                f"The {ix.sname(s).lower()} has only {fmt(depth)} clear {what} on the {ix.lname(lid)}; it needs 3 ft.",
                ids=[s["id"], *([hall] if hall else [])],
                fix=f"Make the stair hall at least 3.5 ft longer than the stair at its {side} edge, where a dog-leg starts and "
                    f"arrives, on every floor.", ref=f"{REF} P-21 / {IBC} §1011.6", value=round(depth, 2), limit=3.0, unit="ft")
    if which == "arrival" and hall and not [n for n in ix.door_adj.get(hall, ())]:
        out.add(f"plan.stair.landing_exit:{s['id']}:{lid}", "Way off the landing", "fail",
                f"The top of the {ix.sname(s).lower()} on the {ix.lname(lid)} lands in a hall with no way out.", ids=[s["id"], hall],
                fix="Connect the stair hall to the floor with a door or an open_to onto a corridor or lounge.", ref=f"{REF} P-21")


def _samples(a: float, b: float) -> list[float]:
    if b - a <= 0.6:
        return [(a + b) / 2]
    n = max(2, int((b - a) / 0.5))
    return [a + 0.2 + (b - a - 0.4) * i / (n - 1) for i in range(n)]


# P-23 ----------------------------------------------------------------------------------------------------------------
SIDE_FOR_START = {"+y": "front", "-y": "back", "+x": "left", "-x": "right"}


def top_stair(ix: PlanIndex) -> dict | None:
    return next((s for s in ix.stairs if s.get("to_level") == ix.roof_id), None)


def mumty_need(ix: PlanIndex, s: dict) -> Rect:
    """The stair tower must cover the top stair and its 3 ft top landing (wall included)."""
    g = ix.stair_geo(s)
    landing = ix.strip(g["rect"], g["arrive_side"], 3.0)
    return union_rect(g["rect"], landing)


def slab_cover(ix: PlanIndex) -> list[Rect]:
    """Where the roof slab is: over the top storey's enclosed rooms and porches."""
    if not ix.top:
        return []
    return [ix.R[r["id"]] for r in ix.level_rooms(ix.top) if r.get("type") not in OPEN - {"porch"}]


def door_sides(ix: PlanIndex, s: dict, m: Rect) -> dict[str, float]:
    """Allowed mumty door sides -> contact length with the top landing (A.0 P-23 / B.3)."""
    g = ix.stair_geo(s)
    e = g["arrive_side"]
    r = g["rect"]
    # the landing region inside the mumty: from the mumty's wall on side e to the stair edge e, across its full width
    if e == "front":
        land = (m[0], m[1], m[2], r[1])
    elif e == "back":
        land = (m[0], r[3], m[2], m[3])
    elif e == "left":
        land = (m[0], m[1], r[0], m[3])
    else:
        land = (r[2], m[1], m[2], m[3])
    depth = (land[3] - land[1]) if e in ("front", "back") else (land[2] - land[0])
    breadth = (land[2] - land[0]) if e in ("front", "back") else (land[3] - land[1])
    slabs = slab_cover(ix)
    tank = rect_of(ix.roof["water_tank"]) if (ix.roof.get("water_tank") or {}).get("rect") else None
    allowed: dict[str, float] = {}
    for side, (axis, c, lo, hi, n) in sides(m).items():
        if side == e:
            contact = breadth
            mid = ((land[0] + land[2]) / 2, c) if axis == "x" else (c, (land[1] + land[3]) / 2)
        elif side == {"front": "back", "back": "front", "left": "right", "right": "left"}[e]:
            continue
        else:
            contact = depth
            mid = ((land[0] + land[2]) / 2, c) if axis == "x" else (c, (land[1] + land[3]) / 2)
        if contact < 3.6 - 1e-6:
            continue
        if ix.on_party_line(axis, c, lo, hi):
            continue
        ox, oy = mid[0] + n[0] * 1.5, mid[1] + n[1] * 1.5
        if not any(contains(sl, ox, oy) for sl in slabs):
            continue
        if tank and contains(tank, ox, oy, 0.5):
            continue
        allowed[side] = contact
    return allowed


def _mumty(ix: PlanIndex, out: _Out) -> None:
    s = top_stair(ix)
    if not s:
        return
    m_roof_room = ix.room_at(ix.roof_id, *_centre(rect_of(s)), enclosed=True) if ix.roof_id else None
    if not ix.mumty and not m_roof_room:
        out.add("plan.roof.mumty", "Stair tower", "fail", "A stair reaches the roof but there is no stair tower (mumty) over it.",
                ids=[s["id"]], fix="Add roof.mumty with rect = the top-floor stair hall and door_side = the stair's start-end side.",
                ref=f"{REF} P-23")
        return
    m = ix.mumty or ix.R[m_roof_room]
    need = mumty_need(ix, s)
    if not within(need, m, 0.2):
        out.add("plan.roof.mumty_cover", "Stair tower covers the stair", "fail",
                f"The stair tower ({fmt(m[2] - m[0])} × {fmt(m[3] - m[1])}) doesn't cover the stair and its 3 ft top landing "
                f"({fmt(need[2] - need[0])} × {fmt(need[3] - need[1])}), so the roof door can't sit at the top of the stair.",
                ids=[s["id"]], fix="Set roof.mumty.rect to the top-floor stair hall: the stair rect plus at least 3.5 ft at its "
                                   "start edge.", ref=f"{REF} P-23")
        return
    if not ix.mumty:
        return
    side = (ix.roof.get("mumty") or {}).get("door_side")
    allowed = door_sides(ix, s, m)
    if side not in allowed:
        g = ix.stair_geo(s)
        if allowed:
            pick = max(allowed, key=lambda k: (k == g["arrive_side"], allowed[k]))
            msg = f"The roof door is on the {side} side, away from the top of the stair. Use the {pick} side."
        else:
            msg = ("No side of the stair tower can take the roof door beside the top landing (party wall, open sky or a short "
                   "landing).")
        out.add("plan.roof.mumty_door", "Roof door at the top landing", "fail", msg, ids=[s["id"]],
                fix="door_side = the stair's start-end side (front for +y, back for -y, left for +x, right for -x); if that is a "
                    "party wall, use a long side and make the stair tower at least 3.5 ft longer than the stair at its start end.",
                ref=f"{REF} P-23")


def _centre(r: Rect) -> tuple[float, float]:
    return (r[0] + r[2]) / 2, (r[1] + r[3]) / 2


def repair_mumty(plan: dict) -> list[str]:
    """Deterministic stair-tower repair (B.3 at plan level): cover the top stair and its landing, put the door on the best
    side beside the landing, and keep a plastic tank on the tower. Returns what changed."""
    ix = PlanIndex(plan)
    s = top_stair(ix)
    if not s:
        return []
    changed: list[str] = []
    roof = plan.setdefault("roof", {})
    if ix.room_at(ix.roof_id, *_centre(rect_of(s)), enclosed=True) if ix.roof_id else False:
        return []  # an enclosed roof room acts as the stair tower
    g0 = ix.stair_geo(s)
    need = mumty_need(ix, s)
    pad = {k: (0.0 if k == g0["arrive_side"] else 0.375) for k in ("front", "back", "left", "right")}
    need = (need[0] - pad["left"], need[1] - pad["front"], need[2] + pad["right"], need[3] + pad["back"])
    m = ix.mumty
    hall = ix.room_at(ix.top, *_centre(rect_of(s)), enclosed=True) if ix.top else None
    if m:
        base = union_rect(m, need)
    elif hall and ix.type(hall) in ("stair", "lobby") and within(need, ix.R[hall], 0.2):
        base = ix.R[hall]
    else:
        base = need
    base = (max(0.0, base[0]), max(0.0, base[1]), min(ix.W or base[2], base[2]), min(ix.D or base[3], base[3]))
    mum = roof.setdefault("mumty", {"height_ft": 9.0, "door_side": "front"})
    old = mum.get("rect")
    newr = {"x": round(base[0], 2), "y": round(base[1], 2), "w": round(base[2] - base[0], 2), "d": round(base[3] - base[1], 2)}
    if old != newr:
        mum["rect"] = newr
        changed.append("mumty.rect")
    mum["height_ft"] = min(float(mum.get("height_ft") or 9.0), 9.5)
    ix = PlanIndex(plan)
    m = ix.mumty
    allowed = door_sides(ix, s, m)
    g = ix.stair_geo(s)
    if not allowed:  # grow the tower 3.5 ft at the landing end when the slab allows, then retry
        grown = ix.strip(m, g["arrive_side"], 3.5)
        cx, cy = _centre(grown)
        if any(contains(sl, cx, cy) for sl in slab_cover(ix)) and not ix.on_party_line(*_side_line(grown, g["arrive_side"])):
            u = union_rect(m, grown)
            mum["rect"] = {"x": round(u[0], 2), "y": round(u[1], 2), "w": round(u[2] - u[0], 2), "d": round(u[3] - u[1], 2)}
            changed.append("mumty.grown")
            ix = PlanIndex(plan)
            allowed = door_sides(ix, s, ix.mumty)
    if allowed and mum.get("door_side") not in allowed:
        mum["door_side"] = max(allowed, key=lambda k: (k == g["arrive_side"], allowed[k]))
        changed.append("mumty.door_side")
    tank = roof.get("water_tank")
    if tank and tank.get("material") == "plastic" and tank.get("rect"):
        mr = rect_of(mum)
        t = tank["rect"]
        if not within(rect_of(tank), mr, 0.05):
            w, d = min(float(t["w"]), mr[2] - mr[0] - 1), min(float(t["d"]), mr[3] - mr[1] - 1)
            tank["rect"] = {"x": round((mr[0] + mr[2] - w) / 2, 2), "y": round((mr[1] + mr[3] - d) / 2, 2), "w": round(w, 2), "d": round(d, 2)}
            changed.append("water_tank.on_mumty")
    return changed


def repair_stairs(plan: dict) -> list[str]:
    """Deterministic stair fit: when a stair stack lacks its 3 ft landing (P-21) or code length/breadth (P-20) but its stair
    halls are big enough, move and resize the flights inside the halls (same rect for the whole stack). Returns stair ids."""
    ix = PlanIndex(plan)
    if not ix.stairs:
        return []
    bad = {c["id"].split(":")[1] for c in check(plan) if c["status"] == "fail"
           and c["id"].startswith(("plan.stair.landing", "plan.stair.geometry"))}
    changed: list[str] = []
    stacks: dict[tuple, list[dict]] = defaultdict(list)
    for s in ix.stairs:
        stacks[tuple(round(v, 1) for v in rect_of(s))].append(s)
    for _, stack in stacks.items():
        if not any(s["id"] in bad for s in stack):
            continue
        halls = []
        for s in stack:
            c = _centre(rect_of(s))
            for lid in (s.get("from_level"), s.get("to_level")):
                if lid == ix.roof_id:
                    continue
                h = ix.room_at(lid, *c, enclosed=True)
                if not h or ix.type(h) not in ("stair", "lobby"):
                    halls = []
                    break
                halls.append(ix.R[h])
            else:
                continue
            break
        if not halls:
            continue
        H = (max(h[0] for h in halls), max(h[1] for h in halls), min(h[2] for h in halls), min(h[3] for h in halls))
        g = ix.stair_geo(stack[0])
        T, n, w = g["T"], g["N"], max(g["width"], 3.5)
        if g["kind"] == "dogleg":
            need_len, need_b = (math.ceil(n / 2) - 1) * T + max(w, 3.0), 2 * w + 0.25
        elif g["kind"] == "straight":
            need_len, need_b = (n - 1) * T, w
        else:
            continue
        along_y = g["start"] in ("+y", "-y")
        h_len = (H[3] - H[1]) if along_y else (H[2] - H[0])
        h_b = (H[2] - H[0]) if along_y else (H[3] - H[1])
        if need_len + 3.0 > h_len + 1e-6 or need_b > h_b - 0.5 + 1e-6:
            continue  # the hall is too small: only the planner can fix it
        landing = min(3.5, h_len - need_len)
        length = max(need_len, min(g["length"], h_len - landing))
        breadth = min(max(g["breadth"], need_b), h_b - 0.75)
        r = g["rect"]
        if along_y:
            cx = min(max((r[0] + r[2]) / 2, H[0] + 0.375 + breadth / 2), H[2] - 0.375 - breadth / 2)
            x0, x1 = cx - breadth / 2, cx + breadth / 2
            y0 = H[1] + landing if g["start"] == "+y" else H[3] - landing - length
            y1 = y0 + length
        else:
            cy = min(max((r[1] + r[3]) / 2, H[1] + 0.375 + breadth / 2), H[3] - 0.375 - breadth / 2)
            y0, y1 = cy - breadth / 2, cy + breadth / 2
            x0 = H[0] + landing if g["start"] == "+x" else H[2] - landing - length
            x1 = x0 + length
        new = {"x": round(x0, 3), "y": round(y0, 3), "w": round(x1 - x0, 3), "d": round(y1 - y0, 3)}
        for s in stack:
            s["rect"] = dict(new)
            s["width_ft"] = max(float(s.get("width_ft") or 0), 3.5)
            s["tread_in"] = max(float(s.get("tread_in") or 0), 10)
            changed.append(s["id"])
    return changed


def _side_line(r: Rect, side: str):
    axis, c, lo, hi, _ = sides(r)[side]
    return axis, c, lo, hi


# P-24 ----------------------------------------------------------------------------------------------------------------
def roof_free_area(ix: PlanIndex) -> tuple[float, float]:
    """(free sq ft, footprint sq ft) of the roof for solar: top-storey slab minus a 2 ft parapet band, the stair tower,
    the tank and any roof rooms."""
    slabs = slab_cover(ix)
    if not slabs:
        return 0.0, 0.0
    fp = union_area(slabs)
    bx = union_rect(*slabs)
    band = 2.0 * 2 * ((bx[2] - bx[0]) + (bx[3] - bx[1]))
    taken = band
    if ix.mumty:
        taken += area(ix.mumty)
    t = ix.roof.get("water_tank")
    if t and t.get("rect") and not (ix.mumty and within(rect_of(t), ix.mumty, 0.1)):
        taken += area(rect_of(t))
    for r in ix.level_rooms(ix.roof_id or ""):
        if r.get("type") not in OPEN:
            taken += area(ix.R[r["id"]])
    return max(0.0, fp - taken), fp


def _roof_services(ix: PlanIndex, out: _Out, brief: dict) -> None:
    tank = ix.roof.get("water_tank")
    want_tank = brief.get("water_tank")
    if tank and tank.get("rect") and want_tank:
        tr = rect_of(tank)
        if want_tank == "plastic" and ix.mumty and not within(tr, ix.mumty, 0.1):
            out.add("plan.roof.tank", "Water tank", "warn", "The blue plastic tank should sit on the stair tower's roof.",
                    fix="Put roof.water_tank.rect inside roof.mumty.rect (material plastic).", ref=f"{REF} P-24")
        if want_tank == "concrete" and ix.mumty and overlap_area(tr, ix.mumty) > 0.5:
            out.add("plan.roof.tank", "Water tank", "warn", "The concrete tank overlaps the stair tower.",
                    fix="Put the concrete tank on the roof slab next to the stair tower, 3 ft clear of its door.", ref=f"{REF} P-24")
    solar = brief.get("solar")
    free, fp = roof_free_area(ix)
    if fp > 0:
        kwp = free / 70
        pct = 100 * free / fp
        if solar in ("ready", "panels"):
            st = "pass" if pct >= 55 - 1e-6 else "warn"
            out.add("plan.roof.solar", "Roof kept clear for solar", st,
                    f"{pct:.0f}% kept clear (min 55%): about {free:,.0f} sq ft for panels, roughly {kwp:.0f} kW.",
                    fix="Keep the stair tower and tank in one corner and the rest of the roof clear: no domes, minarets or "
                        "pergolas.", ref=f"{REF} P-24", value=round(pct), limit=55, unit="%")


# P-25 ----------------------------------------------------------------------------------------------------------------
PROGRAM_TYPES = {
    "bedroom": BEDROOMS, "bed": BEDROOMS, "bedrooms": BEDROOMS, "master_bedroom": {"master_bedroom"}, "master": {"master_bedroom"},
    "guest_bedroom": {"guest_bedroom"}, "guest": {"guest_bedroom"}, "bath": {"bath"}, "bathroom": {"bath"}, "baths": {"bath"},
    "powder": {"powder"}, "powder_room": {"powder"}, "drawing": {"drawing"}, "drawing_room": {"drawing"}, "lounge": {"lounge"},
    "tv_lounge": {"lounge"}, "family_lounge": {"lounge"}, "dining": {"dining"}, "kitchen": {"kitchen"}, "kitchenette": {"kitchen"},
    "dirty_kitchen": {"dirty_kitchen"}, "prayer": {"prayer"}, "prayer_room": {"prayer"}, "study": {"study"}, "office": {"study"},
    "store": {"store"}, "laundry": {"laundry"}, "servant": {"servant"}, "servant_quarter": {"servant"}, "dressing": {"dressing"},
    "terrace": {"terrace"}, "roof_terrace": {"terrace"}, "balcony": {"balcony"}, "porch": {"porch", "garage"},
    "car_porch": {"porch", "garage"}, "garage": {"garage", "porch"}, "lawn": {"lawn"},
}
SUITES = {"bed_bath": ("bedroom", "bath"), "bedroom_bath": ("bedroom", "bath"), "suite": ("bedroom", "bath"),
          "master_suite": ("master_bedroom", "bath"), "master_bed_bath": ("master_bedroom", "bath")}
LEVEL_INDEX = {"basement": -1, "ground": 0, "first": 1, "second": 2, "third": 3}
NAME_MATCH = {"dining": "dining", "lounge": "lounge", "prayer": "prayer", "kitchen": "kitchen", "study": "study"}


def parse_program(rooms: list[str]) -> dict[str, int]:
    """["drawing", "bedroom:2", "bed_bath:1"] -> {"drawing": 1, "bedroom": 3, "bath": 1}."""
    counts: dict[str, int] = defaultdict(int)
    for tok in rooms or []:
        name, _, n = str(tok).strip().lower().replace(" ", "_").replace("-", "_").partition(":")
        try:
            k = max(0, int(float(n))) if n else 1
        except ValueError:
            k = 1
        if name in SUITES:
            a, b = SUITES[name]
            counts[a] += k
            counts[b] += k
        elif name in PROGRAM_TYPES:
            counts[name] += k
    return dict(counts)


def _count(rooms: list[dict], key: str) -> int:
    types = PROGRAM_TYPES[key]
    if key in ("bedroom", "bed", "bedrooms"):
        return sum(1 for r in rooms if r.get("type") in BEDROOMS)
    n = sum(1 for r in rooms if r.get("type") in types)
    if not n and key in NAME_MATCH:
        n = sum(1 for r in rooms if NAME_MATCH[key] in str(r.get("name", "")).lower())
    return n


def _level_for(ix: PlanIndex, name: str) -> str | None:
    name = str(name).strip().lower()
    if name == "roof":
        return ix.roof_id
    if name in ix.lv:
        return name
    idx = LEVEL_INDEX.get(name)
    return next((lv["id"] for lv in ix.levels if lv.get("index") == idx), None) if idx is not None else None


SPACE_REQ = {  # brief.spaces id -> (program key, severity)
    "drawing": ("drawing", "fail"), "tv_lounge": ("lounge", "fail"), "dining": ("dining", "fail"), "kitchen": ("kitchen", "fail"),
    "dirty_kitchen": ("dirty_kitchen", "fail"), "servant_quarter": ("servant", "fail"), "prayer": ("prayer", "fail"),
    "study": ("study", "fail"), "store": ("store", "warn"), "laundry": ("laundry", "warn"), "lawn": ("lawn", "warn"),
    "roof_terrace": ("terrace", "warn"),
}


def _program(ix: PlanIndex, out: _Out, brief: dict) -> None:
    if not brief:
        return
    beds = brief.get("bedrooms")
    have_beds = _count(ix.rooms, "bedroom")
    if isinstance(beds, (int, float)) and beds > 0 and have_beds != int(beds):
        out.add("plan.program.bedrooms", "Bedrooms as briefed", "fail",
                f"The plan has {have_beds} bedroom{'s' if have_beds != 1 else ''}; the brief asks for {int(beds)}.",
                fix=f"Plan exactly {int(beds)} bedrooms (bedroom, master_bedroom or guest_bedroom types; servant rooms don't count).",
                ref=f"{REF} P-25", value=have_beds, limit=int(beds), unit="bedrooms")
    baths = brief.get("bathrooms")
    have_baths = sum(1 for r in ix.rooms if r.get("type") in WET)
    if isinstance(baths, (int, float)) and baths > 0 and have_baths < int(baths):
        out.add("plan.program.bathrooms", "Bathrooms as briefed", "warn",
                f"The plan has {have_baths} bathroom{'s' if have_baths != 1 else ''}; the brief asks for {int(baths)}.",
                fix=f"Plan {int(baths)} baths or powder rooms.", ref=f"{REF} P-25", value=have_baths, limit=int(baths), unit="baths")
    for sp in brief.get("spaces") or []:
        key = str(sp).split(":")[0]
        if key == "car_porch":
            if not any(r.get("type") in ("porch", "garage") for r in ix.rooms):
                out.add("plan.program.space:car_porch", "Car porch", "fail", "The brief asks for a car porch; the plan has none.",
                        fix="Add a porch room inside the building line at the front.", ref=f"{REF} P-25")
            continue
        if key in SPACE_REQ:
            prog, sev = SPACE_REQ[key]
            if _count(ix.rooms, prog) == 0:
                label = key.replace("_", " ")
                out.add(f"plan.program.space:{key}", "Requested room", sev, f"The brief asks for a {label}; the plan has none.",
                        fix=f"Add a {label} ({prog} type).", ref=f"{REF} P-25")
    for fl in brief.get("floors") or []:
        lid = _level_for(ix, fl.get("level", ""))
        want = parse_program(fl.get("rooms") or [])
        if not want:
            continue
        if not lid:
            out.add(f"plan.program.floor:{fl.get('level')}", "Rooms per floor", "fail",
                    f"The brief puts rooms on the {fl.get('level')} floor, but the plan has no such floor.",
                    fix=f"Add the {fl.get('level')} level.", ref=f"{REF} P-25")
            continue
        here = ix.level_rooms(lid)
        wrong = []
        # Bedrooms: the floor's total (bedroom + master + guest) is exact; a master or guest bedroom is checked by its own type.
        want_beds = sum(n for k, n in want.items() if k in BED_KEYS)
        if want_beds:
            have = _count(here, "bedroom")
            if have != want_beds:
                wrong.append(f"{want_beds} bedroom{'s' if want_beds != 1 else ''} in all (has {have})")
        for key, n in want.items():
            if key in ("bedroom", "bed", "bedrooms"):
                continue
            if key in ("master_bedroom", "master", "guest_bedroom", "guest"):
                t = "master_bedroom" if key.startswith("master") else "guest_bedroom"
                have = sum(1 for r in here if r.get("type") == t)
                if have != n:
                    wrong.append(f"{n} {t.replace('_', ' ')}{'' if n == 1 else 's'} (has {have})")
                continue
            have = _count(here, key)
            if have < n:
                wrong.append(f"{n} {key.replace('_', ' ')}{'' if n == 1 or key.endswith('s') else 's'} (has {have})")
        if wrong:
            out.add(f"plan.program.floor:{lid}", "Rooms per floor", "fail",
                    f"The {ix.lname(lid)} should have " + ", ".join(wrong) + ".", ids=[r["id"] for r in here if r.get("type") in BEDROOMS][:6],
                    fix=f"Follow brief.floors for the {ix.lname(lid)} exactly.", ref=f"{REF} P-25")
    prefs = " ".join([str(p) for p in brief.get("preferences") or []] + [str(brief.get("notes") or "")]).lower()
    attached_asked = bool(re.search(r"attach|en.?suite", prefs))
    # one bath per bedroom (or more) means attached baths: across the brief, or on a floor of the per-floor program
    beds_n, baths_n = int(brief.get("bedrooms") or 0), int(brief.get("bathrooms") or 0)
    attached_levels: set[str] = set()
    if beds_n and baths_n >= beds_n + 1:
        attached_asked = True
    for fl in brief.get("floors") or []:
        prog = parse_program(fl.get("rooms") or [])
        b = sum(n for k, n in prog.items() if k in BED_KEYS)
        w = sum(n for k, n in prog.items() if k in ("bath", "bathroom", "baths"))
        if b and w >= b and (lid := _level_for(ix, fl.get("level", ""))):
            attached_levels.add(lid)
    for r in ix.rooms:
        if r.get("type") not in BEDROOMS:
            continue
        own = [nb for nb in ix.door_adj.get(r["id"], ()) if ix.type(nb) in WET | {"dressing"}
               and [x for x in ix.door_adj.get(nb, ()) if x != EXT] == [r["id"]]]
        own += [b for d in own if ix.type(d) == "dressing" for b in ix.door_adj.get(d, ()) if ix.type(b) in WET]
        if not any(ix.type(x) in WET for x in own):
            if r.get("type") == "master_bedroom":
                out.add(f"plan.program.attached_bath:{r['id']}", "Master en-suite", "fail", f"{r['name']} has no bath of its own.",
                        ids=[r["id"]], fix="Give the master bedroom an attached bath whose only door opens into it.", ref=f"{REF} P-25")
            elif attached_asked or r.get("level") in attached_levels:
                out.add(f"plan.program.attached_bath:{r['id']}", "Attached bath", "fail",
                        f"The brief asks for attached baths; {r['name']} has none.", ids=[r["id"]],
                        fix=f"Give {r['name']} its own bath whose only door opens into it.", ref=f"{REF} P-25")
    if re.search(r"open(-|\s)?(plan )?kitchen", prefs):
        kits = [r for r in ix.rooms if r.get("type") == "kitchen"]
        def is_open(k):
            if any(ix.open_pairs.get(tuple(sorted((k["id"], o))), {}).get("valid") for o in k.get("open_to") or []):
                return True
            for (a, b), res in ix.open_pairs.items():
                if res["valid"] and k["id"] in (a, b):
                    return True
            return any(o.get("type") == "arch" and float(o.get("width_ft") or 0) >= 5 for o in ix.door_ops.get(k["id"], []))
        if kits and not any(is_open(k) for k in kits):
            out.add("plan.program.open_kitchen", "Open kitchen", "fail", "The family asked for an open kitchen; the plan's kitchen "
                    "is closed.", ids=[k["id"] for k in kits], fix="Make the kitchen open_to the lounge or dining (no wall between).",
                    ref=f"{REF} P-25")
    if re.search(r"(parent|elder|old|senior|grand)", prefs) and re.search(r"ground", prefs):
        if not any(r.get("type") in BEDROOMS and r.get("level") == ix.ground for r in ix.rooms):
            out.add("plan.program.parents_ground", "Bedroom downstairs", "fail",
                    "The family asked for a bedroom on the ground floor (for the parents); the plan has none.",
                    fix="Put a bedroom with an attached bath on the ground floor.", ref=f"{REF} P-25")


# P-28 (Naqsha): baths you can actually use -------------------------------------------------------------------------------------
BATH_MIN = {"bath": (30.0, 4.5), "powder": (15.0, 3.0)}  # sq ft, clear width (WC + basin; a bath adds a shower)


def _bath_sizes(ix: PlanIndex, out: _Out) -> None:
    for r in ix.rooms:
        t = r.get("type")
        if t not in BATH_MIN:
            continue
        x0, y0, x1, y1 = ix.R[r["id"]]
        w, d = x1 - x0, y1 - y0
        a, narrow = w * d, min(w, d)
        need_a, need_w = BATH_MIN[t]
        if "master" in (r["id"] + r.get("name", "")).lower() and t == "bath":
            need_a = 40.0
        if a + 1e-6 < need_a or narrow + 1e-6 < need_w:
            what = f"{fmt(narrow)} wide" if narrow + 1e-6 < need_w else f"{a:.0f} sq ft"
            out.add(f"plan.room.bath_size:{r['id']}", "Bath size", "fail",
                    f"{r['name']} is only {what} ({fmt(w)} × {fmt(d)}); a usable {('master ' if need_a > 30 else '')}"
                    f"{'bath' if t == 'bath' else 'powder room'} needs {need_a:g} sq ft and {fmt(need_w)} width.", ids=[r["id"]],
                    fix=f"Make {r['name']} at least {need_a:g} sq ft and {need_w:g} ft wide, e.g. 5 × 8 ft (master 6 × 8 ft).",
                    ref=f"{REF} P-28", value=round(a), limit=need_a, unit="sq ft")
        elif t == "bath" and max(w, d) / max(narrow, 0.1) > 2.4:
            out.add(f"plan.room.bath_shape:{r['id']}", "Bath shape", "warn",
                    f"{r['name']} is a long, narrow {fmt(w)} × {fmt(d)}; part of it is wasted corridor.", ids=[r["id"]],
                    fix="Keep baths roughly 5 × 8 to 6 × 10 ft and give the spare length to a wardrobe or the bedroom.",
                    ref=f"{REF} P-28")


# P-28b (Naqsha): a walk-in dressing you can furnish ------------------------------------------------------------------------
DRESSING_MIN = (25.0, 5.0)  # sq ft, short side: a 2 ft wardrobe run + a 3 ft aisle in front of it
WARDROBE_WALL = 4.0  # one solid wall this long takes a two-door wardrobe


def _dressing_sizes(ix: PlanIndex, out: _Out) -> None:
    need_a, need_w = DRESSING_MIN
    for r in ix.rooms:
        if r.get("type") != "dressing":
            continue
        x0, y0, x1, y1 = ix.R[r["id"]]
        w, d = x1 - x0, y1 - y0
        a, narrow = w * d, min(w, d)
        if a + 1e-6 >= need_a and narrow + 1e-6 >= need_w:
            solid = longest_solid_wall(ix, r["id"])
            if solid + 1e-6 < WARDROBE_WALL:  # big enough, but doors and glass leave no wall for the wardrobe
                out.add(f"plan.room.dressing_wall:{r['id']}", "Wardrobe wall", "warn",
                        f"{r['name']} has no solid wall for a wardrobe: its longest is {fmt(solid)} and a wardrobe needs "
                        f"{fmt(WARDROBE_WALL)}.", ids=[r["id"]],
                        fix=f"Keep one wall of {r['name']} at least {WARDROBE_WALL:g} ft long with no door or window in it "
                            f"(move a door to a corner, or the window to another wall).",
                        ref=f"{REF} P-28", value=round(solid, 2), limit=WARDROBE_WALL, unit="ft")
            continue
        what = f"{fmt(narrow)} wide" if narrow + 1e-6 < need_w else f"{a:.0f} sq ft"
        out.add(f"plan.room.dressing_size:{r['id']}", "Dressing size", "fail",
                f"{r['name']} is only {what} ({fmt(w)} × {fmt(d)}); a walk-in dressing needs 5 ft across for a 2 ft wardrobe "
                f"and a 3 ft aisle, and at least {need_a:g} sq ft.", ids=[r["id"]],
                fix=f"Make {r['name']} at least 5 ft wide and {need_a:g} sq ft (e.g. 5 × 6 ft), taking the space from its "
                    f"bedroom, or drop it and give the bedroom a built-in wardrobe wall instead.",
                ref=f"{REF} P-28", value=round(narrow, 2) if narrow + 1e-6 < need_w else round(a),
                limit=need_w if narrow + 1e-6 < need_w else need_a, unit="ft" if narrow + 1e-6 < need_w else "sq ft")


# P-26 ----------------------------------------------------------------------------------------------------------------
DRY_BELOW = BEDROOMS | {"drawing", "prayer"}  # a bath over these drips into a bedroom, the guests' room or the prayer room


def _wet_over_dry(ix: PlanIndex, out: _Out) -> None:
    order = [lv["id"] for lv in ix.levels]
    for r in ix.rooms:
        if r.get("type") not in WET or r.get("level") not in order:
            continue
        i = order.index(r["level"])
        if i == 0:
            continue
        below = order[i - 1]
        ra = ix.R[r["id"]]
        for x in ix.level_rooms(below):
            if x.get("type") in DRY_BELOW and overlap_area(ra, ix.R[x["id"]]) > 0.5 * area(ra):
                out.add(f"plan.structure.wet_over_dry:{r['id']}", "Bath over a dry room", "warn",
                        f"{r['name']} sits over {x['name']}: leaks and drain pipes would run through its ceiling.",
                        ids=[r["id"], x["id"]], fix=f"Move {r['id']} over a bath, the kitchen, a store, laundry or the stair hall "
                                                    f"below (or swap it with a room that sits over one).", ref=f"{REF} P-26")
                break


def _free_segments(ix: "PlanIndex", rid: str, side: str) -> list[tuple[float, float, str]]:
    """Parts of a room's side that face outdoors on the same level: not shared with an enclosed room, not on a party wall.
    [(lo, hi, outside id or "exterior")]"""
    r = ix.R[rid]
    axis, c, lo, hi, _ = sides(r)[side]
    if ix.on_party_line(axis, c, lo, hi):
        return []
    lid = ix.by_id[rid].get("level")
    cuts: list[tuple[float, float, str | None]] = []
    for other in ix.level_rooms(lid):
        if other["id"] == rid:
            continue
        e = shared_edge(r, ix.R[other["id"]])
        if not e or e[0] != axis or abs(e[1] - c) > 0.1:
            continue
        cuts.append((e[2], e[3], other["id"] if other.get("type") in OPEN else None))
    out, cur = [], lo
    for a, b, oid in sorted(cuts, key=lambda c: (c[0], c[1])):
        if a > cur + 0.5:
            out.append((cur, a, "exterior"))
        if oid:
            out.append((max(a, cur), b, oid))
        cur = max(cur, b)
    if hi > cur + 0.5:
        out.append((cur, hi, "exterior"))
    return [s for s in out if s[1] - s[0] >= 2.0]


def add_missing_windows(plan: dict) -> list[str]:
    """Deterministic daylight repair: a habitable room or kitchen short of 8% glazing gets a window on its longest free
    outside wall (same level, clear of other openings); a bath or powder room with no opening to the outside gets a
    ventilator. Returns the ids added."""
    from .lda import HABITABLE  # (lda imports this module)
    # earlier automatic openings are placed afresh each time (the rooms may have moved since)
    plan["openings"] = [o for o in plan.get("openings") or [] if "_auto" not in str(o.get("id", ""))]
    ix = PlanIndex(plan)
    added: list[str] = []
    for r in ix.rooms:
        t = r.get("type")
        if r.get("level") == ix.roof_id or t not in HABITABLE | KITCHENS | WET:
            continue
        rid = r["id"]
        x0, y0, x1, y1 = ix.R[rid]
        floor = (x1 - x0) * (y1 - y0)
        wet = t in WET
        have = valid_glazing(ix, rid)
        need = 2.0 if wet else 0.08 * floor
        if have + 0.05 >= need:
            continue
        best = None
        for side in ("front", "back", "left", "right"):
            for lo, hi, out in _free_segments(ix, rid, side):
                taken = [o for o in ix.openings if rid in o.get("between") or []]
                axis = sides(ix.R[rid])[side][0]
                c = sides(ix.R[rid])[side][1]
                busy = [(float(o["at"][0] if axis == "x" else o["at"][1]), float(o.get("width_ft") or 3)) for o in taken
                        if abs(float(o["at"][1] if axis == "x" else o["at"][0]) - c) < 0.3]
                # the widest gap on this segment between existing openings
                pts = sorted([(lo, lo)] + [(a - w / 2 - 0.5, a + w / 2 + 0.5) for a, w in busy] + [(hi, hi)])
                for (_, e0), (s1, _) in zip(pts, pts[1:]):
                    gap = s1 - e0
                    if gap >= (2.0 if wet else 3.0) and (best is None or gap > best[0]):
                        best = (gap, side, axis, c, e0, s1, out)
        if not best:
            continue
        gap, side, axis, c, a, b, out = best
        h = 1.5 if wet else 4.5
        w = 2.0 if wet else max(3.0, min(gap - 0.6, round(((need - have) / h + 0.5) * 2) / 2, 10.0))
        mid = round((a + b) / 2 * 4) / 4
        at = [mid, round(c, 2)] if axis == "x" else [round(c, 2), mid]
        oid = f"{rid}_{'vent' if wet else 'win'}_auto"
        plan.setdefault("openings", []).append({"id": oid, "level": r.get("level"), "type": "ventilator" if wet else "window",
                                                "at": at, "width_ft": w, "height_ft": h, "sill_ft": 6.0 if wet else 3.0,
                                                "between": [rid, out]})
        added.append(oid)
        ix = PlanIndex(plan)
    return added


# --- deterministic door repair --------------------------------------------------------------------------------------
# Who a room may be entered from, in order of preference (the house's circulation logic, plainly).
DOOR_FROM = {
    "bath": ("bedroom", "master_bedroom", "guest_bedroom", "corridor", "lobby", "lounge", "stair"),
    "powder": ("corridor", "lobby", "lounge", "stair"),
    "dressing": ("bedroom", "master_bedroom", "guest_bedroom"),
    "bedroom": ("corridor", "lobby", "lounge", "stair", "dining"),
    "master_bedroom": ("corridor", "lobby", "lounge", "stair", "dining"),
    "guest_bedroom": ("corridor", "lobby", "lounge", "stair", "drawing"),
    "servant": ("corridor", "lobby", "dirty_kitchen", "kitchen", "open_space", "porch"),
    "kitchen": ("dining", "lounge", "lobby", "corridor"),
    "dirty_kitchen": ("kitchen", "corridor", "lobby", "open_space"),
    "store": ("corridor", "lobby", "kitchen", "dirty_kitchen", "lounge"),
    "laundry": ("corridor", "lobby", "dirty_kitchen", "terrace", "open_space"),
    "prayer": ("corridor", "lobby", "lounge"),
    "study": ("corridor", "lobby", "lounge"),
    "dining": ("lounge", "lobby", "corridor", "kitchen"),
    "drawing": ("lobby", "porch", "corridor"),
    "lounge": ("lobby", "corridor", "stair", "dining"),
    "lobby": ("porch", "lounge", "corridor"),
    "corridor": ("lounge", "lobby", "stair"),
    "balcony": ("bedroom", "master_bedroom", "lounge", "corridor"),
    "terrace": ("lounge", "corridor", "stair", "bedroom", "master_bedroom"),
}


def _door_on(ix: "PlanIndex", a: str, b: str, width: float) -> list[float] | None:
    """A point for a door between rooms a and b on their shared wall, clear of the openings already on it."""
    e = shared_edge(ix.R[a], ix.R[b])
    if not e or e[3] - e[2] < width + 1.0:
        return None
    axis, c, lo, hi = e
    busy = []
    for o in ix.openings:
        if a in o.get("between") or [] or b in o.get("between") or []:
            ox, oy = float(o["at"][0]), float(o["at"][1])
            if abs((oy if axis == "x" else ox) - c) < 0.3:
                busy.append(((ox if axis == "x" else oy), float(o.get("width_ft") or 3)))
    for along in [lo + 0.5 + width / 2, hi - 0.5 - width / 2, (lo + hi) / 2]:  # near a corner first, as architects do
        if all(abs(along - p) >= (w + width) / 2 + 0.5 for p, w in busy):
            along = round(along * 4) / 4
            return [along, round(c, 2)] if axis == "x" else [round(c, 2), along]
    return None


def repair_doors(plan: dict, rounds: int = 3) -> list[str]:
    """Doors the plan can't build (between rooms that share no wall) are dropped, and every enclosed room nobody can reach
    gets a door from the right kind of neighbour (a bath from its bedroom, a bedroom from a corridor or the lounge).
    Returns the ids added."""
    added: list[str] = []
    for _ in range(rounds):
        ix = PlanIndex(plan)
        bad = {o["id"] for o in ix.openings if o.get("type") in DOORS and not ix.info[o["id"]]["valid"]
               and len(set(r for r in o.get("between") or [] if r != EXT)) == 2}
        if bad:
            plan["openings"] = [o for o in plan.get("openings") or [] if o.get("id") not in bad]
            ix = PlanIndex(plan)
        out = _Out()
        try:
            _reach(ix, out)
        except Exception:
            return added
        stuck = [c["id"].split(":", 1)[1] for c in out.checks if c["id"].startswith("plan.circulation.unreachable:")
                 and c["status"] == "fail"]
        if not stuck:
            break
        made = False
        for rid in stuck:
            if rid not in ix.by_id:
                continue
            t = ix.by_id[rid].get("type")
            wants = DOOR_FROM.get(t, ("corridor", "lobby", "lounge"))
            nbs = [n for n in ix.adj.get(rid, ()) if n in ix.by_id and ix.by_id[n].get("level") == ix.by_id[rid].get("level")]
            nbs.sort(key=lambda n: wants.index(ix.by_id[n].get("type")) if ix.by_id[n].get("type") in wants else 99)
            for n in nbs:
                if ix.by_id[n].get("type") not in wants:
                    break
                w = 2.5 if t in WET or t == "dressing" else 3.0
                at = _door_on(ix, rid, n, w)
                if at:
                    oid = f"{rid}_door_auto"
                    plan.setdefault("openings", []).append({"id": oid, "level": ix.by_id[rid].get("level"), "type": "door",
                                                            "at": at, "width_ft": w, "height_ft": 7, "between": [rid, n]})
                    added.append(oid)
                    made = True
                    break
        if not made:
            break
    return added
