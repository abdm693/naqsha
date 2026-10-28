/**
 * B.4 furniture keep-out zones (plan ft), computed once per room after the structure exists:
 *  - doors: (width + 1 ft) × max(3 ft, leaf + 0.5 ft) on the swing side, × 3 ft on the other side (sliding doors
 *    and arches: 3 ft both sides);
 *  - open-plan edges: a 3.5 ft gate, 3 ft deep on both sides, where people actually cross;
 *  - stairs: the laid-out stair + 0.5 ft, its foot landing, its top landing and 1 ft around the stairwell;
 *  - the roof door's outside landing, the water tank and the solar area on the roof;
 *  - windows: a 2 ft band in front of each window, for items taller than its sill;
 *  - wall items: every door or window on the wall ± 0.3 ft (see solidIntervals).
 */
import type { Side } from "@contracts/house-sdk";
import type { BuildCtx } from "../core/ctx";
import { expandRect, type R } from "../core/grid";
import type { RoomM } from "../plan/model";
import { innerRect } from "../interior";
import { subtract, type Span } from "../structure/cover";
import type { PlacedOpening } from "../structure/model";

export interface Zone {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  kind: "door" | "gate" | "stair" | "roof_door" | "tank" | "solar" | "window" | "walkway" | "bay";
  /** windows: sill height above the room floor (the zone applies to items that rise 0.5 ft above the sill) */
  sill?: number;
  /** windows: the opening type ("window", "ventilator", ...) and its width (ft) */
  op?: string;
  width?: number;
  /** the part that may never be touched, used when the full clearance leaves no room (the door leaf's sweep and
   *  2 ft in front of every doorway, the stair itself, its landings and 0.5 ft around the stairwell) */
  core?: { x0: number; x1: number; y0: number; y1: number };
  id?: string;
}

const SIDES: Side[] = ["front", "back", "left", "right"];
const fromR = (r: R, kind: Zone["kind"], id?: string): Zone => ({ x0: r.x, x1: r.x + r.w, y0: r.y, y1: r.y + r.d, kind, id });
const hits = (z: { x0: number; x1: number; y0: number; y1: number }, r: RoomM, m = 0) => z.x0 < r.rect.x + r.rect.w + m && z.x1 > r.rect.x - m && z.y0 < r.rect.y + r.rect.d + m && z.y1 > r.rect.y - m;

const cache = new WeakMap<BuildCtx, Map<string, Zone[]>>();

export function keepOut(ctx: BuildCtx, room: RoomM): Zone[] {
  let m = cache.get(ctx);
  if (!m) cache.set(ctx, (m = new Map()));
  let z = m.get(room.id);
  if (!z) m.set(room.id, (z = computeZones(ctx, room)));
  return z;
}

function computeZones(ctx: BuildCtx, room: RoomM): Zone[] {
  const out: Zone[] = [];
  const model = ctx.model;
  const plan = ctx.plan;
  // doors and windows on this room's walls
  for (const o of model.openingsOfRoom(room)) {
    const run = o.run;
    const into = o.neg === room ? -1 : 1;
    const c0 = run.c + (into * run.t) / 2;
    const w = o.u1 - o.u0;
    if (o.isDoor) {
      const hinged = o.op.type !== "sliding_door" && o.op.type !== "arch";
      const leaf = o.op.type === "double_door" ? w / 2 : w;
      const swing = hinged && o.swingSide === into;
      const depth = swing ? Math.max(3.0, leaf + 0.5) : 3.0;
      const box = (a: number, b: number, dep: number) => {
        const c1 = c0 + into * dep;
        return run.axis === "x" ? { x0: a, x1: b, y0: Math.min(c0, c1), y1: Math.max(c0, c1) } : { x0: Math.min(c0, c1), x1: Math.max(c0, c1), y0: a, y1: b };
      };
      // EN-02: the part never touched is the full clear zone (opening width × 3 ft on this side) plus the leaf's sweep
      const core = swing ? box(o.u0 - 0.15, o.u1 + 0.15, Math.max(3.0, leaf + 0.15)) : box(o.u0, o.u1, 3.0);
      out.push({ ...box(o.u0 - 0.5, o.u1 + 0.5, depth), kind: "door", id: o.op.id, core });
    } else {
      const c1 = c0 + into * 2.0;
      const a = o.u0 - 0.3, b = o.u1 + 0.3;
      const sill = o.bottom - room.floorH;
      const meta = { kind: "window" as const, sill, id: o.op.id, op: o.op.type, width: o.u1 - o.u0 };
      out.push(run.axis === "x" ? { x0: a, x1: b, y0: Math.min(c0, c1), y1: Math.max(c0, c1), ...meta } : { x0: Math.min(c0, c1), x1: Math.max(c0, c1), y0: a, y1: b, ...meta });
    }
  }
  // open-plan gates
  for (const oid of room.open) {
    const other = plan.room(oid);
    if (!other || other.level !== room.level) continue;
    const e = sharedEdge(room.rect, other.rect);
    if (!e) continue;
    let mid = (e.a + e.b) / 2;
    // a stair landing that reaches this edge sets where people cross
    for (const lay of model.stairs) {
      for (const L of [lay.stair.from.id === room.level ? lay.foot : null, lay.holeLevel === room.level ? lay.landing : null]) {
        if (!L) continue;
        const lo = e.axis === "x" ? L.x : L.y, hi = e.axis === "x" ? L.x + L.w : L.y + L.d;
        const cl = e.axis === "x" ? L.y : L.x, ch = e.axis === "x" ? L.y + L.d : L.x + L.w;
        if (hi > e.a && lo < e.b && cl < e.c + 6 && ch > e.c - 6) mid = Math.min(Math.max((lo + hi) / 2, e.a + 1.75), e.b - 1.75);
      }
    }
    const a = Math.max(e.a, mid - 1.75), b = Math.min(e.b, mid + 1.75);
    const a2 = Math.max(e.a, mid - 1.5), b2 = Math.min(e.b, mid + 1.5);
    const core = e.axis === "x" ? { x0: a2, x1: b2, y0: e.c - 2, y1: e.c + 2 } : { x0: e.c - 2, x1: e.c + 2, y0: a2, y1: b2 };
    out.push(e.axis === "x" ? { x0: a, x1: b, y0: e.c - 3, y1: e.c + 3, kind: "gate", id: oid, core } : { x0: e.c - 3, x1: e.c + 3, y0: a, y1: b, kind: "gate", id: oid, core });
  }
  // stairs
  for (const lay of model.stairs) {
    if (lay.stair.from.id === room.level) {
      const z = fromR(expandRect(lay.rect, 0.5), "stair", lay.stair.id);
      const r2 = expandRect(lay.rect, 0.15);
      z.core = { x0: r2.x, x1: r2.x + r2.w, y0: r2.y, y1: r2.y + r2.d };
      if (hits(z, room)) out.push(z);
      const f = fromR(expandRect(lay.foot, 0.25), "stair", lay.stair.id);
      if (hits(f, room)) out.push(f);
    }
    if (lay.holeLevel === room.level) {
      for (const h of lay.holes) {
        const z = fromR(expandRect(h, 1.0), "stair", lay.stair.id);
        const r2 = expandRect(h, 0.5);
        z.core = { x0: r2.x, x1: r2.x + r2.w, y0: r2.y, y1: r2.y + r2.d };
        if (hits(z, room)) out.push(z);
      }
      const l = fromR(lay.landing, "stair", lay.stair.id);
      if (hits(l, room)) out.push(l);
    }
  }
  // roof: the tower door's outside landing, the water tank, the solar area
  if (room.lv.isRoof) {
    const tw = model.tower;
    const door = tw ? model.openings.find((o) => o.op.level === tw.room.level && o.isDoor && (o.neg === tw.room || o.pos === tw.room)) : null;
    if (door) {
      const run = door.run;
      const out1 = door.neg === tw!.room ? 1 : -1;
      const c0 = run.c + (out1 * run.t) / 2, c1 = c0 + out1 * 3.5;
      const z: Zone = run.axis === "x" ? { x0: door.u0 - 0.5, x1: door.u1 + 0.5, y0: Math.min(c0, c1), y1: Math.max(c0, c1), kind: "roof_door" } : { x0: Math.min(c0, c1), x1: Math.max(c0, c1), y0: door.u0 - 0.5, y1: door.u1 + 0.5, kind: "roof_door" };
      if (hits(z, room)) out.push(z);
    }
    const t = plan.plan.roof?.water_tank?.rect;
    if (t) {
      const z = fromR(expandRect({ x: Number(t.x) || 0, y: Number(t.y) || 0, w: Number(t.w) || 0, d: Number(t.d) || 0 }, 1), "tank");
      if (hits(z, room)) out.push(z);
    }
    const sol = solarRect(ctx);
    if (sol) {
      const z = fromR(sol, "solar");
      if (hits(z, room)) out.push(z);
    }
  }
  return out;
}

type Box4 = { x0: number; x1: number; y0: number; y1: number };

/** EN2-02: pieces that adapt to a window behind them (counters cut their wall cabinets, baths sit under ventilators) */
export const WINDOW_EXEMPT = new Set<string>(["kitchen_counter", "vanity", "shower", "wc", "bathtub", "sink_kitchen", "washing_machine", "curtains"]);
/** habitable rooms (LDA: rooms for living and sleeping): a tall piece never stands across their window as a last
 *  resort; a kitchen (its fridge), dressing, store or bath may still lose one */
export const HABITABLE = new Set<string>(["master_bedroom", "bedroom", "guest_bedroom", "servant", "lounge", "drawing", "dining", "study", "prayer"]);
/** The height (ft above the room floor) a piece blocks a window at: a TV unit counts with its TV. */
export const blockHeight = (type: string, h: number): number => (type === "tv_unit" ? 5.6 : h);
/** A tall piece (a wardrobe, a bookshelf, a fridge, a TV unit with its TV, a floor plant): never across a habitable
 *  room's only window. Lower pieces (a bed's headboard, a dresser, a sofa) may still sit under one as a last resort. */
export const TALL_H = 4.5;
export const isTall = (type: string, h: number): boolean => !WINDOW_EXEMPT.has(type) && blockHeight(type, h) >= TALL_H;
/** Does a piece of this type and height stand in a window's way when it is in front of it? */
export function blocksWindow(type: string, h: number, z: Zone): boolean {
  return z.kind === "window" && !WINDOW_EXEMPT.has(type) && blockHeight(type, h) > (z.sill ?? 3) + 0.5;
}
/**
 * The windows of a room a tall piece may still stand in front of as a last resort: in a room people live in, only
 * ventilators and the smallest window when there are two or more; elsewhere (a dressing, a store) any window but the
 * room's only one (EN-F5: a dressing room's one window is never walled up by its wardrobe). A kitchen's fridge, which
 * the kitchen cannot do without, may still stand in front of its window when there is no other place.
 */
export function onlyWindowKept(room: RoomM, type: string): boolean {
  return room.cat === "enclosed" && !HABITABLE.has(room.type) && type !== "fridge";
}
export function spareWindows(ctx: BuildCtx, room: RoomM, type = ""): Set<string> | "all" {
  const ws = keepOut(ctx, room).filter((z) => z.kind === "window");
  const out = new Set<string>(ws.filter((z) => z.op === "ventilator").map((z) => z.id ?? ""));
  const real = ws.filter((z) => z.op !== "ventilator").sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  if (!HABITABLE.has(room.type)) return real.length >= 2 || !onlyWindowKept(room, type) ? "all" : out;
  if (real.length >= 2 && real[0].id) out.add(real[0].id);
  return out;
}

/**
 * EN-02: the clear zone a door, arch or sliding door keeps on one side (`into` = -1 the run's neg side, +1 its pos
 * side): the opening's width × 3 ft from the wall face, and, on the side a hinged leaf swings into, the quarter
 * circles the leaves sweep (centre at the hinge, radius the leaf). Nothing may stand in it.
 */
export function doorClearance(o: PlacedOpening, into: -1 | 1): { rect: Box4; discs: { cx: number; cy: number; r: number; quad: Box4 }[] } {
  const run = o.run;
  const c0 = run.c + (into * run.t) / 2;
  const toBox = (a: number, b: number, p: number, q: number): Box4 => (run.axis === "x" ? { x0: Math.min(a, b), x1: Math.max(a, b), y0: Math.min(p, q), y1: Math.max(p, q) } : { x0: Math.min(p, q), x1: Math.max(p, q), y0: Math.min(a, b), y1: Math.max(a, b) });
  const rect = toBox(o.u0, o.u1, c0, c0 + into * 3);
  const discs: { cx: number; cy: number; r: number; quad: Box4 }[] = [];
  const hinged = o.op.type !== "sliding_door" && o.op.type !== "arch" && o.op.type !== "garage_door";
  if (hinged && o.swingSide === into) {
    const w = o.u1 - o.u0;
    const hinges: [number, number][] = o.op.type === "double_door" ? [[o.u0, 1], [o.u1, -1]] : o.hingeAtA ? [[o.u0, 1]] : [[o.u1, -1]];
    const r = o.op.type === "double_door" ? w / 2 : w;
    for (const [u, dir] of hinges) {
      const [cx, cy] = run.axis === "x" ? [u, c0] : [c0, u];
      discs.push({ cx, cy, r, quad: toBox(u, u + dir * r, c0, c0 + into * r) });
    }
  }
  return { rect, discs };
}

/** Does a footprint intrude into a door's clear zone (by more than `tol` ft)? */
export function intrudes(f: Box4, z: ReturnType<typeof doorClearance>, tol = 0.05): boolean {
  const ov = (a: Box4, b: Box4) => a.x0 < b.x1 - tol && b.x0 < a.x1 - tol && a.y0 < b.y1 - tol && b.y0 < a.y1 - tol;
  if (ov(f, z.rect)) return true;
  for (const d of z.discs) {
    if (!ov(f, d.quad)) continue;
    // nearest point of the footprint (clipped to the quadrant) to the hinge
    const x0 = Math.max(f.x0, d.quad.x0), x1 = Math.min(f.x1, d.quad.x1), y0 = Math.max(f.y0, d.quad.y0), y1 = Math.min(f.y1, d.quad.y1);
    const nx = Math.min(Math.max(d.cx, x0), x1), ny = Math.min(Math.max(d.cy, y0), y1);
    if (Math.hypot(nx - d.cx, ny - d.cy) < d.r - tol) return true;
  }
  return false;
}

export function sharedEdge(a: R, b: R): { axis: "x" | "y"; c: number; a: number; b: number } | null {
  const tol = 0.05;
  const ox0 = Math.max(a.x, b.x), ox1 = Math.min(a.x + a.w, b.x + b.w);
  const oy0 = Math.max(a.y, b.y), oy1 = Math.min(a.y + a.d, b.y + b.d);
  if (ox1 - ox0 > 0.5 && (Math.abs(a.y + a.d - b.y) < tol || Math.abs(b.y + b.d - a.y) < tol)) return { axis: "x", c: Math.abs(a.y + a.d - b.y) < tol ? b.y : a.y, a: ox0, b: ox1 };
  if (oy1 - oy0 > 0.5 && (Math.abs(a.x + a.w - b.x) < tol || Math.abs(b.x + b.w - a.x) < tol)) return { axis: "y", c: Math.abs(a.x + a.w - b.x) < tol ? b.x : a.x, a: oy0, b: oy1 };
  return null;
}

/** The roof area kept clear for solar panels (plan.roof.solar.rect, or the engine's own pick), or null. */
export function solarRect(ctx: BuildCtx): R | null {
  const s = ctx.plan.plan.roof?.solar;
  if (!s) return null;
  const r = s.rect;
  if (r && [r.x, r.y, r.w, r.d].every((v) => Number.isFinite(Number(v))) && Number(r.w) > 1 && Number(r.d) > 1) return { x: Number(r.x), y: Number(r.y), w: Number(r.w), d: Number(r.d) };
  return (ctx as unknown as { solarAuto?: R | null }).solarAuto ?? null;
}

/**
 * Solid intervals of a room's wall on one side, in plan coordinates along the wall: wall runs minus every door
 * and window ± 0.3 ft, minus open-plan stretches, inside the room's inner extent. Wall items go only here.
 */
export function solidIntervals(ctx: BuildCtx, room: RoomM, side: Side): Span[] {
  const inner = innerRect(ctx, room);
  const axis = side === "front" || side === "back" ? "x" : "y";
  const lo = axis === "x" ? inner.x0 : inner.y0, hi = axis === "x" ? inner.x1 : inner.y1;
  const spans: Span[] = [];
  const cuts: Span[] = [];
  for (const w of ctx.model.roomWalls(room, side)) {
    const a = Math.max(lo, w.a), b = Math.min(hi, w.b);
    if (b - a > 0.05) spans.push([a, b]);
    for (const o of w.run.openings) cuts.push([o.u0 - 0.3, o.u1 + 0.3]);
  }
  // wall runs that meet end to end (at a T junction) are one continuous face on this side
  spans.sort((p, q) => p[0] - q[0]);
  const merged: Span[] = [];
  for (const sp of spans) {
    const last = merged[merged.length - 1];
    if (last && sp[0] <= last[1] + 0.06) last[1] = Math.max(last[1], sp[1]);
    else merged.push([sp[0], sp[1]]);
  }
  return subtract(merged, cuts, 0.3);
}

export { SIDES };
