/**
 * One wording for what goes on the roof, used everywhere it is named (the brief, "Understood", Concepts, Details,
 * the plan's roof labels and print): "Roof kept clear for solar", "Raised solar frame", "No solar",
 * "Blue plastic tank", "Concrete tank in the stair tower".
 */
import type { Brief } from "@contracts/api-types";

export type SolarChoice = NonNullable<Brief["solar"]>;
export type TankChoice = NonNullable<Brief["water_tank"]>;

export const SOLAR_LABEL: Record<SolarChoice, string> = {
  ready: "Roof kept clear for solar",
  panels: "Raised solar frame",
  none: "No solar",
};

export const TANK_LABEL: Record<TankChoice, string> = {
  plastic: "Blue plastic tank",
  concrete: "Concrete tank in the stair tower",
};

export function solarLabel(v: string | null | undefined): string | null {
  return v && v in SOLAR_LABEL ? SOLAR_LABEL[v as SolarChoice] : null;
}

export function tankLabel(v: string | null | undefined): string | null {
  return v && v in TANK_LABEL ? TANK_LABEL[v as TankChoice] : null;
}

/** The plan's roof (contracts/plan.ts): "panels" places the frame, "ready" keeps the area clear. */
export function planSolarLabel(mode: "ready" | "panels"): string {
  return mode === "panels" ? SOLAR_LABEL.panels : SOLAR_LABEL.ready;
}

/** A tank drawn on the plan: its material's name, or "Water tank" when the plan doesn't say. */
export function planTankLabel(material: "plastic" | "concrete" | undefined): string {
  return material ? TANK_LABEL[material] : "Water tank";
}

/**
 * Solar on a clear roof, from the clear area: about 1 panel per 20 sq ft at ~0.55 kW each (a 2.3 × 1.1 m panel with
 * walking room), so the brief's question and the compliance sheet quote the same kilowatts.
 */
export function solarFromArea(sqft: number): { count: number; kw: number } {
  const count = Math.max(0, Math.floor(sqft / 20));
  return { count, kw: Math.round(count * 0.55 * 10) / 10 };
}
