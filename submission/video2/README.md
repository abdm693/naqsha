# Naqsha · Nebius edition demo film

HyperFrames project (hyperframes@0.8.214). Output: `renders/naqsha-nebius-demo.mp4`. See BRIEF.md, STORYBOARD.md and
REVIEW.md.

## Rebuild after swapping the footage

1. Record new runs with `submission/capture/capture.mjs` (`node capture.mjs full`, `node capture.mjs drawing`).
2. Put the new recording names in `scripts/footage.json` (`"full"` and `"drawing"`, without extension). Optionally add
   `"marks"` for the new full run: `"all checks pass"` (the frame where the plan's status card turns to "Fixed … → 0")
   and `"3d code"` (when it says "Building the 3D model…"). Without them build.py derives both from `house view`.
3. Update the facts in `scripts/numbers.json` (lda_pass, lda_total, match_before, match_after, rooms_read, floors_read).
4. Run, from this folder:

```bash
python3 scripts/prep_footage.py                      # webm -> 30 fps H.264 (-g 30) + step logs into assets/footage
GOOGLE_APPLICATION_CREDENTIALS=~/.config/gcloud-naqsha-nebius-adc/application_default_credentials.json \
  /Users/abdullahmoazzam/Code/naqsha-nebius/api/.venv/bin/python -I scripts/gen_vo.py vo07 vo09   # only if the numbers changed
python3 scripts/build.py                             # scenes, cards, MG, proxies, bed_fit.wav, index.html
node scripts/carve/carve.mjs --comp index.html --bed music --strength 0.7
npx hyperframes check
npx hyperframes render --quality delivery --video-frame-format png -o renders/naqsha-nebius-demo.mp4
```

(gen_vo.py with no ids re-voices every line; build.py warns when a line's voiced text no longer matches the script.)

Step names the build reads from the JSON logs (each `{"t": seconds, "what": name}`):
- full run: `workspace`, `sent`, `rules box`, `decide for me`, `concepts view`, `plan view`, `house view`,
  `match score` (also matches `match score: …`), `match popover`, `photos panel`, `photos done`, `photo enlarged`,
  `photo 2`, `photo 3`, `photo 4`, `night`, `day again`, `orbit`, `walk`, `walked`
- drawing run: `uploaded`, `read`

Assumptions tied to the app, not to one recording (constants in build.py): the 3D canvas shows the house about 2.4 s
after `house view` (`HV_SHOWN`); the outro's first shot is the 2.3 s before `walk`; the walk's last 3.5 s are cut;
the night shot is `night` + 0.3 s for 4.3 s. vo07 says "All {lda_total} bylaw checks pass", so build.py stops if
lda_pass and lda_total differ.
