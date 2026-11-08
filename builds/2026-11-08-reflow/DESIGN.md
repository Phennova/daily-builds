# Reflow - design

## Concept
A Lemmings-style puzzle where the level is a real HTML page and your only tools are CSS declarations.
Tiny "readers" drop out of the address bar and walk along the tops of the line boxes the browser actually
laid out: a ragged right edge is a staircase, a heading is a ledge, a flex row of cards is a bridge, the gap
between lines is a fall. Below the page sits a DevTools-style Styles pane; tap a value (`text-align: left`,
`font-size: 14px`, `flex-direction: row`, `white-space: normal`...) to cycle it, the browser reflows the
page, and the terrain under the readers changes instantly. Edits happen live, during the run: grow a font
under a walker and the text lifts it like an elevator; switch a paragraph to `nowrap` and its one long line
becomes a bridge over the void. Get the required number of readers to the link within an edit budget.

## Why would someone who has seen a hundred web games find this interesting?
The terrain is not drawn: it is whatever the browser's real layout engine produces for the current
stylesheet (read back with `Range.getClientRects()`), so every CSS property you half-know becomes a physical
verb, and the game ships its own pixel font generated as a TrueType file in JavaScript at startup so that
line breaks, and therefore the puzzles, come out identical on every device.

## Candidate ideas considered (2026-11-08)
Research: Show HN this week (Coldframe fridge-controller honeypot, Backwords reverse speech, Uncracked City
LLM detective), itch.io jams (Game Off 2026 theme "SHIFT", Spooky Jam "Lost Footage"), Chrome 157 notes,
the "Lemmings CSS Animation" toy (walkers on page elements, no puzzle) that prompted the backlog entry.

| idea | novelty | wow | feasibility | note |
|------|---------|-----|-------------|------|
| reflow - CSS-property Lemmings on a real laid-out page | 5 | 4 | 3 | picked: new technique cluster (DOM layout as physics), playful, not another forensics sim |
| cold-chain - supermarket refrigeration SCADA night shift vs forced-defrost attacks (Coldframe, Nov 2026) | 3 | 3 | 4 | security streak; backlog |
| lost-footage - repair a corrupted found-footage clip by fixing I/P-frame chains (datamosh) | 3 | 4 | 3 | forensics again; backlog |
| spectrogram-smuggler (backlog) - tool | 3 | 4 | 5 | already common online |
| one-light-day (backlog) - Voyager ops at one light-day | 5 | 4 | 3 | hold for ~2026-11-18 when it is topical |
| backwords-radio - say phrases backwards so reversed playback matches | 3 | 2 | 2 | scoring speech is unreliable without models |

Previous days were canvas-rendered expert simulations (sonar, geology, CD-R, geolocation, gearbox); this one is
a DOM/CSS puzzle with a light tone, which is the change of pace the rules ask for.

## Scope (achievable)
- One `index.html` + `game.js` + `font.js` + `levels.js` + `style.css`. No dependencies, no network.
- Pixel font: hand-written 5x7 bitmaps (ASCII 32-126, with descenders) converted at runtime into a minimal
  TrueType font (head, hhea, maxp, OS/2, hmtx, cmap fmt 4, loca, glyf, name, post), loaded with the
  `FontFace` API from an ArrayBuffer. Monospace, no kerning: identical line breaks everywhere. Fallback to
  `monospace` with a visible notice if the font is rejected.
- Page: fixed design size (360 x 540 CSS px) scaled to fit; canvas overlay draws readers, hatch, exit glow,
  particles. Terrain rebuilt from the DOM after every edit (text fragments via Range.getClientRects, boxes
  with class `solid` via getBoundingClientRect).
- Reader physics (fixed 60 Hz step, design px): walk 0.5 px/step, step up <= 3 px, walls turn them around,
  fall with gravity, splat if the fall exceeds a safe height, exit when overlapping the exit link, lost off the
  page bottom. After a relayout a reader embedded in a solid is pushed up onto its top (the elevator).
- Styles pane: per-level rules with tappable values that cycle through 2-4 options; each tap costs one edit
  from the budget; changed values highlighted; reset/restart.
- 7-8 handcrafted levels, each introducing a property: text-align, font-size (elevator), line-height (fall
  height/walls), letter-spacing (bridge length), white-space nowrap (overflow bridge), flex-direction (bridge vs
  tower), display none (remove a wall), writing-mode (pillar vs ledge), then a combination finale.
- Loop: title/intro -> level select (stars in localStorage) -> level (play/pause, 2x speed, restart) -> result
  (saved/needed, edits vs par, stars) -> next; finale "page shipped" screen.
- Juice: reflow flash on the edited element, ink-splat particles, save sparkle, walker walk cycle,
  WebAudio blips (spawn, reflow whoosh, save chime, splat), mute toggle, reduced-motion respected.

## Tech
Vanilla JS, DOM layout + Range API, Canvas 2D overlay, FontFace API with a generated TTF, WebAudio, localStorage.

## Definition of done
- Font loads in Edge (measured advance equals expected); all levels solvable with their reference solution and
  NOT solved with zero edits, verified by an in-page self-test (`?selftest`) run in headless Edge.
- Title, how-to, level select, results, finale, restart; no console errors; mute; touch + mouse + keyboard
  (space = pause, R = restart, F = fast).
- Mobile portrait layout (page above, Styles pane below), safe areas, 60 fps-ish.
- README, screenshot of real gameplay (`?demo`), index row, IDEAS update, Pages live.

## Test plan
- `?selftest`: font metrics check; per level run the sim headlessly (synchronous loop with real layout reads)
  with no edits (expect fail) and with the reference timed-edit script (expect >= needed saved); print a
  table into the DOM; read it with `--dump-dom`.
- Physics unit checks inside self-test: a reader on a flat floor walks, turns at a wall, splats from height,
  is ejected upward when a box grows under it.
- Headless Edge screenshots at 1280x720 and 390x844 (`?demo`), console log check via `--enable-logging`.
