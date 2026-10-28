import type { ReactNode } from "react";
import { cn } from "@/app/lib/utils";

/**
 * Content area of a view that should stay clear of the floating chrome. The shell publishes:
 * - --chrome-top: the height of the top row (title capsule, view switch, people) plus its inset
 * - --dock-h: the dock's height plus its inset (0 when hidden)
 * Full-bleed views (3D, images) ignore this and let the chrome float over them.
 */
export function ViewFrame({ children, className, scroll }: { children: ReactNode; className?: string; scroll?: boolean }) {
  return (
    <div
      className={cn("absolute inset-0", scroll ? "overflow-y-auto" : "overflow-hidden", className)}
      style={{ paddingTop: "var(--chrome-top)", paddingBottom: "calc(var(--dock-h) + var(--chrome))" }}
    >
      {children}
    </div>
  );
}
