# Call the Ball — design

Daily build #1, 2026-10-27. Game (flight / naval aviation sim-lite).

## Concept
You fly the last ~20 seconds of an F/A-18E Super Hornet carrier approach: "the groove", from about 3/4 nm
behind the ship to the arresting wires. Nothing else: no takeoff, no dogfight. The whole game is the hardest
20 seconds in naval aviation, done with the real cues a pilot uses:

- **The meatball** (IFLOLS Fresnel lens on the left of the deck): an amber light that sits level with the
  green datum bars when you are on the 3.5° glideslope, rides high when you are high, sinks and turns red when
  you are dangerously low.
- **Lineup**: the landing area is angled ~9° off the ship's axis and the ship steams away at ~25 kts, so the
  centreline constantly creeps to the right. You must keep chasing it.
- **Power controls glideslope** (as in the Hornet in the approach): more throttle = less sink. Thrust spools
  up with lag, so over-controlling turns into a porpoise ("OC" in LSO speak).
- **The LSO** talks to you over the radio ("Roger ball", "Power", "Right for lineup", "Easy with it",
  "Wave off, wave off!") and then grades the pass in real LSO shorthand, e.g.
  `(OK) (LO)X  LULIM  (SLO)IC  #3 wire`, translated in plain English on the debrief card.
- Your passes go up on a **greenie board** (green OK, yellow Fair, brown No Grade, blue Bolter, red Wave-off /
  Cut) and a cruise GPA.

A "cruise" is 6 passes of increasing difficulty: calm Case I day → crosswind → choppy seas → dusk → Case III
night with a pitching deck and burble behind the island → the "Bingo fuel" final pass (one try only).

## Why would someone who has seen a hundred web games find this interesting?
It is not a flight game, it is an **instrument-reading game**: every input is judged against the real
carrier-landing grading scheme (glideslope / lineup / sink in phases X, IM, IC, AR, IW, wires 1-4, bolter,
wave-off, cut), and the feedback comes in the authentic shorthand a real LSO would write, which you learn to
read pass by pass. The lineup creep from the angled deck is a mechanic most people have never heard of and it
is real physics.

## Scope (achievable, finishable)
In:
- Canvas 2D custom 3D projection (pilot's eye): sky gradient/stars, ocean with horizon + swell shading,
  carrier silhouette (hull, angled deck with edge lights and centreline, island, 4 wires, drop lights),
  wake, IFLOLS with datum bars + 12-cell ball, wave-off lights.
- Minimal HUD: velocity vector, AOA E-bracket (fixed on-speed), altitude, VSI, distance, plus an
  optional "lens repeater" inset (magnified ball) because the lens is tiny on a phone screen.
- Flight model `sim.js` (pure functions, testable in Node): glideslope geometry, ship motion, throttle lag,
  sink, lineup drift, wind / burble, hook touchdown → wire selection, ramp strike, bolter, wave-off.
- LSO module: live calls (rate-limited, priority based) and the post-pass grade + shorthand comments.
- Controls: one-thumb touch "stick" anywhere (vertical = power, horizontal = lineup/bank), keyboard
  (W/S or ↑/↓ power, A/D or ←/→ lineup), mouse drag. Hold full power for wave-off/bolter.
- WebAudio: engine (noise + oscillators following throttle), wind, radio squelch clicks, trap thump,
  bolter roar. Optional speechSynthesis for LSO voice (subtitles always shown). Mute button.
- Title screen, how-to card (illustrated meatball states), 6-pass cruise, debrief card per pass,
  greenie board, final cruise summary (GPA, "Top Hook" etc.), restart, localStorage best GPA.
- `?demo` autopilot mode for screenshots/attract mode. `prefers-reduced-motion` = no camera shake.

Out (explicitly): takeoff/pattern/Case III marshal, real flight dynamics in all axes, 3D models, multiplayer.

## Tech
Single static folder: `index.html`, `style.css`, `sim.js` (flight + grading, UMD so Node can require it),
`game.js` (render, input, audio, UI). No dependencies, no network.

## Definition of done
- Loads on desktop and iPhone-size viewport, no console errors, title → play → debrief → board → summary →
  restart all work.
- The ball visibly behaves correctly (high/low/red), lineup creep is noticeable, LSO calls are sensible.
- All four wires, bolter, wave-off, cut/ramp strike are reachable and graded correctly.
- Autopilot demo traps a 3-wire OK in calm conditions (proves the model is flyable).
- README, screenshot of real gameplay, unit tests pass (`node test.js`).

## Test plan
- `node test.js`: glideslope geometry, ball cell mapping, wire selection from touchdown points, grading of
  synthetic passes (perfect → OK, high-all-the-way → Fair/No Grade, low at ramp → cut/ramp strike,
  long → bolter), LSO shorthand formatting, autopilot traps in calm + night conditions.
- Headless Edge `--dump-dom` + `--enable-logging=stderr` for JS errors; `?test` in-page self-test.
- Screenshots at 1280x720 and 390x844 (phone) via headless Edge in `?demo` mode; inspect them.
