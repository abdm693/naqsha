# Naqsha design system and UX spec (final)

**Decision:** **Calm** is the base, with grafts from Spatial and Studio. This file replaces the three proposals.

## 0. Scorecard

| Proposal | Intuitive | Premium | 3D-first | 1-day build | Collab | Wow | Total |
|---|---|---|---|---|---|---|---|
| **Calm** | 9 | 8 | 8 | 9 | 7 | 7 | **48** |
| Spatial | 7 | 9 | 9 | 5 | 8 | 9 | 47 |
| Studio | 5 | 6 | 7 | 8 | 9 | 6 | 41 |

- **Calm:** the plainest and cheapest. Thin author identity, and a heavy three.js landing.
- **Spatial:** the best 3D ideas, but its morphing canvas and icon rail won't fit in a day.
- **Studio:** the best collaboration and print, but the "01–06" rail is a stage bar and it reads as an architect's tool.

**Grafts:**
- From Spatial: the Ask+Next dock, Geist, author hues, ghosting, floor = go there, and Approve.
- From Studio: the SVG animation, shared pin numbers, the feasibility chip, "Opens to…" and the title block.
- From maket.ai: Guaranteed/Preferences, named stages and suggestion chips.

## 1. Principles

1. **The house is the hero.** Content runs edge to edge, with chrome floating over it.
2. **One accent.** Cobalt means "next move" or "selected", with one accent button at most.
3. **Naqsha proposes, you correct.** Assumptions show as editable tokens.
4. **Places, not steps.** No numbers, ticks or "Step 3 of 5".
5. **Plain words.** No model names, code or jargon.

## 2. Tokens (replace `@theme` in `web/src/index.css`)

Rename `brick*`→`accent*`, `paper`→`canvas`, `sheet/plaster`→`surface`, `wash`→`surface-2`, `graphite`→`ink-2`, `pencil`→`ink-3`. Delete Fraunces, `bg-drafting` and the stamp.

```css
@import "tailwindcss";

@theme {
  --font-sans: "Geist", ui-sans-serif, system-ui, -apple-system, sans-serif;
  --font-mono: "Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  --font-urdu: "Noto Nastaliq Urdu", serif;

  --color-canvas: #F6F6F3;      /* page (limestone) */
  --color-surface: #FFFFFF;     /* cards, sheets */
  --color-surface-2: #EEEEEA;   /* hover, tracks, chips */
  --color-surface-3: #E5E5E0;   /* pressed */
  --color-line: #E4E4DF;
  --color-line-strong: #CFCFC8;
  --color-ink: #111113;         /* 17.4:1 */
  --color-ink-2: #46464B;       /* 8.7:1 */
  --color-ink-3: #6E6E73;       /* 4.7:1, lowest text */
  --color-ink-4: #A1A1A6;       /* placeholder/disabled only */

  --color-accent: #2747F5;      /* 6.35:1 on white */
  --color-accent-press: #1F3BD6;
  --color-accent-soft: #EDF0FF;
  --color-accent-line: #B9C5FF;

  --color-pass: #0E7A55;  --color-pass-soft: #E3F3EC;   /* compliance only */
  --color-warn: #A35A00;  --color-warn-soft: #FFF3DD;
  --color-fail: #C8281E;  --color-fail-soft: #FDECEA;

  --color-hud: #18181B;  --color-hud-ink: #F5F5F7;
  --color-hud-ink-2: #A3A3AD;  --color-hud-accent: #7D93FF;

  --color-plan-bed: #EEF1FE;  --color-plan-wet: #E6F1F5;  --color-plan-living: #F2F2EF;
  --color-plan-service: #ECECE8;  --color-plan-outdoor: #E8F1E9;

  --color-author-1: #0D7C72;  --color-author-2: #6A4FD6;  --color-author-3: #C23F78;
  --color-author-4: #A8641A;  --color-author-5: #4F6378;  --color-author-6: #2F7A3A;

  --radius-chip: 10px;  --radius-control: 12px;  --radius-card: 20px;
  --radius-panel: 28px; --radius-media: 32px;

  --shadow-e1: 0 0 0 1px rgb(17 17 19 / .06), 0 1px 2px rgb(17 17 19 / .04);
  --shadow-e2: 0 0 0 1px rgb(17 17 19 / .05), 0 12px 32px -12px rgb(17 17 19 / .18);
  --shadow-e3: 0 0 0 1px rgb(17 17 19 / .05), 0 32px 80px -24px rgb(17 17 19 / .30);
  --shadow-focus: 0 0 0 4px rgb(39 71 245 / .20);

  --text-hero: clamp(3rem, 7.5vw, 7rem); --text-hero--line-height: .95;
  --text-hero--letter-spacing: -.045em;  --text-hero--font-weight: 600;
  --text-display: 3rem;    --text-display--line-height: 3.25rem;
  --text-display--letter-spacing: -.03em; --text-display--font-weight: 600;
  --text-title: 1.75rem;   --text-title--line-height: 2.125rem;
  --text-title--letter-spacing: -.02em;  --text-title--font-weight: 600;
  --text-heading: 1.25rem; --text-heading--line-height: 1.625rem;
  --text-heading--letter-spacing: -.01em; --text-heading--font-weight: 600;
  --text-body-lg: 1.0625rem; --text-body-lg--line-height: 1.625rem;
  --text-body: .9375rem;   --text-body--line-height: 1.375rem;
  --text-label: .8125rem;  --text-label--line-height: 1.125rem; --text-label--font-weight: 500;
  --text-caption: .75rem;  --text-caption--line-height: 1rem;
  --text-caption--letter-spacing: .01em; --text-caption--font-weight: 500;

  --ease-out: cubic-bezier(.22, 1, .36, 1);
  --ease-sheet: cubic-bezier(.32, .72, 0, 1);
  --ease-camera: cubic-bezier(.65, 0, .35, 1);
  --ease-exit: cubic-bezier(.4, 0, 1, 1);

  --animate-breathe: breathe 1.6s ease-in-out infinite;
  --animate-shimmer: shimmer 1.8s var(--ease-sheet) infinite;
}

:root {
  --dur-press: 120ms; --dur-fast: 160ms; --dur-base: 240ms;
  --dur-panel: 320ms; --dur-slow: 600ms;   /* use as duration-(--dur-panel) */
  --scrim: rgb(17 17 19 / .32);
  /* motion spring everywhere: { type: "spring", stiffness: 380, damping: 34 } */
}

@utility glass-light { background: rgb(255 255 255 / .72); backdrop-filter: blur(20px) saturate(1.8);
  box-shadow: 0 0 0 1px rgb(17 17 19 / .06), 0 8px 24px -12px rgb(17 17 19 / .16); }
@utility glass-hud { background: rgb(24 24 27 / .58); backdrop-filter: blur(24px) saturate(1.6);
  box-shadow: inset 0 0 0 1px rgb(255 255 255 / .10); color: var(--color-hud-ink); }
@keyframes breathe { 50% { opacity: .35; transform: scale(.8); } }
@keyframes shimmer { from { transform: translateX(-100%); } to { transform: translateX(100%); } }
```

- **Spacing:** 4, 8, 12, 16, 24, 32, 48, 64, 96, 128. Floating chrome sits 12px in (16px at ≥1024). Reading column 600px, max 1280px.
- **Glass:** the app is light only. Anything over 3D or photos is `glass-hud`, never glass on glass.

## 3. Typography

- **Load from Google Fonts:** `Geist:wght@400;500;600`, `Geist+Mono:wght@500` and `Noto+Nastaliq+Urdu:wght@500`.
- **Geist** for everything, in sentence case with no all-caps. Body is 15px; Naqsha's chat voice is `body-lg`.
- **Geist Mono** only for dimensions, areas and counts (`35′ × 65′`, `42/42`), with `tabular-nums`.
- **Wordmark:** "Naqsha" in Geist 600 at -0.03em, then نقشہ in Nastaliq at 70% opacity.

## 4. Components (`web/src/app/ui/`)

| Component | Spec |
|---|---|
| **Button** | Pill, weight 500. sm 32px (14px padding, 13px text), md 40 (18, 15), lg 48 (22, 16). Icon buttons are circles, 44px on touch/HUD. Press 0.97 (120ms). Focus: `shadow-focus` plus an accent border. Loading: a breathing 6px dot. |
| ↳ variants | `primary`: accent, white text, at most one on screen. `secondary`: surface, `line-strong` border, ink. `quiet`: transparent ink-2, surface-2 on hover. `ink`: the landing Portal only. `hud`: `glass-hud`, over 3D. |
| **Input** | 44px, `rounded-control`, surface, `line-strong`. Focus: accent border plus `shadow-focus`. Error: fail border plus a caption, never a red fill. |
| **Composer** | 52px, growing to 160px, radius 26px. A 36px accent send button scales in from 0.6 once there is text. Enter sends. |
| **Segmented** | 36px. A surface-2 track and a surface thumb (e1) that springs. |
| **Chips** | 32px, `rounded-chip`, 13px/500, surface-2. **Selected:** accent-soft, accent text, `accent-line`. **Fact token:** ink for *You said*, ink-3 with a dotted underline for *Assumed*; tap to edit, × to remove. **Suggestion:** secondary; a tap sends it. **Status:** a 6px dot plus text. |
| **Card** | A 4:3 `rounded-card` image with no text, then a heading and an ink-3 caption ("Version 2 · Shared with 2"). Hover: the image scales 1.02 (600ms) and the card lifts to e2. |
| **Sheet** | Floats 12px in, `rounded-panel`, e3. Conversation 420px left, comments 380px right. Surface over the canvas, `glass-hud` over 3D. 24px slide plus fade, 320ms `ease-sheet`. Esc closes. |
| **Toast** | One at a time, 12px above the dock. A 44px ink pill at 92%, optional "Undo", gone after 4s. Autosave never toasts. |
| **Dialog** | 480px, `rounded-panel`, e3, over the scrim with an 8px blur. A title, one line, buttons right-aligned with primary last. Scale 0.96→1 (320ms) in, 200ms `ease-exit` out. A bottom sheet below 640px. |
| **Command bar** | The dock's Ask field, with no separate palette. ⌘K or `/` focuses it. Typing opens a popover: **Ask Naqsha** (always first), **Go to** (views, floors, rooms, versions), **Do** (Print, Share, Day/Night, Walk, Compare). |

## 5. Navigation model (no stage bar)

A project is one full-bleed canvas at `/p/:id/:view`, where view is `brief|concepts|plan|house`. The query string holds the state: `?mode=walk&floor=first&room=bed-2&v=2&light=night`. The old routes redirect: setup→brief, design→plan, explore→house, revisions→`house?panel=versions`.

The interface is five floating pieces with no bars:

1. **Title capsule (top-left):** ← Homes, the project name (renamed inline), and the status line "v2 · 42/42 LDA · 5/5 livable · Saved". Its menu holds Versions, Print plan…, Share, Rename, Details and All homes.
2. **View switch (top-centre):** a segmented **Brief · Concepts · Plan · House**. These are views of one home, not steps.
   - It shows only views that exist; one being generated carries a breathing accent dot.
   - ⌘1–4 switch views.
3. **People (top-right):** avatars (3, then +n), **Comments** with its count, and **Share**.
4. **Dock (bottom-centre, max 720px):** Naqsha's latest line and 2–3 suggestion chips, then Ask with the attached **Next pill**.
   - Next names the move: "Show me concepts" → "Plan this one" → "Walk through it" → "Revise with 3 comments" (or "Share" with none) → "See what changed".
   - While Naqsha works, narration replaces it.
5. **Sheets:** the conversation on the left (docked in Brief, otherwise opened by tapping Naqsha's line or ⌘J) and comments on the right.

## 6. Screens

### Landing (`/`)

- **Header** (`glass-light` once scrolled): wordmark, "Samples", "Sign in", and **Portal** (`ink`) to `/app`.
- **Hero:** "**Walk through your home before the first brick.**" (`hero`, 12ch).
  - Subhead (`body-lg`, ink-2): "Naqsha turns your plot and your family's wishes into an LDA-ready design and a 3D home you can walk, share and change, in one sitting."
  - Buttons: **Start your home** (primary) and **Explore a sample home** (secondary, no sign-in).
- **Construction animation:** an inline SVG axonometric (under 60KB) in a `rounded-media` frame. One motion timeline plays once on view:

  | Time | Beat |
  |---|---|
  | 0–0.8s | The plot outline draws and "35′ × 65′" counts up. |
  | 0.8–1.4s | The accent setback envelope dashes in. |
  | 1.4–2.0s | The slab extrudes. |
  | 2.0–3.2s | Columns rise (+0′ to +21′) and a hairline crane jib swings to 35°. |
  | 2.4–4.4s | Walls fill floor by floor, hatched then solid, with a 120ms stagger. |
  | 4.4–5.2s | The stair and railings rise, and the solar frame and tank spring in. |
  | 5.2–5.8s | Windows glaze and the crane leaves. |
  | 5.8–6.8s | A mask wipes to the sample's day render. |
  | 6.8–8.0s | The night render fades in and holds. |

  Hover offers "Replay". Reduced motion shows the final frame. No three.js on the landing.
- **Features** (3×2, a heading plus one line, no icons):
  - **Approval-ready from day one:** 42 LDA checks on every plan.
  - **Decide in an afternoon:** four exteriors, by day and by night.
  - **Walk it with your family:** room by room, on any laptop or phone.
  - **Change it with a comment:** pin a note and get the next version.
  - **Clients in the loop:** they comment and approve from a link.
  - **Print-ready drawings:** a PDF for your contractor.
- **Then:** three samples, and the line "For builders and architects: win the client in the first meeting." with **Open the Portal**.

### Auth

- **Sign-in:** a 440px dialog with **Continue with Google** (Firebase Auth) and no passwords. `/signin` shows it over the landing page.
- **First run:** "Your name, as clients will see it", plus an optional firm. Then: "Bring your 3 homes into your account?"
- **When:** only on Share, "Save to my account" or an invite. Never before samples.

### Workspace (`/app`)

- **Header:** wordmark and the avatar menu (or "Guest" with **Sign in**).
- **Composer:** under "Your homes": "Describe your plot to start: *10 marla in Johar Town, east-facing, mid-row, for six*". Sending creates the project, parses the brief and opens Brief.
- **Tabs:** **Your homes · Shared with you · Samples**, in a 3/2/1-column grid; samples come first for new users. "Demo data" is an ink-3 caption, not a red dot.

### Brief (conversational setup)

- **Layout:** the conversation is docked on the left. On the right is a live plot canvas to scale, with the road, north arrow, ghosted neighbours and accent envelope. A corner plot adds a second road and the splay.
- **Understood card:** fact tokens stream in, always including corner or mid-row. It has two columns, **Guaranteed** (LDA plus 5 livable rules) and **Preferences**.
- **Rounds:** at most three, each one question with one widget and "Decide for me".
  1. **Floors.** Roof, First and Ground rows of draggable room chips:
     - Master bed + bath, Bed + bath, Drawing, Dining, TV lounge, Kitchen, Dirty kitchen, Guest, Prayer, Study, Store, Servant quarter, Laundry, Balcony, Terrace.
     - Steppers set ×n, and a kitchen can go on any floor.
     - A 4px meter shows "1,240 of 1,440 sq ft". It turns warn above 90%. Over 100% it asks "Too much for the first floor. Move the study down?"
  2. **Roof.**
     - Tank picture cards: "Blue plastic tank (cheaper, visible)" or "Concrete tank in the stair tower (hidden, lasts decades)", which is marked Recommended.
     - "Keep the roof clear for solar" is on by default ("about 18 panels, ~10 kW"). The alternatives are "Raised solar frame" and "Not now".
     - No domes, minarets or pergolas unless asked for.
  3. **Style.** Three image swatches.
- **Next:** **Show me concepts**. The dock chip "Decide everything for me" runs straight to a walkable house, narrating as it goes.

### Concepts

- **Grid:** 2×2, 16px gap, no text on images. Captions: "A · Stone and teak" plus brief chips ("Mid-row · East-facing · Solar roof").
- **Prompts:** say "neighbours on both sides, single road frontage" unless the plot is a corner, and keep the roof minimal.
- **Day | Night** (top right, `N`): each night image is an edit of its day image with the same camera.
  - The first toggle generates all four in parallel and caches them. Tiles shimmer until ready.
  - All four crossfade together (400ms). `?light=` persists.
- **Choose:** a lightbox, where Ask remixes ("darker glass"). Next reads **Plan this one**.

### Plan (design, compliance, print)

- **Drawing:** a vector plan on white: ink walls, plan fills, door swings, mono dimensions, and the setback as a 1px accent dash. A floor stack (R / 1 / G) sits on the left edge, with `[` and `]` stepping floors.
- **Room hover:** "Bedroom 2 · 14′ × 12′ · Opens to: Corridor, own bath".
- **While working:** a 2px accent hairline, and the dock narrates "Reading the brief → Laying out floors → Checking 42 LDA rules → Fixing 2 → Building 3D, 14 of 23". Code lives in Details.
- **Compliance chip:** "● 42/42 LDA · 5/5 livable" opens a sheet with two groups. Clicking a rule pulses its geometry, and a fixed fail eases to pass.
  - **LDA:** coverage, height, FAR and setbacks, with 2px meters.
  - **Livable:**
    - "Bedrooms open only to a corridor, lounge, balcony or own bath"
    - "Every stair edge and void has a railing"
    - "Stairs reach every floor, including the roof"
    - "Doors are clear of furniture"
    - "A clear 3 ft path to every door"
- **Print (⌘P):** a dialog for A3/A4, floors, cover and compliance. It opens `/p/:id/print?v=2&size=a3&sheets=g,1,r` with `@page { size: A3 landscape; margin: 12mm }`.
  - Pages: a cover (concept, site plan, area schedule), one floor per page at 1:100 with a scale bar and north arrow, then compliance.
  - Each page carries a title block: project, plot, version, author/firm, date.
  - All vector SVG; `window.print()` saves the PDF.

### House: explore and walk HUD

All `glass-hud`, in fixed zones that never overlap:

| Zone | Contents |
|---|---|
| Top | Title capsule · view switch · people |
| Left edge | Floor stack R · 1 · G (plus All in Orbit) |
| Top-right, under people | 168px minimap (Walk), clickable |
| Bottom-left | **Orbit · Walk** (`V`) · **View** popover (layers, section, Day/Dusk/Night, neighbours, "Render this view") |
| Bottom-centre | Dock: room pill "Dining room · Ground ▾" (`M`) · Ask · `+` comment (`C`) · Next |

- **Hints:** a one-time coachmark ("Click to look around · WASD to move · Esc to stop") fades after 4s, then lives behind `?`. Delete the permanent key legend.
- **Mouse look:** a click calls `requestPointerLock({ unadjustedMovement: true })`. Trackpads drag to look. Spawn at the main door, facing in. After 2.5s idle, only the crosshair and the room pill remain.
- **Room navigator (`M`):** rooms by floor with type-to-filter, or a minimap click.
  - The route draws on the minimap, then the camera glides along door waypoints and faces the room: A* over room adjacency, 1.6m eye height, `clamp(700, d×120, 2400)` ms, `ease-camera`.
  - With no route, it crossfades (300ms) and says "No door reaches the roof terrace yet. I've flagged it."
- **Floor stack** (`[` `]`):
  - **In Walk:** go to that floor by gliding up the stair to its landing. It never hides geometry, offers no All and never leaves you mid-air.
  - **In Orbit:** the floors above lift 1.5m and fade (420ms). Tap the active floor again to show all.
- **Clear view:** neighbours between the camera and the house **ghost** to 15% clay. Porch cars don't collide and fade within 2m.
- **Sheets:** an open sheet hides the HUD zones it covers, so nothing ever stacks.

### Comments and collaboration

- **Roles:** Owner and Team edit and revise, Client comments and approves, Viewer only looks. Comments carry `author { id, name, role, hue }`.
- **Pins:** 24px, in the author's hue with a white ring and a number that matches in Plan and House. The selected pin gets a 2px accent ring. Press `C` and click to drop one; it auto-tags "First floor · Bedroom 2 · Wall" (editable) and saves a snapshot.
- **Comments sheet:** Open · Resolved · Mine, grouped by floor and room.
  - Each comment: a 28px initials avatar in the author's hue, the name, the role as a caption ("Client") and the time.
  - Naqsha replies under the نقشہ avatar with a feasibility chip ("Feasible · +20 sq ft" or "Breaks front setback").
  - "Include in next revision" is on for Team, and off for Client until an owner includes it.
- **Share dialog:** a link with a role (Can comment / Can view), the version, email invites as Team or Client, and a "Link copied" toast.
- **Client view (`/s/:token`):** no Brief or Details, and a banner: "Shared by Ahmed Builders · You can comment". Guests give only a name. Next becomes **Approve v2**. Presence polls every 10s.

### Revisions

- **Start:** "Revise with 3 comments", or a change typed into Ask, opens the conversation, where incoming `changes` tick off as they rebuild.
- **Canvas:** stays put and crossfades to v2 (600ms), with a 1.2s accent outline on changed meshes.
- **Compare:** in Plan, changed rooms get a dashed accent outline and a delta ("+20 sq ft"), plus a 2D wipe that snaps at 0/50/100%. In House, hold `\` to see v1.
- **Each comment** ends as **Done**, **Alternative offered** (with "Use the alternative"), or **Not possible** with the reason in ink-2.
- **Versions** (title menu): a thumbnail, the author and "From 3 comments". **Restore** makes a new version.

### Mobile (under 768px)

- **Frame:** a 52px top row (←, name, Share) with the view switch full width below it, and the dock pinned to the bottom (safe-area). Sheets become bottom sheets at 40% and 92%.
- **Views:** Concepts is a swipe carousel. Plan pinches to zoom, with floor chips. Walk has a left joystick, right-side drag to look and a full-sheet room list, but no minimap.
- **Sizing:** 16px gutters, 44px targets, nothing hover-only.

## 7. Motion and micro-interactions

Use motion `layout` and the spring. Reduced motion: 120ms fades and 200ms camera crossfades.

| # | Interaction | Motion |
|---|---|---|
| 1 | Next pill | Label crossfades, width springs (320ms) |
| 2 | Fact tokens | 40ms stagger, rising from y+6 (240ms) |
| 3 | Envelope | Springs to size as dimensions count up (320ms) |
| 4 | Room chip drag | Lifts to 1.04 with e3; meter springs, one warn pulse on overflow |
| 5 | Day/Night | All four crossfade (400ms `ease-out`) |
| 6 | Plan draw-in | Walls stroke in arrival order (600ms); rooms fill with a 40ms stagger |
| 7 | Check fixed | Fail to pass with a 1→1.06→1 pop (400ms); "5 → 1 → 0" |
| 8 | Room glide | Route draws (300ms), then the camera moves; the name settles into the pill |
| 9 | Pin drop | 0.6→1.08→1, 8px drop, one ripple (320ms) |
| 10 | Saved | "Saving…" → "Saved" for 1.5s in the status line |

## 8. Copy tone

A calm, experienced Lahore architect: warm, brief, second person, in marla and feet. One clause per rule.

- "Tell me about the plot and who will live there. One message is enough."
- "Here's what I understood. Tap anything I got wrong."
- "I've assumed a one-car porch. Change it any time."
- "LDA needs 10 ft open at the front. I've kept it."
- "Your home passes all 42 LDA checks. Want to walk through it?"
- "I couldn't widen the drawing room without breaking the side setback. I can take 2 ft from the lounge instead."

**Never:** "Argon", "section", "SDK", "agent", "Oops", exclamation marks, emoji or all-caps.
