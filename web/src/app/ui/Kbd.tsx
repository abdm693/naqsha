import type { ReactNode } from "react";
import { cn } from "@/app/lib/utils";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** "mod" renders ⌘ on Apple devices and Ctrl elsewhere. */
export function modKey(): string {
  return isMac ? "⌘" : "Ctrl";
}

/** A keyboard key. Pass several children for a chord: <Kbd>mod</Kbd> or <Kbd keys={["mod", "K"]} />. */
export function Kbd({ children, keys, tone = "light", className }: { children?: ReactNode; keys?: string[]; tone?: "light" | "hud"; className?: string }) {
  const list = keys ?? [children];
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)}>
      {list.map((k, i) => (
        <kbd
          key={i}
          className={cn(
            "inline-grid h-5 min-w-5 place-items-center rounded-[6px] px-1 font-sans text-[12px] font-medium leading-none",
            tone === "light" ? "bg-surface text-ink-3 shadow-[inset_0_0_0_1px_var(--color-line),0_1px_0_var(--color-line)]" : "bg-white/10 text-hud-ink-2",
          )}
        >
          {k === "mod" ? modKey() : k}
        </kbd>
      ))}
    </span>
  );
}
