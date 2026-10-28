/**
 * The walk colliders, baked from the engine's `colliders` (walls, slabs, invisible stair ramps, furniture…) into two
 * static BVHs (three-mesh-bvh):
 *
 * - **main**: what you walk on and the walls around you: floors, slabs, stair treads and landings (the tops of the
 *   invisible ramps), thresholds, plinths, the ground, walls, railings. The walker's feet follow only this one.
 * - **solid**: furniture, fixtures, roof equipment (water tank, solar frames) and cars when they are shown. Solid from
 *   the floor up and never walked on, so an armchair or a solar panel can't be climbed and a coffee table can't be
 *   walked through.
 *
 * The engine merges each level's colliders into one untagged mesh, so solids are told apart by the boxes of the
 * as-built elements they belong to: a triangle lying wholly inside a solid element's box (lifted just off its floor,
 * so the slab under it stays walkable) goes to `solid`. World matrices are refreshed first (stale matrices collapse
 * everything to the origin, docs/research/tech-stack.md §1.5).
 */
import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";

/** Invisible stair helpers: only their walkable tops should collide. */
const RAMP_KIND = /(^|[:_])(ramp|landing)($|[:_])/;

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _n = new THREE.Vector3(), _e1 = new THREE.Vector3(), _e2 = new THREE.Vector3();
const _m = new THREE.Matrix4(), _mw = new THREE.Matrix4();
const _mb = new THREE.Box3();

export interface SolidBVH {
  mesh: THREE.Mesh; // query-only; never added to the scene
  bvh: MeshBVH;
  triangles: number;
}

export interface ColliderBVH {
  mesh: THREE.Mesh; // query-only; never added to the scene
  bvh: MeshBVH;
  triangles: number;
  bounds: THREE.Box3;
  /** furniture, fixtures, roof equipment, shown cars: obstacles from the floor up (null when there are none) */
  solid: SolidBVH | null;
}

export interface ColliderSolids {
  /** world boxes of solid elements (furniture, fixtures, shown cars…); triangles wholly inside one are solid */
  boxes?: THREE.Box3[];
  /** meshes that are solid as a whole (world-space roof equipment baked by the viewer) */
  meshes?: THREE.Mesh[];
  /**
   * Geometry for a solid box that no collider triangle belongs to (engines leave coffee tables, plants and outdoor
   * chairs out of the colliders): usually the element's own visible triangles.
   */
  fill?: (boxIndex: number) => THREE.Mesh | null;
  /**
   * Doorways kept clear: solid triangles centred in one are dropped, so a chair or a tall unit the engine left
   * standing in a door never seals a room off (walls are unaffected).
   */
  clear?: THREE.Box3[];
}

/** A coarse XZ hash of boxes so each triangle tests only the few boxes around it. */
class BoxGrid {
  private cells = new Map<number, number[]>();
  constructor(readonly boxes: THREE.Box3[], readonly cell = 1) {
    boxes.forEach((b, i) => {
      for (let x = Math.floor(b.min.x / cell); x <= Math.floor(b.max.x / cell); x++)
        for (let z = Math.floor(b.min.z / cell); z <= Math.floor(b.max.z / cell); z++) {
          const k = this.key(x, z);
          const list = this.cells.get(k);
          if (list) list.push(i);
          else this.cells.set(k, [i]);
        }
    });
  }
  private key(x: number, z: number) {
    return (x + 4096) * 8192 + (z + 4096);
  }
  /** Index of a box holding all three points, or -1. */
  holds(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): number {
    if (!this.boxes.length) return -1;
    const cx = (a.x + b.x + c.x) / 3, cz = (a.z + b.z + c.z) / 3;
    const list = this.cells.get(this.key(Math.floor(cx / this.cell), Math.floor(cz / this.cell)));
    if (!list) return -1;
    for (const i of list) {
      const box = this.boxes[i];
      if (box.containsPoint(a) && box.containsPoint(b) && box.containsPoint(c)) return i;
    }
    return -1;
  }

  /** How many boxes hold all three points; the last one found goes in `out.i`. */
  holdsCount(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, out: { i: number }): number {
    if (!this.boxes.length) return 0;
    const cx = (a.x + b.x + c.x) / 3, cz = (a.z + b.z + c.z) / 3;
    const list = this.cells.get(this.key(Math.floor(cx / this.cell), Math.floor(cz / this.cell)));
    if (!list) return 0;
    let n = 0;
    for (const i of list) {
      const box = this.boxes[i];
      if (box.containsPoint(a) && box.containsPoint(b) && box.containsPoint(c)) {
        n++;
        out.i = i;
      }
    }
    return n;
  }
}

/** Calls `tri` with each world-space triangle of `m` (every instance of an InstancedMesh). */
function eachTriangle(m: THREE.Mesh, tri: (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => void) {
  const pos = m.geometry?.getAttribute("position") as THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined;
  if (!pos || pos.count < 3) return;
  const idx = m.geometry.index;
  const n = idx ? idx.count : pos.count - (pos.count % 3);
  const inst = m as unknown as THREE.InstancedMesh;
  const count = inst.isInstancedMesh ? inst.count : 1;
  for (let k = 0; k < count; k++) {
    if (inst.isInstancedMesh) {
      inst.getMatrixAt(k, _m);
      _mw.multiplyMatrices(m.matrixWorld, _m);
    } else _mw.copy(m.matrixWorld);
    for (let i = 0; i + 2 < n; i += 3) {
      _a.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(_mw);
      _b.fromBufferAttribute(pos, idx ? idx.getX(i + 1) : i + 1).applyMatrix4(_mw);
      _c.fromBufferAttribute(pos, idx ? idx.getX(i + 2) : i + 2).applyMatrix4(_mw);
      tri(_a, _b, _c);
    }
  }
}

class TriList {
  data: number[] = [];
  push(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) {
    this.data.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  }
  get triangles() {
    return this.data.length / 9;
  }
  /** Indexed, position-only geometry with its BVH. */
  bake(): { mesh: THREE.Mesh; bvh: MeshBVH; triangles: number } | null {
    if (!this.data.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.data, 3));
    const index = new Uint32Array(this.data.length / 3);
    for (let i = 0; i < index.length; i++) index[i] = i;
    g.setIndex(new THREE.BufferAttribute(index, 1));
    const bvh = new MeshBVH(g);
    g.boundsTree = bvh;
    g.computeBoundingBox();
    return { mesh: new THREE.Mesh(g), bvh, triangles: index.length / 3 };
  }
}

/**
 * Bake the colliders. `exclude`: boxes whose triangles are dropped (hidden parked cars never block the way in).
 * `solids`: what is solid from the floor up and never walkable (see the file comment).
 */
export function buildColliderBVH(meshes: THREE.Mesh[], exclude: THREE.Box3[] = [], solids: ColliderSolids = {}): ColliderBVH | null {
  const main = new TriList(), solid = new TriList();
  const excluded = new BoxGrid(exclude);
  const solidGrid = new BoxGrid(solids.boxes ?? []);
  // collider triangles that belong to exactly one solid box (shared ones may be a neighbour's, e.g. the sofa
  // around a coffee table)
  const own = new Uint32Array(solids.boxes?.length ?? 0);
  const which = { i: -1 };
  const clear = solids.clear ?? [];
  const _ctr = new THREE.Vector3();
  const inDoorway = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => {
    if (!clear.length) return false;
    _ctr.copy(a).add(b).add(c).multiplyScalar(1 / 3);
    return clear.some((z) => z.containsPoint(_ctr));
  };
  for (const m of meshes) {
    if (!m?.geometry) continue;
    m.updateWorldMatrix(true, false); // REQUIRED: stale matrices collapse everything to the origin
    const isInst = !!(m as unknown as THREE.InstancedMesh).isInstancedMesh;
    if (typeof m.userData?.kind === "string" && RAMP_KIND.test(m.userData.kind) && !isInst) {
      // stair ramps and landings: keep the walkable tops only (normal·up > 0.3). Their vertical sides would block a
      // walker stepping onto the first treads from the side; the sloped top alone still pushes back where it's high.
      eachTriangle(m, (a, b, c) => {
        _n.crossVectors(_e1.subVectors(b, a), _e2.subVectors(c, a)).normalize();
        if (Math.abs(_n.y) >= 0.3) main.push(a, b, c);
      });
      continue;
    }
    // a cheap whole-mesh test first: most meshes touch neither a car nor a piece of furniture's box
    let checkExclude = exclude.length > 0, checkSolid = (solids.boxes?.length ?? 0) > 0;
    if ((checkExclude || checkSolid) && !isInst) {
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      _mb.copy(m.geometry.boundingBox!).applyMatrix4(m.matrixWorld);
      if (checkExclude) checkExclude = exclude.some((b) => b.intersectsBox(_mb));
      if (checkSolid) checkSolid = solids.boxes!.some((b) => b.intersectsBox(_mb));
    }
    eachTriangle(m, (a, b, c) => {
      if (checkExclude && excluded.holds(a, b, c) >= 0) return;
      const n = checkSolid ? solidGrid.holdsCount(a, b, c, which) : 0;
      if (n === 1) own[which.i]++;
      if (n === 0) main.push(a, b, c);
      else if (!inDoorway(a, b, c)) solid.push(a, b, c);
    });
  }
  const whole = [...(solids.meshes ?? [])];
  if (solids.fill)
    for (let i = 0; i < own.length; i++) {
      if (own[i]) continue;
      const f = solids.fill(i);
      if (f) whole.push(f);
    }
  for (const m of whole) {
    if (!m?.geometry) continue;
    m.updateWorldMatrix(true, false);
    eachTriangle(m, (a, b, c) => {
      if (!inDoorway(a, b, c)) solid.push(a, b, c);
    });
  }
  const mb = main.bake();
  if (!mb) return null;
  const sb = solid.bake();
  return { mesh: mb.mesh, bvh: mb.bvh, triangles: mb.triangles, bounds: mb.mesh.geometry.boundingBox!.clone(), solid: sb };
}

export function disposeCollider(c: ColliderBVH | null) {
  if (!c) return;
  c.mesh.geometry.dispose();
  c.solid?.mesh.geometry.dispose();
}
