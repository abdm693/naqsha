/**
 * The room navigator (M): rooms by floor with type-to-filter, plus the Stair and, when the plan has one, the Roof
 * (it may have no rooms of its own). Shared by the owner's House and the client's walk.
 */
import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import type { BuildingPlan } from "@contracts/plan";
import { cn, feetInches } from "@/app/lib/utils";
import { Kbd } from "@/app/design/kit";
import { CATEGORY, SITE_TYPES, isRoofLevel, levelName, levelsOf, sentenceCase } from "@/app/plan/model";

const ROOM_ORDER = ["living", "bed", "wet", "service", "outdoor"];

/** Rooms by floor with type-to-filter (M). Shared by the owner's House and the client's walk. */
interface Place {
  key: string;
  label: string;
  /** Extra words the filter matches ("terrace" finds the Roof). */
  words?: string;
  meta: string | null;
  here: boolean;
  go: () => void;
}

export function RoomNavigator({
  plan,
  current,
  onGo,
  onFloor,
  currentLevel,
  open = true,
  onClose,
}: {
  plan: BuildingPlan;
  current: string | null;
  onGo: (id: string) => void;
  /** Go to a whole floor, as the floor stack's R does (lists the Roof when the plan has one). */
  onFloor?: (levelId: string) => void;
  /** The walker's floor, so "You're here" can mark the Roof. */
  currentLevel?: string | null;
  open?: boolean;
  /** Escape in the search field closes the list (the field keeps every other key to itself). */
  onClose?: () => void;
}) {
  const [q, setQ] = useState("");
  const search = useRef<HTMLInputElement>(null);
  // The list keeps the height it had when you started typing (the panel mounts afresh each time it opens): the
  // panel opens upward (anchored by its bottom), so a shrinking list would move the search field under your cursor.
  const listEl = useRef<HTMLDivElement>(null);
  const [lockH, setLockH] = useState<number | null>(null);
  // The panel is placed (and made visible) a frame after it mounts: keep trying to focus the search until it can
  // take focus (a hidden panel can't), for about a second.
  useEffect(() => {
    if (!open) return;
    const fine = window.matchMedia?.("(pointer: fine)").matches ?? true;
    if (!fine) return;
    let n = 0;
    const t = window.setInterval(() => {
      const el = search.current;
      if (el && document.activeElement !== el) el.focus({ preventScroll: true });
      if ((el && document.activeElement === el) || ++n > 14) window.clearInterval(t);
    }, 70);
    return () => window.clearInterval(t);
  }, [open]);
  const levels = levelsOf(plan);
  const rooms = plan.rooms.filter((r) => !SITE_TYPES.has(r.type) && r.type !== "stair");
  const needle = q.trim().toLowerCase();
  const match = (p: Place) => !needle || `${p.label} ${p.words ?? ""}`.toLowerCase().includes(needle);
  const roof = onFloor ? levels.find((l) => isRoofLevel(plan, l)) : undefined;
  // One Stair: the lowest stair hall, where the walk up begins.
  const stair = plan.rooms
    .filter((r) => r.type === "stair")
    .sort((a, b) => (levels.find((l) => l.id === a.level)?.index ?? 0) - (levels.find((l) => l.id === b.level)?.index ?? 0))[0];
  const groups = levels
    .map((l) => {
      const places: Place[] = [];
      if (roof && l.id === roof.id) places.push({ key: `floor-${l.id}`, label: "Roof", words: "terrace top solar tank", meta: null, here: currentLevel === l.id && !current, go: () => onFloor!(l.id) });
      if (stair && stair.level === l.id) places.push({ key: stair.id, label: "Stair", words: "stairs staircase steps up", meta: null, here: current === stair.id, go: () => onGo(stair.id) });
      const list = rooms
        .filter((r) => r.level === l.id)
        .sort((a, b) => ROOM_ORDER.indexOf(CATEGORY[a.type]) - ROOM_ORDER.indexOf(CATEGORY[b.type]) || a.name.localeCompare(b.name, undefined, { numeric: true }))
        .map<Place>((r) => ({ key: r.id, label: sentenceCase(r.name), meta: `${feetInches(r.rect.w)} × ${feetInches(r.rect.d)}`, here: r.id === current, go: () => onGo(r.id) }));
      return { l, list: [...places, ...list].filter(match) };
    })
    .filter((g) => g.list.length);
  const first = groups[0]?.list[0];
  return (
    <div>
      <div className="nq-field flex items-center gap-2 rounded-control bg-white/8 px-2.5">
        <Search className="size-3.5 text-hud-ink-2" strokeWidth={1.75} />
        <input
          ref={search}
          value={q}
          onChange={(e) => {
            if (lockH == null && listEl.current) setLockH(listEl.current.offsetHeight);
            setQ(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && first) first.go();
            if (e.key === "Escape" && onClose) {
              e.preventDefault();
              onClose();
            }
            e.stopPropagation();
          }}
          placeholder="Go to a room"
          aria-label="Go to a room"
          className="h-9 min-w-0 flex-1 bg-transparent text-[13.5px] text-hud-ink outline-none placeholder:text-hud-ink-2"
        />
        <Kbd tone="hud" className="[@media(pointer:coarse)]:hidden">M</Kbd>
      </div>
      <div ref={listEl} style={lockH != null ? { minHeight: lockH } : undefined} className="mt-2 max-h-[50vh] overflow-y-auto [scrollbar-width:thin] max-md:max-h-none">
        {groups.map(({ l, list }) => (
          <div key={l.id} className="mb-1">
            <p className="px-2 pb-0.5 pt-1.5 text-[12px] text-hud-ink-2">{levelName(l)}</p>
            {list.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={p.go}
                className={cn("flex w-full items-center justify-between gap-3 rounded-control px-2 py-1.5 text-left text-[13.5px] outline-none hover:bg-white/8 focus-visible:shadow-focus", p.here && "bg-white/10")}
              >
                <span className="truncate">{p.label}</span>
                {p.here ? <span className="text-[12px] text-hud-accent">You're here</span> : p.meta ? <span className="font-mono text-[12px] tabular-nums text-hud-ink-2">{p.meta}</span> : null}
              </button>
            ))}
          </div>
        ))}
        {!groups.length && <p className="px-2 py-3 text-[13px] text-hud-ink-2">No room called that.</p>}
      </div>
    </div>
  );
}
