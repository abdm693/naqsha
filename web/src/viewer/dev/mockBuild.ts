/**
 * DEV-ONLY stand-in for engine.buildHouse (track: VIEWER).
 *
 * HouseViewer falls back to this only while the real engine throws "not implemented". It turns a BuildingPlan
 * into simple, fully-tagged geometry with the same BuildResult shape: walls along room edges with gaps for
 * openings, slabs per level, stairs (visible treads + invisible ramp colliders), a few box furniture items,
 * landscape, a "sun" directional light and warm interior lights. Units: plan feet → world meters (+Y up).
 */
import * as THREE from "three";
import type { BuildingPlan, Level, Opening, Rect, Room, Stair } from "@contracts/plan";
import type { Layer } from "@contracts/house-sdk";
import type { AsBuiltSummary } from "@contracts/api-types";
import type { BuildResult, DesignSectionSrc, SectionResult } from "@/engine";

const FT = 0.3048;
/** Plan ft → world m (contracts/plan.ts): x = x_ft, z = −y_ft (road at +z), Y = h_ft. */
const W = (x_ft: number, y_ft: number, h_ft = 0) => new THREE.Vector3(x_ft * FT, h_ft * FT, -y_ft * FT);
const EXT_T = 0.75;
const INT_T = 0.375;
const OUTDOOR = new Set(["porch", "balcony", "terrace", "lawn", "driveway", "courtyard", "open_space"]);
const RAILED = new Set(["balcony", "terrace"]);

type Side = "front" | "back" | "left" | "right";
interface Tags { layer: Layer; level?: string; room?: string; kind: string; label?: string; id?: string }
interface Box { x0: number; x1: number; y0: number; y1: number; h0: number; h1: number }

type MatKey =
  | "plaster" | "interior" | "ceiling" | "plinth" | "stone" | "teak" | "metal" | "glass" | "railGlass"
  | "marble" | "porcelain_tile" | "terrazzo" | "wood" | "ceramic_tile" | "concrete" | "grass" | "paving"
  | "asphalt" | "kerb" | "fabric" | "fabric2" | "linen" | "walnut" | "white" | "black" | "chrome"
  | "carPaint" | "rubber" | "leaf" | "bark" | "neighbour" | "neighbour2" | "lightEmissive" | "tv" | "water";

function makeMaterials(plan: BuildingPlan): Record<MatKey, THREE.Material> {
  const pal = plan.style.palette;
  const std = (color: string, roughness = 0.85, metalness = 0, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
  return {
    plaster: std(pal[0] ?? "#f4f1ec", 0.92),
    interior: std("#efe8dc", 0.9),
    ceiling: std("#f7f5f1", 0.95),
    plinth: std("#9d968b", 0.9),
    stone: std(pal[1] ?? "#8b877f", 0.82),
    teak: std(pal[2] ?? "#a26a3c", 0.55),
    metal: std(pal[3] ?? "#1f1f22", 0.38, 0.65),
    glass: new THREE.MeshPhysicalMaterial({ color: "#b8d2de", roughness: 0.04, metalness: 0, transparent: true, opacity: 0.22, depthWrite: false, envMapIntensity: 1.4 }),
    railGlass: new THREE.MeshPhysicalMaterial({ color: "#cfe3ea", roughness: 0.05, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }),
    marble: std("#eeeae3", 0.16),
    porcelain_tile: std("#e2dcd1", 0.3),
    terrazzo: std("#d9d4ca", 0.35),
    wood: std("#a0714a", 0.5),
    ceramic_tile: std("#d6d2ca", 0.32),
    concrete: std("#b3ada3", 0.9),
    grass: std("#6f8f48", 0.97),
    paving: std("#bdb3a4", 0.86),
    asphalt: std("#3a3c3f", 0.96),
    kerb: std("#a29d94", 0.9),
    fabric: std("#5d6b72", 0.96),
    fabric2: std("#c9b79c", 0.95),
    linen: std("#f1ede6", 0.95),
    walnut: std("#5c3f2b", 0.5),
    white: std("#f3f1ed", 0.6),
    black: std("#1b1b1d", 0.5),
    chrome: std("#c8c8c8", 0.2, 1),
    carPaint: std("#7d1f1f", 0.32, 0.4),
    rubber: std("#151515", 0.9),
    leaf: std("#4f7a3a", 0.9),
    bark: std("#5b4632", 0.95),
    neighbour: std("#e6dfd2", 0.92),
    neighbour2: std("#d8cfc0", 0.92),
    lightEmissive: new THREE.MeshStandardMaterial({ color: "#ffffff", emissive: "#ffe9c4", emissiveIntensity: 5, roughness: 0.6 }),
    tv: new THREE.MeshStandardMaterial({ color: "#0d0f12", roughness: 0.15, metalness: 0.2, emissive: "#1d2a3a", emissiveIntensity: 0.4 }),
    water: std("#4a7fa1", 0.1, 0),
  };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

class MockBuilder {
  root = new THREE.Group();
  colliders: THREE.Mesh[] = [];
  mats: Record<MatKey, THREE.Material>;
  levels: Level[];
  private seq = 0;
  private count = 0;
  private built = new Set<string>();

  constructor(public plan: BuildingPlan) {
    this.mats = makeMaterials(plan);
    this.levels = [...plan.levels].sort((a, b) => a.index - b.index);
    this.root.name = "mock-house";
    this.root.userData = { kind: "house_root" };
  }

  take(): number { const c = this.count; this.count = 0; return c; }

  level(id: string) { return this.levels.find((l) => l.id === id)!; }
  levelAbove(l: Level) { return this.levels.find((x) => x.index === l.index + 1); }
  rooms(levelId: string) { return this.plan.rooms.filter((r) => r.level === levelId); }

  tag(o: THREE.Object3D, t: Tags) {
    o.userData = { layer: t.layer, level: t.level, room: t.room, kind: t.kind, label: t.label, id: t.id ?? `${t.kind.replace(/[^a-z0-9]+/gi, "_")}_${++this.seq}` };
    return o;
  }

  add<T extends THREE.Object3D>(o: T, t: Tags, parent: THREE.Object3D = this.root): T {
    this.tag(o, t);
    parent.add(o);
    this.count++;
    return o;
  }

  boxMesh(b: Box, mat: THREE.Material | THREE.Material[], shadow = true): THREE.Mesh | null {
    const w = (b.x1 - b.x0) * FT, d = (b.y1 - b.y0) * FT, h = (b.h1 - b.h0) * FT;
    if (w <= 1e-4 || d <= 1e-4 || h <= 1e-4) return null;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.copy(W((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.h0 + b.h1) / 2));
    m.castShadow = shadow;
    m.receiveShadow = true;
    return m;
  }

  box(b: Box, mat: THREE.Material | THREE.Material[], t: Tags, opts: { collider?: boolean; shadow?: boolean } = {}) {
    const m = this.boxMesh(b, mat, opts.shadow ?? true);
    if (!m) return null;
    this.add(m, t);
    if (opts.collider) this.colliders.push(m);
    return m;
  }

  // ───────────────────────────── structure ─────────────────────────────

  structure() {
    if (this.built.has("structure")) return;
    this.built.add("structure");
    const plan = this.plan;
    for (const lvl of this.levels) {
      if (lvl.id === "roof" || this.rooms(lvl.id).length === 0) continue;
      this.slabs(lvl);
      this.walls(lvl);
      this.porchColumns(lvl);
    }
    this.roof();
    for (const st of plan.stairs) this.stair(st);
    this.boundary();
  }

  /** Floor slabs: ground = solid plinth blocks; upper levels = slabs with stair holes. Top face = floor finish. */
  slabs(lvl: Level) {
    const isGround = lvl.index === 0;
    for (const r of this.rooms(lvl.id)) {
      const finish = this.finishMat(r);
      const holes = this.plan.stairs.filter((s) => s.to_level === lvl.id && this.rectInside(s.rect, r.rect)).map((s) => this.stairHole(s));
      const t: Tags = { layer: "structure", level: lvl.id, room: r.id, kind: isGround ? "floor" : "slab", label: `${r.name} floor` };
      if (isGround && r.type === "driveway") {
        // ramp from the road crown up to the plinth
        const g = rampGeometry(r.rect, 0, lvl.elevation_ft);
        const m = this.add(new THREE.Mesh(g, this.mats.paving), { ...t, kind: "driveway" });
        m.receiveShadow = true;
        this.colliders.push(m);
        continue;
      }
      const h0 = isGround ? 0 : lvl.elevation_ft - lvl.slab_ft;
      const side = isGround ? this.mats.plinth : this.mats.plaster;
      const mats = [side, side, finish, isGround ? side : this.mats.ceiling, side, side];
      for (const part of subtractRects(r.rect, holes)) {
        this.box({ x0: part.x, x1: part.x + part.w, y0: part.y, y1: part.y + part.d, h0, h1: lvl.elevation_ft }, mats, t, { collider: true, shadow: !isGround });
      }
    }
  }

  finishMat(r: Room): THREE.Material {
    const f = r.floor_finish;
    if (f && f in this.mats) return this.mats[f as MatKey];
    if (r.type === "lawn") return this.mats.grass;
    if (OUTDOOR.has(r.type)) return this.mats.paving;
    if (r.type.includes("bed")) return this.mats.wood;
    if (r.type === "bath" || r.type === "powder") return this.mats.ceramic_tile;
    return this.mats.porcelain_tile;
  }

  rectInside(a: Rect, b: Rect) {
    return a.x >= b.x - 0.01 && a.y >= b.y - 0.01 && a.x + a.w <= b.x + b.w + 0.01 && a.y + a.d <= b.y + b.d + 0.01;
  }

  walls(lvl: Level) {
    const rooms = this.rooms(lvl.id);
    const h0 = lvl.elevation_ft;
    const above = this.levelAbove(lvl);
    const h1 = above ? above.elevation_ft - above.slab_ft : h0 + lvl.height_ft - lvl.slab_ft;
    const openings = this.plan.openings.filter((o) => o.level === lvl.id);
    for (const seg of wallSegments(rooms)) {
      const roomA = seg.rooms[0];
      if (seg.kind === "none") continue;
      if (seg.kind === "railing") {
        this.railing(seg, h0, { layer: "structure", level: lvl.id, room: roomA.id, kind: "railing", label: `${roomA.name} railing` });
        continue;
      }
      const t = seg.kind === "exterior" ? EXT_T : INT_T;
      const ops = openings
        .filter((o) => onSegment(o, seg))
        .map((o) => ({ o, a: (seg.axis === "x" ? o.at[0] : o.at[1]) - o.width_ft / 2, b: (seg.axis === "x" ? o.at[0] : o.at[1]) + o.width_ft / 2 }))
        .sort((p, q) => p.a - q.a);
      const mat = seg.kind === "exterior" ? this.mats.plaster : this.mats.interior;
      const tags: Tags = { layer: "structure", level: lvl.id, room: roomA.id, kind: "wall", label: seg.kind === "exterior" ? "Exterior wall" : "Interior wall" };
      const ext = seg.kind === "exterior" ? t / 2 : 0;
      let cursor = seg.a - ext;
      const piece = (a: number, b: number, ph0: number, ph1: number) => {
        if (b - a < 0.02 || ph1 - ph0 < 0.02) return;
        this.box(segBox(seg, a, b, t, ph0, ph1), mat, tags, { collider: true });
      };
      for (const { o, a, b } of ops) {
        piece(cursor, a, h0, h1);
        const sill = o.sill_ft ?? (o.type === "window" || o.type === "corner_window" ? 3 : o.type === "ventilator" ? 6 : 0);
        const head = Math.min(h1, h0 + sill + o.height_ft);
        piece(a, b, h0, h0 + sill);
        piece(a, b, head, h1);
        this.openingFill(seg, o, a, b, h0 + sill, head, t, lvl.id);
        cursor = b;
      }
      piece(cursor, seg.b + ext, h0, h1);
    }
  }

  openingFill(seg: Segment, o: Opening, a: number, b: number, s: number, hd: number, t: number, level: string) {
    const room = seg.rooms.find((r) => o.between.includes(r.id))?.id ?? seg.rooms[0].id;
    const isGlazed = o.type === "window" || o.type === "corner_window" || o.type === "ventilator" || o.type === "sliding_door";
    const fr = 0.18; // frame size, ft
    const frameMat = isGlazed ? this.mats.metal : this.mats.teak;
    const group = new THREE.Group();
    const kind = o.type === "main_door" || o.type === "double_door" ? "door" : o.type;
    const pieces: Box[] = [
      segBox(seg, a, a + fr, t + 0.08, s, hd),
      segBox(seg, b - fr, b, t + 0.08, s, hd),
      segBox(seg, a, b, t + 0.08, hd - fr, hd),
    ];
    if (isGlazed) pieces.push(segBox(seg, a, b, t + 0.08, s, s + fr));
    for (const p of pieces) { const m = this.boxMesh(p, frameMat); if (m) group.add(m); }
    if (isGlazed) {
      const pane = this.boxMesh(segBox(seg, a + fr, b - fr, 0.05, s + fr, hd - fr), this.mats.glass, false);
      if (pane) { pane.castShadow = false; group.add(pane); }
      if (o.type === "sliding_door") {
        const mid = this.boxMesh(segBox(seg, (a + b) / 2 - fr / 2, (a + b) / 2 + fr / 2, 0.12, s, hd), frameMat);
        if (mid) group.add(mid);
      }
    }
    const label = o.type === "main_door" ? "Main door" : `${o.type.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())}`;
    this.add(group, { layer: "structure", level, room, kind, label, id: o.id });
  }

  railing(seg: Segment, h0: number, tags: Tags) {
    const g = new THREE.Group();
    const glass = this.boxMesh(segBox(seg, seg.a, seg.b, 0.06, h0 + 0.15, h0 + 3.3), this.mats.railGlass, false);
    const rail = this.boxMesh(segBox(seg, seg.a, seg.b, 0.18, h0 + 3.3, h0 + 3.5), this.mats.metal);
    if (glass) g.add(glass);
    if (rail) g.add(rail);
    this.add(g, tags);
    const col = this.boxMesh(segBox(seg, seg.a, seg.b, 0.2, h0, h0 + 3.5), this.mats.metal);
    if (col) { col.visible = false; col.userData = { kind: "railing_collider", layer: "structure", level: tags.level }; this.root.add(col); this.colliders.push(col); }
  }

  porchColumns(lvl: Level) {
    const above = this.levelAbove(lvl);
    if (!above) return;
    const enclosed = this.rooms(lvl.id).filter((r) => !OUTDOOR.has(r.type));
    for (const r of this.rooms(lvl.id).filter((x) => x.type === "porch")) {
      const corners: [number, number][] = [[r.rect.x, r.rect.y], [r.rect.x + r.rect.w, r.rect.y], [r.rect.x, r.rect.y + r.rect.d], [r.rect.x + r.rect.w, r.rect.y + r.rect.d]];
      for (const [cx, cy] of corners) {
        const touches = enclosed.some((e) => cx >= e.rect.x - 0.1 && cx <= e.rect.x + e.rect.w + 0.1 && cy >= e.rect.y - 0.1 && cy <= e.rect.y + e.rect.d + 0.1);
        if (touches) continue;
        const ix = Math.min(Math.max(cx, r.rect.x + 0.6), r.rect.x + r.rect.w - 0.6);
        const iy = Math.min(Math.max(cy, r.rect.y + 0.6), r.rect.y + r.rect.d - 0.6);
        this.box({ x0: ix - 0.5, x1: ix + 0.5, y0: iy - 0.5, y1: iy + 0.5, h0: lvl.elevation_ft, h1: above.elevation_ft }, this.mats.stone, { layer: "structure", level: lvl.id, room: r.id, kind: "column", label: "Porch column" }, { collider: true });
      }
    }
  }

  roof() {
    const roofLvl = this.levels.find((l) => l.id === "roof");
    if (!roofLvl) return;
    const below = this.levels.find((l) => l.index === roofLvl.index - 1);
    if (!below) return;
    const roofed = this.rooms(below.id).filter((r) => !OUTDOOR.has(r.type));
    const h1 = roofLvl.elevation_ft;
    for (const r of roofed) {
      const holes = this.plan.stairs.filter((s) => s.to_level === roofLvl.id && this.rectInside(s.rect, r.rect)).map((s) => this.stairHole(s));
      for (const part of subtractRects(r.rect, holes)) {
        this.box(
          { x0: part.x, x1: part.x + part.w, y0: part.y, y1: part.y + part.d, h0: h1 - roofLvl.slab_ft, h1 },
          [this.mats.plaster, this.mats.plaster, this.mats.concrete, this.mats.ceiling, this.mats.plaster, this.mats.plaster],
          { layer: "structure", level: "roof", room: r.id, kind: "slab", label: "Roof slab" },
          { collider: true },
        );
      }
    }
    // parapet on the outer edges of the roofed footprint
    for (const seg of wallSegments(roofed.map((r) => ({ ...r, open_to: roofed.map((x) => x.id) })))) {
      if (seg.kind !== "exterior") continue;
      this.box(segBox(seg, seg.a - EXT_T / 2, seg.b + EXT_T / 2, EXT_T, h1, h1 + this.plan.roof.parapet_ft), this.mats.plaster, { layer: "structure", level: "roof", kind: "parapet", label: "Roof parapet" }, { collider: true });
    }
    const mumty = this.plan.roof.mumty;
    if (mumty) {
      const r = mumty.rect;
      const top = h1 + mumty.height_ft;
      const sides: { side: Side; seg: Segment }[] = [
        { side: "front", seg: mkSeg("x", r.y, r.x, r.x + r.w) },
        { side: "back", seg: mkSeg("x", r.y + r.d, r.x, r.x + r.w) },
        { side: "left", seg: mkSeg("y", r.x, r.y, r.y + r.d) },
        { side: "right", seg: mkSeg("y", r.x + r.w, r.y, r.y + r.d) },
      ];
      const tags: Tags = { layer: "structure", level: "roof", kind: "mumty", label: "Mumty (stair tower)" };
      for (const { side, seg } of sides) {
        if (side === mumty.door_side) {
          const len = seg.b - seg.a;
          const da = seg.a + Math.min(1.0, len * 0.1), db = da + 3.25;
          this.box(segBox(seg, seg.a - EXT_T / 2, da, EXT_T, h1, top), this.mats.plaster, tags, { collider: true });
          this.box(segBox(seg, da, db, EXT_T, h1 + 7.2, top), this.mats.plaster, tags, { collider: true });
          this.box(segBox(seg, db, seg.b + EXT_T / 2, EXT_T, h1, top), this.mats.plaster, tags, { collider: true });
        } else {
          this.box(segBox(seg, seg.a - EXT_T / 2, seg.b + EXT_T / 2, EXT_T, h1, top), this.mats.plaster, tags, { collider: true });
        }
      }
      this.box({ x0: r.x - 0.4, x1: r.x + r.w + 0.4, y0: r.y - 0.4, y1: r.y + r.d + 0.4, h0: top, h1: top + 0.5 }, [this.mats.plaster, this.mats.plaster, this.mats.concrete, this.mats.ceiling, this.mats.plaster, this.mats.plaster], { ...tags, kind: "slab", label: "Mumty roof" }, { collider: true });
    }
    const tank = this.plan.roof.water_tank;
    if (tank) {
      const r = tank.rect;
      this.box({ x0: r.x, x1: r.x + r.w, y0: r.y, y1: r.y + r.d, h0: h1, h1: h1 + tank.height_ft }, this.mats.white, { layer: "structure", level: "roof", kind: "water_tank", label: "Water tank" }, { collider: true });
    }
  }

  // stairs: local frame u = along the first flight, v = across; see `stairFrame`
  stairHole(s: Stair): Rect {
    const f = stairFrame(s);
    return f.rect(f.uStart, f.len - f.uStart, 0, f.wid);
  }

  stair(s: Stair) {
    const from = this.level(s.from_level), to = this.level(s.to_level);
    if (!from || !to) return;
    const f = stairFrame(s);
    const h0 = from.elevation_ft, h1 = to.elevation_ft, hMid = (h0 + h1) / 2;
    const room = this.plan.rooms.find((r) => r.level === s.from_level && this.rectInside(s.rect, r.rect))?.id;
    const tags: Tags = { layer: "structure", level: s.from_level, room, kind: "stair", label: "Staircase", id: s.id };
    const group = this.add(new THREE.Group(), tags);
    const ground = from.index === 0;
    const gap = 0.25;
    const wA = (f.wid - gap) / 2;
    const L = Math.min(s.width_ft, f.len * 0.36);
    const uLand = f.len - L;
    const riser = s.riser_in / 12;
    const rampMat = this.mats.concrete;
    const ramp = (geo: THREE.BufferGeometry, kind: string) => {
      const m = new THREE.Mesh(geo, rampMat);
      m.visible = false; // invisible collider, like the engine's ramps
      m.userData = { layer: "structure", level: s.from_level, room, kind, id: `${s.id}_${kind}` };
      this.root.add(m);
      this.colliders.push(m);
    };
    const treadMat = this.finishMat(this.plan.rooms.find((r) => r.id === room) ?? ({ type: "stair", floor_finish: "marble" } as Room));
    const steps = (u0: number, u1: number, v0: number, v1: number, ha: number, hb: number, solid: boolean) => {
      const n = Math.max(1, Math.round((hb - ha) / riser));
      for (let i = 0; i < n; i++) {
        const ua = u0 + ((u1 - u0) * i) / n, ub = u0 + ((u1 - u0) * (i + 1)) / n;
        const top = ha + ((hb - ha) * (i + 1)) / n;
        const r = f.rect(Math.min(ua, ub), Math.abs(ub - ua), v0, v1 - v0);
        const m = this.boxMesh({ x0: r.x, x1: r.x + r.w, y0: r.y, y1: r.y + r.d, h0: solid ? ha : top - riser - 0.35, h1: top }, treadMat);
        if (m) group.add(m);
      }
    };
    // Flight A: u ∈ [uStart, uLand], v ∈ [0, wA], h0 → hMid
    steps(f.uStart, uLand, 0, wA, h0, hMid, ground);
    ramp(f.prism([[f.uStart, h0], [uLand, hMid], [uLand, ground ? h0 : hMid - 0.6], ...(ground ? [] : [[f.uStart, h0 - 0.6] as [number, number]])], 0, wA), "stair_ramp");
    // Landing: u ∈ [uLand, len], full width
    const land = f.rect(uLand, L, 0, f.wid);
    const lm = this.boxMesh({ x0: land.x, x1: land.x + land.w, y0: land.y, y1: land.y + land.d, h0: ground ? h0 : hMid - 0.6, h1: hMid }, treadMat);
    if (lm) { group.add(lm); this.colliders.push(lm); }
    // Flight B: u from uLand back to uStart on v ∈ [wA + gap, wid], hMid → h1 (a waist slab)
    steps(uLand, f.uStart, wA + gap, f.wid, hMid, h1, false);
    ramp(f.prism([[uLand, hMid], [f.uStart, h1], [f.uStart, h1 - 0.7], [uLand, hMid - 0.7]], wA + gap, f.wid), "stair_ramp");
    if (ground) {
      // under-stair store below the low end of flight B (no head-bumping from the ground floor)
      const u0 = Math.max(f.uStart, uLand - 3);
      const hB0 = h1 - ((h1 - hMid) * (u0 - f.uStart)) / (uLand - f.uStart);
      const store = new THREE.Mesh(f.prism([[u0, h0], [uLand, h0], [uLand, hMid - 0.7], [u0, hB0 - 0.7]], wA + gap, f.wid), this.mats.interior);
      store.castShadow = store.receiveShadow = true;
      group.add(store);
      this.colliders.push(store);
    }
    // inner railing (between flights) and the outer railing of flight B
    const hA = (u: number) => h0 + ((hMid - h0) * (u - f.uStart)) / (uLand - f.uStart);
    const hB = (u: number) => h1 - ((h1 - hMid) * (u - f.uStart)) / (uLand - f.uStart);
    const uA = f.uStart + 1.6, uB = f.uStart + 2.2;
    const railA = f.prism([[uA, hA(uA) + 3.2], [uLand, hMid + 3.2], [uLand, hMid], [uA, hA(uA)]], wA - 0.06, wA + gap + 0.06);
    const rail = new THREE.Mesh(railA, this.mats.railGlass);
    rail.castShadow = false;
    group.add(rail);
    this.colliders.push(rail);
    const railB = f.prism([[uLand, hMid + 3.2], [uB, hB(uB) + 3.2], [uB, hB(uB)], [uLand, hMid]], f.wid - 0.1, f.wid + 0.02);
    const rb = new THREE.Mesh(railB, this.mats.railGlass);
    rb.castShadow = false;
    group.add(rb);
    this.colliders.push(rb);
    // railing around the void on the upper floor (outer edge of flight B)
    const vr = f.rect(f.uStart + 2.4, f.len - f.uStart - 2.4, f.wid - 0.1, 0.12);
    this.railing(rectSeg(vr), h1, { layer: "structure", level: s.to_level, room, kind: "railing", label: "Stair railing" });
  }

  boundary() {
    const { plot, boundary_wall: bw, gates } = this.plan.site;
    const W = plot.width_ft, D = plot.depth_ft;
    const tags: Tags = { layer: "structure", level: "ground", kind: "boundary_wall", label: "Boundary wall" };
    const t = 0.75;
    // front wall with gate gaps
    const gaps = gates.map((g) => [g.at[0] - g.width_ft / 2, g.at[0] + g.width_ft / 2] as [number, number]).sort((a, b) => a[0] - b[0]);
    let cur = -t / 2;
    const front = mkSeg("x", 0, 0, W);
    for (const [a, b] of gaps) {
      this.box(segBox(front, cur, a, t, 0, bw.front_height_ft), this.mats.plaster, tags, { collider: true });
      for (const px of [a, b]) this.box({ x0: px - 0.6, x1: px + 0.6, y0: -0.6, y1: 0.6, h0: 0, h1: bw.front_height_ft + 1 }, this.mats.stone, { ...tags, kind: "gate_pillar", label: "Gate pillar" }, { collider: true });
      cur = b;
    }
    this.box(segBox(front, cur, W + t / 2, t, 0, bw.front_height_ft), this.mats.plaster, tags, { collider: true });
    this.box(segBox(mkSeg("y", 0, 0, D), 0, D + t / 2, t, 0, bw.side_height_ft), this.mats.plaster, tags, { collider: true });
    this.box(segBox(mkSeg("y", W, 0, D), 0, D + t / 2, t, 0, bw.side_height_ft), this.mats.plaster, tags, { collider: true });
    this.box(segBox(mkSeg("x", D, 0, W), -t / 2, W + t / 2, t, 0, bw.rear_height_ft), this.mats.plaster, tags, { collider: true });
    // sliding car gate (metal slats) drawn open, parked against the wall
    for (const g of gates) {
      const grp = new THREE.Group();
      const a = g.at[0] - g.width_ft / 2;
      const n = Math.max(3, Math.round(g.width_ft / 0.6));
      for (let i = 0; i < n; i++) {
        const x = a + (i + 0.5) * (g.width_ft / n);
        const m = this.boxMesh({ x0: x - 0.08, x1: x + 0.08, y0: -1.2, y1: -1.05, h0: 0.3, h1: bw.front_height_ft + 0.6 }, this.mats.metal);
        if (m) grp.add(m);
      }
      const rail = this.boxMesh({ x0: a, x1: a + g.width_ft, y0: -1.25, y1: -1.0, h0: bw.front_height_ft + 0.4, h1: bw.front_height_ft + 0.7 }, this.mats.metal);
      if (rail) grp.add(rail);
      grp.position.x = (g.kind === "sliding" ? -g.width_ft * 0.85 : 0) * FT;
      if (g.kind !== "sliding") grp.visible = true;
      this.add(grp, { layer: "structure", level: "ground", kind: "gate", label: g.kind === "pedestrian" ? "Pedestrian gate" : "Car gate", id: g.id });
    }
  }

  // ───────────────────────────── facade ─────────────────────────────

  facade() {
    if (this.built.has("facade")) return;
    this.built.add("facade");
    const g = this.levels.find((l) => l.index === 0)!;
    const roofLvl = this.levels.find((l) => l.id === "roof");
    const top = (roofLvl?.elevation_ft ?? g.elevation_ft + 22) + this.plan.roof.parapet_ft;
    const enclosed = this.plan.rooms.filter((r) => !OUTDOOR.has(r.type));
    const frontY = Math.min(...enclosed.map((r) => r.rect.y));
    const maxX = Math.max(...enclosed.map((r) => r.rect.x + r.rect.w));
    // stone-clad pier at the front right corner
    this.box({ x0: maxX - 3.2, x1: maxX + 0.5, y0: frontY - 0.85, y1: frontY - 0.35, h0: g.elevation_ft, h1: top + 0.6 }, this.mats.stone, { layer: "facade", kind: "facade:cladding", label: "Grey stone cladding pier" }, { collider: true });
    // vertical teak fins over the first floor front of the leftmost front room
    const first = this.levels.find((l) => l.index === 1);
    const frontRoom = this.plan.rooms.filter((r) => r.level === first?.id && !OUTDOOR.has(r.type)).sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x)[0];
    if (first && frontRoom) {
      const grp = new THREE.Group();
      const n = 9;
      for (let i = 0; i < n; i++) {
        const x = frontRoom.rect.x + 0.6 + (i * (frontRoom.rect.w - 1.2)) / (n - 1);
        const m = this.boxMesh({ x0: x - 0.15, x1: x + 0.15, y0: frontRoom.rect.y - 1.6, y1: frontRoom.rect.y - 0.4, h0: first.elevation_ft - 0.4, h1: first.elevation_ft + first.height_ft - 0.2 }, this.mats.teak);
        if (m) grp.add(m);
      }
      this.add(grp, { layer: "facade", level: first.id, room: frontRoom.id, kind: "facade:fins", label: "Teak fins" });
    }
    // porch canopy with downlights
    const porch = this.plan.rooms.find((r) => r.type === "porch");
    if (porch && first) {
      this.box({ x0: porch.rect.x - 0.5, x1: porch.rect.x + porch.rect.w + 0.3, y0: porch.rect.y - 2.5, y1: porch.rect.y + 0.5, h0: first.elevation_ft - 0.9, h1: first.elevation_ft - 0.3 }, [this.mats.plaster, this.mats.plaster, this.mats.plaster, this.mats.teak, this.mats.plaster, this.mats.plaster], { layer: "facade", level: "ground", room: porch.id, kind: "facade:canopy", label: "Timber-soffit canopy" });
    }
    // black frame around the drawing-room window
    const w1 = this.plan.openings.find((o) => o.type === "window" && o.level === g.id && o.at[1] <= frontY + 0.1);
    if (w1) {
      const a = w1.at[0] - w1.width_ft / 2 - 0.6, b = w1.at[0] + w1.width_ft / 2 + 0.6;
      const s = g.elevation_ft + (w1.sill_ft ?? 3) - 0.6, hd = g.elevation_ft + (w1.sill_ft ?? 3) + w1.height_ft + 0.6;
      const grp = new THREE.Group();
      const y0 = w1.at[1] - 1.5, y1 = w1.at[1] - 0.35;
      for (const bx of [
        { x0: a, x1: a + 0.4, y0, y1, h0: s, h1: hd }, { x0: b - 0.4, x1: b, y0, y1, h0: s, h1: hd },
        { x0: a, x1: b, y0, y1, h0: hd - 0.4, h1: hd }, { x0: a, x1: b, y0, y1, h0: s, h1: s + 0.4 },
      ]) { const m = this.boxMesh(bx, this.mats.metal); if (m) grp.add(m); }
      this.add(grp, { layer: "facade", level: g.id, room: w1.between[0], kind: "facade:frame", label: "Black window frame" });
    }
  }

  // ───────────────────────────── furniture ─────────────────────────────

  furnish(roomId: string) {
    const r = this.plan.rooms.find((x) => x.id === roomId);
    if (!r || this.built.has(`furnish_${roomId}`)) return;
    this.built.add(`furnish_${roomId}`);
    const lvl = this.level(r.level);
    const h = lvl.elevation_ft;
    const t = (kind: string, label: string): Tags => ({ layer: "furniture", level: r.level, room: r.id, kind: `furniture:${kind}`, label });
    const side = this.freeSide(r);
    const c = this.roomCenter(r);
    switch (r.type) {
      case "drawing":
      case "lounge": {
        if (side) {
          this.item(r, side, sofa(this.mats, 7.2, 3.0), t("sofa_3", "3-seat sofa"), h, true);
          const opp = oppositeSide(side);
          const info = this.sideInfo(r, opp);
          if (!info.ops && !info.open) {
            const tv = r.type === "lounge";
            this.item(r, opp, tvUnit(this.mats, tv), t(tv ? "tv_unit" : "console_table", tv ? "TV unit" : "Console table"), h, true);
          }
          const toward = side === "back" ? [0, 1.6] : side === "front" ? [0, -1.6] : side === "left" ? [-1.6, 0] : [1.6, 0];
          this.placeAt(r, c.x + toward[0], c.y + toward[1], sideRot(side), coffeeTable(this.mats), t("coffee_table", "Coffee table"), h, true);
        }
        this.placeAt(r, c.x, c.y, 0, rug(this.mats, 8, 6), t("rug", "Rug"), h, false);
        break;
      }
      case "dining":
        this.placeAt(r, c.x, c.y, r.rect.w > r.rect.d ? 0 : Math.PI / 2, diningTable(this.mats), t("dining_table_6", "Dining table"), h, true);
        break;
      case "master_bedroom":
      case "bedroom":
      case "guest_bedroom": {
        const king = r.type === "master_bedroom";
        if (side) this.item(r, side, bed(this.mats, king ? 6.4 : 5.3, 6.8), t(king ? "bed_king" : "bed_queen", king ? "King bed" : "Queen bed"), h, true);
        break;
      }
      case "kitchen": {
        if (side) this.item(r, side, counter(this.mats, Math.min(10, (side === "left" || side === "right" ? r.rect.d : r.rect.w) - 2.5)), t("kitchen_counter", "Kitchen counter"), h, true);
        break;
      }
      case "porch": {
        // park along the porch's long axis, on the side away from the main door
        const door = this.plan.openings.find((o) => o.type === "main_door" && o.between.includes(r.id));
        const alongY = r.rect.d >= r.rect.w;
        let px = c.x, py = c.y;
        if (door && alongY) px = door.at[0] > c.x ? r.rect.x + 4 : r.rect.x + r.rect.w - 4;
        if (door && !alongY) py = door.at[1] > c.y ? r.rect.y + 4 : r.rect.y + r.rect.d - 4;
        this.placeAt(r, px, py, alongY ? 0 : Math.PI / 2, car(this.mats), { ...t("car_sedan", "Car"), layer: "furniture" }, h, true);
        break;
      }
      case "bath":
      case "powder": {
        if (side) this.item(r, side, vanity(this.mats), t("vanity", "Vanity"), h, true);
        break;
      }
      default:
        break;
    }
  }

  roomCenter(r: Room) { return { x: r.rect.x + r.rect.w / 2, y: r.rect.y + r.rect.d / 2 }; }

  /** Openings on one side of a room, and whether that side is open to a neighbour (open plan). */
  sideInfo(r: Room, s: Side): { ops: number; open: boolean } {
    const { x, y, w, d } = r.rect;
    const ops = this.plan.openings.filter((o) => o.level === r.level && o.between.includes(r.id)).filter((o) => {
      if (s === "front") return Math.abs(o.at[1] - y) < 1;
      if (s === "back") return Math.abs(o.at[1] - (y + d)) < 1;
      if (s === "left") return Math.abs(o.at[0] - x) < 1;
      return Math.abs(o.at[0] - (x + w)) < 1;
    }).length;
    const openIds = new Set(r.open_to ?? []);
    const open = this.plan.rooms.some((n) => openIds.has(n.id) && touchesSide(r.rect, n.rect, s));
    return { ops, open };
  }

  /** A solid side of the room (no doors/windows, not open plan), or null. */
  freeSide(r: Room): Side | null {
    const order: Side[] = ["back", "left", "right", "front"];
    return order.find((s) => { const i = this.sideInfo(r, s); return !i.ops && !i.open; }) ?? null;
  }

  item(r: Room, side: Side, obj: { group: THREE.Group; depth: number; colliders: THREE.Mesh[] }, tags: Tags, h: number, collide: boolean) {
    const { x, y, w, d } = r.rect;
    const off = INT_T / 2 + obj.depth / 2 / FT + 0.15;
    let px = x + w / 2, py = y + d / 2;
    if (side === "back") py = y + d - off;
    if (side === "front") py = y + off;
    if (side === "left") px = x + off;
    if (side === "right") px = x + w - off;
    this.placeAt(r, px, py, sideRot(side), obj, tags, h, collide);
  }

  placeAt(_r: Room, x: number, y: number, rot: number, obj: { group: THREE.Group; colliders: THREE.Mesh[] }, tags: Tags, h: number, collide: boolean) {
    obj.group.position.copy(W(x, y, h));
    obj.group.rotation.y = rot;
    this.add(obj.group, tags);
    if (collide) this.colliders.push(...obj.colliders);
  }

  // ───────────────────────────── landscape ─────────────────────────────

  landscape() {
    if (this.built.has("landscape")) return;
    this.built.add("landscape");
    const { plot, road_width_ft = 40 } = this.plan.site;
    const W = plot.width_ft, D = plot.depth_ft;
    const tg = (kind: string, label: string, extra: Partial<Tags> = {}): Tags => ({ layer: "landscape", kind, label, ...extra });
    // street: footpath + road + far footpath
    this.box({ x0: -120, x1: W + 120, y0: -7, y1: -0.4, h0: 0, h1: 0.5 }, this.mats.kerb, tg("footpath", "Footpath"), { collider: true, shadow: false });
    this.box({ x0: -120, x1: W + 120, y0: -7 - road_width_ft, y1: -7, h0: -0.05, h1: 0.0 }, this.mats.asphalt, tg("road", "Road"), { shadow: false });
    this.box({ x0: -120, x1: W + 120, y0: -14 - road_width_ft, y1: -7 - road_width_ft, h0: 0, h1: 0.5 }, this.mats.kerb, tg("footpath", "Footpath"), { shadow: false });
    // lane markings
    for (let x = -110; x < W + 110; x += 14) {
      this.box({ x0: x, x1: x + 7, y0: -7 - road_width_ft / 2 - 0.25, y1: -7 - road_width_ft / 2 + 0.25, h0: 0, h1: 0.02 }, this.mats.white, tg("road_marking", "Road marking"), { shadow: false });
    }
    // lawn top
    const lawn = this.plan.rooms.find((r) => r.type === "lawn");
    if (lawn) this.box({ x0: lawn.rect.x + 0.4, x1: lawn.rect.x + lawn.rect.w - 0.4, y0: lawn.rect.y + 0.4, y1: lawn.rect.y + lawn.rect.d - 0.4, h0: 1.5, h1: 1.56 }, this.mats.grass, tg("lawn", "Front lawn", { level: lawn.level, room: lawn.id }), { shadow: false });
    // trees
    const trees: [number, number, number][] = [[-3.5, -3.5, 20], [W + 3.5, -3.5, 18], [lawn ? lawn.rect.x + 2.5 : 3, 2.5, 13], [W + 26, -3.5, 22], [-28, -3.5, 19]];
    for (const [x, y, hgt] of trees) this.placeTree(x, y, hgt);
    // neighbours (context massing): both sides and across the road
    const nb = (x0: number, x1: number, y0: number, y1: number, hgt: number, mat: THREE.Material) => {
      this.box({ x0, x1, y0, y1, h0: 0, h1: hgt }, mat, tg("neighbour", "Neighbouring house"));
      this.box({ x0: x0 - 0.3, x1: x1 + 0.3, y0: y0 - 0.3, y1: y1 + 0.3, h0: hgt, h1: hgt + 3 }, mat, tg("neighbour", "Neighbouring house"));
    };
    nb(-W + 4, -6, 16, D - 6, 18, this.mats.neighbour);
    nb(W + 6, 2 * W - 4, 18, D - 8, 19, this.mats.neighbour2);
    nb(-W + 2, -2, -14 - road_width_ft - D + 10, -24 - road_width_ft, 23, this.mats.neighbour2);
    nb(2, W - 2, -14 - road_width_ft - D + 8, -26 - road_width_ft, 21, this.mats.neighbour);
    nb(W + 2, 2 * W - 2, -14 - road_width_ft - D + 10, -24 - road_width_ft, 25, this.mats.neighbour);
    // a ground plane inside the plot rear/side so it reads as hard landscape
    const side = this.plan.rooms.find((r) => r.type === "open_space");
    if (side) this.box({ x0: side.rect.x + 1, x1: side.rect.x + 2.4, y0: side.rect.y + 3, y1: side.rect.y + side.rect.d - 3, h0: 1.5, h1: 2.6 }, this.mats.leaf, tg("hedge", "Planter hedge", { level: side.level, room: side.id }), { collider: true });
  }

  placeTree(x: number, y: number, hgt: number) {
    const g = new THREE.Group();
    const trunkH = hgt * 0.45 * FT;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, trunkH, 8), this.mats.bark);
    trunk.position.y = trunkH / 2;
    trunk.castShadow = true;
    g.add(trunk);
    const canopyR = hgt * 0.24 * FT;
    for (let i = 0; i < 3; i++) {
      const c = new THREE.Mesh(new THREE.IcosahedronGeometry(canopyR * (1 - i * 0.18), 1), this.mats.leaf);
      c.position.set(Math.sin(i * 2.1) * canopyR * 0.35, trunkH + canopyR * (0.55 + i * 0.5), Math.cos(i * 2.1) * canopyR * 0.35);
      c.castShadow = true;
      c.receiveShadow = true;
      g.add(c);
    }
    g.position.copy(W(x, y, y > 0 ? 1.5 : 0.5));
    this.add(g, { layer: "landscape", kind: "tree", label: "Tree" });
    this.colliders.push(trunk);
  }

  // ───────────────────────────── lighting ─────────────────────────────

  lights() {
    if (this.built.has("lights")) return;
    this.built.add("lights");
    const { plot } = this.plan.site;
    const sun = new THREE.DirectionalLight("#fff3e2", 4.2);
    const center = W(plot.width_ft / 2, plot.depth_ft / 2, 10);
    sun.position.copy(center).add(new THREE.Vector3(-18, 26, 14)); // the viewer re-aims it along the sun path
    sun.target.position.copy(center);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -22; sc.right = 22; sc.top = 22; sc.bottom = -22; sc.near = 1; sc.far = 120;
    sun.shadow.bias = -0.0002;
    sun.shadow.normalBias = 0.03;
    this.add(sun, { layer: "lighting", kind: "sun", label: "Sun", id: "sun" });
    this.root.add(sun.target);
    // warm ceiling lights in the main rooms (point light + emissive disc so bloom picks it up)
    const main = this.plan.rooms.filter((r) => ["drawing", "lounge", "master_bedroom", "bedroom", "guest_bedroom", "kitchen", "dining", "stair"].includes(r.type));
    for (const r of main) {
      const lvl = this.level(r.level);
      const above = this.levelAbove(lvl);
      const ceil = above ? above.elevation_ft - above.slab_ft : lvl.elevation_ft + lvl.height_ft - lvl.slab_ft;
      const c = this.roomCenter(r);
      const g = new THREE.Group();
      const light = new THREE.PointLight("#ffd9a8", r.type === "lounge" || r.type === "drawing" ? 9 : 6, 9, 2);
      light.position.set(0, -0.5, 0);
      g.add(light);
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.03, 24), this.mats.lightEmissive);
      disc.castShadow = false;
      g.add(disc);
      g.position.copy(W(c.x, c.y, ceil)).add(new THREE.Vector3(0, -0.02, 0));
      this.add(g, { layer: "lighting", level: r.level, room: r.id, kind: "light:ceiling", label: `${r.name} ceiling light` });
    }
  }

  summary(): AsBuiltSummary {
    const objects: AsBuiltSummary["objects"] = [];
    const box = new THREE.Box3();
    this.root.updateMatrixWorld(true);
    for (const o of this.root.children) {
      const u = o.userData;
      if (!u?.id || !u.layer || o.type.includes("Light")) continue;
      box.setFromObject(o);
      if (box.isEmpty()) continue;
      objects.push({
        id: u.id, layer: u.layer, kind: u.kind, level: u.level, room: u.room,
        // world z = −y_ft, so the plan y range comes from the opposite z bounds
        bbox_ft: { min: [box.min.x / FT, -box.max.z / FT, box.min.y / FT], max: [box.max.x / FT, -box.min.z / FT, box.max.y / FT] },
      });
    }
    return { objects, section_errors: [] };
  }

  spawn(): { position: THREE.Vector3; lookAt: THREE.Vector3 } {
    const door = this.plan.openings.find((o) => o.type === "main_door") ?? this.plan.openings.find((o) => o.between.includes("exterior") && o.type !== "window");
    const g = this.levels.find((l) => l.index === 0)!;
    if (!door) {
      const p = W(this.plan.site.plot.width_ft / 2, 4, g.elevation_ft);
      return { position: p, lookAt: W(this.plan.site.plot.width_ft / 2, 20, g.elevation_ft + 5) };
    }
    const inside = this.plan.rooms.find((r) => r.id === door.between[0]);
    let nx = 0, ny = -1;
    if (inside) {
      const { x, y, w, d } = inside.rect;
      const dists: [number, number, number][] = [[Math.abs(door.at[1] - y), 0, -1], [Math.abs(door.at[1] - (y + d)), 0, 1], [Math.abs(door.at[0] - x), -1, 0], [Math.abs(door.at[0] - (x + w)), 1, 0]];
      dists.sort((a, b) => a[0] - b[0]);
      [, nx, ny] = dists[0];
    }
    const lvl = this.level(door.level) ?? g;
    const pos = W(door.at[0] + nx * 4.5, door.at[1] + ny * 4.5, lvl.elevation_ft);
    const look = W(door.at[0] - nx * 6, door.at[1] - ny * 6, lvl.elevation_ft).add(new THREE.Vector3(0, 1.5, 0));
    return { position: pos, lookAt: look };
  }

  dispose() {
    const geos = new Set<THREE.BufferGeometry>();
    this.root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) geos.add(m.geometry); });
    for (const m of this.colliders) geos.add(m.geometry);
    geos.forEach((g) => g.dispose());
    Object.values(this.mats).forEach((m) => m.dispose());
    this.root.removeFromParent();
    this.root.clear();
  }
}

// ───────────────────────────── geometry helpers ─────────────────────────────

interface Segment { axis: "x" | "y"; at: number; a: number; b: number; rooms: Room[]; kind: "exterior" | "interior" | "railing" | "none" }

function mkSeg(axis: "x" | "y", at: number, a: number, b: number): Segment {
  return { axis, at, a, b, rooms: [], kind: "exterior" };
}

function rectSeg(r: Rect): Segment {
  return r.w >= r.d ? mkSeg("x", r.y + r.d / 2, r.x, r.x + r.w) : mkSeg("y", r.x + r.w / 2, r.y, r.y + r.d);
}

/** Box for a stretch [a, b] of a wall segment, thickness t centred on the segment line. */
function segBox(seg: Segment, a: number, b: number, t: number, h0: number, h1: number): Box {
  return seg.axis === "x"
    ? { x0: a, x1: b, y0: seg.at - t / 2, y1: seg.at + t / 2, h0, h1 }
    : { x0: seg.at - t / 2, x1: seg.at + t / 2, y0: a, y1: b, h0, h1 };
}

function onSegment(o: Opening, seg: Segment) {
  const [x, y] = o.at;
  if (seg.axis === "x") return Math.abs(y - seg.at) <= 1.5 && x >= seg.a - 0.01 && x <= seg.b + 0.01;
  return Math.abs(x - seg.at) <= 1.5 && y >= seg.a - 0.01 && y <= seg.b + 0.01;
}

/** Split all room edges of one level into unique wall segments and classify each one. */
function wallSegments(rooms: Room[]): Segment[] {
  interface Edge { axis: "x" | "y"; at: number; a: number; b: number; room: Room }
  const groups = new Map<string, Edge[]>();
  for (const r of rooms) {
    const { x, y, w, d } = r.rect;
    const edges: Edge[] = [
      { axis: "x", at: y, a: x, b: x + w, room: r }, { axis: "x", at: y + d, a: x, b: x + w, room: r },
      { axis: "y", at: x, a: y, b: y + d, room: r }, { axis: "y", at: x + w, a: y, b: y + d, room: r },
    ];
    for (const e of edges) {
      const k = `${e.axis}:${e.at.toFixed(3)}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(e);
    }
  }
  const out: Segment[] = [];
  for (const edges of groups.values()) {
    const pts = [...new Set(edges.flatMap((e) => [e.a, e.b]))].sort((p, q) => p - q);
    const pieces: Segment[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      if (b - a < 0.01) continue;
      const rs = [...new Set(edges.filter((e) => e.a <= a + 1e-3 && e.b >= b - 1e-3).map((e) => e.room))];
      if (!rs.length) continue;
      let kind: Segment["kind"];
      if (rs.length === 1) kind = OUTDOOR.has(rs[0].type) ? (RAILED.has(rs[0].type) ? "railing" : "none") : "exterior";
      else {
        const [r1, r2] = rs;
        const open = (r1.open_to ?? []).includes(r2.id) || (r2.open_to ?? []).includes(r1.id);
        const o1 = OUTDOOR.has(r1.type), o2 = OUTDOOR.has(r2.type);
        kind = open ? "none" : o1 && o2 ? "none" : o1 || o2 ? "exterior" : "interior";
      }
      pieces.push({ axis: edges[0].axis, at: edges[0].at, a, b, rooms: rs, kind });
    }
    // merge neighbours of the same kind so openings can straddle breakpoints
    for (const p of pieces) {
      const last = out[out.length - 1];
      if (last && last.axis === p.axis && last.at === p.at && last.kind === p.kind && Math.abs(last.b - p.a) < 1e-3) {
        last.b = p.b;
        for (const r of p.rooms) if (!last.rooms.includes(r)) last.rooms.push(r);
      } else out.push({ ...p, rooms: [...p.rooms] });
    }
  }
  return out;
}

function touchesSide(r: Rect, n: Rect, s: Side) {
  const ox = Math.min(r.x + r.w, n.x + n.w) - Math.max(r.x, n.x) > 0.5;
  const oy = Math.min(r.y + r.d, n.y + n.d) - Math.max(r.y, n.y) > 0.5;
  if (s === "front") return ox && Math.abs(n.y + n.d - r.y) < 0.1;
  if (s === "back") return ox && Math.abs(n.y - (r.y + r.d)) < 0.1;
  if (s === "left") return oy && Math.abs(n.x + n.w - r.x) < 0.1;
  return oy && Math.abs(n.x - (r.x + r.w)) < 0.1;
}

/** rect minus holes (each hole assumed inside); returns non-overlapping pieces. */
function subtractRects(r: Rect, holes: Rect[]): Rect[] {
  let parts: Rect[] = [r];
  for (const h of holes) {
    const next: Rect[] = [];
    for (const p of parts) {
      const ix0 = Math.max(p.x, h.x), ix1 = Math.min(p.x + p.w, h.x + h.w);
      const iy0 = Math.max(p.y, h.y), iy1 = Math.min(p.y + p.d, h.y + h.d);
      if (ix1 <= ix0 || iy1 <= iy0) { next.push(p); continue; }
      if (iy0 > p.y) next.push({ x: p.x, y: p.y, w: p.w, d: iy0 - p.y });
      if (iy1 < p.y + p.d) next.push({ x: p.x, y: iy1, w: p.w, d: p.y + p.d - iy1 });
      if (ix0 > p.x) next.push({ x: p.x, y: iy0, w: ix0 - p.x, d: iy1 - iy0 });
      if (ix1 < p.x + p.w) next.push({ x: ix1, y: iy0, w: p.x + p.w - ix1, d: iy1 - iy0 });
    }
    parts = next.filter((p) => p.w > 0.01 && p.d > 0.01);
  }
  return parts;
}

/** Driveway ramp: rises along +y from h0 at rect.y to h1 at rect.y + d; solid to the ground. */
function rampGeometry(r: Rect, h0: number, h1: number) {
  const f = stairFrame({ rect: r, start: "+y" } as Stair);
  return f.prism([[0, h0], [r.d, h1], [r.d, Math.min(h0, 0)], [0, Math.min(h0, 0) - 0.001]], 0, r.w);
}

/** Local frame of a stair: u runs along the first flight (`start`), v across; plus an extruded-profile builder. */
function stairFrame(s: Pick<Stair, "rect" | "start">) {
  const { x, y, w, d } = s.rect;
  const alongY = s.start === "+y" || s.start === "-y";
  const len = alongY ? d : w, wid = alongY ? w : d;
  const toPlan = (u: number, v: number): [number, number] => {
    switch (s.start) {
      case "+y": return [x + v, y + u];
      case "-y": return [x + w - v, y + d - u];
      case "+x": return [x + u, y + d - v];
      default: return [x + w - u, y + v];
    }
  };
  const uStart = Math.min(1.5, len * 0.12);
  return {
    len, wid, uStart, toPlan,
    rect(u0: number, du: number, v0: number, dv: number): Rect {
      const [ax, ay] = toPlan(u0, v0), [bx, by] = toPlan(u0 + du, v0 + dv);
      return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), d: Math.abs(by - ay) };
    },
    /** Convex profile in (u, h_ft) extruded across v ∈ [v0, v1]; world meters, flat normals. */
    prism(profile: [number, number][], v0: number, v1: number): THREE.BufferGeometry {
      const P = (u: number, v: number, h: number) => { const [px, py] = toPlan(u, v); return W(px, py, h).toArray(); };
      const tri: number[] = [];
      const n = profile.length;
      for (let i = 1; i < n - 1; i++) {
        const a = profile[0], b = profile[i], c = profile[i + 1];
        tri.push(...P(a[0], v0, a[1]), ...P(b[0], v0, b[1]), ...P(c[0], v0, c[1]));
        tri.push(...P(a[0], v1, a[1]), ...P(c[0], v1, c[1]), ...P(b[0], v1, b[1]));
      }
      for (let i = 0; i < n; i++) {
        const a = profile[i], b = profile[(i + 1) % n];
        tri.push(...P(a[0], v0, a[1]), ...P(a[0], v1, a[1]), ...P(b[0], v1, b[1]));
        tri.push(...P(a[0], v0, a[1]), ...P(b[0], v1, b[1]), ...P(b[0], v0, b[1]));
      }
      // convex solid: make every triangle face away from the centroid (mapping handedness varies by `start`)
      let cx = 0, cy = 0, cz = 0;
      const nv = tri.length / 3;
      for (let i = 0; i < tri.length; i += 3) { cx += tri[i]; cy += tri[i + 1]; cz += tri[i + 2]; }
      cx /= nv; cy /= nv; cz /= nv;
      for (let i = 0; i < tri.length; i += 9) {
        const [ax, ay, az, bx, by, bz, qx, qy, qz] = tri.slice(i, i + 9);
        const ux = bx - ax, uy = by - ay, uz = bz - az, wx = qx - ax, wy = qy - ay, wz = qz - az;
        const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
        const dx = (ax + bx + qx) / 3 - cx, dy = (ay + by + qy) / 3 - cy, dz = (az + bz + qz) / 3 - cz;
        if (nx * dx + ny * dy + nz * dz < 0) tri.splice(i + 3, 6, qx, qy, qz, bx, by, bz);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(tri, 3));
      g.computeVertexNormals();
      return g;
    },
  };
}

/** Rotation that turns an item's local +z (its front) to face into the room from wall `s` (world z = −y_ft). */
const sideRot = (s: Side) => (s === "back" ? 0 : s === "front" ? Math.PI : s === "left" ? Math.PI / 2 : -Math.PI / 2);
const oppositeSide = (s: Side): Side => (s === "back" ? "front" : s === "front" ? "back" : s === "left" ? "right" : "left");

// ───────────────────────────── furniture kit (meters, local +z = front) ─────────────────────────────

type Kit = { group: THREE.Group; depth: number; colliders: THREE.Mesh[] };
type M = Record<MatKey, THREE.Material>;

function part(g: THREE.Group, w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material, cast = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = cast;
  m.receiveShadow = true;
  g.add(m);
  return m;
}

function sofa(m: M, wFt: number, dFt: number): Kit {
  const g = new THREE.Group();
  const w = wFt * FT, d = dFt * FT;
  const base = part(g, w, 0.42, d, 0, 0.21, 0, m.fabric);
  part(g, w, 0.45, 0.2, 0, 0.62, -d / 2 + 0.1, m.fabric);
  part(g, 0.18, 0.2, d, -w / 2 + 0.09, 0.52, 0, m.fabric);
  part(g, 0.18, 0.2, d, w / 2 - 0.09, 0.52, 0, m.fabric);
  for (let i = 0; i < 3; i++) part(g, w / 3 - 0.06, 0.1, d - 0.28, -w / 3 + (i * w) / 3, 0.47, 0.06, m.fabric2);
  return { group: g, depth: d, colliders: [base] };
}

function bed(m: M, wFt: number, lFt: number): Kit {
  const g = new THREE.Group();
  const w = wFt * FT, l = lFt * FT;
  const frame = part(g, w, 0.32, l, 0, 0.16, 0, m.walnut);
  part(g, w - 0.08, 0.22, l - 0.12, 0, 0.42, 0.02, m.linen);
  part(g, w + 0.1, 1.15, 0.1, 0, 0.58, -l / 2 + 0.05, m.fabric2);
  part(g, w * 0.4, 0.12, 0.35, -w * 0.22, 0.58, -l / 2 + 0.32, m.white);
  part(g, w * 0.4, 0.12, 0.35, w * 0.22, 0.58, -l / 2 + 0.32, m.white);
  part(g, w - 0.06, 0.06, l * 0.35, 0, 0.55, l * 0.25, m.fabric);
  for (const sx of [-1, 1]) part(g, 0.5, 0.5, 0.42, sx * (w / 2 + 0.33), 0.25, -l / 2 + 0.25, m.walnut);
  return { group: g, depth: l, colliders: [frame] };
}

function tvUnit(m: M, withTv: boolean): Kit {
  const g = new THREE.Group();
  const body = part(g, 1.9, 0.45, 0.42, 0, 0.225, 0, m.walnut);
  if (withTv) part(g, 1.45, 0.82, 0.05, 0, 1.25, -0.12, m.tv);
  return { group: g, depth: 0.42, colliders: [body] };
}

function coffeeTable(m: M): Kit {
  const g = new THREE.Group();
  const top = part(g, 1.15, 0.06, 0.62, 0, 0.4, 0, m.walnut);
  part(g, 1.0, 0.36, 0.5, 0, 0.18, 0, m.black);
  return { group: g, depth: 0.62, colliders: [top] };
}

function rug(m: M, wFt: number, dFt: number): Kit {
  const g = new THREE.Group();
  part(g, wFt * FT, 0.012, dFt * FT, 0, 0.006, 0, m.fabric2, false);
  return { group: g, depth: dFt * FT, colliders: [] };
}

function diningTable(m: M): Kit {
  const g = new THREE.Group();
  const top = part(g, 1.8, 0.05, 0.95, 0, 0.75, 0, m.walnut);
  part(g, 1.5, 0.7, 0.12, 0, 0.36, 0, m.black);
  for (const [x, z] of [[-0.55, -0.7], [0, -0.7], [0.55, -0.7], [-0.55, 0.7], [0, 0.7], [0.55, 0.7]]) {
    part(g, 0.45, 0.46, 0.45, x, 0.23, z, m.fabric2);
    part(g, 0.45, 0.5, 0.06, x, 0.7, z + (z < 0 ? -0.2 : 0.2), m.fabric2);
  }
  return { group: g, depth: 0.95, colliders: [top] };
}

function counter(m: M, lenFt: number): Kit {
  const g = new THREE.Group();
  const l = Math.max(1.2, lenFt * FT);
  const base = part(g, l, 0.88, 0.62, 0, 0.44, 0, m.white);
  part(g, l + 0.02, 0.04, 0.64, 0, 0.9, 0, m.black);
  part(g, l, 0.7, 0.35, 0, 1.85, -0.13, m.teak);
  part(g, 0.6, 0.03, 0.4, l * 0.2, 0.93, 0.02, m.chrome);
  return { group: g, depth: 0.62, colliders: [base] };
}

function vanity(m: M): Kit {
  const g = new THREE.Group();
  const body = part(g, 0.9, 0.82, 0.48, 0, 0.41, 0, m.teak);
  part(g, 0.92, 0.04, 0.5, 0, 0.84, 0, m.white);
  part(g, 0.8, 0.9, 0.02, 0, 1.45, -0.23, m.chrome);
  return { group: g, depth: 0.48, colliders: [body] };
}

function car(m: M): Kit {
  const g = new THREE.Group();
  const body = part(g, 1.8, 0.62, 4.5, 0, 0.55, 0, m.carPaint);
  part(g, 1.62, 0.52, 2.4, 0, 1.12, -0.15, m.carPaint);
  part(g, 1.64, 0.4, 2.2, 0, 1.12, -0.15, m.glass, false);
  for (const [x, z] of [[-0.82, 1.4], [0.82, 1.4], [-0.82, -1.4], [0.82, -1.4]]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.24, 18), m.rubber);
    w.rotation.z = Math.PI / 2;
    w.position.set(x, 0.33, z);
    w.castShadow = true;
    g.add(w);
  }
  return { group: g, depth: 4.5, colliders: [body] };
}

// ───────────────────────────── entry point ─────────────────────────────

const DEFAULT_SECTIONS = (plan: BuildingPlan): DesignSectionSrc[] => [
  { name: "structure", layer: "structure", body: "" },
  { name: "facade_front", layer: "facade", body: "" },
  ...plan.rooms
    .filter((r) => ["drawing", "lounge", "master_bedroom", "bedroom", "guest_bedroom", "kitchen", "porch", "bath"].includes(r.type))
    .map((r) => ({ name: `furnish_${r.id}`, layer: "furniture" as Layer, body: "" })),
  { name: "landscape", layer: "landscape", body: "" },
  { name: "lighting", layer: "lighting", body: "" },
];

export async function mockBuild(
  plan: BuildingPlan,
  sections: DesignSectionSrc[],
  opts?: { onSection?: (r: SectionResult, root: THREE.Group) => void | Promise<void>; quality?: "high" | "medium" },
): Promise<BuildResult> {
  const b = new MockBuilder(plan);
  const list = sections.length ? sections : DEFAULT_SECTIONS(plan);
  const results: SectionResult[] = [];
  // the structure always comes first, even if the design forgot it
  const ordered = list.some((s) => s.layer === "structure") ? list : [{ name: "structure", layer: "structure" as Layer, body: "" }, ...list];
  for (const s of ordered) {
    const t0 = performance.now();
    let ok = true, error: string | undefined;
    try {
      if (s.layer === "structure") b.structure();
      else if (s.layer === "facade") b.facade();
      else if (s.layer === "furniture" && s.name.startsWith("furnish_")) b.furnish(s.name.slice("furnish_".length));
      else if (s.layer === "landscape") b.landscape();
      else if (s.layer === "lighting") b.lights();
    } catch (e) {
      ok = false;
      error = e instanceof Error ? e.message : String(e);
    }
    const r: SectionResult = { name: s.name, layer: s.layer, ok, error, ms: performance.now() - t0, objects: b.take() };
    results.push(r);
    await sleep(4);
    await opts?.onSection?.(r, b.root);
  }
  if (!list.some((s) => s.layer === "lighting")) b.lights();
  const levels = b.levels.map((l) => ({ id: l.id, name: l.name, floor_y: l.elevation_ft * FT, top_y: (l.elevation_ft + l.height_ft) * FT }));
  return {
    root: b.root,
    summary: b.summary(),
    sections: results,
    levels,
    colliders: b.colliders,
    spawn: b.spawn(),
    dispose: () => b.dispose(),
  };
}
