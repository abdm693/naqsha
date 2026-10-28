/** Mock intake agent: six one-tap questions plus an optional map pin, then a complete 10-marla LDA brief. */
import type { Brief as BriefBase, BriefPlot, ChatMessage, Chip } from "@contracts/api-types";

/** The mock always keeps a plot on its working brief (zeros until known). */
type Brief = BriefBase & { plot: BriefPlot };
import type { Authority } from "@contracts/plan";
import type { IntakeBody } from "../client";
import { BUDGET_LABEL, PLOT_PRESETS, STYLE_OPTIONS, parseCoordinates, plotLabel, spaceLabel, toMarla } from "../domain";
import { db, findProject, now, save, touch, uid, type IntakeState } from "./db";
import { envelopeFor } from "./lda";
import { ev, type Step } from "./stream";

type Field = "scheme" | "plot" | "facing" | "rooms" | "style" | "budget" | "coordinates";

interface Question {
  field: Field;
  text: string;
  chips?: Chip[];
  multi?: boolean;
  input?: ChatMessage["input"];
}

const QUESTIONS: Question[] = [
  {
    field: "scheme",
    text: "First: where is the plot?",
    chips: [
      { label: "Johar Town", value: "LDA:Johar Town", hint: "LDA scheme" },
      { label: "LDA Avenue 1", value: "LDA:LDA Avenue 1", hint: "LDA scheme" },
      { label: "Wapda Town", value: "LDA:Wapda Town", hint: "LDA-approved" },
      { label: "Lake City", value: "LDA:Lake City", hint: "LDA-approved" },
      { label: "DHA Lahore", value: "DHA:DHA Lahore", hint: "Own bylaws" },
      { label: "Bahria Town", value: "BAHRIA:Bahria Town", hint: "Own bylaws" },
    ],
  },
  { field: "plot", input: "plot", text: "How big is the plot? Pick a standard size or enter the exact width and depth." },
  {
    field: "facing",
    text: "Which way does the front of the plot, the road side, face?",
    chips: [
      { label: "North", value: "N" },
      { label: "East", value: "E" },
      { label: "South", value: "S" },
      { label: "West", value: "W" },
      { label: "Not sure", value: "unknown", hint: "I'll assume north" },
    ],
  },
  { field: "rooms", input: "rooms", text: "Now the family. How many bedrooms and baths, and which spaces do you want?" },
  { field: "style", input: "style", text: "Which look do you love? I'll carry it through the concepts, the facade and the interiors." },
  {
    field: "budget",
    text: "What finish level should I design for? It changes materials, not the layout.",
    chips: [
      { label: "Economy", value: "economy", hint: "Simple, durable finishes" },
      { label: "Standard", value: "standard", hint: "Porcelain floors, local fittings" },
      { label: "Premium", value: "premium", hint: "Marble, wood, imported fittings" },
      { label: "Luxury", value: "luxury", hint: "Bespoke throughout" },
    ],
  },
  {
    field: "coordinates",
    input: "map",
    text: "Last one, and it's optional: paste a Google Maps link or coordinates so I can orient the sun to the real site.",
  },
];

const GREETING =
  "Assalam-o-alaikum! I'm your AI architect. Six quick questions, mostly one tap each, and you'll have concepts, a code-checked naqsha and a 3D home to walk through. Skip anything and I'll choose for you.";

export function blankBrief(): Brief {
  return {
    city: "Lahore",
    authority: "LDA",
    plot: { width_ft: 0, depth_ft: 0, area_marla: 0, corner: false },
    storeys: 0,
    basement: false,
    bedrooms: 0,
    bathrooms: 0,
    spaces: [],
    style: "",
    auto_filled: [],
  };
}

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const r1 = (n: number) => Math.round(n * 10) / 10;

function markAuto(b: Brief, ...fields: string[]) {
  for (const f of fields) if (!b.auto_filled.includes(f)) b.auto_filled.push(f);
}
function unmarkAuto(b: Brief, ...fields: string[]) {
  b.auto_filled = b.auto_filled.filter((f) => !fields.includes(f));
}

function setPlot(b: Brief, w: number, d: number, corner = false) {
  b.plot = { width_ft: w, depth_ft: d, area_marla: r1(toMarla(w, d)), corner };
}

function roomDefaults(marla: number) {
  const bedrooms = marla < 5 ? 2 : marla < 10 ? 3 : marla < 20 ? 4 : marla < 40 ? 5 : 6;
  return { storeys: 2, bedrooms, bathrooms: bedrooms + 1 };
}

/** Default for one field; returns the phrase used in the acknowledgement. */
function autoFill(b: Brief, field: Field): string | null {
  switch (field) {
    case "scheme":
      b.city = "Lahore"; b.authority = "LDA"; b.scheme = "Johar Town";
      markAuto(b, "scheme");
      return "an LDA scheme like Johar Town";
    case "plot":
      setPlot(b, 35, 65);
      markAuto(b, "plot");
      return "a 10 marla plot (35 × 65 ft), the most common family size";
    case "facing":
      b.facing = "N";
      markAuto(b, "facing");
      return "north-facing";
    case "rooms": {
      const d = roomDefaults(b.plot.area_marla || 10);
      b.storeys = d.storeys; b.bedrooms = d.bedrooms; b.bathrooms = d.bathrooms;
      b.spaces = ["drawing", "tv_lounge", "dining", "kitchen", "car_porch:1", "lawn"];
      markAuto(b, "storeys", "bedrooms", "bathrooms", "spaces");
      return `${d.bedrooms} bedrooms and ${d.bathrooms} baths over ${d.storeys} storeys, with a drawing room, TV lounge and car porch`;
    }
    case "style":
      b.style = "Modern Contemporary";
      markAuto(b, "style");
      return "Modern Contemporary, the most requested look in Lahore right now";
    case "budget":
      b.budget = "standard";
      markAuto(b, "budget");
      return "standard finishes";
    case "coordinates":
      return null;
  }
}

function chipMap(chips: string[] = []) {
  const kv = new Map<string, string>();
  const plain: string[] = [];
  for (const c of chips) {
    const i = c.indexOf(":");
    const key = i > 0 ? c.slice(0, i) : "";
    if (["plot", "corner", "storeys", "bedrooms", "bathrooms", "coords", "style"].includes(key)) kv.set(key, c.slice(i + 1));
    else plain.push(c);
  }
  return { kv, plain };
}

/** Apply an answer. Returns the acknowledgement sentence(s). */
function applyAnswer(b: Brief, field: Field, body: IntakeBody): string {
  const text = (body.message ?? "").trim();
  const { kv, plain } = chipMap(body.chips);
  const lower = text.toLowerCase();

  switch (field) {
    case "scheme": {
      const chip = plain[0] ?? "";
      let authority: Authority = "LDA";
      let scheme = text || "Johar Town";
      if (chip.includes(":")) {
        authority = chip.split(":")[0] as Authority;
        scheme = chip.split(":").slice(1).join(":");
      } else if (/dha|defen[cs]e/.test(lower)) {
        authority = "DHA";
      } else if (/bahria/.test(lower)) {
        authority = "BAHRIA";
      }
      b.city = "Lahore"; b.authority = authority; b.scheme = scheme;
      unmarkAuto(b, "scheme");
      if (authority === "DHA" || authority === "BAHRIA") {
        const short = authority === "DHA" ? "DHA" : "Bahria";
        return `${scheme} has its own bylaws${authority === "DHA" ? " (a 39 ft height cap, for one)" : ""}. I'll design to LDA rules, which are close, and flag where ${short} differs.`;
      }
      const approved = ["Wapda Town", "Lake City"].includes(scheme);
      return `${scheme} is ${approved ? "an LDA-approved scheme" : "an LDA scheme"}, so I'll check everything against the LDA Building & Zoning Regulations 2019, as consolidated in 2026.`;
    }
    case "plot": {
      const dims = kv.get("plot") ?? text.match(/(\d+(?:\.\d+)?)\s*(?:x|×|\*|by)\s*(\d+(?:\.\d+)?)/i)?.slice(1, 3).join("x");
      const corner = kv.get("corner") === "true" || /corner/.test(lower);
      if (dims) {
        const [w, d] = dims.split("x").map(Number);
        setPlot(b, w, d, corner);
      } else {
        const m = lower.match(/(\d+(?:\.\d+)?)\s*(marla|kanal)/);
        const marla = m ? Number(m[1]) * (m[2] === "kanal" ? 20 : 1) : 10;
        const preset = PLOT_PRESETS.find((p) => Math.abs(p.marla - marla) < 0.01);
        if (preset) setPlot(b, preset.width_ft, preset.depth_ft, corner);
        else {
          const area = marla * 225;
          const w = Math.round(Math.sqrt(area * 0.55));
          setPlot(b, w, r1(area / w), corner);
        }
      }
      unmarkAuto(b, "plot");
      return plotAck(b);
    }
    case "facing": {
      const chip = plain[0] ?? "";
      const fromText = /north/.test(lower) ? "N" : /south/.test(lower) ? "S" : /east/.test(lower) ? "E" : /west/.test(lower) ? "W" : "";
      const f = (["N", "E", "S", "W", "NE", "NW", "SE", "SW"].includes(chip) ? chip : fromText) as Brief["facing"] | "";
      if (!f) {
        b.facing = "N";
        markAuto(b, "facing");
        return "No problem, I'll assume north-facing for now. You can change it on the brief later.";
      }
      b.facing = f;
      unmarkAuto(b, "facing");
      return {
        N: "North-facing is the easy one in Lahore: the front stays out of the harsh sun, so big front windows work.",
        S: "South-facing: the front takes strong sun all day, so I'll add deep chajjas and vertical fins.",
        E: "East-facing: soft morning sun at the front, so the drawing room will glow at breakfast.",
        W: "West-facing: the front gets the hot afternoon sun, so I'll shade it with fins and a deep porch canopy.",
      }[f as "N" | "S" | "E" | "W"] ?? "Noted.";
    }
    case "rooms": {
      const d = roomDefaults(b.plot.area_marla || 10);
      const num = (re: RegExp) => Number(lower.match(re)?.[1] ?? NaN);
      b.bedrooms = Number(kv.get("bedrooms") ?? (num(/(\d+)\s*bed/) || d.bedrooms));
      b.bathrooms = Number(kv.get("bathrooms") ?? (num(/(\d+)\s*bath/) || d.bathrooms));
      b.storeys = Math.min(3, Number(kv.get("storeys") ?? (num(/(\d+)\s*(?:storey|story|floor)/) || d.storeys)));
      const spaces = new Set(plain.length ? plain : ["drawing", "tv_lounge", "car_porch:1"]);
      if (!plain.length) {
        if (/drawing/.test(lower)) spaces.add("drawing");
        if (/lawn|garden/.test(lower)) spaces.add("lawn");
        if (/servant/.test(lower)) spaces.add("servant_quarter");
      }
      spaces.add("kitchen");
      spaces.add("dining");
      b.spaces = [...spaces];
      unmarkAuto(b, "storeys", "bedrooms", "bathrooms", "spaces");
      const env = envelopeFor(b.plot.width_ft || 35, b.plot.depth_ft || 65, b.plot.corner, b.authority);
      const perFloor = Math.min(env.buildable_rect.w * env.buildable_rect.d, env.max_ground_coverage_sqft);
      const fits = b.bedrooms <= b.storeys * 3 + 1;
      return fits
        ? `${b.bedrooms} bedrooms and ${b.bathrooms} baths over ${b.storeys} storey${b.storeys === 1 ? "" : "s"} fits well: the envelope allows about ${fmt(perFloor)} sq ft per floor.`
        : `${b.bedrooms} bedrooms on ${b.storeys} storey${b.storeys === 1 ? "" : "s"} is tight for this plot; I'll keep rooms at least 100 sq ft as LDA requires and tell you if one doesn't fit.`;
    }
    case "style": {
      const chosen = kv.get("style") ?? plain[0] ?? "";
      const match = STYLE_OPTIONS.find((s) => s.name.toLowerCase() === chosen.toLowerCase())
        ?? STYLE_OPTIONS.find((s) => lower.includes(s.name.toLowerCase().split(" ")[0]));
      if (match) {
        b.style = match.name;
      } else {
        b.style = text || "Modern Contemporary";
      }
      if (text && match && text.toLowerCase() !== match.name.toLowerCase()) b.style_notes = text;
      unmarkAuto(b, "style");
      return `${b.style} it is.`;
    }
    case "budget": {
      const chip = plain[0] ?? "";
      const v = (["economy", "standard", "premium", "luxury"].find((k) => chip === k || lower.includes(k)) ?? "standard") as Brief["budget"];
      b.budget = v;
      unmarkAuto(b, "budget");
      return `${BUDGET_LABEL[v ?? "standard"]} finishes, noted.`;
    }
    case "coordinates": {
      const coords = kv.get("coords") ? parseCoordinates(kv.get("coords")!) : parseCoordinates(text);
      if (!coords) return "I couldn't read coordinates from that, so I'll skip the pin. The map is optional.";
      b.coordinates = coords;
      return `Pinned at ${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}. I'll use it to place the sun correctly.`;
    }
  }
}

function plotAck(b: Brief): string {
  const env = envelopeFor(b.plot.width_ft, b.plot.depth_ft, b.plot.corner, b.authority);
  const sb = env.setbacks_ft;
  const sides = sb.left && sb.right ? `, plus ${sb.right} ft on both sides` : sb.right ? `, plus a ${sb.right} ft side space on one side` : "; no side space is needed";
  const buildable = env.buildable_rect.w * env.buildable_rect.d;
  const binding = buildable < env.max_ground_coverage_sqft
    ? `The setbacks leave about ${fmt(buildable)} sq ft per floor, inside the ${env.max_coverage_pct}% coverage cap.`
    : `You can cover up to ${env.max_coverage_pct}% of the ground, ${fmt(env.max_ground_coverage_sqft)} sq ft.`;
  const corner = b.plot.corner ? ` As a corner plot, the corner must be splayed by ${b.plot.area_marla <= 10 ? 5 : 10} ft.` : "";
  return `A ${plotLabel(b.plot.area_marla)} plot (${b.plot.width_ft} × ${b.plot.depth_ft} ft) falls in LDA's ${env.band.toLowerCase()} band. Keep ${sb.front} ft open at the front and ${sb.rear} ft at the back${sides}. ${binding} Height is capped at ${env.max_height_ft} ft and 3 storeys.${corner} The buildable envelope is drawn on the right.`;
}

function summary(b: Brief): string {
  const extras = b.spaces.filter((s) => !["kitchen", "dining"].includes(s)).map(spaceLabel).map((s) => s.toLowerCase());
  const list = extras.length ? `, ${extras.slice(0, -1).join(", ")}${extras.length > 1 ? " and " : ""}${extras[extras.length - 1]}` : "";
  return `Your brief is ready: a ${b.storeys}-storey ${b.style} home on a ${plotLabel(b.plot.area_marla)} plot in ${b.scheme ?? "Lahore"}, with ${b.bedrooms} bedrooms and ${b.bathrooms} baths${list}. It all fits inside the LDA envelope. Next, I'll sketch four exterior concepts for you to choose from.`;
}

function envelopeOf(b: Brief) {
  return b.plot.width_ft ? envelopeFor(b.plot.width_ft, b.plot.depth_ft, b.plot.corner, b.authority) : null;
}

function messageFor(text: string, q?: Question): ChatMessage {
  return {
    id: uid("msg"),
    role: "assistant",
    text,
    created_at: now(),
    chips: q?.chips,
    multi: q?.multi,
    input: q?.input ?? null,
    field: q?.field,
    allow_skip: q ? true : undefined,
  };
}

/**
 * A conversation paused at the rooms question (scheme, a corner 1-kanal plot and facing answered),
 * built with the same question flow, for the seeded demo workspace.
 */
export function demoSetupState(): { messages: ChatMessage[]; brief: Brief; step: number } {
  const brief = blankBrief();
  const messages: ChatMessage[] = [];
  const user = (text: string) => messages.push({ id: uid("msg"), role: "user", text, created_at: now() });
  messages.push(messageFor(`${GREETING}\n\n${QUESTIONS[0].text}`, QUESTIONS[0]));
  user("Wapda Town");
  let ack = applyAnswer(brief, "scheme", { message: "Wapda Town", chips: ["LDA:Wapda Town"] });
  messages.push(messageFor(`${ack}\n\n${QUESTIONS[1].text}`, QUESTIONS[1]));
  user("1 kanal plot, 50 × 90 ft, corner");
  ack = applyAnswer(brief, "plot", { message: "1 kanal plot, 50 × 90 ft, corner", chips: ["plot:50x90", "corner:true"] });
  messages.push(messageFor(`${ack}\n\n${QUESTIONS[2].text}`, QUESTIONS[2]));
  user("North");
  ack = applyAnswer(brief, "facing", { message: "North", chips: ["N"] });
  messages.push(messageFor(`${ack}\n\n${QUESTIONS[3].text}`, QUESTIONS[3]));
  return { messages, brief, step: 3 };
}

/** The live intake agent answers in one structured call (~8 s) without deltas; mirror that. */
async function* say(pid: string, text: string, q?: Question): AsyncGenerator<Step> {
  const msg = messageFor(text, q);
  (db().messages[pid] ??= []).push(msg);
  save();
  yield ev("message", msg);
}

/** Same wording as the live server's echo of the user's turn. */
function userText(body: IntakeBody): string {
  if (body.action === "skip_question") return "Skip — you decide.";
  if (body.action === "skip_all") return "Skip setup — design it for me.";
  return body.message?.trim() || (body.chips ?? []).join(", ");
}

/** The live agent takes ~8 s a turn; the mock thinks for ~3 s. */
const think = () => 2400 + Math.random() * 1200;

function rename(pid: string, b: Brief) {
  const p = findProject(pid);
  if (p.name === "Untitled home" && b.plot.area_marla) {
    p.name = `${plotLabel(b.plot.area_marla).replace(/^\w/, (c) => c.toUpperCase())} house${b.scheme ? `, ${b.scheme}` : ""}`;
  }
}

function syncProject(pid: string, st: IntakeState) {
  const p = findProject(pid);
  p.brief = structuredClone(st.brief);
  p.envelope = envelopeOf(st.brief);
  rename(pid, st.brief);
  touch(p);
}

async function* complete(pid: string, st: IntakeState, lead?: string): AsyncGenerator<Step> {
  st.done = true;
  st.step = QUESTIONS.length;
  const p = findProject(pid);
  syncProject(pid, st);
  if (p.stage === "setup") p.stage = "concepts";
  save();
  yield* say(pid, lead ? `${lead}\n\n${summary(st.brief)}` : summary(st.brief));
  yield ev("intake.complete", { brief: st.brief, envelope: envelopeOf(st.brief) });
  yield ev("done", {});
}

export async function* intakeScript(pid: string, body: IntakeBody): AsyncGenerator<Step> {
  const d = db();
  findProject(pid);
  const st: IntakeState = (d.intake[pid] ??= { step: -1, done: false, brief: blankBrief() });
  const msgs = (d.messages[pid] ??= []);

  if (body.action === "start") {
    if (msgs.length) { yield ev("done", {}); return; }
    yield 1600;
    st.step = 0;
    save();
    yield ev("brief", { brief: st.brief, envelope: null });
    yield* say(pid, `${GREETING}\n\n${QUESTIONS[0].text}`, QUESTIONS[0]);
    yield ev("done", {});
    return;
  }

  // Record and echo the user's turn (the client swaps it for its optimistic copy).
  const userMsg: ChatMessage = { id: uid("msg"), role: "user", text: userText(body), created_at: now() };
  msgs.push(userMsg);
  save();
  yield ev("message", userMsg);
  yield think();

  if (st.done) {
    // Late edits after completion: apply free text to notes and confirm.
    if (body.message) st.brief.notes = [st.brief.notes, body.message].filter(Boolean).join("\n");
    syncProject(pid, st);
    save();
    yield ev("brief", { brief: st.brief, envelope: envelopeOf(st.brief) });
    yield* say(pid, "Added to your brief. I'll take it into account in the concepts and the plan.");
    yield ev("done", {});
    return;
  }

  if (body.action === "skip_all") {
    const chosen: string[] = [];
    for (let i = Math.max(0, st.step); i < QUESTIONS.length; i++) {
      const phrase = autoFill(st.brief, QUESTIONS[i].field);
      if (phrase) chosen.push(phrase);
    }
    syncProject(pid, st);
    save();
    yield ev("brief", { brief: st.brief, envelope: envelopeOf(st.brief) });
    yield 300;
    const lead = chosen.length
      ? `Done. I've chosen ${chosen.slice(0, -1).join("; ")}${chosen.length > 1 ? "; and " : ""}${chosen[chosen.length - 1]}. Everything marked "AI-chosen" can be changed later.`
      : "Done.";
    yield* complete(pid, st, lead);
    return;
  }

  const q = QUESTIONS[Math.max(0, st.step)];
  let ack: string;
  if (body.action === "skip_question") {
    const phrase = autoFill(st.brief, q.field);
    ack = phrase ? `No problem, I'll go with ${phrase}.` : "No problem, the map is optional.";
    if (q.field === "plot") ack += ` ${plotAck(st.brief)}`;
  } else {
    ack = applyAnswer(st.brief, q.field, body);
  }
  syncProject(pid, st);
  save();
  yield ev("brief", { brief: st.brief, envelope: envelopeOf(st.brief) });
  yield 250;

  st.step += 1;
  save();
  if (st.step >= QUESTIONS.length) {
    yield* complete(pid, st, ack);
    return;
  }
  const next = QUESTIONS[st.step];
  yield* say(pid, `${ack}\n\n${next.text}`, next);
  yield ev("done", {});
}
