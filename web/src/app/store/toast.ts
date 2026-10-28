/**
 * Toasts (DESIGN.md §4): one at a time, a 44px ink pill 12px above the dock, an optional action ("Undo"),
 * gone after 4 s. A new toast replaces the current one. Autosave never toasts.
 */
import { create } from "zustand";
import { errorMessage, isAbortError } from "@/api/client";

export type ToastTone = "info" | "success" | "error";

export interface ToastItem {
  id: number;
  tone: ToastTone;
  text: string;
  /** A second, quieter sentence (errors: what went wrong). */
  detail?: string;
  action?: { label: string; run: () => void };
}

interface ToastState {
  current: ToastItem | null;
  push(t: Omit<ToastItem, "id">, ttlMs?: number): number;
  dismiss(id?: number): void;
}

let seq = 1;
let timer: ReturnType<typeof setTimeout> | undefined;

export const useToasts = create<ToastState>((set, get) => ({
  current: null,
  push(t, ttlMs = 4000) {
    const id = seq++;
    clearTimeout(timer);
    set({ current: { ...t, id } });
    if (ttlMs > 0) timer = setTimeout(() => get().dismiss(id), ttlMs);
    return id;
  },
  dismiss(id) {
    const cur = get().current;
    if (cur && (id === undefined || cur.id === id)) set({ current: null });
  },
}));

export const toast = {
  /** A plain message, optionally with an action. */
  show(text: string, opts: { detail?: string; action?: ToastItem["action"]; tone?: ToastTone; duration?: number } = {}) {
    return useToasts.getState().push({ tone: opts.tone ?? "info", text, detail: opts.detail, action: opts.action }, opts.duration);
  },
  /** "Comment deleted · Undo". The undo window is 5 s. */
  undo(text: string, onUndo: () => void) {
    return useToasts.getState().push({ tone: "info", text, action: { label: "Undo", run: onUndo } }, 5000);
  },
  error(title: string, e?: unknown, action?: ToastItem["action"]) {
    if (e && isAbortError(e)) return;
    return useToasts.getState().push({ tone: "error", text: title, detail: e ? errorMessage(e) : undefined, action }, action ? 8000 : 6000);
  },
  success(title: string, detail?: string) {
    return useToasts.getState().push({ tone: "success", text: title, detail });
  },
  info(title: string, detail?: string) {
    return useToasts.getState().push({ tone: "info", text: title, detail });
  },
  dismiss(id?: number) {
    useToasts.getState().dismiss(id);
  },
};
