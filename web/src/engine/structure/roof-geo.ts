/**
 * B.8 roof: the area kept clear for solar (plan.roof.solar), panel rows on a light steel frame when the brief asks
 * for panels, and the overhead water tank in the material the brief chose (blue ribbed plastic or rendered RCC).
 */
import * as THREE from "three";
import type { BuildCtx } from "../core/ctx";
import type { R } from "../core/grid";
import { Kit, lathe, mat4, unitBox } from "../core/shapes";
import { DEG, FT, clamp } from "../core/util";

const FACING: Record<string, number> = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };

/** Plan unit vector pointing to true south (panels face it). */
export function southVector(ctx: BuildCtx): [number, number] {
  const bF = (FACING[ctx.plan.plan.site?.facing ?? "N"] ?? 0) * DEG;
  return [-Math.sin(bF), Math.cos(bF)];
}

/** The tank rect from the plan (sanitised), or null. */
export function tankRect(ctx: BuildCtx): R | null {
  const t = ctx.plan.plan.roof?.water_tank?.rect;
  if (!t) return null;
  const x = clamp(Number(t.x) || 0, 0, ctx.plan.plotW), y = clamp(Number(t.y) || 0, 0, ctx.plan.plotD);
  return { x, y, w: clamp(Number(t.w) || 5, 2, 12), d: clamp(Number(t.d) || 5, 2, 12) };
}

/**
 * The roof area kept clear for panels: plan.roof.solar.rect when given, else the largest rectangle of open roof
 * slab (top storey footprint) that keeps 2 ft from the parapet, 1 ft from the tank, and clear of the stair tower and
 * the 4 ft landing outside its door. Cached on the build.
 */
export function computeSolarRect(ctx: BuildCtx): R | null {
  const c = ctx as unknown as { solarAuto?: R | null };
  if (c.solarAuto !== undefined) return c.solarAuto;
  c.solarAuto = null;
  const plan = ctx.plan;
  const sol = plan.plan.roof?.solar;
  if (!sol) return null;
  const top = plan.levelBelow(plan.roof);
  if (!top) return null;
  const roofRooms = plan.roomsOn(plan.roof.id).filter((r) => r.cat === "enclosed");
  const tank = tankRect(ctx);
  const tw = ctx.structureBuilt ? ctx.model.tower : null;
  const door = tw ? ctx.model.openings.find((o) => o.op.level === tw.room.level && o.isDoor && (o.neg === tw.room || o.pos === tw.room)) : null;
  const CELL = 1;
  const nx = Math.ceil(plan.plotW / CELL), ny = Math.ceil(plan.plotD / CELL);
  const ok = new Uint8Array(nx * ny);
  const slab = (x: number, y: number) => {
    const r = plan.roomAt(top.id, x, y);
    return !!r && (r.cat === "enclosed" || r.cat === "porch");
  };
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const x = (i + 0.5) * CELL, y = (j + 0.5) * CELL;
      let v = slab(x, y) && slab(x - 2.4, y) && slab(x + 2.4, y) && slab(x, y - 2.4) && slab(x, y + 2.4);
      if (v) v = !roofRooms.some((r) => x > r.rect.x - 1.5 && x < r.rect.x + r.rect.w + 1.5 && y > r.rect.y - 1.5 && y < r.rect.y + r.rect.d + 1.5);
      if (v && tank) v = !(x > tank.x - 1 && x < tank.x + tank.w + 1 && y > tank.y - 1 && y < tank.y + tank.d + 1);
      if (v && door) {
        const run = door.run;
        const out = door.neg === tw!.room ? 1 : -1;
        const c0 = run.c + out * run.t / 2, c1 = c0 + out * 4.5;
        const [x0, x1, y0, y1] = run.axis === "x" ? [door.u0 - 1.5, door.u1 + 1.5, Math.min(c0, c1), Math.max(c0, c1)] : [Math.min(c0, c1), Math.max(c0, c1), door.u0 - 1.5, door.u1 + 1.5];
        v = !(x > x0 && x < x1 && y > y0 && y < y1);
      }
      ok[j * nx + i] = v ? 1 : 0;
    }
  // largest rectangle of ok cells (histogram method)
  const hgt = new Int32Array(nx);
  let best = { area: 0, x: 0, y: 0, w: 0, d: 0 };
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) hgt[i] = ok[j * nx + i] ? hgt[i] + 1 : 0;
    const st: number[] = [];
    for (let i = 0; i <= nx; i++) {
      const h = i < nx ? hgt[i] : 0;
      while (st.length && hgt[st[st.length - 1]] >= h) {
        const hh = hgt[st.pop()!];
        const left = st.length ? st[st.length - 1] + 1 : 0;
        const w = i - left;
        if (hh * w > best.area && hh >= 6 && w >= 6) best = { area: hh * w, x: left * CELL, y: (j - hh + 1) * CELL, w: w * CELL, d: hh * CELL };
      }
      st.push(i);
    }
  }
  if (best.area > 0) c.solarAuto = { x: best.x, y: best.y, w: best.w, d: best.d };
  return c.solarAuto;
}

/** Panel rows (mode "panels") tilted 22° to true south on a galvanised steel frame, inside the solar rect. */
export function buildSolar(ctx: BuildCtx): void {
  const sol = ctx.plan.plan.roof?.solar;
  const r = computeSolarRect(ctx);
  if (!sol || !r || sol.mode !== "panels") return;
  const M = ctx.mats;
  const glass = M.basic("#17202e", { roughness: 0.18, metalness: 0.35 });
  const cellLine = M.basic("#7f8a99", { roughness: 0.4, metalness: 0.6 });
  const alu = M.get({ preset: "metal_brushed", color: "#c9ccd0" });
  const steel = M.get({ preset: "metal_brushed", color: "#9ea3a8", roughness: 0.45 });
  const base = ctx.plan.roof.elev;
  // rows run perpendicular to the south direction, snapped to the roof's axes
  const [sx, sy] = southVector(ctx);
  const southAxis: "x" | "y" = Math.abs(sx) > Math.abs(sy) ? "x" : "y";
  const sgn = southAxis === "x" ? Math.sign(sx) || 1 : Math.sign(sy) || 1;
  const tilt = 22 * DEG;
  const slope = 3.7; // panel short side up the slope (ft)
  const pw = 7.5; // panel long side along the row
  const depth = slope * Math.cos(tilt), rise = slope * Math.sin(tilt);
  const pitch = depth + 2.6; // room for the winter shadow and a maintenance path
  const across0 = southAxis === "x" ? r.x : r.y, across1 = southAxis === "x" ? r.x + r.w : r.y + r.d;
  const along0 = southAxis === "x" ? r.y : r.x, along1 = southAxis === "x" ? r.y + r.d : r.x + r.w;
  const nPan = Math.floor((along1 - along0 - 0.6) / (pw + 0.15));
  const nRow = Math.floor((across1 - across0 - depth) / pitch) + 1;
  if (nPan < 1 || nRow < 1) return;
  const used = nPan * (pw + 0.15) - 0.15;
  const a0 = along0 + (along1 - along0 - used) / 2;
  const kit = new Kit();
  const P = (along: number, across: number, h: number) => (southAxis === "x" ? new THREE.Vector3(across * FT, h * FT, along * FT) : new THREE.Vector3(along * FT, h * FT, across * FT));
  const lowH = 1.0; // front edge height above the roof
  for (let k = 0; k < nRow; k++) {
    // the low edge faces south: rows step away from the south side of the rect
    const lo = sgn > 0 ? across1 - k * pitch : across0 + k * pitch; // low (south) edge
    const hi = lo - sgn * depth;
    const qx = (across: number) => across;
    for (let p = 0; p < nPan; p++) {
      const u0 = a0 + p * (pw + 0.15), u1 = u0 + pw;
      // panel slab: from (lo, lowH) to (hi, lowH + rise)
      const o = P(u0, qx(lo), base + lowH);
      const along = southAxis === "x" ? new THREE.Vector3(0, 0, pw * FT) : new THREE.Vector3(pw * FT, 0, 0);
      const up = P(u0, qx(hi), base + lowH + rise).sub(o);
      const nrm = new THREE.Vector3().crossVectors(along, up).normalize();
      if (nrm.y < 0) nrm.negate();
      nrm.multiplyScalar(0.12 * FT);
      box3(kit.mb(glass, false), o, along, up, nrm);
      // frame border and cell lines on the glass face
      const lift = nrm.clone().multiplyScalar(1.08);
      for (let q = 1; q < 6; q++) {
        const oo = o.clone().add(along.clone().multiplyScalar(q / 6)).add(lift);
        box3(kit.mb(cellLine, false), oo, along.clone().normalize().multiplyScalar(0.02), up, nrm.clone().multiplyScalar(0.15));
      }
      for (const t of [0, 1]) box3(kit.mb(alu), o.clone().add(up.clone().multiplyScalar(t)).add(up.clone().normalize().multiplyScalar(t ? -0.04 : 0)), along, up.clone().normalize().multiplyScalar(0.04), nrm.clone().multiplyScalar(1.3));
      void u1;
    }
    // steel frame: rails under the panels and legs every ~6 ft
    const legs = Math.max(2, Math.ceil(used / 6) + 1);
    for (let l = 0; l < legs; l++) {
      const u = a0 + (used * l) / (legs - 1);
      const front = P(u, lo - sgn * 0.3, base), back = P(u, hi + sgn * 0.3, base);
      const hF = lowH + rise * 0.08, hB = lowH + rise * 0.92;
      kit.box(steel, front.x, (base + hF / 2) * FT, front.z, 0.05, hF * FT, 0.05);
      kit.box(steel, back.x, (base + hB / 2) * FT, back.z, 0.05, hB * FT, 0.05);
      // diagonal rafter from front to back leg top
      const a = P(u, lo - sgn * 0.3, base + hF), b = P(u, hi + sgn * 0.3, base + hB);
      const d = b.clone().sub(a);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), d.clone().normalize());
      kit.geo(steel, unitBox(), new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(d.length(), 0.045, 0.045)));
      // ballast block
      kit.box(M.get({ preset: "concrete", color: "#b9b4ab" }), (front.x + back.x) / 2, (base + 0.15) * FT, (front.z + back.z) / 2, southAxis === "x" ? Math.abs(back.x - front.x) + 0.1 : 0.25, 0.3 * FT, southAxis === "x" ? 0.25 : Math.abs(back.z - front.z) + 0.1);
    }
  }
  const g = kit.build();
  ctx.add(g, { kind: "solar", level: ctx.plan.roof.id, id: "solar_panels", label: `Solar panels (${nRow * nPan} × ~550 W)` });
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.userData.collide = true;
      ctx.collider(o as THREE.Mesh);
    }
  });
}

/** Parallelepiped from corner o with edges a, b, c (meters, builder frame). */
function box3(mb: ReturnType<Kit["mb"]>, o: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): void {
  const m = new THREE.Matrix4().makeBasis(a, b, c);
  m.setPosition(o.x + (a.x + b.x + c.x) / 2, o.y + (a.y + b.y + c.y) / 2, o.z + (a.z + b.z + c.z) / 2);
  if (Math.abs(m.determinant()) < 1e-12) return;
  mb.addGeometry(unitBox(), m);
}

/** Overhead water tank: "plastic" = the familiar blue ribbed cylinder on a pad; "concrete" = a rendered RCC box. */
export function buildTank(ctx: BuildCtx, mats: { plaster: THREE.Material; concrete: THREE.Material; pipe: THREE.Material }): void {
  const plan = ctx.plan;
  const wt = plan.plan.roof?.water_tank;
  const r = tankRect(ctx);
  if (!wt || !r) return;
  const H = clamp(Number(wt.height_ft) || 5, 2, 10);
  const cx = r.x + r.w / 2, cy = r.y + r.d / 2;
  // on the stair tower if it stands over it, else on the roof slab
  const tower = plan.rooms.find((m) => m.lv.isRoof && m.cat === "enclosed" && cx > m.rect.x && cx < m.rect.x + m.rect.w && cy > m.rect.y && cy < m.rect.y + m.rect.d);
  const base = tower ? tower.lv.elev + plan.mumtyHeight : plan.roof.elev;
  const kit = new Kit();
  const material = wt.material === "concrete" ? "concrete" : "plastic";
  if (material === "concrete") {
    // RCC tank: rendered walls with a drip band, a raised manhole and an overflow pipe
    const w = r.w - 0.3, d = r.d - 0.3;
    kit.box(mats.plaster, cx * FT, (base + H / 2) * FT, cy * FT, w * FT, H * FT, d * FT);
    kit.box(mats.concrete, cx * FT, (base + H + 0.1) * FT, cy * FT, (w + 0.4) * FT, 0.2 * FT, (d + 0.4) * FT);
    kit.box(mats.concrete, (cx - w / 4) * FT, (base + H + 0.35) * FT, cy * FT, 1.8 * FT, 0.3 * FT, 1.8 * FT);
    kit.cyl(mats.pipe, (cx + w / 2 + 0.15) * FT, (base + H - 0.6) * FT, cy * FT, 0.04, 0.5, 10, 0, 0, Math.PI / 2);
  } else {
    const blue = ctx.mats.get({ preset: "plastic", color: "#2a5d9f", roughness: 0.5 });
    const pad = 0.6;
    kit.rbox(mats.concrete, cx * FT, (base + pad / 2) * FT, cy * FT, (r.w - 0.2) * FT, pad * FT, (r.d - 0.2) * FT, 0.02, 1);
    const R = (Math.min(r.w, r.d) / 2 - 0.25) * FT;
    const h = H * FT;
    const pts: [number, number][] = [[0, 0], [R * 0.92, 0], [R, 0.04]];
    const ribs = Math.max(4, Math.round(H / 0.55));
    for (let k = 0; k <= ribs; k++) {
      const yy = 0.06 + ((h * 0.86 - 0.06) * k) / ribs;
      pts.push([R * (k % 2 ? 0.965 : 1), yy]);
    }
    pts.push([R * 0.96, h * 0.9], [R * 0.75, h * 0.97], [R * 0.3, h], [0, h]);
    kit.geo(blue, lathe(`tank|${R.toFixed(3)}|${h.toFixed(3)}`, pts, 40), mat4(cx * FT, (base + pad) * FT, cy * FT));
    kit.cyl(blue, cx * FT, (base + pad) * FT + h + 0.03, cy * FT, R * 0.32, 0.07, 28);
    kit.cyl(mats.pipe, (cx + Math.min(r.w, r.d) / 2 - 0.4) * FT, (base + pad) * FT + 0.12, cy * FT, 0.035, 0.24, 10, 0, 0, Math.PI / 2);
  }
  const g = kit.build();
  ctx.add(g, { kind: "water_tank", level: plan.roof.id, id: "water_tank", label: material === "concrete" ? "RCC water tank" : "Overhead water tank" });
  if (!tower) g.traverse((o) => (o as THREE.Mesh).isMesh && ctx.collider(o as THREE.Mesh));
}
