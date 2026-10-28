/**
 * Photos of the house and the concept check (House view).
 *
 * Photos: the viewer captures the 3D model from four fixed cameras (front, street corner, garden, aerial) and the server
 * turns each capture into a photograph that keeps the geometry and the camera and takes its materials from the chosen
 * concept (POST …/views). Every photo starts from the model, so every angle shows this design. They are saved on the
 * version (`version.views`); anyone can look, editors make and remake them.
 *
 * Concept check: the model's front view against the chosen concept, feature by feature (POST …/match). Missing
 * features come back as rewritten facade sections, which replace the version's sections and rebuild in the viewer.
 *
 * Jobs live in a small store keyed by version id, so a run keeps going (and its result stays) while the panel is closed
 * or the view changes.
 */
import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { AnimatePresence, motion } from "motion/react";
import { ChevronLeft, ChevronRight, Download, Images, RotateCw, ScanSearch, X } from "lucide-react";
import type { ConceptMatch, HouseView, Project, Version } from "@contracts/api-types";
import type { BuildingPlan } from "@contracts/plan";
import type { ViewerHandle } from "@/viewer/HouseViewer";
import { api, assetUrl, errorMessage } from "@/api/client";
import { cn } from "@/app/lib/utils";
import { useProject } from "@/app/store/project";
import { flow } from "@/app/design/flow";
import { BreathingDot, Button, IconButton, Popover, Segmented, Shimmer, notify } from "@/app/design/kit";
import { sectionPhrase } from "@/app/design/words";

// ── Jobs ────────────────────────────────────────────────────────────────────────────────────────────

export const ANGLES = [
  { angle: "front", label: "Front" },
  { angle: "corner", label: "Street corner" },
  { angle: "garden", label: "Garden" },
  { angle: "aerial", label: "Aerial" },
] as const;

const labelOf = (angle: string, fallback?: string) => ANGLES.find((a) => a.angle === angle)?.label ?? fallback ?? angle;

interface Shot {
  angle: string;
  label: string;
  /** The 3D capture the photo is made from (shown while the photo is drawing). */
  capture?: string;
  view?: HouseView;
  failed?: string;
}

interface PhotoJob {
  status: "capturing" | "drawing" | "done" | "error";
  shots: Shot[];
  startedAt: number;
  error?: string;
}

interface MatchJob {
  status: "capturing" | "checking" | "refitting" | "rechecking" | "done" | "error";
  message?: string;
  match?: ConceptMatch;
  /** Sections rewritten so far by the refit. */
  refit: string[];
  /** The rebuilt facade was checked again (the match is the new score). */
  rechecked?: boolean;
  error?: string;
}

const useJobs = create<{ photos: Record<string, PhotoJob>; match: Record<string, MatchJob> }>(() => ({ photos: {}, match: {} }));

const patchPhotos = (vid: string, patch: Partial<PhotoJob> | ((j: PhotoJob) => Partial<PhotoJob>)) => {
  const cur = useJobs.getState().photos[vid];
  if (!cur) return;
  useJobs.setState((s) => ({ photos: { ...s.photos, [vid]: { ...cur, ...(typeof patch === "function" ? patch(cur) : patch) } } }));
};
const patchMatch = (vid: string, patch: Partial<MatchJob> | ((j: MatchJob) => Partial<MatchJob>)) => {
  const cur = useJobs.getState().match[vid];
  if (!cur) return;
  useJobs.setState((s) => ({ match: { ...s.match, [vid]: { ...cur, ...(typeof patch === "function" ? patch(cur) : patch) } } }));
};

const photosRunning = (j?: PhotoJob) => !!j && (j.status === "capturing" || j.status === "drawing");
const matchRunning = (j?: MatchJob) => !!j && (j.status === "capturing" || j.status === "checking" || j.status === "refitting" || j.status === "rechecking");

/** Patch the cached version (the House view shows it, so the viewer rebuilds what changed). */
function patchVersion(vid: string, patch: (v: Version) => Partial<Version>) {
  const v = useProject.getState().versions[vid];
  if (v) flow.cacheVersion({ ...v, ...patch(v) });
}

/** The server's copy (with what the run saved), keeping nothing stale. */
async function refetchVersion(pid: string, vid: string) {
  try {
    const v = await api.getVersion(pid, vid);
    if (useProject.getState().pid === pid) flow.cacheVersion(v);
  } catch {
    /* keep the local copy */
  }
}

/** Capture the four angles and turn each into a photograph; resolves when the last one is back. */
export async function makePhotos(pid: string, vid: string, viewer: () => ViewerHandle | null): Promise<void> {
  if (photosRunning(useJobs.getState().photos[vid])) return;
  useJobs.setState((s) => ({ photos: { ...s.photos, [vid]: { status: "capturing", shots: [], startedAt: Date.now() } } }));
  try {
    const v = viewer();
    const caps = v ? await v.captureAngles(ANGLES.map((a) => a.angle)) : [];
    if (!caps.length) throw new Error("The 3D view isn't ready yet. Try again once the house has built.");
    patchPhotos(vid, { status: "drawing", startedAt: Date.now(), shots: caps.map((c) => ({ angle: c.angle, label: c.label, capture: c.image })) });
    await api.views(pid, vid, { shots: caps.map((c) => ({ angle: c.angle, label: c.label, image_data_url: c.image })) }, {
      view: ({ index, view }) => patchPhotos(vid, (j) => ({ shots: j.shots.map((s, i) => (i === index ? { ...s, view, failed: undefined } : s)) })),
      "view.failed": ({ index, message }) => patchPhotos(vid, (j) => ({ shots: j.shots.map((s, i) => (i === index ? { ...s, failed: message } : s)) })),
    });
    const made = useJobs.getState().photos[vid]?.shots.filter((s) => s.view).map((s) => s.view!) ?? [];
    // Saved on the version: show them at once, then take the server's copy.
    if (made.length) patchVersion(vid, (cur) => ({ views: [...(cur.views ?? []).filter((x) => !made.some((m) => m.angle === x.angle)), ...made] }));
    patchPhotos(vid, { status: "done" });
    await refetchVersion(pid, vid);
  } catch (e) {
    patchPhotos(vid, { status: "error", error: errorMessage(e) });
  }
}

/**
 * Compare the model (front and street-corner captures) with the concept; with refit, rebuild the facade features that
 * are missing, wait for the viewer to rebuild them and check once more without refit, so the score shown is the rebuilt
 * house's. Resolves with the sections the refit rewrote (empty when nothing changed), or null when the check didn't run.
 */
export async function checkConcept(pid: string, vid: string, viewer: () => ViewerHandle | null, opts?: { quiet?: boolean }): Promise<string[] | null> {
  if (matchRunning(useJobs.getState().match[vid])) return null;
  const prev = useJobs.getState().match[vid];
  useJobs.setState((s) => ({ match: { ...s.match, [vid]: { status: "capturing", refit: [], match: prev?.match, message: "Looking at the house from the road…" } } }));

  /** Capture front + corner (after any rebuild has finished) and run one check. Resolves with the rewritten sections. */
  const pass = async (refit: boolean): Promise<string[]> => {
    const v = viewer();
    const caps = v ? await v.captureAngles(["front", "corner"]) : [];
    const front = caps.find((c) => c.angle === "front");
    if (!front) throw new Error("The 3D view isn't ready yet.");
    const extra = caps.filter((c) => c.angle !== "front").map((c) => c.image);
    if (refit) patchMatch(vid, { status: "checking", message: "Comparing the model with the concept…" });
    let seenMatch = false;
    let rewritten: string[] = [];
    await api.matchConcept(pid, vid, { image_data_url: front.image, ...(extra.length ? { extra_image_data_urls: extra } : {}), refit }, {
      stage: ({ message }) => {
        if (refit) patchMatch(vid, { message: plainStage(message, seenMatch), ...(seenMatch ? { status: "refitting" } : {}) });
      },
      match: ({ match }) => {
        seenMatch = true;
        patchMatch(vid, { match });
        patchVersion(vid, () => ({ concept_match: match }));
      },
      section: ({ section, index }) => {
        patchVersion(vid, (cur) => ({
          sections: cur.sections.some((s) => s.name === section.name)
            ? cur.sections.map((s) => (s.name === section.name ? section : s))
            : [...cur.sections.slice(0, index), section, ...cur.sections.slice(index)],
        }));
        patchMatch(vid, (j) => ({ refit: j.refit.includes(section.name) ? j.refit : [...j.refit, section.name] }));
      },
      done: (d) => {
        const { match: m, refit_sections } = d as { match?: ConceptMatch; refit_sections?: string[] };
        if (m) {
          patchMatch(vid, { match: m });
          patchVersion(vid, () => ({ concept_match: m }));
        }
        if (Array.isArray(refit_sections)) rewritten = refit_sections;
      },
    });
    return rewritten.length ? rewritten : refit ? useJobs.getState().match[vid]?.refit ?? [] : [];
  };

  try {
    const refit = await pass(true);
    if (refit.length) {
      // captureAngles waits for the viewer to finish rebuilding the rewritten sections before it captures
      patchMatch(vid, { status: "rechecking", message: "Checking the rebuilt facade…" });
      await refetchVersion(pid, vid);
      await pass(false);
      patchMatch(vid, { rechecked: true });
    }
    patchMatch(vid, { status: "done", message: undefined });
    await refetchVersion(pid, vid);
    return refit;
  } catch (e) {
    patchMatch(vid, { status: "error", message: undefined, error: errorMessage(e) });
    if (!opts?.quiet) notify.error("Couldn't check the house against the concept", e);
    return null;
  }
}

/** The server's stage line, trimmed of its ellipsis; ours when it has none. */
function plainStage(message: string | undefined, afterMatch: boolean) {
  const m = (message ?? "").trim();
  if (m) return m;
  return afterMatch ? "Rebuilding the parts that don't match yet…" : "Comparing the model with the concept…";
}

/** What the House view needs for one version: photos to show, the concept check, and whether either is running. */
export function useHouseExtras(version: Version | undefined) {
  const vid = version?.id ?? "";
  const photoJob = useJobs((s) => (vid ? s.photos[vid] : undefined));
  const matchJob = useJobs((s) => (vid ? s.match[vid] : undefined));
  const saved = version?.views ?? [];
  // A run in flight (or one that hasn't been saved back yet) wins over what the version carries.
  const live = photoJob && (photosRunning(photoJob) || (photoJob.status === "done" && !saved.length));
  const shots: Shot[] = live
    ? photoJob.shots
    : saved.filter((v) => v.angle !== "interior").map((v) => ({ angle: v.angle, label: labelOf(v.angle, v.label), view: v, capture: v.model_url }));
  return {
    shots,
    photoJob,
    photosBusy: photosRunning(photoJob),
    match: matchJob?.match ?? version?.concept_match,
    matchJob,
    matchBusy: matchRunning(matchJob),
  };
}

// ── Photos panel ────────────────────────────────────────────────────────────────────────────────────

export function PhotosPanel({
  shots,
  job,
  canEdit,
  hasConcept,
  onMake,
  onClose,
}: {
  shots: Shot[];
  job?: PhotoJob;
  canEdit: boolean;
  hasConcept: boolean;
  onMake: () => void;
  onClose: () => void;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const [secs, setSecs] = useState(0);
  const busy = photosRunning(job);
  useEffect(() => {
    if (!busy || !job) return;
    const t = setInterval(() => setSecs(Math.floor((Date.now() - job.startedAt) / 1000)), 500);
    return () => clearInterval(t);
  }, [busy, job]);

  // Tiles: what there is, else the four angles waiting.
  const tiles: Shot[] = shots.length ? shots : job?.status === "capturing" ? ANGLES.map((a) => ({ ...a })) : [];
  const viewable = tiles.map((s, i) => ({ s, i })).filter(({ s }) => s.view || s.capture);
  const made = tiles.filter((s) => s.view).length;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (open !== null) setOpen(null);
        else onClose();
      }
      if (open === null) return;
      const k = viewable.findIndex((x) => x.i === open);
      if (e.key === "ArrowRight" && viewable.length) setOpen(viewable[(k + 1) % viewable.length].i);
      if (e.key === "ArrowLeft" && viewable.length) setOpen(viewable[(k - 1 + viewable.length) % viewable.length].i);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, viewable]);

  const line = busy
    ? job?.status === "capturing"
      ? "Taking the four views from the 3D model…"
      : made ? `Making the photos: ${made} of ${tiles.length} done.` : `Making ${tiles.length} photos at once. This takes about half a minute.`
    : job?.status === "error"
      ? job.error ?? "The photos didn't come through."
      : tiles.length
        ? hasConcept
          ? "Made from the 3D model, with the materials of the concept you chose."
          : "Made from the 3D model."
        : canEdit
          ? "Four photographs of this design: from the road, the street corner, above the garden and from the air. Each one starts from the 3D model, so it shows this house."
          : "No photos of this version yet.";

  const enlarged = open !== null ? tiles[open] : null;

  return (
    <motion.div
      className="fixed inset-0 z-[75] flex flex-col bg-hud/92 text-hud-ink backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      role="dialog"
      aria-modal="true"
      aria-label="Photos of the house"
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="min-w-0">
          <p className="text-heading">Photos</p>
          <p className={cn("text-[13px]", job?.status === "error" && !busy ? "text-[#F5B97A]" : "text-hud-ink-2")}>
            {busy && <BreathingDot className="mr-2 bg-hud-accent align-middle" />}
            {line}
            {busy && job?.status === "drawing" && <span className="ml-2 font-mono tabular-nums">{secs}s</span>}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {canEdit && (
            <Button
              variant={tiles.length ? "hud" : "primary"}
              size="sm"
              loading={busy}
              icon={tiles.length ? <RotateCw className="size-4" strokeWidth={1.75} /> : <Images className="size-4" strokeWidth={1.75} />}
              onClick={onMake}
            >
              {busy ? "Making…" : tiles.length && made ? "Remake" : "Make photos"}
            </Button>
          )}
          <IconButton label="Close" variant="hud" size={40} onClick={onClose}>
            <X className="size-4" strokeWidth={1.75} />
          </IconButton>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 sm:px-8 [scrollbar-width:thin]">
        {tiles.length > 0 ? (
          <div className="mx-auto grid max-w-[1400px] grid-cols-1 gap-3 sm:grid-cols-2">
            {tiles.map((s, i) => (
              <PhotoTile key={s.angle} shot={s} drawing={busy} onOpen={s.view || s.capture ? () => setOpen(i) : undefined} />
            ))}
          </div>
        ) : (
          <div className="mx-auto grid max-w-[1400px] grid-cols-2 gap-3 opacity-60">
            {ANGLES.map((a) => (
              <div key={a.angle} className="relative aspect-video overflow-hidden rounded-media bg-white/5">
                <span className="glass-hud absolute bottom-3 left-3 rounded-full px-2.5 py-1 text-[12px]">{a.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <AnimatePresence>{enlarged && <Enlarged shot={enlarged} onClose={() => setOpen(null)} onStep={viewable.length > 1 ? (d) => {
        const k = viewable.findIndex((x) => x.i === open);
        setOpen(viewable[(k + d + viewable.length) % viewable.length].i);
      } : undefined} />}</AnimatePresence>
    </motion.div>
  );
}

function PhotoTile({ shot, drawing, onOpen }: { shot: Shot; drawing: boolean; onOpen?: () => void }) {
  const photo = assetUrl(shot.view?.url, { w: 960 });
  const model = assetUrl(shot.capture);
  const waiting = !shot.view && !shot.failed && drawing;
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!onOpen}
      aria-label={`${shot.label}${shot.view ? "" : waiting ? ", drawing" : ""}`}
      className="group relative aspect-video overflow-hidden rounded-media bg-black text-left outline-none focus-visible:shadow-focus disabled:cursor-default"
    >
      {model && !photo && <img src={model} alt="" className={cn("absolute inset-0 h-full w-full object-cover", waiting && "opacity-70")} draggable={false} />}
      {photo && (
        <motion.img
          key={photo}
          src={photo}
          alt={`${shot.label}: photo of the house`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6 }}
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.015]"
          draggable={false}
        />
      )}
      {waiting && (
        <div className="absolute inset-0 grid place-items-center bg-black/25">
          <Shimmer dark />
          <span className="glass-hud inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[13px]">
            <BreathingDot className="bg-hud-accent" /> {model ? "Drawing the photo" : "Taking the view"}
          </span>
        </div>
      )}
      {shot.failed && (
        <div className="absolute inset-0 grid place-items-center bg-black/55 p-4 text-center text-[13px] text-hud-ink-2">{shot.failed}</div>
      )}
      <span className="glass-hud absolute bottom-3 left-3 rounded-full px-2.5 py-1 text-[12px]">{shot.label}</span>
      {photo && !waiting && <span className="glass-hud absolute bottom-3 right-3 rounded-full px-2.5 py-1 text-[11.5px] text-hud-ink-2 opacity-0 transition-opacity group-hover:opacity-100">Made from the 3D model</span>}
    </button>
  );
}

function Enlarged({ shot, onClose, onStep }: { shot: Shot; onClose: () => void; onStep?: (d: 1 | -1) => void }) {
  const photo = assetUrl(shot.view?.url);
  const model = assetUrl(shot.capture);
  const [side, setSide] = useState<"photo" | "model">(photo ? "photo" : "model");
  useEffect(() => setSide(photo ? "photo" : "model"), [photo, shot.angle]);
  const src = side === "photo" && photo ? photo : model;
  return (
    <motion.div
      className="absolute inset-0 z-10 flex flex-col bg-hud/96"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <p className="text-heading">{shot.label}</p>
        <div className="flex items-center gap-2">
          {photo && model && (
            <Segmented
              label="Show"
              tone="hud"
              value={side}
              onChange={setSide}
              options={[
                { value: "photo", label: "Photo" },
                { value: "model", label: "3D model" },
              ]}
            />
          )}
          {photo && side === "photo" && (
            <a href={photo} download={`naqsha-${shot.angle}.png`} target="_blank" rel="noreferrer">
              <Button variant="hud" size="sm" icon={<Download className="size-4" strokeWidth={1.75} />}>
                <span className="max-sm:hidden">Save</span>
              </Button>
            </a>
          )}
          <IconButton label="Back to all photos" variant="hud" size={40} onClick={onClose}>
            <X className="size-4" strokeWidth={1.75} />
          </IconButton>
        </div>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-4 pb-6 sm:px-14">
        {onStep && (
          <IconButton label="Previous" variant="hud" size={40} className="absolute left-2 top-1/2 z-10 -translate-y-1/2 sm:left-4" onClick={() => onStep(-1)}>
            <ChevronLeft className="size-5" strokeWidth={1.75} />
          </IconButton>
        )}
        <div className="relative aspect-video max-h-full w-full max-w-[1400px] overflow-hidden rounded-media bg-black">
          {/* the grid's smaller copy while the full-size photo loads */}
          {side === "photo" && photo && <img src={assetUrl(shot.view?.url, { w: 960 })} alt="" className="absolute inset-0 h-full w-full object-contain" draggable={false} />}
          {src && <img key={src} src={src} alt={side === "photo" ? `${shot.label}: photo of the house` : `${shot.label}: the 3D model`} className="absolute inset-0 h-full w-full object-contain" draggable={false} />}
          {side === "photo" && photo && <span className="glass-hud absolute bottom-3 left-3 rounded-full px-2.5 py-1 text-[12px] text-hud-ink-2">Made from the 3D model</span>}
        </div>
        {onStep && (
          <IconButton label="Next" variant="hud" size={40} className="absolute right-2 top-1/2 z-10 -translate-y-1/2 sm:right-4" onClick={() => onStep(1)}>
            <ChevronRight className="size-5" strokeWidth={1.75} />
          </IconButton>
        )}
      </div>
    </motion.div>
  );
}

// ── Concept check ───────────────────────────────────────────────────────────────────────────────────

/** "the facade", "the facade and the boundary wall": facade sections are one thing to people. */
function rebuiltPhrase(names: string[], plan: BuildingPlan): string {
  const facade = names.some((n) => /^facade_(front|back|left|right|rear|side)/.test(n));
  const rest = names.filter((n) => !/^facade_(front|back|left|right|rear|side)/.test(n)).map((n) => sectionPhrase(n, plan));
  const parts = [...(facade ? ["the facade"] : []), ...rest];
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0] ?? "the facade";
}

const STATUS_DOT: Record<ConceptMatch["features"][number]["status"], string> = { present: "bg-[#6FCF97]", partial: "bg-[#F5B97A]", missing: "bg-[#F28B82]" };
const STATUS_WORD: Record<ConceptMatch["features"][number]["status"], string> = { present: "There", partial: "Close", missing: "Missing" };

/** "Matches the concept: 86%", with the feature list; editors can check (again). */
export function ConceptMatchChip({
  project,
  plan,
  match,
  job,
  busy,
  canEdit,
  onCheck,
}: {
  project: Project;
  plan: BuildingPlan;
  match?: ConceptMatch;
  job?: MatchJob;
  busy: boolean;
  canEdit: boolean;
  onCheck: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const concept = project.concepts.find((c) => c.id === project.selected_concept_id);
  if (!concept || (!match && !busy && !canEdit)) return null;
  const score = match?.score;
  const refit = job?.status === "done" ? job.refit : match?.refit?.sections ?? [];
  const history = (match?.history ?? []).filter((h) => typeof h.score === "number");
  const before = history.length > 1 ? history[history.length - 2].score : null;
  const order = { missing: 0, partial: 1, present: 2 } as const;
  const features = [...(match?.features ?? [])].sort((a, b) => order[a.status] - order[b.status]);
  const label = busy
    ? job?.message?.replace(/…$/, "") ?? "Checking against the concept"
    : typeof score === "number"
      ? `Matches the concept: ${Math.round(score)}%`
      : match
        ? "Compared with the concept"
        : "Check against the concept";

  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={() => (match || busy ? setOpen(!open) : onCheck())}
        aria-expanded={match || busy ? open : undefined}
        className="glass-hud pointer-events-auto inline-flex h-9 max-w-[min(420px,calc(100vw-24px))] items-center gap-2 rounded-full px-3 text-[13px] outline-none focus-visible:shadow-focus"
      >
        {busy ? <BreathingDot className="bg-hud-accent" /> : <ScanSearch className="size-3.5 shrink-0 text-hud-accent" strokeWidth={2} />}
        <span className="truncate">{label}</span>
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref} side="top" tone="hud" className="w-[360px]" sheetBelow={640} label="How the model matches the concept">
        <div className="flex items-start gap-3 px-1 pb-2 pt-0.5">
          <img src={assetUrl(concept.url, { w: 320 })} alt="The concept" className="h-14 w-24 shrink-0 rounded-[6px] object-cover" />
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-medium">
              {typeof score === "number" ? `${Math.round(score)}% of the concept is in the model` : busy ? "Checking…" : "Not checked yet"}
            </p>
            {match?.reverted ? (
              <p className="text-[12px] text-hud-ink-2">
                The rebuilt facade scored {Math.round(match.reverted.score ?? 0)}%, so the earlier facade was kept.
              </p>
            ) : typeof before === "number" && typeof score === "number" && before !== score && (
              <p className="text-[12px] text-hud-ink-2">
                {score > before ? "Up" : "Down"} from {Math.round(before)}% {job?.rechecked && job.status === "done" ? "before the facade was rebuilt" : "at the last check"}
              </p>
            )}
            {match?.summary && <p className="mt-0.5 text-[12.5px] leading-snug text-hud-ink-2">{match.summary}</p>}
          </div>
        </div>
        {busy && job?.message && (
          <p className="flex items-center gap-2 px-1 pb-2 text-[12.5px] text-hud-ink-2">
            <BreathingDot className="bg-hud-accent" /> {job.message}
          </p>
        )}
        {features.length > 0 && (
          <ul className="max-h-[42vh] space-y-0.5 overflow-y-auto border-t border-white/10 pt-1.5 text-[13px] leading-snug [scrollbar-width:thin]">
            {features.map((f) => (
              <li key={f.id} className="flex items-start gap-2 rounded-control px-1 py-1.5">
                <span className={cn("mt-[6px] size-1.5 shrink-0 rounded-full", STATUS_DOT[f.status])} />
                <span className="min-w-0 flex-1">
                  <span className="block">{f.what}</span>
                  {f.status !== "present" && f.note && <span className="block text-[12px] text-hud-ink-2">{f.note}</span>}
                </span>
                <span className="shrink-0 text-[11.5px] text-hud-ink-2">{STATUS_WORD[f.status]}</span>
              </li>
            ))}
          </ul>
        )}
        {refit.length > 0 && !busy && (
          <p className="mt-1 border-t border-white/10 px-1 pt-2 text-[12.5px] text-hud-ink-2">
            Rebuilt {rebuiltPhrase(refit, plan)} to bring the model closer to the concept.{job?.rechecked ? "" : " Check again for the new score."}
          </p>
        )}
        {canEdit && (
          <div className="mt-2 flex justify-end px-1">
            <Button variant="hud" size="sm" loading={busy} icon={<ScanSearch className="size-4" strokeWidth={1.75} />} onClick={onCheck}>
              {match ? "Check again" : "Check against the concept"}
            </Button>
          </div>
        )}
      </Popover>
    </>
  );
}
