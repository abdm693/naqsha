/**
 * Mock mode only: POST /concepts/night. The live API edits each day image into the same view at night; the mock
 * grades the day image in a canvas (blue hour, a darker sky, warm light low down) so the Day/Night toggle can be
 * exercised end to end. Results stay in memory for the session.
 */
import type { Concept } from "@contracts/api-types";
import type { SSEHandlers, StreamOptions } from "@/api/client";
import { dispatchSSE } from "@/api/sse";
import { db, sleep } from "@/api/mock/db";

const memo = new Map<string, string>();

async function grade(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit) return hit;
  const img = new Image();
  img.src = url;
  await img.decode();
  const w = Math.min(1280, img.naturalWidth);
  const h = Math.round((img.naturalHeight * w) / img.naturalWidth);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  if (!g) return url;
  g.filter = "brightness(0.42) saturate(0.75) contrast(1.08)";
  g.drawImage(img, 0, 0, w, h);
  g.filter = "none";
  // Blue hour: a cool wash, deeper toward the sky.
  g.globalCompositeOperation = "multiply";
  const sky = g.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, "rgb(40 58 110)");
  sky.addColorStop(0.45, "rgb(92 112 170)");
  sky.addColorStop(1, "rgb(150 150 170)");
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h);
  // Light from the house and the street: a soft warm lift low in the frame.
  g.globalCompositeOperation = "soft-light";
  const warm = g.createLinearGradient(0, h * 0.35, 0, h);
  warm.addColorStop(0, "rgba(255, 190, 120, 0)");
  warm.addColorStop(0.6, "rgba(255, 190, 120, 0.55)");
  warm.addColorStop(1, "rgba(255, 170, 100, 0.35)");
  g.fillStyle = warm;
  g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = "source-over";
  const out = c.toDataURL("image/jpeg", 0.86);
  memo.set(url, out);
  return out;
}

export async function mockNight(pid: string, ids: string[], handlers: SSEHandlers, opts?: StreamOptions): Promise<void> {
  const project = db().projects.find((p) => p.id === pid);
  const concepts = ids.map((id) => project?.concepts.find((c) => c.id === id)).filter((c): c is Concept => !!c);
  // All night edits run in parallel live; they land a few seconds apart.
  await Promise.all(
    concepts.map(async (concept, index) => {
      await sleep(2600 + index * 650 + Math.random() * 900, opts?.signal);
      try {
        const night_url = await grade(concept.url);
        if (opts?.signal?.aborted) return;
        dispatchSSE(handlers, "concept", { index, concept: { ...concept, night_url } });
      } catch (e) {
        dispatchSSE(handlers, "concept.failed", { index, message: e instanceof Error ? e.message : "The night view failed." });
      }
    }),
  );
  if (opts?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  dispatchSSE(handlers, "done", {});
}
