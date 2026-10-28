/**
 * SSE over POST (track: APP). See contracts/api.md, "Streaming".
 *
 * EventSource only supports GET, so streams are read with fetch() + ReadableStream and parsed here
 * following the WHATWG event-stream rules: `event:` / `data:` fields, multi-line data, `:` comments,
 * CR/LF/CRLF line endings, and a blank line that dispatches the event.
 *
 * Semantics shared by the real and mock clients:
 * - Every typed event goes to its handler (handler exceptions are logged, never kill the stream).
 * - `ping` only resets the idle watchdog (and reaches a handler if one is given).
 * - `done` resolves the promise. `error` calls its handler, then rejects with a StreamError.
 * - A stream that closes without `done`/`error` rejects with a recoverable StreamError.
 * - Aborting via the caller's AbortSignal rejects with an AbortError (check with isAbortError).
 */
import type { SSEEvents } from "@contracts/api-types";

export type SSEEventName = keyof SSEEvents;
export type SSEHandlers = { [K in SSEEventName]?: (data: SSEEvents[K]) => void };

export interface StreamOptions {
  signal?: AbortSignal;
  /** Abort if nothing (not even a ping) arrives for this long. The server pings every 15 s. */
  idleTimeoutMs?: number;
}

export class StreamError extends Error {
  readonly recoverable: boolean;
  readonly status?: number;
  constructor(message: string, recoverable = true, status?: number) {
    super(message);
    this.name = "StreamError";
    this.recoverable = recoverable;
    this.status = status;
  }
}

export function isAbortError(e: unknown): boolean {
  return (
    (e instanceof DOMException && e.name === "AbortError") ||
    (e instanceof Error && e.name === "AbortError")
  );
}

/** Dispatch one parsed event to the typed handlers. Returns "done" | "error" | null. */
export function dispatchSSE(
  handlers: SSEHandlers,
  event: string,
  data: unknown,
): { terminal: "done" | null } {
  const name = event as SSEEventName;
  const handler = handlers[name] as ((d: unknown) => void) | undefined;
  if (name === "error") {
    const payload = (data ?? {}) as SSEEvents["error"];
    try { handler?.(payload); } catch (err) { console.error("[sse] error handler threw", err); }
    throw new StreamError(payload.message || "Naqsha hit a problem. Try again.", payload.recoverable ?? true);
  }
  try {
    handler?.(data);
  } catch (err) {
    console.error(`[sse] handler for "${event}" threw`, err);
  }
  return { terminal: name === "done" ? "done" : null };
}

interface ParsedEvent { event: string; data: string }

/** Incremental event-stream parser. Feed text chunks, get complete events back. */
export class SSEParser {
  private buf = "";
  private pendingCR = false;
  private event = "";
  private data: string[] = [];

  feed(chunk: string): ParsedEvent[] {
    let text = chunk;
    if (this.pendingCR) { text = "\r" + text; this.pendingCR = false; }
    // Hold back a trailing CR: it may be the first half of a CRLF split across chunks.
    if (text.endsWith("\r")) { this.pendingCR = true; text = text.slice(0, -1); }
    this.buf += text.replace(/\r\n?/g, "\n");

    const out: ParsedEvent[] = [];
    let nl: number;
    while ((nl = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, nl);
      this.buf = this.buf.slice(nl + 1);
      const ev = this.line(line);
      if (ev) out.push(ev);
    }
    return out;
  }

  /** Flush at end of stream (a final event without its blank line is still dispatched). */
  end(): ParsedEvent[] {
    const out: ParsedEvent[] = [];
    if (this.pendingCR) { this.pendingCR = false; }
    if (this.buf.length) { const ev = this.line(this.buf); this.buf = ""; if (ev) out.push(ev); }
    const ev = this.line("");
    if (ev) out.push(ev);
    return out;
  }

  private line(line: string): ParsedEvent | null {
    if (line === "") {
      if (!this.data.length && !this.event) return null;
      const ev = { event: this.event || "message", data: this.data.join("\n") };
      this.event = "";
      this.data = [];
      return ev;
    }
    if (line.startsWith(":")) return null; // comment / keepalive
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") this.event = value;
    else if (field === "data") this.data.push(value);
    // `id` and `retry` are irrelevant for POST streams.
    return null;
  }
}

function parseData(raw: string): unknown {
  if (raw === "") return {};
  try { return JSON.parse(raw); } catch { return { text: raw }; }
}

async function errorFromResponse(res: Response): Promise<StreamError> {
  let detail = "";
  try {
    const text = await res.text();
    try {
      const j = JSON.parse(text) as { detail?: unknown; message?: unknown };
      detail = typeof j.detail === "string" ? j.detail : typeof j.message === "string" ? j.message : text;
    } catch { detail = text; }
  } catch { /* ignore */ }
  const recoverable = res.status >= 500 || res.status === 429;
  // An HTML error page (a proxy or a crash) is never shown to people: say it plainly instead.
  if (!detail || /^\s*</.test(detail)) {
    detail =
      res.status === 404 ? "Not found." :
      res.status === 401 ? "Please sign in to do that." :
      res.status === 403 ? "You don't have access to that." :
      recoverable ? "Naqsha is briefly unavailable. Try again shortly." :
      `The server returned ${res.status}.`;
  }
  return new StreamError(detail.slice(0, 300), recoverable, res.status);
}

/** Read until the server closes the stream, or cancel after `ms`. */
async function drain(reader: ReadableStreamDefaultReader<string>, ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  try {
    while (Date.now() < deadline) {
      const left = deadline - Date.now();
      const r = await Promise.race([reader.read(), new Promise<null>((res) => setTimeout(() => res(null), left))]);
      if (r === null) break;
      if (r.done) return;
    }
  } catch {
    return;
  }
  reader.cancel().catch(() => {});
}

/**
 * Open an SSE stream (POST with a JSON body, or GET) and consume it.
 * Resolves "done" when the server sends `done`, or "empty" on 204 No Content (nothing to stream).
 */
export async function openSSE(
  url: string,
  init: { method: "GET" | "POST"; body?: unknown; headers: Record<string, string> },
  handlers: SSEHandlers,
  opts: StreamOptions = {},
): Promise<"done" | "empty"> {
  const ctrl = new AbortController();
  const outer = opts.signal;
  if (outer?.aborted) throw new DOMException("Aborted", "AbortError");
  const forwardAbort = () => ctrl.abort(outer?.reason ?? new DOMException("Aborted", "AbortError"));
  outer?.addEventListener("abort", forwardAbort, { once: true });

  const idleMs = opts.idleTimeoutMs ?? 60_000;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let idleFired = false;
  const resetIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { idleFired = true; ctrl.abort(); }, idleMs);
  };

  let reader: ReadableStreamDefaultReader<string> | undefined;
  let finished = false;
  try {
    resetIdle();
    let res: Response;
    try {
      res = await fetch(url, {
        method: init.method,
        headers: {
          Accept: "text/event-stream",
          ...(init.method === "POST" ? { "Content-Type": "application/json" } : {}),
          ...init.headers,
        },
        body: init.method === "POST" ? JSON.stringify(init.body ?? {}) : undefined,
        signal: ctrl.signal,
        cache: "no-store",
      });
    } catch (e) {
      if (idleFired) throw new StreamError("The server took too long to respond.", true);
      if (isAbortError(e)) throw e;
      throw new StreamError("Can't reach the Naqsha server. Check your connection and try again.", true);
    }
    if (res.status === 204) return "empty";
    if (!res.ok) throw await errorFromResponse(res);
    if (!res.body) throw new StreamError("This browser can't read streaming responses.", false);

    reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    const parser = new SSEParser();
    for (;;) {
      let chunk: ReadableStreamReadResult<string>;
      try {
        chunk = await reader.read();
      } catch (e) {
        if (idleFired) throw new StreamError("Naqsha went quiet for too long. Try again.", true);
        if (isAbortError(e) || outer?.aborted) throw new DOMException("Aborted", "AbortError");
        throw new StreamError("The connection dropped mid-stream. Try again.", true);
      }
      const events = chunk.done ? parser.end() : parser.feed(chunk.value);
      if (!chunk.done) resetIdle();
      for (const ev of events) {
        const { terminal } = dispatchSSE(handlers, ev.event, parseData(ev.data));
        if (terminal === "done") {
          finished = true;
          return "done";
        }
      }
      if (chunk.done) break;
    }
    throw new StreamError("The connection closed before Naqsha finished. Try again.", true);
  } finally {
    clearTimeout(idleTimer);
    outer?.removeEventListener("abort", forwardAbort);
    // Release the connection. After `done`, give the server a moment to close the stream itself, so a finished
    // stream doesn't show up as "aborted" in DevTools; otherwise (error, abort) cancel it now.
    if (reader) {
      if (finished) void drain(reader, 1500);
      else reader.cancel().catch(() => {});
    }
  }
}
