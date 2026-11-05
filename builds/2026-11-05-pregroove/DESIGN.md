# Pregroove: design

Build #6, 2026-11-05. Type: game (disc forensics / CTF puzzle). Slug: `pregroove`.

## Concept
2031. The networks are filtered, so couriers carry "blank" CD-Rs. The message is not in the data; it is in the
picture the data draws. Every audio frame burned onto a CD-R darkens or leaves clear a tiny stretch of the spiral
track, and if you choose the samples right, the dye layer shows a picture to the naked eye (this is real: CDImage,
2022, and DiscImageStudio, on Hacker News this week). But the picture only appears on the exact disc model it was
computed for, because it depends on the disc's geometry: where the spiral starts, the track pitch (about 1.6 um)
and the linear velocity (about 1.2-1.4 m/s).

You do not have the disc. You have the rip: raw frames from the courier's drive. Your job is to rebuild the
geometry in software until the picture snaps out of the noise, then read the flag on it and type it in. This is
exactly the BSidesSF CTF challenge its author described in the HN thread ("invert the process in software and
simulate what a burned disk would look like ... adjust disk parameters rapidly until they had a readable image"),
turned into a five-disc campaign.

## Why would someone who has seen a hundred web games find this interesting?
It is a real piece of forgotten physics turned into a tuning puzzle: the decoder actually walks a 20,000-turn
Archimedean spiral for every pixel, so an error of one part in a million in the velocity visibly twists the
picture, the parameters couple the way they do on a real disc (radius depends on pitch x velocity, angle on pitch
alone), and the moment the swirl untwists into a readable message is a genuine "it clicked" reveal. You can also
measure the geometry like a real solver, with an autocorrelation scope that finds one revolution in the raw stream,
and listen to what a picture sounds like when it is played as audio.

## Candidates considered (novelty / wow / feasibility, 1-5)
- pregroove (this): CD-surface image forensics, spiral geometry calibration, flag entry. 5/5/4. Timely (HN this
  week), security/CTF framing for Phennova, new technique cluster (spiral inverse mapping, stream autocorrelation,
  sonification of data).
- memory-scan: Cheat-Engine-style value scanning against a running toy DOS game (find health, freeze it, follow a
  pointer chain), inspired by "a decade of reversing to get co-op in DOS Wing Commander" (Show HN, 2026-11-04).
  4/3/4. Backlog.
- hubble-reboost: plan a reboost rendezvous for a decaying Hubble before re-entry (ScienceDaily 2026-11-04).
  3/3/3. Close to reentry-footprint in backlog; merged there.
- altermagnet: spin-split band toy for the third kind of magnetism (SLAC, Science, 2026-11-04). 3/2/3. Dropped.
- ghost-process: "Ghost in the Machine" (AI Game Jam theme, Oct-Nov 2026): find a hidden process in a simulated
  task manager via side channels (CPU time, handles, timing). 3/3/4. Backlog.
- one-light-day (backlog 5/4/3): still better shipped near 2026-11-18.
Yesterday was procedural geology; two days ago passive sonar DSP. Pregroove has per-pixel inverse mapping like
road-cut, but the concept, genre and core technique (spiral geometry, calibration) are new.

## The physics model (honest, simplified where noted)
- Constant linear velocity, constant pitch spiral. Distance along the track s, start radius r0, pitch p:
  r(s) = sqrt(r0^2 + p*s/pi), turn angle theta(s) = 2*pi*(r(s) - r0)/p (+ phi0, the angular position of the
  start). One CD-DA frame (24 bytes, 6 stereo samples, 588 channel bits) is v/7350 m long, so frame n sits at
  s = (n - n0) * v / 7350.
- The stream is one value per frame: dark or clear. In the real tools each frame's bytes are chosen so that, after
  EFM, the burned marks average dark or light (DiscImageStudio uses 0x0D / 0xAA patterns), and CIRC interleaving
  has to be pre-compensated. We model at the frame level and say so in the README; we do not generate burnable WAVs.
- The stream is generated from a hidden 2D picture (flag text, emblem, calibration spokes) using the TRUE geometry,
  binarised with an ordered dither in disc space, plus burn noise on later discs. It is evaluated lazily
  (stream(n) is a pure function), which is equivalent to storing ~32 M frames.
- Decoding: for each screen pixel (r, phi), with the GUESSED geometry, find the nearest turn of the spiral through
  that point, its s, its frame n, and show stream(n). Correct geometry = the picture; errors = a smooth warp:
  phi0 rotates; r0 and n0 shift; p and v twist with different radial profiles. Coupling is real: r(n) depends on
  p*v, angle on p.
- Sensitivity (computed): at the outer edge an error of 1e-5 in v twists the picture by ~0.9 rad. Hence the jog
  controls with decade step sizes, like a real calibration tool.

## Scope (achievable and finishable)
Core (`disc.js`, pure, runs in node):
- geometry forward (n -> r, theta) and inverse (r, phi -> n), seeded RNG, hidden-picture rasteriser
  (supplied as a sampler so node tests can use a synthetic picture), dither, noise, stream(n),
  autocorrelation lag finder with parabolic refinement, two-point geometry estimate from two lag readings,
  flag generator (NATO-ish codewords + digits), challenge-link encode/decode.
Game (`game.js`, `index.html`, `style.css`):
- Title screen with a rendered iridescent CD (procedural diffraction rainbow sheen that follows pointer / tilt).
- Bench: decoded disc view (square canvas, inverse mapped, 1x while dragging, 2x2 supersampled at rest), parameter
  rows (value with full precision, jog strip drag, -/+ buttons, step size selector 1e-2 .. 1e-7 relative), a twist
  hint readout only on the tutorial disc.
- Lag scope: pick a position on the stream (a radius slider), compute autocorrelation, show the curve and the
  peak lag (frames per revolution); two readings -> "estimate" button sets v and p roughly (to ~1e-4), the final
  untwist is by eye.
- Listen: play ~2 s of the stream around the scope position as PCM through WebAudio (dark/clear frames as the two
  sample patterns), so you hear the rotation rate as a flutter. Mute toggle; UI sounds (tick on jog, chime on solve,
  buzz on wrong flag).
- Flag entry; wrong flag = gentle buzz, right flag = reveal: the physical disc rendered with the picture in the dye
  under the rainbow sheen, time and residual error shown, next disc.
- Campaign (5 discs, each adds one unknown):
  1. "Factory spec": only v is off (coarse). Inner calibration spokes bow; straighten them. Tutorial hints.
  2. "Off-brand": v off by more, needs vernier steps; no hints.
  3. "Second source": p and v unknown (coupled).
  4. "Late start": the burn began after an unknown pregap (n0) and the start radius r0 is unknown; use the scope.
  5. "Worn CD-RW": all of v, p, r0, phi0 unknown, burn noise, no calibration spokes. Small flag.
  End screen with totals; restart. Random geometry and flag each run.
- Make a dead drop: type a short message -> challenge link (#d=...) with random geometry; the receiver gets a
  custom disc. Copy-to-clipboard.
- Mobile-first layout (disc on top, controls below, big touch targets), keyboard: arrow keys jog the selected
  parameter, [ ] step size, Enter submits. prefers-reduced-motion disables the sheen animation and reveal spin.

## Changes made during the build (2026-11-05)
- r0 dropped as a tunable: from the stream alone the start radius is degenerate with v and p (a fitted geometry with
  the wrong r0 just scales the picture), so r0 is fixed at the Red Book 25 mm. In its place: **pitch drift** (linear
  change of pitch with radius), a real calibration term (DiscImageStudio fits a cubic track pitch). n0 was likewise
  degenerate with (r0, phi0) and is gone.
- Campaign: 1 Factory spec (v, small error), 2 Off-brand (v from nominal), 3 Second source (v, p), 4 Zoned pitch
  (v, p, drift), 5 Worn CD-RW (v, p, phi0, 10% flipped frames, no ticks, smaller print).
- Calibration rings instead of spokes: irregular tick rings at hub / mid / rim radii; the bench shows each ring's
  offset (circular cross-correlation of the decoded ring with the known pattern), which is how a calibration
  assistant measures bowing. Flag is arc text at r = 44 mm.
- Scope fit is a damped Gauss-Newton over all readings with outlier rejection (half-turn echoes in symmetric parts
  of the picture); blank stretches of track report "no echo".

## Definition of done
- All 5 discs solvable by tuning in the browser with mouse and with touch emulation; flags are readable at the
  correct geometry and unreadable when an unknown is off by its starting error.
- Lag scope estimates land within the "vernier" range of the truth (tested in node).
- No console errors in headless Edge; self-test page parameter (?selftest) passes; node tests pass.
- README with idea, controls, physics notes and honest limits; screenshot of real gameplay (?demo).
- Under 1.5 MB, zero network requests.

## Test plan
- `tests.js` (node): forward/inverse round trip (n -> r,theta -> n) across the disc; decode with true params
  reproduces the hidden picture exactly (synthetic sampler); twist magnitude for a 1e-5 v error matches the
  analytic estimate; lag finder recovers frames-per-revolution within 0.2 frames at several radii; two-point
  estimate within 1e-4 relative; flag generator deterministic per seed; challenge link round trip.
- Headless Edge: `--dump-dom` with ?selftest and `--enable-logging=stderr` for JS errors; screenshots of title,
  bench (?demo) and mobile size; view them.
- Manual-ish: solve disc 1 and disc 5 via a scripted ?demo=solve that sets the true params, check readability in
  the screenshot.
