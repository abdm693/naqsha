import type { BuildingPlan } from "@contracts/plan";
import type { Comment, CommentAnchor } from "@contracts/api-types";
import { sentenceCase } from "@/app/plan/model";


/**
 * Stand-in viewport image for when the 3D viewer can't capture (still loading, or WebGL is unavailable).
 * It is an honest placeholder: a dark sheet with the plot outline and the words "3D view".
 */
export function placeholderSnapshot(plan: BuildingPlan | undefined, label = "3D view", width = 960, height = 540): string {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const g = c.getContext("2d");
  if (!g) return "";
  const grad = g.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, "#2b2620");
  grad.addColorStop(1, "#14120f");
  g.fillStyle = grad;
  g.fillRect(0, 0, width, height);
  g.strokeStyle = "rgba(255,255,255,0.06)";
  for (let x = 0; x < width; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, height); g.stroke(); }
  for (let y = 0; y < height; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(width, y); g.stroke(); }
  if (plan) {
    const W = plan.site.plot.width_ft;
    const D = plan.site.plot.depth_ft;
    const s = Math.min((width * 0.5) / W, (height * 0.7) / D);
    const ox = (width - W * s) / 2;
    const oy = (height - D * s) / 2;
    g.strokeStyle = "rgba(255,255,255,0.35)";
    g.lineWidth = 1.5;
    g.strokeRect(ox, oy, W * s, D * s);
    g.strokeStyle = "rgba(231,165,143,0.8)";
    for (const r of plan.rooms.filter((x) => x.level === plan.levels[0]?.id)) {
      g.strokeRect(ox + r.rect.x * s, oy + (D - r.rect.y - r.rect.d) * s, r.rect.w * s, r.rect.d * s);
    }
  }
  g.fillStyle = "rgba(255,255,255,0.85)";
  g.font = "600 22px Inter, sans-serif";
  g.textAlign = "center";
  g.fillText(label, width / 2, height - 36);
  return c.toDataURL("image/jpeg", 0.85);
}

// World mapping (contracts/web-modules.md): x_m = x_ft·0.3048, z_m = −y_ft·0.3048, so the road is at +z.
const M = 0.3048;

/** A sensible front-of-house camera (standing on the road) for comments made without a picked point. */
export function frontCamera(plan: BuildingPlan): Comment["camera"] {
  const W = plan.site.plot.width_ft;
  const D = plan.site.plot.depth_ft;
  return {
    position: [(W / 2) * M, 9, 14],
    target: [(W / 2) * M, 4, -(D / 2) * M * 0.6],
  };
}

export function generalAnchor(plan: BuildingPlan): CommentAnchor {
  return {
    position: [(plan.site.plot.width_ft / 2) * M, 4, -(plan.site.plot.depth_ft / 3) * M],
    normal: [0, 0, 1],
    label: "This view",
    kind: "view",
  };
}

/** An engine label without its trailing note: "Roof (roof)" → "Roof", "Slab (first floor)" → "Slab". */
export function cleanAnchorLabel(label: string | undefined | null): string | undefined {
  const t = (label ?? "").replace(/\s*\([^)]*\)\s*$/, "").trim();
  return t || undefined;
}

/**
 * "Master bedroom window, first floor" from an anchor, using the plan for names: sentence case, no "(…)" the
 * engine adds, and no floor when the name already says it ("Roof", never "Roof (roof), roof").
 */
export function anchorLabel(anchor: CommentAnchor, plan?: BuildingPlan): string {
  const room = anchor.room ? plan?.rooms.find((r) => r.id === anchor.room)?.name ?? anchor.room : undefined;
  const level = anchor.level ? plan?.levels.find((l) => l.id === anchor.level)?.name ?? anchor.level : undefined;
  const label = cleanAnchorLabel(anchor.label);
  const what = label && label !== room ? label : undefined;
  // "Car porch roof" already says where it is; don't repeat "Car Porch".
  const roomPart = room && what?.toLowerCase().includes(room.toLowerCase()) ? undefined : room;
  const named = [what, roomPart].filter(Boolean).join(" ").toLowerCase();
  const levelWord = level?.toLowerCase().replace(/\s*floor$/, "");
  const levelPart = level && levelWord && named.includes(levelWord) ? undefined : level?.toLowerCase();
  const parts = [what && sentenceCase(what), roomPart && sentenceCase(roomPart), levelPart].filter(Boolean) as string[];
  if (!parts.length) return "This view";
  // Only the first part leads with a capital ("Master bedroom window, first floor").
  return parts.map((p, i) => (i === 0 ? p.replace(/^\w/, (c) => c.toUpperCase()) : /^.[A-Z]/.test(p) || /\d/.test(p) ? p : p.charAt(0).toLowerCase() + p.slice(1))).join(", ");
}
