/**
 * Optional engine helpers beyond the contract (engine/index.ts "extra helpers for the viewer"). Feature-detected
 * at runtime so the viewer works against the stub, the dev mock, or any engine version; when present they keep the
 * viewer's sun slider and captures exactly in step with what the engine itself does.
 */
import type * as THREE from "three";
import type { BuildingPlan } from "@contracts/plan";
import * as engine from "@/engine";

type Site = Pick<BuildingPlan, "site">;

export interface EngineExtras {
  updateSun?: (light: THREE.DirectionalLight, plan: Site, hour: number, hemi?: THREE.HemisphereLight | null) => void;
  sunDirection?: (plan: Site, hour: number) => { dir: THREE.Vector3; altitude: number };
  setTimeOfDay?: (root: THREE.Object3D, plan: Site, hour: number) => void;
  texturesReady?: () => Promise<unknown>;
}

const mod = engine as unknown as Record<string, unknown>;
const fn = <T>(k: string) => (typeof mod[k] === "function" ? (mod[k] as T) : undefined);

export const engineExtras: EngineExtras = {
  updateSun: fn("updateSun"),
  sunDirection: fn("sunDirection"),
  setTimeOfDay: fn("setTimeOfDay"),
  texturesReady: fn("texturesReady"),
};
