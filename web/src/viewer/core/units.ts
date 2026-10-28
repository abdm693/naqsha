/**
 * Plan ↔ world conversions (contracts/plan.ts): plan feet, origin = front-left plot corner; world meters, +Y up;
 * x_m = x_ft·0.3048, z_m = −y_ft·0.3048. The road (plan y < 0) is at +z, so from the street (looking toward −z)
 * plan +x is on the viewer's right. Every viewer conversion goes through these helpers.
 */
import * as THREE from "three";

export const FT = 0.3048;

export const ft = (n: number) => n * FT;

/** Plan y (ft) → world z (m). */
export const zOf = (y_ft: number) => -y_ft * FT;
/** World z (m) → plan y (ft). */
export const yOf = (z_m: number) => -z_m / FT;

export function planToWorld(x_ft: number, y_ft: number, h_ft = 0, out = new THREE.Vector3()) {
  return out.set(x_ft * FT, h_ft * FT, zOf(y_ft));
}

export function worldToPlan(v: THREE.Vector3): { x: number; y: number; h: number } {
  return { x: v.x / FT, y: yOf(v.z), h: v.y / FT };
}

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Frame-rate independent exponential smoothing factor. */
export const damp = (lambda: number, dt: number) => 1 - Math.exp(-lambda * dt);

export const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function isCoarsePointer(): boolean {
  try {
    return window.matchMedia("(pointer: coarse)").matches && !window.matchMedia("(pointer: fine)").matches;
  } catch {
    return false;
  }
}
