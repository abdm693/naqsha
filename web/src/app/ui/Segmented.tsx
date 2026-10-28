import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/app/lib/utils";
import { spring } from "./motion";
import { SegmentThumb } from "./SegmentThumb";

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  title?: string;
  disabled?: boolean;
  /** A breathing accent dot after the label ("being made"). */
  busy?: boolean;
}

/**
 * A segmented control (DESIGN.md §4): 36px, a surface-2 track and a surface thumb (e1) that springs between options.
 * Arrow keys move the selection. `tone="hud"` for use over 3D.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = "md",
  tone = "light",
  label,
  className,
  fill,
}: {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (v: T) => void;
  size?: "sm" | "md";
  tone?: "light" | "hud" | "dark";
  /** Accessible name of the group. */
  label?: string;
  className?: string;
  /** Stretch options to fill the width. */
  fill?: boolean;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const hud = tone !== "light";
  // Roving tab stop: the selected option, or the first one when nothing is selected.
  const tabStop = Math.max(0, options.findIndex((o) => o.value === value));

  const onKey = (e: KeyboardEvent, i: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const dir = e.key === "ArrowRight" ? 1 : -1;
    for (let k = 1; k <= options.length; k++) {
      const j = (i + dir * k + options.length) % options.length;
      if (!options[j].disabled) {
        onChange(options[j].value);
        refs.current[j]?.focus();
        break;
      }
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        "relative isolate inline-flex items-center rounded-full p-[3px]",
        size === "md" ? "h-9" : "h-8",
        hud ? "bg-white/10" : "bg-surface-2",
        fill && "flex w-full",
        className,
      )}
    >
      {/* The thumb slides under the labels, inside this control only (SegmentThumb). */}
      <SegmentThumb index={options.findIndex((o) => o.value === value)} transition={spring} className={hud ? "bg-hud-ink" : "bg-surface shadow-e1"} />
      {options.map((o, i) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={i === tabStop ? 0 : -1}
            title={o.title}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKey(e, i)}
            className={cn(
              "hit-44 relative inline-flex h-full items-center justify-center whitespace-nowrap rounded-full font-medium outline-none transition-colors duration-[160ms]",
              "focus-visible:shadow-focus disabled:cursor-not-allowed disabled:opacity-40",
              size === "md" ? "px-3.5 text-[13px]" : "px-3 text-[12px]",
              fill && "flex-1",
              hud
                ? active ? "text-ink" : "text-hud-ink-2 hover:text-hud-ink"
                : active ? "text-ink" : "text-ink-3 hover:text-ink",
            )}
          >
            <span className="relative z-10 inline-flex items-center gap-1.5">
              {o.label}
              {o.busy && <span className="size-1.5 rounded-full bg-accent animate-breathe" aria-label="In progress" />}
            </span>
          </button>
        );
      })}
    </div>
  );
}
