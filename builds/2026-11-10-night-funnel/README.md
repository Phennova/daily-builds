# Night Funnel

Shoot down one-way attack drones at night with a 20 mm cannon and the gunsight real fighter pilots use.

In November 2026 the commander of Ukraine's 107th Aviation Wing said its F-16 pilots had shot down about 4,700 drones, mostly with the gun, and one pilot got nine in a single sortie. Night Funnel puts you in that seat over a fictional city. The gun is cheap, but a piston drone flies slower than you can safely fly, and a warhead that goes off within 150 m hurts.

**Play:** https://phennova.github.io/daily-builds/builds/2026-11-10-night-funnel/

## The idea: an honest gun funnel
The curved green pair of lines on the HUD is not a drawing. Every frame the game looks at your own flight history for the last 1.5 seconds and asks "where would a round fired at each past instant be right now?" The funnel is those points. Its width at each point is a 2.5 m wingspan at that range, so when the drone's wingtips touch both walls you have the correct range and lead at once. It bends when you turn because older bullets were fired along your old nose. With a lock, a small ring on the funnel (BATR, "bullets at target range") marks where those bullets are at the drone's exact distance, which is easier to read on a phone than a 2.5 m wingspan. This is the same trick as the Enhanced Envelope Gun Sight (EEGS) on the F-16 and the F/A-18's funnel mode. A unit test checks that the funnel matches the simulated rounds exactly, in straight flight and in a 6 g turn, and a test autopilot that decides when to shoot only from the funnel wins every night.

## How to play
- Put the drone in the ring on the funnel (wingtips on the walls), then fire in short bursts (100 rounds per second, 510 rounds). IN RANGE means 150-700 m.
- Slow down and use the speed brake: a piston drone flies 185 km/h and you stall near 210.
- Do not shoot inside 150 m (warhead blast), avoid fireballs and debris, and mind the ground.
- Each drone that gets through darkens a district. Meet the kill target before fuel runs out.
- Five nights: Boresight (coached), First Stream, Low and Slow, Jet Drones, The Record (ten drones: 3 to pass, nine is the real-world record to beat).

## Controls
- Touch: drag on the left side to steer (down = pull up), FIRE and BRAKE buttons, slide the bar on the right edge for throttle.
- Keyboard: arrows or WASD steer (down/S = pull up), Space or J fire, Shift/Ctrl (or R/F) throttle, B speed brake, N night vision, M mute, P or Esc pause.
- Neutral stick holds your climb angle even when banked. "Invert pitch" is on the title screen.

## Notes on the model
Point-mass flight model (nose = velocity vector), stall around 55 m/s, 9 g limit, M61A1-style gun (1,030 m/s muzzle, drag, gravity drop, small dispersion; every round is simulated and hit-tested). Approximate, not a study sim. All audio is generated with WebAudio; no assets, no network.

## Files
`index.html`, `style.css`, `sim.js` (pure physics/missions, runs in node), `render.js` (canvas projection + HUD), `audio.js`, `game.js`. Tests: `node tests/sim.test.js`. `?demo&night=N&ff=SECONDS` runs the autopilot from a fast-forwarded moment (used for the screenshot); `?night=N` jumps to a night; `?touch` forces the touch controls on a desktop.

Not tested on a real iPhone yet: the touch layout was checked in headless Edge at 390x844 and 844x390, not on a device, and the audio has not been heard on a phone.
