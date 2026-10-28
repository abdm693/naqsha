# Web module boundaries

Three tracks are built in parallel in `web/src`. Each one owns a directory and talks to the others **only** through the interfaces below. The interface files are already stubbed in the scaffold; implement them without changing their exported signatures. If a signature must change, note it in your final report.

## engine/: House SDK + builders (track: ENGINE)

`web/src/engine/index.ts`

```ts
export interface DesignSectionSrc { name: string; layer: Layer; body: string }

/** Parse design.js text ("// @section name [layer] … // @end"). Lenient: ignores junk outside sections. */
export function parseDesign(code: string): DesignSectionSrc[];
/** Serialize back (used for display/download). */
export function serializeDesign(sections: DesignSectionSrc[]): string;
/** Fallback design when Argon code is missing: structure + auto_furnish every room + landscape + lights. */
export function defaultDesign(plan: BuildingPlan): DesignSectionSrc[];
/** Static safety screen; returns the reasons a section is rejected (empty = OK). */
export function screenSection(body: string): string[];

export interface SectionResult { name: string; layer: Layer; ok: boolean; error?: string; ms: number; objects: number }
export interface BuildResult {
  root: THREE.Group;            // add to scene; meters, +Y up
  summary: AsBuiltSummary;      // see contracts/api.md
  sections: SectionResult[];
  levels: { id: string; name: string; floor_y: number; top_y: number }[];   // meters, for level toggles/section cut
  colliders: THREE.Mesh[];      // static meshes for walkthrough collision (walls, slabs, stairs ramps, big furniture, boundary)
  spawn: { position: THREE.Vector3; lookAt: THREE.Vector3 };  // walkthrough start: on the gate-to-door walkway, ~7 ft before the main door, door in view
  landings?: { level: string; position: THREE.Vector3; lookAt: THREE.Vector3 }[]; // (additive) per floor: stair landing at eye height, looking into the floor
  dispose(): void;
}
/** Build the house. Runs sections in order and calls onSection after each (the viewer re-renders = "layers assembling"). */
export function buildHouse(plan: BuildingPlan, sections: DesignSectionSrc[], opts?: {
  onSection?: (r: SectionResult, root: THREE.Group) => void | Promise<void>;
  quality?: "high" | "medium";
}): Promise<BuildResult>;
```

World mapping (all tracks): `x_m = x_ft·0.3048`, **`z_m = −y_ft·0.3048`**, `Y_m = h_ft·0.3048`. The road is at +z. The engine also accepts sections shaped as `{name, layer, code}` (API `DesignSection`), treating `code` as an alias for `body`.

Every created `Object3D` carries
`userData = { layer, level, room, kind, id, label }`. The viewer relies on this for layer and level toggles, for hover labels, and for comment anchors.

Kinds the viewer acts on (engine overhaul, additive):
- `kind: "vehicle"`: cars and motorbikes (layer furniture). They never merge with other meshes (`userData.mergeGroup = "vehicle"`), and their walk colliders are separate meshes in `colliders` with `userData.kind === "vehicle"`, so `hideVehicles` can drop both.
- `kind: "context"`: road, footpaths, kerbs, streetlights, utility poles and wires, street trees and neighbouring houses (layer landscape, `mergeGroup = "context"`), for `ghostContext`.
- Stairwell guards are tagged with the floor they stand on (`kind: "railing:stair"`), flights with the floor they start from.
- `BuildResult.summary.checks` lists what the engine repaired or could not repair (`contracts/api-types.ts` `AsBuiltSummary.checks`).

## viewer/: scene host, modes, walkthrough, comments (track: VIEWER)

`web/src/viewer/HouseViewer.tsx`

```tsx
export interface ViewerHandle {
  capture(opts?: { width?: number; height?: number }): Promise<string>;  // PNG data URL of the current view (for AI render + comment snapshots)
  flyTo(comment: Comment): void;
  setMode(mode: "orbit" | "walk"): void;
  /** Walk: glide from the current position to the room (through doors and stairs). Orbit: frame the room in a dollhouse cut. */
  goToRoom(roomId: string): void;
  /** Walk: move to that floor's stair landing, facing into the floor. Orbit: show up to that floor. */
  setFloor(levelId: string): void;
  /** Back to the hero view (orbit). */
  resetView(): void;
}
export interface HouseViewerProps {
  plan: BuildingPlan;
  sections: DesignSectionSrc[];                 // from engine.parseDesign(version code) or Version.sections
  mode: "orbit" | "walk";
  visibleLevels?: string[];                     // default: all
  layers?: Partial<Record<Layer, boolean>>;     // default: all on
  sectionCut?: number | null;                   // meters; clip everything above
  sunHour?: number;                             // 6..19
  comments?: Comment[];
  commentMode?: boolean;                        // when on, a click (orbit) or C/click (walk) places a pin
  onAddComment?: (draft: { anchor: CommentAnchor; camera: Comment["camera"]; snapshot: string }) => void;
  onSelectComment?: (id: string) => void;
  onBuildProgress?: (r: SectionResult, done: number, total: number) => void;
  onReady?: (result: { summary: AsBuiltSummary; sections: SectionResult[] }) => void;
  onExitWalk?: (reason?: "exit" | "flyTo" | "finish") => void;
  /** Make neighbours and context objects that sit between the camera and the house translucent (default true). */
  ghostContext?: boolean;
  /** Hide cars and motorbikes (default: hidden in walk mode, shown in orbit). */
  hideVehicles?: boolean;
  /** Night lighting: sky dark, interior and facade lights on. */
  night?: boolean;
  /** Walk: fires when the walker enters a different room (for the room navigator). */
  onRoomChange?: (roomId: string | null, levelId: string | null) => void;
  /** Keep the camera when plan/sections change (version switch); default true. */
  preserveCamera?: boolean;
}
export const HouseViewer: React.ForwardRefExoticComponent<HouseViewerProps & React.RefAttributes<ViewerHandle>>;
```

## app/: everything else in the UI (track: APP)

Pages:
- `/`: workspace
- `/p/:id`: project, with steps Setup → Concepts → Design → Explore and Walk → Revisions

The app also owns `web/src/api/` (`client.ts` and `sse.ts`). It uses `HouseViewer` and the engine types only through the exports above.

During development the app can use **mock mode** (`VITE_MOCK=1`). In mock mode the API layer returns fixtures from `contracts/fixtures/` and simulates SSE streams with timers, so the UI is fully clickable before the backend exists.
