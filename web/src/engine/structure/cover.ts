/** What already guards a line on a level: wall faces (minus doorways) and railings built so far. */
import type { BuildCtx } from "../core/ctx";

export type Span = [number, number];

/** Subtract intervals from a list of spans. */
export function subtract(spans: Span[], cuts: Span[], minLen = 0): Span[] {
  let out = spans.map((s) => [s[0], s[1]] as Span);
  for (const [p, q] of cuts) {
    const next: Span[] = [];
    for (const [a, b] of out) {
      if (q <= a || p >= b) next.push([a, b]);
      else {
        if (p > a) next.push([a, p]);
        if (q < b) next.push([q, b]);
      }
    }
    out = next;
  }
  return out.filter(([a, b]) => b - a > minLen);
}

/**
 * Parts of [a, b] on the line (axis, c) of `level` that nothing guards: no wall face within `tol` (doorways and
 * low openings do not count) and no railing already built along it.
 */
export function unguarded(ctx: BuildCtx, level: string, axis: "x" | "y", c: number, a: number, b: number, tol = 0.6, minLen = 0.2, useGuards = true): Span[] {
  const lv = ctx.plan.levelById.get(level);
  const floor = lv?.elev ?? 0;
  const cov: Span[] = [];
  for (const run of ctx.model.runsByLevel.get(level) ?? []) {
    if (run.axis !== axis) continue;
    if (![run.c - run.t / 2, run.c + run.t / 2, run.c].some((w) => Math.abs(w - c) < tol)) continue;
    if (run.h1 - floor < 2.5) continue;
    const p = Math.max(a, run.ea), q = Math.min(b, run.eb);
    if (q - p <= 0.02) continue;
    // a doorway is not a guard (a glazed window is)
    const holes = run.openings.filter((o) => o.isDoor && o.bottom - floor < 2.5).map((o) => [o.u0, o.u1] as Span);
    cov.push(...subtract([[p, q]], holes));
  }
  // corner squares: a perpendicular wall that the line passes through covers its own thickness
  for (const run of ctx.model.runsByLevel.get(level) ?? []) {
    if (run.axis === axis || run.h1 - floor < 2.5) continue;
    if (c < run.ea - tol || c > run.eb + tol) continue;
    const p = Math.max(a, run.c - run.t / 2), q = Math.min(b, run.c + run.t / 2);
    if (q - p > 0.01) cov.push([p - 0.02, q + 0.02]);
  }
  for (const g of useGuards ? ctx.guards : []) {
    if (g.level !== level || g.axis !== axis || Math.abs(g.c - c) > tol) continue;
    const p = Math.max(a, g.a), q = Math.min(b, g.b);
    if (q - p > 0.02) cov.push([p, q]);
  }
  return subtract([[a, b]], cov, minLen);
}
