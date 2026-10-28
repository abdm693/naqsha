# Naqsha redesign: "Calm"

The house is the interface. Everything else waits until it is needed.

## 1. Principles

1. **The house is the hero.** Renders, plans and 3D run edge to edge. Controls are glass over the house and fade when idle.
2. **One accent, one meaning.** Blue means "your next move" or "Naqsha is working", never decoration or status.
3. **Propose, don't interrogate.** Every screen opens with Naqsha's draft for the user to correct.
4. **A place, not a wizard.** A project is one canvas whose content changes, with no numbered steps.
5. **Plain words.** Each screen has one headline and one forward action. Model names and code stay behind "Details".

## 2. Colour

**Why replace beige and terracotta?** Terracotta disappears into the golden-hour brick-and-teak renders. Brick `#9e3f26` also sits next to fail red `#b1262c`, so "primary" and "violation" look alike. The grid, serif and stamp read as dated. Cobalt complements the warm renders and echoes Multani *kashi* tile blue.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#F7F6F3` | `#111110` | page (limestone) |
| `--surface` | `#FFFFFF` | `#1A1A18` | cards, sheets |
| `--surface-2` | `#EFEDE9` | `#232321` | hover, segmented track |
| `--line` | `#E5E2DC` | `#2C2B29` | 1px hairlines |
| `--line-strong` | `#CFCAC1` | `#3D3C39` | inputs, secondary walls |
| `--ink` | `#161513` | `#F3F1EC` | text, plan walls |
| `--ink-2` | `#4A4741` | `#A9A59E` | secondary text |
| `--ink-3` | `#6F6B64` | `#8A867F` | tertiary (at least 4.5:1) |
| `--accent` | `#2E5BDA` | `#6E93F5` | the one accent (5.4:1) |
| `--accent-press` | `#2549B8` | `#5A7FE6` | pressed |
| `--accent-soft` | `#EEF2FD` | `#1B2440` | selection, focus halo |
| `--pass` / `--warn` / `--fail` | `#2E7A55` / `#995F0D` / `#C0352E` | `#5DBB8A` / `#E0A54A` / `#F0706A` | compliance only, as a 6px dot plus text |
| `--glass` | `rgba(20,20,19,.56)`, `blur(24px) saturate(1.4)`, border `rgba(255,255,255,.08)` | same | only over 3D or photos |

## 3. Typography

Load from Google Fonts:

- **Inter**: variable, `opsz` 14–32, weights 400/500/600 only.
- **JetBrains Mono** 400: code under Details.
- **Noto Nastaliq Urdu** 500: the نقشہ wordmark.

Drop Fraunces. Use `"tnum"` for every dimension and figure, sentence case everywhere and no all-caps labels.

| Style | Size/line | Tracking | Weight |
|---|---|---|---|
| hero | `clamp(56px,8vw,120px)`/0.95 | -0.045em | 600 |
| display | 64/68 | -0.035em | 600 |
| title-1 | 40/44 | -0.025em | 600 |
| title-2 | 28/34 | -0.018em | 600 |
| title-3 | 20/26 | -0.01em | 600 |
| body-lg (Naqsha's voice) | 19/30 | -0.005em | 400 |
| body | 16/24 | 0 | 400 |
| callout | 14/20 | 0 | 500 |
| caption | 12/16 | +0.01em | 500 |

## 4. Spacing, radius, elevation, motion

- **Spacing:** 4, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192. Gutters are 16 / 32 / 64 (phone, tablet, desktop). Reading column 600px, maximum width 1280px.
- **Radius:** 6 for keys and chips, 10 for inputs, 16 for cards, 24 for sheets and HUD panels, 32 for hero media, 999 for every button and segmented control.
- **Elevation:**
  - `e0`: a 1px `--line` only (the default).
  - `e1`: `0 1px 2px rgb(22 21 19/.04), 0 0 0 1px rgb(22 21 19/.06)`.
  - `e2`, popovers: `0 12px 32px -12px rgb(22 21 19/.18)`.
  - `e3`, sheets: `0 32px 80px -24px rgb(22 21 19/.28)`.
- **Motion:**
  - Durations: press 120ms, fade 200ms, panel 320ms, canvas crossfade 600ms. Camera flights take `clamp(700, distance×120, 2400)`ms.
  - Easings: `--ease-std` `cubic-bezier(.2,0,0,1)`, `--ease-sheet` `cubic-bezier(.32,.72,0,1)`, `--ease-exit` `cubic-bezier(.4,0,1,1)`.
  - Under `prefers-reduced-motion`, flights become 200ms crossfades and draw-ins are off.

## 5. Navigation: one canvas, three anchors

The stage bar is deleted. A project is `/p/:id` with three quiet anchors.

1. **Title menu (top left).** The project name sits above a caption status line, for example "Version 2 · 42 of 42 LDA checks · Saved". Clicking it lists Brief, Concepts, Plan, Home and Versions, each with a thumbnail and its state, followed by Share, Print plan…, Rename and All homes. This is how the user goes back.
2. **View switch (top centre).** A segmented control, **Concepts · Plan · Home**, that shows only the views that exist. These are views of one house, like Map and Satellite, so there are no numbers, ticks or connectors. Routes are `/concepts`, `/plan` and `/home?walk=1&room=kitchen&v=2`.
3. **Next pill (bottom right).** The only accent button, naming the move: "Choose this concept", "Plan the floors", "Walk through it", "Revise with 3 comments". It is hidden while Naqsha works.

The **conversation** is a persistent left panel (400px) that collapses to a floating composer in Home. It holds the brief, questions, progress and revision notes. "Show me the plan", "take me to the master bedroom" and `⌘K` work anywhere. The view switch and status line show where the user is. The Next pill, or asking, moves them on.

## 6. Screens

### Landing (`/`)

- **Header:** the wordmark on the left. On the right, a "Samples" link and **Portal**, an ink pill that opens `/app`.
- **Hero:** "Walk through your home before the first brick." Beneath it, in body-lg: "Your plot and your family's wishes become an LDA-ready design and a 3D home you can walk, in one sitting."
- **"The house assembles":** a 7s three.js sequence from the sample `design.js` that plays once and holds, behind a poster frame. The plot hairline draws, then the dashed accent envelope, then the slab and columns. Walls extrude floor by floor (180ms stagger), white clay resolves to stone, teak and glass, and the sun sweeps to dusk as the windows warm. With reduced motion, show the final frame.
- **Features:** four statements, each led by a display-size figure: "Under an hour" from plot to walkthrough, "42 LDA checks" on every draft, "Change it on screen, not on site" and "Clients comment, Naqsha revises". For architects and builders: "Win the client in the first meeting."
- **Samples:** three full-bleed sample homes that open in Home without sign-in.

### Sign in and sign up

A 400px sheet over the blurred final frame: "Continue with Google" (Identity Platform) or email magic link, with no passwords. One follow-up field, "Your name, as clients will see it", plus an optional firm name. Guest projects migrate into the account. Shared-link visitors give only a name, on their first comment.

### Workspace (`/app`)

Under "Your homes", a large composer ("Describe a plot to start: *10 marla in Lake City, east-facing, for six*") creates a project with the brief already parsed. Below are image-only cards, each with a title and one status line ("Version 2 · Shared with 2"), then a samples row (first when there are no projects).

### Conversational setup

The conversation sits on the left and a live plot canvas on the right, with the envelope redrawing as facts change.

- **Opening:** "Tell me about the plot and who will live there."
- **Understood card:** everything extracted shows as editable tokens, for example "10 marla · 35×65 · Faces east · **Mid-row** · 6 people incl. grandparents". Corner or mid-row is always a token.
- **Rounds:** at most three, each one question with one widget.
  1. **Floors.** Pre-filled Roof, First and Ground rows with room chips and per-floor steppers ("Grandparents on ground: no stairs"). Chips drag between floors, "+ Kitchen" can go on First for a joint family, and a live bar shows "First: 1,860 of 2,040 sq ft".
  2. **Roof.** Water tank, as two image choices: "Plastic tank on a stand" or "Concrete tank in the stair tower". Solar: "Keep the roof clear for solar" is on by default ("about 18 panels, ~10 kW") and adds "no domes, minarets or pergolas" to the prompts.
  3. **Style.** Three image swatches.
- **Assumptions:** tappable lines in `--ink-3` ("I'll assume a 1-car porch"). A ghost "Decide for me" is always there. Thinking is a breathing 6px accent dot.

### Concepts

A 2×2 grid of renders with no text on the images. Captions below read "A · Stone and teak" and "Mid-row, east-facing". Prompts must say "neighbours on both sides" unless the plot is a corner plot. A **Day | Night** toggle sits top right. Night is an image edit of the same day image with the same camera, cached, and all four crossfade together. Clicking an image opens a full-bleed lightbox with a remix composer and the Next pill ("Choose this concept").

### Plan

The canvas is a vector plan on white, with ink walls and tnum dimensions. A floor stack (R, 1, G) runs down the left edge.

- **While working:** one narration line ("Planning floors… Checking 42 rules… Fixing 2… Building 3D, 14 of 23") and a 2px accent hairline on top. The code sections and timeline move to **Details**.
- **Compliance chip:** "● 42 of 42 LDA checks" opens a sheet with two groups:
  - **LDA:** coverage, height, FAR and setbacks, as rows with thin bars.
  - **Livability:** "Bedrooms open only to corridors, lounges, balconies or their own bath", "Every stair and void has a railing", "Roof reachable by stairs", "No furniture across a door".
- **Print (`⌘P`):** a sheet with A3/A4, floors, concept cover and compliance page. The output has a title block (project, plot, version, author and firm, date) and one floor per page at 1:100 with a scale bar and north arrow, in vector SVG so "Save as PDF" stays crisp.

### Home: explore and walk

Full bleed, with HUD zones on a fixed grid that never overlap. In walk, the chrome fades after 2.5s idle.

- **Top:** the title menu on the left, **Orbit | Walk** in the centre, and Share with presence avatars on the right.
- **Floor stack (R, 1, G), left edge:**
  - In orbit, it lifts the upper floors away. Tapping the active floor again shows all.
  - In walk, it flies the walker to that floor's stair landing and never hides geometry.
- **Room navigator, bottom centre:** a pill reading "Dining room · Ground ▾" (or press `G`) lists rooms by floor with type-to-filter. Choosing one glides the camera through the doors (A* over room adjacency), then returns control.
- **Bottom right:** a 160px minimap (tap a room to go there), the `+` comment button (`C`), and the Next pill.
- **Mouse look:** a click starts `requestPointerLock({unadjustedMovement:true})`, with WASD to move, Shift to run and Esc to release. A one-time hint replaces the "Click to start" modal and the permanent key legend.
- **Clearing the view:** neighbours in front of the house become 15% clay ghosts. Porch cars in walk stop colliding and fade within 2m.
- **View popover:** layers, section cut, Day/Dusk/Night, neighbours (Show / Ghost / Hide) and "Render this view".

### Comments and collaboration

- **Comment author:** each comment gains `author {id, name, role: owner|team|client}`. Avatars are initials on `--surface-2`, with the role as caption text and no coloured badges.
- **Pins:** ink dots with a white ring. The selected pin is accent. Threads take replies.
- **Share sheet:** a link ("Can comment" or "Can view") plus email invites as Team or Client.
- **Clients:** see Concepts, Plan (read-only), Home and comments, never setup or Details.
- **Owner:** ticks "Include in next revision" per thread, and only ticked threads reach the ADK agent.

### Revisions

"Revise with 3 comments" starts the revision, and the conversation ticks off each comment. The canvas stays on Home and crossfades to v2. Changed elements get a 1.2s accent outline, and changed rooms get a dashed accent outline in Plan. Press and hold `\` or the version chip to see v1. Comments that couldn't be applied show in ink-2 with the reason, not in red. Past versions are in Title menu → Versions.

## 7. Ten micro-interactions

1. **Next pill:** the label crossfades and the width animates (320ms).
2. **Understood tokens:** they stream in with a 40ms stagger, and a tap makes one an inline field.
3. **Envelope:** springs to size while the dimensions count up.
4. **Day/night:** all four concepts crossfade together in 400ms.
5. **Plan draw-in:** walls stroke in the order Argon emits them.
6. **Compliance:** "17/42" ticks up, and fixes read 5 → 1 → 0 as the dot eases from warn to pass.
7. **Room glide:** the room name settles into the navigator pill on arrival.
8. **Floor lift:** upper floors rise 1.5m and fade, like an architect's model.
9. **Pin drop:** scales 0.6→1 and drops 8px, then the composer opens attached.
10. **Saved:** "Saved" shows in the status line for 1.5s, so autosave stays visible but quiet.

## 8. What not to do

- No stepper, ticks, percentages or stage names in the chrome.
- No terracotta, beige grid, serif display type or stamps.
- No accent on decoration or status, and never two accent buttons at once.
- No glass on light pages, text over renders, modals over 3D, or overlapping HUD elements.
- No "Argon", model names or code in the main path or client views.
- No red except LDA violations.
- No question the agent can infer, and no more than three setup rounds.
- No roof ornaments by default. The roof is for solar and the tank.
- No spinners, emoji, gradients or stock illustration.
