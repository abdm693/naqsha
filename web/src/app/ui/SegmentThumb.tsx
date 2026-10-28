import { useLayoutEffect, useRef, useState } from "react";
import { animate, motion, useMotionValue, useReducedMotion, type Transition } from "motion/react";
import { cn } from "@/app/lib/utils";

/**
 * The moving thumb of a segmented control (Segmented, the floor stack): render it as a direct child of the control.
 * One per control, placed in the control's own coordinates under its `index`-th `[role=radio]` child, so it only ever
 * springs between that control's options: it never flies in from another control, even when the control remounts or
 * moves. It sits at z-0 and the options' labels at z-10 (the control is `isolate`), so a label is never painted over
 * mid-slide. Changing `index` springs it; a resize (a label that changes, a font that loads) just places it.
 */
export function SegmentThumb({ index, transition, className }: { index: number; transition: Transition; className?: string }) {
  const self = useRef<HTMLSpanElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const width = useMotionValue(0);
  const height = useMotionValue(0);
  const target = useRef<string | null>(null);
  const [shown, setShown] = useState(false);
  const reduce = useReducedMotion();

  useLayoutEffect(() => {
    // The control is this thumb's parent (the control's own ref isn't attached yet when a child's effect runs).
    const track = self.current?.parentElement;
    if (!track || index < 0) {
      target.current = null;
      setShown(false);
      return;
    }
    const place = (slide: boolean) => {
      const opt = track.querySelectorAll<HTMLElement>(":scope > [role=radio]")[index];
      if (!opt) return;
      const to = [opt.offsetLeft, opt.offsetTop, opt.offsetWidth, opt.offsetHeight];
      const key = to.join(",");
      if (key === target.current) return;
      const spring = slide && target.current !== null && !reduce;
      target.current = key;
      [x, y, width, height].forEach((v, i) => {
        if (spring) void animate(v, to[i], transition);
        else v.jump(to[i]);
      });
      setShown(true);
    };
    place(true);
    const ro = new ResizeObserver(() => place(false));
    ro.observe(track);
    for (const c of track.children) if (c !== self.current) ro.observe(c);
    return () => ro.disconnect();
  }, [index, reduce, transition, x, y, width, height]);

  return (
    <motion.span
      ref={self}
      aria-hidden
      style={{ x, y, width, height, visibility: shown ? undefined : "hidden" }}
      className={cn("pointer-events-none absolute left-0 top-0 z-0 rounded-full", className)}
    />
  );
}
