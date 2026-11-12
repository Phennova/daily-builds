# HOOT

A puzzle game about a 1951 computer that can only click.

Live: https://phennova.github.io/daily-builds/builds/2026-11-12-hoot/

## The idea
Early computers like CSIRAC (Melbourne) and the Ferranti Mark 1 (Manchester) stored memory as pulses circling in a
mercury delay line. An instruction could only be fetched when its word came round to the read head, so the time
between two instructions depended on where they sat. Their "hooter" speaker clicked each time an instruction sent it a
pulse, and programmers made music by arranging those clicks. There was no note command: pitch was placement.

In this toy machine the tank has 24 words and turns 130.8 times a second. Every instruction is a HOOT. A note is a closed
loop of instructions. A loop of k clicks that takes R revolutions plays k/R times 130.8 Hz (C3). Drawn on the ring it is a
star polygon: one word is C3, a diameter C4, a triangle walked once G4, the same triangle in hops of 16 (two turns) G3.
Only whole-number ratios exist, so the machine is a bugle that plays the harmonic series. When k does not divide 24R the
gaps cannot be equal and the note wobbles (jitter, in words) - the same compromise Geoff Hill met on CSIRAC.

## How to play
- Tap a free word to add a HOOT to the selected note, tap its first word again to close the loop (you hear it).
- Tap a card to pick another note. Undo / Clear note to edit. Dashed ghosts (early levels) show even spacing.
- Hatched words are taken by locked code. Notes cannot share words.
- When every note is within 20 cents, Play tune. Stars: 1 in tune, 2 wobble at or under the solver's par, 3 least total wobble.
- Keys: Space play, U undo, 1-5 select note. Sound on/off button top right. Headphones help.

## Six programs
Operator call, Octaves, Same triangle twice, Hill's compromise, Taps (a solver proves no packing has wobble 1), and Frere Jacques
in a completely full tank, cut to "acetate" with crackle and wow.

## Tests
- `node tests/sim.test.js` (39 checks: hop maths, k/R, cents, jitter, solver par for every level).
- `index.html?selftest` builds all six levels through the real tap handler using the solver, checks 3 stars and renders the tune audio.
- `index.html?demo=5` shows a solved level.

## Honest limits
It is a toy, not an emulator: one tank, every instruction a hoot, one revolution = one C3 period. Real machines had
several tanks and counters. Audio is a simple hooter model, tested only for non-silent and bounded output in headless
Edge, not by ear on devices. Not tested on iOS Safari. Layout checked by DOM metrics at phone, desktop and landscape sizes.

Sources: University of Melbourne "The music of CSIRAC"; Doornbusch, "Early computer music experiments in Australia and
England" (Organised Sound, 2017); Turing's Programmers' Handbook for the Manchester machine; Copeland and Long on the 1951 BBC acetate.
No dependencies, no network requests. MIT.
