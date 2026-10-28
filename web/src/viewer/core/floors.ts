/**
 * Orbit floor focus motion (DESIGN "Floor stack · In Orbit: the floors above lift 1.5 m and fade (420 ms)").
 *
 * Hiding: the floors above are hidden at once and a translucent clay stand-in of them (same geometry, one shared
 * material, so no per-material shader variants) lifts 1.5 m while it fades out.
 * Showing: the real floors come back lifted and settle into place.
 */
import * as THREE from "three";
import type { Level } from "@contracts/plan";
import { easeOutCubic, smoothstep } from "./units";

/** "G", "1", "2", "R", "B": the floor stack's own short names (the app's floor stack, the minimap and walk keys). */
export function levelShort(l: Level, levels: Level[]): string {
  const sorted = [...levels].sort((a, b) => a.index - b.index);
  if (/roof/i.test(l.id) || /roof/i.test(l.name) || (l === sorted[sorted.length - 1] && sorted.length > 1 && !/floor/i.test(l.name))) return "R";
  if (l.index < 0) return "B";
  if (l.index === 0) return "G";
  return String(l.index);
}

/** Every floor's short name, ground first ("G", "1", "R"). */
export function levelShorts(levels: Level[]): string[] {
  const sorted = [...levels].sort((a, b) => a.index - b.index);
  return sorted.map((l) => levelShort(l, sorted));
}

/**
 * The floor a key names, by the same labels the floor stack shows: G (or 0) the ground floor, 1–9 the floor labelled
 * so, R the roof, B the basement (the one nearest the ground). Null when no floor carries that label.
 */
export function levelForKey(code: string, levels: Level[]): Level | null {
  const digit = /^(?:Digit|Numpad)([0-9])$/.exec(code)?.[1];
  const label = digit != null ? (digit === "0" ? "G" : digit) : code === "KeyG" ? "G" : code === "KeyR" ? "R" : code === "KeyB" ? "B" : null;
  if (!label) return null;
  const sorted = [...levels].sort((a, b) => a.index - b.index);
  const hits = sorted.filter((l) => levelShort(l, sorted) === label);
  // basements count down from the ground; any other label names the lowest floor that carries it
  return (label === "B" ? hits[hits.length - 1] : hits[0]) ?? null;
}

/** A number key (top row or keypad): it always means a floor, so one no floor carries deserves an answer. */
export function isFloorNumberKey(code: string): boolean {
  return /^(?:Digit|Numpad)[0-9]$/.test(code);
}

/** "G, 1 and R": the floor stack's labels, ground first, as a phrase. */
export function floorList(levels: Level[]): string {
  const keys = levelShorts(levels).filter((k, i, all) => all.indexOf(k) === i);
  return keys.length > 1 ? `${keys.slice(0, -1).join(", ")} and ${keys[keys.length - 1]}` : (keys[0] ?? "one floor");
}

const LIFT = 1.5;
const DUR = 420;

const CLAY = new THREE.MeshLambertMaterial({ color: "#e4dfd6", transparent: true, opacity: 0.8, depthWrite: true });
CLAY.name = "nq-floor-lift";

interface Out {
  group: THREE.Group;
  start: number;
}
interface In {
  objs: { o: THREE.Object3D; y: number }[];
  start: number;
}

export class FloorLift {
  private outs: Out[] = [];
  private ins: In[] = [];

  get active() {
    return this.outs.length > 0 || this.ins.length > 0;
  }

  /** Stand-ins for `meshes` (currently visible, about to be hidden) that lift and fade. */
  liftAway(meshes: THREE.Mesh[], parent: THREE.Object3D) {
    if (!meshes.length) return;
    const group = new THREE.Group();
    group.name = "nq-floor-lift";
    group.userData = { noPick: true, viewer: "lift" };
    for (const m of meshes) {
      if ((m as THREE.InstancedMesh).isInstancedMesh || !m.geometry) continue;
      m.updateWorldMatrix(true, false);
      const g = new THREE.Mesh(m.geometry, CLAY);
      g.matrixAutoUpdate = false;
      g.matrix.copy(m.matrixWorld);
      g.userData = { noPick: true, viewer: "lift" };
      group.add(g);
    }
    group.matrixAutoUpdate = true;
    parent.add(group);
    this.outs.push({ group, start: performance.now() });
  }

  /** Real objects that just became visible: start them lifted and settle them. */
  settleIn(objs: THREE.Object3D[]) {
    if (!objs.length) return;
    const list = objs.map((o) => ({ o, y: o.position.y }));
    for (const it of list) {
      it.o.position.y = it.y + LIFT;
      it.o.updateMatrix();
    }
    this.ins.push({ objs: list, start: performance.now() });
  }

  /** Advance; returns true while anything moved. */
  tick(now: number): boolean {
    if (!this.active) return false;
    let w = 0;
    for (const a of this.outs) {
      const t = Math.min(1, (now - a.start) / DUR);
      const e = easeOutCubic(t);
      a.group.position.y = LIFT * e;
      // rise first, then dissolve
      CLAY.opacity = 0.8 * (1 - smoothstep(0.2, 1, t));
      if (t < 1) this.outs[w++] = a;
      else a.group.removeFromParent();
    }
    this.outs.length = w;
    w = 0;
    for (const a of this.ins) {
      const t = Math.min(1, (now - a.start) / DUR);
      const e = easeOutCubic(t);
      for (const it of a.objs) {
        it.o.position.y = it.y + LIFT * (1 - e);
        it.o.updateMatrix();
      }
      if (t < 1) this.ins[w++] = a;
    }
    this.ins.length = w;
    return true;
  }

  /** Snap everything to rest (before captures, rebuilds, walking). */
  finish() {
    for (const a of this.outs) a.group.removeFromParent();
    this.outs.length = 0;
    for (const a of this.ins)
      for (const it of a.objs) {
        it.o.position.y = it.y;
        it.o.updateMatrix();
      }
    this.ins.length = 0;
  }
}
