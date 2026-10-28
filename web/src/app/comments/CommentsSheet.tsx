/**
 * The comments sheet (right): who (All · Mine · Team · Client) and status (Open · Resolved), combinable, grouped by
 * floor and room, with threads.
 * "Revise with N comments" lets the owner or team pick which notes feed the next revision.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MessageSquarePlus } from "lucide-react";
import type { Comment, Project } from "@contracts/api-types";
import { api, userId } from "@/api/client";
import { canEdit } from "@/app/lib/views";
import { useAuth } from "@/app/store/auth";
import { useProject } from "@/app/store/project";
import { Button } from "@/app/ui/Button";
import { Chip } from "@/app/ui/Chip";
import { Sheet } from "@/app/ui/Sheet";
import { CommentItem } from "./CommentItem";
import { STATUS_FILTERS, WHO_FILTERS, groupComments, matches, pinNumbers, type StatusFilter, type WhoFilter } from "./model";
import { usePinNumbers } from "./pins";

export function CommentsSheet({
  open,
  onClose,
  project,
  clientView,
  applyMode,
  onApplyModeChange,
  focusId,
  onShow,
  onApply,
  emptyHint,
}: {
  open: boolean;
  onClose: () => void;
  project: Project;
  clientView?: boolean;
  applyMode?: boolean;
  onApplyModeChange?: (on: boolean) => void;
  /** Scroll to this comment and flash it. */
  focusId?: string | null;
  onShow?: (c: Comment) => void;
  /** Start a revision with these comments. */
  onApply?: (ids: string[]) => void;
  /** What to say when there are no comments yet. */
  emptyHint?: string;
}) {
  const comments = useProject((s) => s.comments);
  const commentsFor = useProject((s) => s.commentsFor);
  const versions = useProject((s) => s.versions);
  const guestName = useProject((s) => s.guestName);
  const reviseRunning = useProject((s) => s.revise.status === "running");
  const user = useAuth((s) => s.user);
  const [who, setWho] = useState<WhoFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("any");
  const pass = useCallback((c: Comment, m: { ids: string[]; name?: string | null }) => matches(c, who, m) && (status === "any" || matches(c, status, m)), [who, status]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const refs = useRef(new Map<string, HTMLElement>());

  const versionId = commentsFor ?? project.current_version_id;
  const plan = versionId ? versions[versionId]?.plan : undefined;
  const list = useMemo(() => comments.filter((c) => !versionId || c.version_id === versionId), [comments, versionId]);
  // The owner's pins keep their number across versions (the whole project's comments); a client numbers their own.
  const projectNumbers = usePinNumbers(clientView ? undefined : project.id, list);
  const numbers = useMemo(() => (clientView ? pinNumbers(list) : projectNumbers), [clientView, list, projectNumbers]);
  const me = useMemo(() => ({ ids: [user?.uid, clientView ? undefined : userId()].filter(Boolean) as string[], name: clientView ? guestName : user?.name }), [user, clientView, guestName]);
  // Threads on earlier versions (resolved notes, with Naqsha's answers) stay readable after a revision, for everyone,
  // and the filters apply to them too.
  // The owner's store holds the shown version's comments only: fetch the other versions' threads when the sheet opens.
  const [others, setOthers] = useState<Comment[]>([]);
  useEffect(() => {
    if (!open || clientView || !versionId || project.versions.length < 2) return;
    let alive = true;
    api
      .listComments(project.id)
      .then((all) => alive && setOthers(all.filter((c) => c.version_id !== versionId)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [open, clientView, versionId, project.id, project.versions.length]);
  const earlierAll = useMemo(() => {
    if (!versionId) return [];
    const seen = new Set<string>();
    return [...comments.filter((c) => c.version_id !== versionId), ...others]
      .filter((c) => !seen.has(c.id) && seen.add(c.id))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }, [comments, others, versionId]);
  const earlier = useMemo(() => earlierAll.filter((c) => pass(c, me)), [earlierAll, pass, me]);
  const shown = useMemo(() => list.filter((c) => pass(c, me)), [list, pass, me]);
  const groups = useMemo(() => groupComments(shown, plan), [shown, plan]);
  const openList = useMemo(() => list.filter((c) => c.status === "open"), [list]);
  const moderator = !clientView && canEdit(project);
  const isLatest = versionId === project.current_version_id;
  const canApply = moderator && isLatest && openList.length > 0 && !!onApply;

  // Apply mode starts with every open comment included (only when it turns on); any can be unticked.
  const openRef = useRef(openList);
  openRef.current = openList;
  useEffect(() => {
    if (applyMode) setPicked(new Set(openRef.current.map((c) => c.id)));
  }, [applyMode]);

  useEffect(() => {
    if (!open || !focusId) return;
    const t = setTimeout(() => refs.current.get(focusId)?.scrollIntoView({ block: "center", behavior: "smooth" }), 120);
    return () => clearTimeout(t);
  }, [open, focusId]);

  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const count = picked.size;
  const footer = applyMode && canApply ? (
    <div className="flex items-center gap-2">
      <Button variant="quiet" size="md" onClick={() => onApplyModeChange?.(false)}>Cancel</Button>
      <Button
        variant="primary"
        size="md"
        className="flex-1"
        disabled={!count || reviseRunning}
        onClick={() => onApply?.([...picked])}
      >
        {count ? `Revise with ${count} ${count === 1 ? "comment" : "comments"}` : "Pick at least one"}
      </Button>
    </div>
  ) : canApply ? (
    <Button variant="secondary" size="md" className="w-full" onClick={() => onApplyModeChange?.(true)} disabled={reviseRunning}>
      Revise with {openList.length} {openList.length === 1 ? "comment" : "comments"}…
    </Button>
  ) : undefined;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      side="right"
      title={applyMode && canApply ? "Choose what to change" : "Comments"}
      footer={footer}
      bodyClassName="pt-1"
    >
      {applyMode && canApply ? (
        <p className="mb-2 text-[13px] leading-[18px] text-ink-3">
          Naqsha will make a new version with these changes and answer each one in its thread.
        </p>
      ) : (
        (list.length > 0 || earlierAll.length > 0) && (
          <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
            <div className="flex flex-wrap gap-1" role="group" aria-label="Who wrote it">
              {WHO_FILTERS.map((f) => (
                <Chip key={f.id} size="sm" selected={who === f.id} onClick={() => setWho(f.id)} aria-pressed={who === f.id}>
                  {f.label}
                </Chip>
              ))}
            </div>
            <span className="h-4 w-px bg-line-strong" aria-hidden />
            <div className="flex flex-wrap gap-1" role="group" aria-label="Status">
              {STATUS_FILTERS.map((f) => (
                <Chip key={f.id} size="sm" selected={status === f.id} onClick={() => setStatus((s) => (s === f.id ? "any" : f.id))} aria-pressed={status === f.id}>
                  {f.label}
                </Chip>
              ))}
            </div>
          </div>
        )
      )}

      {!isLatest && list.length > 0 && (
        <p className="mb-2 rounded-[12px] bg-surface-2 px-3 py-2 text-[13px] leading-[18px] text-ink-2">These notes are on an earlier version.</p>
      )}

      {list.length === 0 ? (
        <div className="grid place-items-center px-4 py-14 text-center">
          <span className="grid size-11 place-items-center rounded-full bg-surface-2 text-ink-3">
            <MessageSquarePlus className="size-5" strokeWidth={1.75} />
          </span>
          <p className="mt-3 text-[15px] font-semibold text-ink">{earlierAll.length ? "No notes on this version yet" : "No comments yet"}</p>
          <p className="mt-1 max-w-[260px] text-[13px] leading-[18px] text-ink-3">
            {emptyHint ?? "Press C in the House view, then click anywhere to pin a note. Naqsha turns notes into the next version."}
          </p>
        </div>
      ) : shown.length === 0 ? (
        <p className="px-1 py-10 text-center text-[13px] text-ink-3">Nothing on this version with this filter.</p>
      ) : (
        // Filters apply instantly: no exit animations to wait for.
        <div className="flex flex-col gap-1">
          {groups.map((g) => {
            const items = applyMode && canApply ? g.items.filter((c) => c.status === "open") : g.items;
            if (!items.length) return null;
            return (
              <section key={g.key} className="pt-2">
                <h3 className="sticky top-0 z-[1] -mx-5 bg-surface px-5 py-1.5 text-[12px] font-medium text-ink-3">{g.label}</h3>
                <div className="flex flex-col divide-y divide-line">
                  {items.map((c) => (
                    <CommentItem
                      key={c.id}
                      ref={(el) => {
                        if (el) refs.current.set(c.id, el);
                        else refs.current.delete(c.id);
                      }}
                      comment={c}
                      number={numbers.get(c.id)}
                      me={me}
                      moderator={moderator}
                      clientView={clientView}
                      highlight={focusId === c.id}
                      onShow={onShow}
                      selectable={applyMode && canApply}
                      selected={picked.has(c.id)}
                      onToggle={() => toggle(c.id)}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {earlier.length > 0 && !(applyMode && canApply) && (
        <section className="pt-4" aria-label="Notes on earlier versions">
          <h3 className="sticky top-0 z-[1] -mx-5 bg-surface px-5 py-1.5 text-[12px] font-medium text-ink-3">On earlier versions</h3>
          <div className="flex flex-col divide-y divide-line">
            {earlier.map((c) => (
              <CommentItem key={c.id} comment={c} me={me} moderator={false} clientView={clientView} highlight={focusId === c.id} />
            ))}
          </div>
        </section>
      )}
    </Sheet>
  );
}
