/** localStorage-backed store for mock mode. */
import type { Brief, ChatMessage, Comment, Member, Project, Version } from "@contracts/api-types";

export type MockBrief = Brief & { plot: NonNullable<Brief["plot"]> };
/** A brief with a plot (zeros when the size isn't known yet). */
export function withPlot(b: Brief): MockBrief {
  return { ...b, plot: b.plot ?? { width_ft: 0, depth_ft: 0, area_marla: 0, corner: false } };
}

export interface IntakeState {
  step: number; // index into the question list
  done: boolean;
  /** The mock keeps a plot on its working brief (zeros until known). */
  brief: MockBrief;
}

export interface MockDB {
  projects: Project[];
  /** Finished example homes (GET /samples), owned by nobody; cloned on demand. */
  samples: Project[];
  messages: Record<string, ChatMessage[]>;
  versions: Record<string, Version>;
  comments: Record<string, Comment[]>;
  intake: Record<string, IntakeState>;
  /** People invited to a project (email "*" = any signed-in person; used by the "shared with you" demo). */
  members: Record<string, Member[]>;
  /** Client links. */
  shares: Record<string, { enabled: boolean; token: string }>;
  /** Account that owns a project once a guest signed in and claimed it (absent: the browser's guest). */
  owners: Record<string, string>;
  /** Display name of the owner of projects shared with you (demo). */
  ownerNames: Record<string, string>;
  /** Sample id → your copy of it (cloning again opens the same copy). */
  clones: Record<string, string>;
}

const KEY = "naqsha.mock.db.v2";
let cache: MockDB | null = null;

function empty(): MockDB {
  return { projects: [], samples: [], messages: {}, versions: {}, comments: {}, intake: {}, members: {}, shares: {}, owners: {}, ownerNames: {}, clones: {} };
}

export function db(): MockDB {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    cache = raw ? { ...empty(), ...(JSON.parse(raw) as MockDB) } : empty();
  } catch {
    cache = empty();
  }
  return cache;
}

export function save(): void {
  if (!cache) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch (e) {
    // Quota: drop the oldest comment snapshots and try once more.
    console.warn("[mock] localStorage save failed, trimming snapshots", e);
    for (const list of Object.values(cache.comments)) for (const c of list.slice(0, -4)) delete c.snapshot_url;
    try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* give up quietly */ }
  }
}

export const uid = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-3)}`;
export const now = () => new Date().toISOString();
export const clone = <T>(x: T): T => structuredClone(x);

/** Playback speed for simulated latency (localStorage["naqsha.mock.speed"], 1 = realistic). */
export function speed(): number {
  try {
    const v = Number(localStorage.getItem("naqsha.mock.speed"));
    return v > 0 ? v : 1;
  } catch {
    return 1;
  }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const t = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms * speed());
    const onAbort = () => { clearTimeout(t); reject(new DOMException("Aborted", "AbortError")); };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Simulated REST latency. */
export const latency = (ms = 180) => sleep(ms + Math.random() * 120);

export function findProject(pid: string): Project {
  const p = db().projects.find((x) => x.id === pid);
  if (!p) throw Object.assign(new Error("Project not found."), { status: 404 });
  return p;
}

export function touch(p: Project): void {
  p.updated_at = now();
}
