/** Anchors and cameras for comments made without a picked point (a note on "this view"). */
import type { Comment, CommentAnchor } from "@contracts/api-types";
import type { BuildingPlan } from "@contracts/plan";

// World mapping (contracts/web-modules.md): x_m = x_ft·0.3048, z_m = −y_ft·0.3048; the road is at +z.
const M = 0.3048;

export function frontCamera(plan: BuildingPlan): Comment["camera"] {
  const W = plan.site.plot.width_ft;
  const D = plan.site.plot.depth_ft;
  return { position: [(W / 2) * M, 9, 14], target: [(W / 2) * M, 4, -(D / 2) * M * 0.6] };
}

export function generalAnchor(plan: BuildingPlan): CommentAnchor {
  return {
    position: [(plan.site.plot.width_ft / 2) * M, 4, -(plan.site.plot.depth_ft / 3) * M],
    normal: [0, 0, 1],
    label: "Whole home",
    kind: "view",
  };
}

/** "Bedroom 2, first floor" for a picked point. */
export function anchorPlace(anchor: CommentAnchor, plan?: BuildingPlan): string {
  const room = anchor.room ? plan?.rooms.find((r) => r.id === anchor.room)?.name ?? anchor.room : undefined;
  const level = anchor.level ? plan?.levels.find((l) => l.id === anchor.level)?.name ?? anchor.level : undefined;
  const what = anchor.label && anchor.label !== room ? anchor.label : undefined;
  const roomPart = room && what?.toLowerCase().includes(room.toLowerCase()) ? undefined : room;
  const parts = [what, roomPart, level?.toLowerCase()].filter(Boolean);
  return parts.length ? parts.join(", ").replace(/^\w/, (c) => c.toUpperCase()) : "This view";
}
