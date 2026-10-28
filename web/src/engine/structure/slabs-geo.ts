/** Slabs (with stair holes), ceilings, floor finishes per room, roof finish and the plinth heightfield. */
import * as THREE from "three";
import { CellGrid, expandRect, type R } from "../core/grid";
import { MeshBuilder } from "../core/meshbuilder";
import { FT } from "../core/util";
import type { BuildCtx } from "../core/ctx";
import type { RoomM } from "../plan/model";
import { EXT_T, FINISH } from "./model";

export interface SlabMats {
  edge: THREE.Material;
  ceiling: THREE.Material;
  interiorEdge: THREE.Material;
  roof: THREE.Material;
  plinth: THREE.Material;
  floorOf: (room: RoomM) => THREE.Material;
  woodLike: (room: RoomM) => boolean;
}

/** Emit faces for a boolean cell grid as a slab between h0 and h1 (ft). */
function gridSlab<T>(
  g: CellGrid<T>,
  inside: (v: T | null) => boolean,
  h0: number,
  h1: number,
  top: MeshBuilder | null,
  bottom: MeshBuilder | null,
  side: (x: number, y: number, outward: [number, number]) => MeshBuilder | null,
): void {
  for (const r of g.rects(inside)) {
    if (top) top.faceY(h1 * FT, r.x * FT, (r.x + r.w) * FT, r.y * FT, (r.y + r.d) * FT, 1);
    if (bottom) bottom.faceY(h0 * FT, r.x * FT, (r.x + r.w) * FT, r.y * FT, (r.y + r.d) * FT, -1);
  }
  const er = g.edgeRuns((n, p) => {
    const a = inside(n), b = inside(p);
    return a && !b ? "+" : b && !a ? "-" : null;
  });
  for (const e of er) {
    const dir = e.key === "+" ? 1 : -1;
    const mid = (e.a + e.b) / 2;
    const px = e.axis === "x" ? mid : e.c + dir * 0.1;
    const py = e.axis === "x" ? e.c + dir * 0.1 : mid;
    const mb = side(px, py, e.axis === "x" ? [0, dir] : [dir, 0]);
    if (!mb) continue;
    if (e.axis === "x") mb.faceZ(e.c * FT, e.a * FT, e.b * FT, h0 * FT, h1 * FT, dir);
    else mb.faceX(e.c * FT, h0 * FT, h1 * FT, e.a * FT, e.b * FT, dir);
  }
}

export function buildSlabs(ctx: BuildCtx, m: SlabMats): void {
  const plan = ctx.plan;
  const model = ctx.model;
  const add = (mb: MeshBuilder, mat: THREE.Material, tags: Record<string, string | undefined>, collide = true, cast = true) => {
    const g = mb.build();
    if (!g) return null;
    const mesh = new THREE.Mesh(g, mat);
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    ctx.add(mesh, tags);
    if (collide) ctx.collider(mesh);
    else mesh.userData.collide = false;
    return mesh;
  };
  const enclosedAt = (lv: string, x: number, y: number) => {
    const r = plan.roomAt(lv, x, y);
    return !!r && r.cat === "enclosed";
  };

  // ── structural slabs ──────────────────────────────────────────────────────────────────────────────
  for (const s of model.slabs) {
    const U = s.level;
    const below = plan.levelBelow(U);
    const topMB = new MeshBuilder(), botMB = new MeshBuilder(), edgeMB = new MeshBuilder(), inEdgeMB = new MeshBuilder();
    gridSlab(s.grid, (v) => v === true, s.bottom, s.top, topMB, botMB, (x, y) => {
      const inner = enclosedAt(U.id, x, y) || (below ? enclosedAt(below.id, x, y) : false);
      return inner ? inEdgeMB : edgeMB;
    });
    topMB.append(edgeMB);
    const nm = U.name;
    add(topMB, m.edge, { kind: "slab", level: U.id, id: `slab_${U.id}${s.top > U.elev + 1 ? "_mumty" : ""}`, label: `Slab (${nm})` });
    add(inEdgeMB, m.interiorEdge, { kind: "slab", level: U.id, id: `slab_edge_${U.id}`, label: `Slab edge (${nm})` }, true);
    add(botMB, m.ceiling, { kind: "ceiling", level: below?.id ?? U.id, id: `ceiling_${below?.id ?? U.id}${s.top > U.elev + 1 ? "_mumty" : ""}`, label: `Ceiling (${below?.name ?? nm})` });
  }

  // ── floor finishes per room (minus stair holes) ───────────────────────────────────────────────────
  for (const lv of plan.levels) {
    const rooms = plan.roomsOn(lv.id).filter((r) => r.cat !== "outdoor");
    if (!rooms.length) continue;
    const holes: R[] = model.stairs.filter((s) => s.holeLevel === lv.id).flatMap((s) => s.holes);
    const g = CellGrid.fromRects<RoomM | "hole">(
      [...rooms.map((r) => ({ rect: r.rect, val: r as RoomM | "hole" })), ...holes.map((h) => ({ rect: h, val: "hole" as const }))],
      (a, b) => (b === "hole" ? "hole" : a),
    );
    for (const room of rooms) {
      const mb = new MeshBuilder();
      mb.swapTopUV = m.woodLike(room) && room.rect.d > room.rect.w;
      const h1 = room.floorH, h0 = room.floorH - FINISH;
      for (const r of g.rects((v) => v === room)) mb.faceY(h1 * FT, r.x * FT, (r.x + r.w) * FT, r.y * FT, (r.y + r.d) * FT, 1);
      // exposed edges (stair holes, height steps)
      const er = g.edgeRuns((n, p) => {
        const a = n === room, b = p === room;
        if (a === b) return null;
        const other = (a ? p : n) as RoomM | "hole" | null;
        if (other && other !== "hole" && Math.abs(other.floorH - room.floorH) < 0.01) return null;
        if (!other && lv.i > 0) return null; // building edge on upper floors: covered by walls/railing curbs
        return a ? "+" : "-";
      });
      for (const e of er) {
        const dir = e.key === "+" ? 1 : -1;
        const hb = e.neg === "hole" || e.pos === "hole" ? h0 - 0.02 : h0;
        if (e.axis === "x") mb.faceZ(e.c * FT, e.a * FT, e.b * FT, hb * FT, h1 * FT, dir);
        else mb.faceX(e.c * FT, hb * FT, h1 * FT, e.a * FT, e.b * FT, dir);
      }
      // B.9: an open space above the ground floor is a light court (floored, open to the sky)
      const label = room.type === "open_space" && lv.i > 0 ? `${room.name} (light court)` : `${room.name} floor`;
      add(mb, m.floorOf(room), { kind: "floor", level: lv.id, room: room.id, id: `floor_${room.id}`, label }, true, false);
    }
  }

  // ── roof finish on exposed roofs ─────────────────────────────────────────────────────────────────
  for (const U of plan.levels) {
    if (U.i === 0) continue;
    const L = plan.levels[U.i - 1];
    const below = plan.roomsOn(L.id).filter((r) => r.cat === "enclosed" || r.cat === "porch");
    if (!below.length) continue;
    const upper = plan.roomsOn(U.id).filter((r) => r.cat !== "outdoor");
    const holes = model.stairs.filter((s) => s.holeLevel === U.id).flatMap((s) => s.holes);
    const g = CellGrid.fromRects<boolean>(
      [
        ...below.map((r) => ({ rect: r.rect, val: true })),
        ...upper.map((r) => ({ rect: r.rect, val: false })),
        ...holes.map((h) => ({ rect: h, val: false })),
      ],
      (a, b) => a && b,
    );
    const mb = new MeshBuilder();
    gridSlab(g, (v) => v === true, U.elev - FINISH, U.elev, mb, null, (x, y) => (g.valueAt(x, y) === false ? mb : null));
    add(mb, m.roof, { kind: "roof", level: U.id, id: `roof_finish_${U.id}`, label: `Roof (${U.name})` }, true, false);
  }

  // ── plinth / ground floor fill (heightfield) ─────────────────────────────────────────────────────
  const P = model.plinth;
  const grade = plan.grade;
  const keyOf = (v: number | null) => (v == null ? "" : v.toFixed(3));
  const top = new MeshBuilder();
  const sides = new MeshBuilder();
  for (const r of P.rects((v) => v != null, keyOf)) {
    const h = parseFloat(r.key);
    top.faceY(h * FT, r.x * FT, (r.x + r.w) * FT, r.y * FT, (r.y + r.d) * FT, 1);
  }
  const er = P.edgeRuns((n, p) => {
    const a = n ?? -1, b = p ?? -1;
    if (Math.abs(a - b) < 1e-3) return null;
    return `${a > b ? "+" : "-"}|${Math.max(a, b).toFixed(3)}|${Math.min(a, b).toFixed(3)}`;
  });
  for (const e of er) {
    const [d, hiS, loS] = e.key.split("|");
    const dir = d === "+" ? 1 : -1;
    const hi = parseFloat(hiS);
    const lo = Math.max(grade - 0.3, parseFloat(loS) < 0 ? grade - 0.3 : parseFloat(loS));
    if (hi - lo < 1e-3) continue;
    if (e.axis === "x") sides.faceZ(e.c * FT, e.a * FT, e.b * FT, lo * FT, hi * FT, dir);
    else sides.faceX(e.c * FT, lo * FT, hi * FT, e.a * FT, e.b * FT, dir);
  }
  top.append(sides);
  add(top, m.plinth, { kind: "plinth", level: plan.levels[0].id, id: "plinth", label: "Plinth" }, true);
  void EXT_T;
  void expandRect;
}
