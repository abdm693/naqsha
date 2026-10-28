/**
 * Walkability grid for one floor, probed from the same BVH the walker collides with (so a path on the grid is a path
 * a person can actually walk: through doorways, around sofas, never through a wall). Used by the room navigator to
 * plan glides; A* with a clearance cost keeps routes in the middle of corridors and doorways.
 */
import * as THREE from "three";
import { STEP_UP, type WalkController } from "./WalkController";

/** Probe radius for "can stand here": a little under the walker's capsule so 2.5 ft doors always have a free cell. */
const PROBE_R = 0.2;
const MAX_CLR = 4;

export interface GridBounds { x0: number; z0: number; x1: number; z1: number }

/**
 * Why a floor cell is not free (a bit mask in `NavGrid.blk`): walls and other structure, or a solid of some kind.
 * The room navigator relaxes solid kinds to tell what seals a room off (planting vs furniture) from a missing door.
 */
export const BLOCK = { wall: 1, planting: 2, furniture: 4, other: 8 } as const;

/** Classifies the solids a capsule standing at `p` (radius r) overlaps, as a mask of BLOCK.planting/furniture/other. */
export type SolidClassifier = (p: THREE.Vector3, r: number) => number;

export class NavGrid {
  readonly nx: number;
  readonly nz: number;
  readonly free: Uint8Array;
  readonly h: Float32Array;
  readonly clr: Uint8Array;
  /** For floor cells that are not free: what blocks them (BLOCK mask); 0 for free cells and cells with no floor. */
  readonly blk: Uint8Array;
  private built = false;
  private cursor = 0;
  private comps: Int32Array | null = null;

  constructor(
    readonly levelId: string,
    readonly floorY: number,
    readonly b: GridBounds,
    readonly cell = 0.2,
    /** Accepted floor band around floorY (m): the ground level also walks the lawn, porch steps and footpath. */
    readonly band: [number, number] = [-0.35, 0.35],
  ) {
    this.nx = Math.max(1, Math.ceil((b.x1 - b.x0) / cell));
    this.nz = Math.max(1, Math.ceil((b.z1 - b.z0) / cell));
    const n = this.nx * this.nz;
    this.free = new Uint8Array(n);
    this.h = new Float32Array(n).fill(NaN);
    this.clr = new Uint8Array(n);
    this.blk = new Uint8Array(n);
  }

  get ready() {
    return this.built;
  }

  idx(ix: number, iz: number) {
    return iz * this.nx + ix;
  }

  cx(i: number) {
    return this.b.x0 + ((i % this.nx) + 0.5) * this.cell;
  }

  cz(i: number) {
    return this.b.z0 + (Math.floor(i / this.nx) + 0.5) * this.cell;
  }

  center(i: number, out = new THREE.Vector3()) {
    return out.set(this.cx(i), this.h[i], this.cz(i));
  }

  cellAt(x: number, z: number): number {
    const ix = Math.floor((x - this.b.x0) / this.cell), iz = Math.floor((z - this.b.z0) / this.cell);
    if (ix < 0 || iz < 0 || ix >= this.nx || iz >= this.nz) return -1;
    return this.idx(ix, iz);
  }

  /**
   * Probe cells for up to `budgetMs` (all of them when budgetMs is Infinity). Returns true once the grid is complete.
   * Cheap enough per floor (~5–12k cells) to finish in a few idle frames after the walk collider is built.
   */
  build(walk: WalkController, budgetMs = Infinity, classify?: SolidClassifier | null): boolean {
    if (this.built) return true;
    const t0 = performance.now();
    const n = this.nx * this.nz;
    const p = new THREE.Vector3();
    const top = this.floorY + this.band[1] + STEP_UP;
    const bottom = this.floorY + this.band[0] - 0.05;
    while (this.cursor < n) {
      const i = this.cursor++;
      const x = this.cx(i), z = this.cz(i);
      const g = walk.groundAt1(x, z, top, bottom);
      if (g !== null && g >= this.floorY + this.band[0] && g <= this.floorY + this.band[1]) {
        this.h[i] = g;
        p.set(x, g, z);
        const hit = walk.overlapKind(p, PROBE_R);
        if (!hit) this.free[i] = 1;
        else this.blk[i] = hit === 1 ? BLOCK.wall : (classify?.(p, PROBE_R) || BLOCK.other);
      }
      if ((i & 63) === 0 && performance.now() - t0 > budgetMs) return false;
    }
    this.computeClearance();
    this.built = true;
    return true;
  }

  /** Chessboard distance (in cells, capped) from every free cell to the nearest blocked one. */
  private computeClearance() {
    const { nx, nz, free, clr } = this;
    const q: number[] = [];
    for (let i = 0; i < free.length; i++) {
      if (!free[i]) {
        clr[i] = 0;
        q.push(i);
      } else clr[i] = 255;
    }
    // border cells count as next to a wall
    for (let ix = 0; ix < nx; ix++)
      for (const iz of [0, nz - 1]) {
        const i = this.idx(ix, iz);
        if (free[i] && clr[i] > 1) {
          clr[i] = 1;
          q.push(i);
        }
      }
    for (let iz = 0; iz < nz; iz++)
      for (const ix of [0, nx - 1]) {
        const i = this.idx(ix, iz);
        if (free[i] && clr[i] > 1) {
          clr[i] = 1;
          q.push(i);
        }
      }
    for (let head = 0; head < q.length; head++) {
      const i = q[head];
      const d = clr[i];
      if (d >= MAX_CLR) continue;
      const ix = i % nx, iz = (i / nx) | 0;
      for (let oz = -1; oz <= 1; oz++)
        for (let ox = -1; ox <= 1; ox++) {
          const jx = ix + ox, jz = iz + oz;
          if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue;
          const j = this.idx(jx, jz);
          if (clr[j] > d + 1) {
            clr[j] = d + 1;
            q.push(j);
          }
        }
    }
    for (let i = 0; i < clr.length; i++) if (clr[i] === 255) clr[i] = MAX_CLR;
  }

  /** Nearest free cell to (x, z) within `maxR` m whose floor is within `dy` of `y` (when given). */
  nearestFree(x: number, z: number, maxR = 1.5, y?: number, dy = 0.45): number {
    const c = this.cellAt(x, z);
    const R = Math.ceil(maxR / this.cell);
    const ix0 = Math.floor((x - this.b.x0) / this.cell), iz0 = Math.floor((z - this.b.z0) / this.cell);
    let best = -1, bestD = Infinity;
    const ok = (i: number) => this.free[i] && (y === undefined || Math.abs(this.h[i] - y) <= dy);
    if (c >= 0 && ok(c)) return c;
    for (let iz = iz0 - R; iz <= iz0 + R; iz++) {
      if (iz < 0 || iz >= this.nz) continue;
      for (let ix = ix0 - R; ix <= ix0 + R; ix++) {
        if (ix < 0 || ix >= this.nx) continue;
        const i = this.idx(ix, iz);
        if (!ok(i)) continue;
        const d = (this.cx(i) - x) ** 2 + (this.cz(i) - z) ** 2;
        if (d < bestD && d <= maxR * maxR) {
          bestD = d;
          best = i;
        }
      }
    }
    return best;
  }

  private passable(a: number, b: number) {
    return this.free[b] === 1 && Math.abs(this.h[a] - this.h[b]) <= STEP_UP;
  }

  /** A* (8-connected, no corner cutting) with a soft penalty near walls. Returns cell indices start → goal. */
  findPath(start: number, goal: number): number[] | null {
    if (start < 0 || goal < 0 || !this.free[start] || !this.free[goal]) return null;
    if (start === goal) return [start];
    const { nx, nz } = this;
    const n = nx * nz;
    const g = new Float32Array(n).fill(Infinity);
    const came = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const gx = goal % nx, gz = (goal / nx) | 0;
    const hfn = (i: number) => {
      const dx = Math.abs((i % nx) - gx), dz = Math.abs(((i / nx) | 0) - gz);
      return Math.max(dx, dz) + 0.4142 * Math.min(dx, dz);
    };
    const heap = new MinHeap();
    g[start] = 0;
    heap.push(start, hfn(start));
    const penalty = [3, 1.6, 0.45, 0.1, 0];
    while (heap.size) {
      const i = heap.pop();
      if (i === goal) break;
      if (closed[i]) continue;
      closed[i] = 1;
      const ix = i % nx, iz = (i / nx) | 0;
      for (let oz = -1; oz <= 1; oz++)
        for (let ox = -1; ox <= 1; ox++) {
          if (!ox && !oz) continue;
          const jx = ix + ox, jz = iz + oz;
          if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue;
          const j = jz * nx + jx;
          if (closed[j] || !this.passable(i, j)) continue;
          if (ox && oz && (!this.passable(i, iz * nx + jx) || !this.passable(i, jz * nx + ix))) continue;
          const step = ox && oz ? 1.4142 : 1;
          const cost = g[i] + step * (1 + penalty[Math.min(this.clr[j], 4)]);
          if (cost < g[j]) {
            g[j] = cost;
            came[j] = i;
            heap.push(j, cost + hfn(j));
          }
        }
    }
    if (came[goal] < 0) return null;
    const out: number[] = [];
    for (let c = goal; c !== -1; c = came[c]) out.push(c);
    return out.reverse();
  }

  /**
   * Dijkstra flood from `start` over everything walkable (same costs as findPath). Lets a caller pick the best goal
   * among the cells you can actually reach, e.g. the reachable spot nearest a room's middle when furniture walls
   * part of the room off.
   */
  flood(start: number): { cost: Float32Array; came: Int32Array } {
    const { nx, nz } = this;
    const n = nx * nz;
    const cost = new Float32Array(n).fill(Infinity);
    const came = new Int32Array(n).fill(-1);
    if (start < 0 || !this.free[start]) return { cost, came };
    const closed = new Uint8Array(n);
    const heap = new MinHeap();
    const penalty = [3, 1.6, 0.45, 0.1, 0];
    cost[start] = 0;
    heap.push(start, 0);
    while (heap.size) {
      const i = heap.pop();
      if (closed[i]) continue;
      closed[i] = 1;
      const ix = i % nx, iz = (i / nx) | 0;
      for (let oz = -1; oz <= 1; oz++)
        for (let ox = -1; ox <= 1; ox++) {
          if (!ox && !oz) continue;
          const jx = ix + ox, jz = iz + oz;
          if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue;
          const j = jz * nx + jx;
          if (closed[j] || !this.passable(i, j)) continue;
          if (ox && oz && (!this.passable(i, iz * nx + jx) || !this.passable(i, jz * nx + ix))) continue;
          const c = cost[i] + (ox && oz ? 1.4142 : 1) * (1 + penalty[Math.min(this.clr[j], 4)]);
          if (c < cost[j]) {
            cost[j] = c;
            came[j] = i;
            heap.push(j, c);
          }
        }
    }
    return { cost, came };
  }

  /**
   * Connected-component label of every free cell (−1 for cells you can't stand on). Two cells share a label when a
   * walk joins them (the same moves as findPath: diagonals never cut a corner, so 4-neighbour connectivity).
   */
  components(): Int32Array {
    if (this.comps) return this.comps;
    const { nx, nz } = this;
    const n = nx * nz;
    const comp = new Int32Array(n).fill(-1);
    const q = new Int32Array(n);
    let label = 0;
    for (let s = 0; s < n; s++) {
      if (!this.free[s] || comp[s] >= 0) continue;
      let head = 0, tail = 0;
      q[tail++] = s;
      comp[s] = label;
      while (head < tail) {
        const i = q[head++];
        const ix = i % nx, iz = (i / nx) | 0;
        for (const [jx, jz] of [[ix - 1, iz], [ix + 1, iz], [ix, iz - 1], [ix, iz + 1]]) {
          if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue;
          const j = jz * nx + jx;
          if (comp[j] >= 0 || !this.passable(i, j)) continue;
          comp[j] = label;
          q[tail++] = j;
        }
      }
      label++;
    }
    this.comps = comp;
    return comp;
  }

  /**
   * Cells reachable from `starts` when floor cells blocked only by the solid kinds in `allow` (a BLOCK mask) count as
   * free: "if the planting weren't there, could you get in?"
   */
  reach(starts: number[], allow: number): Uint8Array {
    const { nx, nz } = this;
    const n = nx * nz;
    const seen = new Uint8Array(n);
    const open = (j: number) => this.free[j] === 1 || (this.blk[j] !== 0 && (this.blk[j] & ~allow) === 0);
    const q = new Int32Array(n);
    let head = 0, tail = 0;
    for (const s of starts) {
      if (s < 0 || seen[s] || !open(s)) continue;
      seen[s] = 1;
      q[tail++] = s;
    }
    while (head < tail) {
      const i = q[head++];
      const ix = i % nx, iz = (i / nx) | 0;
      for (const [jx, jz] of [[ix - 1, iz], [ix + 1, iz], [ix, iz - 1], [ix, iz + 1]]) {
        if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue;
        const j = jz * nx + jx;
        if (seen[j] || !open(j) || Math.abs(this.h[i] - this.h[j]) > STEP_UP) continue;
        seen[j] = 1;
        q[tail++] = j;
      }
    }
    return seen;
  }

  /** Cell path start → goal from a flood's `came` links (null when unreached). */
  static trace(came: Int32Array, start: number, goal: number): number[] | null {
    if (goal === start) return [start];
    if (goal < 0 || came[goal] < 0) return null;
    const out: number[] = [];
    for (let c = goal; c !== -1; c = came[c]) {
      out.push(c);
      if (c === start) break;
    }
    return out[out.length - 1] === start ? out.reverse() : null;
  }

  /** Straight walkable line between two cells (sampled at half-cell steps), keeping some clearance. */
  los(a: number, b: number, minClr: number): boolean {
    const ax = this.cx(a), az = this.cz(a), bx = this.cx(b), bz = this.cz(b);
    const len = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(len / (this.cell * 0.5)));
    let prev = a;
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      const c = this.cellAt(ax + (bx - ax) * t, az + (bz - az) * t);
      if (c < 0 || !this.free[c]) return false;
      if (c !== prev) {
        if (Math.abs(this.h[c] - this.h[prev]) > STEP_UP) return false;
        if (this.clr[c] < minClr) return false;
        prev = c;
      }
    }
    return true;
  }

  /** Greedy string pulling: keep only the turning points of a cell path. */
  simplify(path: number[]): number[] {
    if (path.length <= 2) return path.slice();
    const out = [path[0]];
    let anchor = 0;
    while (anchor < path.length - 1) {
      let far = anchor + 1;
      const need = Math.min(2, this.clr[path[anchor]]);
      for (let k = path.length - 1; k > anchor + 1; k--) {
        const m = Math.min(need, this.clr[path[k]]);
        if (this.los(path[anchor], path[k], Math.max(1, m))) {
          far = k;
          break;
        }
      }
      out.push(path[far]);
      anchor = far;
    }
    return out;
  }

  /** Is cell i inside the world-space rect (x0..x1, z0..z1)? */
  inRect(i: number, r: { x0: number; x1: number; z0: number; z1: number }) {
    const x = this.cx(i), z = this.cz(i);
    return x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
  }
}

class MinHeap {
  private ids: number[] = [];
  private keys: number[] = [];
  get size() {
    return this.ids.length;
  }
  push(id: number, key: number) {
    const ids = this.ids, keys = this.keys;
    let i = ids.length;
    ids.push(id);
    keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      ids[i] = ids[p];
      keys[i] = keys[p];
      i = p;
    }
    ids[i] = id;
    keys[i] = key;
  }
  pop(): number {
    const ids = this.ids, keys = this.keys;
    const top = ids[0];
    const lastId = ids.pop()!, lastKey = keys.pop()!;
    const n = ids.length;
    if (n) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        if (l >= n) break;
        const c = r < n && keys[r] < keys[l] ? r : l;
        if (keys[c] >= lastKey) break;
        ids[i] = ids[c];
        keys[i] = keys[c];
        i = c;
      }
      ids[i] = lastId;
      keys[i] = lastKey;
    }
    return top;
  }
}
