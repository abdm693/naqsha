/**
 * Mock streams for concepts, design and revise. Event order and shapes follow the live API
 * (api/app/agents/*): design runs plan → LDA check → fix loop (5 → 1 → 0 failures) → 23 sections → save;
 * revise lives in ./revise.ts.
 * Timings are compressed versions of the real ones (scale with localStorage["naqsha.mock.speed"]).
 */
import type { Change, Concept, DesignSection, Version } from "@contracts/api-types";
import type { BuildingPlan, ComplianceReport } from "@contracts/plan";
import type { ConceptsBody } from "../client";
import { clone, db, findProject, now, save, touch, uid } from "./db";
import { ARGON_SECTIONS, CONCEPT_IMAGES, REMIX_IMAGES, clonePlan } from "./fixtures";
import { ARGON_REPORT, recheck } from "./lda";
import { ev, type Step } from "./stream";

// ── Concepts ────────────────────────────────────────────────────────────────────────────────────────

const VARIATIONS = [
  "white plaster volumes, a full-height grey stone pier, teak soffits and a cantilevered porch canopy",
  "a corner composition with stacked stone, timber cladding and a frameless glass balcony",
  "a deep white frame around the first floor with vertical teak battens and grey stone infill",
  "warm evening light, mirrored massing, teak bands and a stone-clad stair tower",
];

export async function* conceptsScript(pid: string, body: ConceptsBody): AsyncGenerator<Step> {
  const p = findProject(pid);
  const count = Math.max(1, Math.min(4, body.count ?? 4));
  const brief = p.brief;
  const styleName = brief?.style || "Modern Contemporary";
  const where = brief?.scheme ? `${brief.scheme}, Lahore` : "Lahore";
  const size = brief?.plot?.area_marla ? `${Math.round(brief.plot.area_marla)} marla` : "10 marla";
  const base = body.base_concept_id ? p.concepts.find((c) => c.id === body.base_concept_id) : undefined;
  const images = base ? REMIX_IMAGES : CONCEPT_IMAGES;
  const offset = base ? p.concepts.filter((c) => c.parent_id).length : p.concepts.filter((c) => !c.parent_id).length;

  if (p.stage === "setup") p.stage = "concepts";
  save();

  const prompts = Array.from({ length: count }, (_, i) =>
    base
      ? `Remix of the selected concept: ${body.instruction}. Keep the massing, camera and plot; golden hour, photoreal.`
      : `Photoreal golden-hour exterior of a ${size} ${styleName} house in ${where}: ${VARIATIONS[(i + offset) % VARIATIONS.length]}, 4 ft front boundary wall with a sliding gate.`,
  );

  // All four start at once (they run in parallel on the server)…
  for (let i = 0; i < count; i++) yield ev("concept.started", { index: i, prompt: prompts[i] });
  // …and land a few seconds apart (live: ~16–17 s each).
  const finishAt = [7200, 8100, 8900, 9800].slice(0, count);
  let elapsed = 0;
  for (let i = 0; i < count; i++) {
    const wait = Math.max(150, finishAt[i] - elapsed + Math.random() * 500);
    yield wait;
    elapsed += wait;
    const concept: Concept = {
      id: uid("c"),
      url: images[(i + offset) % images.length],
      prompt: prompts[i],
      model: "gemini-3.1-flash-image",
      created_at: now(),
      parent_id: base?.id,
      instruction: body.instruction,
    };
    const proj = findProject(pid);
    proj.concepts.push(concept);
    if (!proj.thumbnail_url) proj.thumbnail_url = concept.url;
    touch(proj);
    save();
    yield ev("concept", { index: i, concept });
  }
  yield ev("done", {});
}

// ── Design ──────────────────────────────────────────────────────────────────────────────────────────

/** Plans for the fix loop: attempt 1 has five under-glazed rooms, attempt 2 one, attempt 3 none. */
const UNDERSIZED: Record<string, number>[] = [
  { g_lounge_w1: 2, f_lounge_w: 3, f_bed3_w: 1.5, f_bed4_w: 1.5, g_guest_w: 1.5 },
  { f_lounge_w: 3 },
  {},
];

function attemptPlan(pid: string, attempt: number): BuildingPlan {
  const plan = clonePlan();
  const brief = findProject(pid).brief;
  if (brief) {
    if (brief.facing) plan.site.facing = brief.facing;
    if (brief.scheme) plan.site.scheme = brief.scheme;
    if (brief.coordinates) plan.site.coordinates = brief.coordinates;
  }
  const narrow = UNDERSIZED[attempt - 1] ?? {};
  for (const o of plan.openings) if (narrow[o.id] !== undefined) o.width_ft = narrow[o.id];
  return plan;
}

function* progressTicks(from: number, to: number, n: number, gap: number): Generator<Step> {
  for (let i = 1; i <= n; i++) {
    yield gap + Math.random() * 300;
    yield ev("progress", { chars: Math.round(from + ((to - from) * i) / n) });
  }
}

const failuresOf = (r: ComplianceReport) => r.checks.filter((c) => c.status === "fail").length;

export async function* designScript(pid: string): AsyncGenerator<Step> {
  const p = findProject(pid);
  p.stage = "planning";
  touch(p);
  save();

  let plan: BuildingPlan = clonePlan();
  let report: ComplianceReport = ARGON_REPORT;
  // Like the live API, each attempt streams its own character count (a full plan is ~17k characters).
  const sizes = [17_400, 16_800, 17_100];
  for (let attempt = 1; attempt <= 3; attempt++) {
    yield ev("stage", attempt === 1
      ? { stage: "plan", message: "Laying out the floors…" }
      : { stage: "fix", message: `Fixing ${failuresOf(report)} ${failuresOf(report) === 1 ? "issue" : "issues"}…` });
    yield* progressTicks(0, sizes[attempt - 1], attempt === 1 ? 7 : 4, attempt === 1 ? 1150 : 1000);
    yield 500;
    plan = attemptPlan(pid, attempt);
    yield ev("plan", { plan, attempt });
    yield 350;
    yield ev("stage", { stage: "compliance", message: `Checking ${report.checks.length} LDA rules…` });
    yield 900;
    report = attempt === 3 ? structuredClone(ARGON_REPORT) : recheck(plan);
    yield ev("compliance", { report, attempt });
    yield 900;
    if (report.ok) break;
  }

  findProject(pid).stage = "building";
  save();
  yield ev("stage", { stage: "build", message: "Building your home in 3D…" });
  yield 1200;

  let chars = 0;
  let lastTick = 0;
  const sections: DesignSection[] = [];
  for (let i = 0; i < ARGON_SECTIONS.length; i++) {
    const s = ARGON_SECTIONS[i];
    yield 450 + Math.random() * 900;
    chars += s.code.length + 40;
    if (Math.floor(chars / 3000) !== Math.floor(lastTick / 3000)) yield ev("progress", { chars });
    lastTick = chars;
    sections.push(s);
    yield ev("section", { section: s, index: i });
  }

  yield ev("stage", { stage: "save", message: "Saving this version…" });
  yield 700;
  const version = saveVersion(pid, plan, sections, report, `v${findProject(pid).versions.length + 1}: ${plan.rooms.length} spaces, ${sections.length} code sections`);
  yield ev("version", { version });
  yield ev("done", {});
}

export function saveVersion(
  pid: string,
  plan: BuildingPlan,
  sections: DesignSection[],
  compliance: ComplianceReport,
  summary: string,
  changes: Change[] = [],
  /** The version this one revises (defaults to the project's current version). */
  parentId?: string,
): Version {
  const p = findProject(pid);
  const selected = p.concepts.find((c) => c.id === p.selected_concept_id) ?? p.concepts[0];
  const version: Version = {
    id: uid("v"),
    n: p.versions.length + 1,
    created_at: now(),
    parent_id: parentId ?? p.current_version_id ?? undefined,
    plan,
    sections,
    compliance,
    changes,
    status: "ready",
    thumbnail_url: selected?.url,
  };
  db().versions[version.id] = version;
  p.versions.push({ id: version.id, n: version.n, created_at: version.created_at, status: "ready", summary });
  p.current_version_id = version.id;
  p.stage = "ready";
  p.thumbnail_url = p.thumbnail_url ?? selected?.url ?? null;
  touch(p);
  save();
  return clone(version);
}
