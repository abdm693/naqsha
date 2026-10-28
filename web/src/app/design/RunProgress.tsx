/**
 * Progress of a design run as four named stages, Plan · Check · Review · Build, with one plain line of
 * narration ("Fixing 2 issues") and the time so far. Not a console: no code, no ids, no character counts.
 */
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/app/lib/utils";
import { BreathingDot, EASE_OUT } from "./kit";
import { narration, type Run } from "./flow";
import { STAGES, fixLoopLine, namedStage } from "./words";

function clock(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function useNow(active: boolean, every = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(t);
  }, [active, every]);
  return now;
}

/** The 2px accent hairline at the top of a view while Naqsha works. */
export function WorkingHairline({ active }: { active: boolean }) {
  return (
    <AnimatePresence>
      {active && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="pointer-events-none absolute inset-x-0 top-0 z-30 h-[2px] overflow-hidden bg-accent/15"
          aria-hidden
        >
          <div className="absolute inset-y-0 -left-1/3 w-1/3 animate-[hairline_1.6s_cubic-bezier(.32,.72,0,1)_infinite] bg-accent" />
          <style>{`@keyframes hairline{from{transform:translateX(0)}to{transform:translateX(400%)}}`}</style>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function StageStrip({ run, tone = "light" }: { run: Run; tone?: "light" | "hud" }) {
  const current = namedStage(run.stage);
  // Never step back: a fix after the review is still the review stage (the strip only moves forward).
  const idx = Math.max(current ? STAGES.findIndex((s) => s.id === current) : -1, ...run.reached.map((r) => STAGES.findIndex((s) => s.id === r)));
  const running = run.status === "running";
  return (
    <ol className="flex items-center gap-1.5" aria-label="Design progress">
      {STAGES.map((s, i) => {
        const done = !running ? run.status === "done" || i < idx : i < idx;
        const active = running && i === idx;
        return (
          <li key={s.id} className="flex items-center gap-1.5">
            {i > 0 && <span className={cn("h-px w-4 sm:w-6", done || active ? (tone === "light" ? "bg-ink/40" : "bg-white/40") : tone === "light" ? "bg-line-strong" : "bg-white/15")} aria-hidden />}
            <span
              className={cn(
                "inline-flex items-center gap-1.5 text-[13px] font-medium",
                active ? "text-accent" : done ? (tone === "light" ? "text-ink" : "text-hud-ink") : tone === "light" ? "text-ink-4" : "text-hud-ink-2/60",
                active && tone === "hud" && "text-hud-accent",
              )}
              aria-current={active ? "step" : undefined}
            >
              {active ? (
                <BreathingDot className={tone === "hud" ? "bg-hud-accent" : undefined} />
              ) : (
                <span className={cn("size-1.5 rounded-full", done ? (tone === "light" ? "bg-ink" : "bg-hud-ink") : tone === "light" ? "bg-line-strong" : "bg-white/20")} />
              )}
              {s.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** A floating card: the stage strip, the narration line, the fix loop and the clock. */
export function RunCard({ run, className, onRetry }: { run: Run; className?: string; onRetry?: () => void }) {
  const running = run.status === "running";
  const now = useNow(running);
  const line = narration(run) ?? (run.status === "error" ? "The design stopped." : run.status === "done" ? "Done" : "");
  const loop = fixLoopLine(run.failures);
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: EASE_OUT }}
      className={cn("rounded-card bg-surface/95 px-4 py-3 shadow-e2 backdrop-blur", className)}
      role="status"
      aria-live="polite"
    >
      <StageStrip run={run} />
      <div className="mt-2 flex items-baseline justify-between gap-4">
        <AnimatePresence mode="wait" initial={false}>
          <motion.p
            key={line}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            className={cn("text-[15px] leading-snug", run.status === "error" ? "text-fail" : "text-ink")}
          >
            {line}
          </motion.p>
        </AnimatePresence>
        {running && !run.resumed && <span className="shrink-0 font-mono text-[12px] tabular-nums text-ink-3">{clock(now - run.startedAt)}</span>}
      </div>
      {(loop || run.status === "error") && (
        <div className="mt-1 flex items-center justify-between gap-3">
          {loop && <p className="font-mono text-[12px] tabular-nums text-ink-3">{loop}</p>}
          {run.status === "error" && onRetry && (
            <button type="button" onClick={onRetry} className="text-[13px] font-medium text-accent hover:underline">
              Try again
            </button>
          )}
        </div>
      )}
    </motion.div>
  );
}
