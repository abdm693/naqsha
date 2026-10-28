/** auto_furnish(room): sensible, intentional layouts per room type that avoid doors, windows and stairs. */
import type { FurnishOptions, FurnitureType, Side } from "@contracts/house-sdk";
import type { BuildCtx } from "../core/ctx";
import { warn } from "../core/util";
import type { RoomM } from "../plan/model";
import { findRoom, innerRect } from "../interior";
import { doorZones, furnishImpl, qiblaRot } from "./place";
import { wayCost } from "./paths";

type Style = "modern" | "classic" | "minimal" | "traditional";
const SIDES: Side[] = ["front", "back", "left", "right"];
const OPP: Record<Side, Side> = { front: "back", back: "front", left: "right", right: "left" };

interface SideInfo {
  side: Side;
  axis: "x" | "y";
  /** inner extent of the room along this side */
  lo: number;
  hi: number;
  walls: [number, number][];
  doors: [number, number][];
  windows: { u0: number; u1: number; sill: number }[];
}

export function autoFurnishImpl(ctx: BuildCtx, roomId: string, o?: { style?: Style; palette?: string[] }): void {
  const room = findRoom(ctx, roomId);
  if (!room) return;
  const style: Style = (["modern", "classic", "minimal", "traditional"] as Style[]).includes(o?.style as Style) ? (o!.style as Style) : "modern";
  const L = new Layout(ctx, room, style);
  try {
    switch (room.type) {
      case "master_bedroom": case "bedroom": case "guest_bedroom": case "servant": L.bedroom(); break;
      case "lounge": L.lounge(); break;
      case "drawing": L.drawing(); break;
      case "dining": L.dining(); break;
      case "kitchen": case "dirty_kitchen": L.kitchen(); break;
      case "bath": case "powder": L.bath(); break;
      case "dressing": L.dressing(); break;
      case "study": L.study(); break;
      case "prayer": L.prayer(); break;
      case "store": L.store(); break;
      case "laundry": L.laundry(); break;
      case "stair": case "lobby": case "corridor": L.hall(); break;
      case "porch": case "garage": L.porch(); break;
      case "balcony": L.balcony(); break;
      case "terrace": L.terrace(); break;
      case "lawn": case "courtyard": L.garden(); break;
      default: break;
    }
  } catch (e) {
    warn(`auto_furnish ${room.id} failed: ${(e as Error).message}`);
  }
}

class Layout {
  readonly inner: { x0: number; x1: number; y0: number; y1: number };
  readonly sides: Record<Side, SideInfo>;
  readonly W: number;
  readonly D: number;
  readonly area: number;
  readonly entry: Side | null;
  constructor(private ctx: BuildCtx, private room: RoomM, private style: Style) {
    this.inner = room.cat === "enclosed" ? innerRect(ctx, room) : { x0: room.rect.x + 0.3, x1: room.rect.x + room.rect.w - 0.3, y0: room.rect.y + 0.3, y1: room.rect.y + room.rect.d - 0.3 };
    this.W = this.inner.x1 - this.inner.x0;
    this.D = this.inner.y1 - this.inner.y0;
    this.area = room.rect.w * room.rect.d;
    this.sides = {} as Record<Side, SideInfo>;
    for (const s of SIDES) this.sides[s] = this.info(s);
    // entry: side with the main door into the room
    let best: Side | null = null, bw = 0;
    for (const s of SIDES) {
      const w = this.sides[s].doors.reduce((a, [p, q]) => a + q - p, 0);
      if (w > bw) {
        bw = w;
        best = s;
      }
    }
    this.entry = best;
  }

  private info(side: Side): SideInfo {
    const axis: "x" | "y" = side === "front" || side === "back" ? "x" : "y";
    const lo = axis === "x" ? this.inner.x0 : this.inner.y0, hi = axis === "x" ? this.inner.x1 : this.inner.y1;
    const ws = this.ctx.model.roomWalls(this.room, side);
    const walls: [number, number][] = ws.map((w) => [Math.max(lo, w.a), Math.min(hi, w.b)] as [number, number]).filter(([a, b]) => b - a > 0.3);
    const doors: [number, number][] = [], windows: { u0: number; u1: number; sill: number }[] = [];
    for (const w of ws)
      for (const op of w.run.openings) {
        if (op.isDoor) doors.push([op.u0, op.u1]);
        else windows.push({ u0: op.u0, u1: op.u1, sill: op.bottom - this.room.floorH });
      }
    return { side, axis, lo, hi, walls, doors, windows };
  }

  /** free intervals along a side for an item of height h (ft); windows block items taller than the sill. */
  free(side: Side, h: number, pad = 0.5): [number, number][] {
    const si = this.sides[side];
    let spans = si.walls.map(([a, b]) => [a, b] as [number, number]);
    const cut = (p: number, q: number) => {
      const out: [number, number][] = [];
      for (const [a, b] of spans) {
        if (q <= a || p >= b) out.push([a, b]);
        else {
          if (p > a) out.push([a, p]);
          if (q < b) out.push([q, b]);
        }
      }
      spans = out;
    };
    for (const [p, q] of si.doors) cut(p - pad, q + pad);
    for (const w of si.windows) if (w.sill < h + 0.1) cut(w.u0 - 0.2, w.u1 + 0.2);
    // stairs and door swing zones from other walls that reach this side
    for (const z of doorZones(this.ctx, this.room)) {
      const nearSide = si.axis === "x" ? (side === "front" ? z.y0 < this.inner.y0 + 2.2 : z.y1 > this.inner.y1 - 2.2) : side === "left" ? z.x0 < this.inner.x0 + 2.2 : z.x1 > this.inner.x1 - 2.2;
      if (nearSide) cut(si.axis === "x" ? z.x0 : z.y0, si.axis === "x" ? z.x1 : z.y1);
    }
    return spans.filter(([a, b]) => b - a > 0.8).sort((a, b) => b[1] - b[0] - (a[1] - a[0]));
  }

  /** along_ft for a plan coordinate u on a side (the d.ts convention: from the wall's left end seen from inside). */
  along(side: Side, u: number): number {
    const r = this.room.rect;
    switch (side) {
      case "front": return r.x + r.w - u;
      case "back": return u - r.x;
      case "left": return u - r.y;
      default: return r.y + r.d - u;
    }
  }
  depthFrom(side: Side): number {
    return side === "front" || side === "back" ? this.D : this.W;
  }

  /** a piece of this type already stands in the room */
  has(type: string): boolean {
    return this.ctx.items.some((it) => it.room === this.room.id && it.type === type);
  }
  put(type: FurnitureType, o: Partial<FurnishOptions>): ReturnType<typeof furnishImpl> {
    return furnishImpl(this.ctx, type, { room: this.room.id, ...o } as FurnishOptions, this.style);
  }
  against(type: FurnitureType, side: Side, u: number, o: Partial<FurnishOptions> = {}): ReturnType<typeof furnishImpl> {
    return this.put(type, { against: side, along_ft: this.along(side, u), ...o });
  }
  /** room-local point helper */
  at(x: number, y: number): [number, number] {
    return [x - this.room.rect.x, y - this.room.rect.y];
  }
  center(): [number, number] {
    return this.at((this.inner.x0 + this.inner.x1) / 2, (this.inner.y0 + this.inner.y1) / 2);
  }
  /** point at distance `dist` from a side's inner face, at along-coordinate u */
  pointFrom(side: Side, u: number, dist: number): [number, number] {
    const x = side === "left" ? this.inner.x0 + dist : side === "right" ? this.inner.x1 - dist : u;
    const y = side === "front" ? this.inner.y0 + dist : side === "back" ? this.inner.y1 - dist : u;
    return this.at(x, y);
  }
  rotFacingAwayFrom(side: Side): number {
    return { front: 0, back: 180, left: -90, right: 90 }[side];
  }
  fanAndAc(avoid?: Side, at?: [number, number]): void {
    this.put("ceiling_fan", { at: at ?? this.center() });
    const cands = SIDES.filter((s) => s !== avoid).map((s) => ({ s, f: this.free(s, 9, 0.4)[0] })).filter((c) => c.f && c.f[1] - c.f[0] > 3.4);
    cands.sort((a, b) => (b.f[1] - b.f[0]) - (a.f[1] - a.f[0]));
    const c = cands.find((x) => x.s === (avoid ? OPP[avoid] : "")) ?? cands[0];
    if (c) this.against("ac_split", c.s, (c.f[0] + c.f[1]) / 2);
  }
  curtainsOnWindows(): void {
    for (const s of SIDES)
      for (const w of this.sides[s].windows) {
        if (w.u1 - w.u0 < 2.5) continue;
        this.against("curtains", s, (w.u0 + w.u1) / 2, { size: { w_ft: w.u1 - w.u0 + 1.6 } });
      }
    for (const s of SIDES)
      for (const [p, q] of this.sides[s].doors) {
        const isSlide = this.ctx.model.openingsOfRoom(this.room).some((op) => op.op.type === "sliding_door" && Math.abs(op.u0 - p) < 0.01);
        if (isSlide) this.against("curtains", s, (p + q) / 2, { size: { w_ft: q - p + 1.6 } });
      }
  }
  plantInCorner(n = 1, type: FurnitureType = "plant_floor"): void {
    const corners: [number, number][] = [
      [this.inner.x0 + 1.1, this.inner.y0 + 1.1], [this.inner.x1 - 1.1, this.inner.y0 + 1.1],
      [this.inner.x0 + 1.1, this.inner.y1 - 1.1], [this.inner.x1 - 1.1, this.inner.y1 - 1.1],
    ];
    const zones = doorZones(this.ctx, this.room);
    let placed = 0;
    for (const [x, y] of corners) {
      if (placed >= n) break;
      const box = { x0: x - 0.9, x1: x + 0.9, y0: y - 0.9, y1: y + 0.9 };
      const hit = [...zones, ...this.ctx.items.filter((it) => it.room === this.room.id && it.cls === "floor")].some((z) => box.x0 < z.x1 && z.x0 < box.x1 && box.y0 < z.y1 && z.y0 < box.y1);
      if (hit) continue;
      this.put(type, { at: this.at(x, y) });
      placed++;
    }
  }

  // ── layouts ────────────────────────────────────────────────────────────────────────────────────────
  bedroom(): void {
    const isMaster = this.room.type === "master_bedroom";
    const small = Math.min(this.W, this.D) < 9.5 || this.room.type === "servant";
    let type: FurnitureType = isMaster ? "bed_king" : small ? "bed_single" : "bed_queen";
    const bw = type === "bed_king" ? 6.8 : type === "bed_queen" ? 5.6 : 3.6;
    const bl = type === "bed_single" ? 6.9 : 7.1;
    // choose the bed wall (EN3-01: a headboard wall where the bed would cut the way between the room's doors, or to a
    // window, loses to one that keeps them open)
    let best: { s: Side; span: [number, number]; score: number } | null = null;
    for (const s of SIDES) {
      if (this.depthFrom(s) < bl + 2.2) continue;
      for (const span of this.free(s, 3.2, 0.6)) {
        const len = span[1] - span[0];
        if (len < bw + 0.3) continue;
        const win = this.sides[s].windows.some((w) => w.u1 > span[0] && w.u0 < span[1] && w.sill < 4);
        const cost = wayCost(this.ctx, this.room.id, type, this.bedBox(s, this.bedU(s, span, bw / 2), bw, bl), s);
        const score = len * 0.3 + (this.entry && s === OPP[this.entry] ? 5 : 0) + (s === this.entry ? -4 : 0) + (win ? -3 : 0) + (len >= bw + 3.6 ? 3 : 0) - cost / 40;
        if (!best || score > best.score) best = { s, span, score };
      }
    }
    if (!best && type !== "bed_single") {
      type = "bed_single";
      for (const s of SIDES)
        for (const span of this.free(s, 3.2, 0.5)) if (span[1] - span[0] > 3.9 && (!best || span[1] - span[0] > best.span[1] - best.span[0])) best = { s, span, score: 0 };
    }
    if (!best) {
      this.put(type, { at: this.center() });
      this.fanAndAc();
      return;
    }
    const s = best.s;
    const [a, b] = best.span;
    const half = (type === "bed_king" ? 6.8 : type === "bed_queen" ? 5.6 : 3.6) / 2;
    const u = this.bedU(s, best.span, half);
    this.against(type, s, u, { variant: "upholstered headboard" });
    for (const side of [-1, 1]) {
      const nu = u + side * (half + 0.95);
      if (nu - 0.85 >= a - 0.05 && nu + 0.85 <= b + 0.05) {
        this.against("side_table", s, nu);
        this.against("table_lamp", s, nu);
      }
    }
    this.against("painting", s, u, { size: { w_ft: Math.min(half * 1.3, 4.2), h_ft: 2.4 } });
    // rug under the lower two thirds of the bed
    const rugP = this.pointFrom(s, u, bl * 0.62);
    this.put("rug", { at: rugP, rot_deg: this.rotFacingAwayFrom(s), size: { w_ft: half * 2 + 3, d_ft: 5.5 } });
    // wardrobe on another wall
    const ws = SIDES.filter((x) => x !== s).flatMap((x) => this.free(x, 7.6, 0.5).map((sp) => ({ x, sp })));
    ws.sort((p, q) => q.sp[1] - q.sp[0] - (p.sp[1] - p.sp[0]) + (p.x === OPP[s] ? 1 : 0) - (q.x === OPP[s] ? 1 : 0));
    const wr = ws.find((c) => c.sp[1] - c.sp[0] >= 4);
    let wardrobeSide: Side | null = null;
    if (wr) {
      const len = Math.min(wr.sp[1] - wr.sp[0] - 0.2, isMaster ? 7.6 : 6);
      const wu = wr.sp[1] - len / 2 - 0.05;
      this.against("wardrobe", wr.x, wu, { size: { w_ft: len, d_ft: 2 } });
      wardrobeSide = wr.x;
    }
    // dresser / desk on a remaining wall (desk likes windows)
    const rest = SIDES.filter((x) => x !== s).flatMap((x) => this.free(x, 2.6, 0.5).map((sp) => ({ x, sp })));
    rest.sort((p, q) => q.sp[1] - q.sp[0] - (p.sp[1] - p.sp[0]));
    const dr = rest.find((c) => c.sp[1] - c.sp[0] >= 4.4 && this.depthFrom(c.x) > 7);
    if (dr) {
      const t: FurnitureType = isMaster ? "dresser" : this.room.type === "guest_bedroom" ? "dresser" : "study_desk";
      const du = (dr.sp[0] + dr.sp[1]) / 2;
      this.against(t, dr.x, du);
      if (t === "study_desk") this.put("desk_chair", { at: this.pointFrom(dr.x, du, 2.4), rot_deg: (this.rotFacingAwayFrom(dr.x) + 180) % 360 });
      if (t === "dresser") this.against("mirror_wall", dr.x, du, { size: { w_ft: 2.6, h_ft: 3.2 }, variant: "round" });
    }
    if (isMaster && this.area > 170) {
      const c = this.pointFrom(OPP[s], (this.sides[OPP[s]].lo + this.sides[OPP[s]].hi) / 2, 2.2);
      void c;
      this.put("armchair", { at: this.cornerAway(s), rot_deg: this.rotFacingAwayFrom(OPP[s]) + 35 });
    }
    void wardrobeSide;
    this.fanAndAc(s);
    this.curtainsOnWindows();
    this.plantInCorner(1);
  }

  /** where along a free span of wall `s` the bed's centre goes (the wall's middle, kept 1.7 ft off the span's ends
   *  when it is long enough for nightstands) */
  private bedU(s: Side, [a, b]: [number, number], half: number): number {
    const wallMid = (this.sides[s].lo + this.sides[s].hi) / 2;
    const m = b - a > 2 * half + 3.4 ? 1.7 : 0.1;
    return Math.min(Math.max(wallMid, a + half + m), b - half - m);
  }

  /** a bed's footprint with its headboard on wall `s` at along-coordinate u (plan ft) */
  private bedBox(s: Side, u: number, w: number, l: number): { x0: number; x1: number; y0: number; y1: number } {
    const I = this.inner;
    switch (s) {
      case "front": return { x0: u - w / 2, x1: u + w / 2, y0: I.y0, y1: I.y0 + l };
      case "back": return { x0: u - w / 2, x1: u + w / 2, y0: I.y1 - l, y1: I.y1 };
      case "left": return { x0: I.x0, x1: I.x0 + l, y0: u - w / 2, y1: u + w / 2 };
      default: return { x0: I.x1 - l, x1: I.x1, y0: u - w / 2, y1: u + w / 2 };
    }
  }

  /** a free-ish corner on the side opposite `s` */
  private cornerAway(s: Side): [number, number] {
    const o = OPP[s];
    const x = o === "left" ? this.inner.x0 + 1.8 : o === "right" ? this.inner.x1 - 1.8 : this.inner.x1 - 1.8;
    const y = o === "front" ? this.inner.y0 + 1.8 : o === "back" ? this.inner.y1 - 1.8 : this.inner.y1 - 1.8;
    return this.at(x, y);
  }

  lounge(): void {
    const big = this.area > 300 && Math.max(this.W, this.D) >= 19;
    const alongX = this.W >= this.D;
    // living zone: a band of the room (2/3 if big)
    let zone = { ...this.inner };
    let diningZone: typeof zone | null = null;
    if (big) {
      if (alongX) {
        const split = this.inner.x0 + this.W * 0.6;
        const living = this.sides.left.walls.length >= this.sides.right.walls.length;
        zone = living ? { ...this.inner, x1: split } : { ...this.inner, x0: this.inner.x1 - this.W * 0.6 };
        diningZone = living ? { ...this.inner, x0: split } : { ...this.inner, x1: this.inner.x1 - this.W * 0.6 };
      } else {
        const split = this.inner.y0 + this.D * 0.6;
        zone = { ...this.inner, y1: split };
        diningZone = { ...this.inner, y0: split };
      }
    }
    // TV wall: longest solid stretch inside the living zone, 1.5 ft clear of every door and arch frame (EN-08), and
    // not the wall the room is entered through while another wall can take it
    let tvBest: { s: Side; u: number; len: number } | null = null;
    const tvCands: { s: Side; u: number; len: number }[] = [];
    for (const s of SIDES) {
      const ax = s === "front" || s === "back" ? "x" : "y";
      const zlo = ax === "x" ? zone.x0 : zone.y0, zhi = ax === "x" ? zone.x1 : zone.y1;
      const sideCoord = s === "front" ? this.inner.y0 : s === "back" ? this.inner.y1 : s === "left" ? this.inner.x0 : this.inner.x1;
      const inZone = ax === "x" ? sideCoord >= zone.y0 - 0.5 && sideCoord <= zone.y1 + 0.5 : sideCoord >= zone.x0 - 0.5 && sideCoord <= zone.x1 + 0.5;
      if (!inZone) continue;
      for (const [a, b] of this.free(s, 7, 1.5)) {
        const p = Math.max(a, zlo), q = Math.min(b, zhi);
        if (q - p < 5.5) continue;
        const depth = ax === "x" ? zone.y1 - zone.y0 : zone.x1 - zone.x0;
        if (depth < 9) continue;
        tvCands.push({ s, u: (p + q) / 2, len: q - p });
      }
    }
    const notEntry = tvCands.filter((c) => c.s !== this.entry);
    for (const c of notEntry.length ? notEntry : tvCands) if (!tvBest || c.len > tvBest.len) tvBest = c;
    let livingCenter: [number, number] = this.at((zone.x0 + zone.x1) / 2, (zone.y0 + zone.y1) / 2);
    if (tvBest) {
      const s = tvBest.s;
      const u = tvBest.u;
      const unitW = Math.min(7, tvBest.len - 0.5);
      this.against("tv_unit", s, u, { size: { w_ft: unitW } });
      this.against("tv", s, u, { size: { w_ft: unitW > 6 ? 4.6 : 4 } });
      const depth = s === "front" || s === "back" ? zone.y1 - zone.y0 : zone.x1 - zone.x0;
      const back = Math.min(depth - 0.5, 13.5); // sofa back distance from the TV wall
      const faceTV = (this.rotFacingAwayFrom(s) + 180) % 360;
      const lsofa = depth >= 12.5 && tvBest.len >= 9.5;
      const th = (faceTV * Math.PI) / 180;
      const lx = Math.cos(th), ly = Math.sin(th); // sofa local +x in plan
      if (lsofa) {
        const w = Math.min(9.5, tvBest.len);
        this.put("sofa_l", { at: this.pointFrom(s, u, back - 3.2), rot_deg: faceTV, size: { w_ft: w, d_ft: 6.4 } });
        const p = this.pointFrom(s, u, back - 3.1 - 1.5 - 1.1);
        this.put("coffee_table", { at: [p[0] - lx * 1.4, p[1] - ly * 1.4], rot_deg: faceTV, size: { w_ft: 3.8, d_ft: 2.2 }, variant: "marble top", material: "marble_white" });
        const lp = this.pointFrom(s, u, back - 1.0);
        this.put("floor_lamp", { at: [lp[0] - lx * (w / 2 + 0.9), lp[1] - ly * (w / 2 + 0.9)] });
      } else {
        this.put("sofa_3", { at: this.pointFrom(s, u, back - 1.55), rot_deg: faceTV });
        this.put("coffee_table", { at: this.pointFrom(s, u, back - 3.1 - 1.4 - 1.1), rot_deg: faceTV, variant: "marble top", material: "marble_white" });
        const ap = this.pointFrom(s, u, back - 4.6);
        this.put("armchair", { at: [ap[0] + lx * 5.2, ap[1] + ly * 5.2], rot_deg: faceTV - 70 });
        const lp = this.pointFrom(s, u, back - 1.0);
        this.put("floor_lamp", { at: [lp[0] - lx * 4.6, lp[1] - ly * 4.6] });
      }
      this.put("rug", { at: this.pointFrom(s, u, back - 3.7), rot_deg: faceTV, size: { w_ft: lsofa ? 10 : 9, d_ft: 7.6 } });
      livingCenter = this.pointFrom(s, u, back / 2);
    } else {
      this.put("sofa_3", { at: this.center() });
    }
    if (diningZone) {
      const cx = (diningZone.x0 + diningZone.x1) / 2, cy = (diningZone.y0 + diningZone.y1) / 2;
      const span = alongX ? diningZone.y1 - diningZone.y0 : diningZone.x1 - diningZone.x0;
      const t: FurnitureType = span >= 12 ? "dining_table_6" : "dining_table_4";
      this.put(t, { at: this.at(cx, cy), rot_deg: alongX ? 90 : 0 });
      this.put("pendant", { at: this.at(cx, cy), variant: "low" });
    }
    this.fanAndAc(tvBest?.s, livingCenter);
    this.curtainsOnWindows();
    this.plantInCorner(2);
  }

  drawing(): void {
    // main sofa against the best solid wall (not the entry)
    let best: { s: Side; u: number; len: number } | null = null;
    for (const s of SIDES)
      for (const [a, b] of this.free(s, 3, 0.6)) {
        const len = b - a - (s === this.entry ? 4 : 0);
        if (b - a >= 7.6 && this.depthFrom(s) >= 11 && (!best || len > best.len)) best = { s, u: (a + b) / 2, len };
      }
    const cx = (this.inner.x0 + this.inner.x1) / 2, cy = (this.inner.y0 + this.inner.y1) / 2;
    if (best) {
      const s = best.s;
      this.against("sofa_3", s, best.u, { color: "#d7cfc2" });
      this.against("painting", s, best.u, { size: { w_ft: 4.5, h_ft: 2.8 } });
      const depth = this.depthFrom(s);
      const ctD = Math.min(4.6, depth * 0.36);
      this.put("coffee_table", { at: this.pointFrom(s, best.u, ctD + 0.9), rot_deg: this.rotFacingAwayFrom(s), size: { w_ft: 4, d_ft: 2.3 }, variant: "marble top", material: "marble_white" });
      for (const side of [-1, 1]) {
        const p = this.pointFrom(s, best.u + side * 3.4, ctD + 3.6);
        this.put("armchair", { at: p, rot_deg: (this.rotFacingAwayFrom(s) + 180 + side * 25) % 360, color: "#9b6a45" });
      }
      this.put("rug", { at: this.pointFrom(s, best.u, ctD + 1.2), rot_deg: this.rotFacingAwayFrom(s), size: { w_ft: 10, d_ft: 8 }, variant: this.style === "traditional" ? "classic" : "", color: "#cbbfae" });
      this.against("side_table", s, best.u - 4.8);
      this.against("table_lamp", s, best.u - 4.8);
      // console on another wall
      const others = SIDES.filter((x) => x !== s).flatMap((x) => this.free(x, 2.7, 0.6).map((sp) => ({ x, sp }))).filter((c) => c.sp[1] - c.sp[0] >= 4.5);
      if (others[0]) {
        const u = (others[0].sp[0] + others[0].sp[1]) / 2;
        this.against("console_table", others[0].x, u);
        this.against("mirror_wall", others[0].x, u, { size: { w_ft: 3, h_ft: 3 }, variant: "round" });
      }
    } else {
      this.put("sofa_3", { at: this.at(cx, cy) });
    }
    this.put("chandelier", { at: this.at(cx, cy), variant: this.style === "traditional" || this.style === "classic" ? "classic" : "" });
    const ac = SIDES.flatMap((x) => this.free(x, 9, 0.4).map((sp) => ({ x, sp }))).filter((c) => c.sp[1] - c.sp[0] > 3.4 && c.x !== best?.s)[0];
    if (ac) this.against("ac_split", ac.x, (ac.sp[0] + ac.sp[1]) / 2);
    this.curtainsOnWindows();
    this.plantInCorner(2);
  }

  dining(): void {
    const cx = (this.inner.x0 + this.inner.x1) / 2, cy = (this.inner.y0 + this.inner.y1) / 2;
    const longX = this.W >= this.D;
    const len = Math.max(this.W, this.D), wid = Math.min(this.W, this.D);
    const t: FurnitureType = len >= 15 && wid >= 10.5 ? "dining_table_8" : len >= 12 && wid >= 9.5 ? "dining_table_6" : "dining_table_4";
    this.put("rug", { at: this.at(cx, cy), rot_deg: longX ? 90 : 0, size: { w_ft: wid - 2.5, d_ft: Math.min(len - 3, 12) } });
    this.put(t, { at: this.at(cx, cy), rot_deg: longX ? 0 : 90, variant: "marble top", material: "marble_white" });
    this.put(t === "dining_table_8" ? "chandelier" : "pendant", { at: this.at(cx, cy), variant: "low" });
    const sb = SIDES.flatMap((x) => this.free(x, 2.6, 0.5).map((sp) => ({ x, sp }))).filter((c) => c.sp[1] - c.sp[0] >= 5).sort((a, b) => b.sp[1] - b.sp[0] - (a.sp[1] - a.sp[0]))[0];
    if (sb) {
      const u = (sb.sp[0] + sb.sp[1]) / 2;
      this.against("sideboard", sb.x, u, { size: { w_ft: Math.min(6, sb.sp[1] - sb.sp[0] - 0.4) } });
      this.against("mirror_wall", sb.x, u, { size: { w_ft: 3.2, h_ft: 2.4 } });
    }
    this.fanAndAc(sb?.x);
    this.curtainsOnWindows();
    this.plantInCorner(1);
  }

  kitchen(): void {
    // main run on the longest free wall (windows allowed: sink goes under them)
    const runs = SIDES.flatMap((s) => this.free(s, 0.5, 0.4).map((sp) => ({ s, sp }))).filter((c) => c.sp[1] - c.sp[0] >= 3.5);
    runs.sort((a, b) => b.sp[1] - b.sp[0] - (a.sp[1] - a.sp[0]) + (this.sides[b.s].windows.length ? 1.5 : 0) - (this.sides[a.s].windows.length ? 1.5 : 0));
    const main = runs[0];
    if (!main) {
      this.put("kitchen_counter", { at: this.center(), size: { w_ft: Math.min(8, this.W - 1) } });
      return;
    }
    const [a, b] = main.sp;
    this.against("kitchen_counter", main.s, (a + b) / 2, { size: { w_ft: b - a, d_ft: 2 } });
    // L-return on an adjacent wall
    const adj = (main.s === "front" || main.s === "back" ? ["left", "right"] : ["front", "back"]) as Side[];
    let placedFridge = false;
    for (const s2 of adj) {
      const fr = this.free(s2, 0.5, 0.4).filter(([p, q]) => q - p >= 4.5);
      if (!fr.length || this.room.type === "dirty_kitchen") continue;
      const nearMain = main.s === "front" || main.s === "left" ? -1 : 1;
      let [p, q] = fr[0];
      // keep clear of the main run's depth
      const mainCoord = main.s === "front" ? this.inner.y0 : main.s === "back" ? this.inner.y1 : main.s === "left" ? this.inner.x0 : this.inner.x1;
      if (nearMain < 0) p = Math.max(p, mainCoord + 2.05);
      else q = Math.min(q, mainCoord - 2.05);
      if (q - p < 3.5) continue;
      if (!placedFridge && q - p >= 7.5) {
        const fu = nearMain < 0 ? q - 1.6 : p + 1.6;
        this.against("fridge", s2, fu);
        if (nearMain < 0) q -= 3.3;
        else p += 3.3;
        placedFridge = true;
      }
      if (q - p >= 3) this.against("kitchen_counter", s2, (p + q) / 2, { size: { w_ft: q - p, d_ft: 2 }, variant: "noHob" });
      break;
    }
    if (!placedFridge) {
      const f = SIDES.filter((s) => s !== main.s).flatMap((s) => this.free(s, 6.2, 0.4).map((sp) => ({ s, sp }))).find((c) => c.sp[1] - c.sp[0] >= 3.3);
      if (f) this.against("fridge", f.s, f.sp[1] - 1.6);
    }
    if (this.room.type === "kitchen") this.against("microwave", main.s, a + 1.3);
    this.plantInCorner(1, "plant_small");
  }

  bath(): void {
    const powder = this.room.type === "powder";
    const far = this.entry ? OPP[this.entry] : "back";
    const fs = this.free(far, 7, 0.3)[0];
    if (!powder && fs && fs[1] - fs[0] >= 3) {
      // shower in the corner of the far wall, away from the door
      const big = this.area >= 70 && this.room.rect.w >= 7 && this.room.rect.d >= 8 && this.room.id.includes("master");
      if (big) this.against("bathtub", far, fs[1] - 2.8);
      // (a small bath takes a 2.6 ft tray, so its WC and basin still fit)
      else if (this.area < 50) this.against("shower", far, fs[1] - 1.35, { size: { w_ft: 2.6, d_ft: 2.6 } });
      else this.against("shower", far, fs[1] - 1.55, { size: { w_ft: Math.min(3.2, fs[1] - fs[0]), d_ft: Math.min(3.2, this.depthFrom(far) * 0.45) } });
    }
    const sides = SIDES.filter((s) => s !== far).sort((p, q) => (q === OPP[far] ? 0 : 1) - (p === OPP[far] ? 0 : 1));
    let vanityDone = false, wcDone = false;
    for (const s of [...sides, far]) {
      for (const [p, q] of this.free(s, 3, 0.35)) {
        if (!vanityDone && q - p >= (powder ? 2.2 : 2.8)) {
          const vw = Math.min(powder ? 2.2 : 3.2, q - p - 0.2);
          this.against("vanity", s, p + vw / 2 + 0.1, { size: { w_ft: vw, d_ft: 1.6 } });
          vanityDone = true;
          continue;
        }
        if (vanityDone && !wcDone && q - p >= 2.4 && this.depthFrom(s) > 3.6) {
          this.against("wc", s, (p + q) / 2);
          wcDone = true;
        }
      }
      if (vanityDone && wcDone) break;
    }
    if (!wcDone) this.put("wc", { at: this.center() });
    // EN2-03: every wet room has a basin (a 1.5 × 1.2 ft wall-hung one where a vanity does not fit) and every bath a
    // shower (a 2.6 ft tray on the far wall where the corner shower did not fit)
    if (!this.has("vanity")) {
      const c = SIDES.flatMap((x) => this.free(x, 3, 0.3).map((sp) => ({ x, sp }))).filter((q) => q.sp[1] - q.sp[0] >= 1.7).sort((a, b) => (a.x === far ? 1 : 0) - (b.x === far ? 1 : 0))[0];
      this.against("vanity", c?.x ?? (this.entry && this.entry !== far ? OPP[far] : far), c ? (c.sp[0] + c.sp[1]) / 2 : (this.sides[far].lo + this.sides[far].hi) / 2, { size: { w_ft: 1.5, d_ft: 1.2 } });
    }
    if (!powder && !this.has("shower") && !this.has("bathtub")) {
      const sp = this.free(far, 7, 0.3)[0];
      const u = sp ? Math.max(sp[0] + 1.35, sp[1] - 1.35) : (this.sides[far].lo + this.sides[far].hi) / 2;
      this.against("shower", far, u, { size: { w_ft: 2.6, d_ft: 2.6 } });
    }
    if (!powder) {
      const tr = SIDES.flatMap((s) => this.free(s, 4.5, 0.3).map((sp) => ({ s, sp }))).find((c) => c.sp[1] - c.sp[0] > 2.2);
      if (tr) this.against("towel_rail", tr.s, tr.sp[0] + 1.1);
    }
  }

  dressing(): void {
    const ws = SIDES.flatMap((s) => this.free(s, 7.6, 0.3).map((sp) => ({ s, sp }))).filter((c) => c.sp[1] - c.sp[0] >= 2.5);
    for (const c of ws.slice(0, 2)) this.against("wardrobe", c.s, (c.sp[0] + c.sp[1]) / 2, { size: { w_ft: c.sp[1] - c.sp[0] - 0.1, d_ft: 1.9 } });
    if (!this.has("wardrobe")) {
      // EN2-03: a 1.6 ft deep hanging unit along the longest free wall (a dressing may cover its window)
      const c = SIDES.flatMap((s) => this.free(s, 0.5, 0.3).map((sp) => ({ s, sp }))).filter((q) => q.sp[1] - q.sp[0] >= 2).sort((a, b) => b.sp[1] - b.sp[0] - (a.sp[1] - a.sp[0]))[0];
      if (c) this.against("wardrobe", c.s, (c.sp[0] + c.sp[1]) / 2, { size: { w_ft: c.sp[1] - c.sp[0] - 0.1, d_ft: 1.6 } });
    }
    if (this.W > 5 && this.D > 5) this.put("ottoman", { at: this.center() });
  }

  study(): void {
    const win = SIDES.find((s) => this.sides[s].windows.length);
    const ds = win ? this.free(win, 2.6, 0.4)[0] : null;
    const s = ds && win ? win : SIDES.find((x) => this.free(x, 2.6, 0.4).length);
    if (s) {
      const sp = this.free(s, 2.6, 0.4)[0];
      const u = (sp[0] + sp[1]) / 2;
      this.against("study_desk", s, u);
      this.put("desk_chair", { at: this.pointFrom(s, u, 2.4), rot_deg: (this.rotFacingAwayFrom(s) + 180) % 360 });
    }
    const bs = SIDES.filter((x) => x !== s).flatMap((x) => this.free(x, 6.6, 0.4).map((sp) => ({ x, sp }))).find((c) => c.sp[1] - c.sp[0] > 3.2);
    if (bs) this.against("bookshelf", bs.x, (bs.sp[0] + bs.sp[1]) / 2, { size: { w_ft: Math.min(6, bs.sp[1] - bs.sp[0] - 0.2) } });
    this.put("armchair", { at: this.cornerAway(s ?? "front") });
    this.put("ceiling_fan", { at: this.center() });
    this.curtainsOnWindows();
  }

  prayer(): void {
    const rot = qiblaRot(this.ctx);
    const [cx, cy] = this.center();
    for (let i = 0; i < 3; i++) this.put("prayer_mat", { at: [cx + (i - 1) * 2.6 * Math.cos((rot * Math.PI) / 180), cy + (i - 1) * 2.6 * Math.sin((rot * Math.PI) / 180)], rot_deg: rot });
    const bs = SIDES.flatMap((x) => this.free(x, 3, 0.4).map((sp) => ({ x, sp }))).find((c) => c.sp[1] - c.sp[0] > 3);
    if (bs) this.against("bookshelf", bs.x, (bs.sp[0] + bs.sp[1]) / 2, { size: { w_ft: 3, h_ft: 3.2 } });
    this.put("ceiling_fan", { at: this.center() });
  }

  store(): void {
    for (const s of SIDES) {
      const sp = this.free(s, 6.6, 0.4)[0];
      if (sp && sp[1] - sp[0] > 2.5) this.against("bookshelf", s, (sp[0] + sp[1]) / 2, { size: { w_ft: Math.min(5, sp[1] - sp[0] - 0.2), d_ft: 1.4 }, material: { preset: "metal_brushed", color: "#9a9ea3" } });
    }
  }

  laundry(): void {
    // a 2 ft deep machine needs 2.5 ft clear in front of it; units on facing walls need 7 ft between the walls
    const sp = SIDES.flatMap((s) => this.free(s, 3, 0.4).map((x) => ({ s, x })))
      .filter((c) => c.x[1] - c.x[0] >= 2.2 && this.depthFrom(c.s) >= 4.5)
      .sort((a, b) => b.x[1] - b.x[0] - (a.x[1] - a.x[0]));
    const m = sp[0];
    if (!m) return;
    this.against("washing_machine", m.s, m.x[0] + 1.1);
    if (m.x[1] - m.x[0] >= 5.6) {
      this.against("sink_kitchen", m.s, m.x[0] + 4);
      return;
    }
    const other = sp.find((c) => c.s !== m.s && c.x[1] - c.x[0] >= 3.2 && (c.s !== OPP[m.s] || this.depthFrom(c.s) >= 7));
    if (other) this.against("sink_kitchen", other.s, (other.x[0] + other.x[1]) / 2);
  }

  hall(): void {
    if (Math.min(this.W, this.D) < 3.8) return;
    const c = SIDES.flatMap((s) => this.free(s, 2.6, 0.6).map((sp) => ({ s, sp }))).filter((x) => x.sp[1] - x.sp[0] >= 4.2 && this.depthFrom(x.s) >= 3.8)[0];
    if (c) {
      const u = (c.sp[0] + c.sp[1]) / 2;
      this.against("console_table", c.s, u, { size: { w_ft: Math.min(4, c.sp[1] - c.sp[0] - 0.4), d_ft: 1.1 } });
      this.against("painting", c.s, u, { size: { w_ft: 3, h_ft: 2.2 } });
    }
    this.plantInCorner(1);
  }

  porch(): void {
    const r = this.room.rect;
    // car parked nose-in toward the house (the side away from the road / driveway)
    const longY = r.d >= r.w;
    const suv = Math.max(r.w, r.d) >= 17;
    const rot = longY ? 0 : this.ctx.plan.roomsOn(this.room.level).some((q) => q.type === "driveway" && Math.abs(q.rect.x + q.rect.w - r.x) < 0.5) ? 90 : -90;
    const [cx, cy] = this.center();
    this.put(suv ? "car_suv" : "car_sedan", { at: [cx, cy + (longY ? 0.4 : 0)], rot_deg: rot, color: suv ? "#26282b" : "#e8e8e5" });
    if (Math.min(r.w, r.d) >= 13.5) this.put("motorbike", { at: longY ? [r.w - 1.6, cy + 2] : [cx + 2, r.d - 1.6], rot_deg: rot, color: "#b3122a" } as Partial<FurnishOptions>);
    this.plantInCorner(1);
  }

  balcony(): void {
    const r = this.room.rect;
    const long = r.w >= r.d;
    const n = Math.max(1, Math.floor(Math.max(r.w, r.d) / 6));
    const [cx, cy] = this.center();
    this.put("outdoor_table", { at: [cx, cy], variant: "low", size: { w_ft: 2 } });
    this.put("outdoor_chair", { at: long ? [cx - 2.2, cy] : [cx, cy - 2.2], rot_deg: long ? -90 : 0 });
    this.put("outdoor_chair", { at: long ? [cx + 2.2, cy] : [cx, cy + 2.2], rot_deg: long ? 90 : 180 });
    void n;
    this.plantInCorner(2);
  }

  terrace(): void {
    const [cx, cy] = this.center();
    this.put("outdoor_table", { at: [cx, cy] });
    for (const [dx, dy, rot] of [[-2.4, 0, -90], [2.4, 0, 90], [0, -2.4, 0], [0, 2.4, 180]] as const) this.put("outdoor_chair", { at: [cx + dx, cy + dy], rot_deg: rot });
    this.plantInCorner(3);
    if (this.area > 140) this.put("swing", { at: this.pointFrom("back", (this.inner.x0 + this.inner.x1) / 2, 3) });
  }

  garden(): void {
    const [cx, cy] = this.center();
    if (this.area > 180) this.put("swing", { at: [cx, cy] });
  }
}
