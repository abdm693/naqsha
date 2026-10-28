/**
 * Mock LDA engine for mock mode.
 * - envelopeFor: setbacks, coverage, FAR and height by plot band (docs/research/lda-regulations.md §(a)).
 * - recheck: re-derives the room size and daylight checks of a real engine report for a modified plan,
 *   using the engine's own wording, so attempt 1/2 and revisions stay consistent with the drawing.
 * The Python engine (api/app/compliance/lda.py) is the source of truth.
 */
import type { Envelope } from "@contracts/api-types";
import type { Authority, BuildingPlan, ComplianceCheck, ComplianceReport, Room } from "@contracts/plan";
import argonReport from "./data/argon-v1-compliance.json";

export const MARLA_SQFT = 225;
export const ARGON_REPORT = argonReport as unknown as ComplianceReport;

interface Band {
  label: string;
  upTo: number; // marla, exclusive
  front: number;
  rear: number;
  side: number;
  sides: 0 | 1 | 2;
  coverage: number;
  far: number;
  height: number;
}

const BANDS: Band[] = [
  { label: "Under 5 marla", upTo: 5, front: 5, rear: 5, side: 0, sides: 0, coverage: 80, far: 2.4, height: 38 },
  { label: "5 marla to under 10 marla", upTo: 10, front: 5, rear: 5, side: 0, sides: 0, coverage: 75, far: 2.3, height: 38 },
  { label: "10 marla to under 1 kanal", upTo: 20, front: 10, rear: 7, side: 5, sides: 1, coverage: 70, far: 2.8, height: 45 },
  { label: "1 kanal to 30 marla", upTo: 30.001, front: 10, rear: 7, side: 5, sides: 1, coverage: 65, far: 2.6, height: 45 },
  { label: "Over 30 marla to under 2 kanal", upTo: 40, front: 10, rear: 7, side: 5, sides: 2, coverage: 60, far: 2.4, height: 45 },
  { label: "2 to under 4 kanal", upTo: 80, front: 20, rear: 10, side: 10, sides: 2, coverage: 55, far: 2.2, height: 45 },
  { label: "4 kanal and above", upTo: Infinity, front: 20, rear: 13, side: 13, sides: 2, coverage: 55, far: 2.2, height: 45 },
];

export function marla(width_ft: number, depth_ft: number): number {
  return Math.round(((width_ft * depth_ft) / MARLA_SQFT) * 100) / 100;
}

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

export function envelopeFor(width_ft: number, depth_ft: number, corner = false, authority: Authority = "LDA"): Envelope {
  const area = width_ft * depth_ft;
  const m = marla(width_ft, depth_ft);
  const b = BANDS.find((x) => m < x.upTo) ?? BANDS[BANDS.length - 1];
  const left = b.sides === 2 ? b.side : 0;
  const right = b.sides >= 1 ? b.side : 0;
  const rect = { x: left, y: b.front, w: Math.max(0, width_ft - left - right), d: Math.max(0, depth_ft - b.front - b.rear) };
  const buildable = rect.w * rect.d;
  const cap = (area * b.coverage) / 100;
  const notes = [
    `Keep the front ${b.front} ft open as the building line, and ${b.rear} ft at the back.`,
    b.sides === 0
      ? "No side space is needed in this band, so you can build wall to wall."
      : b.sides === 1
        ? `Leave a ${b.side} ft side space on one side (LDA lets you swap sides for a fee).`
        : `Leave ${b.side} ft open on both sides.`,
    buildable < cap
      ? `The setbacks bind first: about ${fmt(buildable)} sq ft per floor, under the ${b.coverage}% cap of ${fmt(cap)} sq ft.`
      : `Ground coverage binds first: up to ${b.coverage}% of the plot, ${fmt(cap)} sq ft.`,
    `Up to ${b.height} ft from the road crown to the top of the parapet, and 3 storeys plus a basement. A stair tower (mumty) up to 9'6" is extra.`,
  ];
  if (corner) notes.push(`Corner plot: splay the corner by ${m <= 10 ? 5 : 10} ft on both sides.`);
  if (authority === "DHA") notes.push("DHA Lahore has its own bylaws (39 ft cap). These LDA numbers are a guide only.");
  if (authority === "BAHRIA") notes.push("Bahria Town has its own bylaws. These LDA numbers are a guide only.");
  return {
    authority,
    band: b.label,
    setbacks_ft: { front: b.front, rear: b.rear, left, right },
    side_space_note: b.sides === 1 ? `${b.side} ft side space on one side` : b.sides === 2 ? `${b.side} ft on both sides` : undefined,
    max_coverage_pct: b.coverage,
    max_far: b.far,
    max_height_ft: b.height,
    max_storeys: 3,
    buildable_rect: rect,
    max_ground_coverage_sqft: Math.round(cap),
    notes,
  };
}

// ── Re-check (mirrors the engine's room checks and wording) ─────────────────────────────────────────

const OUTDOOR = new Set(["lawn", "driveway", "open_space", "courtyard"]);
const OPEN_DECK = new Set(["balcony", "terrace"]);
const PARKING = new Set(["porch", "garage"]);
const KITCHENS = new Set(["kitchen", "dirty_kitchen"]);
const GLAZED = new Set(["window", "corner_window", "sliding_door"]);

const area = (r: Room) => r.rect.w * r.rect.d;
const r1 = (n: number) => Math.round(n * 10) / 10;
const ftp = (n: number) => `${Number(n.toFixed(2))}′`;

const OPEN_AIR = new Set(["porch", "balcony", "terrace", "lawn", "driveway", "courtyard", "open_space"]);

/** Glazed area to the outside (or to an open-air space), as the engine counts it. */
function glazing(plan: BuildingPlan, room: Room): number {
  return plan.openings
    .filter((o) => GLAZED.has(o.type) && o.between.includes(room.id))
    .filter((o) => {
      const other = o.between.find((x) => x !== room.id);
      return other === "exterior" || OPEN_AIR.has(plan.rooms.find((r) => r.id === other)?.type ?? "");
    })
    .reduce((s, o) => s + o.width_ft * o.height_ft, 0);
}

function roomCheck(c: ComplianceCheck, plan: BuildingPlan): ComplianceCheck {
  const [kind, id] = c.id.split(":");
  const room = id ? plan.rooms.find((r) => r.id === id) : undefined;
  if (!room) return c;
  const a = area(room);
  const minDim = Math.min(room.rect.w, room.rect.d);
  if (kind === "room.size") {
    if (KITCHENS.has(room.type)) {
      const ok = a >= 50 && minDim >= 6;
      return { ...c, status: ok ? "pass" : "fail", value: Math.round(a), message: `${room.name} is ${fmt(a)} sq ft (min 50 sq ft, 6′ wide).` };
    }
    const ok = a >= 100 && minDim >= 8;
    return {
      ...c,
      status: ok ? "pass" : "fail",
      value: Math.round(a),
      message: `${room.name} is ${ftp(room.rect.w)}×${ftp(room.rect.d)} = ${fmt(a)} sq ft (min 100 sq ft, 8′ wide).`,
    };
  }
  if (kind === "room.light") {
    const g = glazing(plan, room);
    const need = r1(a * 0.08);
    return {
      ...c,
      status: g >= need ? "pass" : "fail",
      value: r1(g),
      limit: need,
      message: g >= need
        ? `Glazing ${fmt(g)} sq ft vs ${fmt(need)} sq ft needed (8% of floor area).`
        : `${room.name} has ${fmt(g)} sq ft of glazing to the outside; LDA needs ${fmt(need)} sq ft (8% of floor area).`,
    };
  }
  return c;
}

/** The engine report for `plan`, derived from a real report of a closely related plan. */
export function recheck(plan: BuildingPlan, base: ComplianceReport = ARGON_REPORT): ComplianceReport {
  const checks = base.checks.map((c) => roomCheck(c, plan));
  const ground = plan.levels.find((l) => l.index === 0)?.id ?? "ground";
  const roof = plan.levels.find((l) => l.id === "roof")?.id ?? "roof";
  const building = plan.rooms.filter((r) => !OUTDOOR.has(r.type));
  const covered = building.filter((r) => r.level === ground).reduce((s, r) => s + area(r), 0);
  const floors = building.filter((r) => r.level !== roof && !OPEN_DECK.has(r.type) && !PARKING.has(r.type)).reduce((s, r) => s + area(r), 0);
  const plotArea = plan.site.plot.width_ft * plan.site.plot.depth_ft;
  const order = { fail: 0, warn: 1, pass: 2 } as const;
  const sorted = [...checks].sort((a, b) => order[a.status] - order[b.status]);
  return {
    ...base,
    ok: !checks.some((c) => c.status === "fail"),
    checks: sorted,
    metrics: {
      ...base.metrics,
      covered_area_sqft: covered,
      coverage_pct: r1((covered / plotArea) * 100),
      total_floor_area_sqft: floors,
      far: Math.round((floors / plotArea) * 100) / 100,
    },
  };
}
