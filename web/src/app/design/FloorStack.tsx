/**
 * The floor stack (DESIGN.md "Plan" and "House"): R · 2 · 1 · G down the left edge, roof on top, `[` and `]` to
 * step. Below 768px it lies down as a row of chips. The House adds "All" in Orbit.
 */
import type { Level } from "@contracts/plan";
import { cn } from "@/app/lib/utils";
import { SegmentThumb } from "@/app/ui/SegmentThumb";
import { SPRING, useHotkeys } from "./kit";

export interface StackItem { id: string; key: string; name: string; dot?: boolean }

export function stackItems(levels: Level[], keyOf: (l: Level) => string, nameOf: (l: Level) => string): StackItem[] {
  return [...levels].sort((a, b) => b.index - a.index).map((l) => ({ id: l.id, key: keyOf(l), name: nameOf(l) }));
}

export function FloorStack({
  items,
  value,
  onChange,
  tone = "light",
  orientation = "vertical",
  extra,
  hotkeys = true,
  className,
}: {
  /** Top floor first. */
  items: StackItem[];
  value: string;
  onChange: (id: string) => void;
  tone?: "light" | "hud";
  orientation?: "vertical" | "horizontal";
  /** An extra option after the floors (e.g. { id: "all", key: "All" }). */
  extra?: StackItem;
  hotkeys?: boolean;
  className?: string;
}) {
  const all = extra ? [...items, extra] : items;
  const floors = items; // top → bottom
  const idx = floors.findIndex((f) => f.id === value);
  useHotkeys(
    {
      "]": () => {
        // up a floor
        const i = idx < 0 ? floors.length - 1 : idx;
        if (i > 0) onChange(floors[i - 1].id);
      },
      "[": () => {
        const i = idx < 0 ? 0 : idx;
        if (i < floors.length - 1) onChange(floors[i + 1].id);
      },
    },
    hotkeys && floors.length > 1,
  );
  const vertical = orientation === "vertical";
  return (
    <div
      role="radiogroup"
      aria-label="Floor"
      className={cn(
        "relative isolate flex gap-0.5 rounded-full p-1",
        vertical ? "flex-col" : "flex-row",
        tone === "light" ? "bg-surface/90 shadow-e1 backdrop-blur" : "glass-hud",
        className,
      )}
    >
      {/* One thumb per stack, sliding under the labels within this stack only. */}
      <SegmentThumb index={all.findIndex((f) => f.id === value)} transition={SPRING} className={tone === "light" ? "bg-ink" : "bg-white"} />
      {all.map((f) => {
        const active = f.id === value;
        return (
          <button
            key={f.id}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={f.name}
            title={`${f.name}${f.id === "all" ? "" : "  ([ / ])"}`}
            onClick={() => onChange(f.id)}
            className={cn(
              "hit-44 relative grid place-items-center rounded-full font-medium outline-none transition-colors duration-(--dur-fast) focus-visible:shadow-focus",
              // The same 36px round thumb in Plan, Revisions and House, standing or lying down ("All" widens it).
              f.key.length > 2 ? "h-9 min-w-9 px-3 text-[13px]" : "size-9 text-[13px]",
              tone === "light" ? (active ? "text-white" : "text-ink-2 hover:text-ink") : active ? "text-ink" : "text-hud-ink-2 hover:text-hud-ink",
            )}
          >
            <span className="relative z-10">{f.key}</span>
            {f.dot && <span className="absolute right-1 top-1 z-10 size-1.5 rounded-full bg-fail" />}
          </button>
        );
      })}
    </div>
  );
}
