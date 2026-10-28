import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/app/lib/utils";
import { useToasts } from "@/app/store/toast";
import { ease } from "./motion";
import { useModals } from "./overlay";

/**
 * Renders the one current toast, centred 12px above the dock (the project shell publishes the dock's height
 * as --dock-h; elsewhere it sits 24px from the bottom). Mount once, at the app root.
 * Push toasts with `toast.show / toast.undo / toast.error` from "@/app/store/toast".
 */
export function Toaster() {
  const current = useToasts((s) => s.current);
  const dismiss = useToasts((s) => s.dismiss);
  // Over a dialog, the toast sits at the bottom edge, clear of the dialog's buttons.
  const modal = useModals((s) => s.count > 0);
  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-[80] flex justify-center px-4"
      style={{ bottom: modal ? "calc(16px + var(--safe-b))" : "calc(max(var(--dock-h), 12px) + 12px + var(--safe-b))" }}
      aria-live="polite"
      role="status"
    >
      <AnimatePresence mode="popLayout">
        {current && (
          <motion.div
            key={current.id}
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: 0.24, ease: ease.out } }}
            exit={{ opacity: 0, y: 4, transition: { duration: 0.16, ease: ease.exit } }}
            className={cn(
              "pointer-events-auto flex min-h-11 max-w-[min(560px,100%)] items-center gap-3 bg-ink/92 py-2.5 pl-5 text-white shadow-e3 backdrop-blur-md",
              current.detail ? "rounded-[22px]" : "rounded-full",
              current.action ? "pr-2" : "pr-5",
            )}
          >
            {current.tone === "error" && <span className="size-1.5 shrink-0 rounded-full bg-[#FF7A70]" aria-hidden />}
            <div className="min-w-0">
              <p className="text-[14px] font-medium leading-5">{current.text}</p>
              {current.detail && <p className="mt-0.5 text-[13px] leading-[18px] text-white/70">{current.detail}</p>}
            </div>
            {current.action && (
              <button
                type="button"
                onClick={() => {
                  current.action?.run();
                  dismiss(current.id);
                }}
                className="h-8 shrink-0 rounded-full px-3.5 text-[14px] font-medium text-hud-accent outline-none transition-colors hover:bg-white/10 focus-visible:shadow-[0_0_0_2px_var(--color-hud-accent)]"
              >
                {current.action.label}
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
