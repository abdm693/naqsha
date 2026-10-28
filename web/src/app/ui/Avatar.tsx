import type { Author } from "@contracts/api-types";
import { cn } from "@/app/lib/utils";

/*
 * Initials avatars coloured by role (contracts/api.md "Comments become a conversation"; DESIGN.md author hues).
 * Owner teal, Team violet, Client magenta, Guest amber. Naqsha speaks under its own ink avatar (نقشہ).
 */

export type AvatarRole = Author["role"] | "viewer";

const ROLE_HUE: Record<string, string> = {
  owner: "var(--color-author-1)",
  team: "var(--color-author-2)",
  client: "var(--color-author-3)",
  guest: "var(--color-author-4)",
  viewer: "var(--color-author-5)",
};

export function roleColor(role?: AvatarRole | null): string {
  return ROLE_HUE[role ?? "viewer"] ?? ROLE_HUE.viewer;
}

/**
 * One hue per author (DESIGN.md "Comments"): the same hash as the pins in Plan and House (plan/model authorHue),
 * keyed by the author's id, else their name.
 */
export function authorColor(key?: string | null): string {
  if (!key) return "var(--color-author-1)";
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return `var(--color-author-${(h % 6) + 1})`;
}

/** "Ahmed Raza" → "AR", "ahmed@x.pk" → "A", "" → "?". */
export function initials(name?: string | null): string {
  const n = (name ?? "").trim().replace(/@.*$/, "");
  if (!n) return "?";
  const parts = n.split(/[\s._-]+/).filter(Boolean);
  const a = parts[0]?.[0] ?? "";
  const b = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (a + b).toUpperCase() || "?";
}

const SIZE = { 20: "size-5 text-[9px]", 24: "size-6 text-[10px]", 28: "size-7 text-[11px]", 32: "size-8 text-[12px]", 40: "size-10 text-[14px]" } as const;
export type AvatarSize = keyof typeof SIZE;

export function Avatar({
  name,
  role,
  color,
  hueKey,
  size = 28,
  ring,
  className,
  title,
}: {
  name?: string | null;
  role?: AvatarRole | null;
  /** The author's id (or name): gives them their one hue, the same as their pins. */
  hueKey?: string | null;
  /** Override the role colour (any CSS colour). */
  color?: string;
  size?: AvatarSize;
  /** A white ring, for stacks and for avatars over images. */
  ring?: boolean;
  className?: string;
  title?: string;
}) {
  if (role === "agent") return <NaqshaAvatar size={size} ring={ring} className={className} />;
  return (
    <span
      className={cn(
        "inline-grid shrink-0 select-none place-items-center rounded-full font-semibold leading-none tracking-[.02em] text-white",
        SIZE[size],
        ring && "ring-2 ring-surface",
        className,
      )}
      style={{ background: color ?? (hueKey ? authorColor(hueKey) : roleColor(role)) }}
      title={title ?? name ?? undefined}
      aria-hidden={title || name ? undefined : true}
      role={title || name ? "img" : undefined}
      aria-label={title ?? name ?? undefined}
    >
      {initials(name)}
    </span>
  );
}

/** Naqsha's own avatar: ink, with نقشہ in Nastaliq. */
export function NaqshaAvatar({ size = 28, ring, className }: { size?: AvatarSize; ring?: boolean; className?: string }) {
  const px = { 20: 9, 24: 10, 28: 11, 32: 13, 40: 16 }[size];
  return (
    <span
      role="img"
      aria-label="Naqsha"
      className={cn("inline-grid shrink-0 select-none place-items-center overflow-hidden rounded-full bg-ink text-white", SIZE[size], ring && "ring-2 ring-surface", className)}
    >
      <span lang="ur" dir="rtl" className="font-urdu leading-none" style={{ fontSize: px, marginTop: -px * 0.35 }}>
        نقشہ
      </span>
    </span>
  );
}

/** Up to `max` avatars, overlapping, then "+n". */
export function AvatarStack({
  people,
  max = 3,
  size = 28,
  className,
}: {
  people: { id: string; name?: string | null; role?: AvatarRole | null }[];
  max?: number;
  size?: AvatarSize;
  className?: string;
}) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <span className={cn("inline-flex items-center", className)}>
      {shown.map((p, i) => (
        <Avatar key={p.id} name={p.name} role={p.role} hueKey={p.id} size={size} ring className={i ? "-ml-2" : ""} />
      ))}
      {rest > 0 && (
        <span
          className={cn("-ml-2 inline-grid place-items-center rounded-full bg-surface-2 font-semibold text-ink-2 ring-2 ring-surface", SIZE[size])}
          aria-label={`${rest} more`}
        >
          +{rest}
        </span>
      )}
    </span>
  );
}
