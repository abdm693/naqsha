import { useEffect, useId, useState, type CSSProperties, type ReactNode } from "react";
import { AnimatePresence, motion, useDragControls, type PanInfo } from "motion/react";
import { X } from "lucide-react";
import { cn } from "@/app/lib/utils";
import { useEscape, usePhone } from "@/app/lib/hooks";
import { ease } from "./motion";

/**
 * A floating side sheet (DESIGN.md §4). It floats --chrome (12px, 16px from 1024) in from the edge, radius 28, e3.
 * Surface over the canvas, glass-hud over 3D. 24px slide plus fade, 320ms ease-sheet. Escape closes it.
 * Non-modal: the canvas stays usable next to it.
 *
 * Under 768px it becomes a bottom sheet that rests at 40% or 92% of the screen: drag the handle (or tap it)
 * to switch, drag down from 40% to close.
 *
 * Its top edge is `var(--sheet-top)` (the project shell sets it below its floating top row).
 */
export function Sheet({
  open,
  onClose,
  side = "right",
  tone = "surface",
  width,
  title,
  headerActions,
  footer,
  children,
  label,
  className,
  bodyClassName,
  initialSnap = "half",
}: {
  open: boolean;
  onClose: () => void;
  side?: "left" | "right";
  tone?: "surface" | "hud";
  /** Desktop width in px. Defaults: 420 left (conversation), 380 right (comments). */
  width?: number;
  title?: ReactNode;
  /** Small controls in the header, left of the close button. */
  headerActions?: ReactNode;
  /** Pinned under the scrolling body (a composer). */
  footer?: ReactNode;
  children: ReactNode;
  label?: string;
  className?: string;
  bodyClassName?: string;
  /** Phone only: where the bottom sheet opens. */
  initialSnap?: "half" | "full";
}) {
  const phone = usePhone();
  const titleId = useId();
  const [snap, setSnap] = useState<"half" | "full">(initialSnap);
  const drag = useDragControls();
  useEscape(open, onClose);
  useEffect(() => { if (open) setSnap(initialSnap); }, [open, initialSnap]);

  const w = width ?? (side === "left" ? 420 : 380);
  const hud = tone === "hud";

  const onDragEnd = (_: unknown, info: PanInfo) => {
    const dy = info.offset.y;
    const vy = info.velocity.y;
    if (dy < -60 || vy < -500) setSnap("full");
    else if (dy > 90 || vy > 500) {
      if (snap === "full" && dy < 320) setSnap("half");
      else onClose();
    }
  };

  const header = (
    <div
      className={cn("flex shrink-0 items-center gap-2 px-5 pb-2 pt-4", phone && "cursor-grab touch-none pt-2 active:cursor-grabbing")}
      onPointerDown={phone ? (e) => drag.start(e) : undefined}
    >
      {phone && (
        <button
          type="button"
          aria-label={snap === "half" ? "Expand" : "Collapse"}
          onClick={() => setSnap((s) => (s === "half" ? "full" : "half"))}
          className="absolute left-1/2 top-1.5 -translate-x-1/2 px-4 py-1.5 outline-none"
        >
          <span className={cn("block h-1 w-9 rounded-full", hud ? "bg-white/25" : "bg-line-strong")} />
        </button>
      )}
      <div id={titleId} className={cn("min-w-0 flex-1 truncate text-[15px] font-semibold tracking-[-.01em]", phone && "mt-3", hud ? "text-hud-ink" : "text-ink")}>
        {title}
      </div>
      {headerActions && <div className={cn("flex items-center gap-1", phone && "mt-3")}>{headerActions}</div>}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-full outline-none transition-colors focus-visible:shadow-focus",
          phone && "mt-3",
          hud ? "text-hud-ink-2 hover:bg-white/10 hover:text-hud-ink" : "text-ink-3 hover:bg-surface-2 hover:text-ink",
        )}
      >
        <X className="size-4" strokeWidth={1.75} />
      </button>
    </div>
  );

  const body = (
    <>
      {header}
      <div className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5 scrollbar-thin", bodyClassName)}>{children}</div>
      {footer && <div className={cn("shrink-0 border-t px-4 py-3", hud ? "border-white/10" : "border-line", phone && "pb-[calc(12px+var(--safe-b))]")}>{footer}</div>}
    </>
  );

  const panelClass = cn(
    "flex flex-col overflow-hidden outline-none",
    hud ? "glass-hud" : "bg-surface shadow-e3",
    className,
  );

  return (
    <AnimatePresence>
      {open &&
        (phone ? (
          <motion.section
            key="sheet-phone"
            role="dialog"
            aria-labelledby={title ? titleId : undefined}
            aria-label={title ? undefined : label}
            drag="y"
            dragControls={drag}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0.08, bottom: 0.6 }}
            onDragEnd={onDragEnd}
            initial={{ y: "100%" }}
            animate={{ y: 0, height: snap === "full" ? "92dvh" : "40dvh", transition: { duration: 0.32, ease: ease.sheet } }}
            exit={{ y: "100%", transition: { duration: 0.22, ease: ease.exit } }}
            className={cn(panelClass, "fixed inset-x-0 bottom-0 z-[45] rounded-t-panel")}
          >
            {body}
          </motion.section>
        ) : (
          <motion.section
            key="sheet-desk"
            role="complementary"
            aria-labelledby={title ? titleId : undefined}
            aria-label={title ? undefined : label}
            initial={{ opacity: 0, x: side === "left" ? -24 : 24 }}
            animate={{ opacity: 1, x: 0, transition: { duration: 0.32, ease: ease.sheet } }}
            exit={{ opacity: 0, x: side === "left" ? -24 : 24, transition: { duration: 0.2, ease: ease.exit } }}
            style={{ width: w, [side]: "var(--chrome)", top: "var(--sheet-top, var(--chrome))", bottom: "var(--sheet-bottom, var(--chrome))" } as CSSProperties}
            className={cn(panelClass, "fixed z-[35] max-w-[calc(100vw-24px)] rounded-panel")}
          >
            {body}
          </motion.section>
        ))}
    </AnimatePresence>
  );
}
