/**
 * Dev-only 2D plan of one level as built: rooms, walls, stairwells, guards, furniture, keep-out zones (full and
 * core), the 3 ft path mask, the walkway, parking bays, the walk spawn and the spots a check flagged.
 */
import type { BuildResult } from "../index";
import type { BuildCtx } from "../core/ctx";
import { keepOut } from "../furniture/zones";
import { parking } from "../furniture/parking";
import { pathMask } from "../furniture/paths";
import type { Check } from "./checks";

export function drawPlan(canvas: HTMLCanvasElement, res: BuildResult, levelId: string, checks: Check[] = []): void {
  const ctx = (res as unknown as { ctx?: BuildCtx }).ctx;
  const g = canvas.getContext("2d");
  if (!ctx || !g) return;
  const plan = ctx.plan;
  const W = plan.plotW, D = plan.plotD;
  // an attached canvas draws at its CSS size; a detached one (exports) at its own pixel size
  const attached = canvas.clientWidth > 0;
  const dpr = attached ? Math.min(2, window.devicePixelRatio || 1) : 1;
  const cw = attached ? canvas.clientWidth : canvas.width, ch = attached ? canvas.clientHeight : canvas.height;
  canvas.width = cw * dpr;
  canvas.height = ch * dpr;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = "#f7f5f0";
  g.fillRect(0, 0, cw, ch);
  const pad = 26;
  const s = Math.min((cw - 2 * pad) / W, (ch - 2 * pad - 18) / D);
  // plan y grows away from the road: draw the road at the bottom
  const X = (x: number) => pad + x * s;
  const Y = (y: number) => ch - pad - y * s;
  const rect = (x0: number, y0: number, x1: number, y1: number) => g.rect(X(Math.min(x0, x1)), Y(Math.max(y0, y1)), Math.abs(x1 - x0) * s, Math.abs(y1 - y0) * s);
  g.strokeStyle = "#c9c4b9";
  g.lineWidth = 1;
  g.strokeRect(X(0), Y(D), W * s, D * s);
  const level = plan.levelById.get(levelId)!;
  // rooms
  for (const r of plan.roomsOn(levelId)) {
    g.beginPath();
    rect(r.rect.x, r.rect.y, r.rect.x + r.rect.w, r.rect.y + r.rect.d);
    g.fillStyle = r.cat === "enclosed" ? "#ffffff" : r.cat === "porch" ? "#efe9de" : r.cat === "deck" ? "#e9efe7" : "#eef2e6";
    g.fill();
    g.fillStyle = "#9a958c";
    g.font = "10px Inter, system-ui, sans-serif";
    g.fillText(r.name.slice(0, 22), X(r.rect.x) + 3, Y(r.rect.y + r.rect.d) + 11);
  }
  // path mask (3 ft walkable) for each room cluster
  const done = new Set<string>();
  for (const r of plan.roomsOn(levelId)) {
    if (done.has(r.id) || r.cat === "outdoor") continue;
    const m = pathMask(ctx, r);
    for (const q of plan.roomsOn(levelId)) if (q.open.has(r.id) || q === r) done.add(q.id);
    g.fillStyle = "rgba(120,190,140,0.22)";
    for (let j = 0; j < m.ny; j++)
      for (let i = 0; i < m.nx; i++) if (m.mask[j * m.nx + i]) g.fillRect(X(m.x0 + i * m.cell), Y(m.y0 + (j + 1) * m.cell), m.cell * s + 0.5, m.cell * s + 0.5);
    g.fillStyle = "#2f8f5b";
    for (const e of m.entries) {
      g.beginPath();
      g.arc(X(e.x), Y(e.y), 3, 0, Math.PI * 2);
      g.fill();
    }
  }
  // keep-out zones
  for (const r of plan.roomsOn(levelId)) {
    for (const z of keepOut(ctx, r)) {
      const col = z.kind === "door" ? "214,69,65" : z.kind === "gate" ? "60,120,210" : z.kind === "stair" ? "140,80,190" : z.kind === "window" ? "230,170,40" : "120,120,120";
      g.beginPath();
      rect(z.x0, z.y0, z.x1, z.y1);
      g.fillStyle = `rgba(${col},0.08)`;
      g.fill();
      if (z.core) {
        g.beginPath();
        rect(z.core.x0, z.core.y0, z.core.x1, z.core.y1);
        g.strokeStyle = `rgba(${col},0.7)`;
        g.setLineDash([3, 2]);
        g.stroke();
        g.setLineDash([]);
      }
    }
  }
  // walls
  for (const run of ctx.model.runsByLevel.get(levelId) ?? []) {
    g.strokeStyle = run.kind === "parapet" ? "#8a857c" : "#3b3a37";
    g.lineWidth = Math.max(1.5, run.t * s);
    const segs: [number, number][] = [];
    let cur = run.ea;
    for (const o of run.openings) {
      segs.push([cur, o.u0]);
      cur = o.u1;
    }
    segs.push([cur, run.eb]);
    for (const [a, b] of segs) {
      if (b - a < 0.02) continue;
      g.beginPath();
      if (run.axis === "x") {
        g.moveTo(X(a), Y(run.c));
        g.lineTo(X(b), Y(run.c));
      } else {
        g.moveTo(X(run.c), Y(a));
        g.lineTo(X(run.c), Y(b));
      }
      g.stroke();
    }
    for (const o of run.openings) {
      g.strokeStyle = o.isDoor ? "#d6453f" : "#3c8fd6";
      g.lineWidth = 2;
      g.beginPath();
      if (run.axis === "x") {
        g.moveTo(X(o.u0), Y(run.c));
        g.lineTo(X(o.u1), Y(run.c));
      } else {
        g.moveTo(X(run.c), Y(o.u0));
        g.lineTo(X(run.c), Y(o.u1));
      }
      g.stroke();
    }
  }
  // stairs: flights, holes and landings
  for (const l of ctx.model.stairs) {
    if (l.stair.from.id === levelId) {
      g.strokeStyle = "#7d5bb0";
      g.lineWidth = 1;
      for (const f of l.flights) {
        for (let k = 0; k < f.n; k++) {
          const a = f.s0 + f.sign * k * f.tread;
          g.beginPath();
          if (f.axis === "x") {
            g.moveTo(X(a), Y(f.c0));
            g.lineTo(X(a), Y(f.c1));
          } else {
            g.moveTo(X(f.c0), Y(a));
            g.lineTo(X(f.c1), Y(a));
          }
          g.stroke();
        }
      }
      g.beginPath();
      rect(l.foot.x, l.foot.y, l.foot.x + l.foot.w, l.foot.y + l.foot.d);
      g.fillStyle = "rgba(125,91,176,0.12)";
      g.fill();
    }
    if (l.holeLevel === levelId) {
      for (const h of l.holes) {
        g.beginPath();
        rect(h.x, h.y, h.x + h.w, h.y + h.d);
        g.fillStyle = "rgba(40,40,40,0.28)";
        g.fill();
      }
      g.beginPath();
      rect(l.landing.x, l.landing.y, l.landing.x + l.landing.w, l.landing.y + l.landing.d);
      g.strokeStyle = "#2f8f5b";
      g.setLineDash([4, 3]);
      g.stroke();
      g.setLineDash([]);
      const t = l.topRiser;
      g.strokeStyle = "#2f8f5b";
      g.lineWidth = 3;
      g.beginPath();
      if (t.axis === "x") {
        g.moveTo(X(t.a), Y(t.c));
        g.lineTo(X(t.b), Y(t.c));
      } else {
        g.moveTo(X(t.c), Y(t.a));
        g.lineTo(X(t.c), Y(t.b));
      }
      g.stroke();
    }
  }
  // guards
  g.strokeStyle = "#e08a1e";
  g.lineWidth = 2.5;
  for (const gd of ctx.guards) {
    if (gd.level !== levelId) continue;
    g.beginPath();
    if (gd.axis === "x") {
      g.moveTo(X(gd.a), Y(gd.c));
      g.lineTo(X(gd.b), Y(gd.c));
    } else {
      g.moveTo(X(gd.c), Y(gd.a));
      g.lineTo(X(gd.c), Y(gd.b));
    }
    g.stroke();
  }
  // furniture
  for (const it of ctx.items) {
    const r = plan.room(it.room);
    if (!r || r.level !== levelId || it.cls === "ceiling") continue;
    g.beginPath();
    rect(it.x0, it.y0, it.x1, it.y1);
    if (it.cls === "wall") {
      g.strokeStyle = "#111";
      g.lineWidth = 2;
      g.stroke();
    } else if (it.cls === "floor") {
      g.fillStyle = it.type.startsWith("car") ? "rgba(30,30,30,0.55)" : "rgba(110,100,90,0.45)";
      g.fill();
    } else {
      g.strokeStyle = "rgba(110,100,90,0.5)";
      g.lineWidth = 1;
      g.stroke();
    }
  }
  // ground: bays, walkway, spawn
  if (level.i === 0) {
    const P = parking(ctx);
    for (const b of P.bays) {
      g.beginPath();
      rect(b.rect.x, b.rect.y, b.rect.x + b.rect.w, b.rect.y + b.rect.d);
      g.strokeStyle = b.used ? "#333" : "#999";
      g.setLineDash([5, 3]);
      g.lineWidth = 1.2;
      g.stroke();
      g.setLineDash([]);
    }
    g.strokeStyle = "rgba(47,143,91,0.85)";
    g.lineWidth = 3 * s;
    g.globalAlpha = 0.25;
    g.beginPath();
    P.path.forEach(([x, y], k) => (k ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y))));
    g.stroke();
    g.globalAlpha = 1;
    g.lineWidth = 1.5;
    g.beginPath();
    P.path.forEach(([x, y], k) => (k ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y))));
    g.stroke();
    const sx = res.spawn.position.x / 0.3048, sy = -res.spawn.position.z / 0.3048;
    const lx = res.spawn.lookAt.x / 0.3048, ly = -res.spawn.lookAt.z / 0.3048;
    const a = Math.atan2(ly - sy, lx - sx);
    g.fillStyle = "#1f6fd6";
    g.beginPath();
    g.moveTo(X(sx + Math.cos(a) * 2), Y(sy + Math.sin(a) * 2));
    g.lineTo(X(sx + Math.cos(a + 2.5) * 1.2), Y(sy + Math.sin(a + 2.5) * 1.2));
    g.lineTo(X(sx + Math.cos(a - 2.5) * 1.2), Y(sy + Math.sin(a - 2.5) * 1.2));
    g.fill();
  }
  // flagged spots
  g.strokeStyle = "#e0241b";
  g.lineWidth = 2;
  for (const c of checks)
    for (const sp of c.spots ?? []) {
      if (sp.level !== levelId) continue;
      g.beginPath();
      g.moveTo(X(sp.x) - 5, Y(sp.y) - 5);
      g.lineTo(X(sp.x) + 5, Y(sp.y) + 5);
      g.moveTo(X(sp.x) + 5, Y(sp.y) - 5);
      g.lineTo(X(sp.x) - 5, Y(sp.y) + 5);
      g.stroke();
    }
  g.fillStyle = "#6b675f";
  g.font = "11px Inter, system-ui, sans-serif";
  g.fillText(`${level.name} · road ↓ · green 3 ft path · dots entries · orange guards · dashed keep-out cores`, pad, ch - 8);
}
