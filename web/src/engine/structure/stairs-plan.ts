/**
 * Stair planning, run before any wall is derived (pure plan geometry, feet):
 *  - a missing flight from the top storey to the roof is synthesized (B.3.1);
 *  - stairs are grouped into stacks that share one layout and one handedness (B.2.3);
 *  - flights are laid out at code: treads never below max(tread_in, 10 in), landings at least the flight width,
 *    a 2.95 ft clear strip in front of the first riser on every level; anything the stair room cannot give is
 *    reported (B.2.1, B.2.2) instead of being silently squeezed;
 *  - the stair tower (mumty) is grown to cover the top flight and its top landing, and its door is placed on a wall
 *    that touches that landing, at roof level, never over the void (B.3.2 to B.3.5).
 */
import { expandRect, rectContains, type R } from "../core/grid";
import type { NoteLog } from "../core/notes";
import { clamp, warn } from "../core/util";
import type { LevelM, PlanModel, RoomM, Side, StairM } from "../plan/model";
import { cap, openingName, openingNameLow, stairLabel } from "./labels";

const EXT_T = 0.75;
const INT_T = 0.375;
/** clear strip in front of the first riser (and the arrival landing of a dog-leg) */
export const STRIP = 2.95;
const GAP = 0.05;

export interface Flight {
  axis: "x" | "y";
  sign: 1 | -1;
  /** across extent */
  c0: number;
  c1: number;
  /** along coordinate of the first riser */
  s0: number;
  n: number;
  riser: number;
  tread: number;
  h0: number;
}

export interface StairLayout {
  stair: StairM;
  kind: "dogleg" | "straight" | "l_shape";
  flights: Flight[];
  landings: { rect: R; h: number }[];
  holes: R[];
  /** laid-out footprint (first riser to the far end of the stair) */
  rect: R;
  /** upper level id where the hole is cut */
  holeLevel: string;
  /** a point on the top landing just beyond the top riser */
  arrival: { x: number; y: number };
  /** the line where the last flight meets the upper floor (edge-run convention: `axis` = direction it runs) */
  topRiser: { axis: "x" | "y"; c: number; a: number; b: number };
  /** clear landing in front of the first riser (from level) */
  foot: R;
  /** top landing on the upper level: between the top riser and the stair room's wall */
  landing: R;
  /** unit plan direction of travel when stepping off the last flight */
  outDir: [number, number];
  /** the stair's clear foot strip (ft) actually built */
  strip: number;
  /** EN2-01: built-in storage under the flights and landings where the soffit is under 6′8″ (filled in by stairs-geo):
   *  along [a0, a1] × across [c0, c1] on `axis`, from the floor up to top0 (at a0) / top1 (at a1), plan ft */
  storage?: { axis: "x" | "y"; a0: number; a1: number; c0: number; c1: number; floor: number; top0: number; top1: number }[];
}

export interface TowerDoor {
  room: RoomM;
  at: [number, number];
  side: Side;
  width: number;
}

const near = (a: number, b: number, e = 1e-3) => Math.abs(a - b) <= e;
const mk = (axis: "x" | "y", a0: number, a1: number, c0: number, c1: number): R =>
  axis === "x"
    ? { x: Math.min(a0, a1), y: Math.min(c0, c1), w: Math.abs(a1 - a0), d: Math.abs(c1 - c0) }
    : { x: Math.min(c0, c1), y: Math.min(a0, a1), w: Math.abs(c1 - c0), d: Math.abs(a1 - a0) };
const bbox = (...rs: R[]): R => {
  const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y));
  const x1 = Math.max(...rs.map((r) => r.x + r.w)), y1 = Math.max(...rs.map((r) => r.y + r.d));
  return { x: x0, y: y0, w: x1 - x0, d: y1 - y0 };
};
const overlapArea = (a: R, b: R) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.d, b.y + b.d) - Math.max(a.y, b.y));

// ── B.3.1: the flight from the top storey to the roof ─────────────────────────────────────────────────────
export function ensureStairChain(plan: PlanModel, notes: NoteLog): void {
  if (!plan.stairs.length) return;
  const chain = [...plan.storeys, plan.roof];
  for (let k = 0; k + 1 < chain.length; k++) {
    const from = chain[k], to = chain[k + 1];
    if (plan.stairs.some((s) => s.from === from && s.to.elev >= to.elev - 0.01)) continue;
    // only continue a stair that reaches this storey (a ground-only stair room does not imply a roof stair)
    const below = plan.stairs.filter((s) => s.to === from).sort((a, b) => b.from.elev - a.from.elev)[0];
    if (!below) continue;
    const s: StairM = { ...below, id: `${below.id}_to_${to.id}`, from, to, rect: { ...below.rect }, synthetic: true };
    plan.addStair(s);
    notes.add({
      id: `asbuilt.roof_stair_added:${s.id}`,
      title: to.isRoof ? "Stair to the roof added" : "Missing stair added",
      // EN-F4: an addition the engine guarantees, not a problem (pass: never counted or listed as a note)
      status: "pass",
      message: `The engine continued ${stairLabel(below)} up to the ${to.name.toLowerCase()}, which the plan's stairs didn't reach.`,
      element_ids: [s.id],
    });
  }
}

// ── faces of a stair room (before walls exist) ────────────────────────────────────────────────────────────
/**
 * Inner face of `room` on `side`, over the across range [lo, hi]. A wall to an enclosed room is interior
 * (0.375 ft), anything else exterior (0.75 ft); an open-plan edge (open_to) does not limit the stair at all.
 */
function sideFace(plan: PlanModel, room: RoomM, side: Side, lo: number, hi: number): number {
  const r = room.rect;
  const axisAlong = side === "front" || side === "back" ? "x" : "y";
  const e = side === "front" ? r.y : side === "back" ? r.y + r.d : side === "left" ? r.x : r.x + r.w;
  const into = side === "front" || side === "left" ? 1 : -1;
  const a = Math.max(lo, axisAlong === "x" ? r.x : r.y), b = Math.min(hi, axisAlong === "x" ? r.x + r.w : r.y + r.d);
  let face = into > 0 ? -Infinity : Infinity;
  const n = 6;
  for (let k = 0; k <= n; k++) {
    const u = b > a ? a + ((b - a) * (k + 0.5)) / (n + 1) : (a + b) / 2;
    const ox = axisAlong === "x" ? u : e - into * 0.3;
    const oy = axisAlong === "x" ? e - into * 0.3 : u;
    const other = plan.roomAt(room.level, ox, oy);
    let f: number;
    if (other && other !== room && plan.isOpen(room, other)) f = e - into * 6;
    else if (other && other !== room && other.cat === "enclosed") f = e + (into * INT_T) / 2;
    else f = e + (into * EXT_T) / 2;
    face = into > 0 ? Math.max(face, f) : Math.min(face, f);
  }
  return face;
}

/** which across side should people ARRIVE on: the side nearer the upper level's access (open_to rooms, doors) */
function arrivalHigh(plan: PlanModel, s: StairM, axis: "x" | "y", C0: number, C1: number): boolean {
  const R0 = s.rect;
  const upRoom = plan.roomAt(s.to.id, R0.x + R0.w / 2, R0.y + R0.d / 2);
  let accessC = (C0 + C1) / 2 + (axis === "y" ? (plan.plotW / 2 > (C0 + C1) / 2 ? 0.1 : -0.1) : 0.1);
  if (upRoom) {
    const pts: number[] = [];
    for (const o of plan.roomsOn(s.to.id)) {
      if (!plan.isOpen(upRoom, o)) continue;
      pts.push(axis === "y" ? o.rect.x + o.rect.w / 2 : o.rect.y + o.rect.d / 2);
    }
    for (const op of plan.openings) {
      if (op.level !== s.to.id || !op.between.includes(upRoom.id)) continue;
      pts.push(axis === "y" ? op.at[0] : op.at[1]);
    }
    if (pts.length) accessC = pts.reduce((p, q) => p + q, 0) / pts.length;
  }
  return accessC > (C0 + C1) / 2;
}

// ── B.2: stacks and code-compliant layouts ────────────────────────────────────────────────────────────────
export function layoutStairs(plan: PlanModel, notes: NoteLog): StairLayout[] {
  // stacks: stairs whose footprints overlap by > 80 % share one layout (their flights stand on top of each other)
  const stairs = [...plan.stairs].sort((a, b) => a.from.elev - b.from.elev);
  const stacks: StairM[][] = [];
  for (const s of stairs) {
    const area = s.rect.w * s.rect.d;
    const st = stacks.find((g) => g.some((t) => overlapArea(t.rect, s.rect) > 0.8 * Math.min(area, t.rect.w * t.rect.d)) && !g.some((t) => t.from === s.from));
    if (st) st.push(s);
    else stacks.push([s]);
  }
  const out: StairLayout[] = [];
  for (const st of stacks) {
    // EN-06: a flight or landing that passes less than 7 ft over a door below (or a door above that would open onto
    // the stairwell) makes the planner turn the stair around or mirror it, when that clears every door
    const VARIANTS = [{ flipSign: false, flipArrive: false }, { flipSign: true, flipArrive: false }, { flipSign: false, flipArrive: true }, { flipSign: true, flipArrive: true }];
    let best: { v: (typeof VARIANTS)[number]; n: number } | null = null;
    for (const v of VARIANTS) {
      const scratch = new NoteLogLite();
      const lays = layoutStack(plan, st, scratch as unknown as NoteLog, v);
      if (!lays.length) break;
      const n = blockedDoors(plan, lays).length + scratch.fails * 3;
      if (!best || n < best.n) best = { v, n };
      if (n === 0) break;
    }
    const v = best?.v ?? VARIANTS[0];
    const lays = layoutStack(plan, st, notes, v);
    if (v !== VARIANTS[0] && lays.length)
      notes.add({
        id: `asbuilt.stair_turned:${st[0].id}`,
        title: "Stair turned to clear a door",
        status: "warn",
        message: `${cap(stairLabel(st[0]))} was ${v.flipSign ? "turned around" : "mirrored"}${v.flipSign && v.flipArrive ? " and mirrored" : ""} so no flight or landing passes over a door.`,
        element_ids: st.map((s) => s.id),
      });
    for (const b of blockedDoors(plan, lays))
      notes.add({
        id: `asbuilt.stair_blocks_door:${b.op.id}`,
        title: "Stair landing blocks a door",
        status: "fail",
        message: b.under
          ? `${cap(stairLabel(b.lay.stair))} passes only ${Math.max(0, b.clear).toFixed(1)} ft above the floor in front of ${openingNameLow(plan, b.op)}; it needs 7 ft.`
          : `${openingName(plan, b.op)} opens onto the stairwell of ${stairLabel(b.lay.stair)}.`,
        element_ids: [b.op.id, b.lay.stair.id],
      });
    out.push(...lays);
  }
  return out;
}

/** collects notes during a trial layout (only to compare variants) */
class NoteLogLite {
  fails = 0;
  readonly list: unknown[] = [];
  add(n: { status: string }): void {
    if (n.status === "fail") this.fails++;
  }
}

type PlanOpening = PlanModel["openings"][number];

/**
 * Doors a stair layout gets in the way of: a door on its from level whose 2.5 ft approach lies under a flight or
 * landing less than 7 ft up, or a door on its upper level whose approach opens onto the stairwell.
 */
export function blockedDoors(plan: PlanModel, lays: StairLayout[]): { lay: StairLayout; op: PlanOpening; clear: number; under: boolean }[] {
  const DOORS = ["main_door", "door", "double_door", "sliding_door", "arch", "garage_door"];
  const out: { lay: StairLayout; op: PlanOpening; clear: number; under: boolean }[] = [];
  const isect = (a: R, b: R): R | null => {
    const x0 = Math.max(a.x, b.x), x1 = Math.min(a.x + a.w, b.x + b.w), y0 = Math.max(a.y, b.y), y1 = Math.min(a.y + a.d, b.y + b.d);
    return x1 - x0 > 0.05 && y1 - y0 > 0.05 ? { x: x0, y: y0, w: x1 - x0, d: y1 - y0 } : null;
  };
  /** the door's 2.5 ft approach on the stair's side, when the door stands on an edge of the stair's footprint */
  const approach = (op: PlanOpening, R: R): R | null => {
    const [x, y] = op.at, hw = op.width / 2;
    for (const e of [R.y, R.y + R.d]) {
      if (Math.abs(y - e) > 0.9 || x + hw < R.x || x - hw > R.x + R.w) continue;
      const inward = e === R.y ? 1 : -1;
      return { x: x - hw, y: inward > 0 ? y : y - 2.5, w: op.width, d: 2.5 };
    }
    for (const e of [R.x, R.x + R.w]) {
      if (Math.abs(x - e) > 0.9 || y + hw < R.y || y - hw > R.y + R.d) continue;
      const inward = e === R.x ? 1 : -1;
      return { x: inward > 0 ? x : x - 2.5, y: y - hw, w: 2.5, d: op.width };
    }
    return null;
  };
  for (const lay of lays) {
    const from = lay.stair.from;
    const floorRoom = plan.roomAt(from.id, lay.rect.x + lay.rect.w / 2, lay.rect.y + lay.rect.d / 2);
    const floor = floorRoom ? floorRoom.floorH : from.elev;
    for (const op of plan.openings) {
      if (!DOORS.includes(op.type)) continue;
      if (op.level === from.id) {
        const z = approach(op, lay.rect);
        if (!z) continue;
        let low = Infinity;
        for (const L of lay.landings) if (isect(L.rect, z)) low = Math.min(low, L.h - 0.5);
        for (const f of lay.flights) {
          const fr = mk(f.axis, f.s0, f.s0 + f.sign * (f.n - 1) * f.tread, f.c0, f.c1);
          const ov = isect(fr, z);
          if (!ov) continue;
          const [a0, a1] = f.axis === "x" ? [ov.x, ov.x + ov.w] : [ov.y, ov.y + ov.d];
          const t = f.sign > 0 ? a0 - f.s0 : f.s0 - a1; // nearest the first riser = lowest
          const k = Math.max(0, Math.floor(t / f.tread));
          low = Math.min(low, f.h0 + (k + 1) * f.riser - 0.75);
        }
        if (low - floor < 7) out.push({ lay, op, clear: low - floor, under: true });
      } else if (op.level === lay.holeLevel && !lay.stair.to.isRoof) {
        const z = approach(op, lay.rect);
        if (z && lay.holes.some((h) => isect(h, z))) out.push({ lay, op, clear: 0, under: false });
      }
    }
  }
  return out;
}

function layoutStack(plan: PlanModel, stack: StairM[], notes: NoteLog, v: { flipSign: boolean; flipArrive: boolean } = { flipSign: false, flipArrive: false }): StairLayout[] {
  const base = stack[0];
  const R0 = base.rect;
  const axis: "x" | "y" = base.start === "+x" || base.start === "-x" ? "x" : "y";
  const sign0: 1 | -1 = base.start === "+x" || base.start === "+y" ? 1 : -1;
  const sign: 1 | -1 = v.flipSign ? (-sign0 as 1 | -1) : sign0;
  const pA0 = axis === "x" ? R0.x : R0.y, pA1 = axis === "x" ? R0.x + R0.w : R0.y + R0.d;
  const C0 = axis === "x" ? R0.y : R0.x, C1 = axis === "x" ? R0.y + R0.d : R0.x + R0.w;
  const breadth = C1 - C0;
  const cx = R0.x + R0.w / 2, cy = R0.y + R0.d / 2;
  const planLen = pA1 - pA0;
  let kind: StairLayout["kind"] = base.kind;
  if (kind === "dogleg" && breadth < 2 * 2.4 + 0.1) kind = "straight";
  if (kind === "l_shape" && (breadth < 4.5 || planLen < 4.5)) kind = "straight";
  if (kind !== base.kind)
    notes.add({
      id: `asbuilt.stair_kind:${base.id}`,
      title: "Stair built as a straight flight",
      status: "warn",
      message: `${cap(stairLabel(base))} is only ${breadth.toFixed(1)} ft wide, too narrow for a ${base.kind === "dogleg" ? "dog-leg" : "turn"}, so it was built as a straight flight.`,
      element_ids: stack.map((s) => s.id),
    });
  let T = Math.max(...stack.map((s) => Math.max(s.tread_in, 10) / 12));
  const per = stack
    .map((s) => {
      const fromRoom = plan.roomAt(s.from.id, cx, cy);
      const h0 = fromRoom ? fromRoom.floorH : s.from.elev;
      const rise = s.to.elev - h0;
      const N = Math.max(3, Math.round((rise * 12) / s.riser_in));
      return { s, h0, rise, N, r: rise / N, n1: kind === "straight" ? N : Math.ceil(N / 2) };
    })
    .filter((p) => p.rise >= 3);
  if (!per.length) return [];
  const wf = kind === "dogleg" ? Math.min(base.width, (breadth - 0.15) / 2) : kind === "l_shape" ? Math.min(base.width, breadth * 0.5, planLen * 0.5) : Math.min(base.width, breadth);
  const arriveHigh = arrivalHigh(plan, base, axis, C0, C1) !== v.flipArrive;

  // room faces along the run, on every level the stack touches (the roof is handled by the tower)
  const lowSide: Side = axis === "y" ? "front" : "left";
  const highSide: Side = axis === "y" ? "back" : "right";
  const facesOn = (lvs: LevelM[]) => {
    let lo = -Infinity, hi = Infinity;
    for (const lv of lvs) {
      const room = plan.roomAt(lv.id, cx, cy);
      if (!room || room.cat !== "enclosed") continue;
      lo = Math.max(lo, sideFace(plan, room, lowSide, C0, C1));
      hi = Math.min(hi, sideFace(plan, room, highSide, C0, C1));
    }
    return { lo, hi };
  };
  const uniq = (l: LevelM[]) => [...new Set(l)];
  const fromLv = uniq(per.map((p) => p.s.from));
  const toLv = uniq(per.map((p) => p.s.to).filter((l) => !l.isRoof));
  const all = facesOn(uniq([...fromLv, ...toLv]));
  const F = facesOn(fromLv);
  const Tl = facesOn(toLv);
  const n1max = Math.max(...per.map((p) => p.n1));
  const Nmax = Math.max(...per.map((p) => p.N));
  let strip = STRIP;
  let len: number;
  let A0: number, A1: number;
  const fail = (msg: string, status: "warn" | "fail" = "fail") =>
    notes.add({ id: `asbuilt.stair_fit:${base.id}`, title: status === "fail" ? "Stair does not fit its room" : "Stair landing tight", status, message: msg, element_ids: stack.map((s) => s.id) });

  if (kind === "dogleg" || kind === "l_shape") {
    // the start end is both the foot (below) and the arrival (above) of a dog-leg: it needs the strip on every level
    const Lmin = kind === "dogleg" ? Math.max(3.0, wf) : wf;
    const lo = Number.isFinite(all.lo) ? all.lo : sign > 0 ? pA0 - STRIP : -Infinity;
    const hi = Number.isFinite(all.hi) ? all.hi : sign < 0 ? pA1 + STRIP : Infinity;
    const total = hi - GAP - lo;
    const need = (n1max - 1) * T + Lmin;
    const need3 = (n1max - 1) * T + (kind === "dogleg" ? 3.0 : wf);
    if (!Number.isFinite(total) || total - STRIP >= need) {
      len = Number.isFinite(total) ? clamp(planLen, need, total - STRIP) : Math.max(planLen, need);
    } else if (total - STRIP >= need3) {
      len = total - STRIP;
      fail(`The mid-landing of ${stairLabel(base)} is ${(len - (n1max - 1) * T).toFixed(1)} ft deep, under its ${wf.toFixed(1)} ft width: the stair room is ${(need + STRIP - total).toFixed(1)} ft too short.`, "warn");
    } else if (total - 2.0 >= need3) {
      len = need3;
      strip = total - len;
      fail(`${cap(stairLabel(base))} has only ${strip.toFixed(1)} ft clear at its foot: the stair room is ${(need3 + STRIP - total).toFixed(1)} ft too short.`);
    } else {
      // last resort: shallower treads (reported, never silent)
      const Tmin = 9.5 / 12;
      const T2 = Math.max(Tmin, (total - 2.0 - (need3 - (n1max - 1) * T)) / Math.max(1, n1max - 1));
      const was = T;
      T = Math.min(T, T2);
      len = (n1max - 1) * T + (kind === "dogleg" ? 3.0 : wf);
      strip = Math.max(0.3, total - len);
      fail(`${cap(stairLabel(base))} was built with ${(T * 12).toFixed(1)} in treads (code: ${(was * 12).toFixed(0)} in): the stair room is ${(need3 + STRIP - total).toFixed(1)} ft too short.`);
    }
    if (sign > 0) {
      A0 = Number.isFinite(lo) ? clamp(pA0, lo + strip, Number.isFinite(hi) ? Math.max(lo + strip, hi - GAP - len) : Infinity) : pA0;
      A1 = A0 + len;
    } else {
      A1 = Number.isFinite(hi) ? clamp(pA1, Number.isFinite(lo) ? Math.min(hi - strip, lo + GAP + len) : -Infinity, hi - strip) : pA1;
      A0 = A1 - len;
    }
  } else {
    // straight: foot strip at the start on the from levels, arrival strip beyond the top riser on the to levels
    const run = (Nmax - 1) * T;
    const startFace = sign > 0 ? F.lo : F.hi;
    const bodyEnd = sign > 0 ? F.hi - GAP : F.lo + GAP;
    const arriveEnd = sign > 0 ? (Number.isFinite(Tl.hi) ? Tl.hi - STRIP : Infinity) : Number.isFinite(Tl.lo) ? Tl.lo + STRIP : -Infinity;
    const limitEnd = sign > 0 ? Math.min(bodyEnd, arriveEnd) : Math.max(bodyEnd, arriveEnd);
    const startMin = sign > 0 ? startFace + STRIP : startFace - STRIP; // first riser may not be closer to the wall than this
    const avail = Number.isFinite(startFace) && Number.isFinite(limitEnd) ? Math.abs(limitEnd - startMin) * (sign > 0 ? Math.sign(limitEnd - startMin) : Math.sign(startMin - limitEnd)) : Infinity;
    len = run;
    if (avail < run) {
      const Tmin = 9.5 / 12;
      const T2 = Math.max(Tmin, (avail + 2 * (STRIP - 2.0)) / Math.max(1, Nmax - 1));
      if (T2 < T) {
        const was = T;
        T = T2;
        len = (Nmax - 1) * T;
        fail(`${cap(stairLabel(base))} was built with ${(T * 12).toFixed(1)} in treads (code: ${(was * 12).toFixed(0)} in): the stair room is ${(run - avail).toFixed(1)} ft too short.`);
      } else fail(`The landings of ${stairLabel(base)} are under 3 ft: the stair room is ${(run - avail).toFixed(1)} ft too short.`);
    }
    const s0 = sign > 0 ? pA0 : pA1;
    let st: number;
    if (!Number.isFinite(avail)) st = s0;
    else if (sign > 0) st = clamp(s0, Math.min(startMin, limitEnd - len), Math.max(startMin, limitEnd - len));
    else st = clamp(s0, Math.min(startMin, limitEnd + len), Math.max(startMin, limitEnd + len));
    A0 = sign > 0 ? st : st - len;
    A1 = sign > 0 ? st + len : st;
    strip = Number.isFinite(startFace) ? Math.abs((sign > 0 ? A0 : A1) - startFace) : STRIP;
  }

  const startA = sign > 0 ? A0 : A1;
  const farA = sign > 0 ? A1 : A0;
  const rect = mk(axis, A0, A1, C0, C1);
  const foot = mk(axis, startA - sign * strip, startA, C0, C1);
  const layouts: StairLayout[] = [];
  for (const p of per) {
    const s = p.s;
    const r = p.r, h0 = p.h0, N = p.N;
    const flights: Flight[] = [];
    const landings: { rect: R; h: number }[] = [];
    const holes: R[] = [];
    const slabBottom = s.to.elev - s.from.slab;
    const kMax = Math.floor((slabBottom - 6.75 - h0) / r) - 1;
    if (kind === "dogleg") {
      const n1 = p.n1, n2 = N - n1;
      const L = len - (n1 - 1) * T;
      const f1c: [number, number] = arriveHigh ? [C0, C0 + wf] : [C1 - wf, C1];
      const f2c: [number, number] = arriveHigh ? [C1 - wf, C1] : [C0, C0 + wf];
      flights.push({ axis, sign, c0: f1c[0], c1: f1c[1], s0: startA, n: n1, riser: r, tread: T, h0 });
      const landNear = farA - sign * L;
      landings.push({ rect: mk(axis, landNear, farA, C0, C1), h: h0 + n1 * r });
      flights.push({ axis, sign: (-sign) as 1 | -1, c0: f2c[0], c1: f2c[1], s0: landNear, n: n2, riser: r, tread: T, h0: h0 + n1 * r });
      const end2 = landNear - sign * (n2 - 1) * T;
      const safe1 = startA + sign * Math.max(0, kMax) * T;
      const cut1 = sign > 0 ? Math.min(end2, safe1) : Math.max(end2, safe1);
      holes.push(mk(axis, end2, farA, f2c[0], f2c[1]));
      holes.push(mk(axis, cut1, farA, f1c[0], f1c[1]));
      if (f2c[0] > f1c[1] + 1e-3) holes.push(mk(axis, cut1, farA, f1c[1], f2c[0]));
      if (f1c[0] > f2c[1] + 1e-3) holes.push(mk(axis, cut1, farA, f2c[1], f1c[0]));
      const ac = (f2c[0] + f2c[1]) / 2, aa = end2 - sign * 1.2;
      const outDir: [number, number] = axis === "x" ? [-sign, 0] : [0, -sign];
      layouts.push({
        stair: s, kind, flights, landings, holes, rect, holeLevel: s.to.id,
        arrival: axis === "x" ? { x: aa, y: ac } : { x: ac, y: aa },
        topRiser: { axis: axis === "x" ? "y" : "x", c: end2, a: f2c[0], b: f2c[1] },
        foot, landing: mk(axis, startA - sign * strip, end2, C0, C1), outDir, strip,
      });
    } else if (kind === "l_shape") {
      const n1 = p.n1, n2 = N - n1;
      let T2 = T;
      if ((n2 - 1) * T2 + wf > breadth) {
        const was = T2;
        T2 = Math.max(9.5 / 12, (breadth - wf) / Math.max(1, n2 - 1));
        notes.add({ id: `asbuilt.stair_fit:${s.id}:l`, title: "Stair does not fit its room", status: "fail", message: `The second flight of ${stairLabel(s)} was built with ${(T2 * 12).toFixed(1)} in treads: the stair is only ${breadth.toFixed(1)} ft wide.`, element_ids: [s.id] });
      }
      const f1c: [number, number] = arriveHigh ? [C0, C0 + wf] : [C1 - wf, C1];
      flights.push({ axis, sign, c0: f1c[0], c1: f1c[1], s0: startA, n: n1, riser: r, tread: T, h0 });
      const landA0 = startA + sign * (n1 - 1) * T;
      const landA1 = landA0 + sign * wf;
      landings.push({ rect: mk(axis, landA0, landA1, f1c[0], f1c[1]), h: h0 + n1 * r });
      const axis2: "x" | "y" = axis === "x" ? "y" : "x";
      const sign2: 1 | -1 = arriveHigh ? 1 : -1;
      const s02 = arriveHigh ? f1c[1] : f1c[0];
      flights.push({ axis: axis2, sign: sign2, c0: Math.min(landA0, landA1), c1: Math.max(landA0, landA1), s0: s02, n: n2, riser: r, tread: T2, h0: h0 + n1 * r });
      const end = s02 + sign2 * (n2 - 1) * T2;
      const safe1 = startA + sign * Math.max(0, kMax) * T;
      const cut1 = sign > 0 ? Math.min(landA0, safe1) : Math.max(landA0, safe1);
      holes.push(mk(axis, cut1, landA1, f1c[0], f1c[1]));
      holes.push(axis2 === "x" ? mk("x", s02, end, Math.min(landA0, landA1), Math.max(landA0, landA1)) : mk("y", s02, end, Math.min(landA0, landA1), Math.max(landA0, landA1)));
      const ac = (landA0 + landA1) / 2, aa = end + sign2 * 1.2;
      const outDir: [number, number] = axis2 === "x" ? [sign2, 0] : [0, sign2];
      const landTop = axis2 === "x" ? mk("x", end, end + sign2 * STRIP, Math.min(landA0, landA1), Math.max(landA0, landA1)) : mk("y", end, end + sign2 * STRIP, Math.min(landA0, landA1), Math.max(landA0, landA1));
      layouts.push({
        stair: s, kind, flights, landings, holes, rect, holeLevel: s.to.id,
        arrival: axis2 === "x" ? { x: aa, y: ac } : { x: ac, y: aa },
        topRiser: { axis: axis2 === "x" ? "y" : "x", c: end, a: Math.min(landA0, landA1), b: Math.max(landA0, landA1) },
        foot, landing: landTop, outDir, strip,
      });
    } else {
      const cMid = (C0 + C1) / 2;
      flights.push({ axis, sign, c0: cMid - wf / 2, c1: cMid + wf / 2, s0: startA, n: N, riser: r, tread: T, h0 });
      const end = startA + sign * (N - 1) * T;
      holes.push(mk(axis, startA, end, cMid - wf / 2 - 0.05, cMid + wf / 2 + 0.05));
      // headroom: the hole runs back from the top riser as far as a 6.75 ft clearance needs
      const aa = end + sign * 1.2;
      const outDir: [number, number] = axis === "x" ? [sign, 0] : [0, sign];
      layouts.push({
        stair: s, kind, flights, landings, holes, rect, holeLevel: s.to.id,
        arrival: axis === "x" ? { x: aa, y: cMid } : { x: cMid, y: aa },
        topRiser: { axis: axis === "x" ? "y" : "x", c: end, a: cMid - wf / 2, b: cMid + wf / 2 },
        foot, landing: mk(axis, end, end + sign * STRIP, C0, C1), outDir, strip,
      });
    }
  }
  return layouts;
}

// ── B.3: the stair tower (mumty), its top landing and its door ────────────────────────────────────────────
export function reconcileTower(
  plan: PlanModel,
  lays: StairLayout[],
  env: { x0: number; x1: number; y0: number; y1: number; party: Record<Side, boolean> },
  notes: NoteLog,
): TowerDoor | null {
  const roof = plan.roof;
  const top = plan.levelBelow(roof);
  const lay = lays.find((l) => l.stair.to === roof);
  const planDoorSide = (plan.plan.roof?.mumty?.door_side ?? "front") as Side;
  if (!lay || !top) {
    // no stair reaches the roof: a plan mumty keeps its door on the side the plan gives
    const m = plan.room("roof_mumty");
    if (!m) return null;
    const rr = m.rect;
    const at: [number, number] =
      planDoorSide === "front" ? [rr.x + rr.w / 2, rr.y] : planDoorSide === "back" ? [rr.x + rr.w / 2, rr.y + rr.d] : planDoorSide === "left" ? [rr.x, rr.y + rr.d / 2] : [rr.x + rr.w, rr.y + rr.d / 2];
    return { room: m, at, side: planDoorSide, width: 3 };
  }
  const cx = lay.rect.x + lay.rect.w / 2, cy = lay.rect.y + lay.rect.d / 2;
  let tower =
    plan.rooms.find((r) => r.level === roof.id && r.cat === "enclosed" && !r.synthetic && rectContains(r.rect, cx, cy)) ??
    plan.room("roof_mumty") ??
    null;
  const t2 = EXT_T / 2;
  const core = expandRect(lay.rect, t2);
  if (!tower) {
    tower = {
      id: "roof_mumty", name: "Mumty (stair tower)", type: "stair", level: roof.id, lv: roof, rect: { ...core }, cat: "enclosed",
      open: new Set(), floorFinish: "marble", floorH: 0, ceilH: 0, synthetic: true,
    };
    plan.addRoom(tower);
    notes.add({ id: "asbuilt.mumty_added", title: "Stair tower added", status: "pass", message: "The engine built a stair tower (mumty) over the roof stair and its top landing.", element_ids: [lay.stair.id] });
  }
  const T = tower;
  const last = lay.flights[lay.flights.length - 1];
  const fa = last.axis, fs = last.sign; // the last flight runs along fa in direction fs
  // supported: over the top storey's slab, inside the plot/envelope, not in another roof room, not over a hole
  // (a roof terrace or deck is open roof to walk out onto; only another enclosed roof room is in the way)
  const otherRoof = plan.roomsOn(roof.id).filter((r) => r !== T && r.cat === "enclosed");
  const holesRoof = lays.filter((l) => l.holeLevel === roof.id && l !== lay).flatMap((l) => l.holes);
  const slabAt = (x: number, y: number) => {
    const r = plan.roomAt(top.id, x, y);
    return !!r && (r.cat === "enclosed" || r.cat === "porch");
  };
  const pointOK = (x: number, y: number, margin = 0) =>
    x > -0.01 && y > -0.01 && x < plan.plotW + 0.01 && y < plan.plotD + 0.01 &&
    x >= env.x0 - 1e-3 && x <= env.x1 + 1e-3 && y >= env.y0 - 1e-3 && y <= env.y1 + 1e-3 &&
    slabAt(x, y) && (margin <= 0 || (slabAt(x - margin, y) && slabAt(x + margin, y) && slabAt(x, y - margin) && slabAt(x, y + margin))) &&
    !otherRoof.some((r) => rectContains(r.rect, x, y, -0.05)) && !holesRoof.some((h) => rectContains(h, x, y, -0.05));
  const rectOK = (r: R, margin = 0) => {
    const nx = Math.max(1, Math.ceil(r.w / 0.5)), ny = Math.max(1, Math.ceil(r.d / 0.5));
    for (let i = 0; i <= nx; i++)
      for (let j = 0; j <= ny; j++) {
        const x = r.x + Math.min(r.w - 0.02, Math.max(0.02, (r.w * i) / nx));
        const y = r.y + Math.min(r.d - 0.02, Math.max(0.02, (r.d * j) / ny));
        if (!pointOK(x, y, margin)) return false;
      }
    return true;
  };
  // the top landing wanted: 3 ft (plus the wall) beyond the top riser, in the direction people step off
  const tr = lay.topRiser;
  const zWant =
    fa === "x"
      ? mk("x", tr.c, tr.c + fs * (3.0 + t2), lay.kind === "dogleg" ? lay.rect.y - t2 : tr.a - t2, lay.kind === "dogleg" ? lay.rect.y + lay.rect.d + t2 : tr.b + t2)
      : mk("y", tr.c, tr.c + fs * (3.0 + t2), lay.kind === "dogleg" ? lay.rect.x - t2 : tr.a - t2, lay.kind === "dogleg" ? lay.rect.x + lay.rect.w + t2 : tr.b + t2);
  // grow side by side from the stair core toward the wanted box, while the roof below supports it
  const grow = (M: R, want: R): R => {
    let x0 = M.x, y0 = M.y, x1 = M.x + M.w, y1 = M.y + M.d;
    const tx0 = Math.min(x0, want.x), ty0 = Math.min(y0, want.y), tx1 = Math.max(x1, want.x + want.w), ty1 = Math.max(y1, want.y + want.d);
    const step = 0.25;
    const ext = (cur: number, target: number, dir: -1 | 1, ok: (a: number, b: number) => boolean) => {
      while (dir < 0 ? cur > target + 1e-6 : cur < target - 1e-6) {
        const nxt = dir < 0 ? Math.max(target, cur - step) : Math.min(target, cur + step);
        if (!ok(Math.min(cur, nxt), Math.max(cur, nxt))) break;
        cur = nxt;
      }
      return cur;
    };
    x0 = ext(x0, tx0, -1, (a, b) => rectOK({ x: a, y: y0, w: b - a, d: y1 - y0 }));
    x1 = ext(x1, tx1, 1, (a, b) => rectOK({ x: a, y: y0, w: b - a, d: y1 - y0 }));
    y0 = ext(y0, ty0, -1, (a, b) => rectOK({ x: x0, y: a, w: x1 - x0, d: b - a }));
    y1 = ext(y1, ty1, 1, (a, b) => rectOK({ x: x0, y: a, w: x1 - x0, d: b - a }));
    return { x: x0, y: y0, w: x1 - x0, d: y1 - y0 };
  };
  const base = bbox(T.rect, core);
  let M = grow(base, bbox(base, zWant));

  // candidate walls touching the top landing Z
  type Cand = { side: Side; axis: "x" | "y"; c: number; a: number; b: number; out: -1 | 1; len: number; u: number; open: number };
  const zOf = (m: R) => {
    // Z: from the top riser to the tower's inner face in the step-off direction, across the tower's inner width
    const inLo = (fa === "x" ? m.x : m.y) + t2, inHi = (fa === "x" ? m.x + m.w : m.y + m.d) - t2;
    const zFar = fs > 0 ? inHi : inLo;
    // a dog-leg's other band may be cut back further than the top riser (headroom): Z stops at the nearest hole
    const near0 = fs < 0 ? Math.min(...lay.holes.map((h) => (fa === "x" ? h.x : h.y))) : Math.max(...lay.holes.map((h) => (fa === "x" ? h.x + h.w : h.y + h.d)));
    const zNear2 = lay.kind === "dogleg" ? near0 : tr.c;
    const c0 = (fa === "x" ? m.y : m.x) + t2, c1 = (fa === "x" ? m.y + m.d : m.x + m.w) - t2;
    return { along: [Math.min(zNear2, zFar), Math.max(zNear2, zFar)] as [number, number], across: [c0, c1] as [number, number] };
  };
  const tank = plan.plan.roof?.water_tank?.rect;
  const solar = plan.plan.roof?.solar?.rect;
  const sideOf = (axis: "x" | "y", out: -1 | 1): Side => (axis === "x" ? (out < 0 ? "front" : "back") : out < 0 ? "left" : "right");
  const candidates = (m: R): Cand[] => {
    const z = zOf(m);
    const out: Cand[] = [];
    const W = 3;
    // wall perpendicular to the step-off direction, at the far end of Z
    const endC = fs > 0 ? (fa === "x" ? m.x + m.w : m.y + m.d) : fa === "x" ? m.x : m.y;
    const endAxis: "x" | "y" = fa === "x" ? "y" : "x"; // the wall runs across
    const lines: { axis: "x" | "y"; c: number; a: number; b: number; out: -1 | 1 }[] = [
      { axis: endAxis, c: endC, a: z.across[0], b: z.across[1], out: fs },
      // long walls (parallel to the step-off direction) touch Z along its length
      { axis: fa, c: (fa === "x" ? m.y : m.x), a: z.along[0], b: z.along[1], out: -1 },
      { axis: fa, c: (fa === "x" ? m.y + m.d : m.x + m.w), a: z.along[0], b: z.along[1], out: 1 },
    ];
    for (const l of lines) {
      const len = l.b - l.a;
      if (len < W + 0.6 - 1e-3) continue;
      const side = sideOf(l.axis, l.out);
      // party wall: the tower wall sits on a zero-setback plot edge
      const onPlotEdge = l.axis === "x" ? (l.out < 0 ? l.c < 0.6 : l.c > plan.plotD - 0.6) : l.out < 0 ? l.c < 0.6 : l.c > plan.plotW - 0.6;
      if (onPlotEdge && env.party[side]) continue;
      const u = (l.a + l.b) / 2;
      // outside strip: door + 1 ft wide, 3 ft deep, on open roof slab clear of holes, tank, solar area and parapet band
      const o0 = l.c + l.out * t2, o1 = o0 + l.out * 3;
      const strip = l.axis === "x" ? mk("x", u - (W + 1) / 2, u + (W + 1) / 2, o0, o1) : mk("y", u - (W + 1) / 2, u + (W + 1) / 2, o0, o1);
      // (tested 0.45 ft beyond its outer edge for the parapet band; its ends may touch a wall corner)
      const o2 = o1 + l.out * 0.45;
      const test = l.axis === "x" ? mk("x", u - (W + 1) / 2 + 0.45, u + (W + 1) / 2 - 0.45, o0 + l.out * 0.05, o2) : mk("y", u - (W + 1) / 2 + 0.45, u + (W + 1) / 2 - 0.45, o0 + l.out * 0.05, o2);
      if (!rectOK(test)) continue;
      const hits = (q: R | undefined) => !!q && overlapArea(strip, { x: Number(q.x) || 0, y: Number(q.y) || 0, w: Number(q.w) || 0, d: Number(q.d) || 0 }) > 0.01;
      if (tank && !rectContains(m, Number(tank.x) + Number(tank.w) / 2, Number(tank.y) + Number(tank.d) / 2) && hits(tank)) continue;
      if (hits(solar)) continue;
      // open roof in front (for ties): 6 ft deep band
      const band = l.axis === "x" ? mk("x", l.a - 2, l.b + 2, o0, o0 + l.out * 6) : mk("y", l.a - 2, l.b + 2, o0, o0 + l.out * 6);
      let open = 0;
      for (let i = 0; i < 12; i++) for (let j = 0; j < 6; j++) if (pointOK(band.x + (band.w * (i + 0.5)) / 12, band.y + (band.d * (j + 0.5)) / 6)) open++;
      out.push({ side, axis: l.axis, c: l.c, a: l.a, b: l.b, out: l.out, len, u, open });
    }
    return out;
  };
  const choose = (cs: Cand[]): Cand | null => {
    if (!cs.length) return null;
    const startSide = sideOf(fa === "x" ? "y" : "x", fs);
    return (
      cs.find((c) => c.side === planDoorSide) ??
      cs.find((c) => c.side === startSide) ??
      [...cs].sort((p, q) => q.len - p.len || q.open - p.open)[0]
    );
  };
  let pick = choose(candidates(M));
  if (!pick) {
    // grow 3.5 ft at the step-off end, else along the last flight's outer side
    const endGrow: R = fa === "x" ? (fs > 0 ? { ...M, w: M.w + 3.5 } : { ...M, x: M.x - 3.5, w: M.w + 3.5 }) : fs > 0 ? { ...M, d: M.d + 3.5 } : { ...M, y: M.y - 3.5, d: M.d + 3.5 };
    const M2 = grow(M, endGrow);
    pick = choose(candidates(M2));
    if (pick) M = M2;
    else {
      const mid = (last.c0 + last.c1) / 2, cen = fa === "x" ? M.y + M.d / 2 : M.x + M.w / 2;
      const outSide = mid < cen ? -1 : 1;
      const sideGrow: R = fa === "x" ? (outSide < 0 ? { ...M, y: M.y - 3.5, d: M.d + 3.5 } : { ...M, d: M.d + 3.5 }) : outSide < 0 ? { ...M, x: M.x - 3.5, w: M.w + 3.5 } : { ...M, w: M.w + 3.5 };
      const M3 = grow(M, sideGrow);
      pick = choose(candidates(M3));
      if (pick) M = M3;
    }
  }
  plan.setRoomRect(T, M);
  for (const l of lays) {
    if (l.holeLevel !== roof.id) continue;
    const z = zOf(M);
    l.landing = fa === "x" ? mk("x", z.along[0], z.along[1], z.across[0], z.across[1]) : mk("y", z.along[0], z.along[1], z.across[0], z.across[1]);
  }
  if (!pick) {
    // nothing outside the tower is usable: put the door on the step-off end anyway and report it
    const z = zOf(M);
    const endC = fs > 0 ? (fa === "x" ? M.x + M.w : M.y + M.d) : fa === "x" ? M.x : M.y;
    const endAxis: "x" | "y" = fa === "x" ? "y" : "x";
    const u = (z.across[0] + z.across[1]) / 2;
    // EN2-05: report it only when the 3 ft strip outside that door really is blocked (party wall, tank, roof edge)
    const o0 = endC + fs * t2;
    let clear = true;
    for (let i = 0; i <= 6 && clear; i++)
      for (let j = 1; j <= 6 && clear; j++) {
        const a = u - 1.5 + (3 * i) / 6, c = o0 + (fs * 3 * j) / 6;
        const [x, y] = endAxis === "x" ? [a, c] : [c, a];
        if (!pointOK(x, y)) clear = false;
      }
    const strip = endAxis === "x" ? mk("x", u - 1.5, u + 1.5, o0, o0 + fs * 3) : mk("y", u - 1.5, u + 1.5, o0, o0 + fs * 3);
    const onTank = !!tank && overlapArea(strip, { x: Number(tank.x) || 0, y: Number(tank.y) || 0, w: Number(tank.w) || 0, d: Number(tank.d) || 0 }) > 0.01;
    if (!clear || onTank)
      notes.add({ id: "asbuilt.roof_door", title: "Roof door has no clear roof outside", status: "fail", message: "The roof door opens toward a party wall, the tank or the roof edge: no wall at the top landing faces clear roof.", element_ids: [T.id] });
    warn("stair tower: no candidate wall for the roof door at the top landing; door at the step-off end");
    return { room: T, at: endAxis === "x" ? [u, endC] : [endC, u], side: sideOf(endAxis, fs), width: 3 };
  }
  const W = 3;
  const u = clamp(pick.u, pick.a + 0.3 + W / 2, pick.b - 0.3 - W / 2);
  if (pick.side !== planDoorSide)
    notes.add({
      id: "asbuilt.roof_door_moved",
      title: "Roof door moved to the top landing",
      status: "warn",
      message: `The roof door was built on the stair tower's ${pick.side} side, at the top landing, not on its ${planDoorSide} side as drawn.`,
      element_ids: [T.id],
    });
  return { room: T, at: pick.axis === "x" ? [u, pick.c] : [pick.c, u], side: pick.side, width: W };
}

/** True when two numbers are within a millimetre (exported for tests). */
export const _near = near;
