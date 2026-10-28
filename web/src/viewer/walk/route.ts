/**
 * Room navigator: plans a walk from where you stand to a room, a floor or a point, the way a person would go —
 * along a walkability grid on each floor (through doorways, around furniture) and up or down the engine's stair
 * ramps between floors — and decides where to stop and which way to face.
 *
 * Falls back to the plan's room graph (doors, open-plan edges, outdoor areas) when the grid finds no way through
 * (e.g. furniture in a doorway), and reports "no route" when even the plan has no door to the room.
 */
import * as THREE from "three";
import type { BuildingPlan, Level, Opening, Room } from "@contracts/plan";
import { FT, clamp, zOf } from "../core/units";
import { BLOCK, NavGrid, type SolidClassifier } from "./navgrid";
import { EYE, STEP_UP, type WalkController } from "./WalkController";

export type NavTarget =
  | { kind: "room"; room: Room }
  | { kind: "level"; level: Level }
  | { kind: "point"; level: Level; x: number; z: number };

export interface RoutePlan {
  ok: boolean;
  /** Dense feet positions (world m), start → end. */
  pts: THREE.Vector3[];
  /** Final stance. */
  end: THREE.Vector3;
  yaw: number;
  pitch: number;
  length: number;
  /** Per point: how slowly to take the segment that ends there (stairs are taken slower than floors). */
  weights: number[];
  /** Length weighted by `weights` (drives the glide's duration). */
  timeLength: number;
  /** The route uses a stair. */
  stairs: boolean;
  /** Route as plan-feet polylines per level (for the minimap). */
  byLevel: Record<string, [number, number][]>;
  /** True when part of the route ignores furniture (room-graph fallback). */
  rough?: boolean;
  /** The only way in goes through something solid at eye height (a wardrobe in a doorway): don't glide it. */
  blocked?: boolean;
  reason?: string;
}

/**
 * Why no walk reaches a room: planting (a landscape solid) or furniture seals it off, something else solid does
 * (a parked car, the water tank), or no door joins it (in the plan, or in the built house).
 */
export type BlockCause = "planting" | "furniture" | "other" | "nodoor";

/** Outdoor areas that are a hole in an upper floor (a light court seen from the floor above), not a floor. */
const VOID_TYPES = new Set(["open_space", "courtyard", "lawn", "driveway"]);

interface StairPath {
  id: string;
  from: string;
  to: string;
  /** feet positions from the foot (on `from`) to the arrival (on `to`) */
  pts: THREE.Vector3[];
}

const OUTDOOR = new Set(["porch", "balcony", "terrace", "lawn", "driveway", "courtyard", "open_space", "garage"]);
const WALKABLE_OPENINGS = new Set<Opening["type"]>(["main_door", "door", "double_door", "sliding_door", "arch", "garage_door"]);
const LOOK_PITCH = -0.06;
/** Stairs are glided at well under half the floor speed (a quick glide down a flight is dizzying). */
const STAIR_WEIGHT = 2.8;


/** Low/high end centres of an invisible stair ramp (world), from its extreme vertices. */
function rampEnds(m: THREE.Mesh) {
  m.updateWorldMatrix(true, false);
  const pos = m.geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!pos || pos.count < 3) return null;
  const vs: THREE.Vector3[] = [];
  for (let i = 0; i < pos.count; i++) vs.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld));
  let minY = Infinity, maxY = -Infinity;
  for (const v of vs) {
    minY = Math.min(minY, v.y);
    maxY = Math.max(maxY, v.y);
  }
  const avg = (arr: THREE.Vector3[]) => arr.reduce((s, v) => s.add(v), new THREE.Vector3()).multiplyScalar(1 / Math.max(1, arr.length));
  const lo = avg(vs.filter((v) => v.y < minY + 0.03));
  const hi = avg(vs.filter((v) => v.y > maxY - 0.03));
  if (Math.hypot(hi.x - lo.x, hi.z - lo.z) < 0.15) return null; // a landing, not a flight
  return { lo, hi, minY, maxY };
}

function roomWorldRect(r: Room, inset = 0) {
  return {
    x0: r.rect.x * FT + inset,
    x1: (r.rect.x + r.rect.w) * FT - inset,
    z0: zOf(r.rect.y + r.rect.d) + inset,
    z1: zOf(r.rect.y) - inset,
  };
}

export class Navigator {
  private grids = new Map<string, NavGrid>();
  private stairs: StairPath[] | null = null;
  /** Points that lie on a stair flight (shared with the cached stair paths). */
  private stairSet = new WeakSet<THREE.Vector3>();
  /**
   * How far you can see from a point along a direction (visible geometry: a water tank or a wardrobe may not be a
   * collider). Defaults to the walk collider.
   */
  sight: ((from: THREE.Vector3, dir: THREE.Vector3, max: number) => number) | null = null;
  /** Tells planting from furniture where a solid blocks a grid cell (set by the viewer, which knows the elements). */
  classify: SolidClassifier | null = null;
  /** Where every walk starts: the main door approach (feet, world). The house's own circulation is what joins it. */
  entry: THREE.Vector3 | null = null;
  private colliders: THREE.Mesh[] = [];

  constructor(
    private plan: BuildingPlan,
    private walk: WalkController,
  ) {}

  /** A new collider was built (new house, toggles): forget grids and stair paths. */
  reset(plan: BuildingPlan, colliders: THREE.Mesh[]) {
    this.plan = plan;
    this.colliders = colliders;
    this.grids.clear();
    this.stairs = null;
  }

  get levels() {
    return [...this.plan.levels].sort((a, b) => a.index - b.index);
  }

  levelAt(y: number): Level {
    const ls = this.levels;
    let lvl = ls[0];
    for (const l of ls) if (l.elevation_ft * FT <= y + 0.45) lvl = l;
    return lvl;
  }

  grid(levelId: string, budgetMs = Infinity): NavGrid | null {
    if (!this.walk.bvh) return null;
    let g = this.grids.get(levelId);
    if (!g) {
      const lvl = this.plan.levels.find((l) => l.id === levelId);
      if (!lvl) return null;
      const W = this.plan.site.plot.width_ft, D = this.plan.site.plot.depth_ft;
      const lowest = this.levels[0]?.id === levelId;
      // the ground floor also covers the footpath in front of the plot (the walk starts outside)
      const y0 = lowest ? -14 : -3;
      g = new NavGrid(levelId, lvl.elevation_ft * FT, { x0: -0.4, x1: W * FT + 0.4, z0: zOf(D + 1), z1: zOf(y0) }, 0.2, lowest ? [-0.75, 0.4] : [-0.35, 0.35]);
      this.grids.set(levelId, g);
    }
    g.build(this.walk, budgetMs, this.classify);
    return g.ready ? g : null;
  }

  /** Build grids a little at a time (call from the frame loop while walking). Returns true when all are ready. */
  warm(budgetMs: number): boolean {
    if (!this.walk.bvh) return false;
    const t0 = performance.now();
    for (const l of this.levels) {
      const left = budgetMs - (performance.now() - t0);
      if (left <= 0) return false;
      if (!this.grid(l.id, left)) return false;
    }
    this.stairPaths();
    return true;
  }

  // ───────────────────────────── stairs ─────────────────────────────

  stairPaths(): StairPath[] {
    if (this.stairs) return this.stairs;
    const out: StairPath[] = [];
    for (const s of this.plan.stairs ?? []) {
      const ramps = this.colliders
        .filter((m) => typeof m.userData?.id === "string" && m.userData.id.startsWith(`${s.id}_`) && /ramp/.test(String(m.userData.kind ?? m.userData.id)))
        .map(rampEnds)
        .filter((r): r is NonNullable<ReturnType<typeof rampEnds>> => !!r)
        .sort((a, b) => a.minY - b.minY);
      const from = this.plan.levels.find((l) => l.id === s.from_level), to = this.plan.levels.find((l) => l.id === s.to_level);
      if (!from || !to) continue;
      const xz: THREE.Vector3[] = [];
      if (ramps.length) {
        const dirOf = (r: (typeof ramps)[number]) => new THREE.Vector3(r.hi.x - r.lo.x, 0, r.hi.z - r.lo.z).normalize();
        // step off each end onto the floor, but never through the wall a stair often starts against
        const fy = from.elevation_ft * FT, ty = to.elevation_ft * FT;
        xz.push(this.extendFree(ramps[0].lo.clone().setY(fy), dirOf(ramps[0]).negate(), 0.5));
        for (const r of ramps) xz.push(r.lo.clone(), r.hi.clone());
        const last = ramps[ramps.length - 1];
        xz.push(this.extendFree(last.hi.clone().setY(ty), dirOf(last), 0.6));
      } else {
        // no ramps (older engines): straight across the stair rect
        const r = s.rect;
        const startEdge: Record<string, [number, number, number, number]> = {
          "+y": [r.x + r.w / 2, r.y, r.x + r.w / 2, r.y + r.d],
          "-y": [r.x + r.w / 2, r.y + r.d, r.x + r.w / 2, r.y],
          "+x": [r.x, r.y + r.d / 2, r.x + r.w, r.y + r.d / 2],
          "-x": [r.x + r.w, r.y + r.d / 2, r.x, r.y + r.d / 2],
        };
        const [ax, ay, bx, by] = startEdge[s.start] ?? startEdge["+y"];
        xz.push(new THREE.Vector3(ax * FT, from.elevation_ft * FT, zOf(ay)), new THREE.Vector3(bx * FT, to.elevation_ft * FT, zOf(by)));
      }
      // densify and drop onto the walkable surface (ramp tops, landings, floors)
      const y0 = from.elevation_ft * FT, y1 = to.elevation_ft * FT;
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i < xz.length; i++) {
        if (i === 0) {
          pts.push(xz[0].clone().setY(y0));
          continue;
        }
        const a = xz[i - 1], b = xz[i];
        const n = Math.max(1, Math.ceil(a.distanceTo(b) / 0.15));
        for (let k = 1; k <= n; k++) pts.push(new THREE.Vector3().lerpVectors(a, b, k / n));
      }
      pts[pts.length - 1].y = y1;
      for (const p of pts) {
        const approx = clamp(p.y, Math.min(y0, y1) - 0.2, Math.max(y0, y1) + 0.2);
        const g = this.walk.groundAt1(p.x, p.z, approx + 0.55, approx - 0.8);
        if (g !== null) p.y = g;
      }
      pts[0].y = this.walk.groundAt1(pts[0].x, pts[0].z, y0 + 0.4, y0 - 0.4) ?? y0;
      for (const p of pts) this.stairSet.add(p);
      out.push({ id: s.id, from: s.from_level, to: s.to_level, pts });
    }
    this.stairs = out;
    return out;
  }

  /**
   * From inside the stair tower on the roof, the shortest walk out of it to open terrace (a spot with some room
   * around it), or null when the tower has no way out.
   */
  private outOfTower(level: Level, from: THREE.Vector3): THREE.Vector3[] | null {
    const m = this.plan.roof?.mumty?.rect;
    const g = this.grid(level.id);
    if (!m || !g) return null;
    const tower = { x0: m.x * FT - 0.3, x1: (m.x + m.w) * FT + 0.3, z0: zOf(m.y + m.d) - 0.3, z1: zOf(m.y) + 0.3 };
    const s = this.nearestReachable(g, from);
    if (s < 0 || !g.inRect(s, tower)) return null;
    const fl = g.flood(s);
    let goal = -1, best = Infinity;
    for (let i = 0; i < g.free.length; i++) {
      if (!Number.isFinite(fl.cost[i]) || g.inRect(i, tower) || g.clr[i] < 3) continue;
      if (fl.cost[i] < best) {
        best = fl.cost[i];
        goal = i;
      }
    }
    const cells = goal >= 0 ? NavGrid.trace(fl.came, s, goal) : null;
    if (!cells) return null;
    const turns = g.simplify(cells).map((i) => g.center(i));
    return roundCorners(dedupe([from.clone(), ...turns.slice(1)]), g);
  }

  /** Does the path pass through anything solid at eye height? */
  private crossesAtEye(pts: THREE.Vector3[]): boolean {
    if (!this.walk.bvh) return false;
    const ray = new THREE.Ray();
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      ray.origin.set(a.x, a.y + EYE - 0.1, a.z);
      ray.direction.set(b.x - a.x, b.y - a.y, b.z - a.z);
      const len = ray.direction.length();
      if (len < 1e-4) continue;
      ray.direction.multiplyScalar(1 / len);
      if (this.walk.raycastAny(ray, 0, len) !== null) return true;
    }
    return false;
  }

  /** Walk from `p` (on a floor) along `dir` up to `max` m, stopping before anything solid. */
  private extendFree(p: THREE.Vector3, dir: THREE.Vector3, max: number): THREE.Vector3 {
    let best = p.clone();
    const q = new THREE.Vector3();
    for (let t = 0.05; t <= max + 1e-6; t += 0.05) {
      q.copy(p).addScaledVector(dir, t);
      const g = this.walk.groundAt1(q.x, q.z, p.y + 0.4, p.y - 0.4);
      if (g === null || Math.abs(g - p.y) > 0.3) break;
      q.y = g;
      if (this.walk.overlaps(q, 0.18)) break;
      best = q.clone();
    }
    return best;
  }

  /**
   * The free grid cell nearest to `p` that can actually see it (a clear straight step at knee height), so a route
   * never joins a stair or a door from the far side of a wall.
   */
  private nearestReachable(g: NavGrid, p: THREE.Vector3, maxR = 1.6): number {
    const R = Math.ceil(maxR / g.cell);
    const c = g.cellAt(p.x, p.z);
    if (c >= 0 && g.free[c] && Math.abs(g.h[c] - p.y) < 0.6) return c;
    const ix0 = Math.floor((p.x - g.b.x0) / g.cell), iz0 = Math.floor((p.z - g.b.z0) / g.cell);
    const cand: [number, number][] = [];
    for (let iz = iz0 - R; iz <= iz0 + R; iz++) {
      if (iz < 0 || iz >= g.nz) continue;
      for (let ix = ix0 - R; ix <= ix0 + R; ix++) {
        if (ix < 0 || ix >= g.nx) continue;
        const i = g.idx(ix, iz);
        if (!g.free[i] || Math.abs(g.h[i] - p.y) > 0.6) continue;
        const d = Math.hypot(g.cx(i) - p.x, g.cz(i) - p.z);
        if (d <= maxR) cand.push([d, i]);
      }
    }
    cand.sort((a, b) => a[0] - b[0]);
    const from = new THREE.Vector3(), dir = new THREE.Vector3();
    for (const [d, i] of cand.slice(0, 80)) {
      from.set(g.cx(i), g.h[i] + 0.5, g.cz(i));
      dir.set(p.x - from.x, 0, p.z - from.z);
      if (d < 1e-3 || this.walk.clearDistance(from, dir.normalize(), d) >= d - 0.02) return i;
    }
    return cand[0]?.[1] ?? -1;
  }

  /** Stairs to climb/descend from level a to level b (BFS over the stair graph), each oriented in travel order. */
  private stairChain(a: string, b: string): THREE.Vector3[][] | null {
    if (a === b) return [];
    const paths = this.stairPaths();
    const prev = new Map<string, { from: string; pts: THREE.Vector3[] }>();
    const q = [a];
    const seen = new Set([a]);
    while (q.length) {
      const cur = q.shift()!;
      if (cur === b) break;
      for (const s of paths) {
        const step = s.from === cur ? { next: s.to, pts: s.pts } : s.to === cur ? { next: s.from, pts: [...s.pts].reverse() } : null;
        if (!step || seen.has(step.next)) continue;
        seen.add(step.next);
        prev.set(step.next, { from: cur, pts: step.pts });
        q.push(step.next);
      }
    }
    if (!prev.has(b)) return null;
    const chain: THREE.Vector3[][] = [];
    for (let c = b; c !== a; ) {
      const p = prev.get(c)!;
      chain.unshift(p.pts);
      c = p.from;
    }
    return chain;
  }

  // ───────────────────────────── floors ─────────────────────────────

  /** Path on one floor between two feet positions: grid A* (string-pulled, corners rounded), else the room graph. */
  private floorPath(levelId: string, a: THREE.Vector3, b: THREE.Vector3): { pts: THREE.Vector3[]; rough: boolean } | null {
    const g = this.grid(levelId);
    if (g) {
      const s = this.nearestReachable(g, a), e = this.nearestReachable(g, b);
      const cells = s >= 0 && e >= 0 ? g.findPath(s, e) : null;
      if (cells) {
        const turns = g.simplify(cells).map((i) => g.center(i));
        const way = [a.clone(), ...turns.slice(1, -1), b.clone()];
        return { pts: roundCorners(dedupe(way), g), rough: false };
      }
    }
    const lvl = this.plan.levels.find((l) => l.id === levelId);
    if (!lvl) return null;
    const rough = roomGraphPath(this.plan, lvl, a, b);
    return rough ? { pts: roundCorners(dedupe(rough), null), rough: true } : null;
  }

  // ───────────────────────────── routing ─────────────────────────────

  route(from: THREE.Vector3, target: NavTarget): RoutePlan {
    const fail = (reason: string): RoutePlan => ({ ok: false, pts: [], end: from.clone(), yaw: 0, pitch: 0, length: 0, weights: [], timeLength: 0, stairs: false, byLevel: {}, reason });
    const startLevel = this.levelAt(from.y);
    const goalLevel = target.kind === "room" ? this.plan.levels.find((l) => l.id === target.room.level) : target.level;
    if (!goalLevel) return fail("unknown level");
    const chain = this.stairChain(startLevel.id, goalLevel.id);
    if (!chain) return fail("no stair");
    const pts: THREE.Vector3[] = [from.clone()];
    let rough = false;
    let cur = from.clone();
    let curLevel = startLevel.id;
    for (const stair of chain) {
      const seg = this.floorPath(curLevel, cur, stair[0]);
      if (!seg) return fail("no path to the stair");
      rough ||= seg.rough;
      pts.push(...seg.pts.slice(1), ...stair.slice(1));
      cur = stair[stair.length - 1].clone();
      curLevel = this.levelAt(cur.y).id;
    }
    // step off the stair onto a free spot
    const gl = this.grid(goalLevel.id);
    if (chain.length && gl) {
      const c = this.nearestReachable(gl, cur, 1.2);
      if (c >= 0) {
        const p = gl.center(c);
        if (p.distanceTo(cur) > 0.05) pts.push(p);
        cur = p;
      }
    }
    let end: THREE.Vector3;
    let face: number;
    if (target.kind === "room") {
      const res = this.roomStand(target.room, cur);
      if (!res) return fail("no spot in the room");
      rough ||= res.rough;
      pts.push(...res.pts.slice(1));
      end = res.end;
      face = res.yaw;
    } else if (target.kind === "point") {
      const want = new THREE.Vector3(target.x, goalLevel.elevation_ft * FT, target.z);
      const c = gl?.nearestFree(want.x, want.z, 2.0);
      const dest = c !== undefined && c >= 0 ? gl!.center(c) : want;
      const seg = this.floorPath(goalLevel.id, cur, dest);
      if (!seg) return fail("no path");
      rough ||= seg.rough;
      pts.push(...seg.pts.slice(1));
      end = pts[pts.length - 1].clone();
      const a = pts[Math.max(0, pts.length - 6)];
      face = Math.hypot(end.x - a.x, end.z - a.z) > 0.1 ? Math.atan2(-(end.x - a.x), -(end.z - a.z)) : this.walk.yaw;
    } else {
      // the roof: the stair arrives inside the stair tower; step out through its door onto the terrace
      const out = this.plan.rooms.some((r) => r.level === goalLevel.id) ? null : this.outOfTower(goalLevel, cur);
      if (out) {
        pts.push(...out.slice(1));
        cur = out[out.length - 1].clone();
      }
      end = cur.clone();
      face = this.intoFloorYaw(goalLevel, end, pts);
    }
    // a stance the real capsule fits (the grid probes a slimmer one)
    const snug = this.walk.overlaps(end) ? this.walk.findFreeSpot(end, end.y, 0.6) : null;
    if (snug) {
      pts.push(snug);
      end = snug;
    }
    const clean = dedupe(pts);
    let length = 0, timeLength = 0;
    const weights = [0];
    for (let i = 1; i < clean.length; i++) {
      const d = clean[i].distanceTo(clean[i - 1]);
      const w = this.stairSet.has(clean[i]) && this.stairSet.has(clean[i - 1]) ? STAIR_WEIGHT : 1;
      weights.push(w);
      length += d;
      timeLength += d * w;
    }
    const blocked = rough && this.crossesAtEye(clean);
    return { ok: true, pts: clean, end, yaw: face, pitch: LOOK_PITCH, length, weights, timeLength, stairs: chain.length > 0, byLevel: this.splitByLevel(clean), rough, blocked };
  }

  /** Where to stand in a room (just inside, a step past the door) and which way to look (into the room). */
  private roomStand(room: Room, from: THREE.Vector3): { pts: THREE.Vector3[]; end: THREE.Vector3; yaw: number; rough: boolean } | null {
    const lvl = this.plan.levels.find((l) => l.id === room.level)!;
    const floorY = lvl.elevation_ft * FT;
    const rect = roomWorldRect(room);
    const inner = roomWorldRect(room, Math.min(0.35, (Math.min(room.rect.w, room.rect.d) * FT) / 4));
    const centre = new THREE.Vector3((rect.x0 + rect.x1) / 2, floorY, (rect.z0 + rect.z1) / 2);
    const g = this.grid(room.level);
    const inside = (p: THREE.Vector3) => p.x >= rect.x0 && p.x <= rect.x1 && p.z >= rect.z0 && p.z <= rect.z1 && Math.abs(p.y - floorY) < 0.8;
    const faceFrom = (p: THREE.Vector3) => faceInto(rect, p);
    if (g) {
      // the reachable free cell nearest the room's middle, preferring open floor (furniture can wall part of a
      // room off: then you stop where you can stand and still see the room)
      const s = this.nearestReachable(g, from);
      const fl = g.flood(s);
      let goal = -1, gd = Infinity;
      for (let i = 0; i < g.free.length; i++) {
        if (!Number.isFinite(fl.cost[i]) || !g.inRect(i, inner) || Math.abs(g.h[i] - floorY) > 0.6) continue;
        const d = Math.hypot(g.cx(i) - centre.x, g.cz(i) - centre.z) - Math.min(g.clr[i], 3) * 0.35;
        if (d < gd) {
          gd = d;
          goal = i;
        }
      }
      // nothing reachable inside the inset rect: try right up to the walls
      if (goal < 0)
        for (let i = 0; i < g.free.length; i++) {
          if (!Number.isFinite(fl.cost[i]) || !g.inRect(i, rect) || Math.abs(g.h[i] - floorY) > 0.6) continue;
          const d = Math.hypot(g.cx(i) - centre.x, g.cz(i) - centre.z);
          if (d < gd) {
            gd = d;
            goal = i;
          }
        }
      const cells = goal >= 0 && s >= 0 ? NavGrid.trace(fl.came, s, goal) : null;
      if (cells) {
        let stop = cells.length - 1;
        if (!inside(from)) {
          // stop a step inside the room, past the doorway, where there is room to stand
          let entry = 0;
          for (let k = 1; k < cells.length; k++) if (!g.inRect(cells[k - 1], rect) && g.inRect(cells[k], rect)) entry = k;
          let acc = 0;
          stop = entry;
          for (let k = entry + 1; k < cells.length; k++) {
            acc += Math.hypot(g.cx(cells[k]) - g.cx(cells[k - 1]), g.cz(cells[k]) - g.cz(cells[k - 1]));
            stop = k;
            if (acc >= 1.25 && g.clr[cells[k]] >= 2) break;
          }
        }
        const kept = cells.slice(0, stop + 1);
        const turns = g.simplify(kept).map((i) => g.center(i));
        const pts = roundCorners(dedupe([from.clone(), ...turns.slice(1)]), g);
        const end = pts[pts.length - 1].clone();
        return { pts, end, yaw: faceFrom(end), rough: false };
      }
    }
    // fallback: the plan's doors, to a spot inside the room (never one through its wall in the room next door)
    const spot = this.roomStance(room)?.end ?? centre;
    const rough = roomGraphPath(this.plan, lvl, from, spot);
    if (!rough) return null;
    const pts = roundCorners(dedupe(rough), null);
    return { pts, end: pts[pts.length - 1].clone(), yaw: faceFrom(spot), rough: true };
  }

  /**
   * A room you can't stand in: an outdoor area on an upper floor (the light court seen from above), or a room whose
   * floor isn't there in the built house (open to the floor below).
   */
  isVoid(room: Room): boolean {
    const lvl = this.plan.levels.find((l) => l.id === room.level);
    if (!lvl) return false;
    const lowest = this.levels[0];
    if (lowest && lvl.index > lowest.index && VOID_TYPES.has(room.type)) return true;
    // a stair hall is mostly stairwell: never call it a void
    const g = this.walk.bvh && room.type !== "stair" ? this.grid(room.level) : null;
    if (!g) return false;
    const rect = roomWorldRect(room, Math.min(0.3, (Math.min(room.rect.w, room.rect.d) * FT) / 4));
    let cells = 0, floor = 0;
    for (let i = 0; i < g.free.length; i++) {
      if (!g.inRect(i, rect)) continue;
      cells++;
      if (Number.isFinite(g.h[i])) floor++;
    }
    return cells > 4 && floor < cells * 0.2;
  }

  /**
   * Where to stand when brought straight into a room (a crossfade): the free spot inside the room's rect nearest its
   * middle with the most room around it, looking into the room. Null when nothing inside fits you.
   */
  roomStance(room: Room): { end: THREE.Vector3; yaw: number } | null {
    const lvl = this.plan.levels.find((l) => l.id === room.level);
    if (!lvl) return null;
    const floorY = lvl.elevation_ft * FT;
    const rect = roomWorldRect(room);
    const inner = roomWorldRect(room, Math.min(0.35, (Math.min(room.rect.w, room.rect.d) * FT) / 4));
    const centre = new THREE.Vector3((rect.x0 + rect.x1) / 2, floorY, (rect.z0 + rect.z1) / 2);
    const within = (p: THREE.Vector3) => p.x >= rect.x0 && p.x <= rect.x1 && p.z >= rect.z0 && p.z <= rect.z1;
    const fits = (p: THREE.Vector3) => within(p) && !this.walk.overlaps(p);
    const g = this.walk.bvh ? this.grid(room.level) : null;
    if (g) {
      for (const area of [inner, rect]) {
        const cand: [number, number][] = [];
        for (let i = 0; i < g.free.length; i++) {
          if (!g.free[i] || !g.inRect(i, area) || Math.abs(g.h[i] - floorY) > 0.8) continue;
          cand.push([Math.hypot(g.cx(i) - centre.x, g.cz(i) - centre.z) - Math.min(g.clr[i], 3) * 0.35, i]);
        }
        cand.sort((a, b) => a[0] - b[0]);
        for (const [, i] of cand.slice(0, 60)) {
          const p = g.center(i);
          if (fits(p)) return { end: p, yaw: faceInto(rect, p) };
        }
      }
    }
    // no grid (or nothing on it): spiral out from the middle, on whatever floor the room has, inside its walls
    const top = floorY + STEP_UP + 0.02, bottom = floorY - 0.8;
    const p = new THREE.Vector3();
    const maxR = Math.hypot(rect.x1 - rect.x0, rect.z1 - rect.z0) / 2;
    for (let r = 0; r <= maxR + 1e-4; r += 0.2) {
      const n = r === 0 ? 1 : Math.ceil((2 * Math.PI * r) / 0.3);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        p.set(centre.x + Math.cos(a) * r, floorY, centre.z + Math.sin(a) * r);
        if (!within(p)) continue;
        const gy = this.walk.groundAt(p, top, bottom);
        if (gy === null) continue;
        p.y = gy;
        if (fits(p)) return { end: p.clone(), yaw: faceInto(rect, p) };
      }
    }
    return null;
  }

  /** Free cells on a level that the house's circulation joins: the main door approach and the stair ends. */
  private anchorCells(level: Level, g: NavGrid): number[] {
    const out: number[] = [];
    if (this.entry && this.levelAt(this.entry.y).id === level.id) {
      const c = this.nearestReachable(g, this.entry, 2.0);
      if (c >= 0) out.push(c);
    }
    for (const s of this.stairPaths()) {
      const ends: [string, THREE.Vector3][] = [
        [s.from, s.pts[0]],
        [s.to, s.pts[s.pts.length - 1]],
      ];
      for (const [lv, p] of ends) {
        if (lv !== level.id || !p) continue;
        const c = this.nearestReachable(g, p, 1.2);
        if (c >= 0) out.push(c);
      }
    }
    return out;
  }

  /**
   * When `from` stands in a pocket the house's circulation doesn't reach (you were brought straight into a yard that
   * planting seals off): the nearest connected spot to walk on from. Null when `from` is connected, or unknown.
   */
  escape(from: THREE.Vector3): THREE.Vector3 | null {
    const lvl = this.levelAt(from.y);
    const g = this.grid(lvl.id);
    if (!g) return null;
    const comp = g.components();
    const main = new Set(this.anchorCells(lvl, g).map((c) => comp[c]).filter((c) => c >= 0));
    if (!main.size) return null;
    const s = this.nearestReachable(g, from);
    if (s >= 0 && main.has(comp[s])) return null;
    let best = -1, bd = Infinity;
    for (let i = 0; i < g.free.length; i++) {
      if (!g.free[i] || g.clr[i] < 2 || !main.has(comp[i]) || Math.abs(g.h[i] - from.y) > 0.6) continue;
      const d = Math.hypot(g.cx(i) - from.x, g.cz(i) - from.z);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    if (best < 0) return null;
    const p = g.center(best);
    if (!this.walk.overlaps(p)) return p;
    const q = this.walk.findFreeSpot(p, p.y, 0.4);
    return q && comp[g.cellAt(q.x, q.z)] === comp[best] ? q : p;
  }

  /**
   * Why the grid finds no walk from `from` into `room`. "nodoor" when the plan joins the room to nothing you can
   * reach (or, built, its door isn't there); otherwise the solids that seal it off: the room comes within reach once
   * the planting (then the furniture, then anything solid) is taken away.
   */
  blockCause(room: Room, from: THREE.Vector3): BlockCause {
    const lvl = this.plan.levels.find((l) => l.id === room.level);
    if (!lvl) return "nodoor";
    const fromLvl = this.levelAt(from.y);
    // the plan: a door (or an open edge, or a yard) joins the room to where you can come from on its floor
    const { at, adj } = planGraph(this.plan, lvl);
    const lowest = this.levels[0]?.id === lvl.id;
    const startRooms: string[] = [];
    if (fromLvl.id === lvl.id) startRooms.push(at(from));
    for (const s of this.stairPaths()) {
      if (s.from === lvl.id && s.pts[0]) startRooms.push(at(s.pts[0]));
      if (s.to === lvl.id && s.pts.length) startRooms.push(at(s.pts[s.pts.length - 1]));
    }
    if (lowest) startRooms.push("exterior");
    if (this.entry && this.levelAt(this.entry.y).id === lvl.id) startRooms.push(at(this.entry));
    if (!planBfs(adj, startRooms).has(room.id)) return "nodoor";
    // the built house: take the solids away kind by kind
    const g = this.grid(lvl.id);
    if (!g) return "other";
    const starts = fromLvl.id === lvl.id ? [this.nearestReachable(g, from)].filter((c) => c >= 0) : this.anchorCells(lvl, g);
    if (!starts.length) return "other";
    const rect = roomWorldRect(room);
    const floorY = lvl.elevation_ft * FT;
    const reaches = (allow: number) => {
      const seen = g.reach(starts, allow);
      for (let i = 0; i < seen.length; i++) if (seen[i] && g.inRect(i, rect) && Math.abs(g.h[i] - floorY) < 0.8) return true;
      return false;
    };
    if (reaches(BLOCK.planting)) return "planting";
    if (reaches(BLOCK.furniture)) return "furniture";
    if (reaches(BLOCK.planting | BLOCK.furniture)) return "furniture";
    if (reaches(BLOCK.planting | BLOCK.furniture | BLOCK.other)) return "other";
    return "nodoor";
  }

  /**
   * "Into the floor" from a stair landing: toward the middle of the floor's rooms, nudged to the most open view
   * (never a blank wall a step away).
   */
  intoFloorYaw(level: Level, at: THREE.Vector3, path?: THREE.Vector3[]): number {
    const rooms = this.plan.rooms.filter((r) => r.level === level.id && r.type !== "stair");
    let fx = 0, fz = 0, wsum = 0;
    for (const r of rooms) {
      const w = r.rect.w * r.rect.d * (OUTDOOR.has(r.type) ? 0.4 : 1);
      fx += (r.rect.x + r.rect.w / 2) * FT * w;
      fz += zOf(r.rect.y + r.rect.d / 2) * w;
      wsum += w;
    }
    if (!wsum) {
      // the roof: look across the terrace (away from the stair tower)
      const W = this.plan.site.plot.width_ft, D = this.plan.site.plot.depth_ft;
      fx = (W / 2) * FT;
      fz = zOf(D / 2);
      wsum = 1;
    }
    fx /= wsum;
    fz /= wsum;
    const want = Math.atan2(-(fx - at.x), -(fz - at.z));
    // otherwise the way we were heading
    let heading = want;
    if (path && path.length > 3) {
      const a = path[path.length - 4], b = path[path.length - 1];
      if (Math.hypot(b.x - a.x, b.z - a.z) > 0.1) heading = Math.atan2(-(b.x - a.x), -(b.z - a.z));
    }
    const eye = new THREE.Vector3(at.x, at.y + EYE - 0.1, at.z);
    let best = want, bestScore = -Infinity;
    // how open the view is: the centre ray and two at ±18° (so we never aim just past the edge of a tank or a wall)
    const seen = (yaw: number) => {
      const dir = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
      return Math.min(this.walk.clearDistance(eye, dir, 9), this.sight ? this.sight(eye, dir, 9) : 9);
    };
    const spread = THREE.MathUtils.degToRad(18);
    for (let k = -12; k <= 12; k++) {
      const yaw = want + (k * Math.PI) / 12;
      const mid = seen(yaw);
      const open = (Math.min(mid, 7) * 2 + Math.min(seen(yaw - spread), 7) + Math.min(seen(yaw + spread), 7)) / 4;
      const off = Math.abs(angleWrap(yaw - want));
      const offH = Math.abs(angleWrap(yaw - heading));
      const score = open - off * 1.1 - offH * 0.3 - (mid < 1.6 ? 6 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = yaw;
      }
    }
    return best;
  }

  private splitByLevel(pts: THREE.Vector3[]): Record<string, [number, number][]> {
    const out: Record<string, [number, number][]> = {};
    for (const p of pts) {
      const id = this.levelAt(p.y).id;
      (out[id] ??= []).push([p.x / FT, -p.z / FT]);
    }
    return out;
  }
}

const angleWrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Which way to look from `p` into a room (world rect): toward its middle, or its farthest corner from near the middle. */
function faceInto(rect: { x0: number; x1: number; z0: number; z1: number }, p: THREE.Vector3): number {
  const cx = (rect.x0 + rect.x1) / 2, cz = (rect.z0 + rect.z1) / 2;
  const dx = cx - p.x, dz = cz - p.z;
  if (Math.hypot(dx, dz) > 1.0) return Math.atan2(-dx, -dz);
  let best = 0, bd = -1;
  for (const [x, z] of [[rect.x0, rect.z0], [rect.x1, rect.z0], [rect.x0, rect.z1], [rect.x1, rect.z1]]) {
    const dd = Math.hypot(x - p.x, z - p.z);
    if (dd > bd) {
      bd = dd;
      best = Math.atan2(-(x - p.x), -(z - p.z));
    }
  }
  return best;
}

function dedupe(pts: THREE.Vector3[]) {
  const out: THREE.Vector3[] = [];
  for (const p of pts) if (!out.length || out[out.length - 1].distanceTo(p) > 0.02) out.push(p);
  return out;
}

/**
 * Round each turn with a short quadratic curve (≤ 0.45 m) and resample every 0.12 m. Heights follow the grid's
 * floor where there is one (thresholds, porch steps); stair points keep their own heights.
 */
function roundCorners(pts: THREE.Vector3[], g: NavGrid | null): THREE.Vector3[] {
  if (pts.length < 2) return pts.map((p) => p.clone());
  const out: THREE.Vector3[] = [pts[0].clone()];
  const push = (p: THREE.Vector3) => {
    const last = out[out.length - 1];
    const d = last.distanceTo(p);
    const n = Math.max(1, Math.ceil(d / 0.12));
    for (let k = 1; k <= n; k++) out.push(new THREE.Vector3().lerpVectors(last, p, k / n));
  };
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], p = pts[i], b = pts[i + 1];
    const din = p.clone().sub(a), dout = b.clone().sub(p);
    const lin = din.length(), lout = dout.length();
    const r = Math.min(0.45, lin * 0.45, lout * 0.45);
    if (r < 0.05) {
      push(p);
      continue;
    }
    const p0 = p.clone().addScaledVector(din.normalize(), -r);
    const p1 = p.clone().addScaledVector(dout.normalize(), r);
    push(p0);
    const steps = 6;
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      const q = new THREE.Vector3()
        .addScaledVector(p0, (1 - t) * (1 - t))
        .addScaledVector(p, 2 * (1 - t) * t)
        .addScaledVector(p1, t * t);
      out.push(q);
    }
  }
  push(pts[pts.length - 1]);
  if (g) {
    for (const q of out) {
      const c = g.cellAt(q.x, q.z);
      if (c >= 0 && Number.isFinite(g.h[c]) && Math.abs(g.h[c] - q.y) < 0.4) q.y = g.h[c];
    }
  }
  return out;
}

interface PlanEdge {
  to: string;
  via: THREE.Vector3[];
}

/**
 * The plan's walk graph on one level: rooms joined by walkable openings, open-plan edges and shared edges between
 * outdoor areas. A door to "exterior" joins the outdoor area right outside it (a side yard, the porch); on the lowest
 * level the outdoor areas along the road (and, on a corner plot, along the sides) join "exterior", the street. An
 * outdoor area walled in by the house with no door (a light court) is joined to nothing.
 */
function planGraph(plan: BuildingPlan, level: Level) {
  const y = level.elevation_ft * FT;
  const rooms = plan.rooms.filter((r) => r.level === level.id);
  const byId = new Map(rooms.map((r) => [r.id, r]));
  const lowest = level.index === Math.min(...plan.levels.map((l) => l.index));
  const at = (p: THREE.Vector3) => {
    const x = p.x / FT, yy = -p.z / FT;
    const hits = rooms.filter((r) => x >= r.rect.x - 0.3 && x <= r.rect.x + r.rect.w + 0.3 && yy >= r.rect.y - 0.3 && yy <= r.rect.y + r.rect.d + 0.3);
    hits.sort((p1, p2) => p1.rect.w * p1.rect.d - p2.rect.w * p2.rect.d);
    return hits[0]?.id ?? "exterior";
  };
  const adj = new Map<string, PlanEdge[]>();
  const link = (p: string, q: string, via: THREE.Vector3[]) => {
    if (p === q) return;
    (adj.get(p) ?? adj.set(p, []).get(p)!).push({ to: q, via });
    (adj.get(q) ?? adj.set(q, []).get(q)!).push({ to: p, via: [...via].reverse() });
  };
  const isOutdoor = (id: string) => id === "exterior" || OUTDOOR.has(byId.get(id)?.type ?? "");
  const centreOf = (id: string) => {
    const r = byId.get(id);
    return r ? new THREE.Vector3((r.rect.x + r.rect.w / 2) * FT, y, zOf(r.rect.y + r.rect.d / 2)) : null;
  };
  /** The outdoor area a step outside `o` from `inside` ("exterior" when there is none: the street, the open plot). */
  const outsideOf = (o: Opening, inside: Room | undefined): string => {
    if (!inside) return "exterior";
    const r = inside.rect, [ax, ay] = o.at;
    const sides: [number, number, number][] = [
      [Math.abs(ay - r.y), 0, -1],
      [Math.abs(ay - (r.y + r.d)), 0, 1],
      [Math.abs(ax - r.x), -1, 0],
      [Math.abs(ax - (r.x + r.w)), 1, 0],
    ];
    sides.sort((a, b) => a[0] - b[0]);
    const [, nx, ny] = sides[0];
    const px = ax + nx * 1.2, py = ay + ny * 1.2;
    const hit = rooms.find((q) => q.id !== inside.id && isOutdoor(q.id) && px >= q.rect.x - 0.1 && px <= q.rect.x + q.rect.w + 0.1 && py >= q.rect.y - 0.1 && py <= q.rect.y + q.rect.d + 0.1);
    return hit?.id ?? "exterior";
  };
  for (const o of plan.openings ?? []) {
    if (o.level !== level.id || !WALKABLE_OPENINGS.has(o.type)) continue;
    let [p, q] = o.between;
    const pr = byId.get(p), qr = byId.get(q);
    if (!pr && p !== "exterior") continue;
    if (!qr && q !== "exterior") continue;
    if (p === "exterior") p = outsideOf(o, qr);
    if (q === "exterior") q = outsideOf(o, pr);
    // doors open across the wall: step 0.5 m either side, toward each room's middle
    const door = new THREE.Vector3(o.at[0] * FT, y, zOf(o.at[1]));
    const toward = (id: string) => {
      const c = centreOf(id);
      const room = byId.get(id);
      if (!c || !room) return door.clone();
      const d = c.sub(door);
      // keep only the component across the wall
      const onX = Math.abs(o.at[1] - room.rect.y) < 0.6 || Math.abs(o.at[1] - (room.rect.y + room.rect.d)) < 0.6;
      if (onX) d.x = 0;
      else d.z = 0;
      if (d.lengthSq() < 1e-8) return door.clone();
      return door.clone().addScaledVector(d.normalize(), 0.5);
    };
    link(p, q, [p === "exterior" ? door.clone() : toward(p), door, q === "exterior" ? door.clone() : toward(q)]);
  }
  for (const r of rooms)
    for (const id of r.open_to ?? []) {
      const o = byId.get(id);
      if (!o) continue;
      const mid = sharedEdgeMid(r, o);
      if (mid) link(r.id, o.id, [new THREE.Vector3(mid[0] * FT, y, zOf(mid[1]))]);
    }
  for (let i = 0; i < rooms.length; i++)
    for (let j = i + 1; j < rooms.length; j++) {
      if (!isOutdoor(rooms[i].id) || !isOutdoor(rooms[j].id)) continue;
      const mid = sharedEdgeMid(rooms[i], rooms[j]);
      if (mid) link(rooms[i].id, rooms[j].id, [new THREE.Vector3(mid[0] * FT, y, zOf(mid[1]))]);
    }
  if (lowest) {
    const W = plan.site.plot.width_ft;
    const corner = !!plan.site.plot.corner;
    for (const r of rooms) {
      if (!isOutdoor(r.id)) continue;
      const street = r.rect.y <= 0.5 || (corner && (r.rect.x <= 0.5 || r.rect.x + r.rect.w >= W - 0.5));
      if (street) link(r.id, "exterior", [centreOf(r.id)!]);
    }
  }
  return { at, adj };
}

/** BFS over the plan graph: how each room reachable from `starts` is reached (null for the starts themselves). */
function planBfs(adj: Map<string, PlanEdge[]>, starts: string[]) {
  const prev = new Map<string, { from: string; via: THREE.Vector3[] } | null>();
  const q: string[] = [];
  for (const s of starts)
    if (!prev.has(s)) {
      prev.set(s, null);
      q.push(s);
    }
  while (q.length) {
    const cur = q.shift()!;
    for (const e of adj.get(cur) ?? []) {
      if (prev.has(e.to)) continue;
      prev.set(e.to, { from: cur, via: e.via });
      q.push(e.to);
    }
  }
  return prev;
}

/**
 * Fallback route from the plan alone (planGraph). Waypoints are door centres (a short step either side of each door
 * so the glide crosses the wall square-on).
 */
function roomGraphPath(plan: BuildingPlan, level: Level, a: THREE.Vector3, b: THREE.Vector3): THREE.Vector3[] | null {
  if (!plan.rooms.some((r) => r.level === level.id)) return [a.clone(), b.clone()];
  const { at, adj } = planGraph(plan, level);
  const start = at(a), goal = at(b);
  if (start === goal) return [a.clone(), b.clone()];
  const prev = planBfs(adj, [start]);
  if (!prev.has(goal)) return null;
  const via: THREE.Vector3[] = [];
  for (let c = goal; c !== start; ) {
    const p = prev.get(c)!;
    via.unshift(...p.via);
    c = p.from;
  }
  return [a.clone(), ...via, b.clone()];
}

function sharedEdgeMid(a: Room, b: Room): [number, number] | null {
  const A = a.rect, B = b.rect;
  const eps = 0.3;
  // vertical shared edge
  for (const [xa, xb] of [[A.x + A.w, B.x], [A.x, B.x + B.w]]) {
    if (Math.abs(xa - xb) < eps) {
      const y0 = Math.max(A.y, B.y), y1 = Math.min(A.y + A.d, B.y + B.d);
      if (y1 - y0 >= 2.5) return [xa, (y0 + y1) / 2];
    }
  }
  for (const [ya, yb] of [[A.y + A.d, B.y], [A.y, B.y + B.d]]) {
    if (Math.abs(ya - yb) < eps) {
      const x0 = Math.max(A.x, B.x), x1 = Math.min(A.x + A.w, B.x + B.w);
      if (x1 - x0 >= 2.5) return [(x0 + x1) / 2, ya];
    }
  }
  return null;
}

/**
 * Glide time for a route: DESIGN `clamp(700, d×120, 2400)` ms on one floor. Routes that take a stair get up to
 * 4.2 s, with the stair stretch weighted so the climb reads as a climb.
 */
export function glideSeconds(r: Pick<RoutePlan, "timeLength" | "stairs">) {
  return clamp(r.timeLength * 120, 700, r.stairs ? 4200 : 2400) / 1000;
}

