/**
 * The dock's Ask field, shared by every view (DESIGN.md §4 "Command bar", §5 "Dock").
 *
 * Views tell the dock what Ask means where they are:
 *
 *   useAskContext({
 *     placeholder: "Ask for a change, e.g. a bigger kitchen",
 *     onSubmit: (text) => runRevise(versionId, [], text),
 *     suggestions: ["Make the kitchen open", "Add a skylight over the stair"],
 *     next: { label: "Walk through it", run: () => … },     // or null to hide the Next pill
 *     commands: [{ id: "light", group: "do", label: "Night", run: … }],
 *   });
 *
 * The most recently mounted context wins and is dropped on unmount. Anything a view leaves out falls back to the
 * shell's default for that view (Brief sends a setup message; Plan and House send a conversational revision;
 * Concepts remixes the chosen concept).
 *
 * Anywhere: `const ask = useAsk(); ask.focus(); ask.submit("Make bedroom 2 bigger"); ask.setDraft("…")`.
 * ⌘K or "/" focuses the field; typing opens the command popover (Ask Naqsha · Go to · Do).
 */
import { useId, useLayoutEffect, useMemo, type ReactNode } from "react";
import { create } from "zustand";

export interface NextMove {
  label: string;
  run: () => void;
  disabled?: boolean;
  /** Shown as a tooltip on the pill. */
  hint?: string;
}

export interface Command {
  id: string;
  label: string;
  group: "go" | "do";
  run: () => void;
  /** Extra words to match ("night" for "Day / Night"). */
  keywords?: string;
  /** Shown on the right, e.g. a shortcut or "First floor". */
  hint?: string;
  icon?: ReactNode;
}

export interface AskContext {
  /** The Ask field's placeholder in this view. */
  placeholder?: string;
  /** What Ask does with plain text here (false, or a throw, means it didn't go: the dock puts the text back). */
  onSubmit?: (text: string) => void | boolean | Promise<void | boolean>;
  /** 2–3 suggestion chips under Naqsha's line (a tap sends it). */
  suggestions?: string[];
  /** Naqsha's line above the field (null hides it). */
  line?: string | null;
  /** The Next pill (null hides it). */
  next?: NextMove | null;
  /** Extra commands for the command popover. */
  commands?: Command[];
  /** Hide the whole dock (e.g. while a lightbox is open). */
  hidden?: boolean;
  /** Naqsha is working on something this view started (holds sending). */
  busy?: boolean;
}

// Functions live outside the store so registering a context doesn't re-render anything that uses useAsk().
const contexts = new Map<string, AskContext>();

interface AskStore {
  stack: string[];
  /** Bumped when a registered context's visible parts change. */
  version: number;
  draft: string;
  /** Bumped to ask the dock to focus its field. */
  focusTick: number;
  /** Submits queued by useAsk().submit, handled by the dock (which knows the defaults). */
  queued: { text: string; tick: number } | null;
}

export const useAskStore = create<AskStore>(() => ({ stack: [], version: 0, draft: "", focusTick: 0, queued: null }));

function signature(c: AskContext): string {
  return JSON.stringify([
    c.placeholder ?? null,
    c.suggestions ?? null,
    c.line === undefined ? "u" : c.line,
    c.next === undefined ? "u" : c.next === null ? null : [c.next.label, !!c.next.disabled, c.next.hint ?? null],
    c.commands?.map((x) => [x.id, x.label, x.hint ?? null]) ?? null,
    !!c.hidden,
    !!c.busy,
  ]);
}

/**
 * Register what Ask, the suggestions and the Next pill mean in this view, while it is mounted.
 * Pass null to register nothing (the dock then uses the shell's defaults for the view).
 */
export function useAskContext(ctx: AskContext | null): void {
  const id = useId();
  const active = !!ctx;
  const sig = ctx ? signature(ctx) : "";
  // Keep the latest callbacks without re-rendering the dock.
  useLayoutEffect(() => {
    if (ctx) contexts.set(id, ctx);
  });
  useLayoutEffect(() => {
    if (!active) return;
    useAskStore.setState((s) => ({ stack: [...s.stack.filter((x) => x !== id), id] }));
    return () => {
      contexts.delete(id);
      useAskStore.setState((s) => ({ stack: s.stack.filter((x) => x !== id), version: s.version + 1 }));
    };
  }, [id, active]);
  useLayoutEffect(() => {
    if (active) useAskStore.setState((s) => ({ version: s.version + 1 }));
  }, [sig, active]);
}

/** The context the dock should use now (the top of the stack), merged over nothing. */
export function useActiveAskContext(): AskContext {
  const top = useAskStore((s) => s.stack[s.stack.length - 1]);
  const version = useAskStore((s) => s.version);
  return useMemo(() => (top ? contexts.get(top) ?? {} : {}), [top, version]);
}

/** Read the active context outside React (the dock calls its callbacks at the moment of use). */
export function activeAskContext(): AskContext {
  const { stack } = useAskStore.getState();
  const top = stack[stack.length - 1];
  return top ? contexts.get(top) ?? {} : {};
}

export interface AskApi {
  /** Focus the Ask field (and open the command popover). */
  focus(): void;
  /** Send text as if typed into Ask in the current view. */
  submit(text: string): void;
  /** Put text in the field without sending (e.g. a suggestion to edit). */
  setDraft(text: string): void;
}

const askApi: AskApi = {
  focus: () => useAskStore.setState((s) => ({ focusTick: s.focusTick + 1 })),
  submit: (text) => {
    const t = text.trim();
    if (t) useAskStore.setState((s) => ({ queued: { text: t, tick: (s.queued?.tick ?? 0) + 1 } }));
  },
  setDraft: (text) => {
    useAskStore.setState((s) => ({ draft: text, focusTick: s.focusTick + 1 }));
  },
};

/** Talk to the dock's Ask field from any view. Stable; doesn't re-render. */
export function useAsk(): AskApi {
  return askApi;
}
