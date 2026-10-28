/**
 * View switch (DESIGN.md §5.2), top-centre: Brief · Concepts · Plan · House. Views of one home, not steps.
 * Only views that exist are shown; one being made carries a breathing accent dot. ⌘1–4 switch views (ProjectShell).
 */
import { useNavigate } from "react-router-dom";
import type { Project } from "@contracts/api-types";
import { cn } from "@/app/lib/utils";
import { VIEWS, viewAvailable, type SwitchViewId, type ViewId } from "@/app/lib/views";
import { useProject } from "@/app/store/project";
import { Segmented } from "@/app/ui/Segmented";

export function useBusyViews(): Partial<Record<SwitchViewId, boolean>> {
  const concepts = useProject((s) => !!s.conceptRun?.running);
  const design = useProject((s) => s.design.status === "running");
  const revise = useProject((s) => s.revise.status === "running");
  const intake = useProject((s) => s.intakeBusy);
  return { brief: intake, concepts, plan: design, house: revise };
}

export function ViewSwitch({ project, view, tone, fill }: { project: Project; view: ViewId; tone: "light" | "hud"; fill?: boolean }) {
  const navigate = useNavigate();
  const busy = useBusyViews();
  const options: { value: ViewId; label: string; busy: boolean }[] = VIEWS.filter((v) => viewAvailable(project, v.id) || v.id === view).map((v) => ({
    value: v.id,
    label: v.label,
    busy: !!busy[v.id as SwitchViewId] && v.id !== view,
  }));
  // Versions isn't one of the four views, but while it is on screen the switch says so: an active item, never none.
  if (view === "revisions") options.push({ value: "revisions", label: "Versions", busy: false });
  // One place only (a brand-new home): nothing to switch between.
  if (options.length < 2) return null;
  return (
    <div className={cn("pointer-events-auto rounded-full", tone === "hud" ? "glass-hud" : "glass-light", fill && "w-full")}>
      <Segmented<ViewId>
        label="Views of this home"
        value={view}
        options={options}
        onChange={(v) => {
          // Day or night carries across the views (Concepts and House read it; the hidden House keeps it).
          const light = new URLSearchParams(window.location.search).get("light");
          navigate(`/app/p/${project.id}/${v}${light ? `?light=${light}` : ""}`);
        }}
        tone={tone === "hud" ? "hud" : "light"}
        className={cn("h-12 bg-transparent p-1.5", fill ? "w-full [&>button]:px-2" : "[&>button]:px-4")}
        fill={fill}
      />
    </div>
  );
}
