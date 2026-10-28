/** Plays a scripted SSE stream through the same dispatcher the real client uses. */
import type { SSEEvents } from "@contracts/api-types";
import { dispatchSSE, type SSEHandlers } from "../sse";
import { sleep } from "./db";

export type Step = { event: keyof SSEEvents; data: unknown } | number;

export const ev = <K extends keyof SSEEvents>(event: K, data: SSEEvents[K]): Step => ({ event, data });

/** Yield a number to wait that many ms; yield an event to dispatch it. Ends with `done`. */
export async function play(script: AsyncIterable<Step>, handlers: SSEHandlers, signal?: AbortSignal): Promise<void> {
  for await (const step of script) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (typeof step === "number") {
      await sleep(step, signal);
      continue;
    }
    const { terminal } = dispatchSSE(handlers, step.event, structuredClone(step.data));
    if (terminal === "done") return;
  }
  dispatchSSE(handlers, "done", {});
}

/** Split text into word-ish chunks for message.delta streaming. */
export function chunks(text: string, size = 2): string[] {
  const words = text.split(/(\s+)/);
  const out: string[] = [];
  for (let i = 0; i < words.length; i += size * 2) out.push(words.slice(i, i + size * 2).join(""));
  return out;
}
