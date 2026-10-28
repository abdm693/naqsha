/**
 * EN-F1: the open ground around the house as people walk it (plan ft, ground level).
 *  - the 3 ft kept clear outside every exterior door, sliding door, arch and gate (the opening's width plus 1 ft each
 *    side), on the outdoor side of a door and on both sides of a gate;
 *  - the passages: outdoor rooms narrower than 8 ft (side and rear spaces), where planting must leave a 3 ft clear
 *    walking width between 0 and 7 ft above the ground;
 *  - a 3 ft route grid from the gates, which every exterior door and every outdoor room must be reached by.
 * Used by the landscape (where trees, planters and hedges may stand) and by the harness's "Outdoor reach" check.
 */
import * as THREE from "three";
import type { BuildCtx, PlacedItem } from "./core/ctx";
import { humanType } from "./core/notes";
import { clamp, FT, num, warn } from "./core/util";
import { carWays, onWalkwayRect, parking } from "./furniture/parking";
import { keepOut } from "./furniture/zones";
import { roomPhrase } from "./structure/labels";
import { DOOR_TYPES, type RoomM } from "./plan/model";
import { EXT_T, PLINTH_PROUD } from "./structure/model";

export interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface DoorZone {
  id: string;
  kind: "door" | "gate";
  /** nothing planted in it: the opening's width plus 1 ft each side, 3 ft out from the wall face */
  box: Box;
  /** the opening's own width × 3 ft: reaching any of it reaches the door */
  approach: Box;
  /** the axis the opening's wall runs along, and the opening's span on it */
  axis: "x" | "y";
  a: number;
  b: number;
}

export interface Passage {
  room: RoomM;
  /** the direction the passage runs (its long side) */
  axis: "x" | "y";
}

export interface OutdoorModel {
  zones: DoorZone[];
  passages: Passage[];
  /** obstacles at walking height that never move: the house with its walls and plinth, the boundary wall, gate
   *  pillars, facade members lower than 7 ft */
  fixed: Box[];
  /** the gates' openings in the front boundary wall */
  gates: { id: string; x0: number; x1: number }[];
  /** outdoor rooms on the ground (lawns, driveways, open spaces, courtyards) */
  outdoor: RoomM[];
}

const PASSAGE_W = 8;
export const CLEAR_W = 3;
export const CLEAR_H = 7;
const cache = new WeakMap<BuildCtx, OutdoorModel>();

export const overlaps = (a: Box, b: Box, t = 0.02): boolean => a.x0 < b.x1 - t && b.x0 < a.x1 - t && a.y0 < b.y1 - t && b.y0 < a.y1 - t;
export const inBox = (b: Box, x: number, y: number, t = 0): boolean => x >= b.x0 - t && x <= b.x1 + t && y >= b.y0 - t && y <= b.y1 + t;
const rectBox = (r: { x: number; y: number; w: number; d: number }, e = 0): Box => ({ x0: r.x - e, x1: r.x + r.w + e, y0: r.y - e, y1: r.y + r.d + e });

/** The gates as the site builds them (site-geo): clamped into the front boundary, never overlapping. */
export function siteGates(ctx: BuildCtx): { id: string; x0: number; x1: number }[] {
  const W = ctx.plan.plotW;
  const gates = (ctx.plan.plan.site?.gates ?? [])
    .filter((gt) => gt && Array.isArray(gt.at))
    .map((gt) => {
      const w = num(gt.width_ft, gt.kind === "pedestrian" ? 4 : 12, 2.5, 30);
      const x = clamp(num(gt.at[0], W / 2), w / 2 + 0.6, W - w / 2 - 0.6);
      return { id: gt.id ?? "gate", x0: x - w / 2, x1: x + w / 2 };
    })
    .sort((a, b) => a.x0 - b.x0);
  for (let k = 1; k < gates.length; k++) if (gates[k].x0 < gates[k - 1].x1 + 1.3) gates[k].x0 = gates[k - 1].x1 + 1.3;
  return gates;
}

export function outdoorModel(ctx: BuildCtx): OutdoorModel {
  let m = cache.get(ctx);
  if (m) return m;
  const plan = ctx.plan;
  const g = plan.levels[0];
  const W = plan.plotW, D = plan.plotD;
  const zones: DoorZone[] = [];
  for (const o of ctx.model.openings) {
    if (!o.isDoor || o.op.level !== g.id || !DOOR_TYPES.includes(o.op.type)) continue;
    const run = o.run;
    for (const into of [-1, 1] as const) {
      const r = into < 0 ? o.neg : o.pos;
      if (r ? r.cat === "enclosed" : run.out !== into) continue;
      const face = run.c + (into * run.t) / 2, far = face + into * CLEAR_W;
      const [c0, c1] = [Math.min(face, far), Math.max(face, far)];
      const mk = (a: number, b: number): Box => (run.axis === "x" ? { x0: a, x1: b, y0: c0, y1: c1 } : { x0: c0, x1: c1, y0: a, y1: b });
      zones.push({ id: o.op.id, kind: "door", box: mk(o.u0 - 1, o.u1 + 1), approach: mk(o.u0, o.u1), axis: run.axis, a: o.u0, b: o.u1 });
    }
  }
  const gates = siteGates(ctx);
  for (const gt of gates)
    zones.push({ id: gt.id, kind: "gate", box: { x0: gt.x0 - 1, x1: gt.x1 + 1, y0: -CLEAR_W, y1: CLEAR_W }, approach: { x0: gt.x0, x1: gt.x1, y0: 0, y1: CLEAR_W }, axis: "x", a: gt.x0, b: gt.x1 });
  const ground = plan.roomsOn(g.id);
  const outdoor = ground.filter((r) => r.cat === "outdoor" && !r.void);
  const passages: Passage[] = outdoor.filter((r) => Math.min(r.rect.w, r.rect.d) < PASSAGE_W).map((room) => ({ room, axis: room.rect.w < room.rect.d ? "y" : "x" }));
  const fixed: Box[] = [];
  // the house: its walls (half an exterior wall outside the room edge) and the plinth's lip
  for (const r of ground) if (r.cat === "enclosed") fixed.push(rectBox(r.rect, EXT_T / 2 + PLINTH_PROUD));
  // the boundary wall (half of it inside the plot), open at the gates; the gate pillars
  const B = 0.375;
  fixed.push({ x0: -1, x1: B, y0: -1, y1: D + 1 }, { x0: W - B, x1: W + 1, y0: -1, y1: D + 1 }, { x0: -1, x1: W + 1, y0: D - B, y1: D + 1 });
  let fx = -1;
  for (const gt of gates) {
    if (gt.x0 > fx) fixed.push({ x0: fx, x1: gt.x0, y0: -1, y1: B });
    fx = Math.max(fx, gt.x1);
    for (const px of [gt.x0 - 0.65, gt.x1 + 0.65]) fixed.push({ x0: px - 0.65, x1: px + 0.65, y0: -0.65, y1: 0.65 });
  }
  if (fx < W + 1) fixed.push({ x0: fx, x1: W + 1, y0: -1, y1: B });
  // facade members out in the open lower than 7 ft (frames, fins, posts standing on the ground)
  for (const b of ctx.facadeBlocks) if (b.h0 < plan.grade + CLEAR_H && b.h1 > plan.grade + 0.3) fixed.push({ x0: b.x0, x1: b.x1, y0: b.y0, y1: b.y1 });
  m = { zones, passages, fixed, gates, outdoor };
  cache.set(ctx, m);
  return m;
}

/** Floor furniture standing out on the ground (in outdoor rooms and porches), cars and motorbikes left out. */
export function outdoorItems(ctx: BuildCtx): Box[] {
  const g = ctx.plan.levels[0].id;
  return ctx.items
    .filter((it) => it.cls === "floor" && !/^(car_|motorbike)/.test(it.type) && it.h1 - it.h0 > 0.3)
    .filter((it) => {
      const r = ctx.plan.room(it.room);
      return !!r && r.level === g && r.cat !== "enclosed";
    })
    .map(itemBox);
}

const _bb = new THREE.Box3();
/** What a piece takes up as built (a plant's leaves reach past its pot): the plan box the walkthrough treats as solid. */
export function itemBox(it: PlacedItem): Box {
  it.group.updateMatrixWorld(true);
  _bb.setFromObject(it.group);
  if (_bb.isEmpty()) return { x0: it.x0, x1: it.x1, y0: it.y0, y1: it.y1 };
  return { x0: Math.min(it.x0, _bb.min.x / FT), x1: Math.max(it.x1, _bb.max.x / FT), y0: Math.min(it.y0, -_bb.max.z / FT), y1: Math.max(it.y1, -_bb.min.z / FT) };
}

/**
 * The widest clear walking width (ft) across a passage at `u` along it, between its walls and everything standing in
 * it (`solids`), measured inside the passage's own rect.
 */
export function clearAcross(om: OutdoorModel, p: Passage, u: number, solids: Box[]): number {
  const r = p.room.rect;
  const [c0, c1] = p.axis === "y" ? [r.x, r.x + r.w] : [r.y, r.y + r.d];
  const cuts: [number, number][] = [];
  for (const b of [...om.fixed, ...solids]) {
    const [a0, a1, b0, b1] = p.axis === "y" ? [b.y0, b.y1, b.x0, b.x1] : [b.x0, b.x1, b.y0, b.y1];
    if (u <= a0 || u >= a1 || b1 <= c0 || b0 >= c1) continue;
    cuts.push([Math.max(c0, b0), Math.min(c1, b1)]);
  }
  cuts.sort((a, b) => a[0] - b[0]);
  let best = 0, at = c0;
  for (const [a, b] of cuts) {
    if (a > at) best = Math.max(best, a - at);
    at = Math.max(at, b);
  }
  return Math.max(best, c1 - at);
}

/** The free interval across a passage at `u` (the widest one) between its walls and the solids: [lo, hi]. */
export function freeAcross(om: OutdoorModel, p: Passage, u: number, solids: Box[]): [number, number] {
  const r = p.room.rect;
  const [c0, c1] = p.axis === "y" ? [r.x, r.x + r.w] : [r.y, r.y + r.d];
  const cuts: [number, number][] = [];
  for (const b of [...om.fixed, ...solids]) {
    const [a0, a1, b0, b1] = p.axis === "y" ? [b.y0, b.y1, b.x0, b.x1] : [b.x0, b.x1, b.y0, b.y1];
    if (u <= a0 || u >= a1 || b1 <= c0 || b0 >= c1) continue;
    cuts.push([Math.max(c0, b0), Math.min(c1, b1)]);
  }
  cuts.sort((a, b) => a[0] - b[0]);
  let best: [number, number] = [c0, c0], at = c0;
  for (const [a, b] of cuts) {
    if (a - at > best[1] - best[0]) best = [at, a];
    at = Math.max(at, b);
  }
  if (c1 - at > best[1] - best[0]) best = [at, c1];
  return best;
}

/** Does a footprint leave every passage it stands in at least 3 ft clear (the others standing there included)? */
export function passagesClear(om: OutdoorModel, f: Box, solids: Box[]): boolean {
  for (const p of om.passages) {
    if (!overlaps(f, rectBox(p.room.rect), 0.01)) continue;
    const r = p.room.rect;
    const [lo, hi] = p.axis === "y" ? [Math.max(f.y0, r.y), Math.min(f.y1, r.y + r.d)] : [Math.max(f.x0, r.x), Math.min(f.x1, r.x + r.w)];
    const all = [...solids, f];
    for (let u = lo + 0.05; u <= hi - 0.05 + 1e-6; u += 0.25) if (clearAcross(om, p, u, all) < CLEAR_W - 0.01) return false;
    if (hi - lo > 0.1 && clearAcross(om, p, hi - 0.05, all) < CLEAR_W - 0.01) return false;
  }
  return true;
}

// ── the 3 ft route from the gates ─────────────────────────────────────────────────────────────────────────
const CELL = 0.2;
/** a cell (its centre) is on a 3 ft route when no obstacle is within 1.5 ft of it, less half a cell: any gap of 3 ft
 *  or more always has a cell centre that far from both sides */
const HALF = CLEAR_W / 2 - CELL / 2;

export interface Reach {
  /** door and gate ids reached / not reached (only doors the bare plan reaches count as missed) */
  doors: { id: string; reached: boolean; bare: boolean }[];
  rooms: { room: RoomM; reached: boolean; bare: boolean }[];
  /** the gates a route starts from */
  starts: number;
}

interface Grid {
  nx: number;
  ny: number;
  route: Uint8Array;
}

/** min-stamp each box's distance into a clearance grid (only cells within HALF of a box change) */
function stamp(clear: Float32Array, nx: number, ny: number, boxes: Box[]): void {
  for (const b of boxes) {
    const i0 = Math.max(0, Math.floor((b.x0 - HALF) / CELL)), i1 = Math.min(nx - 1, Math.ceil((b.x1 + HALF) / CELL));
    const j0 = Math.max(0, Math.floor((b.y0 - HALF) / CELL)), j1 = Math.min(ny - 1, Math.ceil((b.y1 + HALF) / CELL));
    for (let j = j0; j <= j1; j++) {
      const y = (j + 0.5) * CELL;
      const dy = y < b.y0 ? b.y0 - y : y > b.y1 ? y - b.y1 : 0;
      for (let i = i0; i <= i1; i++) {
        const x = (i + 0.5) * CELL;
        const dx = x < b.x0 ? b.x0 - x : x > b.x1 ? x - b.x1 : 0;
        const d = dx && dy ? Math.hypot(dx, dy) : dx + dy;
        const k = j * nx + i;
        if (d < clear[k]) clear[k] = d;
      }
    }
  }
}

/** the clearance grid of the walls and `solids`, kept for the last set asked (the landscape asks the same set for
 *  every candidate spot of one item) */
const clearCache = new WeakMap<BuildCtx, { sig: string; clear: Float32Array }>();
function routeGrid(ctx: BuildCtx, om: OutdoorModel, solids: Box[], extra?: Box): Grid {
  const W = ctx.plan.plotW, D = ctx.plan.plotD;
  const nx = Math.ceil(W / CELL), ny = Math.ceil(D / CELL);
  // the clearance of each cell centre: its distance to the nearest obstacle box (only within HALF of one matters)
  const sig = solids.map((b) => `${b.x0.toFixed(2)},${b.x1.toFixed(2)},${b.y0.toFixed(2)},${b.y1.toFixed(2)}`).join(";");
  let hit = clearCache.get(ctx);
  if (!hit || hit.sig !== sig) {
    const clear = new Float32Array(nx * ny).fill(HALF + 1);
    stamp(clear, nx, ny, [...om.fixed, ...solids]);
    clearCache.set(ctx, (hit = { sig, clear }));
  }
  let clear = hit.clear;
  if (extra) {
    clear = clear.slice();
    stamp(clear, nx, ny, [extra]);
  }
  const route = new Uint8Array(nx * ny);
  for (let k = 0; k < route.length; k++) route[k] = clear[k] >= HALF ? 1 : 0;
  return { nx, ny, route };
}

function flood(om: OutdoorModel, g: Grid): { seen: Uint8Array; starts: number } {
  const { nx, ny, route } = g;
  const seen = new Uint8Array(nx * ny);
  const q = new Int32Array(nx * ny);
  let h = 0, t = 0, starts = 0;
  for (const gt of om.gates) {
    let any = false;
    for (let j = 0; j * CELL < CLEAR_W + 0.5 && j < ny; j++)
      for (let i = Math.max(0, Math.floor(gt.x0 / CELL)); i * CELL < gt.x1 && i < nx; i++) {
        const k = j * nx + i;
        if (!route[k] || seen[k]) continue;
        seen[k] = 1;
        q[t++] = k;
        any = true;
      }
    if (any) starts++;
  }
  while (h < t) {
    const cur = q[h++];
    const ci = cur % nx, cj = (cur - ci) / nx;
    for (let dj = -1; dj <= 1; dj++)
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const i = ci + di, j = cj + dj;
        if (i < 0 || j < 0 || i >= nx || j >= ny) continue;
        const k = j * nx + i;
        if (seen[k] || !route[k]) continue;
        if (di && dj && (!route[cj * nx + i] || !route[j * nx + ci])) continue;
        seen[k] = 1;
        q[t++] = k;
      }
  }
  return { seen, starts };
}

const anyIn = (g: Grid, seen: Uint8Array, b: Box): boolean => {
  const i0 = Math.max(0, Math.floor(b.x0 / CELL)), i1 = Math.min(g.nx - 1, Math.floor(b.x1 / CELL));
  const j0 = Math.max(0, Math.floor(b.y0 / CELL)), j1 = Math.min(g.ny - 1, Math.floor(b.y1 / CELL));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (seen[j * g.nx + i]) return true;
  return false;
};

/**
 * Which exterior doors and outdoor rooms a 3 ft route from the gates reaches, with `solids` standing on the ground
 * (trees, planters, hedges, outdoor furniture), and on the bare site (walls only: what the plan itself allows).
 */
export function outdoorReach(ctx: BuildCtx, solids: Box[]): Reach {
  const om = outdoorModel(ctx);
  const bare = routeGrid(ctx, om, []);
  const full = routeGrid(ctx, om, solids);
  const fb = flood(om, bare), ff = flood(om, full);
  const doors = om.zones.filter((z) => z.kind === "door").map((z) => ({ id: z.id, reached: anyIn(full, ff.seen, z.approach), bare: anyIn(bare, fb.seen, z.approach) }));
  const rooms = om.outdoor.map((room) => ({ room, reached: anyIn(full, ff.seen, rectBox(room.rect, -0.2)), bare: anyIn(bare, fb.seen, rectBox(room.rect, -0.2)) }));
  return { doors, rooms, starts: ff.starts };
}

/** What a 3 ft route from the gates reaches with `solids` on the ground: [doors reached, outdoor rooms reached]. */
export function reachedWith(ctx: BuildCtx, solids: Box[], extra?: Box): { doors: boolean[]; rooms: boolean[] } {
  const om = outdoorModel(ctx);
  const g = routeGrid(ctx, om, solids, extra);
  const f = flood(om, g);
  return { doors: om.zones.filter((z) => z.kind === "door").map((z) => anyIn(g, f.seen, z.approach)), rooms: om.outdoor.map((room) => anyIn(g, f.seen, rectBox(room.rect, -0.2))) };
}

/** Does adding `f` cut the route from the gates to a door or outdoor room that `before` (the same solids without it)
 *  reaches? */
export function keepsReach(ctx: BuildCtx, solids: Box[], f: Box, before: { doors: boolean[]; rooms: boolean[] }): boolean {
  const after = reachedWith(ctx, solids, f);
  return after.doors.every((d, k) => d || !before.doors[k]) && after.rooms.every((r, k) => r || !before.rooms[k]);
}

/**
 * EN-F1, at the end of the build: outdoor furniture (porch chairs, plants on a veranda, a swing on a lawn) that closes
 * the 3 ft way from the gate to a door or an outdoor room the planting leaves open is moved within its own space to
 * the nearest spot that opens it again (clear of doorways, the walkway and the cars' ways), the piece that frees the
 * most first; one that has no such spot is left out with a note. Cars are never moved here.
 */
export function keepOutdoorReach(ctx: BuildCtx): void {
  if (!ctx.structureBuilt) return;
  const plan = ctx.plan;
  const g = plan.levels[0].id;
  const outItems = () =>
    ctx.items.filter((it) => {
      if (it.cls !== "floor" || /^(car_|motorbike)/.test(it.type) || it.h1 - it.h0 <= 0.3) return false;
      const r = plan.room(it.room);
      return !!r && r.level === g && r.cat !== "enclosed";
    });
  const boxOf = itemBox;
  const solidsWith = (skip?: PlacedItem, at?: Box) => [...ctx.plantings, ...outItems().filter((i) => i !== skip).map(boxOf), ...(at ? [at] : [])];
  const open = reachedWith(ctx, ctx.plantings);
  const missing = (r: { doors: boolean[]; rooms: boolean[] }) => r.doors.filter((d, k) => !d && open.doors[k]).length + r.rooms.filter((x, k) => !x && open.rooms[k]).length;
  const P = parking(ctx);
  const ways = carWays(P, plan.plotW, plan.plotD);
  const om = outdoorModel(ctx);
  for (let iter = 0; iter < 8; iter++) {
    const now = missing(reachedWith(ctx, solidsWith()));
    if (!now) return;
    // the piece whose absence frees the most (the smaller first)
    let best: { it: PlacedItem; gain: number; area: number } | null = null;
    for (const it of outItems()) {
      const gain = now - missing(reachedWith(ctx, solidsWith(it)));
      const area = (it.x1 - it.x0) * (it.y1 - it.y0);
      if (gain > 0 && (!best || gain > best.gain || (gain === best.gain && area < best.area))) best = { it, gain, area };
    }
    if (!best) return;
    const it = best.it;
    const room = plan.room(it.room)!;
    const r = room.rect;
    const zones = keepOut(ctx, room).filter((z) => z.kind !== "window");
    const others = outItems().filter((q) => q !== it && q.room === it.room).map(boxOf);
    const ib = itemBox(it);
    let spot: [number, number] | null = null;
    let tests = 0;
    search: for (let rad = 0.5; rad <= 10; rad += 0.5)
      for (let a = 0; a < 24; a++) {
        const dx = Math.round(Math.cos((a / 24) * Math.PI * 2) * rad * 4) / 4, dy = Math.round(Math.sin((a / 24) * Math.PI * 2) * rad * 4) / 4;
        const b: Box = { x0: ib.x0 + dx, x1: ib.x1 + dx, y0: ib.y0 + dy, y1: ib.y1 + dy };
        const core: Box = { x0: it.x0 + dx, x1: it.x1 + dx, y0: it.y0 + dy, y1: it.y1 + dy };
        if (core.x0 < r.x + 0.2 || core.x1 > r.x + r.w - 0.2 || core.y0 < r.y + 0.2 || core.y1 > r.y + r.d - 0.2) continue;
        if (om.fixed.some((f) => overlaps(core, f, 0.05)) || others.some((q) => overlaps(b, q, 0.05)) || ctx.plantings.some((q) => overlaps(b, q, 0.05))) continue;
        if (zones.some((z) => overlaps(core, z.core ?? z, 0.02)) || om.zones.some((z) => overlaps(b, z.box, 0.02))) continue;
        if (onWalkwayRect(P, b) || ways.some((w) => overlaps(b, w))) continue;
        if (++tests > 80) break search;
        if (missing(reachedWith(ctx, solidsWith(it, b))) < now) {
          spot = [dx, dy];
          break search;
        }
      }
    const deps = ctx.items.filter((q) => q !== it && q.room === it.room && q.cls === "top" && (q.x0 + q.x1) / 2 > it.x0 && (q.x0 + q.x1) / 2 < it.x1 && (q.y0 + q.y1) / 2 > it.y0 && (q.y0 + q.y1) / 2 < it.y1);
    if (spot) {
      const [dx, dy] = spot;
      for (const q of [it, ...deps]) {
        q.group.position.x += dx * FT;
        q.group.position.z -= dy * FT;
        q.x0 += dx;
        q.x1 += dx;
        q.y0 += dy;
        q.y1 += dy;
      }
      warn(`outdoor reach: the ${it.type} in ${it.room} closed the 3 ft way from the gate; moved ${Math.hypot(dx, dy).toFixed(1)} ft`);
      continue;
    }
    for (const q of [it, ...deps]) {
      q.group.removeFromParent();
      const meshes = new Set<object>();
      q.group.traverse((o) => meshes.add(o));
      ctx.colliders = ctx.colliders.filter((m) => !meshes.has(m));
      const k = ctx.items.indexOf(q);
      if (k >= 0) ctx.items.splice(k, 1);
    }
    ctx.notes.add({
      id: `asbuilt.outdoor_way:${room.id}:${it.type}`,
      title: "Furniture left out to keep the way in clear",
      status: "warn",
      message: `The ${humanType(it.type)} in ${roomPhrase(plan, room)} was left out to keep a 3 ft way from the gate.`,
      element_ids: [room.id],
    });
  }
}
