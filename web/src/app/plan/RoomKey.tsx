/** The legend line for a room too small to label on the plan: its letter key, name and size. */
import type { Room } from "@contracts/plan";
import { feetInches } from "@/app/lib/utils";
import { sentenceCase } from "./model";

/** A legend line for a lettered room key: "A  Stair hall  8′ × 12′". */
export function RoomKeyRow({ letter, room }: { letter: string; room: Room }) {
  return (
    <li className="flex items-center gap-2 whitespace-nowrap">
      <span className="grid size-4 shrink-0 place-items-center rounded-[4px] border border-ink-2 bg-white text-[10px] font-semibold text-ink">{letter}</span>
      <span className="text-ink-2">{sentenceCase(room.name)}</span>
      <span className="font-mono tabular-nums">
        {feetInches(room.rect.w)} × {feetInches(room.rect.d)}
      </span>
    </li>
  );
}

