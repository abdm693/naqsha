/**
 * The setup conversation as the Brief view reads it: messages, the streaming draft and the in-flight turn.
 *
 * The conversation itself lives in the shell's project store (`@/app/store/project`: messages, sendIntake), so the
 * Brief, the dock's Ask field and the conversation sheet share one sender and one history. This module mirrors it
 * into `useChat` and keeps the two things only the Brief needs: "Decide everything for me" (autopilot) and the live
 * plot preview while the plot widget is edited.
 */
import { create } from "zustand";
import type { ChatMessage, Envelope } from "@contracts/api-types";
import type { IntakeBody } from "@/api/client";
import { useProject } from "@/app/store/project";

/** Live preview while the plot widget is being edited (the canvas follows it before it is sent). */
export interface PlotPreview { width: number; depth: number; corner: boolean; envelope: Envelope | null }

interface ChatState {
  pid: string | null;
  loaded: boolean;
  messages: ChatMessage[];
  draft: string | null;
  busy: boolean;
  failed: IntakeBody | null;
  /** Set when "Decide everything for me" ran: carry on to concepts, a plan and a walkable house. */
  autopilot: boolean;
  preview: PlotPreview | null;
}

export const useChat = create<ChatState>(() => ({
  pid: null,
  loaded: false,
  messages: [],
  draft: null,
  busy: false,
  failed: null,
  autopilot: false,
  preview: null,
}));

function sync() {
  const st = useProject.getState();
  const pid = st.shareToken ? null : st.pid;
  const cur = useChat.getState();
  const loaded = !!pid && st.loadState === "ready";
  const next: Partial<ChatState> = {};
  if (pid !== cur.pid) Object.assign(next, { pid, autopilot: false, preview: null });
  if (loaded !== cur.loaded) next.loaded = loaded;
  if (st.messages !== cur.messages) next.messages = st.messages;
  if (st.draft !== cur.draft) next.draft = st.draft;
  if (st.intakeBusy !== cur.busy) next.busy = st.intakeBusy;
  if (st.intakeFailed !== cur.failed) next.failed = st.intakeFailed;
  if (Object.keys(next).length) useChat.setState(next);
}

sync();
useProject.subscribe(sync);

const live = (pid: string) => {
  const st = useProject.getState();
  return st.pid === pid && !st.shareToken;
};

export const chat = {
  /** An empty conversation starts with Naqsha's greeting (POST /intake {action: "start"}). */
  async open(pid: string) {
    if (!live(pid)) return;
    const st = useProject.getState();
    if (st.loadState === "ready" && st.project?.role !== "client") await st.startIntake();
  },

  async send(pid: string, body: IntakeBody, display?: string) {
    if (!live(pid)) return;
    if (body.action === "skip_all") useChat.setState({ autopilot: true });
    await useProject.getState().sendIntake(body, display);
    if (useProject.getState().intakeFailed) useChat.setState({ autopilot: false });
  },

  /**
   * Send the turn that failed again. After a reload the failure is gone but the person's last message is still
   * unanswered: send that text again without adding a second bubble.
   */
  async retry(pid: string, unanswered?: string) {
    if (!live(pid)) return;
    const st = useProject.getState();
    if (!st.intakeFailed && unanswered) useProject.setState({ intakeFailed: { message: unanswered } });
    await useProject.getState().retryIntake();
  },

  setPreview(preview: PlotPreview | null) {
    useChat.setState({ preview });
  },

  stopAutopilot() {
    useChat.setState({ autopilot: false });
  },
};
