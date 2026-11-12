# HOOT - design

Daily build, 2026-11-12. Game (music / retro-computing puzzle).

## Concept
1951. You are the programmer of a delay-line computer whose only sound device is a "hooter": a loudspeaker
that clicks once each time an instruction sends it a pulse. There is no note command. The memory is a mercury
tank, a ring of 24 words that circulates past a read head once per revolution; an instruction can only be
fetched when its word comes round. So the time between two clicks is fixed by where the two instructions sit
on the ring - and pitch is nothing but placement.

Each note of a tune is a closed loop of HOOT instructions that you lay out on the ring. A loop that visits
k instructions while the tank turns R times clicks k times every R revolutions: its pitch is exactly k/R times
the tank frequency (C3, 130.8 Hz here). Draw the loop and it becomes a star polygon: one dot is C3, a diameter is
C4, a triangle walked once is G4, the same triangle walked twice (hops of 16) is G3, a pentagon with 4 laps is E3.
The delay line can only speak in whole-number ratios: it is a bugle, playing the harmonic series and just
intonation. When k does not divide 24*R the clicks cannot be evenly spaced and the note "wobbles" (jitter): the
very compromise Geoff Hill had to engineer on CSIRAC (his loop used uneven waits t1, t1, t2, t3). All the notes
of a tune must share the same 24 words, around words already taken by the tune-reader code. Pack them, keep
them in tune and steady, then hear your program play the tune through a simulated hooter, cut to acetate like
the BBC's 1951 recording of the Ferranti Mark 1.

## Why would someone who has seen a hundred web games find this interesting?
Because the music is not sampled or synthesised from notes: you hear the literal click train your loop
emits, the pitch you get is the geometry of a star polygon on a rotating mercury memory, and the hard levels are
real number-theory packing puzzles (a solver proves, for example, that Taps cannot fit with less than 2 words of
jitter).

## Research / sources (checked 2026-11-12)
- CSIRAC (CSIR Mk1) and Geoff Hill: mercury delay-line memory, every access waits for the word to come round,
  ~1 kHz major clock; pulses sent to the speaker ("P" destination); played Colonel Bogey publicly in 1951. Hill's
  note loops used uneven waits (t1, t1, t2, t3). Sources: University of Melbourne "The music of CSIRAC";
  Doornbusch, "Early computer music experiments in Australia and England", Organised Sound (2017).
- Turing's Programmers' Handbook: /V "hoot"; a loop with a hoot every 8 beats (1.92 ms) gives 521 Hz "about
  middle C"; a 3-instruction loop gives "a fifth lower" (an interval as a timing ratio).
- Pilot ACE / DEUCE: loops always multiples of 32 us, so notes were submultiples of 31.25 kHz.
- Ferranti Mark 1 / Strachey: BBC acetate recording 1951 (God Save the King, Baa Baa Black Sheep, In the Mood),
  restored in 2016 by Jack Copeland and Jason Long (the disc ran at the wrong speed).
- The machine in the game is a TOY, not an emulator: one 24-word tank, every instruction is a hoot, a revolution
  lasts 1/130.81 s. Real machines had several tanks, longer instructions and counters. README says so.

## Candidates considered (novelty / wow / feasibility, 1-5)
1. hoot (this) - delay-line placement music puzzle, star polygons = ratios, packing proofs. 5/4/4. Chosen: new
   loop type for this repo (constructive placement puzzle + music), no overlap with yesterday's terrain viz or
   the flight builds.
2. phase-connect - pulsar timing: dedisperse and fold the new 7.9-min long-period transient GPM J0715-1141
   (Nature Astronomy, 12 Nov 2026, 1.3-day orbit with a Sun-like star), then phase-connect TOAs across gaps by
   counting turns, fit P, Pdot, orbit Roemer delay until residuals go white; eclipse behind a prominence.
   4/4/4. Not today: it is again "tune parameters until hidden structure appears" (pregroove, bare-earth).
3. glitch-window (backlog) - voltage fault injection on a boot ROM. 4/4/4. Security; keep for another day.
4. gallop - Timsort tribute (Tim Peters' death announced 11 Nov 2026): be the merge, spot runs, choose when to
   gallop. 3/3/5. Too close to an algorithm visualiser.
5. one-light-day (backlog) - Voyager 1 one light-day milestone ~18 Nov 2026. 5/4/3. Better on/near the date.
6. splatter-perl - "93% of paint splatters are valid Perl" (HN today): fling paint, the parser judges. 3/3/3.

## Mechanics (exact)
- Ring of N = 24 slots, word time tau = 1/(24 * 130.8128) s. Head at slot (t mod 24).
- A note's program is a cyclic list of slots s0..s(k-1). After the instruction at slot a, the next one at slot b is
  fetched after hop = ((b - a - 1) mod 24) + 1 words (1..24; pointing at itself = a full revolution).
  Every instruction is a HOOT: a click at the moment it executes.
- Loop length = sum of hops = 24*R (always a whole number of revolutions). Mean pitch f = k/R * 130.81 Hz.
  Cents error vs equal-tempered target = 1200*log2(f/target). Jitter = max hop - min hop (words).
- Each slot holds one instruction; notes cannot share slots; some slots are pre-occupied (locked "reader" code).
- A note is "in tune" if |cents| <= 20; "steady" if jitter <= the level's par jitter (computed by the solver).
- Stars per level: 1 = every note in tune and the tune plays; 2 = also every note at or below par jitter;
  3 = also total jitter sum at the solver's minimum (or "no note exceeds par and N slots free", decide by solver
  results during build - keep it simple and provable).

## Levels (validated by a solver in tests; adjust if a check fails)
1. Operator call - C3 alone (1/1). Tutorial: tap a slot, tap it again to close the loop. Hear 130.8 Hz.
2. Octaves - C3, C4, C5 (1/1, 2/1, 4/1). Equal spacing; pitch = clicks per revolution.
3. Same triangle, two notes - C4, G4 (3/1), G3 (3/2). G3 visits the same kind of triangle with hops of 16: laps.
4. Hill's compromise - C3, E3, G3, C4 arpeggio (1, 5/4, 3/2, 2). E3 needs 5 clicks in 4 laps (19.2 words): it
   can never be steady; the wobble is audible. Obstacles make packing matter.
5. Taps (1862, public domain) - G4, C5, E5, G5 = harmonics 3, 4, 5, 6 with 3 locked words. Proven: no packing
   with jitter <= 1 exists, par is 2.
6. Frere Jacques in the C3 octave - C3, D3, E3, F3, G3 = 1, 9/8, 5/4, 4/3, 3/2 = 22 words + 2 locked = full tank.
   Finale: the tune is "cut to acetate" (record playback with disc animation, crackle, slight wow).
Each level has a short tune (note list with durations) played back by the simulated machine.

## UI
- Title screen (animated mercury ring, click-train hum), level select with stars, one-screen briefing per level.
- Main: the tank ring (canvas, big touch targets, slot numbers), loops drawn as coloured chords with hop labels,
  locked words hatched, read head and circulating pulses animate while playing. Note cards (target, ratio k/R,
  Hz, cents needle, jitter, slots used). Tap a card to select the note you are building.
- Input: tap a free slot to append the next instruction; tap the first slot to close the loop; Undo; Clear note;
  hint ghosts show the ideal even positions for the target ratio (levels 1-4 always, later optional).
- Audio: WebAudio, sample-accurate click trains rendered into AudioBuffers (per-note loop preview, whole tune),
  a "hooter" speaker model (short pulse -> resonant band-pass + soft clip), mute button, volume sane by default.
  Acetate finale adds crackle and a slow speed wobble.
- Oscilloscope strip under the ring showing the click train of the selected note (jitter visible).
- Mobile-first portrait layout, keyboard: digits/arrow keys not required; Space = play, U = undo, Esc = menu.
- prefers-reduced-motion: no ring spin animation, static head.
- ?demo autoloads level 5 with a solved layout (screenshot); ?selftest runs in-page checks.

## Tech
- Static folder: index.html, style.css, sim.js (pure logic: hops, ratios, cents, jitter, validation, solver),
  audio.js, game.js. Zero deps. Node tests (tests/sim.test.js) for the logic and level solvability.

## Definition of done
- 6 levels, all proven solvable by the solver test with recorded par jitter; stars saved in localStorage.
- Live readouts correct (unit-tested), tune playback works, acetate finale, title/briefings/instructions,
  restart, mute. No console errors in headless Edge. Works at 390x844 portrait and 1280x720.
- README with the history, the maths (k/R, star polygons, jitter) and honest limits; screenshot of real gameplay.

## Test plan
- node tests: hop/loop maths, k/R and cents for known cases (G3 = 3/2 = +1.96 c), jitter for 5/4 (=1),
  impossibility of jitter 1 for Taps, each level solvable within tolerance, solved demo layouts validate.
- Headless Edge: load ?selftest (click-through: build loops via the same handlers as taps, play, finish level),
  dump DOM, check no errors. Screenshots at 1280x720 and 390x844 and view them.
