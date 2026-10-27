# Working rules for the daily-build agent

You build ONE finished, creative game or tool per day for Phennova, in this public repository (`Phennova/daily-builds`).
Because the repo is PUBLIC: never commit secrets, tokens, personal data, file paths from the user's machine beyond
what's necessary, or anything private. Read `IDEAS.md` first.

## Quality bar ("nothing basic")
- A build needs a **distinctive idea or mechanic** and at least one "wow" element (a clever system, a surprising
  interaction, an unusual data source/technique, striking procedural art/audio). Write one sentence in DESIGN.md
  answering: "Why would someone who has seen a hundred web games find this interesting?" If the answer is weak,
  change the idea before building.
- Banned as the core idea: tic-tac-toe, to-do apps, calculators, plain snake/pong/tetris/2048/flappy clones,
  weather apps, "AI chatbot wrapper", unit converters, generic dashboards. A well-known genre is fine ONLY with a
  genuinely new twist.
- Finished beats ambitious: it must start fast, have a clear goal/loop, a title/intro, instructions, and a satisfying
  end/restart. No placeholder text, no dead buttons, no console errors.
- Mobile-first: works with touch on an iPhone (viewport meta, no hover-only controls, safe areas, 60fps-ish),
  and still works with keyboard/mouse. Respect `prefers-reduced-motion`; add a mute control when there is audio.
- Game feel: juice (animation, particles, screen shake where apt), WebAudio sound generated in code, a sensible
  difficulty curve. Tools: sensible defaults, helpful errors, export/copy results, short in-app explanation.
- Mix it up over time: games and tools, different genres, different techniques (WebGL/WebGPU if available, canvas,
  WebAudio, cellular automata, procedural generation, physics, text/narrative, simulation, data viz, security toys,
  local-AI-in-the-browser ideas, flight/naval/military sims, sci-fi/dystopian settings, music-reactive, etc.).
  Check IDEAS.md so you don't repeat a concept or technique cluster two days in a row.

## Technical rules
- Each build lives in `builds/YYYY-MM-DD-slug/` (date = today in IST given in the task). Web builds are a static folder with
  `index.html` (+ optional `.js/.css`), **zero dependencies, zero network requests, no CDN, no external fonts**,
  total size under ~1.5 MB. Tools may instead be a Python 3 CLI (standard library only) with a README.
- Include in the folder: `README.md` (what it is, how to play/run, controls, the idea, credits), `DESIGN.md`,
  `screenshot.png`, and tests when logic is non-trivial (plain node/python scripts or in-page self-tests).
- Pages URL pattern: `https://phennova.github.io/daily-builds/builds/<folder>/`. GitHub Pages is enabled on `main` (root).
- Screenshot with headless Edge, e.g.
  `"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --disable-gpu --hide-scrollbars --window-size=1280,720 --virtual-time-budget=4000 --screenshot=<abs path>.png file:///<abs path>/index.html`
  View the PNG (vision tool) and confirm it is not blank/broken. For canvas games make sure the screenshot shows real gameplay
  (use a `?demo` or autoplay URL parameter if needed).
- Test it: load in headless Edge (`--dump-dom`, `--enable-logging=stderr`) to catch JS errors; unit-test the core logic.
  Do not claim something works unless you ran it.
- Tooling on this Windows host (bash shell): Python 3.14 (`python`), Edge (path above), git, gh. Node may not be installed:
  do not rely on it unless `node --version` works. No global installs, no system changes, no touching anything outside
  the repo and the state file named in the task.
- Commit small and clearly; push to `origin main`. After pushing, verify Pages: `gh api repos/Phennova/daily-builds/pages/builds/latest`
  (status `built`) and that the live URL returns HTTP 200 (`curl -sI <url>`; allow a minute or two to propagate).
- Update `README.md` index table (append a row: number, date, name, type, link) and `IDEAS.md` (Built list + backlog).

## Communication
- The ONLY messages you send are: (1) the single end-of-build message, (2) one message if you are genuinely blocked.
  No progress chatter.
- End-of-build message, via `hermes send -t telegram "<text>"` with the screenshot attached by including a line
  `MEDIA:C:/absolute/path/screenshot.png` in the text:
  ```
  🛠 Daily build #N: <Name>
  <two-line pitch: what it is and why it's cool>
  ▶ Play/run: <live URL or exact command>
  Code: https://github.com/Phennova/daily-builds/tree/main/builds/<folder>
  MEDIA:C:/.../screenshot.png
  ```
  If the attachment fails, resend the text without MEDIA. Plain, enthusiastic but not gushing; no filler.
- Be honest in the message about limits (e.g. "not tested on iOS Safari", "audio untested"). Never overclaim.

## State file protocol
A state file path is given in the task (e.g. `C:/Users/soren/hermes-projects/daily-builds/today.md`). Keep it current:
```
STATE: IN_PROGRESS | DONE | FAILED
PHASE: ideation | build | polish | ship
NEXT_MODEL: opus | default
IDEA: <slug> - <one line>
FOLDER: builds/YYYY-MM-DD-slug
NOTES: <what the next chunk should do>
```
`NEXT_MODEL: opus` (Claude Opus 5.5, high reasoning) for judgment-heavy chunks: ideation, design, hard debugging,
final quality review. `default` for routine implementation, assets, tests, docs, deployment steps.
Set `STATE: DONE` only after: pushed, Pages verified live, index/IDEAS updated, Telegram message sent.
Set `STATE: FAILED` only if the day's build cannot be completed; push WIP to a branch `wip/<date>`, never leave `main` broken,
and send the blocked message.
