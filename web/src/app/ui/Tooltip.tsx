import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/app/lib/utils";
import { Kbd } from "./Kbd";

/**
 * A small label that appears on hover (after 450 ms) or keyboard focus. Never the only way to learn something:
 * the trigger must still carry an aria-label. Touch devices don't show tooltips.
 */
export function Tooltip({
  content,
  shortcut,
  side = "top",
  children,
  className,
  disabled,
}: {
  content: ReactNode;
  /** Keys, e.g. ["mod", "K"] or ["C"]. */
  shortcut?: string[];
  side?: "top" | "bottom";
  children: ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number; below: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const id = useId();

  const show = (delay: number) => {
    if (disabled) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), delay);
  };
  const hide = () => {
    clearTimeout(timer.current);
    setOpen(false);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => { if (disabled) hide(); }, [disabled]);

  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    // Measured once per opening. The tip is `w-max`, so its width doesn't depend on where it sits
    // (no measure → move → re-measure loop near the viewport's edge).
    const r = ref.current.getBoundingClientRect();
    const w = tip.current?.offsetWidth ?? 120;
    const h = tip.current?.offsetHeight ?? 28;
    const below = side === "bottom" || r.top - h - 8 < 4;
    const x = Math.min(window.innerWidth - 8 - w / 2, Math.max(8 + w / 2, r.left + r.width / 2));
    setPos({ x, y: below ? r.bottom + 8 : r.top - 8, below });
  }, [open, side]);

  return (
    <span
      ref={ref}
      className={cn("inline-flex", className)}
      aria-describedby={open ? id : undefined}
      onPointerEnter={(e) => e.pointerType !== "touch" && show(450)}
      onPointerLeave={hide}
      onPointerDown={hide}
      onFocus={(e) => (e.target as HTMLElement).matches?.(":focus-visible") && show(0)}
      onBlur={hide}
      onKeyDown={(e) => e.key === "Escape" && hide()}
    >
      {children}
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {open && (
              <motion.div
                ref={tip}
                id={id}
                role="tooltip"
                initial={{ opacity: 0, y: pos?.below ? -2 : 2 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, transition: { duration: 0.1 } }}
                transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                className="pointer-events-none fixed z-[90] flex w-max max-w-[260px] items-center gap-2 rounded-[8px] bg-ink/92 px-2.5 py-1.5 text-[12px] font-medium leading-4 text-white shadow-e2"
                style={{
                  left: pos?.x ?? -9999,
                  top: pos?.y ?? -9999,
                  translate: pos?.below ? "-50% 0" : "-50% -100%",
                  visibility: pos ? "visible" : "hidden",
                }}
              >
                <span>{content}</span>
                {shortcut && <Kbd keys={shortcut} tone="hud" />}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </span>
  );
}
