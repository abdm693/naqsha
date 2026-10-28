/** Interior toolkit: accent walls, false ceilings with cove light, recessed downlights. */
import * as THREE from "three";
import type { MaterialSpec, Side } from "@contracts/house-sdk";
import type { BuildCtx } from "./core/ctx";
import { CellGrid } from "./core/grid";
import { MeshBuilder } from "./core/meshbuilder";
import { Kit } from "./core/shapes";
import { FT, clamp, colorHex, num, warn } from "./core/util";
import type { RoomM } from "./plan/model";
import { side as normSide } from "./facade";
import { presetOf } from "./structure";

/** Inner extent of a room (plan ft) after subtracting wall half-thicknesses on each side (0 for open sides). */
export function innerRect(ctx: BuildCtx, room: RoomM): { x0: number; x1: number; y0: number; y1: number } {
  const r = room.rect;
  const half = (s: Side) => {
    const ws = ctx.model.roomWalls(room, s);
    if (!ws.length) return 0;
    return Math.max(...ws.map((w) => w.run.t / 2));
  };
  return { x0: r.x + half("left"), x1: r.x + r.w - half("right"), y0: r.y + half("front"), y1: r.y + r.d - half("back") };
}

export function findRoom(ctx: BuildCtx, id: unknown): RoomM | null {
  const s = String(id ?? "");
  const r = ctx.plan.room(s);
  if (r) return r;
  // forgiving lookup: case-insensitive id or name
  const low = s.toLowerCase();
  const alt = ctx.plan.rooms.find((x) => x.id.toLowerCase() === low || x.name.toLowerCase() === low);
  if (alt) return alt;
  warn(`unknown room "${s}"`);
  return null;
}

export function interiorAPI(ctx: BuildCtx) {
  const M = ctx.mats;

  function accent_wall(o: { room: string; side: Side; material: MaterialSpec; from_h_ft?: number; to_h_ft?: number }): void {
    const room = findRoom(ctx, o?.room);
    if (!room) return;
    const s = normSide(o?.side);
    const walls = ctx.model.roomWalls(room, s);
    if (!walls.length) {
      warn(`accent_wall: ${room.id} has no wall on its ${s} side`);
      return;
    }
    const inner = innerRect(ctx, room);
    const ceil = ctx.falseCeil.get(room.id) ?? room.ceilH;
    let f0 = num(o?.from_h_ft, 0), f1 = num(o?.to_h_ft, ceil - room.floorH);
    // accept absolute heights for upper floors
    if (room.floorH > 4 && f0 >= room.floorH - 0.01 && f1 > room.floorH + 2) {
      f0 -= room.floorH;
      f1 -= room.floorH;
    }
    const h0 = room.floorH + clamp(Math.min(f0, f1), 0, 20);
    const h1 = Math.min(ceil, room.floorH + clamp(Math.max(f0, f1), 0.3, 30));
    const preset = presetOf(o?.material) ?? "paint";
    const thick = preset === "paint" || preset.startsWith("plaster") ? 0.02 : preset.includes("wood") ? 0.1 : 0.08;
    const mat = M.get(o?.material, "wood_walnut");
    const axis = s === "front" || s === "back" ? "x" : "y";
    const lo = axis === "x" ? inner.x0 : inner.y0, hi = axis === "x" ? inner.x1 : inner.y1;
    const into = s === "front" || s === "left" ? 1 : -1;
    const kit = new Kit();
    const mb = kit.mb(mat);
    const groove = preset.includes("wood") ? M.basic("#20170f", { roughness: 0.8 }) : null;
    for (const w of walls) {
      const a = Math.max(lo, w.a), b = Math.min(hi, w.b);
      if (b - a < 0.2) continue;
      const g = CellGrid.fromRects<boolean>([
        { rect: { x: a, y: h0, w: b - a, d: h1 - h0 }, val: true },
        ...w.run.openings.map((op) => ({ rect: { x: op.u0 - 0.26, y: op.bottom, w: op.u1 - op.u0 + 0.52, d: op.top + 0.26 - op.bottom }, val: false })),
      ]);
      const p0 = w.inner, p1 = w.inner + into * thick;
      for (const rr of g.rects((v) => v === true)) {
        if (!groove) {
          box(mb, axis, rr.x, rr.x + rr.w, p0, p1, rr.y, rr.y + rr.d);
          continue;
        }
        // fluted panelling: vertical boards ~0.5 ft wide (grain runs up each board) with thin dark reveals
        const n = Math.max(1, Math.floor(rr.w / 0.5));
        for (let k = 0; k < n; k++) box(mb, axis, rr.x + (rr.w * k) / n, rr.x + (rr.w * (k + 1)) / n, p0, p1, rr.y, rr.y + rr.d);
        for (let k = 1; k < n; k++) {
          const u = rr.x + (rr.w * k) / n;
          box(kit.mb(groove, false), axis, u - 0.012, u + 0.012, p1, p1 + into * 0.004, rr.y + 0.02, rr.y + rr.d - 0.02);
        }
      }
    }
    if (kit.empty) return;
    const grp = kit.build();
    ctx.add(grp, { kind: "interior:accent_wall", level: room.level, room: room.id, label: `${room.name} feature wall` });
    grp.traverse((x) => (x.userData.collide = false));
  }

  function false_ceiling(o: { room: string; drop_ft?: number; inset_ft?: number; cove_color?: string; material?: MaterialSpec }): void {
    const room = findRoom(ctx, o?.room);
    if (!room) return;
    if (room.cat !== "enclosed") {
      warn(`false_ceiling: ${room.id} is not an enclosed room`);
      return;
    }
    const inner = innerRect(ctx, room);
    const W = inner.x1 - inner.x0, D = inner.y1 - inner.y0;
    const drop = clamp(num(o?.drop_ft, 1.0), 0.25, Math.max(0.3, room.ceilH - room.floorH - 7.6));
    const inset = clamp(num(o?.inset_ft, 2.0), 0.6, Math.min(W, D) / 2 - 1);
    if (inset <= 0.5 || drop <= 0.2) {
      warn(`false_ceiling: ${room.id} too small or too low`);
      return;
    }
    const top = room.ceilH, bot = room.ceilH - drop;
    const mat = M.get(o?.material, { preset: "paint", color: "#fbfaf7" });
    const kit = new Kit();
    const mb = kit.mb(mat);
    const X0 = inner.x0, X1 = inner.x1, Y0 = inner.y0, Y1 = inner.y1;
    // perimeter bulkhead ring
    bx(mb, X0, X1, Y0, Y0 + inset, bot, top);
    bx(mb, X0, X1, Y1 - inset, Y1, bot, top);
    bx(mb, X0, X0 + inset, Y0 + inset, Y1 - inset, bot, top);
    bx(mb, X1 - inset, X1, Y0 + inset, Y1 - inset, bot, top);
    // cove lip + hidden LED
    const lip = 0.06, lipH = 0.22;
    const ix0 = X0 + inset, ix1 = X1 - inset, iy0 = Y0 + inset, iy1 = Y1 - inset;
    bx(mb, ix0 - 0.02, ix1 + 0.02, iy0 - 0.02, iy0 + lip, bot, bot + lipH);
    bx(mb, ix0 - 0.02, ix1 + 0.02, iy1 - lip, iy1 + 0.02, bot, bot + lipH);
    bx(mb, ix0 - 0.02, ix0 + lip, iy0, iy1, bot, bot + lipH);
    bx(mb, ix1 - lip, ix1 + 0.02, iy0, iy1, bot, bot + lipH);
    const hex = colorHex(o?.cove_color, "#ffd9a8");
    const led = M.emissive(hex, 3);
    const lb = kit.mb(led, false);
    const e = 0.04;
    bx(lb, ix0 + lip, ix1 - lip, iy0 + lip, iy0 + lip + e, bot + lipH - 0.05, bot + lipH);
    bx(lb, ix0 + lip, ix1 - lip, iy1 - lip - e, iy1 - lip, bot + lipH - 0.05, bot + lipH);
    bx(lb, ix0 + lip, ix0 + lip + e, iy0 + lip, iy1 - lip, bot + lipH - 0.05, bot + lipH);
    bx(lb, ix1 - lip - e, ix1 - lip, iy0 + lip, iy1 - lip, bot + lipH - 0.05, bot + lipH);
    const grp = kit.build();
    ctx.add(grp, { kind: "interior:false_ceiling", level: room.level, room: room.id, label: `${room.name} false ceiling` });
    grp.traverse((x) => (x.userData.collide = false));
    // cove glow on the recessed ceiling (fades inward)
    const glow = new MeshBuilder();
    const gw = Math.min(1.6, (ix1 - ix0) / 2, (iy1 - iy0) / 2);
    const y = (top - 0.012) * FT;
    const strips: [number, number, number, number, number][] = [
      // x0, x1, y0, y1, orientation (0: along x, fade +y; 1: along x fade -y; 2: along y fade +x; 3: along y fade -x)
      [ix0, ix1, iy0, iy0 + gw, 0],
      [ix0, ix1, iy1 - gw, iy1, 1],
      [ix0, ix0 + gw, iy0, iy1, 2],
      [ix1 - gw, ix1, iy0, iy1, 3],
    ];
    for (const [a0, a1, b0, b1, ori] of strips) {
      const i = glow.pos.length / 3;
      glow.faceY(y, a0 * FT, a1 * FT, b0 * FT, b1 * FT, -1);
      // faceY(-1) emits (x0,z0),(x1,z0),(x1,z1),(x0,z1): set v = fade (1 at the cove edge)
      const v = ori === 0 ? [1, 1, 0, 0] : ori === 1 ? [0, 0, 1, 1] : ori === 2 ? [1, 0, 0, 1] : [0, 1, 1, 0];
      for (let k = 0; k < 4; k++) {
        glow.uv[(i + k) * 2] = 0.5;
        glow.uv[(i + k) * 2 + 1] = 1 - v[k] * 0.5;
      }
    }
    const gg = glow.build();
    if (gg) {
      const m = new THREE.Mesh(gg, M.glow(hex, "cone_up", 0.55));
      m.renderOrder = 3;
      m.userData.glow = true;
      ctx.add(m, { kind: "light:glow", level: room.level, room: room.id, label: "Cove light" });
      m.userData.collide = false;
    }
    ctx.falseCeil.set(room.id, bot);
    (ctx as unknown as { coveInner: Map<string, number[]> }).coveInner ??= new Map();
    (ctx as unknown as { coveInner: Map<string, number[]> }).coveInner.set(room.id, [ix0, ix1, iy0, iy1, top]);
  }

  function downlights(o: { room: string; rows?: number; cols?: number; color?: string }): void {
    const room = findRoom(ctx, o?.room);
    if (!room) return;
    const inner = innerRect(ctx, room);
    const W = inner.x1 - inner.x0, D = inner.y1 - inner.y0;
    const rows = Math.round(clamp(num(o?.rows, Math.max(1, Math.round(D / 5))), 1, 12));
    const cols = Math.round(clamp(num(o?.cols, Math.max(1, Math.round(W / 5))), 1, 12));
    const hex = colorHex(o?.color, "#fff1d6");
    const kit = new Kit();
    const ring = M.basic("#e9e7e2", { roughness: 0.35, metalness: 0.2 });
    const lamp = M.emissive(hex, 3.2);
    const cove = (ctx as unknown as { coveInner?: Map<string, number[]> }).coveInner?.get(room.id);
    const fc = ctx.falseCeil.get(room.id);
    for (let i = 0; i < cols; i++)
      for (let j = 0; j < rows; j++) {
        let x = inner.x0 + (W * (i + 0.5)) / cols;
        let y = inner.y0 + (D * (j + 0.5)) / rows;
        // in a false ceiling, put the lights in the bulkhead ring (nicer) when they fall near it
        let h = room.ceilH;
        if (cove && fc !== undefined) {
          const [ix0, ix1, iy0, iy1] = cove;
          const inside = x > ix0 && x < ix1 && y > iy0 && y < iy1;
          if (!inside) h = fc;
          else if (cols * rows > 1) {
            // snap to the ring band
            const dx0 = x - ix0, dx1 = ix1 - x, dy0 = y - iy0, dy1 = iy1 - y;
            const m = Math.min(dx0, dx1, dy0, dy1);
            if (m < 2.2) {
              if (m === dx0) x = (inner.x0 + ix0) / 2;
              else if (m === dx1) x = (ix1 + inner.x1) / 2;
              else if (m === dy0) y = (inner.y0 + iy0) / 2;
              else y = (iy1 + inner.y1) / 2;
              h = fc;
            }
          }
        }
        kit.cyl(ring, x * FT, h * FT - 0.006, y * FT, 0.055, 0.012, 20);
        kit.cyl(lamp, x * FT, h * FT - 0.013, y * FT, 0.04, 0.004, 20);
      }
    const grp = kit.build(new THREE.Group(), false);
    ctx.add(grp, { kind: "light:downlights", level: room.level, room: room.id, label: `${room.name} downlights` });
    grp.traverse((x) => (x.userData.collide = false));
    ctx.downlit.add(room.id);
  }

  return { accent_wall, false_ceiling, downlights };
}

function box(mb: MeshBuilder, axis: "x" | "y", u0: number, u1: number, p0: number, p1: number, h0: number, h1: number): void {
  const [a0, a1] = [Math.min(u0, u1), Math.max(u0, u1)];
  const [b0, b1] = [Math.min(p0, p1), Math.max(p0, p1)];
  if (a1 - a0 < 1e-4 || b1 - b0 < 1e-4 || h1 - h0 < 1e-4) return;
  if (axis === "x") mb.box(a0 * FT, h0 * FT, b0 * FT, a1 * FT, h1 * FT, b1 * FT);
  else mb.box(b0 * FT, h0 * FT, a0 * FT, b1 * FT, h1 * FT, a1 * FT);
}
function bx(mb: MeshBuilder, x0: number, x1: number, y0: number, y1: number, h0: number, h1: number): void {
  if (x1 - x0 < 1e-4 || y1 - y0 < 1e-4 || h1 - h0 < 1e-4) return;
  mb.box(x0 * FT, h0 * FT, y0 * FT, x1 * FT, h1 * FT, y1 * FT);
}
