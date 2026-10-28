/** Motion constants shared by every component (DESIGN.md §2 and §7). */
import type { Transition } from "motion/react";

/** The one spring used everywhere. */
export const spring: Transition = { type: "spring", stiffness: 380, damping: 34 };

export const ease = {
  out: [0.22, 1, 0.36, 1] as [number, number, number, number],
  sheet: [0.32, 0.72, 0, 1] as [number, number, number, number],
  camera: [0.65, 0, 0.35, 1] as [number, number, number, number],
  exit: [0.4, 0, 1, 1] as [number, number, number, number],
};

/** Durations in seconds (the CSS variables --dur-* hold the same values in ms). */
export const dur = { press: 0.12, fast: 0.16, base: 0.24, panel: 0.32, slow: 0.6 };
