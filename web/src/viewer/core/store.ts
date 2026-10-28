/** Low-frequency viewer UI state (one store per HouseViewer). Per-frame values never go through here. */
import { createStore } from "zustand/vanilla";
import type { Vec3 } from "@contracts/api-types";

export type ViewerMode = "orbit" | "walk";
/**
 * off = orbit · intro = flying in · free = walking with the pointer free (drag to look) · look = pointer locked
 * (mouse look like a game) · commenting = a pin was just dropped, waiting for the note.
 */
export type WalkPhase = "off" | "intro" | "free" | "look" | "commenting";
export type Quality = "high" | "balanced" | "performance";

export interface BuildState {
  phase: "idle" | "building" | "ready" | "error";
  done: number;
  total: number;
  current?: string;
  error?: string;
  failed: number;
  mock: boolean;
  first: boolean; // nothing on screen yet
}

export interface Label { title: string; subtitle?: string }

export interface RouteDraw {
  id: number;
  /** plan-feet polylines per level id */
  byLevel: Record<string, [number, number][]>;
  /** room id the route leads to (highlighted on the minimap) */
  to?: string;
}

export interface ViewerState {
  mode: ViewerMode;
  walk: WalkPhase;
  build: BuildState;
  hover: Label | null;
  target: Label | null; // what the walk crosshair points at
  room: string | null; // name of the room you are in
  roomId: string | null;
  level: string | null; // level id under the walker
  quality: Quality;
  touch: boolean;
  draft: { position: Vec3; normal: Vec3 } | null;
  toast: { id: number; text: string } | null;
  /** pointer lock refused (embedded browsers): drag to look instead */
  lockRefused: boolean;
  /** the walker has looked around by dragging (the "drag to look" prompt is no longer needed) */
  dragged: boolean;
  /** the one-time "how to walk" coachmark is showing */
  hints: boolean;
  /** the centre "Click (or drag) to look around" prompt is showing (4 s, gone at the first look or step) */
  prompt: boolean;
  /** "Note pinned": a walk comment was just saved (about 2 s, then walking resumes) */
  pinned: boolean;
  /** the ? help card is open */
  help: boolean;
  /** no input for a while: the HUD steps back */
  idle: boolean;
  /** a room-navigator glide is under way */
  gliding: boolean;
  route: RouteDraw | null;
  /** orbit: show up to this floor (setFloor); null = all */
  orbitFloor: string | null;
  /** minimap preview of another floor (null = follow the walker) */
  mapLevel: string | null;
  /** the selected comment pin */
  selectedPin: string | null;
  /**
   * The viewer is on screen. False while the app keeps it mounted but hidden (`active={false}`, or an ancestor at
   * visibility: hidden / display: none): it then never renders every frame, takes no keys and lets the HUD rest.
   */
  active: boolean;
}

export type ViewerStore = ReturnType<typeof makeViewerStore>;

export function makeViewerStore(mode: ViewerMode, touch: boolean) {
  return createStore<ViewerState>()(() => ({
    mode,
    walk: "off",
    build: { phase: "idle", done: 0, total: 0, failed: 0, mock: false, first: true },
    hover: null,
    target: null,
    room: null,
    roomId: null,
    level: null,
    quality: "high",
    touch,
    draft: null,
    toast: null,
    lockRefused: typeof document === "undefined" || !("pointerLockElement" in document),
    dragged: false,
    hints: false,
    prompt: false,
    pinned: false,
    help: false,
    idle: false,
    gliding: false,
    route: null,
    orbitFloor: null,
    mapLevel: null,
    selectedPin: null,
    active: true,
  }));
}
