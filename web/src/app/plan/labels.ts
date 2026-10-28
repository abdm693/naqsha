/**
 * Room labels that never collide and never go blank. For each room (largest first) try its full name on one line,
 * then wrapped onto two, horizontally, then vertically for tall rooms, at 12 → 10 px; the name must fit inside the
 * room and miss every label already placed and everything in `avoid` (stair drawings, door swings, gate captions).
 * A name is never abbreviated ("D. kitchen") and never loses its owner ("Bedroom" for "Parents' bedroom"): if
 * nothing fits, the room gets a lettered key (A, B…, never a number, which would read as a comment pin) and a
 * legend line instead.
 * Sizes are screen px; positions are plan feet (y up). Text is measured with canvas in the real font.
 */
import type { Room } from "@contracts/plan";
import { sizeLabel } from "@/app/lib/utils";
import { nameForms } from "./model";

export interface Box { x0: number; y0: number; x1: number; y1: number }

export type Label =
  | { room: Room; kind: "text"; name: string; lines: string[]; dims: string | null; delta?: string; fs: number; dimFs: number; vertical: boolean; cx: number; cy: number }
  | { room: Room; kind: "key"; n: number; letter: string; cx: number; cy: number };

/** 1 → "A", 26 → "Z", 27 → "AA". */
export function keyLetter(n: number): string {
  let s = "";
  let k = n;
  while (k > 0) {
    const r = (k - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    k = Math.floor((k - 1) / 26);
  }
  return s || "A";
}

let ctx: CanvasRenderingContext2D | null = null;
const cache = new Map<string, number>();

/** Width in px of `text` at `fs` px (sans 500, or mono). */
export function measure(text: string, fs: number, mono = false): number {
  const key = `${mono ? "m" : "s"}|${fs}|${text}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  if (!ctx && typeof document !== "undefined") ctx = document.createElement("canvas").getContext("2d");
  let w = text.length * fs * (mono ? 0.62 : 0.56);
  if (ctx) {
    ctx.font = mono ? `500 ${fs}px "Geist Mono", ui-monospace, monospace` : `500 ${fs}px Geist, ui-sans-serif, system-ui, sans-serif`;
    w = ctx.measureText(text).width;
  }
  cache.set(key, w);
  return w;
}

export function clearMeasureCache() {
  cache.clear();
}

const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** A name on one line, then split at the word break that balances two lines best ("Parents'" / "bedroom"). */
function lineSets(name: string): string[][] {
  const words = name.split(" ");
  const out: string[][] = [[name]];
  if (words.length < 2) return out;
  // Never strand a number or a short word on its own line ("Bath" / "3").
  const splits = words
    .slice(1)
    .map((_, i) => [words.slice(0, i + 1).join(" "), words.slice(i + 1).join(" ")])
    .filter(([a, b]) => a.length > 2 && b.length > 2 && !/^\d+$/.test(b) && !/^(&|and|of)$/i.test(b.split(" ")[0]));
  splits.sort((a, b) => Math.max(a[0].length, a[1].length) - Math.max(b[0].length, b[1].length));
  if (splits.length) out.push(splits[0]);
  return out;
}

/**
 * @param ppf  screen px per plan foot
 * @param avoid boxes (plan ft) that labels must not cover, e.g. stair symbols and door swings
 */
export function layoutLabels(rooms: Room[], ppf: number, opts: { avoid?: Box[]; taken?: Set<string>; site?: Set<string>; deltas?: Map<string, string> } = {}): Label[] {
  const placed: Box[] = [...(opts.avoid ?? [])];
  const out: Label[] = [];
  const taken = opts.taken ?? new Set(rooms.map((r) => r.name.toLowerCase()));
  const order = [...rooms].sort((a, b) => b.rect.w * b.rect.d - a.rect.w * a.rect.d);
  const pad = 4 / ppf; // 4px inside the room edge (walls)
  const NAME = [12, 11, 10, 9];
  const DIM = 10.5;
  const LH = 1.2;

  for (const r of order) {
    const { x, y, w, d } = r.rect;
    const inner = { x0: x + pad, y0: y + pad, x1: x + w - pad, y1: y + d - pad };
    const cx = x + w / 2;
    const cy = y + d / 2;
    const iw = (inner.x1 - inner.x0) * ppf; // px
    const ih = (inner.y1 - inner.y0) * ppf;
    const site = opts.site?.has(r.id);
    const delta = opts.deltas?.get(r.id);
    const dims = site ? null : `${sizeLabel(r.rect.w, r.rect.d)}${delta ? ` · ${delta}` : ""}`;
    let done = false;

    // Candidate positions: centre, then nudged along the room's length and across it (clear of a door's swing).
    const along = [0, 0.22, -0.22, 0.34, -0.34];
    const across = [0, 0.18, -0.18, 0.3, -0.3];
    const shifts = along.flatMap((a) => across.map((c) => [a, c] as const)).sort((p, q) => Math.hypot(p[0], p[1]) - Math.hypot(q[0], q[1]));

    outer: for (const form of nameForms(r, taken)) {
      for (const lines of lineSets(form)) {
        for (const fs of NAME) {
          const nameW = Math.max(...lines.map((l) => measure(l, fs)));
          const nameH = fs * LH * lines.length;
          const dimW = dims ? measure(dims, DIM, true) : 0;
          for (const vertical of ih > iw * 1.25 ? [false, true] : [false]) {
            const len = vertical ? ih : iw;
            const wid = vertical ? iw : ih;
            if (nameW > len || nameH + fs * 0.05 > wid) continue;
            const withDims = !!dims && dimW <= len && nameH + DIM * 1.3 <= wid;
            for (const useDims of withDims ? [true, false] : [false]) {
              const blockW = Math.max(nameW, useDims ? dimW : 0);
              const blockH = nameH + (useDims ? DIM * 1.3 : 0);
              for (const [sa, sc] of shifts) {
                // `sa` moves along the text's reading direction's perpendicular (up/down for horizontal text).
                const px = vertical ? cx + sa * w : cx + sc * w;
                const py = vertical ? cy + sc * d : cy + sa * d;
                const hw = (vertical ? blockH : blockW) / 2 / ppf;
                const hh = (vertical ? blockW : blockH) / 2 / ppf;
                const box = { x0: px - hw, y0: py - hh, x1: px + hw, y1: py + hh };
                if (box.x0 < inner.x0 || box.x1 > inner.x1 || box.y0 < inner.y0 || box.y1 > inner.y1) continue;
                // 2px of air: rendered glyphs run a little past the line box.
                const air = { x0: box.x0 - 2 / ppf, y0: box.y0 - 2 / ppf, x1: box.x1 + 2 / ppf, y1: box.y1 + 2 / ppf };
                if (placed.some((p) => overlaps(p, air))) continue;
                placed.push(box);
                out.push({ room: r, kind: "text", name: lines.join(" "), lines, dims: useDims ? sizeLabel(r.rect.w, r.rect.d) : null, delta: useDims ? delta : undefined, fs, dimFs: DIM, vertical, cx: px, cy: py });
                done = true;
                break outer;
              }
            }
          }
        }
      }
    }
    if (!done) {
      const rad = 8 / ppf;
      // The marker goes in a free spot: the centre, else a corner clear of the stair and the door swings.
      const m = Math.min(rad + pad, w / 2, d / 2);
      // The centre, the corners, then a 5 × 5 grid inside the room; failing all, the spot that covers least.
      const grid = [0.1, 0.3, 0.5, 0.7, 0.9].flatMap((fx) => [0.1, 0.3, 0.5, 0.7, 0.9].map((fy) => ({ x: x + m + (w - 2 * m) * fx, y: y + m + (d - 2 * m) * fy })));
      const spots = [
        { x: cx, y: cy },
        { x: x + m, y: y + d - m },
        { x: x + w - m, y: y + d - m },
        { x: x + m, y: y + m },
        { x: x + w - m, y: y + m },
        ...grid,
      ];
      const boxAt = (c: { x: number; y: number }) => ({ x0: c.x - rad, y0: c.y - rad, x1: c.x + rad, y1: c.y + rad });
      const cover = (c: { x: number; y: number }) => {
        const b = boxAt(c);
        return placed.reduce((s, p) => s + Math.max(0, Math.min(p.x1, b.x1) - Math.max(p.x0, b.x0)) * Math.max(0, Math.min(p.y1, b.y1) - Math.max(p.y0, b.y0)), 0);
      };
      const cands = r.type === "stair" ? spots.slice(1) : spots;
      const at = cands.find((c) => cover(c) === 0) ?? [...cands].sort((a, b) => cover(a) - cover(b))[0];
      out.push({ room: r, kind: "key", n: 0, letter: "", cx: at.x, cy: at.y });
      placed.push({ x0: at.x - rad, y0: at.y - rad, x1: at.x + rad, y1: at.y + rad });
    }
  }
  // Letter keys in reading order (front-left first) so the legend reads A, B, C… down the page.
  const keys = out.filter((l): l is Extract<Label, { kind: "key" }> => l.kind === "key").sort((a, b) => a.cy - b.cy || a.cx - b.cx);
  keys.forEach((k, i) => {
    k.n = i + 1;
    k.letter = keyLetter(i + 1);
  });
  return out;
}
