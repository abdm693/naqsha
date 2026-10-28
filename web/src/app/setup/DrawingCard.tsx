/**
 * The family's own drawing in the Brief: a hidden file picker the entry points share, and the card under the plot
 * that shows the sheets while they are read and once they have been ("Your drawing · 14 rooms read").
 */
import { useRef, type ReactNode } from "react";
import { motion } from "motion/react";
import type { ImportedDrawing } from "@contracts/api-types";
import { assetUrl } from "@/api/client";
import { feetInches } from "@/app/lib/utils";
import { Button, EASE_OUT } from "@/app/design/kit";
import { Spinner } from "@/app/ui/Spinner";
import { DRAWING_ACCEPT, floorsIn } from "./drawing";

/** A hidden <input type="file"> for floor plan images; `pick()` opens it from any button. */
export function useDrawingPicker(onFiles: (files: File[]) => void): { input: ReactNode; pick: () => void } {
  const ref = useRef<HTMLInputElement>(null);
  const input = (
    <input
      ref={ref}
      type="file"
      accept={DRAWING_ACCEPT}
      multiple
      hidden
      tabIndex={-1}
      onChange={(e) => {
        const files = Array.from(e.target.files ?? []);
        // Cleared, so picking the same file again still counts as a change.
        e.target.value = "";
        if (files.length) onFiles(files);
      }}
    />
  );
  return { input, pick: () => ref.current?.click() };
}

/** While the drawing is read: the local sheets under a shimmer. Once read: the stored sheets and what came of them. */
export function DrawingCard({
  imported,
  reading,
  onReplace,
  className,
}: {
  imported?: ImportedDrawing | null;
  /** Local previews of the sheets being read right now. */
  reading?: string[] | null;
  onReplace?: () => void;
  className?: string;
}) {
  if (!reading && !imported?.images?.length) return null;
  const plot = imported?.layout?.plot;
  const floors = imported ? floorsIn(imported) : 0;
  return (
    <motion.section
      aria-label="Your drawing"
      aria-busy={reading ? true : undefined}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: EASE_OUT }}
      className={className}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        {reading ? (
          <p className="flex items-center gap-2 text-[15px] font-semibold text-ink" role="status">
            <Spinner className="text-accent" /> Reading your drawing…
          </p>
        ) : (
          <h3 className="text-[15px] font-semibold text-ink">
            Your drawing <span className="font-normal text-ink-3">· {imported!.rooms} {imported!.rooms === 1 ? "room" : "rooms"} read{floors > 1 ? ` on ${floors} floors` : ""}</span>
          </h3>
        )}
        {!reading && onReplace && (
          <Button variant="quiet" size="sm" onClick={onReplace} className="-mr-2">
            Use another drawing
          </Button>
        )}
      </div>
      <ul className="mt-3 flex gap-3 overflow-x-auto pb-1 [scrollbar-width:thin]">
        {(reading ?? imported!.images).map((src, i) => (
          <li key={src} className="relative shrink-0 overflow-hidden rounded-control bg-white shadow-e1">
            {reading ? (
              <>
                <img src={src} alt={`Sheet ${i + 1}`} className="block h-36 w-auto min-w-16 max-w-[260px] object-contain opacity-70" />
                <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/70 to-transparent" />
              </>
            ) : (
              <a href={assetUrl(src)} target="_blank" rel="noopener noreferrer" className="block outline-none focus-visible:shadow-focus" aria-label={`Open sheet ${i + 1} in a new tab`}>
                <img src={assetUrl(src, { w: 640 })} alt="" loading="lazy" className="block h-36 w-auto min-w-16 max-w-[260px] object-contain" />
              </a>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[13px] leading-snug text-ink-2">
        {reading
          ? "Room by room, floor by floor. It takes about 20 seconds."
          : "The design keeps your layout and changes only what the rules need."}
      </p>
      {!reading && plot?.assumed && (
        <p className="mt-1 text-[12.5px] leading-snug text-ink-3">
          No plot size was written on it, so I took {feetInches(plot.width_ft)} × {feetInches(plot.depth_ft)}. Change it under Plot if that's wrong.
        </p>
      )}
    </motion.section>
  );
}
