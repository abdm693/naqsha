/**
 * B.6 parking bays and the gate-to-door walkway (plan ft).
 * Bays are derived from the porch (nose-in toward the house, beside the porch edge farthest from the doors that
 * open onto it) so that a 3 ft walkway always runs from the pedestrian gate (or the car gate) to the main door.
 * Cars snap to a free bay; the walkway and bays are keep-out zones for every other porch, driveway and lawn item;
 * the walk spawns on the walkway facing the door with nothing tall in between.
 */
import type { BuildCtx } from "../core/ctx";
import type { R } from "../core/grid";
import type { RoomM } from "../plan/model";
import type { PlacedOpening } from "../structure/model";

export interface Bay {
  rect: R;
  /** car rotation (rot_deg: 0 = nose toward +y) so the nose points into the porch, toward the house */
  rot: number;
  room: string;
  used: boolean;
  /** porch bays are used first; driveway bays only for further cars */
  where: "porch" | "driveway";
}

export interface Parking {
  bays: Bay[];
  /** walkway centreline from the gate to the main door's approach (plan ft) */
  path: [number, number][];
  /** test whether a point lies on the 3 ft walkway */
  onWalkway: (x: number, y: number) => boolean;
  door: PlacedOpening | null;
  /** point 2 ft outside the main door, and the door centre */
  approach: [number, number] | null;
  doorCentre: [number, number] | null;
}

const CELL = 0.5;
/** EN2-04: a parking bay is the plan rule's 9 × 18 ft (api compliance/planning.py CAR_W, CAR_L), never narrower than
 *  8.5 ft, so the doors of a parked car still open */
export const BAY_W = [9, 8.5];
export const BAY_L = 18;
const cache = new WeakMap<BuildCtx, Parking>();

export function parking(ctx: BuildCtx): Parking {
  let p = cache.get(ctx);
  if (!p) cache.set(ctx, (p = computeParking(ctx)));
  return p;
}

/**
 * Lay the bays out again for `n` cars (the design asked for more cars than were counted up front). Returns the new
 * layout; the caller moves the cars already parked into its bays (in order). Null when it gives no more bays.
 */
export function replanParking(ctx: BuildCtx, n: number): Parking | null {
  const old = parking(ctx);
  const next = computeParking(ctx, n);
  if (next.bays.length <= old.bays.length) return null;
  cache.set(ctx, next);
  return next;
}

function mainDoor(ctx: BuildCtx): PlacedOpening | null {
  const ops = ctx.structureBuilt ? ctx.model.openings : [];
  const g = ctx.plan.levels[0].id;
  return (
    ops.find((o) => o.op.type === "main_door" && o.op.level === g) ??
    ops.find((o) => o.isDoor && o.op.level === g && o.run.out !== 0 && o.op.type !== "garage_door") ??
    null
  );
}

function computeParking(ctx: BuildCtx, want?: number): Parking {
  const plan = ctx.plan;
  const g = plan.levels[0];
  const door = mainDoor(ctx);
  let approach: [number, number] | null = null, doorCentre: [number, number] | null = null;
  let doorZone: R | null = null;
  if (door) {
    const run = door.run;
    // outside = the side that is not the enclosed room behind the main door
    const encl = (r: RoomM | null) => !!r && r.cat === "enclosed";
    const outSign = run.out !== 0 ? run.out : encl(run.neg) && !encl(run.pos) ? 1 : -1;
    const u = (door.u0 + door.u1) / 2;
    doorCentre = run.axis === "x" ? [u, run.c] : [run.c, u];
    const a = run.c + outSign * (run.t / 2 + 2);
    approach = run.axis === "x" ? [u, a] : [a, u];
    const c0 = run.c + (outSign * run.t) / 2, c1 = c0 + outSign * 3;
    doorZone = run.axis === "x" ? { x: door.u0 - 0.5, y: Math.min(c0, c1), w: door.u1 - door.u0 + 1, d: 3 } : { x: Math.min(c0, c1), y: door.u0 - 0.5, w: 3, d: door.u1 - door.u0 + 1 };
  }
  // door approach zones of every door opening onto a porch
  const porches = plan.roomsOn(g.id).filter((r) => r.type === "porch" || r.type === "garage");
  const doorZones: R[] = [];
  if (doorZone) doorZones.push(doorZone);
  for (const o of ctx.structureBuilt ? ctx.model.openings : []) {
    if (!o.isDoor || o.op.level !== g.id) continue;
    const pr = [o.neg, o.pos].find((r) => r && porches.includes(r));
    if (!pr) continue;
    const into = o.neg === pr ? -1 : 1;
    const c0 = o.run.c + (into * o.run.t) / 2, c1 = c0 + into * 3;
    doorZones.push(o.run.axis === "x" ? { x: o.u0 - 0.5, y: Math.min(c0, c1), w: o.u1 - o.u0 + 1, d: 3 } : { x: Math.min(c0, c1), y: o.u0 - 0.5, w: 3, d: o.u1 - o.u0 + 1 });
  }
  // the walking grid over the plot (ground level): not inside enclosed rooms (+0.6 ft for walls)
  // only the front of the plot matters: up to just past the main door and the porches
  const yMax = Math.min(plan.plotD, Math.max(doorCentre ? doorCentre[1] : 0, ...porches.map((p) => p.rect.y + p.rect.d), 10) + 6);
  const nx = Math.ceil(plan.plotW / CELL), ny = Math.ceil(yMax / CELL);
  const base = new Uint8Array(nx * ny);
  const enclosed = plan.roomsOn(g.id).filter((r) => r.cat === "enclosed");
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const x = (i + 0.5) * CELL, y = (j + 0.5) * CELL;
      let ok = x > 0.6 && x < plan.plotW - 0.6 && y > 0.3 && y < plan.plotD - 0.6;
      if (ok) for (const r of enclosed) if (x > r.rect.x - 0.6 && x < r.rect.x + r.rect.w + 0.6 && y > r.rect.y - 0.6 && y < r.rect.y + r.rect.d + 0.6) { ok = false; break; }
      // porch columns stand at the porch corners: keep their footprint
      base[j * nx + i] = ok ? 1 : 0;
    }
  const gates = plan.plan.site?.gates ?? [];
  const ped = gates.find((q) => q.kind === "pedestrian") ?? gates[0];
  const carGate = gates.find((q) => q.kind !== "pedestrian");
  const start: [number, number] = [Math.min(Math.max(Number(ped?.at?.[0] ?? plan.plotW / 2), 1), plan.plotW - 1), 0.75];
  const blockedBy = (bays: R[], inflate: number) => {
    const m = base.slice();
    for (const b of bays) {
      const i0 = Math.floor((b.x - inflate) / CELL), i1 = Math.ceil((b.x + b.w + inflate) / CELL);
      const j0 = Math.floor((b.y - inflate) / CELL), j1 = Math.ceil((b.y + b.d + inflate) / CELL);
      for (let j = Math.max(0, j0); j < Math.min(ny, j1); j++) for (let i = Math.max(0, i0); i < Math.min(nx, i1); i++) m[j * nx + i] = 0;
    }
    return m;
  };
  const pathOn = (mask: Uint8Array): [number, number][] | null => {
    if (!approach) return null;
    const si = Math.floor(start[0] / CELL), sj = Math.floor(start[1] / CELL);
    const ti = Math.min(nx - 1, Math.max(0, Math.floor(approach[0] / CELL))), tj = Math.min(ny - 1, Math.max(0, Math.floor(approach[1] / CELL)));
    // the start and target cells are always walkable (the gate / the door step)
    const m = mask.slice();
    for (const [i, j] of [[si, sj], [ti, tj]]) if (i >= 0 && j >= 0 && i < nx && j < ny) m[j * nx + i] = 1;
    // Dijkstra with a small penalty near obstacles so the walkway keeps to the middle of free space
    const cost = new Float64Array(nx * ny).fill(Infinity);
    const prev = new Int32Array(nx * ny).fill(-1);
    const near = new Float32Array(nx * ny);
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        if (!m[j * nx + i]) continue;
        let pen = 0;
        for (let d = 1; d <= 3; d++) if (!m[j * nx + Math.min(nx - 1, i + d)] || !m[j * nx + Math.max(0, i - d)] || !m[Math.min(ny - 1, j + d) * nx + i] || !m[Math.max(0, j - d) * nx + i]) { pen = (4 - d) * 0.4; break; }
        near[j * nx + i] = pen;
      }
    const heap = new MinHeap();
    heap.push(sj * nx + si, 0);
    cost[sj * nx + si] = 0;
    const N8 = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
    while (heap.size) {
      const [cur, cc] = heap.pop();
      if (cc > cost[cur]) continue;
      if (cur === tj * nx + ti) break;
      const ci = cur % nx, cj = (cur - ci) / nx;
      for (const [di, dj, w] of N8) {
        const i = ci + di, j = cj + dj;
        if (i < 0 || j < 0 || i >= nx || j >= ny) continue;
        const k = j * nx + i;
        if (!m[k]) continue;
        if (di && dj && (!m[cj * nx + i] || !m[j * nx + ci])) continue;
        const c = cost[cur] + w + near[k];
        if (c < cost[k]) {
          cost[k] = c;
          prev[k] = cur;
          heap.push(k, c);
        }
      }
    }
    const t = tj * nx + ti;
    if (cost[t] === Infinity) return null;
    const out: [number, number][] = [];
    for (let k = t; k !== -1; k = prev[k]) out.push([((k % nx) + 0.5) * CELL, (Math.floor(k / nx) + 0.5) * CELL]);
    return out.reverse();
  };
  /** fast feasibility test (4-neighbour BFS) */
  const reachable = (mask: Uint8Array): boolean => {
    if (!approach) return true;
    const si = Math.floor(start[0] / CELL), sj = Math.floor(start[1] / CELL);
    const ti = Math.min(nx - 1, Math.max(0, Math.floor(approach[0] / CELL))), tj = Math.min(ny - 1, Math.max(0, Math.floor(approach[1] / CELL)));
    const seen = new Uint8Array(nx * ny);
    const q = new Int32Array(nx * ny);
    let h = 0, t = 0;
    const s0 = sj * nx + si, goal = tj * nx + ti;
    q[t++] = s0;
    seen[s0] = 1;
    while (h < t) {
      const cur = q[h++];
      if (cur === goal) return true;
      const ci = cur % nx, cj = (cur - ci) / nx;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const i = ci + di, j = cj + dj;
        if (i < 0 || j < 0 || i >= nx || j >= ny) continue;
        const k = j * nx + i;
        if (seen[k] || (!mask[k] && k !== goal)) continue;
        seen[k] = 1;
        q[t++] = k;
      }
    }
    return false;
  };
  // ── bays ───────────────────────────────────────────────────────────────────────────────────────────────
  const bays: Bay[] = [];
  const chosen: R[] = [];
  const ov = (a: R, b: R) => a.x < b.x + b.w - 0.01 && b.x < a.x + a.w - 0.01 && a.y < b.y + b.d - 0.01 && b.y < a.y + a.d - 0.01;
  // EN-04: lay out as many bays as the design parks cars (at least one per porch), side by side, on either side of
  // the walkway, or one behind the other (tandem) in a deep porch; EN2-04: every bay 9 ft wide (8.5 ft at the least)
  // and 18 ft deep, as the plan check counts them
  let wanted = Math.max(1, want ?? ctx.carsWanted ?? 1);
  for (const pr of porches) {
    const placed = porchBays(pr, Math.max(1, wanted));
    wanted = Math.max(0, wanted - placed);
  }
  function porchBays(pr: RoomM, n: number): number {
    const r = pr.rect;
    type E = { side: "front" | "back" | "left" | "right"; score: number };
    const edges: E[] = (["front", "back", "left", "right"] as const).map((side) => {
      const mx = side === "left" ? r.x - 0.5 : side === "right" ? r.x + r.w + 0.5 : r.x + r.w / 2;
      const my = side === "front" ? r.y - 0.5 : side === "back" ? r.y + r.d + 0.5 : r.y + r.d / 2;
      const o = plan.roomAt(g.id, mx, my);
      let score = -10;
      if (!o || o.cat === "outdoor") score = (o?.type === "driveway" ? 6 : 2) + (side === "front" ? 3 : 0);
      if (carGate && side === "front" && Math.abs(Number(carGate.at?.[0]) - (r.x + r.w / 2)) < r.w) score += 2;
      return { side, score };
    });
    edges.sort((a, b) => b.score - a.score);
    const e = edges[0];
    if (e.score < 0) return 0;
    const alongX = e.side === "front" || e.side === "back";
    const width = alongX ? r.w : r.d;
    const depth = alongX ? r.d : r.w;
    const inward = e.side === "front" || e.side === "left" ? 1 : -1;
    const edgeC = e.side === "front" ? r.y : e.side === "back" ? r.y + r.d : e.side === "left" ? r.x : r.x + r.w;
    const lo = alongX ? r.x : r.y;
    // depth slots: one bay deep, or two (tandem) when the porch is deep enough for two cars nose to tail
    const tandem = depth >= 2 * BAY_L - 0.01;
    const bl = BAY_L;
    const outBy = tandem ? 0 : Math.max(0, bl - depth); // a short porch: the car's tail may stand in the driveway
    if (outBy > 4 + 1e-6) return 0;
    const slots = tandem ? [0, 1] : [0];
    const rot = alongX ? (inward > 0 ? 0 : 180) : inward > 0 ? -90 : 90;
    type C = { rect: R; score: number; slot: number; u: number };
    // a bay may stand up to 4 ft out over the open drive-in edge, so it keeps clear of a door at the back of the porch
    const poses: { len: number; out: number; slot: number }[] = [];
    for (const slot of slots) poses.push({ len: bl, out: outBy, slot });
    if (!tandem) for (let ob = Math.max(outBy, 0) + 0.5; ob <= 4 + 1e-6; ob += 0.5) poses.push({ len: bl, out: ob, slot: 0 });
    const singles = (bw: number, outward: boolean): C[] => {
      const out: C[] = [];
      const us: number[] = [];
      for (let u = lo; u + bw <= lo + width + 1e-6; u += 0.5) us.push(u);
      if (width - bw > 0.01) us.push(lo + width - bw);
      for (const ps of poses.filter((q) => outward || q.out <= outBy + 1e-6))
        for (const u of us) {
          const c0 = edgeC - inward * ps.out + inward * ps.slot * ps.len, c1 = c0 + inward * ps.len;
          const rect: R = alongX ? { x: u, y: Math.min(c0, c1), w: bw, d: ps.len } : { x: Math.min(c0, c1), y: u, w: ps.len, d: bw };
          if (rect.x < -0.01 || rect.y < 0.3 || rect.x + rect.w > plan.plotW + 0.01) continue;
          if (doorZones.some((z) => ov(z, rect)) || chosen.some((z) => ov(z, rect)) || enclosed.some((q) => ov(q.rect, rect))) continue;
          // far from the doors, close to the car gate's line; under the porch roof before out on the driveway, the
          // front slot before the tandem one
          const cx = rect.x + rect.w / 2, cy = rect.y + rect.d / 2;
          const dd = Math.min(30, ...doorZones.map((z) => Math.hypot(z.x + z.w / 2 - cx, z.y + z.d / 2 - cy)));
          const gate = carGate ? -Math.abs(Number(carGate.at?.[0]) - cx) * 0.15 : 0;
          out.push({ rect, score: dd + gate - ps.slot * 4 - (ps.out - outBy) * 1.5, slot: ps.slot, u });
        }
      return out;
    };
    const feasible = (arr: R[]) => reachable(blockedBy([...chosen, ...arr], 1.5));
    /** the best arrangement of k bays of width bw that keeps the walkway open (exhaustive for 1 and 2 bays, then greedy) */
    const arrange = (k: number, bw: number, outward: boolean): C[] | null => {
      const cs = singles(bw, outward).sort((a, b) => b.score - a.score);
      if (!cs.length) return null;
      if (k === 1) return cs.find((c) => feasible([c.rect])) ? [cs.find((c) => feasible([c.rect]))!] : null;
      if (k === 2) {
        const pairs: [C, C, number][] = [];
        for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) if (!ov(cs[i].rect, cs[j].rect)) pairs.push([cs[i], cs[j], cs[i].score + cs[j].score]);
        pairs.sort((a, b) => b[2] - a[2]);
        let tests = 0;
        for (const [a, b] of pairs) {
          if (++tests > 400) break;
          if (feasible([a.rect, b.rect])) return [a, b];
        }
        return null;
      }
      const base = arrange(k - 1, bw, outward);
      if (!base) return null;
      const extra = cs.find((c) => !base.some((b) => ov(b.rect, c.rect)) && feasible([...base.map((b) => b.rect), c.rect]));
      return extra ? [...base, extra] : null;
    };
    const fitAcross = Math.max(1, Math.floor((width + 0.01) / BAY_W[BAY_W.length - 1])) * slots.length;
    // (EN-F5: every car under the porch roof, at the narrower 8.5 ft bay if need be, before one stands out over the
    // drive-in edge into the driveway)
    for (let k = Math.min(n, fitAcross); k >= 1; k--) {
      for (const [bw, outward] of [...BAY_W.map((b) => [b, false] as const), ...BAY_W.map((b) => [b, true] as const)]) {
        if (bw > width + 1e-6) continue;
        const arr = arrange(k, bw, outward);
        if (!arr) continue;
        for (const c of arr.sort((a, b) => a.slot - b.slot || a.u - b.u)) {
          chosen.push(c.rect);
          bays.push({ rect: c.rect, rot, room: pr.id, used: false, where: "porch" });
        }
        return arr.length;
      }
    }
    return 0;
  }
  // spare bays in the driveway (front setback) for further cars: nose toward the house, never on the walkway or
  // in front of a porch bay
  for (const dr of plan.roomsOn(g.id).filter((r) => r.type === "driveway")) {
    const r = dr.rect;
    const bl = BAY_L, bw = BAY_W[0];
    if (r.d < bl || r.w < bw) continue;
    for (let n = 0, cap = Math.min(2, wanted); n < cap; n++) {
      let best: { rect: R; score: number } | null = null;
      for (let u = r.x; u + bw <= r.x + r.w + 1e-6; u += 0.5) {
        const rect: R = { x: u, y: r.y + r.d - bl, w: bw, d: bl };
        if (chosen.some((z) => ov(z, rect)) || doorZones.some((z) => ov(z, rect))) continue;
        // not in front of a porch bay (that car must be able to drive out)
        if (bays.some((b) => b.where === "porch" && b.rect.x < rect.x + rect.w && rect.x < b.rect.x + b.rect.w)) continue;
        if (!reachable(blockedBy([...chosen, rect], 1.5))) continue;
        const gate = carGate ? -Math.abs(Number(carGate.at?.[0]) - (u + bw / 2)) * 0.1 : 0;
        const score = gate - n;
        if (!best || score > best.score) best = { rect, score };
      }
      if (!best) break;
      chosen.push(best.rect);
      bays.push({ rect: best.rect, rot: 0, room: dr.id, used: false, where: "driveway" });
      wanted--;
    }
  }
  const path = pathOn(blockedBy(chosen, 1.5)) ?? (approach ? [start, approach] : []);
  // the walkway: 3 ft wide around the centreline
  const wmask = new Uint8Array(nx * ny);
  for (const [x, y] of path) {
    const i0 = Math.floor((x - 1.5) / CELL), i1 = Math.ceil((x + 1.5) / CELL), j0 = Math.floor((y - 1.5) / CELL), j1 = Math.ceil((y + 1.5) / CELL);
    for (let j = Math.max(0, j0); j < Math.min(ny, j1); j++) for (let i = Math.max(0, i0); i < Math.min(nx, i1); i++) if (Math.hypot((i + 0.5) * CELL - x, (j + 0.5) * CELL - y) <= 1.5) wmask[j * nx + i] = 1;
  }
  const onWalkway = (x: number, y: number) => {
    const i = Math.floor(x / CELL), j = Math.floor(y / CELL);
    return i >= 0 && j >= 0 && i < nx && j < ny && wmask[j * nx + i] === 1;
  };
  return { bays, path, onWalkway, door, approach, doorCentre };
}

/**
 * EN3-02: the way each car drives in: its bay less 1 ft on each side (the car's doors and mirrors stay inside), from
 * the plot edge the car comes in from to the bay's far end (plan ft boxes). Nothing low may stand in it.
 */
export function carWays(p: Parking, plotW: number, plotD: number): { x0: number; x1: number; y0: number; y1: number }[] {
  return p.bays.map(({ rect: r, rot }) => {
    if (rot === 0) return { x0: r.x + 1, x1: r.x + r.w - 1, y0: 0, y1: r.y + r.d };
    if (rot === 180) return { x0: r.x + 1, x1: r.x + r.w - 1, y0: r.y, y1: plotD };
    if (rot === -90) return { x0: 0, x1: r.x + r.w, y0: r.y + 1, y1: r.y + r.d - 1 };
    return { x0: r.x, x1: plotW, y0: r.y + 1, y1: r.y + r.d - 1 };
  });
}

/**
 * EN3-02: the points of a footprint (sampled every 0.25 ft) that stand out in the open, more than 1 ft from every
 * enclosed ground-floor room (half a wall and a skin on it): cladding or fins on the house wall are not something
 * people or cars run into, a frame post, a sill or a louvre post standing in front of the house is.
 */
export function openPoints(ctx: BuildCtx, f: { x0: number; x1: number; y0: number; y1: number }): [number, number][] {
  const g = ctx.plan.levels[0];
  const walls = ctx.plan.roomsOn(g.id).filter((r) => r.cat === "enclosed").map((r) => r.rect);
  const axis = (a: number, b: number) => {
    const out = [a, b, (a + b) / 2];
    for (let v = a + 0.25; v < b - 0.05; v += 0.25) out.push(v);
    return out;
  };
  const out: [number, number][] = [];
  for (const x of axis(f.x0, f.x1))
    for (const y of axis(f.y0, f.y1)) if (!walls.some((r) => x > r.x - 1 && x < r.x + r.w + 1 && y > r.y - 1 && y < r.y + r.d + 1)) out.push([x, y]);
  return out;
}

/** Does a footprint touch the walkway? (sampled every 0.5 ft) */
export function onWalkwayRect(p: Parking, f: { x0: number; x1: number; y0: number; y1: number }): boolean {
  for (let x = f.x0 + 0.1; x < f.x1; x += 0.5) for (let y = f.y0 + 0.1; y < f.y1; y += 0.5) if (p.onWalkway(x, y)) return true;
  for (let x = f.x0 + 0.1; x < f.x1; x += 0.5) if (p.onWalkway(x, f.y1 - 0.1)) return true;
  for (let y = f.y0 + 0.1; y < f.y1; y += 0.5) if (p.onWalkway(f.x1 - 0.1, y)) return true;
  return false;
}

class MinHeap {
  private k: number[] = [];
  private v: number[] = [];
  get size(): number {
    return this.k.length;
  }
  push(key: number, val: number): void {
    const k = this.k, v = this.v;
    k.push(key);
    v.push(val);
    let i = k.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (v[p] <= v[i]) break;
      [k[p], k[i]] = [k[i], k[p]];
      [v[p], v[i]] = [v[i], v[p]];
      i = p;
    }
  }
  pop(): [number, number] {
    const k = this.k, v = this.v;
    const top: [number, number] = [k[0], v[0]];
    const lk = k.pop()!, lv = v.pop()!;
    if (k.length) {
      k[0] = lk;
      v[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < k.length && v[l] < v[m]) m = l;
        if (r < k.length && v[r] < v[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]];
        [v[m], v[i]] = [v[i], v[m]];
        i = m;
      }
    }
    return top;
  }
}
