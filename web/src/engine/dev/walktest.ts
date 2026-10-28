/**
 * Dev-only walk test: a capsule (r = 0.3 m) driven through waypoints against the build's colliders, using the
 * same shapecast approach as the walkthrough (tech-stack §1.5). Reports where it got to.
 */
import * as THREE from "three";
import { MeshBVH, StaticGeometryGenerator } from "three-mesh-bvh";
import type { BuildResult } from "../index";

const RADIUS = 0.3, EYE = 1.6, GRAVITY = -9.81 * 2, SPEED = 1.4, STEPS = 5;

export function colliderMesh(res: BuildResult): THREE.Mesh {
  const g = new THREE.Group();
  res.root.updateMatrixWorld(true);
  for (const c of res.colliders) {
    const m = new THREE.Mesh(c.geometry);
    m.applyMatrix4(c.matrixWorld);
    g.add(m);
  }
  g.updateMatrixWorld(true);
  const gen = new StaticGeometryGenerator(g);
  gen.attributes = ["position"];
  const geo = gen.generate();
  (geo as unknown as { boundsTree: MeshBVH }).boundsTree = new MeshBVH(geo);
  return new THREE.Mesh(geo);
}

/** Waypoints along every stair ramp (low end → high end), in build order of height. */
export function rampWaypoints(res: BuildResult): THREE.Vector3[] {
  const ramps: { lo: THREE.Vector3; hi: THREE.Vector3 }[] = [];
  for (const c of res.colliders) {
    if (!String(c.userData.kind ?? "").includes("ramp")) continue;
    const p = c.geometry.getAttribute("position") as THREE.BufferAttribute;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < p.count; i++) pts.push(new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(c.matrixWorld));
    pts.sort((a, b) => a.y - b.y);
    // top surface = the 4 highest of each end; take extreme ends
    const lo = pts.slice(0, 4).reduce((a, b) => a.add(b), new THREE.Vector3()).multiplyScalar(0.25);
    const hi = pts.slice(-4).reduce((a, b) => a.add(b), new THREE.Vector3()).multiplyScalar(0.25);
    ramps.push({ lo, hi });
  }
  ramps.sort((a, b) => a.lo.y - b.lo.y);
  const out: THREE.Vector3[] = [];
  for (const r of ramps) {
    const dir = r.hi.clone().sub(r.lo).setY(0).normalize();
    out.push(r.lo.clone().addScaledVector(dir, 0.25), r.hi.clone().addScaledVector(dir, 0.55));
  }
  return out;
}

/** Raycast straight down at a plan point through every collider; returns hit heights (ft) per collider id. */
export function probe(res: BuildResult, xft: number, yft: number): string[] {
  const FT = 0.3048;
  res.root.updateMatrixWorld(true);
  const rc = new THREE.Raycaster(new THREE.Vector3(xft * FT, 40, -yft * FT), new THREE.Vector3(0, -1, 0));
  const out: string[] = [];
  for (const c of res.colliders) {
    const vis = c.visible;
    c.visible = true;
    const hits = rc.intersectObject(c, false);
    c.visible = vis;
    for (const h of hits) out.push(`${c.userData.id ?? c.name}:${(h.point.y / FT).toFixed(2)}`);
  }
  // also visible floor meshes
  res.root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !String(m.userData.kind ?? "").includes("floor")) return;
    for (const h of rc.intersectObject(m, false)) out.push(`render:${m.userData.id}:${(h.point.y / FT).toFixed(2)}`);
  });
  return out;
}

/** Convenience for the console: walk from a plan-ft start point up every stair ramp. */
export function runStairWalk(res: BuildResult, start: [number, number, number], seconds = 120): Record<string, unknown> {
  const FT = 0.3048;
  const col = colliderMesh(res);
  const wps = rampWaypoints(res);
  const r = walk(col, new THREE.Vector3(start[0] * FT, start[2] * FT + 0.02, -start[1] * FT), wps, seconds);
  const f = (v: THREE.Vector3) => [+(v.x / FT).toFixed(1), +(-v.z / FT).toFixed(1), +(v.y / FT).toFixed(2)];
  return { waypoints: wps.map(f), reached: r.reached, of: wps.length, feet: f(r.feet), log: r.log };
}

export function walk(collider: THREE.Mesh, start: THREE.Vector3, waypoints: THREE.Vector3[], maxSeconds = 120): { reached: number; feet: THREE.Vector3; log: string[] } {
  const bvh = (collider.geometry as unknown as { boundsTree: MeshBVH }).boundsTree;
  const feet = start.clone();
  const vel = new THREE.Vector3();
  let onGround = false;
  const seg = new THREE.Line3(), box = new THREE.Box3(), tv = new THREE.Vector3(), tv2 = new THREE.Vector3();
  let wi = 0;
  const log: string[] = [];
  let stuck = 0;
  let last = feet.clone();
  const dt = 1 / 60;
  for (let t = 0; t < maxSeconds && wi < waypoints.length; t += dt) {
    const target = waypoints[wi];
    const to = target.clone().sub(feet).setY(0);
    if (to.length() < 0.25) {
      log.push(`wp${wi} reached at y=${feet.y.toFixed(2)}`);
      wi++;
      continue;
    }
    const move = to.normalize();
    const d = dt / STEPS;
    for (let i = 0; i < STEPS; i++) {
      vel.y = onGround ? Math.max(vel.y, 0) : vel.y + GRAVITY * d;
      feet.addScaledVector(vel, d);
      feet.addScaledVector(move, SPEED * d);
      seg.start.copy(feet).y += RADIUS;
      seg.end.copy(feet).y += EYE - RADIUS;
      box.makeEmpty().expandByPoint(seg.start).expandByPoint(seg.end);
      box.min.addScalar(-RADIUS);
      box.max.addScalar(RADIUS);
      bvh.shapecast({
        intersectsBounds: (b: THREE.Box3) => b.intersectsBox(box),
        intersectsTriangle: (tri: { closestPointToSegment: (s: THREE.Line3, a: THREE.Vector3, b: THREE.Vector3) => number }) => {
          const dist = tri.closestPointToSegment(seg, tv, tv2);
          if (dist < RADIUS) {
            const depth = RADIUS - dist;
            const dir = tv2.sub(tv).normalize();
            seg.start.addScaledVector(dir, depth);
            seg.end.addScaledVector(dir, depth);
          }
          return false;
        },
      } as never);
      const nf = tv.copy(seg.start);
      nf.y -= RADIUS;
      const corr = tv2.subVectors(nf, feet);
      onGround = corr.y > Math.abs(d * vel.y * 0.25);
      const off = Math.max(0, corr.length() - 1e-5);
      corr.normalize().multiplyScalar(off);
      feet.add(corr);
      if (onGround) vel.set(0, 0, 0);
    }
    if (Math.round(t * 60) % 60 === 0) {
      if (feet.distanceTo(last) < 0.05) stuck++;
      else stuck = 0;
      last.copy(feet);
      if (stuck > 3) {
        const miss = waypoints[wi].clone().sub(feet).setY(0).length();
        // (only on the same floor: a waypoint straight above or below is not reached)
        if (miss < 0.9 && Math.abs(waypoints[wi].y - feet.y) < 0.5) {
          log.push(`wp${wi} near-miss (${miss.toFixed(2)} m, wall clearance) at y=${feet.y.toFixed(2)}`);
          wi++;
          stuck = 0;
          continue;
        }
        log.push(`stuck before wp${wi} at (${feet.x.toFixed(2)}, ${feet.y.toFixed(2)}, ${feet.z.toFixed(2)})`);
        break;
      }
    }
    if (feet.y < -10) {
      log.push("fell out of the world");
      break;
    }
  }
  return { reached: wi, feet, log };
}
