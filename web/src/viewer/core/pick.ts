/**
 * Visibility-aware picking. THREE.Raycaster ignores `visible`, so hidden floors/layers, invisible stair ramps and
 * colliders would swallow clicks; this walks the tree itself, skips them, honours the section cut and uses
 * three-mesh-bvh where a mesh is heavy enough to benefit.
 */
import * as THREE from "three";
import { MeshBVH, acceleratedRaycast } from "three-mesh-bvh";

/** Helpers nobody means to click: stair ramps, colliders, light glows/cones, the sun and sky, bare bulbs. */
const NON_PICK_KIND = /(^|[:_])(ramp|collider)($|[:_])|_collider$|^collider|^light:(glow|sun|sky|bulb|point|interior|cone|wash)|^helper/;

export function materialIsInvisible(mat: THREE.Material | THREE.Material[] | undefined): boolean {
  if (!mat) return true;
  const list = Array.isArray(mat) ? mat : [mat];
  // additive blending = a fake light pool or wall wash: light, not a surface
  return list.every((m) => !m || m.visible === false || m.colorWrite === false || (m.transparent && m.opacity < 0.04) || m.blending === THREE.AdditiveBlending);
}

export function isPickable(o: THREE.Object3D): boolean {
  if ((o as THREE.Light).isLight) return false;
  const u = o.userData;
  if (!u) return true;
  if (u.noPick || u.viewer) return false;
  if (typeof u.kind === "string" && NON_PICK_KIND.test(u.kind)) return false;
  return true;
}

export interface PickOptions {
  clipY?: number | null;
  far?: number;
  /** Reject individual hits (e.g. a neighbour ghosted out of the way). */
  skip?: (hit: THREE.Intersection) => boolean;
}

const _hits: THREE.Intersection[] = [];

/** Closest visible, pickable hit under `roots` (or null). */
export function pick(raycaster: THREE.Raycaster, roots: THREE.Object3D[], opts: PickOptions = {}): THREE.Intersection | null {
  _hits.length = 0;
  const clip = opts.clipY ?? null;
  const rc = raycaster as THREE.Raycaster & { firstHitOnly?: boolean };
  rc.firstHitOnly = clip === null && !opts.skip;
  if (opts.far !== undefined) raycaster.far = opts.far;
  const visit = (o: THREE.Object3D) => {
    if (!o.visible || !isPickable(o)) return;
    const m = o as THREE.Mesh;
    if (m.isMesh && o.layers.test(raycaster.layers) && !materialIsInvisible(m.material)) o.raycast(raycaster, _hits);
    const ch = o.children;
    for (let i = 0; i < ch.length; i++) visit(ch[i]);
  };
  for (const r of roots) visit(r);
  rc.firstHitOnly = false;
  raycaster.far = Infinity;
  if (!_hits.length) return null;
  _hits.sort((a, b) => a.distance - b.distance);
  for (const h of _hits) {
    if (clip !== null && h.point.y > clip + 1e-3) continue;
    if (opts.skip?.(h)) continue;
    _hits.length = 0;
    return h;
  }
  _hits.length = 0;
  return null;
}

const _nm = new THREE.Matrix3();
const _im = new THREE.Matrix4();

/** World-space face normal of a hit, flipped to face the ray origin. */
export function hitNormal(hit: THREE.Intersection, rayDir: THREE.Vector3): THREE.Vector3 {
  const n = hit.face ? hit.face.normal.clone() : new THREE.Vector3(0, 1, 0);
  const obj = hit.object as THREE.InstancedMesh;
  if (obj.isInstancedMesh && hit.instanceId !== undefined) {
    obj.getMatrixAt(hit.instanceId, _im);
    _im.premultiply(obj.matrixWorld);
    _nm.getNormalMatrix(_im);
  } else _nm.getNormalMatrix(hit.object.matrixWorld);
  n.applyMatrix3(_nm).normalize();
  if (n.dot(rayDir) > 0) n.negate();
  return n;
}

/**
 * Give heavy meshes a BVH so hover / comment raycasts stay cheap. Works in small time slices; returns a cancel fn.
 * Uses `indirect` BVHs so the engine's index buffers are never reordered.
 */
export function accelerateLater(root: THREE.Object3D, budgetMs = 6): () => void {
  const queue: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (o as THREE.InstancedMesh).isInstancedMesh || (o as THREE.SkinnedMesh).isSkinnedMesh) return;
    const g = m.geometry as THREE.BufferGeometry & { boundsTree?: MeshBVH };
    if (!g?.attributes?.position || g.boundsTree) {
      if (g?.boundsTree) m.raycast = acceleratedRaycast;
      return;
    }
    const tris = (g.index ? g.index.count : g.attributes.position.count) / 3;
    if (tris >= 400) queue.push(m);
  });
  let cancelled = false;
  let handle = 0;
  const work = () => {
    const t0 = performance.now();
    while (queue.length && performance.now() - t0 < budgetMs) {
      const m = queue.pop()!;
      const g = m.geometry as THREE.BufferGeometry & { boundsTree?: MeshBVH };
      try {
        if (!g.boundsTree) g.boundsTree = new MeshBVH(g, { indirect: true });
        m.raycast = acceleratedRaycast;
      } catch {
        /* odd geometry: keep the default raycast */
      }
    }
    if (queue.length && !cancelled) handle = requestAnimationFrame(work);
  };
  handle = requestAnimationFrame(work);
  return () => {
    cancelled = true;
    cancelAnimationFrame(handle);
  };
}
