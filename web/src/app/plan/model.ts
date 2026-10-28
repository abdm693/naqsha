/**
 * Reading a BuildingPlan the way people talk about a house: room categories and colours, short names
 * that never degrade into nonsense ("Powder", never "ROOM"), what each room opens to, floor names and
 * the room schedule. Units are plan feet (contracts/plan.ts).
 */
import type { BuildingPlan, Level, Opening, Room, RoomType } from "@contracts/plan";
import type { Comment } from "@contracts/api-types";

export type Category = "bed" | "wet" | "living" | "service" | "outdoor";

export const CATEGORY: Record<RoomType, Category> = {
  bedroom: "bed",
  master_bedroom: "bed",
  guest_bedroom: "bed",
  dressing: "bed",
  study: "bed",
  bath: "wet",
  powder: "wet",
  laundry: "wet",
  kitchen: "wet",
  dirty_kitchen: "wet",
  drawing: "living",
  lounge: "living",
  dining: "living",
  prayer: "living",
  lobby: "living",
  corridor: "living",
  stair: "living",
  store: "service",
  servant: "service",
  porch: "service",
  garage: "service",
  driveway: "service",
  balcony: "outdoor",
  terrace: "outdoor",
  courtyard: "outdoor",
  lawn: "outdoor",
  open_space: "outdoor",
};

/** Plan fills (DESIGN.md --color-plan-*), as literal colours so print and SVG export keep them. */
export const FILL: Record<Category, string> = {
  bed: "#EEF1FE",
  wet: "#E6F1F5",
  living: "#F2F2EF",
  service: "#ECECE8",
  outdoor: "#E8F1E9",
};

/** Room types without walls on their exterior edges. */
export const OPEN_TYPES = new Set<RoomType>(["porch", "balcony", "terrace", "lawn", "driveway", "courtyard", "open_space"]);
/** Site areas drawn only on the ground level. */
export const SITE_TYPES = new Set<RoomType>(["lawn", "driveway", "courtyard", "open_space"]);
/** Rooms people live in (bedrooms must be independent). */
export const BEDROOMS = new Set<RoomType>(["bedroom", "master_bedroom", "guest_bedroom"]);
export const CIRCULATION = new Set<RoomType>(["corridor", "lobby", "stair", "lounge", "dining", "balcony", "terrace", "porch", "courtyard"]);
export const DOOR_TYPES = new Set<Opening["type"]>(["main_door", "door", "double_door", "sliding_door", "arch", "garage_door"]);

/** Proper names that keep their capital inside a sentence ("Spanish veranda", "Johar Town"). */
const PROPER = new Set(["Spanish", "Mughal", "Moorish", "Mediterranean", "Lahore", "Karachi", "Islamabad", "Bahria", "Gulberg", "Punjab", "Eid", "Quran", "Urdu", "English"]);

/**
 * "Master Bedroom" → "Master bedroom" (keeps "TV", numbers and proper nouns that are all caps, also inside
 * punctuation: "(LDA)", "LDA:").
 */
export function sentenceCase(name: string): string {
  const words = name.trim().split(/\s+/);
  const keep = (w: string) => {
    const letters = w.replace(/[^A-Za-z]/g, "");
    return (letters.length >= 2 && letters === letters.toUpperCase()) || /\d/.test(w) || PROPER.has(letters);
  };
  return words.map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : keep(w) ? w : w.toLowerCase())).join(" ");
}

/** Places that keep their capitals inside display text ("Johar Town", "DHA Phase 6"). */
const PLACE = /\b(Town|Phase|Lahore|Gulberg|Bahria|Johar|Defence|Cantt|Avenue|Garden|Colony|Society|Valley|City)\b/;

/**
 * Display text in sentence case when it arrived in Title Case ("Modern Contemporary" → "Modern contemporary",
 * "Separate Dirty Kitchen" → "Separate dirty kitchen"); mixed text, place names and acronyms are left as they are.
 */
export function untitle(text: string): string {
  const t = text.trim();
  const words = t.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w));
  if (words.length < 2 || PLACE.test(t)) return t;
  const titled = words.every((w) => /^[A-Z]/.test(w) || /^(and|or|of|the|a|an|in|on|to|with|for)$/.test(w));
  return titled ? sentenceCase(t) : t;
}

/**
 * A name inside a sentence: "Master Bedroom" → "master bedroom", "TV Lounge" → "TV lounge". The first letter is
 * lowered only when the second isn't a capital (so "TV" stays).
 */
export function inSentence(name: string): string {
  const s = sentenceCase(name);
  return /^.[A-Z]/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1);
}

/**
 * Name forms for a room label, longest first. A label never abbreviates ("D. kitchen") and never drops the owner
 * ("Bedroom" for "Parents' bedroom"): the full name in sentence case, and only a trailing "room" may go ("Drawing
 * room" → "Drawing"). A name that still doesn't fit wraps onto two lines or gets a lettered key (labels.ts).
 */
export function nameForms(r: Room, taken: Set<string> = new Set()): string[] {
  const full = sentenceCase(r.name);
  const out: string[] = [full];
  const words = full.split(" ");
  if (words.length > 1 && /^room$/i.test(words[words.length - 1])) out.push(words.slice(0, -1).join(" "));
  // Never let a shorter form collide with another room's full name.
  return [...new Set(out)].filter((c, i) => i === 0 || !taken.has(c.toLowerCase())).filter((c) => !/^(room|space|area|hall)$/i.test(c));
}

export function levelsOf(plan: BuildingPlan): Level[] {
  return [...plan.levels].sort((a, b) => a.index - b.index);
}

/** "G", "1", "2", "R": the floor-stack label. */
export function levelKey(l: Level, all: Level[]): string {
  if (l.id === "roof" || /roof/i.test(l.name)) return "R";
  if (l.index < 0) return "B";
  if (l.index === 0) return "G";
  const top = Math.max(...all.map((x) => x.index));
  if (l.index === top && !all.some((x) => x.id === "roof")) return "R";
  return String(l.index);
}

export function levelName(l: Level): string {
  return sentenceCase(l.name.replace(/\s*plan$/i, ""));
}

export function isRoofLevel(plan: BuildingPlan, l: Level): boolean {
  const top = Math.max(...plan.levels.map((x) => x.index));
  return l.id === "roof" || (l.index === top && !plan.rooms.some((r) => r.level === l.id && !SITE_TYPES.has(r.type) && !OPEN_TYPES.has(r.type)));
}

export const area = (r: Room) => r.rect.w * r.rect.d;

/** Door-like connections of a room: [neighbour id, opening]. "exterior" for outside. */
export function connections(plan: BuildingPlan, room: Room): { other: string; via: Opening["type"] | "open" }[] {
  const out: { other: string; via: Opening["type"] | "open" }[] = [];
  for (const o of plan.openings) {
    if (!DOOR_TYPES.has(o.type) || o.level !== room.level) continue;
    if (o.between[0] === room.id) out.push({ other: o.between[1], via: o.type });
    else if (o.between[1] === room.id) out.push({ other: o.between[0], via: o.type });
  }
  for (const r of plan.rooms) {
    if (r.id === room.id || r.level !== room.level) continue;
    if (room.open_to?.includes(r.id) || r.open_to?.includes(room.id)) out.push({ other: r.id, via: "open" });
  }
  return out;
}

/** "Kitchen" → "kitchen" inside a sentence; "TV lounge" stays as it is. */
function inline(name: string): string {
  return /^[A-Z]{2}/.test(name) ? name : name.charAt(0).toLowerCase() + name.slice(1);
}

/** "Corridor, own bath", the "Opens to" line for a room (DESIGN.md Plan: room hover). */
export function opensTo(plan: BuildingPlan, room: Room): string[] {
  const byId = new Map(plan.rooms.map((r) => [r.id, r]));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of connections(plan, room)) {
    if (seen.has(c.other)) continue;
    seen.add(c.other);
    if (c.other === "exterior") {
      out.push(room.type === "porch" || room.type === "lobby" || c.via === "main_door" ? "the street side" : "outside");
      continue;
    }
    const other = byId.get(c.other);
    if (!other) continue;
    const otherDoors = connections(plan, other).filter((x) => x.other !== "exterior" && x.other !== room.id);
    // "Own" only for a bedroom's suite (its bath or dressing); a lounge's neighbouring bath is just "Bath 2".
    const own = BEDROOMS.has(room.type) && (other.type === "bath" || other.type === "dressing") && otherDoors.every((x) => ["bath", "dressing"].includes(byId.get(x.other)?.type ?? ""));
    out.push(own ? `own ${other.type === "bath" ? "bath" : "dressing"}` : inline(sentenceCase(other.name)));
  }
  // Exterior views: windows onto the outside are not "opens to".
  return out.map((s, i) => (i === 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s));
}

/** The level a world-space comment anchor sits on (anchor.level wins; else by height). */
export function anchorLevel(plan: BuildingPlan, c: Comment): string | undefined {
  if (c.anchor.level && plan.levels.some((l) => l.id === c.anchor.level)) return c.anchor.level;
  const hFt = c.anchor.position[1] / 0.3048;
  const lv = levelsOf(plan);
  let best: Level | undefined = lv[0];
  for (const l of lv) if (hFt >= l.elevation_ft - 0.5) best = l;
  return best?.id;
}

/** World meters (x, -y) → plan feet. */
export function anchorPlanXY(c: Comment): [number, number] {
  return [c.anchor.position[0] / 0.3048, -c.anchor.position[2] / 0.3048];
}

/** Rooms of a level that carry floor area (for schedules and totals). */
export function roomsOn(plan: BuildingPlan, levelId: string): Room[] {
  return plan.rooms.filter((r) => r.level === levelId && !SITE_TYPES.has(r.type));
}

/** Covered area of a level: rooms with a roof over them (porches count, balconies and terraces don't). */
export function coveredArea(plan: BuildingPlan, levelId: string): number {
  return roomsOn(plan, levelId)
    .filter((r) => !OPEN_TYPES.has(r.type) || r.type === "porch")
    .reduce((s, r) => s + area(r), 0);
}

/** Room-size changes between two plans: id → delta sq ft (only rooms in both, |Δ| ≥ 1). New rooms are "new". */
/**
 * The rooms a change touched: room ids as they are, an opening (f_master_w) → the room(s) on either side of it,
 * a stair → its stair hall. Each room carries the summaries of the changes that touched it.
 */
export function changedRooms(plan: BuildingPlan, changes: { summary: string; kind: string; targets: string[] }[] | undefined): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (id: string, summary: string) => {
    if (!plan.rooms.some((r) => r.id === id)) return;
    const list = out.get(id) ?? [];
    if (!list.includes(summary)) list.push(summary);
    out.set(id, list);
  };
  for (const c of changes ?? []) {
    if (c.kind !== "plan") continue;
    const summary = cleanSummary(c.summary);
    for (const t of c.targets) {
      if (plan.rooms.some((r) => r.id === t)) {
        add(t, summary);
        continue;
      }
      const o = plan.openings.find((x) => x.id === t);
      if (o) {
        for (const side of o.between) if (side !== "exterior") add(side, summary);
        continue;
      }
      const st = plan.stairs.find((x) => x.id === t);
      if (st) {
        const hall = plan.rooms.find((r) => r.level === st.from_level && r.type === "stair" && st.rect.x >= r.rect.x - 0.5 && st.rect.y >= r.rect.y - 0.5 && st.rect.x + st.rect.w <= r.rect.x + r.rect.w + 0.5 && st.rect.y + st.rect.d <= r.rect.y + r.rect.d + 0.5);
        if (hall) add(hall.id, summary);
        continue;
      }
      // An id that names a room by prefix (f_master_w2 → f_master).
      const base = plan.rooms.filter((r) => t.startsWith(`${r.id}_`)).sort((a, b) => b.id.length - a.id.length)[0];
      if (base) add(base.id, summary);
    }
  }
  return out;
}

/** "Widened the window (Master w)" → "Widened the window": ids and id-like asides never reach people. */
export function cleanSummary(s: string): string {
  return s
    .replace(/\s*\((?:[a-z]_[\w]+|[A-Z][a-z]+(?: [a-z0-9]+)*?(?: w\d*| d\d*)|[\w]+_[\w]+)\)/g, "")
    .replace(/\b[gfrb]_[a-z0-9_]+\b/g, (id) => id.replace(/^[gfrb]_/, "").replace(/_/g, " "))
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;])/g, "$1")
    .trim();
}

export function areaDeltas(before: BuildingPlan | undefined, after: BuildingPlan, ids: string[]): Map<string, number | "new"> {
  const out = new Map<string, number | "new">();
  for (const id of ids) {
    const a = after.rooms.find((r) => r.id === id);
    if (!a) continue;
    const b = before?.rooms.find((r) => r.id === id);
    if (!b) out.set(id, "new");
    else {
      const d = Math.round(area(a) - area(b));
      if (Math.abs(d) >= 1) out.set(id, d);
    }
  }
  return out;
}

/** DESIGN.md author hues (literal, so they work in SVG, print and inline styles). */
export const AUTHOR_HUES = ["#0D7C72", "#6A4FD6", "#C23F78", "#A8641A", "#4F6378", "#2F7A3A"];
export const hueColor = (c: Comment) => AUTHOR_HUES[(authorHue(c) - 1) % 6];

/** Stable author hue (1..6) for pins and avatars. */
export function authorHue(c: Comment): number {
  const key = c.author?.id || c.author?.name || "";
  if (!key) return 1;
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return (h % 6) + 1;
}
