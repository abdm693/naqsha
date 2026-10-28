/**
 * defaultDesign(plan): a complete, good-looking design.js for any valid plan. Section bodies are plain JS that
 * read s.plan at runtime, so they adapt to the layout (and double as a pattern Argon can follow).
 */
import type { BuildingPlan } from "@contracts/plan";
import type { DesignSectionSrc } from "./index";

const ENCLOSED_SKIP = new Set(["lawn", "driveway", "open_space", "courtyard"]);

export function defaultDesignImpl(plan: BuildingPlan): DesignSectionSrc[] {
  const pal = Array.isArray(plan?.style?.palette) && plan.style.palette.length >= 3 ? plan.style.palette : ["#f4f1ec", "#8b877f", "#a26a3c", "#1f1f22", "#d9d3c7"];
  const light = pal[0] ?? "#f4f1ec";
  const stone = pal[1] ?? "#8b877f";
  const wood = pal[2] ?? "#a26a3c";
  const warm = pal[4] ?? "#d9d3c7";
  const sections: DesignSectionSrc[] = [];

  sections.push({
    name: "structure",
    layer: "structure",
    body: `s.structure({
  exterior_wall: { preset: "plaster_white", color: "${light}" },
  interior_wall: { preset: "paint", color: "#f3efe8" },
  floors: {
    default: "porcelain_tile", drawing: "marble_white", lounge: "marble_white", dining: "marble_white",
    lobby: "marble_white", corridor: "marble_white", stair: "marble_white",
    master_bedroom: "wood_floor_walnut", bedroom: "wood_floor_oak", guest_bedroom: "wood_floor_oak",
    bath: "ceramic_tile", powder: "marble_beige", kitchen: "porcelain_tile", porch: "paving", terrace: "porcelain_tile"
  },
  window_frame: "metal_black",
  door: "wood_teak",
  glass: "glass_clear",
  railing: "glass",
  boundary_wall: { preset: "plaster_grey", color: "${warm}" },
  gate: "metal_black",
  plinth: "slate_cladding"
});
`,
  });

  sections.push({
    name: "facade_front",
    layer: "facade",
    body: `// Read the plan so this works for any layout.
const P = s.plan;
const front = s.face("front");
const levels = P.levels.filter((l) => !/roof/i.test(l.id));
const g = levels[0], f1 = levels[1];
const roofTop = front.top_h_ft;
// Full-height stone pier at the right end of the front elevation, rising a little above the parapet.
const pierW = 3;
// (EN3-02: over a car porch the pier starts above the porch opening, out of the way of the car)
const overPorch = P.rooms.some((r) => r.level === g.id && ["porch", "garage"].includes(r.type) && r.rect.x < front.to_ft && r.rect.x + r.rect.w > front.to_ft - pierW && r.rect.y < front.plane_ft + 1);
s.facade.cladding({ side: "front", from_x_ft: front.to_ft - pierW, to_x_ft: front.to_ft, from_h_ft: overPorch && f1 ? f1.elevation_ft - 0.6 : front.bottom_h_ft,
  to_h_ft: roofTop + 1.5, depth_ft: 0.9, material: { preset: "stone_cladding", color: "${stone}" } });
if (!overPorch) s.facade.wall_light({ side: "front", x_ft: front.to_ft - pierW / 2, h_ft: g.elevation_ft + 7.5, color: "#ffd9a8" });
if (f1) s.facade.wall_light({ side: "front", x_ft: front.to_ft - pierW / 2, h_ft: f1.elevation_ft + 7.5, color: "#ffd9a8" });
// First-floor front rooms: a picture frame around the left volume, teak fins over a front window.
if (f1) {
  const frontRooms = P.rooms.filter((r) => r.level === f1.id && !["balcony", "terrace"].includes(r.type) && Math.abs(r.rect.y - Math.min(...P.rooms.filter((q) => q.level === f1.id).map((q) => q.rect.y))) < 0.5)
    .sort((a, b) => a.rect.x - b.rect.x);
  const top = f1.elevation_ft + f1.height_ft;
  if (frontRooms[0]) {
    const r = frontRooms[0];
    s.facade.frame({ side: "front", from_x_ft: r.rect.x - 0.4, to_x_ft: Math.min(r.rect.x + r.rect.w + 0.4, front.to_ft - pierW), from_h_ft: f1.elevation_ft - 0.6,
      to_h_ft: top + 0.4, thickness_ft: 0.9, depth_ft: 1.4, material: { preset: "plaster_white", color: "${light}" } });
  }
  const win = P.openings.find((o) => o.level === f1.id && o.type === "window" && frontRooms.some((r) => Math.abs(o.at[1] - r.rect.y) < 0.6) && (!frontRooms[0] || o.at[0] > frontRooms[0].rect.x + frontRooms[0].rect.w));
  const target = win ? { a: win.at[0] - win.width_ft / 2 - 1, b: win.at[0] + win.width_ft / 2 + 1 } : frontRooms[1] ? { a: frontRooms[1].rect.x + 1, b: frontRooms[1].rect.x + frontRooms[1].rect.w - 1 } : null;
  if (target && target.b - target.a > 2) {
    const n = Math.max(4, Math.round((target.b - target.a) / 0.85));
    s.facade.fins({ side: "front", from_x_ft: target.a, to_x_ft: Math.min(target.b, front.to_ft - pierW - 0.3), from_h_ft: f1.elevation_ft + 0.3, to_h_ft: top - 0.6,
      count: n, width_ft: 0.33, depth_ft: 0.7, material: { preset: "wood_teak", color: "${wood}" } });
  }
}
// Cantilevered timber canopy over the car porch with downlights.
const porch = P.rooms.find((r) => r.type === "porch");
if (porch && f1) {
  s.facade.canopy({ rect: { x: porch.rect.x - 0.4, y: porch.rect.y - 2.5, w: porch.rect.w + 0.8, d: 3.2 }, h_ft: f1.elevation_ft + 0.2,
    thickness_ft: 1.0, material: { preset: "wood_teak", color: "${wood}" }, downlights: true });
}
`,
  });

  sections.push({
    name: "interior_feature",
    layer: "interior",
    body: `// Coffered false ceilings with warm cove light and downlights in the main living spaces.
for (const r of s.plan.rooms) {
  const big = r.rect.w * r.rect.d;
  if (["drawing", "lounge", "dining", "master_bedroom"].includes(r.type) && big >= 140) {
    s.interior.false_ceiling({ room: r.id, drop_ft: 0.75, inset_ft: 1.8, cove_color: "#ffd8a8" });
    s.interior.downlights({ room: r.id, rows: 2, cols: r.rect.w > 15 ? 3 : 2 });
  }
}
const drawing = s.plan.rooms.find((r) => r.type === "drawing");
if (drawing) s.interior.accent_wall({ room: drawing.id, side: "back", material: "wood_walnut" });
`,
  });

  const rooms = Array.isArray(plan?.rooms) ? plan.rooms : [];
  for (const r of rooms) {
    if (!r || typeof r.id !== "string" || ENCLOSED_SKIP.has(r.type)) continue;
    if (!/^[A-Za-z0-9_]+$/.test(r.id)) continue;
    sections.push({ name: `furnish_${r.id}`, layer: "furniture", body: `s.auto_furnish(${JSON.stringify(r.id)}, { style: "modern" });\n` });
  }

  sections.push({
    name: "landscape",
    layer: "landscape",
    body: `const P = s.plan;
const W = P.site.plot.width_ft;
for (const r of P.rooms.filter((q) => q.type === "lawn")) {
  s.landscape.lawn(r.rect);
  // palms and shrubs along the front boundary, an ornamental tree in the corner
  const n = Math.max(1, Math.floor(r.rect.w / 7));
  for (let i = 0; i < n; i++) s.landscape.tree([r.rect.x + (r.rect.w * (i + 0.5)) / n, r.rect.y + 1.6], { kind: i % 2 ? "bush" : "palm", height_ft: i % 2 ? 3.5 : 9 });
  s.landscape.tree([r.rect.x + r.rect.w - 2.5, r.rect.y + r.rect.d - 2.5], { kind: "ornamental", height_ft: 14 });
}
for (const r of P.rooms.filter((q) => q.type === "open_space" && q.rect.w <= 8 && q.rect.d > 20)) {
  s.landscape.hedge([r.rect.x + r.rect.w - 0.9, r.rect.y + 1], [r.rect.x + r.rect.w - 0.9, r.rect.y + r.rect.d - 1], { height_ft: 3 });
}
// planters outside the front boundary wall, then the street with neighbours for context
s.landscape.planter({ x: 0.8, y: -2.4, w: Math.min(12, W * 0.35), d: 1.8 }, { height_ft: 0.9, material: "slate_cladding" });
s.landscape.tree([2.5, -1.5], { kind: "bush", height_ft: 3 });
s.landscape.tree([7, -1.5], { kind: "palm", height_ft: 6 });
s.landscape.street({ road_width_ft: P.site.road_width_ft || 40, neighbours: true, streetlights: true });
`,
  });

  sections.push({
    name: "lighting",
    layer: "lighting",
    body: `s.lights.sun({ hour: 17.5 });
s.lights.interior({ warmth: "warm" });
`,
  });
  return sections;
}
