# Blade Rate

A passive-sonar classification game. You are the sonar supervisor of a fast-attack submarine on a barrier patrol.
Steer a beam onto a contact, listen on headphones, and read its fingerprint on two displays:

- LOFARgram: long-averaged spectrogram of machinery tonals (50 Hz vs 60 Hz plant families, pumps, gears).
- DEMON: the envelope spectrum of the cavitation hiss, whose peaks are the shaft rate and blade rate (blades x shaft rate).

Place the harmonic cursors, match the lines against the Acoustic Intelligence book, convert shaft RPM to speed with
turns-per-knot, and file the report before the watch ends. Five watches, including a quiet boat that barely cavitates,
whales that sweep instead of holding a line, and a torpedo fail state.

Play: https://phennova.github.io/daily-builds/builds/2026-11-03-blade-rate/ (headphones strongly recommended)

## The idea
Every display is a real FFT of the same simulated hydrophone signal you hear. `sim.js` synthesises tonals, shaft and
blade modulation, cavitation noise and ambient sea noise; DEMON is computed the honest way (bandpass, envelope, FFT).
Classification is signal-processing reasoning, not icon spotting.

## Controls
Drag on the bearing display to steer the beam; drag the LOFAR/DEMON cursors; R report, B book, M mute. Touch works
(iPhone layout checked only in headless Edge at 390x844, not on real iOS Safari).

## Dev
- `node tests.js` runs the signal-model tests (53 pass).
- `index.html?selftest` drives the full UI flow headlessly. `?demo&watch=N` jumps to a watch, `?seed=N` fixes the seed.
- No dependencies, no network requests. Audio is generated with WebAudio.

Design notes in DESIGN.md. Screenshots: screenshot.png, screenshot-mobile.png.
