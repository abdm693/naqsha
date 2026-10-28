/** Railings/balustrades (glass, metal bars, solid) along straight or sloped lines, plus a parallelepiped helper. */
import * as THREE from "three";
import { MeshBuilder } from "../core/meshbuilder";
import { Kit, unitBox, unitCyl } from "../core/shapes";
import { FT } from "../core/util";

export type RailType = "glass" | "metal_bars" | "solid";

export interface RailMats {
  glass: THREE.Material;
  metal: THREE.Material;
  rail: THREE.Material;
  solid: THREE.Material;
  coping: THREE.Material;
}

const _m = new THREE.Matrix4();
/** Parallelepiped with corner o (meters) and edge vectors a, b, c (meters). */
export function skewBox(mb: MeshBuilder, o: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): void {
  _m.makeBasis(a, b, c);
  _m.setPosition(o.x + (a.x + b.x + c.x) / 2, o.y + (a.y + b.y + c.y) / 2, o.z + (a.z + b.z + c.z) / 2);
  if (Math.abs(_m.determinant()) < 1e-12) return;
  mb.addGeometry(unitBox(), _m.clone());
}

/** Plan point (ft) + height (ft) → world meters. */
export const P3 = (x: number, y: number, h: number) => new THREE.Vector3(x * FT, h * FT, y * FT);

/**
 * Railing from (x0,y0,h0) to (x1,y1,h1) (plan ft; h = base line height) of height H ft.
 * For sloped stair rails, h0 != h1 and posts stay vertical.
 */
export function railing(kit: Kit, glassKit: Kit, type: RailType, x0: number, y0: number, h0: number, x1: number, y1: number, h1: number, H: number, m: RailMats, opts: { shoe?: boolean; handrailWood?: boolean } = {}): void {
  const len = Math.hypot(x1 - x0, y1 - y0);
  if (len < 0.2) return;
  const dx = (x1 - x0) / len, dy = (y1 - y0) / len;
  const nx = -dy, ny = dx; // horizontal normal
  const A = (k: number) => P3(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k, h0 + (h1 - h0) * k);
  const along = P3(x1 - x0, y1 - y0, h1 - h0).sub(P3(0, 0, 0));
  const up = (h: number) => new THREE.Vector3(0, h * FT, 0);
  const side = (w: number) => new THREE.Vector3(nx * w * FT, 0, ny * w * FT);
  const handMat = opts.handrailWood ? m.rail : m.metal;
  if (type === "glass") {
    if (opts.shoe !== false) {
      // base shoe channel
      skewBox(kit.mb(m.metal), A(0).add(side(-0.09)), along, up(0.3), side(0.18));
    }
    const n = Math.max(1, Math.ceil(len / 4.6));
    const gap = 0.05;
    for (let k = 0; k < n; k++) {
      const k0 = k / n + (k ? gap / 2 / len : 0), k1 = (k + 1) / n - (k < n - 1 ? gap / 2 / len : 0);
      const o = A(k0).add(up(0.12)).add(side(-0.02));
      const a = along.clone().multiplyScalar(k1 - k0);
      skewBox(glassKit.mb(m.glass, false), o, a, up(H - 0.2), side(0.04));
    }
    // slim top cap
    skewBox(kit.mb(handMat), A(0).add(up(H - 0.08)).add(side(-0.06)), along, up(0.09), side(0.12));
    return;
  }
  if (type === "metal_bars") {
    skewBox(kit.mb(handMat), A(0).add(up(H - 0.1)).add(side(-0.08)), along, up(0.1), side(0.16));
    skewBox(kit.mb(m.metal), A(0).add(up(0.28)).add(side(-0.04)), along, up(0.07), side(0.08));
    // balusters at no more than 4 in clear (IBC 1015.4: a 4 in sphere must not pass)
    const n = Math.max(2, Math.ceil(len / 0.32));
    for (let k = 0; k <= n; k++) {
      const p = A(k / n).add(up(0.28));
      const mm = new THREE.Matrix4().makeTranslation(p.x, p.y + ((H - 0.38) * FT) / 2, p.z).multiply(new THREE.Matrix4().makeScale(0.016, (H - 0.38) * FT, 0.016));
      kit.mb(m.metal).addGeometry(unitBox(), mm);
    }
    // end posts
    for (const k of [0, 1]) {
      const p = A(k);
      const mm = new THREE.Matrix4().makeTranslation(p.x, p.y + (H * FT) / 2, p.z).multiply(new THREE.Matrix4().makeScale(0.045, H * FT, 0.045));
      kit.mb(m.metal).addGeometry(unitBox(), mm);
    }
    return;
  }
  // solid parapet / balustrade wall with coping
  skewBox(kit.mb(m.solid), A(0).add(side(-0.17)), along, up(H - 0.1), side(0.34));
  skewBox(kit.mb(m.coping), A(0).add(up(H - 0.1)).add(side(-0.22)), along, up(0.12), side(0.44));
}

/** Round handrail (wood or metal) along a sloped line, offset from a wall. */
export function handrail(kit: Kit, mat: THREE.Material, x0: number, y0: number, h0: number, x1: number, y1: number, h1: number): void {
  const a = P3(x0, y0, h0), b = P3(x1, y1, h1);
  const d = b.clone().sub(a);
  const L = d.length();
  if (L < 0.05) return;
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  const mm = new THREE.Matrix4().compose(mid, q, new THREE.Vector3(0.045, L, 0.045));
  kit.mb(mat).addGeometry(unitCyl(12), mm);
}
