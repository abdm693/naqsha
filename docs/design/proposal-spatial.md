# Naqsha redesign: Spatial direction ("the house is the interface")

Each project is one full-bleed canvas that changes form (plot, concepts, plan, house) instead of switching pages. The chrome is a few floating glass ornaments, and a command bar ("Ask Naqsha") is the main input. References: visionOS ornaments and Arc's command bar.

## 1. Principles

1. **One canvas that changes form.** The plot grows into the LDA envelope, then the plan, then the house. The user never leaves `/p/:id`.
2. **Say it or tap it.** Anything a button does can be typed ("go to the master bedroom", "night", "print first floor"). Every agent question also has one-tap answers.
3. **Context appears where you are.** Panels attach to the room, pin or rule they describe. At most three floating surfaces, in fixed zones that never overlap. (Today "Finish walkthrough" covers the key hints.)
4. **One next step, not the whole pipeline.** There is exactly one accent action per view.
5. **Trust stays visible.** LDA and livability checks are a constant badge. A failed check glows on its geometry.

## 2. Colour

**Why the change:** the beige and brick read as heritage stationery. They also compete with the scene's warm teak, terracotta armchairs and stone, and brick sits too close to `fail` red. With neutral chrome, the only warm colours on screen are the house's own materials. The new accent is **blueprint cobalt**, the colour of a drawn naqsha.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#F5F6F8` | `#0B0C0F` | page, canvas surround |
| `--surface` | `#FFFFFF` | `#16181D` | cards, sheets |
| `--glass` | `rgba(255,255,255,.72)` | `rgba(22,24,29,.64)` | ornaments on pages |
| `--hud-glass` | `rgba(14,16,20,.62)` | same | **every control over the 3D scene, in both themes** |
| `--ink` | `#0E1014` (19:1) | `#F2F3F5` | primary text |
| `--ink-2` | `#454B55` (8.8:1) | `#B8BDC6` | body |
| `--ink-3` | `#6B717C` (4.9:1) | `#9AA0AA` | secondary text |
| `--line` / `--line-strong` | `#E6E8EC` / `#CDD1D8` | `#262930` / `#3A3E46` | hairlines, inputs |
| `--accent` | `#2747F5` (6.4:1 on white) | `#7D93FF` | primary action, selection, focus |
| `--accent-soft` | `#ECEFFF` | `#1B2142` | selected tint |
| `--pass` / `--warn` / `--fail` | `#0E7A55` / `#B4540A` / `#C8281E` | `#3DD39A` / `#FFB547` / `#FF7A6B` | check states |
| `--author-1…6` | `#2747F5 #0E9F8F #D14D8B #E07B00 #6A4CE0 #4A7A1F` | +15% lightness | avatars, pins |

Glass uses `backdrop-filter: blur(24px) saturate(160%)` with a stroke of `inset 0 0 0 1px rgba(255,255,255,.14), 0 0 0 1px rgba(0,0,0,.06)`. Dark mode follows `prefers-color-scheme`.

## 3. Typography (Google Fonts)

- **Geist** (400/500/600) for all UI and display text. Drop Fraunces: a serif display reads editorial and dated here.
- **Geist Mono** (500) for dimensions, areas and check counts, with `tabular-nums`.
- **Noto Nastaliq Urdu** (400) only for the نقشہ wordmark.

| Role | Size/line | Weight | Tracking |
|---|---|---|---|
| Hero | 88/88 (mobile 48/50) | 600 | −0.04em |
| Display | 48/52 | 600 | −0.03em |
| Title | 28/34 | 600 | −0.02em |
| Heading | 20/26 | 600 | −0.01em |
| Body | 15/22 | 400 | 0 |
| Label | 13/18 | 500 | 0 |
| Caption | 12/16 | 500 | +0.01em |
| Dimension (mono) | 11/14 | 500 | +0.02em |

## 4. Spacing, radius, elevation, motion

- **Spacing** (4 pt grid): `2 4 8 12 16 20 24 32 48 64 96`. Ornaments sit 16 px from the edge (12 on mobile), 8 px apart.
- **Radius:** `chip 8`, `control 12`, `card 20`, `panel 28`, `pill 999`. Nested radii are concentric: inner = outer − padding.
- **Elevation:**
  - `e1`: a hairline only.
  - `e2` (ornaments): `0 1px 2px rgba(0,0,0,.06), 0 8px 24px -8px rgba(0,0,0,.20)`.
  - `e3` (contextual panels): `0 24px 64px -16px rgba(0,0,0,.28)`.
  - `e4`: e3 plus a `rgba(14,16,20,.32)` scrim, for sheets.
- **Motion:**
  - Durations: press 120 ms, fade 200 ms, panel 320 ms, morph 800 ms, camera 600–1200 ms (scaled by distance).
  - Easing: `--ease-out: cubic-bezier(.22,1,.36,1)`, `--ease-camera: cubic-bezier(.65,0,.35,1)`. Panels use a spring of `{stiffness: 380, damping: 34}` (motion/react).
  - Under reduced motion, camera moves become 200 ms crossfade cuts.

## 5. Navigation model (replaces the stage bar)

| Ornament | Where | Job |
|---|---|---|
| **Project capsule** | top-left | Glyph, project name (rename inline), version chip `v2 ▾`, a status sentence ("Planning floors… 2 of 3"), and "Saved ✓". Its menu holds Share, Print and Versions. |
| **Lens rail** | left edge, vertical, icons (label on hover) | Brief · Concepts · Plan · House · History: *views of one project*, not steps. A lens appears once it exists; while it generates it shows a progress ring. |
| **Command bar** | bottom-centre, 640 px | Input, the agent's latest line above it, and 2–4 contextual chips. Open it with `/` or ⌘K. |
| **Next capsule** | right end of the command bar | The single accent action: *Generate concepts → Plan this one → Walk through → Revise with 3 comments → Share*. |

**Where am I?** The canvas itself, the highlighted lens and the status sentence. **How do I move on?** The Next capsule, or say it. The URL holds the whole state (`?lens=house&mode=walk&floor=first&room=bed-2&v=2`), so back/forward and shared links work. Keys: `1–5` switch lenses, `G/F/R` switch floors, `W` toggles walk, `C` adds a comment, `Esc` steps back out.

## 6. Screens

**Landing (`/`).**
- **Header:** the wordmark, "Sign in", and an accent **Portal →** pill.
- **Heading** (88 px): "See your home before the first brick." Under it: "Naqsha designs a Lahore home around your family, checks it against LDA rules, and lets you walk through it, in an afternoon."
- **Calls to action:** *Open Portal* and *Explore a sample home* (no sign-in).
- **Animation:** a live three.js scene built with the engine from the sample plan.
  - Sequence: the plot outline draws, the setback envelope fades in, the slab pours, and a rising `sectionCut` plane grows the walls floor by floor. Then the stair and railings, the glazing and the roof solar panels appear, the sun sweeps to dusk and the lights come on.
  - 9 s, then it idles in orbit; scrolling scrubs it. Fallback: an 8-frame WebP sequence.
- **Features** (six outcome tiles): *Approval-ready from day one* · *Decide in an afternoon* · *Walk it with your family* · *Change it in plain words* · *Clients and team in one place* · *Print-ready naqsha*.

**Sign in / up.** A 420 px sheet, not a separate page.
- **Methods:** Google (primary) or an email magic link. No passwords.
- **When it appears:** only on Share, on saving a guest project, or when opening an invite.
- **First run:** asks only for a display name, then assigns an author colour.

**Workspace (`/portal`).**
- **Top:** a large command bar: "Describe your home…", with example chips. Submitting creates a project with the brief already parsed.
- **Below:** tabs *Your homes · Shared with you · Samples*. Cards (4:3) show a thumbnail that orbits on hover (a sprite), the status sentence and collaborator avatars.

**Setup (Brief lens).**
- **Canvas:** the plot to scale, with the road, a north arrow and ghosted neighbours. The rectangle reshapes as sizes are typed. "Corner" adds a second road and the splay. The envelope rises as a translucent cobalt volume.
- **Chat and Brief card:** chat is a 400 px glass column on the left, with a Brief card top-right.
  - The agent parses compound answers. "10 marla corner, east facing, parents downstairs" fills four facts, and each flies into the Brief card as a chip. Values the AI picked carry a dotted "AI chose" underline and are editable with one tap.
  - One question per turn, only for what is missing, with a default and its reason.
- **Floor stack:** one bar per storey. Room tokens (Bed + bath, Kitchen, Drawing, TV lounge, Dining, Prayer, Store, Servant, Laundry) drag between floors. The agent pre-fills it ("Ammi's room on ground"). Each floor has a meter (`1,240 / 1,440 sq ft`) that turns amber when the floor is over capacity.
- **Water tank:** two picture cards: *blue plastic* (cheaper, visible) or *RCC over the mumty* (default; hidden, durable).
- **Roof:** "Keep the roof clear for solar?" *Yes* draws the panel array with an estimate ("~6 kW"). Domes, minarets and pergolas are off unless asked for.

**Concepts.**
- **Layout:** a 2×2 grid of floating images. On mobile, a swipe carousel.
- **Day/night toggle** (☀︎/☾ above the grid): all four images crossfade together. Night images are image-to-image variants of the day frames, so the comparison is like for like. They generate on the first toggle, with shimmer placeholders.
- **Plot label:** each image carries a *Corner plot* or *Mid-row* chip taken from the brief.
- **Choosing:** clicking an image expands it full-bleed. The command bar then remixes it ("darker glass"), and Next reads *Plan this one*.

**Plan.**
- **Live drawing:** the SVG plan draws as Argon streams: walls stroke in and labels type. A floor stack sits on the right.
- **Activity strip:** one line of narration ("Checking 42 LDA rules… fixed 2 setback issues") that expands into the timeline. Code hides behind *Show Argon's work*.
- **Checks badge:** `LDA 42/42 · Livable 4/4`. The livable checks:
  - bedrooms open only onto circulation, living, balcony or their own bath;
  - every stair edge has a guard;
  - a stair reaches the roof door;
  - no furniture sits in a door swing.

  Clicking a rule highlights its geometry. Violations outline in `--fail` and morph to `--pass` once fixed.
- **Print:** `/p/:id/print?v=2` lays out vector sheets (A3 landscape, A4 optional): a cover (concept, site plan, area schedule, compliance), then one sheet per floor at 1:100, each with a title block, scale bar and north arrow. `@media print` plus `window.print()` gives Save as PDF.

**House lens: Explore and Walk.**
- **Orbit view:**
  - Floor stack (right): Roof / First / Ground / All.
  - **View** button (bottom-left): layers, section cut, sun time, and *Neighbours: Ghost / Show / Hide*. Ghost is the default: neighbours fade to 15% when they block the camera's view of the house.
- **Walk view:**
  - **Mouse look:** a click engages pointer lock with a centre dot, FPS style. `Esc` releases it, and trackpads drag to look.
  - **Room navigator:** the minimap (top-right) is clickable, and "Rooms ▾" lists rooms by floor. Picking one draws a route, then the camera glides along the navmesh through doorways (1.4 m/s, eye at 1.6 m, at most 3 s). If there is no route, it fades to the doorway.
  - **Floor buttons** mean *go there*: glide up the stair, or fade to the landing. They never hide levels and never leave the user mid-air.
  - **Cars** ghost within 2 m of the camera.
- **HUD zones:** the capsule and location ("Dining · Ground") top-left, the minimap top-right, the lens rail on the left, the command bar and Next at bottom-centre, the checks badge bottom-left. Key hints show once, then collapse to `?`.

**Comments and collaboration.**
- **Pins:** `C` or right-click › *Comment here* drops a pin with an author-coloured ring. An anchored bubble opens, auto-tagged ("Bedroom 2 · wall"), with @mentions.
- **Share sheet:** roles are *Team (edit)*, *Client (comment and approve)* and *Viewer*, plus a link toggle.
- **Clients** see reduced chrome: no Revise, and an **Approve v2** action.
- **Comments panel:** filters, threads, and a per-comment *Include in next revision* toggle. It is on by default for the team and off for clients until the team includes the comment.

**Revisions.**
- **Starting one:** Next becomes *Revise with 3 comments*, or the user types a change ("open up the kitchen") to revise straight away.
- **Rebuild:** affected rooms pulse, then only the changed sections rebuild.
- **Review:** a vertical **before/after wipe** splits the canvas, with changes outlined in accent and "What changed" cards floating beside them. Pins show *Resolved* or *Not possible*, with the reason and a *Do the alternative* button.
- **History lens:** the timeline with thumbnails. *Restore* creates a new version.

## 7. Ten micro-interactions

1. **Plot:** the rectangle reshapes and the dimensions count up as the user types (320 ms).
2. **Facts:** extracted facts fly from the chat into the Brief card (FLIP, 400 ms).
3. **Room tokens:** a dragged token lifts (scale 1.04, e3). The floor meter springs, and amber pulses once when a floor overflows.
4. **Day/night:** the sun rotates into the moon while all four images crossfade (600 ms).
5. **Plan drawing:** walls draw via `stroke-dashoffset` and rooms fill at a 40 ms stagger.
6. **Violation fixed:** the red outline morphs to green with a 1.0→1.06→1.0 pop.
7. **Plan to House:** the 2D plan extrudes into 3D (800 ms) instead of a route change.
8. **Room glide:** the route draws on the minimap before the camera moves. The room name fades in on arrival.
9. **Pin drop:** the pin springs in with a surface ripple and the input autofocuses. `Enter` saves.
10. **Before/after wipe:** the wipe snaps to 0/50/100%, and "Saved ✓" fades in after each autosave.

## 8. What not to do

- **No stage scaffolding:** no stepper, no numbered stages, no "Step 3 of 5".
- **Colour:** no more than one accent action per view, and no warm colours in the chrome.
- **Surfaces:** no glass on glass and no overlapping HUD zones. Text over 3D always uses `--hud-glass`.
- **Camera:** no teleports without a transition, no floor switch that hides your floor, and no mid-air spawns.
- **Homeowner view:** no model names, attempt counts or code by default.
- **Inputs:** no chat-only inputs; every question offers taps.
- **Style:** no serif display, beige, button gradients, neon glass or emoji.
- **Design content:** no decorative roof elements unless asked, and no corner-plot imagery for a mid-row brief.
- **Animation:** nothing over 900 ms that the user waits through repeatedly, and reduced motion is always honoured.
