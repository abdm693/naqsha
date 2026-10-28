/**
 * HouseViewer: public interface (track: VIEWER). See contracts/web-modules.md.
 *
 * Orbit (camera-controls) and first-person walk (BVH capsule) views of a house built progressively by
 * engine.buildHouse, with level/layer toggles, a section cut, a Lahore sun path (into the night), comment pins,
 * a room navigator and capture. React renders the shell; everything per-frame lives in ViewerController.
 *
 * Mode: `mode` is the app's requested mode. The viewer can also leave walk mode by itself (Esc → exit, flyTo to an
 * aerial comment); it then calls `onExitWalk` — set your `mode` prop to "orbit" there. F ("finish") does NOT leave
 * walk mode by itself: the viewer frees the pointer and calls `onExitWalk("finish")`; the app confirms, then sets
 * `mode` to "orbit" (or does nothing to keep walking).
 *
 * Versions: pass a new `plan`/`sections` to the same HouseViewer (do not change its React `key`). The new house is
 * built off screen and crossfades in; the camera stays where it is (`preserveCamera`), and flipping back to a version
 * shown a moment ago is instant.
 *
 * HUD zones (DESIGN "House: explore and walk HUD"): the viewer draws only the crosshair, the walk prompts, the
 * minimap (top-right, 72 px down, under the app's people capsule), one-line toasts (top-centre, 72 px down) and the
 * touch joystick. Everything else (title, view switch, floor stack, Orbit/Walk, dock, room pill) is the app's.
 * While walking it marks itself `data-idle="1"` after 2.5 s without input, and the document root
 * `data-nq-walk-idle`, so the app's chrome recedes too (viewer.css: anything marked `data-nq-recede`, and the shell's
 * floating rows over the view). DESIGN: after 2.5 s idle only the crosshair and the room pill remain. The minimap
 * never recedes while the pointer is on it.
 */
import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from "react";
import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import { useStore } from "zustand";
import type { BuildingPlan } from "@contracts/plan";
import type { Layer } from "@contracts/house-sdk";
import type { AsBuiltSummary, Comment, CommentAnchor } from "@contracts/api-types";
import type { DesignSectionSrc, SectionResult } from "@/engine";
import { ViewerController } from "./core/controller";
import type { Quality } from "./core/store";
import { SceneRoot } from "./scene/SceneRoot";
import { OrbitRig } from "./scene/OrbitRig";
import { PostFX } from "./scene/PostFX";
import { PinAnchors, PinsOverlay } from "./comments/PinsLayer";
import { Hud } from "./hud/Hud";
import "./viewer.css";

export interface ViewerHandle {
  capture(opts?: { width?: number; height?: number }): Promise<string>;
  /**
   * Captures from fixed cameras worked out from the plan, for photos made from the model: "front" (across the road at
   * eye level), "corner" (three-quarter from the street, 15 ft up), "garden" (25 ft above the front garden, looking
   * at the entrance), "aerial" (70 ft or more, 45° down). Default: all four, 1280×720 JPEG data URLs. Leaves walk
   * mode, waits for the house to finish building, shows every floor and layer without the cut, by day, and puts the
   * camera back afterwards.
   */
  captureAngles(angles?: string[], opts?: { width?: number; height?: number }): Promise<{ angle: string; label: string; image: string }[]>;
  flyTo(comment: Comment): void;
  setMode(mode: "orbit" | "walk"): void;
  /** Walk: glide to the room through doors/stairs. Orbit: frame the room in a dollhouse cut. */
  goToRoom(roomId: string): void;
  /** Walk: move to that floor's stair landing facing into the floor. Orbit: show up to that floor ("all" = every floor). */
  setFloor(levelId: string): void;
  /** Back to the hero view (orbit). */
  resetView(): void;
  /**
   * The comment composer closed without saving (Esc, ×): drop the draft pin and, in walk, walk on at once. Saving
   * needs no call: the new comment arriving in `comments` shows "Note pinned" for ~2 s, then walking resumes.
   */
  cancelDraft(): void;
}

export interface HouseViewerProps {
  plan: BuildingPlan;
  sections: DesignSectionSrc[];
  mode: "orbit" | "walk";
  visibleLevels?: string[];
  layers?: Partial<Record<Layer, boolean>>;
  sectionCut?: number | null;
  /** Lahore sun, 6..19 by day; past sunset (~18:45) the light runs through dusk (19:00) into night (19:30 on). */
  sunHour?: number;
  comments?: Comment[];
  commentMode?: boolean;
  onAddComment?: (draft: { anchor: CommentAnchor; camera: Comment["camera"]; snapshot: string }) => void;
  onSelectComment?: (id: string) => void;
  onBuildProgress?: (r: SectionResult, done: number, total: number) => void;
  onReady?: (result: { summary: AsBuiltSummary; sections: SectionResult[] }) => void;
  /**
   * "exit": Esc / back to overview (the viewer is already in orbit). "flyTo": an aerial comment took it out of walk.
   * "finish": F was pressed — the viewer stays in walk mode with the pointer free; confirm, then set mode "orbit".
   */
  onExitWalk?: (reason?: "exit" | "flyTo" | "finish") => void;
  /** Make neighbours/context between the camera and the house translucent (default true). */
  ghostContext?: boolean;
  /**
   * Hide cars and motorbikes (default: hidden in walk, shown in orbit). Shown in walk they are solid like furniture
   * and thin out to 40% within 2 m; hidden they never block the way.
   */
  hideVehicles?: boolean;
  /** Night lighting: dark sky, interior and facade lights on. */
  night?: boolean;
  /** Walk: fires when the walker enters a different room (null outside rooms, and (null, null) on leaving walk). */
  onRoomChange?: (roomId: string | null, levelId: string | null) => void;
  /** Keep the camera when plan/sections change (version switch); default true. */
  preserveCamera?: boolean;
  /**
   * The viewer is on screen (default true). Pass false while keeping it mounted but hidden behind another view; the
   * viewer also notices an ancestor hidden with visibility: hidden or display: none by itself. While inactive it
   * renders only on demand (never every frame, even in walk mode), ignores the keyboard and its pins stay hidden.
   */
  active?: boolean;
}

/**
 * Device-pixel-ratio range per quality tier (R3F re-applies the `dpr` prop on every render, so the tier must drive
 * the prop). Measured walking the engine's argon-v1 house (230k tris, 12 point lights, PBR + transmission glass) at
 * 1440×900 CSS px on a laptop: DPR 1.6 + full AO ≈ 27 fps, DPR 1.25 + half AO ≈ 47, DPR 1 without AO ≈ 58.
 * The scene is fill-rate bound, so the tiers trade pixels first.
 */
const DPR: Record<Quality, [number, number]> = { high: [1, 1.5], balanced: [1, 1.1], performance: [0.85, 1] };

const GL_PROPS = {
  antialias: false,
  preserveDrawingBuffer: false,
  powerPreference: "high-performance" as const,
  toneMapping: THREE.AgXToneMapping,
  stencil: false,
};

export const HouseViewer = forwardRef<ViewerHandle, HouseViewerProps>(function HouseViewer(props, ref) {
  const [ctrl] = useState(() => new ViewerController(props));
  ctrl.setProps(props);
  useImperativeHandle(ref, () => ctrl.handle, [ctrl]);

  const mode = useStore(ctrl.store, (s) => s.mode);
  const walkPhase = useStore(ctrl.store, (s) => s.walk);
  const lockRefused = useStore(ctrl.store, (s) => s.lockRefused);
  const quality = useStore(ctrl.store, (s) => s.quality);
  const idle = useStore(ctrl.store, (s) => s.idle);
  const gliding = useStore(ctrl.store, (s) => s.gliding);
  const active = useStore(ctrl.store, (s) => s.active);

  useEffect(() => {
    ctrl.mount();
    return () => ctrl.unmount();
  }, [ctrl]);

  // rebuild when plan / sections change identity (content-identical inputs are skipped inside)
  useEffect(() => {
    ctrl.builds.request(props.plan, props.sections);
  }, [ctrl, props.plan, props.sections]);

  useEffect(() => {
    ctrl.setMode(props.mode, "props");
  }, [ctrl, props.mode]);

  const levelsKey = props.visibleLevels ? props.visibleLevels.join("|") : "*";
  const layersKey = useMemo(() => JSON.stringify(props.layers ?? {}), [props.layers]);
  useEffect(() => {
    ctrl.syncVisibility();
  }, [ctrl, levelsKey, layersKey, props.plan]);

  useEffect(() => {
    ctrl.syncSectionCut();
  }, [ctrl, props.sectionCut]);

  useEffect(() => {
    ctrl.syncSun();
  }, [ctrl, props.sunHour, props.night, props.plan]);

  useEffect(() => {
    ctrl.syncCommentMode();
  }, [ctrl, props.commentMode]);

  useEffect(() => {
    ctrl.onCommentsChanged();
  }, [ctrl, props.comments]);

  useEffect(() => {
    ctrl.syncContext();
  }, [ctrl, props.ghostContext, props.hideVehicles]);

  useEffect(() => {
    ctrl.syncActive();
  }, [ctrl, props.active]);

  return (
    <div
      ref={ctrl.setContainer}
      className="nq-viewer"
      data-mode={mode}
      data-walk={walkPhase}
      data-comment={props.commentMode ? "1" : "0"}
      data-drag={lockRefused ? "1" : "0"}
      data-idle={idle ? "1" : "0"}
      data-gliding={gliding ? "1" : "0"}
      data-active={active ? "1" : "0"}
    >
      <Canvas
        shadows="percentage"
        dpr={DPR[quality]}
        gl={GL_PROPS}
        camera={{ fov: 50, near: 0.08, far: 3000, position: [30, 22, 26] }}
        frameloop={mode === "walk" && active ? "always" : "demand"}
      >
        <SceneRoot ctrl={ctrl} />
        <OrbitRig ctrl={ctrl} />
        <PinAnchors ctrl={ctrl} comments={props.comments} />
        <PostFX ctrl={ctrl} />
      </Canvas>
      <PinsOverlay ctrl={ctrl} comments={props.comments} />
      <Hud ctrl={ctrl} plan={props.plan} commentMode={!!props.commentMode} />
    </div>
  );
});
