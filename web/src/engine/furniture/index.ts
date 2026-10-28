/** Furniture: s.furnish() and s.auto_furnish(). */
import type * as THREE from "three";
import type { FurnishOptions, FurnitureType } from "@contracts/house-sdk";
import type { BuildCtx } from "../core/ctx";
import { furnishImpl } from "./place";
import { autoFurnishImpl } from "./auto";

export function furnish(ctx: BuildCtx, item: FurnitureType, o: FurnishOptions): THREE.Object3D {
  return furnishImpl(ctx, item, o ?? ({} as FurnishOptions)).group;
}

export function autoFurnish(ctx: BuildCtx, room: string, o?: { style?: "modern" | "classic" | "minimal" | "traditional"; palette?: string[] }): void {
  autoFurnishImpl(ctx, room, o);
}
