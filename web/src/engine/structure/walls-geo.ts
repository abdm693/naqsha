/**
 * Wall geometry: each wall run is decomposed into solid boxes around its openings, and every visible face is
 * routed to a per-room "skin" bucket (interior paint per room, exterior material for outside faces). Reveals are
 * split at the frame plane so the inside half takes the room's finish and the outside half the facade finish.
 */
import * as THREE from "three";
import { MeshBuilder } from "../core/meshbuilder";
import { FT } from "../core/util";
import type { BuildCtx } from "../core/ctx";
import type { RoomM } from "../plan/model";
import { FINISH, type WallRun } from "./model";

export interface WallMats {
  ext: THREE.Material;
  int: THREE.Material;
  wet: THREE.Material;
  floorOf: (room: RoomM) => THREE.Material;
  coping: THREE.Material;
}

const WET = new Set(["bath", "powder"]);

/** Map run-local (u along, w across, h) to MeshBuilder calls. */
class RunFaces {
  constructor(private run: WallRun) {}
  side(mb: MeshBuilder, w: number, u0: number, u1: number, h0: number, h1: number, dir: number): void {
    if (u1 - u0 < 1e-4 || h1 - h0 < 1e-4) return;
    if (this.run.axis === "x") mb.faceZ(w * FT, u0 * FT, u1 * FT, h0 * FT, h1 * FT, dir);
    else mb.faceX(w * FT, h0 * FT, h1 * FT, u0 * FT, u1 * FT, dir);
  }
  end(mb: MeshBuilder, u: number, wa: number, wb: number, h0: number, h1: number, dir: number): void {
    if (wb - wa < 1e-4 || h1 - h0 < 1e-4) return;
    if (this.run.axis === "x") mb.faceX(u * FT, h0 * FT, h1 * FT, wa * FT, wb * FT, dir);
    else mb.faceZ(u * FT, wa * FT, wb * FT, h0 * FT, h1 * FT, dir);
  }
  horiz(mb: MeshBuilder, h: number, u0: number, u1: number, wa: number, wb: number, dir: number): void {
    if (u1 - u0 < 1e-4 || wb - wa < 1e-4) return;
    if (this.run.axis === "x") mb.faceY(h * FT, u0 * FT, u1 * FT, wa * FT, wb * FT, dir);
    else mb.faceY(h * FT, wa * FT, wb * FT, u0 * FT, u1 * FT, dir);
  }
  box(mb: MeshBuilder, u0: number, u1: number, w0: number, w1: number, h0: number, h1: number): void {
    if (this.run.axis === "x") mb.box(u0 * FT, h0 * FT, w0 * FT, u1 * FT, h1 * FT, w1 * FT);
    else mb.box(w0 * FT, h0 * FT, u0 * FT, w1 * FT, h1 * FT, u1 * FT);
  }
  /** plan point for (u, w) */
  pt(u: number, w: number): [number, number] {
    return this.run.axis === "x" ? [u, w] : [w, u];
  }
}

export function buildWalls(ctx: BuildCtx, m: WallMats): void {
  const model = ctx.model;
  const plan = ctx.plan;
  const buckets = new Map<string, { mb: MeshBuilder; level: string; room: RoomM | null }>();
  const skirts = new Map<string, { mb: MeshBuilder; room: RoomM }>();
  const thresholds = new Map<string, { mb: MeshBuilder; mat: THREE.Material; level: string }>();
  const copings = new Map<string, MeshBuilder>();

  const bucket = (level: string, px: number, py: number): MeshBuilder => {
    const room = plan.roomAt(level, px, py);
    const enclosed = room && room.cat === "enclosed" ? room : null;
    const key = `${level}|${enclosed ? enclosed.id : "ext"}`;
    let b = buckets.get(key);
    if (!b) {
      b = { mb: new MeshBuilder(), level, room: enclosed };
      buckets.set(key, b);
    }
    return b.mb;
  };

  for (const run of model.runs.concat(model.parapets.filter((p) => !model.runs.includes(p)))) {
    const F = new RunFaces(run);
    const lv = run.level.id;
    const wN = run.c - run.t / 2, wP = run.c + run.t / 2;
    const ops = run.openings;
    // solids: [u0,u1,h0,h1, kind]
    type Solid = { u0: number; u1: number; h0: number; h1: number; kind: "full" | "below" | "above" };
    const solids: Solid[] = [];
    let cur = run.ea;
    for (const o of ops) {
      if (o.u0 - cur > 1e-4) solids.push({ u0: cur, u1: o.u0, h0: run.h0, h1: run.h1, kind: "full" });
      if (o.bottom > run.h0 + 1e-3) solids.push({ u0: o.u0, u1: o.u1, h0: run.h0, h1: o.bottom, kind: "below" });
      if (o.top < run.h1 - 1e-3) solids.push({ u0: o.u0, u1: o.u1, h0: o.top, h1: run.h1, kind: "above" });
      cur = o.u1;
    }
    if (run.eb - cur > 1e-4) solids.push({ u0: cur, u1: run.eb, h0: run.h0, h1: run.h1, kind: "full" });

    for (const s of solids) {
      const um = (s.u0 + s.u1) / 2;
      // big side faces
      const [nx, ny] = F.pt(um, wN - 0.05);
      F.side(bucket(lv, nx, ny), wN, s.u0, s.u1, s.h0, s.h1, -1);
      const [px, py] = F.pt(um, wP + 0.05);
      F.side(bucket(lv, px, py), wP, s.u0, s.u1, s.h0, s.h1, 1);
      if (run.topExposed && s.kind !== "below") {
        // coping cap on free-standing walls (parapets)
        let cb = copings.get(lv);
        if (!cb) copings.set(lv, (cb = new MeshBuilder()));
        const ov = 0.09;
        const ua = s.u0 === run.ea && run.capA.kind !== "none" ? s.u0 - ov : s.u0;
        const ub = s.u1 === run.eb && run.capB.kind !== "none" ? s.u1 + ov : s.u1;
        // the drip overhang never crosses a party-wall plot edge (projection envelope)
        const c = model.clipRunBox(run.axis, ua, ub, wN - ov, wP + ov);
        if (c) F.box(cb, c[0], c[1], c[2], c[3], s.h1, s.h1 + 0.13);
      }
    }
    // reveals around openings
    for (const o of ops) {
      const fp = run.c + o.frameOff;
      const parts: [number, number][] = [[wN, fp], [fp, wP]];
      for (const [wa, wb] of parts) {
        const wm = (wa + wb) / 2;
        const [qx, qy] = F.pt((o.u0 + o.u1) / 2, wm);
        const mb = bucket(lv, qx, qy);
        if (o.bottom > run.h0 + 1e-3) F.horiz(mb, o.bottom, o.u0, o.u1, wa, wb, 1); // sill reveal
        if (o.top < run.h1 - 1e-3) F.horiz(mb, o.top, o.u0, o.u1, wa, wb, -1); // head reveal
        F.end(mb, o.u0, wa, wb, o.bottom, o.top, 1); // jamb facing +u (the solid to the left)
        F.end(mb, o.u1, wa, wb, o.bottom, o.top, -1);
      }
    }
    // run end caps
    for (const end of ["a", "b"] as const) {
      const cap = end === "a" ? run.capA : run.capB;
      if (cap.kind === "none") continue;
      const u = end === "a" ? run.ea : run.eb;
      const dir = end === "a" ? -1 : 1;
      const strips: [number, number][] = cap.kind === "strips" ? cap.strips.map(([a, b]) => [run.c + a, run.c + b]) : [[wN, wP]];
      const h0 = cap.kind === "full" && cap.h0 !== undefined ? cap.h0 : run.h0;
      for (const [wa, wb] of strips) {
        const [qx, qy] = F.pt(u + dir * 0.05, (wa + wb) / 2);
        F.end(bucket(lv, qx, qy), u, wa, wb, h0, run.h1, dir);
      }
    }
    // skirting + thresholds (rooms on either side)
    if (run.kind === "exterior" || run.kind === "interior") {
      for (const [room, w, dir] of [[run.neg, wN, -1], [run.pos, wP, 1]] as [RoomM | null, number, number][]) {
        if (!room || room.cat !== "enclosed" || WET.has(room.type)) continue;
        let sk = skirts.get(room.id);
        if (!sk) skirts.set(room.id, (sk = { mb: new MeshBuilder(), room }));
        const lo = (run.axis === "x" ? room.rect.x : room.rect.y) + 0.19;
        const hi = (run.axis === "x" ? room.rect.x + room.rect.w : room.rect.y + room.rect.d) - 0.19;
        for (const s of solids) {
          if (s.kind === "above" || s.h0 > run.h0 + 1e-3) continue;
          const a = Math.max(s.u0, lo), b = Math.min(s.u1, hi);
          if (b - a < 0.1) continue;
          const w0 = dir < 0 ? w - 0.05 : w, w1 = dir < 0 ? w : w + 0.05;
          F.box(sk.mb, a, b, w0, w1, room.floorH - 0.01, room.floorH + 0.33);
        }
      }
      for (const o of ops) {
        if (!o.isDoor) continue;
        const rooms = [run.neg, run.pos].filter((r): r is RoomM => !!r && r.cat !== "outdoor");
        const hi = rooms.sort((p, q) => q.floorH - p.floorH)[0];
        const mat = hi && hi.cat === "enclosed" ? m.floorOf(hi) : m.coping;
        const key = `${lv}|${mat.uuid}`;
        let tb = thresholds.get(key);
        if (!tb) thresholds.set(key, (tb = { mb: new MeshBuilder(), mat, level: lv }));
        const top = o.bottom + FINISH + 0.02;
        F.box(tb.mb, o.u0, o.u1, wN - 0.03, wP + 0.03, o.bottom, top);
      }
    }
  }

  for (const [key, b] of buckets) {
    const geo = b.mb.build();
    if (!geo) continue;
    const mat = b.room ? (WET.has(b.room.type) ? m.wet : m.int) : m.ext;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const lvName = plan.levelById.get(b.level)?.name ?? b.level;
    ctx.add(mesh, {
      kind: b.room ? "wall" : "wall:exterior",
      level: b.level,
      room: b.room?.id,
      id: b.room ? `walls_${b.room.id}` : `walls_ext_${b.level}`,
      label: b.room ? `${b.room.name} walls` : `Exterior walls (${lvName})`,
    });
    mesh.userData.collide = true;
    ctx.collider(mesh);
    void key;
  }
  for (const [, s] of skirts) {
    const geo = s.mb.build();
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, m.floorOf(s.room));
    mesh.receiveShadow = true;
    ctx.add(mesh, { kind: "skirting", level: s.room.level, room: s.room.id, id: `skirting_${s.room.id}`, label: `${s.room.name} skirting` });
    mesh.userData.collide = false;
  }
  for (const [, t] of thresholds) {
    const geo = t.mb.build();
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, t.mat);
    mesh.receiveShadow = true;
    ctx.add(mesh, { kind: "threshold", level: t.level, id: ctx.uid(`thresholds_${t.level}`), label: "Door threshold" });
    ctx.collider(mesh);
  }
  for (const [lv, cb] of copings) {
    const geo = cb.build();
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, m.coping);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    ctx.add(mesh, { kind: "parapet:coping", level: lv, id: `coping_${lv}`, label: "Parapet coping" });
  }
}
