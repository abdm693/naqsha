# Project shell (`web/src/app/shell`)

Owned by APP-SHELL. A home is one full-bleed canvas at `/app/p/:id/:view` with five floating pieces and no bars
(`docs/design/DESIGN.md` §5): the title capsule, the Brief · Concepts · Plan · House switch, the people cluster
(Comments, Share), the dock (Naqsha's line, suggestions, Ask, Next) and two sheets (conversation left, comments right).

## Views

`ProjectShell` renders one view per route; each is
`export function XView({ project, onProjectChange }: { project: Project; onProjectChange(p: Project): void })`:

| Route | Component |
|---|---|
| `/app/p/:id/brief` | `setup/BriefView` |
| `/app/p/:id/concepts` | `concepts/ConceptsView` |
| `/app/p/:id/plan` | `plan/PlanView` |
| `/app/p/:id/house` | `explore/HouseView` (lazy: three.js) |
| `/app/p/:id/revisions` | `revisions/RevisionsView` |

The files at those paths on this branch are placeholders (marked PLACEHOLDER) that APP-FLOWS replaces. Views read and
write the open project through `useProject` (`@/app/store/project`) as before. Old step routes redirect
(setup → brief, design → plan, explore → house), keeping `location.state` and the query string.

Views are full-bleed: the chrome floats over them. Content that must stay clear of it uses `<ViewFrame>` or the CSS
variables the shell publishes: `--chrome-top` (the top row plus its inset), `--dock-h` (the dock plus its inset) and
`--chrome` (12px, 16px from 1024px). Over 3D (House) the chrome switches to `glass-hud` by itself.

## The dock: `useAskContext` and `useAsk` (`./ask.ts`)

```tsx
useAskContext({
  placeholder: "Ask for a change, e.g. a bigger kitchen",
  onSubmit: (text) => useProject.getState().runRevise(versionId, [], text),
  suggestions: ["Make the kitchen open", "Add a skylight over the stair"],
  line: "Your home passes all 42 LDA checks. Want to walk through it?",   // null hides it
  next: { label: "Walk through it", run: () => navigate("?mode=walk") },  // null hides the Next pill
  commands: [{ id: "light", group: "do", label: "Night", run: toggleNight }],
  hidden: lightboxOpen,
});
const ask = useAsk(); ask.focus(); ask.submit("Make bedroom 2 bigger"); ask.setDraft("Make the porch");
```

Everything is optional; what a view leaves out falls back to the shell's defaults (Brief: a setup message; Concepts:
remix the chosen concept; Plan/House: a conversational revision `{instruction}`; Next: "Show me concepts" → "Plan this
one" → "Walk through it" → "Revise with N comments" / "Share" → "See what changed"). While Naqsha works (intake, concepts,
design, revise in `useProject`), narration replaces the line and the Next pill. ⌘K or `/` focuses Ask; typing opens
Ask Naqsha · Go to · Do.

## The query string (what the shell's commands set; views read it)

| Param | Meaning |
|---|---|
| `mode=walk` | House: walk mode |
| `floor=<level id>` | Plan or House: that floor |
| `room=<room id>` | House: go to that room (walk) |
| `v=<version id>` | Plan or House: an earlier version |
| `light=night` | Concepts or House: night |
| `comment=<id>` | House: fly to that pin (set by "Show where" in the comments sheet) |
| `dialog=print` | Plan: open the print dialog (title menu "Print plan…", command "Print plan…") |
| `compare=1` | Plan: compare with the previous version |

## Comments

`@/app/comments`: `CommentsSheet` (the right sheet; the shell mounts it), `CommentItem`, `PinNumber` (24px, author hue,
white ring) and `model.ts` (`pinNumbers(comments)` gives the shared numbers for Plan and House pins, `placeOf`, filters).
Store actions: `addComment`, `updateComment`, `deleteComment` (with Undo), `replyToComment`, `runRevise(vid, ids?, instruction?)`.
Open the sheet from a view with `useShell.getState().openComments({ focus: id })`.

## Keyboard

⌘1–4 views · ⌘K or `/` Ask · ⌘J conversation · `C` comments (House uses C for pinning) · Escape closes the top-most layer only.
