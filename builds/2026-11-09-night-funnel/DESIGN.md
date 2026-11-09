# Night Funnel - design

Build #10, 2026-11-09. Game (air-to-air gunnery, flight physics, night air defence).

## Concept
At the International Fighter Conference in Munich (early Nov 2026) the commander of Ukraine's F-16 unit said his
pilots have shot down about 4,700 one-way attack drones, 1,100 in October alone, mostly with the **20 mm gun**:
missiles are saved for cruise missiles. The record is 9 drones in one sortie, landing with 80 of 400 rounds left.
The gun is cheap, but it is dangerous: a slow piston drone is half the speed of the fighter's comfortable minimum,
so you overtake it in seconds, you risk stalling low over the ground, and if you kill it too close its 50 kg warhead
goes off in your face. (Source: defence24.com, 8 Nov 2026, reporting Gareth Jennings.)

You fly the night shift over a city whose lights are its power grid. The drones come in streams; every one that
gets through knocks a district dark. You have a gun, 400 rounds, a fuel clock, and the real gunsight fighters use:
the **EEGS funnel**.

## The wow: an honest gun funnel
The funnel is not a decoration. Each frame the sim takes the history of your own aircraft (position, velocity,
nose direction) over the last second, asks "where would a round fired at each past instant be *right now*", and draws
those points on the HUD; the funnel's width at each point is how wide a 2.5 m wingspan looks at that round's range.
So when you pull, the funnel bends because the older bullets were fired along your old nose; when you fire, the real
tracers fly down the funnel you just watched form. Put the drone's wingtips on the funnel walls and the range and the
lead are right at the same time - the same technique as the real Enhanced Envelope Gun Sight (F-16, and the F/A-18
funnel mode). A unit test checks that the funnel matches the simulated rounds to the millimetre.

## Why would someone who has seen a hundred web games find this interesting?
It is a shooter where the crosshair is a live physics computation from your own past flight path, so the skill is
real air-to-air gunnery (match the target's plane, lead it, let it fly through the stream), and the hard part is the
one real pilots describe: overtake, stall speed, ground, and warhead blast radius against a target too slow to shoot.

## Core loop
- First-person cockpit view at night: stars, horizon glow, the city's districts as thousands of lights below, the
  drones as dark delta wings with a dim exhaust glow. NVG toggle (green phosphor, grain, bloom) - on by default.
- HUD (green): gun cross, funnel, flight path, speed (kt), altitude (ft), G, throttle/speedbrake, rounds, target
  designator box on the locked drone with range and closure, IN RANGE cue (150-600 m), target locator line when
  off-screen, STALL / PULL UP / BINGO warnings, a small top-down map inset.
- Kill a drone: 2-4 hits (20 mm HEI). Its warhead may detonate: within ~150 m that damages you (shake, cracked
  canopy, damage %), and you can fly into the debris. Uncontrolled ones fall burning.
- A drone reaching its aim point hits a substation: explosion, the district's lights die out.
- Night ends when all drones are down or through, or at BINGO fuel, or if you are shot down by debris / hit the
  ground. Result screen: kills, rounds used, districts kept lit, damage, grade; best saved in localStorage.

## Nights (5)
1. Boresight (dusk, coached): one slow drone straight and level; learn the gun cross, funnel, wingspan, range.
2. First Stream: three piston drones in trail at ~600 m on a route with turns; NVG.
3. Low and Slow: three drones at ~120 m; overtake, speedbrake/S-turns, stall and ground danger, blast radius.
4. Jet Drones: three jet-powered drones at ~140 m/s that weave and change altitude; tail chase.
5. The Record: a ten-drone raid with 400 rounds and a fuel clock. Beat 9.

## Physics (honest but simplified; documented as approximate)
- Point-mass flight model, nose = velocity vector (no AoA): roll-rate and G commands, lift = n g along the lift
  vector, gravity, thrust (idle..max with a small afterburner zone), drag = parasite + induced (n^2 / V^2) +
  speedbrake. Available G = min(9, 9 (V / V_corner)^2), V_corner ~175 m/s, so 1 g stall ~58 m/s and below that the
  jet sinks. Ground contact = crash.
- M61A1-style gun: 100 rounds/s, 1,030 m/s muzzle velocity plus aircraft velocity, quadratic drag along the line
  (closed form s(t) = ln(1 + k v0 t) / k), gravity drop 1/2 g t^2, small dispersion. Every round is simulated and
  hit-tested (segment vs ellipsoid). The funnel uses the same closed form, so they agree.
- Piston drone: 51 m/s (185 km/h), 2.5 m span, 3.5 m long. Jet drone: ~140 m/s. Waypoint routes to aim points.

## Controls
- Touch: drag anywhere on the left part = virtual stick (pull down = pull back, optional invert), FIRE button
  (hold) and throttle slider on the right, speedbrake button. Multi-touch.
- Keyboard: arrows / WASD = stick, Space or J = fire, Shift / Ctrl (or R / F) = throttle up / down,
  B = speedbrake, N = NVG, M = mute, P / Esc = pause. Mouse drag on the left = stick.

## Audio (WebAudio, all generated)
Jet engine rumble/whine tracking throttle, wind vs speed, the M61's 100 Hz buzz-saw burst, drone moped buzz with
range-based level and Doppler from closure, explosions, IN RANGE tone, stall horn, PULL UP beeps. Mute button.

## Tech
Static folder, zero dependencies: `index.html`, `style.css`, `sim.js` (pure physics, ballistics, funnel, drones,
missions; no DOM; usable from node), `render.js` (canvas 2D perspective projection, NVG post effect, HUD),
`audio.js`, `game.js` (screens, input, loop). Fixed 120 Hz sim step. `?demo` = autopilot flies an intercept and
shoots (for the screenshot); `?night=N` jumps to a night.

## Definition of done
Title + how-to + night select; all 5 nights playable and winnable on touch and keyboard; honest funnel (tested);
win/lose/result screens with restart; mute, NVG toggle, reduced motion respected (no shake, fewer particles);
no console errors; README, screenshot of real gameplay, index row, IDEAS entry; Pages live.

## Test plan
- `node tests/sim.test.js`: closed-form ballistics vs numeric integration; funnel point == simulated round position
  after tau seconds (straight and in a 6 g turn); stall behaviour (1 g available at ~58 m/s); a drone follows its
  route and reaches its aim point; autopilot bot wins nights 1 and 2 in a headless run (proves winnability).
- Headless Edge load with `--enable-logging` for console errors; screenshot `?demo` mid-engagement and view it.
- Manual: mobile layout at 390x844 and landscape 844x390 screenshots.
