/**
 * EN2-05: names for as-built notes. A note speaks the family's language: "the door between the Kitchen and the
 * Dining", "the ground-to-first stair", never a plan id like g_kitchen_open or stair_g_f.
 */
import { DOOR_TYPES, type OpeningM, type PlanModel, type RoomM, type StairM } from "../plan/model";

export const cap = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1);

/** "ground" for "Ground Floor", "first" for "First Floor", "roof" for "Roof". */
const short = (name: string): string => name.replace(/\s*floor$/i, "").trim().toLowerCase() || name.toLowerCase();

/** "the ground-to-first stair", "the first-to-roof stair". */
export function stairLabel(s: StairM): string {
  return `the ${short(s.from.name)}-to-${short(s.to.name)} stair`;
}

/**
 * EN-F4: a room as a note names it, in sentence case ("the upper passage", "the TV lounge & dining"), with its floor
 * only when another floor has a room of the same name ("the stair hall on the first floor").
 */
export function sentenceName(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((w) => (/^[A-Z0-9]{2,}$/.test(w.replace(/[^A-Za-z0-9]/g, "")) ? w : w.toLowerCase()))
    .join(" ");
}
export function roomPhrase(plan: PlanModel, room: RoomM): string {
  const twin = plan.rooms.some((q) => q !== room && q.level !== room.level && q.name.trim().toLowerCase() === room.name.trim().toLowerCase());
  return `the ${sentenceName(room.name)}${twin ? ` on the ${room.lv.name.toLowerCase()}` : ""}`;
}

/** "the main door", "the kitchen window", "the sliding door from the upper passage to the rear sun terrace". */
export function openingNameLow(plan: PlanModel, op: OpeningM): string {
  const rooms = op.between.map((b) => (b === "exterior" ? null : plan.room(b) ?? null)).filter((r): r is RoomM => !!r);
  const kind = op.type === "main_door" ? "main door" : op.type === "double_door" ? "double door" : op.type === "sliding_door" ? "sliding door" : op.type === "garage_door" ? "garage door" : op.type === "arch" ? "arch" : op.type === "ventilator" ? "ventilator" : DOOR_TYPES.includes(op.type) ? "door" : "window";
  if (op.type === "main_door") return "the main door";
  if (op.id === "roof_mumty_door") return "the roof door";
  // the floor once, when a room name repeats on another floor ("Stair Hall" on every storey)
  const lv = plan.levelById.get(op.level);
  const twin = rooms.some((r) => plan.rooms.some((q) => q !== r && q.level !== r.level && q.name.trim().toLowerCase() === r.name.trim().toLowerCase()));
  const on = twin && lv ? ` on the ${lv.name.toLowerCase()}` : "";
  const nm = (r: RoomM) => sentenceName(r.name);
  if (rooms.length >= 2)
    return DOOR_TYPES.includes(op.type) ? `the ${kind} from the ${nm(rooms[0])} to the ${nm(rooms[1])}${on}` : `the ${kind} between the ${nm(rooms[0])} and the ${nm(rooms[1])}${on}`;
  if (rooms.length === 1) return `the ${nm(rooms[0])} ${kind}${on}`;
  return lv ? `a ${kind} on the ${lv.name.toLowerCase()}` : `a ${kind}`;
}

/** The same, starting a sentence ("The kitchen window"). */
export function openingName(plan: PlanModel, op: OpeningM): string {
  return cap(openingNameLow(plan, op));
}
