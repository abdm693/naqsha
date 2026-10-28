/**
 * Dev-only replica of the backend's as-built projection check (api/app/compliance/lda.py: check_asbuilt), so the
 * harness can confirm a build passes before the app sends its summary: nothing in the facade / structure / custom
 * layers may project into a mandatory open space beyond 0 ft (party wall), 1.5 ft (< 10 ft) or 3 ft (≥ 10 ft),
 * with 0.5 ft tolerance; lights, glows, site and boundary elements and anything below 3 ft are ignored.
 */
import type { BuildingPlan } from "@contracts/plan";
import type { BuildResult } from "../index";

type SideK = "front" | "rear" | "left" | "right";

export function asBuiltCheck(plan: BuildingPlan, summary: BuildResult["summary"]): { id: string; kind?: string; side: SideK; amount: number; allowed: number }[] {
  const W = plan.site.plot.width_ft, D = plan.site.plot.depth_ft;
  const given = (plan.site.setbacks_ft ?? {}) as Partial<Record<SideK, number>>;
  const sb: Record<SideK, number> = { front: given.front ?? 0, rear: given.rear ?? 0, left: given.left ?? 0, right: given.right ?? 0 };
  const allow = (s: number) => (s <= 0 ? 0 : s >= 10 ? 3 : 1.5);
  const tol = 0.5;
  const lim = { front: allow(sb.front) + tol, rear: allow(sb.rear) + tol, left: allow(sb.left) + tol, right: allow(sb.right) + tol };
  const x0 = sb.left, y0 = sb.front, x1 = W - sb.right, y1 = D - sb.rear;
  const skip = ["site", "boundary", "gate", "light", "glow", "facade:wall_light", "facade:led_strip", "lamp", "fixture", "street", "tree"];
  const out: { id: string; kind?: string; side: SideK; amount: number; allowed: number }[] = [];
  for (const o of summary.objects) {
    const kind = (o.kind ?? "").toLowerCase();
    if (!["facade", "structure", "custom"].includes(o.layer) || skip.some((s) => kind.startsWith(s)) || kind.includes("light") || kind.includes("glow")) continue;
    const mn = o.bbox_ft.min, mx = o.bbox_ft.max;
    if (mx[2] < 3) continue;
    const over: Record<SideK, number> = { front: y0 - mn[1], rear: mx[1] - y1, left: x0 - mn[0], right: mx[0] - x1 };
    let side: SideK = "front";
    for (const k of Object.keys(over) as SideK[]) if (over[k] - lim[k] > over[side] - lim[side]) side = k;
    if (over[side] > lim[side]) out.push({ id: o.id, kind: o.kind, side, amount: +over[side].toFixed(2), allowed: allow(sb[side]) });
  }
  return out;
}
