/// <reference lib="webworker" />
/** Texture worker: generates procedural texture maps off the main thread. */
import { runTexJob, type TexJob } from "./texjob";

self.onmessage = (e: MessageEvent<TexJob>) => {
  const res = runTexJob(e.data);
  const transfer: ArrayBuffer[] = [];
  for (const a of [res.albedo, res.normal, res.rough]) if (a) transfer.push(a.buffer as ArrayBuffer);
  (self as unknown as Worker).postMessage(res, transfer);
};
