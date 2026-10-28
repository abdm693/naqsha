/**
 * MeshBuilder: accumulates triangles (positions/normals/uvs/indices) in METERS. UVs are box-projected in
 * meters, so materials tile at true physical scale (a material's texture covers `size_m` meters).
 */
import * as THREE from "three";

export interface BoxMask {
  px?: boolean; nx?: boolean; py?: boolean; ny?: boolean; pz?: boolean; nz?: boolean;
}

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _nm = new THREE.Matrix3();
const _bb = new THREE.Box3();

export class MeshBuilder {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  idx: number[] = [];
  /** Rotate top/bottom face UVs 90° (e.g. run floor planks along z). */
  swapTopUV = false;
  /**
   * Wood joinery: for each box()/addGeometry() part, run texture u (the grain) along the longer in-plane side of
   * every face, so door leaves, fins and boards get vertical grain and table tops get it along their length.
   */
  grainAuto = false;
  private ext: [number, number, number] | null = null;

  get vertexCount(): number {
    return this.pos.length / 3;
  }
  get empty(): boolean {
    return this.idx.length === 0;
  }

  private pushUV(x: number, y: number, z: number, nx: number, ny: number, nz: number): void {
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    const e = this.ext;
    if (e) {
      let u: number, v: number;
      if (ax >= ay && ax >= az) {
        if (e[1] > e[2] * 1.05) (u = y), (v = nx > 0 ? z : -z);
        else (u = nx > 0 ? -z : z), (v = y);
      } else if (az >= ay) {
        if (e[1] > e[0] * 1.05) (u = y), (v = nz > 0 ? -x : x);
        else (u = nz > 0 ? x : -x), (v = y);
      } else if (e[2] > e[0] * 1.05) (u = ny > 0 ? z : -z), (v = x);
      else (u = x), (v = ny > 0 ? -z : z);
      this.uv.push(u, v);
      return;
    }
    if (ax >= ay && ax >= az) this.uv.push(nx > 0 ? -z : z, y);
    else if (az >= ay) this.uv.push(nz > 0 ? x : -x, y);
    else if (this.swapTopUV) this.uv.push(ny > 0 ? z : -z, x);
    else this.uv.push(x, ny > 0 ? -z : z);
  }

  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, u?: number, v?: number): number {
    const i = this.pos.length / 3;
    this.pos.push(x, y, z);
    this.nor.push(nx, ny, nz);
    if (u === undefined || v === undefined) this.pushUV(x, y, z, nx, ny, nz);
    else this.uv.push(u, v);
    return i;
  }

  /** Quad from 4 corners in CCW order seen from the normal side. */
  quad(
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
    dx: number, dy: number, dz: number,
    nx: number, ny: number, nz: number,
  ): void {
    const i = this.pos.length / 3;
    this.pos.push(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz);
    for (let k = 0; k < 4; k++) this.nor.push(nx, ny, nz);
    this.pushUV(ax, ay, az, nx, ny, nz);
    this.pushUV(bx, by, bz, nx, ny, nz);
    this.pushUV(cx, cy, cz, nx, ny, nz);
    this.pushUV(dx, dy, dz, nx, ny, nz);
    this.idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
  }

  /** Face perpendicular to X at x, spanning y0..y1, z0..z1; dir = +1 (normal +x) or -1. */
  faceX(x: number, y0: number, y1: number, z0: number, z1: number, dir: number): void {
    if (y1 - y0 < 1e-6 || z1 - z0 < 1e-6) return;
    if (dir > 0) this.quad(x, y0, z1, x, y0, z0, x, y1, z0, x, y1, z1, 1, 0, 0);
    else this.quad(x, y0, z0, x, y0, z1, x, y1, z1, x, y1, z0, -1, 0, 0);
  }
  /** Face perpendicular to Z at z, spanning x0..x1, y0..y1. */
  faceZ(z: number, x0: number, x1: number, y0: number, y1: number, dir: number): void {
    if (x1 - x0 < 1e-6 || y1 - y0 < 1e-6) return;
    if (dir > 0) this.quad(x0, y0, z, x1, y0, z, x1, y1, z, x0, y1, z, 0, 0, 1);
    else this.quad(x1, y0, z, x0, y0, z, x0, y1, z, x1, y1, z, 0, 0, -1);
  }
  /** Face perpendicular to Y at y, spanning x0..x1, z0..z1. */
  faceY(y: number, x0: number, x1: number, z0: number, z1: number, dir: number): void {
    if (x1 - x0 < 1e-6 || z1 - z0 < 1e-6) return;
    if (dir > 0) this.quad(x0, y, z1, x1, y, z1, x1, y, z0, x0, y, z0, 0, 1, 0);
    else this.quad(x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1, 0, -1, 0);
  }

  /** Axis-aligned box (meters). mask selects faces (default all). */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mask?: BoxMask): void {
    if (x1 < x0) [x0, x1] = [x1, x0];
    if (y1 < y0) [y0, y1] = [y1, y0];
    if (z1 < z0) [z0, z1] = [z1, z0];
    const m = mask ?? {};
    if (this.grainAuto) this.ext = [x1 - x0, y1 - y0, z1 - z0];
    if (m.px !== false) this.faceX(x1, y0, y1, z0, z1, 1);
    if (m.nx !== false) this.faceX(x0, y0, y1, z0, z1, -1);
    if (m.py !== false) this.faceY(y1, x0, x1, z0, z1, 1);
    if (m.ny !== false) this.faceY(y0, x0, x1, z0, z1, -1);
    if (m.pz !== false) this.faceZ(z1, x0, x1, y0, y1, 1);
    if (m.nz !== false) this.faceZ(z0, x0, x1, y0, y1, -1);
    this.ext = null;
  }

  /** Box given by center + size. */
  boxC(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, mask?: BoxMask): void {
    this.box(cx - sx / 2, cy - sy / 2, cz - sz / 2, cx + sx / 2, cy + sy / 2, cz + sz / 2, mask);
  }

  /**
   * Append an arbitrary geometry transformed by `m`. uv: "box" re-projects UVs in the builder's space (meters),
   * "native" keeps the geometry's own UVs.
   */
  addGeometry(geo: THREE.BufferGeometry, m?: THREE.Matrix4, uv: "box" | "native" = "box"): void {
    const p = geo.getAttribute("position") as THREE.BufferAttribute | undefined;
    if (!p) return;
    let n = geo.getAttribute("normal") as THREE.BufferAttribute | undefined;
    if (!n) {
      geo.computeVertexNormals();
      n = geo.getAttribute("normal") as THREE.BufferAttribute;
    }
    const t = geo.getAttribute("uv") as THREE.BufferAttribute | undefined;
    const base = this.pos.length / 3;
    if (this.grainAuto && uv === "box") {
      if (!geo.boundingBox) geo.computeBoundingBox();
      _bb.copy(geo.boundingBox!);
      if (m) _bb.applyMatrix4(m);
      this.ext = [_bb.max.x - _bb.min.x, _bb.max.y - _bb.min.y, _bb.max.z - _bb.min.z];
    }
    if (m) _nm.getNormalMatrix(m);
    const flip = m ? m.determinant() < 0 : false;
    for (let i = 0; i < p.count; i++) {
      _v.fromBufferAttribute(p, i);
      _n.fromBufferAttribute(n, i);
      if (m) {
        _v.applyMatrix4(m);
        _n.applyMatrix3(_nm).normalize();
      }
      this.pos.push(_v.x, _v.y, _v.z);
      this.nor.push(_n.x, _n.y, _n.z);
      if (uv === "native" && t) this.uv.push(t.getX(i), t.getY(i));
      else this.pushUV(_v.x, _v.y, _v.z, _n.x, _n.y, _n.z);
    }
    this.ext = null;
    const index = geo.getIndex();
    if (index) {
      for (let i = 0; i < index.count; i += 3) {
        const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2);
        if (flip) this.idx.push(base + a, base + c, base + b);
        else this.idx.push(base + a, base + b, base + c);
      }
    } else {
      for (let i = 0; i < p.count; i += 3) {
        if (flip) this.idx.push(base + i, base + i + 2, base + i + 1);
        else this.idx.push(base + i, base + i + 1, base + i + 2);
      }
    }
  }

  /** Append another builder. */
  append(b: MeshBuilder): void {
    const base = this.pos.length / 3;
    for (const v of b.pos) this.pos.push(v);
    for (const v of b.nor) this.nor.push(v);
    for (const v of b.uv) this.uv.push(v);
    for (const i of b.idx) this.idx.push(base + i);
  }

  build(): THREE.BufferGeometry | null {
    if (this.idx.length === 0) return null;
    // Builders work in a plan-aligned frame (x = x_ft, z = +y_ft). The contract world is z = -y_ft
    // (road at +z), so mirror z here, once: negate z of positions and normals and flip the winding.
    const pos = Float32Array.from(this.pos);
    const nor = Float32Array.from(this.nor);
    for (let i = 2; i < pos.length; i += 3) {
      pos[i] = -pos[i];
      nor[i] = -nor[i];
    }
    const vc = pos.length / 3;
    const idx = vc > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx);
    for (let i = 0; i < idx.length; i += 3) {
      const t = idx[i + 1];
      idx[i + 1] = idx[i + 2];
      idx[i + 2] = t;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

/** Box-project UVs (meters) for a standalone geometry in its own space. Returns the same geometry. */
export function boxUV(geo: THREE.BufferGeometry, scale = 1): THREE.BufferGeometry {
  const p = geo.getAttribute("position") as THREE.BufferAttribute;
  let n = geo.getAttribute("normal") as THREE.BufferAttribute | undefined;
  if (!n) {
    geo.computeVertexNormals();
    n = geo.getAttribute("normal") as THREE.BufferAttribute;
  }
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) * scale, y = p.getY(i) * scale, z = p.getZ(i) * scale;
    const nx = n.getX(i), ny = n.getY(i), nz = n.getZ(i);
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    let u: number, v: number;
    if (ax >= ay && ax >= az) { u = nx > 0 ? -z : z; v = y; }
    else if (az >= ay) { u = nz > 0 ? x : -x; v = y; }
    else { u = x; v = ny > 0 ? -z : z; }
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
  }
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return geo;
}
