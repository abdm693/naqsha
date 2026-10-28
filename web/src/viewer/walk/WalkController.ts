/**
 * First-person walk physics (imperative, no React). Capsule vs one merged BVH (three-mesh-bvh), sub-stepped.
 *
 * Adapted from the tested controller in docs/research/tech-stack.md §1.5, with one change that makes stairs and
 * thresholds feel smooth: walls are resolved by a capsule that starts STEP_UP above the feet (horizontal push-out
 * only), while the feet follow the floor through short downward BVH raycasts. Steps < STEP_UP and the engine's
 * invisible stair ramps are climbed without bumps, gravity takes over beyond SNAP_DOWN, and the 1e-5 epsilon from
 * the research notes stops float noise from cancelling gravity.
 *
 * Besides walking it runs two scripted camera moves: the fly-in from orbit (`transition`) and the room navigator's
 * glide (`glide`), which carries the walker along a precomputed path through doors and up stairs.
 */
import * as THREE from "three";
import type { MeshBVH } from "three-mesh-bvh";
import { clamp, damp, easeInOutCubic, smoothstep } from "../core/units";

export const RADIUS = 0.28; // capsule radius (m): 2.5 ft doors (~0.66 m clear inside frames) pass comfortably
export const EYE = 1.6; // eye height (m)
export const HEAD = 1.78; // top of the capsule
export const STEP_UP = 0.36; // highest step climbed without a ramp (plinth/threshold/stair riser)
/** Solids (furniture, fixtures, roof equipment, shown cars) block from just above the floor. */
const SOLID_FROM = 0.03;
const SNAP_DOWN = 0.5; // follow floors/ramps downward up to this much per frame while grounded
const WALK = 1.5; // m/s
const RUN = 3.0; // m/s
const GRAVITY = -9.81 * 1.8;
const ACCEL = 11; // velocity smoothing (1/s)
/** Radians per pixel of pointer-locked mouse movement (a typical FPS sensitivity). */
export const LOCK_SENS = 0.0022;
/** Radians per CSS pixel for drag-to-look (a 500 px drag turns ~95°). */
export const DRAG_SENS = 0.0033;
const MAX_PITCH = THREE.MathUtils.degToRad(84);

export interface WalkInput {
  keys: Set<string>;
  joy: { x: number; y: number }; // touch joystick, −1..1 (y = forward)
  look: { dx: number; dy: number }; // accumulated radians since the last frame (already scaled by sensitivity)
  /** Continuous turn rate (rad/s), e.g. hover-at-the-edge look. */
  turn: { yaw: number; pitch: number };
}

export interface WalkTransition {
  fromPos: THREE.Vector3;
  fromQuat: THREE.Quaternion;
  fromFov: number;
  t: number;
  dur: number;
}

/** A scripted walk along a path of feet positions (world, m). */
export interface Glide {
  pts: THREE.Vector3[];
  /** cumulative TIME-length (segment length × weight): the glide advances uniformly along this */
  cum: number[];
  total: number;
  t: number;
  dur: number;
  yaw0: number;
  pitch0: number;
  yaw1: number;
  pitch1: number;
  onDone?: (completed: boolean) => void;
  onProgress?: (s: number, total: number) => void;
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _seg = new THREE.Line3();
const _box = new THREE.Box3();
const _ray = new THREE.Ray();
const _euler = new THREE.Euler(0, 0, 0, "YXZ");
const _q = new THREE.Quaternion();
const _push = new THREE.Vector3();
const _before = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);

/** Shortest signed angle from a to b. */
export function angleDelta(a: number, b: number) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** CSS cubic-bezier(x1, y1, x2, y2) easing, solved for x by Newton iterations (DESIGN --ease-camera = .65,0,.35,1). */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const e = sx(t) - x;
      if (Math.abs(e) < 1e-5) break;
      const d = dx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    return sy(clamp(t, 0, 1));
  };
}
export const easeCamera = cubicBezier(0.65, 0, 0.35, 1);

export class WalkController {
  feet = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  /** Look targets: mouse input moves these, the view follows with a little smoothing (`lookLag`). */
  private yawGoal = 0;
  private pitchGoal = 0;
  /** Smoothing rate for look (1/s); Infinity = raw. Drag-to-look uses a softer value than pointer lock. */
  lookLag = 38;
  vel = new THREE.Vector3();
  vy = 0;
  grounded = false;
  camY = 0;
  bvh: MeshBVH | null = null;
  /** furniture, fixtures, roof equipment, shown cars: obstacles from the floor up, never ground */
  solid: MeshBVH | null = null;
  spawn = { feet: new THREE.Vector3(), yaw: 0, pitch: 0 };
  transition: WalkTransition | null = null;
  glide: Glide | null = null;
  fov = 70;
  input: WalkInput = { keys: new Set(), joy: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, turn: { yaw: 0, pitch: 0 } };
  /** true while the player is allowed to move. */
  enabled = false;
  private hasPose = false;

  /**
   * `bvh`: floors, stairs, ramps, thresholds and walls (the feet follow only this). `solid`: furniture, fixtures,
   * roof equipment and shown cars, solid from the floor up and never walked on.
   */
  setCollider(bvh: MeshBVH | null, solid: MeshBVH | null = null) {
    this.bvh = bvh;
    this.solid = solid;
  }

  /** First hit along a ray in either collider (distance), or null. */
  raycastAny(ray: THREE.Ray, near: number, far: number): number | null {
    let best: number | null = null;
    for (const b of [this.bvh, this.solid]) {
      if (!b) continue;
      const hit = b.raycastFirst(ray, THREE.DoubleSide, near, far);
      if (hit && (best === null || hit.distance < best)) best = hit.distance;
    }
    return best;
  }

  /** Snap the look goal to the current view (after scripted moves). */
  syncLook() {
    this.yawGoal = this.yaw;
    this.pitchGoal = this.pitch;
  }

  setLook(yaw: number, pitch: number) {
    this.yaw = this.yawGoal = yaw;
    this.pitch = this.pitchGoal = clamp(pitch, -MAX_PITCH, MAX_PITCH);
  }

  /** Highest walkable surface under (x, z) between `top` and `bottom` (world Y), sampled at 5 points. */
  groundAt(p: THREE.Vector3, top: number, bottom: number): number | null {
    if (!this.bvh) return null;
    let best: number | null = null;
    const r = RADIUS * 0.55;
    const offs = [0, 0, r, 0, -r, 0, 0, r, 0, -r];
    for (let i = 0; i < offs.length; i += 2) {
      _ray.origin.set(p.x + offs[i], top, p.z + offs[i + 1]);
      _ray.direction.copy(DOWN);
      const hit = this.bvh.raycastFirst(_ray, THREE.DoubleSide, 0, top - bottom);
      if (hit && (best === null || hit.point.y > best)) best = hit.point.y;
    }
    return best;
  }

  /** One downward ray at (x, z): the first surface between `top` and `bottom`. */
  groundAt1(x: number, z: number, top: number, bottom: number): number | null {
    if (!this.bvh) return null;
    _ray.origin.set(x, top, z);
    _ray.direction.copy(DOWN);
    const hit = this.bvh.raycastFirst(_ray, THREE.DoubleSide, 0, top - bottom);
    return hit ? hit.point.y : null;
  }

  /** Horizontal free distance from `from` along `dir` (unit, y ignored), up to `max`. */
  clearDistance(from: THREE.Vector3, dir: THREE.Vector3, max: number): number {
    if (!this.bvh) return max;
    _ray.origin.copy(from);
    _ray.direction.set(dir.x, 0, dir.z).normalize();
    return this.raycastAny(_ray, 0, max) ?? max;
  }

  /** Would a capsule (radius `r`) standing at `feet` overlap walls or furniture? */
  overlaps(feet: THREE.Vector3, r = RADIUS): boolean {
    if (!this.bvh) return false;
    // walls etc. from step height up (steps and thresholds are walked over); solids from the floor up
    return this.capsuleHits(this.bvh, feet, STEP_UP, r) || (!!this.solid && this.capsuleHits(this.solid, feet, SOLID_FROM, r));
  }

  /** What a capsule at `feet` overlaps: 0 nothing, 1 walls and other structure, 2 only solids (furniture, planting…). */
  overlapKind(feet: THREE.Vector3, r = RADIUS): 0 | 1 | 2 {
    if (!this.bvh) return 0;
    if (this.capsuleHits(this.bvh, feet, STEP_UP, r)) return 1;
    return this.solid && this.capsuleHits(this.solid, feet, SOLID_FROM, r) ? 2 : 0;
  }

  private capsuleHits(bvh: MeshBVH, feet: THREE.Vector3, from: number, r: number): boolean {
    _seg.start.set(feet.x, feet.y + from + r, feet.z);
    _seg.end.set(feet.x, feet.y + HEAD - r, feet.z);
    _box.makeEmpty().expandByPoint(_seg.start).expandByPoint(_seg.end);
    _box.min.addScalar(-r + 0.02);
    _box.max.addScalar(r - 0.02);
    let hit = false;
    bvh.shapecast({
      intersectsBounds: (box) => box.intersectsBox(_box),
      intersectsTriangle: (tri) => {
        if (tri.closestPointToSegment(_seg, _v, _v2) < r - 0.02) {
          hit = true;
          return true;
        }
      },
    });
    return hit;
  }

  /**
   * Nearest free standing spot to `pos` on the floor at ~`floorY` (spiral search, ≤ `maxR` m). Engines sometimes put
   * the spawn on a parked car or a planter; this keeps the walkthrough from starting on a roof or inside a wall.
   */
  findFreeSpot(pos: THREE.Vector3, floorY: number, maxR = 3): THREE.Vector3 | null {
    const p = new THREE.Vector3();
    for (let r = 0; r <= maxR + 1e-4; r += 0.2) {
      const n = r === 0 ? 1 : Math.ceil((2 * Math.PI * r) / 0.3);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        p.set(pos.x + Math.cos(a) * r, floorY, pos.z + Math.sin(a) * r);
        const g = this.groundAt(p, floorY + STEP_UP + 0.02, floorY - 0.6);
        if (g === null || Math.abs(g - floorY) > 0.3) continue;
        p.y = g;
        if (!this.overlaps(p)) return p.clone();
      }
    }
    return null;
  }

  /**
   * Place the walker (feet on the floor below `pos`, nudged to a free spot) looking at `lookAt`.
   * `preferFloorY` (e.g. the plan level's finished floor) wins over whatever the probe hits first (a car roof…).
   */
  teleport(pos: THREE.Vector3, lookAt?: THREE.Vector3, preferFloorY?: number) {
    const floor = this.groundAt(pos, pos.y + 0.3, pos.y - 3);
    let spot: THREE.Vector3 | null = null;
    if (preferFloorY !== undefined) spot = this.findFreeSpot(pos, preferFloorY);
    if (!spot && floor !== null) spot = this.findFreeSpot(pos, floor);
    const g = spot ? spot.y : floor;
    this.feet.set(spot?.x ?? pos.x, g ?? pos.y, spot?.z ?? pos.z);
    if (lookAt) {
      _v.subVectors(lookAt, _v2.set(this.feet.x, this.feet.y + EYE, this.feet.z));
      this.setLook(Math.atan2(-_v.x, -_v.z), clamp(Math.atan2(_v.y, Math.hypot(_v.x, _v.z)), -0.5, 0.5));
    }
    this.vel.set(0, 0, 0);
    this.vy = 0;
    this.grounded = g !== null;
    this.camY = this.feet.y + EYE;
    this.hasPose = true;
  }

  setSpawn(pos: THREE.Vector3, lookAt: THREE.Vector3, preferFloorY?: number) {
    this.teleport(pos, lookAt, preferFloorY);
    this.spawn.feet.copy(this.feet);
    this.spawn.yaw = this.yaw;
    this.spawn.pitch = this.pitch;
  }

  /** Stand exactly here (already validated), looking along yaw/pitch. */
  place(feet: THREE.Vector3, yaw: number, pitch: number) {
    this.feet.copy(feet);
    this.setLook(yaw, pitch);
    this.vel.set(0, 0, 0);
    this.vy = 0;
    this.grounded = true;
    this.camY = feet.y + EYE;
    this.hasPose = true;
  }

  get ready() {
    return this.hasPose;
  }

  respawn() {
    this.feet.copy(this.spawn.feet);
    this.setLook(this.spawn.yaw, this.spawn.pitch);
    this.vel.set(0, 0, 0);
    this.vy = 0;
    this.camY = this.feet.y + EYE;
  }

  /** Eased fly-in from the current camera pose to the walker's eye. */
  beginTransition(camera: THREE.PerspectiveCamera, dur = 1.1) {
    this.glide = null;
    this.transition = { fromPos: camera.position.clone(), fromQuat: camera.quaternion.clone(), fromFov: camera.fov, t: 0, dur };
  }

  /**
   * Walk the camera along `pts` (feet positions, ≥ 2) in `dur` seconds with the DESIGN camera ease, looking ahead
   * along the path and settling on (yaw1, pitch1). Movement keys cancel it (`onDone(false)`).
   */
  beginGlide(pts: THREE.Vector3[], dur: number, yaw1: number, pitch1: number, onDone?: (completed: boolean) => void, onProgress?: (s: number, total: number) => void, weights?: number[]) {
    if (pts.length < 2) {
      if (pts[0]) this.place(pts[0], yaw1, pitch1);
      onDone?.(true);
      return;
    }
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]) * (weights?.[i] ?? 1));
    this.transition = null;
    this.vel.set(0, 0, 0);
    this.vy = 0;
    this.glide = { pts, cum, total: cum[cum.length - 1], t: 0, dur: Math.max(0.05, dur), yaw0: this.yaw, pitch0: this.pitch, yaw1, pitch1, onDone, onProgress };
  }

  /** Stop a glide where it is (the walker keeps standing there). */
  cancelGlide() {
    const g = this.glide;
    if (!g) return;
    this.glide = null;
    this.grounded = true;
    this.vel.set(0, 0, 0);
    this.syncLook();
    g.onDone?.(false);
  }

  eyePosition(out: THREE.Vector3) {
    return out.set(this.feet.x, this.camY, this.feet.z);
  }

  eyeQuaternion(out: THREE.Quaternion) {
    _euler.set(this.pitch, this.yaw, 0, "YXZ");
    return out.setFromEuler(_euler);
  }

  private pointAt(g: Glide, s: number, out: THREE.Vector3) {
    const { pts, cum } = g;
    if (s <= 0) return out.copy(pts[0]);
    if (s >= g.total) return out.copy(pts[pts.length - 1]);
    let lo = 0, hi = cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= s) lo = mid;
      else hi = mid;
    }
    const span = cum[hi] - cum[lo] || 1;
    return out.lerpVectors(pts[lo], pts[hi], (s - cum[lo]) / span);
  }

  private updateGlide(dt: number, camera: THREE.PerspectiveCamera) {
    const g = this.glide!;
    // any movement key takes control back
    if (this.input.keys.size && [...this.input.keys].some((k) => k !== "ShiftLeft" && k !== "ShiftRight")) {
      this.cancelGlide();
      return true;
    }
    const moving = g.t < 1;
    if (moving) {
      g.t = Math.min(1, g.t + dt / g.dur);
      const s = easeCamera(g.t) * g.total;
      this.pointAt(g, s, this.feet);
      // look ahead along the path (time-length ≈ metres on floors); settle on the final view over the last stretch
      const ahead = this.pointAt(g, Math.min(g.total, s + 1.6), _v3);
      const dx = ahead.x - this.feet.x, dz = ahead.z - this.feet.z;
      const hd = Math.hypot(dx, dz);
      let pathYaw = this.yaw, pathPitch = 0;
      if (hd > 0.08) {
        pathYaw = Math.atan2(-dx, -dz);
        pathPitch = clamp(Math.atan2(ahead.y - this.feet.y, hd) * 0.5, -0.3, 0.3);
      }
      const settle = smoothstep(0.6, 0.96, g.t);
      const start = smoothstep(0, 0.16, g.t);
      let yaw = g.yaw0 + angleDelta(g.yaw0, pathYaw) * start;
      yaw = yaw + angleDelta(yaw, g.yaw1) * settle;
      let pitch = g.pitch0 + (pathPitch - g.pitch0) * start;
      pitch = pitch + (g.pitch1 - pitch) * settle;
      this.turnToward(yaw, pitch, dt);
      g.onProgress?.(s, g.total);
    } else {
      // arrived: finish turning to face the room at a calm pace
      this.turnToward(g.yaw1, g.pitch1, dt);
    }
    this.camY = this.feet.y + EYE;
    camera.position.set(this.feet.x, this.camY, this.feet.z);
    camera.quaternion.copy(this.eyeQuaternion(_q));
    camera.updateMatrixWorld();
    if (!moving && Math.abs(angleDelta(this.yaw, g.yaw1)) < 0.01 && Math.abs(this.pitch - g.pitch1) < 0.01) {
      this.glide = null;
      this.yaw = g.yaw1;
      this.pitch = g.pitch1;
      this.syncLook();
      this.grounded = true;
      this.vel.set(0, 0, 0);
      camera.quaternion.copy(this.eyeQuaternion(_q));
      camera.updateMatrixWorld();
      g.onDone?.(true);
    }
    return true;
  }

  /** Ease the view toward (yaw, pitch), never faster than a comfortable head turn (~150°/s). */
  private turnToward(yaw: number, pitch: number, dt: number) {
    const k = damp(7, dt);
    const maxStep = 2.6 * dt;
    const dy = clamp(angleDelta(this.yaw, yaw) * k, -maxStep, maxStep);
    const dp = clamp((pitch - this.pitch) * k, -maxStep * 0.6, maxStep * 0.6);
    // close enough: land exactly (no endless approach)
    this.yaw += Math.abs(angleDelta(this.yaw, yaw)) < 0.004 ? angleDelta(this.yaw, yaw) : dy;
    this.pitch += Math.abs(pitch - this.pitch) < 0.004 ? pitch - this.pitch : dp;
  }

  /** Advance one frame and write the camera. Returns true while something moved. */
  update(dt: number, camera: THREE.PerspectiveCamera): boolean {
    dt = Math.min(dt, 0.1);
    if (this.transition) return this.updateTransition(dt, camera);
    if (this.glide) return this.updateGlide(dt, camera);

    // look: input moves the goal, the view follows (frame-rate independent)
    const { look, keys, joy, turn } = this.input;
    if (this.enabled) {
      this.yawGoal -= look.dx + turn.yaw * dt;
      this.pitchGoal = clamp(this.pitchGoal - look.dy - turn.pitch * dt, -MAX_PITCH, MAX_PITCH);
    }
    look.dx = 0;
    look.dy = 0;
    const lk = Number.isFinite(this.lookLag) ? damp(this.lookLag, dt) : 1;
    const dyaw = angleDelta(this.yaw, this.yawGoal);
    const turning = Math.abs(dyaw) > 1e-5 || Math.abs(this.pitchGoal - this.pitch) > 1e-5;
    this.yaw += dyaw * lk;
    this.pitch += (this.pitchGoal - this.pitch) * lk;

    // wish direction from keys + joystick, relative to yaw
    let f = 0, s = 0;
    if (this.enabled) {
      if (keys.has("KeyW") || keys.has("ArrowUp")) f += 1;
      if (keys.has("KeyS") || keys.has("ArrowDown")) f -= 1;
      if (keys.has("KeyD") || keys.has("ArrowRight")) s += 1;
      if (keys.has("KeyA") || keys.has("ArrowLeft")) s -= 1;
      f += joy.y;
      s += joy.x;
    }
    const len = Math.hypot(f, s);
    if (len > 1) { f /= len; s /= len; }
    const run = keys.has("ShiftLeft") || keys.has("ShiftRight") || Math.hypot(joy.x, joy.y) > 0.92;
    const speed = run ? RUN : WALK;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    // forward = (−sin, 0, −cos), right = (cos, 0, −sin)
    const wx = (-sin * f + cos * s) * speed;
    const wz = (-cos * f - sin * s) * speed;
    const k = damp(ACCEL, dt);
    this.vel.x += (wx - this.vel.x) * k;
    this.vel.z += (wz - this.vel.z) * k;
    if (Math.abs(this.vel.x) < 1e-4) this.vel.x = 0;
    if (Math.abs(this.vel.z) < 1e-4) this.vel.z = 0;

    const before = _before.copy(this.feet);
    const moveLen = Math.hypot(this.vel.x, this.vel.z) * dt;
    if (this.bvh) {
      const steps = clamp(Math.ceil(moveLen / 0.035), 1, 10);
      for (let i = 0; i < steps; i++) {
        const px = this.feet.x, pz = this.feet.z;
        this.feet.x += (this.vel.x * dt) / steps;
        this.feet.z += (this.vel.z * dt) / steps;
        this.resolveWalls();
        if (this.grounded) this.guardEdge(px, pz);
      }
      this.followFloor(dt);
    } else {
      this.feet.x += this.vel.x * dt;
      this.feet.z += this.vel.z * dt;
    }
    // walls ate the motion: kill velocity along the blocked axis so we don't "stick"
    if (moveLen > 1e-5 && dt > 0) {
      const realX = (this.feet.x - before.x) / dt, realZ = (this.feet.z - before.z) / dt;
      this.vel.x = Math.abs(realX) < Math.abs(this.vel.x) ? realX : this.vel.x;
      this.vel.z = Math.abs(realZ) < Math.abs(this.vel.z) ? realZ : this.vel.z;
    }
    if (this.feet.y < -25) this.respawn();

    // camera: smooth vertical motion over steps, exact when falling
    const eye = this.feet.y + EYE;
    const dy = eye - this.camY;
    this.camY = Math.abs(dy) > 0.9 || !this.grounded ? eye : this.camY + dy * damp(16, dt);
    camera.position.set(this.feet.x, this.camY, this.feet.z);
    camera.quaternion.copy(this.eyeQuaternion(_q));
    camera.updateMatrixWorld();
    return moveLen > 1e-5 || Math.abs(dy) > 1e-4 || !this.grounded || turning;
  }

  private updateTransition(dt: number, camera: THREE.PerspectiveCamera) {
    const tr = this.transition!;
    tr.t = Math.min(1, tr.t + dt / tr.dur);
    const e = easeInOutCubic(tr.t);
    this.camY = this.feet.y + EYE;
    const toPos = this.eyePosition(_v);
    // arc slightly upward mid-flight so we don't clip through the porch roof
    camera.position.lerpVectors(tr.fromPos, toPos, e);
    camera.position.y += Math.sin(e * Math.PI) * 1.2 * Math.max(0, 1 - toPos.distanceTo(tr.fromPos) / 60);
    camera.quaternion.slerpQuaternions(tr.fromQuat, this.eyeQuaternion(_q), e);
    camera.fov = tr.fromFov + (this.fov - tr.fromFov) * e;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    if (tr.t >= 1) {
      this.transition = null;
      this.syncLook();
    }
    return true;
  }

  /**
   * Safety net: never step off an edge into a drop (an unguarded stairwell, a balcony without its railing yet, the
   * roof's edge). If the ground is gone under the new position, slide along the edge, or stay put.
   */
  private guardEdge(px: number, pz: number) {
    const top = this.feet.y + STEP_UP + 0.02, bottom = this.feet.y - SNAP_DOWN - 0.05;
    if (this.groundAt(this.feet, top, bottom) !== null) return;
    const nx = this.feet.x, nz = this.feet.z;
    this.feet.set(nx, this.feet.y, pz);
    if (this.groundAt(this.feet, top, bottom) !== null) {
      this.vel.z = 0;
      return;
    }
    this.feet.set(px, this.feet.y, nz);
    if (this.groundAt(this.feet, top, bottom) !== null) {
      this.vel.x = 0;
      return;
    }
    this.feet.set(px, this.feet.y, pz);
    this.vel.x = this.vel.z = 0;
  }

  /**
   * Horizontal capsule push-out against everything that isn't floor/ceiling-like: walls from step height up (so
   * stair risers and thresholds are stepped over), solids (furniture, roof equipment, shown cars) from the floor up.
   */
  private resolveWalls() {
    this.pushOut(this.bvh!, STEP_UP);
    if (this.solid) this.pushOut(this.solid, SOLID_FROM);
  }

  private pushOut(bvh: MeshBVH, from: number) {
    _seg.start.set(this.feet.x, this.feet.y + from + RADIUS, this.feet.z);
    _seg.end.set(this.feet.x, this.feet.y + HEAD - RADIUS, this.feet.z);
    for (let iter = 0; iter < 3; iter++) {
      _box.makeEmpty().expandByPoint(_seg.start).expandByPoint(_seg.end);
      _box.min.addScalar(-RADIUS);
      _box.max.addScalar(RADIUS);
      let moved = false;
      bvh.shapecast({
        intersectsBounds: (box) => box.intersectsBox(_box),
        intersectsTriangle: (tri) => {
          const triPoint = _v, capPoint = _v2;
          const d = tri.closestPointToSegment(_seg, triPoint, capPoint);
          if (d >= RADIUS) return;
          _push.subVectors(capPoint, triPoint);
          _push.y = 0;
          let h = _push.length();
          if (h < 1e-6) {
            // segment touches the triangle: fall back to its normal
            tri.getNormal(_push);
            _push.y = 0;
            h = _push.length();
          }
          if (h < 0.2 * Math.max(d, 1e-6) || h < 1e-6) return; // floor/ceiling-like contact: the floor follower owns Y
          const depth = RADIUS - d;
          _push.multiplyScalar(depth / h);
          _seg.start.add(_push);
          _seg.end.add(_push);
          moved = true;
        },
      });
      if (!moved) break;
    }
    const nx = _seg.start.x, nz = _seg.start.z;
    const dx = nx - this.feet.x, dz = nz - this.feet.z;
    const off = Math.hypot(dx, dz);
    if (off > 1e-5) {
      const s = Math.max(0, off - 1e-5) / off; // ignore float noise (research note: required)
      this.feet.x += dx * s;
      this.feet.z += dz * s;
    }
  }

  private followFloor(dt: number) {
    const top = this.feet.y + STEP_UP + 0.02;
    if (this.grounded) {
      const g = this.groundAt(this.feet, top, this.feet.y - SNAP_DOWN);
      if (g !== null) {
        this.feet.y = g;
        this.vy = 0;
        return;
      }
      this.grounded = false;
    }
    // airborne
    this.vy += GRAVITY * dt;
    const nextY = this.feet.y + this.vy * dt;
    const g = this.groundAt(this.feet, top, Math.min(nextY, this.feet.y) - 0.05);
    if (g !== null && nextY <= g + 1e-5) {
      this.feet.y = g;
      this.vy = 0;
      this.grounded = true;
    } else this.feet.y = nextY;
  }
}
