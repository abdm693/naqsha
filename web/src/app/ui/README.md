# Naqsha UI primitives (`web/src/app/ui`)

Owned by APP-SHELL. Built on the tokens in `web/src/index.css` (the exact `@theme` from `docs/design/DESIGN.md` §2).
Import from the barrel:

```ts
import { Button, IconButton, Chip, Input, Sheet, Dialog, toast, Segmented, Avatar, Tooltip, Kbd } from "@/app/ui";
```

`@/app/ui/primitives` and `@/app/ui/Button` still export the old names (`Pill`, `Menu`, `Dialog`, `Segmented`, `Chip`,
`Spinner`, `StatusIcon`, `Toaster`), so older screens keep compiling. The pre-overhaul token class names (`bg-paper`, `text-graphite`,
`bg-brick`…) are gone: use the tokens above.

## Tokens in one breath

| Use | Class |
|---|---|
| Page / card / hover / pressed | `bg-canvas` · `bg-surface` · `bg-surface-2` · `bg-surface-3` |
| Text, strongest to weakest | `text-ink` · `text-ink-2` · `text-ink-3` (lowest readable) · `text-ink-4` (placeholder only) |
| Lines | `border-line` · `border-line-strong` |
| The one accent ("next move", "selected") | `bg-accent` `text-accent` `bg-accent-soft` `border-accent-line` |
| Compliance only | `text-pass` `bg-pass-soft` · `text-warn` `bg-warn-soft` · `text-fail` `bg-fail-soft` |
| Over 3D or photos | `glass-hud` (+ `text-hud-ink`, `text-hud-ink-2`, `text-hud-accent`) |
| Plan fills | `bg-plan-bed` `bg-plan-wet` `bg-plan-living` `bg-plan-service` `bg-plan-outdoor` |
| Author hues | `--color-author-1…6` (Avatar picks them by role) |
| Radii | `rounded-chip` 10 · `rounded-control` 12 · `rounded-card` 20 · `rounded-panel` 28 · `rounded-media` 32 |
| Elevation | `shadow-e1` (resting) · `shadow-e2` (hover, floating chrome) · `shadow-e3` (sheets, dialogs) · `shadow-focus` |
| Type | `text-hero` `text-display` `text-title` `text-heading` `text-body-lg` `text-body` `text-label` `text-caption` |
| Numbers (dimensions, areas, counts) | `num` (Geist Mono 500, tabular) |
| Easing | `ease-out` `ease-sheet` `ease-camera` `ease-exit`; durations `duration-(--dur-panel)` etc. |
| Motion in JS | `spring`, `ease`, `dur` from `@/app/ui` (`{ type: "spring", stiffness: 380, damping: 34 }`) |

Floating chrome sits `var(--chrome)` from the edges (12px, 16px from 1024px). Light theme only.

## Components

### Button
```tsx
<Button variant="primary" size="md" icon={<Plus />} trailing={<ArrowRight />} loading={busy} onClick={…}>Show me concepts</Button>
```
- `variant`: `primary` (accent; **at most one on screen**), `secondary` (default), `quiet`, `ink` (landing Portal only), `hud` (over 3D), `danger` (confirm delete).
- `size`: `sm` 32px · `md` 40px · `lg` 48px (also `xs` 28, `xl` 56).
- `loading` swaps the icon for a breathing dot and blocks clicks. Press scales to .97.
- `buttonClass(variant, size, className)` styles a router `<Link>` as a button.

### IconButton
```tsx
<IconButton label="Share" shortcut={["mod", "S"]} variant="quiet" size="md"><Share2 className="size-4" /></IconButton>
```
A circle. `label` is required (aria-label and tooltip). `variant`: `quiet` · `secondary` · `primary` · `hud` · `hud-quiet`. `size`: `xs` 28 · `sm` 32 · `md` 40 · `lg` 44 (use `lg` on touch and HUD). `tooltip={false}` to skip the tooltip.

### Chip, SuggestionChip, FactToken, StatusChip
```tsx
<Chip selected={on} onClick={toggle} hint="Most popular" multi>10 marla</Chip>
<SuggestionChip onClick={() => ask.submit("Make the kitchen open")}>Make the kitchen open</SuggestionChip>
<FactToken assumed onClick={edit} onRemove={remove}>One-car porch</FactToken>
<StatusChip tone="pass">42/42 LDA</StatusChip>
```
32px, radius 10, 13px/500. `StatusChip` tones: `neutral` `accent` `pass` `warn` `fail` `progress` (breathing dot) `dark`; `filled={false}` for bare text.

### Input, Textarea
```tsx
<Input label="Email" type="email" error={err} hint="We never share it." leading={<Mail />} trailing={<Button size="sm">Invite</Button>} />
<Textarea autoGrow maxHeight={200} value={v} onChange={…} />
```
44px, radius 12. Errors show a fail border and a caption (never a red fill). Forward refs.

### Composer
```tsx
<Composer value={v} onChange={setV} onSubmit={send} placeholder="Ask Naqsha" busy={working} leading={…} trailing={<Kbd keys={["mod","K"]} />} />
```
52px growing to 160px, radius 26; the 36px accent send button springs in once there is text. Enter sends, Shift+Enter adds a line. `tone="hud"` over 3D.

### Card, Panel
```tsx
<Card media={<img src={url} alt="" />} title="Johar Town family home" caption="Version 2 · Shared with 2" onClick={open} actions={<Menu … />} />
<Panel className="p-5">…</Panel>
```
A 4:3 `rounded-card` image with no text on it, then the heading and an ink-3 caption. Hover lifts to e2 and scales the image 1.02 (600ms). `actions` never trigger the card.

### Sheet
```tsx
<Sheet open={open} onClose={close} side="right" tone="surface" title="Comments" headerActions={…} footer={<Composer … />}>…</Sheet>
```
Floats `--chrome` in, radius 28, e3; 24px slide + fade (320ms `ease-sheet`); Escape closes. Defaults: 420px on the left, 380px on the right. Its top is `var(--sheet-top)` (the project shell sets it under its top row). Under 768px it is a bottom sheet resting at 40% or 92% (drag or tap the handle). `tone="hud"` over 3D.

### Dialog
```tsx
<Dialog open={open} onClose={close} title="Delete this home?" description="It can't be undone."
  actions={<><Button variant="quiet" onClick={close}>Cancel</Button><Button variant="danger" onClick={del}>Delete</Button></>} />
```
480px (`width`), radius 28, e3, scrim with an 8px blur; scale .96→1 in, 200ms out. A bottom sheet under 640px. Focus is trapped and restored; Escape and the scrim close it (`dismissible={false}` to hold it open while saving).

### Toast
```ts
import { toast } from "@/app/ui";
toast.show("Link copied");
toast.undo("Comment deleted", restore);          // Undo for 5 s
toast.error("Couldn't save the comment", err);   // adds the friendly reason
```
One at a time, a 44px ink pill 12px above the dock, gone after 4 s. Never toast autosave. `<Toaster />` is mounted once in `App.tsx`.

### Segmented
```tsx
<Segmented label="Light" value={light} onChange={setLight} options={[{ value: "day", label: "Day" }, { value: "night", label: "Night", busy: true }]} />
```
36px (`size="sm"` 32px); surface-2 track, surface thumb that springs. Arrow keys move. `tone="hud"` over 3D, `fill` to stretch.

### Avatar, AvatarStack, NaqshaAvatar
```tsx
<Avatar name="Sana Malik" role="client" size={28} />
<AvatarStack people={[{ id, name, role }]} max={3} />
<NaqshaAvatar size={28} />
```
Initials coloured by role: owner teal, team violet, client magenta, guest amber. `role="agent"` renders Naqsha's ink نقشہ avatar. Sizes 20, 24, 28, 32, 40.

### Tooltip
```tsx
<Tooltip content="Comments" shortcut={["C"]}><button aria-label="Comments">…</button></Tooltip>
```
Hover (450 ms) or keyboard focus; not on touch. Always keep an aria-label on the trigger.

### Spinner, BreathingDot
`<Spinner />` is a thin arc in the text colour. `<BreathingDot />` is the 6px accent dot for "being made" (the view switch, buttons).

### Kbd
`<Kbd keys={["mod", "K"]} />` renders ⌘K on Apple devices and Ctrl K elsewhere. `tone="hud"` on dark.

### Menu
```tsx
<Menu trigger={({ open, toggle }) => <IconButton label="More" aria-expanded={open} onClick={toggle}><Ellipsis /></IconButton>}
      items={[{ label: "Rename", icon: <Pencil />, onSelect: rename }, { separator: true }, { label: "Delete", danger: true, onSelect: del }]} />
```
Rendered in a portal (cards can't clip it), flips above when there's no room, Escape/click-outside close it and return focus, arrow keys move. Items can be `{ heading }`, `{ separator: true }`, or carry `hint`, `checked`, `disabled`.

### Switch
`<Switch checked={on} onChange={setOn} label="Client link" />`

### Wordmark, PlotSketch
`<Wordmark />` is "Naqsha" + نقشہ. `<PlotSketch envelope width depth />` draws a plot and its envelope (thumbnails before there's a render).

## Shared hooks (`@/app/lib/hooks`)
`useMediaQuery`, `usePhone` (<768px), `useReducedMotion`, `useFocusTrap(ref, active)`, `useEscape(active, fn)` (one Escape closes only the top-most layer), `isTyping()`, `copyText(text)`.
