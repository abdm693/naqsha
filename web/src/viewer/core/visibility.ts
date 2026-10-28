/**
 * Level / layer visibility with a dollhouse rule: once a level is hidden, every level above it is hidden too,
 * and the ceilings of the top visible level are lifted off so you can look into its rooms from above.
 */
import * as THREE from "three";
import type { Layer } from "@contracts/house-sdk";
import type { Level } from "@contracts/plan";
import { isContainer } from "./tags";

export interface VisibilitySpec {
  visibleLevels?: string[];
  layers?: Partial<Record<Layer, boolean>>;
}

export interface LevelBand { id: string; floor_y: number; top_y: number }

/** Effective set of shown level ids, or null = all. */
export function effectiveLevels(planLevels: Level[], visible?: string[]): Set<string> | null {
  if (!visible) return null;
  const want = new Set(visible);
  const out = new Set<string>();
  let seen = false;
  for (const l of [...planLevels].sort((a, b) => a.index - b.index)) {
    if (want.has(l.id)) {
      out.add(l.id);
      seen = true;
    } else if (seen) break; // dollhouse: nothing above a hidden level
  }
  return out;
}

const CEILING_KIND = /(^|[:_])(false_)?ceiling(?!_fan)|(^|:)cove|downlight/;
const SLAB_KIND = /slab|ceiling/;

export class VisibilityController {
  private base = new WeakMap<THREE.Object3D, boolean>();
  private bbox = new WeakMap<THREE.Object3D, THREE.Box3>();
  /** Objects held hidden while they wait for their drop-in animation. */
  held = new WeakSet<THREE.Object3D>();
  /** Objects the viewer hides for its own reasons (cars in walk mode). */
  suppressed = new WeakSet<THREE.Object3D>();

  levelsShown: Set<string> | null = null;
  layersOff = new Set<string>();
  private known = new Set<string>();
  private topVisible: LevelBand | null = null;
  private dollhouse = false;

  configure(spec: VisibilitySpec, planLevels: Level[], bands: LevelBand[]) {
    this.known = new Set(planLevels.map((l) => l.id));
    this.levelsShown = effectiveLevels(planLevels, spec.visibleLevels);
    this.layersOff = new Set(Object.entries(spec.layers ?? {}).filter(([, on]) => on === false).map(([k]) => k));
    this.topVisible = null;
    this.dollhouse = false;
    if (this.levelsShown) {
      const sorted = [...planLevels].sort((a, b) => a.index - b.index);
      const shown = sorted.filter((l) => this.levelsShown!.has(l.id));
      const top = shown[shown.length - 1];
      if (top) {
        this.dollhouse = sorted.some((l) => l.index > top.index);
        this.topVisible = bands.find((b) => b.id === top.id) ?? null;
      }
    }
  }

  /** Is an object hidden by its OWN tags (ignores its `visible` flag)? */
  hiddenByTags(o: THREE.Object3D): boolean {
    // engine containers (a design.js section, the "merged" group that holds every consolidated mesh) carry a layer
    // but contain objects of all layers/levels: only their children are toggled
    if (isContainer(o)) return false;
    const u = o.userData ?? {};
    if (typeof u.layer === "string" && this.layersOff.has(u.layer)) return true;
    if (typeof u.level === "string" && this.levelsShown && this.known.has(u.level) && !this.levelsShown.has(u.level)) return true;
    if (this.dollhouse && this.topVisible) {
      if (u.level === this.topVisible.id) {
        const kind = typeof u.kind === "string" ? u.kind : "";
        if (CEILING_KIND.test(kind) || this.allPartsCeiling(o)) return true;
        if (SLAB_KIND.test(kind) && this.isAboveFloor(o, this.topVisible)) return true;
      } else if (!u.level && (u.layer === "facade" || u.layer === "structure") && (u.kind || u.id)) {
        // full-height facade pieces (piers, fins, cladding) would otherwise stand over the cut-away floors
        const b = this.boxOf(o);
        if (!b.isEmpty() && b.max.y > this.topVisible.top_y + 0.6) return true;
      }
    }
    return false;
  }

  private ceilingParts = new WeakMap<THREE.Object3D, boolean>();

  /** Consolidated meshes (engine `userData.parts`) whose every part is a ceiling/false ceiling/cove. */
  private allPartsCeiling(o: THREE.Object3D) {
    let v = this.ceilingParts.get(o);
    if (v === undefined) {
      const parts = o.userData?.parts as { tags?: { kind?: unknown } }[] | undefined;
      v = Array.isArray(parts) && parts.length > 0 && parts.every((p) => typeof p.tags?.kind === "string" && CEILING_KIND.test(p.tags.kind as string));
      this.ceilingParts.set(o, v);
    }
    return v;
  }

  private boxOf(o: THREE.Object3D) {
    let b = this.bbox.get(o);
    if (!b) {
      o.updateWorldMatrix(true, true);
      b = new THREE.Box3().setFromObject(o, false);
      this.bbox.set(o, b);
    }
    return b;
  }

  private isAboveFloor(o: THREE.Object3D, band: LevelBand) {
    const b = this.boxOf(o);
    return !b.isEmpty() && b.min.y > band.floor_y + 1.2;
  }

  /** Apply to the whole tree under `root`. Cheap enough to run after every section and on every prop change. */
  apply(root: THREE.Object3D) {
    root.traverse((o) => {
      if (o === root) return;
      if (!this.base.has(o)) this.base.set(o, o.visible);
      const baseVisible = this.base.get(o)!;
      o.visible = baseVisible && !this.held.has(o) && !this.suppressed.has(o) && !this.hiddenByTags(o);
    });
  }

  /** Hide or show one object for viewer reasons, respecting every other rule. */
  suppress(o: THREE.Object3D, hidden: boolean) {
    this.remember(o);
    if (hidden) this.suppressed.add(o);
    else this.suppressed.delete(o);
    o.visible = this.baseVisible(o) && !this.held.has(o) && !this.suppressed.has(o) && !this.hiddenByTags(o);
  }

  /** Forget cached state for a subtree that was replaced (bounding boxes moved). */
  reset() {
    this.base = new WeakMap();
    this.bbox = new WeakMap();
  }

  /** Record an object's engine-set visibility before the viewer first touches it. */
  remember(o: THREE.Object3D) {
    if (!this.base.has(o)) this.base.set(o, o.visible);
  }

  /** The original (engine-set) visibility of an object, before any toggles. */
  baseVisible(o: THREE.Object3D) {
    return this.base.has(o) ? this.base.get(o)! : o.visible;
  }

  /**
   * Should this collider take part in walk physics? Only the viewer's own level/layer toggles disable it — colliders
   * are invisible by design and engines often hide their whole collider group, so `visible` is ignored here.
   */
  colliderEnabled(m: THREE.Object3D, root: THREE.Object3D | null): boolean {
    let p: THREE.Object3D | null = m;
    while (p && p !== root) {
      if (this.hiddenByTags(p)) return false;
      p = p.parent;
    }
    return true;
  }
}
