/**
 * Consolidation: merge static meshes that share (layer, level, material, shadow flags) into single meshes to keep
 * draw calls low. Each merged mesh keeps `userData.parts` (triangle ranges → original tags) so hits can still be
 * resolved to an element (see resolveHit). Also builds position-only collider meshes and the as-built summary.
 */
import * as THREE from "three";
import type { AsBuiltSummary, Vec3 } from "@contracts/api-types";
import type { Layer } from "@contracts/house-sdk";
import { readTags, type ObjTags, type PartRange } from "./tags";
import { FT } from "./util";

interface Src {
  mesh: THREE.Mesh;
  matrix: THREE.Matrix4;
  tags: ObjTags;
  collider: boolean;
}

type BBox = { min: [number, number, number]; max: [number, number, number] };

export interface ConsolidateResult {
  colliders: THREE.Mesh[];
  summary: AsBuiltSummary["objects"];
  mergedMeshes: number;
}

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _nm = new THREE.Matrix3();

function eligible(m: THREE.Mesh): boolean {
  if ((m as THREE.InstancedMesh).isInstancedMesh || (m as THREE.SkinnedMesh).isSkinnedMesh) return false;
  if (Array.isArray(m.material) || !m.material) return false;
  if (m.userData.noMerge) return false;
  const g = m.geometry;
  if (!g || !g.getAttribute("position") || !g.getAttribute("normal") || !g.getAttribute("uv")) return false;
  if (Object.keys(g.morphAttributes).length) return false;
  for (const k of Object.keys(g.attributes)) if (k !== "position" && k !== "normal" && k !== "uv") return false;
  if ((g.getAttribute("position") as unknown as { isInterleavedBufferAttribute?: boolean }).isInterleavedBufferAttribute) return false;
  // geometry groups (BoxGeometry has 6, CylinderGeometry 3, ExtrudeGeometry 2) only pick materials from an array;
  // with one material the renderer draws the whole index (drawRange), so the groups do not matter. Design code builds
  // its arches, roofs and grilles from these primitives: skipping them left hundreds of loose meshes (EN-09).
  if (g.drawRange.start !== 0 || Number.isFinite(g.drawRange.count)) return false;
  return true;
}

function visibleChain(o: THREE.Object3D, stop: THREE.Object3D): boolean {
  let p: THREE.Object3D | null = o;
  while (p && p !== stop) {
    if (!p.visible) return false;
    p = p.parent;
  }
  return true;
}

export function consolidate(root: THREE.Group, colliderGroup: THREE.Group, colliderSet: Set<THREE.Object3D>): ConsolidateResult {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const groups = new Map<string, Src[]>();
  const summary = new Map<string, { id: string; layer: Layer; kind?: string; level?: string; room?: string; bbox: BBox }>();
  const addBox = (tags: ObjTags, bb: BBox) => {
    const id = tags.id ?? "unknown";
    const cur = summary.get(id);
    if (!cur) summary.set(id, { id, layer: tags.layer, kind: tags.kind, level: tags.level, room: tags.room, bbox: { min: [...bb.min], max: [...bb.max] } });
    else
      for (let k = 0; k < 3; k++) {
        cur.bbox.min[k] = Math.min(cur.bbox.min[k], bb.min[k]);
        cur.bbox.max[k] = Math.max(cur.bbox.max[k], bb.max[k]);
      }
  };
  const extraColliders: Src[] = [];
  root.traverse((o) => {
    if (o === colliderGroup || isInside(o, colliderGroup)) return;
    const m = o as THREE.Mesh;
    if (!m.isMesh) {
      // interior lights are listed (they are fixtures in rooms); the sun and sky are not objects of the house
      if ((o as THREE.Light).isLight && o.userData.id && o.userData.kind !== "sun" && o.userData.kind !== "sky") {
        const p = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld).applyMatrix4(inv);
        const pf: [number, number, number] = [p.x / FT, -p.z / FT, p.y / FT];
        addBox(readTags(o), { min: pf, max: [...pf] });
      }
      return;
    }
    const tags = readTags(m);
    const matrix = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
    const isCol = colliderSet.has(m);
    if (!eligible(m) || !visibleChain(m, root)) {
      // still summarize
      const bb = new THREE.Box3().setFromObject(m);
      if (!bb.isEmpty()) addBox(tags, toPlanBox(bb.applyMatrix4(inv)));
      if (isCol) extraColliders.push({ mesh: m, matrix, tags, collider: true });
      return;
    }
    const mat = m.material as THREE.Material;
    const key = `${tags.layer}|${tags.level ?? ""}|${mat.uuid}|${m.castShadow ? 1 : 0}${m.receiveShadow ? 1 : 0}|${m.renderOrder}|${groupOf(m)}`;
    let arr = groups.get(key);
    if (!arr) groups.set(key, (arr = []));
    arr.push({ mesh: m, matrix, tags, collider: isCol });
  });

  const mergedGroup = new THREE.Group();
  mergedGroup.name = "merged";
  mergedGroup.userData = { layer: "structure", kind: "merged", id: "merged", label: "House" };
  let mergedMeshes = 0;
  const colliderSrc: Src[] = [...extraColliders];

  for (const [, arr] of groups) {
    let vCount = 0, iCount = 0;
    for (const s of arr) {
      const g = s.mesh.geometry;
      vCount += g.getAttribute("position").count;
      iCount += g.index ? g.index.count : g.getAttribute("position").count;
    }
    const pos = new Float32Array(vCount * 3), nor = new Float32Array(vCount * 3), uv = new Float32Array(vCount * 2);
    const idx = vCount > 65535 ? new Uint32Array(iCount) : new Uint16Array(iCount);
    const parts: PartRange[] = [];
    let vo = 0, io = 0;
    for (const s of arr) {
      const g = s.mesh.geometry;
      const P = g.getAttribute("position") as THREE.BufferAttribute, N = g.getAttribute("normal") as THREE.BufferAttribute, U = g.getAttribute("uv") as THREE.BufferAttribute;
      _nm.getNormalMatrix(s.matrix);
      const flip = s.matrix.determinant() < 0;
      const bb: BBox = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
      for (let i = 0; i < P.count; i++) {
        _v.fromBufferAttribute(P, i).applyMatrix4(s.matrix);
        _n.fromBufferAttribute(N, i).applyMatrix3(_nm).normalize();
        const k = (vo + i) * 3;
        pos[k] = _v.x; pos[k + 1] = _v.y; pos[k + 2] = _v.z;
        nor[k] = _n.x; nor[k + 1] = _n.y; nor[k + 2] = _n.z;
        uv[(vo + i) * 2] = U.getX(i);
        uv[(vo + i) * 2 + 1] = U.getY(i);
        const px = _v.x / FT, py = -_v.z / FT, ph = _v.y / FT;
        if (px < bb.min[0]) bb.min[0] = px; if (px > bb.max[0]) bb.max[0] = px;
        if (py < bb.min[1]) bb.min[1] = py; if (py > bb.max[1]) bb.max[1] = py;
        if (ph < bb.min[2]) bb.min[2] = ph; if (ph > bb.max[2]) bb.max[2] = ph;
      }
      const triStart = io / 3;
      if (g.index) {
        const I = g.index;
        for (let i = 0; i < I.count; i += 3) {
          const a = I.getX(i) + vo, b = I.getX(i + 1) + vo, c = I.getX(i + 2) + vo;
          idx[io++] = a;
          idx[io++] = flip ? c : b;
          idx[io++] = flip ? b : c;
        }
      } else {
        for (let i = 0; i < P.count; i += 3) {
          idx[io++] = vo + i;
          idx[io++] = vo + (flip ? i + 2 : i + 1);
          idx[io++] = vo + (flip ? i + 1 : i + 2);
        }
      }
      parts.push({ start: triStart, count: io / 3 - triStart, tags: s.tags });
      if (bb.min[0] <= bb.max[0]) addBox(s.tags, bb);
      vo += P.count;
      if (s.collider) colliderSrc.push(s);
    }
    const first = arr[0].mesh;
    let mesh: THREE.Mesh;
    if (arr.length === 1) {
      // keep as is (already a single mesh); just bake the transform for consistency
      mesh = first;
      first.userData.parts = parts;
      continue;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    mesh = new THREE.Mesh(geo, first.material);
    mesh.castShadow = first.castShadow;
    mesh.receiveShadow = first.receiveShadow;
    mesh.renderOrder = first.renderOrder;
    const common = commonTags(arr.map((s) => s.tags));
    mesh.userData = { ...common, parts, merged: true, collide: false };
    if (groupOf(first)) mesh.userData.mergeGroup = groupOf(first);
    mesh.name = `merged:${common.layer}:${common.level ?? ""}:${(first.material as THREE.Material).name}`;
    mergedGroup.add(mesh);
    mergedMeshes++;
    for (const s of arr) {
      s.mesh.parent?.remove(s.mesh);
      if (s.mesh.geometry !== mesh.geometry) s.mesh.geometry.dispose();
    }
  }
  root.add(mergedGroup);
  pruneEmpty(root, colliderGroup);

  // colliders: one position-only mesh per level
  const byLevel = new Map<string, Src[]>();
  for (const s of colliderSrc) {
    // vehicles get their own collider meshes (kind "vehicle") so a viewer can drop them with the cars
    const k = (s.tags.level ?? "_") + (groupOf(s.mesh) === "vehicle" ? "|vehicle" : "");
    byLevel.set(k, [...(byLevel.get(k) ?? []), s]);
  }
  const colliders: THREE.Mesh[] = [];
  for (const [lv, arr] of byLevel) {
    let vCount = 0, iCount = 0;
    for (const s of arr) {
      const g = s.mesh.geometry;
      if (!g.getAttribute("position")) continue;
      vCount += g.getAttribute("position").count;
      iCount += g.index ? g.index.count : g.getAttribute("position").count;
    }
    if (!vCount) continue;
    const pos = new Float32Array(vCount * 3);
    const idx = new Uint32Array(iCount);
    let vo = 0, io = 0;
    for (const s of arr) {
      const g = s.mesh.geometry;
      const P = g.getAttribute("position") as THREE.BufferAttribute;
      if (!P) continue;
      for (let i = 0; i < P.count; i++) {
        _v.fromBufferAttribute(P, i).applyMatrix4(s.matrix);
        pos[(vo + i) * 3] = _v.x; pos[(vo + i) * 3 + 1] = _v.y; pos[(vo + i) * 3 + 2] = _v.z;
      }
      if (g.index) for (let i = 0; i < g.index.count; i++) idx[io++] = g.index.getX(i) + vo;
      else for (let i = 0; i < P.count; i++) idx[io++] = vo + i;
      vo += P.count;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setIndex(new THREE.BufferAttribute(idx.subarray(0, io), 1));
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    const cm = new THREE.Mesh(geo, COLLIDER_MAT);
    cm.visible = false;
    const [lvId, grp] = lv.split("|");
    cm.userData = { layer: grp ? "furniture" : "structure", kind: grp === "vehicle" ? "vehicle" : "collider", level: lvId === "_" ? undefined : lvId, id: `collider_${lv.replace("|", "_")}`, label: grp === "vehicle" ? "Vehicle collider" : "Collider", collide: true };
    colliderGroup.add(cm);
    colliders.push(cm);
  }
  // keep pre-made invisible colliders (ramps/landings)
  for (const c of colliderGroup.children) if ((c as THREE.Mesh).isMesh && !colliders.includes(c as THREE.Mesh)) colliders.push(c as THREE.Mesh);

  const objects = [...summary.values()].map((s) => ({
    id: s.id,
    layer: s.layer,
    kind: s.kind,
    level: s.level,
    room: s.room,
    bbox_ft: { min: s.bbox.min.map(r2) as Vec3, max: s.bbox.max.map(r2) as Vec3 },
  }));
  return { colliders, summary: objects, mergedMeshes };
}

const COLLIDER_MAT = new THREE.MeshBasicMaterial({ visible: false });

/** Optional merge partition hint (e.g. "context" for street/neighbours) found on the mesh or an ancestor. */
function groupOf(o: THREE.Object3D): string {
  let p: THREE.Object3D | null = o;
  while (p) {
    if (p.userData.mergeGroup) return String(p.userData.mergeGroup);
    p = p.parent;
  }
  return "";
}
const r2 = (n: number) => Math.round(n * 100) / 100;

function toPlanBox(b: THREE.Box3): BBox {
  return { min: [b.min.x / FT, -b.max.z / FT, b.min.y / FT], max: [b.max.x / FT, -b.min.z / FT, b.max.y / FT] };
}

function isInside(o: THREE.Object3D, g: THREE.Object3D): boolean {
  let p = o.parent;
  while (p) {
    if (p === g) return true;
    p = p.parent;
  }
  return false;
}

function commonTags(list: ObjTags[]): ObjTags {
  const first = list[0];
  const out: ObjTags = { layer: first.layer };
  const keys: (keyof ObjTags)[] = ["level", "room", "kind", "section"];
  for (const k of keys) {
    const v = first[k];
    if (v !== undefined && list.every((t) => t[k] === v)) (out as unknown as Record<string, unknown>)[k] = v;
  }
  const kinds = new Set(list.map((t) => (t.kind ?? "").split(":")[0]));
  if (!out.kind && kinds.size === 1) out.kind = [...kinds][0] || undefined;
  out.id = `merged_${first.layer}_${first.level ?? "site"}_${(out.kind ?? "mixed").replace(/[^a-z0-9]+/gi, "_")}_${Math.random().toString(36).slice(2, 7)}`;
  out.label = out.room ? list[0].label : `${cap(out.kind ?? first.layer)}${first.level ? "" : ""}`;
  return out;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");

function pruneEmpty(o: THREE.Object3D, keep: THREE.Object3D): void {
  for (const c of [...o.children]) {
    if (c === keep) continue;
    pruneEmpty(c, keep);
    if (!(c as THREE.Mesh).isMesh && !(c as THREE.Light).isLight && c.children.length === 0 && (c.type === "Group" || c.type === "Object3D") && !c.userData.keep) o.remove(c);
  }
}
