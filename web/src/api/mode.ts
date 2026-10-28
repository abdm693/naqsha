/** Mock mode: VITE_MOCK=1, or localStorage["naqsha.mock"] = "1". */
export function mockEnabled(): boolean {
  if (import.meta.env.VITE_MOCK === "1") return true;
  try {
    return localStorage.getItem("naqsha.mock") === "1";
  } catch {
    return false;
  }
}

/** The guest identity: a UUID made once per browser and sent as X-Naqsha-User. */
export function userId(): string {
  let id: string | null = null;
  try { id = localStorage.getItem("naqsha.uid"); } catch { /* private mode */ }
  if (!id) {
    id = crypto.randomUUID();
    try { localStorage.setItem("naqsha.uid", id); } catch { /* ignore */ }
  }
  return id;
}
