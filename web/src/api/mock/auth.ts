/**
 * Mock identity provider (VITE_MOCK=1): accounts live in localStorage, tokens are opaque strings.
 * Same error codes as the Identity Toolkit, so the UI's messages are exercised in mock mode too.
 */
import type { IdentityProvider, TokenSet } from "../auth";
import { AuthError, authMessage } from "../auth";
import { sleep } from "./db";

interface MockUser { uid: string; email: string; password: string; name?: string }

const KEY = "naqsha.mock.users";

function users(): Record<string, MockUser> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}") as Record<string, MockUser>;
  } catch {
    return {};
  }
}
function saveUsers(u: Record<string, MockUser>) {
  try { localStorage.setItem(KEY, JSON.stringify(u)); } catch { /* ignore */ }
}

const err = (code: string) => new AuthError(code, authMessage(code));
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function tokens(u: MockUser): TokenSet {
  return { idToken: `mock.${u.uid}.${Date.now()}`, refreshToken: `mockr.${u.uid}`, expiresIn: 3600, uid: u.uid, email: u.email, name: u.name };
}

/** The display name of a mock account (for "Shared by …"). */
export function mockUserName(uid: string | undefined): string | undefined {
  if (!uid) return undefined;
  const u = Object.values(users()).find((x) => x.uid === uid);
  return u ? u.name || u.email.split("@")[0] : undefined;
}

export const mockIdentity: IdentityProvider = {
  async signUp(email, password, name) {
    await sleep(500);
    const key = email.toLowerCase();
    if (!EMAIL.test(key)) throw err("INVALID_EMAIL");
    if (password.length < 6) throw err("WEAK_PASSWORD");
    const all = users();
    if (all[key]) throw err("EMAIL_EXISTS");
    const u: MockUser = { uid: `u_${Math.random().toString(36).slice(2, 10)}`, email: key, password, name: name || undefined };
    all[key] = u;
    saveUsers(all);
    return tokens(u);
  },
  async signIn(email, password) {
    await sleep(450);
    const key = email.toLowerCase();
    if (!EMAIL.test(key)) throw err("INVALID_EMAIL");
    if (!password) throw err("MISSING_PASSWORD");
    const u = users()[key];
    if (!u || u.password !== password) throw err("INVALID_LOGIN_CREDENTIALS");
    return tokens(u);
  },
  async refresh(refreshToken) {
    await sleep(120);
    const uid = refreshToken.replace(/^mockr\./, "");
    const u = Object.values(users()).find((x) => x.uid === uid);
    if (!u) throw err("INVALID_REFRESH_TOKEN");
    return tokens(u);
  },
  async sendReset(email) {
    await sleep(400);
    if (!EMAIL.test(email)) throw err("INVALID_EMAIL");
  },
};
