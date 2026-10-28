/**
 * Flows kit (track: APP-FLOWS). The few primitives the Brief, Concepts, Plan, House and Revisions views share,
 * drawn straight from docs/design/DESIGN.md §4 with its tokens. They mirror the API the shell's `ui/*` primitives
 * are specified with (Button primary/secondary/quiet/ink/hud, sm/md/lg; Chip; Segmented; Dialog; Popover; Kbd),
 * so swapping these imports for `@/app/ui/*` at integration is mechanical.
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { cn } from "@/app/lib/utils";
import { useEscape as useShellEscape } from "@/app/lib/hooks";
import { toast } from "@/app/store/toast";
import { SegmentThumb } from "@/app/ui/SegmentThumb";

export const SPRING = { type: "spring" as const, stiffness: 380, damping: 34 };
export const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];
export const EASE_SHEET: [number, number, number, number] = [0.32, 0.72, 0, 1];

// ── Button ──────────────────────────────────────────────────────────────────────────────────────────

export type ButtonVariant = "primary" | "secondary" | "quiet" | "ink" | "hud";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-accent text-white hover:bg-accent-press disabled:bg-accent/45",
  secondary: "bg-surface text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)] hover:bg-surface-2",
  quiet: "bg-transparent text-ink-2 hover:bg-surface-2 hover:text-ink",
  ink: "bg-ink text-white hover:bg-ink-2",
  hud: "glass-hud text-hud-ink hover:bg-[rgb(40_40_44/0.72)]",
};
const SIZE: Record<ButtonSize, string> = {
  sm: "h-8 gap-1.5 px-3.5 text-[13px]",
  md: "h-10 gap-2 px-[18px] text-[15px]",
  lg: "h-12 gap-2 px-[22px] text-[16px]",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
  iconRight?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading, icon, iconRight, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "hit-44 relative inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-full font-medium outline-none",
        "transition-[background-color,color,box-shadow,transform,opacity] duration-(--dur-fast) ease-out active:scale-[0.97]",
        "focus-visible:shadow-focus disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100",
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...rest}
    >
      {loading ? <BreathingDot className={variant === "primary" || variant === "ink" ? "bg-white" : "bg-accent"} /> : icon}
      {children}
      {iconRight}
    </button>
  );
});

export function IconButton({
  label,
  variant = "quiet",
  size = 36,
  className,
  children,
  pressed,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; variant?: ButtonVariant; size?: 28 | 32 | 36 | 40 | 44; pressed?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      className={cn(
        "hit-44 relative inline-grid shrink-0 place-items-center rounded-full outline-none transition-[background-color,color,transform] duration-(--dur-fast) active:scale-95 focus-visible:shadow-focus disabled:opacity-40",
        VARIANT[variant],
        className,
      )}
      style={{ width: size, height: size }}
      {...rest}
    >
      {children}
    </button>
  );
}

/** The loading mark: a breathing 6px dot (DESIGN §4 Button). */
export function BreathingDot({ className, style }: { className?: string; style?: CSSProperties }) {
  return <span aria-hidden className={cn("inline-block size-1.5 shrink-0 animate-breathe rounded-full bg-accent", className)} style={style} />;
}

/** Status: a 6px dot plus text. */
export function StatusDot({ tone, className }: { tone: "pass" | "warn" | "fail" | "accent" | "muted"; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-1.5 shrink-0 rounded-full",
        tone === "pass" && "bg-pass",
        tone === "warn" && "bg-warn",
        tone === "fail" && "bg-fail",
        tone === "accent" && "bg-accent",
        tone === "muted" && "bg-ink-4",
        className,
      )}
    />
  );
}

// ── Chip ────────────────────────────────────────────────────────────────────────────────────────────

export function Chip({
  selected,
  children,
  className,
  tone = "default",
  size = "md",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean; tone?: "default" | "suggestion" | "hud"; size?: "sm" | "md" }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        "hit-44 relative inline-flex shrink-0 select-none items-center gap-1.5 rounded-chip font-medium outline-none transition-[background-color,box-shadow,color,transform] duration-(--dur-fast) ease-out active:scale-[0.97] focus-visible:shadow-focus disabled:opacity-45",
        size === "md" ? "min-h-8 px-3 py-1 text-[13px]" : "min-h-7 px-2.5 py-0.5 text-[12px]",
        "max-w-full text-left leading-snug",
        tone === "hud"
          ? selected
            ? "bg-white text-ink"
            : "bg-white/10 text-hud-ink hover:bg-white/16"
          : selected
            ? "bg-accent-soft text-accent shadow-[inset_0_0_0_1px_var(--color-accent-line)]"
            : tone === "suggestion"
              ? "bg-surface text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)] hover:bg-surface-2"
              : "bg-surface-2 text-ink hover:bg-surface-3",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

// ── Segmented ───────────────────────────────────────────────────────────────────────────────────────

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  tone = "light",
  size = "md",
  label,
  className,
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string; disabled?: boolean; /** Accessible name when the label is short ("3" → "3 storeys"). */ aria?: string }[];
  onChange: (v: T) => void;
  tone?: "light" | "hud";
  /** lg: 44px, the phone HUD's touch size. */
  size?: "sm" | "md" | "lg";
  label: string;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        "relative isolate inline-flex shrink-0 items-center rounded-full p-[3px]",
        size === "lg" ? "h-11" : size === "md" ? "h-9" : "h-8",
        tone === "light" ? "bg-surface-2" : "glass-hud",
        className,
      )}
    >
      {/* The thumb slides under the labels, inside this control only (SegmentThumb). */}
      <SegmentThumb index={options.findIndex((o) => o.value === value)} transition={SPRING} className={tone === "light" ? "bg-surface shadow-e1" : "bg-white"} />
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={o.aria}
            title={o.title}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              "hit-44 relative inline-flex h-full items-center rounded-full font-medium outline-none transition-colors duration-(--dur-fast) focus-visible:shadow-focus disabled:opacity-40",
              // lg is the phone HUD's icon-only size: a little narrower so the one-row HUD fits a 320px phone.
              size === "sm" ? "px-3 text-[12px]" : size === "lg" ? "px-3 text-[13px]" : "px-3.5 text-[13px]",
              tone === "light" ? (active ? "text-ink" : "text-ink-3 hover:text-ink") : active ? "text-ink" : "text-hud-ink-2 hover:text-hud-ink",
            )}
          >
            <span className="relative z-10 inline-flex items-center gap-1.5">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── Kbd ─────────────────────────────────────────────────────────────────────────────────────────────

export function Kbd({ children, className, tone = "light" }: { children: ReactNode; className?: string; tone?: "light" | "hud" }) {
  return (
    <kbd
      className={cn(
        "inline-grid h-5 min-w-5 place-items-center rounded-[6px] px-1 font-mono text-[12px] font-medium",
        tone === "light" ? "bg-surface-2 text-ink-3 shadow-[inset_0_-1px_0_var(--color-line-strong)]" : "bg-white/12 text-hud-ink-2",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

// ── Meter ───────────────────────────────────────────────────────────────────────────────────────────

/** A thin meter (2px by default; DESIGN uses 2px for compliance and 4px for the floor-program meter). */
export function Meter({ value, max, height = 2, tone, className }: { value: number; max: number; height?: number; tone?: "pass" | "warn" | "fail" | "accent" | "ink"; className?: string }) {
  const ratio = max > 0 ? value / max : 0;
  const t = tone ?? (ratio > 1 ? "fail" : ratio > 0.9 ? "warn" : "ink");
  return (
    <div className={cn("w-full overflow-hidden rounded-full bg-surface-2", className)} style={{ height }}>
      <motion.div
        initial={false}
        animate={{ width: `${Math.max(0, Math.min(100, ratio * 100))}%` }}
        transition={SPRING}
        className={cn(
          "h-full rounded-full",
          t === "pass" && "bg-pass",
          t === "warn" && "bg-warn",
          t === "fail" && "bg-fail",
          t === "accent" && "bg-accent",
          t === "ink" && "bg-ink",
        )}
      />
    </div>
  );
}

// ── Skeleton ────────────────────────────────────────────────────────────────────────────────────────

export function Shimmer({ className, dark }: { className?: string; dark?: boolean }) {
  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}>
      <div className={cn("absolute inset-y-0 -left-full w-full animate-shimmer bg-gradient-to-r from-transparent to-transparent", dark ? "via-white/10" : "via-white/60")} />
    </div>
  );
}

// ── Overlay plumbing ────────────────────────────────────────────────────────────────────────────────

/** Escape closes the top-most layer only (the shell's layer stack; it preventDefaults, so the viewer keeps walking). */
function useEscape(open: boolean, onClose: () => void) {
  useShellEscape(open, onClose);
}

export function useMediaQuery(q: string): boolean {
  const [m, setM] = useState(() => (typeof window !== "undefined" ? window.matchMedia(q).matches : false));
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [q]);
  return m;
}

// ── Dialog ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * 480px dialog (DESIGN §4): title, one line, buttons right-aligned with the primary last.
 * Below 640px it becomes a bottom sheet.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  actions,
  width = 480,
  tone = "light",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  width?: number;
  tone?: "light" | "hud";
}) {
  useEscape(open, onClose);
  const phone = useMediaQuery("(max-width: 639px)");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => {
      const el = ref.current?.querySelector<HTMLElement>("[data-autofocus], button.bg-accent, button, input, textarea");
      el?.focus();
    }, 30);
    return () => {
      clearTimeout(t);
      prev?.focus?.();
    };
  }, [open]);
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          // Top-anchored on wider screens, so a taller body (another floor's tab, a field error) never moves it.
          className="fixed inset-0 z-[80] flex items-end justify-center sm:items-start sm:p-6 sm:pt-[min(12vh,96px)]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.2, ease: [0.4, 0, 1, 1] } }}
          transition={{ duration: 0.24 }}
        >
          <div className="absolute inset-0 bg-(--scrim) backdrop-blur-[8px]" onClick={onClose} />
          <motion.div
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-label={typeof title === "string" ? title : undefined}
            initial={phone ? { y: "100%" } : { opacity: 0, scale: 0.96 }}
            animate={phone ? { y: 0 } : { opacity: 1, scale: 1 }}
            exit={phone ? { y: "100%", transition: { duration: 0.24, ease: [0.4, 0, 1, 1] } } : { opacity: 0, scale: 0.98, transition: { duration: 0.2, ease: [0.4, 0, 1, 1] } }}
            transition={{ duration: 0.32, ease: EASE_SHEET }}
            className={cn(
              "relative w-full overflow-hidden shadow-e3",
              phone ? "max-h-[92dvh] rounded-t-panel pb-[env(safe-area-inset-bottom)]" : "max-h-[calc(100dvh-min(12vh,96px)-24px)] rounded-panel",
              tone === "light" ? "bg-surface text-ink" : "glass-hud",
            )}
            style={{ maxWidth: phone ? undefined : width, transformOrigin: phone ? undefined : "50% 0" }}
          >
            <div className="max-h-[inherit] overflow-y-auto px-6 pb-6 pt-6 [scrollbar-width:thin]">
              {phone && <span aria-hidden className="mx-auto -mt-2 mb-4 block h-1 w-9 rounded-full bg-line-strong" />}
              <div className="flex items-start justify-between gap-4">
                <h2 className="text-heading">{title}</h2>
                <IconButton label="Close" size={32} onClick={onClose} className="-mr-2 -mt-1 text-ink-3">
                  <X className="size-4" strokeWidth={1.75} />
                </IconButton>
              </div>
              {description && <div className={cn("mt-1.5 text-body", tone === "light" ? "text-ink-2" : "text-hud-ink-2")}>{description}</div>}
              {children && <div className="mt-5">{children}</div>}
              {/* The actions stay in view (a long dialog scrolls under them): Save is never below the fold. */}
              {actions && (
                <div className={cn("mt-6 flex flex-wrap items-center justify-end gap-2", tone === "light" && "sticky -bottom-6 z-10 -mx-6 -mb-6 mt-2 bg-surface px-6 pb-6 pt-4")}>
                  {actions}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

// ── Popover ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * A small anchored panel. Closes on outside click and Esc. `side` is where it opens relative to the anchor; it flips
 * only when the other side has more room, and is always clamped inside the viewport (8px margin) with its own scroll.
 * `sheetBelow` (px): narrower screens get a bottom sheet instead.
 */
export function Popover({
  open,
  onClose,
  anchor,
  children,
  side = "top",
  align = "start",
  tone = "light",
  className,
  offset = 8,
  sheetBelow,
  sheetFull,
  avoid,
  label,
}: {
  open: boolean;
  onClose: () => void;
  anchor: RefObject<HTMLElement | null>;
  children: ReactNode;
  side?: "top" | "bottom";
  align?: "start" | "end" | "center";
  tone?: "light" | "hud";
  className?: string;
  offset?: number;
  sheetBelow?: number;
  /** As a sheet, take the full height under the top row (the phone room list). */
  sheetFull?: boolean;
  /** Elements the panel must not cover (e.g. the minimap); it shifts left or caps its height to stay clear. */
  avoid?: () => (Element | null | undefined)[];
  label?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPosState] = useState<CSSProperties>({ visibility: "hidden" });
  const posKey = useRef("");
  // Only re-render when the placement actually changes (it is re-checked while open).
  const setPos = useCallback((p: CSSProperties) => {
    const k = JSON.stringify(p);
    if (k === posKey.current) return;
    posKey.current = k;
    setPosState(p);
  }, []);
  const [asSheet, setAsSheet] = useState(false);
  // Read through a ref: callers pass a fresh arrow each render, and re-placing on every render would make it jump.
  const avoidRef = useRef(avoid);
  avoidRef.current = avoid;
  useEscape(open, onClose);

  const place = useCallback(() => {
    const sheet = !!sheetBelow && window.innerWidth < sheetBelow;
    setAsSheet(sheet);
    if (sheet) {
      setPos(
        sheetFull
          ? { left: 8, right: 8, top: "calc(var(--chrome-top, 72px) + 4px)", bottom: "calc(8px + env(safe-area-inset-bottom, 0px))", visibility: "visible" }
          : { left: 8, right: 8, bottom: "calc(8px + env(safe-area-inset-bottom, 0px))", maxHeight: "min(70dvh, calc(100dvh - 16px))", visibility: "visible" },
      );
      return;
    }
    const a = anchor.current?.getBoundingClientRect();
    const p = panel.current;
    if (!a || !p) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = p.offsetWidth;
    // Natural height (uncapped) decides the side; the cap then keeps it on screen with internal scroll.
    const natural = p.scrollHeight;
    const above = a.top - offset - 8;
    const below = vh - a.bottom - offset - 8;
    let dir = side;
    if (side === "top" && natural > above && below > above) dir = "bottom";
    if (side === "bottom" && natural > below && above > below) dir = "top";
    const room = Math.max(120, dir === "top" ? above : below);
    let maxH = Math.min(natural, room, vh - 16);
    let left = align === "start" ? a.left : align === "end" ? a.right - w : a.left + a.width / 2 - w / 2;
    left = Math.max(8, Math.min(vw - w - 8, left));
    let top = dir === "top" ? a.top - offset - maxH : a.bottom + offset;
    top = Math.max(8, Math.min(vh - maxH - 8, top));
    // Stay clear of what must stay visible (the minimap): cap the height above it, or move beside it.
    for (const el of avoidRef.current?.() ?? []) {
      const r = el?.getBoundingClientRect();
      if (!r || !r.width) continue;
      const hits = left < r.right && r.left < left + w && top < r.bottom && r.top < top + maxH;
      if (!hits) continue;
      if (dir === "top" && a.top - offset - (r.bottom + 8) >= 160) {
        maxH = Math.min(maxH, a.top - offset - (r.bottom + 8));
        top = a.top - offset - maxH;
      } else if (r.left - 8 - w >= 8) {
        left = r.left - 8 - w;
      }
    }
    setPos({ left, top, maxHeight: maxH, visibility: "visible" });
  }, [anchor, side, align, offset, sheetBelow, sheetFull, setPos]);

  useLayoutEffect(() => {
    if (!open) return;
    setPos({ visibility: "hidden" });
    const raf = requestAnimationFrame(place);
    const ro = new ResizeObserver(place);
    if (panel.current) ro.observe(panel.current);
    window.addEventListener("resize", place);
    // Re-check now and then: what it must avoid (the minimap) can appear after it opened.
    const tick = window.setInterval(place, 500);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", place);
      window.clearInterval(tick);
    };
  }, [open, place, setPos]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || anchor.current?.contains(t)) return;
      onClose();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open, onClose, anchor]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          ref={panel}
          initial={{ opacity: 0, y: side === "top" ? 6 : -6, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: side === "top" ? 4 : -4, transition: { duration: 0.14 } }}
          transition={{ duration: 0.2, ease: EASE_OUT }}
          className={cn(
            "fixed z-[70] overflow-y-auto overscroll-contain rounded-card p-2 [scrollbar-width:thin]",
            tone === "light" ? "bg-surface text-ink shadow-e2" : "glass-hud shadow-[0_24px_60px_-20px_rgb(0_0_0/0.6)]",
            className,
            asSheet && "w-auto rounded-panel p-3",
          )}
          style={pos}
          role="dialog"
          aria-label={label}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

// ── Keyboard shortcuts ──────────────────────────────────────────────────────────────────────────────

export function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  return t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
}

/** Bind single-key shortcuts while mounted; ignored while typing or with ⌘/Ctrl/Alt held. */
export function useHotkeys(map: Record<string, (e: KeyboardEvent) => void>, enabled = true) {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      const fn = ref.current[e.key] ?? ref.current[e.key.toLowerCase()];
      if (fn) fn(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}

// ── Notices ─────────────────────────────────────────────────────────────────────────────────────────

/** Every toast from the flows goes through here, so swapping the shell's Toast in is one edit. */
export const notify = {
  info: (title: string, body?: string) => toast.info(title, body),
  success: (title: string, body?: string) => toast.success(title, body),
  error: (title: string, err?: unknown, action?: { label: string; run: () => void }) => toast.error(title, err, action),
};

/** Ignore a click that lands within `ms` of the last one (no double-click hazards on expensive actions). */
export function useGuardedClick(ms = 600) {
  const last = useRef(0);
  return useCallback(
    (fn: () => void) => () => {
      const now = Date.now();
      if (now - last.current < ms) return;
      last.current = now;
      fn();
    },
    [ms],
  );
}
