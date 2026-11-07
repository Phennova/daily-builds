# Crash Box

Build #8 - a driving-skill game about double-clutching an unsynchronised WWII truck gearbox.

Play: https://phennova.github.io/daily-builds/builds/2026-11-07-crash-box/

You drive a GMC CCKW 2.5-ton truck in the Red Ball Express convoy (Normandy, 1944). Its Warner 5-speed has no
synchromesh: a gear only goes in when the gearbox input shaft already spins at the speed that gear needs. So you
double-clutch: clutch in, neutral, clutch out, let the revs fall (or blip the throttle) until the input-shaft needle
meets the gear tick, clutch in, select the gear, clutch out. Miss and the teeth grind.

Everything is simulated (engine torque and flywheel, slipping clutch, free-spinning input shaft, dog engagement,
vehicle mass, grade, brake fade). Double-clutching, grinding a gear in, and clutchless "float" shifting emerge from
the physics. The straight-six sound is synthesised from the firing-pulse cycle, so you can hear revs line up.

## Runs
1. Motor Pool - guided tutorial with a coach
2. Route N12 - hold 60 yd behind the convoy, 25 mph max
3. The Long Grade - steep climb, then a descent where the brakes fade
4. Blackout Run - the dash goes dark; shift by ear
5. Snapped Linkage - the clutch fails mid-run; float the gears

## Controls
Keyboard: Shift = clutch, W/Up = gas, S/Down = brake, hold 1-5 or N = lever, E = start, P/Esc = pause, M = mute.
Touch: on-screen pedals, drag the knob in the H-gate. Headphones help.

## Dev
- `node tests/sim.test.cjs` - 47 drivetrain/mission checks (needs node).
- `?demo=N&t=secs` autopilot run N, `?selftest` autopilot passes all 5 runs, `?playtest=N` drives the real UI and
  input path with the bot, `?layout` reports element rects.

Not tested on real iOS Safari or with real audio output (only headless Edge, no sound card).
