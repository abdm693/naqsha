// @section structure [structure]
// Modern Contemporary structure: crisp white plaster volumes, black aluminium frames, glass railings, marble and oak floors
s.structure({
  exterior_wall: { preset: "plaster_white", color: "#f5f4f0", roughness: 0.78 },
  interior_wall: { preset: "paint", color: "#f6f3ec", roughness: 0.85 },
  ceiling: { preset: "paint", color: "#ffffff" },
  floors: {
    default: "porcelain_tile",
    drawing: "marble_white",
    lounge: "marble_white",
    dining: "marble_white",
    stair: "marble_white",
    corridor: "marble_white",
    master_bedroom: "wood_floor_walnut",
    bedroom: "wood_floor_oak",
    guest_bedroom: "wood_floor_oak",
    kitchen: "porcelain_tile",
    dirty_kitchen: "ceramic_tile",
    bath: "ceramic_tile",
    powder: "marble_beige",
    laundry: "ceramic_tile",
    store: "porcelain_tile",
    balcony: "porcelain_tile",
    porch: { preset: "paving", color: "#7a7d80" }
  },
  window_frame: "metal_black",
  door: "wood_walnut",
  glass: "glass_tinted",
  railing: "glass",
  boundary_wall: { preset: "plaster_warm", color: "#d8d2c7" },
  gate: "metal_black",
  plinth: "slate_cladding"
});
// @end
// @section facade_stone_pier [facade]
// Full-height split-face grey slate stone feature pier anchoring the center of the front elevation
const front = s.face("front");

// Main vertical stone pier separating the left bedroom/drawing volume from the right porch/balcony bay
s.facade.cladding({
  side: "front",
  from_x_ft: 12.2,
  to_x_ft: 16.5,
  from_h_ft: 1.5,
  to_h_ft: front.top_h_ft + 1.5,
  depth_ft: 1.2,
  material: { preset: "slate_cladding", color: "#7c8082", roughness: 0.88 }
});

// Subtle horizontal stone band inset into the front boundary wall matching the concept image
s.facade.cladding({
  side: "front",
  from_x_ft: 3.5,
  to_x_ft: 12.2,
  from_h_ft: 2.6,
  to_h_ft: 3.5,
  depth_ft: 0.15,
  material: { preset: "slate_cladding", color: "#686c6e", roughness: 0.9 }
});

// Up/down architectural wall washer on the central stone pier
s.facade.wall_light({
  side: "front",
  x_ft: 14.35,
  h_ft: 18.0,
  color: "#ffe3b8",
  intensity: 2.2
});
s.facade.wall_light({
  side: "front",
  x_ft: 14.35,
  h_ft: 8.5,
  color: "#ffe3b8",
  intensity: 1.8
});
// @end
// @section facade_left_bay [facade]
// Deep white boxed frame around the left-bay master bedroom and drawing room windows
const frontFace = s.face("front");

// Projecting white architectural picture frame around the first-floor master bedroom window
s.facade.frame({
  side: "front",
  from_x_ft: 0.8,
  to_x_ft: 12.2,
  from_h_ft: 12.2,
  to_h_ft: 22.8,
  thickness_ft: 1.1,
  depth_ft: 1.6,
  material: { preset: "plaster_white", color: "#f7f6f2" }
});

// Dark charcoal recessed window header/surround accent inside the upper frame
s.facade.cladding({
  side: "front",
  from_x_ft: 1.9,
  to_x_ft: 12.2,
  from_h_ft: 20.5,
  to_h_ft: 21.7,
  depth_ft: 0.25,
  material: "metal_black"
});

// Ground floor horizontal chajja slab above the drawing room window
s.facade.canopy({
  rect: { x: 0.5, y: 8.4, w: 11.7, d: 1.6 },
  h_ft: 12.3,
  thickness_ft: 0.8,
  material: { preset: "plaster_white", color: "#f7f6f2" },
  downlights: true
});

// Subtle Juliet glass railing band across the lower portion of the master window
s.facade.led_strip({
  side: "front",
  from_x_ft: 1.8,
  to_x_ft: 12.0,
  h_ft: 12.2,
  color: "#ffdfb0"
});
// @end
// @section facade_right_bay [facade]
// Cantilevered dark-fascia car porch canopy, upper white balcony canopy, and vertical teak louvers
// Dark matte black cantilevered fascia canopy over the car porch entry
s.facade.canopy({
  rect: { x: 15.0, y: 8.2, w: 15.8, d: 2.0 },
  h_ft: 11.2,
  thickness_ft: 0.65,
  material: { preset: "metal_black", color: "#222426", roughness: 0.4 },
  downlights: true
});

// Crisp white balcony slab edge / fascia above the porch
s.facade.canopy({
  rect: { x: 16.5, y: 8.5, w: 14.0, d: 1.6 },
  h_ft: 12.5,
  thickness_ft: 0.9,
  material: { preset: "plaster_white", color: "#f7f6f2" },
  downlights: false
});

// Upper balcony roof canopy with recessed downlights
s.facade.canopy({
  rect: { x: 16.5, y: 8.5, w: 14.0, d: 6.5 },
  h_ft: 22.8,
  thickness_ft: 0.9,
  material: { preset: "plaster_white", color: "#f7f6f2" },
  downlights: true
});

// Signature vertical teak wood fins shielding the right half of the upper balcony
s.facade.fins({
  side: "front",
  from_x_ft: 21.0,
  to_x_ft: 28.2,
  from_h_ft: 13.0,
  to_h_ft: 22.3,
  count: 8,
  width_ft: 0.38,
  depth_ft: 0.75,
  material: { preset: "wood_teak", color: "#a86838", roughness: 0.55 }
});

// Warm LED cove light under the upper balcony roof slab
s.facade.led_strip({
  side: "front",
  from_x_ft: 16.5,
  to_x_ft: 29.8,
  h_ft: 22.3,
  color: "#ffe2b5"
});

// Exterior wall lights flanking the porch and right passage
s.facade.wall_light({ side: "right", x_ft: 20.0, h_ft: 8.0, color: "#ffe3b8", intensity: 1.4 });
s.facade.wall_light({ side: "right", x_ft: 36.0, h_ft: 8.0, color: "#ffe3b8", intensity: 1.4 });
// @end
// @section interior_ground [interior]
// False ceilings with warm perimeter coves, downlights, and feature walls for ground floor reception rooms
s.interior.false_ceiling({
  room: "g_drawing",
  drop_ft: 0.6,
  inset_ft: 1.5,
  cove_color: "#ffe4b8",
  material: { preset: "paint", color: "#ffffff" }
});
s.interior.downlights({ room: "g_drawing", rows: 2, cols: 3, color: "#fff1d6" });
s.interior.accent_wall({
  room: "g_drawing",
  side: "left",
  material: { preset: "wood_walnut", roughness: 0.5 }
});

s.interior.false_ceiling({
  room: "g_lounge",
  drop_ft: 0.6,
  inset_ft: 1.5,
  cove_color: "#ffe4b8",
  material: { preset: "paint", color: "#ffffff" }
});
s.interior.downlights({ room: "g_lounge", rows: 2, cols: 3, color: "#fff1d6" });
s.interior.accent_wall({
  room: "g_lounge",
  side: "front",
  material: "travertine"
});

s.interior.false_ceiling({
  room: "g_dining",
  drop_ft: 0.6,
  inset_ft: 1.5,
  cove_color: "#ffe4b8",
  material: { preset: "paint", color: "#ffffff" }
});
s.interior.downlights({ room: "g_dining", rows: 2, cols: 3, color: "#fff1d6" });

s.interior.false_ceiling({
  room: "g_guest",
  drop_ft: 0.5,
  inset_ft: 1.2,
  cove_color: "#ffe4b8"
});
s.interior.accent_wall({
  room: "g_guest",
  side: "left",
  material: { preset: "paint", color: "#d9d2c5" }
});
// @end
// @section interior_first [interior]
// False ceilings, coves, and feature headboard walls for the first floor family lounge and bedrooms
s.interior.false_ceiling({
  room: "f_master",
  drop_ft: 0.6,
  inset_ft: 1.5,
  cove_color: "#ffe2b3",
  material: { preset: "paint", color: "#ffffff" }
});
s.interior.downlights({ room: "f_master", rows: 2, cols: 3, color: "#fff1d6" });
s.interior.accent_wall({
  room: "f_master",
  side: "left",
  material: "wood_walnut"
});

s.interior.false_ceiling({
  room: "f_lounge",
  drop_ft: 0.6,
  inset_ft: 1.5,
  cove_color: "#ffe2b3",
  material: { preset: "paint", color: "#ffffff" }
});
s.interior.downlights({ room: "f_lounge", rows: 2, cols: 3, color: "#fff1d6" });
s.interior.accent_wall({
  room: "f_lounge",
  side: "right",
  material: "slate_cladding"
});

s.interior.false_ceiling({
  room: "f_bed2",
  drop_ft: 0.5,
  inset_ft: 1.2,
  cove_color: "#ffe2b3"
});
s.interior.accent_wall({
  room: "f_bed2",
  side: "left",
  material: { preset: "paint", color: "#cfd4d0" }
});

s.interior.false_ceiling({ room: "f_bed3", drop_ft: 0.5, inset_ft: 1.2, cove_color: "#ffe2b3" });
s.interior.false_ceiling({ room: "f_bed4", drop_ft: 0.5, inset_ft: 1.2, cove_color: "#ffe2b3" });
// @end
// @section furnish_g_porch [furniture]
// Car porch with a dark grey SUV matching the reference photo and entryway console/planters
s.furnish("car_suv", {
  room: "g_porch",
  at: [7.5, 8.2],
  rot_deg: 0,
  color: "#3a3d40"
});
s.furnish("plant_floor", { room: "g_porch", at: [2.0, 14.5] });
s.furnish("plant_floor", { room: "g_porch", at: [13.5, 14.5] });
// @end
// @section furnish_g_drawing [furniture]
// Formal drawing room (15x16 ft) with plush seating group, marble coffee table, chandelier, AC and fan
s.furnish("rug", {
  room: "g_drawing",
  at: [7.5, 8.2],
  size: { w_ft: 10.5, d_ft: 9.0 },
  color: "#dcd5c9"
});
s.furnish("sofa_3", {
  room: "g_drawing",
  against: "left",
  along_ft: 8.0,
  size: { w_ft: 7.5, d_ft: 3.0 },
  color: "#e6e1d6"
});
s.furnish("sofa_2", {
  room: "g_drawing",
  against: "back",
  along_ft: 5.5,
  size: { w_ft: 5.2, d_ft: 2.8 },
  color: "#e6e1d6"
});
s.furnish("armchair", {
  room: "g_drawing",
  at: [11.5, 5.5],
  rot_deg: -115,
  color: "#9a6338"
});
s.furnish("coffee_table", {
  room: "g_drawing",
  at: [7.2, 8.0],
  size: { w_ft: 4.0, d_ft: 2.6 },
  material: "marble_white",
  variant: "marble top"
});
s.furnish("console_table", {
  room: "g_drawing",
  against: "right",
  along_ft: 4.0,
  size: { w_ft: 4.0, d_ft: 1.3 },
  material: "wood_walnut"
});
s.furnish("curtains", {
  room: "g_drawing",
  against: "front",
  along_ft: 7.5,
  size: { w_ft: 9.5, h_ft: 9.0 },
  color: "#ece7dc"
});
s.furnish("painting", { room: "g_drawing", against: "left", along_ft: 8.0 });
s.furnish("chandelier", { room: "g_drawing", at: [7.5, 8.0] });
s.furnish("ceiling_fan", { room: "g_drawing", at: [7.5, 11.5] });
s.furnish("ac_split", { room: "g_drawing", against: "left", along_ft: 12.5 });
s.furnish("plant_floor", { room: "g_drawing", at: [1.8, 2.0] });
// @end
// @section furnish_g_lounge [furniture]
// Ground floor TV lounge (22x10 ft) with L-sofa, media wall on the front wall, ceiling fan and split AC
s.furnish("rug", {
  room: "g_lounge",
  at: [13.5, 5.2],
  size: { w_ft: 10.0, d_ft: 7.0 },
  color: "#d4cec3"
});
s.furnish("tv_unit", {
  room: "g_lounge",
  against: "front",
  along_ft: 8.0,
  size: { w_ft: 6.5, d_ft: 1.4 },
  material: "wood_walnut"
});
s.furnish("tv", {
  room: "g_lounge",
  against: "front",
  along_ft: 8.0,
  size: { w_ft: 5.0 }
});
s.furnish("sofa_l", {
  room: "g_lounge",
  at: [14.0, 6.2],
  rot_deg: 180,
  size: { w_ft: 8.5, d_ft: 5.5 },
  color: "#6d7173"
});
s.furnish("coffee_table", {
  room: "g_lounge",
  at: [13.5, 3.8],
  size: { w_ft: 3.8, d_ft: 2.2 },
  material: "wood_walnut"
});
s.furnish("ceiling_fan", { room: "g_lounge", at: [13.5, 5.0] });
s.furnish("ac_split", { room: "g_lounge", against: "right", along_ft: 2.5 });
s.furnish("plant_floor", { room: "g_lounge", at: [20.2, 1.8] });
// @end
// @section furnish_g_dining [furniture]
// Formal dining room (22x10 ft) opening to the right passage via a sliding glass door
s.furnish("dining_table_8", {
  room: "g_dining",
  at: [11.5, 5.0],
  rot_deg: 90,
  size: { w_ft: 7.5, d_ft: 3.6 },
  material: "marble_white",
  variant: "marble top"
});
s.furnish("sideboard", {
  room: "g_dining",
  against: "back",
  along_ft: 14.5,
  size: { w_ft: 5.5, d_ft: 1.5 },
  material: "wood_walnut"
});
s.furnish("mirror_wall", {
  room: "g_dining",
  against: "back",
  along_ft: 14.5,
  size: { w_ft: 4.5, h_ft: 3.2 }
});
s.furnish("pendant", { room: "g_dining", at: [11.5, 5.0] });
s.furnish("ceiling_fan", { room: "g_dining", at: [6.0, 5.0] });
s.furnish("water_dispenser", { room: "g_dining", at: [1.8, 1.8], rot_deg: 0 });
// @end
// @section furnish_g_kitchen [furniture]
// Main display kitchen (8x12 ft) with L-shaped counters, hob, sink, oven, and fridge
s.furnish("kitchen_counter", {
  room: "g_kitchen",
  against: "right",
  along_ft: 6.0,
  size: { w_ft: 10.0, d_ft: 2.0 },
  material: "wood_white_oak"
});
s.furnish("hob", {
  room: "g_kitchen",
  against: "right",
  along_ft: 5.5
});
s.furnish("sink_kitchen", {
  room: "g_kitchen",
  against: "back",
  along_ft: 4.0
});
s.furnish("fridge", {
  room: "g_kitchen",
  against: "left",
  along_ft: 9.5,
  material: "metal_brushed"
});
s.furnish("microwave", {
  room: "g_kitchen",
  against: "right",
  along_ft: 9.0
});
// @end
// @section furnish_g_dirty_kitchen [furniture]
// Heavy-cooking spice/dirty kitchen (6x12 ft) with counter, hob, and sink
s.furnish("kitchen_counter", {
  room: "g_dirty_kitchen",
  against: "left",
  along_ft: 6.0,
  size: { w_ft: 9.5, d_ft: 2.0 },
  material: "wood_teak"
});
s.furnish("hob", {
  room: "g_dirty_kitchen",
  against: "left",
  along_ft: 5.0
});
s.furnish("sink_kitchen", {
  room: "g_dirty_kitchen",
  against: "back",
  along_ft: 3.0
});
// @end
// @section furnish_g_guest [furniture]
// Ground floor guest bedroom (10x12 ft) with queen bed, wardrobe, side tables, ceiling fan and split AC
s.furnish("bed_queen", {
  room: "g_guest",
  against: "left",
  along_ft: 6.0,
  size: { w_ft: 5.5, d_ft: 6.5 },
  color: "#d9d2c5",
  variant: "upholstered headboard"
});
s.furnish("side_table", { room: "g_guest", against: "left", along_ft: 2.0, material: "wood_oak" });
s.furnish("side_table", { room: "g_guest", against: "left", along_ft: 10.0, material: "wood_oak" });
s.furnish("wardrobe", {
  room: "g_guest",
  against: "right",
  along_ft: 4.0,
  size: { w_ft: 5.0, d_ft: 2.0 },
  material: "wood_oak"
});
s.furnish("curtains", {
  room: "g_guest",
  against: "back",
  along_ft: 5.0,
  size: { w_ft: 6.5, h_ft: 8.5 },
  color: "#e6e0d4"
});
s.furnish("ceiling_fan", { room: "g_guest", at: [5.0, 6.0] });
s.furnish("ac_split", { room: "g_guest", against: "left", along_ft: 6.0 });
// @end
// @section furnish_g_service_baths [furniture]
// Ground floor store, powder room, and guest bathroom fixtures
s.auto_furnish("g_store", { style: "modern" });

s.furnish("vanity", { room: "g_powder", against: "left", along_ft: 2.0, size: { w_ft: 2.4, d_ft: 1.5 } });
s.furnish("wc", { room: "g_powder", against: "back", along_ft: 4.2 });
s.furnish("mirror_wall", { room: "g_powder", against: "left", along_ft: 2.0 });

s.furnish("vanity", { room: "g_guest_bath", against: "front", along_ft: 3.0, size: { w_ft: 3.0, d_ft: 1.6 } });
s.furnish("wc", { room: "g_guest_bath", against: "right", along_ft: 4.0 });
s.furnish("shower", { room: "g_guest_bath", against: "back", along_ft: 3.0 });
// @end
// @section furnish_f_master [furniture]
// Master bedroom (15x16 ft) overlooking the front lawn with king bed, walnut joinery, curtains, fan and AC
s.furnish("rug", {
  room: "f_master",
  at: [7.5, 8.0],
  size: { w_ft: 10.0, d_ft: 9.0 },
  color: "#ddd6ca"
});
s.furnish("bed_king", {
  room: "f_master",
  against: "left",
  along_ft: 8.0,
  size: { w_ft: 6.5, d_ft: 6.8 },
  color: "#c8bfb2",
  variant: "upholstered headboard"
});
s.furnish("side_table", { room: "f_master", against: "left", along_ft: 3.5, material: "wood_walnut" });
s.furnish("side_table", { room: "f_master", against: "left", along_ft: 12.5, material: "wood_walnut" });
s.furnish("table_lamp", { room: "f_master", against: "left", along_ft: 3.5 });
s.furnish("table_lamp", { room: "f_master", against: "left", along_ft: 12.5 });
s.furnish("wardrobe", {
  room: "f_master",
  against: "back",
  along_ft: 4.5,
  size: { w_ft: 7.0, d_ft: 2.0 },
  material: "wood_walnut"
});
s.furnish("dresser", {
  room: "f_master",
  against: "right",
  along_ft: 8.0,
  size: { w_ft: 5.0, d_ft: 1.6 },
  material: "wood_walnut"
});
s.furnish("armchair", {
  room: "f_master",
  at: [11.8, 3.5],
  rot_deg: -45,
  color: "#a86838"
});
s.furnish("curtains", {
  room: "f_master",
  against: "front",
  along_ft: 7.5,
  size: { w_ft: 10.5, h_ft: 9.5 },
  color: "#f0ece4"
});
s.furnish("ceiling_fan", { room: "f_master", at: [7.5, 8.0] });
s.furnish("ac_split", { room: "f_master", against: "right", along_ft: 12.0 });
// @end
// @section furnish_f_balcony [furniture]
// Front balcony (15x5 ft) with tropical potted plants behind the glass balustrade matching the concept photo
s.furnish("plant_floor", { room: "f_balcony", at: [2.0, 1.5] });
s.furnish("plant_small", { room: "f_balcony", at: [4.5, 1.3] });
s.furnish("outdoor_chair", { room: "f_balcony", at: [8.0, 2.5], rot_deg: 180 });
s.furnish("outdoor_table", { room: "f_balcony", at: [10.2, 2.5] });
s.furnish("plant_floor", { room: "f_balcony", at: [12.2, 1.4] });
s.furnish("plant_floor", { room: "f_balcony", at: [13.8, 1.5] });
// @end
// @section furnish_f_bed2 [furniture]
// Front-right Bedroom 2 (10x11 ft) opening onto the louvered front balcony
s.furnish("bed_queen", {
  room: "f_bed2",
  against: "left",
  along_ft: 5.5,
  size: { w_ft: 5.2, d_ft: 6.4 },
  color: "#d4d8d4",
  variant: "upholstered headboard"
});
s.furnish("side_table", { room: "f_bed2", against: "left", along_ft: 1.8, material: "wood_oak" });
s.furnish("wardrobe", {
  room: "f_bed2",
  against: "back",
  along_ft: 7.5,
  size: { w_ft: 4.2, d_ft: 2.0 },
  material: "wood_oak"
});
s.furnish("study_desk", {
  room: "f_bed2",
  against: "right",
  along_ft: 3.0,
  size: { w_ft: 3.6, d_ft: 1.8 },
  material: "wood_oak"
});
s.furnish("ceiling_fan", { room: "f_bed2", at: [5.0, 5.5] });
s.furnish("ac_split", { room: "f_bed2", against: "left", along_ft: 5.5 });
// @end
// @section furnish_f_lounge [furniture]
// First floor family lounge (22x13 ft) with L-sofa, media wall, prayer mat corner, fan and split AC
s.furnish("rug", {
  room: "f_lounge",
  at: [11.5, 6.5],
  size: { w_ft: 10.5, d_ft: 8.0 },
  color: "#dcd5c8"
});
s.furnish("sofa_l", {
  room: "f_lounge",
  at: [10.0, 6.5],
  rot_deg: 90,
  size: { w_ft: 9.0, d_ft: 6.0 },
  color: "#e2ddd3"
});
s.furnish("coffee_table", {
  room: "f_lounge",
  at: [12.5, 6.5],
  size: { w_ft: 4.0, d_ft: 2.5 },
  material: "wood_walnut"
});
s.furnish("tv_unit", {
  room: "f_lounge",
  against: "right",
  along_ft: 6.5,
  size: { w_ft: 6.5, d_ft: 1.5 },
  material: "wood_walnut"
});
s.furnish("tv", {
  room: "f_lounge",
  against: "right",
  along_ft: 6.5,
  size: { w_ft: 5.0 }
});
s.furnish("bookshelf", {
  room: "f_lounge",
  against: "front",
  along_ft: 18.0,
  size: { w_ft: 4.5, d_ft: 1.3 },
  material: "wood_walnut"
});
s.furnish("prayer_mat", {
  room: "f_lounge",
  at: [3.0, 10.0],
  rot_deg: 255
});
s.furnish("ceiling_fan", { room: "f_lounge", at: [11.5, 6.5] });
s.furnish("ac_split", { room: "f_lounge", against: "front", along_ft: 18.0 });
s.furnish("plant_floor", { room: "f_lounge", at: [20.0, 11.2] });
// @end
// @section furnish_f_bed3 [furniture]
// Rear-left Bedroom 3 (9x14 ft) with queen bed, wardrobe, study desk, ceiling fan and AC
s.furnish("bed_queen", {
  room: "f_bed3",
  against: "right",
  along_ft: 7.0,
  size: { w_ft: 5.2, d_ft: 6.4 },
  color: "#d8cfc2",
  variant: "upholstered headboard"
});
s.furnish("side_table", { room: "f_bed3", against: "right", along_ft: 3.2, material: "wood_oak" });
s.furnish("wardrobe", {
  room: "f_bed3",
  against: "front",
  along_ft: 3.0,
  size: { w_ft: 4.5, d_ft: 2.0 },
  material: "wood_oak"
});
s.furnish("study_desk", {
  room: "f_bed3",
  against: "left",
  along_ft: 10.5,
  size: { w_ft: 3.8, d_ft: 1.8 },
  material: "wood_oak"
});
s.furnish("desk_chair", { room: "f_bed3", at: [2.5, 10.5], rot_deg: -90 });
s.furnish("ceiling_fan", { room: "f_bed3", at: [4.5, 7.0] });
s.furnish("ac_split", { room: "f_bed3", against: "right", along_ft: 7.0 });
// @end
// @section furnish_f_bed4 [furniture]
// Rear-right Bedroom 4 (9x14 ft) with queen bed, wardrobe, dresser, ceiling fan and AC
s.furnish("bed_queen", {
  room: "f_bed4",
  against: "left",
  along_ft: 7.0,
  size: { w_ft: 5.2, d_ft: 6.4 },
  color: "#cfd4d8",
  variant: "upholstered headboard"
});
s.furnish("side_table", { room: "f_bed4", against: "left", along_ft: 3.2, material: "wood_oak" });
s.furnish("wardrobe", {
  room: "f_bed4",
  against: "front",
  along_ft: 6.5,
  size: { w_ft: 4.2, d_ft: 2.0 },
  material: "wood_oak"
});
s.furnish("dressing_table", {
  room: "f_bed4",
  against: "right",
  along_ft: 3.5,
  size: { w_ft: 3.5, d_ft: 1.6 },
  material: "wood_oak"
});
s.furnish("ceiling_fan", { room: "f_bed4", at: [4.5, 7.0] });
s.furnish("ac_split", { room: "f_bed4", against: "left", along_ft: 7.0 });
// @end
// @section furnish_f_baths_and_laundry [furniture]
// First floor bathrooms (Master Bath, Bath 2, Bath 3, Bath 4), laundry room, and stair/corridor accents
s.furnish("vanity", { room: "f_master_bath", against: "front", along_ft: 2.5, size: { w_ft: 3.2, d_ft: 1.6 } });
s.furnish("wc", { room: "f_master_bath", against: "front", along_ft: 5.5 });
s.furnish("shower", { room: "f_master_bath", against: "right", along_ft: 2.5 });

s.furnish("vanity", { room: "f_bath2", against: "front", along_ft: 2.5, size: { w_ft: 2.8, d_ft: 1.6 } });
s.furnish("wc", { room: "f_bath2", against: "right", along_ft: 5.5 });
s.furnish("shower", { room: "f_bath2", against: "back", along_ft: 2.5 });

s.auto_furnish("f_bath3", { style: "modern" });
s.auto_furnish("f_bath4", { style: "modern" });

s.furnish("washing_machine", { room: "f_laundry", against: "left", along_ft: 4.5 });
s.furnish("sink_kitchen", { room: "f_laundry", against: "left", along_ft: 9.0 });

s.furnish("console_table", { room: "f_corr", against: "front", along_ft: 7.0, size: { w_ft: 3.5, d_ft: 1.2 }, material: "wood_walnut" });
s.furnish("plant_small", { room: "g_stair", at: [6.5, 2.0] });
s.furnish("plant_small", { room: "f_stair", at: [6.5, 15.5] });
// @end
// @section landscape [landscape]
// Front lawn outside the boundary wall, ornamental trees, shrubs, stamped concrete driveway, and street context
// Lush front lawn strip and inner lawn garden
s.landscape.lawn({ x: 0.5, y: 0.5, w: 13.5, d: 9.0 });
s.landscape.lawn({ x: 0.5, y: -5.5, w: 13.5, d: 5.0 });

// Stamped concrete driveway and pedestrian stepping path
s.landscape.paving({ x: 14.0, y: -6.0, w: 20.5, d: 16.0 }, { preset: "paving", color: "#808386" });
s.landscape.paving({ x: 30.0, y: 10.0, w: 5.0, d: 48.0 }, "paving");
s.landscape.paving({ x: 0.0, y: 58.0, w: 35.0, d: 7.0 }, "paving");

// Low planter bed along the front boundary wall matching the concept photo
s.landscape.planter({ x: 0.8, y: -2.2, w: 12.8, d: 2.0 }, { height_ft: 0.8, material: "slate_cladding" });

// Signature ornamental tree in front of the left boundary wall plus lush shrubs
s.landscape.tree([5.5, -1.2], { kind: "ornamental", height_ft: 17.0 });
s.landscape.tree([1.8, -1.5], { kind: "bush", height_ft: 4.0 });
s.landscape.tree([4.0, -1.5], { kind: "bush", height_ft: 3.2 });
s.landscape.tree([8.2, -1.3], { kind: "bush", height_ft: 3.8 });
s.landscape.tree([12.2, -1.4], { kind: "palm", height_ft: 5.5 });

// Inner garden & side passage greenery
s.landscape.tree([3.0, 4.5], { kind: "bush", height_ft: 3.5 });
s.landscape.tree([10.5, 4.5], { kind: "bush", height_ft: 3.5 });
s.landscape.tree([32.5, 24.0], { kind: "ashoka", height_ft: 14.0 });
s.landscape.tree([32.5, 38.0], { kind: "ashoka", height_ft: 14.0 });

// Road, kerb, neighbouring houses and streetlamp context
s.landscape.street({ road_width_ft: 40, neighbours: true, streetlights: true });
// @end
// @section lighting [lighting]
// Late-afternoon golden daylight and warm interior illumination
s.lights.sun({ hour: 16.5, intensity: 1.25 });
s.lights.interior({ warmth: "warm", intensity: 1.0 });
// @end