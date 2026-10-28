/**
 * The command popover's "Go to" and "Do" lists (DESIGN.md §4 "Command bar").
 * Go to: views, floors, rooms, versions. Do: Print, Share, Day/Night, Walk, Compare…
 * Commands change the route and its query string; views read ?mode, ?floor, ?room, ?v, ?light, ?dialog, ?compare.
 */
import type { Project, Version } from "@contracts/api-types";
import type { RoomType } from "@contracts/plan";
import { canEdit, roleOf, viewAvailable, VIEWS, type ViewId } from "@/app/lib/views";
import { levelName, sentenceCase } from "@/app/plan/model";
import type { Command } from "./ask";

const SITE: Set<RoomType> = new Set(["lawn", "driveway", "courtyard", "open_space"] as RoomType[]);

export interface CommandEnv {
  project: Project;
  version: Version | null;
  view: ViewId;
  params: URLSearchParams;
  go: (path: string) => void;
  /** Update the current view's query string (null deletes a key). */
  setParams: (patch: Record<string, string | null>) => void;
  share: () => void;
  comments: () => void;
  chat: () => void;
  signedIn: boolean;
  signIn: () => void;
  signOut: () => void;
}


export function buildCommands(env: CommandEnv): Command[] {
  const { project, version, view } = env;
  const base = `/app/p/${project.id}`;
  const out: Command[] = [];

  // Go to: views
  for (const v of VIEWS) {
    if (v.id !== view && viewAvailable(project, v.id)) out.push({ id: `view-${v.id}`, group: "go", label: v.label, run: () => env.go(`${base}/${v.id}`) });
  }
  if (view !== "revisions" && viewAvailable(project, "revisions")) {
    out.push({ id: "view-revisions", group: "go", label: "Versions", keywords: "revisions history changes", run: () => env.go(`${base}/revisions`) });
  }

  const plan = version?.plan;
  if (plan) {
    const levels = [...plan.levels].sort((a, b) => b.index - a.index);
    const floorView: ViewId = view === "plan" ? "plan" : "house";
    for (const l of levels) {
      out.push({
        id: `floor-${l.id}`,
        group: "go",
        label: levelName(l),
        keywords: "floor level storey",
        run: () => (view === floorView ? env.setParams({ floor: l.id }) : env.go(`${base}/${floorView}?floor=${encodeURIComponent(l.id)}`)),
      });
    }
    const levelNames = new Map(plan.levels.map((l) => [l.id, levelName(l)]));
    for (const r of plan.rooms) {
      if (SITE.has(r.type)) continue;
      out.push({
        id: `room-${r.id}`,
        group: "go",
        label: sentenceCase(r.name),
        hint: levelNames.get(r.level),
        keywords: `room ${r.type}`,
        run: () => env.go(`${base}/house?mode=walk&room=${encodeURIComponent(r.id)}`),
      });
    }
  }
  const versions = [...project.versions].sort((a, b) => b.n - a.n);
  if (versions.length > 1) {
    const vView: ViewId = view === "plan" ? "plan" : "house";
    for (const v of versions) {
      out.push({
        id: `version-${v.id}`,
        group: "go",
        label: `Version ${v.n}`,
        hint: v.id === project.current_version_id ? "Latest" : undefined,
        keywords: "version history",
        run: () => (v.id === project.current_version_id ? env.go(`${base}/${vView}`) : env.go(`${base}/${vView}?v=${encodeURIComponent(v.id)}`)),
      });
    }
  }
  out.push({ id: "homes", group: "go", label: "All homes", keywords: "workspace projects back", run: () => env.go("/app") });

  // Do
  if (viewAvailable(project, "house")) {
    out.push({ id: "walk", group: "do", label: "Walk through it", keywords: "walk first person", hint: "V", run: () => env.go(`${base}/house?mode=walk`) });
  }
  if (view === "house" || view === "concepts") {
    const night = env.params.get("light") === "night";
    out.push({ id: "light", group: "do", label: night ? "Day" : "Night", keywords: "day night light lighting", hint: "N", run: () => env.setParams({ light: night ? null : "night" }) });
  }
  if (viewAvailable(project, "plan") && version) {
    out.push({ id: "print", group: "do", label: "Print plan…", keywords: "pdf print export download", run: () => env.go(`${base}/plan?dialog=print`) });
  }
  if (versions.length > 1 && canEdit(project)) {
    out.push({ id: "compare", group: "do", label: "Compare versions", keywords: "compare diff changes", run: () => env.go(`${base}/plan?compare=1`) });
  }
  if (roleOf(project) === "owner") out.push({ id: "share", group: "do", label: "Share…", keywords: "invite client team link", run: env.share });
  out.push({ id: "comments", group: "do", label: "Comments", keywords: "notes feedback", hint: "C", run: env.comments });
  if (canEdit(project)) out.push({ id: "chat", group: "do", label: "Conversation", keywords: "chat messages brief", run: env.chat });
  out.push(
    env.signedIn
      ? { id: "signout", group: "do", label: "Sign out", keywords: "account logout", run: env.signOut }
      : { id: "signin", group: "do", label: "Save your work", keywords: "sign in account login sign up", run: env.signIn },
  );
  return out;
}

/** Commands matching what was typed, best first. */
export function matchCommands(list: Command[], query: string, limit = 7): Command[] {
  const q = query.trim().toLowerCase();
  if (!q) return list.slice(0, limit);
  const words = q.split(/\s+/);
  const scored = list
    .map((c) => {
      const label = c.label.toLowerCase();
      const hay = `${label} ${c.keywords ?? ""} ${c.hint ?? ""}`.toLowerCase();
      if (!words.every((w) => hay.includes(w))) return null;
      const score = label.startsWith(q) ? 3 : label.includes(q) ? 2 : 1;
      return { c, score };
    })
    .filter((x): x is { c: Command; score: number } => !!x)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.c);
}
