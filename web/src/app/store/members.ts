/** People on the open project and its client link (the Share dialog and the people cluster). */
import { create } from "zustand";
import type { Member, Role } from "@contracts/api-types";
import { api, shareUrl, type ShareState } from "@/api/client";
import { toast } from "./toast";

type Invitable = Exclude<Role, "owner">;

interface MembersState {
  pid: string | null;
  members: Member[];
  share: ShareState;
  status: "idle" | "loading" | "ready" | "error";
  load(pid: string): Promise<void>;
  reset(): void;
  invite(email: string, role: Invitable): Promise<boolean>;
  setRole(email: string, role: Invitable): Promise<void>;
  remove(email: string): Promise<void>;
  setShare(enabled: boolean): Promise<string | undefined>;
}

export const useMembers = create<MembersState>((set, get) => ({
  pid: null,
  members: [],
  share: { enabled: false },
  status: "idle",

  async load(pid) {
    if (get().pid !== pid) set({ pid, members: [], share: { enabled: false }, status: "loading" });
    try {
      const r = await api.listMembers(pid);
      if (get().pid === pid) set({ members: r.members, share: r.share, status: "ready" });
    } catch {
      // Guests and older servers have no members list; the cluster simply shows nobody.
      if (get().pid === pid) set({ status: "error" });
    }
  },

  reset() {
    set({ pid: null, members: [], share: { enabled: false }, status: "idle" });
  },

  async invite(email, role) {
    const pid = get().pid;
    if (!pid) return false;
    try {
      const m = await api.inviteMember(pid, { email, role });
      if (get().pid !== pid) return true;
      const rest = get().members.filter((x) => x.email.toLowerCase() !== m.email.toLowerCase());
      set({ members: [...rest, m] });
      toast.show(`Invited ${m.email} as ${role === "team" ? "Team" : "Client"}`);
      return true;
    } catch (e) {
      toast.error("Couldn't send the invite", e);
      return false;
    }
  },

  async setRole(email, role) {
    const pid = get().pid;
    if (!pid) return;
    const before = get().members;
    set({ members: before.map((m) => (m.email === email ? { ...m, role } : m)) });
    try {
      await api.updateMember(pid, email, { role });
    } catch (e) {
      if (get().pid === pid) set({ members: before });
      toast.error("Couldn't change their access", e);
    }
  },

  async remove(email) {
    const pid = get().pid;
    if (!pid) return;
    const before = get().members;
    set({ members: before.filter((m) => m.email !== email) });
    try {
      await api.removeMember(pid, email);
      toast.show("Removed from this home");
    } catch (e) {
      if (get().pid === pid) set({ members: before });
      toast.error("Couldn't remove them", e);
    }
  },

  async setShare(enabled) {
    const pid = get().pid;
    if (!pid) return undefined;
    const before = get().share;
    set({ share: { ...before, enabled } });
    try {
      const r = await api.setShare(pid, enabled);
      if (get().pid === pid) set({ share: r });
      return shareUrl(r);
    } catch (e) {
      if (get().pid === pid) set({ share: before });
      toast.error(enabled ? "Couldn't turn on the client link" : "Couldn't turn off the client link", e);
      return undefined;
    }
  },
}));
