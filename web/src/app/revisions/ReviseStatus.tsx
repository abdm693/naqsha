/**
 * A compact, live card for a revision in progress (used over the Plan and the House): what was asked,
 * the current plain-language step, and a way to follow it in Revisions.
 */
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, X } from "lucide-react";
import { cn } from "@/app/lib/utils";
import { BreathingDot, EASE_OUT } from "@/app/design/kit";
import { narration, type Run } from "@/app/design/flow";

export function ReviseStatus({ run, onOpen, onDismiss, tone = "light", className }: { run: Run; onOpen: () => void; onDismiss?: () => void; tone?: "light" | "hud"; className?: string }) {
  const running = run.status === "running";
  const asked = run.instruction ? `“${run.instruction}”` : run.commentIds?.length ? `${run.commentIds.length} comment${run.commentIds.length === 1 ? "" : "s"}` : "your changes";
  const line = running ? narration(run) : run.status === "done" ? (run.version ? `Version ${run.version.n} is ready` : "Done") : run.error ?? "The revision stopped";
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.32, ease: EASE_OUT }}
      className={cn("flex max-w-[min(520px,calc(100vw-32px))] items-center gap-3 rounded-card py-2.5 pl-4 pr-2", tone === "light" ? "bg-surface/95 shadow-e2 backdrop-blur" : "glass-hud", className)}
      role="status"
      aria-live="polite"
    >
      {running ? <BreathingDot className={tone === "hud" ? "bg-hud-accent" : undefined} /> : <span className={cn("size-1.5 shrink-0 rounded-full", run.status === "done" ? "bg-pass" : "bg-fail")} />}
      <div className="min-w-0 flex-1">
        <p className={cn("truncate text-[12px]", tone === "light" ? "text-ink-3" : "text-hud-ink-2")}>Revising from {asked}</p>
        <AnimatePresence mode="wait" initial={false}>
          <motion.p key={line} initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -3 }} transition={{ duration: 0.18 }} className="truncate text-[14px] leading-snug">
            {line}
          </motion.p>
        </AnimatePresence>
      </div>
      <button
        type="button"
        onClick={onOpen}
        className={cn("inline-flex h-8 shrink-0 items-center gap-1 rounded-full px-3 text-[13px] font-medium outline-none focus-visible:shadow-focus", tone === "light" ? "text-accent hover:bg-accent-soft" : "text-hud-accent hover:bg-white/10")}
      >
        {running ? "Follow" : "What changed"}
        <ArrowRight className="size-3.5" strokeWidth={1.75} />
      </button>
      {!running && onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className={cn("grid size-8 shrink-0 place-items-center rounded-full", tone === "light" ? "text-ink-3 hover:bg-surface-2" : "text-hud-ink-2 hover:bg-white/10")}>
          <X className="size-3.5" strokeWidth={1.75} />
        </button>
      )}
    </motion.div>
  );
}
