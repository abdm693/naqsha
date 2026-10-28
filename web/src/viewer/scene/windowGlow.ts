/**
 * Night: every room glows warm through its outside windows (DESIGN "Day/Night"; the concepts' night renders), the
 * way a lit home reads from the street. The engine lights only its most important rooms and the glass is nearly
 * clear, so from outside most windows were dark holes.
 *
 * One warm card per outside window, glazed door and ventilator of an enclosed room, set just inside the glass (in
 * the reveal, in front of any curtain), lit from the top like a ceiling light. Cards face outward only (so from inside
 * a room you never see one over your own window), blend additively over whatever is behind them, never pick, never
 * collide, and fade with the night amount, so Day and Dusk are untouched.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { BuildingPlan, Opening, Room } from "@contracts/plan";
import { FT } from "../core/units";

const OUTDOOR = new Set(["porch", "balcony", "terrace", "lawn", "driveway", "courtyard", "open_space", "garage"]);
const GLAZED = new Set<Opening["type"]>(["window", "corner_window", "sliding_door", "ventilator"]);
/** How far inside the wall's centreline the card sits (ft): behind the glass, in front of the curtains. */
const INSET = 0.24;

export class WindowGlow {
  readonly group = new THREE.Group();
  private readonly mat = new THREE.MeshBasicMaterial({
    color: "#ffbe73",
    vertexColors: true,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.FrontSide,
    fog: false,
  });
  private plan: BuildingPlan | null = null;

  constructor() {
    this.group.name = "nq-window-glow";
    this.group.userData = { noPick: true, viewer: "window-glow" };
    this.group.visible = false;
    this.mat.name = "nq-window-glow";
  }

  /** (Re)build the cards for a plan; cheap, and a no-op for the plan it already shows. */
  build(plan: BuildingPlan) {
    if (this.plan === plan) return;
    this.plan = plan;
    this.clear();
    const byLevel = new Map<string, THREE.BufferGeometry[]>();
    for (const o of plan.openings ?? []) {
      if (!GLAZED.has(o.type)) continue;
      const card = cardFor(plan, o);
      if (!card) continue;
      (byLevel.get(o.level) ?? byLevel.set(o.level, []).get(o.level)!).push(card);
    }
    for (const [level, geos] of byLevel) {
      const merged = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, this.mat);
      // tagged like the walls they sit in, so floor focus, layers and the dollhouse hide them with their floor
      mesh.userData = { noPick: true, viewer: "window-glow", layer: "structure", level };
      mesh.renderOrder = 2;
      this.group.add(mesh);
    }
  }

  /** 0 day … 1 night. */
  setNight(n: number) {
    const k = Math.min(1, Math.max(0, n));
    this.mat.opacity = k;
    this.group.visible = k > 0.01 && this.group.children.length > 0;
  }

  /** Show only the cards whose floor (and layer) is on show. */
  syncVisibility(hidden: (o: THREE.Object3D) => boolean) {
    for (const c of this.group.children) c.visible = !hidden(c);
  }

  private clear() {
    for (const c of [...this.group.children]) {
      (c as THREE.Mesh).geometry?.dispose();
      this.group.remove(c);
    }
  }

  dispose() {
    this.clear();
    this.mat.dispose();
    this.group.removeFromParent();
  }
}

/** The card for one opening, in world space, or null when it doesn't look outside from an enclosed room. */
function cardFor(plan: BuildingPlan, o: Opening): THREE.BufferGeometry | null {
  const level = plan.levels.find((l) => l.id === o.level);
  if (!level) return null;
  const room = (id: string): Room | undefined => plan.rooms.find((r) => r.id === id && r.level === o.level);
  const outside = (id: string) => id === "exterior" || OUTDOOR.has(room(id)?.type ?? "");
  const [a, b] = o.between;
  const host = [a, b].map(room).find((r): r is Room => !!r && !OUTDOOR.has(r.type));
  const other = host?.id === a ? b : a;
  if (!host || !outside(other)) return null;
  // the host wall: the room edge nearest the opening; the card's normal points out of the room
  const r = host.rect, [ax, ay] = o.at;
  const sides: [number, number, number][] = [
    [Math.abs(ay - r.y), 0, -1],
    [Math.abs(ay - (r.y + r.d)), 0, 1],
    [Math.abs(ax - r.x), -1, 0],
    [Math.abs(ax - (r.x + r.w)), 1, 0],
  ];
  sides.sort((p, q) => p[0] - q[0]);
  const [, nx, ny] = sides[0];
  const door = o.type === "sliding_door";
  const sill = o.sill_ft ?? (door ? 0 : o.type === "ventilator" ? 6 : 3);
  const h = Math.max(0.6, (o.height_ft || (door ? 7 : 4.5)) - 0.35);
  const w = Math.max(0.6, (o.width_ft || 3) - 0.35);
  // plan → world: x = x_ft, z = −y_ft; the normal (nx, ny) in plan is (nx, 0, −ny) in the world
  const normal = new THREE.Vector3(nx, 0, -ny);
  const centre = new THREE.Vector3((ax - nx * INSET) * FT, (level.elevation_ft + sill + 0.175 + h / 2) * FT, -(ay - ny * INSET) * FT);
  const g = new THREE.PlaneGeometry(w * FT, h * FT, 1, 2);
  // a lit ceiling inside: brighter at the top of the window, warm all the way down
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getY(i) / (h * FT) + 0.5; // 0 bottom … 1 top
    const k = 0.5 + 0.5 * t;
    col[i * 3] = k;
    col[i * 3 + 1] = k * (0.9 + 0.1 * t);
    col[i * 3 + 2] = k * (0.8 + 0.2 * t);
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), normal, new THREE.Vector3(0, 1, 0)).setPosition(centre);
  // Matrix4.lookAt points −Z at the target; the plane's front face is +Z, so turn it to face outward
  m.multiply(new THREE.Matrix4().makeRotationY(Math.PI));
  g.applyMatrix4(m);
  return g;
}
