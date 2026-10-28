/**
 * Mock demo content, built from the real Argon v1 run (contracts/fixtures/argon-v1-*):
 * - one sample home for GET /samples (p_sample_johar): concepts, the LDA-checked plan, the 23-section design,
 *   and v2 from a walkthrough revision with resolved and rejected comments; cloned on demand
 * - a lived-in workspace with stable ids for deep links:
 *   p_demo_johar (ready, v1 + v2), p_demo_lake (choosing concepts), p_demo_wapda (mid-setup, corner kanal plot)
 */
import type { Author, Brief, Change, ChatMessage, Comment, Concept, Project, Version } from "@contracts/api-types";
import { db, save, uid, withPlot } from "./db";
import { ARGON_SECTIONS, CONCEPT_IMAGES, clonePlan, revisedSection } from "./fixtures";
import { demoSetupState } from "./intake";
import { ARGON_REPORT, envelopeFor, recheck } from "./lda";
import { NAQSHA, PORCH_REJECTION, deepenBedroom2 } from "./revise";

/** People in the demo conversations. */
const SANA: Author = { id: "u_sana", name: "Sana Malik", role: "client" };
const BILAL: Author = { id: "u_bilal", name: "Bilal Ahmed", role: "team" };

const SEED_KEY = "naqsha.mock.seeded.v2";
/** Same key format as app/lib/fixloop.ts (the fix loop of the real run went 5 → 1 → 0). */
const FIX_LOOP_KEY = (vid: string) => `naqsha.fixloop.${vid}`;

function ago(minutes: number) {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function brief(partial: Partial<Brief>): Brief {
  return {
    city: "Lahore",
    authority: "LDA",
    scheme: "Johar Town",
    plot: { width_ft: 35, depth_ft: 65, area_marla: 10.1, corner: false },
    facing: "N",
    storeys: 2,
    basement: false,
    bedrooms: 4,
    bathrooms: 5,
    spaces: ["drawing", "tv_lounge", "dining", "kitchen", "dirty_kitchen", "car_porch:1", "lawn", "store", "laundry"],
    style: "Modern Contemporary",
    budget: "standard",
    auto_filled: [],
    ...partial,
  };
}

function concepts(pid: string, when: string, where: string): Concept[] {
  const looks = [
    "white plaster volumes, a full-height grey stone pier, teak soffits and a cantilevered porch canopy",
    "a corner composition with stacked stone, timber cladding and a frameless glass balcony",
    "a deep white frame around the first floor with vertical teak battens and grey stone infill",
    "warm evening light, mirrored massing, teak bands and a stone-clad stair tower",
  ];
  return CONCEPT_IMAGES.map((url, i) => ({
    id: `${pid}_c${i + 1}`,
    url,
    prompt: `Photoreal golden-hour exterior of a 10 marla Modern Contemporary house in ${where}, Lahore: ${looks[i]}, 4 ft front boundary wall with a sliding gate.`,
    model: "gemini-3.1-flash-image",
    created_at: when,
  }));
}

function transcript(answer: string, when: string): ChatMessage[] {
  return [
    { id: uid("msg"), role: "assistant", text: "Assalam-o-alaikum! I'm your AI architect. First: where is the plot?", created_at: when },
    { id: uid("msg"), role: "user", text: answer, created_at: when },
    { id: uid("msg"), role: "assistant", text: "Your brief is ready. Next, I'll sketch four exterior concepts for you to choose from.", created_at: when },
  ];
}

/** A finished home: v1 from the Argon run, v2 from a walkthrough revision, with resolved comments. */
function finishedHome(pid: string, name: string, vPrefix: string): { project: Project; versions: Version[]; comments: Comment[]; messages: ChatMessage[] } {
  const t1 = ago(26 * 60);
  const b = brief({ scheme: "Johar Town" });
  const c1 = concepts(pid, t1, "Johar Town");
  const plan = clonePlan();
  const v1: Version = {
    id: `${vPrefix}_1`,
    n: 1,
    created_at: ago(25 * 60),
    plan,
    sections: ARGON_SECTIONS,
    compliance: structuredClone(ARGON_REPORT),
    changes: [],
    status: "ready",
    thumbnail_url: c1[2].url,
  };

  const plan2 = clonePlan();
  deepenBedroom2(plan2);
  const comment = (id: string, author: Author, text: string, room: string, level: string, label: string, minutesAgo: number, snapshot: string, versionId = v1.id): Comment => ({
    id,
    version_id: versionId,
    text,
    anchor: { position: [0, 0, 0], normal: [0, 0, 1], room, level, label },
    camera: { position: [5.3, 9, 14], target: [5.3, 4, -6] },
    snapshot_url: snapshot,
    created_at: ago(minutesAgo),
    status: "open",
    author,
    replies: [],
  });
  const comments: Comment[] = [
    comment(`${pid}_cm_porch`, SANA, "Can we extend the car porch 4 feet forward into the front lawn?", "g_porch", "ground", "Car porch roof", 23 * 60, "/mock/concept-1.jpg"),
    comment(`${pid}_cm_bed2`, BILAL, "Bedroom 2 feels cramped, can it be bigger?", "f_bed2", "first", "Bedroom 2", 23 * 60 - 2, "/mock/remix-1.jpg"),
    comment(`${pid}_cm_louvers`, SANA, "Warmer wood on the balcony louvers please", "f_balcony", "first", "Front balcony louvers", 23 * 60 - 4, "/mock/concept-3.jpg"),
  ];
  const changes: Change[] = [
    { id: "ch1", summary: "Deepened Bedroom 2 by 2 ft into the front balcony (110 → 130 sq ft)", kind: "plan", targets: ["f_bed2", "f_bath2", "f_balcony"], comment_ids: [comments[1].id] },
    { id: "ch2", summary: "Rewrote the right-bay facade: warmer teak louvers and a full-height stone pier", kind: "section", targets: ["facade_right_bay"], comment_ids: [comments[2].id] },
  ];
  const sections2 = ARGON_SECTIONS.map((s) =>
    s.name === "furnish_f_bed2"
      ? revisedSection(s.name, "Bedroom 2 is 2 ft deeper; the bed moves back and a study desk fits by the balcony door.") ?? s
      : s.name === "facade_right_bay"
        ? revisedSection(s.name, "warmer teak louvers wrap the balcony; the stone pier now runs to the parapet.") ?? s
        : s,
  );
  const v2: Version = {
    id: `${vPrefix}_2`,
    n: 2,
    created_at: ago(22 * 60),
    parent_id: v1.id,
    plan: plan2,
    sections: sections2,
    compliance: recheck(plan2),
    changes,
    status: "ready",
    thumbnail_url: c1[2].url,
  };
  const resolutions: [Comment["status"], string][] = [
    ["rejected", PORCH_REJECTION],
    ["resolved", "Bedroom 2 is now 10×13 ft (130 sq ft), up from 110, by taking 2 ft from the front balcony, which stays 3 ft deep. It still passes every LDA room-size and daylight check."],
    ["resolved", "Updated the facade here: the teak louvers are warmer and wrap the balcony, and the stone pier now runs up to the parapet."],
  ];
  comments.forEach((cm, i) =>
    Object.assign(cm, {
      status: resolutions[i][0],
      resolution: resolutions[i][1],
      resolved_in_version: v2.id,
      replies: [{ id: `${cm.id}_r1`, author: NAQSHA, text: resolutions[i][1], created_at: ago(22 * 60) }],
    }),
  );
  // Open notes on v2, ready to apply.
  const kitchen = comment(`${pid}_cm_kitchen`, SANA, "Could the kitchen open into the dining? My mother likes to see the table while she cooks.", "g_kitchen", "ground", "Kitchen", 50, "/mock/remix-2.jpg", v2.id);
  kitchen.replies = [
    { id: `${kitchen.id}_r1`, author: BILAL, text: "We can drop the wall and keep a half-height counter. I'll flag it for the next version.", created_at: ago(41) },
  ];
  const stair = comment(`${pid}_cm_stair`, BILAL, "Add a skylight over the stair so the landing gets daylight.", "f_stair", "first", "Stair landing", 35, "/mock/remix-3.jpg", v2.id);
  comments.push(kitchen, stair);

  const project: Project = {
    id: pid,
    name,
    created_at: t1,
    updated_at: ago(22 * 60),
    stage: "ready",
    brief: b,
    envelope: envelopeFor(35, 65),
    concepts: c1,
    selected_concept_id: c1[2].id,
    versions: [
      { id: v1.id, n: 1, created_at: v1.created_at, status: "ready", summary: `v1: ${plan.rooms.length} spaces, ${v1.sections.length} code sections` },
      { id: v2.id, n: 2, created_at: v2.created_at, status: "ready", summary: changes.map((x) => x.summary).join("; ") },
    ],
    current_version_id: v2.id,
    thumbnail_url: c1[2].url,
  };
  return { project, versions: [v1, v2], comments, messages: transcript("10 marla in Johar Town, 4 bedrooms, modern", t1) };
}

function store(home: ReturnType<typeof finishedHome>, into: "projects" | "samples") {
  const d = db();
  for (const v of home.versions) d.versions[v.id] = v;
  d.comments[home.project.id] = home.comments;
  d.messages[home.project.id] = home.messages;
  d.intake[home.project.id] = { step: 99, done: true, brief: withPlot(home.project.brief!) };
  d[into].push(home.project);
  try { localStorage.setItem(FIX_LOOP_KEY(home.versions[0].id), JSON.stringify([5, 1, 0])); } catch { /* ignore */ }
}

/** The sample home behind "Explore a sample home". */
export function ensureSamples() {
  const d = db();
  if (d.samples?.length) return;
  d.samples = [];
  store(finishedHome("p_sample_johar", "10 marla family home, Johar Town", "v_sample_johar"), "samples");
  save();
}

export function seedIfEmpty() {
  ensureSamples();
  let seeded = false;
  try { seeded = localStorage.getItem(SEED_KEY) === "1"; } catch { /* ignore */ }
  const d = db();
  if (seeded || d.projects.length) return;

  // 1. Ready to walk, with a client and an architect on it.
  store(finishedHome("p_demo_johar", "Johar Town family home", "v_demo_johar"), "projects");
  d.members.p_demo_johar = [
    { uid: SANA.id, email: "sana@example.com", name: SANA.name, role: "client", status: "active" },
    { uid: BILAL.id, email: "bilal@example.com", name: BILAL.name, role: "team", status: "active" },
  ];

  // 2. Choosing a concept.
  const pid2 = "p_demo_lake";
  const t2 = ago(190);
  const b2 = brief({ scheme: "Lake City", bedrooms: 5, bathrooms: 6, facing: "E", auto_filled: ["budget"] });
  d.projects.push({
    id: pid2,
    name: "Lake City, for Ammi and Abbu",
    created_at: t2,
    updated_at: ago(170),
    stage: "concepts",
    brief: b2,
    envelope: envelopeFor(35, 65),
    concepts: concepts(pid2, t2, "Lake City"),
    selected_concept_id: null,
    versions: [],
    current_version_id: null,
    thumbnail_url: CONCEPT_IMAGES[1],
  });
  d.messages[pid2] = transcript("Lake City, 10 marla, east facing, 5 bedrooms", t2);
  d.intake[pid2] = { step: 99, done: true, brief: withPlot(b2) };

  // 3. Mid-setup.
  const pid3 = "p_demo_wapda";
  const setup = demoSetupState();
  d.projects.push({
    id: pid3,
    name: "1 kanal corner plot, Wapda Town",
    created_at: ago(12),
    updated_at: ago(9),
    stage: "setup",
    brief: setup.brief,
    envelope: envelopeFor(setup.brief.plot!.width_ft, setup.brief.plot!.depth_ft, setup.brief.plot!.corner),
    concepts: [],
    selected_concept_id: null,
    versions: [],
    current_version_id: null,
    thumbnail_url: null,
  });
  d.messages[pid3] = setup.messages;
  d.intake[pid3] = { step: setup.step, done: false, brief: setup.brief };

  // 4. Shared with you (listed once you sign in): an architect's home you are on the team of.
  store(finishedHome("p_demo_gulberg", "Gulberg corner house", "v_demo_gulberg"), "projects");
  d.members.p_demo_gulberg = [{ email: "*", role: "team", status: "active" }];
  d.owners.p_demo_gulberg = "u_ahmed";
  d.ownerNames.p_demo_gulberg = "Ahmed Builders";

  save();
  try { localStorage.setItem(SEED_KEY, "1"); } catch { /* ignore */ }
}
