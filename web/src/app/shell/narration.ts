/**
 * What Naqsha is doing right now, in one plain line for the dock ("Laying out the floors…", "Building 3D, 14 of 23"),
 * and what it last said. While Naqsha works, narration replaces the Next pill (DESIGN.md §5).
 */
import { useMemo } from "react";
import type { Project, Version } from "@contracts/api-types";
import type { ComplianceReport } from "@contracts/plan";
import { statusLine, summarize, type Summary } from "@/app/plan/compliance";
import { useProject, type Run } from "@/app/store/project";

export interface Narration {
  text: string;
  /** 0..1 when known. */
  progress?: number;
  kind: "intake" | "concepts" | "design" | "revise" | "night";
}

/** Room ids to names ("g_kitchen" → "Kitchen") from the current plan, for plain narration. */
let roomNames = new Map<string, string>();
export function setRoomNames(rooms: { id: string; name: string }[] | undefined) {
  roomNames = new Map((rooms ?? []).map((r) => [r.id, r.name]));
}

function roomWords(id: string): string {
  const named = roomNames.get(id);
  // "Master Bedroom" → "master bedroom", "TV Lounge" → "TV lounge", "Bedroom 2" → "bedroom 2"
  if (named) return named.split(" ").map((w) => (/^[A-Z][a-z]+$/.test(w) ? w.toLowerCase() : w)).join(" ");
  return id
    .replace(/^[gfrb]_/, "")
    .replace(/^bed(\d)/, "bedroom $1")
    .replace(/^bath(\d)/, "bath $1")
    .replace(/^corr$/, "passage")
    .replace(/_/g, " ");
}

/** "the kitchen", but "Bedroom 2" (numbered rooms read as names). */
function room(id: string): string {
  const w = roomWords(id);
  return /\d/.test(w) ? w.replace(/^\w/, (c) => c.toUpperCase()) : `the ${w}`;
}

/**
 * Plain words for what the API narrates: no codenames, no ids, no "sections".
 * "Reading furnish_g_kitchen…" → "Reading the kitchen furniture…", "Looking at g_lounge…" → "Looking at the TV lounge…".
 */
export function plain(text: string): string {
  return tidy(plainWords(text));
}

function plainWords(text: string): string {
  return text
    .replace(/\bArgon( is)?\b/g, "")
    .replace(/\bthe AI architect\b/gi, "Naqsha")
    .replace(/\bfurnish_([a-z0-9_]+)/g, (_, id: string) => `the furniture in ${room(id)}`)
    .replace(/\bfacade_([a-z0-9_]+)/g, (_, id: string) => `the ${id.replace(/_/g, " ")} facade`)
    .replace(/\binterior_([a-z0-9_]+)/g, (_, id: string) => `the ${roomWords(id)} interiors`)
    .replace(/\b(structure|landscape|lighting)\b(?= *[….]|$)/g, (m) => `the ${m}`)
    .replace(/\b[gfrb]_[a-z0-9_]+\b/g, (id) => room(id))
    .replace(/\b(\d+) (code )?sections?\b/g, (_, n: string) => `${n} ${n === "1" ? "part" : "parts"}`)
    .replace(/\bthe the\b/g, "the")
    .replace(/\s{2,}/g, " ")
    .replace(/^\s*[a-z]/, (c) => c.toUpperCase())
    .trim();
}

/** One mark at the end of a line, never two: "Drawing….", "Done.." and "Ready?." read "Drawing…", "Done.", "Ready?". */
export function tidy(text: string): string {
  return text
    .replace(/\.{3}/g, "…")
    .replace(/…[.…]+/g, "…")
    .replace(/([.!?])[.…]+/g, "$1")
    .replace(/\s+([.!?…,;:])/g, "$1");
}

function runLine(run: Run, kind: "design" | "revise"): Narration | null {
  if (run.status !== "running") return null;
  const last = [...run.items].reverse().find((i) => i.kind === "stage");
  const building = last?.kind === "stage" && last.stage === "build";
  const done = run.sections.length;
  const total = run.version?.sections.length ?? 0;
  if (building && done > 0) {
    return { kind, text: total ? `Building your home in 3D, ${done} of ${total}` : `Building your home in 3D, ${done} ${done === 1 ? "part" : "parts"} so far`, progress: total ? done / total : undefined };
  }
  if (last?.kind === "stage") return { kind, text: plain(last.message) || "Working…" };
  return { kind, text: kind === "design" ? "Reading the brief…" : "Reading your notes…" };
}

export function useNarration(): Narration | null {
  const intakeBusy = useProject((s) => s.intakeBusy);
  const conceptRun = useProject((s) => s.conceptRun);
  const design = useProject((s) => s.design);
  const revise = useProject((s) => s.revise);
  return useMemo(() => {
    const r = runLine(revise, "revise") ?? runLine(design, "design");
    if (r) return r;
    if (conceptRun?.running) {
      const done = conceptRun.slots.filter((x) => x.status !== "drawing").length;
      const n = conceptRun.slots.length;
      const what = conceptRun.baseId ? (n === 1 ? "a variation" : `${n} variations`) : n === 4 ? "four exteriors" : `${n} exteriors`;
      return { kind: "concepts", text: done ? `Drawing ${what}, ${done} of ${n} ready` : `Drawing ${what}…`, progress: done / n };
    }
    if (intakeBusy) return { kind: "intake", text: "Reading your message…" };
    return null;
  }, [intakeBusy, conceptRun, design, revise]);
}

/** Naqsha's most recent words in the conversation (for the dock line). */
export function useLastLine(): string | null {
  const messages = useProject((s) => s.messages);
  return useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === "assistant") return plain(messages[i].text);
    return null;
  }, [messages]);
}

/**
 * LDA and livable counts for a version (the current one unless `vid` is given), with what the 3D build found merged
 * in. A warning is never counted as a pass.
 */
export function complianceCounts(
  project: Project | null,
  versions: Record<string, Version>,
  asBuilt?: Record<string, ComplianceReport>,
  vid?: string | null,
): Summary | null {
  const id = vid ?? project?.current_version_id;
  const v = id ? versions[id] : undefined;
  if (!v?.compliance?.checks?.length) return null;
  return summarize(v.compliance, v.plan, id ? asBuilt?.[id] : undefined);
}

/** "36/36 LDA · 10/12 livable · 2 to check" for the title capsule: the one phrasing (compliance.statusLine). */
export function countsLine(s: Summary): string {
  return statusLine(s);
}
