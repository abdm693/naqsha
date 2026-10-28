/** "Render this view": the 3D view and its photoreal render, compared with a drag-to-wipe divider. */
import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Download, RotateCw, X } from "lucide-react";
import { BreathingDot, Button, IconButton, Shimmer } from "@/app/design/kit";

export function RenderLightbox({ before, after, error, onClose, onRetry }: { before: string; after?: string; error?: string; onClose: () => void; onRetry: () => void }) {
  const [pos, setPos] = useState(50);
  const [secs, setSecs] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  useEffect(() => {
    if (after || error) return;
    const t0 = Date.now();
    const t = setInterval(() => setSecs(Math.floor((Date.now() - t0) / 1000)), 500);
    return () => clearInterval(t);
  }, [after, error]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") setPos((p) => Math.max(0, p - 5));
      if (e.key === "ArrowRight") setPos((p) => Math.min(100, p + 5));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const move = (x: number) => {
    const r = box.current?.getBoundingClientRect();
    if (r) setPos(Math.max(0, Math.min(100, ((x - r.left) / r.width) * 100)));
  };

  return (
    <motion.div
      className="fixed inset-0 z-[75] flex flex-col bg-hud/92 text-hud-ink backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      role="dialog"
      aria-modal="true"
      aria-label="Render of this view"
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div>
          <p className="text-heading">Render of this view</p>
          <p className="text-[13px] text-hud-ink-2">{after ? "Drag the line to compare the 3D view with the render." : error ? "The render didn't come back." : "Turning this view into a photograph…"}</p>
        </div>
        <div className="flex items-center gap-2">
          {after && (
            <a href={after} download="naqsha-render.jpg" target="_blank" rel="noreferrer">
              <Button variant="hud" size="sm" icon={<Download className="size-4" strokeWidth={1.75} />}>
                Save
              </Button>
            </a>
          )}
          <IconButton label="Close" variant="hud" size={40} onClick={onClose}>
            <X className="size-4" strokeWidth={1.75} />
          </IconButton>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center px-4 pb-6 sm:px-8">
        <div
          ref={box}
          className="relative aspect-video max-h-full w-full max-w-[1400px] touch-none select-none overflow-hidden rounded-media bg-black"
          onPointerDown={(e) => {
            if (!after) return;
            dragging.current = true;
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            move(e.clientX);
          }}
          onPointerMove={(e) => dragging.current && move(e.clientX)}
          onPointerUp={() => (dragging.current = false)}
        >
          <img src={before} alt="The 3D view" className="absolute inset-0 h-full w-full object-cover" draggable={false} />
          {after && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6 }} className="absolute inset-0" style={{ clipPath: `inset(0 0 0 ${pos}%)` }}>
              <img src={after} alt="The render" className="h-full w-full object-cover" draggable={false} />
            </motion.div>
          )}
          {after && (
            <>
              <div className="pointer-events-none absolute inset-y-0 w-px bg-white" style={{ left: `${pos}%` }} />
              <div className="pointer-events-none absolute top-1/2 grid size-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white text-ink shadow-e2" style={{ left: `${pos}%` }}>
                <span className="text-[13px]">⇆</span>
              </div>
              <span className="glass-hud absolute left-3 top-3 rounded-full px-2.5 py-1 text-[12px]">3D view</span>
              <span className="glass-hud absolute right-3 top-3 rounded-full px-2.5 py-1 text-[12px]">Render</span>
            </>
          )}
          {!after && !error && (
            <div className="absolute inset-0 grid place-items-center bg-black/30">
              <Shimmer dark />
              <span className="glass-hud inline-flex items-center gap-2.5 rounded-full px-4 py-2 text-[14px]">
                <BreathingDot className="bg-hud-accent" /> Rendering <span className="font-mono tabular-nums text-hud-ink-2">{secs}s</span>
              </span>
            </div>
          )}
          {error && (
            <div className="absolute inset-0 grid place-items-center bg-black/50">
              <div className="max-w-sm text-center">
                <p className="text-body">{error}</p>
                <Button variant="primary" className="mt-4" icon={<RotateCw className="size-4" strokeWidth={1.75} />} onClick={onRetry}>
                  Try again
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
