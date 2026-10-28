/** As-built notes: what the engine had to repair (or could not), reported with the build summary. */
export interface EngineNote {
  /** "asbuilt.<rule>:<element>", e.g. "asbuilt.stair_fit:stair_g_f" */
  id: string;
  title: string;
  status: "pass" | "warn" | "fail";
  message: string;
  element_ids?: string[];
}

const RANK = { pass: 0, warn: 1, fail: 2 } as const;

export class NoteLog {
  readonly list: EngineNote[] = [];
  /** Add a note. A note with the same id, or the same message (EN-07: one line per fact), is merged: the worse
   *  status wins and the element ids are combined. */
  add(n: EngineNote): void {
    const same = this.list.find((x) => x.id === n.id || x.message === n.message);
    if (!same) {
      this.list.push(n);
      return;
    }
    if (RANK[n.status] > RANK[same.status]) same.status = n.status;
    if (n.element_ids?.length) same.element_ids = [...new Set([...(same.element_ids ?? []), ...n.element_ids])];
  }
  /** Add or replace the note with this id (a running count, e.g. "Only 1 of 2 cars fit"). */
  set(n: EngineNote): void {
    const i = this.list.findIndex((x) => x.id === n.id);
    if (i < 0) this.add(n);
    else this.list[i] = n;
  }
  /** Drop the note with this id (a problem a later pass repaired). */
  remove(id: string): void {
    const i = this.list.findIndex((x) => x.id === id);
    if (i >= 0) this.list.splice(i, 1);
  }
}

/** Human names for engine item types in notes ("floor plant", "TV", "WC"), never "plant floor" or "tv". */
export function humanType(type: string): string {
  const MAP: Record<string, string> = {
    plant_floor: "floor plant", plant_small: "small plant", tv: "TV", tv_unit: "TV unit", wc: "WC", ac_split: "AC unit",
    bed_king: "king bed", bed_queen: "queen bed", bed_single: "single bed", sofa_3: "three-seat sofa", sofa_2: "two-seat sofa",
    sofa_l: "L-shaped sofa", dining_table_4: "four-seat dining table", dining_table_6: "six-seat dining table",
    dining_table_8: "eight-seat dining table", sink_kitchen: "kitchen sink", kitchen_counter: "kitchen counter",
    mirror_wall: "wall mirror", side_table: "nightstand", car_sedan: "car", car_suv: "SUV", outdoor_chair: "outdoor chair",
    outdoor_table: "outdoor table", desk_chair: "desk chair", study_desk: "study desk", water_dispenser: "water dispenser",
    washing_machine: "washing machine", towel_rail: "towel rail", prayer_mat: "prayer mat", ceiling_fan: "ceiling fan",
    floor_lamp: "floor lamp", table_lamp: "table lamp", dressing_table: "dressing table", coffee_table: "coffee table",
  };
  return MAP[type] ?? type.replace(/_/g, " ");
}
