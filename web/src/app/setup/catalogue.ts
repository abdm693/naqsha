/**
 * The per-floor room program (DESIGN.md "Brief → Floors"): a Pakistani room catalogue with typical sizes,
 * how much of each floor a program uses, and the `Brief.floors` / `floor:` chip format (contracts/api.md):
 *   floors: [{ level: "ground", rooms: ["drawing", "kitchen", "dirty_kitchen", "bedroom:1", "bath:2"] }]
 *   chips:  "floor:ground=drawing,kitchen,dirty_kitchen,bedroom:1,bath:2"
 */
import type { Brief, Envelope } from "@contracts/api-types";

export type LevelId = "ground" | "first" | "second" | "roof";

export interface CatalogueItem {
  id: string;
  label: string;
  /** The room type the plan uses for it. */
  slug: string;
  /** Typical area on a 10 marla plot, sq ft (scaled with the plot). */
  area: number;
  /** Attached baths it brings. */
  baths: number;
  /** Floors it may go on. */
  on: LevelId[];
  /** Counts toward covered area (balconies only partly, terraces not at all). */
  cover: number;
  max: number;
  hint?: string;
}

const HOUSE: LevelId[] = ["ground", "first", "second"];

export const CATALOGUE: CatalogueItem[] = [
  { id: "master", label: "Master bed + bath", slug: "master_bedroom", area: 300, baths: 1, on: HOUSE, cover: 1, max: 2, hint: "With dressing" },
  { id: "bed", label: "Bed + bath", slug: "bedroom", area: 205, baths: 1, on: HOUSE, cover: 1, max: 5 },
  { id: "guest", label: "Guest room + bath", slug: "guest_bedroom", area: 195, baths: 1, on: HOUSE, cover: 1, max: 2 },
  { id: "drawing", label: "Drawing room", slug: "drawing", area: 230, baths: 0, on: HOUSE, cover: 1, max: 1, hint: "For guests" },
  { id: "dining", label: "Dining", slug: "dining", area: 165, baths: 0, on: HOUSE, cover: 1, max: 1 },
  { id: "lounge", label: "TV lounge", slug: "lounge", area: 220, baths: 0, on: HOUSE, cover: 1, max: 2 },
  { id: "kitchen", label: "Kitchen", slug: "kitchen", area: 120, baths: 0, on: HOUSE, cover: 1, max: 2 },
  { id: "dirty_kitchen", label: "Dirty kitchen", slug: "dirty_kitchen", area: 70, baths: 0, on: HOUSE, cover: 1, max: 1, hint: "For heavy cooking" },
  { id: "prayer", label: "Prayer room", slug: "prayer", area: 55, baths: 0, on: HOUSE, cover: 1, max: 1 },
  { id: "study", label: "Study", slug: "study", area: 100, baths: 0, on: HOUSE, cover: 1, max: 1 },
  { id: "store", label: "Store", slug: "store", area: 40, baths: 0, on: [...HOUSE, "roof"], cover: 1, max: 2 },
  { id: "servant", label: "Servant quarter", slug: "servant", area: 120, baths: 1, on: HOUSE, cover: 1, max: 1, hint: "With its own bath" },
  { id: "laundry", label: "Laundry", slug: "laundry", area: 50, baths: 0, on: [...HOUSE, "roof"], cover: 1, max: 1 },
  { id: "powder", label: "Powder room", slug: "powder", area: 30, baths: 0, on: HOUSE, cover: 1, max: 2, hint: "A guest toilet" },
  { id: "common_bath", label: "Common bath", slug: "bath", area: 40, baths: 1, on: [...HOUSE, "roof"], cover: 1, max: 2, hint: "Not attached to a bedroom" },
  { id: "dressing", label: "Dressing", slug: "dressing", area: 60, baths: 0, on: HOUSE, cover: 1, max: 2 },
  { id: "gym", label: "Gym", slug: "gym", area: 150, baths: 0, on: [...HOUSE, "roof"], cover: 1, max: 1 },
  { id: "kitchenette", label: "Kitchenette", slug: "kitchenette", area: 50, baths: 0, on: [...HOUSE, "roof"], cover: 1, max: 1, hint: "Tea and snacks upstairs" },
  { id: "balcony", label: "Balcony", slug: "balcony", area: 60, baths: 0, on: ["first", "second"], cover: 0.5, max: 2 },
  { id: "terrace", label: "Terrace", slug: "terrace", area: 150, baths: 0, on: ["first", "second", "roof"], cover: 0, max: 1, hint: "Open to the sky" },
];

export const byId = (id: string) => CATALOGUE.find((c) => c.id === id);

/**
 * Rooms per floor by catalogue id. Rooms the catalogue doesn't know (a home theatre, a sauna) are kept as
 * `x:<slug>` keys, so editing the program never deletes them: they show as read-only chips and are saved back.
 */
export type Program = Partial<Record<LevelId, Record<string, number>>>;

const EXTRA = "x:";
export const isExtra = (key: string) => key.startsWith(EXTRA);
/** "x:home_theatre" → "Home theatre". */
export function extraLabel(key: string): string {
  const slug = key.slice(EXTRA.length).replace(/_/g, " ").trim();
  return slug ? slug.charAt(0).toUpperCase() + slug.slice(1) : key;
}
/** The rooms on a floor that the catalogue doesn't list. */
export function extrasOf(rooms: Record<string, number> | undefined): { key: string; label: string; n: number }[] {
  return Object.entries(rooms ?? {})
    .filter(([k, n]) => isExtra(k) && n > 0)
    .map(([key, n]) => ({ key, label: extraLabel(key), n }));
}
const EXTRA_AREA = 100;

export const LEVEL_LABEL: Record<LevelId, string> = { ground: "Ground", first: "First", second: "Second", roof: "Roof" };

export function levelsFor(storeys: number): LevelId[] {
  const s = Math.max(1, Math.min(3, storeys || 2));
  return [...(["ground", "first", "second"] as LevelId[]).slice(0, s), "roof"];
}

/** Room sizes grow and shrink with the plot (a 5 marla bedroom isn't a kanal bedroom). */
export function scaleFor(marla: number): number {
  return Math.min(1.45, Math.max(0.68, Math.sqrt((marla || 10) / 10)));
}

/** Covered area a floor allows: the buildable rectangle, capped by ground coverage. The roof takes small rooms only. */
export function capacity(level: LevelId, env: Envelope | null, brief: Brief | null): number {
  const w = brief?.plot?.width_ft || 35;
  const d = brief?.plot?.depth_ft || 65;
  const floor = env ? Math.min(env.buildable_rect.w * env.buildable_rect.d, env.max_ground_coverage_sqft) : w * d * 0.62;
  return level === "roof" ? Math.round(floor * 0.22) : Math.round(floor);
}

/** Area a floor's program uses: rooms (scaled) plus the stair and a fair share for passages. */
export function used(level: LevelId, rooms: Record<string, number> | undefined, marla: number): number {
  const k = scaleFor(marla);
  let sum = 0;
  for (const [id, n] of Object.entries(rooms ?? {})) {
    const it = byId(id);
    if (it && n > 0) sum += it.area * k * it.cover * n;
    else if (isExtra(id) && n > 0) sum += EXTRA_AREA * k * n;
  }
  if (level === "roof") return Math.round(sum + 110 * k); // the stair tower
  if (!sum) return 0;
  return Math.round(sum * 1.12 + 120 * k); // circulation and the stair hall
}

export function bedroomsIn(p: Program): number {
  return Object.values(p).reduce((s, rooms) => s + (rooms?.master ?? 0) + (rooms?.bed ?? 0) + (rooms?.guest ?? 0), 0);
}
export function bathsIn(p: Program): number {
  return Object.values(p).reduce((s, rooms) => s + Object.entries(rooms ?? {}).reduce((t, [id, n]) => t + (byId(id)?.baths ?? 0) * n, 0), 0);
}

/** Program → Brief.floors (the contract's room list per level). */
export function toFloors(p: Program, levels: LevelId[]): NonNullable<Brief["floors"]> {
  return levels
    .map((level) => {
      const rooms = p[level] ?? {};
      const out: string[] = [];
      let baths = 0;
      for (const it of CATALOGUE) {
        const n = rooms[it.id] ?? 0;
        if (!n) continue;
        baths += it.baths * n;
        if (it.id === "common_bath") continue; // counted in bath:N
        if (it.id === "servant") out.push(n > 1 ? `servant:${n}` : "servant");
        else if (["master", "bed", "guest"].includes(it.id)) out.push(`${it.slug}:${n}`);
        else out.push(n > 1 ? `${it.slug}:${n}` : it.slug);
      }
      for (const x of extrasOf(rooms)) {
        const slug = x.key.slice(EXTRA.length);
        out.push(x.n > 1 ? `${slug}:${x.n}` : slug);
      }
      if (baths) out.push(`bath:${baths}`);
      return { level, rooms: out };
    })
    .filter((f) => f.rooms.length);
}

/**
 * Brief.floors → Program. Attached baths are implied by the bedrooms; baths beyond those become common baths, and
 * rooms the catalogue doesn't know are kept as extras (never dropped).
 */
export function fromFloors(floors: Brief["floors"]): Program {
  const p: Program = {};
  const declaredBaths: Partial<Record<LevelId, number>> = {};
  for (const f of floors ?? []) {
    const level = (["ground", "first", "second", "roof"].includes(f.level) ? f.level : f.level === "basement" ? "ground" : "first") as LevelId;
    const rooms: Record<string, number> = { ...(p[level] ?? {}) };
    for (const token of f.rooms) {
      const [rawSlug, nRaw] = token.trim().split(":");
      const slug = (rawSlug ?? "").trim().toLowerCase();
      if (!slug) continue;
      const n = Math.max(1, Number(nRaw) || 1);
      if (slug === "bath" || slug === "bathroom") {
        declaredBaths[level] = (declaredBaths[level] ?? 0) + n;
        continue;
      }
      const it =
        CATALOGUE.find((c) => c.slug === slug && c.id !== "common_bath") ??
        CATALOGUE.find((c) => c.id === slug) ??
        (slug === "tv_lounge" || slug === "family_lounge" ? byId("lounge")
          : slug === "servant_quarter" ? byId("servant")
          : slug === "powder_room" ? byId("powder")
          : slug === "dressing_room" ? byId("dressing")
          : undefined);
      if (it) rooms[it.id] = (rooms[it.id] ?? 0) + n;
      else rooms[`${EXTRA}${slug}`] = (rooms[`${EXTRA}${slug}`] ?? 0) + n;
    }
    p[level] = rooms;
  }
  for (const [level, declared] of Object.entries(declaredBaths) as [LevelId, number][]) {
    const rooms = p[level] ?? {};
    const implied = Object.entries(rooms).reduce((t, [id, n]) => t + (byId(id)?.baths ?? 0) * n, 0);
    if (declared > implied) rooms.common_bath = (rooms.common_bath ?? 0) + (declared - implied);
    p[level] = rooms;
  }
  return p;
}

export function chipsFor(p: Program, levels: LevelId[]): string[] {
  return toFloors(p, levels).map((f) => `floor:${f.level}=${f.rooms.join(",")}`);
}

/** "Ground: drawing room, dining, kitchen, 1 bed + bath" */
export function describe(p: Program, levels: LevelId[]): string {
  return levels
    .map((l) => {
      const rooms = p[l] ?? {};
      const parts = CATALOGUE.filter((c) => rooms[c.id]).map((c) => {
        const n = rooms[c.id];
        const name = /^[A-Z][a-z]/.test(c.label) ? c.label.charAt(0).toLowerCase() + c.label.slice(1) : c.label;
        return n > 1 ? `${n} × ${name}` : name;
      });
      for (const x of extrasOf(rooms)) parts.push(x.n > 1 ? `${x.n} × ${x.label.toLowerCase()}` : x.label.toLowerCase());
      return parts.length ? `${LEVEL_LABEL[l]}: ${parts.join(", ")}` : null;
    })
    .filter(Boolean)
    .join(". ");
}

export function roomsLine(rooms: Record<string, number> | undefined): string {
  const parts = CATALOGUE.filter((c) => rooms?.[c.id]).map((c) => {
    const n = rooms![c.id];
    const short = c.label.replace(" + bath", "").replace(" room", "").replace("Master bed", "Master").replace("Servant quarter", "Servant");
    return n > 1 ? `${n} ${short === "Bed" ? "beds" : short.toLowerCase()}` : short === "Bed" ? "1 bed" : short;
  });
  for (const x of extrasOf(rooms)) parts.push(x.n > 1 ? `${x.n} ${x.label.toLowerCase()}` : x.label);
  // A list after "Ground:" reads in sentence case: "1 bed, drawing, TV lounge, kitchen, dirty kitchen".
  return parts.map((p) => (/^.[A-Z]/.test(p) ? p : p.charAt(0).toLowerCase() + p.slice(1))).join(", ");
}

/**
 * A sensible first program from the brief, the way most Lahore families arrange it: guests and the kitchen
 * downstairs (with a parents' room if asked), bedrooms and a family lounge upstairs, laundry on the roof (or downstairs
 * when the house is already at the authority's storey limit, since a roof room counts as a storey).
 */
export function defaultProgram(brief: Brief | null, env: Envelope | null): Program {
  if (brief?.floors?.length) return fromFloors(brief.floors);
  const marla = brief?.plot?.area_marla || 10;
  const storeys = Math.max(1, Math.min(3, brief?.storeys || (marla < 4 ? 3 : 2)));
  const levels = levelsFor(storeys);
  const beds = Math.max(1, brief?.bedrooms || (marla < 5 ? 2 : marla < 10 ? 3 : marla < 20 ? 4 : 5));
  const spaces = new Set(brief?.spaces ?? []);
  const prefs = (brief?.preferences ?? []).join(" ").toLowerCase() + " " + (brief?.notes ?? "").toLowerCase();
  const parentsDown = /parent|elder|old|grand|ground floor bed|bedroom on the ground/.test(prefs) || storeys === 1;
  const p: Program = { ground: {}, first: {}, second: {}, roof: {} };
  const g = p.ground!;
  if (spaces.has("drawing") || marla >= 7) g.drawing = 1;
  g.dining = 1;
  g.kitchen = 1;
  if (spaces.has("dirty_kitchen") || marla >= 10) g.dirty_kitchen = 1;
  g.lounge = 1;
  if (spaces.has("prayer")) g.prayer = 1;
  if (spaces.has("servant_quarter") && marla >= 15) g.servant = 1;
  if (spaces.has("study")) g.study = 1;
  if (spaces.has("store") || marla >= 15) g.store = 1;

  let left = beds;
  const upper = levels.filter((l) => l !== "ground" && l !== "roof");
  if (parentsDown || !upper.length) {
    g.bed = 1;
    left -= 1;
  }
  // Upper floors: the master first, then bedrooms, a family lounge on the main family floor.
  for (const l of upper) {
    const rooms = p[l]!;
    const fit = Math.max(1, Math.floor(capacity(l, env, brief) / (205 * scaleFor(marla) * 1.12)) - 1);
    const take = Math.min(left, fit);
    if (take > 0) {
      if (l === upper[0]) {
        rooms.master = 1;
        rooms.bed = take - 1;
      } else rooms.bed = take;
      left -= take;
    }
    if (l === upper[0] && marla >= 10 && beds >= 3) rooms.lounge = 1;
    if (marla >= 7) rooms.balcony = 1;
  }
  if (left > 0) g.bed = (g.bed ?? 0) + left;
  if (!upper.length && !g.master) {
    g.master = 1;
    g.bed = Math.max(0, (g.bed ?? 0) - 1);
  }
  // Rooms asked for by name: a gym and a kitchenette go upstairs (the top floor), a powder room by the drawing room.
  const top = upper[upper.length - 1];
  if (spaces.has("gym")) p[top ?? "ground"]!.gym = 1;
  if (spaces.has("kitchenette") && top) p[top]!.kitchenette = 1;
  if (spaces.has("powder") || spaces.has("powder_room")) g.powder = 1;
  // a roof laundry is one more storey: only under the authority's limit, otherwise by the dirty kitchen downstairs
  if (spaces.has("laundry") || marla >= 7) (storeys < (env?.max_storeys ?? 3) ? p.roof! : g).laundry = 1;
  if (spaces.has("roof_terrace")) p.roof!.terrace = 1;
  for (const l of Object.keys(p) as LevelId[]) {
    const rooms = p[l]!;
    for (const k of Object.keys(rooms)) if (!rooms[k]) delete rooms[k];
  }
  const out = Object.fromEntries(levels.map((l) => [l, p[l] ?? {}])) as Program;
  return fitProgram(out, levels, env, brief);
}

/** Move rooms off over-full floors (bedrooms down, to the ground floor if needed) until every floor fits. */
export function fitProgram(program: Program, levels: LevelId[], env: Envelope | null, brief: Brief | null): Program {
  let p = program;
  for (let i = 0; i < 8; i++) {
    const m = suggestMove(p, levels, env, brief);
    if (!m) break;
    p = applyMove(p, m);
  }
  // Nowhere left to move to: drop the nice-to-haves from a floor that is still over, least missed first.
  const marla = brief?.plot?.area_marla || 10;
  const lounges = () => levels.reduce((n, l) => n + (p[l]?.lounge ?? 0), 0);
  for (const l of levels) {
    for (const id of OPTIONAL) {
      if (used(l, p[l], marla) <= capacity(l, env, brief)) break;
      const rooms = { ...(p[l] ?? {}) };
      if (!rooms[id] || (id === "lounge" && lounges() < 2)) continue;
      rooms[id] -= 1;
      if (!rooms[id]) delete rooms[id];
      p = { ...p, [l]: rooms };
    }
  }
  return p;
}

/** What a suggested program gives up first when a floor can't hold it. */
const OPTIONAL = ["balcony", "terrace", "study", "prayer", "store", "dirty_kitchen", "lounge", "dining", "laundry", "drawing"];

export function applyMove(p: Program, move: { from: LevelId; to: LevelId; id: string }): Program {
  const from = { ...(p[move.from] ?? {}) };
  from[move.id] = Math.max(0, (from[move.id] ?? 0) - 1);
  if (!from[move.id]) delete from[move.id];
  const to = { ...(p[move.to] ?? {}) };
  to[move.id] = (to[move.id] ?? 0) + 1;
  return { ...p, [move.from]: from, [move.to]: to };
}

/** The first floor (from the bottom) whose program is over its capacity, and by how much. */
export function overFloor(p: Program, levels: LevelId[], env: Envelope | null, brief: Brief | null): { level: LevelId; over: number } | null {
  const marla = brief?.plot?.area_marla || 10;
  for (const l of levels) {
    const over = used(l, p[l], marla) - capacity(l, env, brief);
    if (over > 0) return { level: l, over: Math.round(over) };
  }
  return null;
}

/** When a floor is over its capacity: the room to move and where ("Move the study down?"). */
export function suggestMove(p: Program, levels: LevelId[], env: Envelope | null, brief: Brief | null): { from: LevelId; to: LevelId; id: string } | null {
  const marla = brief?.plot?.area_marla || 10;
  for (const from of levels) {
    if (used(from, p[from], marla) <= capacity(from, env, brief)) continue;
    const rooms = p[from] ?? {};
    // Bedrooms first (the usual overflow; they move down a floor, to the ground floor if needed), then small rooms.
    const rank = (id: string) => (id === "bed" ? 0 : id === "guest" ? 1 : 2);
    const movable = CATALOGUE.filter((c) => (rooms[c.id] ?? 0) > 0)
      .filter((c) => !["kitchen", "drawing", "master"].includes(c.id) || from !== "ground")
      .filter((c) => c.id !== "master")
      .sort((a, b) => rank(a.id) - rank(b.id) || a.area - b.area);
    const at = (l: LevelId) => levels.indexOf(l);
    for (const it of movable) {
      const to = levels
        .filter((l) => l !== from && it.on.includes(l))
        .map((l) => ({ l, spare: capacity(l, env, brief) - used(l, { ...(p[l] ?? {}), [it.id]: (p[l]?.[it.id] ?? 0) + 1 }, marla) }))
        .filter((x) => x.spare >= 0)
        // Prefer a floor below (the nearest one first), then any floor with room.
        .sort((a, b) => {
          const da = at(a.l) < at(from) ? at(from) - at(a.l) : 10 + at(a.l);
          const db = at(b.l) < at(from) ? at(from) - at(b.l) : 10 + at(b.l);
          return da - db || b.spare - a.spare;
        })[0];
      if (to) return { from, to: to.l, id: it.id };
    }
  }
  return null;
}
