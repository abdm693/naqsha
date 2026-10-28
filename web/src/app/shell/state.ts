/** Floating pieces of the project shell that are open (sheets, dialogs). */
import { create } from "zustand";

export type LeftPanel = "chat" | null;
export type RightPanel = "comments" | null;

interface ShellState {
  left: LeftPanel;
  right: RightPanel;
  share: boolean;
  /** The comments sheet opens on "Revise with N comments" (from the Next pill). */
  applyMode: boolean;
  /** A comment to scroll to and highlight in the sheet. */
  focusComment: string | null;
  /** How much of the bottom edge the dock takes (px), as --dock-h says; views fit their drawings above it. */
  dockH: number;
  /** A view's own right-hand sheet (Plan's compliance sheet), px wide: the dock moves clear of it. 0 when none. */
  viewSheet: number;
  setViewSheet(px: number): void;
  /** House's "notes from the 3D model" list (phones open it from the title menu). */
  asBuiltOpen: boolean;
  setAsBuiltOpen(open: boolean): void;
  /** A view's full-height phone sheet is open (House's room list): the view switch steps aside for it. */
  switchHidden: boolean;
  setSwitchHidden(hidden: boolean): void;
  toggleChat(open?: boolean): void;
  openComments(opts?: { apply?: boolean; focus?: string | null }): void;
  closeComments(): void;
  setShare(open: boolean): void;
  setApplyMode(on: boolean): void;
  reset(): void;
}

export const useShell = create<ShellState>((set, get) => ({
  left: null,
  right: null,
  share: false,
  applyMode: false,
  focusComment: null,
  dockH: 0,
  viewSheet: 0,
  asBuiltOpen: false,
  switchHidden: false,
  setSwitchHidden(hidden) {
    if (get().switchHidden !== hidden) set({ switchHidden: hidden });
  },
  setAsBuiltOpen(open) {
    set({ asBuiltOpen: open });
  },
  setViewSheet(px) {
    if (get().viewSheet !== px) set({ viewSheet: px });
  },
  toggleChat(open) {
    const next = open ?? get().left !== "chat";
    set({ left: next ? "chat" : null });
  },
  openComments({ apply = false, focus = null } = {}) {
    set({ right: "comments", applyMode: apply, focusComment: focus });
  },
  closeComments() {
    set({ right: null, applyMode: false, focusComment: null });
  },
  setShare(open) {
    set({ share: open });
  },
  setApplyMode(on) {
    set({ applyMode: on });
  },
  reset() {
    set({ left: null, right: null, share: false, applyMode: false, focusComment: null, viewSheet: 0, asBuiltOpen: false, switchHidden: false });
  },
}));
