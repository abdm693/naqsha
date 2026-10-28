/** furnish(): place one furniture item (against a wall or at a room-local point), clamp, nudge, support, tag. */
import * as THREE from "three";
import type { FurnishOptions, FurnitureType, Side } from "@contracts/house-sdk";
import type { BuildCtx, PlacedItem } from "../core/ctx";
import { Kit } from "../core/shapes";
import { DEG, FT, clamp, colorHex, hashStr, luma, num, rng, warn } from "../core/util";
import { humanType } from "../core/notes";
import type { RoomM } from "../plan/model";
import { findRoom, innerRect } from "../interior";
import { acOutdoor, chairsForTable, ITEMS, type ItemDef } from "./items";
import { makeMats, type ItemBuild } from "./parts";
import { blocksWindow, isTall, keepOut, solidIntervals, spareWindows, type Zone } from "./zones";
import { ceilingSpot } from "../lights";
import { onWalkwayRect, parking, replanParking, type Parking } from "./parking";
import { subtract } from "../structure/cover";
import { roomPhrase } from "../structure/labels";

const SIDES: Side[] = ["front", "back", "left", "right"];
const ROT: Record<Side, number> = { front: 0, back: 180, left: -90, right: 90 };

const ALIASES: Record<string, FurnitureType> = {
  bed: "bed_queen", king_bed: "bed_king", queen_bed: "bed_queen", single_bed: "bed_single", double_bed: "bed_queen",
  nightstand: "side_table", bedside_table: "side_table", end_table: "side_table", closet: "wardrobe", cupboard: "wardrobe",
  sofa: "sofa_3", couch: "sofa_3", loveseat: "sofa_2", sectional: "sofa_l", l_sofa: "sofa_l", chair: "dining_chair", lounge_chair: "armchair",
  pouf: "ottoman", center_table: "coffee_table", centre_table: "coffee_table", tv_stand: "tv_unit", media_unit: "tv_unit", television: "tv",
  carpet: "rug", lamp: "floor_lamp", light: "pendant", fan: "ceiling_fan", ac: "ac_split", air_conditioner: "ac_split", plant: "plant_floor",
  potted_plant: "plant_floor", art: "painting", picture: "painting", mirror: "mirror_wall", dining_table: "dining_table_6", table: "dining_table_4",
  buffet: "sideboard", kitchen: "kitchen_counter", counter: "kitchen_counter", island: "kitchen_island", refrigerator: "fridge", stove: "hob",
  cooker: "oven", range: "oven", sink: "sink_kitchen", toilet: "wc", commode: "wc", basin: "vanity", washbasin: "vanity", bath: "bathtub",
  tub: "bathtub", towel: "towel_rail", desk: "study_desk", office_chair: "desk_chair", shelf: "bookshelf", shelves: "bookshelf",
  car: "car_sedan", suv: "car_suv", bike: "motorbike", motorcycle: "motorbike", washer: "washing_machine", jhoola: "swing",
  dispenser: "water_dispenser", janamaz: "prayer_mat", chandeliers: "chandelier", curtain: "curtains", drapes: "curtains",
};

export function resolveItem(item: unknown): FurnitureType | null {
  const s = String(item ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if ((ITEMS as Record<string, unknown>)[s]) return s as FurnitureType;
  if (ALIASES[s]) return ALIASES[s];
  for (const [k, v] of Object.entries(ALIASES)) if (s.includes(k)) return v;
  return null;
}

/** What each "top" item stands on (undefined: anything with a top surface). */
const TOP_SUPPORTS: Partial<Record<string, string[]>> = {
  hob: ["kitchen_counter", "kitchen_island"],
  sink_kitchen: ["kitchen_counter", "kitchen_island"],
  microwave: ["kitchen_counter", "kitchen_island", "sideboard"],
  table_lamp: ["side_table", "console_table", "dresser", "sideboard", "study_desk", "dressing_table"],
};

/** Items that may overlap each other's footprints (sets). */
const COMPANIONS: [string, string][] = [
  ["dining_chair", "dining_table"], ["desk_chair", "study_desk"], ["ottoman", "dressing_table"], ["ottoman", "sofa"], ["coffee_table", "sofa_l"],
  ["hob", "kitchen_counter"], ["sink_kitchen", "kitchen_counter"], ["microwave", "kitchen_counter"], ["outdoor_chair", "outdoor_table"],
];
const companions = (a: string, b: string) => COMPANIONS.some(([p, q]) => (a.startsWith(p) && b.startsWith(q)) || (a.startsWith(q) && b.startsWith(p)));

interface Rect4 { x0: number; x1: number; y0: number; y1: number }
const overlaps = (a: Rect4, b: Rect4, tol = 0.05) => a.x0 < b.x1 - tol && b.x0 < a.x1 - tol && a.y0 < b.y1 - tol && b.y0 < a.y1 - tol;

const OPP: Record<Side, Side> = { front: "back", back: "front", left: "right", right: "left" };
const WET = new Set<string>(["bath", "powder", "laundry", "store"]);
const ADJ: Record<Side, Side[]> = { front: ["left", "right"], back: ["left", "right"], left: ["front", "back"], right: ["front", "back"] };
/** EN3-01: pieces whose width is what they are (a bed, a sofa): never narrowed past 85 % */
const FIRM_WIDTH = new Set<string>(["bed_king", "bed_queen", "sofa_3", "sofa_l"]);
/** may be narrowed up to 15 % to fit */
const SHRINK = new Set<string>(["wardrobe", "sideboard", "kitchen_counter", "bookshelf", "tv_unit", "dresser", "console_table", "bed_king", "bed_queen", "sofa_3", "sofa_l", "shower", "vanity", "study_desk", "dressing_table"]);
/** never left out: if nothing is free they may touch other furniture, but never a door, stair or walkway */
const ESSENTIAL = new Set<string>(["wc", "vanity", "shower", "bed_king", "bed_queen", "bed_single", "kitchen_counter", "fridge", "dining_table_4", "dining_table_6", "dining_table_8", "sofa_3", "sofa_l", "sofa_2", "wardrobe", "washing_machine"]);

/** purely decorative pieces: when one has no free spot it is simply not placed (no note: nothing the family relies on) */
export const DECOR = new Set<string>(["plant_floor", "plant_small", "floor_lamp", "table_lamp", "painting", "ottoman", "swing", "outdoor_chair", "outdoor_table", "console_table", "side_table", "armchair", "desk_chair"]);
/** pieces that give way to a fixture the room cannot do without (they are left out, with a note) */
const SOFT = new Set<string>(["plant_floor", "plant_small", "water_dispenser", "armchair", "ottoman", "floor_lamp", "console_table", "desk_chair", "outdoor_chair", "outdoor_table", "swing"]);
/** the smaller version tried before an essential piece is left out */
const SMALLER: Partial<Record<string, { type: FurnitureType; size?: { w_ft?: number; d_ft?: number }; variant?: string }>> = {
  bed_king: { type: "bed_queen" },
  bed_queen: { type: "bed_single" },
  fridge: { type: "fridge", size: { w_ft: 2.4, d_ft: 2.2 } },
  dining_table_8: { type: "dining_table_6" },
  dining_table_6: { type: "dining_table_4" },
  sofa_l: { type: "sofa_3" },
  sofa_3: { type: "sofa_2" },
  // EN2-02/EN2-03: a shallow (1.6 ft) hanging unit before a wardrobe is left out
  wardrobe: { type: "wardrobe", size: { d_ft: 1.6 } },
  // EN2-03: a wall-hung basin, a shower tray
  vanity: { type: "vanity", size: { w_ft: 1.5, d_ft: 1.2 } },
  shower: { type: "shower", size: { w_ft: 2.6, d_ft: 2.6 } },
};
/** the last resort for a bath's shower: a wet-area shower on the wall (no tray, no glass) */
const WET_SHOWER = { type: "shower" as FurnitureType, size: { w_ft: 2, d_ft: 0.6 }, variant: "wet" };
/** EN3-01: the last bed before none: a compact single (a 6 ft 3 in divan) */
const SHORT_SINGLE: { type: FurnitureType; size: { w_ft: number; d_ft: number }; variant?: string } = { type: "bed_single", size: { w_ft: 3.3, d_ft: 6.25 } };

/** EN-03: what a room is not a room without (a bedroom's bed, a dressing room's wardrobe, a kitchen's fridge and hob,
 *  a bath's WC). Matched by type prefix; `add` is what the defining pass furnishes when it is missing. */
const DEFINING: Record<string, { label: string; types: string[]; add: FurnitureType }[]> = {
  master_bedroom: [{ label: "bed", types: ["bed_"], add: "bed_king" }],
  bedroom: [{ label: "bed", types: ["bed_"], add: "bed_queen" }],
  guest_bedroom: [{ label: "bed", types: ["bed_"], add: "bed_queen" }],
  servant: [{ label: "bed", types: ["bed_"], add: "bed_single" }],
  dressing: [{ label: "wardrobe", types: ["wardrobe"], add: "wardrobe" }],
  kitchen: [
    { label: "fridge", types: ["fridge"], add: "fridge" },
    { label: "hob", types: ["hob", "oven", "kitchen_counter"], add: "hob" },
  ],
  dirty_kitchen: [{ label: "hob", types: ["hob", "oven", "kitchen_counter"], add: "hob" }],
  // EN2-03: every bath and powder room has a basin, every bath a shower or a tub
  bath: [
    { label: "WC", types: ["wc"], add: "wc" },
    { label: "basin", types: ["vanity"], add: "vanity" },
    { label: "shower", types: ["shower", "bathtub"], add: "shower" },
  ],
  powder: [
    { label: "WC", types: ["wc"], add: "wc" },
    { label: "basin", types: ["vanity"], add: "vanity" },
  ],
};

export function isDefining(room: RoomM, type: string): boolean {
  return type !== "kitchen_counter" && (DEFINING[room.type] ?? []).some((d) => d.types.some((t) => type.startsWith(t)));
}

/**
 * EN3-01: build a piece again as another, smaller piece (a single bed for a queen) at the spot the walking-path repair
 * chose, with the colour, material and variant it was asked with. The old piece goes first (with what stands on it);
 * when the new one does not land on that spot, it is taken out again and the old one put back. Returns the new piece.
 */
export function rebuildAs(ctx: BuildCtx, it: PlacedItem, type: FurnitureType, at: { x: number; y: number; rot: number; side?: Side }, size?: { w_ft: number; d_ft: number }): PlacedItem | null {
  const room = ctx.plan.room(it.room);
  if (!room) return null;
  const parts = [it, ...ctx.items.filter((q) => q !== it && q.room === it.room && q.cls === "top" && (q.x0 + q.x1) / 2 > it.x0 && (q.x0 + q.x1) / 2 < it.x1 && (q.y0 + q.y1) / 2 > it.y0 && (q.y0 + q.y1) / 2 < it.y1)];
  const saved = parts.map((q) => ({ q, parent: q.group.parent, k: ctx.items.indexOf(q) }));
  const cols = ctx.colliders;
  const meshes = new Set<THREE.Object3D>();
  for (const q of parts) q.group.traverse((x) => meshes.add(x));
  for (const q of parts) {
    q.group.removeFromParent();
    ctx.items.splice(ctx.items.indexOf(q), 1);
  }
  ctx.colliders = cols.filter((m) => !meshes.has(m));
  const base: Record<string, unknown> = { ...(it.opts ?? {}) };
  for (const k of ["size", "at", "against", "along_ft", "rot_deg", "_smaller", "_exact"]) delete base[k];
  const o: Record<string, unknown> = { ...base, room: room.id, _smaller: 9, _exact: true, ...(size ? { size } : {}) };
  if (at.side) {
    const r = room.rect;
    o.against = at.side;
    o.along_ft = at.side === "front" ? r.x + r.w - at.x : at.side === "back" ? at.x - r.x : at.side === "left" ? at.y - r.y : r.y + r.d - at.y;
  } else {
    o.at = [at.x - room.rect.x, at.y - room.rect.y];
    o.rot_deg = at.rot;
  }
  const n = furnishImpl(ctx, type, o as unknown as FurnishOptions, (it.style ?? "modern") as "modern").item;
  if (n && Math.hypot((n.x0 + n.x1) / 2 - at.x, (n.y0 + n.y1) / 2 - at.y) < 0.35) return n;
  // (it did not land there: back to how it was)
  if (n) {
    n.group.removeFromParent();
    const k = ctx.items.indexOf(n);
    if (k >= 0) ctx.items.splice(k, 1);
  }
  for (const { q, parent, k } of saved) {
    parent?.add(q.group);
    ctx.items.splice(Math.min(Math.max(k, 0), ctx.items.length), 0, q);
  }
  ctx.colliders = cols;
  return null;
}

/**
 * EN-03, after every section: each room gets the pieces it is defined by. A missing one (never asked for, or left out
 * because nothing was free) is furnished again with the full search (every wall, both orientations, a smaller
 * version, softer pieces giving way); if it still has no place the build reports a fail note.
 */
export function ensureDefining(ctx: BuildCtx, run?: (fn: () => void) => Promise<void>): Promise<void> | void {
  const missing = (room: RoomM) => (DEFINING[room.type] ?? []).filter((d) => !ctx.items.some((it) => it.room === room.id && d.types.some((t) => it.type.startsWith(t) && !(t === "kitchen_counter" && /nohob/i.test(it.variant ?? "")))));
  const rooms = ctx.plan.rooms.filter((r) => r.cat === "enclosed" && missing(r).length);
  if (!rooms.length) return;
  const work = () => {
    for (const room of rooms) {
      // in order of need (a bath's WC, then its basin, then its shower): a fixture that comes later and stands in the
      // way of an earlier one gives way to it and is placed again in its own turn
      const defs = DEFINING[room.type] ?? [];
      for (const [k, d] of defs.entries()) {
        if (!missing(room).some((m) => m.label === d.label)) continue;
        // the wall with the longest solid stretch first (the placer tries the others itself); a shower on the wall
        // across from the door
        const place = () => {
          const sides = SIDES.map((s) => ({ s, len: solidIntervals(ctx, room, s).reduce((a, [p, q]) => Math.max(a, q - p), 0) })).sort((a, b) => b.len - a.len);
          const entry = d.add === "shower" ? doorWall(ctx, room) : null;
          furnishImpl(ctx, d.add, { room: room.id, against: entry ? OPP[entry] : sides[0]?.s ?? "back" } as FurnishOptions);
        };
        place();
        if (WET.has(room.type) && missing(room).some((m) => m.label === d.label)) {
          const later = defs.slice(k + 1).flatMap((x) => x.types);
          const lesser = ctx.items.filter((it) => it.room === room.id && it.cls === "floor" && later.some((t) => it.type.startsWith(t)));
          if (lesser.length) {
            for (const it of lesser) evict(ctx, it, d.add);
            place();
          }
        }
        const still = missing(room).some((m) => m.label === d.label);
        if (still)
          ctx.notes.add({
            id: `asbuilt.furniture_missing:${room.id}:${d.label.toLowerCase()}`,
            title: `No ${d.label} in the ${room.name}`,
            status: "fail",
            message: `There's no place for a ${d.label} in ${roomLabel(ctx, room)} that keeps its doorways clear.`,
            element_ids: [room.id],
          });
      }
    }
  };
  return run ? run(work) : work();
}

/** The wall a room is entered through (its widest door), or null. */
function doorWall(ctx: BuildCtx, room: RoomM): Side | null {
  const d = ctx.model.openingsOfRoom(room).filter((o) => o.isDoor).sort((a, b) => b.u1 - b.u0 - (a.u1 - a.u0))[0];
  if (!d) return null;
  const into = d.neg === room ? -1 : 1;
  return d.run.axis === "x" ? (into > 0 ? "front" : "back") : into > 0 ? "left" : "right";
}

/**
 * EN2-04, after every section: the porch parks as many cars as the plan asks for. A car the design did not furnish
 * goes into a free bay; when none is free the car branch of furnish reports "Only N of M cars fit".
 */
export function ensureCars(ctx: BuildCtx): void {
  const porches = ctx.plan.rooms.filter((r) => r.lv.i === 0 && (r.type === "porch" || r.type === "garage")).sort((a, b) => b.rect.w * b.rect.d - a.rect.w * a.rect.d);
  if (!porches.length) return;
  // (a car the design asked for and that did not fit is already reported: only the ones it never asked for)
  for (let k = 0; ctx.carsParked < ctx.carsPlan && ctx.carsAsked < ctx.carsPlan && k < 6; k++) {
    const before = ctx.carsParked;
    const suv = ctx.items.some((it) => it.type === "car_sedan");
    furnishImpl(ctx, suv ? "car_suv" : "car_sedan", { room: porches[0].id, color: suv ? "#26282b" : "#e8e8e5" } as FurnishOptions);
    if (ctx.carsParked === before) break;
  }
}

/** EN-08: 1.5 ft around every door and arch frame of a room, as keep-out boxes for a TV unit. */
function tvFrameZones(ctx: BuildCtx, room: RoomM): Zone[] {
  const out: Zone[] = [];
  for (const o of ctx.model.openingsOfRoom(room)) {
    if (!o.isDoor) continue;
    const run = o.run;
    const into = o.neg === room ? -1 : 1;
    const c0 = run.c + (into * run.t) / 2, c1 = c0 + into * 1.5;
    const z = run.axis === "x" ? { x0: o.u0 - 1.5, x1: o.u1 + 1.5, y0: Math.min(c0, c1), y1: Math.max(c0, c1) } : { x0: Math.min(c0, c1), x1: Math.max(c0, c1), y0: o.u0 - 1.5, y1: o.u1 + 1.5 };
    out.push({ ...z, kind: "door", core: { ...z }, id: o.op.id });
  }
  return out;
}

/** The wall of `room` an opening is in. */
function wallOf(room: RoomM, o: { neg: RoomM | null; run: { axis: "x" | "y" } }): Side {
  const into = o.neg === room ? -1 : 1;
  // the room lies on the `into` side of the wall: a wall at the room's low edge is its front/left wall
  return o.run.axis === "x" ? (into > 0 ? "front" : "back") : into > 0 ? "left" : "right";
}

/** EN3-04: how many rooms away from the main door each room of its floor is (through doors, arches and open plan). */
function stepsFromMainDoor(ctx: BuildCtx): Map<string, number> {
  const memo = ctx as unknown as { stepsFromMain?: Map<string, number> };
  if (memo.stepsFromMain) return memo.stepsFromMain;
  const dist = new Map<string, number>();
  const main = ctx.model.openings.find((o) => o.op.type === "main_door");
  const q: RoomM[] = [];
  for (const r of main ? [main.neg, main.pos] : []) if (r && !dist.has(r.id)) { dist.set(r.id, 0); q.push(r); }
  while (q.length) {
    const r = q.shift()!;
    const d = dist.get(r.id)!;
    const next: RoomM[] = [];
    for (const o of ctx.model.openingsOfRoom(r)) if (o.isDoor) next.push(...[o.neg, o.pos].filter((x): x is RoomM => !!x && x !== r));
    for (const id of r.open) {
      const x = ctx.plan.room(id);
      if (x && x.level === r.level) next.push(x);
    }
    for (const x of next) if (!dist.has(x.id)) { dist.set(x.id, d + 1); q.push(x); }
  }
  return (memo.stepsFromMain = dist);
}

/**
 * The walls a living room is entered through: the one holding the house's main door; else (EN3-04) the ones holding a
 * door from a lobby, porch or corridor that the way in from the main door comes through (nearer the main door than
 * the room itself). Empty for other rooms.
 */
function entranceWalls(ctx: BuildCtx, room: RoomM): Side[] {
  if (!["lounge", "drawing", "dining", "lobby"].includes(room.type)) return [];
  const ops = ctx.model.openingsOfRoom(room);
  const main = ops.find((o) => o.op.type === "main_door");
  if (main) return [wallOf(room, main)];
  const dist = stepsFromMainDoor(ctx);
  const d0 = dist.get(room.id);
  if (d0 === undefined) return [];
  const out = new Set<Side>();
  for (const o of ops) {
    if (!o.isDoor) continue;
    const other = o.neg === room ? o.pos : o.neg;
    if (!other || !["lobby", "porch", "corridor"].includes(other.type)) continue;
    const d = dist.get(other.id);
    if (d !== undefined && d < d0) out.add(wallOf(room, o));
  }
  return [...out];
}

/**
 * EN-08: the TV wall of a living room is not the wall it is entered through. When a design puts the TV unit there,
 * the whole media group placed in that section (TV unit, TV, sofas, armchairs, coffee table, rug, lamps) is mirrored
 * to the opposite wall, keeping how the pieces face each other, if every piece is free there.
 */
function mirrorMedia(ctx: BuildCtx, room: RoomM, S: Side): void {
  const MEDIA = /^(tv_unit|tv$|sofa_|armchair|coffee_table|ottoman|rug|floor_lamp|side_table|table_lamp)/;
  const group = ctx.items.filter((it) => it.room === room.id && MEDIA.test(it.type) && it.cls !== "ceiling");
  const unit = group.find((it) => it.type === "tv_unit" && it.against === S);
  if (!unit) return;
  const ax: "x" | "y" = S === "front" || S === "back" ? "y" : "x";
  const inner = innerRect(ctx, room);
  const m = ax === "y" ? (inner.y0 + inner.y1) / 2 : (inner.x0 + inner.x1) / 2;
  const box = (it: Rect4): Rect4 => (ax === "y" ? { x0: it.x0, x1: it.x1, y0: 2 * m - it.y1, y1: 2 * m - it.y0 } : { x0: 2 * m - it.x1, x1: 2 * m - it.x0, y0: it.y0, y1: it.y1 });
  const zones = keepOut(ctx, room).filter((z) => z.kind !== "window");
  const frames = tvFrameZones(ctx, room);
  const others = ctx.items.filter((it) => it.room === room.id && it.cls === "floor" && !group.includes(it));
  const inside = (b: Rect4) => b.x0 >= inner.x0 - 0.05 && b.x1 <= inner.x1 + 0.05 && b.y0 >= inner.y0 - 0.05 && b.y1 <= inner.y1 + 0.05;
  const O = OPP[S];
  // (it stays where it is, quietly, when the group does not fit across the room)
  const stay = (why: string) => warn(`furnish: the TV group in ${room.id} stays on the ${S} wall (${why})`);
  // (never onto another wall the room is entered through)
  if (entranceWalls(ctx, room).includes(O)) return stay(`the ${O} wall is an entrance wall too`);
  for (const it of group) {
    const b = box(it);
    if (!inside(b)) return stay(`the ${it.type} would leave the room`);
    if (it.cls === "floor") {
      const zs = it.type === "tv_unit" ? [...zones, ...frames] : zones;
      const z = zs.find((z) => overlaps(b, z.core ?? z, 0.04));
      if (z) return stay(`the ${it.type} would stand in front of ${z.id ?? z.kind}`);
      const o = others.find((o) => overlaps(b, o, 0.08));
      if (o) return stay(`the ${it.type} would stand on the ${o.type}`);
    }
    if ((it.cls === "wall" || it.type === "tv_unit") && it.against === S) {
      const [a, c] = ax === "y" ? [b.x0, b.x1] : [b.y0, b.y1];
      if (it.cls === "wall" && !solidIntervals(ctx, room, O).some(([p, q]) => a >= p - 0.05 && c <= q + 0.05)) return stay(`no solid ${O} wall for the ${it.type}`);
      if (it.type === "tv_unit" && !ctx.model.roomWalls(room, O).some((wl) => a >= wl.a - 0.3 && c <= wl.b + 0.3)) return stay(`no ${O} wall behind the TV unit`);
    }
  }
  for (const it of group) {
    const b = box(it);
    const dx = b.x0 - it.x0, dy = b.y0 - it.y0;
    it.group.position.x += dx * FT;
    it.group.position.z -= dy * FT;
    const r0 = it.rot ?? 0;
    const r1 = ax === "y" ? 180 - r0 : -r0;
    it.group.rotation.y += (r1 - r0) * DEG;
    it.rot = r1;
    if (it.against === S) it.against = O;
    else if (it.against === O) it.against = S;
    Object.assign(it, b);
  }
  ctx.notes.add({ id: `asbuilt.tv_wall:${room.id}`, title: "TV moved off the entrance wall", status: "warn", message: `The TV in ${roomLabel(ctx, room)} was turned to the ${O} wall, away from the door the room is entered by.`, element_ids: [room.id] });
}

/** Take a piece out again (it gave way to a fixture), with whatever stands on it. */
function evict(ctx: BuildCtx, it: PlacedItem, forType: string): void {
  const deps = ctx.items.filter((q) => q !== it && q.room === it.room && q.cls === "top" && (q.x0 + q.x1) / 2 > it.x0 && (q.x0 + q.x1) / 2 < it.x1 && (q.y0 + q.y1) / 2 > it.y0 && (q.y0 + q.y1) / 2 < it.y1);
  for (const q of [it, ...deps]) {
    q.group.removeFromParent();
    const meshes = new Set<THREE.Object3D>();
    q.group.traverse((x) => meshes.add(x));
    ctx.colliders = ctx.colliders.filter((m) => !meshes.has(m));
    const k = ctx.items.indexOf(q);
    if (k >= 0) ctx.items.splice(k, 1);
  }
  // EN2-05: a soft piece (a plant, a chair, a dispenser) giving way to a fixture is not worth a note
  warn(`furnish: ${it.type} in ${it.room} left out to make room for the ${humanType(forType)}`);
}

/** A room's name for notes, with its floor when another room on another floor has the same name (EN-07). */
/** EN-F4: a room as notes name it mid-sentence: "the dirty kitchen", "the stair hall on the first floor". */
export function roomLabel(ctx: BuildCtx, room: RoomM | null | undefined): string {
  return room ? roomPhrase(ctx.plan, room) : "a room";
}

const alongOf = (side: Side, it: { x0: number; x1: number; y0: number; y1: number }): [number, number] => (side === "front" || side === "back" ? [it.x0, it.x1] : [it.y0, it.y1]);

/** The partner a wall item lines up with: a TV over its unit, a mirror over a dresser or vanity, a painting over a sofa, sideboard, console or bed. */
function pairPartner(ctx: BuildCtx, room: RoomM, type: string, side: Side, u: number, alongGiven: boolean): { side: Side; u: number } | null {
  const partners: Record<string, string[]> = {
    tv: ["tv_unit"],
    mirror_wall: ["dresser", "dressing_table", "vanity"],
    painting: ["sofa_3", "sofa_2", "sofa_l", "sideboard", "console_table", "bed_king", "bed_queen", "bed_single"],
  };
  const want = partners[type];
  if (!want) return null;
  const cands = ctx.items.filter((it) => it.room === room.id && want.includes(it.type) && it.against);
  if (!cands.length) return null;
  const scored = cands
    .map((it) => {
      const [a, b] = alongOf(it.against as Side, it);
      const c = (a + b) / 2;
      return { it, c, half: (b - a) / 2, dist: it.against === side ? Math.abs(c - u) : 1e6 };
    })
    .sort((p, q) => p.dist - q.dist);
  const best = scored[0];
  if (type === "tv") return { side: best.it.against as Side, u: best.c };
  if (best.it.against !== side) return null;
  if (alongGiven && best.dist > best.half + 2) return null;
  return { side, u: best.c };
}

/** B.4.1: a solid stretch of wall for a wall item: the requested wall, then the opposite one, then the adjacent ones. */
function placeOnWall(ctx: BuildCtx, room: RoomM, type: string, side: Side, u: number, w: number, onlyThisWall = false): { side: Side; u: number } | null {
  const high = (t: string) => t === "ac_split";
  const others = ctx.items.filter((it) => it.room === room.id && it.cls === "wall" && it.type !== "curtains" && high(it.type) === high(type));
  for (const s of onlyThisWall ? [side] : [side, OPP[side], ...ADJ[side]]) {
    let ints = solidIntervals(ctx, room, s);
    // EN-08: a TV keeps 1.5 ft from every door and arch frame on its wall
    if (type === "tv") ints = subtract(ints, ctx.model.roomWalls(room, s).flatMap((wl) => wl.run.openings.filter((o) => o.isDoor).map((o) => [o.u0 - 1.5, o.u1 + 1.5] as [number, number])));
    ints = subtract(ints, others.filter((it) => it.against === s).map((it) => { const [a, b] = alongOf(s, it); return [a - 0.25, b + 0.25] as [number, number]; }));
    const fits = ints.filter(([a, b]) => b - a >= w + 0.2);
    if (!fits.length) continue;
    if (s === side) {
      let best: { u: number; dd: number } | null = null;
      for (const [a, b] of fits) {
        const c = clamp(u, a + w / 2 + 0.1, b - w / 2 - 0.1);
        if (!best || Math.abs(c - u) < best.dd) best = { u: c, dd: Math.abs(c - u) };
      }
      return { side: s, u: best!.u };
    }
    const [a, b] = fits.sort((p, q) => q[1] - q[0] - (p[1] - p[0]))[0];
    return { side: s, u: (a + b) / 2 };
  }
  return null;
}

/**
 * EN2-02: where a pair of curtains hangs: centred on the window or sliding door of `side` nearest `u`, else on the
 * room's largest one (ventilators and slits under 1.5 ft do not count); as wide as asked within the glazing + 0.6 to
 * + 2.4 ft, and never reaching over a door, an arch or the room's corner. Null when the room has no glazing.
 */
function curtainSpot(ctx: BuildCtx, room: RoomM, side: Side, u: number, wAsk: number): { side: Side; u: number; w: number } | null {
  const glazing = (s: Side) =>
    ctx.model.roomWalls(room, s).flatMap((wl) => wl.run.openings.filter((op) => op.op.type === "sliding_door" || (!op.isDoor && op.op.type !== "ventilator" && op.u1 - op.u0 >= 1.5)));
  let pick = glazing(side).sort((p, q) => Math.abs((p.u0 + p.u1) / 2 - u) - Math.abs((q.u0 + q.u1) / 2 - u))[0];
  let s = side;
  if (!pick) {
    const all = SIDES.flatMap((x) => glazing(x).map((op) => ({ x, op }))).sort((p, q) => q.op.u1 - q.op.u0 - (p.op.u1 - p.op.u0));
    if (!all.length) return null;
    pick = all[0].op;
    s = all[0].x;
  }
  const c = (pick.u0 + pick.u1) / 2, win = pick.u1 - pick.u0;
  let half = (Number.isFinite(wAsk) ? clamp(wAsk, win + 0.6, win + 2.4) : win + 1.6) / 2;
  // stay off every door and arch on that wall, and inside the room
  const inner = innerRect(ctx, room);
  const [lo, hi] = s === "front" || s === "back" ? [inner.x0, inner.x1] : [inner.y0, inner.y1];
  half = Math.min(half, c - lo - 0.05, hi - c - 0.05);
  for (const wl of ctx.model.roomWalls(room, s))
    for (const op of wl.run.openings) {
      if (op === pick || !op.isDoor || op.op.type === "sliding_door") continue;
      if (op.u1 <= c) half = Math.min(half, c - op.u1 - 0.15);
      else if (op.u0 >= c) half = Math.min(half, op.u0 - c - 0.15);
    }
  half = Math.max(half, win / 2 + 0.1);
  return { side: s, u: c, w: 2 * half };
}

/** A TV placed before its unit: at the end of the section, slide it over the unit and set it 0.9 ft above it. */
function deferTvPairing(ctx: BuildCtx, room: RoomM, group: THREE.Object3D, getItem: () => PlacedItem | undefined): void {
  ctx.endOfSection.push(() => {
    const it = getItem();
    if (!it || !it.against) return;
    const side = it.against as Side;
    const unit = ctx.items.find((q) => q.room === room.id && q.type === "tv_unit" && q.against === side);
    if (!unit) return;
    const [ua, ub] = alongOf(side, unit);
    const [ta, tb] = alongOf(side, it);
    const du = (ua + ub) / 2 - (ta + tb) / 2;
    const w = tb - ta;
    const target = (ua + ub) / 2;
    if (!solidIntervals(ctx, room, side).some(([a, b]) => target - w / 2 >= a - 0.01 && target + w / 2 <= b + 0.01)) return;
    const mount = unit.h1 + 0.9;
    if (side === "front" || side === "back") {
      group.position.x += du * FT;
      it.x0 += du;
      it.x1 += du;
    } else {
      group.position.z -= du * FT;
      it.y0 += du;
      it.y1 += du;
    }
    const dh = mount - it.h0;
    group.position.y += dh * FT;
    it.h0 += dh;
    it.h1 += dh;
  });
}

/** Door, open-plan gate, stair and roof keep-out zones inside a room (plan ft); see zones.ts. */
export function doorZones(ctx: BuildCtx, room: RoomM): Rect4[] {
  return keepOut(ctx, room).filter((z) => z.kind !== "window");
}

function footprint(cx: number, cy: number, w: number, d: number, rotDeg: number): Rect4 {
  const t = rotDeg * DEG;
  const hx = (Math.abs(Math.cos(t)) * w + Math.abs(Math.sin(t)) * d) / 2;
  const hy = (Math.abs(Math.sin(t)) * w + Math.abs(Math.cos(t)) * d) / 2;
  return { x0: cx - hx, x1: cx + hx, y0: cy - hy, y1: cy + hy };
}

function defaultsFor(ctx: BuildCtx, type: FurnitureType, style: string): { fabric: string; accent: string; accent2: string; main?: string } {
  const pal = ctx.plan.palette;
  const wood = pal.find((c) => { const l = luma(c); return l > 0.18 && l < 0.55; }) ?? "#a26a3c";
  const neutral = pal.find((c) => luma(c) > 0.65 && luma(c) < 0.92) ?? "#d9d3c7";
  const fabric: Partial<Record<string, string>> = {
    sofa_3: "#cfc8bb", sofa_2: "#cfc8bb", sofa_l: "#c9c3b7", armchair: "#a8714a", ottoman: "#6e7d73", bed_king: "#cfc6b8", bed_queen: "#d4cdbf",
    bed_single: "#c9cfd2", dining_chair: "#d8d0c2", desk_chair: "#4a4d52", rug: neutral, prayer_mat: "#7a1f2b", curtains: "#ece6da",
  };
  void style;
  return { fabric: fabric[type] ?? "#cfc8bb", accent: wood === "#a26a3c" ? "#8a5a3a" : wood, accent2: "#e9e1d3" };
}

function defaultMain(ctx: BuildCtx, type: FurnitureType): THREE.Material {
  const M = ctx.mats;
  switch (type) {
    case "wardrobe": return M.get({ preset: "lacquer", color: "#d8d2c8" });
    case "kitchen_counter": case "kitchen_island": case "sink_kitchen": return M.get({ preset: "lacquer", color: "#2d3034" });
    case "fridge": case "oven": return M.get("metal_brushed");
    case "ceiling_fan": return M.get({ preset: "lacquer", color: "#f1efea" });
    case "car_sedan": return M.get({ preset: "lacquer", color: "#e9e9e6", metalness: 0.35, roughness: 0.3 });
    case "car_suv": return M.get({ preset: "lacquer", color: "#25272a", metalness: 0.45, roughness: 0.3 });
    case "vanity": return M.get("wood_walnut");
    case "coffee_table": case "dining_table_4": case "dining_table_6": case "dining_table_8": return M.get("wood_walnut");
    default: return M.get("wood_walnut");
  }
}

export interface FurnishResult {
  group: THREE.Group;
  item?: PlacedItem;
}

export function furnishImpl(ctx: BuildCtx, itemIn: FurnitureType, o: FurnishOptions, style: "modern" | "classic" | "minimal" | "traditional" = "modern"): FurnishResult {
  const prof = (globalThis as unknown as { __naqshaProf?: Record<string, number> }).__naqshaProf;
  const tp = prof ? performance.now() : 0;
  try {
    return furnishInner(ctx, itemIn, o, style);
  } finally {
    if (prof) prof[String(itemIn)] = (prof[String(itemIn)] ?? 0) + performance.now() - tp;
  }
}

function furnishInner(ctx: BuildCtx, itemIn: FurnitureType, o: FurnishOptions, style: "modern" | "classic" | "minimal" | "traditional"): FurnishResult {
  const group = new THREE.Group();
  const type = resolveItem(itemIn);
  if (!type) {
    warn(`furnish: unknown item "${String(itemIn)}", skipped`);
    return { group };
  }
  if (type !== itemIn) warn(`furnish: "${String(itemIn)}" interpreted as ${type}`);
  const def: ItemDef = ITEMS[type];
  const room = findRoom(ctx, o?.room);
  if (!room) return { group };
  // EN-F3: a void (an upper open space over a court) has no floor to stand anything on
  if (room.void) {
    warn(`furnish: ${room.id} is open to the floor below (no floor); ${type} skipped`);
    return { group };
  }
  const inner = innerRect(ctx, room);
  const isOpenRoom = room.cat !== "enclosed";
  // an open-plan side (no wall at all) is no boundary: furniture may reach 1.5 ft into the neighbouring space
  const openSide = (s: Side) => !isOpenRoom && ctx.structureBuilt && !ctx.model.roomWalls(room, s).length && [...room.open].some((id) => ctx.plan.room(id)?.level === room.level);
  const bounds: Rect4 = isOpenRoom
    ? { x0: room.rect.x + 0.2, x1: room.rect.x + room.rect.w - 0.2, y0: room.rect.y + 0.2, y1: room.rect.y + room.rect.d - 0.2 }
    : { x0: inner.x0 - (openSide("left") ? 1.5 : 0), x1: inner.x1 + (openSide("right") ? 1.5 : 0), y0: inner.y0 - (openSide("front") ? 1.5 : 0), y1: inner.y1 + (openSide("back") ? 1.5 : 0) };
  const size = (o?.size ?? {}) as { w_ft?: number; d_ft?: number; h_ft?: number };
  let w = num(size.w_ft, def.dims[0], 0.2, 40);
  let d = num(size.d_ft, def.dims[1], 0.05, 40);
  const h = num(size.h_ft, def.dims[2], 0.02, 30);
  if ((type === "car_sedan" || type === "car_suv" || type === "motorbike") && w > d) [w, d] = [d, w];
  if (type === "kitchen_counter") d = clamp(d, 1.6, 3);
  const variant = String(o?.variant ?? "").toLowerCase();
  let against: Side | null = SIDES.includes(o?.against as Side) ? (o.against as Side) : null;
  const isVehicle = type === "car_sedan" || type === "car_suv";
  const outdoorGround = room.lv.i === 0 && room.cat !== "enclosed";
  const park = outdoorGround && ctx.structureBuilt ? parking(ctx) : null;
  // keep-out zones for floor items: doors, open-plan gates, stairs, roof door, tank, solar area; windows for tall items
  const zones: Zone[] = (def.cls === "floor" || def.cls === "top") && ctx.structureBuilt ? keepOut(ctx, room).filter((z) => z.kind !== "window" || blocksWindow(type, h, z)) : [];
  // EN2-02: the windows a tall piece may still stand in front of as a last resort (never a habitable room's only one)
  const spare = isTall(type, h) && zones.some((z) => z.kind === "window") ? spareWindows(ctx, room, type) : "all";
  let anyWindow = false; // (probe: would a spot exist if every window could be blocked?)
  const mayBlock = (z: Zone) => anyWindow || spare === "all" || spare.has(z.id ?? "");
  // EN-08: a TV unit keeps 1.5 ft from every door and arch frame (never wedged between two openings)
  if (type === "tv_unit" && ctx.structureBuilt) zones.push(...tvFrameZones(ctx, room));
  let rot = 0;
  let cx: number, cy: number;
  let wallInfo: { axis: "x" | "y"; inner: number; into: number; lo: number; hi: number } | null = null;
  const faceOf = (side: Side) => {
    const r = room.rect;
    const axis: "x" | "y" = side === "front" || side === "back" ? "x" : "y";
    const walls = ctx.model.roomWalls(room, side);
    const into = side === "front" || side === "left" ? 1 : -1;
    const edge = side === "front" ? r.y : side === "back" ? r.y + r.d : side === "left" ? r.x : r.x + r.w;
    // the face of the thickest wall on that side (the room bounds use the same), so items never sink into a wall
    const inner = walls.length ? (into > 0 ? Math.max(...walls.map((wl) => wl.inner)) : Math.min(...walls.map((wl) => wl.inner))) : edge + into * 0.05;
    const lo = axis === "x" ? bounds.x0 : bounds.y0, hi = axis === "x" ? bounds.x1 : bounds.y1;
    return { axis, inner, into, lo, hi };
  };
  /** centre of an item of this size against `side` at along-coordinate u */
  const poseOn = (side: Side, u: number): [number, number] => {
    const f = faceOf(side);
    const t = ROT[side] * DEG;
    const halfAcross = f.axis === "x" ? (Math.abs(Math.sin(t)) * w + Math.abs(Math.cos(t)) * d) / 2 : (Math.abs(Math.cos(t)) * w + Math.abs(Math.sin(t)) * d) / 2;
    const across = f.inner + f.into * (halfAcross + 0.02);
    return f.axis === "x" ? [u, across] : [across, u];
  };
  const dropped = (why: string, keptWindow = false): FurnishResult => {
    // EN2-05: an optional piece that does not fit is left out quietly; a piece the room is defined by (its bed, its WC,
    // a kitchen's fridge) is reported by the defining pass at the end of the build if it still has no place (EN-03).
    // EN2-02: a piece left out because its only spot was across the room's window is worth telling the family.
    if (keptWindow && !isDefining(room, type))
      ctx.notes.add({ id: `asbuilt.window_kept_clear:${room.id}:${type}`, title: "Furniture left out to keep a window clear", status: "warn", message: `The ${humanType(type)} in ${roomLabel(ctx, room)} was left out to keep the window clear.`, element_ids: [room.id] });
    warn(`furnish ${type} in ${room.id}: ${why}; left out`);
    const dbg = (ctx as unknown as { dropLog?: unknown[] }).dropLog ?? ((ctx as unknown as { dropLog?: unknown[] }).dropLog = []);
    dbg.push({ type, room: room.id, cx, cy, w, d, rot, against, bounds, zones });
    return { group };
  };

  if (isVehicle) {
    // B.6: cars only in a parking bay that keeps the gate-to-door walkway clear
    ctx.carsAsked++;
    let bays = ctx.structureBuilt ? parking(ctx).bays.filter((b) => !b.used) : [];
    if (!bays.length && ctx.structureBuilt) {
      // EN-04: more cars than were counted up front: lay the bays out again for one more car, moving the parked ones
      const re = replanParking(ctx, ctx.carsAsked);
      if (re) {
        moveParkedCars(ctx, re);
        bays = re.bays.filter((b) => !b.used);
      }
    }
    const want = Array.isArray(o?.at) ? [room.rect.x + num(o.at[0], room.rect.w / 2), room.rect.y + num(o.at[1], room.rect.d / 2)] : [room.rect.x + room.rect.w / 2, room.rect.y + room.rect.d / 2];
    const bay = bays.sort((a, b) => (a.where === b.where ? 0 : a.where === "porch" ? -1 : 1) || Math.hypot(a.rect.x + a.rect.w / 2 - want[0], a.rect.y + a.rect.d / 2 - want[1]) - Math.hypot(b.rect.x + b.rect.w / 2 - want[0], b.rect.y + b.rect.d / 2 - want[1]))[0];
    if (!bay) {
      const m = Math.max(ctx.carsAsked, ctx.carsWanted);
      const nParked = ctx.carsParked;
      ctx.notes.set({
        id: "asbuilt.car_dropped",
        title: "Car left out",
        status: "fail",
        message: `Only ${nParked} of ${m} cars ${nParked === 1 ? "fits" : "fit"} in ${roomLabel(ctx, room)} with a 3 ft walkway kept from the gate to the main door.`,
        element_ids: [room.id],
      });
      return { group };
    }
    ctx.carsParked++;
    bay.used = true;
    cx = bay.rect.x + bay.rect.w / 2;
    cy = bay.rect.y + bay.rect.d / 2;
    rot = bay.rot;
    against = null;
  } else if (against) {
    rot = ROT[against];
    const r = room.rect;
    const axis: "x" | "y" = against === "front" || against === "back" ? "x" : "y";
    wallInfo = faceOf(against);
    // along_ft: from the wall's LEFT end as seen from inside the room
    const len = axis === "x" ? r.w : r.d;
    let along = num(o?.along_ft, NaN);
    let u: number | undefined;
    const alongGiven = Number.isFinite(along);
    if (!alongGiven) along = len / 2;
    if (u === undefined) {
      along = clamp(along, 0, len);
      u = against === "front" ? r.x + r.w - along : against === "back" ? r.x + along : against === "left" ? r.y + along : r.y + r.d - along;
    }
    // EN2-02: curtains always hang centred on glazing (a window or a sliding door): the one on that wall nearest the
    // asked spot, else the room's largest; never over a door; a room with no window gets none
    if (type === "curtains" && ctx.structureBuilt) {
      const spot = curtainSpot(ctx, room, against, u, num(o?.size?.w_ft, NaN));
      if (!spot) {
        warn(`furnish curtains in ${room.id}: no window or sliding door to hang them at; left out`);
        return { group };
      }
      // (one pair per window)
      const mid = (it: PlacedItem) => (spot.side === "front" || spot.side === "back" ? (it.x0 + it.x1) / 2 : (it.y0 + it.y1) / 2);
      if (ctx.items.some((it) => it.room === room.id && it.type === "curtains" && it.against === spot.side && Math.abs(mid(it) - spot.u) < 0.3)) return { group };
      against = spot.side;
      rot = ROT[against];
      wallInfo = faceOf(against);
      u = spot.u;
      w = spot.w;
    }
    // B.4: wall items only on solid wall, never over a door or window; paired items line up with their partner
    if (def.cls === "wall" && type !== "curtains" && ctx.structureBuilt) {
      const partner = pairPartner(ctx, room, type, against, u, alongGiven);
      if (partner) {
        against = partner.side;
        u = partner.u;
        rot = ROT[against];
        wallInfo = faceOf(against);
      }
      // a TV hangs over its unit's wall only (never across the room from it); in a bedroom, on the wall the bed faces
      const bedTv = type === "tv" && !partner && ["master_bedroom", "bedroom", "guest_bedroom"].includes(room.type) ? ctx.items.find((it) => it.room === room.id && it.type.startsWith("bed_") && it.against) : undefined;
      if (bedTv) {
        against = OPP[bedTv.against as Side];
        rot = ROT[against];
        wallInfo = faceOf(against);
        u = against === "front" || against === "back" ? (bedTv.x0 + bedTv.x1) / 2 : (bedTv.y0 + bedTv.y1) / 2;
      }
      const spot = placeOnWall(ctx, room, type, against, u, w, type === "tv" && (!!partner || !!bedTv));
      if (!spot) return type === "tv" ? { group } : dropped("no wall in the room has a clear stretch for it (it may not hang over a door or window)");
      if (spot.side !== against) {
        against = spot.side;
        rot = ROT[against];
        wallInfo = faceOf(against);
      }
      u = spot.u;
    }
    [cx, cy] = poseOn(against, u);
  } else {
    const at = Array.isArray(o?.at) ? o.at : null;
    const lx = at ? num(at[0], room.rect.w / 2) : room.rect.w / 2;
    const ly = at ? num(at[1], room.rect.d / 2) : room.rect.d / 2;
    cx = room.rect.x + lx;
    cy = room.rect.y + ly;
    rot = num(o?.rot_deg, 0, -720, 720);
    if (type === "prayer_mat" && o?.rot_deg === undefined) rot = qiblaRot(ctx);
  }

  // clamp inside the room
  let fp = footprint(cx, cy, w, d, rot);
  const clampFp = () => {
    const hw = (fp.x1 - fp.x0) / 2, hh = (fp.y1 - fp.y0) / 2;
    if (def.cls === "ceiling") return;
    cx = bounds.x1 - bounds.x0 > 2 * hw ? clamp(cx, bounds.x0 + hw, bounds.x1 - hw) : (bounds.x0 + bounds.x1) / 2;
    cy = bounds.y1 - bounds.y0 > 2 * hh ? clamp(cy, bounds.y0 + hh, bounds.y1 - hh) : (bounds.y0 + bounds.y1) / 2;
    fp = footprint(cx, cy, w, d, rot);
  };
  if (!isVehicle) clampFp();

  // EN-02/EN-08: a "top" item (lamp, hob, sink, microwave, small plant) stands ON a nightstand, counter or table: when
  // nothing supports it where it was asked for, it moves onto the nearest suitable surface in the room; with none,
  // it stands on the floor as its own little cabinet and keeps out of doorways like any floor item
  let topSupported = false;
  if (def.cls === "top" && ctx.structureBuilt) {
    const kinds = TOP_SUPPORTS[type];
    const ok = (it: PlacedItem) => it.room === room.id && it.topH !== null && it.cls === "floor" && (!kinds || kinds.some((k) => it.type.startsWith(k)));
    const inside = (it: PlacedItem) => cx > it.x0 && cx < it.x1 && cy > it.y0 && cy < it.y1;
    const sameOn = (sup: PlacedItem) => ctx.items.some((q) => q.cls === "top" && q.type === type && q.room === room.id && (q.x0 + q.x1) / 2 > sup.x0 && (q.x0 + q.x1) / 2 < sup.x1 && (q.y0 + q.y1) / 2 > sup.y0 && (q.y0 + q.y1) / 2 < sup.y1);
    const under = ctx.items.find((it) => ok(it) && inside(it) && !(type === "table_lamp" && sameOn(it)));
    if (under) topSupported = true;
    else {
      const holds = (s: PlacedItem) => ctx.items.some((q) => q.cls === "top" && q.type === type && q.room === room.id && (q.x0 + q.x1) / 2 > s.x0 && (q.x0 + q.x1) / 2 < s.x1 && (q.y0 + q.y1) / 2 > s.y0 && (q.y0 + q.y1) / 2 < s.y1);
      const dist = (s: PlacedItem) => Math.hypot(Math.max(s.x0 - cx, 0, cx - s.x1), Math.max(s.y0 - cy, 0, cy - s.y1)) + (holds(s) ? 20 : 0);
      const sups = ctx.items.filter((it) => ok(it) && !holds(it)).sort((a, b) => dist(a) - dist(b));
      for (const s of sups) {
        const r2 = s.rot ?? rot;
        const f0 = footprint(0, 0, w, d, r2);
        const hx = (f0.x1 - f0.x0) / 2, hy = (f0.y1 - f0.y0) / 2;
        const lx0 = s.x0 + Math.min(hx, (s.x1 - s.x0) / 2), lx1 = s.x1 - Math.min(hx, (s.x1 - s.x0) / 2);
        const ly0 = s.y0 + Math.min(hy, (s.y1 - s.y0) / 2), ly1 = s.y1 - Math.min(hy, (s.y1 - s.y0) / 2);
        const px = clamp(cx, lx0, lx1), py = clamp(cy, ly0, ly1);
        // slide along the surface's long side, clear of the other things already standing on it
        const tops = ctx.items.filter((q) => q.cls === "top" && q.room === room.id && (q.x0 + q.x1) / 2 > s.x0 && (q.x0 + q.x1) / 2 < s.x1 && (q.y0 + q.y1) / 2 > s.y0 && (q.y0 + q.y1) / 2 < s.y1);
        const alongXs = s.x1 - s.x0 >= s.y1 - s.y0;
        let spot: [number, number] | null = null;
        for (let k = 0; k <= 80 && !spot; k++) {
          const off = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.25;
          const qx = alongXs ? px + off : px, qy = alongXs ? py : py + off;
          if (qx < lx0 - 1e-6 || qx > lx1 + 1e-6 || qy < ly0 - 1e-6 || qy > ly1 + 1e-6) continue;
          const f = footprint(qx, qy, w, d, r2);
          if (!tops.some((q) => overlaps(f, q, 0.05))) spot = [qx, qy];
        }
        if (!spot) continue;
        [cx, cy] = spot;
        rot = r2;
        if (s.against) {
          against = s.against as Side;
          wallInfo = faceOf(against);
        }
        fp = footprint(cx, cy, w, d, rot);
        topSupported = true;
        break;
      }
    }
  }

  // B.4/B.6: floor items never in a keep-out zone, on the walkway or in a parking bay. Search: the requested wall
  // (full clearances, then the core clearances that still keep every door leaf, doorway and stair free), the other
  // walls, a narrower size, and for essential fixtures a spot that may touch other furniture; else leave it out.
  // a table lamp with no free nightstand, console or desk is not stood on the floor: it is simply not placed
  if (type === "table_lamp" && ctx.structureBuilt && !topSupported) {
    warn(`furnish table_lamp in ${room.id}: nothing free to stand on; left out`);
    return { group };
  }
  if ((def.cls === "floor" || (def.cls === "top" && !topSupported && ctx.structureBuilt)) && !isVehicle) {
    const otherItems = ctx.items.filter((it) => it.room === room.id && it.cls === "floor" && (def.cls === "top" || !companions(type, it.type)));
    const others = otherItems.map((it) => ({ x0: it.x0, x1: it.x1, y0: it.y0, y1: it.y1 }));
    // what a fixture the room cannot do without may push aside (a plant, a chair, a dispenser), never a bed or counter
    const hard = otherItems.filter((it) => !SOFT.has(it.type)).map((it) => ({ x0: it.x0, x1: it.x1, y0: it.y0, y1: it.y1 }));
    const bays = park ? park.bays.map((b) => ({ x0: b.rect.x, x1: b.rect.x + b.rect.w, y0: b.rect.y, y1: b.rect.y + b.rect.d })) : [];
    const inBounds = (f: Rect4) => !(f.x0 < bounds.x0 - 0.01 || f.x1 > bounds.x1 + 0.01 || f.y0 < bounds.y0 - 0.01 || f.y1 > bounds.y1 + 0.01);
    /** tier 0: full zones; 1: core zones; 2: core zones, a tall piece may stand in front of a window; 3: as 2, and
     *  plants, chairs and the like give way. A door's core (its width × 3 ft and the leaf's sweep), the stair and
     *  its landings are never given up (EN-02), and furniture never stands inside other furniture. */
    const blockers = (tier: number) => (tier >= 3 ? hard : others);
    const free = (f: Rect4, tier = 0) =>
      inBounds(f) &&
      !zones.some((z) => !(tier >= 2 && z.kind === "window" && mayBlock(z)) && overlaps(f, tier === 0 ? z : z.core ?? z, 0.04)) &&
      !blockers(tier).some((ob) => overlaps(f, ob, 0.08)) &&
      !bays.some((b) => overlaps(f, b, 0.02)) &&
      !(park && onWalkwayRect(park, f));
    /** EN3-01: would a bed at this spot run one of its long sides along a window (within 1 ft of that wall, over 1 ft of
     *  the window)? */
    const sideAlongWindow = (f: { x: number; y: number; rot: number; w: number }): boolean => {
      const b = footprint(f.x, f.y, f.w, d, f.rot);
      const lenAlongY = b.y1 - b.y0 >= b.x1 - b.x0;
      const sides: [Side, number, [number, number]][] = lenAlongY
        ? [["left", b.x0 - bounds.x0, [b.y0, b.y1]], ["right", bounds.x1 - b.x1, [b.y0, b.y1]]]
        : [["front", b.y0 - bounds.y0, [b.x0, b.x1]], ["back", bounds.y1 - b.y1, [b.x0, b.x1]]];
      return sides.some(([s, gap, [a, c]]) => gap < 1 && ctx.model.roomWalls(room, s).some((wl) => wl.run.openings.some((op) => !op.isDoor && op.op.type !== "ventilator" && Math.min(c, op.u1) - Math.max(a, op.u0) > 1)));
    };
    // EN-08: a nightstand stands beside the bed, one on each side (never both on one side, never across the room)
    let flanked = false;
    if (type === "side_table") {
      const bed = ctx.items.filter((it) => it.room === room.id && it.type.startsWith("bed_") && it.against).sort((a, b) => Math.hypot((a.x0 + a.x1) / 2 - cx, (a.y0 + a.y1) / 2 - cy) - Math.hypot((b.x0 + b.x1) / 2 - cx, (b.y0 + b.y1) / 2 - cy))[0];
      if (bed) {
        const side = bed.against as Side;
        const ax = side === "front" || side === "back";
        const [ba, bb] = ax ? [bed.x0, bed.x1] : [bed.y0, bed.y1];
        const half = w / 2;
        const mid = (it: PlacedItem) => (ax ? (it.x0 + it.x1) / 2 : (it.y0 + it.y1) / 2);
        const taken = (u: number) => ctx.items.some((q) => q.room === room.id && q.type === "side_table" && q.against === side && Math.abs(mid(q) - u) < half + 0.4);
        const uReq = ax ? cx : cy;
        const flanks = [-1, 1].filter((k) => !taken(k < 0 ? ba - 0.1 - half : bb + 0.1 + half)).sort((p, q) => Math.abs((p < 0 ? ba : bb) - uReq) - Math.abs((q < 0 ? ba : bb) - uReq));
        const w0 = w;
        for (const k of flanks) {
          // the stand's own width, else a slim 1.3 ft one
          for (const ww of w0 > 1.3 ? [w0, 1.3] : [w0]) {
            const u = k < 0 ? ba - 0.1 - ww / 2 : bb + 0.1 + ww / 2;
            const save = { against, rot, wallInfo };
            against = side;
            rot = ROT[side];
            wallInfo = faceOf(side);
            w = ww;
            const [px, py] = poseOn(side, u);
            const f = footprint(px, py, w, d, rot);
            if (free(f, 1)) {
              cx = px;
              cy = py;
              fp = f;
              flanked = true;
              break;
            }
            w = w0;
            ({ against, rot, wallInfo } = save);
          }
          if (flanked) break;
        }
        if (!flanked) return dropped("there is no free side of the bed for it");
      }
    }
    // a bedroom's TV unit belongs on the wall the bed faces, or nowhere (EN-08)
    const bedFaces = type === "tv_unit" && ["master_bedroom", "bedroom", "guest_bedroom"].includes(room.type) && ctx.items.some((it) => it.room === room.id && it.type.startsWith("bed_") && it.against);
    if (bedFaces) {
      const bed = ctx.items.find((it) => it.room === room.id && it.type.startsWith("bed_") && it.against)!;
      const face = OPP[bed.against as Side];
      if (against !== face) {
        against = face;
        rot = ROT[face];
        wallInfo = faceOf(face);
        const bu = face === "front" || face === "back" ? (bed.x0 + bed.x1) / 2 : (bed.y0 + bed.y1) / 2;
        [cx, cy] = poseOn(face, bu);
        fp = footprint(cx, cy, w, d, rot);
      }
    }
    // EN-F5: a TV unit stands against a real wall (its TV hangs on it): asked against an open-plan side, it looks for
    // a wall like any piece that is in the way
    const needsWall = type === "tv_unit" && !!against && ctx.structureBuilt;
    const wallBehind = (side: Side, u: number, ww: number) =>
      ctx.model.roomWalls(room, side).some((wl) => u - ww / 2 >= wl.a - 0.3 && u + ww / 2 <= wl.b + 0.3);
    const unbacked = needsWall && !wallBehind(against!, wallInfo ? (wallInfo.axis === "x" ? cx : cy) : 0, w);
    if (!flanked && (!free(fp) || unbacked)) {
      const start = { side: against, rot, w, cx, cy };
      let found: { x: number; y: number; side: Side | null; rot: number; w: number } | null = null;
      let keptWindow = false;
      // an item that stands against a wall only moves to stretches where a wall really stands behind it
      const backed = (side: Side, u: number, ww: number) => {
        const ws = ctx.model.roomWalls(room, side).map((wl) => [wl.a, wl.b] as [number, number]).sort((p, q) => p[0] - q[0]);
        if (!ws.length) return side === start.side && !needsWall;
        const merged: [number, number][] = [];
        for (const sp of ws) {
          const last = merged[merged.length - 1];
          if (last && sp[0] <= last[1] + 0.06) last[1] = Math.max(last[1], sp[1]);
          else merged.push([sp[0], sp[1]]);
        }
        return merged.some(([a, b]) => u - ww / 2 >= a - 0.3 && u + ww / 2 <= b + 0.3);
      };
      // obstacles as intervals along a wall, to try the exact spots between them (a 0.25 ft scan misses tight gaps)
      const edgesAlong = (side: Side, tier: number): number[] => {
        const ax = side === "front" || side === "back";
        const out: number[] = [];
        for (const z of zones) {
          const q = tier === 0 ? z : z.core ?? z;
          out.push(ax ? q.x0 : q.y0, ax ? q.x1 : q.y1);
        }
        for (const o of blockers(tier)) out.push(ax ? o.x0 : o.y0, ax ? o.x1 : o.y1);
        for (const wl of ctx.model.roomWalls(room, side)) out.push(wl.a, wl.b);
        return out;
      };
      const tryWall = (side: Side, uPref: number, wTry: number, tier: number): boolean => {
        const f0 = faceOf(side);
        const r2 = ROT[side];
        const save = w;
        w = wTry;
        const t = r2 * DEG;
        const hw = (side === "front" || side === "back" ? Math.abs(Math.cos(t)) * w + Math.abs(Math.sin(t)) * d : Math.abs(Math.sin(t)) * w + Math.abs(Math.cos(t)) * d) / 2;
        const us = [uPref, f0.lo + hw, f0.hi - hw];
        for (const e of edgesAlong(side, tier)) us.push(e - hw - 0.05, e + hw + 0.05);
        for (let u = f0.lo + hw; u <= f0.hi - hw + 1e-6; u += 0.5) us.push(u);
        us.sort((a, b) => Math.abs(a - uPref) - Math.abs(b - uPref));
        for (const u of us) {
          if (u < f0.lo + hw - 0.01 || u > f0.hi - hw + 0.01) continue;
          if (!backed(side, u, w)) continue;
          const [px, py] = poseOn(side, u);
          const f = footprint(px, py, w, d, r2);
          if (free(f, tier)) {
            found = { x: px, y: py, side, rot: r2, w };
            return true;
          }
        }
        w = save;
        return false;
      };
      /** nearest free spot within 5 ft: candidates touch the room bounds or an obstacle's edge, plus a 0.5 ft grid */
      const trySpiral = (tier: number): boolean => {
        const f = footprint(cx, cy, w, d, rot);
        const hx = (f.x1 - f.x0) / 2, hy = (f.y1 - f.y0) / 2;
        const xs = [cx, bounds.x0 + hx, bounds.x1 - hx], ys = [cy, bounds.y0 + hy, bounds.y1 - hy];
        for (const z of zones) {
          const q = tier === 0 ? z : z.core ?? z;
          xs.push(q.x0 - hx - 0.05, q.x1 + hx + 0.05);
          ys.push(q.y0 - hy - 0.05, q.y1 + hy + 0.05);
        }
        for (const o of blockers(tier)) {
          xs.push(o.x0 - hx - 0.1, o.x1 + hx + 0.1);
          ys.push(o.y0 - hy - 0.1, o.y1 + hy + 0.1);
        }
        for (let k = -18; k <= 18; k++) {
          xs.push(cx + k * 0.5);
          ys.push(cy + k * 0.5);
        }
        let best: { x: number; y: number; dd: number } | null = null;
        for (const x of xs)
          for (const y of ys) {
            const dd = Math.hypot(x - cx, y - cy);
            if (dd > (tier === 0 ? 5 : 9) || (best && dd >= best.dd)) continue;
            if (free(footprint(x, y, w, d, rot), tier)) best = { x, y, dd };
          }
        if (!best) return false;
        found = { x: best.x, y: best.y, side: null, rot, w };
        return true;
      };
      /** the widest clear stretch of any wall, for items that can be made shorter (counters, wardrobes) */
      const fitSpan = (tier: number): boolean => {
        const spans: { side: Side; u: number; len: number }[] = [];
        for (const s of bedFaces ? [start.side!] : [start.side!, OPP[start.side!], ...ADJ[start.side!]]) {
          if (!ctx.model.roomWalls(room, s).length) continue;
          const f0 = faceOf(s);
          let run0: number | null = null;
          const probe = 0.6;
          for (let u = f0.lo; u <= f0.hi + 1e-6; u += 0.25) {
            const [px, py] = poseOn(s, u);
            const ok = free(footprint(px, py, probe, d, ROT[s]), tier);
            if (ok && run0 === null) run0 = u;
            if ((!ok || u + 0.25 > f0.hi + 1e-6) && run0 !== null) {
              const end = ok ? u : u - 0.25;
              const len = end - run0 + probe;
              spans.push({ side: s, u: (run0 + end) / 2, len });
              run0 = null;
            }
          }
        }
        spans.sort((a, b) => b.len - a.len);
        // (EN3-01: a bed or a sofa is never squeezed past 85 % of its width: a 3.6 ft "queen" is a single bed, which the
        // smaller-version step builds properly)
        const minW = FIRM_WIDTH.has(type) ? start.w * 0.85 : Math.max(3, start.w * 0.5);
        for (const b of spans) {
          if (b.len - 0.2 < minW - 1e-6) break;
          if (tryWall(b.side, b.u, Math.min(start.w, b.len - 0.2), tier)) return true;
        }
        return false;
      };
      if (start.side) {
        const s0 = start.side;
        const uNow = wallInfo!.axis === "x" ? cx : cy;
        const proj = (side: Side) => (side === "front" || side === "back" ? cx : cy);
        const rest: Side[] = bedFaces ? [] : [OPP[s0], ...ADJ[s0]];
        const all = [s0, ...rest];
        const at = (s: Side) => (s === s0 ? uNow : proj(s));
        const clear =
          tryWall(s0, uNow, w, 0) ||
          tryWall(s0, uNow, w, 1) ||
          // a TV unit stays on the wall the seating faces: a shorter unit there before another wall
          (type === "tv_unit" && [0.9, 0.8, 0.7, 0.6].some((k) => start.w * k >= 3 && (tryWall(s0, uNow, start.w * k, 0) || tryWall(s0, uNow, start.w * k, 1)))) ||
          rest.some((s) => tryWall(s, proj(s), start.w, 0)) ||
          rest.some((s) => tryWall(s, proj(s), start.w, 1)) ||
          // EN2-02: every narrower size (a wardrobe down to 60 %) on every wall before anything stands across a window
          (SHRINK.has(type) && (type === "wardrobe" ? [0.95, 0.9, 0.85, 0.75, 0.6] : [0.95, 0.9, 0.85]).some((k) => all.some((s) => tryWall(s, at(s), start.w * k, 1)))) ||
          (SHRINK.has(type) && fitSpan(1));
        const opt = o as { _smaller?: number; _clear?: boolean };
        // (a smaller bed tried for a larger one, below, goes no further than a clear spot)
        if (!clear && opt._clear) return { group };
        const ok =
          clear ||
          (ESSENTIAL.has(type) && all.some((s) => tryWall(s, at(s), start.w, 2))) ||
          (ESSENTIAL.has(type) && SHRINK.has(type) && ([0.95, 0.9, 0.85].some((k) => all.some((s) => tryWall(s, at(s), start.w * k, 2))) || fitSpan(2))) ||
          (ESSENTIAL.has(type) && all.some((s) => tryWall(s, at(s), start.w, 3))) ||
          (ESSENTIAL.has(type) && SHRINK.has(type) && ([0.95, 0.9, 0.85].some((k) => all.some((s) => tryWall(s, at(s), start.w * k, 3))) || fitSpan(3)));
        void ok;
        // EN3-01: a bed whose only spot runs its long side along a window (a queen pushed against the window wall, the
        // window behind it out of reach) is a smaller bed clear of the window when one fits there: a single bed beside
        // the window, not a queen across it. (A headboard under a window is fine: the window is reached beside it.)
        if (!clear && found && type.startsWith("bed_") && SMALLER[type] && (!opt._smaller || opt._clear) && ctx.structureBuilt && sideAlongWindow(found as { x: number; y: number; rot: number; w: number })) {
          const sm = SMALLER[type]!;
          const r = furnishInner(ctx, sm.type, { ...o, size: undefined, _smaller: 1, _clear: true } as FurnishOptions, style);
          if (r.item) {
            warn(`furnish ${type} in ${room.id}: its only spot runs along the window; a ${humanType(sm.type)} stands clear of it instead`);
            return r;
          }
        }
        // (was it a window that kept it out? a spot would exist if any window could be blocked)
        if (!found && spare !== "all" && zones.some((z) => z.kind === "window")) {
          const w0 = w;
          anyWindow = true;
          keptWindow = all.some((s) => tryWall(s, at(s), start.w, 2)) || (SHRINK.has(type) && fitSpan(2));
          anyWindow = false;
          found = null;
          w = w0;
        }
      } else {
        // free-standing: near the asked spot, then turned a quarter (both orientations)
        const tiers = ESSENTIAL.has(type) ? [0, 1, 2, 3] : [0, 1];
        if (!tiers.some((t) => trySpiral(t))) {
          const r0 = rot;
          rot = r0 + 90;
          if (!tiers.some((t) => trySpiral(t))) rot = r0;
        }
        if (!found && spare !== "all" && zones.some((z) => z.kind === "window")) {
          anyWindow = true;
          keptWindow = trySpiral(2);
          anyWindow = false;
          found = null;
        }
      }
      if (!found) {
        // a smaller version of a fixture the room is defined by (a queen for a king, a slim fridge), before leaving it out
        // (EN2-03: a shower that has no room for a 2.6 ft tray becomes a wet-area shower: head and mixer on the wall,
        // a drain in the floor)
        const lvl = Number((o as { _smaller?: number })._smaller ?? 0);
        // (EN3-01: a single bed that is still too long becomes a compact 3.3 × 6.25 ft single, never no bed at all)
        const short = type === "bed_single" && lvl <= 2 && d > SHORT_SINGLE.size.d_ft + 0.05 ? SHORT_SINGLE : undefined;
        const smaller = lvl === 0 ? SMALLER[type] ?? short : type === "shower" && lvl === 1 && !variant.includes("wet") ? WET_SHOWER : short;
        if (smaller) {
          group.removeFromParent();
          // (a different piece, a single bed for a queen, takes its own size, not the one asked for the larger piece;
          // a bed keeps the shorter length it was asked with)
          const askedLen = num((o?.size as { d_ft?: number } | undefined)?.d_ft, NaN);
          const sz = smaller.size ? { ...(o?.size ?? {}), ...smaller.size } : smaller.type !== type ? (type.startsWith("bed_") && askedLen < ITEMS[smaller.type].dims[1] ? { d_ft: askedLen } : undefined) : o?.size;
          return furnishInner(ctx, smaller.type, { ...o, size: sz, ...(smaller.variant ? { variant: smaller.variant } : {}), _smaller: lvl + 1 } as FurnishOptions, style);
        }
        // EN-F5: a wardrobe or a bookshelf whose only spot stands across the window it must keep clear is built low, under
        // the sill (a chest-height unit), before it is left out
        const lowOpt = o as { _low?: boolean };
        if (keptWindow && !lowOpt._low && (type === "wardrobe" || type === "bookshelf")) {
          const sill = Math.min(...keepOut(ctx, room).filter((z) => z.kind === "window" && z.op !== "ventilator").map((z) => z.sill ?? 3));
          // (its top just under the sill: nothing of the glass is covered)
          const lowH = Math.min(h - 0.5, sill - 0.1);
          if (Number.isFinite(lowH) && lowH >= 2.4) {
            group.removeFromParent();
            warn(`furnish ${type} in ${room.id}: its only spot stands across the window; built ${lowH.toFixed(1)} ft tall, under the sill`);
            return furnishInner(ctx, type, { ...o, size: { ...(o?.size ?? {}), h_ft: lowH }, _low: true } as FurnishOptions, style);
          }
        }
        return dropped(keptWindow ? "its only spot would stand across a window" : "there is no place for it that keeps doors, stairs and walkways clear", keptWindow);
      }
      const fnd = found as { x: number; y: number; side: Side | null; rot: number; w: number };
      cx = fnd.x;
      cy = fnd.y;
      w = fnd.w;
      if (fnd.side && fnd.side !== start.side) {
        against = fnd.side;
        rot = fnd.rot;
        wallInfo = faceOf(fnd.side);
      }
      fp = footprint(cx, cy, w, d, rot);
      // anything soft it now stands on gives way (EN-03: a fridge before a water dispenser)
      for (const it of otherItems) if (SOFT.has(it.type) && overlaps(fp, it, 0.08)) evict(ctx, it, type);
    }
    // EN-08: a double or king bed against a wall keeps room for a nightstand on each side: when a door zone or a
    // piece takes one side, the bed slides along its wall (up to 3 ft) to where both sides are free
    if ((type === "bed_king" || type === "bed_queen") && against && ctx.structureBuilt && !(o as { _exact?: boolean })?._exact) {
      const side = against;
      const ax = side === "front" || side === "back";
      const nsW = 1.3, nsD = ITEMS.side_table.dims[1]; // the slimmest nightstand the flank may take
      const sideOk = (bx0: number, bx1: number) =>
        [bx0 - 0.1 - nsW / 2, bx1 + 0.1 + nsW / 2].every((u) => {
          const f = faceOf(side);
          const across = f.inner + f.into * (nsD / 2 + 0.02);
          const nf = ax ? footprint(u, across, nsW, nsD, 0) : footprint(across, u, nsD, nsW, 0);
          return free(nf, 1);
        });
      const [a0, a1] = ax ? [fp.x0, fp.x1] : [fp.y0, fp.y1];
      if (!sideOk(a0, a1)) {
        for (let k = 1; k <= 12; k++) {
          const off = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.25;
          const nx = ax ? cx + off : cx, ny = ax ? cy : cy + off;
          const nfp = footprint(nx, ny, w, d, rot);
          if (!free(nfp, 1)) continue;
          if (!sideOk(a0 + off, a1 + off)) continue;
          cx = nx;
          cy = ny;
          fp = nfp;
          break;
        }
      }
    }
  }
  if (def.cls === "wall" && type === "tv" && ctx.structureBuilt) {
    // a TV placed before its unit: line it up at the end of the section
    const tvUnitLater = !ctx.items.some((it) => it.room === room.id && it.type === "tv_unit");
    if (tvUnitLater) deferTvPairing(ctx, room, group, () => item);
  }

  // vertical placement
  let base = room.floorH;
  const extra: ItemBuild["extra"] = { room: room.id };
  const ceilingAtPoint = () => {
    const fc = ctx.falseCeil.get(room.id);
    const cove = (ctx as unknown as { coveInner?: Map<string, number[]> }).coveInner?.get(room.id);
    if (fc !== undefined && cove) {
      const [ix0, ix1, iy0, iy1] = cove;
      const inside = cx > ix0 && cx < ix1 && cy > iy0 && cy < iy1;
      return inside ? room.ceilH : fc;
    }
    return fc ?? room.ceilH;
  };
  if (def.cls === "ceiling") {
    // pendants, chandeliers and fans never hang in a stairwell
    [cx, cy] = ceilingSpot(ctx, room, cx, cy);
    fp = footprint(cx, cy, w, d, rot);
    extra.ceiling = (ceilingAtPoint() - room.floorH) * FT;
  } else if (def.cls === "wall") {
    let mount = def.mount ?? 4;
    if (num(size.h_ft, NaN) && type === "curtains") mount = 0;
    const below = ctx.items.filter((it) => it.room === room.id && it.cls === "floor" && it.against === against && overlaps(it, { x0: fp.x0 - 0.2, x1: fp.x1 + 0.2, y0: fp.y0 - 3, y1: fp.y1 + 3 }, 0));
    const topBelow = below.length ? Math.max(...below.map((it) => it.h1)) - room.floorH : 0;
    if (type === "tv") mount = topBelow > 0 ? topBelow + 0.9 : 3.3;
    else if (type === "painting") mount = topBelow > 0 ? Math.max(topBelow + 0.8, 3.6) : Math.max(3.2, 5 - h / 2);
    else if (type === "mirror_wall") mount = topBelow > 0 ? topBelow + 0.6 : Math.max(2.8, 5.2 - h / 2);
    else if (type === "ac_split") mount = Math.min(def.mount ?? 6.9, ceilingAtPoint() - room.floorH - 1.25);
    else if (type === "curtains") mount = 0;
    base = room.floorH + mount;
    if (type === "curtains") extra.ceiling = (ceilingAtPoint() - room.floorH) * FT;
  } else if (def.cls === "top") {
    const sup = ctx.items.filter((it) => it.room === room.id && it.topH !== null && cx > it.x0 && cx < it.x1 && cy > it.y0 && cy < it.y1).sort((a, b) => (b.topH ?? 0) - (a.topH ?? 0))[0];
    if (sup) {
      base = sup.topH!;
      extra.support = (sup.topH! - room.floorH) * FT;
    }
  }
  if (type === "kitchen_counter" && wallInfo) {
    // openings on the wall behind, in item-local x (m)
    const walls = ctx.model.roomWalls(room, against!);
    // item-local +x along the wall's plan axis (world z = -y, built geometry mirrored in local z)
    const sgn = against === "front" || against === "right" ? 1 : -1;
    const centerU = wallInfo.axis === "x" ? cx : cy;
    extra.wallOpenings = walls.flatMap((wl) =>
      wl.run.openings
        .filter((op) => !op.isDoor)
        .map((op) => {
          const a = (op.u0 - centerU) * sgn * FT, b = (op.u1 - centerU) * sgn * FT;
          return { x0: Math.min(a, b), x1: Math.max(a, b), sill: (op.bottom - room.floorH) * FT, top: (op.top - room.floorH) * FT };
        }),
    );
    extra.ceiling = (ceilingAtPoint() - room.floorH) * FT;
  }

  // materials
  const dflt = defaultsFor(ctx, type, style);
  const fabricHex = typeof o?.color === "string" ? colorHex(o.color, dflt.fabric) : dflt.fabric;
  const main = o?.material ? ctx.mats.get(o.material, "wood_walnut") : defaultMain(ctx, type);
  const mats = makeMats(ctx.mats, { main, fabricHex, accentHex: dflt.accent, accent2Hex: dflt.accent2, style });
  if (type === "car_sedan" || type === "car_suv") mats.main = typeof o?.color === "string" ? ctx.mats.get({ preset: "lacquer", color: o.color, metalness: 0.45, roughness: 0.3 }) : main;
  if (type === "curtains" || type === "towel_rail") mats.accent2 = ctx.mats.get({ preset: "linen", color: fabricHex });
  if (type === "rug" || type === "prayer_mat") mats.fabric = ctx.mats.get({ preset: "fabric", color: fabricHex });

  const seed = hashStr(`${room.id}|${type}|${ctx.items.length}`);
  const kit = new Kit();
  const b: ItemBuild = { k: kit, w: w * FT, d: d * FT, h: h * FT, m: mats, variant, rnd: rng(seed), style, colorHex: fabricHex, extra };

  // deferred builds (need to know what else the section places)
  const deferred = type === "kitchen_counter" || type.startsWith("dining_table");
  const doBuild = () => {
    try {
      def.build(b);
    } catch (e) {
      warn(`furnish ${type} failed: ${(e as Error).message}`);
    }
    kit.build(group);
    group.traverse((x) => {
      const mesh = x as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.userData.collide = !!def.collide;
        if (def.collide) ctx.collider(mesh);
      }
    });
  };
  // world: z = -y; built geometry faces local -z, so a plan CCW rotation θ is rotation.y = +θ
  group.position.set(cx * FT, base * FT, -cy * FT);
  group.rotation.y = rot * DEG;
  if (type === "prayer_mat") group.rotation.y += Math.PI;
  const label = `${room.name} ${type.replace(/_/g, " ")}`;
  const topH = topHeight(type, base, h, b);
  const item: PlacedItem = {
    id: ctx.uid(`${room.id}_${type}`), type, room: room.id, x0: fp.x0, x1: fp.x1, y0: fp.y0, y1: fp.y1,
    h0: base, h1: base + (def.cls === "ceiling" ? 0 : h), cls: def.cls, topH, group, against: against ?? undefined, w, d, rot, variant,
    opts: { ...(o ?? {}) } as Record<string, unknown>, style,
  };
  ctx.items.push(item);
  const vehicle = isVehicle || type === "motorbike";
  ctx.add(group, { kind: vehicle ? "vehicle" : `furniture:${type}`, room: room.id, level: room.level, id: item.id, label: vehicle ? (type === "car_suv" ? "SUV" : type === "motorbike" ? "Motorbike" : "Car") : label });
  if (vehicle) group.userData.mergeGroup = "vehicle";

  if (deferred) {
    ctx.endOfSection.push(() => {
      if (type === "kitchen_counter") {
        b.extra.noHob = ctx.items.some((it) => it.room === room.id && (it.type === "hob" || it.type === "oven"));
        b.extra.noSink = ctx.items.some((it) => it.room === room.id && it.type === "sink_kitchen");
      }
      doBuild();
      if (type.startsWith("dining_table") && !variant.includes("no chair") && !variant.includes("table only")) {
        const explicit = ctx.items.some((it) => it.room === room.id && it.type === "dining_chair" && Math.abs((it.x0 + it.x1) / 2 - cx) < w / 2 + 3 && Math.abs((it.y0 + it.y1) / 2 - cy) < w / 2 + 3);
        if (!explicit) {
          const seats = type === "dining_table_8" ? 8 : type === "dining_table_6" ? 6 : 4;
          const ck = new Kit();
          chairsForTable(ck, { ...b, k: ck, m: { ...mats, fabric: ctx.mats.get({ preset: "fabric", color: "#d6cdbd" }) } }, seats);
          const cg = ck.build(new THREE.Group());
          cg.name = "auto_chairs";
          group.add(cg);
          cg.traverse((x) => {
            if ((x as THREE.Mesh).isMesh) x.userData.collide = false;
          });
          for (const k of ["layer", "level", "room", "kind", "id", "label", "section"]) cg.traverse((x) => (x.userData[k] ??= group.userData[k]));
        }
      }
      // propagate tags to late-built children
      group.traverse((x) => {
        for (const k of ["layer", "level", "room", "kind", "id", "label", "section"]) if (x.userData[k] === undefined) x.userData[k] = group.userData[k];
      });
    });
  } else {
    doBuild();
    group.traverse((x) => {
      for (const k of ["layer", "level", "room", "kind", "id", "label", "section"]) if (x.userData[k] === undefined) x.userData[k] = group.userData[k];
    });
  }

  if (type === "ac_split" && wallInfo && against) addOutdoorUnit(ctx, room, against, cx, cy, base, mats);
  if (type === "tv_unit" && against && ctx.structureBuilt && entranceWalls(ctx, room).includes(against)) {
    const key = `${room.id}|${ctx.section}`;
    const done = ((ctx as unknown as { mediaMirror?: Set<string> }).mediaMirror ??= new Set<string>());
    if (!done.has(key)) {
      done.add(key);
      const side0 = against;
      ctx.endOfSection.push(() => mirrorMedia(ctx, room, side0));
    }
  }
  return { group, item };
}

/** After the bays were laid out again: put every car already parked into a bay of the new layout (in order). */
function moveParkedCars(ctx: BuildCtx, p: Parking): void {
  const cars = ctx.items.filter((it) => it.type === "car_sedan" || it.type === "car_suv");
  const free = [...p.bays].sort((a, b) => (a.where === b.where ? 0 : a.where === "porch" ? -1 : 1));
  for (const it of cars) {
    const bay = free.find((b) => !b.used);
    if (!bay) break;
    bay.used = true;
    const cx = bay.rect.x + bay.rect.w / 2, cy = bay.rect.y + bay.rect.d / 2;
    const fp = footprint(cx, cy, it.w ?? 6, it.d ?? 15, bay.rot);
    it.group.position.x = cx * FT;
    it.group.position.z = -cy * FT;
    it.group.rotation.y = bay.rot * DEG;
    Object.assign(it, { x0: fp.x0, x1: fp.x1, y0: fp.y0, y1: fp.y1, rot: bay.rot, room: bay.room });
  }
}

function topHeight(type: FurnitureType, base: number, h: number, b: ItemBuild): number | null {
  const ft = (m: number) => m / FT;
  switch (type) {
    case "side_table": case "dresser": case "console_table": case "sideboard": case "tv_unit": case "coffee_table": case "bookshelf": case "wardrobe": case "outdoor_table":
      return base + h;
    case "study_desk": case "dressing_table": case "dining_table_4": case "dining_table_6": case "dining_table_8":
      return base + ft(0.76);
    case "kitchen_counter": case "kitchen_island": case "vanity":
      return base + ft(type === "vanity" ? 0.86 : 0.9);
    default:
      void b;
      return null;
  }
}

function addOutdoorUnit(ctx: BuildCtx, room: RoomM, side: Side, cx: number, cy: number, base: number, mats: ReturnType<typeof makeMats>): void {
  const walls = ctx.model.roomWalls(room, side);
  const u = side === "front" || side === "back" ? cx : cy;
  const wl = walls.find((x) => u >= x.a - 0.1 && u <= x.b + 0.1);
  if (!wl || wl.run.out === 0) return;
  const run = wl.run;
  if (run.axis === "x" && run.out < 0) return; // keep the street facade clean
  const outer = run.c + (run.out * run.t) / 2;
  // never hang it over a party wall / past the plot's projection envelope (the unit is ~1.1 ft deep)
  const face0: Side = run.axis === "x" ? (run.out < 0 ? "front" : "back") : run.out < 0 ? "left" : "right";
  const env = ctx.model.envelope;
  const reach = outer + run.out * 1.15;
  if (env.party[face0] || (run.axis === "x" ? reach < env.y0 || reach > env.y1 : reach < env.x0 || reach > env.x1)) return;
  // skip if a facade element or an opening sits there
  if (run.openings.some((op) => u > op.u0 - 1.6 && u < op.u1 + 1.6)) return;
  const h = Math.max(room.floorH + 1, base - 1.6);
  const kit = new Kit();
  acOutdoor(kit, mats);
  const g = kit.build();
  const px = run.axis === "x" ? u : outer, py = run.axis === "x" ? outer : u;
  g.position.set(px * FT, h * FT, -py * FT);
  // outward facing
  const face: Side = run.axis === "x" ? (run.out < 0 ? "front" : "back") : run.out < 0 ? "left" : "right";
  const rot = face === "back" ? 0 : face === "front" ? 180 : face === "left" ? 90 : -90;
  g.rotation.y = rot * DEG;
  ctx.add(g, { kind: "furniture:ac_outdoor", room: room.id, level: room.level, label: "AC outdoor unit" });
  g.traverse((x) => (x.userData.collide = false));
}

/** rot_deg so that a prayer mat faces the qibla (~263° from Lahore). */
export function qiblaRot(ctx: BuildCtx): number {
  const FACING: Record<string, number> = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };
  const bF = FACING[ctx.plan.plan.site?.facing ?? "N"] ?? 0;
  const th = (263 - bF) * DEG;
  const dx = -Math.sin(th), dy = -Math.cos(th);
  return Math.atan2(-dx, dy) / DEG;
}
