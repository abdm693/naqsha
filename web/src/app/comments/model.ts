/** Comment filters, grouping and labels (DESIGN.md "Comments and collaboration"). */
import type { Author, Comment } from "@contracts/api-types";
import type { BuildingPlan } from "@contracts/plan";
import { sentenceCase } from "@/app/plan/model";

export type CommentFilter = "all" | "mine" | "team" | "client" | "open" | "resolved";

export const FILTERS: { id: CommentFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "mine", label: "Mine" },
  { id: "team", label: "Team" },
  { id: "client", label: "Client" },
  { id: "open", label: "Open" },
  { id: "resolved", label: "Resolved" },
];

/** Two groups that combine: who wrote it, and whether it is still open ("Client" and "Open" at once). */
export type WhoFilter = "all" | "mine" | "team" | "client";
export type StatusFilter = "any" | "open" | "resolved";
export const WHO_FILTERS: { id: WhoFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "mine", label: "Mine" },
  { id: "team", label: "Team" },
  { id: "client", label: "Client" },
];
export const STATUS_FILTERS: { id: Exclude<StatusFilter, "any">; label: string }[] = [
  { id: "open", label: "Open" },
  { id: "resolved", label: "Resolved" },
];

export const STATUS_LABEL: Record<Comment["status"], string> = {
  open: "Open",
  resolved: "Done",
  partial: "Alternative offered",
  rejected: "Not possible",
};

export const STATUS_TONE: Record<Comment["status"], "neutral" | "pass" | "warn" | "fail"> = {
  open: "neutral",
  resolved: "pass",
  partial: "warn",
  rejected: "fail",
};

export const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  team: "Team",
  client: "Client",
  guest: "Guest",
  agent: "Naqsha",
};

/** Comments written before authors existed belong to the owner. */
export function authorOf(c: { author?: Author }): Author {
  return c.author ?? { id: "owner", name: "Owner", role: "owner" };
}

/** The server says whose a comment or reply is (`mine`; author ids are opaque handles); older payloads fall back to ids. */
export function isMine(a: Author, me: { ids: string[]; name?: string | null }, mine?: boolean): boolean {
  if (mine !== undefined) return mine;
  if (me.ids.includes(a.id)) return true;
  return !!me.name && a.role === "client" && a.name.trim().toLowerCase() === me.name.trim().toLowerCase();
}

export function matches(c: Comment, f: CommentFilter, me: { ids: string[]; name?: string | null }): boolean {
  const a = authorOf(c);
  switch (f) {
    case "all": return true;
    case "mine": return isMine(a, me, c.mine);
    case "team": return a.role === "owner" || a.role === "team";
    case "client": return a.role === "client" || a.role === "guest";
    case "open": return c.status === "open";
    case "resolved": return c.status !== "open";
  }
}

/** Pin numbers shared by Plan and House: creation order within the version, from 1. */
export function pinNumbers(comments: Comment[]): Map<string, number> {
  const sorted = [...comments].sort((a, b) => a.created_at.localeCompare(b.created_at));
  return new Map(sorted.map((c, i) => [c.id, i + 1]));
}

const levelLabel = (plan: BuildingPlan | undefined, id?: string) => {
  if (!id) return null;
  const l = plan?.levels.find((x) => x.id === id);
  const name = l?.name ?? id.replace(/_/g, " ");
  return name.replace(/\bFloor\b/, "floor").replace(/^\w/, (ch) => ch.toUpperCase());
};

/** "First floor · Bedroom 2" (or the anchor's own label). */
export function placeOf(c: Comment, plan?: BuildingPlan): string {
  const a = c.anchor;
  const room = a.room ? plan?.rooms.find((r) => r.id === a.room)?.name : undefined;
  // The engine's "Roof (roof)" is just "Roof"; a name that already says the floor doesn't repeat it ("Roof", not
  // "Roof · Roof").
  const what = room ?? a.label?.replace(/\s*\([^)]*\)\s*$/, "").trim() ?? null;
  const level = levelLabel(plan, a.level);
  const levelWord = level?.toLowerCase().replace(/\s*floor$/, "");
  const parts = [what && levelWord && what.toLowerCase().includes(levelWord) ? null : level, what ? sentenceCase(what) : null].filter(Boolean) as string[];
  return parts.length ? parts.join(" · ") : "General";
}

/** Group by floor then room, in plan order (top floor last), keeping "General" first. */
export function groupComments(list: Comment[], plan?: BuildingPlan): { key: string; label: string; items: Comment[] }[] {
  const levelIndex = new Map(plan?.levels.map((l) => [l.id, l.index]) ?? []);
  const groups = new Map<string, { key: string; label: string; items: Comment[]; order: number }>();
  for (const c of list) {
    const label = placeOf(c, plan);
    const key = label;
    const order = c.anchor.level ? levelIndex.get(c.anchor.level) ?? 50 : -1;
    const g = groups.get(key) ?? { key, label, items: [], order };
    g.items.push(c);
    groups.set(key, g);
  }
  return [...groups.values()]
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label))
    .map(({ key, label, items }) => ({ key, label, items: items.sort((x, y) => x.created_at.localeCompare(y.created_at)) }));
}
