/** Camera framing: the hero 3/4 aerial front view and helpers. World mapping: x = x_ft, z = −y_ft (road at +z). */
import * as THREE from "three";
import type { BuildingPlan } from "@contracts/plan";
import { planToWorld } from "./units";

/** World box of the plot, from the road edge up to the top of the mumty/parapet. */
export function plotBox(plan: BuildingPlan): THREE.Box3 {
  const { width_ft: W, depth_ft: D } = plan.site.plot;
  const top = Math.max(...plan.levels.map((l) => l.elevation_ft + l.height_ft), 10) + (plan.roof?.mumty?.height_ft ?? 0) * 0.6;
  return new THREE.Box3().setFromPoints([planToWorld(0, 0, 0), planToWorld(W, D, top)]);
}

/** Box of the built footprint (enclosed rooms), used to focus shadows and the orbit target. */
export function houseBox(plan: BuildingPlan): THREE.Box3 {
  const outdoor = new Set(["lawn", "driveway", "open_space", "courtyard"]);
  const rooms = plan.rooms.filter((r) => !outdoor.has(r.type));
  const b = new THREE.Box3();
  for (const r of rooms) {
    b.expandByPoint(planToWorld(r.rect.x, r.rect.y, 0));
    b.expandByPoint(planToWorld(r.rect.x + r.rect.w, r.rect.y + r.rect.d, 0));
  }
  if (b.isEmpty()) return plotBox(plan);
  b.max.y = plotBox(plan).max.y;
  return b;
}

const _v = new THREE.Vector3();

function fits(camera: THREE.PerspectiveCamera, corners: THREE.Vector3[], pos: THREE.Vector3, target: THREE.Vector3, mx: number, my: number) {
  camera.position.copy(pos);
  camera.lookAt(target);
  camera.updateMatrixWorld();
  for (const c of corners) {
    _v.copy(c).project(camera);
    if (Math.abs(_v.x) > mx || Math.abs(_v.y) > my || _v.z > 1) return false;
  }
  return true;
}

/**
 * The part of the canvas the house may use (px): the canvas size and how much of each edge the app's chrome covers
 * (on a phone: the top row and view switch, the dock).
 */
export interface SafeArea {
  w: number;
  h: number;
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * A 3/4 aerial view of the front (the road side, +z). `side` = +1 looks from the +X side (plan right),
 * −1 from −X. Distance is solved so the whole plot fits with margins (room for HUD overlays).
 * Neighbouring houses sit right beside a plot (zero side setbacks), so the view looks over them.
 * With a `safe` area (phones), the plot fits inside it instead, centred between the top chrome and the dock.
 */
export function heroPose(plan: BuildingPlan, camera: THREE.PerspectiveCamera, side: 1 | -1 = 1, azimuthDeg = 30, elevationDeg = 31, safe?: SafeArea | null) {
  const box = plotBox(plan);
  const size = box.getSize(new THREE.Vector3());
  const target = box.getCenter(new THREE.Vector3());
  target.y = size.y * 0.32;
  target.z += size.z * 0.06; // bias toward the front facade (front edge is the box's max z)
  const az = THREE.MathUtils.degToRad(azimuthDeg) * side;
  const el = THREE.MathUtils.degToRad(elevationDeg);
  const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
  const corners: THREE.Vector3[] = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));
  if (safe && safe.w > 0 && safe.h > 0) return fitSafe(camera, corners, target, dir, safe);
  const saved = { p: camera.position.clone(), q: camera.quaternion.clone() };
  let lo = 2, hi = 400;
  const pos = new THREE.Vector3();
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    pos.copy(target).addScaledVector(dir, mid);
    if (fits(camera, corners, pos, target, 0.84, 0.74)) hi = mid;
    else lo = mid;
  }
  pos.copy(target).addScaledVector(dir, hi);
  camera.position.copy(saved.p);
  camera.quaternion.copy(saved.q);
  camera.updateMatrixWorld();
  return { position: pos, target };
}

/**
 * Fit `corners` inside the safe area (NDC rect left after the chrome's insets): solve the distance for the box's
 * projected size, then slide the view across the screen so the box sits in the middle of the safe area, stepping
 * back a little until every corner is inside.
 */
function fitSafe(camera: THREE.PerspectiveCamera, corners: THREE.Vector3[], target0: THREE.Vector3, dir: THREE.Vector3, safe: SafeArea) {
  const saved = { p: camera.position.clone(), q: camera.quaternion.clone() };
  camera.aspect = safe.w / safe.h;
  camera.updateProjectionMatrix();
  const x0 = -1 + (2 * safe.left) / safe.w, x1 = 1 - (2 * safe.right) / safe.w;
  const y0 = -1 + (2 * safe.bottom) / safe.h, y1 = 1 - (2 * safe.top) / safe.h;
  const ext = (pos: THREE.Vector3, tgt: THREE.Vector3) => {
    camera.position.copy(pos);
    camera.lookAt(tgt);
    camera.updateMatrixWorld();
    let ax = Infinity, bx = -Infinity, ay = Infinity, by = -Infinity, behind = false;
    for (const c of corners) {
      _v.copy(c).project(camera);
      if (_v.z > 1) behind = true;
      ax = Math.min(ax, _v.x);
      bx = Math.max(bx, _v.x);
      ay = Math.min(ay, _v.y);
      by = Math.max(by, _v.y);
    }
    return { ax, bx, ay, by, behind };
  };
  let lo = 2, hi = 400;
  const pos = new THREE.Vector3();
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    const e = ext(pos.copy(target0).addScaledVector(dir, mid), target0);
    if (!e.behind && e.bx - e.ax <= x1 - x0 && e.by - e.ay <= y1 - y0) hi = mid;
    else lo = mid;
  }
  const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  const right = new THREE.Vector3(), up = new THREE.Vector3();
  let d = hi;
  const target = target0.clone();
  for (let k = 0; k < 40; k++) {
    target.copy(target0);
    pos.copy(target).addScaledVector(dir, d);
    let e = ext(pos, target);
    for (let it = 0; it < 4; it++) {
      right.setFromMatrixColumn(camera.matrixWorld, 0);
      up.setFromMatrixColumn(camera.matrixWorld, 1);
      const sx = ((e.ax + e.bx) / 2 - (x0 + x1) / 2) * d * tanV * camera.aspect;
      const sy = ((e.ay + e.by) / 2 - (y0 + y1) / 2) * d * tanV;
      target.addScaledVector(right, sx).addScaledVector(up, sy);
      pos.addScaledVector(right, sx).addScaledVector(up, sy);
      e = ext(pos, target);
    }
    if (!e.behind && e.ax >= x0 && e.bx <= x1 && e.ay >= y0 && e.by <= y1) break;
    d *= 1.025;
  }
  camera.position.copy(saved.p);
  camera.quaternion.copy(saved.q);
  camera.updateMatrixWorld();
  return { position: pos.clone(), target };
}

/**
 * The volume neighbours must never hide (orbit ghosting): the whole plot, from just above the ground to the top of
 * the stair tower and water tank.
 */
export function ghostBox(plan: BuildingPlan): THREE.Box3 {
  const { width_ft: W, depth_ft: D } = plan.site.plot;
  const roofTop = Math.max(...plan.levels.map((l) => l.elevation_ft + l.height_ft), 10);
  const tower = Math.max(plan.roof?.mumty?.height_ft ?? 0, plan.roof?.water_tank?.height_ft ?? 0);
  return new THREE.Box3().setFromPoints([planToWorld(0, 0, 0.4), planToWorld(W, D, roofTop + tower + 1)]);
}

/** An aerial three-quarter view into one room (dollhouse cut), keeping the current compass direction. */
export function roomPose(rect: { x: number; y: number; w: number; d: number }, floorFt: number, azimuth: number) {
  const target = planToWorld(rect.x + rect.w / 2, rect.y + rect.d / 2, floorFt + 2.5);
  const diag = Math.hypot(rect.w, rect.d) * 0.3048;
  const dist = THREE.MathUtils.clamp(diag * 1.55 + 3.5, 7, 26);
  const el = THREE.MathUtils.degToRad(52);
  const dir = new THREE.Vector3(Math.sin(azimuth) * Math.cos(el), Math.sin(el), Math.cos(azimuth) * Math.cos(el));
  return { position: target.clone().addScaledVector(dir, dist), target };
}


// ───────────────────────────── photo cameras ─────────────────────────────

/** The fixed cameras the House view's photos are made from (each photo starts from a capture of the model). */
export type PhotoAngle = "front" | "corner" | "garden" | "aerial";
export const PHOTO_ANGLES: PhotoAngle[] = ["front", "corner", "garden", "aerial"];
export const PHOTO_LABELS: Record<PhotoAngle, string> = { front: "Front", corner: "Street corner", garden: "Garden", aerial: "Aerial" };

export interface PhotoPose {
  position: THREE.Vector3;
  target: THREE.Vector3;
  /** vertical field of view, degrees */
  fov: number;
}

const _Y = new THREE.Vector3(0, 1, 0);

/**
 * From a fixed spot, turn the camera until the points' spread sits in the middle of the frame (no roll, +Y up), and
 * the vertical fov that fits them with a margin at this aspect.
 */
function aimFrom(pos: THREE.Vector3, pts: THREE.Vector3[], aspect: number, margin = 0.88): { target: THREE.Vector3; fov: number } {
  const centre = pts.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / Math.max(1, pts.length));
  const fwd = centre.clone().sub(pos).normalize();
  const right = new THREE.Vector3(), up = new THREE.Vector3();
  let hx = 0, hy = 0;
  for (let it = 0; it < 6; it++) {
    right.crossVectors(fwd, _Y).normalize();
    up.crossVectors(right, fwd).normalize();
    let ax = Infinity, bx = -Infinity, ay = Infinity, by = -Infinity;
    for (const p of pts) {
      _v.subVectors(p, pos);
      const z = Math.max(0.05, _v.dot(fwd));
      const x = _v.dot(right) / z, y = _v.dot(up) / z;
      ax = Math.min(ax, x);
      bx = Math.max(bx, x);
      ay = Math.min(ay, y);
      by = Math.max(by, y);
    }
    hx = (bx - ax) / 2;
    hy = (by - ay) / 2;
    const cx = (ax + bx) / 2, cy = (ay + by) / 2;
    if (Math.abs(cx) < 1e-4 && Math.abs(cy) < 1e-4) break;
    fwd.addScaledVector(right, cx).addScaledVector(up, cy).normalize();
  }
  const tanV = Math.max(hy, hx / aspect) / margin;
  return { target: pos.clone().addScaledVector(fwd, Math.max(5, centre.distanceTo(pos))), fov: THREE.MathUtils.radToDeg(2 * Math.atan(tanV)) };
}

function boxCorners(b: THREE.Box3): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) out.push(new THREE.Vector3(x, y, z));
  return out;
}

/** The distance along `dir` from `target` at which the frame needs about `fov` degrees (it narrows as you step back). */
function distanceFor(target: THREE.Vector3, dir: THREE.Vector3, pts: THREE.Vector3[], aspect: number, fov: number, lo = 4, hi = 400) {
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2;
    if (aimFrom(target.clone().addScaledVector(dir, mid), pts, aspect).fov > fov) lo = mid;
    else hi = mid;
  }
  return hi;
}

/**
 * The camera for one photo angle, from the plan (feet → world: x = x_ft, z = −y_ft, road at +z):
 * - front: standing on the far footpath across the road at eye level, the whole facade and the boundary wall in frame;
 * - corner: three-quarter from the street, ~40° off the facade's axis on the sunny side, 15 ft up, over the road;
 * - garden: 25 ft up in front of the boundary wall, over the front garden's edge, looking at the entrance;
 * - aerial: high (70 ft or more) on the other side, looking down at 45° on the whole plot.
 * `side` +1 puts the corner view on the plan's right (+x), −1 on its left.
 */
export function photoPose(plan: BuildingPlan, angle: PhotoAngle, aspect: number, side: 1 | -1 = 1): PhotoPose {
  const { width_ft: W, depth_ft: D } = plan.site.plot;
  const FT = 0.3048;
  const FOOTPATH = 6;
  const road = THREE.MathUtils.clamp(plan.site.road_width_ft ?? 40, 12, 150);
  const farKerb = FOOTPATH + road + FOOTPATH * 0.6; // plan ft in front of the plot (y < 0)
  const house = houseBox(plan);
  const plot = plotBox(plan);
  const wallH = plan.site.boundary_wall?.front_height_ft ?? 6;
  const front = [planToWorld(0, 0, 0), planToWorld(W, 0, 0), planToWorld(0, 0, wallH), planToWorld(W, 0, wallH)];
  const clampFov = (f: number, lo: number, hi: number) => THREE.MathUtils.clamp(f, lo, hi);

  if (angle === "front") {
    const pts = [...boxCorners(house), ...front];
    const pos = planToWorld(W / 2, -farKerb, 6);
    let aim = aimFrom(pos, pts, aspect);
    // a narrow lane: step back until the lens is no wider than a phone's
    for (let k = 0; k < 24 && aim.fov > 68; k++) {
      pos.z += 1;
      aim = aimFrom(pos, pts, aspect);
    }
    return { position: pos, target: aim.target, fov: clampFov(aim.fov, 22, 72) };
  }

  if (angle === "corner") {
    // From the street the neighbours hide the house's sides and back: frame its front, full height, and the wall.
    const face = house.clone();
    face.min.z = Math.max(face.min.z, face.max.z - 4);
    const pts = [...boxCorners(face), ...front];
    const target = new THREE.Vector3((face.min.x + face.max.x) / 2, 15 * FT, face.max.z);
    // 45° off the axis would look down the row at the next house: 38° keeps the facade the subject
    const az = THREE.MathUtils.degToRad(38) * side;
    const dir = new THREE.Vector3(Math.sin(az), 0, Math.cos(az));
    let d = distanceFor(target, dir, pts, aspect, 52);
    // stay over the road (clear of the street trees and lamps on the footpaths, and the row across it)
    const zMax = (FOOTPATH + road * 0.7) * FT;
    if (target.z + dir.z * d > zMax) d = Math.max(4, (zMax - target.z) / dir.z);
    const pos = target.clone().addScaledVector(dir, d);
    pos.z = Math.max(pos.z, (FOOTPATH + 2) * FT);
    const aim = aimFrom(pos, pts, aspect);
    return { position: pos, target: aim.target, fov: clampFov(aim.fov, 30, 75) };
  }

  if (angle === "garden") {
    const ground = plan.levels.find((l) => l.index === 0) ?? plan.levels[0];
    const door =
      plan.openings.find((o) => o.type === "main_door") ??
      plan.openings.filter((o) => o.between.includes("exterior") && /door/.test(o.type)).sort((a, b) => a.at[1] - b.at[1])[0];
    const lvl = plan.levels.find((l) => l.id === door?.level) ?? ground;
    const frontY = house.isEmpty() ? D * 0.3 : -house.max.z / FT;
    const dx = door ? door.at[0] : W / 2;
    const dy = door ? door.at[1] : frontY;
    const e = lvl?.elevation_ft ?? 1.5;
    const lawns = plan.rooms.filter((r) => r.type === "lawn" && r.rect.y < dy);
    const pts = [planToWorld(dx - 10, dy, 0), planToWorld(dx + 10, dy, 0), planToWorld(dx - 10, dy, e + 14), planToWorld(dx + 10, dy, e + 14), planToWorld(dx - 9, 1, 0), planToWorld(dx + 9, 1, 0)];
    for (const r of lawns) pts.push(planToWorld(r.rect.x, r.rect.y, 0), planToWorld(r.rect.x + r.rect.w, r.rect.y, 0), planToWorld(r.rect.x, r.rect.y + r.rect.d, 0), planToWorld(r.rect.x + r.rect.w, r.rect.y + r.rect.d, 0));
    const lawnFront = lawns.length ? Math.min(...lawns.map((r) => r.rect.y)) : 0;
    // over the street, in front of the boundary wall: far enough back to see the door, not only the porch roof
    const pos = planToWorld(THREE.MathUtils.clamp(dx, W * 0.25, W * 0.75), Math.min(lawnFront, 0) - FOOTPATH - Math.min(road * 0.4, 16), 25);
    const aim = aimFrom(pos, pts, aspect, 0.9);
    return { position: pos, target: aim.target, fov: clampFov(aim.fov, 40, 72) };
  }

  // aerial
  const pts = [...boxCorners(plot), ...front];
  const target = plot.getCenter(new THREE.Vector3());
  target.y = 0;
  const az = THREE.MathUtils.degToRad(-30) * side;
  const el = THREE.MathUtils.degToRad(45);
  const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
  const d = Math.max(distanceFor(target, dir, pts, aspect, 42), (70 * FT) / Math.sin(el));
  const pos = target.clone().addScaledVector(dir, d);
  const aim = aimFrom(pos, pts, aspect);
  return { position: pos, target: aim.target, fov: clampFov(aim.fov, 24, 60) };
}
