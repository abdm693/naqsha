/** createSDK: the HouseSDK object handed to design.js sections. Forgiving by design: never throws on bad input. */
import * as THREE from "three";
import type { FurnishOptions, FurnitureType, HouseSDK, MaterialSpec, RoomHandle, Side, Tags } from "@contracts/house-sdk";
import type { BuildingPlan } from "@contracts/plan";
import type { BuildCtx } from "./core/ctx";
import { applyTags } from "./core/tags";
import { FT, num, w3, warn } from "./core/util";
import { buildStructure, type StructureOpts } from "./structure";
import { facadeAPI, side as normSide } from "./facade";
import { interiorAPI, findRoom } from "./interior";
import { addSun, interiorLights, pointLight } from "./lights";
import { furnish, autoFurnish } from "./furniture";
import { landscapeAPI } from "./landscape";

const LAYERS = ["structure", "facade", "interior", "furniture", "landscape", "lighting", "custom"];

export function createSDK(ctx: BuildCtx): HouseSDK {
  const plan = ctx.plan;
  const frozenPlan = deepFreeze(structuredCloneSafe(plan.plan));
  const guard = <A extends unknown[], R>(name: string, fn: (...a: A) => R, fallback: () => R) =>
    (...a: A): R => {
      try {
        return fn(...a);
      } catch (e) {
        warn(`s.${name}() failed: ${(e as Error)?.message ?? e}`);
        return fallback();
      }
    };
  const roomHandle = (id: string): RoomHandle => {
    const r = findRoom(ctx, id) ?? plan.rooms.find((x) => x.cat === "enclosed") ?? plan.rooms[0];
    if (!r) {
      const rect = { x: 0, y: 0, w: plan.plotW, d: plan.plotD };
      return { id: String(id), type: "lounge", level: plan.levels[0].id, rect, floor_h_ft: plan.grade, ceiling_h_ft: plan.grade + 10, toWorld: (x, y, h = 0) => w3(num(x, 0), num(y, 0), plan.grade + num(h, 0)) };
    }
    return {
      id: r.id,
      type: r.type,
      level: r.level,
      rect: { ...r.rect },
      floor_h_ft: r.floorH,
      ceiling_h_ft: ctx.falseCeil.get(r.id) ?? r.ceilH,
      toWorld: (x: number, y: number, h = 0) => w3(r.rect.x + num(x, 0), r.rect.y + num(y, 0), r.floorH + num(h, 0)),
    };
  };
  const facade = facadeAPI(ctx);
  const interior = interiorAPI(ctx);
  const landscape = landscapeAPI(ctx);
  const sdk: HouseSDK = {
    THREE,
    plan: frozenPlan,
    ft: (n: number) => num(n, 0) * FT,
    toWorld: (x: number, y: number, h = 0) => w3(num(x, 0), num(y, 0), num(h, 0)),
    mat: guard("mat", (spec: MaterialSpec) => ctx.mats.get(spec), () => ctx.mats.get("plaster_white")),
    structure: guard("structure", (opts?: StructureOpts) => buildStructure(ctx, opts ?? {}), () => undefined),
    room: guard("room", roomHandle, () => roomHandle("")),
    face: guard(
      "face",
      (s: Side, level?: string) => ctx.model.face(normSide(s), level && plan.levelById.has(level) ? level : undefined),
      () => ({ side: "front" as Side, from_ft: 0, to_ft: plan.plotW, plane_ft: 0, bottom_h_ft: 0, top_h_ft: 20 }),
    ),
    facade: wrapNS("facade", facade as unknown as Record<string, (...a: unknown[]) => unknown>) as unknown as HouseSDK["facade"],
    interior: wrapNS("interior", interior as unknown as Record<string, (...a: unknown[]) => unknown>) as unknown as HouseSDK["interior"],
    furnish: guard("furnish", (item: FurnitureType, o: FurnishOptions) => furnish(ctx, item, o), () => new THREE.Group()),
    auto_furnish: guard("auto_furnish", (room: string, o?: { style?: "modern" | "classic" | "minimal" | "traditional"; palette?: string[] }) => autoFurnish(ctx, room, o), () => undefined),
    landscape: wrapNS("landscape", landscape as unknown as Record<string, (...a: unknown[]) => unknown>) as unknown as HouseSDK["landscape"],
    lights: wrapNS("lights", {
      sun: (o?: unknown) => addSun(ctx, (o ?? {}) as { hour?: number }),
      interior: (o?: unknown) => interiorLights(ctx, (o ?? {}) as { intensity?: number }),
      point: (o: unknown) => pointLight(ctx, o as Parameters<typeof pointLight>[1]),
    }) as unknown as HouseSDK["lights"],
    add: guard(
      "add",
      (obj: THREE.Object3D, tags: Tags) => {
        if (!obj || !(obj as THREE.Object3D).isObject3D) {
          warn("s.add(): not a THREE.Object3D, skipped");
          return new THREE.Group();
        }
        const t = (tags ?? {}) as Partial<Tags>;
        const layer = LAYERS.includes(String(t.layer)) ? t.layer : ctx.layer;
        obj.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            const mat = m.material as THREE.Material;
            if (!(mat && (mat as THREE.MeshStandardMaterial).transparent)) m.castShadow = true;
            m.receiveShadow = true;
          }
        });
        ctx.add(obj, { ...t, layer, kind: t.kind ?? "custom" });
        if (t.level === undefined) applyTags(obj, { level: guessLevel(ctx, obj) });
        return obj;
      },
      () => new THREE.Group(),
    ),
  };
  return lenient(sdk, "s") as HouseSDK;
}

function guessLevel(ctx: BuildCtx, obj: THREE.Object3D): string {
  obj.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(obj);
  if (b.isEmpty()) return ctx.plan.levels[0].id;
  const h = (b.min.y + b.max.y) / 2 / FT;
  let id = ctx.plan.levels[0].id;
  for (const l of ctx.plan.levels) if (h >= l.elev - 0.5) id = l.id;
  return id;
}

/** Wrap every function of a namespace so one bad call warns instead of aborting the section. */
function wrapNS(ns: string, api: Record<string, (...a: unknown[]) => unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, fn] of Object.entries(api)) {
    out[k] = (...a: unknown[]) => {
      try {
        return fn(...a);
      } catch (e) {
        warn(`s.${ns}.${k}() failed: ${(e as Error)?.message ?? e}`);
        return undefined;
      }
    };
  }
  return lenient(out, `s.${ns}`) as Record<string, unknown>;
}

/** Null object: absorbs any property access / call (for APIs that do not exist). */
function nothing(path: string): unknown {
  const fn = function () {
    return nothing(path + "()");
  };
  return new Proxy(fn, {
    get: (_t, p) => {
      if (p === "then" || typeof p === "symbol") return undefined;
      if (p === "isObject3D" || p === "isMaterial") return false;
      return nothing(`${path}.${String(p)}`);
    },
    apply: () => nothing(path + "()"),
    construct: () => nothing(`new ${path}`) as object,
  });
}

/** Proxy that turns unknown properties into warned no-ops (Argon sometimes invents APIs). */
function lenient<T extends object>(target: T, path: string): T {
  return new Proxy(target, {
    get(t, p, r) {
      if (typeof p === "symbol" || p in t) return Reflect.get(t, p, r);
      if (p === "then" || p === "toJSON") return undefined;
      warn(`${path}.${String(p)} is not part of the House SDK; ignored`);
      return nothing(`${path}.${String(p)}`);
    },
  });
}

/** THREE namespace for sections: unknown members become null objects instead of crashing. */
export function lenientThree(): typeof THREE {
  return new Proxy(THREE as unknown as object, {
    get(t, p, r) {
      if (typeof p === "symbol" || p in t) return Reflect.get(t, p, r);
      if (p === "then") return undefined;
      warn(`THREE.${String(p)} does not exist in three r186; ignored`);
      return nothing(`THREE.${String(p)}`);
    },
  }) as typeof THREE;
}

function structuredCloneSafe(p: BuildingPlan): BuildingPlan {
  try {
    return structuredClone(p);
  } catch {
    return JSON.parse(JSON.stringify(p ?? {}));
  }
}
function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
  }
  return o;
}
