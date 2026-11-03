# Ideas log (read before ideating; append every build)

Format: `- YYYY-MM-DD | slug | game/tool | one-line concept | techniques | rating (self, 1-5)`.
Never repeat a concept below. Keep a balance of games and tools. Also keep a short **backlog** of promising ideas
you thought of but did not build.

## Built
- 2026-10-27 | call-the-ball | game | fly the final 18s groove of an F/A-18E carrier approach on the meatball, graded by a procedural LSO with real shorthand; 6-pass cruise + greenie board | canvas 3D-ish render, WebAudio, flight model, speech synthesis | 4
- 2026-11-01 | greenlist | game | scrub a real KGW LLM text watermark out of dispatches by swapping synonyms while a perplexity detector watches; 5 nights incl. k=2 hash, blind, spoofing | hash green lists, z-test, exact DP solver, DOM word puzzle, WebAudio | 4

## Backlog (unbuilt ideas, for future days)
- spectrogram-smuggler | tool | hide text/images inside the spectrogram of a generated WAV; decode via mic or file with an in-browser FFT; explains audio steganography | WebAudio, FFT, WAV encoder | 3/4/5
- timing-oracle | game | dystopian terminal where you crack a simulated password checker by measuring response times (timing side-channel), with live histograms and statistics | security education, data viz | 4/3/4
- permit-dystopia | game | sci-fi bureaucracy: a city AI approves/denies citizens' requests; spot forged documents with hidden tells | narrative, procedural docs | 3/3/4
- cellular-ecology | toy | falling-sand + reaction-diffusion hybrid on WebGPU compute with a canvas fallback | WebGPU compute | 3/4/3
- cache-whisper | game | you are a sandboxed AI agent that must leak a secret to a sibling VM through a shared CPU cache / CPU-contention covert channel: design the encoding, sync and threshold against noisy neighbours and a defender's anomaly meter (inspired by OpenAI's Oct 2026 red-team disclosure); could absorb timing-oracle | security education, signal processing, data viz | 4/4/4 on 2026-10-31
- burn-through | game | EW duel: fly a strike package into a SAM radar's coverage, juggle standoff vs self-screening jamming and watch J/S vs R^2 decide the burn-through range on a live PPI scope | radar range equation, canvas scope, WebAudio RWR tones | 3/4/4 (military; space it away from flight builds)
- partition-fault | game | Jepsen-style chaos engineer: cut links, skew clocks and kill nodes in a toy replicated KV store until the history checker proves a lost write / stale read; anomaly shown on a timeline (inspired by Jepsen's ParticleDB report, 2026-10-31) | distributed-systems sim, history checker, data viz | 4/4/3 on 2026-11-01
- lycurgus-glass | toy | dichroic glass optics: light the Roman Lycurgus Cup from front/back and tune nanoparticle size to shift scattered vs transmitted colour | canvas shading, Mie-ish approximation | 3/3/4 on 2026-11-01
- twenty-seconds | game | "20 second" micro-game format: a complete run in exactly 20 s (20 Second Game Jam, Oct-Nov 2026) | tight game feel | 3/3/5
- one-light-day | game | Voyager 1 ops: relocate FDS code around a failed memory chip, power-budget heaters as the RTGs decay, and every uplink/telemetry round trip costs ~2 days of light time; time it near 2026-11-18 when Voyager 1 crosses one light-day | latency puzzle, memory-map packing, mission sim | 5/4/3 on 2026-11-03
- cut-and-rotate | game | break a Videocrypt-style analog TV scrambler (cut-point rotation, line shuffle) by line-to-line correlation, as in Markus Kuhn's 1990s attack; dystopian pirate-broadcast framing | canvas image DSP, security history | 4/4/4 on 2026-11-03
- blink-survey | game | Rubin-style difference imaging: blink exposures, link moving dots into tracklets, use the opposition rate of motion to get distance and find a Neptune Trojan among asteroids, satellite streaks and cosmic rays | procedural star fields, PSF, orbital rate physics | 4/4/4 on 2026-11-03 (space away from astronomy builds)
- reentry-footprint | game | narrow a decaying satellite's re-entry window (Swift, Nov 2026) along a ground-track ribbon as solar flux shifts drag | orbital decay, map projection | 3/3/4 on 2026-11-03

## Interests of the user (use for inspiration, not as a straitjacket)
Coding; cybersecurity (learning level: explain concepts in-app); running local AI on modest hardware; Steam games;
alternative music; wanting to fly the F/A-18 Super Hornet (carrier landing, flight, naval aviation); military
hardware (tanks, planes, interesting facts); sci-fi and dystopian books; world affairs; Minecraft modding; random
project ideas. He plays mostly on an iPhone browser when away, and a gaming laptop at home.
