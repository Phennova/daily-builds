# Greenlist: design

Build #3, 2026-11-01. Type: game (word puzzle / security education). Slug: `greenlist`.

## Research notes (what is in the air right now)
- HN today: "AI text watermarking and quality loss" (EU AI Act transparency rules; major labs now watermark text output,
  Gruber vs. Jalkut debate). Watermarking of LLM text is suddenly a mainstream topic, but almost nobody has *seen* how a
  watermark works.
- The classic scheme (Kirchenbauer et al. 2023, "KGW"): at every step a hash of the previous token(s) + a secret key
  splits the vocabulary into a green list (fraction gamma) and a red list; green logits get +delta. Detection is a
  one-proportion z-test: z = (N_green - gamma*N) / sqrt(gamma*(1-gamma)*N); z >= 4 means "machine". Paraphrase /
  synonym-substitution attacks lower z, but they cost fluency (perplexity goes up), and because the hash depends on the
  previous token, editing one word also re-rolls the colour of the NEXT word.
- Other candidates considered today are in IDEAS.md (scores below).

## Candidates (novelty / wow / feasibility, scored together)
| idea | N | W | F | note |
|---|---|---|---|---|
| **greenlist** (this) - scrub a KGW watermark out of a dispatch under a dystopian Ministry of Provenance | 5 | 4 | 4 | timely, real algorithm, a new kind of word puzzle |
| partition-fault (Jepsen-style: inject partitions/clock skew into a toy replicated DB until the checker finds a lost write) | 4 | 4 | 3 | Jepsen ParticleDB report today; checker is the hard part |
| cache-whisper (backlog) covert channel between VMs | 4 | 4 | 4 | still good; keep for another day |
| sonar-waterfall (backlog) | 4 | 4 | 4 | FFT/signal again right after Earth-Sized Eye: space it out |
| twenty-seconds micro-game for the 20 Second Game Jam | 3 | 3 | 5 | weak hook |
| lycurgus-glass dichroic optics toy | 3 | 3 | 4 | pretty but thin loop |

Previous builds: flight sim (10-27), radio-astronomy imaging (10-31). A text/security puzzle is a clean change of
cluster (no 3D, no FFT).

## Concept
2031. The Ministry of Provenance requires every published sentence to be certified HUMAN or MACHINE; machine text is
traced to its licence holder. The underground press drafts its dispatches with SCRIBE, a stolen language model, and
SCRIBE watermarks everything it writes. Each night you get one draft. Before the courier leaves, swap words (every slot
has a few synonyms) until the Ministry's detector stops seeing the watermark, without making the prose so awkward that
the Ministry's *other* detector (perplexity: "nobody writes like that") flags it.

The draft is generated live at the start of each night: you watch SCRIBE sample each slot, with its candidate bars and
the green ones pushed up by delta. Then the detector scans it and stamps it MACHINE (z about 5).

## Why would someone who has seen a hundred web games find this interesting?
It is a real LLM watermark (keyed hash green lists, delta-biased sampling, z-test) turned into a word puzzle with a
genuinely new mechanic: every word you swap also re-colours its neighbour, so you are playing against a hash
function's dependency chain while a second detector (perplexity) punishes clumsy synonyms - which is exactly the
trade-off researchers argue about, and you learn it by feel.

## Mechanics
- Tokens = lowercase words (punctuation ignored). Colour of token i = H(key, prev_k tokens, token_i) < gamma.
  gamma = 0.25. Both detector and generator use the same function (tested).
- Template text: fixed words + slots `{a|b|c}`; option order = model preference (base logit falls by about 0.7-1.0
  per rank, authored per option where needed). Options may be multi-word.
- Generation: per slot, softmax(base logit + delta*green), delta = 2.5, seeded RNG; regenerate with next seed until
  the initial z is in a target band (e.g. 4.3-6.5) so every night starts clearly flagged.
- Fluency: perplexity proxy = exp(mean NLL of the chosen slot options under the base (unwatermarked) model, spread
  over all tokens). The game shows it as a "READS HUMAN" meter with a cap per night.
- Win a night: z < pass threshold (usually 2.0; "uncertain" band 2-4 is not enough), perplexity <= cap, within the
  edit budget. Then "SEND". Score = edits left + fluency margin + z margin. Fail: courier leaves at budget 0 -> retry.
- Nights (campaign of 5):
  1. Leaked key: colours visible, plus a preview of the delta-z on each option. Tutorial.
  2. Tight prose: colours visible, no preview, lower perplexity cap.
  3. Wider window: the Ministry hashes the previous TWO words (k=2): an edit re-colours up to 3 tokens.
  4. Blind: the key rotated; no colours. You get limited scans that return green counts per sentence. Inference night.
  5. Reversal: frame the Ministry - a hand-written Ministry speech must be made to read as MACHINE (z >= 4)
     (spoofing attack), with the key leaked again.
- End screen: totals, a short "what was real" explainer, replay.

## Tech
- Static `index.html` + `style.css` + `wm.js` (pure watermark/LM logic, node-testable) + `nights.js` (content) +
  `game.js` (UI, audio). DOM for text (word chips; tap -> bottom sheet with options), canvas for the z-gauge (bell
  curve with needle and thresholds) and generation bars. WebAudio: typewriter ticks, scanner sweep, stamp thud;
  mute button. No network, no fonts.
- `?demo` URL param for screenshots (auto-plays generation and a few edits). `?night=N` for testing.

## Definition of done
- 5 nights authored and each verified solvable by a solver script (tests) within its budget and cap.
- Title/intro, how-to, generation animation, scanning, stamp verdict, end screen, replay, mute, reduced-motion respected.
- Works on a 390x844 touch viewport and on desktop with mouse/keyboard; no console errors in headless Edge.
- README, screenshot, index + IDEAS updated, Pages live.

## Test plan
- `node tests.js`: hash determinism; z formula against hand values; random human-like text gives |z| small on average
  (null hypothesis check over many keys); generation produces z in band for each night; colour recompute after an edit
  only touches the expected neighbours (k=1 and k=2); greedy/beam solver finds a winning assignment for every night
  within its budget; perplexity of all-first-choice = minimum.
- Headless Edge `--dump-dom` + `--enable-logging` to catch JS errors; screenshots at 1280x720 and 390x844 viewed.
