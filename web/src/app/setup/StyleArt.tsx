import type { ReactNode } from "react";
import type { StyleOption } from "@/api/domain";

/** Small elevation sketches per style, drawn in the style's own palette (no external images). */
export function StyleArt({ style, className }: { style: StyleOption; className?: string }) {
  const [base, mid, accent, dark] = style.palette;
  const line = "rgb(30 27 23 / 0.55)";
  const sky = "rgb(255 255 255 / 0)";
  const ground = <path d="M4 70H116" stroke={line} strokeWidth="1" />;
  let body: ReactNode = null;

  switch (style.motif) {
    case "fins":
      body = (
        <>
          <rect x="22" y="24" width="72" height="46" fill={base} stroke={line} strokeWidth="0.8" />
          <rect x="22" y="18" width="40" height="6" fill={base} stroke={line} strokeWidth="0.8" />
          <rect x="80" y="14" width="10" height="56" fill={mid} />
          <rect x="30" y="29" width="44" height="16" fill={dark} opacity="0.85" />
          {Array.from({ length: 8 }, (_, i) => (
            <rect key={i} x={31 + i * 5.6} y="28" width="2.2" height="18" fill={accent} />
          ))}
          <rect x="18" y="47" width="36" height="3" fill={accent} />
          <rect x="58" y="52" width="16" height="18" fill={dark} opacity="0.9" />
        </>
      );
      break;
    case "tile":
      body = (
        <>
          <rect x="24" y="34" width="72" height="36" fill={base} stroke={line} strokeWidth="0.8" />
          <path d="M18 36L60 16L102 36Z" fill={mid} />
          {Array.from({ length: 7 }, (_, i) => (
            <path key={i} d={`M${26 + i * 11} ${33 - (i < 4 ? i * 4.4 : (6 - i) * 4.4)}v3`} stroke={dark} strokeOpacity="0.3" strokeWidth="0.8" />
          ))}
          {[34, 54, 74].map((x) => (
            <path key={x} d={`M${x} 64V50a6 6 0 0 1 12 0V64Z`} fill={dark} opacity="0.85" />
          ))}
          <rect x="22" y="64" width="76" height="2.5" fill={accent} />
        </>
      );
      break;
    case "columns":
      body = (
        <>
          <rect x="20" y="30" width="80" height="40" fill={base} stroke={line} strokeWidth="0.8" />
          <path d="M16 30L60 14L104 30Z" fill={mid} stroke={line} strokeWidth="0.8" />
          <rect x="16" y="28" width="88" height="3" fill={accent} />
          {[30, 46, 70, 86].map((x) => (
            <rect key={x} x={x - 2} y="32" width="4" height="38" fill={mid} />
          ))}
          <rect x="54" y="48" width="12" height="22" fill={dark} opacity="0.85" />
          <rect x="35" y="40" width="7" height="12" fill={dark} opacity="0.75" />
          <rect x="78" y="40" width="7" height="12" fill={dark} opacity="0.75" />
        </>
      );
      break;
    case "box":
      body = (
        <>
          <rect x="18" y="38" width="60" height="32" fill={base} stroke={line} strokeWidth="0.8" />
          <rect x="44" y="18" width="58" height="22" fill={base} stroke={line} strokeWidth="0.8" />
          <rect x="44" y="40" width="58" height="2" fill={mid} />
          <rect x="50" y="24" width="46" height="9" fill={dark} opacity="0.85" />
          <rect x="24" y="48" width="18" height="22" fill={dark} opacity="0.85" />
          <rect x="84" y="42" width="18" height="28" fill={mid} />
        </>
      );
      break;
    case "arch":
      body = (
        <>
          <rect x="20" y="28" width="80" height="42" fill={base} stroke={line} strokeWidth="0.8" />
          <rect x="16" y="25" width="88" height="3" fill={mid} />
          {[30, 52, 74].map((x) => (
            <path key={x} d={`M${x} 70V54a8 8 0 0 1 16 0V70Z`} fill={accent} opacity="0.9" />
          ))}
          {[34, 78].map((x) => (
            <rect key={x} x={x} y="34" width="8" height="10" fill={accent} opacity="0.7" />
          ))}
          {Array.from({ length: 6 }, (_, i) => (
            <path key={i} d={`M${50 + i * 4} 18V25`} stroke={dark} strokeOpacity="0.5" strokeWidth="1" />
          ))}
          <path d="M48 18H74" stroke={dark} strokeOpacity="0.5" strokeWidth="1" />
        </>
      );
      break;
    case "dome":
      body = (
        <>
          <rect x="20" y="30" width="80" height="40" fill={mid} />
          <path d="M70 30V22a8 8 0 0 1 16 0V30Z" fill={accent} />
          <path d="M78 12a4 4 0 0 1 0 8a4 4 0 0 1 0-8Z" fill={accent} />
          <path d="M78 11V7" stroke={dark} strokeWidth="1" />
          <rect x="16" y="28" width="88" height="3" fill={accent} />
          {[30, 54].map((x) => (
            <path key={x} d={`M${x} 70V54q0-8 8-11q8 3 8 11V70Z`} fill={dark} opacity="0.85" />
          ))}
          <rect x="74" y="38" width="20" height="14" fill={base} />
          <path d="M76 52V44q0-4 4-5q4 1 4 5V52M84 52V44q0-4 4-5q4 1 4 5V52" fill={dark} opacity="0.8" />
          <rect x="72" y="52" width="24" height="2.5" fill={accent} />
        </>
      );
      break;
    case "grid":
      body = (
        <>
          <rect x="20" y="22" width="80" height="48" fill={mid} />
          {Array.from({ length: 9 }, (_, i) => (
            <path key={i} d={`M20 ${26 + i * 5}H100`} stroke={dark} strokeOpacity="0.18" strokeWidth="0.7" />
          ))}
          <rect x="30" y="30" width="34" height="30" fill={dark} />
          <path d="M41 30V60M52 30V60M30 40H64M30 50H64" stroke={base} strokeOpacity="0.5" strokeWidth="0.8" />
          <rect x="72" y="44" width="20" height="26" fill={dark} />
          <rect x="16" y="20" width="88" height="3" fill={dark} />
        </>
      );
      break;
  }

  return (
    <svg viewBox="0 0 120 78" className={className} aria-hidden>
      <rect width="120" height="78" fill={sky} />
      {body}
      {ground}
    </svg>
  );
}
