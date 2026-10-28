/** Object tagging: every Object3D carries userData = { layer, level, room, kind, id, label }. */
import type * as THREE from "three";
import type { Layer } from "@contracts/house-sdk";

export interface ObjTags {
  layer: Layer;
  level?: string;
  room?: string;
  kind?: string;
  id?: string;
  label?: string;
  /** design.js section that created the object (extra, used by revisions/comments). */
  section?: string;
}

export interface PartRange {
  /** first triangle index (faceIndex as reported by THREE.Raycaster) */
  start: number;
  /** number of triangles */
  count: number;
  tags: ObjTags;
}

const TAG_KEYS = ["layer", "level", "room", "kind", "id", "label", "section"] as const;

/**
 * Apply tags to an object and all its descendants. Existing (more specific) child tags are kept unless
 * `force` is set; the root object always receives the given values.
 */
export function applyTags(obj: THREE.Object3D, tags: Partial<ObjTags>, force = false): void {
  obj.traverse((o) => {
    const ud = o.userData as Record<string, unknown>;
    for (const k of TAG_KEYS) {
      const v = tags[k];
      if (v === undefined) continue;
      if (force || o === obj || ud[k] === undefined) ud[k] = v;
    }
  });
}

export function readTags(o: THREE.Object3D): ObjTags {
  const u = o.userData as Partial<ObjTags>;
  return {
    layer: (u.layer ?? "custom") as Layer,
    level: u.level,
    room: u.room,
    kind: u.kind,
    id: u.id,
    label: u.label,
    section: u.section,
  };
}

/**
 * Resolve the tags for a raycast hit. Merged meshes keep a `userData.parts` table (triangle ranges → tags);
 * plain meshes return their own userData.
 */
export function resolveHit(obj: THREE.Object3D, faceIndex?: number | null): ObjTags {
  const parts = (obj.userData as { parts?: PartRange[] }).parts;
  if (parts && parts.length && faceIndex != null && faceIndex >= 0) {
    let lo = 0;
    let hi = parts.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const p = parts[mid];
      if (faceIndex < p.start) hi = mid - 1;
      else if (faceIndex >= p.start + p.count) lo = mid + 1;
      else return { ...readTags(obj), ...stripUndef(p.tags) };
    }
  }
  return readTags(obj);
}

function stripUndef(t: ObjTags): Partial<ObjTags> {
  const o: Partial<ObjTags> = {};
  for (const k of TAG_KEYS) if (t[k] !== undefined) (o as Record<string, unknown>)[k] = t[k];
  return o;
}
