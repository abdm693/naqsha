import { useRef, useState } from "react";
import { useStore } from "zustand";
import type { ViewerController } from "../core/controller";
import { DRAG_SENS } from "../walk/WalkController";

const R = 48; // joystick travel (px)

const capture = (el: Element, id: number) => {
  try {
    el.setPointerCapture(id);
  } catch {
    /* synthetic or already-released pointer */
  }
};

/**
 * Phone walking (DESIGN Mobile): a floating joystick under the left thumb, drag anywhere on the right to look, and one
 * round "pin a comment" button on the right edge. Finish, rooms and floors live in the app's dock.
 */
export function TouchControls({ ctrl }: { ctrl: ViewerController }) {
  const [joy, setJoy] = useState<{ x: number; y: number; kx: number; ky: number } | null>(null);
  const joyRef = useRef<{ id: number; x: number; y: number } | null>(null);
  const lookRef = useRef<{ id: number; x: number; y: number } | null>(null);
  const input = ctrl.walk.input;
  // after the one-time "Left thumb to move" hint, a faint ring keeps saying where the joystick lives
  const hints = useStore(ctrl.store, (s) => s.hints);
  const gliding = useStore(ctrl.store, (s) => s.gliding);

  const endJoy = () => {
    joyRef.current = null;
    input.joy.x = input.joy.y = 0;
    setJoy(null);
  };

  return (
    <>
      <div
        className="nq-touch-zone"
        data-nq-ui=""
        style={{ left: 0, width: "45%" }}
        onPointerDown={(e) => {
          if (joyRef.current) return;
          const r = e.currentTarget.getBoundingClientRect();
          joyRef.current = { id: e.pointerId, x: e.clientX - r.left, y: e.clientY - r.top };
          capture(e.currentTarget, e.pointerId);
          setJoy({ x: joyRef.current.x, y: joyRef.current.y, kx: 0, ky: 0 });
        }}
        onPointerMove={(e) => {
          const j = joyRef.current;
          if (!j || e.pointerId !== j.id) return;
          const r = e.currentTarget.getBoundingClientRect();
          let dx = e.clientX - r.left - j.x, dy = e.clientY - r.top - j.y;
          const len = Math.hypot(dx, dy);
          if (len > R) {
            dx = (dx / len) * R;
            dy = (dy / len) * R;
          }
          input.joy.x = dx / R;
          input.joy.y = -dy / R;
          setJoy({ x: j.x, y: j.y, kx: dx, ky: dy });
        }}
        onPointerUp={(e) => {
          if (joyRef.current && e.pointerId === joyRef.current.id) endJoy();
        }}
        onPointerCancel={endJoy}
      >
        {joy ? (
          <div className="nq-joy" style={{ left: joy.x, top: joy.y }}>
            <i style={{ transform: `translate(${joy.kx}px, ${joy.ky}px)` }} />
          </div>
        ) : (
          !hints && !gliding && (
            <div className="nq-joy nq-joy-rest" aria-hidden>
              <i />
            </div>
          )
        )}
      </div>
      <div
        className="nq-touch-zone"
        data-nq-ui=""
        style={{ right: 0, width: "55%" }}
        onPointerDown={(e) => {
          lookRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
          capture(e.currentTarget, e.pointerId);
          ctrl.walk.lookLag = 22;
        }}
        onPointerMove={(e) => {
          const l = lookRef.current;
          if (!l || e.pointerId !== l.id) return;
          input.look.dx += (e.clientX - l.x) * DRAG_SENS * 1.25;
          input.look.dy += (e.clientY - l.y) * DRAG_SENS * 1.25;
          l.x = e.clientX;
          l.y = e.clientY;
        }}
        onPointerUp={() => (lookRef.current = null)}
        onPointerCancel={() => (lookRef.current = null)}
      />
      <button className="nq-touch-pin nq-glass" data-nq-ui="" aria-label="Pin a comment here" onClick={() => ctrl.placeComment(0, 0, true)}>
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
          <path d="M9 2.5a5 5 0 0 1 5 5c0 3.6-5 8-5 8s-5-4.4-5-8a5 5 0 0 1 5-5z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M9 5.5v4M7 7.5h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
    </>
  );
}
