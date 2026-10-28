/** A comment pinned in the 3D view: where it is, a snapshot, a few quick starts and the note. */
import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { MapPin, X } from "lucide-react";
import type { BuildingPlan } from "@contracts/plan";
import type { Comment, CommentAnchor } from "@contracts/api-types";
import { Button, Chip, EASE_OUT, IconButton } from "@/app/design/kit";
import { inSentence, sentenceCase } from "@/app/plan/model";
import { anchorLabel, cleanAnchorLabel } from "./snapshot";

export interface CommentDraft {
  anchor: CommentAnchor;
  camera: Comment["camera"];
  snapshot: string;
}

/** Quick starts that name what was clicked ("Make the kitchen bigger"), with the caret left where you type next. */
function quickStarts(anchor: CommentAnchor, plan?: BuildingPlan): string[] {
  const room = anchor.room ? plan?.rooms.find((r) => r.id === anchor.room)?.name : undefined;
  // "Make the TV lounge bigger", "More light in Bedroom 2": numbered rooms read as names.
  const r = room ? (/\d/.test(room) ? sentenceCase(room) : `the ${inSentence(room)}`) : undefined;
  // The engine's "Roof (roof)" reads "the roof": no "(…)", and never the room's own name again.
  const clean = cleanAnchorLabel(anchor.label);
  const label = clean && clean !== room && !/^(wall|floor|ceiling|slab)$/i.test(clean) ? inSentence(clean) : undefined;
  const out: string[] = [];
  if (r) out.push(`Make ${r} bigger`, `More light in ${r}`);
  if (label) out.push(`Move the ${label} `, `Change the ${label} to `);
  else if (r) out.push(`Change the finishes in ${r} to `);
  if (!out.length) out.push("Make this bigger", "More light here", "Change this to ");
  return out.slice(0, 4);
}

export function Composer({ draft, plan, onCancel, onSave }: { draft: CommentDraft; plan?: BuildingPlan; onCancel: () => void; onSave: (text: string) => Promise<boolean> }) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const where = anchorLabel(draft.anchor, plan);
  const save = async () => {
    if (!text.trim() || saving) return;
    setSaving(true);
    await onSave(text.trim());
    setSaving(false);
  };
  const start = (q: string) => {
    setText(q);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(q.length, q.length);
    });
  };
  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.98 }}
      transition={{ duration: 0.32, ease: EASE_OUT }}
      className="w-[min(400px,calc(100vw-24px))] overflow-hidden rounded-panel bg-surface text-ink shadow-e3"
      role="dialog"
      aria-label="New comment"
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
        e.stopPropagation();
      }}
    >
      <div className="relative">
        {draft.snapshot ? <img src={draft.snapshot} alt="" className="aspect-[16/8] w-full object-cover" /> : <div className="aspect-[16/8] w-full bg-hud" />}
        <span className="glass-hud absolute left-3 top-3 inline-flex max-w-[80%] items-center gap-1.5 rounded-full px-2.5 py-1 text-[12.5px]">
          <MapPin className="size-3.5 shrink-0" strokeWidth={2} />
          <span className="truncate">{where}</span>
        </span>
        <IconButton label="Cancel" variant="hud" size={32} onClick={onCancel} className="absolute right-2.5 top-2.5">
          <X className="size-3.5" strokeWidth={1.75} />
        </IconButton>
      </div>
      <div className="p-4">
        <div className="flex flex-wrap gap-1.5">
          {quickStarts(draft.anchor, plan).map((q) => (
            <Chip key={q} size="sm" onClick={() => start(q)}>
              {q.trim()}
            </Chip>
          ))}
        </div>
        <textarea
          ref={ref}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void save();
            }
          }}
          rows={3}
          placeholder="What would you change here?"
          className="mt-3 w-full resize-none rounded-control bg-surface-2 px-3 py-2.5 text-body text-ink outline-none placeholder:text-ink-4 focus:shadow-focus"
        />
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-[12.5px] text-ink-3">Naqsha reads every comment when you revise.</span>
          <Button variant="primary" size="sm" disabled={!text.trim()} loading={saving} onClick={() => void save()}>
            Pin it
          </Button>
        </div>
      </div>
    </motion.div>
  );
}
