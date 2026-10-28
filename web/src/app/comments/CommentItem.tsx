/**
 * One comment and its thread: the author's avatar in their role's hue, name, role and time; the pin number shared
 * by Plan and House; Naqsha's answer with its outcome; replies; inline edit (caret at the end) and delete with undo.
 */
import { forwardRef, useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Check, Ellipsis, Eye, Pencil, RotateCcw, Trash2 } from "lucide-react";
import type { Comment } from "@contracts/api-types";
import { assetUrl } from "@/api/client";
import { cn, relativeTime } from "@/app/lib/utils";
import { useProject } from "@/app/store/project";
import { useMembers } from "@/app/store/members";
import { Avatar, authorColor } from "@/app/ui/Avatar";
import { Button } from "@/app/ui/Button";
import { StatusChip } from "@/app/ui/Chip";
import { Menu, type MenuItem } from "@/app/ui/Menu";
import { ease } from "@/app/ui/motion";
import { authorOf, isMine, ROLE_LABEL, STATUS_LABEL, STATUS_TONE } from "./model";

export interface Me { ids: string[]; name?: string | null }

export function PinNumber({ n, hueKey, selected, className }: { n: number; hueKey?: string | null; selected?: boolean; className?: string }) {
  return (
    <span
      className={cn(
        "inline-grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold tabular text-white ring-2 ring-surface",
        selected && "shadow-[0_0_0_4px_var(--color-accent)]",
        className,
      )}
      style={{ background: authorColor(hueKey) }}
      aria-label={`Pin ${n}`}
    >
      {n}
    </span>
  );
}

export const CommentItem = forwardRef<
  HTMLElement,
  {
    comment: Comment;
    number?: number;
    me: Me;
    /** Owner or Team: resolve and reopen, delete anyone's. */
    moderator: boolean;
    /** The client view: reply only. */
    clientView?: boolean;
    highlight?: boolean;
    onShow?: (c: Comment) => void;
    /** Apply mode: a checkbox picks it for the next revision. */
    selectable?: boolean;
    selected?: boolean;
    onToggle?: () => void;
  }
>(function CommentItem({ comment: c, number, me, moderator, clientView, highlight, onShow, selectable, selected, onToggle }, ref) {
  const updateComment = useProject((s) => s.updateComment);
  const deleteComment = useProject((s) => s.deleteComment);
  const reply = useProject((s) => s.replyToComment);
  // The owner is named when the project knows their name (older comments were saved as just "Owner").
  const ownerName = useMembers((s) => s.members.find((m) => m.role === "owner")?.name?.trim());
  const raw = authorOf(c);
  const author = raw.role === "owner" && raw.name.trim().toLowerCase() === "owner" && ownerName ? { ...raw, name: ownerName } : raw;
  const mine = isMine(raw, me, c.mine);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(c.text);
  const [replyText, setReplyText] = useState("");
  const [replying, setReplying] = useState(false);
  const [sending, setSending] = useState(false);
  const [snap, setSnap] = useState<"loading" | "loaded" | "failed">("loading");
  const editRef = useRef<HTMLTextAreaElement>(null);
  const replyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (!editing) setText(c.text); }, [c.text, editing]);
  // Edit opens with the caret at the end, not with everything selected.
  useLayoutEffect(() => {
    const el = editRef.current;
    if (!editing || !el) return;
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
    el.style.height = "auto";
    el.style.height = `${Math.min(200, el.scrollHeight + 2)}px`;
  }, [editing]);
  useEffect(() => { if (replying) replyRef.current?.focus(); }, [replying]);

  const save = () => {
    const t = text.trim();
    setEditing(false);
    if (t && t !== c.text) void updateComment(c.id, { text: t });
    else setText(c.text);
  };
  const sendReply = async () => {
    const t = replyText.trim();
    if (!t || sending) return;
    setSending(true);
    const ok = await reply(c.id, t);
    setSending(false);
    if (ok) {
      setReplyText("");
      setReplying(false);
    }
  };

  const items: MenuItem[] = [];
  if (onShow) items.push({ label: "Show where", icon: <Eye />, onSelect: () => onShow(c) });
  if (!clientView && mine) items.push({ label: "Edit", icon: <Pencil />, onSelect: () => setEditing(true) });
  if (!clientView && moderator) {
    items.push(
      c.status === "open"
        ? { label: "Mark as done", icon: <Check />, onSelect: () => void updateComment(c.id, { status: "resolved" }) }
        : { label: "Reopen", icon: <RotateCcw />, onSelect: () => void updateComment(c.id, { status: "open" }) },
    );
  }
  if (!clientView && (mine || moderator)) {
    items.push({ separator: true }, { label: "Delete", icon: <Trash2 />, danger: true, onSelect: () => void deleteComment(c.id) });
  }

  const replies = c.replies ?? [];
  const resolutionInThread = !!c.resolution && replies.some((r) => r.author.role === "agent" && r.text.trim() === c.resolution?.trim());

  return (
    <motion.article
      ref={ref}
      layout="position"
      initial={false}
      animate={highlight ? { backgroundColor: ["rgba(237,240,255,1)", "rgba(237,240,255,0)"] } : undefined}
      transition={{ duration: 1.6, ease: ease.out }}
      className={cn("group/comment relative rounded-[16px] px-3 py-3 -mx-3", selectable && "pl-11")}
      aria-label={`Comment by ${author.name}`}
    >
      {selectable && (
        <label className="absolute left-2 top-3.5 grid size-7 cursor-pointer place-items-center">
          <input
            type="checkbox"
            checked={!!selected}
            onChange={onToggle}
            className="peer sr-only"
            aria-label={`Include "${c.text.slice(0, 40)}" in the next revision`}
          />
          <span
            className={cn(
              "grid size-[18px] place-items-center rounded-[6px] transition-colors peer-focus-visible:shadow-focus",
              selected ? "bg-accent text-white" : "bg-surface shadow-[inset_0_0_0_1.5px_var(--color-line-strong)]",
            )}
          >
            {selected && <Check className="size-3" strokeWidth={3} />}
          </span>
        </label>
      )}

      <header className="flex items-start gap-2.5">
        <Avatar name={author.name} role={author.role} hueKey={c.author?.id || c.author?.name} size={28} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span className="truncate text-[14px] font-semibold text-ink">{mine ? "You" : author.name}</span>
            <span className="shrink-0 text-[12px] text-ink-3">
              {[roleCaption(author), relativeTime(c.created_at)].filter(Boolean).join(" · ")}
            </span>
          </div>
        </div>
        {number !== undefined && <PinNumber n={number} hueKey={c.author?.id || c.author?.name} />}
        {items.length > 0 && (
          <Menu
            width={196}
            label="Comment actions"
            trigger={({ open, toggle }) => (
              <button
                type="button"
                onClick={toggle}
                aria-label="Comment actions"
                aria-expanded={open}
                className={cn(
                  "-mr-1 grid size-7 shrink-0 place-items-center rounded-full text-ink-3 outline-none transition-[opacity,background-color] hover:bg-surface-2 hover:text-ink focus-visible:opacity-100 focus-visible:shadow-focus",
                  open ? "bg-surface-2 opacity-100" : "opacity-100 sm:opacity-0 sm:group-hover/comment:opacity-100",
                )}
              >
                <Ellipsis className="size-4" strokeWidth={1.75} />
              </button>
            )}
            items={items}
          />
        )}
      </header>

      <div className="mt-2 pl-[38px]">
        {editing ? (
          <div>
            <textarea
              ref={editRef}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = `${Math.min(200, e.target.scrollHeight + 2)}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setText(c.text); setEditing(false); }
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); }
              }}
              aria-label="Edit comment"
              rows={2}
              className="w-full resize-none rounded-control border border-accent bg-surface px-3 py-2 text-[14px] leading-5 text-ink shadow-focus outline-none"
            />
            <div className="mt-2 flex justify-end gap-1.5">
              <Button size="sm" variant="quiet" onClick={() => { setText(c.text); setEditing(false); }}>Cancel</Button>
              <Button size="sm" variant="secondary" onClick={save} disabled={!text.trim()}>Save</Button>
            </div>
          </div>
        ) : (
          <p className="whitespace-pre-wrap text-[14px] leading-5 text-ink">{c.text}</p>
        )}

        {/* The snapshot shows only once its image has loaded: never an empty box (and nothing when it fails). */}
        {c.snapshot_url && !editing && snap !== "failed" && (
          <button
            type="button"
            onClick={() => onShow?.(c)}
            disabled={!onShow}
            className={cn("mt-2 overflow-hidden rounded-[12px] shadow-e1 outline-none focus-visible:shadow-focus disabled:cursor-default", snap === "loaded" ? "block" : "absolute h-0 w-0 opacity-0")}
            aria-label="Show where this comment was pinned"
            tabIndex={snap === "loaded" ? undefined : -1}
            aria-hidden={snap === "loaded" ? undefined : true}
          >
            <img src={assetUrl(c.snapshot_url)} alt="" loading="lazy" onLoad={() => setSnap("loaded")} onError={() => setSnap("failed")} className="aspect-[16/9] w-40 object-cover" />
          </button>
        )}

        {c.kind === "approval" ? (
          <div className="mt-2">
            <StatusChip tone="pass">✓ Approved by {author.name}</StatusChip>
          </div>
        ) : c.status !== "open" && (
          <div className="mt-2">
            <StatusChip tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</StatusChip>
          </div>
        )}

        {/* Naqsha's answer (from servers that don't post it as a reply) */}
        {c.resolution && !resolutionInThread && (
          <Reply author={{ id: "naqsha", name: "Naqsha", role: "agent" }} text={c.resolution} rejected={c.status === "rejected"} />
        )}
        {replies.map((r) => (
          <Reply key={r.id} author={r.author} text={r.text} at={r.created_at} mine={isMine(r.author, me, r.mine)} rejected={r.author.role === "agent" && c.status === "rejected"} />
        ))}

        {replying ? (
          <div className="mt-2.5 flex items-end gap-1.5 rounded-[18px] border border-line-strong bg-surface p-1 pl-3 focus-within:border-accent focus-within:shadow-focus">
            <textarea
              ref={replyRef}
              value={replyText}
              rows={1}
              onChange={(e) => {
                setReplyText(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = `${Math.min(140, e.target.scrollHeight)}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void sendReply(); }
                if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setReplying(false); setReplyText(""); }
              }}
              placeholder="Reply"
              aria-label="Reply"
              className="min-h-8 flex-1 resize-none bg-transparent py-1.5 text-[14px] leading-5 text-ink outline-none placeholder:text-ink-4"
            />
            <Button size="sm" variant={replyText.trim() ? "ink" : "quiet"} onClick={() => void sendReply()} disabled={!replyText.trim()} loading={sending}>
              Send
            </Button>
          </div>
        ) : (
          !editing && (
            <button
              type="button"
              onClick={() => setReplying(true)}
              className="mt-1.5 rounded-full px-0 py-1 text-[13px] font-medium text-ink-3 outline-none transition-colors hover:text-ink focus-visible:shadow-focus"
            >
              Reply
            </button>
          )
        )}
      </div>
    </motion.article>
  );
});

function Reply({
  author,
  text,
  at,
  mine,
  rejected,
}: {
  author: { id: string; name: string; role: string };
  text: string;
  at?: string;
  mine?: boolean;
  rejected?: boolean;
}) {
  const agent = author.role === "agent";
  return (
    <div className="mt-3 flex gap-2">
      <Avatar name={author.name} role={author.role as never} hueKey={author.id || author.name} size={24} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[13px] font-semibold text-ink">{mine ? "You" : author.name}</span>
          <span className="text-[12px] text-ink-3">
            {[agent ? null : roleCaption(author), at ? relativeTime(at) : null].filter(Boolean).join(" · ")}
          </span>
        </div>
        <p className={cn("mt-0.5 whitespace-pre-wrap text-[14px] leading-5", rejected ? "text-ink-2" : "text-ink")}>{text}</p>
      </div>
    </div>
  );
}

/** "Client", but nothing when the name already says the role ("Owner · Owner" reads as a stutter). */
function roleCaption(a: { name: string; role: string }): string | null {
  const label = ROLE_LABEL[a.role] ?? a.role;
  return a.name.trim().toLowerCase() === label.toLowerCase() ? null : label;
}
