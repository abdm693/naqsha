/**
 * Mock fixtures. The plan, design.js and compliance report are copies of a real end-to-end Argon run
 * (contracts/fixtures/argon-v1-*, 10 marla Johar Town: 42/42 LDA checks, 23 sections) kept under ./data.
 */
import type { BuildingPlan } from "@contracts/plan";
import type { Layer } from "@contracts/house-sdk";
import type { DesignSection } from "@contracts/api-types";
import argonPlan from "./data/argon-v1-plan.json";
import argonDesign from "./data/argon-v1-design.js?raw";

export const ARGON_PLAN = argonPlan as unknown as BuildingPlan;

export function clonePlan(): BuildingPlan {
  return structuredClone(ARGON_PLAN);
}

const SECTION_RE = /^\s*\/\/\s*@section\s+([A-Za-z0-9_]+)\s*\[(\w+)\]\s*$/;
const END_RE = /^\s*\/\/\s*@end\s*$/;

export function parseSections(code: string): DesignSection[] {
  const out: DesignSection[] = [];
  let cur: DesignSection | null = null;
  for (const line of code.split(/\r?\n/)) {
    const m = line.match(SECTION_RE);
    if (m) {
      if (cur) out.push(cur);
      cur = { name: m[1], layer: m[2] as Layer, code: "" };
      continue;
    }
    if (END_RE.test(line)) {
      if (cur) out.push(cur);
      cur = null;
      continue;
    }
    if (cur) cur.code += line + "\n";
  }
  if (cur) out.push(cur);
  return out.map((s) => ({ ...s, code: s.code.replace(/\n+$/, "\n") }));
}

const FALLBACK_DESIGN = `// @section structure [structure]
s.structure({ exterior_wall: "plaster_white", window_frame: "metal_black", door: "wood_teak", railing: "glass" });
// @end
// @section landscape [landscape]
s.landscape.street({ road_width_ft: 40, neighbours: true, streetlights: true });
// @end
// @section lighting [lighting]
s.lights.sun({ hour: 17.5 });
s.lights.interior({ warmth: "warm" });
// @end
`;

export const ARGON_SECTIONS: DesignSection[] = (() => {
  const parsed = parseSections(argonDesign);
  return parsed.length ? parsed : parseSections(FALLBACK_DESIGN);
})();

/** Whole-section replacement used by the mock revision: prepend a revision note to the real section. */
export function revisedSection(name: string, note: string): DesignSection | null {
  const s = ARGON_SECTIONS.find((x) => x.name === name);
  if (!s) return null;
  return { ...s, code: `// Revision: ${note}\n${s.code}` };
}

export const CONCEPT_IMAGES = ["/mock/concept-1.jpg", "/mock/concept-2.jpg", "/mock/concept-3.jpg", "/mock/concept-4.jpg"];
export const REMIX_IMAGES = ["/mock/remix-1.jpg", "/mock/remix-2.jpg", "/mock/remix-3.jpg"];
export const RENDER_IMAGE = "/mock/render-1.jpg";
