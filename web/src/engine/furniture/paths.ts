/**
 * B.5 walking paths (900 mm): after each furnishing section, every entry of an open-plan cluster of rooms (each
 * door, the stair foot and the top landing) must be reachable from every other with a 3 ft wide path between the
 * furniture (obstacles grown by 1.5 ft, beds by 1.25 ft, walls by 0.6 ft). When furniture cuts a path, the piece
 * that reconnects the most entries is moved along its wall, to another wall or nearby, and left out as a last
 * resort. Whatever cannot be repaired is reported.
 *
 * EN3-01: every room's reach as well. By at least a 1.8 ft squeeze (the reach mask) from its entries, every entry, a
 * long side of every bed and the approach to every window of a habitable room must be reached. The repair ladder:
 * 1. move the pieces in the way (a bed with its nightstands and rug; two pieces trading places when one alone cannot
 * move); 2. a smaller version of a piece the room keeps (a narrower, then shallower wardrobe; a single bed for a queen),
 * least-needed first; 3. leave out the least-needed piece, with a note ("the wardrobe was left out to keep the way to
 * the bath clear"). A door still not reached at all is a fail ("door unreachable"), one joined only by less than 3 ft a
 * tight walking path. EN3-03: no picture, mirror or wall TV is left over a door or window after a repair.
 */
import * as THREE from "three";
import type { FurnitureType, Side } from "@contracts/house-sdk";
import type { BuildCtx, PlacedItem } from "../core/ctx";
import { FT, DEG, warn } from "../core/util";
import { humanType } from "../core/notes";
import type { RoomM } from "../plan/model";
import { innerRect } from "../interior";
import { subtract, type Span } from "../structure/cover";
import { ITEMS } from "./items";
import { isDefining, rebuildAs, roomLabel } from "./place";
import { blocksWindow, HABITABLE, keepOut, solidIntervals } from "./zones";

const CELL = 0.25;
const FIXED = new Set(["kitchen_counter", "wc", "vanity", "shower", "bathtub", "tv_unit", "car_sedan", "car_suv", "fridge", "kitchen_island", "washing_machine", "oven"]);
/** moved if that frees the path, but never left out (a dresser that cannot move off the walkway is left out) */
const KEEP = new Set(["bed_king", "bed_queen", "bed_single", "sofa_3", "sofa_2", "sofa_l", "dining_table_4", "dining_table_6", "dining_table_8", "wardrobe", "study_desk"]);
/** may be made up to 15 % narrower to move off a walkway */
const NARROWER = new Set(["dresser", "sideboard", "console_table", "bookshelf", "dressing_table", "wardrobe", "study_desk"]);
type Box = { x0: number; x1: number; y0: number; y1: number };

const inflateOf = (it: PlacedItem) => (it.type.startsWith("bed_") ? 1.25 : it.type.startsWith("dining_table") ? 2.2 : 1.5);
const ROT: Record<string, number> = { front: 0, back: 180, left: -90, right: 90 };

function footprint(cx: number, cy: number, w: number, d: number, rotDeg: number): Box {
  const t = rotDeg * DEG;
  const hx = (Math.abs(Math.cos(t)) * w + Math.abs(Math.sin(t)) * d) / 2;
  const hy = (Math.abs(Math.sin(t)) * w + Math.abs(Math.cos(t)) * d) / 2;
  return { x0: cx - hx, x1: cx + hx, y0: cy - hy, y1: cy + hy };
}

function clusterOf(ctx: BuildCtx, room: RoomM): RoomM[] {
  const out = new Set<RoomM>([room]);
  const q = [room];
  while (q.length) {
    const r = q.pop()!;
    for (const id of r.open) {
      const o = ctx.plan.room(id);
      if (o && o.level === r.level && !out.has(o) && o.cat !== "outdoor") {
        out.add(o);
        q.push(o);
      }
    }
  }
  return [...out];
}

interface Grid {
  x0: number;
  y0: number;
  nx: number;
  ny: number;
  base: Uint8Array; // walkable before furniture
}

function baseGrid(ctx: BuildCtx, rooms: RoomM[]): Grid {
  const x0 = Math.min(...rooms.map((r) => r.rect.x)), y0 = Math.min(...rooms.map((r) => r.rect.y));
  const x1 = Math.max(...rooms.map((r) => r.rect.x + r.rect.w)), y1 = Math.max(...rooms.map((r) => r.rect.y + r.rect.d));
  const nx = Math.ceil((x1 - x0) / CELL), ny = Math.ceil((y1 - y0) / CELL);
  const base = new Uint8Array(nx * ny);
  // room rects (walls are blocked below, with their own clearance; open-plan edges must stay passable)
  const inners = rooms.map((r) => ({ x0: r.rect.x, x1: r.rect.x + r.rect.w, y0: r.rect.y, y1: r.rect.y + r.rect.d }));
  const level = rooms[0].level;
  const runs = (ctx.model.runsByLevel.get(level) ?? []).filter((r) => r.kind !== "boundary");
  const stairs = ctx.model.stairs;
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const x = x0 + (i + 0.5) * CELL, y = y0 + (j + 0.5) * CELL;
      let ok = rooms.some((r, k) => x >= r.rect.x && x <= r.rect.x + r.rect.w && y >= r.rect.y && y <= r.rect.y + r.rect.d && x >= inners[k].x0 - 0.01 && x <= inners[k].x1 + 0.01 && y >= inners[k].y0 - 0.01 && y <= inners[k].y1 + 0.01);
      if (ok)
        for (const run of runs) {
          const along = run.axis === "x" ? x : y, across = run.axis === "x" ? y : x;
          if (along < run.ea - 0.6 || along > run.eb + 0.6) continue;
          if (Math.abs(across - run.c) > run.t / 2 + 0.6) continue;
          // an open doorway in that wall is not an obstacle
          if (run.openings.some((o) => o.isDoor && along > o.u0 + 0.1 && along < o.u1 - 0.1)) continue;
          ok = false;
          break;
        }
      if (ok)
        for (const s of stairs) {
          if (s.stair.from.id === level && x > s.rect.x && x < s.rect.x + s.rect.w && y > s.rect.y && y < s.rect.y + s.rect.d) ok = false;
          if (s.holeLevel === level && s.holes.some((h) => x > h.x && x < h.x + h.w && y > h.y && y < h.y + h.d)) ok = false;
          if (!ok) break;
        }
      base[j * nx + i] = ok ? 1 : 0;
    }
  return { x0, y0, nx, ny, base };
}

function entriesOf(ctx: BuildCtx, rooms: RoomM[]): { x: number; y: number; what: string; room?: RoomM }[] {
  const out: { x: number; y: number; what: string; room?: RoomM }[] = [];
  const set = new Set(rooms);
  const level = rooms[0].level;
  for (const o of ctx.model.openings) {
    if (!o.isDoor || o.op.level !== level) continue;
    for (const [r, into] of [[o.neg, -1], [o.pos, 1]] as const) {
      if (!r || !set.has(r)) continue;
      const other = into < 0 ? o.pos : o.neg;
      if (other && set.has(other)) continue;
      const u = (o.u0 + o.u1) / 2, c = o.run.c + into * 1.5;
      out.push(o.run.axis === "x" ? { x: u, y: c, what: o.op.id, room: r } : { x: c, y: u, what: o.op.id, room: r });
    }
  }
  for (const lay of ctx.model.stairs) {
    const inside = (x: number, y: number) => rooms.some((r) => x >= r.rect.x && x <= r.rect.x + r.rect.w && y >= r.rect.y && y <= r.rect.y + r.rect.d);
    if (lay.stair.from.id === level) {
      const f = lay.foot, x = f.x + f.w / 2, y = f.y + f.d / 2;
      if (inside(x, y)) out.push({ x, y, what: `${lay.stair.id} foot` });
    }
    if (lay.holeLevel === level) {
      const f = lay.landing, x = f.x + f.w / 2, y = f.y + f.d / 2;
      if (inside(x, y)) out.push({ x, y, what: `${lay.stair.id} top` });
    }
  }
  return out;
}

/** Components reached by the entries; returns how many entries share the largest component. */
function connectivity(g: Grid, mask: Uint8Array, entries: { x: number; y: number }[]): { best: number; cells: number[] } {
  const { nx, ny } = g;
  const cells = entries.map((e) => {
    const i0 = Math.floor((e.x - g.x0) / CELL), j0 = Math.floor((e.y - g.y0) / CELL);
    // snap to the nearest walkable cell within 1 ft
    let best = -1, bd = Infinity;
    for (let dj = -4; dj <= 4; dj++)
      for (let di = -4; di <= 4; di++) {
        const i = i0 + di, j = j0 + dj;
        if (i < 0 || j < 0 || i >= nx || j >= ny || !mask[j * nx + i]) continue;
        const dd = di * di + dj * dj;
        if (dd < bd) { bd = dd; best = j * nx + i; }
      }
    return best;
  });
  const comp = new Int32Array(nx * ny).fill(-1);
  let nc = 0;
  for (const c0 of cells) {
    if (c0 < 0 || comp[c0] >= 0) continue;
    const q = [c0];
    comp[c0] = nc;
    while (q.length) {
      const cur = q.pop()!;
      const ci = cur % nx, cj = (cur - ci) / nx;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const i = ci + di, j = cj + dj;
        if (i < 0 || j < 0 || i >= nx || j >= ny) continue;
        const k = j * nx + i;
        if (!mask[k] || comp[k] >= 0) continue;
        comp[k] = nc;
        q.push(k);
      }
    }
    nc++;
  }
  const count = new Map<number, number>();
  for (const c of cells) if (c >= 0) count.set(comp[c], (count.get(comp[c]) ?? 0) + 1);
  return { best: Math.max(0, ...count.values()), cells };
}

/** An item's no-walk area: 1.5 ft in front of it (1.25 ft for beds; `inf` for the 2 ft reach mask); along its wall only
 *  0.75 ft past its ends. */
function stampItem(g: Grid, mask: Uint8Array, it: PlacedItem, box: Box = it, inf: number = inflateOf(it), round = false): void {
  const alongX = it.against === "front" || it.against === "back";
  const e = it.against ? Math.min(inf, 0.75) : inf;
  if (round) return stampRound(g, mask, box, alongX ? e : inf, alongX ? inf : e);
  if (!it.against) return stamp(g, mask, box, inf);
  const b2 = alongX ? { x0: box.x0 - e, x1: box.x1 + e, y0: box.y0 - inf, y1: box.y1 + inf } : { x0: box.x0 - inf, x1: box.x1 + inf, y0: box.y0 - e, y1: box.y1 + e };
  stamp(g, mask, b2, 0);
}

/** EN3-01: the reach mask's no-walk area has rounded corners (a walker squeezes diagonally between two corners). */
function stampRound(g: Grid, mask: Uint8Array, b: Box, ix: number, iy: number): void {
  const i0 = Math.max(0, Math.floor((b.x0 - ix - g.x0) / CELL)), i1 = Math.min(g.nx, Math.ceil((b.x1 + ix - g.x0) / CELL));
  const j0 = Math.max(0, Math.floor((b.y0 - iy - g.y0) / CELL)), j1 = Math.min(g.ny, Math.ceil((b.y1 + iy - g.y0) / CELL));
  for (let j = j0; j < j1; j++)
    for (let i = i0; i < i1; i++) {
      const x = g.x0 + (i + 0.5) * CELL, y = g.y0 + (j + 0.5) * CELL;
      const dx = Math.max(b.x0 - x, 0, x - b.x1) / ix, dy = Math.max(b.y0 - y, 0, y - b.y1) / iy;
      if (dx * dx + dy * dy < 1) mask[j * g.nx + i] = 0;
    }
}

function stamp(g: Grid, mask: Uint8Array, b: Box, inflate: number): void {
  const i0 = Math.max(0, Math.floor((b.x0 - inflate - g.x0) / CELL)), i1 = Math.min(g.nx, Math.ceil((b.x1 + inflate - g.x0) / CELL));
  const j0 = Math.max(0, Math.floor((b.y0 - inflate - g.y0) / CELL)), j1 = Math.min(g.ny, Math.ceil((b.y1 + inflate - g.y0) / CELL));
  for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) mask[j * g.nx + i] = 0;
}

export function ensurePaths(ctx: BuildCtx, roomIds: Iterable<string>): void {
  const done = new Set<string>();
  for (const id of roomIds) {
    const room = ctx.plan.room(id);
    if (!room || room.cat === "outdoor" || done.has(id)) continue;
    const cluster = clusterOf(ctx, room);
    for (const r of cluster) done.add(r.id);
    repairCluster(ctx, cluster);
  }
  sweepWallDecor(ctx, done);
}

/** EN3-01: the reach mask, a walker squeezing past sideways (a 1.8 ft passage between pieces): furniture grown by 0.9
 *  ft, walls by 0.6 ft */
const REACH = 0.9;
/** a window is within reach (to open it, to draw its curtains) from this close, straight in front of it: over a desk, a
 *  dresser or a sofa; and from WIN_NEAR anywhere in front of it or a foot to either side */
const WIN_REACH = 4.25;
const WIN_NEAR = 2.5;
/** where one stands beside a bed: within this of its long side (the middle 70 % of it) */
const BED_SIDE = REACH + 0.6;

const isBed = (it: { type: string }) => it.type.startsWith("bed_");
/** fixtures the path repair may still move (never leave out) when a door is cut off or joined by less than 3 ft */
const MOVABLE_FIXED = new Set(["fridge", "washing_machine"]);
/** light pieces one pushes aside to get by (a desk chair, a dining chair, a pouf): not in the way of the squeeze */
const PUSHED_ASIDE = new Set(["desk_chair", "dining_chair", "ottoman"]);

/** A place in a room that must be reachable from its doors: a window's approach or a side of a bed. */
interface Target {
  kind: "window" | "bed";
  room: RoomM;
  cells: number[];
  id?: string;
}

/** The approach to every window (not ventilators or slits) of the habitable rooms of a cluster: the floor in front of
 *  it (see WIN_REACH / WIN_NEAR). */
function windowTargets(ctx: BuildCtx, g: Grid, rooms: RoomM[]): Target[] {
  const out: Target[] = [];
  for (const room of rooms) {
    if (!HABITABLE.has(room.type)) continue;
    for (const o of ctx.model.openingsOfRoom(room)) {
      if (o.isDoor || o.op.type === "ventilator" || o.u1 - o.u0 < 1.5) continue;
      const into = o.neg === room ? -1 : 1;
      const face = o.run.c + (into * o.run.t) / 2;
      const cells: number[] = [];
      const r = room.rect;
      // (only the cells near the window: its span ± 1 ft, out to WIN_REACH)
      const [ax0, ax1] = [o.u0 - 1, o.u1 + 1], [cx0, cx1] = into > 0 ? [face, face + WIN_REACH] : [face - WIN_REACH, face];
      const [bx0, bx1, by0, by1] = o.run.axis === "x" ? [ax0, ax1, cx0, cx1] : [cx0, cx1, ax0, ax1];
      const i0 = Math.max(0, Math.floor((bx0 - g.x0) / CELL)), i1 = Math.min(g.nx, Math.ceil((bx1 - g.x0) / CELL));
      const j0 = Math.max(0, Math.floor((by0 - g.y0) / CELL)), j1 = Math.min(g.ny, Math.ceil((by1 - g.y0) / CELL));
      for (let j = j0; j < j1; j++)
        for (let i = i0; i < i1; i++) {
          const x = g.x0 + (i + 0.5) * CELL, y = g.y0 + (j + 0.5) * CELL;
          if (x < r.x || x > r.x + r.w || y < r.y || y > r.y + r.d) continue;
          const along = o.run.axis === "x" ? x : y, across = o.run.axis === "x" ? y : x;
          const dc = (across - face) * into;
          // (where one stands to open it: right at it, or a foot past either side; or straight in front of it, reaching
          // over a desk, a dresser or a sofa)
          const near = dc <= WIN_NEAR && along >= o.u0 - 1 && along <= o.u1 + 1;
          const over = dc <= WIN_REACH && along >= o.u0 + 0.5 && along <= o.u1 - 0.5;
          if (dc >= 0 && (near || over)) cells.push(j * g.nx + i);
        }
      if (cells.length) out.push({ kind: "window", room, cells, id: o.op.id });
    }
  }
  return out;
}

/** The floor beside a bed's two long sides (the middle 70 % of them), as grid cells. */
function bedCells(g: Grid, b: Box): number[] {
  const alongX = b.x1 - b.x0 >= b.y1 - b.y0; // (a bed is longer than it is wide)
  const L = alongX ? b.x1 - b.x0 : b.y1 - b.y0;
  const strips: Box[] = alongX
    ? [{ x0: b.x0 + 0.15 * L, x1: b.x1 - 0.15 * L, y0: b.y0 - BED_SIDE, y1: b.y0 }, { x0: b.x0 + 0.15 * L, x1: b.x1 - 0.15 * L, y0: b.y1, y1: b.y1 + BED_SIDE }]
    : [{ x0: b.x0 - BED_SIDE, x1: b.x0, y0: b.y0 + 0.15 * L, y1: b.y1 - 0.15 * L }, { x0: b.x1, x1: b.x1 + BED_SIDE, y0: b.y0 + 0.15 * L, y1: b.y1 - 0.15 * L }];
  const out: number[] = [];
  for (const s of strips) {
    const i0 = Math.max(0, Math.floor((s.x0 - g.x0) / CELL)), i1 = Math.min(g.nx, Math.ceil((s.x1 - g.x0) / CELL));
    const j0 = Math.max(0, Math.floor((s.y0 - g.y0) / CELL)), j1 = Math.min(g.ny, Math.ceil((s.y1 - g.y0) / CELL));
    for (let j = j0; j < j1; j++)
      for (let i = i0; i < i1; i++) {
        const x = g.x0 + (i + 0.5) * CELL, y = g.y0 + (j + 0.5) * CELL;
        if (x >= s.x0 && x <= s.x1 && y >= s.y0 && y <= s.y1) out.push(j * g.nx + i);
      }
  }
  return out;
}

/** a planned move of one piece (the walking-path repair tries these before it makes them) */
type Move = { it: PlacedItem; box: Box; against?: string };
interface Eval {
  /** entries not joined to the others by a 3 ft path */
  blocked: number[];
  /** entries not reached at all (not even by a 1.8 ft squeeze) */
  lost: number[];
  /** windows and bed sides not reached */
  failed: Target[];
  /** 0 when everything is reached; each cut-off entry, lost entry and target lowers it */
  total: number;
}

/**
 * The as-built reach of a room cluster (EN3-01): its entries (every door, the stair foot and top landing) joined by a
 * 3 ft path; and, by at least a 1.8 ft squeeze from those entries, every entry, each window's approach and a long side of
 * every bed. `skip` pieces are taken out, `moves` stand at their planned boxes.
 */
function reachModel(ctx: BuildCtx, rooms: RoomM[]) {
  const ids = new Set(rooms.map((r) => r.id));
  const entries = entriesOf(ctx, rooms);
  const g = baseGrid(ctx, rooms);
  const obstacles = () => ctx.items.filter((it) => ids.has(it.room) && it.cls === "floor");
  const bareCells = connectivity(g, g.base, entries).cells;
  const bareLab = labels(g, g.base);
  const wins = windowTargets(ctx, g, rooms);
  const evaluate = (skip: PlacedItem[] = [], moves: Move[] = []): Eval => {
    const sk = new Set<PlacedItem>([...skip, ...moves.map((m) => m.it)]);
    const m3 = g.base.slice(), mR = g.base.slice();
    const beds: { box: Box; room: string }[] = [];
    for (const it of obstacles()) {
      if (sk.has(it)) continue;
      stampItem(g, m3, it);
      if (!PUSHED_ASIDE.has(it.type)) stampItem(g, mR, it, it, REACH, true);
      if (isBed(it)) beds.push({ box: it, room: it.room });
    }
    for (const m of moves) {
      const as = m.against && m.against !== m.it.against ? ({ ...m.it, against: m.against } as PlacedItem) : m.it;
      stampItem(g, m3, as, m.box);
      if (!PUSHED_ASIDE.has(as.type)) stampItem(g, mR, as, m.box, REACH, true);
      if (isBed(m.it)) beds.push({ box: m.box, room: m.it.room });
    }
    const blocked = entries.length > 1 ? joined(g, m3, entries, bareLab, bareCells).blocked : [];
    const labR = labels(g, mR);
    const cellsR = snapCells(g, mR, entries);
    const lost = entries.length > 1 ? joinedOn(cellsR, labR, bareLab, bareCells).blocked : [];
    const reached = new Set(cellsR.filter((c, k) => c >= 0 && !lost.includes(k)).map((c) => labR[c]));
    const targets: Target[] = [...wins, ...beds.map((b) => ({ kind: "bed" as const, room: ctx.plan.room(b.room)!, cells: bedCells(g, b.box) }))];
    const failed = targets.filter((t) => t.cells.length && !t.cells.some((c) => mR[c] && reached.has(labR[c])));
    return { blocked, lost, failed, total: -(blocked.length * 1000 + lost.length * 100 + failed.length * 10) };
  };
  /** the furnished 3 ft mask as it stands */
  const mask3 = () => {
    const m = g.base.slice();
    for (const it of obstacles()) stampItem(g, m, it);
    return m;
  };
  return { ids, entries, g, obstacles, evaluate, bareCells, bareLab, mask3 };
}

function repairCluster(ctx: BuildCtx, rooms: RoomM[]): void {
  const M = reachModel(ctx, rooms);
  const { entries, g, obstacles, evaluate: ev } = M;
  if (!entries.length) return;
  /** the planned moves of a piece going to `box` (a bed takes its nightstands and its rug along) */
  const movesFor = (it: PlacedItem, box: Box, side?: string) => {
    const plan = companionsAt(ctx, it, box, side);
    return { skip: [it, ...plan.all], moves: [{ it, box, against: side } as Move, ...plan.moves] };
  };
  const better = (it: PlacedItem, cur: Eval) => (box: Box, side?: string) => {
    const m = movesFor(it, box, side);
    return ev(m.skip, m.moves).total > cur.total;
  };
  /**
   * A piece that cannot move on its own (a bed hemmed in by a wardrobe) moves to a spot another piece stands on, when
   * that other piece then finds a place of its own that keeps the way open (the lesser-needed piece tried first).
   */
  const swap = (c: PlacedItem, cur: Eval): boolean => {
    if (c.w === undefined || c.d === undefined) return false;
    const mine = new Set(isBed(c) ? companionsOf(ctx, c).all : []);
    // (the pieces of its own room, the lesser-needed and smaller first; a handful at most)
    const area = (q: PlacedItem) => (q.x1 - q.x0) * (q.y1 - q.y0);
    const qs = obstacles()
      .filter((q) => q !== c && q.room === c.room && !mine.has(q) && !FIXED.has(q.type) && q.w !== undefined && q.d !== undefined && area(q) > 1.5)
      .sort((a, b) => need(ctx, a) - need(ctx, b) || area(a) - area(b))
      .slice(0, 4);
    for (const q of qs) {
      const spotC = findSpot(ctx, c, [c.w], c.d, (box, side) => {
        const m = movesFor(c, box, side);
        return ev([...m.skip, q], m.moves).total > cur.total;
      }, new Set([q]));
      if (!spotC) continue;
      const m = movesFor(c, spotC.box, spotC.side);
      const placed = new Set<PlacedItem>([c, ...m.skip]);
      const spotQ = findSpot(ctx, q, [q.w!], q.d!, (box, side) => ev([...m.skip, q], [...m.moves, { it: q, box, against: side }]).total > cur.total, placed, m.moves.map((x) => x.box));
      if (!spotQ) continue;
      trace(ctx, () => `${rooms.map((r) => r.id).join("+")} swap ${ctx.section}: ${c.type} ${c.id} and ${q.type} ${q.id}`);
      applySpot(ctx, c, spotC);
      applySpot(ctx, q, spotQ);
      return true;
    }
    return false;
  };
  // 1. move the pieces in the way (an optional piece that cannot move gives way quietly, EN2-05). A fridge or a washing
  // machine moves too when a door is cut off altogether (never left out)
  const moves = () => {
    const stuck = new Set<PlacedItem>();
    for (let iter = 0; iter < 16; iter++) {
      const cur = ev();
      if (cur.total === 0) return;
      // (EN-F4: also when a door is joined only by less than 3 ft: a washing machine wedged beside a door moves rather
      // than leave a tight walking path)
      const fixed = (it: PlacedItem) => FIXED.has(it.type) && !((cur.lost.length || cur.blocked.length) && MOVABLE_FIXED.has(it.type));
      // the piece whose removal helps most (smaller pieces first on ties)
      let culprit: { it: PlacedItem; gain: number; area: number } | null = null;
      for (const it of obstacles()) {
        if (fixed(it) || stuck.has(it)) continue;
        const gain = ev([it]).total - cur.total;
        const area = (it.x1 - it.x0) * (it.y1 - it.y0);
        if (gain > 0 && (!culprit || gain > culprit.gain || (gain === culprit.gain && area < culprit.area))) culprit = { it, gain, area };
      }
      let improves: ((box: Box, side?: string) => boolean) | null = null;
      if (culprit) improves = better(culprit.it, cur);
      else {
        // several pieces block together: take the ones standing on the natural route (walls only) to an entry or a
        // window or bed side that is cut off, the piece covering most of that route first
        const route = naturalRoute(g, M, cur);
        if (!route) return;
        const onRoute = obstacles()
          .filter((it) => !FIXED.has(it.type) && !stuck.has(it))
          .map((it) => {
            const inf = inflateOf(it);
            let n = 0;
            for (const [x, y] of route) if (x > it.x0 - inf && x < it.x1 + inf && y > it.y0 - inf && y < it.y1 + inf) n++;
            return { it, gain: n, area: (it.x1 - it.x0) * (it.y1 - it.y0) };
          })
          .filter((c) => c.gain > 0)
          .sort((a, b) => b.gain - a.gain || a.area - b.area);
        if (!onRoute.length) return;
        culprit = onRoute[0];
        const inf = inflateOf(culprit.it);
        improves = (box: Box) => !route.some(([x, y]) => x > box.x0 - inf && x < box.x1 + inf && y > box.y0 - inf && y < box.y1 + inf);
      }
      const c = culprit.it;
      trace(ctx, () => `${rooms.map((r) => r.id).join("+")} move#${iter} ${ctx.section}: blocked ${cur.blocked.map((k) => entries[k].what)} lost ${cur.lost.map((k) => entries[k].what)} failed ${cur.failed.map((t) => `${t.kind}:${t.id ?? t.room.id}`)} -> ${c.type} ${c.id}`);
      if (relocate(ctx, c, improves)) stuck.clear(); // (a piece that moved may have freed a spot for one that could not)
      else if (!KEEP.has(c.type) && !FIXED.has(c.type)) drop(ctx, c);
      else if (culprit.gain > 0 && swap(c, cur)) stuck.clear();
      else stuck.add(c);
    }
  };
  const first = ev();
  if (first.total === 0) return reachNotes(ctx, rooms, M, first);
  moves();
  // 2. EN3-01: a smaller version of a piece the room keeps (a narrower, then shallower wardrobe; a single bed for a
  // queen), the least-needed piece first, at a spot where it frees the way; then the moves again
  for (let k = 0; k < 6; k++) {
    const cur = ev();
    if (cur.total === 0) break;
    const cands = obstacles()
      .filter((it) => KEEP.has(it.type) && !FIXED.has(it.type) && smallerSteps(it).length)
      .map((it) => ({ it, gain: ev([it]).total - cur.total }))
      .filter((c) => c.gain > 0)
      .sort((a, b) => need(ctx, a.it) - need(ctx, b.it) || b.gain - a.gain);
    const done = cands.some(({ it: c }) => {
      trace(ctx, () => `${rooms.map((r) => r.id).join("+")} smaller ${ctx.section}: ${c.type} ${c.id}`);
      return shrinkToFit(ctx, c, (it2, box, side) => {
        const m = movesFor(c, box, side);
        return ev(m.skip, [{ it: it2, box, against: side }, ...m.moves.slice(1)]).total > cur.total;
      });
    });
    if (!done) break;
    moves();
  }
  // 3. EN3-01, the last resort: the least-needed piece in the way is left out, with a note. A door, a window or a bed
  // side cut off altogether may cost any piece the room is not defined by; a door joined only by less than 3 ft costs
  // at most a study desk or a wardrobe (never a sofa or a dining table)
  // (when no one piece frees it, the pair that does: its least-needed piece goes first, and the moves run again)
  const hard = (e: Eval) => e.lost.length * 100 + e.failed.length * 10;
  for (let k = 0; k < 4; k++) {
    const cur = ev();
    if (cur.total === 0) break;
    const pool = obstacles().filter((it) => !FIXED.has(it.type) && need(ctx, it) < Infinity);
    const helps = (after: Eval, its: PlacedItem[]) => hard(after) < hard(cur) || (after.total > cur.total && its.every((it) => need(ctx, it) <= 2));
    let pick: { it: PlacedItem; after: Eval } | null = pool
      .map((it) => ({ it, after: ev([it]) }))
      .filter((c) => helps(c.after, [c.it]))
      .sort((a, b) => need(ctx, a.it) - need(ctx, b.it) || b.after.total - a.after.total)[0] ?? null;
    if (!pick && pool.length <= 14) {
      let best: { its: PlacedItem[]; after: Eval } | null = null;
      for (let i = 0; i < pool.length; i++)
        for (let j = i + 1; j < pool.length; j++) {
          const after = ev([pool[i], pool[j]]);
          if (!helps(after, [pool[i], pool[j]])) continue;
          const n = need(ctx, pool[i]) + need(ctx, pool[j]);
          if (!best || n < need(ctx, best.its[0]) + need(ctx, best.its[1]) || (n === need(ctx, best.its[0]) + need(ctx, best.its[1]) && after.total > best.after.total)) best = { its: [pool[i], pool[j]], after };
        }
      if (best) pick = { it: best.its.sort((a, b) => need(ctx, a) - need(ctx, b))[0], after: best.after };
    }
    if (!pick) break;
    const { it, after } = pick;
    const freed = [...cur.lost, ...cur.blocked].find((e) => !after.lost.includes(e) && !after.blocked.includes(e));
    const what = freed !== undefined ? entryLabel(ctx, entries[freed]) : (cur.failed.find((t) => !after.failed.some((u) => u.kind === t.kind && u.id === t.id && u.cells[0] === t.cells[0]))?.kind ?? "window");
    trace(ctx, () => `${rooms.map((r) => r.id).join("+")} leave out ${ctx.section}: ${it.type} ${it.id} for the ${what}`);
    leaveOut(ctx, it, what);
    moves();
  }
  reachNotes(ctx, rooms, M);
}

/** Dev: the repair's steps, when the harness asks for them (globalThis.__reachTrace = []). */
function trace(ctx: BuildCtx, msg: () => string): void {
  const t = (globalThis as unknown as { __reachTrace?: string[] }).__reachTrace;
  if (t) t.push(msg());
  void ctx;
}

/** The way an entry leads: "bath", "dressing room", "balcony", "stair", or "door". */
function entryLabel(ctx: BuildCtx, e: { what: string; room?: RoomM }): string {
  if (/ (foot|top)$/.test(e.what)) return "stair";
  const o = ctx.model.openings.find((x) => x.op.id === e.what);
  const other = o ? (o.neg === e.room ? o.pos : o.neg) : null;
  const T: Record<string, string> = { bath: "bath", powder: "bath", dressing: "dressing room", balcony: "balcony", terrace: "terrace", stair: "stair" };
  return (other && T[other.type]) || "door";
}

/** "the door to the Attached Bath", "the sliding door to the Front Balcony", "the main door" (no raw ids in notes). */
function doorName(ctx: BuildCtx, e: { what: string; room?: RoomM }): string {
  if (/ (foot|top)$/.test(e.what)) return /top$/.test(e.what) ? "the top of the stair" : "the foot of the stair";
  const o = ctx.model.openings.find((x) => x.op.id === e.what);
  if (!o) return "a door";
  if (o.op.type === "main_door") return "the main door";
  const other = o.neg === e.room ? o.pos : o.neg;
  const kind = o.op.type === "sliding_door" ? "sliding door" : o.op.type === "arch" ? "arch" : o.op.type === "double_door" ? "double door" : "door";
  return other ? `the ${kind} to ${roomLabel(ctx, other)}` : `the ${kind} to the outside`;
}

/** EN3-01: how much a room needs a piece (the least-needed is left out first); Infinity: never left out (what the room
 *  is defined by: a bedroom's bed, a dressing room's wardrobe, a dining room's table, a lounge's sofas). */
function need(ctx: BuildCtx, it: PlacedItem): number {
  const room = ctx.plan.room(it.room);
  if (!room) return Infinity;
  if (isDefining(room, it.type)) return Infinity;
  if (it.type.startsWith("dining_table") && room.type === "dining") return Infinity;
  if (it.type.startsWith("sofa_") && ["lounge", "drawing"].includes(room.type)) return Infinity;
  if (!KEEP.has(it.type)) return 0;
  const N: Record<string, number> = { study_desk: 1, wardrobe: 2, sofa_2: 3, dining_table_4: 3, dining_table_6: 4, dining_table_8: 4, sofa_3: 4, sofa_l: 4 };
  return N[it.type] ?? 5;
}

/** EN3-01: leave a piece out so a door, a window or a bed can be reached, with a note for what the family asked for. */
function leaveOut(ctx: BuildCtx, it: PlacedItem, what: string): void {
  const room = ctx.plan.room(it.room);
  drop(ctx, it);
  if (!room || !KEEP.has(it.type)) return;
  const way = what === "door" ? "the way to the door" : what === "bed" ? "the way to the bed" : `the way to the ${what}`;
  ctx.notes.add({
    id: `asbuilt.furniture_left_out:${room.id}:${it.type}`,
    title: "Furniture left out to keep the way clear",
    status: "warn",
    message: `The ${humanType(it.type)} in ${roomLabel(ctx, room)} was left out to keep ${way} clear.`,
    element_ids: [room.id],
  });
}

/**
 * EN-03/EN-07/EN3-01, the notes of a room cluster after the repair: an entry no walker can get to at all is a fail
 * ("door unreachable", naming the room and the door); one joined only by less than 3 ft is a tight walking path (one
 * note per cluster, naming the floor). A later section that frees the way takes the notes away again.
 */
function reachNotes(ctx: BuildCtx, rooms: RoomM[], M: ReturnType<typeof reachModel>, known?: Eval): void {
  const fin = known ?? M.evaluate();
  const { entries } = M;
  const key = `asbuilt.path_blocked:${[...M.ids].sort()[0]}`;
  const tight = fin.blocked.filter((k) => !fin.lost.includes(k));
  if (tight.length) {
    const cut = [...new Set(tight.map((k) => entries[k].room).filter((r): r is RoomM => !!r))];
    const named = (cut.length ? cut : rooms).map((r) => roomLabel(ctx, r));
    ctx.notes.set({ id: key, title: "Tight walking path", status: "warn", message: `Furniture leaves less than 3 ft in front of a door or the stair in ${named.join(" and ")}.`, element_ids: rooms.map((r) => r.id) });
  } else ctx.notes.remove(key);
  const want = new Set<string>();
  for (const k of fin.lost) {
    const e = entries[k];
    const room = e.room ?? rooms[0];
    const id = `asbuilt.door_unreachable:${room.id}:${e.what}`;
    want.add(id);
    ctx.notes.set({
      id,
      title: `A door in the ${room.name} can't be reached`,
      status: "fail",
      message: `Furniture in ${roomLabel(ctx, room)} closes off ${doorName(ctx, e)}: there's no way to it from the room's other doors.`,
      element_ids: [room.id, e.what],
    });
  }
  for (const n of [...ctx.notes.list]) if (n.id.startsWith("asbuilt.door_unreachable:") && rooms.some((r) => n.id.startsWith(`asbuilt.door_unreachable:${r.id}:`)) && !want.has(n.id)) ctx.notes.remove(n.id);
}

/** Entries joined by a 3 ft path to the others they could reach on the bare floor (walls and stairs only); entries
 *  that walls already part (a plan issue, not furniture) are judged within their own group. */
function joined(g: Grid, mask: Uint8Array, entries: { x: number; y: number }[], bareLab: Int32Array, bareCells: number[]): { ok: number; blocked: number[] } {
  return joinedOn(snapCells(g, mask, entries), labels(g, mask), bareLab, bareCells);
}

/** Each entry's cell on a mask: the nearest walkable cell within 1 ft (-1: none). */
function snapCells(g: Grid, mask: Uint8Array, entries: { x: number; y: number }[]): number[] {
  const { nx, ny } = g;
  return entries.map((e) => {
    const i0 = Math.floor((e.x - g.x0) / CELL), j0 = Math.floor((e.y - g.y0) / CELL);
    let best = -1, bd = Infinity;
    for (let dj = -4; dj <= 4; dj++)
      for (let di = -4; di <= 4; di++) {
        const i = i0 + di, j = j0 + dj;
        if (i < 0 || j < 0 || i >= nx || j >= ny || !mask[j * nx + i]) continue;
        const dd = di * di + dj * dj;
        if (dd < bd) { bd = dd; best = j * nx + i; }
      }
    return best;
  });
}

/** joined(), given the entries' snapped cells and the component labels of the mask */
function joinedOn(fur: number[], lab: Int32Array, bareLab: Int32Array, bareCells: number[]): { ok: number; blocked: number[] } {
  const groups = new Map<number, number[]>();
  bareCells.forEach((c, k) => {
    if (c < 0) return;
    const key = bareLab[c];
    groups.set(key, [...(groups.get(key) ?? []), k]);
  });
  let ok = 0;
  const blocked: number[] = [];
  for (const ks of groups.values()) {
    const cnt = new Map<number, number[]>();
    for (const k of ks) {
      const key = fur[k] < 0 ? -1 - k : lab[fur[k]];
      cnt.set(key, [...(cnt.get(key) ?? []), k]);
    }
    const main = [...cnt.values()].sort((a, b) => b.length - a.length)[0];
    ok += main.length;
    for (const k of ks) if (!main.includes(k)) blocked.push(k);
  }
  return { ok, blocked };
}

/** Shortest route on the bare floor (walls and stairs only) from a cut-off entry to the main group, as plan points. */
function entryRoute(g: Grid, furnished: Uint8Array, entries: { x: number; y: number }[]): [number, number][] | null {
  const bare = connectivity(g, g.base, entries).cells; // entry cells on the bare floor
  const fur = connectivity(g, furnished, entries).cells; // and on the furnished floor
  const labB = labels(g, g.base), labF = labels(g, furnished);
  let best: [number, number][] | null = null;
  for (let a = 0; a < entries.length; a++)
    for (let b = a + 1; b < entries.length; b++) {
      if (bare[a] < 0 || bare[b] < 0 || labB[bare[a]] !== labB[bare[b]]) continue; // walls part them anyway
      if (fur[a] >= 0 && fur[b] >= 0 && labF[fur[a]] === labF[fur[b]]) continue; // already joined
      const r = bfsRoute(g, bare[a], bare[b]);
      if (r && (!best || r.length < best.length)) best = r;
    }
  return best;
}

function bfsRoute(g: Grid, s: number, t: number): [number, number][] | null {
  const { nx, ny } = g;
  const prev = new Int32Array(nx * ny).fill(-2);
  const q = new Int32Array(nx * ny);
  let h = 0, e = 0;
  q[e++] = s;
  prev[s] = -1;
  while (h < e) {
    const cur = q[h++];
    if (cur === t) break;
    const ci = cur % nx, cj = (cur - ci) / nx;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const i = ci + di, j = cj + dj;
      if (i < 0 || j < 0 || i >= nx || j >= ny) continue;
      const k = j * nx + i;
      if (!g.base[k] || prev[k] !== -2) continue;
      prev[k] = cur;
      q[e++] = k;
    }
  }
  if (prev[t] === -2) return null;
  const out: [number, number][] = [];
  for (let k = t; k !== -1; k = prev[k]) out.push([g.x0 + ((k % nx) + 0.5) * CELL, g.y0 + (Math.floor(k / nx) + 0.5) * CELL]);
  return out;
}

/** Shortest route on the bare floor (walls and stairs only) to what is cut off: an entry (from the others), else a
 *  window's approach or a bed side (from the entries), as plan points. */
function naturalRoute(g: Grid, M: ReturnType<typeof reachModel>, cur: Eval): [number, number][] | null {
  if (cur.blocked.length) {
    const r = entryRoute(g, M.mask3(), M.entries);
    if (r) return r;
  }
  const src = M.bareCells.filter((c, k) => c >= 0 && !cur.lost.includes(k));
  for (const t of cur.failed) {
    const r = bfsToSet(g, src, new Set(t.cells.filter((c) => g.base[c])));
    if (r) return r;
  }
  return null;
}

/** Multi-source BFS on the bare floor to the nearest of `goals`; the route as plan points (goal first). */
function bfsToSet(g: Grid, sources: number[], goals: Set<number>): [number, number][] | null {
  if (!sources.length || !goals.size) return null;
  const { nx, ny } = g;
  const prev = new Int32Array(nx * ny).fill(-2);
  const q = new Int32Array(nx * ny);
  let h = 0, e = 0;
  for (const s of sources) if (prev[s] === -2) { prev[s] = -1; q[e++] = s; }
  let hit = -1;
  while (h < e) {
    const cur = q[h++];
    if (goals.has(cur)) {
      hit = cur;
      break;
    }
    const ci = cur % nx, cj = (cur - ci) / nx;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const i = ci + di, j = cj + dj;
      if (i < 0 || j < 0 || i >= nx || j >= ny) continue;
      const k = j * nx + i;
      if (!g.base[k] || prev[k] !== -2) continue;
      prev[k] = cur;
      q[e++] = k;
    }
  }
  if (hit < 0) return null;
  const out: [number, number][] = [];
  for (let k = hit; k !== -1; k = prev[k]) out.push([g.x0 + ((k % nx) + 0.5) * CELL, g.y0 + (Math.floor(k / nx) + 0.5) * CELL]);
  return out;
}

/** A spot a piece may move to: its centre, rotation, the wall it stands against, its footprint and width. */
interface Spot {
  x: number;
  y: number;
  rot: number;
  side?: string;
  box: Box;
  w: number;
  d: number;
}

/**
 * The nearest free spot for a piece of size w × d (along its wall first, then the other walls; a free-standing piece
 * within 4 ft) that `improves` accepts: inside the room, out of every door, stair and (for a tall piece) window zone,
 * off the other furniture (a bed's own nightstands and rug move with it). Widths are tried in the order given.
 */
function findSpot(ctx: BuildCtx, it: PlacedItem, widths: number[], d: number, improves: (box: Box, side?: string) => boolean, ignore?: Set<PlacedItem>, extra: Box[] = []): Spot | null {
  const room = ctx.plan.room(it.room);
  if (!room) return null;
  const inner = room.cat === "enclosed" ? innerRect(ctx, room) : { x0: room.rect.x + 0.2, x1: room.rect.x + room.rect.w - 0.2, y0: room.rect.y + 0.2, y1: room.rect.y + room.rect.d - 0.2 };
  // (EN2-02: a tall piece is never moved in front of a window to free a path)
  const zones = keepOut(ctx, room).filter((z) => z.kind !== "window" || blocksWindow(it.type, it.h1 - it.h0, z));
  const mine = new Set(isBed(it) ? companionsOf(ctx, it).all : []);
  const others: Box[] = [...ctx.items.filter((q) => q !== it && q.room === it.room && q.cls === "floor" && !mine.has(q) && !ignore?.has(q)), ...extra];
  const ov = (a: Box, b: Box, t = 0.06) => a.x0 < b.x1 - t && b.x0 < a.x1 - t && a.y0 < b.y1 - t && b.y0 < a.y1 - t;
  const ok = (b: Box, side?: string) => b.x0 >= inner.x0 - 0.01 && b.x1 <= inner.x1 + 0.01 && b.y0 >= inner.y0 - 0.01 && b.y1 <= inner.y1 + 0.01 && !zones.some((z) => ov(b, z, 0.02)) && !others.some((q) => ov(b, q)) && improves(b, side);
  const cx = (it.x0 + it.x1) / 2, cy = (it.y0 + it.y1) / 2;
  // wall runs that meet end to end (a T junction behind) are one face
  const wallsOf = (side: string) => {
    const walls: { a: number; b: number }[] = [];
    for (const wl of ctx.model.roomWalls(room, side as "front" | "back" | "left" | "right").map((x) => ({ a: x.a, b: x.b })).sort((p, q) => p.a - q.a)) {
      const last = walls[walls.length - 1];
      if (last && wl.a <= last.b + 0.06) last.b = Math.max(last.b, wl.b);
      else walls.push(wl);
    }
    return walls;
  };
  const candidates = (w: number) => {
    const cands: { x: number; y: number; rot: number; side?: string }[] = [];
    if (it.against) {
      for (const side of ["front", "back", "left", "right"]) {
        const rot = ROT[side];
        const t = rot * DEG;
        const hx = (Math.abs(Math.cos(t)) * w + Math.abs(Math.sin(t)) * d) / 2, hy = (Math.abs(Math.sin(t)) * w + Math.abs(Math.cos(t)) * d) / 2;
        const axisX = side === "front" || side === "back";
        const c = side === "front" ? inner.y0 + hy + 0.02 : side === "back" ? inner.y1 - hy - 0.02 : side === "left" ? inner.x0 + hx + 0.02 : inner.x1 - hx - 0.02;
        const lo = axisX ? inner.x0 + hx : inner.y0 + hy, hi = axisX ? inner.x1 - hx : inner.y1 - hy;
        const pref = axisX ? cx : cy;
        const walls = wallsOf(side);
        const half = axisX ? hx : hy;
        for (let k = 0; k <= Math.ceil((hi - lo) / 0.25) * 2; k++) {
          const u = pref + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.25;
          if (u < lo || u > hi) continue;
          if (!walls.some((wl) => u - half >= wl.a - 0.3 && u + half <= wl.b + 0.3)) continue;
          cands.push(axisX ? { x: u, y: c, rot, side } : { x: c, y: u, rot, side });
        }
      }
      // same wall first
      cands.sort((a, b) => (a.side === it.against ? 0 : 1) - (b.side === it.against ? 0 : 1));
    } else {
      for (let rr = 0.25; rr <= 4.001; rr += 0.25) for (let a = 0; a < 24; a++) cands.push({ x: cx + Math.cos((a / 24) * Math.PI * 2) * rr, y: cy + Math.sin((a / 24) * Math.PI * 2) * rr, rot: it.rot ?? 0 });
    }
    return cands;
  };
  for (const w of widths)
    for (const c of candidates(w)) {
      const box = footprint(c.x, c.y, w, d, c.rot);
      if (ok(box, c.side)) return { ...c, box, w, d };
    }
  return null;
}

/** Move an item (and anything standing on it; a bed with its nightstands and rug) to a spot that is free and helps. */
function relocate(ctx: BuildCtx, it: PlacedItem, improves: (box: Box, side?: string) => boolean): boolean {
  if (it.w === undefined || it.d === undefined) return false;
  // EN2-02: a piece that may be made shorter (a dresser, a sideboard) tries 95, 90 and 85 % of its width too
  const w0 = it.w;
  const spot = findSpot(ctx, it, (NARROWER.has(it.type) ? [1, 0.95, 0.9, 0.85] : [1]).map((k) => w0 * k), it.d, improves);
  if (!spot) return false;
  if (spot.w !== w0) {
    it.group.scale.x *= spot.w / w0;
    it.w = spot.w;
  }
  applySpot(ctx, it, spot);
  return true;
}

/** Put a piece at a spot (moving what stands on it, its pictures, and a bed's nightstands and rug). */
function applySpot(ctx: BuildCtx, it: PlacedItem, spot: Spot): void {
  const comp = isBed(it) ? companionsAt(ctx, it, spot.box, spot.side) : null;
  const cx = (it.x0 + it.x1) / 2, cy = (it.y0 + it.y1) / 2;
  const dx = spot.x - cx, dy = spot.y - cy;
  const old = { side: it.against, x0: it.x0, x1: it.x1, y0: it.y0, y1: it.y1 };
  for (const q of [it, ...topsOn(ctx, it)]) shift(q, dx, dy);
  if (spot.rot !== (it.rot ?? 0)) {
    it.group.rotation.y += (spot.rot - (it.rot ?? 0)) * DEG;
    it.rot = spot.rot;
  }
  if (spot.side) it.against = spot.side;
  Object.assign(it, spot.box);
  rehang(ctx, it, old, dx, dy);
  if (comp) applyCompanions(ctx, comp);
}

const shift = (q: PlacedItem, dx: number, dy: number) => {
  q.group.position.x += dx * FT;
  q.group.position.z -= dy * FT;
  q.x0 += dx; q.x1 += dx; q.y0 += dy; q.y1 += dy;
};
const topsOn = (ctx: BuildCtx, it: PlacedItem) =>
  ctx.items.filter((q) => q !== it && q.room === it.room && q.cls === "top" && (q.x0 + q.x1) / 2 > it.x0 && (q.x0 + q.x1) / 2 < it.x1 && (q.y0 + q.y1) / 2 > it.y0 && (q.y0 + q.y1) / 2 < it.y1);

/** A bed's nightstands (against its wall, beside its head) and the rug under it. */
function companionsOf(ctx: BuildCtx, bed: PlacedItem): { stands: PlacedItem[]; rugs: PlacedItem[]; all: PlacedItem[] } {
  const ax = bed.against === "front" || bed.against === "back";
  const [a, b] = ax ? [bed.x0, bed.x1] : [bed.y0, bed.y1];
  const stands = ctx.items.filter((q) => {
    if (q.room !== bed.room || q.type !== "side_table" || q.against !== bed.against) return false;
    const [qa, qb] = ax ? [q.x0, q.x1] : [q.y0, q.y1];
    return Math.min(Math.abs(qa - b), Math.abs(a - qb)) < 0.8 || (qa < b && qb > a);
  });
  const rugs = ctx.items.filter((q) => q.room === bed.room && q.cls === "rug" && q.type === "rug" && (q.x0 + q.x1) / 2 > bed.x0 - 1 && (q.x0 + q.x1) / 2 < bed.x1 + 1 && (q.y0 + q.y1) / 2 > bed.y0 - 1 && (q.y0 + q.y1) / 2 < bed.y1 + 1);
  return { stands, rugs, all: [...stands, ...rugs] };
}

/** Where a bed's nightstands go when the bed stands at `box` against `side`: one at each side of its head, where they
 *  are free (a nightstand with no free place is left out). Rugs follow the bed's centre. */
function companionsAt(ctx: BuildCtx, bed: PlacedItem, box: Box, side?: string): { all: PlacedItem[]; moves: Move[]; plan: { q: PlacedItem; box: Box | null; rot: number; side?: string }[] } {
  if (!isBed(bed)) return { all: [], moves: [], plan: [] };
  const c = companionsOf(ctx, bed);
  const room = ctx.plan.room(bed.room)!;
  const s = side ?? bed.against;
  const plan: { q: PlacedItem; box: Box | null; rot: number; side?: string }[] = [];
  if (s && c.stands.length) {
    const inner = innerRect(ctx, room);
    const zones = keepOut(ctx, room).filter((z) => z.kind !== "window");
    const others = ctx.items.filter((q) => q.room === bed.room && q.cls === "floor" && q !== bed && !c.all.includes(q));
    const ov = (a: Box, b: Box, t = 0.06) => a.x0 < b.x1 - t && b.x0 < a.x1 - t && a.y0 < b.y1 - t && b.y0 < a.y1 - t;
    const ax0 = bed.against === "front" || bed.against === "back";
    const ax = s === "front" || s === "back";
    const [a, b] = ax ? [box.x0, box.x1] : [box.y0, box.y1];
    const used: Box[] = [];
    const sorted = [...c.stands].sort((p, q) => (ax0 ? p.x0 - q.x0 : p.y0 - q.y0));
    sorted.forEach((q, k) => {
      const w = q.w ?? q.x1 - q.x0, d = q.d ?? q.y1 - q.y0;
      const u = k === 0 ? a - 0.1 - w / 2 : b + 0.1 + w / 2;
      const across = s === "front" ? box.y0 + d / 2 : s === "back" ? box.y1 - d / 2 : s === "left" ? box.x0 + d / 2 : box.x1 - d / 2;
      const nb = ax ? footprint(u, across, w, d, 0) : footprint(across, u, w, d, 90);
      const fits = k < 2 && nb.x0 >= inner.x0 - 0.01 && nb.x1 <= inner.x1 + 0.01 && nb.y0 >= inner.y0 - 0.01 && nb.y1 <= inner.y1 + 0.01 && !zones.some((z) => ov(nb, z.core ?? z, 0.04)) && !others.some((o) => ov(nb, o, 0.08)) && !used.some((o) => ov(nb, o)) && !ov(nb, box);
      if (fits) used.push(nb);
      plan.push({ q, box: fits ? nb : null, rot: ROT[s], side: s });
    });
  }
  // the rug keeps its place relative to the bed (toward its foot), turned with it, and stays inside the room
  const FOOT: Record<string, [number, number]> = { front: [0, 1], back: [0, -1], left: [1, 0], right: [-1, 0] };
  const f0 = FOOT[bed.against ?? "front"] ?? [0, 1], f1 = FOOT[s ?? "front"] ?? f0;
  const turn = f0[0] !== 0 !== (f1[0] !== 0);
  const bx = (bed.x0 + bed.x1) / 2, by = (bed.y0 + bed.y1) / 2, nx = (box.x0 + box.x1) / 2, ny = (box.y0 + box.y1) / 2;
  const inner = innerRect(ctx, room);
  for (const r of c.rugs) {
    const ox = (r.x0 + r.x1) / 2 - bx, oy = (r.y0 + r.y1) / 2 - by;
    const along = ox * f0[0] + oy * f0[1], lat = -ox * f0[1] + oy * f0[0];
    let rx = nx + along * f1[0] - lat * f1[1], ry = ny + along * f1[1] + lat * f1[0];
    const hw = (turn ? r.y1 - r.y0 : r.x1 - r.x0) / 2, hd = (turn ? r.x1 - r.x0 : r.y1 - r.y0) / 2;
    rx = Math.min(Math.max(rx, inner.x0 + hw), inner.x1 - hw);
    ry = Math.min(Math.max(ry, inner.y0 + hd), inner.y1 - hd);
    const turned = (Math.round(Math.atan2(f1[1], f1[0]) / DEG) - Math.round(Math.atan2(f0[1], f0[0]) / DEG) + 360) % 360;
    plan.push({ q: r, box: { x0: rx - hw, x1: rx + hw, y0: ry - hd, y1: ry + hd }, rot: (r.rot ?? 0) + turned });
  }
  return { all: c.all, moves: plan.filter((p) => p.box && p.q.cls === "floor").map((p) => ({ it: p.q, box: p.box!, against: p.side })), plan };
}

/** Move a bed's nightstands (with their lamps) and rug to their planned places; a nightstand with none is left out. */
function applyCompanions(ctx: BuildCtx, comp: ReturnType<typeof companionsAt>): void {
  for (const p of comp.plan) {
    const q = p.q;
    if (!p.box) {
      drop(ctx, q);
      continue;
    }
    const dx = (p.box.x0 + p.box.x1) / 2 - (q.x0 + q.x1) / 2, dy = (p.box.y0 + p.box.y1) / 2 - (q.y0 + q.y1) / 2;
    for (const t of [q, ...topsOn(ctx, q)]) shift(t, dx, dy);
    if (p.rot !== (q.rot ?? 0)) {
      const dr = p.rot - (q.rot ?? 0);
      for (const t of [q, ...topsOn(ctx, q)]) {
        // (turn about the piece's own centre; a lamp keeps its place on the stand)
        t.group.rotation.y += dr * DEG;
        t.rot = (t.rot ?? 0) + dr;
      }
    }
    if (p.side) q.against = p.side;
    Object.assign(q, p.box);
  }
}

/** EN3-01: the smaller versions of a piece, in the order they are tried. */
function smallerSteps(it: PlacedItem): { type: string; w: number; d: number }[] {
  const dims = (t: string) => (ITEMS as Record<string, { dims: [number, number, number] }>)[t]?.dims ?? [it.w ?? 3, it.d ?? 2, 3];
  const w = it.w ?? it.x1 - it.x0, d = it.d ?? it.y1 - it.y0;
  const chain: Record<string, string[]> = {
    bed_king: ["bed_queen", "bed_single"], bed_queen: ["bed_single"],
    sofa_l: ["sofa_3", "sofa_2"], sofa_3: ["sofa_2"],
    dining_table_8: ["dining_table_6", "dining_table_4"], dining_table_6: ["dining_table_4"],
  };
  // (a bed ends as a compact 3.3 × 6.25 ft single before there is no bed)
  if (chain[it.type]) return [...chain[it.type].map((t) => ({ type: t, w: dims(t)[0], d: dims(t)[1] })), ...(it.type.startsWith("bed_") ? [{ type: "bed_single", w: 3.3, d: 6.25 }] : [])];
  if (it.type === "bed_single" && (w > 3.35 || d > 6.3)) return [{ type: "bed_single", w: 3.3, d: 6.25 }];
  if (it.type === "wardrobe") {
    // narrower (to 60 %, never under 2.5 ft: a single-door almirah), then also shallow (a 1.6 ft hanging unit)
    const nw = Math.max(2.5, w * 0.6);
    const out: { type: string; w: number; d: number }[] = [];
    if (nw < w - 0.1) out.push({ type: "wardrobe", w: nw, d });
    if (d > 1.65) out.push({ type: "wardrobe", w: Math.min(w, nw), d: 1.6 });
    return out;
  }
  if (it.type === "study_desk" && w > 3.1) return [{ type: "study_desk", w: 3, d: Math.min(d, 1.75) }];
  return [];
}

/**
 * EN3-01, step 2 of the repair: a smaller version of a piece the room keeps (a single bed for a queen; a narrower, then
 * shallower wardrobe), at the nearest spot where it frees the way. The same piece is resized; another kind of piece is
 * built again in its place (with the colour and material it was asked with) and its nightstands move up to it.
 */
function shrinkToFit(ctx: BuildCtx, it: PlacedItem, improves: (it2: PlacedItem, box: Box, side?: string) => boolean): boolean {
  for (const step of smallerSteps(it)) {
    const spot = findSpot(ctx, it, [step.w], step.d, (box, side) => improves(it, box, side));
    if (!spot) continue;
    const from = humanType(it.type);
    if (step.type === it.type && !isBed(it)) {
      if (it.w) it.group.scale.x *= step.w / it.w;
      if (it.d) it.group.scale.z *= step.d / it.d;
      it.w = step.w;
      it.d = step.d;
      applySpot(ctx, it, spot);
      warn(`walking path: the ${from} in ${it.room} made ${step.w.toFixed(1)} × ${step.d.toFixed(1)} ft to keep the way clear`);
      return true;
    }
    // (the bed's nightstands close up to the new, narrower bed; its rug follows it)
    const comp = isBed(it) ? companionsAt(ctx, it, spot.box, spot.side) : null;
    const next = rebuildAs(ctx, it, step.type as FurnitureType, { x: spot.x, y: spot.y, rot: spot.rot, side: spot.side as Side | undefined }, { w_ft: step.w, d_ft: step.d });
    if (!next) continue;
    if (comp) applyCompanions(ctx, comp);
    warn(`walking path: the ${from} in ${it.room} became a ${humanType(step.type)} to keep the way clear`);
    return true;
  }
  return false;
}

/** Pictures that hang over a moved piece: a mirror or painting over it moves along with it on the same wall and is
 *  taken down when it goes to another wall; a tall piece takes down the pictures it now stands in front of. EN3-03: a
 *  picture that followed its piece over a door or window is re-centred on solid wall, or taken down. */
function rehang(ctx: BuildCtx, it: PlacedItem, old: { side?: string; x0: number; x1: number; y0: number; y1: number }, dx: number, dy: number): void {
  const DECO = new Set(["mirror_wall", "painting"]);
  const along = (side: string | undefined, b: Box): [number, number] => (side === "front" || side === "back" ? [b.x0, b.x1] : [b.y0, b.y1]);
  for (const q of ctx.items.filter((q) => q !== it && q.room === it.room && q.cls === "wall" && DECO.has(q.type) && q.against && q.against === old.side)) {
    const [a, b] = along(old.side, old), [qa, qb] = along(old.side, q);
    if (qb <= a + 0.1 || qa >= b - 0.1) continue;
    if (it.against === old.side) {
      const sx = old.side === "front" || old.side === "back" ? dx : 0, sy = old.side === "left" || old.side === "right" ? dy : 0;
      q.group.position.x += sx * FT;
      q.group.position.z -= sy * FT;
      q.x0 += sx; q.x1 += sx; q.y0 += sy; q.y1 += sy;
      keepOffOpenings(ctx, q);
    } else takeDown(ctx, q);
  }
  if (it.h1 - it.h0 > 5 && it.against)
    for (const q of ctx.items.filter((q) => q !== it && q.room === it.room && q.cls === "wall" && DECO.has(q.type) && q.against === it.against)) {
      const [a, b] = along(it.against, it), [qa, qb] = along(it.against, q);
      if (qb > a + 0.1 && qa < b - 0.1) takeDown(ctx, q);
    }
}

/** Take a wall piece down (it is not a walk collider). */
function takeDown(ctx: BuildCtx, q: PlacedItem): void {
  q.group.removeFromParent();
  const k = ctx.items.indexOf(q);
  if (k >= 0) ctx.items.splice(k, 1);
}

/** wall decor that may never hang over a door or window */
const WALL_DECOR = new Set(["painting", "mirror_wall", "tv"]);

/**
 * EN3-03: a painting, mirror or wall TV never hangs over a door or window (the opening's span ± 0.3 ft, see
 * zones.solidIntervals). One that does is re-centred on the nearest solid stretch of its wall that is free of other wall
 * pieces at its height, or, with none, taken down quietly.
 */
function keepOffOpenings(ctx: BuildCtx, q: PlacedItem): void {
  const room = ctx.plan.room(q.room);
  if (!room || !q.against || !ctx.items.includes(q)) return;
  const side = q.against as Side;
  const ax = side === "front" || side === "back";
  const [a, b] = ax ? [q.x0, q.x1] : [q.y0, q.y1];
  const solid = solidIntervals(ctx, room, side);
  if (solid.some(([p, r]) => a >= p - 0.05 && b <= r + 0.05)) return;
  const others = ctx.items.filter((o) => o !== q && o.room === q.room && o.cls === "wall" && o.against === side && o.type !== "curtains" && o.h0 < q.h1 && q.h0 < o.h1);
  const free = subtract(solid, others.map((o) => (ax ? [o.x0 - 0.25, o.x1 + 0.25] : [o.y0 - 0.25, o.y1 + 0.25]) as Span));
  const w = b - a, c = (a + b) / 2;
  let best: number | null = null;
  for (const [p, r] of free) {
    if (r - p < w + 0.2) continue;
    const u = Math.min(Math.max(c, p + w / 2 + 0.1), r - w / 2 - 0.1);
    if (best === null || Math.abs(u - c) < Math.abs(best - c)) best = u;
  }
  if (best === null) {
    takeDown(ctx, q);
    warn(`wall decor: ${q.type} in ${q.room} taken down (no solid wall clear of doors and windows for it)`);
    return;
  }
  const du = best - c;
  if (ax) {
    q.group.position.x += du * FT;
    q.x0 += du;
    q.x1 += du;
  } else {
    q.group.position.z -= du * FT;
    q.y0 += du;
    q.y1 += du;
  }
}

/** EN3-03: the final sweep after a repair: no wall decor in these rooms hangs over a door or window. */
function sweepWallDecor(ctx: BuildCtx, rooms: Iterable<string>): void {
  const ids = new Set(rooms);
  for (const q of ctx.items.filter((q) => ids.has(q.room) && q.cls === "wall" && WALL_DECOR.has(q.type))) keepOffOpenings(ctx, q);
}

function drop(ctx: BuildCtx, it: PlacedItem): void {
  const deps = ctx.items.filter((q) => q !== it && q.room === it.room && q.cls === "top" && (q.x0 + q.x1) / 2 > it.x0 && (q.x0 + q.x1) / 2 < it.x1 && (q.y0 + q.y1) / 2 > it.y0 && (q.y0 + q.y1) / 2 < it.y1);
  for (const q of [it, ...deps]) {
    q.group.removeFromParent();
    const meshes = new Set<THREE.Object3D>();
    q.group.traverse((o) => meshes.add(o));
    ctx.colliders = ctx.colliders.filter((m) => !meshes.has(m));
    const k = ctx.items.indexOf(q);
    if (k >= 0) ctx.items.splice(k, 1);
  }
  // EN2-05: an optional piece that gives way to a walking path is left out quietly (the defining ones never are)
  warn(`walking path: ${it.type} in ${it.room} left out to keep the way to a door, window or bed clear`);
}

/** For checks: every room cluster's entries and which of them a 3 ft path does not reach. */
export function pathReport(ctx: BuildCtx): { rooms: string[]; entries: number; unreached: string[]; planSplit: boolean }[] {
  const out: { rooms: string[]; entries: number; unreached: string[]; planSplit: boolean }[] = [];
  const seen = new Set<string>();
  for (const room of ctx.plan.rooms) {
    if (seen.has(room.id) || room.cat === "outdoor") continue;
    const cl = clusterOf(ctx, room);
    for (const r of cl) seen.add(r.id);
    const ids = new Set(cl.map((r) => r.id));
    const entries = entriesOf(ctx, cl);
    if (entries.length < 2) continue;
    const g = baseGrid(ctx, cl);
    const m = g.base.slice();
    for (const it of ctx.items) if (ids.has(it.room) && it.cls === "floor") stampItem(g, m, it);
    const bareCells = connectivity(g, g.base, entries).cells;
    const bareLab = labels(g, g.base);
    const j = joined(g, m, entries, bareLab, bareCells);
    // entries walls keep apart (an open_to between rooms that do not touch): a plan issue, listed separately
    const groups = new Set(bareCells.filter((c) => c >= 0).map((c) => bareLab[c]));
    out.push({ rooms: cl.map((r) => r.id), entries: entries.length, unreached: j.blocked.map((k) => entries[k].what), planSplit: groups.size > 1 });
  }
  return out;
}

/**
 * EN3-01, for checks (the doorReach probe): per room cluster with a door, BFS on the furnished masks between its doors,
 * stair landings, window approaches and bed sides: the doors joined only by a squeeze under 3 ft ("tight"), the doors
 * no walker gets to at all ("lost"), and the windows and beds that cannot be reached from the doors.
 */
export function reachReport(ctx: BuildCtx): { rooms: string[]; entries: number; tight: string[]; lost: string[]; windows: string[]; beds: string[] }[] {
  const out: { rooms: string[]; entries: number; tight: string[]; lost: string[]; windows: string[]; beds: string[] }[] = [];
  const seen = new Set<string>();
  for (const room of ctx.plan.rooms) {
    if (seen.has(room.id) || room.cat === "outdoor") continue;
    const cl = clusterOf(ctx, room);
    for (const r of cl) seen.add(r.id);
    const M = reachModel(ctx, cl);
    if (!M.entries.length) continue;
    const e = M.evaluate();
    out.push({
      rooms: cl.map((r) => r.id),
      entries: M.entries.length,
      tight: e.blocked.filter((k) => !e.lost.includes(k)).map((k) => M.entries[k].what),
      lost: e.lost.map((k) => M.entries[k].what),
      windows: e.failed.filter((t) => t.kind === "window").map((t) => t.id ?? t.room.id),
      beds: e.failed.filter((t) => t.kind === "bed").map((t) => t.room.id),
    });
  }
  return out;
}

/**
 * EN3-01, for the bed placer (auto_furnish): what a piece at `box` against `side` would cut off in its room as it is
 * furnished so far: 1000 for each door no longer joined by 3 ft, 100 more when it is not reached at all, 10 for each
 * window or bed side out of reach. 0 when it leaves every way open.
 */
export function wayCost(ctx: BuildCtx, roomId: string, type: string, box: Box, side?: string): number {
  const room = ctx.plan.room(roomId);
  if (!room || !ctx.structureBuilt) return 0;
  const M = reachModel(ctx, clusterOf(ctx, room));
  if (!M.entries.length) return 0;
  const probe = { id: "probe", type, room: roomId, ...box, h0: room.floorH, h1: room.floorH + 3.6, cls: "floor", topH: null, against: side } as unknown as PlacedItem;
  return -M.evaluate([], [{ it: probe, box, against: side }]).total;
}

/** Dev: the reach mask of a room's cluster as text rows ("#" blocked, "." walkable, "o" a target cell not reached,
 *  "*" a target cell reached, "E" an entry), y rows from the front. */
export function reachAscii(ctx: BuildCtx, roomId: string): string[] {
  const room = ctx.plan.room(roomId);
  if (!room) return [];
  const M = reachModel(ctx, clusterOf(ctx, room));
  const { g } = M;
  const mR = g.base.slice();
  for (const it of M.obstacles()) if (!PUSHED_ASIDE.has(it.type)) stampItem(g, mR, it, it, REACH, true);
  const e = M.evaluate();
  const failed = new Set(e.failed.flatMap((t) => t.cells));
  const all = new Set([...windowTargets(ctx, g, clusterOf(ctx, room)).flatMap((t) => t.cells)]);
  const ent = new Set(connectivity(g, mR, M.entries).cells);
  const rows: string[] = [];
  for (let j = 0; j < g.ny; j++) {
    let s = "";
    for (let i = 0; i < g.nx; i++) {
      const k = j * g.nx + i;
      s += ent.has(k) ? "E" : failed.has(k) ? (mR[k] ? "o" : "x") : all.has(k) && mR[k] ? "*" : mR[k] ? "." : "#";
    }
    rows.push(`${(g.y0 + (j + 0.5) * CELL).toFixed(2).padStart(6)} ${s}`);
  }
  return rows;
}

function labels(g: Grid, mask: Uint8Array): Int32Array {
  const { nx, ny } = g;
  const comp = new Int32Array(nx * ny).fill(-1);
  let nc = 0;
  for (let s = 0; s < nx * ny; s++) {
    if (!mask[s] || comp[s] >= 0) continue;
    const q = [s];
    comp[s] = nc;
    while (q.length) {
      const cur = q.pop()!;
      const ci = cur % nx, cj = (cur - ci) / nx;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const i = ci + di, j = cj + dj;
        if (i < 0 || j < 0 || i >= nx || j >= ny) continue;
        const k = j * nx + i;
        if (!mask[k] || comp[k] >= 0) continue;
        comp[k] = nc;
        q.push(k);
      }
    }
    nc++;
  }
  return comp;
}

/** For the dev plan overlay: the walkable mask of a cluster after furniture (1 = a 3 ft path can pass). */
export function pathMask(ctx: BuildCtx, room: RoomM): { x0: number; y0: number; nx: number; ny: number; cell: number; mask: Uint8Array; entries: { x: number; y: number; what: string }[] } {
  const cl = clusterOf(ctx, room);
  const ids = new Set(cl.map((r) => r.id));
  const g = baseGrid(ctx, cl);
  const m = g.base.slice();
  for (const it of ctx.items) if (ids.has(it.room) && it.cls === "floor") stampItem(g, m, it);
  return { x0: g.x0, y0: g.y0, nx: g.nx, ny: g.ny, cell: CELL, mask: m, entries: entriesOf(ctx, cl) };
}
