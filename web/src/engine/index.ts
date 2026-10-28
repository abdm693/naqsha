/**
 * House SDK engine: public interface (track: ENGINE). See contracts/web-modules.md and contracts/house-sdk.d.ts.
 */
import * as THREE from "three";
import type { BuildingPlan } from "@contracts/plan";
import type { Layer } from "@contracts/house-sdk";
import type { AsBuiltSummary } from "@contracts/api-types";
import { buildHouseImpl } from "./build";
import { defaultDesignImpl } from "./default-design";

export interface DesignSectionSrc { name: string; layer: Layer; body: string }

export interface SectionResult { name: string; layer: Layer; ok: boolean; error?: string; ms: number; objects: number }

export interface BuildResult {
  root: THREE.Group;
  summary: AsBuiltSummary;
  sections: SectionResult[];
  levels: { id: string; name: string; floor_y: number; top_y: number }[];
  colliders: THREE.Mesh[];
  spawn: { position: THREE.Vector3; lookAt: THREE.Vector3 };
  /**
   * (additive) Where the walk lands on each floor: the stair's top landing on upper floors (the foot of the stair on
   * the lowest one), at eye height (1.6 m), looking into the floor rather than at a wall. Use for "go to floor".
   */
  landings?: { level: string; position: THREE.Vector3; lookAt: THREE.Vector3 }[];
  dispose(): void;
}

const SECTION_RE = /^\s*\/\/\s*@section\s+([A-Za-z0-9_]+)\s*(?:\[(\w+)\])?\s*$/;
const END_RE = /^\s*\/\/\s*@end\b.*$/;
const LAYERS: Layer[] = ["structure", "facade", "interior", "furniture", "landscape", "lighting", "custom"];

function layerFor(name: string, given?: string): Layer {
  if (given && LAYERS.includes(given as Layer)) return given as Layer;
  const n = name.toLowerCase();
  if (n.startsWith("structure")) return "structure";
  if (n.startsWith("facade")) return "facade";
  if (n.startsWith("interior")) return "interior";
  if (n.startsWith("furnish")) return "furniture";
  if (n.startsWith("landscape")) return "landscape";
  if (n.startsWith("light")) return "lighting";
  return "custom";
}

/** Parse design.js text ("// @section name [layer] … // @end"). Lenient: ignores junk outside sections. */
export function parseDesign(code: string): DesignSectionSrc[] {
  const out: DesignSectionSrc[] = [];
  let cur: DesignSectionSrc | null = null;
  for (const line of String(code ?? "").split(/\r?\n/)) {
    const m = line.match(SECTION_RE);
    if (m) { if (cur) out.push(cur); cur = { name: m[1], layer: layerFor(m[1], m[2]), body: "" }; continue; }
    if (END_RE.test(line)) { if (cur) out.push(cur); cur = null; continue; }
    if (cur) cur.body += line + "\n";
  }
  if (cur) out.push(cur);
  return out;
}

/** Serialize back (used for display/download). */
export function serializeDesign(sections: DesignSectionSrc[]): string {
  return (sections ?? [])
    .map((s) => {
      const body = String((s as DesignSectionSrc & { code?: string }).body ?? (s as { code?: string }).code ?? "");
      return `// @section ${s.name} [${s.layer}]\n${body.replace(/\n$/, "")}\n// @end`;
    })
    .join("\n");
}

/** Blank out comments and string literal text (template ${…} expressions are kept) so the screen sees only code. */
function codeOnly(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === "/" && d === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && d === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      out += " ";
      continue;
    }
    if (c === '"' || c === "'") {
      i++;
      while (i < n && src[i] !== c && src[i] !== "\n") i += src[i] === "\\" ? 2 : 1;
      i++;
      out += '""';
      continue;
    }
    if (c === "`") {
      i++;
      out += "`";
      while (i < n && src[i] !== "`") {
        if (src[i] === "\\") { i += 2; continue; }
        if (src[i] === "$" && src[i + 1] === "{") {
          let depth = 1;
          i += 2;
          out += "${";
          while (i < n && depth > 0) {
            if (src[i] === "{") depth++;
            else if (src[i] === "}") depth--;
            if (depth > 0) out += src[i];
            i++;
          }
          out += "}";
          continue;
        }
        i++;
      }
      i++;
      out += "`";
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

const BANNED: [RegExp, string][] = [
  [/\bfetch\b/, "fetch"],
  [/\bXMLHttpRequest\b/, "XMLHttpRequest"],
  [/\bWebSocket\b/, "WebSocket"],
  [/\bEventSource\b/, "EventSource"],
  [/\bimport\s*\(/, "import("],
  [/(^|[;\n])\s*import\s/, "import"],
  [/\beval\s*\(/, "eval("],
  [/\bFunction\b/, "Function("],
  [/\bdocument\s*[.[]/, "document."],
  [/\bwindow\s*[.[]/, "window."],
  [/\b(localStorage|sessionStorage)\b/, "localStorage"],
  [/\bindexedDB\b/, "indexedDB"],
  [/\bnavigator\s*[.[]/, "navigator."],
  [/\bpostMessage\b/, "postMessage"],
  [/\bglobalThis\b/, "globalThis"],
  [/\bconstructor\b/, "constructor"],
  [/__proto__/, "__proto__"],
  [/\b(setTimeout|setInterval|requestAnimationFrame|importScripts)\b/, "timers"],
  [/\b(self|top|parent|frames|opener)\s*[.[]/, "global object"],
  [/\blocation\s*[.[=]/, "location"],
  [/\bcookie\b/, "document.cookie"],
];

/** Static safety screen; returns the reasons a section is rejected (empty = OK). */
export function screenSection(body: string): string[] {
  const code = codeOnly(String(body ?? ""));
  const out: string[] = [];
  for (const [re, label] of BANNED) if (re.test(code)) out.push(`uses forbidden API: ${label}`);
  return out;
}

/** Fallback design when Argon code is missing: structure + auto_furnish every room + landscape + lights. */
export function defaultDesign(plan: BuildingPlan): DesignSectionSrc[] {
  // also carry `code` (alias of `body`) so the result can be used as API DesignSection[] directly
  return defaultDesignImpl(plan).map((s) => Object.assign(s, { code: s.body }));
}

/** Build the house. Runs sections in order and calls onSection after each (the viewer re-renders = "layers assembling"). */
export async function buildHouse(
  plan: BuildingPlan,
  sections: DesignSectionSrc[],
  opts?: { onSection?: (r: SectionResult, root: THREE.Group) => void | Promise<void>; quality?: "high" | "medium" },
): Promise<BuildResult> {
  return buildHouseImpl(plan, sections, opts ?? {}, screenSection);
}

// ── extra helpers for the viewer (additive; not required by the contract) ───────────────────────────────
/** Tags for a raycast hit, resolving merged meshes to the original element via userData.parts. */
export { resolveHit } from "./core/tags";
/** Move the sun light (userData.kind === "sun") to a new hour; also see setTimeOfDay for lamps/glows. */
export { updateSun, sunDirection } from "./lights";
/** Scale emissive fixtures and fake light pools for a time of day (call together with updateSun). */
export { setTimeOfDay } from "./build";
/** Procedural textures stream in from a worker pool after buildHouse resolves; await this before captures. */
export { texturesReady } from "./materials/library";
