/**
 * CellGrid: rectilinear decomposition of a set of axis-aligned rectangles. Used for wall edge analysis,
 * slab unions with holes, roof parapets and facade regions. Coordinates are plan feet.
 */
export interface R {
  x: number;
  y: number;
  w: number;
  d: number;
}

export function uniqSorted(vals: number[], eps = 1e-3): number[] {
  const s = vals.filter(Number.isFinite).sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of s) if (!out.length || v - out[out.length - 1] > eps) out.push(v);
  return out;
}

export interface EdgeRun<T> {
  /** run direction: "x" = runs along x (on the horizontal line y = c); "y" = runs along y (line x = c) */
  axis: "x" | "y";
  c: number;
  a: number;
  b: number;
  /** value on the lower-coordinate side of the line (y < c for axis "x"; x < c for axis "y") */
  neg: T | null;
  pos: T | null;
  key: string;
}

export class CellGrid<T> {
  readonly xs: number[];
  readonly ys: number[];
  readonly nx: number;
  readonly ny: number;
  readonly cells: (T | null)[];

  constructor(xs: number[], ys: number[]) {
    this.xs = xs;
    this.ys = ys;
    this.nx = Math.max(0, xs.length - 1);
    this.ny = Math.max(0, ys.length - 1);
    this.cells = new Array(this.nx * this.ny).fill(null);
  }

  /**
   * Build from rects. Later items overwrite earlier ones unless `pick(existing, incoming)` says otherwise.
   */
  static fromRects<T>(
    items: { rect: R; val: T }[],
    pick?: (existing: T, incoming: T) => T,
    extraXs: number[] = [],
    extraYs: number[] = [],
  ): CellGrid<T> {
    const xs: number[] = [...extraXs];
    const ys: number[] = [...extraYs];
    for (const it of items) {
      xs.push(it.rect.x, it.rect.x + it.rect.w);
      ys.push(it.rect.y, it.rect.y + it.rect.d);
    }
    const g = new CellGrid<T>(uniqSorted(xs), uniqSorted(ys));
    for (const it of items) g.fill(it.rect, it.val, pick);
    return g;
  }

  idx(i: number, j: number): number {
    return j * this.nx + i;
  }
  get(i: number, j: number): T | null {
    if (i < 0 || j < 0 || i >= this.nx || j >= this.ny) return null;
    return this.cells[j * this.nx + i];
  }
  set(i: number, j: number, v: T | null): void {
    if (i < 0 || j < 0 || i >= this.nx || j >= this.ny) return;
    this.cells[j * this.nx + i] = v;
  }

  /** Index range of cells covered by rect [x, x+w] × [y, y+d] (cell centers inside). */
  range(r: R): [number, number, number, number] {
    const i0 = Math.max(0, lowerIdx(this.xs, r.x) - 1);
    const i1 = Math.min(this.nx, upperIdx(this.xs, r.x + r.w));
    const j0 = Math.max(0, lowerIdx(this.ys, r.y) - 1);
    const j1 = Math.min(this.ny, upperIdx(this.ys, r.y + r.d));
    return [i0, i1, j0, j1];
  }

  fill(r: R, v: T | null, pick?: (existing: T, incoming: T) => T): void {
    const [i0, i1, j0, j1] = this.range(r);
    for (let j = j0; j < j1; j++)
      for (let i = i0; i < i1; i++) {
        const cx = (this.xs[i] + this.xs[i + 1]) / 2;
        const cy = (this.ys[j] + this.ys[j + 1]) / 2;
        if (cx < r.x || cx > r.x + r.w || cy < r.y || cy > r.y + r.d) continue;
        const k = j * this.nx + i;
        const cur = this.cells[k];
        this.cells[k] = cur != null && v != null && pick ? pick(cur, v) : v;
      }
  }

  cellRect(i: number, j: number): R {
    return { x: this.xs[i], y: this.ys[j], w: this.xs[i + 1] - this.xs[i], d: this.ys[j + 1] - this.ys[j] };
  }

  /** Cell containing point (or null outside). */
  cellAt(x: number, y: number): [number, number] | null {
    if (x < this.xs[0] || x > this.xs[this.nx] || y < this.ys[0] || y > this.ys[this.ny]) return null;
    const i = Math.min(this.nx - 1, Math.max(0, upperIdx(this.xs, x) - 1));
    const j = Math.min(this.ny - 1, Math.max(0, upperIdx(this.ys, y) - 1));
    return [i, j];
  }
  valueAt(x: number, y: number): T | null {
    const c = this.cellAt(x, y);
    return c ? this.get(c[0], c[1]) : null;
  }

  /** Merge cells satisfying pred into maximal-ish rectangles (greedy rows, then vertical merge). */
  rects(pred: (v: T | null) => boolean, groupKey?: (v: T | null) => string): (R & { key: string })[] {
    const out: (R & { key: string })[] = [];
    let open: { i0: number; i1: number; j0: number; key: string }[] = [];
    for (let j = 0; j <= this.ny; j++) {
      const spans: { i0: number; i1: number; key: string }[] = [];
      if (j < this.ny) {
        let i = 0;
        while (i < this.nx) {
          const v = this.get(i, j);
          if (!pred(v)) { i++; continue; }
          const key = groupKey ? groupKey(v) : "";
          let k = i + 1;
          while (k < this.nx && pred(this.get(k, j)) && (groupKey ? groupKey(this.get(k, j)) : "") === key) k++;
          spans.push({ i0: i, i1: k, key });
          i = k;
        }
      }
      const next: typeof open = [];
      for (const o of open) {
        const m = spans.findIndex((s) => s.i0 === o.i0 && s.i1 === o.i1 && s.key === o.key);
        if (m >= 0) {
          next.push(o);
          spans.splice(m, 1);
        } else {
          out.push({ x: this.xs[o.i0], y: this.ys[o.j0], w: this.xs[o.i1] - this.xs[o.i0], d: this.ys[j] - this.ys[o.j0], key: o.key });
        }
      }
      for (const s of spans) next.push({ i0: s.i0, i1: s.i1, j0: j, key: s.key });
      open = next;
    }
    return out;
  }

  /**
   * Boundary runs. keyFn(neg, pos) returns a key (string) when there is an edge of interest, else null.
   * Consecutive unit edges with the same key on the same grid line are merged into one run.
   */
  edgeRuns(keyFn: (neg: T | null, pos: T | null) => string | null): EdgeRun<T>[] {
    const out: EdgeRun<T>[] = [];
    // vertical lines x = xs[i]: runs along y
    for (let i = 0; i <= this.nx; i++) {
      let cur: EdgeRun<T> | null = null;
      for (let j = 0; j < this.ny; j++) {
        const neg = this.get(i - 1, j);
        const pos = this.get(i, j);
        const key = keyFn(neg, pos);
        if (key !== null && cur && cur.key === key && Math.abs(cur.b - this.ys[j]) < 1e-6) {
          cur.b = this.ys[j + 1];
          continue;
        }
        if (cur) out.push(cur);
        cur = key === null ? null : { axis: "y", c: this.xs[i], a: this.ys[j], b: this.ys[j + 1], neg, pos, key };
      }
      if (cur) out.push(cur);
    }
    // horizontal lines y = ys[j]: runs along x
    for (let j = 0; j <= this.ny; j++) {
      let cur: EdgeRun<T> | null = null;
      for (let i = 0; i < this.nx; i++) {
        const neg = this.get(i, j - 1);
        const pos = this.get(i, j);
        const key = keyFn(neg, pos);
        if (key !== null && cur && cur.key === key && Math.abs(cur.b - this.xs[i]) < 1e-6) {
          cur.b = this.xs[i + 1];
          continue;
        }
        if (cur) out.push(cur);
        cur = key === null ? null : { axis: "x", c: this.ys[j], a: this.xs[i], b: this.xs[i + 1], neg, pos, key };
      }
      if (cur) out.push(cur);
    }
    return out;
  }
}

/** first index k with arr[k] >= v - eps */
function lowerIdx(arr: number[], v: number): number {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (arr[m] < v - 1e-6) lo = m + 1;
    else hi = m;
  }
  return lo;
}
/** first index k with arr[k] > v + eps */
function upperIdx(arr: number[], v: number): number {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (arr[m] <= v + 1e-6) lo = m + 1;
    else hi = m;
  }
  return lo;
}

export function rectContains(r: R, x: number, y: number, eps = 1e-6): boolean {
  return x >= r.x - eps && x <= r.x + r.w + eps && y >= r.y - eps && y <= r.y + r.d + eps;
}
export function rectOverlap(a: R, b: R): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.d && b.y < a.y + a.d;
}
export function expandRect(r: R, e: number): R {
  return { x: r.x - e, y: r.y - e, w: r.w + 2 * e, d: r.d + 2 * e };
}
export function rectIntersect(a: R, b: R): R | null {
  const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.d, b.y + b.d);
  if (x1 - x0 <= 1e-6 || y1 - y0 <= 1e-6) return null;
  return { x: x0, y: y0, w: x1 - x0, d: y1 - y0 };
}
