/**
 * Clear view and cars.
 *
 * Ghosting: neighbours, poles, wires and other street context (engine `kind: "context"`, legacy
 * `landscape:neighbour…`, or `userData.mergeGroup === "context"`) get a shader patch that, per fragment, tests whether
 * the house lies behind it along the view ray. Those fragments are dropped from the opaque pass and redrawn by a
 * translucent clay overlay (DESIGN: "neighbours between the camera and the house ghost to 15% clay"). Per fragment,
 * so it works on consolidated meshes and from any angle, with no sorting artefacts in the solid parts.
 *
 * Vehicles: cars and motorbikes (engine `kind: "vehicle"`, legacy `furniture:car_*`/`motorbike`) are split out of
 * consolidated meshes into their own meshes so they can fade and hide on their own, and their triangles are left
 * out of the walk collider (porch cars never block the way in).
 */
import * as THREE from "three";
import { partsOf, type PartRange } from "./tags";

export const CONTEXT_KIND = /(^|:)(context|neighbou?rs?|utility_poles?|wires|streetlights?|power_lines?)($|:)/;
export const VEHICLE_KIND = /(^|:)(vehicles?|cars?|car_sedan|car_suv|suv|sedan|motorbikes?|motorcycles?|scooters?|rickshaw)($|:)/;

/** At most this many buildings near the camera fade at once (the nearest ones). */
export const NEAR_MAX = 8;
/** A building within this distance of the orbit camera (or containing it) fades almost away; gone by NEAR_FAR. */
export const NEAR_IN = 4;
export const NEAR_FAR = 6;
/** Ghost opacity: neighbours between the camera and the house (DESIGN 15% clay), and buildings by the camera. */
const GHOST_ALPHA = 0.15;
const NEAR_ALPHA = 0.04;
/** A whole neighbour ghosted at eye level is big: lighter, so it never veils the ground floor and gate. */
const OCC_ALPHA = 0.07;
/**
 * Share of the house a building must hide before it ghosts whole (ramping in up to OCC_FULL). The aerial hero view
 * sees a side neighbour hide ~25% (its yard side), so it keeps the soft window there; eye-level views (≥35%) ghost it.
 */
const OCC_FROM = 0.3;
const OCC_FULL = 0.35;

/** Shared uniforms: one value drives every patched material. */
export const GHOST = {
  nqGhost: { value: 0 },
  nqBoxMin: { value: new THREE.Vector3() },
  nqBoxMax: { value: new THREE.Vector3() },
  /** buildings close to the camera (world boxes) and how far they fade (0..1) */
  nqNearMin: { value: Array.from({ length: NEAR_MAX }, () => new THREE.Vector3()) },
  nqNearMax: { value: Array.from({ length: NEAR_MAX }, () => new THREE.Vector3()) },
  nqNearW: { value: new Array<number>(NEAR_MAX).fill(0) },
  /** how much of the same building stands between the camera and the house (it then ghosts whole, not as a hole) */
  nqOccW: { value: new Array<number>(NEAR_MAX).fill(0) },
  nqNearN: { value: 0 },
  /**
   * 1 while capturing for "Render this view": nothing is translucent (an AI render turns a ghosted neighbour into a
   * glass building). Neighbours, also those in front of the house, are drawn solid; only a building at the lens (the
   * near fade, which the viewport shows at 4%) is left out whole, so the frame is never one blank wall.
   */
  nqCapture: { value: 0 },
};

const GLSL = /* glsl */ `
uniform float nqGhost;
uniform vec3 nqBoxMin;
uniform vec3 nqBoxMax;
uniform vec3 nqNearMin[${NEAR_MAX}];
uniform vec3 nqNearMax[${NEAR_MAX}];
uniform float nqNearW[${NEAR_MAX}];
uniform float nqOccW[${NEAR_MAX}];
uniform int nqNearN;
uniform float nqCapture;
varying vec3 vNqW;
// how much of this fragment belongs to a building at (or in) the camera, or sits right in front of the lens
float nqNearF = 0.0;
// how much of this fragment belongs to a building standing in front of the house (ghosted whole)
float nqOccF = 0.0;
void nqNear(vec3 p) {
  float w = 0.0, o = 0.0;
  for (int i = 0; i < ${NEAR_MAX}; i++) {
    if (i >= nqNearN) break;
    if (all(greaterThanEqual(p, nqNearMin[i])) && all(lessThanEqual(p, nqNearMax[i]))) {
      w = max(w, nqNearW[i]);
      o = max(o, nqOccW[i]);
    }
  }
  nqNearF = max(w, 1.0 - smoothstep(1.5, 3.0, length(p - cameraPosition)));
  nqOccF = o;
}
// length of the view ray's stretch inside the box that lies beyond the fragment (0 = the box isn't behind it)
float nqChord(vec3 ro, vec3 inv, float L, vec3 bmin, vec3 bmax) {
  vec3 t0 = (bmin - ro) * inv;
  vec3 t1 = (bmax - ro) * inv;
  vec3 tn3 = min(t0, t1), tf3 = max(t0, t1);
  float tn = max(max(tn3.x, tn3.y), tn3.z);
  float tf = min(min(tf3.x, tf3.y), tf3.z);
  return tf - max(tn, L);
}
float nqGhostAt(vec3 p) {
  nqNearF = 0.0;
  nqOccF = 0.0;
  if (nqGhost <= 0.0) return 0.0;
  nqNear(p);
  // capture: solid, except a building at the lens, which is cut out whole (never a translucent veil)
  if (nqCapture > 0.5) return step(0.5, nqNearF);
  vec3 d = p - cameraPosition;
  float L = length(d);
  vec3 rd = d / max(L, 1e-5);
  vec3 sg = sign(rd);
  sg += 1.0 - abs(sg);
  vec3 inv = 1.0 / (sg * max(abs(rd), vec3(1e-5)));
  // the house box, then the same box grown by 0.7 / 1.4 / 2.1 m: a soft-edged window, not a hard cut-out
  float g = 0.0;
  for (int k = 0; k < 4; k++) {
    vec3 e = vec3(0.7 * float(k));
    vec3 grow = vec3(e.x, e.y, e.z);
    g += smoothstep(0.0, 0.35, nqChord(cameraPosition, inv, L, nqBoxMin - vec3(grow.x, 0.0, grow.z), nqBoxMax + grow));
  }
  return nqGhost * max(max(g * 0.25, nqOccF), nqNearF);
}
`;

const VERT_DECL = "varying vec3 vNqW;\n";
const VERT_BODY = `#include <project_vertex>
  vec4 nqW4 = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    nqW4 = instanceMatrix * nqW4;
  #endif
  vNqW = (modelMatrix * nqW4).xyz;`;

function patch(mat: THREE.Material, mode: "solid" | "ghost") {
  const prev = mat.onBeforeCompile?.bind(mat);
  mat.onBeforeCompile = (sh, r) => {
    prev?.(sh, r);
    Object.assign(sh.uniforms, GHOST);
    sh.vertexShader = VERT_DECL + sh.vertexShader.replace("#include <project_vertex>", VERT_BODY);
    const test = mode === "solid" ? "if (nqG > 0.02) discard;" : "if (nqG <= 0.02 || nqCapture > 0.5) discard;";
    sh.fragmentShader =
      GLSL +
      sh.fragmentShader.replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>\n  float nqG = nqGhostAt(vNqW);\n  ${test}`);
    if (mode === "ghost") {
      sh.fragmentShader = sh.fragmentShader.replace(
        "#include <dithering_fragment>",
        `#include <dithering_fragment>\n  float nqK = smoothstep(0.02, 0.85, nqG);\n  gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114))) * vec3(1.02, 1.0, 0.96), 0.7 * nqK);\n  gl_FragColor.a *= mix(1.0, mix(mix(${GHOST_ALPHA.toFixed(3)}, ${OCC_ALPHA.toFixed(3)}, nqOccF), ${NEAR_ALPHA.toFixed(3)}, nqNearF), nqK);`,
      );
    }
  };
  const key = mat.customProgramCacheKey?.bind(mat);
  mat.customProgramCacheKey = () => `${key ? key() : ""}|nq-ghost-${mode}`;
  mat.needsUpdate = true;
}


/** CPU twin of the shader's per-building terms (near the camera, standing in front of the house). */
function nearAt(p: THREE.Vector3, cam: THREE.Vector3): number {
  let w = 0;
  const n = GHOST.nqNearN.value;
  for (let i = 0; i < n; i++) {
    const mn = GHOST.nqNearMin.value[i], mx = GHOST.nqNearMax.value[i];
    if (p.x >= mn.x && p.y >= mn.y && p.z >= mn.z && p.x <= mx.x && p.y <= mx.y && p.z <= mx.z) w = Math.max(w, GHOST.nqNearW.value[i], GHOST.nqOccW.value[i]);
  }
  const t = Math.min(1, Math.max(0, (p.distanceTo(cam) - 1.5) / 1.5));
  return Math.max(w, 1 - t * t * (3 - 2 * t));
}

const _ray = new THREE.Ray();
const _hit = new THREE.Vector3();
const _samples: THREE.Vector3[] = [];
const ss01 = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

const _corner = new THREE.Vector3();

/** Share of the screen a box covers (its projected bounding rectangle, clipped); 1 when it wraps the camera. */
function screenCover(b: THREE.Box3, camera: THREE.PerspectiveCamera): number {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  let behind = 0;
  for (let k = 0; k < 8; k++) {
    _corner.set(k & 1 ? b.max.x : b.min.x, k & 2 ? b.max.y : b.min.y, k & 4 ? b.max.z : b.min.z);
    _corner.applyMatrix4(camera.matrixWorldInverse);
    if (_corner.z > -camera.near) {
      behind++;
      continue;
    }
    _corner.applyMatrix4(camera.projectionMatrix);
    x0 = Math.min(x0, _corner.x);
    x1 = Math.max(x1, _corner.x);
    y0 = Math.min(y0, _corner.y);
    y1 = Math.max(y1, _corner.y);
  }
  if (behind === 8) return 0; // wholly behind the camera
  if (behind) return 1; // part of it behind the lens: it wraps around the view
  const w = Math.max(0, Math.min(1, x1) - Math.max(-1, x0)), h = Math.max(0, Math.min(1, y1) - Math.max(-1, y0));
  return (w * h) / 4;
}

/** Points spread through the house box (5 × 3 × 5), lower ones first: the ground floor and gate count most. */
function houseSamples(box: THREE.Box3): THREE.Vector3[] {
  _samples.length = 0;
  const s = box.getSize(new THREE.Vector3());
  for (const fy of [0.12, 0.4, 0.75])
    for (const fx of [0.05, 0.27, 0.5, 0.73, 0.95])
      for (const fz of [0.05, 0.27, 0.5, 0.73, 0.95]) _samples.push(new THREE.Vector3(box.min.x + s.x * fx, box.min.y + s.y * fy, box.min.z + s.z * fz));
  return _samples;
}

/** CPU twin of the shader test (for picking through ghosted neighbours). */
export function ghostAt(p: THREE.Vector3, cam: THREE.Vector3): number {
  const g = GHOST.nqGhost.value;
  if (g <= 0) return 0;
  const near = nearAt(p, cam);
  const d = new THREE.Vector3().subVectors(p, cam);
  const L = d.length();
  if (L < 1e-5) return g * near;
  d.multiplyScalar(1 / L);
  const mn = GHOST.nqBoxMin.value, mx = GHOST.nqBoxMax.value;
  const ss = (x: number) => {
    const t = Math.min(1, Math.max(0, x / 0.35));
    return t * t * (3 - 2 * t);
  };
  let sum = 0;
  for (let k = 0; k < 4; k++) {
    const e = 0.7 * k;
    let tn = -Infinity, tf = Infinity;
    for (const a of ["x", "y", "z"] as const) {
      const lo = mn[a] - (a === "y" ? 0 : e), hi = mx[a] + e;
      const inv = 1 / (Math.abs(d[a]) < 1e-5 ? 1e-5 * (d[a] < 0 ? -1 : 1) : d[a]);
      const t0 = (lo - cam[a]) * inv, t1 = (hi - cam[a]) * inv;
      tn = Math.max(tn, Math.min(t0, t1));
      tf = Math.min(tf, Math.max(t0, t1));
    }
    sum += ss(tf - Math.max(tn, L));
  }
  return g * Math.max(sum / 4, near);
}

/**
 * Buildings of the street context, as world boxes: the triangles of every "house-like" context mesh above gate height,
 * joined where their boxes touch (sweep and prune + union-find), each cluster dropped to the ground. The engine merges
 * all the neighbours into a few meshes per material, so this is how one neighbour can fade on its own.
 */
function buildingBoxes(meshes: THREE.Mesh[]): THREE.Box3[] {
  const boxes: THREE.Box3[] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let base = Infinity;
  const tris: number[] = []; // minx, miny, minz, maxx, maxy, maxz per triangle
  for (const m of meshes) {
    const pos = m.geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
    if (!pos || (m as THREE.InstancedMesh).isInstancedMesh) continue;
    m.updateWorldMatrix(true, false);
    const idx = m.geometry.index;
    const n = idx ? idx.count : pos.count;
    for (let i = 0; i + 2 < n; i += 3) {
      a.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(m.matrixWorld);
      b.fromBufferAttribute(pos, idx ? idx.getX(i + 1) : i + 1).applyMatrix4(m.matrixWorld);
      c.fromBufferAttribute(pos, idx ? idx.getX(i + 2) : i + 2).applyMatrix4(m.matrixWorld);
      const y0 = Math.min(a.y, b.y, c.y);
      base = Math.min(base, y0);
      tris.push(Math.min(a.x, b.x, c.x), y0, Math.min(a.z, b.z, c.z), Math.max(a.x, b.x, c.x), Math.max(a.y, b.y, c.y), Math.max(a.z, b.z, c.z));
    }
  }
  const n = tris.length / 6;
  if (!n) return boxes;
  // above the boundary walls and gates (which join a whole row together)
  const keep: number[] = [];
  for (let i = 0; i < n; i++) if (tris[i * 6 + 1] > base + 1.9) keep.push(i);
  keep.sort((i, j) => tris[i * 6] - tris[j * 6]);
  const parent = new Int32Array(n).map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  const tol = 0.03;
  const active: number[] = [];
  for (const i of keep) {
    const x0 = tris[i * 6];
    for (let k = active.length - 1; k >= 0; k--) {
      const j = active[k];
      if (tris[j * 6 + 3] < x0 - tol) {
        active.splice(k, 1);
        continue;
      }
      if (tris[j * 6 + 1] <= tris[i * 6 + 4] + tol && tris[i * 6 + 1] <= tris[j * 6 + 4] + tol && tris[j * 6 + 2] <= tris[i * 6 + 5] + tol && tris[i * 6 + 2] <= tris[j * 6 + 5] + tol) {
        const ri = find(i), rj = find(j);
        if (ri !== rj) parent[ri] = rj;
      }
    }
    active.push(i);
  }
  const byRoot = new Map<number, THREE.Box3>();
  for (const i of keep) {
    const r = find(i);
    let box = byRoot.get(r);
    if (!box) byRoot.set(r, (box = new THREE.Box3()));
    box.expandByPoint(a.set(tris[i * 6], tris[i * 6 + 1], tris[i * 6 + 2]));
    box.expandByPoint(a.set(tris[i * 6 + 3], tris[i * 6 + 4], tris[i * 6 + 5]));
  }
  // windows, frames and bands that float on a facade join the building whose footprint they sit on (a building is
  // a prism: footprints that overlap belong together; neighbours only ever touch across a gap)
  const parts = [...byRoot.values()];
  const footTol = 0.05;
  const overlaps = (p: THREE.Box3, q: THREE.Box3) => p.min.x <= q.max.x + footTol && q.min.x <= p.max.x + footTol && p.min.z <= q.max.z + footTol && q.min.z <= p.max.z + footTol;
  for (let merged = true; merged; ) {
    merged = false;
    for (let i = 0; i < parts.length && !merged; i++)
      for (let j = i + 1; j < parts.length; j++) {
        if (!overlaps(parts[i], parts[j])) continue;
        parts[i].union(parts[j]);
        parts.splice(j, 1);
        merged = true;
        break;
      }
  }
  for (const box of parts) {
    const s = box.getSize(a);
    if (Math.max(s.x, s.z) < 2 || s.y < 1) continue; // a lone tank or a sign, not a building
    box.min.y = base - 0.2;
    box.expandByScalar(0.3);
    boxes.push(box);
  }
  return boxes;
}

function tagChain(o: THREE.Object3D, stop: THREE.Object3D | null) {
  let kind: string | undefined, group: string | undefined;
  for (let p: THREE.Object3D | null = o; p && p !== stop; p = p.parent) {
    const u = p.userData ?? {};
    if (!kind && typeof u.kind === "string" && u.kind !== "merged" && u.kind !== "section") kind = u.kind;
    if (!group && typeof u.mergeGroup === "string") group = u.mergeGroup;
  }
  return { kind, group };
}

const isVehicleKind = (k: unknown) => typeof k === "string" && VEHICLE_KIND.test(k);
const isContextKind = (k: unknown) => typeof k === "string" && CONTEXT_KIND.test(k);

export interface Vehicle {
  id: string;
  meshes: THREE.Mesh[];
  /** world box (m) */
  box: THREE.Box3;
  opacity: number;
  clones: Map<THREE.Material, THREE.Material>;
  originals: Map<THREE.Mesh, THREE.Material | THREE.Material[]>;
}

/**
 * Move the triangles of `ranges` (consolidated parts) into a new sibling mesh with the same material, and
 * collapse them in the source (degenerate triangles: numbering, and so part lookup, stays valid).
 */
function splitParts(src: THREE.Mesh, ranges: PartRange[]): THREE.Mesh | null {
  const g = src.geometry;
  const idx = g.index;
  if (!idx || !ranges.length) return null;
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const nor = g.getAttribute("normal") as THREE.BufferAttribute | undefined;
  const uv = g.getAttribute("uv") as THREE.BufferAttribute | undefined;
  const map = new Map<number, number>();
  const P: number[] = [], N: number[] = [], U: number[] = [], I: number[] = [];
  const parts: PartRange[] = [];
  for (const r of ranges) {
    const start = I.length / 3;
    for (let t = r.start; t < r.start + r.count; t++)
      for (let k = 0; k < 3; k++) {
        const vi = idx.getX(t * 3 + k);
        let ni = map.get(vi);
        if (ni === undefined) {
          ni = P.length / 3;
          map.set(vi, ni);
          P.push(pos.getX(vi), pos.getY(vi), pos.getZ(vi));
          if (nor) N.push(nor.getX(vi), nor.getY(vi), nor.getZ(vi));
          if (uv) U.push(uv.getX(vi), uv.getY(vi));
        }
        I.push(ni);
      }
    parts.push({ start, count: r.count, tags: r.tags });
  }
  for (const r of ranges)
    for (let t = r.start; t < r.start + r.count; t++) {
      const a = idx.getX(t * 3);
      idx.setX(t * 3 + 1, a);
      idx.setX(t * 3 + 2, a);
    }
  idx.needsUpdate = true;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
  if (nor) geo.setAttribute("normal", new THREE.Float32BufferAttribute(N, 3));
  if (uv) geo.setAttribute("uv", new THREE.Float32BufferAttribute(U, 2));
  geo.setIndex(I);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  const m = new THREE.Mesh(geo, src.material);
  m.castShadow = src.castShadow;
  m.receiveShadow = src.receiveShadow;
  m.renderOrder = src.renderOrder;
  m.matrixAutoUpdate = src.matrixAutoUpdate;
  m.position.copy(src.position);
  m.quaternion.copy(src.quaternion);
  m.scale.copy(src.scale);
  m.matrix.copy(src.matrix);
  const t0 = ranges[0].tags as Record<string, unknown>;
  m.userData = { ...t0, parts, viewer: "split" };
  src.parent?.add(m);
  return m;
}

export class ContextFX {
  vehicles: Vehicle[] = [];
  private done = new WeakSet<THREE.Object3D>();
  private solidClones = new Map<THREE.Material, THREE.Material>();
  /** Same material, translucent: redraws only the ghosted fragments (so the edge of the window is seamless). */
  private ghostClones = new Map<THREE.Material, THREE.Material>();
  /** Depth-only twins of the ghost clones (the de-stacking pre-pass). */
  private ghostDepthClones = new Map<THREE.Material, THREE.Material>();
  private owned: (THREE.Material | THREE.BufferGeometry)[] = [];

  /** Classify and prepare a finished build (idempotent per root). */
  install(root: THREE.Object3D) {
    this.vehicles = [];
    const byId = new Map<string, Vehicle>();
    const addVehicle = (m: THREE.Mesh, id: string) => {
      let v = byId.get(id);
      if (!v) {
        v = { id, meshes: [], box: new THREE.Box3(), opacity: 1, clones: new Map(), originals: new Map() };
        byId.set(id, v);
      }
      v.meshes.push(m);
    };
    const meshes: THREE.Mesh[] = [];
    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && !o.userData?.viewer) meshes.push(o as THREE.Mesh);
    });
    const firstTime = !this.done.has(root);
    const contextMeshes: THREE.Mesh[] = [];
    for (const m of meshes) {
      const { kind, group } = tagChain(m, root);
      const parts = partsOf(m);
      // ── vehicles ──
      if (parts) {
        const veh = parts.filter((p) => isVehicleKind(p.tags.kind));
        if (veh.length === parts.length) addVehicle(m, String(veh[0].tags.id ?? m.uuid));
        else if (veh.length && firstTime) {
          // one new mesh per vehicle id
          const ids = new Map<string, PartRange[]>();
          for (const p of veh) {
            const id = String(p.tags.id ?? "vehicle");
            (ids.get(id) ?? ids.set(id, []).get(id)!).push(p);
          }
          for (const [id, rs] of ids) {
            const split = splitParts(m, rs);
            if (split) addVehicle(split, id);
          }
        }
      } else if (isVehicleKind(kind) || isVehicleKind(m.userData?.kind)) {
        let id = m.uuid;
        for (let p: THREE.Object3D | null = m; p && p !== root; p = p.parent) if (isVehicleKind(p.userData?.kind) && p.userData?.id) id = String(p.userData.id);
        addVehicle(m, id);
      }
      // ── context ──
      const ctx = group === "context" || isContextKind(kind) || (!!parts && parts.every((p) => isContextKind(p.tags.kind)));
      if (ctx && !m.userData.nqGhost) this.ghostify(m);
      if (ctx) contextMeshes.push(m);
    }
    // the neighbours' houses (by label when the engine gives one), clustered into one box per building
    const HOUSE = /neighbou?r|house|building|villa|home/i;
    const labelled = contextMeshes.filter((m) => HOUSE.test(String(m.userData?.label ?? "")) || !!partsOf(m)?.some((p) => HOUSE.test(String(p.tags.label ?? ""))));
    this.buildings = buildingBoxes(labelled.length ? labelled : contextMeshes);
    this.nearKey = "";
    // split meshes created on an earlier install are tagged "split": pick them up again (cached builds)
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.userData?.viewer === "split") {
        const id = String(partsOf(m)?.[0]?.tags.id ?? m.uuid);
        if (!byId.get(id)?.meshes.includes(m)) addVehicle(m, id);
      }
    });
    this.done.add(root);
    root.updateMatrixWorld(true);
    for (const v of byId.values()) {
      v.box.makeEmpty();
      for (const m of v.meshes) v.box.expandByObject(m);
      // cars bigger than a garage are not cars (defensive)
      const s = v.box.getSize(new THREE.Vector3());
      if (s.x > 12 || s.z > 12) continue;
      this.vehicles.push(v);
    }
  }

  private ghostify(m: THREE.Mesh) {
    m.geometry.computeBoundingBox();
    const bb = m.geometry.boundingBox;
    // flat ground pieces (road, footpath, kerbs) can never block the view
    if (bb && bb.max.y - bb.min.y < 0.35 && !m.userData.parts) return;
    m.userData.nqGhost = true;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    const next = mats.map((mat) => {
      let c = this.solidClones.get(mat);
      if (!c) {
        c = mat.clone();
        patch(c, "solid");
        this.solidClones.set(mat, c);
        this.owned.push(c);
      }
      return c;
    });
    m.material = Array.isArray(m.material) ? next : next[0];
    if ((m as THREE.InstancedMesh).isInstancedMesh) return; // no overlay for instanced street trees etc.
    // Ghost layers never stack: a depth-only pass of every ghosted face first (renderOrder 49), then the clay colour
    // drawn only where it is the nearest ghosted surface (renderOrder 50, depth test ≤). Looking through two or three
    // neighbours reads as one even 15% veil, not 30–40%.
    const pre = mats.map((mat) => {
      let c = this.ghostDepthClones.get(mat);
      if (!c) {
        c = mat.clone();
        c.transparent = true;
        c.colorWrite = false;
        c.depthWrite = true;
        patch(c, "ghost");
        this.ghostDepthClones.set(mat, c);
        this.owned.push(c);
      }
      return c;
    });
    const ghosts = mats.map((mat) => {
      let c = this.ghostClones.get(mat);
      if (!c) {
        c = mat.clone();
        c.transparent = true;
        c.depthWrite = false;
        c.depthFunc = THREE.LessEqualDepth;
        patch(c, "ghost");
        this.ghostClones.set(mat, c);
        this.owned.push(c);
      }
      return c;
    });
    for (const [mat, order] of [[pre, 49], [ghosts, 50]] as const) {
      const overlay = new THREE.Mesh(m.geometry, Array.isArray(m.material) ? mat : mat[0]);
      overlay.userData = { noPick: true, viewer: "ghost" };
      overlay.renderOrder = order;
      overlay.castShadow = false;
      overlay.receiveShadow = false;
      overlay.frustumCulled = m.frustumCulled;
      m.add(overlay);
    }
  }

  /** Buildings of the street (world boxes), for fading the ones at the camera. */
  buildings: THREE.Box3[] = [];
  private nearKey = "";

  /** Last per-building weights (debugging): [index, near, in front of the house, share of the house it hides]. */
  lastFade: [number, number, number, number][] = [];

  /**
   * Orbit, per building of the street:
   * - at the camera: one that contains it or stands within NEAR_IN m fades to 4% (a smooth ramp out to NEAR_FAR);
   * - in front of the house: one that hides a good share of the house (rays from the camera to points spread
   *   through the house box) ghosts whole to 15% clay, so it never reads as a wall with a hole cut in it.
   * At most NEAR_MAX buildings, strongest first. Returns true when anything changed (repaint).
   */
  updateNear(camera: THREE.PerspectiveCamera, enabled: boolean): boolean {
    const cam = camera.position;
    const list: { i: number; near: number; occ: number; d: number; frac: number }[] = [];
    if (enabled && this.buildings.length) {
      const house = new THREE.Box3(GHOST.nqBoxMin.value, GHOST.nqBoxMax.value);
      const pts = house.isEmpty() ? [] : houseSamples(house);
      const houseD = house.isEmpty() ? Infinity : house.distanceToPoint(cam);
      camera.updateMatrixWorld();
      this.buildings.forEach((b, i) => {
        const d = b.distanceToPoint(cam);
        const near = 1 - ss01(NEAR_IN, NEAR_FAR, d);
        let blocked = 0;
        if (pts.length && !b.containsPoint(cam)) {
          for (const p of pts) {
            _ray.origin.copy(cam);
            _ray.direction.subVectors(p, cam);
            const L = _ray.direction.length();
            _ray.direction.multiplyScalar(1 / L);
            if (_ray.intersectBox(b, _hit) && _hit.distanceTo(cam) < L - 0.3) blocked++;
          }
        }
        const frac = pts.length ? blocked / pts.length : 0;
        let occ = ss01(OCC_FROM, OCC_FULL, frac);
        // at eye level (the camera below its roof), a neighbour nearer than the house whose facade fills more than
        // a tenth of the frame is a wall in the way, even off to one side: it ghosts too
        if (occ < 1 && cam.y < b.max.y + 2 && d < houseD + 1) occ = Math.max(occ, ss01(0.07, 0.1, screenCover(b, camera)));
        if (near > 0.001 || occ > 0.001) list.push({ i, near, occ, d, frac });
      });
    }
    list.sort((x, y) => Math.max(y.near, y.occ) - Math.max(x.near, x.occ) || x.d - y.d);
    list.length = Math.min(list.length, NEAR_MAX);
    const key = list.map((n) => `${n.i}:${n.near.toFixed(2)}:${n.occ.toFixed(2)}`).join("|");
    if (key === this.nearKey) return false;
    this.nearKey = key;
    this.lastFade = list.map((n) => [n.i, +n.near.toFixed(2), +n.occ.toFixed(2), +n.frac.toFixed(2)]);
    list.forEach((n, k) => {
      const b = this.buildings[n.i];
      GHOST.nqNearMin.value[k].copy(b.min);
      GHOST.nqNearMax.value[k].copy(b.max);
      GHOST.nqNearW.value[k] = n.near;
      GHOST.nqOccW.value[k] = n.occ;
    });
    GHOST.nqNearN.value = list.length;
    return true;
  }

  /** Set the house box rays are tested against (world). */
  setHouseBox(b: THREE.Box3) {
    GHOST.nqBoxMin.value.copy(b.min);
    GHOST.nqBoxMax.value.copy(b.max);
  }

  /** Fade one vehicle (0 = hidden). Transparent clones are made on first use and kept. */
  setVehicleOpacity(v: Vehicle, a: number, suppress: (o: THREE.Object3D, hidden: boolean) => void) {
    a = Math.min(1, Math.max(0, a));
    if (Math.abs(a - v.opacity) < 1e-3 && !(a === 0 || a === 1)) return;
    v.opacity = a;
    for (const m of v.meshes) {
      if (a <= 0.001) {
        suppress(m, true);
        continue;
      }
      suppress(m, false);
      if (a >= 0.999) {
        const orig = v.originals.get(m);
        if (orig) {
          m.material = orig;
          v.originals.delete(m);
        }
        continue;
      }
      if (!v.originals.has(m)) v.originals.set(m, m.material);
      const src = v.originals.get(m)!;
      const list = Array.isArray(src) ? src : [src];
      const fade = list.map((mat) => {
        let c = v.clones.get(mat);
        if (!c) {
          c = mat.clone();
          c.transparent = true;
          c.depthWrite = false;
          v.clones.set(mat, c);
          this.owned.push(c);
        }
        c.opacity = (mat.opacity ?? 1) * a;
        return c;
      });
      m.material = Array.isArray(src) ? fade : fade[0];
    }
  }

  /**
   * The engine streams full-resolution textures into its materials after the build; carry them over to our
   * clones (ghost-able context, fading cars).
   */
  syncClones() {
    const pairs: [THREE.Material, THREE.Material][] = [...this.solidClones, ...this.ghostClones, ...this.ghostDepthClones];
    for (const v of this.vehicles) pairs.push(...v.clones);
    for (const [src, dst] of pairs) {
      const a = src as THREE.MeshStandardMaterial, b = dst as THREE.MeshStandardMaterial;
      let recompile = false;
      for (const k of ["map", "normalMap", "roughnessMap", "metalnessMap", "aoMap", "emissiveMap", "alphaMap", "bumpMap"] as const) {
        if (!(k in a)) continue;
        if (a[k] !== b[k]) {
          if (!a[k] !== !b[k]) recompile = true;
          (b as unknown as Record<string, unknown>)[k] = a[k];
        }
      }
      if ("roughness" in a) b.roughness = a.roughness;
      if ("metalness" in a) b.metalness = a.metalness;
      if (recompile) b.needsUpdate = true;
    }
  }

  /** World boxes of every vehicle, shrunk off the floor so the slab under a car stays solid. */
  exclusionBoxes(): THREE.Box3[] {
    return this.vehicles.map((v) => {
      const b = v.box.clone().expandByScalar(0.03);
      b.min.y += 0.06;
      return b;
    });
  }

  dispose() {
    for (const o of this.owned) o.dispose();
    this.owned = [];
    this.solidClones.clear();
    this.ghostClones.clear();
    this.ghostDepthClones.clear();
    this.buildings = [];
    this.vehicles = [];
  }
}
