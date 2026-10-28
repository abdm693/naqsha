/**
 * Start from a drawing: the family's own floor plan, read room by room on the server (POST /drawing, 5 to 20 s) into
 * the brief and a starting layout the design keeps. Sheets are shrunk here to 2000 px on the long side, flattened on
 * white, and sent as data URLs. One reading at a time; the Brief view shows it while it runs, wherever it was started.
 */
import { create } from "zustand";
import type { ImportedDrawing, Project } from "@contracts/api-types";
import { api } from "@/api/client";
import { useProject } from "@/app/store/project";
import { toast } from "@/app/store/toast";

export const DRAWING_ACCEPT = "image/png,image/jpeg,image/webp";
const MAX_SIDE = 2000;
const MAX_SHEETS = 4;
// A PNG this big is a photo, not a line drawing: send it as a JPEG instead.
const PNG_LIMIT = 6_000_000;

interface DrawingState {
  /** The project whose drawing is being read (null when none is). */
  pid: string | null;
  /** Local previews of the sheets being read (object URLs). */
  previews: string[];
}

export const useDrawing = create<DrawingState>(() => ({ pid: null, previews: [] }));

/** The files that can be read as sheets (images only: no PDFs yet). */
export const sheetsIn = (files: File[]) => files.filter((f) => /^image\/(png|jpeg|webp)$/.test(f.type));

/** Said when nothing picked was an image. */
export function notAnImage() {
  toast.show("That isn't an image", { tone: "error", detail: "Upload the floor plan as a PNG, JPEG or WebP picture." });
}

/** One sheet as a data URL, at most 2000 px on its long side. */
export async function shrink(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  try {
    const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * k));
    const h = Math.max(1, Math.round(bmp.height * k));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser can't prepare the image.");
    // Transparent PNGs would read as black lines on black: lay them on white paper.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bmp, 0, 0, w, h);
    if (file.type === "image/png") {
      const png = canvas.toDataURL("image/png");
      if (png.length < PNG_LIMIT) return png;
    }
    return canvas.toDataURL("image/jpeg", 0.9);
  } finally {
    bmp.close();
  }
}

/** Floors counted the way people count them (the roof isn't one). */
export function floorsIn(imported: ImportedDrawing): number {
  return (imported.layout?.levels ?? []).filter((l) => l !== "roof").length || 1;
}

/** "Read 14 rooms on 2 floors from your drawing". */
export function readLine(imported: ImportedDrawing): string {
  const n = imported.rooms;
  const f = floorsIn(imported);
  return `Read ${n} ${n === 1 ? "room" : "rooms"} on ${f} ${f === 1 ? "floor" : "floors"} from your drawing`;
}

/**
 * Read `files` as project `pid`'s drawing. The open project is replaced with the server's copy when it comes back;
 * the toast says how much was read, or the server's reason when nothing could be.
 */
export async function importDrawing(pid: string, files: File[]): Promise<Project | null> {
  if (useDrawing.getState().pid) return null;
  const sheets = sheetsIn(files);
  if (!sheets.length) {
    notAnImage();
    return null;
  }
  const picked = sheets.slice(0, MAX_SHEETS);
  const previews = picked.map((f) => URL.createObjectURL(f));
  useDrawing.setState({ pid, previews });
  try {
    const images = await Promise.all(picked.map(shrink));
    const p = await api.uploadDrawing(pid, images);
    if (useProject.getState().pid === pid) useProject.setState({ project: p });
    if (p.imported) {
      const skipped = sheets.length > MAX_SHEETS ? `I looked at the first ${MAX_SHEETS} sheets.` : undefined;
      toast.success(readLine(p.imported), skipped);
    }
    return p;
  } catch (e) {
    toast.error("Couldn't read your drawing", e);
    return null;
  } finally {
    previews.forEach((u) => URL.revokeObjectURL(u));
    useDrawing.setState({ pid: null, previews: [] });
  }
}
