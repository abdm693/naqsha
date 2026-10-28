/** Facade toolkit: cladding, fins, louvers, frames, canopies, jaali screens, columns, wall lights, LED strips. */
import * as THREE from "three";
import type { FacadeRegion, MaterialSpec, Side } from "@contracts/house-sdk";
import type { Pt, Rect } from "@contracts/plan";
import type { BuildCtx } from "./core/ctx";
import { CellGrid } from "./core/grid";
import { MeshBuilder } from "./core/meshbuilder";
import { Kit } from "./core/shapes";
import { FT, clamp, color, colorHex, num, warn } from "./core/util";
import { makeCanvas } from "./materials/gen";
import { levelAtHeight } from "./lights";
import { carWays, openPoints, parking, type Parking } from "./furniture/parking";

const SIDES: Side[] = ["front", "back", "left", "right"];
export function side(s: unknown): Side {
  return SIDES.includes(s as Side) ? (s as Side) : (warn(`unknown side "${String(s)}", using front`), "front");
}
/** outward unit normal in plan for a side */
const OUT: Record<Side, [number, number]> = { front: [0, -1], back: [0, 1], left: [-1, 0], right: [1, 0] };
const outSign = (s: Side) => (s === "front" || s === "left" ? -1 : 1);

/** Box in face space: u along the face, o = plan coordinate across (plane), h heights (ft). */
function faceBox(mb: MeshBuilder, s: Side, u0: number, u1: number, p0: number, p1: number, h0: number, h1: number): void {
  const [a0, a1] = [Math.min(u0, u1), Math.max(u0, u1)];
  const [b0, b1] = [Math.min(p0, p1), Math.max(p0, p1)];
  if (a1 - a0 < 1e-4 || b1 - b0 < 1e-4 || h1 - h0 < 1e-4) return;
  if (s === "front" || s === "back") mb.box(a0 * FT, h0 * FT, b0 * FT, a1 * FT, h1 * FT, b1 * FT);
  else mb.box(b0 * FT, h0 * FT, a0 * FT, b1 * FT, h1 * FT, a1 * FT);
}

interface Reg {
  side: Side;
  u0: number;
  u1: number;
  h0: number;
  h1: number;
}
function region(o: Partial<FacadeRegion>): Reg {
  const s = side(o?.side);
  let u0 = num(o?.from_x_ft, 0), u1 = num(o?.to_x_ft, u0 + 4);
  let h0 = num(o?.from_h_ft, 0), h1 = num(o?.to_h_ft, h0 + 3);
  if (u1 < u0) [u0, u1] = [u1, u0];
  if (h1 < h0) [h0, h1] = [h1, h0];
  if (u1 - u0 < 0.1) u1 = u0 + 0.1;
  if (h1 - h0 < 0.1) h1 = h0 + 0.1;
  return { side: s, u0: clamp(u0, -60, 400), u1: clamp(u1, -60, 400), h0: clamp(h0, -2, 80), h1: clamp(h1, -2, 90) };
}

/** A face-space box (u along the face, p across it) as a plan box (ft). */
function planBox(s: Side, u0: number, u1: number, p0: number, p1: number): Box2 {
  const [a0, a1] = [Math.min(u0, u1), Math.max(u0, u1)];
  const [b0, b1] = [Math.min(p0, p1), Math.max(p0, p1)];
  return s === "front" || s === "back" ? { x0: a0, x1: a1, y0: b0, y1: b1 } : { x0: b0, x1: b1, y0: a0, y1: a1 };
}
type Box2 = { x0: number; x1: number; y0: number; y1: number };

/** EN3-02: a facade member lower than this above the ground under it is something a walker or a car runs into */
const LOW_FT = 7;

export function facadeAPI(ctx: BuildCtx) {
  const M = ctx.mats;
  // Projections never cross a party-wall plot edge and reach at most 1.5 / 3 ft into open setbacks
  // (StructureModel.envelope); geometry beyond that is cut off with a warning.
  let clipped = false;
  // EN3-02: the members built since the last finish(), as plan boxes (ctx.facadeBlocks keeps the colliding ones)
  let members: (Box2 & { h0: number; h1: number })[] = [];
  const fbox = (mb: MeshBuilder, s: Side, u0: number, u1: number, p0: number, p1: number, h0: number, h1: number): void => {
    const axis = s === "front" || s === "back" ? "x" : "y";
    const c = ctx.model.clipRunBox(axis, u0, u1, p0, p1);
    const lo = (a: number, b: number) => Math.min(a, b), hi = (a: number, b: number) => Math.max(a, b);
    if (!c || c[0] > lo(u0, u1) + 1e-3 || c[1] < hi(u0, u1) - 1e-3 || c[2] > lo(p0, p1) + 1e-3 || c[3] < hi(p0, p1) - 1e-3) clipped = true;
    if (c) {
      faceBox(mb, s, c[0], c[1], c[2], c[3], h0, h1);
      members.push({ ...planBox(s, c[0], c[1], c[2], c[3]), h0: Math.min(h0, h1), h1: Math.max(h0, h1) });
    }
  };
  /**
   * EN3-02: where a low facade member may not stand: each parking bay and the way its car drives in (the bay's width
   * less 1 ft a side, from the plot edge it is entered from to its far end), 3 ft in front of every ground-floor door
   * to the outside or onto a porch (± 0.3 ft), 3 ft inside every gate, and the 3 ft walkway from the gate to the main
   * door. Computed once, on the first member that needs it.
   */
  let keep: { zones: Box2[]; walk: Parking | null } | null = null;
  const keepClear = (): { zones: Box2[]; walk: Parking | null } => {
    if (keep) return keep;
    const zones: Box2[] = [];
    let walk: Parking | null = null;
    if (ctx.structureBuilt) {
      const plan = ctx.plan;
      const g = plan.levels[0];
      walk = parking(ctx);
      zones.push(...carWays(walk, plan.plotW, plan.plotD));
      for (const o of ctx.model.openings) {
        if (!o.isDoor || o.op.level !== g.id) continue;
        const run = o.run;
        for (const [r, into] of [[o.neg, -1], [o.pos, 1]] as const) {
          if (r ? r.cat === "enclosed" : run.out !== into) continue;
          const c0 = run.c + (into * run.t) / 2, c1 = c0 + into * 3;
          zones.push(run.axis === "x" ? { x0: o.u0 - 0.3, x1: o.u1 + 0.3, y0: Math.min(c0, c1), y1: Math.max(c0, c1) } : { x0: Math.min(c0, c1), x1: Math.max(c0, c1), y0: o.u0 - 0.3, y1: o.u1 + 0.3 });
        }
      }
      for (const gt of plan.plan.site?.gates ?? []) {
        const gx = Number(gt?.at?.[0]), gy = Number(gt?.at?.[1]), w = Number(gt?.width_ft) || 4;
        if (!Number.isFinite(gx) || !Number.isFinite(gy) || gy > 1) continue;
        zones.push({ x0: gx - w / 2, x1: gx + w / 2, y0: 0, y1: 3 });
      }
    }
    return (keep = { zones, walk });
  };
  /** Does a facade member with this plan footprint, starting at h0, stand in a way that must stay clear? (only its
   *  part out in the open counts, see openPoints) */
  const inTheWay = (b: Box2, h0: number): boolean => {
    if (!ctx.structureBuilt) return false;
    const floor = floorBelow(ctx, (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, h0 + 0.5);
    if (h0 >= floor + LOW_FT) return false;
    const K = keepClear();
    return openPoints(ctx, b).some(([x, y]) => K.zones.some((z) => x > z.x0 + 0.02 && x < z.x1 - 0.02 && y > z.y0 + 0.02 && y < z.y1 - 0.02) || (!!K.walk && K.walk.onWalkway(x, y)));
  };
  const plane = (r: Reg, withExtras = false): number => {
    const p = ctx.model.outerPlane(r.side, r.u0, r.u1, r.h0, r.h1, withExtras ? ctx.facadeSurfs : undefined);
    if (p !== null) return p;
    return ctx.model.face(r.side).plane_ft;
  };
  const tag = (kind: string, label: string, h0: number, h1: number) => ({
    kind: `facade:${kind}`,
    label,
    level: levelAtHeight(ctx, (h0 + h1) / 2),
  });
  const finish = (kit: Kit, kind: string, label: string, r: Reg, collide = true, shadows = true): THREE.Group => {
    if (clipped) warn(`facade.${kind} on the ${r.side}: cut back to the plot / setback projection limit`);
    clipped = false;
    const g = kit.build(new THREE.Group(), shadows);
    ctx.add(g, tag(kind, label, r.h0, r.h1));
    if (collide) g.traverse((o) => (o as THREE.Mesh).isMesh && ctx.collider(o as THREE.Mesh));
    else g.traverse((o) => (o.userData.collide = false));
    if (collide) for (const m of members) ctx.facadeBlocks.push({ kind: `facade:${kind}`, ...m });
    members = [];
    return g;
  };
  const register = (r: Reg, p: number) => ctx.facadeSurfs.push({ side: r.side, plane: p, u0: r.u0, u1: r.u1, h0: r.h0, h1: r.h1 });
  const openingsOn = (r: Reg, p: number, depth: number) =>
    ctx.model.openings.filter((o) => {
      const run = o.run;
      if (run.out === 0) return false;
      const sd: Side = run.axis === "x" ? (run.out < 0 ? "front" : "back") : run.out < 0 ? "left" : "right";
      if (sd !== r.side) return false;
      const face = run.c + (run.out * run.t) / 2;
      return Math.abs(face - p) < depth + 1.6;
    });

  function cladding(o: FacadeRegion & { depth_ft?: number }): void {
    const r = region(o);
    const depth = clamp(num(o?.depth_ft, 0.1), 0.02, 6);
    const p = plane(r);
    const sgn = outSign(r.side);
    // subtract openings that sit mostly inside the region horizontally
    const holes: { u0: number; u1: number; h0: number; h1: number }[] = [];
    for (const op of openingsOn(r, p, depth)) {
      const ov = Math.min(op.u1, r.u1) - Math.max(op.u0, r.u0);
      if (ov <= 0 || op.top <= r.h0 || op.bottom >= r.h1) continue;
      if (ov / (op.u1 - op.u0) >= 0.5) holes.push({ u0: op.u0 - 0.04, u1: op.u1 + 0.04, h0: op.bottom - 0.04, h1: op.top + 0.04 });
    }
    const g = CellGrid.fromRects<boolean>([
      { rect: { x: r.u0, y: r.h0, w: r.u1 - r.u0, d: r.h1 - r.h0 }, val: true },
      ...holes.map((h) => ({ rect: { x: h.u0, y: h.h0, w: h.u1 - h.u0, d: h.h1 - h.h0 }, val: false })),
    ]);
    const mat = M.get(o?.material, "stone_cladding");
    const kit = new Kit();
    const mb = kit.mb(mat);
    members = [];
    for (const rr of g.rects((v) => v === true)) fbox(mb, r.side, rr.x, rr.x + rr.w, p, p + sgn * depth, rr.y, rr.y + rr.d);
    if (kit.empty) {
      members = [];
      return;
    }
    finish(kit, "cladding", "Facade cladding", r);
    register(r, p + sgn * depth);
  }

  function fins(o: FacadeRegion & { count: number; width_ft?: number; depth_ft?: number }): void {
    const r = region(o);
    const n = Math.round(clamp(num(o?.count, 6), 1, 80));
    const w = clamp(num(o?.width_ft, 0.33), 0.05, 4);
    const d = clamp(num(o?.depth_ft, 0.75), 0.05, 6);
    const p = plane(r);
    const sgn = outSign(r.side);
    const mat = M.get(o?.material, "wood_teak");
    const kit = new Kit();
    const mb = kit.mb(mat);
    members = [];
    const gap = 0.06;
    const span = r.u1 - r.u0;
    for (let k = 0; k < n; k++) {
      const c = n === 1 ? (r.u0 + r.u1) / 2 : r.u0 + w / 2 + ((span - w) * k) / (n - 1);
      fbox(mb, r.side, c - w / 2, c + w / 2, p + sgn * gap, p + sgn * (gap + d), r.h0, r.h1);
    }
    // slim top + bottom carrier rails behind the fins (EN3-02: a rail lower than 7 ft is left off where it would
    // cross a porch's car way, a door or gate, or the walkway)
    const rail = M.get("metal_black");
    const railFoot = planBox(r.side, r.u0, r.u1, p + sgn * 0.02, p + sgn * (gap + 0.12));
    let dropped = 0;
    for (const [h0, h1] of [[r.h1 - 0.1, r.h1], [r.h0, r.h0 + 0.1]]) {
      if (inTheWay(railFoot, h0)) dropped++;
      else fbox(kit.mb(rail), r.side, r.u0, r.u1, p + sgn * 0.02, p + sgn * (gap + 0.12), h0, h1);
    }
    if (dropped) warn(`facade.fins on the ${r.side}: ${dropped === 1 ? "a carrier rail" : "the carrier rails"} left off to keep a door, the walkway or the car way clear`);
    finish(kit, "fins", "Vertical fins", r);
    register(r, p + sgn * (gap + d));
  }

  function louvers(o: FacadeRegion & { count: number; depth_ft?: number; thickness_ft?: number }): void {
    const r = region(o);
    const n = Math.round(clamp(num(o?.count, 8), 1, 120));
    const d = clamp(num(o?.depth_ft, 0.6), 0.05, 5);
    const t = clamp(num(o?.thickness_ft, 0.12), 0.02, 2);
    const p = plane(r);
    const sgn = outSign(r.side);
    const mat = M.get(o?.material, "wood_teak");
    const kit = new Kit();
    const mb = kit.mb(mat);
    members = [];
    const span = r.h1 - r.h0;
    // EN3-02: slats and posts lower than 7 ft are left off where they would cross a porch's car way, a door or gate,
    // or the walkway
    let dropped = 0;
    const slatFoot = planBox(r.side, r.u0, r.u1, p + sgn * 0.05, p + sgn * (0.05 + d));
    for (let k = 0; k < n; k++) {
      const hc = n === 1 ? (r.h0 + r.h1) / 2 : r.h0 + t / 2 + ((span - t) * k) / (n - 1);
      if (inTheWay(slatFoot, hc - t / 2)) {
        dropped++;
        continue;
      }
      fbox(mb, r.side, r.u0, r.u1, p + sgn * 0.05, p + sgn * (0.05 + d), hc - t / 2, hc + t / 2);
    }
    const post = M.get("metal_black");
    for (const u of [r.u0, r.u1]) {
      if (inTheWay(planBox(r.side, u - 0.06, u + 0.06, p, p + sgn * (0.05 + d * 0.6)), r.h0)) {
        dropped++;
        continue;
      }
      fbox(kit.mb(post), r.side, u - 0.06, u + 0.06, p, p + sgn * (0.05 + d * 0.6), r.h0, r.h1);
    }
    if (dropped) warn(`facade.louvers on the ${r.side}: ${dropped} low slat(s) or post(s) left off to keep a door, the walkway or the car way clear`);
    if (kit.empty) {
      members = [];
      return;
    }
    finish(kit, "louvers", "Horizontal louvers", r);
    register(r, p + sgn * (0.05 + d));
  }

  function frame(o: FacadeRegion & { thickness_ft?: number; depth_ft?: number }): void {
    const r = region(o);
    const t = clamp(num(o?.thickness_ft, 1.0), 0.1, Math.min(r.u1 - r.u0, r.h1 - r.h0) / 2);
    const d = clamp(num(o?.depth_ft, 1.5), 0.1, 8);
    const p = plane(r);
    const sgn = outSign(r.side);
    const mat = M.get(o?.material, "plaster_white");
    const kit = new Kit();
    const mb = kit.mb(mat);
    members = [];
    // EN3-02: a frame standing on the ground (its bottom within 1 ft of the ground or plinth under it) is built as a
    // U, with no sill member to trip over or close a porch; and no member lower than 7 ft crosses a porch's car way, a
    // door or gate opening, or the gate-to-door walkway: such a sill or head is left off, and such a post slides in
    // along the frame until it is clear (or is left off)
    const foot = (u0: number, u1: number) => planBox(r.side, u0, u1, p, p + sgn * d);
    const whole = foot(r.u0, r.u1);
    const ground = Math.max(floorBelow(ctx, (whole.x0 + whole.x1) / 2, (whole.y0 + whole.y1) / 2, r.h0 + 0.5), ctx.plan.levels[0]?.elev ?? ctx.plan.grade);
    const sill = !(r.h0 <= ground + 1 + 1e-6) && !inTheWay(whole, r.h0);
    const head = !inTheWay(whole, r.h1 - t);
    // (a U's posts stand on the ground under them, not on the plinth level the frame was drawn from)
    const postFrom = sill ? r.h0 + t : r.h0 <= ground + 1 + 1e-6 ? Math.min(r.h0, floorBelow(ctx, (whole.x0 + whole.x1) / 2, (whole.y0 + whole.y1) / 2, r.h0 + 0.5)) : r.h0;
    const notes: string[] = [];
    if (!sill) notes.push("built as a U (no bottom member)");
    if (head) fbox(mb, r.side, r.u0, r.u1, p, p + sgn * d, r.h1 - t, r.h1);
    else notes.push("head left off");
    if (sill) fbox(mb, r.side, r.u0, r.u1, p, p + sgn * d, r.h0, r.h0 + t);
    const slide = Math.max(0, (r.u1 - r.u0) / 2 - t);
    for (const k of [1, -1]) {
      let at: number | null = null;
      for (let s = 0; s <= slide + 1e-6 && at === null; s += 0.25) {
        const a = k > 0 ? r.u0 + s : r.u1 - s - t;
        if (!inTheWay(foot(a, a + t), postFrom)) at = a;
      }
      if (at === null) {
        notes.push(`${k > 0 ? "first" : "second"} post left off`);
        continue;
      }
      if (Math.abs(at - (k > 0 ? r.u0 : r.u1 - t)) > 1e-6) notes.push(`${k > 0 ? "first" : "second"} post moved ${Math.abs(at - (k > 0 ? r.u0 : r.u1 - t)).toFixed(2)} ft in`);
      fbox(mb, r.side, at, at + t, p, p + sgn * d, postFrom, r.h1 - t);
    }
    if (notes.length) warn(`facade.frame on the ${r.side}: ${notes.join(", ")} (it stands on the ground, or across a door, the walkway or the car way)`);
    if (kit.empty) {
      members = [];
      return;
    }
    finish(kit, "frame", "Projecting frame", r);
    register(r, p + sgn * d);
  }

  function canopy(o: { rect: Rect; h_ft: number; thickness_ft?: number; material: MaterialSpec; downlights?: boolean }): void {
    const rc = o?.rect ?? ({} as Rect);
    let x = num(rc.x, 0), y = num(rc.y, 0), w = num(rc.w, 6), d = num(rc.d, 4);
    if (w < 0) { x += w; w = -w; }
    if (d < 0) { y += d; d = -d; }
    w = clamp(w, 0.3, 200);
    d = clamp(d, 0.3, 200);
    const cr = ctx.model.clipRect({ x, y, w, d });
    if (!cr) {
      warn("facade.canopy lies entirely outside the plot / setback projection limit; skipped");
      return;
    }
    if (cr.w < w - 1e-3 || cr.d < d - 1e-3) warn("facade.canopy: cut back to the plot / setback projection limit");
    ({ x, y, w, d } = cr);
    const top = clamp(num(o?.h_ft, 10), 0, 80);
    const t = clamp(num(o?.thickness_ft, 0.5), 0.08, 4);
    const mat = M.get(o?.material, "plaster_white");
    const kit = new Kit();
    kit.mb(mat).box(x * FT, (top - t) * FT, y * FT, (x + w) * FT, top * FT, (y + d) * FT);
    const r: Reg = { side: "front", u0: x, u1: x + w, h0: top - t, h1: top };
    if (o?.downlights) {
      const ring = M.basic("#d9d6d0", { roughness: 0.4 });
      const lamp = M.emissive("#ffd7a1", 2.4);
      const nx = Math.max(1, Math.round(w / 4)), ny = Math.max(1, Math.round(d / 4));
      const glowMat = M.glow("#ffc98a", "radial", 0.5);
      const gm = new MeshBuilder();
      for (let i = 0; i < nx; i++)
        for (let j = 0; j < ny; j++) {
          const px = x + (w * (i + 0.5)) / nx, py = y + (d * (j + 0.5)) / ny;
          kit.cyl(ring, px * FT, (top - t) * FT - 0.004, py * FT, 0.06, 0.012, 20);
          kit.cyl(lamp, px * FT, (top - t) * FT - 0.011, py * FT, 0.045, 0.004, 20);
          // light pool on the surface below
          const floor = floorBelow(ctx, px, py, top - t);
          const rad = clamp((top - t - floor) * 0.42, 1.2, 4);
          gm.faceY((floor + 0.015) * FT, (px - rad) * FT, (px + rad) * FT, (py - rad) * FT, (py + rad) * FT, 1);
        }
      fixGlowUV(gm);
      const geo = gm.build();
      if (geo) {
        const pool = new THREE.Mesh(geo, glowMat);
        pool.renderOrder = 3;
        pool.userData.glow = true;
        ctx.add(pool, { kind: "light:glow", label: "Canopy light pools", level: levelAtHeight(ctx, top - t - 6) });
        pool.userData.collide = false;
      }
    }
    finish(kit, "canopy", "Canopy", r);
  }

  function screen(o: FacadeRegion & { pattern: "jaali_geometric" | "jaali_star" | "perforated" | "slats" }): void {
    const r = region(o);
    const p = plane(r);
    const sgn = outSign(r.side);
    const pattern = ["jaali_geometric", "jaali_star", "perforated", "slats"].includes(o?.pattern) ? o.pattern : "jaali_geometric";
    if (pattern === "slats") {
      const n = Math.max(3, Math.round((r.u1 - r.u0) / 0.42));
      fins({ ...(o as FacadeRegion), count: n, width_ft: 0.18, depth_ft: 0.35 } as FacadeRegion & { count: number });
      return;
    }
    const base = M.get(o?.material, "plaster_white") as THREE.MeshStandardMaterial;
    const mat = base.clone();
    mat.alphaMap = jaaliTexture(pattern);
    mat.alphaTest = 0.5;
    mat.side = THREE.DoubleSide;
    const tile = pattern === "perforated" ? 0.5 : 1.2; // ft per pattern repeat
    mat.alphaMap.repeat.set(1 / (tile * FT), 1 / (tile * FT));
    ctx.mats.created.push(mat);
    const kit = new Kit();
    const mb = kit.mb(mat);
    const off = 0.35;
    fbox(mb, r.side, r.u0, r.u1, p + sgn * off, p + sgn * (off + 0.06), r.h0, r.h1);
    // frame around the screen
    const fm = M.get("metal_black");
    const fb = kit.mb(fm);
    fbox(fb, r.side, r.u0 - 0.1, r.u1 + 0.1, p, p + sgn * (off + 0.1), r.h1, r.h1 + 0.12);
    fbox(fb, r.side, r.u0 - 0.1, r.u1 + 0.1, p, p + sgn * (off + 0.1), r.h0 - 0.12, r.h0);
    fbox(fb, r.side, r.u0 - 0.1, r.u0, p, p + sgn * (off + 0.1), r.h0, r.h1);
    fbox(fb, r.side, r.u1, r.u1 + 0.1, p, p + sgn * (off + 0.1), r.h0, r.h1);
    finish(kit, "screen", "Jaali screen", r, false);
    register(r, p + sgn * (off + 0.06));
  }

  function column(o: { at: Pt; from_h_ft: number; to_h_ft: number; size_ft?: number; round?: boolean; material: MaterialSpec }): void {
    const at = Array.isArray(o?.at) ? o.at : [0, 0];
    let x = num(at[0], 0), y = num(at[1], 0);
    let h0 = num(o?.from_h_ft, 0), h1 = num(o?.to_h_ft, h0 + 10);
    if (h1 < h0) [h0, h1] = [h1, h0];
    if (h1 - h0 < 0.2) h1 = h0 + 0.2;
    const s = clamp(num(o?.size_ft, 1), 0.2, 8);
    {
      // keep the column inside the projection envelope
      const e = ctx.model.envelope;
      const cx = clamp(x, e.x0 + s / 2, e.x1 - s / 2), cy = clamp(y, e.y0 + s / 2, e.y1 - s / 2);
      if (Math.abs(cx - x) > 1e-3 || Math.abs(cy - y) > 1e-3) warn("facade.column: moved inside the plot / setback projection limit");
      x = cx;
      y = cy;
    }
    const mat = M.get(o?.material, "plaster_white");
    const kit = new Kit();
    if (o?.round) kit.cyl(mat, x * FT, ((h0 + h1) / 2) * FT, y * FT, (s / 2) * FT, (h1 - h0) * FT, 32);
    else kit.mb(mat).box((x - s / 2) * FT, h0 * FT, (y - s / 2) * FT, (x + s / 2) * FT, h1 * FT, (y + s / 2) * FT);
    const r: Reg = { side: "front", u0: x - s / 2, u1: x + s / 2, h0, h1 };
    finish(kit, "column", "Column", r);
    for (const sd of SIDES) {
      const [ox, oy] = OUT[sd];
      const planeV = sd === "front" || sd === "back" ? y + (oy * s) / 2 : x + (ox * s) / 2;
      const u0 = sd === "front" || sd === "back" ? x - s / 2 : y - s / 2;
      ctx.facadeSurfs.push({ side: sd, plane: planeV, u0, u1: u0 + s, h0, h1 });
    }
  }

  function wall_light(o: { side: Side; x_ft: number; h_ft: number; color?: string; intensity?: number }): void {
    const s = side(o?.side);
    const u = num(o?.x_ft, 10), h = num(o?.h_ft, 8, -2, 80);
    const k = clamp(num(o?.intensity, 1), 0, 6);
    const hex = colorHex(o?.color, "#ffd9a8");
    const r: Reg = { side: s, u0: u - 0.3, u1: u + 0.3, h0: h - 0.3, h1: h + 0.3 };
    const p = plane(r, true);
    const sgn = outSign(s);
    const kit = new Kit();
    const body = M.get("metal_black");
    const mb = kit.mb(body);
    fbox(mb, s, u - 0.13, u + 0.13, p, p + sgn * 0.32, h - 0.32, h + 0.32);
    const lamp = M.emissive(hex, 3.5 * k);
    fbox(kit.mb(lamp, false), s, u - 0.09, u + 0.09, p + sgn * 0.08, p + sgn * 0.26, h + 0.32, h + 0.335);
    fbox(kit.mb(lamp, false), s, u - 0.09, u + 0.09, p + sgn * 0.08, p + sgn * 0.26, h - 0.335, h - 0.32);
    finish(kit, "wall_light", "Wall washer", r, false);
    // up/down light cones washing the wall
    const glow = new MeshBuilder();
    const H = 4.2 * clamp(k, 0.6, 2);
    glowQuad(glow, s, u, p + sgn * 0.015, h, 1.7, H);
    fixGlowUV(glow, true);
    const geo = glow.build();
    if (geo) {
      const mm = new THREE.Mesh(geo, M.glow(hex, "cone_ud", clamp(0.55 * k, 0.15, 0.95)));
      mm.renderOrder = 3;
      mm.userData.glow = true;
      ctx.add(mm, { kind: "light:glow", label: "Wall wash", level: levelAtHeight(ctx, h) });
      mm.userData.collide = false;
    }
  }

  function led_strip(o: { side: Side; from_x_ft: number; to_x_ft: number; h_ft: number; color?: string }): void {
    const s = side(o?.side);
    let u0 = num(o?.from_x_ft, 0), u1 = num(o?.to_x_ft, u0 + 4);
    if (u1 < u0) [u0, u1] = [u1, u0];
    const h = num(o?.h_ft, 10, -2, 80);
    const hex = colorHex(o?.color, "#ffd9a8");
    const r: Reg = { side: s, u0, u1, h0: h - 0.3, h1: h + 0.3 };
    const p = plane(r, true);
    const sgn = outSign(s);
    const kit = new Kit();
    fbox(kit.mb(M.emissive(hex, 4), false), s, u0, u1, p + sgn * 0.01, p + sgn * 0.07, h - 0.04, h + 0.04);
    finish(kit, "led_strip", "LED strip", r, false, false);
    const glow = new MeshBuilder();
    glowQuad(glow, s, (u0 + u1) / 2, p + sgn * 0.02, h, u1 - u0 + 0.4, 2.2, true);
    fixGlowUV(glow, true);
    const geo = glow.build();
    if (geo) {
      const mm = new THREE.Mesh(geo, M.glow(hex, "band", 0.5));
      mm.renderOrder = 3;
      mm.userData.glow = true;
      ctx.add(mm, { kind: "light:glow", label: "LED glow", level: levelAtHeight(ctx, h) });
      mm.userData.collide = false;
    }
  }

  return { cladding, fins, louvers, frame, canopy, screen, column, wall_light, led_strip };
}

/** A vertical quad on a facade plane centered at (u, h) of size w × H (ft). For cones the light source sits at mid-height. */
function glowQuad(mb: MeshBuilder, s: Side, u: number, p: number, h: number, w: number, H: number, centered = true): void {
  const h0 = centered ? h - H / 2 : h, h1 = centered ? h + H / 2 : h + H;
  const dir = outSign(s);
  if (s === "front" || s === "back") mb.faceZ(p * FT, (u - w / 2) * FT, (u + w / 2) * FT, h0 * FT, h1 * FT, dir);
  else mb.faceX(p * FT, h0 * FT, h1 * FT, (u - w / 2) * FT, (u + w / 2) * FT, dir);
}

/** Replace box-projected UVs of glow quads with 0..1 per quad (4 verts each). */
function fixGlowUV(mb: MeshBuilder, vertical = false): void {
  const n = mb.uv.length / 8;
  for (let q = 0; q < n; q++) {
    const base = q * 8;
    // MeshBuilder quads are emitted as BL, BR, TR, TL
    const uvs = [0, 0, 1, 0, 1, 1, 0, 1];
    for (let k = 0; k < 8; k++) mb.uv[base + k] = uvs[k];
  }
  void vertical;
}

/** Highest walkable surface under (x,y) below height `below` (ft). */
export function floorBelow(ctx: BuildCtx, x: number, y: number, below: number): number {
  let best = ctx.plan.grade;
  for (const r of ctx.plan.rooms) {
    if (x < r.rect.x || x > r.rect.x + r.rect.w || y < r.rect.y || y > r.rect.y + r.rect.d) continue;
    if (r.floorH < below - 0.2 && r.floorH > best) best = r.floorH;
  }
  if (x < 0 || y < 0 || x > ctx.plan.plotW || y > ctx.plan.plotD) best = Math.min(best, y < 0 ? ctx.plan.grade : best);
  return best;
}

const jaaliCache = new Map<string, THREE.Texture>();
function jaaliTexture(kind: string): THREE.Texture {
  let t = jaaliCache.get(kind);
  if (t) return t.clone();
  const N = 256;
  const cv = makeCanvas(N);
  const g = cv.getContext("2d") as CanvasRenderingContext2D;
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, N, N);
  g.fillStyle = "#000000";
  if (kind === "perforated") {
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 4; j++) {
        g.beginPath();
        g.arc((i + 0.5) * (N / 4) + (j % 2 ? N / 8 : 0), (j + 0.5) * (N / 4), N / 13, 0, Math.PI * 2);
        g.fill();
        if (j % 2) {
          g.beginPath();
          g.arc(((i + 0.5) * (N / 4) + N / 8) - N, (j + 0.5) * (N / 4), N / 13, 0, Math.PI * 2);
          g.fill();
        }
      }
  } else if (kind === "jaali_star") {
    const star = (cx: number, cy: number, R: number) => {
      g.beginPath();
      for (let k = 0; k < 16; k++) {
        const a = (k * Math.PI) / 8;
        const rr = k % 2 ? R * 0.55 : R;
        const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
        if (k) g.lineTo(x, y);
        else g.moveTo(x, y);
      }
      g.closePath();
      g.fill();
    };
    for (const [cx, cy] of [[0, 0], [N, 0], [0, N], [N, N], [N / 2, N / 2]]) star(cx, cy, N * 0.3);
    for (const [cx, cy] of [[N / 2, 0], [0, N / 2], [N, N / 2], [N / 2, N]]) {
      g.beginPath();
      g.arc(cx, cy, N * 0.07, 0, Math.PI * 2);
      g.fill();
    }
  } else {
    // geometric lattice: rotated squares + diamonds (classic Mughal jaali)
    g.save();
    g.translate(N / 2, N / 2);
    g.rotate(Math.PI / 4);
    const s = N * 0.36;
    for (let i = -2; i <= 2; i++)
      for (let j = -2; j <= 2; j++) {
        g.fillRect(i * (N / Math.SQRT2) - s / 2, j * (N / Math.SQRT2) - s / 2, s, s);
      }
    g.restore();
    for (const [cx, cy] of [[0, N / 2], [N / 2, 0], [N, N / 2], [N / 2, N]]) {
      g.beginPath();
      g.arc(cx, cy, N * 0.12, 0, Math.PI * 2);
      g.fill();
    }
  }
  t = new THREE.CanvasTexture(cv as HTMLCanvasElement);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 8;
  jaaliCache.set(kind, t);
  return t.clone();
}

export { color };
