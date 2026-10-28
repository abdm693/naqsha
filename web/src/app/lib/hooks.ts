import { useEffect, useRef, useState, type RefObject } from "react";

/** Live result of a CSS media query. */
export function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return match;
}

/** Under 768px: the phone layout (DESIGN.md §6 "Mobile"). */
export const usePhone = () => useMediaQuery("(max-width: 767px)");

export const useReducedMotion = () => useMediaQuery("(prefers-reduced-motion: reduce)");

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

export function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.closest("[inert]") && el.getClientRects().length > 0);
}

/**
 * While `active`: move focus into `ref` (the first [data-autofocus] or the first focusable), keep Tab inside it,
 * and give focus back to whatever had it before when it ends.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean, returnFocus?: () => HTMLElement | null | undefined) {
  const returnRef = useRef(returnFocus);
  returnRef.current = returnFocus;
  useEffect(() => {
    if (!active) return;
    const before = document.activeElement as HTMLElement | null;
    const t = requestAnimationFrame(() => {
      const root = ref.current;
      if (!root || root.contains(document.activeElement)) return;
      const auto = root.querySelector<HTMLElement>("[data-autofocus]");
      (auto ?? focusables(root)[0] ?? root).focus({ preventScroll: true });
    });
    const onKey = (e: KeyboardEvent) => {
      const root = ref.current;
      if (e.key !== "Tab" || !root) return;
      const list = focusables(root);
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(t);
      document.removeEventListener("keydown", onKey);
      // Back to where the person was: the caller's choice (e.g. the card's More button), else the element that had
      // focus when this opened, if it still exists. A menu item that opened the dialog is gone by now.
      const target = returnRef.current?.() ?? (before && document.contains(before) ? before : null);
      if (target) window.setTimeout(() => target.focus({ preventScroll: true }), 0);
    };
  }, [active, ref]);
}

/**
 * Escape closes the most recent layer only: layers register in a stack, and Escape goes to the top one.
 * Dialogs, sheets, menus and popovers all use this so one press never closes two things.
 */
const escStack: { id: number; fn: () => void }[] = [];
let escSeq = 0;
let escBound = false;
function onEsc(e: KeyboardEvent) {
  if (e.key !== "Escape" || !escStack.length || e.defaultPrevented) return;
  const top = escStack[escStack.length - 1];
  e.preventDefault();
  e.stopPropagation();
  top.fn();
}

export function useEscape(active: boolean, fn: () => void) {
  const latest = useRef(fn);
  latest.current = fn;
  useEffect(() => {
    if (!active) return;
    if (!escBound) {
      window.addEventListener("keydown", onEsc, true);
      escBound = true;
    }
    const id = ++escSeq;
    escStack.push({ id, fn: () => latest.current() });
    return () => {
      const i = escStack.findIndex((x) => x.id === id);
      if (i >= 0) escStack.splice(i, 1);
    };
  }, [active]);
}

/** True when a text field (or a contenteditable) has focus: global shortcuts should stand down. */
export function isTyping(target: EventTarget | null = document.activeElement): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

/** Copy text; falls back to a hidden textarea when the async clipboard is unavailable. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
