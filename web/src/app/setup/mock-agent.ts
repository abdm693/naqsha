/**
 * Mock mode only: the overhaul's conversational setup agent (contracts/api.md "Setup messages"), so the Brief view
 * can be exercised without the backend. One message can fill the whole brief; Naqsha answers with the
 * "Here's what I understood" card, then at most three rounds (floors, roof, style), each one question with
 * one widget and "Decide for me". Persists to the mock store like the rest of the mock API.
 */
import type { Brief as BriefBase, BriefPlot, ChatMessage, Chip } from "@contracts/api-types";

/** The mock always keeps a plot on its working brief (zeros until known). */
type Brief = BriefBase & { plot: BriefPlot };
import type { IntakeBody, SSEHandlers, StreamOptions } from "@/api/client";
import { PLOT_PRESETS, STYLE_OPTIONS, plotLabel, toMarla } from "@/api/domain";
import { db, findProject, now, save, sleep, touch, uid } from "@/api/mock/db";
import { envelopeFor } from "@/api/mock/lda";
import { dispatchSSE } from "@/api/sse";
import { capacity, defaultProgram, describe, fromFloors, levelsFor, toFloors, type Program } from "./catalogue";

type Round = "describe" | "floors" | "roof" | "style" | "done";
const ROUNDS: Round[] = ["describe", "floors", "roof", "style", "done"];

const GREETING = "Assalam-o-alaikum. Tell me about the plot and who will live there. One message is enough.";
const OPENERS = [
  "10 marla in Johar Town, east-facing, mid-row, for a family of six",
  "1 kanal corner plot in Lake City, 5 bedrooms, parents downstairs",
  "5 marla, three storeys, open kitchen and a prayer room",
];

function blank(): Brief {
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
    preferences: [],
  };
}

const SCHEMES: [RegExp, string, Brief["authority"]][] = [
  [/johar town/i, "Johar Town", "LDA"],
  [/lda avenue/i, "LDA Avenue 1", "LDA"],
  [/wapda town/i, "Wapda Town", "LDA"],
  [/lake city/i, "Lake City", "LDA"],
  [/model town/i, "Model Town", "LDA"],
  [/gulberg/i, "Gulberg", "LDA"],
  [/valencia/i, "Valencia", "LDA"],
  [/garden town/i, "Garden Town", "LDA"],
  [/iqbal town|allama iqbal/i, "Allama Iqbal Town", "LDA"],
  [/\bdha\b|defen[cs]e/i, "DHA Lahore", "DHA"],
  [/bahria/i, "Bahria Town", "BAHRIA"],
];

const FACING: [RegExp, NonNullable<Brief["facing"]>][] = [
  [/north[- ]?east/i, "NE"],
  [/north[- ]?west/i, "NW"],
  [/south[- ]?east/i, "SE"],
  [/south[- ]?west/i, "SW"],
  [/\bnorth\b/i, "N"],
  [/\bsouth\b/i, "S"],
  [/\beast\b/i, "E"],
  [/\bwest\b/i, "W"],
];

const WORD_NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, single: 1, double: 2 };
const n = (s: string) => (WORD_NUM[s.toLowerCase()] ?? Number(s));
const NUM = "(\\d+|one|two|three|four|five|six|seven|eight|nine|ten|single|double)";

function setPlot(b: Brief, w: number, d: number, corner: boolean) {
  b.plot = { width_ft: w, depth_ft: d, area_marla: Math.round(toMarla(w, d) * 10) / 10, corner };
}

const unauto = (b: Brief, ...f: string[]) => (b.auto_filled = b.auto_filled.filter((x) => !f.includes(x)));
const auto = (b: Brief, ...f: string[]) => {
  for (const x of f) if (!b.auto_filled.includes(x)) b.auto_filled.push(x);
};
const addPref = (b: Brief, p: string) => {
  b.preferences = b.preferences ?? [];
  if (!b.preferences.some((x) => x.toLowerCase() === p.toLowerCase())) b.preferences.push(p);
};
const addSpace = (b: Brief, s: string) => {
  if (!b.spaces.includes(s)) b.spaces.push(s);
};

/** Read everything one message says about the home. Returns the fields it set. */
function understand(b: Brief, text: string): string[] {
  const t = ` ${text.toLowerCase()} `;
  const set: string[] = [];
  // Plot
  const dims = t.match(/(\d+(?:\.\d+)?)\s*(?:ft|feet|')?\s*(?:x|×|\*|by)\s*(\d+(?:\.\d+)?)/);
  const size = t.match(/(\d+(?:\.\d+)?)\s*(marla|kanal)/);
  const corner = /\bcorner\b/.test(t) ? true : /\b(mid[- ]?row|middle|not (a )?corner|in a row|row house)\b/.test(t) ? false : undefined;
  if (dims) {
    setPlot(b, Number(dims[1]), Number(dims[2]), corner ?? b.plot.corner);
    set.push("plot");
  } else if (size) {
    const marla = Number(size[1]) * (size[2] === "kanal" ? 20 : 1);
    const preset = PLOT_PRESETS.find((p) => Math.abs(p.marla - marla) < 0.01);
    if (preset) setPlot(b, preset.width_ft, preset.depth_ft, corner ?? b.plot.corner);
    else {
      const area = marla * 225;
      const w = Math.round(Math.sqrt(area * 0.55));
      setPlot(b, w, Math.round((area / w) * 10) / 10, corner ?? b.plot.corner);
    }
    set.push("plot");
  } else if (corner !== undefined && b.plot.width_ft) {
    b.plot = { ...b.plot, corner };
    set.push("plot");
  }
  if (corner !== undefined) set.push("corner");
  // Place
  for (const [re, scheme, authority] of SCHEMES) {
    if (re.test(t)) {
      b.scheme = scheme;
      b.authority = authority;
      set.push("scheme");
      break;
    }
  }
  // Facing
  if (/fac(e|es|ing)|front|road/.test(t)) {
    for (const [re, f] of FACING) {
      if (re.test(t)) {
        b.facing = f;
        set.push("facing");
        break;
      }
    }
  }
  // Storeys
  const st = t.match(new RegExp(`${NUM}[- ]?(?:storey|story|stories|storeys|floors?)\\b`));
  if (st && n(st[1]) >= 1 && n(st[1]) <= 3) {
    b.storeys = n(st[1]);
    set.push("storeys");
  }
  if (/\bbasement\b/.test(t)) {
    b.basement = !/no basement/.test(t);
    set.push("basement");
  }
  // Bedrooms and family
  const beds = t.match(new RegExp(`${NUM}\\s*(?:bed ?rooms?|beds?)\\b`));
  if (beds) {
    b.bedrooms = Math.min(9, n(beds[1]));
    b.bathrooms = b.bedrooms + 1;
    set.push("bedrooms");
  }
  const family = t.match(new RegExp(`(?:family|household) of ${NUM}|for ${NUM}(?: people)?\\b`));
  if (family && !beds) {
    const people = n(family[1] ?? family[2]);
    if (people) {
      b.bedrooms = Math.max(2, Math.min(7, Math.ceil(people / 2) + 1));
      b.bathrooms = b.bedrooms + 1;
      set.push("bedrooms");
      addPref(b, `a home for ${people}`);
    }
  }
  if (/parent|elder|grand ?(mother|father|parents)|ammi|abbu|dadi|nani/.test(t)) addPref(b, "parents' bedroom on the ground floor");
  // Spaces and wishes
  if (/drawing/.test(t)) addSpace(b, "drawing");
  if (/open kitchen|open[- ]plan kitchen/.test(t)) addPref(b, "open kitchen");
  if (/dirty kitchen/.test(t)) { addSpace(b, "dirty_kitchen"); addPref(b, "a dirty kitchen"); }
  if (/prayer|namaz/.test(t)) { addSpace(b, "prayer"); addPref(b, "a prayer room"); }
  if (/servant|maid|driver/.test(t)) { addSpace(b, "servant_quarter"); addPref(b, "a servant quarter"); }
  if (/\bstudy|office|work from home/.test(t)) { addSpace(b, "study"); addPref(b, "a study"); }
  if (/\blawn|garden/.test(t)) { addSpace(b, "lawn"); addPref(b, "a lawn"); }
  if (/laundry/.test(t)) addSpace(b, "laundry");
  if (/double[- ]height/.test(t)) addPref(b, "double-height lounge");
  if (/home cinema|cinema/.test(t)) addPref(b, "home cinema");
  const porch = t.match(new RegExp(`(?:porch|parking|garage) (?:for )?${NUM}\\s*cars?|${NUM}[- ]car (?:porch|parking|garage)`));
  if (porch) {
    const cars = n(porch[1] ?? porch[2]);
    b.spaces = b.spaces.filter((s) => !s.startsWith("car_porch"));
    addSpace(b, `car_porch:${cars}`);
    set.push("porch");
  }
  // Roof
  if (/(concrete|rcc|cement|underground)( water)? tank/.test(t)) {
    b.water_tank = "concrete";
    set.push("water_tank");
  } else if (/(plastic|blue)( water)? tank/.test(t)) {
    b.water_tank = "plastic";
    if (b.water_tank) set.push("water_tank");
  }
  if (/solar/.test(t)) {
    b.solar = /panels? now|install|put (solar )?panels|solar panels/.test(t) ? "panels" : "ready";
    set.push("solar");
  }
  // Style
  const style = STYLE_OPTIONS.find((s) => t.includes(s.name.toLowerCase())) ?? (/modern/.test(t) ? STYLE_OPTIONS[0] : /spanish/.test(t) ? STYLE_OPTIONS[1] : /minimal/.test(t) ? STYLE_OPTIONS[3] : undefined);
  if (style) {
    b.style = style.name;
    set.push("style");
  }
  // Budget
  const budget = (["economy", "standard", "premium", "luxury"] as const).find((k) => t.includes(k));
  if (budget) {
    b.budget = budget;
    set.push("budget");
  }
  unauto(b, ...set);
  return set;
}

/** Fill what the person didn't say, and remember it as assumed. */
function assume(b: Brief): string[] {
  const out: string[] = [];
  if (!b.plot.width_ft) {
    setPlot(b, 35, 65, false);
    auto(b, "plot");
    out.push("A 10 marla plot, 35 × 65 ft");
  }
  if (!b.scheme) {
    b.scheme = "Johar Town";
    b.authority = "LDA";
    auto(b, "scheme");
    out.push("An LDA scheme in Lahore");
  }
  if (!b.facing) {
    b.facing = "N";
    auto(b, "facing");
    out.push("The front faces north");
  }
  if (!b.storeys) {
    b.storeys = b.plot.area_marla < 4 ? 3 : 2;
    auto(b, "storeys");
    out.push(`${b.storeys} storeys`);
  }
  if (!b.bedrooms) {
    const m = b.plot.area_marla || 10;
    b.bedrooms = m < 5 ? 2 : m < 10 ? 3 : m < 20 ? 4 : 5;
    b.bathrooms = b.bedrooms + 1;
    auto(b, "bedrooms");
    out.push(`${b.bedrooms} bedrooms, each with its own bath`);
  }
  if (!b.spaces.some((s) => s.startsWith("car_porch"))) {
    const cars = (b.plot.area_marla || 10) >= 15 ? 2 : 1;
    addSpace(b, `car_porch:${cars}`);
    auto(b, "porch");
    out.push(cars === 1 ? "A one-car porch" : "A two-car porch");
  }
  for (const s of ["drawing", "tv_lounge", "dining", "kitchen"]) addSpace(b, s);
  if (!b.style) {
    b.style = "Modern Contemporary";
    auto(b, "style");
    out.push("A modern contemporary look");
  }
  if (!b.budget) {
    b.budget = "standard";
    auto(b, "budget");
    out.push("Standard finishes");
  }
  return out;
}

function guaranteed(b: Brief): string[] {
  const env = b.plot.width_ft ? envelopeFor(b.plot.width_ft, b.plot.depth_ft, b.plot.corner, b.authority) : null;
  const sb = env?.setbacks_ft;
  return [
    sb ? `${sb.front} ft open at the front and ${sb.rear} ft at the back` : "LDA setbacks on every side",
    env ? `Under ${env.max_height_ft} ft and ${env.max_storeys} storeys, ${env.max_coverage_pct}% ground coverage` : "LDA height and coverage limits",
    ...(b.plot.corner ? [`A ${b.plot.area_marla <= 10.15 ? 5 : 10} ft splay at the corner`] : []),
    "Every bedroom opens to a corridor or lounge",
    "The stair reaches the roof, with railings at every drop",
    "Doors clear, and a 3 ft path everywhere",
    "Cars park without blocking the way in",
  ];
}

function assumptionsOf(b: Brief): string[] {
  const a = new Set(b.auto_filled);
  const out: string[] = [];
  if (a.has("plot")) out.push(`${plotLabel(b.plot.area_marla)} plot, ${b.plot.width_ft} × ${b.plot.depth_ft} ft`);
  if (a.has("corner")) out.push(b.plot.corner ? "Corner plot" : "Mid-row plot, houses on both sides");
  if (a.has("scheme")) out.push(`${b.scheme}, LDA rules`);
  if (a.has("facing")) out.push("The front faces north");
  if (a.has("storeys")) out.push(`${b.storeys} storeys`);
  if (a.has("bedrooms")) out.push(`${b.bedrooms} bedrooms with attached baths`);
  if (a.has("porch")) out.push(b.spaces.includes("car_porch:2") ? "A two-car porch" : "A one-car porch");
  if (a.has("style")) out.push("Modern contemporary");
  if (a.has("budget")) out.push("Standard finishes");
  if (a.has("water_tank")) out.push(b.water_tank === "plastic" ? "Blue plastic tank" : "Concrete tank in the stair tower");
  if (a.has("solar")) out.push(b.solar === "none" ? "No solar for now" : "Roof kept clear for solar");
  if (a.has("floors")) out.push("Rooms per floor, the usual Lahore way");
  return out;
}

function prefsOf(b: Brief): string[] {
  const out = [...(b.preferences ?? [])];
  if (b.water_tank && !b.auto_filled.includes("water_tank")) out.push(b.water_tank === "plastic" ? "a blue plastic tank" : "a concrete tank");
  if (b.solar && b.solar !== "none" && !b.auto_filled.includes("solar")) out.push(b.solar === "panels" ? "solar panels now" : "a roof ready for solar");
  return [...new Set(out)];
}

const ROOF_CHIPS: Chip[] = [
  { label: "Blue plastic tank", value: "tank:plastic", hint: "Cheaper, visible" },
  { label: "Concrete tank in the stair tower", value: "tank:concrete", hint: "Recommended" },
  { label: "Keep the roof clear for solar", value: "solar:ready", hint: "About 18 panels, ~10 kW" },
  { label: "Raised solar frame", value: "solar:panels" },
  { label: "Not now", value: "solar:none" },
];

function styleChips(b: Brief): Chip[] {
  const first = STYLE_OPTIONS.find((s) => s.name === b.style) ?? STYLE_OPTIONS[0];
  const picks = [first, ...STYLE_OPTIONS.filter((s) => s.name !== first.name && ["Spanish", "Minimalist", "Modern Contemporary", "Mughal Revival"].includes(s.name))].slice(0, 3);
  return picks.map((s) => ({ label: s.name, value: s.name, hint: s.blurb }));
}

function msg(partial: Partial<ChatMessage> & { text: string }): ChatMessage {
  return { id: uid("msg"), role: "assistant", created_at: now(), ...partial };
}

function questionFor(round: Round, b: Brief, lead?: string): ChatMessage {
  const pre = lead ? `${lead}\n\n` : "";
  switch (round) {
    case "floors":
      return msg({
        text: `${pre}Here's how I'd arrange the rooms floor by floor. Move anything you like.`,
        input: "floors",
        field: "floors",
        allow_skip: true,
      });
    case "roof":
      return msg({
        text: `${pre}Two quick ones about the roof: which water tank, and should I keep it clear for solar? I won't add domes or chhatris unless you ask.`,
        chips: ROOF_CHIPS,
        multi: true,
        field: "roof",
        allow_skip: true,
      });
    case "style":
      return msg({ text: `${pre}Last one: which look do you love?`, input: "style", chips: styleChips(b), field: "style", allow_skip: true });
    default:
      return msg({ text: pre.trim() });
  }
}

export async function mockIntake(pid: string, body: IntakeBody, handlers: SSEHandlers, opts?: StreamOptions): Promise<void> {
  const signal = opts?.signal;
  const d = db();
  findProject(pid);
  const st = (d.intake[pid] ??= { step: -1, done: false, brief: blank() });
  const msgs = (d.messages[pid] ??= []);
  const b = st.brief;
  b.preferences = b.preferences ?? [];
  const emit = <K extends keyof import("@contracts/api-types").SSEEvents>(event: K, data: import("@contracts/api-types").SSEEvents[K]) => {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    dispatchSSE(handlers, event, data);
  };
  const env = () => (b.plot.width_ft ? envelopeFor(b.plot.width_ft, b.plot.depth_ft, b.plot.corner, b.authority) : null);
  const sync = () => {
    const p = findProject(pid);
    p.brief = structuredClone(b);
    p.envelope = env();
    if (/^untitled (home|project)$/i.test(p.name.trim()) && b.plot.area_marla) {
      p.name = `${plotLabel(b.plot.area_marla).replace(/^\w/, (c) => c.toUpperCase())} house${b.scheme ? `, ${b.scheme}` : ""}`;
    }
    touch(p);
    save();
    emit("brief", { brief: structuredClone(b), envelope: env() });
  };
  const say = async (m: ChatMessage) => {
    msgs.push(m);
    save();
    // Stream the words, as the live agent does.
    const words = m.text.split(/(\s+)/);
    for (let i = 0; i < words.length; i += 6) {
      await sleep(28, signal);
      emit("message.delta", { text: words.slice(i, i + 6).join("") });
    }
    emit("message", m);
  };
  const round = (): Round => ROUNDS[Math.max(0, Math.min(ROUNDS.length - 1, st.step))] ?? "describe";
  const advance = () => {
    st.step = Math.min(ROUNDS.length - 1, st.step + 1);
    save();
  };
  const complete = async (lead: string) => {
    st.done = true;
    st.step = ROUNDS.indexOf("done");
    const p = findProject(pid);
    if (!b.floors?.length) {
      b.floors = toFloors(defaultProgram(b, env()), levelsFor(b.storeys));
      auto(b, "floors");
    }
    if (!b.water_tank) { b.water_tank = "concrete"; auto(b, "water_tank"); }
    if (!b.solar) { b.solar = "ready"; auto(b, "solar"); }
    sync();
    if (p.stage === "setup") p.stage = "concepts";
    save();
    await say(
      msg({
        text: `${lead ? `${lead}\n\n` : ""}Your brief is ready: a ${b.storeys}-storey ${b.style.toLowerCase()} home on a ${plotLabel(b.plot.area_marla)} ${b.plot.corner ? "corner " : ""}plot in ${b.scheme ?? "Lahore"}, with ${b.bedrooms} bedrooms. It all fits inside the LDA envelope. Shall I draw four exteriors, by day and by night?`,
        understood: { guaranteed: guaranteed(b), preferences: prefsOf(b), assumptions: assumptionsOf(b) },
        suggestions: ["Show me concepts", "Add a prayer room", "Make it three storeys"],
      }),
    );
    emit("intake.complete", { brief: structuredClone(b), envelope: env() });
  };

  if (body.action === "start") {
    if (msgs.length) return void emit("done", {});
    await sleep(500, signal);
    st.step = 0;
    save();
    emit("brief", { brief: structuredClone(b), envelope: null });
    await say(msg({ text: GREETING, suggestions: OPENERS }));
    emit("done", {});
    return;
  }

  const userText =
    body.action === "skip_question" ? "Decide for me" : body.action === "skip_all" ? "Decide everything for me" : body.message?.trim() || (body.chips ?? []).join(", ");
  const user: ChatMessage = { id: uid("msg"), role: "user", text: userText, created_at: now() };
  msgs.push(user);
  save();
  emit("message", user);
  await sleep(900 + Math.random() * 700, signal);

  // ── Decide everything ──
  if (body.action === "skip_all") {
    if (!b.plot.width_ft) auto(b, "corner");
    assume(b);
    await complete("Done. I've made every choice a Lahore architect would for this plot; everything I assumed is marked, so you can change it any time.");
    emit("done", {});
    return;
  }

  // ── Chips from the widgets ──
  const chips = body.chips ?? [];
  const floorChips = chips.filter((c) => c.startsWith("floor:"));
  if (floorChips.length) {
    b.floors = floorChips.map((c) => {
      const [lvl, rooms] = c.slice(6).split("=");
      return { level: lvl, rooms: (rooms ?? "").split(",").filter(Boolean) };
    });
    const prog: Program = fromFloors(b.floors);
    const storeys = b.floors.filter((f) => f.level !== "roof").length || b.storeys;
    b.storeys = Math.max(1, Math.min(3, storeys));
    const beds = Object.values(prog).reduce((s, r) => s + (r?.master ?? 0) + (r?.bed ?? 0) + (r?.guest ?? 0), 0);
    if (beds) {
      b.bedrooms = beds;
      b.bathrooms = beds + (Object.values(prog).some((r) => r?.servant) ? 1 : 0);
    }
    unauto(b, "floors", "storeys", "bedrooms");
  }
  for (const c of chips) {
    if (c.startsWith("tank:")) { b.water_tank = c.slice(5) as Brief["water_tank"]; unauto(b, "water_tank"); }
    if (c.startsWith("solar:")) { b.solar = c.slice(6) as Brief["solar"]; unauto(b, "solar"); }
    if (c.startsWith("plot:")) {
      const [w, dd] = c.slice(5).split("x").map(Number);
      setPlot(b, w, dd, chips.includes("corner:true"));
      unauto(b, "plot", "corner");
    }
    const style = STYLE_OPTIONS.find((s) => s.name === c);
    if (style) { b.style = style.name; unauto(b, "style"); }
    if (["N", "NE", "E", "SE", "S", "SW", "W", "NW"].includes(c)) { b.facing = c as Brief["facing"]; unauto(b, "facing"); }
  }

  // ── Free text: read whatever it says ──
  const said = body.message && !chips.length ? understand(b, body.message) : [];
  if (body.message && !chips.length && !said.length && st.step > 0) addPref(b, body.message.trim().replace(/\.$/, ""));

  const r = round();
  if (st.done) {
    // An edit after the brief is complete.
    if (said.includes("storeys") || said.includes("bedrooms")) b.floors = toFloors(defaultProgram({ ...b, floors: undefined }, env()), levelsFor(b.storeys));
    sync();
    const what = said.length ? "Updated your brief" : `Noted: “${body.message?.trim()}”`;
    await say(msg({ text: `${what}. I'll carry it into the concepts and the plan.`, suggestions: ["Show me concepts"] }));
    emit("done", {});
    return;
  }

  if (r === "describe") {
    if (!said.includes("corner")) auto(b, "corner");
    const assumed = assume(b);
    if (!b.floors?.length) b.floors = toFloors(defaultProgram(b, env()), levelsFor(b.storeys));
    auto(b, "floors");
    sync();
    advance(); // → floors
    const over = levelsFor(b.storeys).some((l) => l !== "roof" && capacity(l, env(), b) < 600);
    const lead = `Here's what I understood. Tap anything I got wrong.${assumed.length ? "" : ""}${over ? " It's a compact plot, so I've kept the rooms efficient." : ""}`;
    const q = questionFor("floors", b);
    await say({ ...q, text: `${lead}\n\n${q.text}`, understood: { guaranteed: guaranteed(b), preferences: prefsOf(b), assumptions: assumptionsOf(b) } });
    emit("done", {});
    return;
  }

  if (body.action === "skip_question") {
    if (r === "floors") { b.floors = toFloors(defaultProgram({ ...b, floors: undefined }, env()), levelsFor(b.storeys)); auto(b, "floors"); }
    if (r === "roof") { b.water_tank = b.water_tank ?? "concrete"; b.solar = b.solar ?? "ready"; auto(b, "water_tank", "solar"); }
    if (r === "style") { b.style = b.style || "Modern Contemporary"; }
  }

  const ack =
    r === "floors"
      ? body.action === "skip_question"
        ? `I'll go with ${describe(fromFloors(b.floors), levelsFor(b.storeys)).toLowerCase()}.`
        : `Got it. ${describe(fromFloors(b.floors), levelsFor(b.storeys))}.`
      : r === "roof"
        ? `${b.water_tank === "plastic" ? "A blue plastic tank" : "A concrete tank tucked into the stair tower"}, and ${b.solar === "panels" ? "a raised frame for panels" : b.solar === "none" ? "no solar for now" : "the roof kept clear for about 18 panels"}.`
        : r === "style"
          ? `${b.style} it is.`
          : "Noted.";

  // Free text in a round updates the brief and asks the same round again.
  if (body.message && !chips.length && body.action !== "skip_question") {
    sync();
    await say(questionFor(r, b, said.length ? "Updated." : `Noted: “${body.message.trim()}”.`));
    emit("done", {});
    return;
  }

  sync();
  advance();
  const next = round();
  if (next === "done") await complete(ack);
  else await say(questionFor(next, b, ack));
  emit("done", {});
}
