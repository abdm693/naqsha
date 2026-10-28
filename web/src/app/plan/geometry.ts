/**
 * Plan geometry for the 2D drawing: walls derived from room edges, openings snapped to walls,
 * and stair flights. Units are plan feet (see contracts/plan.ts: origin at the front-left plot
 * corner, +y away from the road).
 */
import type { BuildingPlan, Level, Opening, Room, RoomType, Stair } from "@contracts/plan";

export const EXT_WALL = 0.75;
export const INT_WALL = 0.375;

/** Room types without walls on their exterior edges. */
export const OPEN_TYPES = new Set<RoomType>(["porch", "balcony", "terrace", "lawn", "driveway", "courtyard", "open_space"]);
/** Site areas drawn only on the ground level (not building). */
export const SITE_TYPES = new Set<RoomType>(["lawn", "driveway", "courtyard", "open_space"]);

const EPS = 1e-3;
const key = (n: number) => Math.round(n * 1000) / 1000;

export interface Wall {
  /** "h" walls run along x at y = c; "v" walls run along y at x = c. */
  orient: "h" | "v";
  c: number;
  a: number;
  b: number;
  thick: number;
  exterior: boolean;
}

export interface Boundary {
  orient: "h" | "v";
  c: number;
  a: number;
  b: number;
  kind: "open" | "railing";
}

interface Edge {
  a: number;
  b: number;
  side: 1 | -1; // room lies on the +c side (1) or the -c side (-1)
  room: Room;
}

function opensInto(a: Room, b: Room) {
  return !!(a.open_to?.includes(b.id) || b.open_to?.includes(a.id));
}

/** Derive walls and open/railing boundaries for the rooms of one level. */
export function deriveWalls(rooms: Room[]): { walls: Wall[]; boundaries: Boundary[] } {
  const lines: Record<"h" | "v", Map<number, Edge[]>> = { h: new Map(), v: new Map() };
  const add = (o: "h" | "v", c: number, e: Edge) => {
    const k = key(c);
    const list = lines[o].get(k) ?? [];
    list.push(e);
    lines[o].set(k, list);
  };
  for (const r of rooms) {
    const { x, y, w, d } = r.rect;
    add("h", y, { a: x, b: x + w, side: 1, room: r });
    add("h", y + d, { a: x, b: x + w, side: -1, room: r });
    add("v", x, { a: y, b: y + d, side: 1, room: r });
    add("v", x + w, { a: y, b: y + d, side: -1, room: r });
  }

  const walls: Wall[] = [];
  const boundaries: Boundary[] = [];
  for (const orient of ["h", "v"] as const) {
    for (const [c, edges] of lines[orient]) {
      const stops = [...new Set(edges.flatMap((e) => [key(e.a), key(e.b)]))].sort((p, q) => p - q);
      for (let i = 0; i < stops.length - 1; i++) {
        const a = stops[i];
        const b = stops[i + 1];
        if (b - a < EPS) continue;
        const mid = (a + b) / 2;
        const pos = edges.find((e) => e.side === 1 && e.a <= mid + EPS && e.b >= mid - EPS)?.room;
        const neg = edges.find((e) => e.side === -1 && e.a <= mid + EPS && e.b >= mid - EPS)?.room;
        if (!pos && !neg) continue;

        let wall: { thick: number; exterior: boolean } | null = null;
        let boundary: Boundary["kind"] | null = null;
        if (pos && neg) {
          const posOpen = OPEN_TYPES.has(pos.type);
          const negOpen = OPEN_TYPES.has(neg.type);
          if (opensInto(pos, neg)) boundary = "open";
          else if (posOpen && negOpen) boundary = null;
          else if (posOpen || negOpen) {
            wall = { thick: EXT_WALL, exterior: true };
          } else wall = { thick: INT_WALL, exterior: false };
        } else {
          const r = (pos ?? neg)!;
          if (!OPEN_TYPES.has(r.type)) wall = { thick: EXT_WALL, exterior: true };
          else if (r.type === "balcony" || r.type === "terrace") boundary = "railing";
        }

        if (wall) {
          const last = walls[walls.length - 1];
          if (last && last.orient === orient && last.c === c && Math.abs(last.b - a) < EPS && last.thick === wall.thick) last.b = b;
          else walls.push({ orient, c, a, b, ...wall });
        } else if (boundary) {
          const last = boundaries[boundaries.length - 1];
          if (last && last.orient === orient && last.c === c && Math.abs(last.b - a) < EPS && last.kind === boundary) last.b = b;
          else boundaries.push({ orient, c, a, b, kind: boundary });
        }
      }
    }
  }
  return { walls, boundaries };
}

export interface PlacedOpening {
  opening: Opening;
  orient: "h" | "v";
  c: number; // wall line
  a: number; // start along the wall
  b: number; // end along the wall
  thick: number;
  /** +1 if the door swings toward +y (h walls) or +x (v walls). */
  swingDir: 1 | -1;
  /** Hinge at the "a" end (true) or the "b" end. */
  hingeAtA: boolean;
}

function centerOf(r: Room) {
  return { x: r.rect.x + r.rect.w / 2, y: r.rect.y + r.rect.d / 2 };
}

/** Snap each opening to the nearest wall/boundary line within 1.5 ft and work out its swing. */
export function placeOpenings(openings: Opening[], rooms: Room[], walls: Wall[], boundaries: Boundary[]): PlacedOpening[] {
  const out: PlacedOpening[] = [];
  const byId = new Map(rooms.map((r) => [r.id, r]));
  for (const o of openings) {
    const [px, py] = o.at;
    let best: { orient: "h" | "v"; c: number; thick: number; dist: number } | null = null;
    const consider = (orient: "h" | "v", c: number, a: number, b: number, thick: number) => {
      const along = orient === "h" ? px : py;
      const across = orient === "h" ? py : px;
      const dist = Math.abs(across - c);
      if (dist > 1.5 || along < a - 0.5 || along > b + 0.5) return;
      if (!best || dist < best.dist) best = { orient, c, thick, dist };
    };
    for (const w of walls) consider(w.orient, w.c, w.a, w.b, w.thick);
    for (const bd of boundaries) consider(bd.orient, bd.c, bd.a, bd.b, INT_WALL);
    // Fall back to the edge of the room it belongs to.
    if (!best) {
      const r = byId.get(o.between[0]) ?? byId.get(o.between[1]);
      if (r) {
        const { x, y, w, d } = r.rect;
        const cands: [number, "h" | "v", number][] = [
          [Math.abs(py - y), "h", y],
          [Math.abs(py - (y + d)), "h", y + d],
          [Math.abs(px - x), "v", x],
          [Math.abs(px - (x + w)), "v", x + w],
        ];
        cands.sort((p, q) => p[0] - q[0]);
        best = { orient: cands[0][1], c: cands[0][2], thick: EXT_WALL, dist: cands[0][0] };
      }
    }
    if (!best) continue;
    const { orient, c, thick } = best as { orient: "h" | "v"; c: number; thick: number };
    const along = orient === "h" ? px : py;
    const a = along - o.width_ft / 2;
    const b = along + o.width_ft / 2;

    // Swing into between[0] by default ("in"), or toward between[1] ("out").
    const target = byId.get(o.swing === "out" ? o.between[1] : o.between[0]) ?? byId.get(o.between[0]);
    let swingDir: 1 | -1 = 1;
    let hingeAtA = true;
    if (target) {
      const ctr = centerOf(target);
      swingDir = (orient === "h" ? ctr.y - c : ctr.x - c) >= 0 ? 1 : -1;
      // Hinge on the jamb closer to the target room's nearer side wall, as built doors usually are.
      const lo = orient === "h" ? target.rect.x : target.rect.y;
      const hi = orient === "h" ? target.rect.x + target.rect.w : target.rect.y + target.rect.d;
      hingeAtA = Math.abs(a - lo) <= Math.abs(hi - b);
    } else if (o.between.includes("exterior")) {
      // Exterior doors swing inward, away from the outside.
      const other = byId.get(o.between.find((x) => x !== "exterior") ?? "");
      if (other) {
        const ctr = centerOf(other);
        swingDir = (orient === "h" ? ctr.y - c : ctr.x - c) >= 0 ? 1 : -1;
      }
    }
    out.push({ opening: o, orient, c, a, b, thick, swingDir, hingeAtA });
  }
  return out;
}

/** Subtract opening gaps from a wall; returns the solid pieces (with end extensions to close corners). */
export function wallPieces(w: Wall, gaps: { a: number; b: number }[]): { a: number; b: number }[] {
  const ext = w.thick / 2;
  let pieces = [{ a: w.a - ext, b: w.b + ext }];
  for (const g of gaps) {
    const next: { a: number; b: number }[] = [];
    for (const p of pieces) {
      if (g.b <= p.a || g.a >= p.b) next.push(p);
      else {
        if (g.a > p.a) next.push({ a: p.a, b: g.a });
        if (g.b < p.b) next.push({ a: g.b, b: p.b });
      }
    }
    pieces = next;
  }
  return pieces.filter((p) => p.b - p.a > 0.05);
}

export interface Flight {
  /** Tread lines as segments, in plan ft. */
  treads: [number, number, number, number][];
  outline: [number, number][];
}

export interface StairDrawing {
  stair: Stair;
  outline: { x: number; y: number; w: number; d: number };
  flights: Flight[];
  landing?: { x: number; y: number; w: number; d: number };
  path: [number, number][];
  risers: number;
}

/** Lay out the flights of a stair inside its rect (dog-leg: two flights side by side with a landing). */
export function stairDrawing(stair: Stair, levels: Level[]): StairDrawing {
  const from = levels.find((l) => l.id === stair.from_level);
  const to = levels.find((l) => l.id === stair.to_level);
  const rise = from && to ? (to.elevation_ft - from.elevation_ft) * 12 : 132;
  const risers = Math.max(2, Math.round(rise / (stair.riser_in || 7)));
  const tread = (stair.tread_in || 10) / 12;
  const r = stair.rect;
  const alongY = stair.start === "+y" || stair.start === "-y";
  const dir = stair.start === "+y" || stair.start === "+x" ? 1 : -1;
  const len = alongY ? r.d : r.w; // length along the run
  const across = alongY ? r.w : r.d;

  // Map local (u along run from the start edge, v across) to plan coords.
  const toPlan = (u: number, v: number): [number, number] => {
    if (alongY) return [r.x + v, dir === 1 ? r.y + u : r.y + r.d - u];
    return [dir === 1 ? r.x + u : r.x + r.w - u, r.y + v];
  };

  const flights: Flight[] = [];
  let landing: StairDrawing["landing"];
  let path: [number, number][] = [];

  if (stair.kind === "straight") {
    const steps = risers - 1;
    const flightLen = Math.min(len, steps * tread);
    const treads: Flight["treads"] = [];
    for (let i = 1; i <= steps; i++) {
      const u = (i * flightLen) / steps;
      const [x1, y1] = toPlan(u, 0);
      const [x2, y2] = toPlan(u, across);
      treads.push([x1, y1, x2, y2]);
    }
    flights.push({ treads, outline: [toPlan(0, 0), toPlan(flightLen, 0), toPlan(flightLen, across), toPlan(0, across)] });
    path = [toPlan(0.4, across / 2), toPlan(flightLen - 0.3, across / 2)];
  } else {
    // dog-leg (and L-shape, drawn the same way): flight 1 up one half, landing, flight 2 back down the other half
    const fw = Math.min(stair.width_ft || across / 2, across / 2);
    const steps1 = Math.ceil(risers / 2) - 1;
    const steps2 = risers - Math.ceil(risers / 2) - 1;
    const flightLen = Math.min(len - 3, Math.max(steps1, steps2) * tread);
    const landingDepth = len - flightLen;
    const mk = (vFrom: number, vTo: number, steps: number) => {
      const treads: Flight["treads"] = [];
      for (let i = 1; i <= steps; i++) {
        const u = (i * flightLen) / steps;
        const [x1, y1] = toPlan(u, vFrom);
        const [x2, y2] = toPlan(u, vTo);
        treads.push([x1, y1, x2, y2]);
      }
      return { treads, outline: [toPlan(0, vFrom), toPlan(flightLen, vFrom), toPlan(flightLen, vTo), toPlan(0, vTo)] as [number, number][] };
    };
    flights.push(mk(0, fw, steps1));
    flights.push(mk(across - fw, across, steps2));
    const [lx1, ly1] = toPlan(flightLen, 0);
    const [lx2, ly2] = toPlan(len, across);
    landing = { x: Math.min(lx1, lx2), y: Math.min(ly1, ly2), w: Math.abs(lx2 - lx1), d: Math.abs(ly2 - ly1) };
    path = [
      toPlan(0.4, fw / 2),
      toPlan(flightLen + landingDepth / 2, fw / 2),
      toPlan(flightLen + landingDepth / 2, across - fw / 2),
      toPlan(0.6, across - fw / 2),
    ];
  }
  return { stair, outline: r, flights, landing, path, risers };
}

/** Bounding box of a set of rooms. */
export function bounds(rooms: Room[]) {
  if (!rooms.length) return null;
  const x0 = Math.min(...rooms.map((r) => r.rect.x));
  const y0 = Math.min(...rooms.map((r) => r.rect.y));
  const x1 = Math.max(...rooms.map((r) => r.rect.x + r.rect.w));
  const y1 = Math.max(...rooms.map((r) => r.rect.y + r.rect.d));
  return { x: x0, y: y0, w: x1 - x0, d: y1 - y0 };
}

export function levelOrder(plan: BuildingPlan): Level[] {
  return [...plan.levels].sort((a, b) => a.index - b.index);
}
