import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 12.5 → 12′6″   18 → 18′ (primes, as DESIGN.md writes dimensions) */
export function feetInches(ft: number): string {
  const neg = ft < 0;
  let whole = Math.floor(Math.abs(ft) + 1e-6);
  let inches = Math.round((Math.abs(ft) - whole) * 12);
  if (inches === 12) { whole += 1; inches = 0; }
  return `${neg ? "-" : ""}${whole}′${inches ? `${inches}″` : ""}`;
}

/** Room size label like 18′×18′ (or 12′6″×13′). */
export function sizeLabel(w: number, d: number): string {
  return `${feetInches(w)}×${feetInches(d)}`;
}

export function sqft(n: number): string {
  return `${Math.round(n).toLocaleString("en-US")} sq ft`;
}

export function num(n: number, digits = 0): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function relativeTime(iso: string, nowMs = Date.now()): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const s = Math.round((t - nowMs) / 1000);
  const a = Math.abs(s);
  if (a < 45) return "just now";
  if (a < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (a < 86400) return rtf.format(Math.round(s / 3600), "hour");
  if (a < 86400 * 6) return rtf.format(Math.round(s / 86400), "day");
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** 17.5 → "5:30 pm" */
export function hourLabel(h: number): string {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  const suffix = hh >= 12 ? "pm" : "am";
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}:${String(mm).padStart(2, "0")} ${suffix}`;
}

/** Version summaries are change summaries joined with "; " — drop the stray full stops ("windows.; Updated"). */
export function tidySummary(s: string): string {
  return s.replace(/\.\s*;\s*/g, "; ").replace(/\s+/g, " ").trim();
}

export function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
