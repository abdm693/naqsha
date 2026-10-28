/**
 * Stairs: marble treads/risers on a concrete waist, landings, stringers, balustrades, stairwell guards and ramp
 * colliders. Fall protection (B.1): every open flight side and landing edge has a balustrade, every stairwell
 * edge on the upper floor a 3.5 ft guard except exactly where the top flight arrives (and where the next flight up
 * leaves), and every railing, balustrade and stringer is a walk collider.
 */
import * as THREE from "three";
import { CellGrid, rectContains } from "../core/grid";
import { MeshBuilder } from "../core/meshbuilder";
import { Kit } from "../core/shapes";
import { FT } from "../core/util";
import type { BuildCtx } from "../core/ctx";
import type { RoomM } from "../plan/model";
import { FINISH, type Flight, type StairLayout } from "./model";
import { P3, railing, skewBox, type RailMats, type RailType } from "./railings";
import { subtract, unguarded, type Span } from "./cover";

export interface StairMats {
  tread: (room: RoomM | null) => THREE.Material;
  body: THREE.Material;
  stringer: THREE.Material;
  rail: RailMats;
  railType: RailType;
}

/** guard height on level floors (IBC 1015: 42 in) and on flights (handrail 34–38 in above the nosing line) */
export const GUARD_H = 3.5;
const FLIGHT_H = 3.0;

const pt = (f: { axis: "x" | "y" }, along: number, across: number): [number, number] => (f.axis === "x" ? [along, across] : [across, along]);
const sEndOf = (f: Flight) => f.s0 + f.sign * (f.n - 1) * f.tread;

/** Where the hole edge on `level` must stay open: the top-riser line of a flight arriving there, and the band of any flight leaving from there. */
export function openingsOnEdge(ctx: BuildCtx, level: string, axis: "x" | "y", c: number): Span[] {
  const cuts: Span[] = [];
  for (const lay of ctx.model.stairs) {
    if (lay.holeLevel === level) {
      const t = lay.topRiser;
      if (t.axis === axis && Math.abs(t.c - c) < 0.08) cuts.push([t.a, t.b]);
    }
    if (lay.stair.from.id === level) {
      const f = lay.flights[0];
      if (!f || f.axis === axis) continue;
      const lo = Math.min(f.s0, sEndOf(f)) - f.tread, hi = Math.max(f.s0, sEndOf(f)) + f.tread;
      if (c > lo && c < hi) cuts.push([f.c0, f.c1]);
    }
  }
  return cuts;
}

export function buildStairs(ctx: BuildCtx, m: StairMats): void {
  const plan = ctx.plan;
  const holesOn = (lv: string) => ctx.model.stairs.filter((s) => s.holeLevel === lv).flatMap((s) => s.holes);
  /** a walkable floor point on a level: inside a room (not outdoor) and not in a stairwell */
  const floorAt = (lv: string, x: number, y: number) => {
    const r = plan.roomAt(lv, x, y);
    return !!r && r.cat !== "outdoor" && !holesOn(lv).some((h) => rectContains(h, x, y, -0.02));
  };

  for (const lay of ctx.model.stairs) {
    const s = lay.stair;
    const room = plan.roomAt(s.from.id, lay.rect.x + lay.rect.w / 2, lay.rect.y + lay.rect.d / 2);
    const tread = m.tread(room);
    const kit = new Kit(); // treads, risers, waist, landings: walked on via the ramp colliders
    const railKit = new Kit(); // stringers, balustrades, guards: walk colliders
    const glassKit = new Kit();
    const holeKit = new Kit(); // guards around the stairwell on the upper floor (tagged with that floor)
    const holeGlass = new Kit();
    for (const f of lay.flights) flightGeo(kit, f, tread, m.body);
    for (const L of lay.landings) {
      const r = L.rect;
      kit.mb(m.body).box(r.x * FT, (L.h - 0.55) * FT, r.y * FT, (r.x + r.w) * FT, (L.h - FINISH) * FT, (r.y + r.d) * FT);
      kit.mb(tread).box(r.x * FT, (L.h - FINISH) * FT, r.y * FT, (r.x + r.w) * FT, L.h * FT, (r.y + r.d) * FT);
    }
    // flights: stringer + balustrade on every open side; the well sides always get a full balustrade. The
    // first two treads may be left open on a side only when there is solid floor beside them (step on sideways).
    lay.flights.forEach((f, fi) => {
      const sEnd = sEndOf(f);
      const lo0 = Math.min(f.s0, sEnd), hi0 = Math.max(f.s0, sEnd);
      const hAt = (a: number) => f.h0 + f.riser + (f.n - 1) * f.riser * ((a - f.s0) / (sEnd - f.s0 || 1));
      for (const [c, out] of [[f.c0, -1], [f.c1, 1]] as const) {
        const isWell = lay.flights.some((o) => o !== f && o.axis === f.axis && (out > 0 ? o.c0 > c - 0.05 && o.c0 - c < 1.5 : c > o.c1 - 0.05 && c - o.c1 < 1.5));
        const fullSpans: Span[] = isWell ? [[lo0, hi0]] : unguarded(ctx, s.from.id, f.axis, c, lo0, hi0, 0.6, 0.5, false);
        // the first one or two treads stay open on a side only where solid floor lies beside them (nothing to
        // fall from): people step on sideways there, e.g. from under the upper flight of a dog-leg
        let gapStart = 0;
        if (fi === 0)
          for (let k = 1; k <= 2; k++) {
            let solid = true;
            for (let q = 0; q <= 3; q++) {
              const a = f.s0 + f.sign * (k - 1 + q / 3) * f.tread;
              const [x, y] = pt(f, a, c + out * 0.6);
              if (!floorAt(s.from.id, x, y)) solid = false;
            }
            if (!solid) break;
            gapStart = k * f.tread;
          }
        const lo = lo0 + (f.sign > 0 ? gapStart : 0), hi = hi0 - (f.sign > 0 ? 0 : gapStart);
        for (const [p, q] of fullSpans) {
          // stringer plate along the whole open side
          const cs = c + out * 0.04;
          const startEnd = f.sign > 0 ? p : q, endEnd = f.sign > 0 ? q : p;
          const [ax, ay] = pt(f, startEnd - (Math.abs(startEnd - f.s0) < 1e-3 ? f.sign * 0.05 : 0), cs);
          const [bx, by] = pt(f, endEnd, cs);
          const hA = hAt(startEnd), hB = hAt(endEnd);
          // (the stringer sits below the treads' edge: not a collider, so it never trips the walker stepping on)
          skewBox(kit.mb(m.stringer), P3(ax, ay, hA - 0.66), P3(bx - ax, by - ay, hB - hA), new THREE.Vector3(0, 0.78 * FT, 0), side(f, out, 0.06));
          const p2 = Math.max(p, lo), q2 = Math.min(q, hi);
          if (q2 - p2 < 0.6) continue;
          // (it ends at the last nosing, where the stairwell guard of the floor above takes over: no handrail
          // extension, which would narrow a tight top landing)
          const sa = f.sign > 0 ? p2 : q2, sb = f.sign > 0 ? q2 : p2;
          const [rx0, ry0] = pt(f, sa, c - out * 0.05);
          const [rx1, ry1] = pt(f, sb, c - out * 0.05);
          railing(railKit, glassKit, m.railType, rx0, ry0, hAt(sa) + 0.12, rx1, ry1, hAt(sb) + 0.12, FLIGHT_H, m.rail, { shoe: false, handrailWood: true });
        }
      }
    });
    // landings: guard every edge where no flight connects and no wall stands
    for (const L of lay.landings) {
      const r = L.rect;
      const edges: ["x" | "y", number, number, number][] = [
        ["x", r.y, r.x, r.x + r.w],
        ["x", r.y + r.d, r.x, r.x + r.w],
        ["y", r.x, r.y, r.y + r.d],
        ["y", r.x + r.w, r.y, r.y + r.d],
      ];
      for (const [axis, c, a, b] of edges) {
        const cover = lay.flights
          .filter((f) => f.axis !== axis && (Math.abs(f.s0 - c) < 0.3 || Math.abs(sEndOf(f) - c) < 0.3))
          .map((f) => [f.c0, f.c1] as Span);
        const free = subtract([[a, b]], cover, 0.3);
        for (const [p0, q0] of free)
          for (const [p, q] of unguarded(ctx, s.from.id, axis, c, p0, q0, 0.6, 0.3, false)) {
            const [x0, y0] = axis === "x" ? [p - 0.1, c] : [c, p - 0.1];
            const [x1, y1] = axis === "x" ? [q + 0.1, c] : [c, q + 0.1];
            railing(railKit, glassKit, m.railType, x0, y0, L.h, x1, y1, L.h, GUARD_H, m.rail, { handrailWood: true });
          }
      }
    }
    // stairwell guards on the upper floor: every edge, except the arrival opening and the band of a flight
    // leaving from that floor (its own balustrade continues the guard)
    const holeG = CellGrid.fromRects(lay.holes.map((h) => ({ rect: h, val: true })));
    const upper = plan.levelById.get(lay.holeLevel)!;
    const er = holeG.edgeRuns((n, p) => (n && !p ? "+" : p && !n ? "-" : null));
    for (const e of er) {
      const dir = e.key === "+" ? 1 : -1; // the floor is on this side of the line
      // guards of other stairs' holes on the same line count too, but not this stair's own (built below)
      const spans = unguarded(ctx, upper.id, e.axis, e.c, e.a, e.b, 0.6, 0.2);
      // (a gap under 4 in needs no guard: IBC 1015.4)
      const keep = subtract(spans, openingsOnEdge(ctx, upper.id, e.axis, e.c), 0.34);
      const c = e.c + dir * 0.12;
      for (const [p, q] of keep) {
        // reach into the walls / neighbouring guards at the ends, but not into an opening left for walking
        const openAt = (u: number) => openingsOnEdge(ctx, upper.id, e.axis, e.c).some(([a, b]) => u >= a - 0.05 && u <= b + 0.05);
        const p1 = openAt(p) ? p : p - 0.15, q1 = openAt(q) ? q : q + 0.15;
        const [x0, y0] = e.axis === "x" ? [p1, c] : [c, p1];
        const [x1, y1] = e.axis === "x" ? [q1, c] : [c, q1];
        railing(holeKit, holeGlass, m.railType, x0, y0, upper.elev, x1, y1, upper.elev, GUARD_H, m.rail, { handrailWood: true });
        ctx.guards.push({ level: upper.id, axis: e.axis, c: e.c, a: p1, b: q1, h: GUARD_H });
      }
    }
    // EN2-01: no head-strike zone. Wherever a flight or landing passes less than 6′8″ over walkable floor, the space
    // under it is closed off with built-in storage (a plastered box up to the soffit, cupboard doors on its open faces)
    const store = underStair(ctx, lay, floorAt);
    const storeKit = new Kit();
    for (const b of store) prism(storeKit.mb(m.body), b);
    for (const d of storeDoors(ctx, lay, store, floorAt)) {
      storeKit.mb(m.rail.rail).box(d.x0 * FT, d.h0 * FT, d.y0 * FT, d.x1 * FT, d.h1 * FT, d.y1 * FT);
      storeKit.mb(m.stringer).box(d.kx0 * FT, d.kh0 * FT, d.ky0 * FT, d.kx1 * FT, d.kh1 * FT, d.ky1 * FT);
    }
    lay.storage = store.map((b) => ({ axis: b.axis, a0: b.a0, a1: b.a1, c0: b.c0, c1: b.c1, floor: b.hb, top0: b.t0, top1: b.t1 }));
    const g = kit.build();
    ctx.add(g, { kind: "stair", level: s.from.id, room: room?.id, id: s.id, label: `Stair ${s.from.name} → ${s.to.name}` });
    if (!storeKit.empty) {
      const sg = storeKit.build();
      ctx.add(sg, { kind: "stair:storage", level: s.from.id, room: room?.id, id: `${s.id}_storage`, label: "Under-stair storage" });
      sg.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          o.userData.collide = true;
          ctx.collider(o as THREE.Mesh);
        }
      });
    }
    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.userData.collide = false;
    });
    if (!railKit.empty) {
      const rg = railKit.build();
      ctx.add(rg, { kind: "railing:stair", level: s.from.id, room: room?.id, id: `${s.id}_rails`, label: "Stair balustrade" });
      rg.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          o.userData.collide = true;
          ctx.collider(o as THREE.Mesh);
        }
      });
    }
    if (!glassKit.empty) {
      const gg = glassKit.build(new THREE.Group(), false);
      ctx.add(gg, { kind: "railing:glass", level: s.from.id, room: room?.id, id: `${s.id}_glass`, label: "Stair glass balustrade" });
      gg.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          (o as THREE.Mesh).renderOrder = 2;
          o.userData.collide = true;
          ctx.collider(o as THREE.Mesh);
        }
      });
    }
    for (const [k, glass, tagKind] of [[holeKit, false, "railing:stair"], [holeGlass, true, "railing:glass"]] as const) {
      if (k.empty) continue;
      const hg = glass ? k.build(new THREE.Group(), false) : k.build();
      ctx.add(hg, { kind: tagKind, level: lay.holeLevel, id: `${s.id}_well_guard${glass ? "_glass" : ""}`, label: "Stairwell guard" });
      hg.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          if (glass) (o as THREE.Mesh).renderOrder = 2;
          o.userData.collide = true;
          ctx.collider(o as THREE.Mesh);
        }
      });
    }
    rampColliders(ctx, lay);
  }
}

/** invisible ramp colliders so the walkthrough glides up the flights, plus landing slabs */
function rampColliders(ctx: BuildCtx, lay: StairLayout): void {
  const s = lay.stair;
  lay.flights.forEach((f, i) => {
    // ramp through the riser midpoints: meets the lower floor/landing at s0 - T/2 and the upper one at end + T/2
    const mb = new MeshBuilder();
    const s0 = f.s0 - f.sign * f.tread * 0.5;
    const s1 = f.s0 + f.sign * (f.n - 0.5) * f.tread;
    const [ax, ay] = pt(f, s0, f.c0);
    const [bx, by] = pt(f, s1, f.c0);
    const o = P3(ax, ay, f.h0);
    const along = P3(bx - ax, by - ay, f.n * f.riser);
    const across = f.axis === "x" ? new THREE.Vector3(0, 0, (f.c1 - f.c0) * FT) : new THREE.Vector3((f.c1 - f.c0) * FT, 0, 0);
    skewBox(mb, o.clone().add(new THREE.Vector3(0, -0.1, 0)), along, new THREE.Vector3(0, 0.1, 0), across);
    const geo = mb.build();
    if (geo) ctx.addColliderOnly(geo, { kind: "stair:ramp", level: s.from.id, id: `${s.id}_ramp_${i}` });
  });
  for (const L of lay.landings) {
    const mb = new MeshBuilder();
    const r = L.rect;
    mb.box(r.x * FT, (L.h - 0.3) * FT, r.y * FT, (r.x + r.w) * FT, L.h * FT, (r.y + r.d) * FT);
    const geo = mb.build();
    if (geo) ctx.addColliderOnly(geo, { kind: "stair:landing", level: s.from.id, id: ctx.uid(`${s.id}_landing`) });
  }
}

function side(f: Flight, out: number, w: number): THREE.Vector3 {
  return f.axis === "x" ? new THREE.Vector3(0, 0, out * w * FT) : new THREE.Vector3(out * w * FT, 0, 0);
}

function flightGeo(kit: Kit, f: Flight, tread: THREE.Material, body: THREE.Material): void {
  const nos = 0.08;
  const tt = 0.13;
  for (let k = 1; k <= f.n; k++) {
    const a0 = f.s0 + f.sign * (k - 1) * f.tread;
    const a1 = f.s0 + f.sign * k * f.tread;
    const htop = f.h0 + k * f.riser;
    const hbot = f.h0 + (k - 1) * f.riser;
    if (k < f.n) {
      box(kit, tread, f, a0 - f.sign * nos, a1, f.c0, f.c1, htop - tt, htop);
      box(kit, body, f, a0 + f.sign * 0.05, a1, f.c0 + 0.01, f.c1 - 0.01, hbot - 0.3, htop - tt);
    }
    box(kit, tread, f, a0, a0 + f.sign * 0.05, f.c0 + 0.005, f.c1 - 0.005, hbot, htop - (k < f.n ? tt : 0));
  }
  // sloped waist slab (soffit): parallelepiped below the line through the inner step corners
  const run = (f.n - 1) * f.tread;
  const rise = (f.n - 1) * f.riser;
  const L = Math.hypot(run, rise);
  if (L < 0.5) return;
  const thick = 0.42;
  const [ox, oy] = pt(f, f.s0, f.c0 + 0.01);
  const start = P3(ox, oy, f.h0);
  // downward normal in (along, h): (rise, -run)/L
  const o = start.clone().add(alongVec(f, (f.sign * thick * rise) / L, (-thick * run) / L));
  const up = alongVec(f, (-f.sign * thick * rise) / L, (thick * run) / L);
  const along = alongVec(f, run * f.sign, rise);
  const across = f.axis === "x" ? new THREE.Vector3(0, 0, (f.c1 - f.c0 - 0.02) * FT) : new THREE.Vector3((f.c1 - f.c0 - 0.02) * FT, 0, 0);
  skewBox(kit.mb(body), o, along, up, across);
}

function alongVec(f: Flight, d: number, h: number): THREE.Vector3 {
  return f.axis === "x" ? new THREE.Vector3(d * FT, h * FT, 0) : new THREE.Vector3(0, h * FT, d * FT);
}

// ── EN2-01: under-stair storage (no head-strike zone) ──────────────────────────────────────────────────────
/** clear height a walkway needs under a flight or landing (6′8″) */
export const HEADROOM = 6 + 8 / 12;
/** waist slab thickness (flightGeo) and landing slab depth below the landing top */
const WAIST = 0.42;
const LANDING_SLAB = 0.55;

/** Underside (soffit) height of flight f's sloped waist at along-coordinate a (plan ft). */
export function soffitAt(f: Flight, a: number): number {
  const run = (f.n - 1) * f.tread, rise = (f.n - 1) * f.riser;
  const L = Math.hypot(run, rise);
  const t = (a - f.s0) * f.sign;
  return f.h0 + t * (f.riser / f.tread) - (run > 1e-6 ? (WAIST * L) / run : WAIST);
}

/** A solid box under a flight or landing: along [a0, a1] × across [c0, c1], from the floor hb up to t0 (at a0) / t1 (at a1). */
interface StoreBox { axis: "x" | "y"; a0: number; a1: number; c0: number; c1: number; hb: number; t0: number; t1: number }

const xyOf = (axis: "x" | "y", a: number, c: number): [number, number] => (axis === "x" ? [a, c] : [c, a]);

/**
 * The floor under every flight and landing of a stair where the clear height to the soffit is under 6′8″ (and above
 * nothing), on walkable floor of the stair's lower level (not over a stairwell), as solid boxes reaching up to the
 * soffit. A dog-leg's lower flight and mid-landing are boxed in whole; its upper flight only near the landing, where
 * people would otherwise walk under its low end.
 */
function underStair(ctx: BuildCtx, lay: StairLayout, floorAt: (lv: string, x: number, y: number) => boolean): StoreBox[] {
  const lv = lay.stair.from.id;
  const plan = ctx.plan;
  const cRoom = plan.roomAt(lv, lay.rect.x + lay.rect.w / 2, lay.rect.y + lay.rect.d / 2);
  const F0 = cRoom ? cRoom.floorH : lay.flights[0]?.h0 ?? 0;
  const els: { axis: "x" | "y"; a0: number; a1: number; c0: number; c1: number; top: (a: number) => number; lin: boolean }[] = [];
  for (const f of lay.flights) {
    if (f.n < 2) continue;
    const sEnd = sEndOf(f);
    els.push({ axis: f.axis, a0: Math.min(f.s0, sEnd), a1: Math.max(f.s0, sEnd), c0: f.c0, c1: f.c1, top: (a) => soffitAt(f, a), lin: true });
  }
  const ax0 = lay.flights[0]?.axis ?? "y";
  for (const L of lay.landings) {
    const r = L.rect;
    const [a0, a1, c0, c1] = ax0 === "x" ? [r.x, r.x + r.w, r.y, r.y + r.d] : [r.y, r.y + r.d, r.x, r.x + r.w];
    els.push({ axis: ax0, a0, a1, c0, c1, top: () => L.h - LANDING_SLAB, lin: false });
  }
  const out: StoreBox[] = [];
  const done: StoreBox[] = [];
  const inDone = (x: number, y: number) => done.some((b) => {
    const [a, c] = b.axis === "x" ? [x, y] : [y, x];
    return a > b.a0 + 1e-3 && a < b.a1 - 1e-3 && c > b.c0 + 1e-3 && c < b.c1 - 1e-3;
  });
  const STEP = 0.25;
  for (const e of els) {
    // along breakpoints: a regular 0.25 ft grid plus where the clear height crosses 0 and 6′8″ (on the stair room floor)
    const as = new Set<number>([e.a0, e.a1]);
    for (let a = e.a0 + STEP; a < e.a1 - 1e-3; a += STEP) as.add(+a.toFixed(4));
    if (e.lin) {
      const s0 = e.top(e.a0), s1 = e.top(e.a1);
      if (Math.abs(s1 - s0) > 1e-6)
        for (const target of [F0, F0 + HEADROOM]) {
          const k = (target - s0) / (s1 - s0);
          if (k > 0 && k < 1) as.add(e.a0 + k * (e.a1 - e.a0));
        }
    }
    const aList = [...as].sort((p, q) => p - q);
    const cList: number[] = [e.c0];
    for (let c = e.c0 + STEP; c < e.c1 - 1e-3; c += STEP) cList.push(c);
    cList.push(e.c1);
    const open = new Map<string, StoreBox>();
    const mine: StoreBox[] = [];
    for (let i = 0; i + 1 < aList.length; i++) {
      const p = aList[i], q = aList[i + 1];
      if (q - p < 1e-3) continue;
      const am = (p + q) / 2;
      // across runs of cells that need closing off, each with its floor height
      const runs: { c0: number; c1: number; F: number }[] = [];
      for (let j = 0; j + 1 < cList.length; j++) {
        const cm = (cList[j] + cList[j + 1]) / 2;
        const [x, y] = xyOf(e.axis, am, cm);
        if (!floorAt(lv, x, y) || inDone(x, y)) continue;
        const F = plan.roomAt(lv, x, y)?.floorH ?? F0;
        const clear = e.top(am) - F;
        if (!(clear > 0.02 && clear < HEADROOM - 1e-3)) continue;
        const last = runs[runs.length - 1];
        if (last && Math.abs(last.c1 - cList[j]) < 1e-6 && Math.abs(last.F - F) < 1e-3) last.c1 = cList[j + 1];
        else runs.push({ c0: cList[j], c1: cList[j + 1], F });
      }
      const next = new Map<string, StoreBox>();
      for (const r of runs) {
        const key = `${r.c0.toFixed(3)}|${r.c1.toFixed(3)}|${r.F.toFixed(3)}`;
        const prev = open.get(key);
        if (prev && Math.abs(prev.a1 - p) < 1e-6) {
          prev.a1 = q;
          next.set(key, prev);
        } else {
          const b: StoreBox = { axis: e.axis, a0: p, a1: q, c0: r.c0, c1: r.c1, hb: r.F, t0: 0, t1: 0 };
          mine.push(b);
          next.set(key, b);
        }
      }
      open.clear();
      for (const [k, v] of next) open.set(k, v);
    }
    // tops follow the soffit (a hair below it, never below the floor)
    for (const b of mine) {
      b.t0 = Math.max(b.hb, e.top(b.a0) - 0.03);
      b.t1 = Math.max(b.hb, e.top(b.a1) - 0.03);
    }
    out.push(...mine);
    done.push(...mine);
  }
  return out.filter((b) => b.a1 - b.a0 > 0.05 && b.c1 - b.c0 > 0.05 && Math.max(b.t0, b.t1) - b.hb > 0.05);
}

/** A box with a sloped top (plan ft → builder metres; the builder frame is x, h, +y). */
function prism(mb: MeshBuilder, b: StoreBox): void {
  const P = (a: number, c: number, h: number) => {
    const [x, y] = xyOf(b.axis, a, c);
    return new THREE.Vector3(x * FT, h * FT, y * FT);
  };
  const A = (a: number, c: number) => xyOf(b.axis, a, c);
  const q = (pts: THREE.Vector3[], out: [number, number, number]) => {
    const n = new THREE.Vector3().subVectors(pts[1], pts[0]).cross(new THREE.Vector3().subVectors(pts[2], pts[0]));
    if (n.lengthSq() < 1e-12) n.subVectors(pts[2], pts[0]).cross(new THREE.Vector3().subVectors(pts[3], pts[0]));
    if (n.lengthSq() < 1e-12) return;
    n.normalize();
    if (n.x * out[0] + n.y * out[1] + n.z * out[2] < 0) {
      pts.reverse();
      n.negate();
    }
    const [p0, p1, p2, p3] = pts;
    mb.quad(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, p3.x, p3.y, p3.z, n.x, n.y, n.z);
  };
  const dirA = A(1, 0), dir0 = A(0, 0);
  const aVec: [number, number, number] = [dirA[0] - dir0[0], 0, dirA[1] - dir0[1]];
  const cVec: [number, number, number] = b.axis === "x" ? [0, 0, 1] : [1, 0, 0];
  const { a0, a1, c0, c1, hb, t0, t1 } = b;
  q([P(a0, c0, t0), P(a1, c0, t1), P(a1, c1, t1), P(a0, c1, t0)], [0, 1, 0]);
  q([P(a0, c0, hb), P(a1, c0, hb), P(a1, c0, t1), P(a0, c0, t0)], [-cVec[0], 0, -cVec[2]]);
  q([P(a0, c1, hb), P(a1, c1, hb), P(a1, c1, t1), P(a0, c1, t0)], cVec);
  if (t0 - hb > 1e-3) q([P(a0, c0, hb), P(a0, c1, hb), P(a0, c1, t0), P(a0, c0, t0)], [-aVec[0], 0, -aVec[2]]);
  if (t1 - hb > 1e-3) q([P(a1, c0, hb), P(a1, c1, hb), P(a1, c1, t1), P(a1, c0, t1)], aVec);
}

/** Cupboard doors on every face of the under-stair storage that looks onto open floor (plan ft boxes). */
function storeDoors(ctx: BuildCtx, lay: StairLayout, boxes: StoreBox[], floorAt: (lv: string, x: number, y: number) => boolean) {
  const lv = lay.stair.from.id;
  const out: { x0: number; x1: number; y0: number; y1: number; h0: number; h1: number; kx0: number; kx1: number; ky0: number; ky1: number; kh0: number; kh1: number }[] = [];
  const inBox = (x: number, y: number) => boxes.some((b) => {
    const [a, c] = b.axis === "x" ? [x, y] : [y, x];
    return a > b.a0 - 0.05 && a < b.a1 + 0.05 && c > b.c0 - 0.05 && c < b.c1 + 0.05;
  });
  // on the flight itself, or under a part of it too low to stand under
  const inFlight = (x: number, y: number) => lay.flights.some((f) => {
    const sEnd = sEndOf(f);
    const [a, c] = f.axis === "x" ? [x, y] : [y, x];
    if (!(a > Math.min(f.s0, sEnd) - 0.05 && a < Math.max(f.s0, sEnd) + 0.05 && c > f.c0 - 0.05 && c < f.c1 + 0.05)) return false;
    return soffitAt(f, a) - (ctx.plan.roomAt(lv, x, y)?.floorH ?? f.h0) < HEADROOM;
  });
  const inWall = (x: number, y: number) => (ctx.model.runsByLevel.get(lv) ?? []).some((run) => {
    const along = run.axis === "x" ? x : y, across = run.axis === "x" ? y : x;
    return along >= run.ea - 0.05 && along <= run.eb + 0.05 && Math.abs(across - run.c) <= run.t / 2 + 0.15;
  });
  const openAt = (x: number, y: number) => floorAt(lv, x, y) && !inBox(x, y) && !inFlight(x, y) && !inWall(x, y);
  const T = 0.045, GAP = 0.2;
  const leaf = (axis: "x" | "y", c: number, out1: -1 | 1, a: number, b: number, h0: number, h1: number, k: number) => {
    if (b - a < 1.2 || h1 - h0 < 2.4) return;
    const c0 = c + out1 * 0.005, c1 = c + out1 * (0.005 + T);
    const kc1 = c1 + out1 * 0.06;
    const ka = k % 2 ? a + 0.25 : b - 0.25;
    const kh = h0 + Math.min(3.3, (h1 - h0) * 0.55);
    const [x0, y0] = xyOf(axis, a, Math.min(c0, c1)), [x1, y1] = xyOf(axis, b, Math.max(c0, c1));
    const [kx0, ky0] = xyOf(axis, ka - 0.03, Math.min(c1, kc1)), [kx1, ky1] = xyOf(axis, ka + 0.03, Math.max(c1, kc1));
    out.push({ x0: Math.min(x0, x1), x1: Math.max(x0, x1), y0: Math.min(y0, y1), y1: Math.max(y0, y1), h0, h1, kx0: Math.min(kx0, kx1), kx1: Math.max(kx0, kx1), ky0: Math.min(ky0, ky1), ky1: Math.max(ky0, ky1), kh0: kh - 0.3, kh1: kh + 0.3 });
  };
  for (const bx of boxes) {
    const top = (a: number) => bx.t0 + ((bx.t1 - bx.t0) * (a - bx.a0)) / (bx.a1 - bx.a0 || 1);
    // the two long faces (sloped top), then the two ends
    // (a leaf only where someone can stand in front of it: open floor 1 ft out from its middle)
    for (const [c, o] of [[bx.c0, -1], [bx.c1, 1]] as const) {
      const len = bx.a1 - bx.a0;
      const n = Math.max(1, Math.round(len / 2.1));
      const lw = len / n;
      for (let k = 0; k < n; k++) {
        const a = bx.a0 + k * lw + 0.05, b = bx.a0 + (k + 1) * lw - 0.05;
        if (!openAt(...xyOf(bx.axis, (a + b) / 2, c + o * 1.0))) continue;
        const h1 = Math.min(bx.hb + 7, Math.min(top(a), top(b)) - GAP);
        leaf(bx.axis, c, o, a, b, bx.hb + 0.12, h1, k);
      }
    }
    for (const [a, o] of [[bx.a0, -1], [bx.a1, 1]] as const) {
      const h = top(a);
      const wid = bx.c1 - bx.c0;
      const n = Math.max(1, Math.round(wid / 2.1));
      const lw = wid / n;
      for (let k = 0; k < n; k++) {
        const c0 = bx.c0 + k * lw + 0.05, c1 = bx.c0 + (k + 1) * lw - 0.05;
        if (!openAt(...xyOf(bx.axis, a + o * 1.0, (c0 + c1) / 2))) continue;
        // an end face: the leaf lies across the axis (swap the roles of along and across)
        const other: "x" | "y" = bx.axis === "x" ? "y" : "x";
        leaf(other, a, o, c0, c1, bx.hb + 0.12, Math.min(bx.hb + 7, h - GAP), k);
      }
    }
  }
  return out;
}

function box(kit: Kit, mat: THREE.Material, f: Flight, a0: number, a1: number, c0: number, c1: number, h0: number, h1: number): void {
  const A0 = Math.min(a0, a1), A1 = Math.max(a0, a1);
  if (A1 - A0 < 1e-4 || h1 - h0 < 1e-4) return;
  if (f.axis === "x") kit.mb(mat).box(A0 * FT, h0 * FT, c0 * FT, A1 * FT, h1 * FT, c1 * FT);
  else kit.mb(mat).box(c0 * FT, h0 * FT, A0 * FT, c1 * FT, h1 * FT, A1 * FT);
}
