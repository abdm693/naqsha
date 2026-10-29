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
  await pause(3);
  // the automatic concept check and photos run after a fresh design; wait for the score
  const chip = page.getByRole("button", { name: /Matches the concept: \d+%/ }).first();
  await chip.waitFor({ timeout: 10 * 60_000 }).catch(() => mark("no match score"));
  mark("match score");
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
