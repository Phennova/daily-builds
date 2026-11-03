# Blade Rate: design

Build #4, 2026-11-03. Type: game (naval sim / signal-processing puzzle). Slug: `blade-rate`.

## Research notes (what is in the air right now, 2026-11-03)
- Show HN this week: "VHS Camera" (simulated analog VHS signal), "Subvocal" (silent speech), "Warsaw in voxels",
  a Linux syscall reference, a portals physics engine, a Vim practice game. Signal simulation in the browser is
  having a moment.
- Security news: AI agents used in ransomware lateral movement (Sophos, GOLD OGRE), Android "SMS of Death" PoC,
  Ivanti chains. (Security was the theme of build #3, so not today.)
- Space: Voyager 1 crosses one light-day from Earth on 2026-11-18 (NASA countdown); Rubin found Neptune L5 Trojans;
  Swift re-enters on Nov 4; ESCAPADE double Earth flyby.
- Defence: Su-57 engine fire at Akhtubinsk, NATO Gripen QRA escort of a Wizz Air A321, Greece buys KC-390s.
- Passive sonar facts checked today (synthetiq UAC course 8.2/8.3, FAS "character of submarine noise", r/submarines
  ex-sonar techs):
  - LOFAR (Low-Frequency Analysis and Recording) = long-averaged spectrogram that shows narrowband machinery *tonals*.
  - DEMON (Detection of Envelope Modulation On Noise) = bandpass the cavitation hiss (1-5 kHz), take the envelope,
    FFT it: peaks at the *shaft rate* and the *blade rate* = blades x shaft rate. Ratio gives the blade count.
  - Speed = shaft RPM / turns-per-knot (TPK) from the intelligence book.
  - Soviet/Russian boats run 50 Hz electrical plants, US boats 60 Hz: a 50 Hz line family is a classic national tell.
  - Slow-speed two-stroke merchant diesels are direct drive: cylinder firing rate = shaft rate x cylinders.
  - Fin whales make 20 Hz pulses that SOSUS operators learned to tell from machinery; biologics sweep in frequency,
    machinery lines stay put.
  - A diesel-electric sub on battery at low speed does not cavitate: nothing on DEMON, only faint tonals.

## Candidates (novelty / wow / feasibility, scored together)
| idea | N | W | F | note |
|---|---|---|---|---|
| **blade-rate** (this; was `sonar-waterfall` in the backlog) - passive sonar operator classifies contacts with LOFAR + DEMON + headphones | 4 | 5 | 4 | user loves military trivia; displays are real FFTs of the simulated signal |
| one-light-day - debug Voyager 1's memory around a failed chip when every test costs 46 hours of light time | 5 | 4 | 3 | perfect hook for Nov 18; puzzle design risk. Backlog, aim for ~Nov 18 |
| cut-and-rotate - break a Videocrypt-style analog TV scrambler by line correlation (Markus Kuhn's attack) | 4 | 4 | 4 | security again right after Greenlist: space it out |
| blink-survey - Rubin-style difference imaging: link moving dots, opposition rate gives distance, find a Neptune Trojan | 4 | 4 | 4 | astronomy imaging too close to Earth-Sized Eye (10-31) |
| reentry-footprint - narrow the Swift re-entry window over a ground-track ribbon | 3 | 3 | 4 | thin loop |

Previous builds: flight sim (10-27), radio-astronomy imaging (10-31), word puzzle/security (11-01). A naval audio
game is a new cluster (WebAudio-heavy, spectrogram UI, classification puzzle); military last appeared a week ago.

## Concept
Cold water, 2031. You are the sonar supervisor of a fast-attack submarine on a barrier patrol. Contacts drift across
the broadband bearing display. Steer a beam onto one, listen to it in your headphones, and read its acoustic
fingerprint on two displays: the LOFARgram (machinery tonals) and the DEMON spectrum (propeller rhythm). Use the
harmonic cursor to measure line families, match them against the Acoustic Intelligence book, estimate the contact's
speed, and file the report before the watch ends. Somewhere in the noise there is a quiet boat that should not be
there.

## Why would someone who has seen a hundred web games find this interesting?
It is a real passive-sonar workflow (LOFAR, DEMON, harmonic cursors, 50 vs 60 Hz plants, blades x shaft rate,
turns-per-knot) in which every display is an honest FFT of the same simulated hydrophone signal you are hearing, so
the classification puzzle is solved with genuine signal-processing reasoning, not by spotting an icon.

## Mechanics
- Signal model (`sim.js`, pure, node-testable), per contact class:
  - `shaft` Hz (from speed via TPK), `blades`, `shafts` (1 or 2, twin shafts slightly detuned),
    plant `mains` 50/60 Hz with harmonic amplitudes, extra machinery tonals (pump, reduction gear, diesel firing =
    shaft x cylinders), cavitation level (0 for a quiet boat / battery), source level.
  - Low band (fs 1000 Hz): tonals (sum of sines with tiny jitter) + shaft/blade-rate lines + Gaussian noise.
  - High band (fs 4000 Hz): white noise x modulation m(t) (blade pulses + shaft asymmetry). DEMON = square,
    block-average to 200 Hz, FFT. Honest DSP, not drawn lines.
  - Biologics: humpback-like moans (swept 120-450 Hz) or fin-whale 20 Hz downswept pulses.
  - Ambient: sea-state noise; received level = source level - transmission loss (range) + beam gain.
- Displays (canvas):
  - BTR (bearing-time waterfall, broadband): bearing 0-359 across, time down. Contacts drift. Tap to steer the beam.
  - LOFARgram of the steered beam: 0-500 Hz (zoom 0-200), rows every 0.5 s, integration 1/4/16 (exponential
    average: quiet lines emerge, but the picture reacts slower).
  - DEMON spectrum: 0-40 Hz modulation, line plot + mini waterfall.
  - Harmonic cursor on LOFAR and DEMON: drag to set a fundamental; ticks at f, 2f, 3f...; readout in Hz and RPM.
- Audio (WebAudio, procedural): steered-beam sound = ambient hiss + each contact's cavitation (bandpassed noise whose
  gain is modulated by a PeriodicWave at the shaft rate with blade harmonics) + machinery hum + biologic moans,
  weighted by beam gain. Clicks/pings UI sounds, alarm on counter-detection. Mute.
- Report: pick class from the book (or Biologic) and speed in knots. Score: class correct 100, speed within 2 kn +50
  (within 4 +20), time bonus; wrong nationality call on a hostile = big penalty. Explanation shown after each report
  ("blade 12.0 / shaft 3.0 = 4 blades; 50 Hz family = Red; 180 RPM / 12 TPK = 15 kn").
- Watches (campaign of 5, each a few minutes):
  1. Shakedown: one loud merchant. Guided tutorial (steer, harmonic cursor, DEMON, report).
  2. Fishing grounds: trawler + merchant + humpback.
  3. The strait: twin-shaft frigate + merchant + fin whale (20 Hz trap).
  4. Battery: a Red diesel-electric on battery; no cavitation, faint 50 Hz family; needs integration. Counter-
     detection clock.
  5. In the shadow: a Red SSN hiding in a loud merchant's noise on nearly the same bearing; separate them by tonals.
     Counter-detection clock; failing ends with "TRANSIENT - TORPEDO IN THE WATER".
- End screen: score, per-watch grades, "what was real" notes (SOSUS, 50/60 Hz, DEMON, fin whales), replay.

## Tech
- Static `index.html` + `style.css` + `sim.js` (signal model, FFT, DEMON, scoring; pure) + `data.js` (book, watches)
  + `game.js` (UI, rendering, audio). No network, no fonts, no dependencies.
- `?demo` (auto steers + cursor for screenshots), `?watch=N` for testing.

## Definition of done
- 5 watches, each with a correct answer derivable from the displays (verified by an automated "operator" in tests:
  peak-picking LOFAR/DEMON + book matching gets every contact right).
- Title/intro, how-to, guided first watch, report + explanation, end screen, replay, mute, reduced motion respected.
- Works on a 390x844 touch viewport and desktop; no console errors in headless Edge; ~60 fps-ish.
- README, screenshot, index + IDEAS updated, Pages live, Telegram sent.

## Test plan
- `node tests.js`: FFT against known sines; LOFAR of each class shows its mains family at the right bins; DEMON peak
  at blade rate and shaft rate within one bin; battery sub has no DEMON peak above noise; speed from shaft rate and
  TPK; scoring; auto-operator classifies all contacts in all watches correctly from the simulated spectra.
- Headless Edge: `--dump-dom` with `--enable-logging=stderr` for JS errors; screenshots desktop + 390x844 mobile.
- Manual-ish: view screenshots with vision; check audio graph builds without errors (no real ears available).
