# Call the Ball

Fly the last 18 seconds of an F/A-18E Super Hornet carrier landing: the "groove". Keep the amber meatball
centred on the green datum bars, hold the lineup on an angled deck that keeps running away from you, and get
graded by a Landing Signal Officer in authentic LSO shorthand (e.g. `(OK) (LO)X LULIM #3 wire`).

Play: https://phennova.github.io/daily-builds/builds/2026-10-27-call-the-ball/

## How to play
- Power controls your glideslope (ball). More throttle = less sink. Thrust lags, so small, early corrections win.
- The deck is angled and the ship steams away, so the centreline creeps right. Chase it with small bank inputs.
- Land on a wire (3 is the target), or take a bolter / wave-off when told. "Wave off" is an order: full power.
- A cruise is 6 passes: Case I day, crosswind, choppy seas, dusk, Case III night, and a one-try "bingo fuel" pass.
  Passes appear on a greenie board and in a cruise GPA.

## Controls
- Touch: drag anywhere; up/down = power, left/right = lineup. Drag up hard for a wave-off.
- Keyboard: W/S or Up/Down = power, A/D or Left/Right = lineup, Space = full power, P = pause, M = mute.
- Mouse: drag like touch.

## Files
- `sim.js` flight model, LSO calls and grading (pure; runs in Node). `node test.js` runs 31 tests.
- `game.js` canvas renderer, WebAudio (all synthesised), input, UI flow. `index.html`, `style.css`.
- URL options: `?demo` autopilot attract mode (`&level=0-5&t=SECONDS`), `?test` in-page self-test.

## Notes
Simplified flight model (glideslope, sink, lineup, burble), not a study sim. Not tested on a real iPhone;
mobile layout checked with headless Edge device emulation. No dependencies, no network requests.
