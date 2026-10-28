import { cn } from "@/app/lib/utils";

/** A thin arc that turns. Inherits the text colour. */
export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("size-4 shrink-0 animate-spin", className)}
      fill="none"
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.18" strokeWidth="2" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** The breathing 6px dot: "Naqsha is working on this". Accent by default. */
export function BreathingDot({ className, label }: { className?: string; label?: string }) {
  return (
    <span
      className={cn("inline-block size-1.5 shrink-0 rounded-full bg-accent animate-breathe", className)}
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}
