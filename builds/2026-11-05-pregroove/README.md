# Pregroove

A disc-forensics puzzle game. 2031: networks are filtered, so couriers carry "blank" CD-Rs. The message is not in the
data, it is in the picture the data draws on the dye layer. You have the courier's raw rip but not the disc, so you
rebuild the burner's geometry (linear velocity, track pitch, start angle) until the picture untwists and the flag
becomes readable.

Play: https://phennova.github.io/daily-builds/builds/2026-11-05-pregroove/

## How to play
1. Each disc shows the decoded surface as a ring-shaped picture. Wrong geometry makes it a swirl.
2. Drag a parameter strip (or use the + / - buttons and the step sizes from coarse to fine) to change it.
3. Open the lag scope: neighbouring turns of the spiral carry the same picture, so the stream echoes itself once
   per revolution. Take readings at spread-out positions, then Fit to solve the geometry numerically.
4. Finish by eye. On most discs three calibration-tick rings (hub, mid, rim) show a live offset readout; drive each to zero.
5. Read the flag on the upper arc and type it in. Five discs, then a debrief. Make a dead-drop link to challenge a friend.

Keyboard/mouse/touch all work. Mute button in the header.

## The idea (real stuff)
Discs record at constant linear velocity, so the spiral's angle depends on the pitch while its radius depends on
pitch x velocity; a 1-part-per-million velocity error shows up as a visible twist after about 20,000 turns. Decoding
walks that spiral (closed-form inverse, per pixel). The scope is an honest autocorrelation of the raw bit stream with
sub-frame peak finding, and the fit is Levenberg-Marquardt on the lag-vs-position model. Inspired by DiscImageStudio /
CDImage (Hacker News, Nov 2026) and the BSidesSF CTF challenge its author described.

## Files
- `index.html`, `style.css`, `game.js` - the game (no dependencies, no network)
- `disc.js` - geometry, burn, decoder, autocorrelation, fit, dead-drop links (runs in browser and node)
- `tests.js` - `node tests.js` (24 unit tests)
- Query params: `?selftest` (in-page checks), `?playtest` (simulated scope + fit + ring-nulling on 4 seeds per disc),
  `?demo`, `?demo=reveal`, `?level=N`, `?seed=x`
- `DESIGN.md` - design notes

## Credits
All code, art and sound generated in-page. Day 6 of the daily builds.
