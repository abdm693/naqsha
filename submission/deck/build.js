// Naqsha pitch deck for the Nebius x NVIDIA Global AI Hackathon (Devpost, Best Apps and Agents).
// Build: python3 prep_images.py && node build.js
// Every number on a slide comes from README.md and the recorded runs.

const path = require("path");
const fs = require("fs");
const pptxgen = require("pptxgenjs");
const sharp = require("sharp");
const React = require("react");
const ReactDOMServer = require("react-dom/server");
const lu = require("react-icons/lu");
const QRCode = require("qrcode");

// apply_theme.js is copied from the pptx skill; it writes THEME's colours into the deck's theme part.
const { applyTheme } = require("./tools/apply_theme.js");

const HERE = __dirname;
const IMG = (f) => path.join(HERE, "assets/img", f);
const OUT = path.join(HERE, "Naqsha_Nebius_NVIDIA_Hackathon.pptx");

const LIVE = "https://naqsha-963839790554.us-central1.run.app";
const CODE = "https://github.com/abdm693/naqsha";
const EVENT = "Nebius x NVIDIA Global AI Hackathon";

// ---------------------------------------------------------------- theme
const HEX = {
  ink: "111113",
  white: "FFFFFF",
  body: "46464B",
  lime: "F3F2EE",
  cobalt: "2747F5",
  green: "76B900",
  caption: "6E6E73",
  cobaltSoft: "EDF0FF",
  cobaltOnInk: "7D93FF",
  greyOnInk: "A3A3AD",
};
const THEME = {
  name: "Naqsha Nebius",
  headFontFace: "Arial",
  bodyFontFace: "Arial",
  colors: {
    dk1: HEX.ink,
    lt1: HEX.white,
    dk2: HEX.body,
    lt2: HEX.lime,
    accent1: HEX.cobalt,
    accent2: HEX.green, // NVIDIA green: Nemotron mentions only
    accent3: HEX.caption,
    accent4: HEX.cobaltSoft,
    accent5: HEX.cobaltOnInk,
    accent6: HEX.greyOnInk,
    hlink: HEX.cobalt,
    folHlink: HEX.cobalt,
  },
};

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE"; // 13.333 x 7.5 in
pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
pres.title = "Naqsha · Nebius x NVIDIA Global AI Hackathon";
pres.subject = "Pitch deck, Best Apps and Agents track, Devpost";
pres.author = "Pivot Analytix";
pres.company = "Pivot Analytix";

const C = pres.SchemeColor;
const INK = C.text1, BODY = C.text2, WHITE = C.background1, LIME = C.background2;
const COBALT = C.accent1, GREEN = C.accent2, CAPTION = C.accent3, COBALT_SOFT = C.accent4;
const COBALT_INK = C.accent5, GREY_INK = C.accent6;

const W = 13.333, M = 0.6, CW = W - 2 * M; // content width 12.133

// ---------------------------------------------------------------- assets
async function iconPng(name, hex, px = 256) {
  const svg = ReactDOMServer.renderToStaticMarkup(
    React.createElement(lu[name], { color: "#" + hex, size: px, strokeWidth: 1.75 })
  );
  const buf = await sharp(Buffer.from(svg)).resize(px, px).png().toBuffer();
  return "image/png;base64," + buf.toString("base64");
}

async function loadAssets() {
  const markSvg = fs.readFileSync(path.join(HERE, "assets/naqsha-mark.svg"));
  const markBuf = await sharp(markSvg, { density: 600 }).resize(512, 512).png().toBuffer();
  fs.writeFileSync(path.join(HERE, "assets/img/naqsha-mark.png"), markBuf);
  const qrBuf = await QRCode.toBuffer(LIVE, {
    errorCorrectionLevel: "M", margin: 1, width: 720, color: { dark: "#111113", light: "#FFFFFF" },
  });
  fs.writeFileSync(path.join(HERE, "assets/img/qr-live.png"), qrBuf);
  const dims = {};
  for (const f of fs.readdirSync(path.join(HERE, "assets/img"))) {
    const m = await sharp(IMG(f)).metadata();
    dims[f] = m.width / m.height;
  }
  return { dims };
}

// ---------------------------------------------------------------- helpers
function T(slide, text, o) {
  const opts = {
    x: o.x, y: o.y, w: o.w, h: o.h,
    fontSize: o.size || 16, bold: !!o.bold, italic: !!o.italic,
    color: o.color || BODY, align: o.align || "left", valign: o.valign || "top",
    margin: o.margin !== undefined ? o.margin : 0, isTextBox: true,
    paraSpaceAfter: o.paraSpaceAfter || 0, lineSpacingMultiple: o.lsm || 1.0,
    objectName: o.name,
  };
  if (o.fill) opts.fill = { color: o.fill };
  if (o.charSpacing) opts.charSpacing = o.charSpacing;
  if (o.fit) opts.fit = o.fit;
  slide.addText(text, opts);
}

function card(slide, x, y, w, h, o = {}) {
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x, y, w, h, rectRadius: o.r || 0.12,
    fill: { color: o.fill || WHITE, transparency: o.transparency || 0 },
    line: o.line ? { color: o.line, width: o.lineW || 1 } : { type: "none" },
    shadow: o.shadow === false ? undefined : { type: "outer", color: "000000", opacity: 0.07, blur: 10, offset: 2, angle: 90 },
    objectName: o.name,
  });
}

// A chip: rounded pill with 14 pt bold text. Width estimated from the text.
function chip(slide, text, x, y, o = {}) {
  const w = o.w || 0.34 + text.length * 0.105;
  slide.addText(text, {
    x, y, w, h: o.h || 0.36, shape: pres.shapes.ROUNDED_RECTANGLE, rectRadius: 0.18,
    fill: { color: o.fill || GREEN }, line: { type: "none" },
    color: o.color || INK, fontSize: 14, bold: true, align: "center", valign: "middle",
    margin: 0, isTextBox: true, objectName: o.name || "Chip " + text,
  });
  return w;
}

function img(slide, A, file, x, y, w, h, o = {}) {
  if (!h) h = w / A.dims[file];
  if (!w) w = h * A.dims[file];
  slide.addImage({ path: IMG(file), x, y, w, h, altText: o.alt || "", objectName: o.name || file, hyperlink: o.link ? { url: o.link } : undefined });
  return { w, h };
}

async function iconDot(slide, name, x, y, d, o = {}) {
  slide.addShape(pres.shapes.OVAL, { x, y, w: d, h: d, fill: { color: o.fill || COBALT_SOFT }, line: { type: "none" }, objectName: "Icon circle " + name });
  const p = d * 0.52;
  slide.addImage({ data: await iconPng(name, o.hex || HEX.cobalt), x: x + (d - p) / 2, y: y + (d - p) / 2, w: p, h: p, altText: "", objectName: "Icon " + name });
}

function arrow(slide, x, y, w, color, o = {}) {
  slide.addShape(pres.shapes.LINE, { x, y, w, h: o.h || 0, flipV: !!o.flipV, line: { color, width: o.width || 1.75, endArrowType: "triangle" }, objectName: o.name || "Arrow" });
}

function numDot(slide, n, x, y, d = 0.42, o = {}) {
  slide.addText(String(n), {
    x, y, w: d, h: d, shape: pres.shapes.OVAL, fill: { color: o.fill || COBALT }, line: { type: "none" },
    color: o.color || WHITE, fontSize: 14, bold: true, align: "center", valign: "middle", margin: 0, isTextBox: true,
    objectName: "Step " + n,
  });
}

// ---------------------------------------------------------------- layouts
function footer(dark) {
  return [
    { image: { path: IMG("naqsha-mark.png"), x: M, y: 6.97, w: 0.3, h: 0.3 } },
    { text: { text: "Naqsha", options: { x: M + 0.42, y: 6.97, w: 1.6, h: 0.3, fontSize: 14, bold: true, color: dark ? WHITE : INK, valign: "middle", margin: 0 } } },
    { text: { text: EVENT + " · Devpost", options: { x: 6.6, y: 6.97, w: 5.5, h: 0.3, fontSize: 14, color: dark ? GREY_INK : CAPTION, align: "right", valign: "middle", margin: 0 } } },
  ];
}
function titlePh(dark) {
  return [
    { placeholder: { options: { name: "kicker", type: "body", x: M, y: 0.45, w: CW, h: 0.32, fontSize: 14, bold: true, color: dark ? COBALT_INK : COBALT, align: "left", valign: "top", margin: 0 }, text: "" } },
    { placeholder: { options: { name: "title", type: "title", x: M, y: 0.8, w: CW, h: 0.75, fontSize: 32, bold: true, color: dark ? WHITE : INK, align: "left", valign: "top", margin: 0 }, text: "" } },
  ];
}
pres.defineSlideMaster({
  title: "Content light", background: { color: LIME },
  objects: [...footer(false), ...titlePh(false)],
  slideNumber: { x: 12.23, y: 6.97, w: 0.5, h: 0.3, fontSize: 14, color: HEX.caption, align: "right", margin: 0 },
});
pres.defineSlideMaster({
  title: "Content dark", background: { color: INK },
  objects: [...footer(true), ...titlePh(true)],
  slideNumber: { x: 12.23, y: 6.97, w: 0.5, h: 0.3, fontSize: 14, color: HEX.greyOnInk, align: "right", margin: 0 },
});
pres.defineSlideMaster({
  title: "Cover", background: { color: INK },
  objects: [
    { placeholder: { options: { name: "title", type: "title", x: M, y: 1.75, w: 5.4, h: 1.15, fontSize: 66, bold: true, color: WHITE, align: "left", valign: "top", margin: 0 }, text: "" } },
  ],
});
pres.defineSlideMaster({
  title: "Closing", background: { color: INK },
  objects: [
    { placeholder: { options: { name: "title", type: "title", x: M, y: 1.75, w: 6.6, h: 0.8, fontSize: 44, bold: true, color: WHITE, align: "left", valign: "top", margin: 0 }, text: "" } },
  ],
});

const light = (section) => pres.addSlide({ masterName: "Content light", sectionTitle: section });
const dark = (section) => pres.addSlide({ masterName: "Content dark", sectionTitle: section });
function heads(slide, kicker, title) {
  slide.addText(kicker, { placeholder: "kicker" });
  slide.addText(title, { placeholder: "title" });
}

// ---------------------------------------------------------------- slides
async function build() {
  const A = await loadAssets();
  let s;

  // 1 · Cover ------------------------------------------------------------
  pres.addSection({ title: "Opening" });
  s = pres.addSlide({ masterName: "Cover", sectionTitle: "Opening" });
  s.addImage({ path: IMG("naqsha-mark.png"), x: M, y: 0.6, w: 0.8, h: 0.8, altText: "Naqsha mark", objectName: "Naqsha mark" });
  T(s, [{ text: EVENT, options: { bold: true, color: WHITE, breakLine: true } }, { text: "Best Apps and Agents · Devpost", options: { color: GREY_INK } }],
    { x: M + 1.0, y: 0.6, w: 4.6, h: 0.8, size: 14, valign: "middle", name: "Event" });
  s.addText("Naqsha", { placeholder: "title" });
  T(s, [
    { text: "نقشہ", options: { color: COBALT_INK, bold: true } },
    { text: "   what families in Pakistan call a house plan", options: { color: GREY_INK } },
  ], { x: M, y: 2.95, w: 5.3, h: 0.45, size: 16, valign: "middle", name: "Urdu name" });
  T(s, "Describe a home or upload a drawing of one. Get a floor plan checked against your city's building rules, a 3D model you can walk through, and photos from every angle.",
    { x: M, y: 3.75, w: 5.0, h: 1.6, size: 20, color: WHITE, lsm: 1.1, name: "Tagline" });
  chip(s, "Agents on NVIDIA Nemotron · Nebius Token Factory", M, 5.8, { w: 5.0, h: 0.42 });
  T(s, "Pivot Analytix  ·  Abdullah Moazzam, Saad Wali Muhammad Joiya, Usama Bin Maalik", { x: M, y: 6.5, w: 5.0, h: 0.6, size: 14, color: GREY_INK, name: "Team line" });
  s.addImage({ path: IMG("cover-front.jpg"), x: 6.0, y: 0, w: W - 6.0, h: 7.5, altText: "Photograph of the Islamabad sample home, made from Naqsha's 3D model", objectName: "Cover photo" });
  T(s, "A photo made from Naqsha's 3D model", { x: 6.35, y: 6.75, w: 3.75, h: 0.42, size: 14, color: WHITE, fill: INK, margin: 7, align: "center", valign: "middle", name: "Cover caption" });
  s.addNotes(
    "Naqsha is our entry to the Nebius x NVIDIA Global AI Hackathon, in the Best Apps and Agents track.\n\n" +
    "Naqsha is the Urdu word families in Pakistan use for a house plan. You describe a home in plain words, or upload a drawing of one, and Naqsha's agents design a floor plan checked against your city's building rules, a 3D model you can walk through, and photographs of the house from every angle.\n\n" +
    "Every text and vision agent in the product runs on NVIDIA Nemotron, served by Nebius Token Factory. The photo on the right was made from the 3D model Naqsha built for our Islamabad demo home."
  );

  // 2 · Problem ----------------------------------------------------------
  pres.addSection({ title: "Product" });
  s = light("Product");
  heads(s, "The problem", "Most homes start as a contractor's sketch");
  const probs = [
    ["LuClock", "Weeks of drafting", "Every draft and every change goes back and forth with a draftsman, by hand."],
    ["LuEye", "No 3D until it's built", "The family commits to a house they have only seen as flat drawings."],
    ["LuLandmark", "Few bylaw experts", "Compliance experts are scarce, so mistakes show up when the authority returns the plan."],
  ];
  const pw = (CW - 2 * 0.35) / 3;
  for (let i = 0; i < 3; i++) {
    const x = M + i * (pw + 0.35), y = 1.95;
    card(s, x, y, pw, 3.75, { name: "Problem card " + (i + 1) });
    await iconDot(s, probs[i][0], x + 0.4, y + 0.45, 0.9);
    T(s, probs[i][1], { x: x + 0.4, y: y + 1.6, w: pw - 0.8, h: 0.5, size: 22, bold: true, color: INK });
    T(s, probs[i][2], { x: x + 0.4, y: y + 2.2, w: pw - 0.8, h: 1.3, size: 16, lsm: 1.1 });
  }
  T(s, [
    { text: "Families in Pakistan usually build a house once. ", options: { bold: true, color: INK } },
    { text: "Nobody checks the plan against the rules until it is sent back." },
  ], { x: M, y: 6.0, w: CW, h: 0.5, size: 16, valign: "middle" });
  s.addNotes(
    "In Pakistan, most families build a house once. It usually starts as a contractor's sketch, then weeks of back and forth with a draftsman.\n\n" +
    "Three things go wrong. Drafting is slow, because every change is redrawn by hand. Nobody in the family can see the house in 3D until the walls go up, so they commit to flat drawings. And people who really know the bylaws are scarce, so the mistakes surface when the development authority returns the plan."
  );

  // 3 · Solution (dark) --------------------------------------------------
  s = dark("Product");
  heads(s, "What Naqsha does", "From one message to a home you can walk through");
  const sol = [
    ["LuShieldCheck", "A floor plan checked against your city's building rules"],
    ["LuCuboid", "A 3D model, written as code, that you can walk through"],
    ["LuCamera", "Photos of the same house from every angle, and at night"],
    ["LuMessageSquare", "Comments from the family, applied by a revision agent"],
    ["LuUpload", "Or start from a drawing you already have"],
  ];
  for (let i = 0; i < sol.length; i++) {
    const y = 1.95 + i * 0.9;
    await iconDot(s, sol[i][0], M, y, 0.6, { fill: C.text2, hex: HEX.white });
    T(s, sol[i][1], { x: M + 0.85, y: y - 0.02, w: 3.75, h: 0.66, size: 16, color: WHITE, valign: "middle", lsm: 1.05 });
  }
  img(s, A, "house-ink.jpg", 5.45, 1.95, 7.28, null, { alt: "The 3D model of the Islamabad sample home in the live app" });
  card(s, 5.75, 4.5, 3.15, 2.2, { fill: WHITE, name: "Brief card" });
  T(s, "The brief", { x: 5.95, y: 4.62, w: 2.8, h: 0.3, size: 14, bold: true, color: CAPTION });
  img(s, A, "brief-bubble.jpg", 5.95, 4.95, 2.75, null, { alt: "The one-message brief for the Islamabad demo home" });
  T(s, "Real screens from the live app", { x: 8.55, y: 6.15, w: 4.18, h: 0.35, size: 14, color: GREY_INK, align: "right" });
  s.addNotes(
    "Naqsha turns a conversation, or a drawing, into a home that has been checked against the bylaws and that you can walk through, in minutes.\n\n" +
    "The brief in the corner is the exact message we typed for the Islamabad demo: a 10 marla plot in G-13, four bedrooms, parents downstairs, modern. From that, Naqsha designs the plan, checks it against the city's rules, builds the house in 3D as code, makes photos of it, and lets the family comment and ask for changes.\n\n" +
    "The screens in this deck are captures from the live app."
  );

  // 4 · Journey ----------------------------------------------------------
  s = light("Product");
  heads(s, "The journey", "Nine steps from a brief to a walk-through");
  const steps = [
    ["j1-brief.jpg", "Brief", "One message; the agent asks the rest"],
    ["j2-rules.jpg", "City rules", "Looked up with Tavily, with sources"],
    ["j3-drawing.jpg", "Your drawing", "Optional; VL reads every room"],
    ["j4-concepts.jpg", "Concepts", "Four exteriors, by day and night"],
    ["j5-plan.jpg", "Plan + fixers", "Four drafts, fixed down to zero failures"],
    ["j6-house.jpg", "3D as code", "Ultra writes the house in code"],
    ["j7-match.jpg", "Concept match", "Missing features get rebuilt"],
    ["j8-photos.jpg", "Photos", "Four angles, made from the model"],
    ["j9-walk.jpg", "Walk", "First person, room by room"],
  ];
  const tw = 2.27, tg = (CW - 5 * tw) / 4, th = tw / A.dims["j1-brief.jpg"];
  for (let i = 0; i < 10; i++) {
    const r = Math.floor(i / 5), c = i % 5;
    const x = M + c * (tw + tg), y = 1.8 + r * 2.55;
    if (i === 9) {
      card(s, x, y, tw, th, { fill: COBALT, shadow: false, name: "Then card" });
      T(s, "Then share it, comment and revise", { x: x + 0.22, y: y + 0.18, w: tw - 0.44, h: th - 0.36, size: 18, bold: true, color: WHITE, valign: "middle" });
      T(s, "See slide 10", { x, y: y + th + 0.12, w: tw, h: 0.35, size: 14, color: CAPTION });
      continue;
    }
    img(s, A, steps[i][0], x, y, tw, th, { alt: steps[i][1] + " step in the live app" });
    numDot(s, i + 1, x, y + th + 0.12, 0.36);
    T(s, steps[i][1], { x: x + 0.46, y: y + th + 0.12, w: tw - 0.46, h: 0.36, size: 16, bold: true, color: INK, valign: "middle" });
    T(s, steps[i][2], { x, y: y + th + 0.52, w: tw, h: 0.5, size: 14, lsm: 1.0 });
  }
  s.addNotes(
    "Here is the whole journey, left to right, using screens from the Islamabad demo.\n\n" +
    "One message starts the brief, and the setup agent asks only for what's missing. If the plot is outside Lahore, the agent looks up the city's building rules on the web with Tavily. You can also upload a drawing you already have. Naqsha shows four exterior concepts, then drafts the plan and fixes it until every check passes. Nemotron 3 Ultra writes the 3D model as code, a vision model checks it against the chosen concept, and the app makes photos of the house from four angles. Then you walk through it.\n\n" +
    "After that the family can comment and ask for changes, which is two slides on."
  );

  // 5 · Start from a drawing --------------------------------------------
  s = light("Product");
  heads(s, "Start from your drawing", "Upload the plan you have. Naqsha reads every room");
  const sh1 = img(s, A, "sheet-plan-ground.jpg", M, 1.85, null, 4.35, { alt: "Uploaded sheet: ground floor plan" });
  const sh2 = img(s, A, "sheet-plan-first.jpg", M + sh1.w + 0.2, 1.85, null, 4.35, { alt: "Uploaded sheet: first floor plan" });
  T(s, "The two sheets uploaded in the demo", { x: M, y: 6.35, w: sh1.w + sh2.w + 0.2, h: 0.35, size: 14, color: CAPTION });
  const ax = M + sh1.w + sh2.w + 0.35;
  arrow(s, ax, 4.0, 0.6, COBALT, { width: 2.25, name: "Sheets to app" });
  const dx = ax + 0.85, dw = W - M - dx;
  T(s, "27 rooms", { x: dx, y: 1.75, w: dw, h: 0.95, size: 60, bold: true, color: COBALT });
  T(s, "on 2 floors, read from two uploaded sheets", { x: dx, y: 2.72, w: dw, h: 0.4, size: 18, color: INK, bold: true });
  chip(s, "Nemotron 3.5 Super VL", dx, 3.3);
  T(s, "It reads names, sizes, positions, doors and windows. The architect agent plans from that layout and changes only what the rules need, and the concepts are drawn from it.", { x: dx, y: 3.9, w: dw, h: 1.3, size: 16, lsm: 1.1 });
  img(s, A, "drawing-read.jpg", dx, 5.35, dw, null, { alt: "The app: Your drawing, 27 rooms read on 2 floors" });
  s.addNotes(
    "Many families already have a drawing from an architect, or a sketch on paper. They can upload a photo of it.\n\n" +
    "Nemotron 3.5 Super VL reads the sheets room by room: names, sizes, positions, doors and windows. In this run it read 27 rooms on 2 floors from two sheets. The architect agent then plans from that layout and changes only what the rules need, and the concepts are drawn from the family's own layout, with the porch and the drawing room where their drawing puts them."
  );

  // 6 · How Nemotron 3 Ultra designs a home -----------------------------
  pres.addSection({ title: "Agents" });
  s = light("Agents");
  heads(s, "The architect agent", "How Nemotron 3 Ultra designs a home");
  const flow = [
    ["Draft ×4", "Nemotron 3 Ultra", GREEN, "Four plans in parallel, each adapted from a proven layout."],
    ["Check", "Rules engine", COBALT_SOFT, "Deterministic Python scores each draft against the bylaws."],
    ["Fix ×2", "Nemotron 3 Ultra", GREEN, "Two fixer agents edit the best drafts with check_edits and apply_edits. The better plan wins."],
    ["Build", "Nemotron 3 Ultra", GREEN, "Writes the 3D model as code, section by section."],
    ["Match", "Super VL + Ultra", GREEN, "VL compares the model with the concept. Ultra rebuilds what's missing."],
  ];
  const fw = 2.13, fg = (CW - 5 * fw) / 4;
  for (let i = 0; i < 5; i++) {
    const x = M + i * (fw + fg), y = 1.8;
    card(s, x, y, fw, 2.75, { name: "Flow card " + flow[i][0] });
    T(s, flow[i][0], { x: x + 0.2, y: y + 0.2, w: fw - 0.4, h: 0.45, size: 22, bold: true, color: INK });
    chip(s, flow[i][1], x + 0.2, y + 0.72, { fill: flow[i][2], color: i === 1 ? COBALT : INK, w: fw - 0.4 });
    T(s, flow[i][3], { x: x + 0.2, y: y + 1.22, w: fw - 0.4, h: 1.45, size: 14, lsm: 1.0 });
    if (i < 4) arrow(s, x + fw + 0.04, y + 1.38, fg - 0.08, COBALT, { name: "Flow arrow " + (i + 1) });
  }
  T(s, "Failing checks on the Islamabad plan, as the fixers worked", { x: M, y: 4.8, w: 7.0, h: 0.35, size: 16, bold: true, color: INK });
  s.addChart(pres.charts.BAR, [{ name: "Failing checks", labels: ["34", "22", "15", "7", "3", "0"], values: [34, 22, 15, 7, 3, 0] }], {
    x: M, y: 5.15, w: 7.0, h: 1.65, barDir: "col", barGapWidthPct: 45,
    chartColors: [HEX.cobalt], showValue: true, dataLabelPosition: "outEnd", dataLabelFontSize: 14, dataLabelColor: HEX.ink, dataLabelFontBold: true, dataLabelFontFace: "+mn-lt",
    catAxisHidden: true, valAxisHidden: true, catAxisLabelFontSize: 14, valAxisLabelFontSize: 14, valGridLine: { style: "none" }, catGridLine: { style: "none" }, valAxisMaxVal: 40, valAxisMinVal: 0,
    showLegend: false, showTitle: false, objectName: "Countdown chart",
    altText: "Failing checks fell 34, 22, 15, 7, 3, 0 as the fixer agents worked",
  });
  card(s, 8.1, 4.8, W - M - 8.1, 2.0, { name: "Countdown card" });
  img(s, A, "plan-countdown.jpg", 8.3, 4.95, W - M - 8.5, null, { alt: "The plan screen's progress card: Fixed 34, 22, 15, 7, 3, 0" });
  T(s, "The plan view shows the countdown live. The finished plan passed all 34 bylaw checks.", { x: 8.3, y: 5.98, w: W - M - 8.5, h: 0.72, size: 15, color: INK, lsm: 1.0 });
  s.addNotes(
    "This is the core of the agent work, and all of it runs on Nemotron 3 Ultra through Token Factory.\n\n" +
    "Ultra drafts four plans in parallel, each adapted from a proven layout for that plot size. A deterministic rules engine scores every draft against the bylaws and livable-home rules. Then two tool-using fixer agents repair the two best drafts at the same time. Each edit is dry-run with check_edits and kept with apply_edits only if the plan gets better, and the better plan wins. Ultra then writes the 3D model as code, and Nemotron VL checks it against the concept, so Ultra can rebuild any facade feature that's missing.\n\n" +
    "On the Islamabad run the failing checks went 34, 22, 15, 7, 3, 0. The plan screen shows that countdown live, and the finished plan passed all 34 checks."
  );

  // 7 · Model map (dark) -------------------------------------------------
  s = dark("Agents");
  heads(s, "Nebius Token Factory", "Four Nemotron models, one endpoint");
  const models = [
    ["Nemotron 3 Ultra", "The architect", [
      "Four plan drafts from a proven layout",
      "Two fixer agents: check_edits, apply_edits",
      "The 3D model, written as code",
      "Rule packs from web pages",
      "Facade refits",
      "Revision agent (Google ADK, 9 tools)",
    ]],
    ["Nemotron 3 Super", "The conversation", [
      "Setup agent (Google ADK, 6 tools)",
      "Records the brief and asks only what's missing",
    ]],
    ["Nemotron 3.5 Super VL", "The eyes", [
      "Reads uploaded drawings",
      "Builds the concept feature checklist",
      "Checks the 3D model against the concept",
      "Reviews its own plan drawings",
    ]],
    ["Nemotron 3.5 Lightning", "The fallback", [
      "Takes over when a model is busy",
      "Ultra → Super → Lightning",
    ]],
  ];
  const mw = [3.55, 2.72, 2.72, 2.54], mg = (CW - mw.reduce((a, b) => a + b, 0)) / 3;
  let mx = M;
  for (let i = 0; i < 4; i++) {
    const w = mw[i], y = 1.85, h = 4.3;
    card(s, mx, y, w, h, { fill: WHITE, transparency: 92, shadow: false, name: "Model card " + models[i][0] });
    T(s, models[i][0], { x: mx + 0.25, y: y + 0.25, w: w - 0.5, h: 0.8, size: 20, bold: true, color: GREEN, valign: "top", lsm: 1.0 });
    T(s, models[i][1], { x: mx + 0.25, y: y + 1.05, w: w - 0.5, h: 0.35, size: 14, color: GREY_INK });
    T(s, models[i][2].map((t, k) => ({ text: t, options: { bullet: { indent: 14 }, breakLine: k < models[i][2].length - 1 } })),
      { x: mx + 0.25, y: y + 1.5, w: w - 0.5, h: h - 1.7, size: 14, color: WHITE, paraSpaceAfter: 7, lsm: 1.0 });
    mx += w + mg;
  }
  T(s, [
    { text: "Outside Token Factory: ", options: { bold: true, color: WHITE } },
    { text: "Tavily for web research, and Gemini image models for the concepts and photos.", options: { color: GREY_INK } },
  ], { x: M, y: 6.3, w: CW, h: 0.45, size: 14, valign: "middle" });
  s.addNotes(
    "Every text and vision call goes to one OpenAI-compatible endpoint, Nebius Token Factory, which let us pick the right Nemotron model for each job.\n\n" +
    "Nemotron 3 Ultra is the architect: the four drafts, the two fixer agents, the 3D model as code, rule packs from web pages, facade refits, and the revision agent, which is a Google ADK agent with nine tools. Nemotron 3 Super runs the setup conversation as an ADK agent with six tools. Nemotron 3.5 Super VL is the eyes: it reads uploaded drawings, builds the feature checklist from the chosen concept, checks the 3D model against it, and reviews its own plan drawings. Nemotron 3.5 Lightning is the last fallback when a model is busy.\n\n" +
    "Only two things live outside Token Factory: Tavily for web research, and Gemini image models for the pictures, since Token Factory doesn't serve image generation."
  );

  // 8 · Tavily rules -----------------------------------------------------
  s = light("Agents");
  heads(s, "Rules for any city", "Building rules for any city, with sources");
  const r1 = img(s, A, "rules-chat.jpg", M, 1.85, null, 4.35, { alt: "The Islamabad brief in the chat, with the rules it guarantees" });
  const r2 = img(s, A, "rules-brief.jpg", M + r1.w + 0.25, 1.85, null, 4.35, { alt: "What CDA lets you build, with the cited source" });
  T(s, "The Islamabad demo, in the live app", { x: M, y: 6.35, w: r1.w + r2.w + 0.25, h: 0.35, size: 14, color: CAPTION });
  const tav = [
    "A brief names a plot outside Lahore, here G-13 in Islamabad.",
    "Tavily Search finds the authority's residential rules. Tavily Extract pulls the pages, official sites first.",
    "Nemotron 3 Ultra writes a rule pack: setbacks, coverage, FAR, height and storeys by plot size, each band citing its sources.",
    "The rules engine checks the plan against that pack.",
  ];
  const rx = M + r1.w + r2.w + 0.85, rw = W - M - rx;
  let ry = 1.85;
  const th8 = [0.5, 0.85, 1.0, 0.5];
  for (let i = 0; i < 4; i++) {
    numDot(s, i + 1, rx, ry, 0.38);
    T(s, tav[i], { x: rx + 0.6, y: ry + 0.02, w: rw - 0.6, h: th8[i], size: 17, color: INK, lsm: 1.0 });
    ry += th8[i] + 0.3;
  }
  card(s, rx, 5.95, rw, 0.75, { fill: COBALT_SOFT, shadow: false, name: "LDA note" });
  T(s, "Lahore's LDA rules ship as a hand-verified pack.", { x: rx + 0.22, y: 5.95, w: rw - 0.44, h: 0.75, size: 14, bold: true, color: INK, valign: "middle" });
  s.addNotes(
    "Building rules differ from city to city, so they live in Naqsha as data.\n\n" +
    "Lahore's LDA regulations ship as a pack we verified by hand. For any other city, the setup agent's research tool calls Tavily Search, then Tavily Extract on the best pages, with official sites ranked first. Nemotron 3 Ultra turns those pages into a rule pack with setbacks, coverage, FAR, height and storeys by plot size, and every band cites its sources. Where the web gives nothing, the pack falls back to the LDA baseline and the app says so.\n\n" +
    "In the demo, one message about a plot in G-13 Islamabad was enough to get CDA's rules, and the plan was checked against them."
  );

  // 9 · Match and photos -------------------------------------------------
  s = light("Agents");
  heads(s, "The house", "Built to match the concept, then photographed");
  img(s, A, "match-lime.jpg", M, 1.85, 6.55, null, { alt: "The match check: 93% of the concept's features are in the 3D model" });
  T(s, [
    { text: "93% of the concept is in the model, ", options: { bold: true, color: COBALT } },
    { text: "up from 86% before the facade was rebuilt. ", options: { bold: true, color: INK } },
    { text: "Nemotron VL checks feature by feature, and Ultra refits only the sections that miss." },
  ], { x: M, y: 5.68, w: 6.55, h: 0.95, size: 15, lsm: 1.05 });
  const gx = 7.45, gw = (W - M - gx - 0.18) / 2, gh = gw / A.dims["photo-front.jpg"];
  const photos = [["photo-front.jpg", "Road"], ["photo-corner.jpg", "Street corner"], ["photo-garden.jpg", "Garden"], ["photo-aerial.jpg", "Air"]];
  for (let i = 0; i < 4; i++) {
    const x = gx + (i % 2) * (gw + 0.18), y = 1.85 + Math.floor(i / 2) * (gh + 0.18);
    img(s, A, photos[i][0], x, y, gw, gh, { alt: "Photo from the " + photos[i][1].toLowerCase() + ", made from the 3D model" });
    T(s, photos[i][1], { x: x + 0.1, y: y + gh - 0.45, w: 0.3 + photos[i][1].length * 0.11, h: 0.34, size: 14, bold: true, color: WHITE, fill: INK, margin: 4, align: "center", valign: "middle" });
  }
  T(s, "Photos from four angles. An image model turns each 3D capture into a photo without moving a wall. Every home also gets a night view and a walk-through.",
    { x: gx, y: 1.85 + 2 * gh + 0.36, w: W - M - gx, h: 1.2, size: 15, lsm: 1.05 });
  s.addNotes(
    "Once the plan passes, the vision model reads the chosen concept into a feature checklist: cladding, fins, balconies, railings, canopies, the gate. Nemotron 3 Ultra builds every feature into the 3D model.\n\n" +
    "Then Nemotron VL compares the model with the concept, feature by feature. On the Islamabad run the first check found 86%. Ultra rebuilt the facade sections that missed, and the next check found 93%. A rebuild is kept only if it scores better.\n\n" +
    "The app then captures the model from the road, the street corner, the garden and the air, and an image model turns each capture into a photograph without moving a wall. So every photo is of the house that's on the plan."
  );

  // 10 · Collaboration ---------------------------------------------------
  pres.addSection({ title: "Collaboration and results" });
  s = light("Collaboration and results");
  heads(s, "Collaboration and revisions", "The family comments. The agent revises");
  const ch = 2.55;
  const cols = [
    ["collab-pin.jpg", "Pin a note", "The owner pins one on the front window."],
    ["collab-share.jpg", "Share a link", "The family comments without an account."],
    ["collab-client.jpg", "Ammi asks", "The client wants a bigger kitchen."],
  ];
  let cx = M;
  const colW = cols.map((c) => ch * A.dims[c[0]]);
  const rvW = 3.35;
  const cgap = (CW - colW.reduce((a, b) => a + b, 0) - rvW) / 3;
  for (let i = 0; i < 3; i++) {
    numDot(s, i + 1, cx, 1.85, 0.38);
    T(s, cols[i][1], { x: cx + 0.5, y: 1.85, w: colW[i] - 0.5, h: 0.38, size: 18, bold: true, color: INK, valign: "middle" });
    img(s, A, cols[i][0], cx, 2.4, colW[i], ch, { alt: cols[i][1] + " in the live app" });
    T(s, cols[i][2], { x: cx, y: 2.4 + ch + 0.12, w: colW[i], h: 0.6, size: 14, color: BODY });
    cx += colW[i] + cgap;
  }
  numDot(s, 4, cx, 1.85, 0.38);
  T(s, "Revise", { x: cx + 0.5, y: 1.85, w: rvW - 0.5, h: 0.38, size: 18, bold: true, color: INK, valign: "middle" });
  const rvh = rvW / A.dims["collab-revise.jpg"];
  img(s, A, "collab-revise.jpg", cx, 2.4, rvW, rvh, { alt: "The revision agent's answer: both changes made, version 2 ready" });
  T(s, "The revision agent applied both notes: a wider front window, and a kitchen island, a longer counter and a table for six.", { x: cx, y: 2.4 + rvh + 0.15, w: rvW, h: 1.05, size: 14, color: BODY, lsm: 1.05 });
  card(s, M, 5.85, (CW - 0.3) / 2, 0.85, { fill: WHITE, name: "Refusal note" });
  await iconDot(s, "LuShieldCheck", M + 0.2, 5.98, 0.58);
  T(s, "A request that breaks a bylaw is refused, with the rule named.", { x: M + 0.95, y: 5.85, w: (CW - 0.3) / 2 - 1.1, h: 0.85, size: 15, color: INK, valign: "middle" });
  const nx = M + (CW - 0.3) / 2 + 0.3;
  card(s, nx, 5.85, (CW - 0.3) / 2, 0.85, { fill: WHITE, name: "Ask bar note" });
  await iconDot(s, "LuMessageSquare", nx + 0.2, 5.98, 0.58);
  T(s, "Or type a change in the Ask bar, in plain words.", { x: nx + 0.95, y: 5.85, w: (CW - 0.3) / 2 - 1.1, h: 0.85, size: 15, color: INK, valign: "middle" });
  s.addNotes(
    "A house is a family decision, so Naqsha is built for comments.\n\n" +
    "The owner pins a note on any spot of the model; here, make the front window wider. They turn on a share link, and the family can comment without an account. Ammi, the client in our demo, pinned a note on the house asking for a bigger kitchen, because she cooks for the whole family.\n\n" +
    "Then the owner clicks Revise. The revision agent, a Google ADK agent on Nemotron 3 Ultra with nine tools, read both notes, checked each change against the bylaws and livable-home rules, and made them: a wider front window, and a kitchen island, a longer counter and a table for six. If a request would break a bylaw, it refuses and names the rule. You can also type a change straight into the Ask bar."
  );

  // 11 · Results (dark) --------------------------------------------------
  s = dark("Collaboration and results");
  heads(s, "Demo runs · 10 marla homes", "What the demo produced");
  const stats = [
    ["34/34", "bylaw checks pass on the Islamabad plan"],
    ["93%", "of the concept's features are in the 3D model, up from 86%"],
    ["27", "rooms read on 2 floors from two uploaded sheets"],
  ];
  for (let i = 0; i < 3; i++) {
    const y = 1.85 + i * 1.2;
    T(s, stats[i][0], { x: M, y, w: 2.9, h: 1.0, size: 58, bold: true, color: i === 0 ? COBALT_INK : WHITE, valign: "middle" });
    T(s, stats[i][1], { x: M + 3.05, y, w: 3.85, h: 1.0, size: 18, color: WHITE, valign: "middle", lsm: 1.05 });
  }
  T(s, [
    { text: "Fixers' countdown: ", options: { bold: true, color: WHITE } },
    { text: "34 → 22 → 15 → 7 → 3 → 0 failing checks", options: { color: GREY_INK } },
    { text: "", options: { breakLine: true } },
  ], { x: M, y: 5.6, w: 6.9, h: 0.4, size: 16, valign: "middle" });
  T(s, [
    { text: "Then: ", options: { bold: true, color: WHITE } },
    { text: "photos from 4 angles, a night view and a walk-through", options: { color: GREY_INK } },
  ], { x: M, y: 6.05, w: 6.9, h: 0.4, size: 16, valign: "middle" });
  img(s, A, "results-corner.jpg", 7.9, 1.85, null, 4.8, { alt: "Street-corner photo of the Islamabad home, made from its 3D model" });
  s.addNotes(
    "Here is what the demo produced. The main run is a 10 marla plot in G-13 Islamabad, checked against the CDA rules Naqsha researched.\n\n" +
    "The plan passes all 34 bylaw checks, and the fixers took the failing checks from 34 down to zero. The 3D model carries 93% of the concept's features, up from 86% before the facade was rebuilt. In a second run, starting from a drawing, Nemotron VL read 27 rooms on 2 floors from two sheets.\n\n" +
    "And the photo on the right is the street-corner view, made from that 3D model."
  );

  // 12 · Architecture ----------------------------------------------------
  pres.addSection({ title: "Platform" });
  s = light("Platform");
  heads(s, "Architecture", "How the pieces fit");
  // Browser
  card(s, M, 2.35, 1.85, 3.6, { name: "Browser box" });
  await iconDot(s, "LuUsers", M + 0.2, 2.55, 0.6);
  T(s, "Browser", { x: M + 0.2, y: 3.3, w: 1.45, h: 0.4, size: 18, bold: true, color: INK });
  T(s, "React and three.js. Runs the house code section by section.", { x: M + 0.2, y: 3.75, w: 1.45, h: 2.0, size: 14, lsm: 1.05 });
  arrow(s, M + 1.92, 4.15, 0.81, COBALT, { name: "Browser to API" });
  T(s, "REST", { x: M + 1.9, y: 3.72, w: 0.85, h: 0.36, size: 14, bold: true, color: COBALT, align: "center" });
  T(s, "SSE", { x: M + 1.9, y: 4.25, w: 0.85, h: 0.36, size: 14, bold: true, color: COBALT, align: "center" });
  // Cloud Run container
  const kx = 3.4, kw = 5.95, ky = 1.85, kh = 4.85;
  card(s, kx, ky, kw, kh, { fill: WHITE, name: "Cloud Run container" });
  T(s, "Cloud Run · FastAPI", { x: kx + 0.25, y: ky + 0.15, w: kw - 0.5, h: 0.4, size: 18, bold: true, color: INK });
  const boxes = [
    ["Setup agent", "ADK · Nemotron 3 Super"],
    ["Rule research", "Tavily · Nemotron 3 Ultra"],
    ["Drawing reader", "Nemotron 3.5 Super VL"],
    ["Architect + fixers", "Nemotron 3 Ultra"],
    ["Match + photos", "VL, Ultra, image model"],
    ["Revision agent", "ADK · Nemotron 3 Ultra"],
  ];
  const bw = (kw - 0.5 - 0.2) / 2, bh = 0.88;
  for (let i = 0; i < 6; i++) {
    const x = kx + 0.25 + (i % 2) * (bw + 0.2), y = ky + 0.7 + Math.floor(i / 2) * (bh + 0.15);
    card(s, x, y, bw, bh, { fill: LIME, shadow: false, name: "Box " + boxes[i][0] });
    T(s, boxes[i][0], { x: x + 0.12, y: y + 0.1, w: bw - 0.24, h: 0.34, size: 14, bold: true, color: INK });
    T(s, boxes[i][1], { x: x + 0.12, y: y + 0.44, w: bw - 0.24, h: 0.36, size: 14, color: BODY });
  }
  const ey = ky + 0.7 + 3 * (bh + 0.15);
  card(s, kx + 0.25, ey, kw - 0.5, 0.9, { fill: COBALT_SOFT, shadow: false, name: "Rules engine box" });
  T(s, "Rules engine", { x: kx + 0.4, y: ey + 0.1, w: kw - 0.8, h: 0.34, size: 14, bold: true, color: COBALT });
  T(s, "Deterministic Python: the LDA pack and researched packs", { x: kx + 0.4, y: ey + 0.45, w: kw - 0.8, h: 0.36, size: 14, color: INK });
  // External services
  const sx = 9.8, sw = W - M - sx;
  const svc = [
    ["Nebius Token Factory", "Every Nemotron text and vision call", true],
    ["Tavily", "Search + extract for city rules", false],
    ["Gemini image models", "Concepts and photos, on Vertex AI", false],
    ["Firestore · Cloud Storage", "Projects, versions, images", false],
  ];
  for (let i = 0; i < 4; i++) {
    const y = 1.85 + i * 1.25;
    card(s, sx, y, sw, 1.1, { fill: svc[i][2] ? INK : WHITE, name: "Service " + svc[i][0] });
    T(s, svc[i][0], { x: sx + 0.18, y: y + 0.12, w: sw - 0.36, h: 0.34, size: 14, bold: true, color: svc[i][2] ? WHITE : INK });
    T(s, svc[i][1], { x: sx + 0.18, y: y + 0.47, w: sw - 0.36, h: 0.55, size: 14, color: svc[i][2] ? GREEN : BODY });
    arrow(s, kx + kw + 0.04, y + 0.52, sx - kx - kw - 0.08, CAPTION, { name: "API to " + svc[i][0] });
  }
  s.addNotes(
    "The browser is a React app with three.js. It talks to one FastAPI service on Cloud Run over REST and Server-Sent Events, so every step streams in as it happens, and it runs the house code section by section, so the family watches the house go up.\n\n" +
    "Inside the service are the agents: the setup agent on Nemotron 3 Super, rule research with Tavily and Ultra, the drawing reader on Super VL, the architect and fixers on Ultra, the match check and photos, and the revision agent on Ultra. They all lean on one deterministic rules engine in Python.\n\n" +
    "Every text and vision call goes to Nebius Token Factory. Tavily handles web research, Gemini image models make the pictures, and Firestore and Cloud Storage hold the projects."
  );

  // 13 · Impact ----------------------------------------------------------
  pres.addSection({ title: "Impact" });
  s = light("Impact");
  heads(s, "Who it's for", "Who it helps, and how it scales");
  const who = [
    ["LuHouse", "Families", "See and walk through the house before spending on bricks. Comment from a shared link."],
    ["LuDraftingCompass", "Architects", "Bring a checked design to the first meeting, then revise it with the client."],
    ["LuHardHat", "Builders", "Sell and build from designs that buyers can walk through."],
  ];
  const ww = (CW - 2 * 0.3) / 3;
  for (let i = 0; i < 3; i++) {
    const x = M + i * (ww + 0.3), y = 1.85;
    card(s, x, y, ww, 2.0, { name: "Audience " + who[i][1] });
    await iconDot(s, who[i][0], x + 0.25, y + 0.25, 0.65);
    T(s, who[i][1], { x: x + 1.05, y: y + 0.25, w: ww - 1.3, h: 0.65, size: 20, bold: true, color: INK, valign: "middle" });
    T(s, who[i][2], { x: x + 0.25, y: y + 1.05, w: ww - 0.5, h: 0.85, size: 15, lsm: 1.05 });
  }
  T(s, "Rules as data, so the same app scales city by city", { x: M, y: 4.15, w: CW, h: 0.4, size: 18, bold: true, color: INK });
  const scale = [
    ["Lahore", "LDA pack, hand-verified, built in"],
    ["Islamabad", "CDA rules researched with Tavily in the demo"],
    ["Pakistan", "The other development authorities"],
    ["Worldwide", "Any city whose rules are published"],
  ];
  const sw2 = 2.65, sg2 = (CW - 4 * sw2) / 3;
  for (let i = 0; i < 4; i++) {
    const x = M + i * (sw2 + sg2), y = 4.7;
    card(s, x, y, sw2, 1.25, { fill: i === 0 ? COBALT : WHITE, name: "Scale " + scale[i][0] });
    T(s, scale[i][0], { x: x + 0.2, y: y + 0.12, w: sw2 - 0.4, h: 0.4, size: 18, bold: true, color: i === 0 ? WHITE : INK });
    T(s, scale[i][1], { x: x + 0.2, y: y + 0.52, w: sw2 - 0.4, h: 0.65, size: 14, color: i === 0 ? WHITE : BODY });
    if (i < 3) arrow(s, x + sw2 + 0.05, y + 0.62, sg2 - 0.1, COBALT, { name: "Scale arrow " + (i + 1) });
  }
  T(s, "Naqsha makes concept designs and a regulation pre-check. A registered architect still signs the plans, and researched rule packs should be confirmed with the authority.",
    { x: M, y: 6.15, w: CW, h: 0.55, size: 14, color: CAPTION });
  s.addNotes(
    "Three groups get the most from this. Families see and walk through the house before they spend anything on bricks, and they can comment from a shared link. Architects can bring a checked design to the first meeting and revise it with the client in the room. Builders can sell and build from designs buyers can walk through.\n\n" +
    "Lahore is only our demo city. Because the rules are data, Naqsha grows city by city: Lahore's LDA pack is built in, Islamabad's CDA rules were researched live with Tavily in the demo, and the same path leads to Pakistan's other development authorities, then to any city that publishes its building rules.\n\n" +
    "To be clear about scope: Naqsha gives concept designs and a pre-check. A registered architect still signs the plans."
  );

  // 14 · What's next -----------------------------------------------------
  s = light("Impact");
  heads(s, "What's next", "What we're building next");
  const nxt = [
    ["LuScrollText", "Reviewed rule packs", "Local architects review the packs for Karachi, Islamabad, Rawalpindi and Faisalabad."],
    ["LuBrickWall", "Structural and MEP drafts", "Structure, plumbing and electrical drafts from the same plan."],
    ["LuCalculator", "Bills of quantities", "Quantities for every home, priced with local rates."],
    ["LuServer", "Nebius Serverless Jobs", "The long design runs move off the web server and onto Serverless Jobs."],
  ];
  const nw = (CW - 3 * 0.3) / 4;
  for (let i = 0; i < 4; i++) {
    const x = M + i * (nw + 0.3), y = 1.85;
    card(s, x, y, nw, 3.3, { name: "Next " + nxt[i][1] });
    await iconDot(s, nxt[i][0], x + 0.3, y + 0.3, 0.7);
    T(s, nxt[i][1], { x: x + 0.3, y: y + 1.15, w: nw - 0.6, h: 0.75, size: 20, bold: true, color: INK, lsm: 1.0 });
    T(s, nxt[i][2], { x: x + 0.3, y: y + 1.95, w: nw - 0.6, h: 1.25, size: 15, lsm: 1.0 });
  }
  img(s, A, "photo-garden.jpg", M, 5.45, null, 1.3, { alt: "Garden photo of the Islamabad home" });
  T(s, "The goal: a family gets a checked plan, a costed house and a walk-through before the first meeting with a builder.",
    { x: M + 2.65, y: 5.45, w: CW - 2.65, h: 1.3, size: 18, color: INK, valign: "middle", lsm: 1.1 });
  s.addNotes(
    "Four things come next. Local architects will review the rule packs for Karachi, Islamabad, Rawalpindi and Faisalabad, so researched rules become verified ones. We'll add structural and MEP drafts from the same plan, and bills of quantities priced at local rates. And the long design runs will move to Nebius Serverless Jobs, so they no longer sit on the web server.\n\n" +
    "Where that leads: a family arrives at the builder's office with a checked plan, a costed house and a walk-through."
  );

  // 15 · How to test -----------------------------------------------------
  pres.addSection({ title: "Try it" });
  s = light("Try it");
  heads(s, "How to test", "Try it now. No account needed");
  card(s, M, 1.85, 3.0, 4.85, { name: "QR card" });
  img(s, A, "qr-live.png", M + 0.35, 2.1, 2.3, 2.3, { alt: "QR code for the live app", link: LIVE });
  T(s, [{ text: "naqsha-963839790554", options: { breakLine: true } }, { text: ".us-central1.run.app" }],
    { x: M + 0.2, y: 4.6, w: 2.6, h: 0.6, size: 14, bold: true, color: COBALT, align: "center" });
  T(s, "Free and open until judging ends.", { x: M + 0.3, y: 5.55, w: 2.4, h: 0.8, size: 14, color: CAPTION, align: "center" });
  const tests = [
    ["Explore a sample home", [
      { text: "Click " }, { text: "Explore a sample home", options: { bold: true, color: INK } },
      { text: ". It opens the Islamabad house. Try " }, { text: "Walk", options: { bold: true, color: INK } },
      { text: ", open " }, { text: "Photos", options: { bold: true, color: INK } },
      { text: ", and click the " }, { text: "Matches the concept", options: { bold: true, color: INK } }, { text: " chip." },
    ]],
    ["Decide everything for me", [
      { text: "Click " }, { text: "Start your home", options: { bold: true, color: INK } },
      { text: " and type one message, e.g. “10 marla in G-13 Islamabad, 4 bedrooms, parents downstairs, modern”. Then click " },
      { text: "Decide everything for me", options: { bold: true, color: INK } },
      { text: ". The house follows in about 10 minutes." },
    ]],
    ["Start from your drawing", [
      { text: "On the start page, click " }, { text: "Start from your drawing", options: { bold: true, color: INK } },
      { text: " and upload a photo of a floor plan. Nemotron VL reads it room by room." },
    ]],
  ];
  const tx0 = M + 3.3, tw3 = (W - M - tx0 - 0.5) / 3;
  for (let i = 0; i < 3; i++) {
    const x = tx0 + i * (tw3 + 0.25), y = 1.85;
    card(s, x, y, tw3, 4.85, { name: "Test " + (i + 1) });
    numDot(s, i + 1, x + 0.25, y + 0.3, 0.45);
    T(s, tests[i][0], { x: x + 0.25, y: y + 0.95, w: tw3 - 0.5, h: 0.75, size: 19, bold: true, color: INK, lsm: 1.0 });
    T(s, tests[i][1], { x: x + 0.25, y: y + 1.8, w: tw3 - 0.5, h: 2.9, size: 15, color: BODY, lsm: 1.1 });
  }
  s.addNotes(
    "You can try all of this yourself, with no account or login.\n\n" +
    "Scan the code or open the link. The quickest path is Explore a sample home: it opens the Islamabad house, where you can walk through it, open Photos, and click the Matches the concept chip to see the feature-by-feature check.\n\n" +
    "To design your own, click Start your home, type one message, and click Decide everything for me. Concepts, the plan and the house follow in about ten minutes, and the plan view shows the fixer agents counting the failures down. Or click Start from your drawing and upload a photo of a floor plan.\n\n" +
    "The app stays free and open until judging ends."
  );

  // 16 · Team and links --------------------------------------------------
  s = pres.addSlide({ masterName: "Closing", sectionTitle: "Try it" });
  s.addImage({ path: IMG("naqsha-mark.png"), x: M, y: 0.6, w: 0.8, h: 0.8, altText: "Naqsha mark", objectName: "Naqsha mark" });
  T(s, [{ text: EVENT, options: { bold: true, color: WHITE, breakLine: true } }, { text: "Best Apps and Agents · Devpost", options: { color: GREY_INK } }],
    { x: M + 1.0, y: 0.6, w: 5.6, h: 0.8, size: 14, valign: "middle", name: "Event" });
  s.addText("Pivot Analytix", { placeholder: "title" });
  T(s, [
    { text: "Abdullah Moazzam", options: { bold: true, color: WHITE } }, { text: "  lead", options: { color: GREY_INK, breakLine: true } },
    { text: "Saad Wali Muhammad Joiya", options: { bold: true, color: WHITE, breakLine: true } },
    { text: "Usama Bin Maalik", options: { bold: true, color: WHITE } },
  ], { x: M, y: 2.75, w: 6.5, h: 1.3, size: 20, paraSpaceAfter: 6 });
  card(s, M, 4.2, 6.6, 2.05, { fill: WHITE, shadow: false, name: "Links card" });
  const links = [
    ["Live app", LIVE, "naqsha-963839790554.us-central1.run.app", "no account needed"],
    ["Code", CODE, "github.com/abdm693/naqsha", "AGPL-3.0"],
  ];
  for (let i = 0; i < 2; i++) {
    const y = 4.4 + i * 0.9;
    T(s, links[i][0], { x: M + 0.3, y, w: 1.4, h: 0.4, size: 16, bold: true, color: INK });
    T(s, [{ text: links[i][2], options: { hyperlink: { url: links[i][1] }, color: COBALT, bold: true } }], { x: M + 1.7, y, w: 4.8, h: 0.4, size: 16 });
    T(s, links[i][3], { x: M + 1.7, y: y + 0.4, w: 4.8, h: 0.35, size: 14, color: CAPTION });
  }
  chip(s, "Agents on NVIDIA Nemotron · Nebius Token Factory", M, 6.5, { w: 5.0, h: 0.42 });
  s.addImage({ path: IMG("team-aerial.jpg"), x: W - 5.6, y: 0, w: 5.6, h: 7.5, altText: "Aerial photo of the Islamabad home, made from its 3D model", objectName: "Closing photo" });
  s.addNotes(
    "Naqsha was built by Pivot Analytix: Abdullah Moazzam, who led it, Saad Wali Muhammad Joiya and Usama Bin Maalik.\n\n" +
    "The live app needs no account, and the code is open under AGPL-3.0. Both links are on the slide and on our Devpost page.\n\n" +
    "Thank you to Nebius and NVIDIA. Every agent in Naqsha runs on Nemotron through Token Factory."
  );

  await pres.writeFile({ fileName: OUT });
  await applyTheme(OUT, THEME);
  console.log("wrote", OUT);
}

build().catch((e) => { console.error(e); process.exit(1); });
