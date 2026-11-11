# Bare Earth - design

Build #12 (driver counter #11), 2026-11-11. Game (lidar archaeology, terrain processing, procedural simulation).

## Concept
You are the analyst on an airborne lidar survey over the Maya lowlands. Each "strip" is a procedurally generated
800 m x 800 m tile of jungle: under the canopy hide a ceremonial centre (pyramid, plaza, platforms), house mounds,
a raised causeway (sacbe) and a reservoir, mixed with things that are NOT archaeology: karst cone hills, sinkholes,
a modern logging track, tree-throw mounds and ground-filter artefacts.

You do not get a picture. You get raw multi-return pulses, and the real pipeline:

1. **Ground filter** (morphological, SMRF-style): per-cell lowest return, then a grey-scale opening with a window
   size and a slope tolerance. Too small a window and patches where no pulse reached the ground stay in as fake
   mounds made of understory returns. Too big a window with a tight slope and the filter shaves the top off the
   very pyramid you are looking for (a real, documented failure mode).
2. **Visualise** the bare-earth model: single hillshade with a draggable sun (azimuth + altitude), multi-directional
   hillshade, slope, Simple Local Relief Model (trend radius), Sky-View Factor, height colour, and the canopy
   surface / "satellite" view for contrast. Single-azimuth hillshade really does hide linear features that run
   parallel to the light, so the causeway can vanish.
3. **Verify** with a profile slice: drag a line across the map and see the raw points along it (green = vegetation,
   brown = classified ground), like the point-cloud slices archaeologists use to prove a shape is on the ground.
4. **Report**: tag features with pins (Pyramid / Platform / Mound / Causeway / Reservoir). Submit to the
   (fictional) heritage institute. The debrief reveals the ground truth, peels the forest off with a slider, and
   explains every miss and false positive ("karst cone: no corners", "understory artefact: these 'ground' points
   are 3 m up").

Why would someone who has seen a hundred web games find this interesting? Because it is the actual archaeologist's
pipeline run live in your browser - simulated laser pulses through a canopy, a ground filter that can delete the
pyramid you are hunting, a sun that makes a causeway disappear when it points along it - and the jungle only comes
off when your processing is right. (Topical: today's #1 on HN is someone finding an unmapped Maya site in NASA
G-LiHT lidar.)

## Scope (finishable)
- Five strips, hand-tuned seeds + parameters, each teaching one idea:
  1. **Clearing** - thin canopy, flat ground. Learn: drag the sun, drop pins, submit. Plaza group.
  2. **High forest** - dense canopy, few ground returns. Default filter leaves understory "mounds". Learn: tune the
     filter, verify with the profile slice.
  3. **Karst** - cone hills and sinkholes everywhere, structures on hilltops. Learn: SLRM removes the big hills;
     straight edges and corners are the tell.
  4. **Sacbe** - a long causeway set parallel to the default sun, and a sunken, curving logging track as a decoy.
     Learn: azimuth bias, multi-directional hillshade / SVF.
  5. **Cliff edge** - hilltop centre on an escarpment (levelled plaza, oval pyramid, raised courtyard,
     flat-bottomed reservoir); an aggressive filter beheads the pyramid. Everything at once.
- Plus "Random survey" from a seed after strip 1 (endless replay).
- Pass rule per strip: find at least the quota of real features with at most N false positives. Score = hits
  (type-correct bonus) minus false positives; grade letter. Progress saved in localStorage.

## Tech
- Single static folder, zero dependencies. Files: `index.html`, `style.css`, `sim.js` (terrain, archaeology,
  canopy, pulses, filter, visualisations, scoring - pure functions, node-testable), `game.js` (UI, map, tools,
  screens), `audio.js` (WebAudio: procedural night-jungle ambience - insects as AM noise bands, frog clicks,
  occasional bird; UI ticks; laser "sweep"; reveal chord), `tests/`.
- Grid 400 x 400 cells at 2 m. Seeded PRNG (mulberry32), value-noise fBm for terrain.
- Archaeology as analytic height functions added to terrain (stepped pyramid with rounded/oval option, platforms
  with batter, plaza levelling, causeway raised 0.6-1 m with sloped edges, house mounds, reservoir with berm).
- Canopy: crown blobs (Poisson-ish placed, 12-30 m), understory layer 2-6 m, per-cell gap probability.
- Pulses: ~6 per cell; each gives returns at canopy top / understory / ground with probabilities from cover;
  Gaussian noise. Store per-cell min return + per-cell sample of points for the profile view (Float32Arrays).
- Ground filter: lowest return per cell -> fill empty cells -> opening with square window (separable min/max,
  O(n) van Herk/Gil-Werman or just O(n*w) - fine at 400^2) -> classify cells where z - opened > tol (tol =
  slope * cell distance) as non-ground -> fill holes by iterative neighbour averaging.
- Visualisations computed into Float32Array then mapped to ImageData; SVF with 8 directions, radius 10 cells.
- Map: canvas, pan/zoom with pointer events (pinch on touch), tap = pin, profile tool = drag a line.

## Definition of done
- Title screen with pitch, 5 strips + random survey, tutorial hints on strip 1, clear instructions screen.
- All tools work with touch and mouse; portrait iPhone layout usable; mute; reduced-motion respected.
- Debrief with ground truth, explanations per pin, forest-peel slider, grade, next/retry.
- No console errors in headless Edge; node tests pass; screenshot shows real processed lidar with pins.
- README, screenshot, index + IDEAS updated, Pages live.

## Test plan
- `node tests/sim.test.js`: determinism by seed; pulse stats (dense canopy -> fewer ground returns); filter: with
  sane settings the DTM error vs true ground is small and pyramid height is kept; with a huge window + tight slope
  the pyramid top is removed (assert the failure mode exists); tiny window leaves understory spikes; hillshade of
  a N-S causeway with sun from N has near-zero contrast vs sun from E; scoring matches pins to features.
- Headless Edge `--dump-dom` + logging for JS errors; `?demo` URL for the screenshot (auto-processed strip with pins).
- Manual-ish: play each strip through with an in-page bot check (`?selftest`) that the quota is achievable with
  the intended settings.
