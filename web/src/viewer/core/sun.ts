/**
 * Lahore sun path — the same model the engine uses for `s.lights.sun({ hour })` (engine/lights.ts), so moving
 * the viewer's sun slider never makes the design's sun jump.
 *
 * - Latitude 31.5°N, fixed declination 18° (early summer: 17.5 h ≈ golden hour), hour angle (h − 12)·15°.
 * - Directions follow the PLAN's semantics: the plot front (−y) faces `site.facing`, and a compass bearing θ relative
 *   to the front maps to plan (−sin θ, −cos θ); world = (x_ft, −y_ft) → (x_m, z_m) (road at +z). For a north-facing
 *   plot the morning sun therefore rises over the plan's left side (min x, "left as seen from the road" = east).
 */
import * as THREE from "three";
import { clamp, lerp, smoothstep } from "./units";

export type Facing = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";

const DEG = Math.PI / 180;
const LAT = 31.5 * DEG;
const DECL = 18 * DEG;
const FACING_AZ: Record<Facing, number> = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };

export interface SunState {
  /** Unit vector from the house toward the sun (world). Altitude clamped ≥ 2.5° so shadows stay defined. */
  dir: THREE.Vector3;
  /** Same direction with the true altitude (for the Sky shader; can dip below the horizon). */
  skyDir: THREE.Vector3;
  altitudeDeg: number;
  /** 0 below the horizon → 1 in daylight (engine's intensity curve, without its 3.4 scale). */
  daylight: number;
  color: THREE.Color;
  /** Engine-equivalent directional intensity before the design's `intensity` scale. */
  intensity: number;
  hemi: { sky: THREE.Color; ground: THREE.Color; intensity: number };
  /** 0 day → 1 night: emissive fixtures read as "on" at dusk (engine setTimeOfDay). */
  night: number;
}

function solar(hour: number) {
  const h = clamp(Number.isFinite(hour) ? hour : 17.5, 5, 20);
  const H = (h - 12) * 15 * DEG;
  const sinAlt = Math.sin(LAT) * Math.sin(DECL) + Math.cos(LAT) * Math.cos(DECL) * Math.cos(H);
  const alt = Math.asin(clamp(sinAlt, -1, 1));
  let cosAz = (Math.sin(DECL) - Math.sin(alt) * Math.sin(LAT)) / (Math.cos(alt) * Math.cos(LAT));
  cosAz = clamp(cosAz, -1, 1);
  let az = Math.acos(cosAz); // from north, east-positive in the morning
  if (H > 0) az = 2 * Math.PI - az;
  return { alt, az };
}

function planDir(az: number, facing: Facing, alt: number) {
  const th = az - (FACING_AZ[facing] ?? 0) * DEG;
  const dx = -Math.sin(th), dy = -Math.cos(th); // plan direction (front = −y)
  // world: x = x_ft, z = −y_ft (road at +z)
  return new THREE.Vector3(dx * Math.cos(alt), Math.sin(alt), -dy * Math.cos(alt)).normalize();
}

export function sunState(hour: number, facing: Facing = "N"): SunState {
  const { alt, az } = solar(hour);
  const a = alt / DEG;
  const warm = new THREE.Color("#ffad66"), gold = new THREE.Color("#ffd6a3"), day = new THREE.Color("#fff3e4");
  const color = a < 12 ? warm.clone().lerp(gold, smoothstep(0, 12, a)) : gold.clone().lerp(day, smoothstep(12, 40, a));
  const daylight = smoothstep(-3, 8, a);
  return {
    dir: planDir(az, facing, Math.max(alt, 2.5 * DEG)),
    skyDir: planDir(az, facing, alt),
    altitudeDeg: a,
    daylight,
    color,
    intensity: 3.4 * daylight * lerp(0.62, 1, smoothstep(5, 45, a)),
    hemi: {
      sky: new THREE.Color("#f3c9a2").lerp(new THREE.Color("#b9d1ec"), smoothstep(4, 30, a)),
      ground: new THREE.Color("#6d5a47"),
      intensity: lerp(0.25, 0.55, smoothstep(-5, 30, a)),
    },
    night: 1 - smoothstep(-2, 16, a),
  };
}
