/**
 * Tileable noise for procedural textures. Perlin fBm is baked once into 256² tables; generators then sample
 * the tables bilinearly at integer frequencies (cheap, and every result tiles seamlessly).
 */
import { rng } from "../core/util";

export const TS = 256; // table size (power of two)
const MASK = TS - 1;

function perlinTable(seed: number, basePeriod: number, octaves: number, ridged = false): Float32Array {
  const rand = rng(seed);
  const out = new Float32Array(TS * TS);
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const P = basePeriod << o;
    const gx = new Float32Array(P * P);
    const gy = new Float32Array(P * P);
    for (let k = 0; k < P * P; k++) {
      const a = rand() * Math.PI * 2;
      gx[k] = Math.cos(a);
      gy[k] = Math.sin(a);
    }
    const scale = P / TS;
    for (let y = 0; y < TS; y++) {
      const fy0 = y * scale;
      const iy = Math.floor(fy0);
      const fy = fy0 - iy;
      const y0 = iy % P, y1 = (iy + 1) % P;
      const sy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
      for (let x = 0; x < TS; x++) {
        const fx0 = x * scale;
        const ix = Math.floor(fx0);
        const fx = fx0 - ix;
        const x0 = ix % P, x1 = (ix + 1) % P;
        const sx = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
        const k00 = y0 * P + x0, k10 = y0 * P + x1, k01 = y1 * P + x0, k11 = y1 * P + x1;
        const n00 = gx[k00] * fx + gy[k00] * fy;
        const n10 = gx[k10] * (fx - 1) + gy[k10] * fy;
        const n01 = gx[k01] * fx + gy[k01] * (fy - 1);
        const n11 = gx[k11] * (fx - 1) + gy[k11] * (fy - 1);
        const nx0 = n00 + (n10 - n00) * sx;
        const nx1 = n01 + (n11 - n01) * sx;
        let n = nx0 + (nx1 - nx0) * sy; // ~[-0.7, 0.7]
        if (ridged) n = 1 - Math.abs(n) * 1.6;
        out[y * TS + x] += n * amp;
      }
    }
    total += amp;
    amp *= 0.5;
  }
  // normalize to [0, 1]
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < out.length; i++) {
    const v = out[i] / total;
    out[i] = v;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const inv = 1 / Math.max(1e-6, hi - lo);
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - lo) * inv;
  return out;
}

const cache = new Map<string, Float32Array>();
/** fBm table (values 0..1). kind "fbm" | "ridged" | "smooth"(fewer octaves). */
export function table(seed: number, kind: "fbm" | "ridged" | "smooth" | "vlow" = "fbm"): Float32Array {
  const key = `${kind}:${seed}`;
  let t = cache.get(key);
  if (!t) {
    t = kind === "vlow" ? perlinTable(seed, 1, 2) : kind === "smooth" ? perlinTable(seed, 2, 3) : kind === "ridged" ? perlinTable(seed, 4, 5, true) : perlinTable(seed, 4, 5);
    cache.set(key, t);
  }
  return t;
}

/** Bilinear sample in TABLE pixel units (wraps). */
export function samp(t: Float32Array, x: number, y: number): number {
  const xf = Math.floor(x), yf = Math.floor(y);
  const fx = x - xf, fy = y - yf;
  const x0 = xf & MASK, y0 = yf & MASK;
  const x1 = (x0 + 1) & MASK, y1 = (y0 + 1) & MASK;
  const a = t[(y0 << 8) | x0], b = t[(y0 << 8) | x1], c = t[(y1 << 8) | x0], d = t[(y1 << 8) | x1];
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/**
 * Sampler for a texture of size N: s(x, y, fu, fv, ox, oy) samples the table at integer frequencies (fu, fv)
 * across the texture (tileable), with an offset in table pixels.
 */
export function sampler(t: Float32Array, N: number) {
  const k = TS / N;
  return (x: number, y: number, fu = 1, fv = fu, ox = 0, oy = 0): number => samp(t, x * k * fu + ox, y * k * fv + oy);
}

/** Integer hash → [0,1) */
export function hash2(x: number, y: number, seed = 0): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export type RGB = [number, number, number];

export function hexRGB(hex: string): RGB {
  let s = hex.replace("#", "").trim();
  if (s.length === 3) s = s.split("").map((c) => c + c).join("");
  const n = parseInt(s.slice(0, 6), 16);
  if (!Number.isFinite(n)) return [0.8, 0.8, 0.8];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
export function mul(a: RGB, k: number): RGB {
  return [a[0] * k, a[1] * k, a[2] * k];
}
/** Shift a color's lightness/saturation a little (deterministic jitter). */
export function jitter(c: RGB, r: () => number, amt = 0.08, hueAmt = 0.03): RGB {
  const l = 1 + (r() - 0.5) * 2 * amt;
  const h = (r() - 0.5) * 2 * hueAmt;
  return [c[0] * l * (1 + h), c[1] * l, c[2] * l * (1 - h)];
}
