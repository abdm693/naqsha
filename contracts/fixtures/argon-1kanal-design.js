// @section structure [structure]
// 1-kanal Spanish Mediterranean villa: warm cream stucco, dark walnut arched joinery,
// wrought-iron balustrades, beige travertine/marble reception floors and warm oak bedrooms.
s.structure({
  exterior_wall: { preset: "plaster_warm", color: "#f4efe6" },
  interior_wall: { preset: "paint", color: "#f6f1e8" },
  ceiling: { preset: "paint", color: "#fbf9f4" },
  floors: {
    default: "marble_beige",
    drawing: "marble_beige",
    lobby: "marble_beige",
    lounge: "marble_beige",
    dining: "marble_beige",
    stair: "marble_beige",
    prayer: "marble_white",
    master_bedroom: "wood_floor_walnut",
    bedroom: "wood_floor_oak",
    guest_bedroom: "wood_floor_oak",
    kitchen: { preset: "porcelain_tile", color: "#dfd5c6" },
    dirty_kitchen: { preset: "porcelain_tile", color: "#d4cab9" },
    bath: "ceramic_tile",
    powder: "marble_beige",
    servant: "ceramic_tile",
    balcony: { preset: "porcelain_tile", color: "#cbbba6" },
    terrace: { preset: "porcelain_tile", color: "#cbbba6" },
    porch: { preset: "paving", color: "#9c9488" }
  },
  window_frame: { preset: "wood_walnut", color: "#4a3222" },
  door: { preset: "wood_walnut", color: "#422b1d" },
  glass: "glass_clear",
  railing: "metal_bars",
  boundary_wall: { preset: "plaster_warm", color: "#f1ece1" },
  gate: "metal_black",
  plinth: "travertine"
});
// @end
// @section facade_spanish_roofs [facade]
// Spanish terracotta barrel-tile pitched eaves over the left bay, entry portico, car porch and rooftop cupola.
const tileMat = s.mat({ preset: "brick_red", color: "#b85a36", roughness: 0.65 });
const trimMat = s.mat({ preset: "travertine", color: "#dcd0be" });
const darkWood = s.mat({ preset: "wood_walnut", color: "#3d271a" });

function addSpanishEave(x0, x1, yFront, yBack, hBase, pitchH, label) {
  const w = x1 - x0;
  const d = yBack - yFront;
  const cx = (x0 + x1) / 2;
  const cy = (yFront + yBack) / 2;
  const base = new THREE.Mesh(new THREE.BoxGeometry(s.ft(w), s.ft(0.45), s.ft(d)), trimMat);
  base.position.copy(s.toWorld(cx, cy, hBase + 0.22));
  s.add(base, { layer: "facade", kind: "facade:cornice", label });

  const steps = 5;
  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    const sw = Math.max(1, w - t * 1.6);
    const sd = Math.max(0.8, d * (1 - t * 0.55));
    const sh = pitchH / steps;
    const tier = new THREE.Mesh(new THREE.BoxGeometry(s.ft(sw), s.ft(sh), s.ft(sd)), tileMat);
    tier.position.copy(s.toWorld(cx, yFront + (d - sd * 0.5) * 0.5 + t * 0.3, hBase + 0.45 + i * sh + sh * 0.5));
    s.add(tier, { layer: "facade", kind: "facade:tile_roof", label });
  }
  const count = Math.max(3, Math.floor(w / 2.2));
  for (let i = 0; i < count; i++) {
    const rx = x0 + 0.9 + (i * (w - 1.8)) / Math.max(1, count - 1);
    const corbel = new THREE.Mesh(new THREE.BoxGeometry(s.ft(0.35), s.ft(0.45), s.ft(0.9)), darkWood);
    corbel.position.copy(s.toWorld(rx, yFront + 0.5, hBase - 0.2));
    s.add(corbel, { layer: "facade", kind: "facade:corbel", label: "Timber rafter tail" });
  }
}

// Left bay pitched tile roof (x: 0..18.5, projecting 2 ft into 20 ft front lawn)
addSpanishEave(0, 18.5, 18.0, 24.5, 24.0, 2.2, "Left bay Spanish tile roof");
// Central entrance portico tile roof (x: 17.6..27.4, y: 17.8..21.5)
addSpanishEave(17.6, 27.4, 17.8, 21.5, 13.5, 1.8, "Entrance portico tile roof");
// Right car porch fascia tile roof under the front terrace balcony (x: 26.5..46.0, y: 17.5..21.2)
addSpanishEave(26.5, 46.0, 17.5, 21.2, 12.2, 1.4, "Porch fascia Spanish tile roof");
// @end
// @section facade_arches_and_mouldings [facade]
// Classical travertine arch surrounds over ground & first-floor windows, porch colonnade arch, and cornice bands.
const mMat = s.mat({ preset: "travertine", color: "#dfd4c3" });
const stuccoMat = s.mat({ preset: "plaster_warm", color: "#f4efe6" });
const glassMat = s.mat({ preset: "glass_tinted", color: "#3a464e" });
const woodMat = s.mat({ preset: "wood_walnut", color: "#422b1d" });

function addWindowArch(cx, yPlane, hSpring, radius, label) {
  const arch = new THREE.Mesh(
    new THREE.CylinderGeometry(s.ft(radius), s.ft(radius), s.ft(0.55), 24, 1, false, 0, Math.PI),
    mMat
  );
  arch.rotation.z = Math.PI / 2;
  arch.rotation.y = Math.PI / 2;
  arch.position.copy(s.toWorld(cx, yPlane - 0.25, hSpring));
  s.add(arch, { layer: "facade", kind: "facade:arch", label });

  const key = new THREE.Mesh(new THREE.BoxGeometry(s.ft(0.55), s.ft(0.85), s.ft(0.7)), mMat);
  key.position.copy(s.toWorld(cx, yPlane - 0.3, hSpring + radius));
  s.add(key, { layer: "facade", kind: "facade:keystone", label: "Arch keystone" });
}

// Left bay Ground Floor twin arches (x = 6, 12 at y = 20) and First Floor twin arches (x = 6, 12 at y = 24)
for (const x of [6.0, 12.0]) {
  addWindowArch(x, 20.0, 9.0, 2.2, "Ground drawing arched moulding");
  addWindowArch(x, 24.0, 20.0, 2.2, "Master balcony arched moulding");
}
// Central Entrance arch (x = 22.5, y = 20.0) + round oculus window above on First Floor
addWindowArch(22.5, 19.6, 9.8, 3.1, "Main entrance grand arch");
const oculusRing = new THREE.Mesh(new THREE.TorusGeometry(s.ft(1.65), s.ft(0.28), 12, 28), mMat);
oculusRing.position.copy(s.toWorld(22.5, 19.85, 19.2));
s.add(oculusRing, { layer: "facade", kind: "facade:oculus", label: "Central oculus moulding" });

// Right bay First Floor triple arches (x = 31, 36, 41 at y = 25)
for (const x of [31.0, 36.0, 41.0]) {
  addWindowArch(x, 25.0, 20.0, 2.0, "Upper triple-arch colonnade moulding");
}

// Wide segmental arch header across the 2-car porch opening (x: 27..45, y = 20)
const porchHeader = new THREE.Mesh(new THREE.BoxGeometry(s.ft(18.4), s.ft(1.6), s.ft(1.2)), stuccoMat);
porchHeader.position.copy(s.toWorld(36.0, 20.0, 11.4));
s.add(porchHeader, { layer: "facade", kind: "facade:porch_arch", label: "Car porch wide arch spandrel" });
const porchKey = new THREE.Mesh(new THREE.BoxGeometry(s.ft(0.8), s.ft(1.1), s.ft(1.4)), mMat);
porchKey.position.copy(s.toWorld(36.0, 19.9, 11.2));
s.add(porchKey, { layer: "facade", kind: "facade:keystone", label: "Porch arch keystone" });

// Warm facade wall lanterns flanking the arches
for (const x of [2.6, 15.4, 19.2, 25.8]) {
  s.facade.wall_light({ side: "front", x_ft: x, h_ft: 8.5, color: "#ffd599", intensity: 1.5 });
}
for (const x of [2.6, 15.4, 28.2, 43.8]) {
  s.facade.wall_light({ side: "front", x_ft: x, h_ft: 19.5, color: "#ffd599", intensity: 1.5 });
}
// @end
// @section facade_cupola_and_parapet [facade]
// Rooftop Spanish stair-tower cupola with a classical dome, arched parapet slots, and moulded balcony corbels.
const stucco = s.mat({ preset: "plaster_warm", color: "#f4efe6" });
const trim = s.mat({ preset: "travertine", color: "#dcd0be" });
const tile = s.mat({ preset: "brick_red", color: "#b85a36", roughness: 0.65 });
const domeMat = s.mat({ preset: "travertine", color: "#e5d9c5", roughness: 0.45 });
const bronze = s.mat("metal_bronze");

// Front parapet decorative cornice & vertical slot niches along x: 18..45 at y = 25
const parapetCornice = new THREE.Mesh(new THREE.BoxGeometry(s.ft(27.5), s.ft(0.6), s.ft(1.2)), trim);
parapetCornice.position.copy(s.toWorld(31.5, 24.8, 27.0));
s.add(parapetCornice, { layer: "facade", kind: "facade:cornice", label: "Parapet crown moulding" });

for (let x = 21.0; x <= 42.5; x += 3.5) {
  const slot = new THREE.Mesh(new THREE.BoxGeometry(s.ft(0.75), s.ft(1.6), s.ft(0.35)), trim);
  slot.position.copy(s.toWorld(x, 24.75, 25.4));
  s.add(slot, { layer: "facade", kind: "facade:niche", label: "Parapet arched niche" });
}

// Sculpted stone corbels supporting the left master balcony (x: 0..18, y = 20)
for (const x of [2.5, 7.2, 10.8, 15.5]) {
  const brk = new THREE.Mesh(new THREE.BoxGeometry(s.ft(0.8), s.ft(1.1), s.ft(2.2)), trim);
  brk.position.copy(s.toWorld(x, 20.6, 11.8));
  s.add(brk, { layer: "facade", kind: "facade:corbel", label: "Balcony stone bracket" });
}

// Spanish cupola & dome crowning the rooftop stair tower (x: 28..38, y: 30..40, h: 27..37)
const towerDrum = new THREE.Mesh(new THREE.BoxGeometry(s.ft(9.5), s.ft(4.5), s.ft(9.5)), stucco);
towerDrum.position.copy(s.toWorld(33.0, 35.0, 29.25));
s.add(towerDrum, { layer: "facade", kind: "facade:cupola", label: "Spanish rooftop tower" });

const towerRoof = new THREE.Mesh(new THREE.ConeGeometry(s.ft(7.6), s.ft(2.4), 4), tile);
towerRoof.rotation.y = Math.PI / 4;
towerRoof.position.copy(s.toWorld(33.0, 35.0, 32.7));
s.add(towerRoof, { layer: "facade", kind: "facade:cupola_roof", label: "Tower terracotta hipped roof" });

const dome = new THREE.Mesh(new THREE.SphereGeometry(s.ft(2.5), 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), domeMat);
dome.position.copy(s.toWorld(33.0, 35.0, 33.6));
s.add(dome, { layer: "facade", kind: "facade:dome", label: "Cupola dome" });

const finial = new THREE.Mesh(new THREE.ConeGeometry(s.ft(0.35), s.ft(1.3), 12), bronze);
finial.position.copy(s.toWorld(33.0, 35.0, 36.5));
s.add(finial, { layer: "facade", kind: "facade:finial", label: "Bronze dome finial" });
// @end
// @section facade_boundary [facade]
// Sculpted Spanish boundary wall with recessed blind arches, travertine coping and wrought-iron pier lanterns.
const wallMat = s.mat({ preset: "plaster_warm", color: "#f2ede2" });
const trimMat = s.mat({ preset: "travertine", color: "#dcd0be" });
const ironMat = s.mat("metal_black");
const warmGlow = s.mat({ preset: "glass_frosted", color: "#ffe3b3", emissive: "#ffb85c", emissive_intensity: 0.9 });

// Three blind arches along the front lawn boundary wall (x: 1.5..19.0, y = 0)
for (const cx of [4.8, 10.2, 15.6]) {
  const archFrame = new THREE.Mesh(new THREE.BoxGeometry(s.ft(4.2), s.ft(3.4), s.ft(0.28)), trimMat);
  archFrame.position.copy(s.toWorld(cx, -0.35, 2.5));
  s.add(archFrame, { layer: "facade", kind: "boundary_wall:arch_panel", label: "Boundary wall arched niche" });
}

// Gate piers with classical caps and wrought-iron coach lanterns (x = 19.6, 24.4, 43.2)
for (const px of [19.6, 24.6, 43.2]) {
  const cap = new THREE.Mesh(new THREE.BoxGeometry(s.ft(1.9), s.ft(0.35), s.ft(1.9)), trimMat);
  cap.position.copy(s.toWorld(px, 0.0, 5.2));
  s.add(cap, { layer: "facade", kind: "boundary_wall:pier_cap", label: "Gate pier stone cap" });

  const stem = new THREE.Mesh(new THREE.CylinderGeometry(s.ft(0.12), s.ft(0.18), s.ft(0.6), 8), ironMat);
  stem.position.copy(s.toWorld(px, 0.0, 5.65));
  s.add(stem, { layer: "facade", kind: "boundary_wall:lantern", label: "Pier coach lantern" });

  const globe = new THREE.Mesh(new THREE.BoxGeometry(s.ft(0.55), s.ft(0.75), s.ft(0.55)), warmGlow);
  globe.position.copy(s.toWorld(px, 0.0, 6.25));
  s.add(globe, { layer: "facade", kind: "boundary_wall:lantern", label: "Pier lantern light" });
}
// @end
// @section interior_spanish_ceilings [interior]
// Coffered false ceilings with warm cove lighting and travertine/walnut feature walls in main rooms.
s.interior.false_ceiling({ room: "g_drawing", drop_ft: 0.8, inset_ft: 2.0, cove_color: "#ffd699" });
s.interior.downlights({ room: "g_drawing", rows: 3, cols: 3 });
s.interior.accent_wall({ room: "g_drawing", side: "left", material: "travertine" });

s.interior.false_ceiling({ room: "g_lobby", drop_ft: 0.7, inset_ft: 1.5, cove_color: "#ffd699" });
s.interior.downlights({ room: "g_lobby", rows: 2, cols: 2 });

s.interior.false_ceiling({ room: "g_lounge", drop_ft: 0.8, inset_ft: 2.2, cove_color: "#ffd699" });
s.interior.downlights({ room: "g_lounge", rows: 2, cols: 4 });
s.interior.accent_wall({ room: "g_lounge", side: "front", material: { preset: "wood_walnut", color: "#523624" } });

s.interior.false_ceiling({ room: "g_dining", drop_ft: 0.75, inset_ft: 2.0, cove_color: "#ffd699" });
s.interior.downlights({ room: "g_dining", rows: 2, cols: 3 });
s.interior.accent_wall({ room: "g_dining", side: "back", material: "travertine" });

s.interior.false_ceiling({ room: "f_master", drop_ft: 0.75, inset_ft: 1.8, cove_color: "#ffd699" });
s.interior.downlights({ room: "f_master", rows: 2, cols: 3 });
s.interior.accent_wall({ room: "f_master", side: "left", material: { preset: "wood_walnut", color: "#4d3322" } });

s.interior.false_ceiling({ room: "f_bed2", drop_ft: 0.7, inset_ft: 1.8, cove_color: "#ffd699" });
s.interior.downlights({ room: "f_bed2", rows: 2, cols: 3 });
s.interior.accent_wall({ room: "f_bed2", side: "right", material: "travertine" });

s.interior.false_ceiling({ room: "f_lounge", drop_ft: 0.7, inset_ft: 1.8, cove_color: "#ffd699" });
s.interior.downlights({ room: "f_lounge", rows: 2, cols: 3 });

s.interior.false_ceiling({ room: "f_prayer", drop_ft: 0.65, inset_ft: 1.4, cove_color: "#ffe4b5" });
s.interior.accent_wall({ room: "f_prayer", side: "left", material: "travertine" });
// @end
// @section furnish_g_drawing [furniture]
// Grand Spanish formal drawing room (18 x 20 ft): classic cream & walnut seating around a marble coffee table.
s.furnish("rug", { room: "g_drawing", at: [9.0, 10.0], size: { w_ft: 12, d_ft: 13 }, color: "#c8b79e" });
s.furnish("sofa_3", { room: "g_drawing", against: "left", along_ft: 10.0, color: "#e5dccb", material: "wood_walnut" });
s.furnish("side_table", { room: "g_drawing", against: "left", along_ft: 4.5, material: "wood_walnut" });
s.furnish("side_table", { room: "g_drawing", against: "left", along_ft: 15.5, material: "wood_walnut" });
s.furnish("table_lamp", { room: "g_drawing", against: "left", along_ft: 4.5 });
s.furnish("table_lamp", { room: "g_drawing", against: "left", along_ft: 15.5 });
s.furnish("painting", { room: "g_drawing", against: "left", along_ft: 10.0, size: { w_ft: 5.0, h_ft: 3.2 } });
s.furnish("sofa_2", { room: "g_drawing", at: [9.0, 15.5], rot_deg: 180, color: "#e5dccb" });
s.furnish("armchair", { room: "g_drawing", at: [13.5, 7.5], rot_deg: -75, color: "#9c5636" });
s.furnish("armchair", { room: "g_drawing", at: [13.5, 12.5], rot_deg: -105, color: "#9c5636" });
s.furnish("coffee_table", { room: "g_drawing", at: [8.8, 10.0], size: { w_ft: 4.5, d_ft: 2.8 }, material: "marble_beige", variant: "marble top" });
s.furnish("console_table", { room: "g_drawing", against: "right", along_ft: 15.0, size: { w_ft: 4.0, d_ft: 1.3 }, material: "wood_walnut" });
s.furnish("mirror_wall", { room: "g_drawing", against: "right", along_ft: 15.0, size: { w_ft: 3.0, h_ft: 3.5 } });
s.furnish("curtains", { room: "g_drawing", against: "front", along_ft: 9.0, size: { w_ft: 13.0 }, color: "#dfd3be" });
s.furnish("chandelier", { room: "g_drawing", at: [9.0, 10.0] });
s.furnish("ceiling_fan", { room: "g_drawing", at: [9.0, 6.0] });
s.furnish("ac_split", { room: "g_drawing", against: "left", along_ft: 10.0 });
s.furnish("plant_floor", { room: "g_drawing", at: [2.0, 2.2] });
s.furnish("plant_floor", { room: "g_drawing", at: [16.0, 2.2] });
// @end
// @section furnish_g_lobby [furniture]
// Entrance lobby (9 x 14 ft): carved walnut console table, mirror, chandelier and indoor palms.
s.furnish("rug", { room: "g_lobby", at: [4.5, 7.0], size: { w_ft: 5.5, d_ft: 8.5 }, color: "#c2b097" });
s.furnish("console_table", { room: "g_lobby", against: "left", along_ft: 10.5, size: { w_ft: 3.8, d_ft: 1.2 }, material: "wood_walnut" });
s.furnish("mirror_wall", { room: "g_lobby", against: "left", along_ft: 10.5, size: { w_ft: 2.8, h_ft: 3.4 } });
s.furnish("chandelier", { room: "g_lobby", at: [4.5, 7.0] });
s.furnish("plant_floor", { room: "g_lobby", at: [1.6, 2.0] });
s.furnish("plant_floor", { room: "g_lobby", at: [7.4, 2.0] });
// @end
// @section furnish_g_porch [furniture]
// 2-car Spanish arched porch (18 x 20 ft): black Honda City sedan as in the concept render plus a second family SUV.
s.furnish("car_sedan", { room: "g_porch", at: [5.2, 10.0], rot_deg: 0, color: "#18191c" });
s.furnish("car_suv", { room: "g_porch", at: [13.0, 10.0], rot_deg: 0, color: "#f2f0eb" });
// @end
// @section furnish_g_lounge [furniture]
// Family TV lounge (30 x 14 ft): walnut media unit on the front wall, large L-sofa and Moroccan area rug.
s.furnish("rug", { room: "g_lounge", at: [17.0, 7.2], size: { w_ft: 14, d_ft: 9.5 }, color: "#cfc2ae" });
s.furnish("tv_unit", { room: "g_lounge", against: "front", along_ft: 18.0, size: { w_ft: 7.5, d_ft: 1.6 }, material: "wood_walnut" });
s.furnish("tv", { room: "g_lounge", against: "front", along_ft: 18.0, size: { w_ft: 5.5 } });
s.furnish("sofa_l", { room: "g_lounge", at: [17.5, 9.2], rot_deg: 180, size: { w_ft: 10.5, d_ft: 7.0 }, color: "#d8ccb8" });
s.furnish("armchair", { room: "g_lounge", at: [10.5, 6.5], rot_deg: 75, color: "#a45c38" });
s.furnish("coffee_table", { room: "g_lounge", at: [17.5, 5.5], size: { w_ft: 4.5, d_ft: 2.5 }, material: "wood_walnut" });
s.furnish("floor_lamp", { room: "g_lounge", at: [24.0, 11.5] });
s.furnish("curtains", { room: "g_lounge", against: "right", along_ft: 7.0, size: { w_ft: 9.0 }, color: "#e5dac8" });
s.furnish("ceiling_fan", { room: "g_lounge", at: [12.0, 7.0] });
s.furnish("ceiling_fan", { room: "g_lounge", at: [22.0, 7.0] });
s.furnish("ac_split", { room: "g_lounge", against: "front", along_ft: 12.0 });
s.furnish("plant_floor", { room: "g_lounge", at: [28.0, 2.0] });
// @end
// @section furnish_g_dining [furniture]
// Formal dining hall (30 x 10 ft): 8-seater marble & walnut dining table, sideboard, chandelier and water dispenser.
s.furnish("rug", { room: "g_dining", at: [16.0, 5.0], size: { w_ft: 12, d_ft: 7.5 }, color: "#c9baa3" });
s.furnish("dining_table_8", { room: "g_dining", at: [16.0, 5.0], rot_deg: 90, material: "marble_beige", variant: "marble top" });
s.furnish("chandelier", { room: "g_dining", at: [16.0, 5.0] });
s.furnish("sideboard", { room: "g_dining", against: "back", along_ft: 22.0, size: { w_ft: 5.5, d_ft: 1.6 }, material: "wood_walnut" });
s.furnish("painting", { room: "g_dining", against: "back", along_ft: 22.0, size: { w_ft: 4.2, h_ft: 2.6 } });
s.furnish("curtains", { room: "g_dining", against: "right", along_ft: 5.0, size: { w_ft: 7.0 }, color: "#e5dac8" });
s.furnish("water_dispenser", { room: "g_dining", at: [5.5, 8.2], rot_deg: 180 });
s.furnish("ceiling_fan", { room: "g_dining", at: [16.0, 5.0] });
s.furnish("plant_floor", { room: "g_dining", at: [28.0, 8.0] });
// @end
// @section furnish_g_kitchen [furniture]
// Main show kitchen (11 x 16 ft): L-shaped counter run, central prep island, double fridge and built-in appliances.
s.furnish("kitchen_counter", { room: "g_kitchen", against: "back", along_ft: 5.5, size: { w_ft: 9.0, d_ft: 2.0 }, material: "wood_oak" });
s.furnish("sink_kitchen", { room: "g_kitchen", against: "back", along_ft: 5.5 });
s.furnish("kitchen_counter", { room: "g_kitchen", against: "right", along_ft: 7.5, size: { w_ft: 10.0, d_ft: 2.0 }, material: "wood_oak" });
s.furnish("hob", { room: "g_kitchen", against: "right", along_ft: 7.5 });
s.furnish("oven", { room: "g_kitchen", against: "right", along_ft: 11.2 });
s.furnish("microwave", { room: "g_kitchen", against: "right", along_ft: 3.8 });
s.furnish("fridge", { room: "g_kitchen", against: "left", along_ft: 3.5 });
s.furnish("kitchen_island", { room: "g_kitchen", at: [5.2, 7.5], size: { w_ft: 3.2, d_ft: 5.5 }, material: "marble_beige" });
s.furnish("ceiling_fan", { room: "g_kitchen", at: [5.5, 8.0] });
// @end
// @section furnish_g_dirty_kitchen [furniture]
// Grease / dirty kitchen (8 x 16 ft): heavy-duty cooking counter, hob, sink and washing machine.
s.furnish("kitchen_counter", { room: "g_dirty_kitchen", against: "left", along_ft: 8.0, size: { w_ft: 11.0, d_ft: 2.0 }, material: "wood_walnut" });
s.furnish("hob", { room: "g_dirty_kitchen", against: "left", along_ft: 6.5 });
s.furnish("sink_kitchen", { room: "g_dirty_kitchen", against: "back", along_ft: 5.5 });
s.furnish("washing_machine", { room: "g_dirty_kitchen", against: "right", along_ft: 3.5 });
// @end
// @section furnish_g_bed1 [furniture]
// Ground floor guest bedroom (12 x 16 ft): queen bed, side tables, wardrobe, dresser and split AC.
s.furnish("bed_queen", { room: "g_bed1", against: "left", along_ft: 8.0, color: "#dfd4c3", material: "wood_walnut" });
s.furnish("side_table", { room: "g_bed1", against: "left", along_ft: 4.0, material: "wood_walnut" });
s.furnish("side_table", { room: "g_bed1", against: "left", along_ft: 12.0, material: "wood_walnut" });
s.furnish("table_lamp", { room: "g_bed1", against: "left", along_ft: 4.0 });
s.furnish("table_lamp", { room: "g_bed1", against: "left", along_ft: 12.0 });
s.furnish("rug", { room: "g_bed1", at: [6.5, 8.0], size: { w_ft: 8.0, d_ft: 9.0 }, color: "#c9baa5" });
s.furnish("wardrobe", { room: "g_bed1", against: "right", along_ft: 4.2, size: { w_ft: 5.5, d_ft: 2.0 }, material: "wood_walnut" });
s.furnish("dresser", { room: "g_bed1", against: "right", along_ft: 12.5, size: { w_ft: 3.5 }, material: "wood_walnut" });
s.furnish("curtains", { room: "g_bed1", against: "back", along_ft: 6.0, size: { w_ft: 7.0 }, color: "#e5dac8" });
s.furnish("ceiling_fan", { room: "g_bed1", at: [6.0, 8.0] });
s.furnish("ac_split", { room: "g_bed1", against: "left", along_ft: 8.0 });
// @end
// @section furnish_g_servant [furniture]
// Servant quarter (8 x 12.5 ft): single bed, wardrobe and ceiling fan.
s.furnish("bed_single", { room: "g_servant", against: "left", along_ft: 5.5, color: "#d5cbbd" });
s.furnish("wardrobe", { room: "g_servant", against: "front", along_ft: 4.0, size: { w_ft: 3.8, d_ft: 1.8 } });
s.furnish("ceiling_fan", { room: "g_servant", at: [4.0, 6.2] });
// @end
// @section furnish_f_master [furniture]
// Master bedroom suite (18 x 16 ft): king bed on walnut feature wall, reading chairs, wardrobe, TV unit & curtains.
s.furnish("bed_king", { room: "f_master", against: "left", along_ft: 8.0, color: "#dfd3c0", material: "wood_walnut", variant: "upholstered headboard" });
s.furnish("side_table", { room: "f_master", against: "left", along_ft: 3.4, material: "wood_walnut" });
s.furnish("side_table", { room: "f_master", against: "left", along_ft: 12.6, material: "wood_walnut" });
s.furnish("table_lamp", { room: "f_master", against: "left", along_ft: 3.4 });
s.furnish("table_lamp", { room: "f_master", against: "left", along_ft: 12.6 });
s.furnish("rug", { room: "f_master", at: [8.5, 8.0], size: { w_ft: 11.0, d_ft: 10.0 }, color: "#cbbba4" });
s.furnish("tv_unit", { room: "f_master", against: "right", along_ft: 10.5, size: { w_ft: 5.5 }, material: "wood_walnut" });
s.furnish("tv", { room: "f_master", against: "right", along_ft: 10.5, size: { w_ft: 4.5 } });
s.furnish("wardrobe", { room: "f_master", against: "back", along_ft: 6.5, size: { w_ft: 8.0, d_ft: 2.0 }, material: "wood_walnut" });
s.furnish("armchair", { room: "f_master", at: [13.5, 3.8], rot_deg: -35, color: "#9c5636" });
s.furnish("curtains", { room: "f_master", against: "front", along_ft: 9.0, size: { w_ft: 12.0 }, color: "#e8decb" });
s.furnish("ceiling_fan", { room: "f_master", at: [9.0, 8.0] });
s.furnish("ac_split", { room: "f_master", against: "left", along_ft: 8.0 });
// @end
// @section furnish_f_bed2 [furniture]
// Front right Bedroom 2 (18 x 15 ft) opening to the triple-arch terrace balcony: king bed, desk, wardrobe & lounge chair.
s.furnish("bed_king", { room: "f_bed2", against: "right", along_ft: 7.5, color: "#e3d8c6", material: "wood_walnut" });
s.furnish("side_table", { room: "f_bed2", against: "right", along_ft: 3.0, material: "wood_walnut" });
s.furnish("side_table", { room: "f_bed2", against: "right", along_ft: 12.0, material: "wood_walnut" });
s.furnish("table_lamp", { room: "f_bed2", against: "right", along_ft: 3.0 });
s.furnish("table_lamp", { room: "f_bed2", against: "right", along_ft: 12.0 });
s.furnish("rug", { room: "f_bed2", at: [9.5, 7.5], size: { w_ft: 10.5, d_ft: 9.5 }, color: "#c9baa3" });
s.furnish("wardrobe", { room: "f_bed2", against: "left", along_ft: 5.0, size: { w_ft: 6.5, d_ft: 2.0 }, material: "wood_walnut" });
s.furnish("dresser", { room: "f_bed2", against: "back", along_ft: 12.0, size: { w_ft: 4.0 }, material: "wood_walnut" });
s.furnish("curtains", { room: "f_bed2", against: "front", along_ft: 9.0, size: { w_ft: 13.0 }, color: "#e8decb" });
s.furnish("ceiling_fan", { room: "f_bed2", at: [9.0, 7.5] });
s.furnish("ac_split", { room: "f_bed2", against: "right", along_ft: 7.5 });
// @end
// @section furnish_f_lounge [furniture]
// Upper family lounge (30 x 10 ft): cozy seating group, TV console, rug and ceiling fans.
s.furnish("rug", { room: "f_lounge", at: [14.0, 5.0], size: { w_ft: 11.0, d_ft: 7.0 }, color: "#cfc1ad" });
s.furnish("sofa_3", { room: "f_lounge", against: "front", along_ft: 12.0, color: "#dfd3c0" });
s.furnish("armchair", { room: "f_lounge", at: [7.0, 5.5], rot_deg: 65, color: "#9c5636" });
s.furnish("armchair", { room: "f_lounge", at: [17.5, 5.5], rot_deg: -65, color: "#9c5636" });
s.furnish("coffee_table", { room: "f_lounge", at: [12.0, 5.5], size: { w_ft: 4.0, d_ft: 2.2 }, material: "wood_walnut" });
s.furnish("console_table", { room: "f_lounge", against: "front", along_ft: 24.0, size: { w_ft: 4.0, d_ft: 1.3 }, material: "wood_walnut" });
s.furnish("curtains", { room: "f_lounge", against: "right", along_ft: 5.0, size: { w_ft: 6.5 }, color: "#e5dac8" });
s.furnish("ceiling_fan", { room: "f_lounge", at: [12.0, 5.0] });
s.furnish("ceiling_fan", { room: "f_lounge", at: [23.0, 5.0] });
s.furnish("ac_split", { room: "f_lounge", against: "front", along_ft: 24.0 });
// @end
// @section furnish_f_prayer [furniture]
// Dedicated prayer room (9 x 14 ft): Qibla-facing prayer mats (facing West/left in S-facing plot), bookshelf and calm lighting.
s.furnish("rug", { room: "f_prayer", at: [4.5, 7.0], size: { w_ft: 6.5, d_ft: 10.0 }, color: "#d8ccb8" });
s.furnish("prayer_mat", { room: "f_prayer", at: [3.2, 5.0], rot_deg: -90, color: "#8c3b2b" });
s.furnish("prayer_mat", { room: "f_prayer", at: [3.2, 8.5], rot_deg: -90, color: "#2d5a4c" });
s.furnish("bookshelf", { room: "f_prayer", against: "back", along_ft: 4.5, size: { w_ft: 4.5, d_ft: 1.2 }, material: "wood_walnut" });
s.furnish("curtains", { room: "f_prayer", against: "right", along_ft: 7.0, size: { w_ft: 5.5 }, color: "#efe8dc" });
s.furnish("ceiling_fan", { room: "f_prayer", at: [4.5, 7.0] });
// @end
// @section furnish_f_bed3 [furniture]
// Bedroom 3 (14 x 14 ft): queen bed, side tables, study desk and wardrobe.
s.furnish("bed_queen", { room: "f_bed3", against: "left", along_ft: 7.0, color: "#dfd3c0", material: "wood_oak" });
s.furnish("side_table", { room: "f_bed3", against: "left", along_ft: 3.0, material: "wood_oak" });
s.furnish("side_table", { room: "f_bed3", against: "left", along_ft: 11.0, material: "wood_oak" });
s.furnish("rug", { room: "f_bed3", at: [7.0, 7.0], size: { w_ft: 8.5, d_ft: 8.5 }, color: "#c9baa3" });
s.furnish("wardrobe", { room: "f_bed3", against: "front", along_ft: 9.5, size: { w_ft: 5.5, d_ft: 2.0 }, material: "wood_oak" });
s.furnish("ceiling_fan", { room: "f_bed3", at: [7.0, 7.0] });
s.furnish("ac_split", { room: "f_bed3", against: "left", along_ft: 7.0 });
// @end
// @section furnish_f_bed4 [furniture]
// Rear-left Bedroom 4 (14 x 16 ft): queen bed, study desk, wardrobe and split AC.
s.furnish("bed_queen", { room: "f_bed4", against: "right", along_ft: 8.0, color: "#dfd3c0", material: "wood_oak" });
s.furnish("side_table", { room: "f_bed4", against: "right", along_ft: 4.0, material: "wood_oak" });
s.furnish("side_table", { room: "f_bed4", against: "right", along_ft: 12.0, material: "wood_oak" });
s.furnish("rug", { room: "f_bed4", at: [7.0, 8.0], size: { w_ft: 8.5, d_ft: 9.0 }, color: "#c9baa3" });
s.furnish("wardrobe", { room: "f_bed4", against: "front", along_ft: 5.0, size: { w_ft: 6.0, d_ft: 2.0 }, material: "wood_oak" });
s.furnish("study_desk", { room: "f_bed4", against: "left", along_ft: 12.0, size: { w_ft: 4.0 }, material: "wood_oak" });
s.furnish("desk_chair", { room: "f_bed4", at: [3.2, 12.0], rot_deg: -90 });
s.furnish("curtains", { room: "f_bed4", against: "back", along_ft: 7.0, size: { w_ft: 7.0 }, color: "#e5dac8" });
s.furnish("ceiling_fan", { room: "f_bed4", at: [7.0, 8.0] });
s.furnish("ac_split", { room: "f_bed4", against: "right", along_ft: 8.0 });
// @end
// @section furnish_f_bed5 [furniture]
// Rear-right Bedroom 5 (15 x 16 ft): queen bed, wardrobe, dressing table and split AC.
s.furnish("bed_queen", { room: "f_bed5", against: "left", along_ft: 8.0, color: "#dfd3c0", material: "wood_oak" });
s.furnish("side_table", { room: "f_bed5", against: "left", along_ft: 4.0, material: "wood_oak" });
s.furnish("side_table", { room: "f_bed5", against: "left", along_ft: 12.0, material: "wood_oak" });
s.furnish("rug", { room: "f_bed5", at: [7.5, 8.0], size: { w_ft: 9.0, d_ft: 9.0 }, color: "#c9baa3" });
s.furnish("wardrobe", { room: "f_bed5", against: "front", along_ft: 10.5, size: { w_ft: 6.0, d_ft: 2.0 }, material: "wood_oak" });
s.furnish("dressing_table", { room: "f_bed5", against: "right", along_ft: 4.0, size: { w_ft: 3.8 }, material: "wood_oak" });
s.furnish("curtains", { room: "f_bed5", against: "back", along_ft: 7.5, size: { w_ft: 7.0 }, color: "#e5dac8" });
s.furnish("ceiling_fan", { room: "f_bed5", at: [7.5, 8.0] });
s.furnish("ac_split", { room: "f_bed5", against: "left", along_ft: 8.0 });
// @end
// @section furnish_baths_and_balconies [furniture]
// Bathrooms, balconies, stair halls and roof terrace furnished in classic Spanish style.
s.furnish("outdoor_table", { room: "f_balcony_r", at: [9.0, 2.5] });
s.furnish("outdoor_chair", { room: "f_balcony_r", at: [6.5, 2.5], rot_deg: 90 });
s.furnish("outdoor_chair", { room: "f_balcony_r", at: [11.5, 2.5], rot_deg: -90 });
s.furnish("plant_floor", { room: "f_balcony_r", at: [2.0, 2.5] });
s.furnish("plant_floor", { room: "f_balcony_r", at: [16.0, 2.5] });
s.furnish("plant_floor", { room: "f_balcony_l", at: [2.0, 2.0] });
s.furnish("plant_floor", { room: "f_balcony_l", at: [16.0, 2.0] });

for (const id of [
  "g_powder", "g_stair", "g_bath1", "g_servant_bath",
  "f_master_bath", "f_bath2", "f_stair", "f_bath3", "f_bath4", "f_bath5", "r_terrace"
]) {
  s.auto_furnish(id, { style: "classic" });
}
// @end
// @section landscape [landscape]
// Lush Spanish courtyard garden: palms and flowering shrubs along the blind-arch wall, stone-paved driveway, and street context.
s.landscape.lawn({ x: 0.5, y: 0.5, w: 19.5, d: 19.0 });
s.landscape.paving({ x: 20.0, y: 0.0, w: 5.0, d: 20.0 }, { preset: "travertine", color: "#d5c7b2" });
s.landscape.paving({ x: 25.0, y: 0.0, w: 24.5, d: 20.0 }, { preset: "paving", color: "#9c9488" });

// Exterior front planter bed in front of the blind-arch boundary wall (match concept photo)
s.landscape.lawn({ x: 0.0, y: -6.0, w: 19.5, d: 5.5 });
s.landscape.planter({ x: 1.0, y: -2.2, w: 17.5, d: 1.8 }, { height_ft: 0.8, material: "travertine" });
s.landscape.tree([4.5, -1.2], { kind: "palm", height_ft: 11 });
s.landscape.tree([14.5, -1.2], { kind: "palm", height_ft: 11 });
s.landscape.tree([7.5, -1.3], { kind: "bush", height_ft: 3.5 });
s.landscape.tree([10.5, -1.3], { kind: "bush", height_ft: 3.8 });
s.landscape.tree([18.2, -1.3], { kind: "bush", height_ft: 3.5 });

// Inside lawn palms and ornamental trees
s.landscape.tree([5.0, 6.0], { kind: "palm", height_ft: 13 });
s.landscape.tree([14.5, 8.0], { kind: "ornamental", height_ft: 12 });
s.landscape.hedge([1.0, 18.5], [17.5, 18.5], { height_ft: 2.5 });

// Side and rear passage ashoka trees
for (const y of [28, 42, 56, 70]) {
  s.landscape.tree([48.2, y], { kind: "ashoka", height_ft: 16 });
}
s.landscape.street({ road_width_ft: 40, neighbours: true, streetlights: true });
// @end
// @section lighting [lighting]
// Bright afternoon sunlight in Lahore with warm interior glow.
s.lights.sun({ hour: 16.5, intensity: 1.15 });
s.lights.interior({ warmth: "warm", intensity: 1.0 });
// @end
