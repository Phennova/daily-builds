# Light Alibi - design

Build #7, 2026-11-06. Game (network forensics on a 3D globe).

## Concept
You work proxy-fraud intake for a streaming platform. VPN and residential-proxy exits claim to be somewhere
("NordStar exit IS-REY-03: Reykjavik, Iceland"). IP-to-location databases are easy to fake; the speed of light is not.
You pick landmark servers on a spinning globe, ping the suspect from them, and every round trip becomes a disk:
a packet cannot have travelled further than (RTT / 2) x 200 km/ms (light in fibre is ~2/3 c). The suspect must be inside
every disk at once. If the claimed city falls outside even one disk, the claim is physically impossible - you have a proof.
Then drop a pin where the exit really is, and the truth is revealed.

This is Constraint-Based Geolocation (CBG), as used in Weinberg et al., "How to Catch when Proxies Lie" (IMC 2018),
which found a third of commercial proxies were not in the advertised country. Hook from this week's news: researchers
found residential-proxy exits on the White House network (AS2650, reported 2026-11-05) and proxy exits "everywhere,
even Saint Helena and Tristan da Cunha".

## Why would someone who has seen a hundred web games find this interesting?
You catch liars with physics: every ping you fire becomes a light-speed bound on a hand-rendered globe, the impossible
region visibly closes in, and the rules are the real ones network researchers use - including the trap that RTT only
ever gives upper bounds, so you can prove a claim false but never prove it true.

## Mechanics
- Globe: orthographic, rendered per pixel by inverse projection (land mask rasterised once from Natural Earth 110m,
  public domain). Disk interiors tint the globe; the intersection of all disks (the feasible region) glows.
  Drag to rotate, pinch / wheel to zoom, tap a landmark to probe it, tap elsewhere to place the pin.
- Probe budget per case. Each probe fires 5 pings, min RTT kept (queueing only ever adds delay). A ripple expands from the
  landmark and the echo returns with an audible delay proportional to RTT (scaled so you can hear the difference).
- Latency model (deterministic per pair, seeded noise): rtt = 2 d / (200 / inflation) + base + last-mile + jitter, with
  inflation 1.2-1.9 and a few circuitous pairs routed via a third city (Manila->Hong Kong via Los Angeles style). Never
  faster than physics, so disks are always safe upper bounds.
- Unpingable exits (case 3+): you can only time client -> proxy -> landmark (B) and client -> proxy -> client (C, your own
  leg, there and back twice). Landmark leg A = B - C/2. Before you measure C (costs a probe) disks use B: still valid but
  loose. Teaches the real trick from the paper.
- Verdict: "Claim is physically impossible" vs "Can't disprove it". Accusing without a disk that excludes the claim is an
  unsupported accusation even if the claim was a lie. Then pin.
- Score per case: verdict (400), pin accuracy (up to 400, plus inside-feasible-region check), unused probes (50 each).
  Rank title at the end.

## Cases (5 handcrafted + endless random "night shift")
1. First Light - claims Frankfurt, truly Frankfurt, pingable, 5 probes. Learn disks; can't prove true.
2. Northern Lie - claims Reykjavik, truly Amsterdam, pingable, 4 probes. The Reykjavik landmark itself only says
   "suspiciously slow" (no lower bounds!); London/Dublin disk excludes Reykjavik = proof.
3. Saint Helena - claims Jamestown, St Helena; unpingable; you are in Bengaluru; truly Prague (cheap hosting). B/C trick.
4. Detour - claims Singapore, truly Hong Kong; some routes are circuitous (Manila, Taipei via LA); 3 probes - choose well.
5. Edge of the World - claims Tristan da Cunha; unpingable + detours + 4 probes; truly Johannesburg.
Night shift: generator picks claim/truth (about half honest), pingability, detours; endless with running score.

## Scope / tech
Static folder, zero deps: index.html, style in page, core.js (geometry + latency model + scoring, node-testable),
land.js (compact quantised Natural Earth 110m land rings), app.js (render, input, audio, UI). WebAudio blips, mute,
prefers-reduced-motion (no ripples/auto-spin), mobile-first layout (globe top, panel bottom on portrait).
?demo for screenshot, ?selftest for in-page checks.

## Definition of done
Title/intro with a 20-second explanation, 5 cases + night shift, verdict + pin + reveal + lesson per case, final summary
and restart, mute, works by touch and mouse, no console errors, README + screenshot, tests pass.

## Test plan
- node tests: great-circle distance vs known city pairs; inverse/forward projection round trip; RTT model never beats
  2d/200; B - C/2 estimates stay >= true distance with the min-of-5 rule over many seeds; each handcrafted case is solvable
  (truth inside all disks with every landmark; the lie cases have at least one affordable proving landmark).
- Headless Edge: load with --enable-logging, no errors; ?selftest passes; ?demo screenshot shows the globe with disks.
