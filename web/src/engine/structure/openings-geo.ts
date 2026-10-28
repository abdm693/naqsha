/** Opening geometry: frames, glass, sills, lintels, door leaves (open ~80°), handles, sliding panels. */
import * as THREE from "three";
import type { BoxMask } from "../core/meshbuilder";
import { Kit, mat4, unitBox, unitCyl } from "../core/shapes";
import { FT } from "../core/util";
import type { BuildCtx } from "../core/ctx";
import type { PlacedOpening, StructureModel, WallRun } from "./model";

export interface OpeningMats {
  frame: THREE.Material;
  glass: THREE.Material;
  frosted: THREE.Material;
  door: THREE.Material;
  handle: THREE.Material;
  sill: THREE.Material;
  board: THREE.Material;
  ext: THREE.Material;
  dark: THREE.Material;
  garage: THREE.Material;
}

const UP = new THREE.Vector3(0, 1, 0);

/** The structure model of the build in progress: sills, hoods and frames are clipped to its projection envelope. */
let MODEL: StructureModel | null = null;

/** Axis helpers for a run. */
function frame(run: WallRun) {
  const U = run.axis === "x" ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
  const W = run.axis === "x" ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
  const P = (u: number, w: number, h: number) => (run.axis === "x" ? new THREE.Vector3(u * FT, h * FT, w * FT) : new THREE.Vector3(w * FT, h * FT, u * FT));
  /**
   * Axis-aligned box in run space (ft). `skip` drops the faces lying at the given u / w / h coordinates: faces
   * pressed against a wall (reveal, wall face) are never seen and would z-fight with it in section cuts.
   */
  const box = (kit: Kit, mat: THREE.Material, u0: number, u1: number, w0: number, w1: number, h0: number, h1: number, skip?: { u?: number[]; w?: number[]; h?: number[] }) => {
    if (MODEL) {
      const c = MODEL.clipRunBox(run.axis, u0, u1, w0, w1);
      if (!c) return;
      [u0, u1, w0, w1] = c;
    }
    const ua = Math.min(u0, u1), ub = Math.max(u0, u1), wa = Math.min(w0, w1), wb = Math.max(w0, w1), ha = Math.min(h0, h1), hb = Math.max(h0, h1);
    const a = P(ua, wa, ha);
    const b = P(ub, wb, hb);
    if (Math.abs(b.x - a.x) < 1e-5 || Math.abs(b.y - a.y) < 1e-5 || Math.abs(b.z - a.z) < 1e-5) return;
    const keep = (list: number[] | undefined, v: number) => !list || !list.some((x) => Math.abs(x - v) < 1e-6);
    const k = { u0: keep(skip?.u, ua), u1: keep(skip?.u, ub), w0: keep(skip?.w, wa), w1: keep(skip?.w, wb), h0: keep(skip?.h, ha), h1: keep(skip?.h, hb) };
    const mask: BoxMask =
      run.axis === "x" ? { nx: k.u0, px: k.u1, nz: k.w0, pz: k.w1, ny: k.h0, py: k.h1 } : { nz: k.u0, pz: k.u1, nx: k.w0, px: k.w1, ny: k.h0, py: k.h1 };
    kit.mb(mat).box(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.min(a.z, b.z), Math.max(a.x, b.x), Math.max(a.y, b.y), Math.max(a.z, b.z), mask);
  };
  return { U, W, P, box };
}

export function buildOpenings(ctx: BuildCtx, m: OpeningMats): void {
  const plan = ctx.plan;
  MODEL = ctx.model;
  for (const po of ctx.model.openings) {
    const kit = new Kit();
    const glassKit = new Kit();
    const t = po.op.type;
    try {
      if (t === "window" || t === "corner_window") windowGeo(kit, glassKit, po, m, false);
      else if (t === "ventilator") windowGeo(kit, glassKit, po, m, true);
      else if (t === "sliding_door") slidingGeo(kit, glassKit, po, m);
      else if (t === "garage_door") garageGeo(kit, po, m);
      else doorGeo(kit, po, m, t === "main_door" ? "main" : t === "double_door" ? "double" : t === "arch" ? "arch" : "single");
    } catch (e) {
      console.warn("[naqsha/engine] opening failed", po.op.id, e);
      continue;
    }
    const room = plan.room(po.op.between[0]) ?? po.neg ?? po.pos;
    const kind = t === "window" || t === "corner_window" || t === "ventilator" ? "window" : t === "arch" ? "arch" : "door";
    const label = `${room?.name ?? "Room"} ${t.replace("_", " ")}`;
    const group = kit.build();
    group.name = po.op.id;
    ctx.add(group, { kind, id: po.op.id, level: po.op.level, room: room?.id, label });
    if (!glassKit.empty) {
      const gg = glassKit.build(new THREE.Group(), false);
      gg.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.renderOrder = 2;
          if (kind === "window") ctx.collider(mesh);
        }
      });
      ctx.add(gg, { kind: `${kind}:glass`, id: `${po.op.id}_glass`, level: po.op.level, room: room?.id, label: `${label} glass` });
    }
    group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.userData.collide = false;
    });
  }
}

function windowGeo(kit: Kit, glassKit: Kit, po: PlacedOpening, m: OpeningMats, vent: boolean): void {
  const run = po.run;
  const F = frame(run);
  const fw = vent ? 0.12 : 0.16;
  const fd = vent ? 0.16 : 0.22;
  const wc = run.c + po.frameOff;
  const w0 = wc - fd / 2, w1 = wc + fd / 2;
  const { u0, u1, bottom: b, top } = po;
  // outer frame
  F.box(kit, m.frame, u0, u0 + fw, w0, w1, b, top, { u: [u0] });
  F.box(kit, m.frame, u1 - fw, u1, w0, w1, b, top, { u: [u1] });
  F.box(kit, m.frame, u0 + fw, u1 - fw, w0, w1, b, b + fw, { h: [b] });
  F.box(kit, m.frame, u0 + fw, u1 - fw, w0, w1, top - fw, top, { h: [top] });
  const W = u1 - u0, H = top - b;
  if (vent) {
    // louvred frosted glass (typical bathroom ventilator)
    const n = Math.max(3, Math.round((H - 2 * fw) / 0.33));
    const step = (H - 2 * fw) / n;
    const len = W - 2 * fw;
    for (let k = 0; k < n; k++) {
      const hc = b + fw + step * (k + 0.5);
      const c = F.P(u0 + W / 2, wc, hc);
      const mm = new THREE.Matrix4().makeBasis(F.U, UP, F.W).setPosition(c);
      mm.multiply(new THREE.Matrix4().makeRotationX(-0.55)).multiply(new THREE.Matrix4().makeScale(len * FT, 0.012, step * 1.15 * FT));
      glassKit.mb(m.frosted, false).addGeometry(unitBox(), mm);
    }
  } else {
    const panes = W <= 3.6 ? 1 : W <= 6.8 ? 2 : Math.ceil(W / 3.4);
    const mw = 0.11;
    for (let k = 1; k < panes; k++) {
      const uc = u0 + (W * k) / panes;
      F.box(kit, m.frame, uc - mw / 2, uc + mw / 2, w0 + 0.01, w1 - 0.01, b + fw, top - fw);
    }
    if (H > 6.2) {
      const hc = top - Math.min(1.8, H * 0.24);
      F.box(kit, m.frame, u0 + fw, u1 - fw, w0 + 0.01, w1 - 0.01, hc - mw / 2, hc + mw / 2);
    }
    // glass (single pane through the frame center plane)
    const g0 = F.P(u0 + fw * 0.5, wc, b + fw * 0.5), g1 = F.P(u1 - fw * 0.5, wc, top - fw * 0.5);
    const mb = glassKit.mb(m.glass, false);
    if (run.axis === "x") mb.faceZ(wc * FT, Math.min(g0.x, g1.x), Math.max(g0.x, g1.x), g0.y, g1.y, 1);
    else mb.faceX(wc * FT, g0.y, g1.y, Math.min(g0.z, g1.z), Math.max(g0.z, g1.z), 1);
  }
  if (run.out !== 0) {
    const out = run.out;
    const wOut = run.c + (out * run.t) / 2, wIn = run.c - (out * run.t) / 2;
    // exterior sill flashing
    F.box(kit, m.sill, u0 - 0.1, u1 + 0.1, wc + (out * fd) / 2, wOut + out * 0.13, b - 0.09, b + 0.025);
    // lintel band (subtle relief)
    if (!vent) F.box(kit, m.ext, u0 - 0.28, u1 + 0.28, wOut, wOut + out * 0.035, top, top + 0.42, { w: [wOut] });
    // interior window board
    const inRoom = out > 0 ? po.neg : po.pos;
    if (inRoom && inRoom.cat === "enclosed" && !vent) F.box(kit, m.board, u0 - 0.08, u1 + 0.08, wc - (out * fd) / 2, wIn - out * 0.07, b - 0.03, b + 0.045);
  } else if (!vent) {
    // interior window: boards both sides
    F.box(kit, m.board, u0 - 0.06, u1 + 0.06, run.c - run.t / 2 - 0.05, run.c + run.t / 2 + 0.05, b - 0.03, b + 0.04);
  }
}

function linings(kit: Kit, po: PlacedOpening, mat: THREE.Material, arch: boolean): number {
  const run = po.run;
  const F = frame(run);
  const lw = arch ? 0.14 : 0.12;
  const wN = run.c - run.t / 2 - 0.015, wP = run.c + run.t / 2 + 0.015;
  const { u0, u1, bottom: b, top } = po;
  F.box(kit, mat, u0, u0 + lw, wN, wP, b, top, { u: [u0], h: [b, top] });
  F.box(kit, mat, u1 - lw, u1, wN, wP, b, top, { u: [u1], h: [b, top] });
  F.box(kit, mat, u0, u1, wN, wP, top - lw, top, { h: [top] });
  // architraves on faces that look into enclosed rooms
  const aw = 0.24, ap = 0.07;
  for (const [room, w, dir] of [[po.neg, run.c - run.t / 2, -1], [po.pos, run.c + run.t / 2, 1]] as const) {
    if (!room || room.cat !== "enclosed") continue;
    const wa = w, wb = w + dir * ap;
    F.box(kit, mat, u0 - aw, u0 + 0.02, wa, wb, b, top + aw, { w: [wa], h: [b] });
    F.box(kit, mat, u1 - 0.02, u1 + aw, wa, wb, b, top + aw, { w: [wa], h: [b] });
    F.box(kit, mat, u0 - aw, u1 + aw, wa, wb, top - 0.02, top + aw, { w: [wa] });
  }
  return lw;
}

function doorGeo(kit: Kit, po: PlacedOpening, m: OpeningMats, style: "single" | "double" | "main" | "arch"): void {
  const run = po.run;
  const F = frame(run);
  const lw = linings(kit, po, m.door, style === "arch");
  if (style === "arch") return;
  const { u0, u1, bottom: b, top } = po;
  const floor = b + 0.04;
  const leafH = top - lw - floor - 0.03;
  const leafT = style === "main" ? 0.19 : 0.14;
  const clear = u1 - u0 - 2 * lw - 0.02;
  const leaves: { hingeU: number; dirU: 1 | -1; width: number }[] =
    style === "double"
      ? [
          { hingeU: u0 + lw, dirU: 1, width: clear / 2 },
          { hingeU: u1 - lw, dirU: -1, width: clear / 2 },
        ]
      : [{ hingeU: po.hingeAtA ? u0 + lw : u1 - lw, dirU: po.hingeAtA ? 1 : -1, width: clear }];
  const swing = po.swingSide;
  const face = swing < 0 ? run.c - run.t / 2 + 0.04 : run.c + run.t / 2 - 0.04;
  const angle = (80 * Math.PI) / 180;
  for (const L of leaves) {
    const H = F.P(L.hingeU, face, floor + 0.03);
    const X = F.U.clone().multiplyScalar(L.dirU);
    const Z = F.W.clone().multiplyScalar(swing);
    const B = new THREE.Matrix4().makeBasis(X, UP, Z).setPosition(H);
    const R = new THREE.Matrix4().makeRotationY(-angle);
    const base = B.clone().multiply(R);
    const lwM = L.width * FT, lhM = leafH * FT, ltM = leafT * FT;
    // leaf slab
    kit.mb(m.door).addGeometry(unitBox(), base.clone().multiply(mat4(lwM / 2, lhM / 2, -ltM / 2, 0, 0, 0, lwM, lhM, ltM)));
    if (style === "main") {
      // inlaid vertical grooves on both faces + long pull bar outside
      const n = 5;
      for (let k = 1; k <= n; k++) {
        const x = (lwM * k) / (n + 1);
        for (const z of [0.002, -ltM - 0.002]) kit.mb(m.dark).addGeometry(unitBox(), base.clone().multiply(mat4(x, lhM * 0.5, z, 0, 0, 0, 0.012, lhM - 0.36, 0.006)));
      }
      const hx = lwM - 0.11;
      const zOut = -ltM - 0.055;
      kit.mb(m.handle).addGeometry(unitCyl(16), base.clone().multiply(mat4(hx, 1.25, zOut, 0, 0, 0, 0.032, 1.0, 0.032)));
      for (const y of [0.85, 1.65]) kit.mb(m.handle).addGeometry(unitCyl(12), base.clone().multiply(mat4(hx, y, (zOut - ltM) / 2, Math.PI / 2, 0, 0, 0.018, 0.055, 0.018)));
      lever(kit, m.handle, base, lwM, ltM, true);
    } else {
      lever(kit, m.handle, base, lwM, ltM, false);
    }
  }
}

function lever(kit: Kit, mat: THREE.Material, base: THREE.Matrix4, lwM: number, ltM: number, insideOnly: boolean): void {
  const y = 1.03;
  const x = lwM - 0.075;
  const sides = insideOnly ? [1] : [1, -1];
  for (const s of sides) {
    const z = s > 0 ? 0.012 : -ltM - 0.012;
    kit.mb(mat).addGeometry(unitCyl(16), base.clone().multiply(mat4(x, y, z, Math.PI / 2, 0, 0, 0.055, 0.02, 0.055)));
    const zl = s > 0 ? 0.045 : -ltM - 0.045;
    kit.mb(mat).addGeometry(unitBox(), base.clone().multiply(mat4(x - 0.055, y, zl, 0, 0, 0, 0.13, 0.018, 0.022)));
    kit.mb(mat).addGeometry(unitCyl(10), base.clone().multiply(mat4(x, y, (z + zl) / 2, Math.PI / 2, 0, 0, 0.018, Math.abs(zl - z), 0.018)));
  }
}

function slidingGeo(kit: Kit, glassKit: Kit, po: PlacedOpening, m: OpeningMats): void {
  const run = po.run;
  const F = frame(run);
  const { u0, u1, bottom: b, top } = po;
  const wc = run.c + po.frameOff;
  const fw = 0.18, fd = 0.32;
  // outer frame + track
  F.box(kit, m.frame, u0, u0 + fw, wc - fd / 2, wc + fd / 2, b, top, { u: [u0], h: [b, top] });
  F.box(kit, m.frame, u1 - fw, u1, wc - fd / 2, wc + fd / 2, b, top, { u: [u1], h: [b, top] });
  F.box(kit, m.frame, u0, u1, wc - fd / 2, wc + fd / 2, top - fw, top, { h: [top] });
  F.box(kit, m.frame, u0, u1, wc - fd / 2, wc + fd / 2, b, b + 0.07, { h: [b] });
  const innerW = u1 - u0 - 2 * fw;
  const pw = innerW / 2 + 0.1;
  const ph = top - fw - (b + 0.07);
  const pf = 0.13;
  const tracks = [wc + 0.065, wc - 0.065];
  // panel A fixed at the far end, panel B slid over it (opening ~ 45%)
  const fixedAtB = po.hingeAtA; // keep the open half away from the nearer corner
  const aU0 = fixedAtB ? u1 - fw - pw : u0 + fw;
  const bU0 = fixedAtB ? aU0 - pw * 0.15 : aU0 + pw * 0.15;
  const panel = (pu0: number, wTrack: number) => {
    const pu1 = pu0 + pw;
    const hb = b + 0.07, ht = hb + ph;
    const t0 = wTrack - 0.045, t1 = wTrack + 0.045;
    F.box(kit, m.frame, pu0, pu0 + pf, t0, t1, hb, ht);
    F.box(kit, m.frame, pu1 - pf, pu1, t0, t1, hb, ht);
    F.box(kit, m.frame, pu0 + pf, pu1 - pf, t0, t1, hb, hb + pf);
    F.box(kit, m.frame, pu0 + pf, pu1 - pf, t0, t1, ht - pf, ht);
    const g0 = F.P(pu0 + pf * 0.5, wTrack, hb + pf * 0.5), g1 = F.P(pu1 - pf * 0.5, wTrack, ht - pf * 0.5);
    const mb = glassKit.mb(m.glass, false);
    if (run.axis === "x") mb.faceZ(wTrack * FT, Math.min(g0.x, g1.x), Math.max(g0.x, g1.x), g0.y, g1.y, 1);
    else mb.faceX(wTrack * FT, g0.y, g1.y, Math.min(g0.z, g1.z), Math.max(g0.z, g1.z), 1);
    // slim pull handle
    const hu = fixedAtB ? pu0 + pf + 0.06 : pu1 - pf - 0.06;
    F.box(kit, m.handle, hu - 0.02, hu + 0.02, wTrack - 0.09, wTrack + 0.09, hb + 2.6, hb + 4.2);
  };
  panel(aU0, tracks[0]);
  panel(bU0, tracks[1]);
}

function garageGeo(kit: Kit, po: PlacedOpening, m: OpeningMats): void {
  const run = po.run;
  const F = frame(run);
  const { u0, u1, bottom: b, top } = po;
  const wc = run.c + po.frameOff;
  F.box(kit, m.frame, u0, u0 + 0.15, wc - 0.2, wc + 0.2, b, top, { u: [u0], h: [b, top] });
  F.box(kit, m.frame, u1 - 0.15, u1, wc - 0.2, wc + 0.2, b, top, { u: [u1], h: [b, top] });
  F.box(kit, m.frame, u0, u1, wc - 0.2, wc + 0.2, top - 0.15, top, { h: [top] });
  const n = Math.max(4, Math.round((top - b) / 0.55));
  const ph = (top - 0.15 - b) / n;
  for (let k = 0; k < n; k++) {
    const h0 = b + k * ph;
    F.box(kit, m.garage, u0 + 0.15, u1 - 0.15, wc - 0.05, wc + 0.05, h0 + 0.02, h0 + ph - 0.02);
    F.box(kit, m.dark, u0 + 0.15, u1 - 0.15, wc - 0.03, wc + 0.03, h0, h0 + 0.02);
  }
}
