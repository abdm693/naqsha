/**
 * Mock revise: an ADK-style agent that reads each walkthrough comment where it was pinned (anchor room and element),
 * edits the plan or the code, re-checks LDA and explains every outcome. Plan edits are real geometry:
 * - "make it bigger": move a shared wall into a neighbour that can spare the space (passage, lounge, balcony…),
 * - "make this door/window wider", "more light": widen the opening within its wall,
 * - "extend into the lawn / forward": rejected, because it would break the front setback,
 * - materials, furniture, storage: rewrite the code section that draws that part of the house.
 * Stage lines mirror the live agent's tool activity ("Looking at g_lounge…", "Rewriting furnish_g_lounge…").
 */
import type { Change, Comment, DesignSection } from "@contracts/api-types";
import type { BuildingPlan, ComplianceReport, Opening, Room, RoomType } from "@contracts/plan";
import { clone, db, findProject, now, save, touch, uid } from "./db";
import { recheck } from "./lda";
import { saveVersion } from "./scripts";
import { ev, type Step } from "./stream";

export const NAQSHA = { id: "naqsha", name: "Naqsha", role: "agent" as const };

export const PORCH_REJECTION =
  "Under LDA Building & Zoning Regulations for a 10-marla plot, a mandatory 10 ft front setback is required and the car porch slab cannot project into the front open space. As an alternative, the 20×10 ft front driveway directly ahead of the 15×16 ft porch already provides extra tandem parking space, or we could deepen the porch inward if you are open to reducing the TV lounge depth.";

const PROJECTION_REJECTION =
  "That would project into the 10 ft front open space, which LDA doesn't allow for houses (B&ZR 2019 §5.1.8). As an alternative I can add a 3 ft sunshade (chajja), the most the front setback permits, or find the space inside the current footprint.";

const STOREY_REJECTION =
  "LDA caps houses at 3 storeys and 45 ft to the top of the parapet, so another floor isn't possible here. I can make the roof more usable instead, with a covered terrace beside the mumty.";

/** Deepen Bedroom 2 by 2 ft into the front balcony (110 → 130 sq ft). Used by the seeded sample's v2. */
export function deepenBedroom2(plan: BuildingPlan): boolean {
  const bed = plan.rooms.find((r) => r.id === "f_bed2");
  const balcony = plan.rooms.find((r) => r.id === "f_balcony");
  const bath = plan.rooms.find((r) => r.id === "f_bath2");
  if (!bed || !balcony) return false;
  bed.rect = { ...bed.rect, y: bed.rect.y - 2, d: bed.rect.d + 2 };
  if (bath) bath.rect = { ...bath.rect, y: bath.rect.y - 2, d: bath.rect.d + 2 };
  balcony.rect = { ...balcony.rect, d: balcony.rect.d - 2 };
  for (const o of plan.openings) {
    if (o.id === "f_bed2_slide") o.at = [o.at[0], o.at[1] - 2];
  }
  return true;
}

// ── Reading the comment ─────────────────────────────────────────────────────────────────────────────

type Intent = "projection" | "storey" | "opening" | "light" | "bigger" | "material" | "remove" | "move" | "storage" | "general";

const FURNITURE_KIND = /furniture|sofa|bed|table|chair|wardrobe|cabinet|desk|counter|shelf|tv|rug|plant|lamp|vanity/;

function intentOf(c: Comment): Intent {
  const t = c.text.toLowerCase();
  const kind = (c.anchor.kind ?? "").toLowerCase();
  if (/\b(another|extra|one more|add a) (floor|storey|story)\b|\b(4th|fourth) (floor|storey)\b/.test(t)) return "storey";
  if (/\b(extend|forward|outward|cantilever|push (it )?out|project(ing)? out)\b|into the (front|lawn|setback|road|street|side space)/.test(t)) return "projection";
  const aboutOpening = /\b(door|doorway|entrance|window|opening|gate)\b/.test(t) || /door|window|opening|arch/.test(kind);
  if (aboutOpening && (/\b(wider|bigger|larger|broader|widen|enlarge|grander)\b/.test(t) || /\d+(\.\d+)?\s*(ft|feet|foot|')/.test(t))) return "opening";
  if (/\b(more light|daylight|natural light|too dark|is dark|so dark|brighter|sunlight|more sun|bigger window|add a window)\b/.test(t)) return "light";
  if (/\b(storage|cupboard|wardrobe|cabinet|shelves|shelf|closet|almirah)\b/.test(t)) return "storage";
  if (/\b(bigger|larger|wider|deeper|more space|spacious|enlarge|cramped|small|tight|tiny)\b/.test(t)) return "bigger";
  if (/\b(remove|delete|get rid|no need|don't need|do not need|take out)\b/.test(t)) return "remove";
  if (/\b(move|shift|relocate|swap|rotate|turn)\b/.test(t)) return "move";
  if (/\b(material|wood|wooden|marble|stone|colou?r|paint|tiles?|glass|brick|finish|darker|lighter|warmer|cooler|louvers?|louvres?|cladding|granite|terrazzo|wallpaper|texture)\b/.test(t)) return "material";
  return "general";
}

/** "TV Lounge" → "TV lounge", "Front Balcony" → "front balcony"; names with numbers stay as they are. */
function inSentence(name: string): string {
  if (/\d/.test(name)) return name;
  return name.split(" ").map((w) => (/^[A-Z][a-z]+$/.test(w) ? w.toLowerCase() : w)).join(" ");
}

/** "the TV lounge", but "Bedroom 4" (numbered rooms read as names). */
const theRoom = (name: string) => (/\d/.test(name) ? name : `the ${inSentence(name)}`);

const ft = (n: number) => `${Number(n.toFixed(1))}`;
const sq = (r: Room) => Math.round(r.rect.w * r.rect.d);

function roomOf(plan: BuildingPlan, c: Comment): Room | undefined {
  const a = c.anchor;
  const byId = plan.rooms.find((r) => r.id === a.room) ?? plan.rooms.find((r) => r.id === a.element_id);
  if (byId) return byId;
  const o = plan.openings.find((x) => x.id === a.element_id);
  return o ? plan.rooms.find((r) => r.id === o.between[0]) : undefined;
}

function requestedFeet(text: string): number | undefined {
  const m = text.match(/(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|')/i);
  return m ? Number(m[1]) : undefined;
}

// ── Plan geometry ───────────────────────────────────────────────────────────────────────────────────

type Side = "front" | "back" | "left" | "right";
const EPS = 0.05;
const near = (a: number, b: number, tol = EPS) => Math.abs(a - b) <= tol;

/** Coordinate of a room edge: front/back are y lines, left/right are x lines. */
function edge(r: Room, side: Side): number {
  const { x, y, w, d } = r.rect;
  return side === "front" ? y : side === "back" ? y + d : side === "left" ? x : x + w;
}
/** The room's extent along an edge. */
function span(r: Room, side: Side): [number, number] {
  const { x, y, w, d } = r.rect;
  return side === "front" || side === "back" ? [x, x + w] : [y, y + d];
}
const OPPOSITE: Record<Side, Side> = { front: "back", back: "front", left: "right", right: "left" };

/** Rooms that can give up some depth, and how much they must keep. */
const DONOR_MIN: Partial<Record<RoomType, number>> = { corridor: 3.5, lobby: 4, lounge: 10, dining: 9, store: 4, laundry: 3.5, balcony: 3, terrace: 6, dressing: 4, study: 7, courtyard: 6 };

interface Growth { room: Room; donor: Room; side: Side; by: number; before: number; after: number; group: string[]; moved: string[] }

/**
 * Grow `roomId` by `by` ft through one of its walls, taking the space from a neighbour on the other side.
 * The neighbour's wall must be covered exactly by rooms on our side (so every room stays a rectangle);
 * those rooms all grow, as Bath 2 does when Bedroom 2 deepens into the balcony.
 */
function grow(plan: BuildingPlan, roomId: string, by = 2): Growth | null {
  const room = plan.rooms.find((r) => r.id === roomId);
  if (!room) return null;
  const same = plan.rooms.filter((r) => r.level === room.level);
  const options: { donor: Room; side: Side; group: Room[]; spare: number }[] = [];
  for (const side of ["back", "front", "right", "left"] as Side[]) {
    const line = edge(room, side);
    for (const donor of same) {
      const min = DONOR_MIN[donor.type];
      if (donor.id === room.id || min === undefined) continue;
      if (!near(edge(donor, OPPOSITE[side]), line)) continue;
      const [dlo, dhi] = span(donor, side);
      const [rlo, rhi] = span(room, side);
      if (rlo < dlo - EPS || rhi > dhi + EPS) continue;
      if (plan.stairs.some((s) => s.from_level === room.level && s.rect.x >= donor.rect.x - EPS && s.rect.x + s.rect.w <= donor.rect.x + donor.rect.w + EPS && s.rect.y >= donor.rect.y - EPS && s.rect.y + s.rect.d <= donor.rect.y + donor.rect.d + EPS)) continue;
      const group = same.filter((r) => r.id !== donor.id && near(edge(r, side), line) && span(r, side)[0] >= dlo - EPS && span(r, side)[1] <= dhi + EPS);
      // the group must tile the donor's wall exactly
      const spans = group.map((r) => span(r, side)).sort((a, b) => a[0] - b[0]);
      let cursor = dlo;
      let tiles = true;
      for (const [lo, hi] of spans) {
        if (!near(lo, cursor)) { tiles = false; break; }
        cursor = hi;
      }
      if (!tiles || !near(cursor, dhi)) continue;
      const depth = side === "front" || side === "back" ? donor.rect.d : donor.rect.w;
      if (depth - by < min - EPS) continue;
      options.push({ donor, side, group, spare: depth - by - min });
    }
  }
  options.sort((a, b) => b.spare - a.spare);
  const o = options[0];
  if (!o) return null;
  const before = sq(room);
  const line = edge(room, o.side);
  for (const r of o.group) {
    const q = r.rect;
    if (o.side === "back") r.rect = { ...q, d: q.d + by };
    if (o.side === "front") r.rect = { ...q, y: q.y - by, d: q.d + by };
    if (o.side === "right") r.rect = { ...q, w: q.w + by };
    if (o.side === "left") r.rect = { ...q, x: q.x - by, w: q.w + by };
  }
  const dq = o.donor.rect;
  if (o.side === "back") o.donor.rect = { ...dq, y: dq.y + by, d: dq.d - by };
  if (o.side === "front") o.donor.rect = { ...dq, d: dq.d - by };
  if (o.side === "right") o.donor.rect = { ...dq, x: dq.x + by, w: dq.w - by };
  if (o.side === "left") o.donor.rect = { ...dq, w: dq.w - by };
  // Openings in the moved wall move with it.
  const horizontal = o.side === "front" || o.side === "back";
  const shift = o.side === "back" || o.side === "right" ? by : -by;
  const [lo, hi] = span(o.donor, o.side);
  const moved: string[] = [];
  for (const op of plan.openings) {
    if (op.level !== room.level) continue;
    const [x, y] = op.at;
    if (horizontal ? near(y, line, 0.8) && x >= lo - EPS && x <= hi + EPS : near(x, line, 0.8) && y >= lo - EPS && y <= hi + EPS) {
      op.at = horizontal ? [x, y + shift] : [x + shift, y];
      moved.push(op.id);
    }
  }
  return { room, donor: o.donor, side: o.side, by, before, after: sq(room), group: o.group.map((r) => r.id), moved };
}

interface Wall { horizontal: boolean; line: number; lo: number; hi: number }

/** The wall segment an opening sits in: the shared edge of the rooms on both sides. */
function wallOf(plan: BuildingPlan, o: Opening): Wall | null {
  const [x, y] = o.at;
  const edges: Wall[] = [];
  for (const id of o.between) {
    const r = plan.rooms.find((q) => q.id === id && q.level === o.level);
    if (!r) continue;
    const { x: rx, y: ry, w, d } = r.rect;
    if ((near(y, ry, 0.8) || near(y, ry + d, 0.8)) && x >= rx - 0.8 && x <= rx + w + 0.8) edges.push({ horizontal: true, line: near(y, ry, 0.8) ? ry : ry + d, lo: rx, hi: rx + w });
    else if ((near(x, rx, 0.8) || near(x, rx + w, 0.8)) && y >= ry - 0.8 && y <= ry + d + 0.8) edges.push({ horizontal: false, line: near(x, rx, 0.8) ? rx : rx + w, lo: ry, hi: ry + d });
  }
  if (!edges.length) return null;
  return edges.reduce((a, e) => ({ ...a, lo: Math.max(a.lo, e.lo), hi: Math.min(a.hi, e.hi) }));
}

const MAX_WIDTH: Partial<Record<Opening["type"], number>> = { door: 4, main_door: 6, double_door: 6, sliding_door: 12, window: 12, corner_window: 12, ventilator: 3, arch: 8, garage_door: 16 };

/** Widen an opening towards `target` within its wall, keeping 0.5 ft clear of other openings and 0.75 ft of corners. */
function widen(plan: BuildingPlan, o: Opening, target: number): { from: number; to: number; limitedBy?: string } | null {
  const wall = wallOf(plan, o);
  if (!wall) return null;
  const along = (p: Opening) => (wall.horizontal ? p.at[0] : p.at[1]);
  const across = (p: Opening) => (wall.horizontal ? p.at[1] : p.at[0]);
  const c0 = along(o);
  let L = wall.lo + 0.75;
  let R = wall.hi - 0.75;
  let leftBlock: string | undefined;
  let rightBlock: string | undefined;
  for (const p of plan.openings) {
    if (p.id === o.id || p.level !== o.level || !near(across(p), wall.line, 0.8)) continue;
    const c = along(p);
    if (c < wall.lo - EPS || c > wall.hi + EPS) continue;
    if (c < c0 && c + p.width_ft / 2 + 0.5 > L) { L = c + p.width_ft / 2 + 0.5; leftBlock = p.id; }
    if (c > c0 && c - p.width_ft / 2 - 0.5 < R) { R = c - p.width_ft / 2 - 0.5; rightBlock = p.id; }
  }
  // A single leaf tops out at 4 ft; wider becomes a double door.
  const type: Opening["type"] = o.type === "door" && target > 4 ? "double_door" : o.type;
  const cap = Math.min(MAX_WIDTH[type] ?? 12, R - L);
  const to = Math.floor(Math.min(target, cap) * 2) / 2;
  const from = o.width_ft;
  if (to <= from + 0.25) return null;
  const center = Math.min(Math.max(c0, L + to / 2), R - to / 2);
  o.type = type;
  o.width_ft = to;
  o.at = wall.horizontal ? [center, o.at[1]] : [o.at[0], center];
  return { from, to, limitedBy: to < target ? (leftBlock ?? rightBlock ?? "the wall") : undefined };
}

// ── Code sections ───────────────────────────────────────────────────────────────────────────────────

const OPEN_AIR = new Set<RoomType>(["porch", "balcony", "terrace", "lawn", "driveway", "courtyard", "open_space"]);

function furnishSection(sections: DesignSection[], room: Room | undefined, level?: string): string | undefined {
  const names = sections.map((s) => s.name);
  if (room) {
    if (names.includes(`furnish_${room.id}`)) return `furnish_${room.id}`;
    const prefix = `furnish_${room.id.split("_")[0]}_`;
    if (room.type === "bath" || room.type === "powder") {
      const n = names.find((x) => x.startsWith(prefix) && x.includes("bath"));
      if (n) return n;
    }
    if (room.type === "laundry") {
      const n = names.find((x) => x.startsWith(prefix) && x.includes("laundry"));
      if (n) return n;
    }
  }
  const lv = room?.level ?? level;
  return names.find((x) => x === `interior_${lv}`) ?? names.find((x) => x.startsWith("interior"));
}

function facadeSection(sections: DesignSection[], plan: BuildingPlan, c: Comment, room: Room | undefined): string | undefined {
  const names = sections.map((s) => s.name);
  const words = `${c.text} ${c.anchor.label ?? ""} ${c.anchor.kind ?? ""}`.toLowerCase();
  if (/pier|stone/.test(words) && names.includes("facade_stone_pier")) return "facade_stone_pier";
  // Which bay: the room's centre if we know the room, else the pinned point (x_m = x_ft · 0.3048).
  const xFt = room ? room.rect.x + room.rect.w / 2 : c.anchor.position[0] / 0.3048;
  const side = xFt < plan.site.plot.width_ft / 2 ? "facade_left_bay" : "facade_right_bay";
  return names.includes(side) ? side : sections.find((s) => s.layer === "facade")?.name;
}

function isExterior(c: Comment, room: Room | undefined): boolean {
  const words = `${c.text} ${c.anchor.label ?? ""} ${c.anchor.kind ?? ""}`.toLowerCase();
  return !room || OPEN_AIR.has(room.type) || /facade|exterior|outside|front wall|elevation|louv|cladding|pier|parapet|boundary/.test(words);
}

function materialPhrase(text: string): string | undefined {
  const m = text.match(/\b((?:warmer|darker|lighter|cooler|richer|natural|white|grey|gray|black|beige|cream|teak|walnut|oak|wooden|wood|marble|stone|brick|granite|terrazzo|porcelain|ceramic|glass|tiles?)(?:\s+(?:wood|wooden|tone|tones|finish|stone|tiles?|marble|cladding|paint|colou?r|louvers|panels|flooring|floor))*)\b/i);
  return m?.[1].toLowerCase();
}

// ── The agent run ───────────────────────────────────────────────────────────────────────────────────

const stage = (message: string, s: "changes" | "plan" | "compliance" | "fix" | "build" | "save" = "changes") => ev("stage", { stage: s, message });

/** A typed change ("make the kitchen bigger") read as an unpinned comment on the room it names. */
function instructionComment(plan: BuildingPlan, versionId: string, text: string): Comment {
  const t = text.toLowerCase();
  const words = (r: Room) => r.name.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2);
  const scored = plan.rooms
    .map((r) => ({ r, score: words(r).filter((w) => t.includes(w)).length + (t.includes(r.name.toLowerCase()) ? 3 : 0) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || (a.r.level === "ground" ? -1 : 1));
  const room = scored[0]?.r;
  return {
    id: `instruction_${Date.now().toString(36)}`,
    version_id: versionId,
    text,
    anchor: { position: [0, 0, 0], normal: [0, 0, 1], room: room?.id, level: room?.level, label: room?.name },
    camera: { position: [0, 8, 14], target: [0, 3, 0] },
    created_at: now(),
    status: "open",
  };
}

export async function* reviseScript(pid: string, versionId: string, commentIds?: string[], instruction?: string): AsyncGenerator<Step> {
  const d = db();
  const p = findProject(pid);
  const base = d.versions[versionId];
  if (!base) {
    yield ev("error", { message: "That version no longer exists.", recoverable: false });
    return;
  }
  const open = (d.comments[pid] ?? []).filter((c) => c.version_id === versionId && c.status === "open");
  const picked = commentIds?.length ? open.filter((c) => commentIds.includes(c.id)) : instruction?.trim() ? [] : open;
  const typed = instruction?.trim() ? instructionComment(base.plan, versionId, instruction.trim()) : null;
  const comments = typed ? [...picked, typed] : picked;
  if (!comments.length) {
    yield ev("error", { message: "There are no open comments to address.", recoverable: false });
    return;
  }

  p.stage = "revising";
  touch(p);
  save();

  yield stage(
    typed && !picked.length
      ? "Reading your change…"
      : `Reading your ${comments.length} comment${comments.length === 1 ? "" : "s"}…`,
  );
  yield 1400;

  const plan = clone(base.plan);
  let report: ComplianceReport = base.compliance;
  let attempt = 0;
  const changes: Change[] = [];
  const sections: DesignSection[] = [...base.sections];
  const resolutions = new Map<string, { status: Comment["status"]; resolution: string }>();

  const resolve = (c: Comment, status: Comment["status"], resolution: string) => resolutions.set(c.id, { status, resolution });
  const addChange = (kind: Change["kind"], summary: string, targets: string[], c: Comment) => {
    const same = changes.find((x) => x.kind === kind && x.summary === summary);
    if (same) same.comment_ids.push(c.id);
    else changes.push({ id: `ch${changes.length + 1}`, summary, kind, targets, comment_ids: [c.id] });
  };
  function* rewrite(name: string | undefined, note: string): Generator<Step> {
    const i = name ? sections.findIndex((s) => s.name === name) : -1;
    if (!name || i < 0) return;
    yield stage(`Rewriting ${name}…`);
    yield 1300;
    sections[i] = { ...sections[i], code: `// Revision: ${note}\n${sections[i].code}` };
    yield ev("section", { section: sections[i], index: i });
  }
  /** Re-check the edited plan; on new failures undo it. */
  function* checkPlan(before: BuildingPlan): Generator<Step, boolean> {
    yield stage("Checking proposed layout changes against LDA rules…");
    yield 1100;
    const next = recheck(plan, base.compliance);
    const fails = (r: ComplianceReport) => r.checks.filter((x) => x.status === "fail").length;
    if (fails(next) > fails(report)) {
      Object.assign(plan, clone(before));
      return false;
    }
    yield stage("Applying layout change…");
    yield 700;
    report = next;
    attempt++;
    yield ev("plan", { plan: clone(plan), attempt });
    yield ev("compliance", { report, attempt });
    yield 400;
    return true;
  }

  for (const c of comments) {
    const intent = intentOf(c);
    const room = roomOf(plan, c);
    const label = c.anchor.label ? inSentence(c.anchor.label) : room ? inSentence(room.name) : "this spot";
    yield stage(`Looking at ${room?.id ?? c.anchor.element_id ?? label}…`);
    yield 1100;

    if (intent === "projection" || intent === "storey") {
      yield stage("Testing a layout change…");
      yield 900;
      yield stage("Checking proposed layout changes against LDA rules…");
      yield 1200;
      const text = c.text.toLowerCase();
      resolve(c, "rejected", intent === "storey" ? STOREY_REJECTION : /porch|car/.test(text) || room?.type === "porch" ? PORCH_REJECTION : PROJECTION_REJECTION);
    } else if (intent === "opening") {
      const t = c.text.toLowerCase();
      const wantsWindow = /window/.test(t) || /window/.test(c.anchor.kind ?? "");
      const target =
        plan.openings.find((o) => o.id === c.anchor.element_id) ??
        plan.openings
          .filter((o) => room && o.between.includes(room.id) && (wantsWindow ? /window/.test(o.type) : /door|arch/.test(o.type)))
          .sort((a, b) => b.width_ft - a.width_ft)[0];
      yield stage(`Reading the plan around ${target?.id ?? room?.id ?? "this wall"}…`);
      yield 900;
      if (!target) {
        resolve(c, "partial", `I couldn't find a ${wantsWindow ? "window" : "door"} right there. Pin the comment directly on it and I'll widen it.`);
      } else {
        const asked = requestedFeet(c.text);
        const what = inSentence(c.anchor.label ?? target.id.replace(/_/g, " "));
        const width0 = target.width_ft;
        if (asked !== undefined && asked <= width0) {
          resolve(c, "resolved", `The ${what} is already ${ft(width0)} ft wide, so no change was needed. Ask for a specific width if you'd like it wider still.`);
        } else {
          yield stage("Testing a layout change…");
          yield 900;
          const before = clone(plan);
          const goal = asked ?? target.width_ft + (/window|sliding/.test(target.type) ? 2 : 1);
          const w = widen(plan, target, goal);
          const ok = w ? yield* checkPlan(before) : false;
          if (w && ok) {
            addChange("plan", `Widened the ${what} from ${ft(w.from)} ft to ${ft(w.to)} ft`, [target.id, ...target.between.filter((x) => x !== "exterior")], c);
            resolve(c, w.limitedBy ? "partial" : "resolved", w.limitedBy
              ? `The ${what} is now ${ft(w.to)} ft wide, up from ${ft(w.from)}. That's as wide as this wall allows next to ${w.limitedBy.replace(/_/g, " ")}.`
              : `The ${what} is now ${ft(w.to)} ft wide, up from ${ft(w.from)} ft. It still passes every LDA check.`);
          } else {
            resolve(c, "partial", `This wall has no room to widen the ${what} without cutting into the next opening or a corner, so I left it at ${ft(width0)} ft.`);
          }
        }
      }
    } else if (intent === "light") {
      const windows = plan.openings
        .filter((o) => room && o.between.includes(room.id) && o.between.includes("exterior") && /window|sliding/.test(o.type))
        .sort((a, b) => b.width_ft - a.width_ft);
      if (!room || !windows.length) {
        yield* rewrite(sections.find((s) => s.name === "lighting")?.name, `warmer, brighter ceiling lights in ${room?.name ?? "this area"}.`);
        resolve(c, "partial", `${room ? `${room.name} has` : "This spot has"} no outside wall, so a window isn't possible without breaking a setback. I brightened it with warmer ceiling lights instead.`);
      } else {
        yield stage("Testing a layout change…");
        yield 900;
        const before = clone(plan);
        const win = windows[0];
        const w = widen(plan, win, win.width_ft + 2);
        const ok = w ? yield* checkPlan(before) : false;
        if (w && ok) {
          addChange("plan", `Widened the ${inSentence(room.name)} window from ${ft(w.from)} ft to ${ft(w.to)} ft for more daylight`, [win.id, room.id], c);
          resolve(c, "resolved", `The ${inSentence(room.name)} window is now ${ft(w.to)} ft wide, up from ${ft(w.from)} ft, so the room gets noticeably more daylight. It still passes every LDA check.`);
        } else {
          yield* rewrite(sections.find((s) => s.name === "lighting")?.name, `warmer, brighter ceiling lights in ${room.name}.`);
          resolve(c, "partial", `The ${inSentence(room.name)} window already fills its wall, so I brightened the room with warmer ceiling lights instead.`);
        }
      }
    } else if (intent === "bigger") {
      const furnish = furnishSection(sections, room, c.anchor.level);
      if (furnish) {
        yield stage(`Reading ${furnish}…`);
        yield 800;
      }
      yield stage("Testing a layout change…");
      yield 900;
      const before = clone(plan);
      const g = room ? grow(plan, room.id, 2) ?? grow(plan, room.id, 1.5) ?? grow(plan, room.id, 1) : null;
      const ok = g ? yield* checkPlan(before) : false;
      if (g && ok && room) {
        const r = plan.rooms.find((x) => x.id === room.id)!;
        const donor = plan.rooms.find((x) => x.id === g.donor.id)!;
        const dir = g.side === "front" || g.side === "back" ? "deeper" : "wider";
        const keeps = g.side === "front" || g.side === "back" ? donor.rect.d : donor.rect.w;
        addChange("plan", `${dir === "deeper" ? "Deepened" : "Widened"} ${room.name} by ${ft(g.by)} ft into ${theRoom(donor.name)} (${g.before} → ${g.after} sq ft)`, [...g.group, donor.id], c);
        yield* rewrite(furnish, `${room.name} is ${ft(g.by)} ft ${dir}; the furniture is re-spaced to use it.`);
        resolve(c, "resolved", `${room.name} is now ${ft(r.rect.w)}×${ft(r.rect.d)} ft (${g.after} sq ft), up from ${g.before}, by taking ${ft(g.by)} ft from ${theRoom(donor.name)}, which stays ${ft(keeps)} ft ${dir === "deeper" ? "deep" : "wide"}. It still passes every LDA room-size and daylight check.`);
      } else {
        resolve(c, "partial", room
          ? `${room.name} is boxed in: the rooms around it are already at their minimum sizes or carry the stair, so it can't grow without breaking an LDA rule. I can trade space with a specific neighbour if you tell me which one matters less.`
          : "I couldn't tell which room this is about. Pin the comment inside the room and I'll try again.");
      }
    } else if (intent === "material") {
      const exterior = isExterior(c, room);
      const name = exterior ? facadeSection(sections, plan, c, room) : furnishSection(sections, undefined, room?.level ?? c.anchor.level);
      if (name) {
        yield stage(`Reading ${name}…`);
        yield 900;
      }
      const phrase = materialPhrase(c.text);
      yield* rewrite(name, `${label}: ${phrase ?? "refreshed finish"} (from a walkthrough comment).`);
      if (name) addChange("section", exterior ? `Updated the facade: ${phrase ?? "a refreshed finish"} on the ${label}` : `Updated the finishes in ${room ? theRoom(room.name) : "this area"}: ${phrase ?? "refreshed"}`, [name], c);
      resolve(c, phrase ? "resolved" : "partial", phrase
        ? `Changed the ${label} to ${phrase}. You'll see it in 3D in the new version.`
        : `I refreshed the finish on the ${label}. Tell me the exact material you have in mind and I'll match it.`);
    } else {
      const name = furnishSection(sections, room, c.anchor.level);
      if (name) {
        yield stage(`Reading ${name}…`);
        yield 900;
      }
      const furniture = FURNITURE_KIND.test((c.anchor.kind ?? "").toLowerCase());
      const where = room ? theRoom(room.name) : "this area";
      const thing = c.anchor.label ? inSentence(c.anchor.label) : "the furniture";
      if ((intent === "remove" || intent === "move") && !furniture && c.anchor.kind && /wall|door|window|stair|column|slab/.test(c.anchor.kind)) {
        yield stage("Testing a layout change…");
        yield 900;
        yield stage("Checking proposed layout changes against LDA rules…");
        yield 1000;
        resolve(c, "partial", `The ${thing} is part of the structure: ${intent === "remove" ? "removing" : "moving"} it would leave a room without its required daylight or access, so I kept it and simplified the furniture around it.`);
        yield* rewrite(name, `furniture simplified around the ${thing}.`);
      } else {
        const note = intent === "remove" ? `removed the ${thing}; the rest is re-spaced.`
          : intent === "move" ? `moved the ${thing} as asked.`
          : intent === "storage" ? `added built-in storage along the longest free wall.`
          : `refreshed the layout from a walkthrough comment: "${c.text.slice(0, 80)}"`;
        yield* rewrite(name, note);
        if (name) addChange("section", intent === "storage" ? `Added built-in storage in ${room ? theRoom(room.name) : "the room"}` : `Rearranged the furniture in ${room ? theRoom(room.name) : "this area"}`, [name], c);
        resolve(c, intent === "general" ? "partial" : "resolved",
          intent === "remove" ? `Removed the ${thing} from ${where} and re-spaced the rest of the furniture.`
          : intent === "move" ? `Moved the ${thing} in ${where} as asked; the rest of the layout shifts to keep clear walkways.`
          : intent === "storage" ? `Added a built-in cupboard wall in ${where}, along its longest free wall.`
          : `I read this as a note about ${where} and refreshed its layout. Tell me more if you meant something specific and I'll take it further.`);
      }
    }
    yield stage("Resolving comment…");
    yield 600;
  }

  yield ev("changes", { changes });
  yield stage("Saving the revised version…", "save");
  yield 900;

  const summary = changes.map((c) => c.summary).join("; ").slice(0, 200) || "Reviewed your comments; no layout changes were needed";
  const version = saveVersion(pid, plan, sections, report, summary, changes, versionId);
  for (const c of comments) {
    const r = resolutions.get(c.id) ?? { status: "partial" as const, resolution: "Reviewed; no specific change was needed." };
    if (c === typed) {
      // A typed change has no thread: Naqsha answers in the narration instead.
      yield stage(r.resolution);
      yield 500;
      continue;
    }
    c.status = r.status;
    c.resolution = r.resolution;
    c.resolved_in_version = version.id;
    // The answer also lands in the thread, where the person asked.
    c.replies = [...(c.replies ?? []), { id: uid("rp"), author: NAQSHA, text: r.resolution, created_at: now() }];
    save();
    yield 350;
    yield ev("comment", { comment: clone(c) });
  }
  yield ev("version", { version });
  yield ev("done", {});
}
