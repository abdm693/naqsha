// @section structure [structure]
// Modern contemporary 10-marla: crisp white plaster, black aluminium frames, glass balustrades,
// Italian white marble in the reception rooms and oak/walnut floors in the bedrooms.
s.structure({
  exterior_wall: { preset: "plaster_white", color: "#f4f1ec" },
  interior_wall: { preset: "paint", color: "#f2eee7" },
  ceiling: { preset: "paint", color: "#fbfaf7" },
  floors: {
    default: "porcelain_tile",
    drawing: "marble_white", lounge: "marble_white", stair: "marble_white", corridor: "marble_white",
    master_bedroom: "wood_floor_walnut", bedroom: "wood_floor_oak", guest_bedroom: "wood_floor_oak", dressing: "wood_floor_oak",
    kitchen: { preset: "porcelain_tile", color: "#d9d4cb" },
    bath: "ceramic_tile", powder: "marble_beige", laundry: "ceramic_tile",
    balcony: { preset: "porcelain_tile", color: "#cfc9bf" }, terrace: { preset: "porcelain_tile", color: "#c9c2b6" },
    porch: { preset: "paving", color: "#8a8782" }
  },
  window_frame: "metal_black",
  door: "wood_walnut",
  glass: "glass_clear",
  railing: "glass",
  boundary_wall: { preset: "plaster_grey", color: "#bdb9b2" },
  gate: "metal_black",
  plinth: "slate_cladding"
});
// @end

// @section facade_stone_pier [facade]
// Full-height grey ledgestone pier at the right end of the front, rising 1.5 ft above the parapet.
const front = s.face("front");
s.facade.cladding({
  side: "front", from_x_ft: front.to_ft - 3.4, to_x_ft: front.to_ft + 0.05,
  from_h_ft: front.bottom_h_ft, to_h_ft: front.top_h_ft + 1.5, depth_ft: 1.1,
  material: { preset: "stone_cladding", color: "#8b877f" }
});
s.facade.wall_light({ side: "front", x_ft: front.to_ft - 1.7, h_ft: 9, color: "#ffd9a8", intensity: 1.4 });
s.facade.wall_light({ side: "front", x_ft: front.to_ft - 1.7, h_ft: 20, color: "#ffd9a8", intensity: 1.4 });
// @end

// @section facade_first_floor [facade]
// Teak fin screen in front of Bedroom 2 (above the porch) and a white canopy roofing the glass balcony.
const g = s.plan.levels.find((l) => l.id === "ground");
const f1 = s.plan.levels.find((l) => l.id === "first");
const roofH = f1.elevation_ft + f1.height_ft;
// (x = 0 is a party wall: nothing may project past it, so the frame starts at x = 0.)
s.facade.frame({
  side: "front", from_x_ft: 0, to_x_ft: 12.4, from_h_ft: f1.elevation_ft - 0.5, to_h_ft: roofH + 0.6,
  thickness_ft: 0.8, depth_ft: 1.6, material: { preset: "plaster_white", color: "#f7f5f1" }
});
s.facade.fins({
  side: "front", from_x_ft: 0.6, to_x_ft: 11.4, from_h_ft: f1.elevation_ft + 0.4, to_h_ft: roofH - 0.3,
  count: 15, width_ft: 0.3, depth_ft: 0.55, material: { preset: "wood_teak", color: "#a26a3c" }
});
// balcony roof canopy flush with the roof slab, with recessed downlights
s.facade.canopy({ rect: { x: 12, y: 9.4, w: 18.4, d: 4.8 }, h_ft: roofH, thickness_ft: 0.85,
  material: { preset: "plaster_white", color: "#f7f5f1" }, downlights: true });
s.facade.led_strip({ side: "front", from_x_ft: 12.6, to_x_ft: 26.4, h_ft: roofH - 0.95, color: "#ffd8a6" });
// @end

// @section facade_ground [facade]
// Cantilevered timber canopy over the car porch, and a deep black box frame around the drawing-room window.
// (Sections are self-contained: re-read anything you need from s.plan.)
const g = s.plan.levels.find((l) => l.id === "ground");
const gTop = g.elevation_ft + g.height_ft;
// Projections stay inside the plot: none past the left party wall (x = 0); at most 3 ft into the 10 ft front setback (y ≥ 7).
s.facade.canopy({ rect: { x: 0, y: 7.0, w: 12.4, d: 3.6 }, h_ft: gTop - 0.4, thickness_ft: 1.0,
  material: { preset: "wood_teak", color: "#9b6236" }, downlights: true });
s.facade.frame({ side: "front", from_x_ft: 15.6, to_x_ft: 26.4, from_h_ft: g.elevation_ft + 1.4, to_h_ft: g.elevation_ft + 7.9,
  thickness_ft: 0.45, depth_ft: 1.2, material: "metal_black" });
s.facade.wall_light({ side: "front", x_ft: 12.9, h_ft: 8.2, color: "#ffd9a8" });
// @end

// @section facade_boundary [facade]
// Custom geometry with THREE: teak slat panels inset in the front boundary wall (road side, y < 0).
const teak = s.mat({ preset: "wood_teak", color: "#9b6236" });
const slate = s.mat("slate_cladding");
for (const [x0, x1] of [[23.4, 33.6]]) {
  for (let i = 0; i < 4; i++) {
    const slat = new THREE.Mesh(new THREE.BoxGeometry(s.ft(x1 - x0), s.ft(0.42), s.ft(0.08)), teak);
    slat.position.copy(s.toWorld((x0 + x1) / 2, -0.42, 1.3 + i * 0.55));
    s.add(slat, { layer: "facade", kind: "boundary_wall:panel", label: "Teak boundary panel" });
  }
}
const stoneBand = new THREE.Mesh(new THREE.BoxGeometry(s.ft(3.1), s.ft(2.6), s.ft(0.12)), slate);
stoneBand.position.copy(s.toWorld(15, -0.44, 2.4));
s.add(stoneBand, { layer: "facade", kind: "boundary_wall:panel", label: "Slate boundary panel" });
// @end

// @section interior_reception [interior]
// Coffered false ceilings with warm coves and downlights; feature walls in walnut and travertine.
s.interior.false_ceiling({ room: "g_drawing", drop_ft: 0.8, inset_ft: 2.2, cove_color: "#ffd6a0" });
s.interior.downlights({ room: "g_drawing", rows: 2, cols: 3 });
s.interior.accent_wall({ room: "g_drawing", side: "back", material: "travertine" });
s.interior.false_ceiling({ room: "g_lounge", drop_ft: 0.75, inset_ft: 2.0, cove_color: "#ffd6a0" });
s.interior.downlights({ room: "g_lounge", rows: 2, cols: 4 });
s.interior.accent_wall({ room: "g_lounge", side: "front", material: { preset: "wood_walnut", color: "#5e3e2a" } });
s.interior.false_ceiling({ room: "f_master", drop_ft: 0.7, inset_ft: 1.8, cove_color: "#ffd6a0" });
s.interior.downlights({ room: "f_master", rows: 2, cols: 2 });
s.interior.accent_wall({ room: "f_master", side: "left", material: "wood_walnut" });
s.interior.false_ceiling({ room: "f_lounge", drop_ft: 0.7, inset_ft: 2.0, cove_color: "#ffd6a0" });
// @end

// @section furnish_g_drawing [furniture]
// Formal drawing room (18 x 18 ft): sofas in a U around a marble table under a ring chandelier.
s.furnish("rug", { room: "g_drawing", at: [7.5, 11.2], size: { w_ft: 11, d_ft: 9 }, color: "#cdbfab" });
s.furnish("sofa_3", { room: "g_drawing", against: "back", along_ft: 4.1, color: "#d9d1c4" });
s.furnish("side_table", { room: "g_drawing", against: "back", along_ft: 0.9 });
s.furnish("table_lamp", { room: "g_drawing", against: "back", along_ft: 0.9 });
s.furnish("painting", { room: "g_drawing", against: "back", along_ft: 4.1, size: { w_ft: 4.6, h_ft: 2.8 } });
s.furnish("sofa_2", { room: "g_drawing", against: "right", along_ft: 3.1, color: "#d9d1c4" });
s.furnish("armchair", { room: "g_drawing", at: [4.2, 6.4], rot_deg: -20, color: "#8f5b39" });
s.furnish("armchair", { room: "g_drawing", at: [9.4, 6.4], rot_deg: 20, color: "#8f5b39" });
s.furnish("coffee_table", { room: "g_drawing", at: [7.2, 10.8], size: { w_ft: 4.2, d_ft: 2.4 }, material: "marble_white", variant: "marble top" });
s.furnish("console_table", { room: "g_drawing", against: "left", along_ft: 3.2, size: { w_ft: 3.6, d_ft: 1.2 } });
s.furnish("mirror_wall", { room: "g_drawing", against: "left", along_ft: 3.2, size: { w_ft: 2.8, h_ft: 2.8 }, variant: "round" });
s.furnish("curtains", { room: "g_drawing", against: "front", along_ft: 9, size: { w_ft: 10.6 }, color: "#ece5d8" });
s.furnish("chandelier", { room: "g_drawing", at: [8, 10] });
s.furnish("ac_split", { room: "g_drawing", against: "left", along_ft: 12.5 });
s.furnish("plant_floor", { room: "g_drawing", at: [1.3, 16.4] });
s.furnish("plant_floor", { room: "g_drawing", at: [16.6, 1.4], variant: "areca palm" });
// @end

// @section furnish_g_lounge [furniture]
// TV lounge (left) facing a walnut media wall, dining for six on the right by the sliding door.
s.furnish("tv_unit", { room: "g_lounge", against: "front", along_ft: 13.9, size: { w_ft: 6.6 } });
s.furnish("tv", { room: "g_lounge", against: "front", along_ft: 13.9, size: { w_ft: 4.6 } });
s.furnish("sofa_l", { room: "g_lounge", at: [8.1, 10.9], rot_deg: 180, size: { w_ft: 9, d_ft: 6.4 }, color: "#bfb6a8" });
s.furnish("coffee_table", { room: "g_lounge", at: [8.4, 6.6], size: { w_ft: 3.8, d_ft: 2.2 }, material: "wood_walnut" });
s.furnish("rug", { room: "g_lounge", at: [8.1, 8.6], size: { w_ft: 10, d_ft: 8 }, color: "#d6cfc3" });
s.furnish("floor_lamp", { room: "g_lounge", at: [3, 13.6] });
s.furnish("dining_table_6", { room: "g_lounge", at: [17.6, 8.6], rot_deg: 90, material: "marble_white", variant: "marble top" });
s.furnish("pendant", { room: "g_lounge", at: [17.6, 8.6], variant: "low" });
s.furnish("sideboard", { room: "g_lounge", against: "back", along_ft: 18.6, size: { w_ft: 5.2 } });
s.furnish("curtains", { room: "g_lounge", against: "right", along_ft: 8.5, size: { w_ft: 9.6 }, color: "#ece5d8" });
s.furnish("ceiling_fan", { room: "g_lounge", at: [8.1, 8.6] });
s.furnish("ac_split", { room: "g_lounge", against: "front", along_ft: 3.2 });
s.furnish("plant_floor", { room: "g_lounge", at: [20.6, 1.4] });
s.furnish("water_dispenser", { room: "g_lounge", at: [21.2, 15.8], rot_deg: 180 });
// @end

// @section furnish_g_kitchen [furniture]
// L-shaped kitchen: sink run under the rear window, cooking run on the right, fridge on the left.
s.furnish("kitchen_counter", { room: "g_kitchen", against: "back", along_ft: 8.1, size: { w_ft: 7, d_ft: 2 } });
s.furnish("kitchen_counter", { room: "g_kitchen", against: "right", along_ft: 6.3, size: { w_ft: 7.4, d_ft: 2 } });
s.furnish("fridge", { room: "g_kitchen", against: "left", along_ft: 7 });
s.furnish("microwave", { room: "g_kitchen", against: "right", along_ft: 4.2 });
// @end

// @section furnish_f_master [furniture]
// Master suite: king bed on the walnut feature wall, wardrobe, dresser, reading chair by the balcony.
s.furnish("bed_king", { room: "f_master", against: "left", along_ft: 7, color: "#cbc2b5", variant: "upholstered headboard" });
s.furnish("side_table", { room: "f_master", against: "left", along_ft: 2.6 });
s.furnish("side_table", { room: "f_master", against: "left", along_ft: 11.4 });
s.furnish("table_lamp", { room: "f_master", against: "left", along_ft: 2.6 });
s.furnish("table_lamp", { room: "f_master", against: "left", along_ft: 11.4 });
s.furnish("rug", { room: "f_master", at: [5.6, 7], size: { w_ft: 9.5, d_ft: 7.5 }, color: "#d8d0c3" });
s.furnish("wardrobe", { room: "f_master", against: "back", along_ft: 3.05, size: { w_ft: 5.6, d_ft: 2 } });
s.furnish("dresser", { room: "f_master", against: "right", along_ft: 6.25, size: { w_ft: 3.6 } });
s.furnish("ac_split", { room: "f_master", against: "right", along_ft: 6.25 });
s.furnish("armchair", { room: "f_master", at: [9.8, 3.3], rot_deg: 140, color: "#a26a3c" });
s.furnish("curtains", { room: "f_master", against: "front", along_ft: 6, size: { w_ft: 9.6 }, color: "#efe9df" });
s.furnish("ceiling_fan", { room: "f_master", at: [6, 7] });
// @end

// @section furnish_rooms [furniture]
// Everything else gets a sensible default layout.
for (const id of ["g_porch", "g_stair", "g_powder", "g_guest", "g_guest_bath", "f_balcony", "f_bed2", "f_bath2", "f_corr",
  "f_master_bath", "f_master_dress", "f_stair", "f_laundry", "f_lounge", "f_terrace", "f_bed3", "f_bath3"]) {
  s.auto_furnish(id, { style: "modern" });
}
// @end

// @section landscape [landscape]
// Front lawn with palms and a flowering tree, planters along the boundary, ashoka trees down the side passage.
s.landscape.lawn({ x: 12.4, y: 0.5, w: 22.1, d: 9.2 });
s.landscape.planter({ x: 22.6, y: 0.6, w: 11.8, d: 1.8 }, { height_ft: 1.2, material: "slate_cladding" });
s.landscape.tree([28.6, 5.2], { kind: "ornamental", height_ft: 14 });
s.landscape.tree([14.6, 2.6], { kind: "palm", height_ft: 9 });
s.landscape.tree([19.6, 2.2], { kind: "bush", height_ft: 3 });
for (const y of [16, 27, 38, 49]) s.landscape.tree([33.6, y], { kind: "ashoka", height_ft: 15 });
s.landscape.planter({ x: 1, y: -2.6, w: 10, d: 1.9 }, { height_ft: 0.9, material: "slate_cladding" });
s.landscape.tree([22, -1.6], { kind: "neem", height_ft: 22 });
s.landscape.street({ road_width_ft: 40, neighbours: true, streetlights: true });
// @end

// @section lighting [lighting]
// Golden hour in Lahore with warm interiors.
s.lights.sun({ hour: 17.5 });
s.lights.interior({ warmth: "warm" });
// @end
