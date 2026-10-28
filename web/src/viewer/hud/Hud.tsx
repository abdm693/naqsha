/**
 * DOM overlays for HouseViewer. They subscribe to low-frequency store slices only; nothing here renders per frame.
 *
 * Zones (DESIGN "House: explore and walk HUD"), so nothing ever overlaps the app's floating chrome:
 * - centre: crosshair, the "Click to look around" prompt, the one-time coachmark, "comment pinned"
 * - top-centre slot (72 px down, under the app's view switch): build progress, comment mode, toasts
 * - top-right, 72 px down (under the app's people capsule): the 168 px minimap with its ? help
 * - phone: no minimap; the joystick and look pad fill the lower screen above the app's dock
 */
import { Fragment, useCallback, useEffect, useMemo, useRef } from "react";
import { useStore } from "zustand";
import type { BuildingPlan } from "@contracts/plan";
import type { ViewerController } from "../core/controller";
import { levelShorts } from "../core/floors";
import { sectionStage } from "../core/tags";
import { MiniMap } from "./MiniMap";
import { TouchControls } from "./TouchControls";

export function Hud({ ctrl, plan, commentMode }: { ctrl: ViewerController; plan: BuildingPlan; commentMode: boolean }) {
  const mode = useStore(ctrl.store, (s) => s.mode);
  return (
    <div className="nq-layer">
      <BuildOverlay ctrl={ctrl} />
      {mode === "orbit" ? <OrbitHud ctrl={ctrl} /> : <WalkHud ctrl={ctrl} plan={plan} commentMode={commentMode} />}
      <TopSlot ctrl={ctrl} commentMode={commentMode} />
    </div>
  );
}

function BuildOverlay({ ctrl }: { ctrl: ViewerController }) {
  const b = useStore(ctrl.store, (s) => s.build);
  if (b.phase === "error") {
    return (
      <div className="nq-error nq-glass" role="alert">
        <b>Couldn’t build the 3D model</b>
        {b.error}
      </div>
    );
  }
  const pct = b.total ? Math.round((b.done / b.total) * 100) : 0;
  // Nothing on screen yet: the card is up from the viewer's first frame ("idle" lasts until the build effect runs),
  // fully opaque (its entrance only moves it), so a House load never opens on an empty sky.
  const card = b.first && (b.phase === "building" || b.phase === "idle");
  return (
    <>
      {card && (
        <div className="nq-build-card nq-glass" role="status" aria-live="polite">
          <h3>Assembling your home</h3>
          <p>{b.done === 0 ? "Laying out the plan" : sectionStage(b.current, ctrl.plan)}</p>
          <div className="nq-bar">
            <i style={{ width: `${Math.max(4, pct)}%` }} />
          </div>
          <div className="nq-build-meta">
            <span>{b.total ? `${b.done} of ${b.total} layers` : b.done ? `${b.done} layers` : "Getting started"}</span>
            <span>{pct}%</span>
          </div>
        </div>
      )}
      {b.mock && b.phase !== "building" && <div className="nq-chip-mock nq-glass">Preview geometry · engine pending</div>}
    </>
  );
}

function OrbitHud({ ctrl }: { ctrl: ViewerController }) {
  const hover = useStore(ctrl.store, (s) => s.hover);
  const tipRef = useCallback((el: HTMLDivElement | null) => void (ctrl.tooltipEl = el), [ctrl]);
  return (
    <>
      <div ref={tipRef} className="nq-tip nq-glass" data-on={hover ? "1" : "0"} aria-hidden>
        {hover && (
          <>
            <b>{hover.title}</b>
            {hover.subtitle && <span>{hover.subtitle}</span>}
          </>
        )}
      </div>
    </>
  );
}

function WalkHud({ ctrl, plan, commentMode }: { ctrl: ViewerController; plan: BuildingPlan; commentMode: boolean }) {
  const phase = useStore(ctrl.store, (s) => s.walk);
  const target = useStore(ctrl.store, (s) => s.target);
  const touch = useStore(ctrl.store, (s) => s.touch);
  const gliding = useStore(ctrl.store, (s) => s.gliding);
  const pinned = useStore(ctrl.store, (s) => s.pinned);
  const walking = phase === "free" || phase === "look";
  return (
    <>
      {walking && (
        <div className="nq-cross" data-look={phase === "look" ? "1" : "0"} data-target={target ? "1" : "0"} data-comment={commentMode ? "1" : "0"} aria-hidden>
          <b />
          <i />
        </div>
      )}
      {phase === "look" && target && !gliding && <div className="nq-target">{target.title}</div>}
      {/* from the moment you enter Walk (it fades in with the fly-in), then it recedes with the rest of the HUD */}
      {!touch && (walking || phase === "intro") && <MiniMap ctrl={ctrl} plan={plan} />}
      <Prompt ctrl={ctrl} plan={plan} />
      {/* only once the note is saved (the composer is open while commenting) */}
      {pinned && (
        <div className="nq-centre-chip nq-glass" data-pinned="1" role="status">
          <span className="nq-dot" />
          <span>Note pinned</span>
        </div>
      )}
      {touch && walking && <TouchControls ctrl={ctrl} />}
    </>
  );
}

/** The centre prompt: how to take the mouse, the one-time coachmark, and the ? help card. */
function Prompt({ ctrl, plan }: { ctrl: ViewerController; plan: BuildingPlan }) {
  const phase = useStore(ctrl.store, (s) => s.walk);
  const touch = useStore(ctrl.store, (s) => s.touch);
  const refused = useStore(ctrl.store, (s) => s.lockRefused);
  const prompt = useStore(ctrl.store, (s) => s.prompt);
  const hints = useStore(ctrl.store, (s) => s.hints);
  const help = useStore(ctrl.store, (s) => s.help);
  const gliding = useStore(ctrl.store, (s) => s.gliding);
  // the floor keys, by the floor stack's own labels (G, 1, R…)
  const floorKeys = useMemo(() => levelShorts(plan.levels).filter((k, i, all) => all.indexOf(k) === i), [plan]);
  // "Click to look around" (or "Drag…" when the pointer can't be locked) for 4 s after you start walking or let go of
  // the mouse; gone at the first look, step or glide. It is the only place that says how to look (no toast as well).
  const showPrompt = prompt && phase === "free" && !gliding && !touch;
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (help) close.current?.focus();
  }, [help]);
  return (
    <>
      {(showPrompt || (hints && phase !== "commenting" && phase !== "intro")) && !help && (
        <div className="nq-prompt" data-hints={hints ? "1" : "0"}>
          {showPrompt && (
            <button className="nq-prompt-main nq-glass nq-ui" data-nq-ui="" onClick={() => ctrl.requestLock()} disabled={refused}>
              <MouseIcon />
              <span>{refused ? "Drag to look around" : "Click to look around"}</span>
            </button>
          )}
          {hints && (
            <div className="nq-coach nq-glass" role="note">
              {touch ? (
                <span>Left thumb to move · right thumb to look</span>
              ) : (
                <>
                  <span>
                    <Kbd>W</Kbd>
                    <Kbd>A</Kbd>
                    <Kbd>S</Kbd>
                    <Kbd>D</Kbd> to move
                  </span>
                  <span>
                    <Kbd>Esc</Kbd> to stop
                  </span>
                  <span>
                    <Kbd>?</Kbd> for more
                  </span>
                </>
              )}
            </div>
          )}
        </div>
      )}
      {help && !touch && (
        <div className="nq-help nq-glass nq-ui" data-nq-ui="" role="dialog" aria-label="Walking controls">
          <div className="nq-help-head">
            <b>Walking controls</b>
            <button ref={close} className="nq-icon" onClick={() => ctrl.setHelp(false)} aria-label="Close">
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
                <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <dl>
            <dt>Move</dt>
            <dd>
              <Kbd>W</Kbd>
              <Kbd>A</Kbd>
              <Kbd>S</Kbd>
              <Kbd>D</Kbd>
            </dd>
            <dt>Look</dt>
            <dd>{refused ? "Drag the mouse" : "Mouse (click first)"}</dd>
            <dt>Run</dt>
            <dd>
              <Kbd>Shift</Kbd>
            </dd>
            <dt>Rooms</dt>
            <dd>
              <Kbd>M</Kbd> or the map
            </dd>
            {plan.levels.length > 1 && (
              <>
                <dt>Floors</dt>
                <dd>
                  {floorKeys.map((k, i) => (
                    <Fragment key={k}>
                      {i > 0 && ", "}
                      <Kbd>{k}</Kbd>
                    </Fragment>
                  ))}{" "}
                  or <Kbd>[</Kbd>
                  <Kbd>]</Kbd>
                </dd>
              </>
            )}
            <dt>Comment</dt>
            <dd>
              <Kbd>C</Kbd>
            </dd>
            <dt>Finish</dt>
            <dd>
              <Kbd>F</Kbd>
            </dd>
            <dt>Leave</dt>
            <dd>
              <Kbd>Esc</Kbd>
            </dd>
          </dl>
        </div>
      )}
    </>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="nq-kbd">{children}</kbd>;
}

function MouseIcon() {
  return (
    <svg width="14" height="18" viewBox="0 0 14 18" aria-hidden>
      <rect x="1" y="1" width="12" height="16" rx="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7 4v3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** The top-centre slot, under the app's view switch: build progress, comment mode, one-line toasts. */
function TopSlot({ ctrl, commentMode }: { ctrl: ViewerController; commentMode: boolean }) {
  const t = useStore(ctrl.store, (s) => s.toast);
  const mode = useStore(ctrl.store, (s) => s.mode);
  const updating = useStore(ctrl.store, (s) => s.build.phase === "building" && !s.build.first);
  const done = useStore(ctrl.store, (s) => s.build.done);
  const total = useStore(ctrl.store, (s) => s.build.total);
  if (!t && !updating && !(commentMode && mode === "orbit")) return null;
  return (
    <div className="nq-slot">
      {updating && (
        <div className="nq-pill nq-glass" role="status">
          <span className="nq-breathe" />
          Updating your home <span className="nq-mono">{done}/{total || "…"}</span>
        </div>
      )}
      {commentMode && mode === "orbit" && !updating && (
        <div className="nq-pill nq-glass">
          <span className="nq-dot" />
          Click anything to pin a note
        </div>
      )}
      {t && (
        <div key={t.id} className="nq-toast" role="status">
          {t.text}
        </div>
      )}
    </div>
  );
}
