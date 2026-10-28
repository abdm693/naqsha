/** How many modal dialogs are open (toasts move below them, to the bottom edge, while any is). */
import { useEffect } from "react";
import { create } from "zustand";

export const useModals = create<{ count: number }>(() => ({ count: 0 }));

export function useModalOpen(open: boolean) {
  useEffect(() => {
    if (!open) return;
    useModals.setState((s) => ({ count: s.count + 1 }));
    return () => useModals.setState((s) => ({ count: Math.max(0, s.count - 1) }));
  }, [open]);
}
