# Earth-Sized Eye: design

Build #2, 2026-10-31. Type: game (science sim / puzzle). Slug: `earth-sized-eye`.

## Concept
You run a night on the Event Horizon Telescope. Each "night" there is a mystery object far too small for any single
dish to see. You pick which real radio observatories to link from a small budget (ALMA, the South Pole Telescope,
Mauna Kea, Pico Veleta, Hanle in Ladakh, Gamsberg in Namibia...), check the weather forecast, then press OBSERVE.
The Earth spins on a dot-matrix globe, every pair of dishes traces an arc across the Fourier (u,v) plane, and the
picture forms live: stripes first, then a blob, then (if you chose well) a black hole's shadow. Afterwards you run
CLEAN (the classic deconvolution algorithm, animated) and have to interpret the blurry result the way the real
scientists did: where is the bright side? how big is the ring? what IS that thing? Score = image fidelity
against the hidden truth + correct interpretation + leftover budget.

Timely: Quanta's "How Do You Take a Picture of a Black Hole?" (Shep Doeleman, 2026-10-29) was on HN this week. Today is
Halloween, so the night-5 mystery target is something spookier than a black hole.

## Why would someone who has seen a hundred web games find this interesting?
It is a real aperture-synthesis imager (Earth-rotation synthesis, 2D FFT, Hogbom CLEAN, real observatory coordinates
and elevation limits) turned into a game: you literally build a planet-sized telescope with a tap and watch a black
hole's shadow condense out of interference stripes, and your choices (which dishes, where, under what weather)
visibly change what you can see.

Existing interferometry demos are slider labs; this has a hidden target, a budget, risk (weather), a reveal and a
science question to answer.

## Scope (finishable)
Five nights (a short campaign), then a final score and replay:
1. **First fringes**: 2 fixed dishes, target = binary "star" (two blobs). Learn that one baseline gives stripes.
   Question: which way is the pair oriented?
2. **Fill the plane**: pick 4 of ~8 sites. Target: ring vs. filled disk. Question: ring or disk?
3. **M87\***: pick up to 6. Ring with Doppler-bright side. Question: where is the bright side (clock position)?
4. **Sgr A\*** (dec -29): southern sites matter; budget tighter. Question: ring diameter (pick from 3 sizes) -> mass.
5. **Something in the dark** (Halloween): full site list + optional orbital dish (sci-fi upgrade, extends baselines
   beyond Earth). Hidden target is a procedural shape (pumpkin face / ghost / ring+jet). Question: what is it?

Per night: budget (credits), each site has a cost, a dish-size sensitivity (noise) and a weather-risk %. Weather
is rolled during the run: a site can cloud out for part of the night (gaps in its arcs).

Out of scope: real calibration/closure phases, polarisation, movies, free placement on land (only listed sites +
one orbit slot), multiplayer, persistence beyond a localStorage best score.

## Tech
- Single static folder: `index.html`, `game.js`, `imaging.js` (pure logic, testable in node), `style.css` optional.
- Imaging: N=128 grid, FOV ~200 microarcsec, observing at 1.3 mm. Station ECEF from lat/lon/alt; per time step
  compute (u,v) per baseline for the source declination and hour angle; keep only times where both stations see the
  source above 15 deg elevation and are not clouded. Grid samples (and Hermitian conjugates) into a mask with
  weights; dirty image = IFFT(mask * FFT(truth)) + per-baseline thermal noise scaled by 1/sqrt(A1*A2).
  Uniform weighting. Hogbom CLEAN with gain 0.1, restored with a Gaussian beam fitted to the dirty-beam main lobe.
- Fidelity = normalized cross-correlation between restored image and truth blurred to a reference resolution.
- Globe: orthographic dot-matrix Earth from a baked low-res land bitmap (built from public-domain Natural Earth data
  at build time; no network at runtime). Drag to spin, tap a site to toggle.
- Canvas 2D for globe, (u,v) plane and image (false-colour "afmhot" palette like EHT images).
- WebAudio: each new (u,v) sample is a soft tick with pitch by baseline length and level by visibility amplitude
  ("hearing the fringes"), a low correlator hum during runs, a reveal chord. Mute button.
- Mobile-first portrait layout (globe top, image + uv panels below), landscape on desktop. `prefers-reduced-motion`
  -> no globe auto-spin animation and instant CLEAN.
- `?demo` URL param: auto-picks sites and fast-forwards a night for screenshots/tests. `?selftest` runs logic checks.

## Definition of done
- Title screen with a 3-line explainer, 5 playable nights, a results screen per night (truth vs your image reveal,
  answer feedback, 1-3 stars) and a final campaign score with restart.
- Works with touch (iPhone portrait) and mouse/keyboard; no console errors; mute works; reduced motion respected.
- Imaging is physically sane: single baseline gives fringes perpendicular to the baseline; more sites improve
  fidelity; Sgr A* tracks differ from M87* tracks (declination); orbital dish gives sharper images.
- README with how to play, controls, the science in plain words, credits; screenshot showing real gameplay.

## Test plan
- `node tests.js`: FFT round-trip and against a direct DFT; Hermitian/real-image check; uv track of an E-W baseline is
  an ellipse with axis ratio sin(dec); elevation check (South Pole always sees Sgr A* at ~29 deg, never M87*);
  CLEAN recovers a point source position; fidelity of full coverage > sparse coverage > single baseline.
- Headless Edge `--dump-dom` + `--enable-logging=stderr` with `?selftest` and `?demo` for JS errors.
- Screenshot via `?demo` at 1280x720 and 390x844 (phone), view both.
- Manual-ish playthrough by scripting the demo through all 5 nights.
