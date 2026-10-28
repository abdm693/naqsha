/** Texture job: run a generator and pack albedo / normal / roughness maps (shared by the worker and the sync fallback). */
import { GENERATORS, type GenParams } from "./gen";
import { hexRGB } from "./noise";

export interface TexJob {
  id: number;
  gen: string;
  N: number;
  base: string;
  seed: number;
  params: GenParams;
  normal: number;
  wantAlbedo: boolean;
}

export interface TexResult {
  id: number;
  albedo: Uint8Array | null;
  normal: Uint8Array | null;
  rough: Uint8Array | null;
  roughMean: number;
}

export function runTexJob(job: TexJob): TexResult {
  const { N } = job;
  const data = GENERATORS[job.gen](N, hexRGB(job.base), job.seed, job.params ?? {});
  let normal: Uint8Array | null = null;
  if (data.height && job.normal > 0) normal = normalFromHeight(data.height, N, job.normal * (N / 512));
  let rough: Uint8Array | null = null;
  let roughMean = 1;
  if (data.rough) {
    rough = new Uint8Array(N * N * 4);
    let sum = 0;
    for (let i = 0; i < N * N; i++) {
      const v = Math.max(0, Math.min(1, data.rough[i]));
      sum += v;
      const b = (v * 255) | 0;
      rough[i * 4] = b;
      rough[i * 4 + 1] = b;
      rough[i * 4 + 2] = b;
      rough[i * 4 + 3] = 255;
    }
    roughMean = Math.max(0.05, sum / (N * N));
  }
  return { id: job.id, albedo: job.wantAlbedo ? data.albedo : null, normal, rough, roughMean };
}

export function normalFromHeight(h: Float32Array, N: number, strength: number): Uint8Array {
  const out = new Uint8Array(N * N * 4);
  const M = N - 1;
  for (let y = 0; y < N; y++) {
    const yu = ((y + 1) & M) * N, yd = ((y - 1 + N) & M) * N, yc = y * N;
    for (let x = 0; x < N; x++) {
      const xr = (x + 1) & M, xl = (x - 1 + N) & M;
      const dx = (h[yc + xr] - h[yc + xl]) * strength;
      const dy = (h[yu + x] - h[yd + x]) * strength;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const k = (yc + x) << 2;
      out[k] = ((-dx * inv * 0.5 + 0.5) * 255) | 0;
      out[k + 1] = ((-dy * inv * 0.5 + 0.5) * 255) | 0;
      out[k + 2] = ((inv * 0.5 + 0.5) * 255) | 0;
      out[k + 3] = 255;
    }
  }
  return out;
}
