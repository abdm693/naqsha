/**
 * Viewer dev harness (web/dev/viewer.html): mounts HouseViewer with fixture plans + design.js and a control panel
 * that plays the app's part (floor stack, room navigator, finish confirm, version switch).
 *
 * URL params: ?fixture=argon-v1|10-marla &mode=walk &hour=17.5 &panel=0 &levels=ground,first &cut=4.6 &comment=1
 *   &night=1 &ghost=0 &cars=show|hide &chrome=1 (mock the app's floating chrome to check HUD zones)
 * Dev builds expose window.__viewerDebug (activate walk without pointer lock, hold keys, teleport, routes…).
 */
import { StrictMode, useCallback, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "@/index.css";
import type { BuildingPlan } from "@contracts/plan";
import type { Layer } from "@contracts/house-sdk";
import type { Comment } from "@contracts/api-types";
import { parseDesign, type SectionResult } from "@/engine";
import { HouseViewer, type HouseViewerProps, type ViewerHandle } from "../HouseViewer";

const planFiles = import.meta.glob<BuildingPlan>("../../../../contracts/fixtures/*plan*.json", { eager: true, import: "default" });
const designFiles = import.meta.glob<string>("../../../../contracts/fixtures/*design*.js", { eager: true, query: "?raw", import: "default" });

// DESIGN tokens + Geist for the harness (the app's index.css provides them in the product)
{
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@500&display=swap";
  document.head.appendChild(link);
  const st = document.createElement("style");
  st.textContent = `:root{--font-sans:"Geist",ui-sans-serif,system-ui,-apple-system,sans-serif;--font-mono:"Geist Mono",ui-monospace,Menlo,monospace;--color-hud:#18181B;--color-hud-ink:#F5F5F7;--color-hud-ink-2:#A3A3AD;--color-hud-accent:#7D93FF;--color-accent:#2747F5;--color-accent-press:#1F3BD6}html,body,#root{height:100%;margin:0}`;
  document.head.appendChild(st);
}

interface Fixture { id: string; plan: BuildingPlan; design: string | null }
const base = (p: string) => p.split("/").pop()!.replace(/\.(json|js)$/, "");
const FIXTURES: Fixture[] = Object.entries(planFiles)
  .map(([path, plan]) => {
    const name = base(path);
    const designKey = Object.keys(designFiles).find((k) => base(k) === name.replace("plan", "design"));
    const id = name.replace(/-?plan-?/, "") || name;
    return { id, plan, design: designKey ? designFiles[designKey] : null };
  })
  .sort((a, b) => (a.id === "10-marla" ? -1 : b.id === "10-marla" ? 1 : a.id.localeCompare(b.id)));

const LAYERS: Layer[] = ["structure", "facade", "interior", "furniture", "landscape", "lighting", "custom"];
const STATUSES: Comment["status"][] = ["open", "partial", "resolved", "rejected"];
const AUTHORS = [
  { id: "u_ahmed", name: "Ahmed", role: "owner" as const },
  { id: "u_sana", name: "Sana", role: "client" as const },
];

const qs = new URLSearchParams(location.search);

function Harness() {
  const [fixtureId, setFixtureId] = useState(() => {
    const want = qs.get("fixture")?.replace(/-?plan-?/, "");
    return FIXTURES.find((f) => f.id === want)?.id ?? FIXTURES[0]?.id;
  });
  // "version" switch: a different fixture shown in the SAME viewer (no remount), like the app's before/after
  const [versionId, setVersionId] = useState<string | null>(null);
  const fixture = FIXTURES.find((f) => f.id === (versionId ?? fixtureId)) ?? FIXTURES[0];
  const sections = useMemo(() => (fixture.design ? parseDesign(fixture.design) : []), [fixture]);
  const [mode, setMode] = useState<"orbit" | "walk">(qs.get("mode") === "walk" ? "walk" : "orbit");
  const [layers, setLayers] = useState<Partial<Record<Layer, boolean>>>({});
  const [cutOn, setCutOn] = useState(qs.has("cut"));
  const [cut, setCut] = useState(Number(qs.get("cut") ?? 4.6));
  const [hour, setHour] = useState(Number(qs.get("hour") ?? 16.5));
  const [night, setNight] = useState(qs.get("night") === "1");
  const [ghost, setGhost] = useState(qs.get("ghost") !== "0");
  const [cars, setCars] = useState<"auto" | "show" | "hide">((qs.get("cars") as "show" | "hide") ?? "auto");
  const [preserve, setPreserve] = useState(true);
  const [commentMode, setCommentMode] = useState(qs.get("comment") === "1");
  const [comments, setComments] = useState<Comment[]>([]);
  const [snaps, setSnaps] = useState<Record<string, string>>({});
  const [capture, setCapture] = useState<string | null>(null);
  const [progress, setProgress] = useState("");
  const [ready, setReady] = useState("");
  const [here, setHere] = useState<{ room: string | null; level: string | null }>({ room: null, level: null });
  const [confirm, setConfirm] = useState(false);
  const [floor, setFloor] = useState<string>("all");
  const [panel, setPanel] = useState(qs.get("panel") !== "0");
  const [chrome] = useState(qs.get("chrome") === "1");
  const viewer = useRef<ViewerHandle>(null);
  // "revision": the same design with the front windows widened (a small plan change → crossfade + changed outline)
  const [revised, setRevised] = useState(false);
  const plan = useMemo(() => {
    if (!revised) return fixture.plan;
    const p = structuredClone(fixture.plan);
    for (const o of p.openings) if (o.type === "window" && o.at[1] < 30) o.width_ft = Math.max(2, o.width_ft - 2);
    return p;
  }, [fixture, revised]);
  const levels = useMemo(() => [...plan.levels].sort((a, b) => b.index - a.index), [plan]);

  const onAddComment = useCallback<NonNullable<HouseViewerProps["onAddComment"]>>((d) => {
    const id = `c${Date.now().toString(36)}`;
    setComments((cs) => [
      ...cs,
      {
        id,
        version_id: "dev",
        text: `Note on ${d.anchor.label ?? d.anchor.kind ?? "surface"}`,
        anchor: d.anchor,
        camera: d.camera,
        created_at: new Date().toISOString(),
        status: "open",
        author: AUTHORS[cs.length % AUTHORS.length],
      },
    ]);
    setSnaps((s) => ({ ...s, [id]: d.snapshot }));
    console.info("[harness] onAddComment", d.anchor, d.camera, `${Math.round(d.snapshot.length / 1024)} KB snapshot`);
  }, []);

  const onBuildProgress = useCallback((r: SectionResult, done: number, total: number) => setProgress(`${done}/${total} · ${r.name}${r.ok ? "" : " ✗"}`), []);
  const onReady = useCallback<NonNullable<HouseViewerProps["onReady"]>>((r) => setReady(`${r.sections.length} sections · ${r.summary.objects.length} objects`), []);
  const onExitWalk = useCallback<NonNullable<HouseViewerProps["onExitWalk"]>>((reason) => {
    console.info("[harness] onExitWalk", reason);
    if (reason === "finish") setConfirm(true);
    else setMode("orbit");
  }, []);
  const onRoomChange = useCallback((room: string | null, level: string | null) => setHere({ room, level }), []);
  const commentsRef = useRef(comments);
  commentsRef.current = comments;
  const onSelectComment = useCallback((id: string) => {
    const c = commentsRef.current.find((x) => x.id === id);
    if (c) viewer.current?.flyTo(c);
  }, []);
  const roomName = plan.rooms.find((r) => r.id === here.room)?.name;
  const levelName = plan.levels.find((l) => l.id === here.level)?.name;

  return (
    <div className="flex h-full w-full bg-neutral-950 text-neutral-100" style={{ fontFamily: "var(--font-sans)" }}>
      <div className="relative min-w-0 flex-1">
        <HouseViewer
          key={fixtureId}
          ref={viewer}
          plan={plan}
          sections={sections}
          mode={mode}
          layers={layers}
          sectionCut={cutOn ? cut : null}
          sunHour={hour}
          night={night}
          ghostContext={ghost}
          hideVehicles={cars === "auto" ? undefined : cars === "hide"}
          preserveCamera={preserve}
          comments={comments}
          commentMode={commentMode}
          onAddComment={onAddComment}
          onSelectComment={onSelectComment}
          onBuildProgress={onBuildProgress}
          onReady={onReady}
          onExitWalk={onExitWalk}
          onRoomChange={onRoomChange}
        />
        {chrome && <MockChrome mode={mode} room={roomName} level={levelName} />}
        {confirm && (
          <div className="absolute inset-0 z-50 grid place-items-center bg-black/30">
            <div className="w-[360px] rounded-[28px] bg-white p-6 text-neutral-900 shadow-2xl">
              <div className="text-[17px] font-semibold">Send {comments.filter((c) => c.status === "open").length} comments to Naqsha?</div>
              <p className="mt-1 text-[14px] text-neutral-500">I'll make the changes and show you the next version.</p>
              <div className="mt-5 flex justify-end gap-2">
                <button className="h-10 rounded-full border border-neutral-300 px-4 text-[14px]" onClick={() => setConfirm(false)}>
                  Keep walking
                </button>
                <button
                  className="h-10 rounded-full bg-[#2747F5] px-4 text-[14px] text-white"
                  onClick={() => {
                    setConfirm(false);
                    setMode("orbit");
                  }}
                >
                  Send
                </button>
              </div>
            </div>
          </div>
        )}
        <button
          className="absolute right-3 bottom-3 z-40 rounded-lg bg-black/50 px-2.5 py-1.5 text-xs text-white/80 backdrop-blur hover:bg-black/70"
          onClick={() => setPanel((p) => !p)}
        >
          {panel ? "Hide panel" : "Panel"}
        </button>
      </div>
      {panel && (
        <aside className="flex w-[300px] shrink-0 flex-col gap-4 overflow-y-auto border-l border-white/10 bg-neutral-900 p-4 text-[13px]">
          <header>
            <div className="text-[11px] tracking-[0.12em] text-white/40 uppercase">Naqsha · viewer harness</div>
            <div className="mt-1 text-white/60">{progress || "…"}</div>
            {ready && <div className="text-emerald-400/90">{ready}</div>}
            <div className="mt-1 text-white/70">
              {mode === "walk" ? `You are in: ${roomName ?? (here.level ? "—" : "outside")}${levelName ? ` · ${levelName}` : ""}` : "Orbit"}
            </div>
          </header>

          <Field label="Fixture (remounts)">
            <select
              className="w-full rounded-md border border-white/10 bg-neutral-800 px-2 py-1.5"
              value={fixtureId}
              onChange={(e) => {
                setFixtureId(e.target.value);
                setVersionId(null);
              }}
            >
              {FIXTURES.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.id} {f.design ? `(design.js, ${parseDesign(f.design).length} sections)` : "(no design → default)"}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Version in place (same viewer, crossfade)">
            <div className="flex flex-wrap gap-1.5">
              {FIXTURES.map((f) => (
                <Toggle key={f.id} on={(versionId ?? fixtureId) === f.id} onClick={() => setVersionId(f.id === fixtureId ? null : f.id)}>
                  {f.id}
                </Toggle>
              ))}
              <Toggle on={preserve} onClick={() => setPreserve((v) => !v)}>
                keep camera
              </Toggle>
              <Toggle on={revised} onClick={() => setRevised((v) => !v)}>
                revision: narrower front windows
              </Toggle>
            </div>
          </Field>

          <Field label="Mode">
            <Seg value={mode} options={["orbit", "walk"]} onChange={(m) => setMode(m as "orbit" | "walk")} />
          </Field>

          <Field label="Floor stack (setFloor)">
            <div className="flex flex-wrap gap-1.5">
              {levels.map((l) => (
                <Toggle
                  key={l.id}
                  on={mode === "walk" ? here.level === l.id : floor === l.id}
                  onClick={() => {
                    setFloor(l.id);
                    viewer.current?.setFloor(l.id);
                  }}
                >
                  {l.name}
                </Toggle>
              ))}
              {mode === "orbit" && (
                <Toggle
                  on={floor === "all"}
                  onClick={() => {
                    setFloor("all");
                    viewer.current?.setFloor("all");
                  }}
                >
                  All
                </Toggle>
              )}
              <MiniBtn onClick={() => viewer.current?.resetView()}>Reset view</MiniBtn>
            </div>
          </Field>

          <Field label="Rooms (goToRoom)">
            <div className="flex flex-col gap-2">
              {levels.map((l) => {
                const rooms = plan.rooms.filter((r) => r.level === l.id);
                if (!rooms.length) return null;
                return (
                  <div key={l.id}>
                    <div className="mb-1 text-[11px] text-white/40">{l.name}</div>
                    <div className="flex flex-wrap gap-1">
                      {rooms.map((r) => (
                        <button
                          key={r.id}
                          className={`rounded-md border px-1.5 py-0.5 text-[11.5px] ${here.room === r.id ? "border-[#7D93FF] text-[#c9d2ff]" : "border-white/10 text-white/70 hover:bg-white/5"}`}
                          onClick={() => viewer.current?.goToRoom(r.id)}
                        >
                          {r.name}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </Field>

          <Field label="Clear view">
            <div className="flex flex-wrap gap-1.5">
              <Toggle on={ghost} onClick={() => setGhost((v) => !v)}>
                ghost neighbours
              </Toggle>
              <Seg value={cars} options={["auto", "show", "hide"]} onChange={(v) => setCars(v as "auto" | "show" | "hide")} />
            </div>
          </Field>

          <Field label="Layers">
            <div className="flex flex-wrap gap-1.5">
              {LAYERS.map((l) => (
                <Toggle key={l} on={layers[l] !== false} onClick={() => setLayers((s) => ({ ...s, [l]: s[l] === false }))}>
                  {l}
                </Toggle>
              ))}
            </div>
          </Field>

          <Field label={`Section cut ${cutOn ? `· ${cut.toFixed(2)} m` : "· off"}`}>
            <div className="flex items-center gap-2">
              <Toggle on={cutOn} onClick={() => setCutOn((v) => !v)}>
                {cutOn ? "On" : "Off"}
              </Toggle>
              <input className="flex-1" type="range" min={0.3} max={9} step={0.05} value={cut} disabled={!cutOn} onChange={(e) => setCut(Number(e.target.value))} />
            </div>
          </Field>

          <Field label={`Sun · ${fmtHour(hour)}`}>
            <div className="flex items-center gap-2">
              <input className="flex-1" type="range" min={6} max={21} step={0.25} value={hour} onChange={(e) => setHour(Number(e.target.value))} />
              <Toggle on={night} onClick={() => setNight((v) => !v)}>
                night
              </Toggle>
            </div>
          </Field>

          <Field label="Comments">
            <Toggle on={commentMode} onClick={() => setCommentMode((v) => !v)}>
              {commentMode ? "Comment mode on" : "Comment mode off"}
            </Toggle>
            <ul className="mt-2 flex flex-col gap-2">
              {comments.map((c, i) => (
                <li key={c.id} className="rounded-lg border border-white/10 bg-white/[0.03] p-2">
                  <div className="flex items-center gap-2">
                    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white/15 text-[11px] font-semibold text-white">{i + 1}</span>
                    <input
                      className="min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 outline-none focus:bg-white/5"
                      value={c.text}
                      onChange={(e) => setComments((cs) => cs.map((x) => (x.id === c.id ? { ...x, text: e.target.value } : x)))}
                    />
                  </div>
                  <div className="mt-1 truncate text-[11px] text-white/45">
                    {c.author?.name} · {c.anchor.kind ?? "?"} · {c.anchor.room ?? "?"} · {c.anchor.level ?? "?"}
                  </div>
                  {snaps[c.id] && <img className="mt-1.5 w-full rounded" src={snaps[c.id]} alt="snapshot" />}
                  <div className="mt-1.5 flex gap-1.5">
                    <MiniBtn onClick={() => viewer.current?.flyTo(c)}>Fly to</MiniBtn>
                    <MiniBtn onClick={() => setComments((cs) => cs.map((x) => (x.id === c.id ? { ...x, status: STATUSES[(STATUSES.indexOf(x.status) + 1) % STATUSES.length] } : x)))}>
                      {c.status}
                    </MiniBtn>
                    <MiniBtn onClick={() => setComments((cs) => cs.filter((x) => x.id !== c.id))}>Delete</MiniBtn>
                  </div>
                </li>
              ))}
              {!comments.length && <li className="text-white/40">Turn on comment mode and click a surface, or press C while walking.</li>}
            </ul>
          </Field>

          <Field label="Capture">
            <div className="flex gap-1.5">
              <MiniBtn onClick={async () => setCapture((await viewer.current?.capture()) ?? null)}>Capture view</MiniBtn>
              <MiniBtn onClick={async () => setCapture((await viewer.current?.capture({ width: 640, height: 360 })) ?? null)}>640×360</MiniBtn>
            </div>
            {capture && (
              <a href={capture} download="naqsha-view.png" className="mt-2 block">
                <img className="w-full rounded border border-white/10" src={capture} alt="capture" />
              </a>
            )}
          </Field>
        </aside>
      )}
    </div>
  );
}

/** Stand-ins for the app's floating chrome (DESIGN zones), to check that the viewer's HUD never collides with them. */
function MockChrome({ mode, room, level }: { mode: string; room?: string; level?: string }) {
  const glass = "bg-[rgb(24_24_27/.58)] backdrop-blur-xl text-[#F5F5F7] shadow-[inset_0_0_0_1px_rgb(255_255_255/.1)]";
  return (
    <div className="pointer-events-none absolute inset-0 z-40 text-[13px]" style={{ fontFamily: "var(--font-sans)" }}>
      <div className={`absolute top-4 left-4 flex h-11 items-center gap-2 rounded-full px-4 ${glass}`}>← Homes · 10 marla, Johar Town</div>
      <div className={`absolute top-4 left-1/2 flex h-11 -translate-x-1/2 items-center gap-4 rounded-full px-4 ${glass}`}>Brief · Concepts · Plan · House</div>
      <div className={`absolute top-4 right-4 flex h-11 items-center gap-2 rounded-full px-4 ${glass}`}>AB · Comments 2 · Share</div>
      <div className={`absolute top-1/2 left-4 flex -translate-y-1/2 flex-col gap-1 rounded-[20px] p-1.5 ${glass}`}>
        <span className="px-2 py-1">R</span>
        <span className="px-2 py-1">1</span>
        <span className="px-2 py-1">G</span>
      </div>
      <div className={`absolute bottom-4 left-4 flex h-11 items-center gap-3 rounded-full px-4 ${glass}`}>Orbit · Walk · View</div>
      <div className={`absolute bottom-4 left-1/2 flex h-[52px] w-[min(720px,calc(100%-32px))] -translate-x-1/2 items-center gap-3 rounded-full px-4 ${glass}`}>
        {mode === "walk" && <span className="rounded-full bg-white/10 px-3 py-1">{room ?? "Outside"} · {level ?? ""} ▾</span>}
        <span className="text-white/50">Ask Naqsha…</span>
        <span className="ml-auto rounded-full bg-[#2747F5] px-3 py-1">Next</span>
      </div>
    </div>
  );
}

const fmtHour = (h: number) => {
  const hh = Math.floor(h), mm = Math.round((h - hh) * 60);
  const ap = hh >= 12 ? "pm" : "am";
  return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, "0")} ${ap}`;
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-1.5 text-[11px] font-medium tracking-wide text-white/45 uppercase">{label}</div>
      {children}
    </section>
  );
}

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={`rounded-md border px-2 py-1 text-[12px] transition ${on ? "border-[#7D93FF]/60 bg-[#7D93FF]/15 text-[#c9d2ff]" : "border-white/10 bg-white/[0.03] text-white/50"}`}
    >
      {children}
    </button>
  );
}

function Seg({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-white/10 bg-white/[0.03] p-0.5">
      {options.map((o) => (
        <button key={o} onClick={() => onChange(o)} className={`rounded-md px-3 py-1 text-[12px] capitalize ${value === o ? "bg-[#2747F5] text-white" : "text-white/60"}`}>
          {o}
        </button>
      ))}
    </div>
  );
}

function MiniBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="rounded-md border border-white/10 bg-white/[0.05] px-2 py-1 text-[11.5px] text-white/75 hover:bg-white/10">
      {children}
    </button>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
