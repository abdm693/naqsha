/** Shared furniture parts: materials bundle, cushions, legs, drawers, handles, books, vases, leaves, art. */
import * as THREE from "three";
import { Kit, lathe, mat4, roundedBox, unitBox, unitCyl as unitCylGeo } from "../core/shapes";
import { color, hashStr, rng } from "../core/util";
import type { MaterialLib } from "../materials/library";
import { makeCanvas } from "../materials/gen";

export interface ItemMats {
  main: THREE.Material;
  fabric: THREE.Material;
  accent: THREE.Material;
  accent2: THREE.Material;
  wood: THREE.Material;
  woodDark: THREE.Material;
  metal: THREE.Material;
  brass: THREE.Material;
  steel: THREE.Material;
  white: THREE.Material;
  linen: THREE.Material;
  ceramic: THREE.Material;
  glass: THREE.Material;
  mirror: THREE.Material;
  dark: THREE.Material;
  marble: THREE.Material;
  leaf: THREE.Material;
  leaf2: THREE.Material;
  soil: THREE.Material;
  shade: THREE.Material;
  bulb: THREE.Material;
  screen: THREE.Material;
  plastic: THREE.Material;
  rubber: THREE.Material;
  stone: THREE.Material;
  M: MaterialLib;
}

export interface ItemBuild {
  k: Kit;
  /** meters */
  w: number;
  d: number;
  h: number;
  m: ItemMats;
  variant: string;
  rnd: () => number;
  style: "modern" | "classic" | "minimal" | "traditional";
  colorHex: string;
  extra: {
    /** kitchen: openings on the wall behind, as local x ranges (m) with sill heights (m above floor) */
    wallOpenings?: { x0: number; x1: number; sill: number; top: number }[];
    noHob?: boolean;
    noSink?: boolean;
    /** ceiling items: distance from floor to ceiling (m) */
    ceiling?: number;
    /** support surface height under "top" items (m), 0 if on the floor */
    support?: number;
    room?: string;
  };
}

export function makeMats(M: MaterialLib, o: { main?: THREE.Material; fabricHex: string; accentHex: string; accent2Hex: string; style: string }): ItemMats {
  const classic = o.style === "classic" || o.style === "traditional";
  return {
    main: o.main ?? M.get("wood_walnut"),
    fabric: M.get({ preset: "fabric", color: o.fabricHex }),
    accent: M.get({ preset: "velvet", color: o.accentHex }),
    accent2: M.get({ preset: "linen", color: o.accent2Hex }),
    wood: M.get("wood_walnut"),
    woodDark: M.get({ preset: "wood_walnut", color: "#3b2619" }),
    metal: classic ? M.get("metal_gold") : M.get("metal_black"),
    brass: M.get("metal_gold"),
    steel: M.get("metal_brushed"),
    white: M.get({ preset: "lacquer", color: "#f2f0eb" }),
    linen: M.get({ preset: "linen", color: "#f1ede6" }),
    ceramic: M.get("ceramic_white"),
    glass: M.get("glass_clear"),
    mirror: M.get("mirror"),
    dark: M.basic("#18181a", { roughness: 0.55 }),
    marble: M.get("marble_white"),
    leaf: leafMat(M, "#3e6b31"),
    leaf2: leafMat(M, "#557f3a"),
    soil: M.get({ preset: "soil", color: "#3d2e24" }),
    shade: M.basic("#f3e6cf", { roughness: 0.9, emissive: "#ffcf8f", emissiveIntensity: 0.9 }),
    bulb: M.emissive("#ffd9a0", 4),
    screen: M.basic("#0b0c0e", { roughness: 0.12, metalness: 0.4 }),
    plastic: M.get({ preset: "plastic", color: "#f3f3f1" }),
    rubber: M.basic("#1a1a1b", { roughness: 0.85 }),
    stone: M.get({ preset: "concrete", color: "#a8a49c" }),
    M,
  };
}

function leafMat(M: MaterialLib, hex: string): THREE.Material {
  const key = `leaf|${hex}`;
  const cache = M as unknown as { _leaf?: Map<string, THREE.Material> };
  cache._leaf ??= new Map();
  let m = cache._leaf.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: color(hex), roughness: 0.55, metalness: 0, side: THREE.DoubleSide });
    m.name = key;
    cache._leaf.set(key, m);
    M.created.push(m);
  }
  return m;
}

// ── basic helpers (all meters, item-local: origin at floor center, front = +z) ─────────────────────
export function cushion(k: Kit, mat: THREE.Material, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, r = 0.05, rx = 0, ry = 0, rz = 0): void {
  k.rbox(mat, cx, cy, cz, sx, sy, sz, Math.min(r, sx / 2.05, sy / 2.05, sz / 2.05), 2, rx, ry, rz);
}

export function legs4(k: Kit, mat: THREE.Material, w: number, d: number, h: number, inset: number, style: "round" | "square" | "tapered" = "tapered", t = 0.035): void {
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const x = sx * (w / 2 - inset), z = sz * (d / 2 - inset);
      if (style === "square") k.box(mat, x, h / 2, z, t, h, t);
      else if (style === "round") k.cyl(mat, x, h / 2, z, t / 2, h, 12);
      else k.geo(mat, taperedLeg(t * 0.55, t * 0.3, h), mat4(x, 0, z, 0.08 * sz, 0, -0.08 * sx));
    }
}

const legCache = new Map<string, THREE.BufferGeometry>();
function taperedLeg(rTop: number, rBot: number, h: number): THREE.BufferGeometry {
  const key = `${rTop.toFixed(3)}|${rBot.toFixed(3)}|${h.toFixed(3)}`;
  let g = legCache.get(key);
  if (!g) {
    g = new THREE.CylinderGeometry(rTop, rBot, h, 12, 1);
    g.translate(0, h / 2, 0);
    legCache.set(key, g);
  }
  return g;
}

/** Front panels with hairline gaps over a carcass face at z = zf (front plane). */
export function fronts(k: Kit, mat: THREE.Material, x0: number, x1: number, y0: number, y1: number, zf: number, cols: number, rows: number, gap = 0.004, depth = 0.018): { cx: number; cy: number; w: number; h: number }[] {
  const out: { cx: number; cy: number; w: number; h: number }[] = [];
  const cw = (x1 - x0) / cols, rh = (y1 - y0) / rows;
  for (let i = 0; i < cols; i++)
    for (let j = 0; j < rows; j++) {
      const cx = x0 + cw * (i + 0.5), cy = y0 + rh * (j + 0.5);
      k.box(mat, cx, cy, zf + depth / 2, cw - gap * 2, rh - gap * 2, depth);
      out.push({ cx, cy, w: cw - gap * 2, h: rh - gap * 2 });
    }
  return out;
}

export function bar(k: Kit, mat: THREE.Material, x: number, y: number, z: number, len: number, vertical: boolean, r = 0.008): void {
  if (vertical) k.cyl(mat, x, y, z, r, len, 10);
  else k.cyl(mat, x, y, z, r, len, 10, 0, 0, Math.PI / 2);
  // stand-offs
  const off = len / 2 - 0.02;
  for (const s of [-1, 1]) {
    if (vertical) k.cyl(mat, x, y + s * off, z - 0.012, r * 0.7, 0.025, 8, Math.PI / 2);
    else k.cyl(mat, x + s * off, y, z - 0.012, r * 0.7, 0.025, 8, Math.PI / 2);
  }
}

export function books(k: Kit, mats: THREE.Material[], x0: number, x1: number, y: number, zc: number, depth: number, rnd: () => number, maxH = 0.28): void {
  let x = x0;
  while (x < x1 - 0.03) {
    if (rnd() < 0.12) {
      x += 0.04 + rnd() * 0.08;
      continue;
    }
    const t = 0.018 + rnd() * 0.03;
    if (x + t > x1) break;
    const h = maxH * (0.62 + rnd() * 0.38);
    const lean = rnd() < 0.06 ? 0.18 : 0;
    k.box(mats[Math.floor(rnd() * mats.length)], x + t / 2, y + h / 2, zc, t, h, depth * (0.75 + rnd() * 0.2), 0);
    if (lean) x += 0.01;
    x += t + 0.002;
  }
}

export function vase(k: Kit, mat: THREE.Material, x: number, y: number, z: number, h: number, kind = 0): void {
  const pts: [number, number][][] = [
    [[0, 0], [0.4, 0], [0.48, 0.08], [0.5, 0.35], [0.38, 0.7], [0.22, 0.9], [0.24, 1], [0, 1]],
    [[0, 0], [0.32, 0], [0.5, 0.25], [0.52, 0.5], [0.4, 0.8], [0.18, 0.95], [0.2, 1], [0, 1]],
    [[0, 0], [0.45, 0], [0.5, 0.1], [0.5, 0.9], [0.42, 1], [0, 1]],
  ];
  const p = pts[kind % pts.length];
  k.geo(mat, lathe(`vase${kind}`, p, 28), mat4(x, y, z, 0, 0, 0, h * 0.55, h, h * 0.55));
}

// ── leaves ────────────────────────────────────────────────────────────────────────────────────────────
const leafGeoCache = new Map<string, THREE.BufferGeometry>();
/** A single leaf (1 m long, width ratio wr) bent downward toward the tip, lying along +y. */
export function leafGeo(wr = 0.38, bend = 0.25, kind: "oval" | "long" = "oval"): THREE.BufferGeometry {
  const key = `${wr}|${bend}|${kind}`;
  let g = leafGeoCache.get(key);
  if (g) return g;
  const nL = 7, pos: number[] = [], idx: number[] = [];
  for (let i = 0; i <= nL; i++) {
    const t = i / nL;
    const prof = kind === "long" ? Math.sin(Math.PI * Math.min(1, t * 1.05)) * (1 - t * 0.3) : Math.pow(Math.sin(Math.PI * t), 0.8) * (1 - t * 0.15);
    const half = (wr / 2) * prof;
    const zc = -bend * t * t;
    // left edge, midrib, right edge (slight V fold)
    pos.push(-half, t, zc - half * 0.25, 0, t, zc + 0.02 * prof, half, t, zc - half * 0.25);
  }
  for (let i = 0; i < nL; i++) {
    const a = i * 3, b = (i + 1) * 3;
    idx.push(a, b, a + 1, a + 1, b, b + 1, a + 1, b + 1, a + 2, a + 2, b + 1, b + 2);
  }
  g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const uv = new Float32Array((pos.length / 3) * 2);
  for (let i = 0; i < pos.length / 3; i++) {
    uv[i * 2] = pos[i * 3] + 0.5;
    uv[i * 2 + 1] = pos[i * 3 + 1];
  }
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  leafGeoCache.set(key, g);
  return g;
}

/** Place a leaf: base at p, pointing along dir (yaw ry, pitch from vertical), size s (m). */
export function leafAt(k: Kit, mat: THREE.Material, px: number, py: number, pz: number, yaw: number, tilt: number, s: number, roll = 0, geo?: THREE.BufferGeometry): void {
  const m = new THREE.Matrix4().makeTranslation(px, py, pz);
  m.multiply(new THREE.Matrix4().makeRotationY(yaw));
  m.multiply(new THREE.Matrix4().makeRotationX(tilt));
  m.multiply(new THREE.Matrix4().makeRotationY(roll));
  m.multiply(new THREE.Matrix4().makeScale(s, s, s));
  k.geo(mat, geo ?? leafGeo(), m, "native");
}

/** Generic potted foliage: stems + leaves in a loose dome. */
export function foliage(k: Kit, m: ItemMats, x: number, y: number, z: number, height: number, spread: number, rnd: () => number, kind: "fiddle" | "areca" | "bush" | "snake"): void {
  if (kind === "snake") {
    const n = 9 + Math.floor(rnd() * 5);
    const g = leafGeo(0.16, 0.05, "long");
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2, r = rnd() * spread * 0.25;
      leafAt(k, rnd() < 0.5 ? m.leaf : m.leaf2, x + Math.cos(a) * r, y, z + Math.sin(a) * r, a, (rnd() - 0.5) * 0.25, height * (0.6 + rnd() * 0.4), 0, g);
    }
    return;
  }
  if (kind === "areca") {
    const fronds = 9 + Math.floor(rnd() * 4);
    const g = leafGeo(0.07, 0.1, "long");
    for (let f = 0; f < fronds; f++) {
      const a = (f / fronds) * Math.PI * 2 + rnd() * 0.4;
      const tilt = 0.25 + rnd() * 0.55;
      const len = height * (0.65 + rnd() * 0.35);
      // stem
      const sx = Math.sin(tilt) * Math.cos(a), sz = Math.sin(tilt) * Math.sin(a), sy = Math.cos(tilt);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(sx, sy, sz));
      k.geo(m.leaf2, unitCylGeo(), new THREE.Matrix4().compose(new THREE.Vector3(x + (sx * len) / 2, y + (sy * len) / 2, z + (sz * len) / 2), q, new THREE.Vector3(0.012, len, 0.012)));
      // leaflets along the frond
      const n = 14;
      for (let i = 2; i < n; i++) {
        const t = i / n;
        const px = x + sx * len * t, py = y + sy * len * t - 0.15 * len * t * t, pz = z + sz * len * t;
        for (const side of [-1, 1]) leafAt(k, m.leaf, px, py, pz, a + side * 1.25 + Math.PI / 2, 1.1 + t * 0.4, len * 0.32 * (1 - t * 0.5), side * 0.3, g);
      }
    }
    return;
  }
  const n = kind === "bush" ? 46 : 24;
  const g = kind === "bush" ? leafGeo(0.55, 0.15) : leafGeo(0.62, 0.22);
  if (kind === "fiddle") {
    // a few woody stems
    for (let s = 0; s < 3; s++) {
      const a = rnd() * Math.PI * 2;
      k.cyl(m.woodDark, x + Math.cos(a) * 0.03, y + height * 0.32, z + Math.sin(a) * 0.03, 0.009, height * 0.64, 6, Math.sin(a) * 0.08, 0, Math.cos(a) * 0.08);
    }
  }
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const a = i * 2.399 + rnd() * 0.5;
    const hh = kind === "bush" ? y + height * (0.25 + 0.6 * Math.sqrt(rnd())) : y + height * (0.3 + 0.62 * t + rnd() * 0.08);
    const r = spread * (kind === "bush" ? 0.2 + rnd() * 0.3 : 0.08 + 0.25 * (1 - Math.abs(t - 0.5)) + rnd() * 0.06);
    const s = kind === "bush" ? spread * (0.32 + rnd() * 0.2) : spread * (0.42 + rnd() * 0.3) * (1 - t * 0.3);
    leafAt(k, rnd() < 0.35 ? m.leaf2 : m.leaf, x + Math.cos(a) * r, hh, z + Math.sin(a) * r, -a + Math.PI / 2, 0.75 + rnd() * 0.6, s, (rnd() - 0.5) * 0.6, g);
  }
}

// ── procedural textures for art, rugs and prayer mats ────────────────────────────────────────────────
const texCache = new Map<string, THREE.Texture>();

export function artTexture(seed: string, palette: string[]): THREE.Texture {
  const key = `art|${seed}|${palette.join(",")}`;
  let t = texCache.get(key);
  if (t) return t;
  const W = 512, H = 384;
  const cv = makeCanvas(W, H);
  const g = cv.getContext("2d") as CanvasRenderingContext2D;
  const r = rng(hashStr(seed));
  const pick = () => palette[Math.floor(r() * palette.length)];
  g.fillStyle = "#efe9df";
  g.fillRect(0, 0, W, H);
  const style = Math.floor(r() * 3);
  if (style === 0) {
    // soft colour fields (Rothko-like)
    const bands = 2 + Math.floor(r() * 2);
    for (let i = 0; i < bands; i++) {
      g.fillStyle = pick();
      g.globalAlpha = 0.85;
      const y0 = 30 + (i * (H - 60)) / bands, hh = (H - 60) / bands - 18;
      g.beginPath();
      g.roundRect(34, y0, W - 68, hh, 10);
      g.fill();
    }
  } else if (style === 1) {
    // arcs and circles (mid-century)
    for (let i = 0; i < 7; i++) {
      g.fillStyle = pick();
      g.globalAlpha = 0.9;
      g.beginPath();
      const cx = r() * W, cy = H * (0.3 + r() * 0.6), rr = 40 + r() * 140;
      g.arc(cx, cy, rr, Math.PI, 0);
      g.fill();
    }
    g.fillStyle = "#c46a3b";
    g.beginPath();
    g.arc(W * (0.25 + r() * 0.5), H * 0.28, 34, 0, Math.PI * 2);
    g.fill();
  } else {
    // abstract brush strokes
    for (let i = 0; i < 26; i++) {
      g.strokeStyle = pick();
      g.globalAlpha = 0.55 + r() * 0.4;
      g.lineWidth = 8 + r() * 30;
      g.lineCap = "round";
      g.beginPath();
      const x = r() * W, y = r() * H;
      g.moveTo(x, y);
      g.bezierCurveTo(x + (r() - 0.5) * 300, y + (r() - 0.5) * 200, x + (r() - 0.5) * 300, y + (r() - 0.5) * 200, x + (r() - 0.5) * 360, y + (r() - 0.5) * 120);
      g.stroke();
    }
  }
  g.globalAlpha = 1;
  grain(g, W, H, 0.22);
  t = new THREE.CanvasTexture(cv as HTMLCanvasElement);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  texCache.set(key, t);
  return t;
}

export function rugTexture(hex: string, kind: "modern" | "classic" | "prayer"): THREE.Texture {
  const key = `rug|${hex}|${kind}`;
  let t = texCache.get(key);
  if (t) return t;
  const W = 512, H = kind === "prayer" ? 896 : 512;
  const cv = makeCanvas(W, H);
  const g = cv.getContext("2d") as CanvasRenderingContext2D;
  const base = color(hex);
  const c = (k: number) => {
    const cc = base.clone().multiplyScalar(k);
    return `rgb(${Math.min(255, cc.r * 255) | 0},${Math.min(255, cc.g * 255) | 0},${Math.min(255, cc.b * 255) | 0})`;
  };
  const r = rng(hashStr(key));
  g.fillStyle = c(1);
  g.fillRect(0, 0, W, H);
  if (kind === "modern") {
    // subtle abstract: tone-on-tone lines + border
    g.strokeStyle = c(0.86);
    g.lineWidth = 3;
    for (let i = 0; i < 9; i++) {
      g.beginPath();
      const y = r() * H;
      g.moveTo(0, y);
      g.bezierCurveTo(W * 0.3, y + (r() - 0.5) * 180, W * 0.7, y + (r() - 0.5) * 180, W, y + (r() - 0.5) * 60);
      g.stroke();
    }
    g.strokeStyle = c(0.78);
    g.lineWidth = 14;
    g.strokeRect(18, 18, W - 36, H - 36);
  } else {
    // classic / prayer: border bands, field motifs
    g.fillStyle = c(0.62);
    g.fillRect(0, 0, W, H);
    g.fillStyle = c(1);
    g.fillRect(28, 28, W - 56, H - 56);
    g.strokeStyle = "#e9dcc0";
    g.lineWidth = 6;
    g.strokeRect(44, 44, W - 88, H - 88);
    g.fillStyle = "#e9dcc0";
    if (kind === "prayer") {
      // mihrab arch at the top end
      g.beginPath();
      g.moveTo(90, H * 0.42);
      g.lineTo(90, H * 0.24);
      g.quadraticCurveTo(W / 2, H * 0.02, W - 90, H * 0.24);
      g.lineTo(W - 90, H * 0.42);
      g.closePath();
      g.globalAlpha = 0.35;
      g.fill();
      g.globalAlpha = 1;
      g.stroke();
      for (let i = 0; i < 6; i++) {
        g.beginPath();
        g.arc(W / 2, H * (0.5 + i * 0.07), 14, 0, Math.PI * 2);
        g.fill();
      }
    } else {
      for (let i = 0; i < 5; i++)
        for (let j = 0; j < 5; j++) {
          g.save();
          g.translate(80 + i * 88, 80 + j * 88);
          g.rotate(Math.PI / 4);
          g.globalAlpha = 0.6;
          g.fillRect(-14, -14, 28, 28);
          g.restore();
        }
      g.globalAlpha = 1;
    }
  }
  grain(g, W, H, 0.32);
  t = new THREE.CanvasTexture(cv as HTMLCanvasElement);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  texCache.set(key, t);
  return t;
}

/** Overlay a cached noise tile (cheap grain without per-pixel readback). */
let noiseTile: HTMLCanvasElement | OffscreenCanvas | null = null;
function grain(g: CanvasRenderingContext2D, W: number, H: number, alpha: number): void {
  if (!noiseTile) {
    const N = 128;
    noiseTile = makeCanvas(N);
    const ng = noiseTile.getContext("2d") as CanvasRenderingContext2D;
    const img = ng.createImageData(N, N);
    const r = rng(1234);
    for (let i = 0; i < N * N; i++) {
      const v = (r() * 255) | 0;
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    ng.putImageData(img, 0, 0);
  }
  const pat = g.createPattern(noiseTile as HTMLCanvasElement, "repeat");
  if (!pat) return;
  g.save();
  g.globalAlpha = alpha;
  g.globalCompositeOperation = "overlay";
  g.fillStyle = pat;
  g.fillRect(0, 0, W, H);
  g.restore();
}

export function texturedMat(M: MaterialLib, key: string, map: THREE.Texture, roughness = 0.9): THREE.Material {
  const cache = M as unknown as { _tex?: Map<string, THREE.Material> };
  cache._tex ??= new Map();
  let m = cache._tex.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ map, roughness, metalness: 0 });
    m.name = key;
    cache._tex.set(key, m);
    M.created.push(m);
  }
  return m;
}

/** A unit plane facing +z with native 0..1 UVs (for art / screens / rugs). */
export function planeGeo(): THREE.BufferGeometry {
  return cachedPlane;
}
const cachedPlane = new THREE.PlaneGeometry(1, 1);

export { roundedBox, unitBox, mat4 };
