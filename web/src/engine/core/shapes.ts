/** Cached base geometries + helpers to append transformed parts into MeshBuilders (meters). */
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { MeshBuilder } from "./meshbuilder";

const cache = new Map<string, THREE.BufferGeometry>();
function cached(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = cache.get(key);
  if (!g) {
    g = make();
    cache.set(key, g);
  }
  return g;
}

export const unitBox = (): THREE.BufferGeometry => cached("box", () => new THREE.BoxGeometry(1, 1, 1));
export const unitCyl = (seg = 24): THREE.BufferGeometry => cached(`cyl${seg}`, () => new THREE.CylinderGeometry(0.5, 0.5, 1, seg, 1));
export const unitSphere = (seg = 20): THREE.BufferGeometry => cached(`sph${seg}`, () => new THREE.SphereGeometry(0.5, seg, Math.max(8, seg >> 1)));
export function roundedBox(w: number, h: number, d: number, r: number, seg = 3): THREE.BufferGeometry {
  const q = (n: number) => Math.round(n * 1000) / 1000;
  const rr = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4);
  return cached(`rb|${q(w)}|${q(h)}|${q(d)}|${q(rr)}|${seg}`, () => new RoundedBoxGeometry(w, h, d, seg, Math.max(1e-4, rr)));
}
export function torus(R: number, r: number, seg = 32, tube = 10, arc = Math.PI * 2): THREE.BufferGeometry {
  const q = (n: number) => Math.round(n * 1000) / 1000;
  return cached(`tor|${q(R)}|${q(r)}|${seg}|${tube}|${q(arc)}`, () => new THREE.TorusGeometry(R, r, tube, seg, arc));
}
export function lathe(key: string, pts: [number, number][], seg = 32): THREE.BufferGeometry {
  return cached(`lathe|${key}|${seg}`, () => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg));
}
export function cone(rTop: number, rBot: number, h: number, seg = 24, open = false): THREE.BufferGeometry {
  const q = (n: number) => Math.round(n * 1000) / 1000;
  return cached(`cone|${q(rTop)}|${q(rBot)}|${q(h)}|${seg}|${open}`, () => new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, open));
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

/** Compose a matrix from position, euler rotation (radians, XYZ) and scale. */
export function mat4(px: number, py: number, pz: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): THREE.Matrix4 {
  _e.set(rx, ry, rz, "YXZ");
  _q.setFromEuler(_e);
  _p.set(px, py, pz);
  _s.set(sx, sy, sz);
  return new THREE.Matrix4().compose(_p, _q, _s);
}

/** Append a scaled/rotated unit box (center cx,cy,cz; size sx,sy,sz; yaw ry) to mb, optionally pre-multiplied by `parent`. */
export function boxTo(mb: MeshBuilder, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, ry = 0, parent?: THREE.Matrix4, rx = 0, rz = 0): void {
  if (sx <= 0 || sy <= 0 || sz <= 0) return;
  if (!parent && ry === 0 && rx === 0 && rz === 0) {
    mb.box(cx - sx / 2, cy - sy / 2, cz - sz / 2, cx + sx / 2, cy + sy / 2, cz + sz / 2);
    return;
  }
  const m = mat4(cx, cy, cz, rx, ry, rz, sx, sy, sz);
  if (parent) m.premultiply(parent);
  mb.addGeometry(unitBox(), m);
}

/** Append any geometry with a transform. */
export function geoTo(mb: MeshBuilder, g: THREE.BufferGeometry, m: THREE.Matrix4, uv: "box" | "native" = "box"): void {
  mb.addGeometry(g, m, uv);
}

/** Builds one merged mesh per material. */
export class Kit {
  private parts = new Map<THREE.Material, MeshBuilder>();
  private flags = new Map<THREE.Material, { cast: boolean; uv?: "native" }>();
  mb(mat: THREE.Material, cast = true): MeshBuilder {
    let b = this.parts.get(mat);
    if (!b) {
      b = new MeshBuilder();
      b.grainAuto = !!mat.userData.grain;
      this.parts.set(mat, b);
      this.flags.set(mat, { cast });
    }
    return b;
  }
  box(mat: THREE.Material, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, ry = 0, parent?: THREE.Matrix4): void {
    boxTo(this.mb(mat), cx, cy, cz, sx, sy, sz, ry, parent);
  }
  rbox(mat: THREE.Material, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, r: number, seg = 2, rx = 0, ry = 0, rz = 0, parent?: THREE.Matrix4): void {
    if (sx <= 0 || sy <= 0 || sz <= 0) return;
    const m = mat4(cx, cy, cz, rx, ry, rz);
    if (parent) m.premultiply(parent);
    this.mb(mat).addGeometry(roundedBox(sx, sy, sz, r, seg), m);
  }
  cyl(mat: THREE.Material, cx: number, cy: number, cz: number, r: number, h: number, seg = 20, rx = 0, ry = 0, rz = 0, parent?: THREE.Matrix4): void {
    if (r <= 0 || h <= 0) return;
    const m = mat4(cx, cy, cz, rx, ry, rz, r * 2, h, r * 2);
    if (parent) m.premultiply(parent);
    this.mb(mat).addGeometry(unitCyl(seg), m);
  }
  sphere(mat: THREE.Material, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, seg = 16, parent?: THREE.Matrix4): void {
    const m = mat4(cx, cy, cz, 0, 0, 0, sx, sy, sz);
    if (parent) m.premultiply(parent);
    this.mb(mat).addGeometry(unitSphere(seg), m);
  }
  geo(mat: THREE.Material, g: THREE.BufferGeometry, m: THREE.Matrix4, uv: "box" | "native" = "box"): void {
    this.mb(mat).addGeometry(g, m, uv);
  }
  noShadow(mat: THREE.Material): void {
    const f = this.flags.get(mat);
    if (f) f.cast = false;
  }
  get empty(): boolean {
    for (const b of this.parts.values()) if (!b.empty) return false;
    return true;
  }
  /** Build meshes into a group. */
  build(group = new THREE.Group(), shadows = true): THREE.Group {
    for (const [mat, b] of this.parts) {
      const g = b.build();
      if (!g) continue;
      const mesh = new THREE.Mesh(g, mat);
      const transparent = (mat as THREE.MeshStandardMaterial).transparent || (mat as THREE.MeshPhysicalMaterial).transmission > 0;
      mesh.castShadow = shadows && (this.flags.get(mat)?.cast ?? true) && !transparent;
      mesh.receiveShadow = !transparent || true;
      group.add(mesh);
    }
    return group;
  }
}
