# Crash Box - design

Build #8, 2026-11-07. Game (driving skill, drivetrain simulation, procedural engine audio).

## Concept
August-November 1944, the Red Ball Express: a one-way loop of 6,000 GMC CCKW "Jimmy" 2.5-ton trucks hauling fuel and
ammunition from Normandy to the front, driven mostly by young African American soldiers who had often never driven a
truck before the war. Convoy rules: 25 mph, 60-yard intervals, keep 'em rolling.

The CCKW's Warner T93 5-speed is a "crash box": no synchromesh. A gear only goes in when the two halves of the dog
clutch are already turning at the same speed. Drivers learned to **double-clutch**: clutch in, lever to neutral, clutch
out, let the revs fall (upshift) or blip the throttle (downshift) until the gearbox input shaft spins at exactly the
speed the next gear needs at this road speed, clutch in, slide the lever home, clutch out. Get it wrong and the teeth
clash: a grinding shriek, a lever kicked back into your hand, a chewed gearbox.

You drive one truck in a Red Ball convoy through five runs. The whole drivetrain is simulated (engine torque curve and
flywheel, slipping dry clutch, free-spinning input shaft, dog engagement, vehicle mass, grade, rolling and air drag), and
the engine sound is synthesised from the firing pulses of a straight six, so you can literally hear the revs line up.

Hook: GitHub Game Off 2026 theme is SHIFT (Nov 2026). On a keyboard the clutch pedal is the Shift key.

## Why would someone who has seen a hundred web games find this interesting?
It turns a real, dying physical skill into the whole game: a crash-box gearbox simulated honestly enough that
double-clutching, rev-matching by ear, grinding it in, and even clutchless "float" shifting all *emerge* from the
physics rather than being scripted, and the procedurally synthesised straight-six makes matching revs something you
can hear - which the night blackout run then makes you rely on.

## Core loop and mechanics
- Side-on scene of the road profile with your truck, the truck ahead, Red Ball route markers, Normandy hedgerows.
- Dashboard: tachometer with an **engine needle**, an **input-shaft needle** (separates from the engine when the
  clutch is in) and **gear ticks 1-5**: the rpm each gear needs at the current road speed. A tick lights green when
  the input shaft is within mesh tolerance. Speedometer (mph), interval-to-truck-ahead (yards), gearbox health.
- Gear engagement: pushing the lever toward gear g compares input shaft speed with output speed x ratio(g).
  Within tolerance: it slides in with a clunk. Outside: grind (noise, shake, damage proportional to the speed
  difference). Holding the lever against the teeth slowly friction-matches a free input shaft (clutch in) - "grinding
  it in" works but costs health. With the clutch engaged the engine fights the teeth and it barely moves.
- Leaving a gear needs the dogs unloaded: clutch in, or (float shift) throttle eased to near-zero driveline torque.
- Stall if the engine falls below ~280 rpm with the clutch engaged in gear; restart in neutral or with clutch in.
- Mission scoring: time vs. schedule, grinds, gearbox damage, interval discipline (30-120 yd band), speeding over
  25 mph (MPs), stalls. Result log with a grade per run, best grades saved in localStorage.

## Runs
1. Motor Pool, Saint-Lo (tutorial, flat, ~600 m): coached first upshifts 1-2-3 with generous tolerance.
2. Route N12 (rolling, ~2.2 km): upshift to 4th, hold the interval, one downshift for a rise.
3. The Long Grade (~2.4 km): steep climb needing 4-3-2 downshifts, then a descent where you must downshift for
   engine braking (brakes heat up and fade if you ride them).
4. Blackout Run (night, ~2.4 km): the dash is unlit except cat's-eye lights; shift by ear.
5. Snapped Linkage (~2.4 km): the clutch linkage breaks after the start; finish by float shifting (no clutch).

## Tech
- Static folder, zero dependencies: `index.html`, `style.css`, `sim.js` (pure drivetrain + vehicle physics, no DOM),
  `audio.js` (WebAudio: engine PeriodicWave computed by DFT of a synthesised 720-degree firing-pulse cycle, load
  crossfade, intake noise, straight-cut gear whine, grind, clunk, road rumble), `game.js` (missions, rendering, input,
  UI). Canvas 2D, fixed 120 Hz physics step.
- Approximate truck data: GMC 270 inline-6, ~104 hp at 2,750 rpm (governed), 293 N.m at 1,400 rpm; T93 ratios about
  6.06 / 3.50 / 1.80 / 1.00 / 0.80; axle ~6.6; loaded mass ~7 t; tyre radius ~0.5 m. Labelled as approximate.
- Controls. Keyboard: Shift = clutch (hold), W/Up = throttle, S/Down = brake, 1-5 = push lever to a gear (hold while
  it grinds), N or 0 = neutral, E = restart a stalled engine, M = mute, P/Esc = pause.
  Touch/mouse: CLUTCH and BRAKE pedals left, GAS pedal right (pressure by vertical position), draggable H-gate knob;
  multi-touch so clutch + gas work together.
- `?demo` autopilot (perfect double-clutcher) for screenshots; `?selftest` in-page tests; node test of `sim.js`.

## Definition of done
- Title, short how-to, run select, 5 runs that each start, can be finished and end with a graded log; restart/next.
- Upshift and downshift by double-clutching work as described; float shifting works; grinding and stalls work.
- Engine audio responds smoothly to rpm/load; mute works; no audio before a user gesture.
- Works on touch (portrait and landscape) and keyboard; respects prefers-reduced-motion (no screen shake).
- No console errors; screenshot shows real gameplay; README with controls and the history.

## Test plan
- `node tests/sim.test.mjs`: engine free-rev and decay rates, clutch lock/slip, mesh accepted within tolerance and
  rejected outside, double-clutch upshift/downshift sequences succeed, single-clutch quick upshift grinds, float
  shift out only at low torque, stall condition, top speed per gear sane, a bot completes every run's terrain.
- `?selftest` in page; headless Edge load with logging for JS errors; `?demo` screenshot viewed.
