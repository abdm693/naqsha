# Naqsha redesign: "Studio" direction

An architecture firm's drawing set, run like Linear, Vercel and Teenage Engineering: cool drafting film, ink linework, one cobalt accent, a signal-orange "live" colour, mono numerals.

## 1. Principles

1. **Every line is a measurement.** The look comes from hairlines, dimension ticks and mono figures, never ornament.
2. **The drawing is the stage.** The plan or model fills the canvas. Chrome is a thin frame around it.
3. **The architect moves first.** Every screen ends with the agent's proposed next step.
4. **Places, not steps.** A project is a drawing set you can open in any order.
5. **Data, calmly.** Real figures go in spec tables, never in hype.

## 2. Colour

**Why drop beige and terracotta:**
- Golden-hour sandstone and teak renders melt into warm chrome, while cool neutrals frame them like a gallery wall.
- Brick `#9E3F26` and fail `#B1262C` are nearly the same hue, so the brand reads as an error.
- Cobalt recalls the blueprint and reads as precise and approved.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#F4F5F7` | `#0B0D10` | Canvas |
| `--surface` | `#FFFFFF` | `#14171C` | Panels, sheets |
| `--surface-2` | `#EDEFF2` | `#1C2027` | Inputs, row hover |
| `--line` / `--line-strong` | `#DFE3E8` / `#C2C9D1` | `#2A3038` / `#3A414B` | Hairlines / borders |
| `--grid` | ink 5% / 9% | white 4% / 7% | 8px / 40px drafting grid |
| `--ink` | `#0E1116` | `#F3F5F7` | Text, plan poché, primary buttons |
| `--ink-2` / `-3` / `-4` | `#3B4350` / `#687280` / `#A0A8B3` | `#C5CBD3` / `#8D96A2` / `#5C6570` | Secondary / meta / disabled |
| `--accent` (`-hover`, `-soft`) | `#2547F5` (`#1A36D6`, `#EAEEFF`) | `#6A86FF` (`#8299FF`, `#1A2350`) | Selection, focus, links, setback lines |
| `--signal` / `--signal-ink` | `#FF5A1F` / `#C2410C` | `#FF6A2B` / `#FF8A57` | Live agent dot, comment pins, "you are here" |
| `--pass` / `-soft` | `#0E8A5F` / `#E4F4EC` | `#3CC48D` / `#0F2A20` | |
| `--warn` / `-soft` | `#B76E00` / `#FFF4DC` | `#F2A93B` / `#2E2210` | |
| `--fail` / `-soft` | `#D92D20` / `#FDECEA` | `#FF6B5E` / `#33140F` | |

**Plan fills:**
- bedroom `#EEF1FE`
- wet areas `#E5F2F6`
- living `#F3F4F6`
- service `#ECEEF1`
- outdoor `#E7F2EA`
- circulation white

Walls are drawn in solid ink, and setbacks as 1px cobalt dashes.

**HUD glass** is used over 3D only: `rgba(11,13,16,.68)`, `blur(16px) saturate(140%)` and a 1px `rgba(255,255,255,.08)` border.

## 3. Typography

All four families come from Google Fonts:
- **Geist** (400/500/600) for the UI.
- **Geist Mono** (400/500, `tabular-nums`) for every number, dimension, label and log line.
- **Instrument Serif Italic** for one phrase per landing heading only.
- **Noto Nastaliq Urdu** for the نقشہ wordmark.

| Style | Size / line-height | Tracking | Weight |
|---|---|---|---|
| display-xl | clamp(56px, 8vw, 112px) / 0.95 | -0.045em | 600 |
| h1 / h2 / h3 | 32/1.15, 22/1.25, 17/1.35 | -0.025, -0.015, -0.01em | 600 |
| body-lg / body / small | 17/1.55, **14/1.5** (app default), 13/1.45 | 0 | 400/500 |
| label (mono, caps) | 11 / 1.2 | +0.08em | 500 |
| data (mono) / kpi | 13/1.3, 28/1.0 | 0, -0.02em | 500 |
| plan room name (caps) | 10 / 1.1 | +0.06em | 600 |

## 4. Spacing, radius, elevation, motion

- **Spacing** uses a 4px base: `2 4 8 12 16 20 24 32 40 48 64 96 128`.
  - Margins are 32px, or 16px on mobile.
  - The rail is 56px wide, or 232px expanded. The inspector is 360px, and the chat is at most 680px.
  - Controls are 32px tall, 44px on touch.
- **Radius:** 0 for plans, 4 for chips, 6 for buttons and inputs, 10 for cards and popovers, and 14 for modals and HUD clusters. Only avatars and pins are round.
- **Elevation:**
  - `e1` is `0 1px 0 #0E11160A, 0 0 0 1px var(--line)`.
  - `e2` is `0 8px 24px -12px #0E11162E, 0 0 0 1px var(--line)`.
  - `e3` is `0 24px 64px -24px #0E111652`.
- **Motion:**
  - Durations are 80ms for a press, 140ms for hover, 220ms for panels and 360ms for route changes. Line drawing takes 600ms per stroke, and camera moves take 0.9–2.5s, scaled by distance.
  - Easings are `cubic-bezier(.16,1,.3,1)` (out) and `cubic-bezier(.65,0,.35,1)` (in-out).
  - With reduced motion, every transition becomes a 120ms fade and camera moves become cuts.

## 5. Navigation model

The stepper is deleted. Three quiet frames replace it:

1. **Breadcrumb bar** (48px). It answers "where am I": `Naqsha / Johar Town family home / Plans · Ground`, then `v2 ▾`, then `Saved`. Avatars, `Share` and the account menu sit on the right.
2. **Sheet index rail** (left; icons that expand on hover). It lists the places like a drawing-set index: `01 Brief`, `02 Concepts`, `03 Plans`, `04 Model`, `05 Review`, `06 Versions`. Each place has one glyph:
   - a hairline ring means not made yet;
   - a pulsing `--signal` dot means the agent is working;
   - an ink dot means ready.
3. **Architect bar** (bottom centre). This persistent composer carries one agent-written **Next chip**, for example `Concept B looks right → Plan the floors`. Clicking the chip, or pressing ⌘↵, moves the user on.

`⌘K` jumps to any place, room or version, and each place has its own URL. On mobile, the rail becomes a bottom tab bar.

## 6. Screens

### Landing
- **Nav:** the wordmark, `Samples`, `For builders`, `Sign in`, and an ink **`Portal →`** button.
- **Hero:** "Walk through your home *before* the first brick." The subhead reads "LDA-ready plans and a 3D house your family can walk, share and revise, in an afternoon."
- **Animation:** an SVG axonometric under 60KB, played once over about 9s.
  - The plot and dimensions draw in, then cobalt setback dashes appear.
  - The slab extrudes. Columns rise while a mono height counter ticks to `+21'0"`, then the walls hatch in floor by floor.
  - The stair zig-zags up, and the solar frame and tank land on the roof. A hairline crane jib swings away.
  - The lines crossfade to the sample render, and day turns to night.
  - With reduced motion, the final frame shows.
- **Features:** a 3×2 grid of hairline cells, each with a title, one line and a mono figure: Approval-ready from day one; Four exteriors, day and night; Walk it with your family; Change it by commenting; Share with clients, keep control; Print-ready drawings.
- **Then:** a strip of sample homes, and a closing `Portal →` band.

### Sign in / sign up
- One screen for both: the form on the left, a plan over a render on the right.
- `Continue with Google` (Firebase Auth) or an email magic link; no passwords. `Continue as guest` stays.
- **First sign-in:** it offers "Bring your 3 guest projects", then asks one question: Family, Builder or Architect?
- **Invites:** the screen shows the project and who invited you. Commenters can join with just a name.

### Workspace
- **Header:** `Projects` with a mono count, a filter (`All · Mine · Shared`), a grid/list toggle and `New project`.
- **Start composer:** typing "10 marla mid-row in DHA 6, 5 beds, kitchen upstairs" creates the project and pre-fills its Brief.
- **Cards:** a 4:3 image, the name, and a mono meta line (`10 MARLA · 35×65 · 5 BED · V2`). They also show a status dot, collaborator avatars and the number of open comments.

### Brief (conversational setup)
- **Layout:** the chat is centred. On the right, a live **Brief sheet** shows the envelope diagram above a spec table. Each row is tagged `You said` or `Assumed` and can be edited inline.
- **Understanding:** the agent extracts facts from free text and shows them as "Understood" chips you can correct. It asks only about the gaps.
- **Plot position** (`Corner` / `Mid-row`, with a mini diagram) is always asked, and the concepts must honour it.
- **Per-floor program:** a **Stack widget** with one band per floor, roof on top.
  - You add, remove or drag room tokens (Bed + bath, Kitchen, Drawing, TV lounge, Dining, Guest, Servant, Prayer, Study).
  - An area meter (`1,180 / 1,440 sq ft`) turns warn when a floor overflows.
  - Typing "second kitchen upstairs" animates a token into place.
- **Water tank:** `Plastic on roof`, `Concrete in structure` or `Decide for me`, each with a one-line trade-off.
- **Roof:** `Keep clear for solar` is the default and shows an estimate (`~4.8 kW`). The other choices are `Elevated solar frame` and `Not now`. Decorative roof features are added only on request.
- **Moving on:** once the minimum is known, the Next chip offers `Generate concepts →`.

### Concepts
- **Grid:** 2×2 at 16:10 with 1px frames. Each has an agent-written mono caption, such as `B · STONE PIER, TEAK LOUVERS`.
- **`Day · Night` toggle (key `N`):** swaps all four images together.
  - Night images are generated from each day image, with the same camera.
  - They are made on the first toggle, and each tile shimmers until its image is ready.
- **Selection:** a 2px cobalt outline and check. Selecting two concepts opens a swipe comparison.
- **Inspector:** a "Drawn from your brief" panel showing plot position, floors, tank and roof.

### Plans: progress, compliance, print
- **The sheet:** poché walls, mono dimensions, door swings, a north arrow, a scale bar and a **title block** (`A-101 Ground floor`, `1:100`, `v2`, `LDA 42/42`).
- **Floors:** a `G · 1 · R` segment (keys `1`–`3`).
- **Hovering a room** outlines it in cobalt and shows its area and "Opens to: Corridor, Attached bath".
- **Inspector tabs:**
  - **Compliance:** KPI tiles (`63.3 / 70%`, each with a 2px meter), followed by two rule groups. Clicking a rule highlights its geometry on the plan.
    - **LDA bylaws.**
    - **Livability:** no bedroom opens into another bedroom or into a bath that isn't its own; every open stair edge has a railing; every level, including the roof, can be reached by stair; doors are clear of furniture.
  - **Rooms:** the room schedule.
  - **Build log:** a Vercel-style mono log (`LDA 5 → 1 → 0`, `Model 14/23`), with the code sections collapsed inside it.
- **Export (⌘P):** choose sheets and A3 or A4. This renders `/p/:id/print` with `@page { size: A3 landscape; margin: 12mm }` at true scale, with a title block on every page. `window.print()` then prints or saves a PDF.

### Model: explore and walk HUD

| Zone (never overlapping) | Element |
|---|---|
| Top-left | Location chip `FIRST FLOOR · Bedroom 3 ▾` |
| Top centre | `Orbit · Walk` |
| Right edge | Level stack `R / 1 / G` |
| Bottom centre | Dock: Layers, Section, Day/Night, Render |
| Bottom-right | Minimap |
| Bottom-left | `? Controls` |

- **Room navigator:** pick a room from the location chip, or click one on the minimap. The camera walks the navmesh at 3× speed (2.5s at most), then faces the room. If no route exists, it says so ("No door reaches Roof terrace").
- **Level stack:** in Walk, it goes to that floor's stair landing. In Orbit, it cuts away the floors above. Walk has no `All` option.
- **Mouse look:** a click engages pointer lock with a crosshair, and `Esc` releases it. Dragging to look remains as a fallback.
- **Occlusion:** cars and furniture within 1.2m of the camera fade to 15%. Neighbours that block the house ghost to a 20% wireframe (`Context: Show · Ghost · Hide`).
- **Finish walkthrough:** becomes the Next chip `Review 3 comments → Make v3`.

### Review: comments and collaboration
- **Pinning:** press `C` and click a surface. The popover has an editable auto-tag (`First floor · Bedroom 2 · Wall`) and a snapshot.
- **Pins:** numbered `--signal` circles, which turn grey once resolved. They carry the same numbers on the model and on the plans.
- **Author identity:**
  - Each comment shows an avatar (initials on one of 8 cool hues, hashed from the user ID), a name, a role badge (`Owner` / `Team` / `Client`) and a mono time.
  - Agent replies are labelled `Architect` and add a pre-check chip, such as `Feasible · +20 sq ft` or `Breaks front setback`.
- **Share popover:** invite by email as Can view, Can comment (clients) or Can edit (team). It also has a link toggle and a choice of which version to share.
- **Clients** see the same app without editing controls, under a banner: "Shared by Ahmed Builders · you can comment".
- **Review place:**
  - Threads are grouped by floor and room, with `Open · Resolved · Mine` filters and `@mentions`.
  - Owners and team members get `Send to revision`.

### Versions
- **Timeline:** each version (`v1`, `v2`…) shows its author and "from 3 comments".
- **"What changed":** a changelog where each row has a type tag, a sentence, room chips and the linked comments. Each comment shows `Done`, `Alternative offered` or `Not possible`.
- **Plan diff:** side-by-side, swipe or a 50% overlay. Changed rooms get a cobalt dashed outline and a delta (`+20 sq ft`).

## 7. Ten micro-interactions

1. **Room hover:** hovering a room draws its dimension strings in 240ms.
2. **Brief sheet:** extracted facts fly into the sheet rows with a 60ms stagger.
3. **Plot size:** the envelope FLIP-morphs and the mono figures count up.
4. **Day/night:** a 1px horizon line wipes across all four tiles, then they crossfade.
5. **Rule checks:** rules tick in and the meters fill. A failed rule nudges 2px once, and its geometry pulses.
6. **Room fly-to:** the minimap arrow tracks the camera, and the room name crossfades on arrival.
7. **Orbit floors:** the floors above rise 0.5m and fade instead of popping.
8. **Comment pin:** it springs in (0 → 1.08 → 1) with one ripple, and its auto-tag types itself.
9. **Save state:** `Saving…` becomes `Saved` with a self-drawing check, never a toast.
10. **Next chip:** when the agent finishes, the chip slides up 8px and glows cobalt once.

## 8. What not to do

- No steppers, numbered stage circles or progress connectors.
- No beige, terracotta, paper textures or serif body text. Red only means fail.
- No pill CTAs with arrow badges, no card shadows and no decorative gradients. Glass is for 3D only.
- No code section names as primary UI.
- No HUD items stacked in one corner, and no legend over an action.
- No sign-up wall before samples or guest projects.
- No long forms. Each question is one card the user can answer in words or skip.
- No looping animation except the live dot, and no confetti or emoji.
- No error-red "Demo data" dot. Use an `--ink-3` mono label instead.
