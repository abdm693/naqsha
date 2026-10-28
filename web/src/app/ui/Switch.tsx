import { motion } from "motion/react";
import { cn } from "@/app/lib/utils";
import { spring } from "./motion";

/** An on/off switch. Give it a visible label next to it, or an aria-label. */
export function Switch({
  checked,
  onChange,
  disabled,
  label,
  className,
  id,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  /** Accessible name when there is no <label htmlFor>. */
  label?: string;
  className?: string;
  id?: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-10 shrink-0 items-center rounded-full p-0.5 outline-none transition-colors duration-[160ms] focus-visible:shadow-focus disabled:opacity-45",
        checked ? "bg-accent" : "bg-surface-3 shadow-[inset_0_0_0_1px_var(--color-line-strong)]",
        className,
      )}
    >
      <motion.span
        layout
        transition={spring}
        className={cn("size-5 rounded-full bg-white shadow-e1", checked ? "ml-auto" : "")}
      />
    </button>
  );
}
