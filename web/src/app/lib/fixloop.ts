/**
 * The compliance fix loop of a design run (failures per attempt, e.g. [5, 1, 0]) is only streamed
 * live; remember it per version in this browser so the Design page can still tell the story later.
 */
const key = (vid: string) => `naqsha.fixloop.${vid}`;

export function saveFixLoop(vid: string, failures: number[]) {
  if (failures.length < 2) return;
  try { localStorage.setItem(key(vid), JSON.stringify(failures)); } catch { /* ignore */ }
}

export function loadFixLoop(vid: string | null | undefined): number[] | undefined {
  if (!vid) return undefined;
  try {
    const raw = localStorage.getItem(key(vid));
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(v) && v.every((n) => typeof n === "number") ? (v as number[]) : undefined;
  } catch {
    return undefined;
  }
}
