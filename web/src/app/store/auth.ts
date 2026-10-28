/**
 * Who is using Naqsha: a guest (no account, projects tied to this browser) or a signed-in person.
 * Sign-in is never forced. It is offered when it matters: "Save your work", Share, or an invite.
 * `requireAccount(reason)` opens the dialog and resolves true once the person is signed in.
 * On sign-in, the guest's projects are claimed into the account (POST /api/me/claim).
 */
import { create } from "zustand";
import { api, userId } from "@/api/client";
import {
  currentUser,
  onSessionChange,
  rememberName,
  sendPasswordReset,
  signIn as authSignIn,
  signOut as authSignOut,
  signUp as authSignUp,
  type SessionUser,
} from "@/api/auth";
import { toast } from "./toast";

export type AuthMode = "signin" | "signup" | "reset";
/** Why we're asking: sets the dialog's title and line. */
export type AuthReason = "save" | "share" | "invite" | "comment" | "generic";

interface DialogState {
  open: boolean;
  mode: AuthMode;
  reason: AuthReason;
}

interface AuthState {
  user: SessionUser | null;
  dialog: DialogState;
  /** Bumped after a sign-in or sign-out (and after claiming), so lists reload. */
  epoch: number;

  openAuth(opts?: { mode?: AuthMode; reason?: AuthReason }): Promise<boolean>;
  closeAuth(): void;
  setMode(mode: AuthMode): void;
  signIn(email: string, password: string): Promise<void>;
  signUp(name: string, email: string, password: string): Promise<void>;
  resetPassword(email: string): Promise<void>;
  signOut(): void;
}

let pending: ((ok: boolean) => void) | null = null;
/** True while this tab signs in (the store updates once, after the claim). */
let signingIn = false;
function settle(ok: boolean) {
  const fn = pending;
  pending = null;
  fn?.(ok);
}

/** After any sign-in: bring the guest's homes along, learn the server's view of the name. */
async function afterSignIn() {
  try {
    const { moved } = await api.claim(userId());
    if (moved > 0) toast.show(moved === 1 ? "Your home is now saved to your account." : `Your ${moved} homes are now saved to your account.`);
  } catch (e) {
    console.warn("claim failed", e);
  }
  try {
    const me = await api.me();
    if (me?.name) rememberName(me.name);
  } catch { /* the token alone is enough */ }
}

export const useAuth = create<AuthState>((set, get) => ({
  user: currentUser(),
  dialog: { open: false, mode: "signin", reason: "generic" },
  epoch: 0,

  openAuth({ mode, reason = "generic" } = {}) {
    if (get().user) return Promise.resolve(true);
    settle(false);
    // People asked to save or share are usually new: start on "create an account".
    const m = mode ?? (reason === "generic" ? "signin" : "signup");
    set({ dialog: { open: true, mode: m, reason } });
    return new Promise<boolean>((resolve) => { pending = resolve; });
  },

  closeAuth() {
    set({ dialog: { ...get().dialog, open: false } });
    settle(!!get().user);
  },

  setMode(mode) {
    set({ dialog: { ...get().dialog, mode } });
  },

  async signIn(email, password) {
    signingIn = true;
    try {
      await authSignIn(email, password);
      await afterSignIn();
    } finally {
      signingIn = false;
    }
    set({ user: currentUser(), dialog: { ...get().dialog, open: false }, epoch: get().epoch + 1 });
    settle(true);
  },

  async signUp(name, email, password) {
    signingIn = true;
    try {
      await authSignUp(name, email, password);
      await afterSignIn();
    } finally {
      signingIn = false;
    }
    set({ user: currentUser(), dialog: { ...get().dialog, open: false }, epoch: get().epoch + 1 });
    settle(true);
  },

  async resetPassword(email) {
    await sendPasswordReset(email);
  },

  signOut() {
    authSignOut();
    set({ user: null, epoch: get().epoch + 1 });
    toast.show("Signed out. Homes you make now stay in this browser.");
  },
}));

// Another tab signed in or out, or the session expired: follow it.
onSessionChange((u) => {
  if (signingIn) return;
  const s = useAuth.getState();
  if (s.user?.uid === u?.uid && s.user?.name === u?.name) return;
  useAuth.setState({ user: u, epoch: s.epoch + (s.user?.uid !== u?.uid ? 1 : 0) });
});

/** Resolve true when the person is (or becomes) signed in; opens the dialog if needed. */
export function requireAccount(reason: AuthReason = "generic"): Promise<boolean> {
  return useAuth.getState().openAuth({ reason });
}
