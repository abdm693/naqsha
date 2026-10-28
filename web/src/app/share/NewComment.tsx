/**
 * Writing a new comment: the snapshot and place, the text, Post. A visitor on a client link gives their name once,
 * on their first comment ("Guests give only a name"); it is remembered in this browser.
 */
import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { MapPin } from "lucide-react";
import { useProject } from "@/app/store/project";
import { Button } from "@/app/ui/Button";
import { Input } from "@/app/ui/Input";
import { ease } from "@/app/ui/motion";

export function NewComment({
  snapshot,
  place,
  askName,
  onCancel,
  onPost,
}: {
  snapshot?: string;
  place: string;
  /** Ask for the commenter's name first (client link, first comment). */
  askName?: boolean;
  onCancel: () => void;
  onPost: (text: string) => Promise<boolean>;
}) {
  const guestName = useProject((s) => s.guestName);
  const setGuestName = useProject((s) => s.setGuestName);
  const [name, setName] = useState(guestName ?? "");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [nameError, setNameError] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const needsName = askName && !guestName;

  useEffect(() => {
    const t = setTimeout(() => (needsName ? nameRef.current : textRef.current)?.focus(), 80);
    return () => clearTimeout(t);
  }, [needsName]);

  const post = async () => {
    if (busy || !text.trim()) return;
    if (needsName) {
      if (!name.trim()) {
        setNameError(true);
        nameRef.current?.focus();
        return;
      }
      setGuestName(name);
    }
    setBusy(true);
    const ok = await onPost(text.trim());
    setBusy(false);
    if (ok) setText("");
  };

  return (
    <motion.div
      role="dialog"
      aria-label="New comment"
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: 0.24, ease: ease.out } }}
      exit={{ opacity: 0, y: 6, transition: { duration: 0.16, ease: ease.exit } }}
      onKeyDown={(e) => {
        if (e.key === "Escape") { e.stopPropagation(); onCancel(); }
      }}
      className="pointer-events-auto w-[min(380px,calc(100vw-24px))] overflow-hidden rounded-[24px] bg-surface shadow-e3"
    >
      {snapshot && (
        <div className="relative">
          <img src={snapshot} alt="" className="aspect-[16/7] w-full object-cover" />
          <span className="absolute left-3 top-3 inline-flex max-w-[85%] items-center gap-1.5 rounded-full bg-ink/80 px-2.5 py-1 text-[12px] font-medium text-white backdrop-blur">
            <MapPin className="size-3.5 shrink-0" strokeWidth={2} />
            <span className="truncate">{place}</span>
          </span>
        </div>
      )}
      <div className="flex flex-col gap-3 p-4">
        {!snapshot && <p className="flex items-center gap-1.5 text-[13px] font-medium text-ink-3"><MapPin className="size-3.5" strokeWidth={2} />{place}</p>}
        {needsName && (
          <Input
            ref={nameRef}
            label="Your name"
            hint="So the owner knows who wrote this. Asked once."
            value={name}
            onChange={(e) => { setName(e.target.value); setNameError(false); }}
            error={nameError ? "Add your name to post." : undefined}
            autoComplete="name"
            maxLength={60}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); textRef.current?.focus(); } }}
          />
        )}
        <textarea
          ref={textRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey || !e.shiftKey) && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void post();
            }
          }}
          rows={3}
          placeholder="What would you change here?"
          aria-label="Comment"
          className="w-full resize-none rounded-control border border-line-strong bg-surface px-3.5 py-2.5 text-[15px] leading-[22px] text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-4 focus:border-accent focus:shadow-focus"
        />
        <div className="flex justify-end gap-2">
          <Button variant="quiet" size="sm" onClick={onCancel}>Cancel</Button>
          <Button variant="ink" size="sm" onClick={() => void post()} disabled={!text.trim()} loading={busy}>Post</Button>
        </div>
      </div>
    </motion.div>
  );
}
