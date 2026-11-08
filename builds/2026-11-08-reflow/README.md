# Reflow

Lemmings on a real web page. The floors are the line boxes your browser just laid out, and your only tools are CSS declarations.

Play: https://phennova.github.io/daily-builds/builds/2026-11-08-reflow/

## How to play
- Tiny readers drop from a chute and walk. They stand on lines of text and boxes, turn at walls, fall off edges.
- A fall over ~96px (four lines) is fatal; leaving the bottom of the page loses them.
- Tap a value in the Styles pane (text-align, letter-spacing, white-space, flex-direction, line-height, ...). The page reflows instantly, even mid-run, and the terrain moves under them. Each change costs an edit.
- Text or boxes that grow into a reader push it up on top (that is how lifts work).
- Save the required number at the EXIT. Stars: pass, edits at par, everyone saved. 7 pages.

Controls: tap/click; Space pause (you can edit while paused), F fast, R restart, I show line boxes, H hint, M mute, Esc levels.

## The idea
Terrain is not drawn: every frame-independent "floor" comes from `Range.getClientRects()` and element boxes measured from the live DOM, so the browser's own text layout is the level geometry. A runtime-generated pixel font (a TTF built in JS, 12px advance) keeps layouts identical across browsers. Progress is saved in localStorage.

## Tests
- `test.html` (self-tests for measurement and solver; `?combos` brute-forces every edit combination per level).
- `index.html?autotest` plays all 7 levels through the real buttons using the reference solutions and checks stars/unlock/persistence; `?autotest=bad` does nothing and expects fail screens.
- `?demo=N&t=steps` shows the reference solution of level N.

Not tested on iOS Safari or with real touch; audio is generated with WebAudio and was not heard by the author.

Credits: all code, font and audio generated in-code. MIT.
