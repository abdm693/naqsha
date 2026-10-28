/**
 * Furniture item builders. Item-local meters: origin at the floor center of the footprint, front = +z, width
 * along x. Each builder fills a Kit (merged per material). Proportions follow real products.
 */
import * as THREE from "three";
import type { FurnitureType } from "@contracts/house-sdk";
import { Kit, lathe, mat4, roundedBox as roundedBoxFor, torus, unitBox, unitCyl } from "../core/shapes";
import { clamp } from "../core/util";
import { artTexture, bar, books, cushion, foliage, fronts, legs4, planeGeo, rugTexture, texturedMat, vase, type ItemBuild } from "./parts";

export type ItemClass = "floor" | "rug" | "wall" | "ceiling" | "top";
export interface ItemDef {
  /** default w, d, h in feet */
  dims: [number, number, number];
  cls: ItemClass;
  /** wall items: default bottom height above floor (ft) */
  mount?: number;
  collide?: boolean;
  build: (b: ItemBuild) => void;
}

const PI = Math.PI;
const stick = (k: Kit, mat: THREE.Material, a: THREE.Vector3, b: THREE.Vector3, r: number, seg = 8) => {
  const d = b.clone().sub(a);
  const L = d.length();
  if (L < 1e-4) return;
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  const m = new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(r * 2, L, r * 2));
  k.geo(mat, unitCyl(seg), m);
};
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// ── beds ──────────────────────────────────────────────────────────────────────────────────────────────
function bed(b: ItemBuild): void {
  const { k, w, d, m } = b;
  const uph = !b.variant.includes("wood") && !b.variant.includes("platform");
  const frame = uph ? m.fabric : m.main;
  const plinthH = 0.08, baseTop = 0.34, matH = 0.22;
  const hbT = 0.11, hbH = clamp(b.h, 0.85, 1.5);
  const z0 = -d / 2;
  k.box(m.dark, 0, plinthH / 2, 0.03, w - 0.18, plinthH, d - 0.28);
  cushion(k, frame, 0, plinthH + (baseTop - plinthH) / 2, hbT / 2, w, baseTop - plinthH, d - hbT, 0.025);
  if (uph) {
    const n = Math.max(5, Math.round(w / 0.23));
    const pw = (w + 0.08) / n;
    for (let i = 0; i < n; i++) cushion(k, m.fabric, -w / 2 - 0.04 + pw * (i + 0.5), hbH / 2 + 0.005, z0 + hbT / 2, pw - 0.005, hbH - 0.01, hbT, 0.04);
  } else {
    k.rbox(m.main, 0, hbH / 2, z0 + hbT / 2, w + 0.1, hbH, hbT, 0.01, 2);
    // integrated side shelves
    for (const s of [-1, 1]) k.rbox(m.main, s * (w / 2 + 0.28), 0.5, z0 + 0.22, 0.5, 0.03, 0.42, 0.006, 1);
  }
  const mz0 = z0 + hbT + 0.02, mz1 = d / 2 - 0.05, md = mz1 - mz0, mzc = (mz0 + mz1) / 2;
  const top = baseTop + matH;
  cushion(k, m.linen, 0, baseTop + matH / 2, mzc, w - 0.07, matH, md, 0.07);
  // duvet draped over the lower ~70%
  const ds = mz0 + md * 0.3;
  cushion(k, m.linen, 0, top - 0.06, (ds + mz1 + 0.04) / 2, w + 0.02, 0.2, mz1 + 0.04 - ds, 0.06);
  cushion(k, m.linen, 0, top + 0.05, ds + 0.07, w + 0.03, 0.075, 0.17, 0.035);
  // throw across the foot
  cushion(k, m.accent2, 0, top + 0.05, mz1 - 0.3, w + 0.06, 0.045, 0.52, 0.02);
  // pillows + accent cushions
  const pairs = w > 1.3 ? [-w / 4, w / 4] : [0];
  for (const x of pairs) cushion(k, m.linen, x, top + 0.13, mz0 + 0.18, Math.min(0.66, w / pairs.length - 0.08), 0.17, 0.44, 0.075, -0.42);
  const acc = w > 1.3 ? [-w / 5.5, w / 5.5] : [0];
  for (const x of acc) cushion(k, m.accent, x, top + 0.16, mz0 + 0.4, 0.44, 0.42, 0.13, 0.06, -0.32);
}

function sideTable(b: ItemBuild): void {
  const { k, w, d, h, m } = b;
  const carcass = m.woodDark;
  k.rbox(m.main, 0, h - 0.015, 0, w, 0.03, d, 0.006, 2);
  k.box(carcass, 0, (h - 0.03 + 0.14) / 2, 0, w - 0.02, h - 0.03 - 0.14, d - 0.03);
  const fr = fronts(k, m.main, -w / 2 + 0.01, w / 2 - 0.01, 0.14, h - 0.03, d / 2 - 0.015, 1, 2);
  for (const f of fr) bar(k, m.brass, f.cx, f.cy + f.h / 2 - 0.035, d / 2 + 0.012, Math.min(0.16, f.w * 0.4), false, 0.006);
  legs4(k, m.metal, w, d, 0.14, 0.04, "round", 0.022);
}

function wardrobe(b: ItemBuild): void {
  const { k, w, d, h, m } = b;
  const plinth = 0.08;
  k.box(m.dark, 0, plinth / 2, -0.03, w - 0.06, plinth, d - 0.1);
  k.box(m.woodDark, 0, (plinth + h) / 2, -0.01, w, h - plinth, d - 0.03);
  const n = Math.max(2, Math.round(w / 0.5));
  const doors = fronts(k, m.main, -w / 2, w / 2, plinth, h, d / 2 - 0.025, n, 1, 0.0025, 0.022);
  for (let i = 0; i < n - 1; i += 2) {
    const xm = (doors[i].cx + doors[i + 1].cx) / 2;
    for (const s of [-1, 1]) bar(k, m.metal, xm + s * 0.035, 1.05, d / 2 + 0.012, 0.42, true, 0.007);
  }
  if (n % 2 === 1) bar(k, m.metal, doors[n - 1].cx - doors[n - 1].w / 2 + 0.035, 1.05, d / 2 + 0.012, 0.42, true, 0.007);
}

function dresser(b: ItemBuild): void {
  const { k, w, d, h, m } = b;
  const legH = 0.12;
  k.rbox(m.main, 0, h - 0.015, 0, w + 0.02, 0.03, d + 0.01, 0.006, 2);
  k.box(m.woodDark, 0, (legH + h - 0.03) / 2, 0, w, h - 0.03 - legH, d - 0.02);
  const fr = fronts(k, m.main, -w / 2, w / 2, legH, h - 0.03, d / 2 - 0.01, 2, 3);
  for (const f of fr) bar(k, m.brass, f.cx, f.cy + f.h / 2 - 0.04, d / 2 + 0.014, Math.min(0.2, f.w * 0.35), false, 0.006);
  legs4(k, m.metal, w, d, legH, 0.05, "tapered", 0.035);
  vase(k, m.ceramic, -w / 3, h, 0, 0.26, 1);
  books(k, [m.accent, m.accent2, m.linen], w / 6, w / 2 - 0.08, h, 0, 0.18, b.rnd, 0.06);
}

function dressingTable(b: ItemBuild): void {
  const { k, w, d, m } = b;
  const h = 0.76;
  k.rbox(m.main, 0, h - 0.015, 0, w, 0.03, d, 0.006, 2);
  k.box(m.woodDark, 0, h - 0.11, 0, w - 0.04, 0.16, d - 0.04);
  const fr = fronts(k, m.main, -w / 2 + 0.02, w / 2 - 0.02, h - 0.19, h - 0.03, d / 2 - 0.02, 2, 1);
  for (const f of fr) bar(k, m.brass, f.cx, f.cy, d / 2 + 0.006, 0.12, false, 0.005);
  legs4(k, m.main, w, d, h - 0.19, 0.04, "tapered", 0.04);
  // mirror on the wall above
  const mw = Math.min(w * 0.75, 0.8), mh = 0.95;
  k.rbox(m.brass, 0, h + 0.15 + mh / 2, -d / 2 + 0.012, mw + 0.04, mh + 0.04, 0.02, 0.01, 2);
  k.rbox(m.mirror, 0, h + 0.15 + mh / 2, -d / 2 + 0.024, mw, mh, 0.01, 0.008, 2);
  // stool
  k.geo(m.accent, lathe("pouf", [[0, 0], [0.92, 0], [1, 0.12], [1, 0.82], [0.9, 1], [0, 1]], 28), mat4(0, 0.06, d / 2 + 0.25, 0, 0, 0, 0.2, 0.36, 0.2));
  legs4(k, m.metal, 0.3, 0.3, 0.07, 0.03, "round", 0.015);
  vase(k, m.ceramic, w / 3, h, -d / 4, 0.18, 2);
}

function studyDesk(b: ItemBuild): void {
  const { k, w, d, m } = b;
  const h = 0.75;
  k.rbox(m.main, 0, h - 0.015, 0, w, 0.03, d, 0.005, 2);
  // drawer pedestal (left) + slim metal legs (right)
  const pw = Math.min(0.42, w * 0.32);
  k.box(m.woodDark, -w / 2 + pw / 2 + 0.02, (h - 0.03) / 2, 0, pw, h - 0.03, d - 0.06);
  const fr = fronts(k, m.main, -w / 2 + 0.02, -w / 2 + 0.02 + pw, 0.02, h - 0.04, d / 2 - 0.03, 1, 3);
  for (const f of fr) bar(k, m.metal, f.cx, f.cy + f.h / 2 - 0.035, d / 2 - 0.012, 0.12, false, 0.005);
  for (const z of [-d / 2 + 0.05, d / 2 - 0.05]) k.box(m.metal, w / 2 - 0.04, (h - 0.03) / 2, z, 0.035, h - 0.03, 0.035);
  k.box(m.metal, w / 2 - 0.04, 0.03, 0, 0.035, 0.03, d - 0.1);
  // laptop + lamp + books
  const lx = 0.05;
  k.rbox(m.steel, lx, h + 0.008, 0.02, 0.33, 0.016, 0.23, 0.004, 1);
  k.geo(m.steel, unitBox(), mat4(lx, h + 0.12, -0.1, -0.32, 0, 0, 0.33, 0.22, 0.008));
  k.geo(m.screen, unitBox(), mat4(lx, h + 0.12, -0.095, -0.32, 0, 0, 0.31, 0.2, 0.004));
  const lampX = w / 2 - 0.16;
  k.cyl(m.metal, lampX, h + 0.01, -d / 4, 0.07, 0.02, 20);
  stick(k, m.metal, V(lampX, h + 0.02, -d / 4), V(lampX - 0.04, h + 0.38, -d / 4 + 0.02), 0.008);
  stick(k, m.metal, V(lampX - 0.04, h + 0.38, -d / 4 + 0.02), V(lampX - 0.18, h + 0.42, -d / 4 + 0.12), 0.008);
  k.geo(m.metal, lathe("deskshade", [[0, 0.1], [0.06, 0.09], [0.1, 0], [0, 0]], 20), mat4(lampX - 0.2, h + 0.33, -d / 4 + 0.13, 0, 0, 0, 0.7, 0.7, 0.7));
  k.cyl(m.bulb, lampX - 0.2, h + 0.335, -d / 4 + 0.13, 0.05, 0.005, 16);
  books(k, [m.accent, m.accent2, m.linen, m.fabric], -w / 2 + 0.1, -w / 2 + 0.34, h, -d / 3, 0.2, b.rnd, 0.24);
}

function deskChair(b: ItemBuild): void {
  const { k, m } = b;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * PI * 2;
    k.geo(m.metal, unitBox(), mat4(Math.cos(a) * 0.15, 0.07, Math.sin(a) * 0.15, 0, -a, 0, 0.3, 0.03, 0.04));
    k.sphere(m.rubber, Math.cos(a) * 0.29, 0.03, Math.sin(a) * 0.29, 0.05, 0.05, 0.05, 10);
  }
  k.cyl(m.steel, 0, 0.26, 0, 0.022, 0.36, 12);
  cushion(k, m.fabric, 0, 0.47, 0.02, 0.5, 0.08, 0.48, 0.035);
  cushion(k, m.fabric, 0, 0.86, -0.23, 0.46, 0.55, 0.07, 0.03, -0.12);
  k.box(m.metal, 0, 0.6, -0.24, 0.05, 0.25, 0.02);
  for (const s of [-1, 1]) {
    k.box(m.metal, s * 0.25, 0.56, 0.0, 0.025, 0.16, 0.025);
    cushion(k, m.dark, s * 0.25, 0.65, 0.02, 0.06, 0.03, 0.26, 0.012);
  }
}

function bookshelf(b: ItemBuild): void {
  const { k, w, d, h, m } = b;
  const t = 0.022;
  k.box(m.main, -w / 2 + t / 2, h / 2, 0, t, h, d);
  k.box(m.main, w / 2 - t / 2, h / 2, 0, t, h, d);
  k.box(m.main, 0, h - t / 2, 0, w, t, d);
  k.box(m.main, 0, 0.05, 0, w, 0.1, d);
  k.box(m.woodDark, 0, h / 2, -d / 2 + 0.005, w - 2 * t, h, 0.01);
  const n = Math.max(3, Math.round((h - 0.1) / 0.36));
  const sh = (h - 0.1 - t) / n;
  const bm = [m.accent, m.accent2, m.linen, m.fabric, m.woodDark];
  for (let i = 0; i < n; i++) {
    const y = 0.1 + sh * i;
    if (i > 0) k.box(m.main, 0, y, 0, w - 2 * t, t, d - 0.01);
    const r = b.rnd();
    if (r < 0.7) books(k, bm, -w / 2 + t + 0.02, -w / 2 + t + (w - 2 * t) * (0.45 + b.rnd() * 0.45), y + t / 2, 0.01, d * 0.8, b.rnd, Math.min(0.3, sh - 0.04));
    if (r > 0.45) vase(k, b.rnd() < 0.5 ? m.ceramic : m.stone, w / 2 - t - 0.12, y + t / 2, 0, Math.min(0.22, sh - 0.06), Math.floor(b.rnd() * 3));
  }
}

// ── seating ───────────────────────────────────────────────────────────────────────────────────────────
function sofa(b: ItemBuild, seats: number, lshape = false): void {
  const { k, w, d, m } = b;
  const legH = 0.1, baseTop = 0.37, seatTop = 0.47, armW = 0.17, armH = 0.6, backH = 0.8, backD = 0.22;
  const d0 = lshape ? Math.min(d, 0.95) : d;
  const chaise = lshape ? clamp(w * 0.34, 0.8, 1.05) : 0;
  const side = b.variant.includes("left") ? -1 : 1;
  const zBack = -d / 2;
  // legs
  const legPts: [number, number][] = [[-w / 2 + 0.07, zBack + 0.07], [w / 2 - 0.07, zBack + 0.07], [-w / 2 + 0.07, zBack + d0 - 0.07], [w / 2 - 0.07, zBack + d0 - 0.07]];
  if (lshape) legPts.push([side * (w / 2 - 0.07), d / 2 - 0.07], [side * (w / 2 - chaise + 0.07), d / 2 - 0.07]);
  for (const [x, z] of legPts) k.cyl(m.metal, x, legH / 2, z, 0.014, legH, 10);
  // base
  cushion(k, m.fabric, 0, (legH + baseTop) / 2, zBack + d0 / 2, w, baseTop - legH, d0, 0.03);
  if (lshape) cushion(k, m.fabric, side * (w / 2 - chaise / 2), (legH + baseTop) / 2, zBack + d0 + (d - d0) / 2 - 0.01, chaise, baseTop - legH, d - d0 + 0.02, 0.03);
  // arms
  const armL = lshape ? (side < 0 ? d : d0) : d0;
  const armR = lshape ? (side > 0 ? d : d0) : d0;
  cushion(k, m.fabric, -w / 2 + armW / 2, (legH + armH) / 2, zBack + armL / 2, armW, armH - legH, armL, 0.055);
  cushion(k, m.fabric, w / 2 - armW / 2, (legH + armH) / 2, zBack + armR / 2, armW, armH - legH, armR, 0.055);
  // back
  cushion(k, m.fabric, 0, (baseTop + backH) / 2, zBack + backD / 2, w - 2 * armW + 0.04, backH - baseTop, backD, 0.05);
  // seat cushions
  const inner = w - 2 * armW;
  const seatD = d0 - backD - 0.02;
  if (lshape) {
    const mainW = inner - chaise + armW;
    const n = Math.max(1, Math.round(mainW / 0.68));
    const cw = mainW / n;
    const x0 = side > 0 ? -w / 2 + armW : w / 2 - armW - mainW;
    for (let i = 0; i < n; i++) cushion(k, m.fabric, x0 + cw * (i + 0.5), (baseTop + seatTop) / 2 + 0.01, zBack + backD + seatD / 2, cw - 0.012, seatTop - baseTop + 0.03, seatD, 0.05);
    cushion(k, m.fabric, side * (w / 2 - armW - (chaise - armW) / 2), (baseTop + seatTop) / 2 + 0.01, zBack + backD + (d - backD) / 2 - 0.01, chaise - armW - 0.012, seatTop - baseTop + 0.03, d - backD - 0.04, 0.05);
  } else {
    const n = Math.max(1, seats);
    const cw = inner / n;
    for (let i = 0; i < n; i++) cushion(k, m.fabric, -inner / 2 + cw * (i + 0.5), (baseTop + seatTop) / 2 + 0.01, zBack + backD + seatD / 2, cw - 0.012, seatTop - baseTop + 0.03, seatD, 0.05);
  }
  // back cushions
  const nb = Math.max(1, Math.round(inner / (lshape ? 0.72 : inner / Math.max(1, seats))));
  const bw = inner / nb;
  for (let i = 0; i < nb; i++) cushion(k, m.fabric, -inner / 2 + bw * (i + 0.5), seatTop + 0.21, zBack + backD + 0.07, bw - 0.02, 0.43, 0.17, 0.07, -0.13);
  // throw pillows
  if (inner > 0.9) {
    for (const s of [-1, 1]) cushion(k, s < 0 ? m.accent : m.accent2, s * (inner / 2 - 0.26), seatTop + 0.2, zBack + backD + 0.2, 0.42, 0.42, 0.13, 0.06, -0.28, 0, s * 0.12);
  }
}

function armchair(b: ItemBuild): void {
  const { k, w, d, m } = b;
  const seatTop = 0.44;
  legs4(k, m.wood, w, d, 0.2, 0.06, "tapered", 0.04);
  cushion(k, m.fabric, 0, 0.29, 0.02, w, 0.18, d - 0.04, 0.04);
  cushion(k, m.fabric, 0, seatTop - 0.02, 0.06, w - 0.26, 0.12, d - 0.26, 0.05);
  for (const s of [-1, 1]) cushion(k, m.fabric, s * (w / 2 - 0.07), 0.47, 0.02, 0.14, 0.38, d - 0.06, 0.05);
  cushion(k, m.fabric, 0, 0.62, -d / 2 + 0.11, w - 0.06, 0.62, 0.18, 0.06, -0.15);
  cushion(k, m.accent2, 0, seatTop + 0.18, -d / 2 + 0.26, 0.4, 0.3, 0.12, 0.05, -0.25);
}

function ottoman(b: ItemBuild): void {
  const { k, w, h, m } = b;
  k.geo(m.accent, lathe("pouf", [[0, 0], [0.92, 0], [1, 0.12], [1, 0.82], [0.9, 1], [0, 1]], 32), mat4(0, 0.05, 0, 0, 0, 0, w / 2, h - 0.05, w / 2));
  legs4(k, m.metal, w * 0.6, w * 0.6, 0.05, 0.03, "round", 0.02);
}

// ── tables & storage ──────────────────────────────────────────────────────────────────────────────────
function coffeeTable(b: ItemBuild): void {
  const { k, w, d, h, m } = b;
  const marbleTop = b.variant.includes("marble") || (m.main as THREE.Material).name.startsWith("marble");
  const topMat = marbleTop ? m.main : m.main;
  if (marbleTop) {
    k.rbox(topMat, 0, h - 0.016, 0, w, 0.032, d, 0.012, 3);
    // sled frame in metal
    for (const s of [-1, 1]) {
      const x = s * (w / 2 - 0.1);
      k.box(m.metal, x, 0.01, 0, 0.022, 0.02, d - 0.12);
      k.box(m.metal, x, h - 0.042, 0, 0.022, 0.02, d - 0.12);
      for (const zs of [-1, 1]) k.box(m.metal, x, (h - 0.03) / 2, zs * (d / 2 - 0.07), 0.022, h - 0.03, 0.022);
    }
  } else {
    k.rbox(topMat, 0, h - 0.02, 0, w, 0.04, d, 0.01, 2);
    k.rbox(topMat, 0, 0.12, 0, w - 0.14, 0.025, d - 0.14, 0.006, 1);
    legs4(k, m.main, w, d, h - 0.04, 0.06, "square", 0.05);
  }
  // decor: tray, vase, book stack
  k.rbox(m.dark, -w * 0.18, h + 0.008, 0, 0.36, 0.016, 0.24, 0.006, 1);
  vase(k, m.ceramic, -w * 0.22, h + 0.016, 0.02, 0.2, 0);
  k.sphere(m.brass, -w * 0.1, h + 0.05, -0.04, 0.07, 0.07, 0.07, 14);
  books(k, [m.accent2, m.linen], w * 0.12, w * 0.32, h, 0.0, 0.24, () => 0.5, 0.04);
  k.rbox(m.accent, w * 0.22, h + 0.06, 0, 0.26, 0.03, 0.2, 0.004, 1);
}

function consoleTable(b: ItemBuild): void {
  const { k, w, d, h, m } = b;
  k.rbox(m.main, 0, h - 0.015, 0, w, 0.03, d, 0.006, 2);
  k.rbox(m.main, 0, 0.18, 0, w - 0.1, 0.02, d - 0.06, 0.004, 1);
  legs4(k, m.metal, w, d, h - 0.03, 0.03, "square", 0.025);
  vase(k, m.stone, -w * 0.28, h, 0, 0.42, 1);
  for (let i = 0; i < 5; i++) stick(k, m.woodDark, V(-w * 0.28, h + 0.38, 0), V(-w * 0.28 + (b.rnd() - 0.5) * 0.3, h + 0.75 + b.rnd() * 0.2, (b.rnd() - 0.5) * 0.2), 0.004, 5);
  books(k, [m.accent, m.accent2], w * 0.08, w * 0.3, h, 0, 0.2, b.rnd, 0.06);
  k.sphere(m.brass, w * 0.36, h + 0.07, 0, 0.12, 0.12, 0.12, 14);
}

function tvUnit(b: ItemBuild): void {
  const { k, w, d, h, m } = b;
  const lift = 0.14;
  k.box(m.dark, 0, lift / 2, -0.02, w - 0.2, lift, d - 0.12);
  k.box(m.woodDark, 0, lift + (h - lift) / 2, 0, w, h - lift, d - 0.02);
  const n = Math.max(2, Math.round(w / 0.55));
  const fr = fronts(k, m.main, -w / 2, w / 2, lift, h - 0.03, d / 2 - 0.01, n, 1, 0.003);
  // fluted fronts: fine vertical grooves
  for (const f of fr) {
    const g = Math.floor(f.w / 0.03);
    for (let i = 1; i < g; i++) k.box(m.woodDark, f.cx - f.w / 2 + (f.w * i) / g, f.cy, d / 2 + 0.009, 0.004, f.h - 0.02, 0.002);
  }
  k.rbox(m.main, 0, h - 0.015, 0, w + 0.02, 0.03, d + 0.01, 0.005, 2);
  k.rbox(m.dark, 0, h + 0.04, -0.02, Math.min(0.9, w * 0.4), 0.07, 0.1, 0.02, 2);
  vase(k, m.ceramic, w * 0.36, h, 0, 0.3, 0);
  books(k, [m.accent2, m.linen], -w * 0.44, -w * 0.3, h, 0, 0.2, b.rnd, 0.05);
}

function tv(b: ItemBuild): void {
  const { k, w, h, m } = b;
  const th = 0.03;
  const onStand = b.variant.includes("stand");
  const y0 = onStand ? 0.08 : 0;
  k.rbox(m.dark, 0, y0 + h / 2, 0, w, h, th, 0.006, 2);
  k.geo(m.screen, unitBox(), mat4(0, y0 + h / 2 + 0.008, th / 2 + 0.0005, 0, 0, 0, w - 0.02, h - 0.03, 0.001));
  if (onStand) {
    k.rbox(m.dark, 0, 0.01, 0.04, w * 0.35, 0.02, 0.22, 0.006, 1);
    k.box(m.dark, 0, 0.05, 0, 0.06, 0.08, 0.04);
  }
}

function rug(b: ItemBuild, kind: "modern" | "classic" | "prayer"): void {
  const { k, w, d, m } = b;
  const tex = rugTexture(b.colorHex, kind);
  const mat = texturedMat(m.M, `rug|${b.colorHex}|${kind}`, tex, 0.95);
  const t = kind === "prayer" ? 0.008 : 0.012;
  k.geo(mat, planeGeo(), mat4(0, t + 0.0005, 0, -PI / 2, 0, 0, w, d, 1), "native");
  k.box(m.fabric, 0, t / 2, 0, w, t, d);
}

function floorLamp(b: ItemBuild): void {
  const { k, h, m } = b;
  k.cyl(m.marble, 0, 0.015, 0, 0.15, 0.03, 28);
  k.cyl(m.metal, 0, h / 2, 0, 0.011, h - 0.3, 10);
  k.geo(m.shade, lathe("drum", [[0.2, 0], [0.21, 0], [0.18, 0.3], [0.17, 0.3]], 32), mat4(0, h - 0.32, 0));
  k.sphere(m.bulb, 0, h - 0.2, 0, 0.06, 0.06, 0.06, 12);
}

function tableLamp(b: ItemBuild): void {
  const { k, m } = b;
  k.geo(m.ceramic, lathe("lampbase", [[0, 0], [0.08, 0], [0.11, 0.08], [0.1, 0.22], [0.04, 0.3], [0.02, 0.34], [0, 0.34]], 28), mat4(0, 0, 0));
  k.cyl(m.brass, 0, 0.36, 0, 0.008, 0.06, 8);
  k.geo(m.shade, lathe("tshade", [[0.15, 0], [0.155, 0], [0.12, 0.2], [0.115, 0.2]], 32), mat4(0, 0.33, 0));
  k.sphere(m.bulb, 0, 0.42, 0, 0.035, 0.035, 0.035, 10);
}

function pendant(b: ItemBuild): void {
  const { k, m } = b;
  const ceil = b.extra.ceiling ?? 3;
  const bottom = clamp(b.variant.includes("low") ? 1.5 : ceil - 0.95, 1.5, ceil - 0.3);
  k.cyl(m.metal, 0, ceil - 0.01, 0, 0.06, 0.02, 20);
  k.cyl(m.dark, 0, (ceil + bottom + 0.22) / 2, 0, 0.003, ceil - bottom - 0.22, 6);
  k.geo(m.metal, lathe("dome", [[0, 0.22], [0.05, 0.215], [0.16, 0.16], [0.24, 0.04], [0.25, 0], [0.235, 0.0], [0.15, 0.15], [0.04, 0.2], [0, 0.205]], 36), mat4(0, bottom, 0));
  k.cyl(m.bulb, 0, bottom + 0.02, 0, 0.2, 0.004, 28);
}

function chandelier(b: ItemBuild): void {
  const { k, w, m } = b;
  const ceil = b.extra.ceiling ?? 3;
  const R = clamp(w / 2, 0.35, 0.8);
  const classic = b.variant.includes("classic") || b.variant.includes("crystal") || b.style === "classic" || b.style === "traditional";
  k.cyl(m.brass, 0, ceil - 0.015, 0, 0.09, 0.03, 24);
  const y1 = ceil - 0.75;
  if (!classic) {
    for (const [rr, yy] of [[R, y1], [R * 0.62, y1 - 0.18]] as const) {
      k.geo(m.brass, torus(rr, 0.018, 64, 10), mat4(0, yy, 0, PI / 2, 0, 0));
      k.geo(m.bulb, torus(rr - 0.012, 0.008, 64, 6), mat4(0, yy - 0.012, 0, PI / 2, 0, 0));
    }
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * PI * 2;
      stick(k, m.dark, V(Math.cos(a) * R, y1, Math.sin(a) * R), V(Math.cos(a) * 0.05, ceil - 0.02, Math.sin(a) * 0.05), 0.0025, 4);
      stick(k, m.dark, V(Math.cos(a) * R * 0.62, y1 - 0.18, Math.sin(a) * R * 0.62), V(Math.cos(a) * R, y1, Math.sin(a) * R), 0.0025, 4);
    }
    return;
  }
  // classic tiered: stem, curved arms with candle bulbs and crystal drops
  k.cyl(m.brass, 0, (ceil + y1 - 0.2) / 2, 0, 0.012, ceil - y1 + 0.2, 10);
  k.geo(m.brass, lathe("chbody", [[0, 0], [0.08, 0.02], [0.11, 0.1], [0.06, 0.2], [0.02, 0.3], [0, 0.3]], 24), mat4(0, y1 - 0.2, 0));
  for (const [n, rr, yy] of [[8, R, y1 - 0.08], [6, R * 0.55, y1 + 0.16]] as const) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * PI * 2;
      const cx = Math.cos(a) * rr, cz = Math.sin(a) * rr;
      stick(k, m.brass, V(0, yy - 0.06, 0), V(cx, yy, cz), 0.007, 6);
      k.cyl(m.brass, cx, yy + 0.01, cz, 0.03, 0.02, 12);
      k.cyl(m.ceramic, cx, yy + 0.07, cz, 0.012, 0.1, 8);
      k.sphere(m.bulb, cx, yy + 0.14, cz, 0.026, 0.04, 0.026, 8);
      k.sphere(m.glass, cx, yy - 0.09, cz, 0.025, 0.04, 0.025, 8);
    }
  }
}

function curtains(b: ItemBuild): void {
  const { k, w, h, m } = b;
  const pw = clamp(w * 0.2, 0.35, 0.8);
  const z = -b.d / 2 + 0.1;
  const g = drapeGeo(pw, h - 0.06, Math.max(5, Math.round(pw / 0.075)));
  for (const s of [-1, 1]) k.geo(m.accent2, g, mat4(s * (w / 2 - pw / 2) - pw / 2, 0.02, z), "box");
  k.cyl(m.metal, 0, h, z, 0.012, w + 0.25, 12, 0, 0, PI / 2);
  for (const s of [-1, 1]) {
    k.sphere(m.metal, s * (w / 2 + 0.14), h, z, 0.035, 0.035, 0.035, 10);
    k.box(m.metal, s * (w / 2 + 0.04), h, z - 0.05, 0.015, 0.02, 0.1);
  }
}

const drapeCache = new Map<string, THREE.BufferGeometry>();
function drapeGeo(w: number, h: number, folds: number): THREE.BufferGeometry {
  const key = `${w.toFixed(3)}|${h.toFixed(3)}|${folds}`;
  let g = drapeCache.get(key);
  if (g) return g;
  const nu = folds * 8, A = 0.035;
  const pos: number[] = [], idx: number[] = [];
  const t = 0.004;
  for (const side of [0, 1])
    for (let i = 0; i <= nu; i++) {
      const u = i / nu;
      const x = u * w;
      const z = A * Math.sin(u * folds * PI * 2) * (0.75 + 0.25 * Math.sin(u * 7.1)) + (side ? -t : t);
      pos.push(x, 0, z, x, h, z);
    }
  const row = (nu + 1) * 2;
  for (let i = 0; i < nu; i++) {
    const a = i * 2, b2 = (i + 1) * 2;
    idx.push(a, b2, a + 1, a + 1, b2, b2 + 1);
    const c = row + i * 2, d = row + (i + 1) * 2;
    idx.push(c, c + 1, d, c + 1, d + 1, d);
  }
  g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  drapeCache.set(key, g);
  return g;
}

function plantFloor(b: ItemBuild): void {
  const { k, w, h, m } = b;
  const r = clamp(w * 0.28, 0.12, 0.3);
  const ph = clamp(h * 0.24, 0.25, 0.5);
  const potMat = b.variant.includes("terracotta") ? m.M.get({ preset: "concrete", color: "#b5653d" }) : b.rnd() < 0.5 ? m.stone : m.ceramic;
  k.geo(potMat, lathe("planter", [[0, 0], [0.82, 0], [0.9, 0.05], [1, 0.95], [0.96, 1], [0.9, 0.96], [0, 0.96]], 32), mat4(0, 0, 0, 0, 0, 0, r, ph, r));
  k.cyl(m.soil, 0, ph * 0.93, 0, r * 0.88, 0.01, 24);
  const v = b.variant;
  const kind = v.includes("palm") || v.includes("areca") ? "areca" : v.includes("snake") ? "snake" : v.includes("bush") ? "bush" : b.rnd() < 0.55 ? "fiddle" : "areca";
  foliage(k, m, 0, ph * 0.93, 0, h - ph, w * 0.9, b.rnd, kind);
}

function plantSmall(b: ItemBuild): void {
  const { k, w, h, m } = b;
  const r = clamp(w * 0.3, 0.06, 0.12);
  k.geo(m.ceramic, lathe("smallpot", [[0, 0], [0.8, 0], [1, 0.9], [0.95, 1], [0, 1]], 24), mat4(0, 0, 0, 0, 0, 0, r, r * 1.3, r));
  foliage(k, m, 0, r * 1.25, 0, h - r * 1.3, w * 0.9, b.rnd, "bush");
}

function painting(b: ItemBuild): void {
  const { k, w, h, m } = b;
  const art = texturedMat(m.M, `art|${b.extra.room ?? ""}|${b.colorHex}`, artTexture(`${b.extra.room ?? "x"}${b.colorHex}${w.toFixed(2)}`, [b.colorHex, "#c46a3b", "#2f4858", "#d9c8a9", "#8b877f", "#e7dccb"]), 0.85);
  const fm = b.variant.includes("gold") || b.style === "classic" ? m.brass : b.variant.includes("wood") ? m.wood : m.dark;
  const t = 0.035;
  k.geo(art, planeGeo(), mat4(0, h / 2, t + 0.0006, 0, 0, 0, w - 0.06, h - 0.06, 1), "native");
  k.box(m.linen, 0, h / 2, t / 2, w - 0.06, h - 0.06, t);
  const f = 0.028;
  k.box(fm, 0, h - f / 2, 0.025, w, f, 0.05);
  k.box(fm, 0, f / 2, 0.025, w, f, 0.05);
  k.box(fm, -w / 2 + f / 2, h / 2, 0.025, f, h, 0.05);
  k.box(fm, w / 2 - f / 2, h / 2, 0.025, f, h, 0.05);
}

function mirrorWall(b: ItemBuild): void {
  const { k, w, h, m } = b;
  const round = b.variant.includes("round") || Math.abs(w - h) < 0.12;
  const fm = b.style === "classic" || b.variant.includes("gold") ? m.brass : m.metal;
  if (round) {
    const R = Math.min(w, h) / 2;
    k.cyl(m.mirror, 0, h / 2, 0.012, R - 0.02, 0.01, 48, PI / 2);
    k.geo(fm, torus(R - 0.012, 0.014, 64, 10), mat4(0, h / 2, 0.016));
  } else {
    k.rbox(fm, 0, h / 2, 0.012, w, h, 0.024, 0.012, 2);
    k.rbox(m.mirror, 0, h / 2, 0.022, w - 0.04, h - 0.04, 0.006, 0.01, 2);
  }
}

// ── dining ────────────────────────────────────────────────────────────────────────────────────────────
function diningTable(b: ItemBuild, seats: number): void {
  const { k, w, d, m } = b;
  const h = 0.76;
  const marble = b.variant.includes("marble") || (m.main as THREE.Material).name.startsWith("marble");
  k.rbox(m.main, 0, h - 0.02, 0, w, 0.04, d, 0.012, 3);
  if (seats <= 4) legs4(k, marble ? m.metal : m.main, w, d, h - 0.04, 0.09, "tapered", 0.06);
  else {
    for (const s of [-1, 1]) {
      const x = s * (w / 2 - Math.min(0.45, w * 0.18));
      k.rbox(marble ? m.woodDark : m.main, x, (h - 0.04) / 2, 0, 0.1, h - 0.04, d * 0.55, 0.01, 2);
      k.rbox(marble ? m.woodDark : m.main, x, 0.02, 0, 0.16, 0.04, d * 0.7, 0.01, 2);
    }
    k.box(marble ? m.woodDark : m.main, 0, h - 0.12, 0, w - Math.min(0.9, w * 0.36), 0.06, 0.08);
  }
  // runner + centerpiece
  k.box(m.accent2, 0, h + 0.002, 0, Math.min(w * 0.7, 1.6), 0.004, 0.36);
  vase(k, m.ceramic, 0, h, 0, 0.26, 1);
  for (const s of [-1, 1]) k.sphere(m.brass, s * 0.25, h + 0.04, 0.05, 0.08, 0.08, 0.08, 12);
}

export function chairsForTable(k: Kit, b: ItemBuild, seats: number): void {
  const { w, d } = b;
  const pts: [number, number, number][] = [];
  const perSide = seats <= 4 ? 2 : seats <= 6 ? 2 : 3;
  for (let i = 0; i < perSide; i++) {
    const x = -w / 2 + (w * (i + 0.5)) / perSide;
    pts.push([x, d / 2 + 0.22, PI]);
    pts.push([x, -d / 2 - 0.22, 0]);
  }
  if (seats > 4) {
    pts.push([w / 2 + 0.24, 0, -PI / 2]);
    pts.push([-w / 2 - 0.24, 0, PI / 2]);
  }
  for (const [x, z, ry] of pts.slice(0, Math.max(seats, 2))) diningChairAt(k, b, x, z, ry);
}

export function diningChairAt(k: Kit, b: ItemBuild, x: number, z: number, ry: number): void {
  const m = b.m;
  const P = mat4(x, 0, z, 0, ry, 0);
  const add = (mat: THREE.Material, g: THREE.BufferGeometry, mm: THREE.Matrix4) => k.geo(mat, g, P.clone().multiply(mm));
  // legs
  for (const sx of [-1, 1]) {
    add(m.wood, unitBox(), mat4(sx * 0.19, 0.22, 0.18, 0.04, 0, 0, 0.03, 0.44, 0.03));
    add(m.wood, unitBox(), mat4(sx * 0.19, 0.45, -0.19, -0.08, 0, 0, 0.03, 0.9, 0.03));
  }
  add(m.fabric, roundedBoxFor(0.46, 0.07, 0.44, 0.03), mat4(0, 0.47, 0.01));
  add(m.fabric, roundedBoxFor(0.44, 0.36, 0.06, 0.025), mat4(0, 0.74, -0.2, -0.1, 0, 0));
}

function diningChair(b: ItemBuild): void {
  diningChairAt(b.k, b, 0, 0, 0);
}

function sideboard(b: ItemBuild): void {
  const { k, w, d, h, m } = b;
  const legH = 0.16;
  k.box(m.woodDark, 0, (legH + h) / 2, 0, w, h - legH, d - 0.02);
  const fr = fronts(k, m.main, -w / 2, w / 2, legH, h - 0.03, d / 2 - 0.01, Math.max(2, Math.round(w / 0.5)), 1, 0.003);
  for (const f of fr) {
    const g = Math.floor(f.w / 0.035);
    for (let i = 1; i < g; i++) k.box(m.woodDark, f.cx - f.w / 2 + (f.w * i) / g, f.cy, d / 2 + 0.009, 0.004, f.h - 0.02, 0.002);
  }
  k.rbox(m.main, 0, h - 0.015, 0, w + 0.02, 0.03, d + 0.01, 0.006, 2);
  legs4(k, m.metal, w, d, legH, 0.06, "square", 0.025);
  // decor
  k.geo(m.ceramic, lathe("lampbase", [[0, 0], [0.08, 0], [0.11, 0.08], [0.1, 0.22], [0.04, 0.3], [0.02, 0.34], [0, 0.34]], 24), mat4(-w * 0.36, h, 0));
  k.geo(m.shade, lathe("tshade", [[0.15, 0], [0.155, 0], [0.12, 0.2], [0.115, 0.2]], 28), mat4(-w * 0.36, h + 0.33, 0));
  vase(k, m.stone, w * 0.1, h, -0.05, 0.36, 0);
  books(k, [m.accent, m.accent2, m.linen], w * 0.24, w * 0.42, h, 0, 0.2, b.rnd, 0.05);
}

// ── kitchen ───────────────────────────────────────────────────────────────────────────────────────────
function kitchenCounter(b: ItemBuild): void {
  const { k, w, d, m } = b;
  const top = 0.9, plinth = 0.1;
  const wcBot = 1.45;
  const wcTop = Math.min(2.2, (b.extra.ceiling ?? 3) - 0.1);
  const wcD = 0.34;
  const front = m.main;
  const work = b.variant.includes("granite") || b.variant.includes("black") ? m.M.get("marble_black") : m.M.get("marble_white");
  k.box(m.dark, 0, plinth / 2, -0.04, w, plinth, d - 0.1);
  k.box(m.woodDark, 0, (plinth + top - 0.04) / 2, -0.01, w, top - 0.04 - plinth, d - 0.03);
  const cols = Math.max(1, Math.round(w / 0.6));
  const drawers = fronts(k, front, -w / 2, w / 2, top - 0.04 - 0.2, top - 0.04, d / 2 - 0.025, cols, 1, 0.003);
  const doors = fronts(k, front, -w / 2, w / 2, plinth, top - 0.04 - 0.2, d / 2 - 0.025, cols, 1, 0.003);
  for (const f of [...drawers, ...doors]) k.box(m.steel, f.cx, f.cy + f.h / 2 - 0.012, d / 2 + 0.002, f.w * 0.7, 0.012, 0.012);
  k.box(work, 0, top - 0.02, 0.01, w + 0.01, 0.04, d + 0.02);
  // openings on the wall behind (windows): no wall cabinets, lower backsplash
  const ops = b.extra.wallOpenings ?? [];
  const blocked = (x0: number, x1: number) => ops.some((o) => x1 > o.x0 - 0.05 && x0 < o.x1 + 0.05 && o.sill < wcTop);
  // sink under a window if possible, hob on the other side
  const win = ops.find((o) => o.x1 > -w / 2 + 0.3 && o.x0 < w / 2 - 0.3);
  let sinkX = win ? clamp((win.x0 + win.x1) / 2, -w / 2 + 0.4, w / 2 - 0.4) : -w / 4;
  let hobX = sinkX < 0 ? w / 4 + 0.1 : -w / 4 - 0.1;
  if (w < 1.8) {
    sinkX = -w / 4;
    hobX = w / 4;
  }
  hobX = clamp(hobX, -w / 2 + 0.38, w / 2 - 0.38);
  // backsplash (stops under windows)
  const splash = m.M.get({ preset: "ceramic_tile", color: "#e8e4dc", scale_ft: 1.2 });
  const segs = splitSpans(-w / 2, w / 2, ops.map((o) => [o.x0, o.x1] as [number, number]));
  for (const [a, c] of segs) k.box(splash, (a + c) / 2, (top + wcBot) / 2, -d / 2 + 0.008, c - a, wcBot - top, 0.012);
  for (const o of ops) {
    const a = Math.max(-w / 2, o.x0), c = Math.min(w / 2, o.x1);
    if (c - a > 0.05 && o.sill > top + 0.02) k.box(splash, (a + c) / 2, (top + o.sill) / 2, -d / 2 + 0.008, c - a, o.sill - top, 0.012);
  }
  // wall cabinets (skip windows and the hood)
  const hoodW = 0.7;
  const wcSegs = splitSpans(-w / 2, w / 2, [...ops.filter((o) => o.sill < wcTop).map((o) => [o.x0 - 0.05, o.x1 + 0.05] as [number, number]), ...(b.extra.noHob ? [] : [[hobX - hoodW / 2, hobX + hoodW / 2] as [number, number]])]);
  for (const [a, c] of wcSegs) {
    if (c - a < 0.3) continue;
    const zc = -d / 2 + wcD / 2;
    k.box(m.woodDark, (a + c) / 2, (wcBot + wcTop) / 2, zc - 0.01, c - a, wcTop - wcBot, wcD - 0.02);
    const n = Math.max(1, Math.round((c - a) / 0.5));
    const fr = fronts(k, front, a, c, wcBot, wcTop, -d / 2 + wcD - 0.02, n, 1, 0.003);
    for (const f of fr) k.box(m.steel, f.cx, f.cy - f.h / 2 + 0.012, -d / 2 + wcD + 0.002, f.w * 0.6, 0.012, 0.012);
    // under-cabinet LED
    k.box(m.bulb, (a + c) / 2, wcBot - 0.004, -d / 2 + wcD - 0.06, c - a - 0.04, 0.006, 0.02);
  }
  void blocked;
  if (!b.extra.noHob) {
    hobTop(k, m, hobX, top, 0.02);
    // chimney hood
    k.geo(m.steel, lathe("hood2", [[0, 0], [0.42, 0], [0.42, 0.045], [0.19, 0.17], [0, 0.17]], 4), mat4(hobX, wcBot + 0.08, -d / 2 + 0.26, 0, PI / 4, 0, 1, 1, 0.82));
    k.box(m.steel, hobX, (wcBot + 0.2 + wcTop + 0.4) / 2, -d / 2 + 0.15, 0.26, wcTop + 0.4 - wcBot - 0.2, 0.24);
  }
  if (!b.extra.noSink) sinkTop(k, m, sinkX, top, -0.02);
}

function splitSpans(a: number, b: number, cuts: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  let cur = a;
  for (const [p, q] of cuts.filter(([p, q]) => q > a && p < b).sort((x, y) => x[0] - y[0])) {
    if (p > cur) out.push([cur, Math.min(p, b)]);
    cur = Math.max(cur, q);
  }
  if (b > cur) out.push([cur, b]);
  return out;
}

function hobTop(k: Kit, m: ItemBuild["m"], x: number, y: number, z: number): void {
  k.rbox(m.screen, x, y + 0.004, z, 0.6, 0.008, 0.5, 0.004, 1);
  const pts: [number, number, number][] = [[-0.15, -0.12, 0.08], [0.15, -0.12, 0.065], [-0.15, 0.12, 0.065], [0.15, 0.12, 0.08]];
  for (const [dx, dz, r] of pts) {
    k.geo(m.steel, torus(r, 0.008, 24, 6), mat4(x + dx, y + 0.012, z + dz, PI / 2, 0, 0));
    k.cyl(m.dark, x + dx, y + 0.016, z + dz, r * 0.45, 0.012, 16);
  }
}

function sinkTop(k: Kit, m: ItemBuild["m"], x: number, y: number, z: number): void {
  k.box(m.steel, x, y + 0.001, z, 0.66, 0.004, 0.46);
  k.box(m.M.basic("#7d7f82", { roughness: 0.35, metalness: 0.9 }), x, y + 0.0035, z + 0.01, 0.58, 0.002, 0.38);
  k.cyl(m.dark, x, y + 0.005, z + 0.01, 0.025, 0.002, 12);
  // gooseneck faucet
  const fx = x, fz = z - 0.26;
  k.cyl(m.steel, fx, y + 0.17, fz, 0.016, 0.34, 14);
  k.geo(m.steel, torus(0.1, 0.014, 20, 8, PI), mat4(fx, y + 0.34, fz + 0.1, 0, PI / 2, 0));
  k.cyl(m.steel, fx, y + 0.3, fz + 0.2, 0.014, 0.08, 10);
  k.box(m.steel, fx + 0.05, y + 0.25, fz, 0.07, 0.012, 0.016);
}

function kitchenIsland(b: ItemBuild): void {
  const { k, w, d, m } = b;
  const top = 0.92;
  const bodyD = d - 0.32;
  k.box(m.dark, 0, 0.05, -0.16, w - 0.1, 0.1, bodyD - 0.08);
  k.box(m.woodDark, 0, (0.1 + top - 0.04) / 2, -0.16, w - 0.08, top - 0.14, bodyD);
  const fr = fronts(k, m.main, -w / 2 + 0.04, w / 2 - 0.04, 0.1, top - 0.04, -0.16 - bodyD / 2 - 0.02, Math.max(2, Math.round(w / 0.6)), 1);
  void fr;
  const stone = m.M.get("marble_white");
  k.box(stone, 0, top - 0.02, 0, w, 0.04, d);
  for (const s of [-1, 1]) k.box(stone, s * (w / 2 - 0.02), (top - 0.04) / 2, 0, 0.04, top - 0.04, d);
  const n = Math.max(2, Math.floor((w - 0.3) / 0.55));
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + 0.15 + ((w - 0.3) * (i + 0.5)) / n;
    const zz = d / 2 + 0.12;
    k.cyl(m.fabric, x, 0.66, zz, 0.19, 0.06, 24);
    for (let j = 0; j < 4; j++) {
      const a = (j / 4) * PI * 2 + PI / 4;
      stick(k, m.metal, V(x + Math.cos(a) * 0.14, 0.63, zz + Math.sin(a) * 0.14), V(x + Math.cos(a) * 0.19, 0, zz + Math.sin(a) * 0.19), 0.01, 6);
    }
    k.geo(m.metal, torus(0.165, 0.008, 24, 6), mat4(x, 0.25, zz, PI / 2, 0, 0));
  }
  pendantRow(k, m, w, b.extra.ceiling ?? 3, top);
}

function pendantRow(k: Kit, m: ItemBuild["m"], w: number, ceil: number, top: number): void {
  const n = w > 2 ? 3 : 2;
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + (w * (i + 0.5)) / n;
    const y = top + 0.75;
    k.cyl(m.dark, x, (ceil + y + 0.2) / 2, 0, 0.003, ceil - y - 0.2, 6);
    k.geo(m.metal, lathe("dome", [[0, 0.22], [0.05, 0.215], [0.16, 0.16], [0.24, 0.04], [0.25, 0], [0.235, 0.0], [0.15, 0.15], [0.04, 0.2], [0, 0.205]], 28), mat4(x, y, 0, 0, 0, 0, 0.6, 0.6, 0.6));
    k.cyl(m.bulb, x, y + 0.012, 0, 0.12, 0.004, 20);
  }
}

function fridge(b: ItemBuild): void {
  const { k, w, d, h, m } = b;
  const body = m.main;
  k.rbox(body, 0, h / 2 + 0.02, -0.02, w, h - 0.04, d - 0.06, 0.012, 2);
  k.box(m.dark, 0, 0.02, -0.02, w - 0.08, 0.04, d - 0.12);
  const fr = fronts(k, body, -w / 2, w / 2, 0.06, h, d / 2 - 0.05, 2, 1, 0.003, 0.03);
  for (const [i, f] of fr.entries()) bar(k, m.steel, f.cx + (i === 0 ? f.w / 2 - 0.04 : -f.w / 2 + 0.04), h * 0.55, d / 2 - 0.0, 0.9, true, 0.011);
  k.rbox(m.screen, fr[0].cx - 0.02, h * 0.62, d / 2 - 0.018, 0.2, 0.32, 0.01, 0.01, 2);
}

function rangeCooker(b: ItemBuild): void {
  const { k, w, d, m } = b;
  const top = 0.9;
  k.rbox(m.steel, 0, top / 2, 0, w, top, d, 0.008, 2);
  k.rbox(m.screen, 0, top * 0.45, d / 2 + 0.002, w - 0.08, top * 0.55, 0.01, 0.01, 2);
  bar(k, m.steel, 0, top * 0.75, d / 2 + 0.03, w - 0.16, false, 0.01);
  for (let i = 0; i < 5; i++) k.cyl(m.dark, -w / 2 + 0.08 + ((w - 0.16) * (i + 0.5)) / 5, top - 0.06, d / 2 + 0.012, 0.018, 0.025, 12, PI / 2);
  hobTop(k, m, 0, top, 0);
  k.box(m.steel, 0, top + 0.06, -d / 2 + 0.02, w, 0.12, 0.03);
}

function hob(b: ItemBuild): void {
  if ((b.extra.support ?? 0) > 0.5) hobTop(b.k, b.m, 0, 0, 0);
  else rangeCooker(b);
}

function sinkKitchen(b: ItemBuild): void {
  const { k, w, d, m } = b;
  if ((b.extra.support ?? 0) > 0.5) {
    sinkTop(k, m, 0, 0, 0);
    return;
  }
  const top = 0.9;
  k.box(m.dark, 0, 0.05, -0.04, w, 0.1, d - 0.1);
  k.box(m.woodDark, 0, (0.1 + top - 0.04) / 2, -0.01, w, top - 0.14, d - 0.03);
  const fr = fronts(k, m.main, -w / 2, w / 2, 0.1, top - 0.04, d / 2 - 0.025, 2, 1, 0.003);
  for (const f of fr) k.box(m.steel, f.cx, f.cy + f.h / 2 - 0.012, d / 2 + 0.002, f.w * 0.7, 0.012, 0.012);
  k.box(m.M.get("marble_white"), 0, top - 0.02, 0.01, w + 0.01, 0.04, d + 0.02);
  sinkTop(k, m, 0, top, -0.02);
}

function microwave(b: ItemBuild): void {
  const { k, m } = b;
  const base = (b.extra.support ?? 0) > 0.5 ? 0 : 0.9;
  if (base > 0) {
    k.box(m.woodDark, 0, 0.45, 0, 0.6, 0.9, 0.45);
    k.box(m.M.get("marble_white"), 0, 0.89, 0, 0.62, 0.03, 0.47);
  }
  k.rbox(m.dark, 0, base + 0.15, 0, 0.5, 0.3, 0.38, 0.01, 2);
  k.rbox(m.screen, -0.05, base + 0.15, 0.19, 0.34, 0.24, 0.005, 0.004, 1);
  k.box(m.steel, 0.18, base + 0.15, 0.19, 0.1, 0.26, 0.006);
}

// ── bath ──────────────────────────────────────────────────────────────────────────────────────────────
function wc(b: ItemBuild): void {
  const { k, d, m } = b;
  const zb = -d / 2;
  k.rbox(m.ceramic, 0, 0.6, zb + 0.09, 0.4, 0.42, 0.17, 0.05, 3);
  k.cyl(m.steel, 0, 0.815, zb + 0.09, 0.03, 0.01, 16);
  k.rbox(m.ceramic, 0, 0.2, zb + 0.23, 0.26, 0.4, 0.22, 0.05, 3);
  k.geo(m.ceramic, lathe("wcbowl", [[0, 0], [0.13, 0], [0.16, 0.06], [0.19, 0.3], [0.19, 0.38], [0, 0.38]], 32), mat4(0, 0, zb + 0.45, 0, 0, 0, 1, 1, 1.3));
  k.rbox(m.ceramic, 0, 0.405, zb + 0.43, 0.38, 0.045, 0.5, 0.02, 3);
}

function vanity(b: ItemBuild): void {
  const { k, w, d, m } = b;
  const y0 = 0.36, y1 = 0.82;
  if (w < 0.58) {
    // EN2-03: a narrow wall-hung basin (no cabinet): a slim counter on two brackets, the bowl, the mirror
    for (const s of [-1, 1]) k.box(m.metal, s * (w / 2 - 0.04), y1 - 0.08, -d / 2 + 0.12, 0.02, 0.14, 0.22);
  } else {
    k.box(m.woodDark, 0, (y0 + y1) / 2, -0.01, w, y1 - y0, d - 0.03);
    const fr = fronts(k, m.main, -w / 2, w / 2, y0, y1, d / 2 - 0.025, Math.max(1, Math.round(w / 0.5)), 1, 0.003);
    for (const f of fr) k.box(m.metal, f.cx, f.cy + f.h / 2 - 0.02, d / 2 + 0.003, f.w * 0.5, 0.01, 0.01);
  }
  k.box(m.M.get("marble_white"), 0, y1 + 0.015, 0, w + 0.01, 0.03, d);
  const bx = 0;
  k.geo(m.ceramic, lathe("vessel", [[0, 0], [0.12, 0], [0.2, 0.06], [0.22, 0.14], [0.205, 0.14], [0.18, 0.07], [0.1, 0.02], [0, 0.02]], 36), mat4(bx, y1 + 0.03, 0.02));
  const fz = 0.02 - 0.26;
  k.cyl(m.metal, bx, y1 + 0.2, fz, 0.016, 0.34, 12);
  k.box(m.metal, bx, y1 + 0.36, fz + 0.08, 0.026, 0.026, 0.17);
  // mirror with LED backlight
  const mw = Math.min(w * 0.85, 0.9), mh = 0.8, my = y1 + 0.3 + mh / 2;
  k.rbox(m.bulb, 0, my, -d / 2 + 0.006, mw + 0.03, mh + 0.03, 0.006, 0.02, 2);
  k.rbox(m.mirror, 0, my, -d / 2 + 0.02, mw, mh, 0.012, 0.02, 2);
}

function shower(b: ItemBuild): void {
  const { k, w, d, m } = b;
  if (b.variant.includes("wet")) {
    // EN2-03: a wet-area shower (a small bath's floor is the shower floor): rain head, arm and mixer on the wall, a
    // hand shower, and a drain in the floor in front of them
    k.box(m.metal, 0, 2.15, -d / 2 + 0.2, 0.025, 0.025, 0.4);
    k.rbox(m.metal, 0, 2.12, -d / 2 + 0.36, 0.25, 0.012, 0.25, 0.004, 1);
    k.cyl(m.metal, 0, 1.1, -d / 2 + 0.01, 0.06, 0.02, 20, PI / 2);
    k.box(m.metal, 0.03, 1.1, -d / 2 + 0.04, 0.08, 0.015, 0.015);
    k.cyl(m.metal, -0.25, 1.05, -d / 2 + 0.02, 0.012, 0.6, 10);
    k.box(m.metal, 0, 0.003, -d / 2 + 0.45, 0.14, 0.006, 0.14);
    k.box(m.dark, 0, 0.0065, -d / 2 + 0.45, 0.1, 0.002, 0.1);
    return;
  }
  const H = 2.0;
  k.rbox(m.ceramic, 0, 0.025, 0, w, 0.05, d, 0.01, 2);
  k.box(m.dark, 0, 0.051, 0, 0.1, 0.002, 0.1);
  const gx = w / 2 - 0.01;
  const frosted = m.glass;
  // fixed front panel (60%) + side panel
  const fw = w * 0.62;
  k.box(frosted, -w / 2 + fw / 2, 0.05 + H / 2, d / 2 - 0.02, fw, H, 0.01);
  k.box(frosted, gx, 0.05 + H / 2, 0, 0.01, H, d - 0.04);
  k.box(m.metal, -w / 2 + fw / 2, 0.05 + H, d / 2 - 0.02, fw, 0.02, 0.02);
  k.box(m.metal, gx, 0.05 + H, 0, 0.02, 0.02, d - 0.04);
  k.box(m.metal, -w / 2 + fw, 0.05 + H / 2, d / 2 - 0.02, 0.02, H, 0.02);
  // rain head + arm + mixer
  k.box(m.metal, 0, 2.15, -d / 2 + 0.2, 0.025, 0.025, 0.4);
  k.rbox(m.metal, 0, 2.12, -d / 2 + 0.36, 0.25, 0.012, 0.25, 0.004, 1);
  k.cyl(m.metal, 0, 1.1, -d / 2 + 0.01, 0.06, 0.02, 20, PI / 2);
  k.box(m.metal, 0.03, 1.1, -d / 2 + 0.04, 0.08, 0.015, 0.015);
  k.cyl(m.metal, -0.25, 1.05, -d / 2 + 0.02, 0.012, 0.6, 10);
}

function bathtub(b: ItemBuild): void {
  const { k, w, d, h, m } = b;
  const prof: [number, number][] = [[0, 0], [0.86, 0], [0.97, 0.1], [1, 0.82], [0.985, 1], [0.93, 1], [0.91, 0.84], [0.84, 0.24], [0.66, 0.15], [0, 0.15]];
  k.geo(m.ceramic, lathe("tub", prof, 48), mat4(0, 0, 0, 0, 0, 0, w / 2, h, d / 2));
  const fx = -w / 2 - 0.12;
  k.cyl(m.metal, fx, 0.45, 0, 0.018, 0.9, 12);
  k.box(m.metal, fx + 0.08, 0.88, 0, 0.18, 0.022, 0.022);
}

function towelRail(b: ItemBuild): void {
  const { k, w, m } = b;
  for (const y of [0.0, 0.16]) k.cyl(m.steel, 0, 0.3 + y, 0.06, 0.009, w, 12, 0, 0, PI / 2);
  for (const s of [-1, 1]) k.box(m.steel, s * (w / 2 - 0.02), 0.38, 0.03, 0.02, 0.24, 0.06);
  cushion(k, m.accent2, -w * 0.1, 0.2, 0.06, w * 0.5, 0.42, 0.035, 0.012);
}

// ── Pakistani home details ────────────────────────────────────────────────────────────────────────────
function ceilingFan(b: ItemBuild): void {
  const { k, m } = b;
  const ceil = b.extra.ceiling ?? 3;
  const body = b.variant.includes("brown") || b.variant.includes("wood") ? m.M.get({ preset: "lacquer", color: "#5a3f2c" }) : m.main;
  const rod = clamp(ceil - 2.75, 0.18, 0.75);
  const y = ceil - rod - 0.06;
  k.cyl(body, 0, ceil - 0.035, 0, 0.075, 0.07, 24);
  k.cyl(m.steel, 0, ceil - 0.07 - rod / 2, 0, 0.012, rod, 10);
  k.geo(body, lathe("fanmotor", [[0, 0], [0.06, 0], [0.11, 0.03], [0.12, 0.07], [0.1, 0.11], [0.04, 0.13], [0, 0.13]], 32), mat4(0, y - 0.1, 0));
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * PI * 2;
    const P = mat4(0, y - 0.06, 0, 0, a, 0);
    k.geo(m.steel, unitBox(), P.clone().multiply(mat4(0.16, 0, 0, 0, 0, 0, 0.13, 0.012, 0.03)));
    k.geo(body, roundedBoxFor(0.58, 0.008, 0.115, 0.004, 1), P.clone().multiply(mat4(0.5, -0.004, 0, 0.14, 0, 0)));
  }
}

function acSplit(b: ItemBuild): void {
  const { k, m } = b;
  const W = 0.96, H = 0.3, D = 0.23;
  k.rbox(m.plastic, 0, H / 2, D / 2, W, H, D, 0.04, 3);
  k.rbox(m.plastic, 0, H * 0.58, D - 0.004, W - 0.02, H * 0.72, 0.02, 0.012, 2);
  k.box(m.dark, 0, 0.045, D * 0.7, W - 0.12, 0.03, D * 0.5);
  k.box(m.M.basic("#cfd2d4", { roughness: 0.5 }), 0, 0.03, D * 0.92, W - 0.16, 0.012, 0.04);
  k.box(m.M.emissive("#8fd6ff", 2), W * 0.32, H * 0.42, D + 0.008, 0.05, 0.012, 0.002);
}

export function acOutdoor(k: Kit, m: ItemBuild["m"]): void {
  const W = 0.8, H = 0.55, D = 0.3;
  const grey = m.M.get({ preset: "plastic", color: "#d9d9d5" });
  k.rbox(grey, 0, H / 2, D / 2, W, H, D, 0.015, 2);
  k.cyl(m.dark, -0.1, H / 2, D + 0.002, 0.2, 0.01, 32, PI / 2);
  k.geo(m.M.basic("#3a3b3d", { roughness: 0.6 }), torus(0.2, 0.012, 32, 6), mat4(-0.1, H / 2, D + 0.006));
  for (let i = 0; i < 4; i++) k.geo(m.M.basic("#3a3b3d", { roughness: 0.6 }), unitBox(), mat4(-0.1, H / 2, D + 0.008, 0, 0, (i * PI) / 4, 0.4, 0.01, 0.004));
  for (const s of [-1, 1]) k.box(m.metal, s * 0.3, -0.04, D / 2 + 0.05, 0.04, 0.04, D + 0.1);
}

function waterDispenser(b: ItemBuild): void {
  const { k, m } = b;
  k.rbox(m.plastic, 0, 0.5, 0, 0.32, 1.0, 0.32, 0.03, 2);
  k.box(m.dark, 0, 0.72, 0.15, 0.22, 0.2, 0.04);
  k.box(m.M.basic("#c8352e", { roughness: 0.4 }), -0.05, 0.8, 0.17, 0.03, 0.04, 0.04);
  k.box(m.M.basic("#2f6db5", { roughness: 0.4 }), 0.05, 0.8, 0.17, 0.03, 0.04, 0.04);
  k.box(m.steel, 0, 0.63, 0.17, 0.2, 0.012, 0.08);
  const bottle = waterMat(m);
  k.geo(bottle, lathe("bottle", [[0, 0], [0.03, 0], [0.03, 0.06], [0.12, 0.12], [0.135, 0.2], [0.135, 0.42], [0.12, 0.47], [0, 0.48]], 32), mat4(0, 1.0, 0));
}

function waterMat(m: ItemBuild["m"]): THREE.Material {
  const cache = m.M as unknown as { _water?: THREE.Material };
  if (!cache._water) {
    cache._water = new THREE.MeshPhysicalMaterial({ color: new THREE.Color("#6aa8d8"), roughness: 0.15, metalness: 0, transparent: true, opacity: 0.6, clearcoat: 1 });
    m.M.created.push(cache._water);
  }
  return cache._water;
}

function washingMachine(b: ItemBuild): void {
  const { k, m } = b;
  k.rbox(m.plastic, 0, 0.43, 0, 0.6, 0.86, 0.58, 0.02, 2);
  k.box(m.M.basic("#d8dadc", { roughness: 0.4 }), 0, 0.8, 0.29, 0.58, 0.1, 0.006);
  k.box(m.steel, -0.2, 0.8, 0.292, 0.12, 0.05, 0.006);
  k.cyl(m.steel, 0.18, 0.8, 0.295, 0.025, 0.015, 16, PI / 2);
  k.geo(m.steel, torus(0.19, 0.025, 40, 8), mat4(0, 0.42, 0.3));
  k.cyl(m.screen, 0, 0.42, 0.296, 0.17, 0.008, 36, PI / 2);
}

// ── vehicles ──────────────────────────────────────────────────────────────────────────────────────────
function car(b: ItemBuild, suv: boolean): void {
  const { k, w, d, m } = b;
  const L = d, W = w;
  const paint = m.main;
  const glass = m.M.basic("#151b20", { roughness: 0.04, metalness: 0.35 });
  const trim = m.M.basic("#111214", { roughness: 0.6 });
  const chrome = m.steel;
  const rw = suv ? 0.37 : 0.32;
  const clr = suv ? 0.3 : 0.17;
  const belt = suv ? 1.06 : 0.86;
  const roof = suv ? 1.8 : 1.42;
  const zf = L / 2 - (suv ? 0.88 : 0.86), zr = -L / 2 + (suv ? 0.95 : 0.95);
  const ar = rw + 0.06;
  const s = new THREE.Shape();
  s.moveTo(-L / 2 + 0.05, clr + 0.02);
  s.lineTo(-L / 2, clr + 0.15);
  s.lineTo(-L / 2 - 0.01, belt - 0.25);
  s.quadraticCurveTo(-L / 2, belt - 0.02, -L / 2 + 0.08, belt);
  s.lineTo(L / 2 - (suv ? 1.45 : 1.55), belt + 0.02);
  s.quadraticCurveTo(L / 2 - 0.5, belt - 0.02, L / 2 - 0.12, belt - (suv ? 0.12 : 0.14));
  s.quadraticCurveTo(L / 2 + 0.02, belt - 0.2, L / 2 + 0.01, belt - 0.42);
  s.lineTo(L / 2 - 0.04, clr + 0.04);
  s.lineTo(zf + ar, clr);
  s.absarc(zf, rw, ar, -Math.asin(Math.min(0.99, (rw - clr) / ar)), PI + Math.asin(Math.min(0.99, (rw - clr) / ar)), false);
  s.lineTo(zr + ar, clr);
  s.absarc(zr, rw, ar, -Math.asin(Math.min(0.99, (rw - clr) / ar)), PI + Math.asin(Math.min(0.99, (rw - clr) / ar)), false);
  s.lineTo(-L / 2 + 0.05, clr + 0.02);
  const body = carExtrude(`body|${suv}|${L.toFixed(2)}|${W.toFixed(2)}`, s, W - 0.08, 0.04);
  k.geo(paint, body, carBase(W - 0.08));
  // greenhouse
  const g = new THREE.Shape();
  const r0 = -L / 2 + (suv ? 0.18 : 0.42);
  g.moveTo(r0, belt - 0.01);
  g.lineTo(r0 + (suv ? 0.1 : 0.45), roof - 0.04);
  g.quadraticCurveTo(r0 + (suv ? 0.14 : 0.55), roof, r0 + (suv ? 0.3 : 0.75), roof);
  g.lineTo(L / 2 - (suv ? 2.1 : 2.15), roof);
  g.quadraticCurveTo(L / 2 - (suv ? 1.95 : 2.0), roof - 0.01, L / 2 - (suv ? 1.85 : 1.9), roof - 0.06);
  g.lineTo(L / 2 - (suv ? 1.42 : 1.5), belt + 0.02);
  g.lineTo(r0, belt - 0.01);
  const cab = carExtrude(`cab|${suv}|${L.toFixed(2)}|${W.toFixed(2)}`, g, W - 0.26, 0.03);
  k.geo(glass, cab, carBase(W - 0.26));
  // roof skin + pillars in body colour
  const roofLen = L / 2 - (suv ? 2.1 : 2.15) - (r0 + (suv ? 0.3 : 0.75));
  k.rbox(paint, 0, roof + 0.012, (r0 + (suv ? 0.3 : 0.75) + L / 2 - (suv ? 2.1 : 2.15)) / 2, W - 0.24, 0.04, roofLen + 0.1, 0.02, 2);
  const bz = (r0 + L / 2 - (suv ? 1.42 : 1.5)) / 2 - (suv ? 0.05 : 0.1);
  for (const sx of [-1, 1]) {
    k.box(paint, sx * (W / 2 - 0.135), (belt + roof) / 2, bz, 0.03, roof - belt, 0.1);
    k.box(paint, sx * (W / 2 - 0.135), (belt + roof) / 2 - 0.02, r0 + (suv ? 0.2 : 0.55), 0.03, roof - belt - 0.06, 0.18);
    // mirrors + handles + door gaps
    k.rbox(paint, sx * (W / 2 + 0.02), belt + 0.08, L / 2 - (suv ? 1.5 : 1.6), 0.14, 0.09, 0.12, 0.02, 2);
    for (const hz of [bz + 0.45, bz - 0.55]) k.box(chrome, sx * (W / 2 - 0.035), belt - 0.08, hz, 0.012, 0.025, 0.14);
    for (const gz of [bz + 0.04, bz - 0.98, bz + 1.0]) k.box(trim, sx * (W / 2 - 0.038), (clr + 0.15 + belt) / 2, gz, 0.004, belt - clr - 0.2, 0.006);
  }
  // wheels
  const tire = lathe("tire", [[0.62, -0.5], [0.94, -0.5], [1, -0.32], [1.02, 0], [1, 0.32], [0.94, 0.5], [0.62, 0.5]], 36);
  for (const [zz, sx] of [[zf, 1], [zf, -1], [zr, 1], [zr, -1]] as const) {
    const x = sx * (W / 2 - 0.13);
    k.geo(m.rubber, tire, mat4(x, rw, zz, 0, 0, PI / 2, rw, 0.25, rw));
    k.cyl(chrome, x + sx * 0.06, rw, zz, rw * 0.62, 0.05, 28, 0, 0, PI / 2);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * PI * 2;
      k.geo(trim, unitBox(), mat4(x + sx * 0.09, rw + Math.sin(a) * rw * 0.33, zz + Math.cos(a) * rw * 0.33, a, 0, 0, 0.02, rw * 0.5, 0.06));
    }
    k.cyl(trim, x + sx * 0.095, rw, zz, 0.05, 0.02, 16, 0, 0, PI / 2);
  }
  // underbody, bumpers, grille, lights, plates
  k.box(trim, 0, clr + 0.08, (zf + zr) / 2, W - 0.4, 0.16, zf - zr - ar * 2);
  k.box(trim, 0, clr + 0.08, L / 2 - 0.05, W - 0.3, 0.12, 0.1);
  k.box(trim, 0, clr + 0.1, -L / 2 + 0.03, W - 0.3, 0.12, 0.1);
  k.rbox(trim, 0, belt - 0.32, L / 2 + 0.005, W * 0.52, suv ? 0.28 : 0.16, 0.04, 0.02, 2);
  for (let i = 0; i < 3; i++) k.box(chrome, 0, belt - 0.4 + i * 0.08, L / 2 + 0.03, W * 0.48, 0.012, 0.012);
  const head = m.M.emissive("#fff6e6", 1.2);
  const tail = m.M.basic("#7a0d10", { roughness: 0.25, emissive: "#ff2a1a", emissiveIntensity: 1.1 });
  for (const sx of [-1, 1]) {
    k.geo(head, unitBox(), mat4(sx * (W / 2 - 0.22), belt - 0.17, L / 2 - 0.02, 0, sx * 0.18, 0, 0.34, 0.07, 0.05));
    k.geo(tail, unitBox(), mat4(sx * (W / 2 - 0.2), belt - 0.12, -L / 2 + 0.0, 0, -sx * 0.2, 0, 0.3, 0.08, 0.05));
  }
  if (suv) k.box(tail, 0, belt - 0.1, -L / 2 - 0.004, W * 0.42, 0.025, 0.02);
  for (const [zz, rot] of [[L / 2 + 0.035, 0], [-L / 2 - 0.02, PI]] as const) k.geo(m.M.basic("#f4f4ef", { roughness: 0.4 }), unitBox(), mat4(0, clr + 0.32, zz, 0, rot, 0, 0.52, 0.11, 0.01));
}

function carBase(width: number): THREE.Matrix4 {
  // shape space: x = car length (z), y = height; extrusion along shape z → car x
  const m = new THREE.Matrix4().makeRotationY(-PI / 2);
  m.premultiply(new THREE.Matrix4().makeTranslation(width / 2, 0, 0));
  return m;
}

const extrudeCache = new Map<string, THREE.BufferGeometry>();
function carExtrude(key: string, shape: THREE.Shape, depth: number, bevel: number): THREE.BufferGeometry {
  let g = extrudeCache.get(key);
  if (!g) {
    g = new THREE.ExtrudeGeometry(shape, { depth: depth - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 14 });
    g.translate(0, 0, bevel);
    g.deleteAttribute("uv");
    g.computeVertexNormals();
    extrudeCache.set(key, g);
  }
  return g;
}

function motorbike(b: ItemBuild): void {
  const { k, m } = b;
  const red = m.M.get({ preset: "lacquer", color: b.colorHex });
  const tireR = 0.3;
  const zf = 0.62, zr = -0.62;
  for (const z of [zf, zr]) {
    k.geo(m.rubber, torus(tireR - 0.035, 0.035, 36, 10), mat4(0, tireR, z, 0, PI / 2, 0));
    k.geo(m.steel, torus(tireR - 0.075, 0.008, 36, 6), mat4(0, tireR, z, 0, PI / 2, 0));
    k.cyl(m.steel, 0, tireR, z, 0.05, 0.1, 12, 0, 0, PI / 2);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * PI * 2;
      stick(k, m.steel, V(0, tireR, z), V(0, tireR + Math.sin(a) * (tireR - 0.08), z + Math.cos(a) * (tireR - 0.08)), 0.0025, 4);
    }
  }
  k.geo(red, unitBox(), mat4(0, 0.72, 0.22, 0.15, 0, 0, 0.24, 0.16, 0.4));
  k.rbox(m.dark, 0, 0.74, -0.25, 0.22, 0.07, 0.6, 0.03, 2);
  k.box(m.dark, 0, 0.42, 0.02, 0.22, 0.24, 0.34);
  stick(k, m.steel, V(0, 0.95, 0.5), V(0, tireR, zf), 0.02);
  k.cyl(m.steel, 0, 0.98, 0.5, 0.012, 0.66, 10, 0, 0, PI / 2);
  k.cyl(m.steel, 0, 0.88, 0.62, 0.07, 0.08, 16, PI / 2);
  k.cyl(m.M.emissive("#fff3d6", 1), 0, 0.88, 0.665, 0.06, 0.005, 16, PI / 2);
  k.cyl(m.steel, 0.14, 0.32, -0.25, 0.035, 0.75, 12, PI / 2 - 0.1);
  k.geo(red, unitBox(), mat4(0, 0.5, -0.62, 0, 0, 0, 0.14, 0.04, 0.4));
  k.box(m.M.basic("#7a0d10", { emissive: "#ff2a1a", emissiveIntensity: 0.8 }), 0, 0.62, -0.88, 0.1, 0.05, 0.03);
  for (const s of [-1, 1]) stick(k, m.steel, V(s * 0.08, 0.05, -0.1), V(s * 0.08, 0.36, -0.02), 0.012);
}

// ── outdoor ───────────────────────────────────────────────────────────────────────────────────────────
function outdoorChair(b: ItemBuild): void {
  const { k, w, d, m } = b;
  const teak = m.M.get("wood_teak");
  for (const s of [-1, 1]) {
    k.box(m.metal, s * (w / 2 - 0.03), 0.3, 0, 0.03, 0.03, d - 0.05);
    k.box(m.metal, s * (w / 2 - 0.03), 0.15, d / 2 - 0.05, 0.03, 0.3, 0.03);
    k.box(m.metal, s * (w / 2 - 0.03), 0.3, -d / 2 + 0.06, 0.03, 0.6, 0.03);
    k.box(teak, s * (w / 2 - 0.03), 0.58, 0.02, 0.07, 0.025, d - 0.12);
    k.box(m.metal, s * (w / 2 - 0.03), 0.44, d / 2 - 0.08, 0.03, 0.28, 0.03);
  }
  cushion(k, m.linen, 0, 0.36, 0.04, w - 0.1, 0.1, d - 0.14, 0.04);
  cushion(k, m.linen, 0, 0.6, -d / 2 + 0.12, w - 0.12, 0.42, 0.12, 0.04, -0.25);
  cushion(k, m.accent, 0.04, 0.55, -d / 2 + 0.24, 0.36, 0.32, 0.1, 0.04, -0.3);
}

function outdoorTable(b: ItemBuild): void {
  const { k, w, h, m } = b;
  const top = b.variant.includes("low") ? 0.45 : Math.min(h, 0.74);
  k.cyl(m.M.get("wood_teak"), 0, top - 0.02, 0, w / 2, 0.04, 40);
  k.cyl(m.metal, 0, (top - 0.04) / 2, 0, 0.03, top - 0.04, 12);
  k.cyl(m.metal, 0, 0.012, 0, w * 0.22, 0.024, 28);
  vase(k, m.stone, 0, top, 0, 0.16, 2);
}

function swing(b: ItemBuild): void {
  const { k, w, d, h, m } = b;
  const teak = m.M.get("wood_teak");
  for (const s of [-1, 1]) {
    const x = s * (w / 2 - 0.05);
    stick(k, m.metal, V(x, 0, -d / 2 + 0.05), V(x, h - 0.05, 0), 0.03);
    stick(k, m.metal, V(x, 0, d / 2 - 0.05), V(x, h - 0.05, 0), 0.03);
  }
  k.cyl(m.metal, 0, h - 0.05, 0, 0.035, w, 14, 0, 0, PI / 2);
  const sw = w * 0.62, sy = 0.45;
  for (let i = 0; i < 6; i++) k.box(teak, 0, sy, -0.22 + i * 0.09, sw, 0.03, 0.075);
  for (let i = 0; i < 5; i++) k.geo(teak, unitBox(), mat4(0, sy + 0.12 + i * 0.085, -0.3, -0.25, 0, 0, sw, 0.065, 0.025));
  for (const s of [-1, 1]) {
    k.box(m.metal, s * (sw / 2), sy + 0.15, 0, 0.03, 0.3, 0.5);
    for (const z of [-0.24, 0.24]) k.cyl(m.steel, s * (sw / 2 - 0.02), (sy + h) / 2, z * 0.5, 0.006, h - sy - 0.05, 6);
  }
  cushion(k, m.linen, 0, sy + 0.06, -0.02, sw - 0.06, 0.08, 0.5, 0.035);
  cushion(k, m.accent, -sw / 4, sy + 0.25, -0.2, 0.4, 0.38, 0.12, 0.05, -0.3);
}

// ── registry ─────────────────────────────────────────────────────────────────────────────────────────
export const ITEMS: Record<FurnitureType, ItemDef> = {
  bed_king: { dims: [6.8, 7.2, 3.9], cls: "floor", collide: true, build: bed },
  bed_queen: { dims: [5.6, 7.0, 3.6], cls: "floor", collide: true, build: bed },
  bed_single: { dims: [3.6, 6.9, 3.2], cls: "floor", collide: true, build: bed },
  side_table: { dims: [1.7, 1.4, 1.8], cls: "floor", build: sideTable },
  wardrobe: { dims: [6, 2, 7.6], cls: "floor", collide: true, build: wardrobe },
  dresser: { dims: [4.6, 1.6, 2.7], cls: "floor", collide: true, build: dresser },
  dressing_table: { dims: [3.4, 1.5, 2.5], cls: "floor", build: dressingTable },
  study_desk: { dims: [4, 2, 2.5], cls: "floor", collide: true, build: studyDesk },
  desk_chair: { dims: [2, 2, 3.2], cls: "floor", build: deskChair },
  bookshelf: { dims: [3, 1.1, 6.6], cls: "floor", collide: true, build: bookshelf },
  sofa_3: { dims: [7.4, 3.1, 2.7], cls: "floor", collide: true, build: (b) => sofa(b, 3) },
  sofa_2: { dims: [5.4, 3.1, 2.7], cls: "floor", collide: true, build: (b) => sofa(b, 2) },
  sofa_l: { dims: [9, 6.4, 2.7], cls: "floor", collide: true, build: (b) => sofa(b, 3, true) },
  armchair: { dims: [2.7, 2.8, 2.6], cls: "floor", collide: true, build: armchair },
  ottoman: { dims: [1.9, 1.9, 1.4], cls: "floor", build: ottoman },
  coffee_table: { dims: [4, 2.2, 1.3], cls: "floor", build: coffeeTable },
  console_table: { dims: [4, 1.2, 2.6], cls: "floor", build: consoleTable },
  tv_unit: { dims: [6, 1.5, 1.5], cls: "floor", collide: true, build: tvUnit },
  tv: { dims: [4.0, 0.2, 2.3], cls: "wall", mount: 3.3, build: tv },
  rug: { dims: [8, 5.5, 0.04], cls: "rug", build: (b) => rug(b, b.variant.includes("classic") || b.style === "traditional" ? "classic" : "modern") },
  floor_lamp: { dims: [1.4, 1.4, 5.6], cls: "floor", build: floorLamp },
  table_lamp: { dims: [1, 1, 1.8], cls: "top", build: tableLamp },
  pendant: { dims: [1.6, 1.6, 2.2], cls: "ceiling", build: pendant },
  chandelier: { dims: [3, 3, 2.6], cls: "ceiling", build: chandelier },
  curtains: { dims: [6, 0.5, 9], cls: "wall", mount: 0, build: curtains },
  plant_floor: { dims: [1.8, 1.8, 4.8], cls: "floor", build: plantFloor },
  plant_small: { dims: [0.8, 0.8, 1.2], cls: "top", build: plantSmall },
  painting: { dims: [3, 0.12, 2.2], cls: "wall", mount: 4, build: painting },
  mirror_wall: { dims: [2.4, 0.1, 3.2], cls: "wall", mount: 3.6, build: mirrorWall },
  dining_table_4: { dims: [4, 3, 2.5], cls: "floor", collide: true, build: (b) => diningTable(b, 4) },
  dining_table_6: { dims: [6, 3.3, 2.5], cls: "floor", collide: true, build: (b) => diningTable(b, 6) },
  dining_table_8: { dims: [8, 3.5, 2.5], cls: "floor", collide: true, build: (b) => diningTable(b, 8) },
  dining_chair: { dims: [1.6, 1.8, 3.1], cls: "floor", build: diningChair },
  sideboard: { dims: [6, 1.5, 2.6], cls: "floor", collide: true, build: sideboard },
  kitchen_counter: { dims: [8, 2, 7.2], cls: "floor", collide: true, build: kitchenCounter },
  kitchen_island: { dims: [6, 3, 3], cls: "floor", collide: true, build: kitchenIsland },
  fridge: { dims: [3, 2.4, 6], cls: "floor", collide: true, build: fridge },
  hob: { dims: [2, 1.8, 2.95], cls: "top", build: hob },
  oven: { dims: [2, 2, 2.95], cls: "floor", collide: true, build: rangeCooker },
  sink_kitchen: { dims: [3, 2, 2.95], cls: "top", build: sinkKitchen },
  microwave: { dims: [1.7, 1.3, 1.0], cls: "top", build: microwave },
  wc: { dims: [1.3, 2.3, 2.7], cls: "floor", build: wc },
  vanity: { dims: [3, 1.7, 6.6], cls: "floor", build: vanity },
  shower: { dims: [3, 3, 7.2], cls: "floor", build: shower },
  bathtub: { dims: [5.5, 2.6, 1.9], cls: "floor", collide: true, build: bathtub },
  towel_rail: { dims: [2, 0.4, 2.2], cls: "wall", mount: 3.2, build: towelRail },
  ceiling_fan: { dims: [4.6, 4.6, 1.4], cls: "ceiling", build: ceilingFan },
  ac_split: { dims: [3.15, 0.8, 1.0], cls: "wall", mount: 6.9, build: acSplit },
  water_dispenser: { dims: [1.1, 1.1, 4.8], cls: "floor", build: waterDispenser },
  prayer_mat: { dims: [2.3, 4, 0.03], cls: "rug", build: (b) => rug(b, "prayer") },
  washing_machine: { dims: [2, 2, 2.85], cls: "floor", collide: true, build: washingMachine },
  car_sedan: { dims: [5.85, 15.1, 4.8], cls: "floor", collide: true, build: (b) => car(b, false) },
  car_suv: { dims: [6.1, 15.8, 6.0], cls: "floor", collide: true, build: (b) => car(b, true) },
  motorbike: { dims: [2.3, 6.3, 3.5], cls: "floor", build: motorbike },
  outdoor_chair: { dims: [2.3, 2.5, 2.6], cls: "floor", build: outdoorChair },
  outdoor_table: { dims: [2.6, 2.6, 2.4], cls: "floor", build: outdoorTable },
  swing: { dims: [6.5, 4.5, 6.8], cls: "floor", collide: true, build: swing },
};
