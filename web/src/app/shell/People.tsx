/**
 * People (DESIGN.md §5.3), top-right: avatars (3, then +n), Comments with its count, and Share.
 */
import { MessageSquare, Share2 } from "lucide-react";
import type { Project } from "@contracts/api-types";
import { cn } from "@/app/lib/utils";
import { roleOf } from "@/app/lib/views";
import { useAuth } from "@/app/store/auth";
import { useMembers } from "@/app/store/members";
import { useProject } from "@/app/store/project";
import { AvatarStack, type AvatarRole } from "@/app/ui/Avatar";
import { Tooltip } from "@/app/ui/Tooltip";
import { startShare } from "./next";
import { useShell } from "./state";

const NOBODY: never[] = [];

export function usePeople(project: Project): { id: string; name: string; role: AvatarRole }[] {
  const user = useAuth((s) => s.user);
  const members = useMembers((s) => (s.pid === project.id ? s.members : NOBODY));
  const me = user ? { id: user.uid, name: user.name || user.email, role: roleOf(project) as AvatarRole } : null;
  const others = members
    .filter((m) => m.email.toLowerCase() !== user?.email.toLowerCase())
    .map((m) => ({ id: m.uid ?? m.email, name: m.name || m.email, role: m.role as AvatarRole }));
  return me ? [me, ...others] : others;
}

export function People({ project, tone, compact }: { project: Project; tone: "light" | "hud"; compact?: boolean }) {
  const people = usePeople(project);
  const comments = useProject((s) => s.comments);
  const right = useShell((s) => s.right);
  const openComments = useShell((s) => s.openComments);
  const closeComments = useShell((s) => s.closeComments);
  const owner = roleOf(project) === "owner";
  const hud = tone === "hud";
  const current = project.current_version_id;
  const count = comments.filter((c) => c.version_id === current && c.status === "open").length;

  const btn = cn(
    "inline-flex h-9 items-center gap-2 rounded-full px-3 text-[14px] font-medium outline-none transition-colors focus-visible:shadow-focus",
    hud ? "text-hud-ink hover:bg-white/10" : "text-ink hover:bg-surface-2",
  );

  return (
    <div className={cn("pointer-events-auto flex h-12 items-center gap-1 rounded-full pl-2 pr-1.5", hud ? "glass-hud" : "glass-light")}>
      {people.length > 1 && !compact && (
        <Tooltip content={people.map((p) => p.name).join(", ")}>
          <button type="button" onClick={() => owner && void startShare()} className="rounded-full px-1 outline-none focus-visible:shadow-focus" aria-label={`${people.length} people on this home`}>
            <AvatarStack people={people} max={3} size={28} />
          </button>
        </Tooltip>
      )}
      {current && (
        <Tooltip content="Comments" shortcut={compact ? undefined : ["C"]}>
          <button
            type="button"
            onClick={() => (right === "comments" ? closeComments() : openComments())}
            aria-pressed={right === "comments"}
            aria-label={`Comments${count ? `, ${count} open` : ""}`}
            className={cn(btn, right === "comments" && (hud ? "bg-white/10" : "bg-surface-2"), compact && "hit-44 relative px-2.5")}
          >
            <MessageSquare className="size-4" strokeWidth={1.75} />
            {!compact && <span>Comments</span>}
            {count > 0 && (
              <span className="grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1.5 text-[11px] font-semibold tabular text-white">{count}</span>
            )}
          </button>
        </Tooltip>
      )}
      {owner && (
        <button
          type="button"
          onClick={() => void startShare()}
          aria-label="Share"
          className={cn(
            "inline-flex h-9 items-center gap-2 rounded-full px-4 text-[14px] font-medium outline-none transition-colors focus-visible:shadow-focus",
            hud ? "bg-hud-ink text-ink hover:bg-white" : "bg-ink text-white hover:bg-ink-2",
            // Phones: the icon alone, so the home's name keeps its room in the title capsule.
            compact && "hit-44 relative w-9 justify-center px-0",
          )}
        >
          <Share2 className="size-4" strokeWidth={1.75} />
          {!compact && <span>Share</span>}
        </button>
      )}
    </div>
  );
}
