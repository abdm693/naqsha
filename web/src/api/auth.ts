/**
 * Accounts: Google Identity Platform, email and password (contracts/api.md "Accounts and collaboration").
 *
 * The SPA talks to the Identity Toolkit REST API with the browser key from GET /api/config:
 * - accounts:signUp, accounts:signInWithPassword, accounts:update (display name), accounts:sendOobCode (reset)
 * - securetoken.googleapis.com/v1/token to refresh the ID token
 *
 * The session (ID token, refresh token, expiry) lives in localStorage["naqsha.session"]. `idToken()` returns a
 * fresh token, refreshing a minute before expiry (one refresh at a time). Guests have no session and keep using
 * X-Naqsha-User. In mock mode the same calls are simulated in the browser (api/mock/auth.ts).
 */
import { mockEnabled } from "./mode";
import { mockIdentity } from "./mock/auth";

export interface SessionUser { uid: string; email: string; name?: string }
export interface Session extends SessionUser {
  idToken: string;
  refreshToken: string;
  /** ms since epoch. */
  expiresAt: number;
}

export interface TokenSet { idToken: string; refreshToken: string; expiresIn: number; uid: string; email?: string; name?: string }

/** What the browser needs from an identity provider; the REST and mock versions both implement it. */
export interface IdentityProvider {
  signUp(email: string, password: string, name: string): Promise<TokenSet>;
  signIn(email: string, password: string): Promise<TokenSet>;
  refresh(refreshToken: string): Promise<TokenSet>;
  sendReset(email: string): Promise<void>;
}

export class AuthError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "AuthError";
    this.code = code;
  }
}

const MESSAGES: Record<string, string> = {
  EMAIL_EXISTS: "That email already has an account. Sign in instead.",
  EMAIL_NOT_FOUND: "That email and password don't match. Try again, or reset your password.",
  INVALID_PASSWORD: "That email and password don't match. Try again, or reset your password.",
  INVALID_LOGIN_CREDENTIALS: "That email and password don't match. Try again, or reset your password.",
  USER_DISABLED: "This account has been switched off. Write to us and we'll help.",
  TOO_MANY_ATTEMPTS_TRY_LATER: "Too many tries for now. Wait a minute, then try again.",
  WEAK_PASSWORD: "Use at least 6 characters for your password.",
  INVALID_EMAIL: "That doesn't look like an email address.",
  MISSING_EMAIL: "Enter your email address.",
  MISSING_PASSWORD: "Enter your password.",
  OPERATION_NOT_ALLOWED: "Email sign-in isn't switched on yet.",
  PASSWORD_LOGIN_DISABLED: "Email sign-in isn't switched on yet.",
  TOKEN_EXPIRED: "Please sign in again.",
  INVALID_REFRESH_TOKEN: "Please sign in again.",
  USER_NOT_FOUND: "Please sign in again.",
  INVALID_ID_TOKEN: "Please sign in again.",
  NETWORK: "Can't reach the sign-in service. Check your connection and try again.",
  NO_CONFIG: "Sign-in isn't available right now. You can keep working as a guest.",
};

export function authMessage(code: string): string {
  return MESSAGES[code] ?? "Sign-in didn't work. Please try again.";
}

const fail = (code: string) => new AuthError(code, authMessage(code));

// ── Config (GET /api/config) ─────────────────────────────────────────────────────────────────────────

export interface AppConfig { auth: { api_key: string; project_id: string } | null }
let configPromise: Promise<AppConfig> | null = null;

export function getConfig(): Promise<AppConfig> {
  if (mockEnabled()) return Promise.resolve({ auth: { api_key: "mock", project_id: "naqsha-mock" } });
  configPromise ??= fetch("/api/config", { headers: { Accept: "application/json" } })
    .then(async (r) => {
      if (!r.ok) throw new Error(String(r.status));
      const j = (await r.json()) as { auth?: { api_key?: string; project_id?: string } };
      return { auth: j.auth?.api_key ? { api_key: j.auth.api_key, project_id: j.auth.project_id ?? "" } : null };
    })
    .catch(() => {
      configPromise = null; // try again next time
      return { auth: null };
    });
  return configPromise;
}

async function apiKey(): Promise<string> {
  const c = await getConfig();
  if (!c.auth?.api_key) throw fail("NO_CONFIG");
  return c.auth.api_key;
}

// ── Identity Toolkit REST ────────────────────────────────────────────────────────────────────────────

const IDT = "https://identitytoolkit.googleapis.com/v1";
const STS = "https://securetoken.googleapis.com/v1/token";

async function post<T>(url: string, body: unknown, form = false): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": form ? "application/x-www-form-urlencoded" : "application/json" },
      body: form ? new URLSearchParams(body as Record<string, string>).toString() : JSON.stringify(body),
    });
  } catch {
    throw fail("NETWORK");
  }
  const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } } & T;
  if (!res.ok) {
    // "WEAK_PASSWORD : Password should be at least 6 characters" → WEAK_PASSWORD
    const code = (j.error?.message ?? "UNKNOWN").split(" ")[0].trim();
    throw fail(code);
  }
  return j;
}

interface IdtAuth { idToken: string; refreshToken: string; expiresIn: string; localId: string; email?: string; displayName?: string }

const restIdentity: IdentityProvider = {
  async signUp(email, password, name) {
    const key = await apiKey();
    const r = await post<IdtAuth>(`${IDT}/accounts:signUp?key=${key}`, { email, password, returnSecureToken: true });
    let idToken = r.idToken;
    let refreshToken = r.refreshToken;
    let expiresIn = Number(r.expiresIn);
    if (name) {
      await post(`${IDT}/accounts:update?key=${key}`, { idToken: r.idToken, displayName: name, returnSecureToken: false });
      // A fresh token carries the `name` claim the backend reads.
      const t = await restIdentity.refresh(r.refreshToken);
      idToken = t.idToken;
      refreshToken = t.refreshToken;
      expiresIn = t.expiresIn;
    }
    return { idToken, refreshToken, expiresIn, uid: r.localId, email: r.email ?? email, name: name || undefined };
  },
  async signIn(email, password) {
    const key = await apiKey();
    const r = await post<IdtAuth>(`${IDT}/accounts:signInWithPassword?key=${key}`, { email, password, returnSecureToken: true });
    return { idToken: r.idToken, refreshToken: r.refreshToken, expiresIn: Number(r.expiresIn), uid: r.localId, email: r.email ?? email, name: r.displayName || undefined };
  },
  async refresh(refreshToken) {
    const key = await apiKey();
    const r = await post<{ id_token: string; refresh_token: string; expires_in: string; user_id: string }>(
      `${STS}?key=${key}`,
      { grant_type: "refresh_token", refresh_token: refreshToken },
      true,
    );
    return { idToken: r.id_token, refreshToken: r.refresh_token, expiresIn: Number(r.expires_in), uid: r.user_id };
  },
  async sendReset(email) {
    const key = await apiKey();
    await post(`${IDT}/accounts:sendOobCode?key=${key}`, { requestType: "PASSWORD_RESET", email });
  },
};

const provider = (): IdentityProvider => (mockEnabled() ? mockIdentity : restIdentity);

// ── Session ─────────────────────────────────────────────────────────────────────────────────────────

const KEY = "naqsha.session";
let session: Session | null = load();
const listeners = new Set<(s: SessionUser | null) => void>();

function load(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    const s = raw ? (JSON.parse(raw) as Session) : null;
    return s && s.idToken && s.refreshToken && s.uid ? s : null;
  } catch {
    return null;
  }
}

function persist(next: Session | null) {
  const before = publicUser(session);
  session = next;
  try {
    if (next) localStorage.setItem(KEY, JSON.stringify(next));
    else localStorage.removeItem(KEY);
  } catch { /* private mode: the session lasts this tab */ }
  const after = publicUser(next);
  // Token refreshes are silent; only a change of person (or of their name) is news.
  if (before?.uid !== after?.uid || before?.name !== after?.name || before?.email !== after?.email) {
    for (const fn of listeners) fn(after);
  }
}

function publicUser(s: Session | null): SessionUser | null {
  return s ? { uid: s.uid, email: s.email, name: s.name } : null;
}

function fromTokens(t: TokenSet, base?: Partial<Session>): Session {
  return {
    uid: t.uid || base?.uid || "",
    email: t.email ?? base?.email ?? "",
    name: t.name ?? base?.name,
    idToken: t.idToken,
    refreshToken: t.refreshToken,
    expiresAt: Date.now() + (Number.isFinite(t.expiresIn) && t.expiresIn > 0 ? t.expiresIn : 3600) * 1000,
  };
}

// Another tab signed in or out: follow it.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key !== KEY) return;
    session = load();
    for (const fn of listeners) fn(publicUser(session));
  });
}

export function currentUser(): SessionUser | null {
  return publicUser(session);
}

export function onSessionChange(fn: (u: SessionUser | null) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function signUp(name: string, email: string, password: string): Promise<SessionUser> {
  const t = await provider().signUp(email.trim(), password, name.trim());
  persist(fromTokens(t, { email: email.trim(), name: name.trim() || undefined }));
  return currentUser()!;
}

export async function signIn(email: string, password: string): Promise<SessionUser> {
  const t = await provider().signIn(email.trim(), password);
  persist(fromTokens(t, { email: email.trim() }));
  return currentUser()!;
}

export async function sendPasswordReset(email: string): Promise<void> {
  await provider().sendReset(email.trim());
}

export function signOut(): void {
  persist(null);
}

/** Update the cached display name after the server tells us (GET /api/me). */
export function rememberName(name: string | undefined) {
  if (session && name && session.name !== name) persist({ ...session, name });
}

let refreshing: Promise<string | null> | null = null;

/** A valid ID token, refreshed when it is within a minute of expiring; null for guests. */
export async function idToken(force = false): Promise<string | null> {
  const s = session;
  if (!s) return null;
  if (!force && s.expiresAt - Date.now() > 60_000) return s.idToken;
  refreshing ??= provider()
    .refresh(s.refreshToken)
    .then((t) => {
      if (session?.uid !== s.uid) return session?.idToken ?? null; // signed out or switched meanwhile
      persist(fromTokens(t, s));
      return session!.idToken;
    })
    .catch((e: unknown) => {
      // A dead refresh token means the account session is over; a network blip keeps the old token.
      if (e instanceof AuthError && e.code !== "NETWORK" && e.code !== "NO_CONFIG") {
        persist(null);
        return null;
      }
      return s.idToken;
    })
    .finally(() => { refreshing = null; });
  return refreshing;
}
