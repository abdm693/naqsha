/**
 * Clear concept names (DESIGN.md "Concepts"): originals are A, B, C… in the order they were drawn; remixes take their
 * parent's letter and a number in order (A1, A2), and every concept gets a short human name, "Stone and teak" or,
 * for a remix, what was asked for ("Darker glass"). Prompts and model names are never shown.
 */
import type { Concept } from "@contracts/api-types";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

const MATERIALS: [RegExp, string][] = [
  [/\bstone\b/i, "stone"],
  [/\bteak\b/i, "teak"],
  [/\b(timber|wood(en)?)\b/i, "timber"],
  [/\bbrick\b/i, "brick"],
  [/\bjaali\b/i, "jaali"],
  [/\bmarble\b/i, "marble"],
  [/\bterracotta|clay tile/i, "terracotta"],
  [/\bconcrete\b/i, "concrete"],
  [/\bplaster|whitewash|white volumes/i, "white plaster"],
  [/\bglass\b/i, "glass"],
  [/\bsteel\b/i, "steel"],
  [/\bfins?\b|battens|louv(er|re)s?/i, "fins"],
  [/\barch(es)?\b/i, "arches"],
];

function capital(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The concept's own name ("Floating Brick Box") when the API gave one, else "Stone and teak" from its prompt. */
export function conceptName(c: Concept, fallbackIndex = 0): string {
  const title = c.title?.trim();
  if (title && !c.instruction?.trim()) return title.length > 40 ? `${title.slice(0, 38).replace(/[\s,;:]+\S*$/, "")}…` : title;
  if (c.instruction?.trim()) {
    const t = c.instruction.trim().replace(/[.!]+$/, "");
    return capital(t.length > 34 ? `${t.slice(0, 32).replace(/[\s,;:]+\S*$/, "")}…` : t);
  }
  const text = c.prompt ?? "";
  const found: { at: number; word: string }[] = [];
  for (const [re, word] of MATERIALS) {
    const m = text.match(re);
    if (m && m.index !== undefined && !found.some((f) => f.word === word)) found.push({ at: m.index, word });
  }
  found.sort((a, b) => a.at - b.at);
  if (found.length >= 2) return capital(`${found[0].word} and ${found[1].word}`);
  if (found.length === 1) return capital(found[0].word);
  return ["Calm volumes", "Deep shade", "Light and air", "Quiet frame"][fallbackIndex % 4];
}

export interface Labelled { concept: Concept; label: string; name: string }

const CUES: [RegExp, string][] = [
  [/cantilever/i, "cantilever"],
  [/jaali|screen/i, "screened"],
  [/courtyard/i, "courtyard"],
  [/pergola/i, "pergola"],
  [/double[- ]height/i, "double height"],
  [/balcon(y|ies)/i, "balconies"],
  [/frame/i, "deep frame"],
  [/golden hour|sunset|warm evening/i, "warm light"],
  [/dusk|twilight/i, "dusk"],
  [/overcast|morning/i, "soft light"],
  [/three-quarter|corner composition|angled/i, "angled view"],
];

/** Names for originals, kept distinct: "Stone and teak", "Stone and teak, cantilever". */
function distinctNames(list: Concept[]): string[] {
  const used = new Set<string>();
  return list.map((c, i) => {
    let name = conceptName(c, i);
    if (used.has(name.toLowerCase())) {
      const cue = CUES.find(([re, word]) => re.test(c.prompt ?? "") && !used.has(`${name}, ${word}`.toLowerCase()))?.[1];
      name = cue ? `${name}, ${cue}` : `${name}, take ${i + 1}`;
    }
    used.add(name.toLowerCase());
    return name;
  });
}

export function labelConcepts(concepts: Concept[]): Map<string, Labelled> {
  const out = new Map<string, Labelled>();
  const sorted = [...concepts].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const roots = sorted.filter((c) => !c.parent_id || !concepts.some((x) => x.id === c.parent_id));
  const names = distinctNames(roots);
  roots.forEach((c, i) => out.set(c.id, { concept: c, label: LETTERS[i % 26] + (i >= 26 ? String(Math.floor(i / 26) + 1) : ""), name: names[i] }));
  const counts = new Map<string, number>();
  for (const c of sorted) {
    if (out.has(c.id)) continue;
    const parent = out.get(c.parent_id!);
    const n = (counts.get(c.parent_id!) ?? 0) + 1;
    counts.set(c.parent_id!, n);
    out.set(c.id, { concept: c, label: `${parent?.label ?? "R"}${n}`, name: conceptName(c, n) });
  }
  return out;
}

export function nextRootLetter(concepts: Concept[], offset: number): string {
  const roots = concepts.filter((c) => !c.parent_id).length;
  return LETTERS[(roots + offset) % 26];
}
