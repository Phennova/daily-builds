# Road Cut — design

Build #5, 2026-11-04. Game (procedural geology puzzle).

## Concept
You are a field geologist on a road trip. Each stop is a road cut: a cliff of rock layers sliced open by a
highway. Every cliff was produced by actually simulating hundreds of millions of years of geology:
sediment settling in horizontal layers, the crust tilting and folding, faults sliding, magma forcing its
way up as dikes and plutons, and erosion planing everything flat before the next sea floods in.

Your job: read the cliff and put its events in order, oldest to youngest, using the same principles
geologists use (superposition, original horizontality, cross-cutting relationships, unconformities).
Get it right and the cliff rebuilds itself in front of you: deep time replays from an empty basin to the
present, and you can scrub the slider back and forth through 500 million years.

Inspiration: Show HN "point your camera at a landscape to learn about its geology" (Oct 29, 2026) and the
classic relative-dating worksheets every intro geology student does on paper, where the diagrams are
static and there are only a handful of them.

## Why would someone who has seen a hundred web games find this interesting?
Every outcrop is a real kinematic simulation, not a drawing: each pixel is traced backwards through time
(through every fold, fault and tilt) to find which rock it is and where its bedding pattern was laid
down, so the textures bend with the rock, every puzzle is a genuinely readable history, the checker
accepts any order the evidence allows (and tells you which contact you misread), and solving it plays the
whole history back as an animation.

## Candidates considered (scored novelty / wow / feasibility, 1-5)
- road-cut (this): procedural kinematic geology + relative dating puzzle + deep-time replay. 4/4/4.
  Prior art: static-image stratigraphy quizzes (e.g. a GitHub "stratigraphy_game" with fixed pictures);
  none generate the geology or replay it. New technique cluster for this repo (procedural generation,
  inverse-mapped per-pixel rendering), and a break from 3 military/security/DSP builds in a row.
- race-window: TOCTOU race-condition exploit game (symlink swap between check and use, widening the
  window with slow path resolution), inspired by the actively exploited WordPress TOCTOU CVE (CISA KEV,
  2026-11-04). 4/3/4. Security again right after greenlist; backlog.
- neuron-carve: hand-place ReLU neurons (each one a draggable half-plane) to carve a decision boundary
  with a neuron budget; levels XOR, ring, spiral. 3/3/5. Backlog.
- slope-armor: tank armour designer: sloped plates, line-of-sight thickness, ricochet angles and a
  weight budget vs incoming shells. 3/4/4. Military two days running; backlog.
- cut-and-rotate (backlog, 4/4/4): Videocrypt descrambling; too close to yesterday's DSP.
- one-light-day (backlog, 5/4/3): better shipped near 2026-11-18 (Voyager 1 one light-day).

## Scope (achievable and finishable)
Geology model (`geo.js`, pure, also runs in node):
- Events, in chronological order, each defined in the coordinates of its own time:
  deposit (level, rock type), tilt (pivot, angle), fold (amplitude, wavelength, phase),
  fault (point, dip, slip; normal or reverse), dike (line, width, wobble), pluton (blob from below),
  erosion (wavy surface height). Start state: crystalline basement below a level, air above.
  The present land surface (final erosion) is implicit and is not a card.
- Per-pixel evaluation by inverse mapping: walk backwards undoing deformations until a state is known
  (air above an erosion surface, or the initial state), then replay forward the fill rules: deposits
  fill only air below their level; intrusions replace only solid rock; erosion turns everything above
  its surface into air. Returns material id + the point's coordinates in the material's own frame
  (so patterns deform with the rock) + fault-trace / unconformity marks.
- Partial events for animation: event k at progress t (tilt angle * t, slip * t, rising level, dike
  growing, erosion surface descending).
- Generator: seeded RNG; packages of 2-5 layers separated by episodes (deformation, faults,
  intrusions) and erosion. Difficulty controls the number of episodes. Validation: every event must
  be visible in the window and actually show its evidence (fault offsets something, erosion truncates
  something, tilt >= 8 degrees, dike crosses at least one boundary), otherwise re-roll.
- Constraint derivation from the rendered evidence: adjacent pairs on the label map (materials and
  marks) give true pairwise orders, each tagged with the principle that explains it; tilt/fold:
  tilted visible units are older, horizontal ones younger. The answer checker accepts any order that
  satisfies all constraints (any linear extension), and on failure reports one violated contact with
  its explanation and highlights both objects.

Game (`render.js`, `game.js`):
- Canvas cross-section with geological map symbols (sandstone dots, shale dashes, limestone bricks,
  conglomerate pebbles, basalt dike, granite crosses, gneiss waves) in an understated earthy palette,
  sky, grass line at the top, a strip of road at the bottom, letter labels at each object's widest point.
- Cards for each event (letter + kind). Tap cards to build the sequence oldest -> youngest; tap a placed
  card to return it. Tap the cliff to identify a unit (highlights it and its card) and vice versa.
- Submit -> wrong: one violated relationship explained and highlighted, mistake counted.
  Right: deep-time replay animation with an age clock (Ma), then a scrubber to explore.
- Campaign: 8 outcrops with increasing complexity, each introducing a principle in one line.
  Stars per outcrop (0 mistakes = 3, 1-2 = 2, more = 1). Hints: 2 per outcrop (reveal one relationship).
  End screen with total stars; then Endless road trip (random seeds, shareable seed in the URL).
- WebAudio, generated: sediment hiss, tectonic rumble, fault crack, magma bubble, erosion wind, solve
  chime. Mute toggle. prefers-reduced-motion: replay steps instead of slides, no shake.
- Title/intro with a 20-second field guide; progress saved in localStorage.

Out of scope: fossils/faunal succession, radiometric dating, inclusions, sills, multiple outcrops to
correlate (all possible later stretch ideas, not today).

## Tech
Static folder, zero dependencies: `index.html`, `style.css`, `geo.js` (model, UMD so node can test it),
`render.js` (canvas drawing), `game.js` (UI, audio, replay), `tests.js` (node). URL params: `?seed=`,
`?demo` (screenshot of a solved replay mid-way), `?selftest` (in-page checks, result in the DOM).

## Definition of done
- Title -> campaign of 8 outcrops -> end screen -> endless mode; all buttons live; no console errors.
- Every generated puzzle is solvable: the true history satisfies every derived constraint; the checker
  accepts the true order and rejects orders that violate an evident contact, with a sensible message.
- Replay animation shows the history building up and the scrubber works.
- Works on a phone in portrait (touch only) and on desktop (mouse; keyboard: 1-9/letters to pick cards,
  Backspace to undo, Enter to submit).
- README, screenshot, tests passing, live on Pages.

## Test plan
- `node tests.js`: RNG determinism; evaluation sanity (stacked deposits read bottom-up; tilt rotates;
  fault displaces by the slip; erosion produces air; dike only in rock); generator over 300 seeds per
  difficulty: valid, each event visible, true order passes the checker, every derived constraint is a
  true order, a random swap of a constrained pair is rejected; performance budget for a full render.
- Headless Edge: `--dump-dom` with `?selftest` (checks pass, no exceptions), screenshots at 1280x720 and
  390x844 with `?demo`, viewed and judged.
