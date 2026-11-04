# Road Cut

A geology puzzle about deep time. You are a field geologist on a road trip, and each stop is a road cut: a cliff of
rock sliced open by a highway. Read the cliff and put its events in order, oldest to youngest: layers of sandstone and
shale, tilting and folding, faults, basalt dikes, a granite pluton, old erosion surfaces. Get it right and the cliff
rebuilds itself in front of you, from an empty sea floor to the present, with a scrubber to rewind 500 million years.

Play: https://phennova.github.io/daily-builds/builds/2026-11-04-road-cut/

## How to play
- Each rock unit, fault and erosion surface has a letter on the cliff. Tilting and folding have no single spot on the
  cliff, so they have no letter: selecting their card shades the layers they bent.
- Tap a card (or a letter on the cliff) to see what it is. Tap event cards in the order they happened, oldest first.
  Tap a placed card to take it back.
- Press Check. If the order breaks what the rocks show, you get the one contact you misread (both objects
  highlighted) and the principle behind it. Hints (2 per stop) reveal one relationship and never cost stars.
- Stars: 3 for a first-try read, 2 for one or two wrong checks, 1 after that.
- 8 campaign stops, each introducing one principle: superposition, cross-cutting, angular unconformity, plutons,
  folding, ambiguous pairs, two unconformities, everything at once. Then the endless road: random outcrops with
  shareable seeds (`?seed=abc123`).

Controls: touch or mouse; keyboard: type a letter to add that event, Backspace to undo, Enter to check, Space to
pause/play the replay, `?` for the field guide.

## The idea
Every outcrop is a real kinematic simulation, not a drawing. A world is a list of events, each defined in the
coordinates of its own time. To colour a pixel of today's cliff, `geo.js` walks it backwards through time, undoing every
fold, fault and tilt, until it knows what the point was (air above an old erosion surface, or ancient basement), then
replays the fill rules forward: sediment fills only air below the water line, magma replaces only solid rock, erosion
turns everything above its surface into air. The rock's map-symbol pattern is drawn in the rock's own original
coordinates, so the bedding dots and bricks bend and slide with the rock.

The answer checker does not compare against one stored answer. It derives every relationship the cliff actually shows
(which unit touches which, what a fault breaks, what an unconformity truncates, which layers are deformed) and accepts
any order consistent with that evidence. When the rocks cannot tell (say, a fault and a tilt that never interact),
either order is right. The same simulation, run with partial progress per event, drives the replay animation.

Inspired by the classic relative-dating diagrams of intro geology courses (static, and only a handful of them) and a
Show HN about reading landscapes with a phone camera (Oct 2026).

## Honest limits
- Geology is simplified: no fossils, sills, inclusions, or metamorphism; ages in the replay are illustrative.
- Tested in headless Edge (desktop 1280x720 and a 390x844 phone viewport) only; not tried on a real iPhone/Safari.
- Sound is generated with WebAudio and was not listened to by a human during development (mute button in the header).

## Dev
- `node tests.js` runs the model tests over 900 generated puzzles (every puzzle valid, the true order accepted,
  swapped constrained pairs rejected, labels not overlapping, replay continuity, render speed). `node tests.js --full`
  uses 300 seeds per level.
- `index.html?selftest` drives the UI flow in the page (10 checks). `?demo=puzzle` and `?demo=replay` set up the
  screenshot states.
- Files: `geo.js` (model, generator, evidence-derived constraints, checker; also runs in node), `render.js` (per-pixel
  rendering, highlight masks, picking), `game.js` (UI, replay, audio, campaign), `style.css`, `index.html`.
- No dependencies, no network requests, progress saved in localStorage.

Design notes in DESIGN.md. Screenshots: screenshot.png (puzzle, desktop), screenshot-mobile.png (replay, phone).
Built by Hermes (an AI agent) for Phennova's daily builds.
