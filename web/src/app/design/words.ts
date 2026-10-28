/**
 * Plain words for what Naqsha is doing. The pipeline speaks in stages, ids and section names
 * ("Argon is fixing the plan (attempt 2)…", "Rewriting furnish_g_lounge…"); people should read
 * "Fixing 2 issues" and "Rearranging the furniture in the lounge". DESIGN.md §8: no model names,
 * no code words, no ids.
 */
import type { BuildingPlan, ComplianceReport, Room } from "@contracts/plan";

export type NamedStage = "plan" | "check" | "review" | "build";

export const STAGES: { id: NamedStage; label: string }[] = [
  { id: "plan", label: "Plan" },
  { id: "check", label: "Check" },
  { id: "review", label: "Review" },
  { id: "build", label: "Build" },
];

/** Map a pipeline stage to one of the four named stages people see. */
export function namedStage(stage: string | null | undefined): NamedStage | null {
  switch (stage) {
    case "plan":
    case "fix":
      return "plan";
    case "compliance":
    case "check":
      return "check";
    case "review":
    case "critique":
    case "self_review":
    case "self-review":
      return "review";
    case "build":
    case "save":
      return "build";
    default:
      return null;
  }
}

export const failures = (r: ComplianceReport | null | undefined) => (r ? r.checks.filter((c) => c.status === "fail").length : 0);

const LEVEL_WORD: Record<string, string> = { b: "basement", g: "ground floor", f: "first floor", s: "second floor", t: "third floor", r: "roof" };

function words(id: string): string {
  return id.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

/** "TV Lounge" → "TV lounge", "Front Balcony" → "front balcony"; names with numbers stay as they are. */
export function inSentence(name: string): string {
  if (/\d/.test(name)) return name;
  return name
    .split(" ")
    .map((w) => (/^[A-Z][a-z]+$/.test(w) ? w.toLowerCase() : w))
    .join(" ");
}

/** "the TV lounge", but "Bedroom 4" (numbered rooms read as names). */
export function theRoom(name: string): string {
  return /\d/.test(name) ? name : `the ${inSentence(name)}`;
}

export function roomById(plan: BuildingPlan | undefined, id: string): Room | undefined {
  return plan?.rooms.find((r) => r.id === id);
}

/** A room id as a name: the plan's name when known, else the id in words without its level prefix. */
export function roomName(plan: BuildingPlan | undefined, id: string): string {
  const r = roomById(plan, id);
  if (r) return r.name;
  const m = id.match(/^([bgfstr])_(.+)$/);
  const base = words(m ? m[2] : id);
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/** What a design section draws, in words: "furnish_g_lounge" → "the furniture in the TV lounge". */
export function sectionPhrase(name: string, plan?: BuildingPlan): string {
  const n = name.toLowerCase();
  let m = n.match(/^furnish(?:ing)?_(.+)$/);
  if (m) return `the furniture in ${theRoom(roomName(plan, m[1]))}`;
  m = n.match(/^interior_(.+)$/);
  if (m) {
    const lvl = plan?.levels.find((l) => l.id === m![1]);
    return `the interiors on the ${inSentence(lvl?.name ?? `${m[1]} floor`).replace(/ floor floor$/, " floor")}`;
  }
  m = n.match(/^facade(?:_(.+))?$/);
  if (m) return m[1] ? `the ${words(m[1])} on the facade` : "the facade";
  if (/^structure/.test(n)) return "the walls, doors and windows";
  if (/^(landscape|site|garden)/.test(n)) return "the garden and the street";
  if (/^(light|lights|lighting)/.test(n)) return "the lighting";
  if (/^roof/.test(n)) return "the roof";
  if (/^stair/.test(n)) return "the stairs";
  m = n.match(/^([bgfstr])_(.+)$/);
  if (m) return theRoom(roomName(plan, n));
  return `the ${words(n)}`;
}

/** Things that look like ids or section names inside a sentence. */
const ID_SRC = "furnish(?:ing)?_[a-z0-9_]+|interior_[a-z0-9_]+|facade(?:_[a-z0-9_]+)?|structure|landscape(?:_[a-z0-9_]+)?|lighting|[bgfstr]_[a-z0-9_]+";
const ID_RE = new RegExp(`\\b(?:${ID_SRC})\\b`, "g");
const isId = (s: string) => new RegExp(`^(?:${ID_SRC})$`).test(s);

/** Rewrite one pipeline line for people: no model name, no ids, no "(s)". */
export function humanize(message: string, plan?: BuildingPlan): string {
  let s = message.trim();
  if (!s) return s;
  // Plurals written as "comment(s)".
  s = s.replace(/(\d+)\s+(\w+?)\(s\)/g, (_, n: string, w: string) => `${n} ${w}${n === "1" ? "" : "s"}`).replace(/\(s\)/g, "s");
  // "Retrying with the direct reviser (KeyError)…" and similar internals.
  if (/retrying with|fallback|direct reviser/i.test(s)) return "Taking another approach…";
  if (/^resolving comment/i.test(s)) return "Writing up what changed…";
  s = s.replace(/\s*\((?:[A-Z][A-Za-z]+Error|attempt \d+)\)/g, "");
  // Remove the model's name: "Argon is laying out…" → "Laying out…", "Argon's" → "My".
  s = s.replace(/^Argon(?:,? the AI architect,?)? (?:is|will) /i, "").replace(/^Argon /i, "").replace(/\bArgon's\b/g, "my").replace(/\bArgon\b/g, "Naqsha");
  s = s.replace(/\bLDA regulations\b/g, "LDA rules");
  // Verbs that come before a section name read better as plain actions.
  s = s.replace(/^Reading (\S+?)(…|\.\.\.)?$/i, (all, id: string) => (isId(id) ? `Looking at ${sectionPhrase(id, plan)}…` : all));
  s = s.replace(/^(?:Rewriting|Writing|Rebuilding) (\S+?)(…|\.\.\.)?$/i, (all, id: string) => (isId(id) ? `Redrawing ${sectionPhrase(id, plan)}…` : all));
  s = s.replace(ID_RE, (id) => sectionPhrase(id, plan).replace(/^the /, ""));
  s = s.replace(/\s{2,}/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "Fixed 5 → 1 → 0" (the compliance fix loop). */
export function fixLoopLine(fails: number[]): string | null {
  if (fails.length < 2) return null;
  return `${fails[fails.length - 1] === 0 ? "Fixed" : "Fixing"} ${fails.join(" → ")}`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "Revised: bedroom 2 deeper, lounge window wider" from a version summary, without ids or "v2:" prefixes. */
export function versionLine(summary?: string): string {
  if (!summary) return "A revision";
  // No status suffix ("· 36/36 LDA · 8/8 livable") and no quotes around a typed request: words, not data.
  const s = summary
    .replace(/^v\d+:\s*/i, "")
    .replace(/\.\s*;\s*/g, "; ")
    .replace(/(^|\s*·\s*)\d+\/\d+ (LDA|livable)\b.*$/i, "")
    .replace(/[“”"]/g, "")
    .trim();
  if (!s) return "A revision";
  if (/^\d+ spaces?, \d+ code sections?$/i.test(s)) return "A fresh design";
  const first = s.split(";")[0].replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim().replace(/[.,]$/, "");
  return first.length > 60 ? `${first.slice(0, 58).replace(/[\s,;:]+\S*$/, "")}…` : first;
}

