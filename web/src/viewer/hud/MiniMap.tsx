import { memo, useCallback, useMemo, useState } from "react";
import { useStore } from "zustand";
import type { BuildingPlan, Level, Room } from "@contracts/plan";
import type { ViewerController } from "../core/controller";
import { levelShort } from "../core/floors";

const OUTDOOR = new Set(["porch", "balcony", "terrace", "lawn", "driveway", "courtyard", "open_space", "garage"]);
const WET = new Set(["bath", "powder", "laundry", "kitchen", "dirty_kitchen"]);
const DOORS = new Set(["main_door", "door", "double_door", "sliding_door", "arch", "garage_door"]);
const FACING_AZ: Record<string, number> = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };
const INNER = 152; // px: 168 px card minus padding

/** "Master Bedroom" → "Master bedroom", "First Floor" → "First floor" (keeps "TV" and numbers), as the app writes names. */
function sentence(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : /^[A-Z]{2,}$/.test(w) || /\d/.test(w) ? w : w.toLowerCase()))
    .join(" ");
}

/**
 * Click-to-go plan of a floor, drawn as seen from the street (road at the bottom, plan +x to the right, SVG
 * y = D − y_ft). Rooms, doors and the stair are drawn; on the roof, the stair tower, tank and solar area. The route
 * of a glide draws in before the camera moves. The walker marker is moved imperatively by the controller.
 */
export const MiniMap = memo(function MiniMap({ ctrl, plan }: { ctrl: ViewerController; plan: BuildingPlan }) {
  const walkerLevel = useStore(ctrl.store, (s) => s.level);
  const mapLevel = useStore(ctrl.store, (s) => s.mapLevel);
  const roomId = useStore(ctrl.store, (s) => s.roomId);
  const route = useStore(ctrl.store, (s) => s.route);
  const help = useStore(ctrl.store, (s) => s.help);
  const [hover, setHover] = useState<Room | null>(null);
  const levels = useMemo(() => [...plan.levels].sort((a, b) => a.index - b.index), [plan]);
  const shownId = mapLevel ?? walkerLevel ?? levels[0]?.id;
  const level = levels.find((l) => l.id === shownId) ?? levels[0];
  const { width_ft: W, depth_ft: D } = plan.site.plot;
  const scale = Math.min(INNER / W, 210 / D);
  const rooms = useMemo(() => plan.rooms.filter((r) => r.level === level?.id), [plan, level]);
  const below = useMemo(() => {
    // the roof is drawn over the floor below's footprint
    if (rooms.length || !level) return [];
    const lower = levels.filter((l) => l.index < level.index).pop();
    return lower ? plan.rooms.filter((r) => r.level === lower.id && !OUTDOOR.has(r.type)) : [];
  }, [plan, rooms, level, levels]);
  const doors = useMemo(() => (plan.openings ?? []).filter((o) => o.level === level?.id && DOORS.has(o.type)), [plan, level]);
  const stairs = useMemo(() => (plan.stairs ?? []).filter((s) => s.from_level === level?.id), [plan, level]);
  const marker = useCallback((g: SVGGElement | null) => void (ctrl.minimapMarker = g), [ctrl]);
  // the front (road) is down on this map, so north sits at 180° − facing (clockwise from up)
  const north = 180 - (FACING_AZ[plan.site.facing] ?? 0);
  const roof = level && !rooms.length ? plan.roof : null;
  const line = route && level ? route.byLevel[level.id] : undefined;
  const onWalkerLevel = level?.id === walkerLevel;
  const previewing = !!level && !!walkerLevel && !onWalkerLevel;
  // the map button steps up through the floors, then back to the lowest
  const nextLevel = level ? (levels[(levels.indexOf(level) + 1) % levels.length] ?? null) : null;

  const planAt = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * (W + 2) - 1;
    const y = D - (((e.clientY - r.top) / r.height) * (D + 2) - 1);
    return { x, y };
  };
  const roomAt = (x: number, y: number) =>
    [...rooms].filter((rm) => x >= rm.rect.x && x <= rm.rect.x + rm.rect.w && y >= rm.rect.y && y <= rm.rect.y + rm.rect.d).sort((a, b) => a.rect.w * a.rect.d - b.rect.w * b.rect.d)[0] ?? null;

  return (
    <div
      className="nq-mini nq-glass nq-ui"
      data-nq-ui=""
      data-help={help ? "1" : "0"}
      // the map never fades while you are reading or using it ("Drawing room · Click to go" must still click)
      onPointerEnter={(e) => e.pointerType !== "touch" && ctrl.setHudHover(true)}
      onPointerLeave={() => ctrl.setHudHover(false)}
      onFocus={() => ctrl.setHudHover(true, "focus")}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) ctrl.setHudHover(false, "focus");
      }}
    >
      <div className="nq-mini-head">
        {/*
         * Which floor's MAP this shows: a quiet text button that steps through the floors' maps (a preview; it never
         * moves you). Changing floors is the app's floor stack, so this must not look like a second one.
         */}
        {levels.length > 1 && level ? (
          <button
            className="nq-mini-which"
            data-preview={previewing ? "1" : "0"}
            title={nextLevel ? `Preview the ${nextLevel.name.toLowerCase()} map` : undefined}
            aria-label={`Map: ${sentence(level.name)}${previewing ? " (preview)" : ""}. Show the ${nextLevel?.name.toLowerCase() ?? "next"} map`}
            onClick={() => nextLevel && ctrl.setMapLevel(nextLevel.id === walkerLevel ? null : nextLevel.id)}
          >
            Map: {levelShort(level, levels)}
            <svg width="8" height="10" viewBox="0 0 8 10" aria-hidden>
              <path d="M1.5 3.5L4 1l2.5 2.5M1.5 6.5L4 9l2.5-2.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        ) : (
          <span className="nq-mini-which" aria-hidden>
            Map
          </span>
        )}
        <span className="nq-mini-north" title="North">
          <svg width="11" height="11" viewBox="-6 -6 12 12" aria-hidden>
            <path d="M0,-5 L3,3 L0,1.6 L-3,3 Z" transform={`rotate(${north})`} fill="currentColor" />
          </svg>
          N
        </span>
        <button className="nq-icon nq-mini-help" aria-label="Walking controls" aria-expanded={help} onClick={() => ctrl.setHelp(!help)}>
          ?
        </button>
      </div>
      <svg
        className="nq-mini-map"
        width={W * scale}
        height={D * scale}
        viewBox={`-1 -1 ${W + 2} ${D + 2}`}
        role="img"
        aria-label={`${level ? sentence(level.name) : "Plan"} map. Click a room to go there.`}
        onPointerMove={(e) => setHover(roomAt(planAt(e).x, planAt(e).y))}
        onPointerLeave={() => setHover(null)}
        onClick={(e) => {
          const p = planAt(e as unknown as React.PointerEvent<SVGSVGElement>);
          const rm = roomAt(p.x, p.y);
          if (rm) ctrl.goToRoom(rm.id);
          else if (level) ctrl.walkToPoint(level.id, p.x, p.y);
        }}
      >
        <rect x={0} y={0} width={W} height={D} className="nq-mini-plot" />
        <line x1={-1} y1={D + 0.7} x2={W + 1} y2={D + 0.7} className="nq-mini-road" />
        {below.map((r) => (
          <rect key={`b${r.id}`} x={r.rect.x} y={D - (r.rect.y + r.rect.d)} width={r.rect.w} height={r.rect.d} className="nq-mini-roofslab" />
        ))}
        {rooms.map((r) => (
          <rect
            key={r.id}
            x={r.rect.x}
            y={D - (r.rect.y + r.rect.d)}
            width={r.rect.w}
            height={r.rect.d}
            className="nq-mini-room"
            data-kind={OUTDOOR.has(r.type) ? "out" : WET.has(r.type) ? "wet" : "in"}
            data-here={onWalkerLevel && r.id === roomId ? "1" : "0"}
            data-hover={hover?.id === r.id ? "1" : "0"}
            data-to={route?.to === r.id ? "1" : "0"}
          />
        ))}
        {stairs.map((s) => (
          <g key={s.id} className="nq-mini-stair">
            <rect x={s.rect.x} y={D - (s.rect.y + s.rect.d)} width={s.rect.w} height={s.rect.d} />
            {Array.from({ length: Math.max(2, Math.floor((s.start.endsWith("y") ? s.rect.d : s.rect.w) / 1.2)) }, (_, i) => {
              const along = s.start.endsWith("y");
              const t = (i + 0.5) * 1.2;
              return along ? (
                <line key={i} x1={s.rect.x} x2={s.rect.x + s.rect.w} y1={D - (s.rect.y + t)} y2={D - (s.rect.y + t)} />
              ) : (
                <line key={i} y1={D - s.rect.y} y2={D - (s.rect.y + s.rect.d)} x1={s.rect.x + t} x2={s.rect.x + t} />
              );
            })}
          </g>
        ))}
        {roof?.mumty && <rect x={roof.mumty.rect.x} y={D - (roof.mumty.rect.y + roof.mumty.rect.d)} width={roof.mumty.rect.w} height={roof.mumty.rect.d} className="nq-mini-room" data-kind="in" />}
        {roof?.water_tank && <rect x={roof.water_tank.rect.x} y={D - (roof.water_tank.rect.y + roof.water_tank.rect.d)} width={roof.water_tank.rect.w} height={roof.water_tank.rect.d} rx={0.6} className="nq-mini-tank" />}
        {roof?.solar?.rect && <rect x={roof.solar.rect.x} y={D - (roof.solar.rect.y + roof.solar.rect.d)} width={roof.solar.rect.w} height={roof.solar.rect.d} className="nq-mini-solar" />}
        {doors.map((o) => {
          // a short bright bar across the wall the door sits in
          const host = rooms.find((r) => r.id === o.between[0]) ?? rooms.find((r) => r.id === o.between[1]);
          const horizontal = host ? Math.abs(o.at[1] - host.rect.y) < 0.7 || Math.abs(o.at[1] - (host.rect.y + host.rect.d)) < 0.7 : true;
          const w = o.width_ft;
          return horizontal ? (
            <rect key={o.id} x={o.at[0] - w / 2} y={D - o.at[1] - 0.35} width={w} height={0.7} className="nq-mini-door" />
          ) : (
            <rect key={o.id} x={o.at[0] - 0.35} y={D - o.at[1] - w / 2} width={0.7} height={w} className="nq-mini-door" />
          );
        })}
        {line && line.length > 1 && <polyline key={route!.id} points={line.map(([x, y]) => `${x.toFixed(2)},${(D - y).toFixed(2)}`).join(" ")} className="nq-mini-route" pathLength={1} />}
        <g ref={marker} style={{ display: onWalkerLevel ? undefined : "none" }}>
          <circle r={3} className="nq-mini-halo" />
          <path d="M0,-2.7 L1.9,1.9 L0,0.95 L-1.9,1.9 Z" className="nq-mini-me" />
        </g>
      </svg>
      <div className="nq-mini-caption" aria-live="polite">
        {hover ? (
          <>
            <b>{sentence(hover.name)}</b>
            <span>{hover.id === roomId && onWalkerLevel ? "You're here" : "Click to go"}</span>
          </>
        ) : (
          <>
            <span>{level ? sentence(level.name) : null}</span>
            {previewing && <span className="nq-mini-preview">Preview</span>}
          </>
        )}
      </div>
    </div>
  );
});
