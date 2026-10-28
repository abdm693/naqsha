/** Lights: Lahore sun from plot facing + hour, hemisphere fill, interior lights (budgeted), point lights. */
import * as THREE from "three";
import type { BuildingPlan, Pt } from "@contracts/plan";
import type { BuildCtx } from "./core/ctx";
import { DEG, FT, clamp, color, lerp, num, smoothstep, warn } from "./core/util";
import { Kit } from "./core/shapes";
import type { RoomM } from "./plan/model";

const LAT = 31.5 * DEG; // Lahore
const DECL = 18 * DEG; // early-summer sun: 17.5h ≈ golden hour, grazing light on north-facing fronts
const FACING: Record<string, number> = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };

/** Unit vector (world) pointing from the house toward the sun, plus altitude (radians). */
export function sunDirection(plan: Pick<BuildingPlan, "site">, hour: number): { dir: THREE.Vector3; altitude: number } {
  const h = clamp(num(hour, 17.5), 5, 20);
  const H = (h - 12) * 15 * DEG;
  const sinAlt = Math.sin(LAT) * Math.sin(DECL) + Math.cos(LAT) * Math.cos(DECL) * Math.cos(H);
  const alt = Math.asin(clamp(sinAlt, -1, 1));
  let cosAz = (Math.sin(DECL) - Math.sin(alt) * Math.sin(LAT)) / (Math.cos(alt) * Math.cos(LAT));
  cosAz = clamp(cosAz, -1, 1);
  let az = Math.acos(cosAz); // from north, east-positive in the morning
  if (H > 0) az = 2 * Math.PI - az;
  const bF = (FACING[plan.site?.facing ?? "N"] ?? 0) * DEG;
  const th = az - bF;
  // plan direction for a compass bearing relative to the plot front (front = -y)
  const dx = -Math.sin(th), dy = -Math.cos(th);
  const altC = Math.max(alt, 2.5 * DEG);
  // world mapping: z = -y
  const dir = new THREE.Vector3(dx * Math.cos(altC), Math.sin(altC), -dy * Math.cos(altC)).normalize();
  return { dir, altitude: alt };
}

export function sunLook(altitude: number): { color: THREE.Color; intensity: number; sky: THREE.Color; ground: THREE.Color; hemi: number } {
  const a = altitude / DEG;
  const warm = new THREE.Color("#ffad66"), gold = new THREE.Color("#ffd6a3"), day = new THREE.Color("#fff3e4");
  const c = a < 12 ? warm.clone().lerp(gold, smoothstep(0, 12, a)) : gold.clone().lerp(day, smoothstep(12, 40, a));
  const intensity = 5.2 * smoothstep(-3, 8, a) * lerp(0.72, 1, smoothstep(5, 45, a));
  const sky = new THREE.Color("#e9c3a3").lerp(new THREE.Color("#b3cbe6"), smoothstep(4, 30, a));
  const ground = new THREE.Color("#5f4f40");
  const hemi = lerp(0.12, 0.32, smoothstep(-5, 30, a));
  return { color: c, intensity, sky, ground, hemi };
}

/** Viewer helper: move an existing sun light (userData.kind === "sun") to a new hour. */
export function updateSun(light: THREE.DirectionalLight, plan: Pick<BuildingPlan, "site">, hour: number, hemi?: THREE.HemisphereLight | null): void {
  const { dir, altitude } = sunDirection(plan, hour);
  const look = sunLook(altitude);
  const tgt = light.target.position;
  const dist = (light.userData.sunDistance as number) ?? 70;
  light.position.copy(tgt).addScaledVector(dir, dist);
  light.color.copy(look.color);
  light.intensity = look.intensity * ((light.userData.intensityScale as number) ?? 1);
  light.userData.sunHour = hour;
  light.userData.sunDir = dir.toArray();
  light.updateMatrixWorld();
  if (hemi) {
    hemi.color.copy(look.sky);
    hemi.groundColor.copy(look.ground);
    hemi.intensity = look.hemi * ((hemi.userData.intensityScale as number) ?? 1);
  }
}

export function addSun(ctx: BuildCtx, o: { hour?: number; intensity?: number } = {}): void {
  const plan = ctx.plan;
  const hour = clamp(num(o?.hour, 17.5), 5, 20);
  const scale = clamp(num(o?.intensity, 1), 0.1, 4);
  ctx.sunHour = hour;
  const W = plan.plotW * FT, D = plan.plotD * FT;
  const target = new THREE.Object3D();
  target.position.set(W / 2, 0, -D / 2);
  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.name = "sun";
  sun.target = target;
  sun.castShadow = true;
  const size = ctx.quality === "high" ? 4096 : 2048;
  sun.shadow.mapSize.set(size, size);
  const R = Math.hypot(W, D) / 2 + 6;
  const cam = sun.shadow.camera as THREE.OrthographicCamera;
  cam.left = -R;
  cam.right = R;
  cam.top = R;
  cam.bottom = -R;
  cam.near = 1;
  cam.far = 220;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.035;
  sun.shadow.radius = 3;
  sun.userData.sunDistance = 90;
  sun.userData.intensityScale = scale;
  const hemi = new THREE.HemisphereLight(0xbcd4ee, 0x6d5a47, 0.5);
  hemi.name = "sky";
  hemi.userData.intensityScale = scale;
  updateSun(sun, plan.plan, hour, hemi);
  const g = new THREE.Group();
  g.name = "sunlight";
  g.add(sun, target, hemi);
  ctx.add(g, { kind: "light:sun", id: "sun_group", label: "Sunlight" });
  sun.userData.kind = "sun";
  sun.userData.id = "sun";
  sun.userData.label = "Sun";
  hemi.userData.kind = "sky";
  hemi.userData.id = "sky";
  hemi.userData.label = "Sky light";
}

const PRIORITY: Partial<Record<string, number>> = {
  lounge: 10, drawing: 9, dining: 8, master_bedroom: 7, kitchen: 6, bedroom: 5, guest_bedroom: 5, study: 4, lobby: 3, stair: 3, dressing: 2, prayer: 2,
};

/** Warm ceiling lights for every enclosed room; real point lights for the most important rooms (budgeted). */
export function interiorLights(ctx: BuildCtx, o: { warmth?: "warm" | "neutral"; intensity?: number } = {}): void {
  const plan = ctx.plan;
  const k = clamp(num(o?.intensity, 1), 0, 4);
  const hex = o?.warmth === "neutral" ? "#fff1e0" : "#ffd29a";
  const rooms = plan.rooms.filter((r) => r.cat === "enclosed" && !r.synthetic);
  const ranked = rooms
    .slice()
    .sort((a, b) => (PRIORITY[b.type] ?? 1) - (PRIORITY[a.type] ?? 1) || b.rect.w * b.rect.d - a.rect.w * a.rect.d);
  const withReal = new Set<string>();
  for (const r of ranked) {
    if ((PRIORITY[r.type] ?? 0) < 2 || r.rect.w * r.rect.d < 60) continue;
    if (!ctx.takeLight()) break;
    withReal.add(r.id);
    const lightH = ceilingAt(ctx, r) - 1.2;
    const l = new THREE.PointLight(color(hex), 7 * k * clamp((r.rect.w * r.rect.d) / 200, 0.7, 1.8), Math.hypot(r.rect.w, r.rect.d) * FT * 1.3, 2);
    l.position.set((r.rect.x + r.rect.w / 2) * FT, lightH * FT, -(r.rect.y + r.rect.d / 2) * FT);
    l.castShadow = false;
    ctx.add(l, { kind: "light:interior", level: r.level, room: r.id, id: `light_${r.id}`, label: `${r.name} light` });
  }
  // emissive flush fixtures in rooms without their own light fittings
  const kits = new Map<string, Kit>();
  const fixtureMat = ctx.mats.emissive(hex, 2.2 * Math.max(0.3, k));
  const rimMat = ctx.mats.basic("#f4f2ee", { roughness: 0.4 });
  for (const r of rooms) {
    const hasOwn = ctx.items.some((it) => it.room === r.id && it.cls === "ceiling" && /chandelier|pendant/.test(it.type));
    if (hasOwn || ctx.downlit.has(r.id)) continue;
    let kit = kits.get(r.level);
    if (!kit) kits.set(r.level, (kit = new Kit()));
    const ch = ceilingAt(ctx, r);
    // never in the stairwell: a fixture there would float in mid-air (it read as a hole in the stair wall)
    const [fx, fy] = ceilingSpot(ctx, r, r.rect.x + r.rect.w / 2, r.rect.y + r.rect.d / 2);
    const cx = fx * FT, cz = fy * FT;
    const fan = ctx.items.some((it) => it.room === r.id && it.type === "ceiling_fan" && Math.hypot((it.x0 + it.x1) / 2 - (r.rect.x + r.rect.w / 2), (it.y0 + it.y1) / 2 - (r.rect.y + r.rect.d / 2)) < 2);
    const offs: [number, number][] = fan ? [[-r.rect.w * 0.28, 0], [r.rect.w * 0.28, 0]] : [[0, 0]];
    for (const [ox, oy] of offs) {
      const x = cx + ox * FT, z = cz + oy * FT;
      kit.cyl(rimMat, x, ch * FT - 0.012, z, 0.17, 0.024, 28);
      kit.cyl(fixtureMat, x, ch * FT - 0.026, z, 0.15, 0.006, 28);
    }
  }
  for (const [lv, kit] of kits) {
    if (kit.empty) continue;
    const g = kit.build(new THREE.Group(), false);
    ctx.add(g, { kind: "light:fixture", level: lv, id: `ceiling_fixtures_${lv}`, label: "Ceiling lights" });
    g.traverse((o2) => (o2.userData.collide = false));
  }
  void withReal;
}

/**
 * A point on a room's ceiling for a fixture, as close to (x, y) as possible but never over a stairwell cut in the
 * slab above (plan ft).
 */
export function ceilingSpot(ctx: BuildCtx, r: RoomM, x: number, y: number): [number, number] {
  const above = ctx.plan.levelAbove(r.lv);
  if (!above || !ctx.structureBuilt) return [x, y];
  const holes = ctx.model.stairs.filter((s) => s.holeLevel === above.id).flatMap((s) => s.holes);
  const inHole = (px: number, py: number) => holes.some((h) => px > h.x - 0.8 && px < h.x + h.w + 0.8 && py > h.y - 0.8 && py < h.y + h.d + 0.8);
  if (!inHole(x, y)) return [x, y];
  let best: [number, number] | null = null, bd = Infinity;
  for (let px = r.rect.x + 1; px <= r.rect.x + r.rect.w - 1; px += 0.5)
    for (let py = r.rect.y + 1; py <= r.rect.y + r.rect.d - 1; py += 0.5) {
      if (inHole(px, py)) continue;
      const d = Math.hypot(px - x, py - y);
      if (d < bd) {
        bd = d;
        best = [px, py];
      }
    }
  return best ?? [x, y];
}

/** Ceiling height for a room, honouring false ceilings placed earlier. */
export function ceilingAt(ctx: BuildCtx, r: RoomM): number {
  return ctx.falseCeil.get(r.id) ?? r.ceilH;
}

export function pointLight(ctx: BuildCtx, o: { at: Pt; h_ft: number; color?: string; intensity?: number; distance_ft?: number }): void {
  const at = Array.isArray(o?.at) ? o.at : [ctx.plan.plotW / 2, ctx.plan.plotD / 2];
  const x = num(at[0], ctx.plan.plotW / 2), y = num(at[1], ctx.plan.plotD / 2), h = num(o?.h_ft, 8, -5, 60);
  const c = color(o?.color, "#ffd9a8");
  const k = clamp(num(o?.intensity, 1), 0, 20);
  const pos = new THREE.Vector3(x * FT, h * FT, y * FT); // build frame (Kit/MeshBuilder mirrors z)
  const level = levelAtHeight(ctx, h);
  if (ctx.takeLight()) {
    const l = new THREE.PointLight(c, 8 * k, num(o?.distance_ft, 16, 2, 120) * FT, 2);
    l.position.set(pos.x, pos.y, -pos.z);
    ctx.add(l, { kind: "light:point", level, id: ctx.uid("point_light"), label: "Light" });
  } else warn("light budget (12 real lights) reached; adding an emissive bulb instead");
  const kit = new Kit();
  kit.sphere(ctx.mats.emissive("#" + c.getHexString(), 3), pos.x, pos.y, pos.z, 0.08, 0.08, 0.08, 12);
  const g = kit.build(new THREE.Group(), false);
  ctx.add(g, { kind: "light:bulb", level, id: ctx.uid("bulb"), label: "Light bulb" });
}

export function levelAtHeight(ctx: BuildCtx, h: number): string {
  let id = ctx.plan.levels[0].id;
  for (const l of ctx.plan.levels) if (h >= l.elev - 0.5) id = l.id;
  return id;
}
