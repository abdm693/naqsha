/** Small shared helpers: units, robust number parsing, warnings, seeded randomness. */
import * as THREE from "three";

export const FT = 0.3048;
export const ft = (n: number): number => n * FT;
export const toFt = (m: number): number => m / FT;

/** Plan feet (x, y, h) → world meters per the contract: x_m = x·0.3048, Y_m = h·0.3048, z_m = −y·0.3048. */
export function w3(x_ft: number, y_ft: number, h_ft = 0): THREE.Vector3 {
  return new THREE.Vector3(x_ft * FT, h_ft * FT, -y_ft * FT);
}
/** World z (m) for a plan y (ft). */
export const wz = (y_ft: number): number => -y_ft * FT;
/** Plan y (ft) for a world z (m). */
export const planY = (z_m: number): number => -z_m / FT;

export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Robust number: falls back to `def` for NaN / non-numbers, then clamps. Never throws. */
export function num(v: unknown, def: number, min = -Infinity, max = Infinity): number {
  let n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  if (!Number.isFinite(n)) n = def;
  return clamp(n, min, max);
}

const warned = new Set<string>();
/** console.warn once per distinct message (Argon's inputs can repeat the same mistake many times). */
export function warn(msg: string, ...rest: unknown[]): void {
  if (warned.has(msg)) return;
  warned.add(msg);
  if (warned.size > 500) warned.clear();
  console.warn(`[naqsha/engine] ${msg}`, ...rest);
}

/** mulberry32 seeded PRNG. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Parse "#rgb"/"#rrggbb"/css name into THREE.Color; fallback on failure. */
export function color(c: unknown, fallback = "#cccccc"): THREE.Color {
  const out = new THREE.Color();
  if (typeof c === "string" && c.trim()) {
    const s = c.trim();
    if (/^#?[0-9a-f]{6}$/i.test(s) || /^#?[0-9a-f]{3}$/i.test(s)) {
      out.set(s.startsWith("#") ? s : `#${s}`);
      return out;
    }
    try {
      // THREE warns on unknown names; check against its table first.
      if ((THREE.Color.NAMES as Record<string, number>)[s.toLowerCase()] !== undefined) {
        out.set(s.toLowerCase());
        return out;
      }
      if (/^(rgb|hsl)a?\(/i.test(s)) {
        out.setStyle(s);
        return out;
      }
    } catch {
      /* fall through */
    }
  }
  out.set(fallback);
  return out;
}

export function colorHex(c: unknown, fallback = "#cccccc"): string {
  return "#" + color(c, fallback).getHexString();
}

/** Relative luminance-ish (sRGB space) of a hex color, 0..1. */
export function luma(hex: string): number {
  const c = color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

export function round(n: number, step = 0.01): number {
  return Math.round(n / step) * step;
}

export const DEG = Math.PI / 180;
