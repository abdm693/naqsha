/**
 * Compatibility barrel: the names older screens import from "@/app/ui/primitives".
 * New code should import from "@/app/ui" (see ui/README.md).
 */
import type { ReactNode } from "react";
import { CircleCheck, CircleX, TriangleAlert } from "lucide-react";
import { cn } from "@/app/lib/utils";
import { StatusChip, type StatusTone } from "./Chip";

export { Chip } from "./Chip";
export { Segmented } from "./Segmented";
export { Dialog } from "./Dialog";
export { Menu } from "./Menu";
export { Toaster } from "./Toast";
export { Spinner } from "./Spinner";

export type Tone = StatusTone;

/** A status pill: a 6px dot plus text on a soft tint. Same as StatusChip. */
export function Pill({ tone = "neutral", children, dot = true, className }: { tone?: Tone; children: ReactNode; dot?: boolean; className?: string }) {
  return (
    <StatusChip tone={tone} dot={dot} className={className}>
      {children}
    </StatusChip>
  );
}

/** Compliance status icon (pass / warn / fail). */
export function StatusIcon({ status, className }: { status: "pass" | "warn" | "fail"; className?: string }) {
  const Icon = status === "pass" ? CircleCheck : status === "warn" ? TriangleAlert : CircleX;
  return <Icon className={cn("size-4 shrink-0", status === "pass" ? "text-pass" : status === "warn" ? "text-warn" : "text-fail", className)} strokeWidth={1.75} />;
}

/** Small label above a value (sentence case, ink-3). */
export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("text-[12px] font-medium text-ink-3", className)}>{children}</span>;
}
