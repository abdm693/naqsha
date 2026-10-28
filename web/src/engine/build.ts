/** buildHouse: run design.js sections against the SDK and assemble the scene. */
import * as THREE from "three";
import type { BuildingPlan } from "@contracts/plan";
import type { Layer } from "@contracts/house-sdk";
import type { AsBuiltSummary } from "@contracts/api-types";
import type { BuildResult, DesignSectionSrc, SectionResult } from "./index";
import { BuildCtx } from "./core/ctx";
import { consolidate } from "./core/consolidate";
import { FT, smoothstep, warn } from "./core/util";
import { PlanModel } from "./plan/model";
import { StructureModel } from "./structure/model";
import { buildStructure } from "./structure";
import { createSDK, lenientThree } from "./sdk";
import { addSun, sunDirection } from "./lights";
import { floorBelow } from "./facade";
import { ensurePaths } from "./furniture/paths";
import { ensureCars, ensureDefining } from "./furniture/place";
import { parking } from "./furniture/parking";
import { keepOutdoorReach } from "./outdoor";
import { ITEMS } from "./furniture/items";
import { solarRect } from "./furniture/zones";
import { NoteLog, type EngineNote } from "./core/notes";

const LAYERS: Layer[] = ["structure", "facade", "interior", "furniture", "landscape", "lighting", "custom"];

export interface BuildStats {
  totalMs: number;
  sectionsMs: number;
  consolidateMs: number;
  meshesBefore: number;
  meshesAfter: number;
}

function inferLayer(name: string): Layer {
  const n = name.toLowerCase();
  if (n.startsWith("structure")) return "structure";
  if (n.startsWith("facade")) return "facade";
  if (n.startsWith("interior")) return "interior";
  if (n.startsWith("furnish")) return "furniture";
  if (n.startsWith("landscape")) return "landscape";
  if (n.startsWith("light")) return "lighting";
  return "custom";
}

const yieldNow = (): Promise<void> =>
  new Promise((res) => {
    if (typeof MessageChannel !== "undefined") {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => res();
      ch.port2.postMessage(0);
    } else setTimeout(res, 0);
  });

export async function buildHouseImpl(
  planIn: BuildingPlan,
  sectionsIn: DesignSectionSrc[],
  opts: { onSection?: (r: SectionResult, root: THREE.Group) => void | Promise<void>; quality?: "high" | "medium" } = {},
  screen: (body: string) => string[],
): Promise<BuildResult & { stats: BuildStats }> {
  const t0 = performance.now();
  const plan = new PlanModel(planIn);
  const ctx = new BuildCtx(plan, opts.quality === "medium" ? "medium" : "high");
  ctx.modelFactory = (c) => new StructureModel(c.plan);
  const sdk = createSDK(ctx);
  const THREE_L = lenientThree();
  const results: SectionResult[] = [];
  // accept {name, layer, body} and the API shape {name, layer, code}
  const sections: DesignSectionSrc[] = [];
  for (const raw of Array.isArray(sectionsIn) ? sectionsIn : []) {
    if (!raw || typeof raw !== "object") continue;
    const sec = raw as DesignSectionSrc & { code?: unknown };
    const body = typeof sec.body === "string" ? sec.body : typeof sec.code === "string" ? sec.code : null;
    if (body === null) continue;
    const name = typeof sec.name === "string" && sec.name ? sec.name : `section_${sections.length}`;
    sections.push({ name, layer: sec.layer, body });
  }

  const runSection = async (name: string, layerIn: string, body: string | (() => void)) => {
    const layer: Layer = LAYERS.includes(layerIn as Layer) ? (layerIn as Layer) : inferLayer(name);
    const group = new THREE.Group();
    group.name = `section:${name}`;
    group.userData = { layer, kind: "section", id: `section_${name}`, label: name, section: name };
    ctx.root.add(group);
    ctx.sectionGroup = group;
    ctx.layer = layer;
    ctx.section = name;
    ctx.objectsThisSection = 0;
    const itemsBefore = ctx.items.length;
    const t = performance.now();
    let ok = true;
    let error: string | undefined;
    if (typeof body === "string") {
      const reasons = screen(body);
      if (reasons.length) {
        ok = false;
        error = `rejected: ${reasons.join("; ")}`;
      } else {
        try {
          const fn = new Function("s", "THREE", '"use strict";\n' + body);
          fn(sdk, THREE_L);
        } catch (e) {
          ok = false;
          error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
        }
      }
    } else {
      try {
        body();
      } catch (e) {
        ok = false;
        error = String(e);
      }
    }
    // deferred hooks (auto dining chairs etc.) always run
    while (ctx.endOfSection.length) {
      try {
        ctx.endOfSection.shift()!();
      } catch (e) {
        warn(`end-of-section hook failed: ${e}`);
      }
    }
    // B.5: keep 3 ft walking paths between the doors and stairs of every room this section furnished
    if (ctx.structureBuilt && ctx.items.length > itemsBefore) {
      try {
        ensurePaths(ctx, new Set(ctx.items.slice(itemsBefore).map((it) => it.room)));
      } catch (e) {
        warn(`walking-path check failed: ${e}`);
      }
    }
    const r: SectionResult = { name, layer, ok, error, ms: Math.round((performance.now() - t) * 10) / 10, objects: ctx.objectsThisSection };
    results.push(r);
    if (error) console.warn(`[naqsha/engine] section ${name}: ${error}`);
    if (opts.onSection) {
      try {
        await opts.onSection(r, ctx.root);
      } catch (e) {
        warn(`onSection callback threw: ${e}`);
      }
    }
    await yieldNow();
  };

  // EN-04: how many cars the design parks (explicit furnish calls; an auto-furnished porch parks one), so the
  // parking layout makes room for all of them from the start
  {
    const carRe = /furnish\s*\(\s*["'`](car_sedan|car_suv|car|suv|sedan)["'`]/g;
    let n = 0;
    for (const s of sections) n += (s.body.match(carRe) ?? []).length;
    const porches = plan.rooms.filter((r) => r.lv.i === 0 && (r.type === "porch" || r.type === "garage"));
    const named = porches.reduce((a, r) => a + (Number(/(\d)\s*-?\s*car/i.exec(r.name)?.[1]) || 0), 0);
    // EN2-04: the plan's own count: the porch's name ("Car porch (2 cars)"), else "a 2-car porch" in its notes
    ctx.carsPlan = porches.length ? named || carsInNotes(plan.plan.notes) : 0;
    ctx.carsWanted = Math.max(n, ctx.carsPlan, porches.length ? 1 : 0);
  }

  // structure first even if Argon put it later; it must exist for everything else
  const ordered = [...sections].sort((a, b) => (a.name === "structure" ? -1 : b.name === "structure" ? 1 : 0));
  for (const s of ordered) {
    if (s.name !== "structure" && !ctx.structureBuilt && ordered[0]?.name !== "structure") {
      await runSection("structure_auto", "structure", () => buildStructure(ctx, {}));
    }
    await runSection(s.name, s.layer, s.body);
  }
  if (!ctx.structureBuilt) await runSection("structure_auto", "structure", () => buildStructure(ctx, {}));
  // EN2-04: as many cars as the plan's porch asks for (into free bays; a car that does not fit is reported)
  if (ctx.structureBuilt && ctx.carsParked < ctx.carsPlan && ctx.carsAsked < ctx.carsPlan) await runSection("park_cars", "furniture", () => ensureCars(ctx));
  // EN-03: every bedroom has its bed, every bath its WC, every kitchen its fridge and hob, every dressing its wardrobe
  if (ctx.structureBuilt) await ensureDefining(ctx, (fn) => runSection("furnish_essentials", "furniture", fn));
  // EN-F1: outdoor furniture never closes the 3 ft way from the gate to a door or a yard the planting leaves open
  if (ctx.structureBuilt) await runSection("outdoor_reach", "furniture", () => keepOutdoorReach(ctx));
  let hasSun = false;
  ctx.root.traverse((o) => {
    if (o.userData.kind === "sun") hasSun = true;
  });
  if (!hasSun) await runSection("lighting_auto", "lighting", () => addSun(ctx, { hour: 17.5 }));
  const tSections = performance.now();

  setTimeOfDay(ctx.root, planIn, ctx.sunHour);

  let meshesBefore = 0;
  ctx.root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshesBefore++;
  });
  const tc = performance.now();
  const cons = consolidate(ctx.root, ctx.colliderGroup, new Set(ctx.colliders));
  const consolidateMs = performance.now() - tc;
  let meshesAfter = 0;
  ctx.root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && o.visible) meshesAfter++;
  });

  const levels = plan.levels.map((l) => ({
    id: l.id,
    name: l.name,
    floor_y: Math.round(l.elev * FT * 1000) / 1000,
    top_y: Math.round((l.isRoof ? l.elev + Math.max(plan.parapet, plan.rooms.some((r) => r.lv.isRoof) ? plan.mumtyHeight : 0) : l.next) * FT * 1000) / 1000,
  }));

  const spawn = computeSpawn(ctx);
  if (ctx.structureBuilt) roofChecks(ctx, cons.summary);
  const summary: AsBuiltSummary = {
    objects: cons.summary,
    section_errors: results.filter((r) => !r.ok).map((r) => ({ section: r.name, error: r.error ?? "error" })),
    checks: mergeNotes([...(ctx.structureBuilt ? ctx.model.notes.list : []), ...ctx.notes.list]),
  };
  const root = ctx.root;
  root.userData.stats = { mergedMeshes: cons.mergedMeshes, meshesBefore, meshesAfter };
  const totalMs = performance.now() - t0;
  const result = {
    root,
    summary,
    sections: results,
    levels,
    colliders: cons.colliders,
    spawn,
    landings: ctx.structureBuilt ? computeLandings(ctx) : [],
    stats: { totalMs, sectionsMs: tSections - t0, consolidateMs, meshesBefore, meshesAfter },
    dispose() {
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && m.geometry) m.geometry.dispose();
      });
      ctx.mats.dispose();
      root.removeFromParent();
    },
  };
  // the build context, for dev tools and checks (not part of the contract; not enumerable)
  Object.defineProperty(result, "ctx", { value: ctx, enumerable: false });
  return result;
}

function computeSpawn(ctx: BuildCtx): { position: THREE.Vector3; lookAt: THREE.Vector3 } {
  const plan = ctx.plan;
  // B.6: on the gate-to-door walkway, about 7 ft before the main door, facing it with nothing tall in between
  const P = ctx.structureBuilt ? parking(ctx) : null;
  if (P && P.door && P.doorCentre && P.path.length > 1) {
    const pts = P.path;
    // look at the door, but test the view only up to the door step (furniture inside the house does not count)
    const [dx, dy] = P.approach ?? P.doorCentre;
    const tall = ctx.items.filter((it) => it.cls === "floor" && it.h1 - it.h0 > 2.5 && ITEMS[it.type as keyof typeof ITEMS]?.collide && ctx.plan.room(it.room)?.cat !== "enclosed");
    const sees = (x: number, y: number) => !tall.some((it) => segHitsBox(x, y, dx, dy, it.x0 - 0.3, it.x1 + 0.3, it.y0 - 0.3, it.y1 + 0.3));
    let acc = 0, idx = pts.length - 1;
    for (let k = pts.length - 1; k > 0; k--) {
      acc += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
      idx = k - 1;
      if (acc >= 7) break;
    }
    while (idx > 0 && !sees(pts[idx][0], pts[idx][1])) idx--;
    const [px, py] = pts[idx];
    const eye = 1.6;
    const floor = floorBelow(ctx, px, py, P.door.bottom + 3);
    return {
      position: new THREE.Vector3(px * FT, floor * FT + eye, -py * FT),
      lookAt: new THREE.Vector3(P.doorCentre[0] * FT, (P.door.bottom + 0.04) * FT + eye, -P.doorCentre[1] * FT),
    };
  }
  const ops = ctx.structureBuilt ? ctx.model.openings : [];
  const main =
    ops.find((o) => o.op.type === "main_door") ??
    ops.find((o) => o.isDoor && o.run.out !== 0 && o.op.type !== "garage_door") ??
    ops.find((o) => o.isDoor);
  const eye = 1.6;
  if (main) {
    const run = main.run;
    const u = (main.u0 + main.u1) / 2;
    const outward = run.out !== 0 ? run.out : main.swingSide === -1 ? 1 : -1;
    // first free spot outside the door (avoid parked cars, planters, other furniture)
    const blocked = (x: number, y: number) =>
      ctx.items.some((it) => (it.cls === "floor" || it.cls === "top") && x > it.x0 - 1.3 && x < it.x1 + 1.3 && y > it.y0 - 1.3 && y < it.y1 + 1.3) ||
      x < 0.8 || y < -20 || x > plan.plotW - 0.8 || y > plan.plotD;
    let px = run.axis === "x" ? u : run.c + outward * 6.5;
    let py = run.axis === "x" ? run.c + outward * 6.5 : u;
    search: for (const dist of [6.5, 4.5, 8.5, 3.5, 10.5, 2.8])
      for (const lat of [0, 2.5, -2.5, 4.5, -4.5]) {
        const cx = run.axis === "x" ? u + lat : run.c + outward * dist;
        const cy = run.axis === "x" ? run.c + outward * dist : u + lat;
        if (!blocked(cx, cy)) {
          px = cx;
          py = cy;
          break search;
        }
      }
    const dx = run.axis === "x" ? u : run.c;
    const dy = run.axis === "x" ? run.c : u;
    const floor = floorBelow(ctx, px, py, main.bottom + 3);
    const doorFloor = main.bottom + 0.04;
    return {
      position: new THREE.Vector3(px * FT, floor * FT + eye, -py * FT),
      lookAt: new THREE.Vector3(dx * FT, doorFloor * FT + eye, -dy * FT),
    };
  }
  const x = plan.plotW / 2, y = 4;
  return {
    position: new THREE.Vector3(x * FT, plan.grade * FT + eye, -y * FT),
    lookAt: new THREE.Vector3(x * FT, plan.grade * FT + eye, -(y + 10) * FT),
  };
}

/**
 * Scale emissive fixtures and fake light pools for the time of day (lights read as "on" at dusk/night and
 * subtle at noon). Safe to call repeatedly (e.g. from a sun slider).
 */
export function setTimeOfDay(root: THREE.Object3D, plan: Pick<BuildingPlan, "site">, hour: number): void {
  const { altitude } = sunDirection(plan, hour);
  const a = altitude * (180 / Math.PI);
  const night = 1 - smoothstep(-2, 16, a);
  const seen = new Set<THREE.Material>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) {
      if (!mat || seen.has(mat)) continue;
      seen.add(mat);
      const sm = mat as THREE.MeshStandardMaterial & THREE.MeshBasicMaterial;
      if (sm.blending === THREE.AdditiveBlending) {
        sm.userData.baseOpacity ??= sm.opacity;
        sm.opacity = (sm.userData.baseOpacity as number) * (0.12 + 0.88 * night);
      } else if (sm.emissive && sm.emissiveIntensity > 0 && sm.emissive.getHex() !== 0) {
        sm.userData.baseEmissive ??= sm.emissiveIntensity;
        sm.emissiveIntensity = (sm.userData.baseEmissive as number) * (0.35 + 0.65 * night);
      }
    }
  });
}

/** Per floor: the stair's landing on it (top landing, or the foot of the lowest stair), facing into the floor. */
function computeLandings(ctx: BuildCtx): { level: string; position: THREE.Vector3; lookAt: THREE.Vector3 }[] {
  const plan = ctx.plan;
  const out: { level: string; position: THREE.Vector3; lookAt: THREE.Vector3 }[] = [];
  const eye = 1.6;
  for (const lv of plan.levels) {
    const up = ctx.model.stairs.find((l) => l.holeLevel === lv.id);
    const foot = ctx.model.stairs.filter((l) => l.stair.from.id === lv.id).sort((a, b) => a.stair.from.elev - b.stair.from.elev)[0];
    const zone = up ? up.landing : foot ? foot.foot : null;
    if (!zone) continue;
    const px = zone.x + zone.w / 2, py = zone.y + zone.d / 2;
    const here = plan.roomAt(lv.id, px, py);
    // look toward the biggest room this landing opens to (its open-plan group), else the biggest room on the floor
    const group = here ? [here, ...[...here.open].map((id) => plan.room(id)).filter((r): r is NonNullable<typeof r> => !!r && r.level === lv.id)] : [];
    const pool = (group.length > 1 ? group.filter((r) => r !== here) : plan.roomsOn(lv.id).filter((r) => r.cat !== "outdoor" && r !== here)).sort((a, b) => b.rect.w * b.rect.d - a.rect.w * a.rect.d);
    const t = pool[0];
    let tx = t ? t.rect.x + t.rect.w / 2 : px + (up ? up.outDir[0] : 0) * 5, ty = t ? t.rect.y + t.rect.d / 2 : py + (up ? up.outDir[1] : 0) * 5;
    if (lv.isRoof && ctx.model.tower) {
      // on the roof: through the tower door
      const tw = ctx.model.tower;
      tx = tw.at[0] + (tw.side === "left" ? -6 : tw.side === "right" ? 6 : 0);
      ty = tw.at[1] + (tw.side === "front" ? -6 : tw.side === "back" ? 6 : 0);
    }
    const floor = lv.elev;
    out.push({ level: lv.id, position: new THREE.Vector3(px * FT, floor * FT + eye, -py * FT), lookAt: new THREE.Vector3(tx * FT, floor * FT + eye, -ty * FT) });
  }
  return out;
}

/**
 * B.8 as-built roof checks: anything standing in the area kept clear for solar (a cupola, a pergola, a chhatri,
 * terrace furniture) and decorative roof structures in general are reported, so Argon can be asked to remove them.
 */
function roofChecks(ctx: BuildCtx, objects: AsBuiltSummary["objects"]): void {
  const plan = ctx.plan;
  const roof = plan.roof;
  const sol = solarRect(ctx);
  const deco = /dome|cupola|minaret|chhatri|chattri|pergola|gazebo|turret|spire|finial/i;
  for (const o of objects) {
    if (o.layer !== "facade" && o.layer !== "custom") continue;
    const [x0, y0, h0] = o.bbox_ft.min, [x1, y1, h1] = o.bbox_ft.max;
    if (h1 < roof.elev + 1 || h0 < roof.elev - 1.5) continue; // not a rooftop object
    const name = `${o.kind ?? ""} ${o.id}`;
    const inSolar = !!sol && x0 < sol.x + sol.w && x1 > sol.x && y0 < sol.y + sol.d && y1 > sol.y;
    if (inSolar)
      ctx.notes.add({ id: `asbuilt.roof_solar_blocked:${o.id}`, title: "Rooftop object in the solar area", status: "warn", message: `${rooftopName(o.kind)} stands in the roof area kept clear for solar panels.`, element_ids: [o.id] });
    else if (deco.test(name))
      ctx.notes.add({ id: `asbuilt.roof_decoration:${o.id}`, title: "Decorative roof structure", status: "warn", message: `A decorative ${(name.match(deco)?.[0] ?? "structure").toLowerCase()} stands on the roof; keep the roof clear unless the brief asks for it.`, element_ids: [o.id] });
  }
}

const cap1 = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
/** EN2-05: "A pergola", "Outdoor chair" from an object's kind, never its id */
function rooftopName(kind?: string): string {
  const k = (kind ?? "").split(":").pop()?.replace(/_/g, " ").trim() ?? "";
  return !k || ["custom", "facade", "structure", "group", "mesh", "obj"].includes(k) ? "A rooftop object" : cap1(k);
}

/** "a 16x18 ft 2-car porch", "a two-car porch": the car count a plan's notes give its porch (0 when they do not). */
function carsInNotes(notes: unknown): number {
  const text = Array.isArray(notes) ? notes.filter((x) => typeof x === "string").join(" ") : typeof notes === "string" ? notes : "";
  const m = /\b(\d|one|two|three|four|single|double)[\s-]*cars?\s+(?:car\s+)?(?:porch|garage|parking)/i.exec(text);
  if (!m) return 0;
  const W: Record<string, number> = { one: 1, single: 1, two: 2, double: 2, three: 3, four: 4 };
  return Number(m[1]) || W[m[1].toLowerCase()] || 0;
}

/** EN-07: one line per fact across the structure and furnishing logs (same id or same message → merged). */
function mergeNotes(list: EngineNote[]): EngineNote[] {
  const log = new NoteLog();
  for (const n of list) log.add({ ...n, element_ids: n.element_ids ? [...n.element_ids] : undefined });
  return log.list;
}

/** Does the segment (x0,y0)-(x1,y1) cross the box? (slab test) */
function segHitsBox(x0: number, y0: number, x1: number, y1: number, bx0: number, bx1: number, by0: number, by1: number): boolean {
  let t0 = 0, t1 = 1;
  const dx = x1 - x0, dy = y1 - y0;
  for (const [p, q] of [[-dx, x0 - bx0], [dx, bx1 - x0], [-dy, y0 - by0], [dy, by1 - y0]]) {
    if (Math.abs(p) < 1e-9) {
      if (q < 0) return false;
      continue;
    }
    const r = q / p;
    if (p < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
    if (t0 > t1) return false;
  }
  return true;
}
