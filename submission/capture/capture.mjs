// Records real footage of the deployed app for the demo film (Playwright video, 1920×1080). One webm per flow in out/,
// plus a JSON log of when each step happened (seconds from the start of that recording), for placing cuts.
// Usage: node capture.mjs <flow> [base_url]     flows: full, drawing, sample
import { chromium } from "playwright";
import fs from "node:fs";

const flow = process.argv[2] || "full";
const BASE = process.argv[3] || "https://naqsha-963839790554.us-central1.run.app";
const OUT = new URL("./out/", import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
const SHEETS = ["plan-ground.png", "plan-first.png"].map((f) => new URL(`../../e2e/fixtures/${f}`, import.meta.url).pathname);

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROME || undefined,
  headless: process.env.HEADED ? false : true,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--force-device-scale-factor=1"],
});
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, recordVideo: { dir: OUT, size: { width: 1920, height: 1080 } } });
const page = await ctx.newPage();
const t0 = Date.now();
const marks = [];
const mark = (what) => { const t = (Date.now() - t0) / 1000; marks.push({ t: +t.toFixed(2), what }); console.log(t.toFixed(1), what); };
const pause = (s) => page.waitForTimeout(s * 1000);

async function typeSlowly(locator, text) {
  await locator.click();
  for (const ch of text) await page.keyboard.type(ch, { delay: 28 + (ch === " " ? 20 : 0) });
}

async function houseTour() {
  await page.waitForURL(/\/house/, { timeout: 20 * 60_000 });
  mark("house view");
  await page.waitForFunction(() => !document.body.innerText.includes("Assembling your home"), null, { timeout: 5 * 60_000 }).catch(() => {});
  mark("house built");
  const summary = await page.getByText(/\d+\/\d+ LDA/).first().textContent().catch(() => "");
  mark(`summary: ${(summary || "").trim()}`);
  await pause(3);
  // the automatic concept check and photos run after a fresh design; wait for the score
  const chip = page.getByRole("button", { name: /Matches the concept: \d+%/ }).first();
  await chip.waitFor({ timeout: 10 * 60_000 }).catch(() => mark("no match score"));
  mark(`match score: ${(await chip.textContent().catch(() => "")) || ""}`);
  await pause(2);
  await chip.click().catch(() => {});
  mark("match popover");
  await pause(6);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Photos/ }).first().click();
  mark("photos panel");
  await page.waitForFunction(() => document.querySelectorAll('[aria-label="Photos of the house"] img[src*="/views/"]').length >= 4,
    null, { timeout: 8 * 60_000 }).catch(() => mark("photos not all in"));
  mark("photos done");
  await pause(4);
  const first = page.locator('[aria-label="Photos of the house"] img[src*="/views/"]').first();
  await first.click().catch(() => {});
  mark("photo enlarged");
  for (let i = 0; i < 3; i++) { await pause(2.5); await page.keyboard.press("ArrowRight"); mark(`photo ${i + 2}`); }
  await pause(2.5);
  await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
  await pause(2);
  // orbit a little, then walk
  const box = await page.locator("canvas").first().boundingBox();
  // night: every room lit from inside
  await page.getByRole("button", { name: "View" }).first().click().catch(() => {});
  await pause(0.8);
  await page.getByRole("radio", { name: /Night/ }).first().click().catch(() => {});
  await page.keyboard.press("Escape");
  mark("night");
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    for (let i = 0; i < 60; i++) { await page.mouse.move(box.x + box.width / 2 + i * 6, box.y + box.height / 2); await pause(0.06); }
    await page.mouse.up();
  }
  await pause(2);
  await page.getByRole("button", { name: "View" }).first().click().catch(() => {});
  await pause(0.6);
  await page.getByRole("radio", { name: /Day/ }).first().click().catch(() => {});
  await page.keyboard.press("Escape");
  mark("day again");
  await pause(1.5);
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    for (let i = 0; i < 40; i++) { await page.mouse.move(box.x + box.width / 2 - i * 9, box.y + box.height / 2 - i * 1.2); await pause(0.04); }
    await page.mouse.up();
  }
  mark("orbit");
  await pause(2);
  await page.getByRole("radio", { name: "Walk" }).first().click().catch(() => page.keyboard.press("v"));
  mark("walk");
  await pause(4);
  if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2).catch(() => {});
  await pause(1);
  await page.keyboard.down("w"); await pause(3.5); await page.keyboard.up("w");
  await page.keyboard.down("ArrowLeft"); await pause(1.2); await page.keyboard.up("ArrowLeft");
  await page.keyboard.down("w"); await pause(3); await page.keyboard.up("w");
  await page.keyboard.down("ArrowRight"); await pause(1.5); await page.keyboard.up("ArrowRight");
  await page.keyboard.down("w"); await pause(2); await page.keyboard.up("w");
  mark("walked");
  await pause(2);
}

if (flow === "full") {
  // one message, the rules looked up, then "Decide everything for me" carries on through concepts, plan and house
  await page.goto(BASE + "/app");
  await pause(2);
  mark("workspace");
  const box = page.getByRole("textbox").first();
  await typeSlowly(box, "We have a 10 marla plot in G-13 Islamabad, a CDA sector, 35 by 65 ft, mid-row, facing east. Two storeys, four bedrooms with attached baths, parents downstairs, a drawing room, an open kitchen and one car porch. Modern style.");
  await box.press("Enter");
  mark("sent");
  await page.getByText(/researched on the web/).first().waitFor({ timeout: 4 * 60_000 }).catch(() => mark("no rules box"));
  mark("rules box");
  await page.getByText(/researched on the web/).first().scrollIntoViewIfNeeded().catch(() => {});
  await pause(6);
  await page.getByRole("button", { name: "Decide everything for me" }).first().click();
  mark("decide for me");
  await page.waitForURL(/\/concepts/, { timeout: 5 * 60_000 }).catch(() => {});
  mark("concepts view");
  await page.waitForURL(/\/plan/, { timeout: 10 * 60_000 }).catch(() => {});
  mark("plan view");
  await houseTour();
} else if (flow === "drawing") {
  await page.goto(BASE + "/app");
  await pause(2);
  mark("workspace");
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "Start from your drawing" }).click()]);
  await chooser.setFiles(SHEETS);
  mark("uploaded");
  await page.getByText(/rooms read on 2 floors/).first().waitFor({ timeout: 3 * 60_000 });
  mark("read");
  await pause(8);
  await page.getByRole("button", { name: "Decide everything for me" }).first().click().catch(() => {});
  mark("decide for me");
  await page.waitForURL(/\/concepts/, { timeout: 5 * 60_000 }).catch(() => {});
  mark("concepts view");
  await page.waitForFunction(() => document.querySelectorAll("img[src*='/concepts/']").length >= 4, null, { timeout: 5 * 60_000 }).catch(() => {});
  mark("concepts in");
  await pause(8);
} else if (flow === "collab") {
  // owner opens the sample house, pins a note, turns on the client link; the client (a second browser) comments;
  // the owner revises with both notes, reads the answers, then types a change
  await page.goto(BASE + "/");
  await pause(2);
  await page.getByRole("button", { name: "Explore a sample home" }).click();
  await page.waitForURL(/\/house/, { timeout: 90_000 });
  await page.waitForFunction(() => !document.body.innerText.includes("Assembling your home"), null, { timeout: 4 * 60_000 }).catch(() => {});
  mark("house");
  await pause(3);
  const canvas = page.locator("canvas").first();
  const cb = await canvas.boundingBox();
  await page.getByRole("button", { name: /^Comment$/ }).first().click().catch(() => page.keyboard.press("c"));
  await pause(1);
  await page.mouse.click(cb.x + cb.width * 0.52, cb.y + cb.height * 0.45);
  mark("pin placed");
  await pause(1.5);
  const note = page.getByRole("textbox").last();
  await typeSlowly(note, "Make this front window wider, please.");
  await pause(0.8);
  await page.getByRole("button", { name: "Pin it" }).click();
  mark("owner pinned");
  await pause(2.5);
  await page.getByRole("button", { name: /^Share$/ }).first().click();
  await pause(1.2);
  await page.getByRole("switch").first().click();
  mark("client link on");
  await pause(2.5);
  const link = "https://" + (await page.locator("input[readonly]").first().inputValue());
  mark(`link ${link}`);
  await page.keyboard.press("Escape");
  // the client, in another browser with no account
  const cctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, recordVideo: { dir: OUT, size: { width: 1920, height: 1080 } } });
  const client = await cctx.newPage();
  await client.goto(link);
  await client.waitForFunction(() => !document.body.innerText.includes("Assembling your home"), null, { timeout: 4 * 60_000 }).catch(() => {});
  await client.waitForTimeout(3000);
  mark("client opened");
  await client.getByRole("button", { name: /Click to pin/ }).first().click().catch(() => {});
  await client.waitForTimeout(800);
  const ccb = await client.locator("canvas").first().boundingBox();
  await client.mouse.click(ccb.x + ccb.width * 0.47, ccb.y + ccb.height * 0.58);
  await client.waitForTimeout(1500);
  const nameBox = client.getByRole("textbox").first();
  await nameBox.click(); for (const ch of "Ammi") await client.keyboard.type(ch, { delay: 60 });
  const cnote = client.getByRole("textbox").last();
  await cnote.click(); for (const ch of "Can the kitchen be bigger? I cook for the whole family.") await client.keyboard.type(ch, { delay: 30 });
  await client.waitForTimeout(800);
  await client.getByRole("button", { name: /^Post$/ }).click();
  mark("client posted");
  await client.waitForTimeout(3000);
  const cvideo = client.video();
  await cctx.close();
  fs.renameSync(await cvideo.path(), `${OUT}client-${new Date().toISOString().slice(11, 19).replace(/:/g, "")}.webm`);
  // back to the owner: the note arrives, then Revise
  await page.getByText(/Ammi/).first().waitFor({ timeout: 60_000 }).catch(() => mark("client note not seen"));
  mark("owner sees client note");
  await pause(3);
  await page.getByRole("button", { name: /Revise with \d+ comments?/ }).first().click();
  await pause(2);
  mark("revise dialog");
  await page.getByRole("button", { name: /Revise with \d+ comments?/ }).last().click();
  mark("revise started");
  await page.getByText(/See what changed/).first().waitFor({ timeout: 20 * 60_000 }).catch(() => mark("no see what changed"));
  mark("revised");
  await pause(2);
  await page.getByText(/See what changed/).first().click().catch(() => {});
  mark("what changed");
  await pause(4);
  await page.mouse.wheel(0, 900);
  await pause(4);
  await page.mouse.wheel(0, 900);
  await pause(4);
  mark("answers read");
  // a typed change in the Ask bar
  const ask = page.getByPlaceholder(/Tell Naqsha what to change|Ask Naqsha/).first();
  await typeSlowly(ask, "Make the drawing room a bit wider.");
  await ask.press("Enter");
  mark("typed change sent");
  await page.waitForTimeout(5000);
  await page.getByText(/See what changed/).first().waitFor({ timeout: 20 * 60_000 }).catch(() => {});
  mark("typed change done");
  await pause(6);
} else if (flow === "sample") {
  await page.goto(BASE + "/");
  await pause(3);
  mark("landing");
  await page.getByRole("button", { name: "Explore a sample home" }).click();
  await page.waitForURL(/\/house/, { timeout: 60_000 });
  mark("house");
  await pause(10);
  await page.getByRole("link", { name: "Plan" }).or(page.getByRole("button", { name: "Plan" })).first().click();
  mark("plan");
  await pause(10);
}
await pause(1);
const video = page.video();
await ctx.close();
const path = await video.path();
const dest = `${OUT}${flow}-${new Date().toISOString().slice(11, 19).replace(/:/g, "")}.webm`;
fs.renameSync(path, dest);
fs.writeFileSync(dest.replace(".webm", ".json"), JSON.stringify(marks, null, 1));
console.log("saved", dest);
await browser.close();
