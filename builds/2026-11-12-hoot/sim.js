// HOOT - pure logic (no DOM). Browser: window.HOOT, node: require('./sim.js').
// A toy delay-line computer: one mercury tank of N words circulating past a read head.
// Every instruction is a HOOT (one click). After the instruction at slot a, the next instruction at slot b
// is fetched hop(a, b) = ((b - a - 1) mod N) + 1 word-times later. A note is a closed loop of instructions.
(function (root) {
  'use strict';

  const N = 24;                       // words in the tank
  const F0 = 130.8127826502993;       // tank frequency = one revolution per C3 period (Hz)
  const TAU = 1 / (N * F0);           // word time (s), ~318.5 us
  const TOL = 20;                     // cents: "in tune"

  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  function midiOf(name) {
    const m = /^([A-G]#?)(-?\d)$/.exec(name);
    if (!m) throw new Error('bad note ' + name);
    return NOTE_NAMES.indexOf(m[1]) + 12 * (+m[2] + 1);
  }
  const freqOf = name => 440 * Math.pow(2, (midiOf(name) - 69) / 12);
  const cents = (f, target) => 1200 * Math.log2(f / target);
  function nearestNote(f) {
    const midi = Math.round(69 + 12 * Math.log2(f / 440));
    const name = NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
    return { name, cents: cents(f, 440 * Math.pow(2, (midi - 69) / 12)) };
  }
  const gcd = (a, b) => { while (b) { [a, b] = [b, a % b]; } return a; };
  const mod = (a, n) => ((a % n) + n) % n;
  const hop = (a, b) => mod(b - a - 1, N) + 1;

  // Analyse a loop given as the ordered list of slots it visits (closed: last jumps back to first).
  function analyze(slots) {
    const k = slots.length;
    if (!k) return null;
    const gaps = slots.map((s, i) => hop(s, slots[(i + 1) % k]));
    const T = gaps.reduce((a, b) => a + b, 0);   // words; always a multiple of N
    const R = T / N;
    const g = gcd(k, R);
    const f = (k / R) * F0;
    const mx = Math.max(...gaps), mn = Math.min(...gaps);
    return { k, R, T, gaps, ratio: [k / g, R / g], f, jitter: mx - mn, mean: T / k, maxGap: mx, minGap: mn };
  }

  // Click times (seconds) for `reps` passes of a loop, starting at its first instruction at t=0.
  function clickTimes(slots, reps) {
    const a = analyze(slots); if (!a) return [];
    const out = []; let t = 0;
    for (let r = 0; r < reps; r++) for (const gp of a.gaps) { out.push(t * TAU); t += gp; }
    return out;
  }

  // Ideal (most even) positions for k clicks in R laps starting at slot s0: hint ghosts.
  function idealSlots(k, R, s0) {
    const T = N * R, out = [];
    for (let i = 0; i < k; i++) out.push(mod(s0 + Math.floor(i * T / k + 1e-9), N));
    return out;
  }

  // Candidate ratios k/R (lowest terms, k <= kMax) within tol cents of a target frequency.
  function ratiosFor(target, tol, kMax) {
    const out = [];
    for (let k = 1; k <= kMax; k++) for (let R = 1; R <= k; R++) {
      if (gcd(k, R) !== 1) continue;
      const c = cents(k / R * F0, target);
      if (Math.abs(c) <= tol) out.push({ k, R, c });
    }
    return out;
  }

  // All slot sets for k clicks in R laps whose gap sequence has jitter <= J. Map key -> {set, jitter, order}.
  function patterns(k, R, J) {
    const T = N * R, g = T / k;
    const lo = Math.max(1, Math.ceil(g) - J), hi = Math.min(N, Math.floor(g) + J);
    const out = new Map();
    const gs = [];
    (function rec(sum, mn, mx) {
      if (gs.length === k) {
        if (sum !== T || mx - mn > J) return;
        for (let off = 0; off < N; off++) {
          let t = 0; const s = [];
          for (const x of gs) { s.push((off + t) % N); t += x; }
          const set = new Set(s); if (set.size < k) continue;
          const key = [...set].sort((a, b) => a - b).join(',');
          const prev = out.get(key);
          if (!prev || prev.jitter > mx - mn) out.set(key, { set: [...set], jitter: mx - mn, order: s });
        }
        return;
      }
      const left = k - gs.length - 1;
      for (let x = lo; x <= hi; x++) {
        if (sum + x + left * lo > T) break;
        if (sum + x + left * hi < T) continue;
        const nmn = Math.min(mn, x), nmx = Math.max(mx, x);
        if (nmx - nmn > J) continue;
        gs.push(x); rec(sum + x, nmn, nmx); gs.pop();
      }
    })(0, Infinity, -Infinity);
    return [...out.values()];
  }

  // Solver for a level: minimise (max jitter, then total jitter) over ratio choices and packings.
  // Returns { maxJ, sumJ, layout: [slots per note] } or null if unsolvable within J <= Jcap.
  function solve(level, opts) {
    opts = opts || {};
    const Jcap = opts.Jcap != null ? opts.Jcap : 4, kMax = opts.kMax || 12;
    for (let J = 0; J <= Jcap; J++) {
      const cands = level.notes.map(n => {
        const list = [];
        for (const r of ratiosFor(freqOf(n.name), level.tol || TOL, kMax)) for (const p of patterns(r.k, r.R, J)) list.push(p);
        list.sort((a, b) => a.jitter - b.jitter || a.set.length - b.set.length);
        return list;
      });
      // order notes by fewest candidates first (faster pruning)
      const idx = cands.map((c, i) => i).sort((a, b) => cands[a].length - cands[b].length);
      const used = new Uint8Array(N); for (const s of level.locked || []) used[s] = 1;
      let best = null; const pick = new Array(level.notes.length);
      let nodes = 0;
      (function rec(d, sumJ) {
        if (best && sumJ >= best.sumJ) return;
        if (++nodes > (opts.nodeCap || 4e6)) return;
        if (d === idx.length) { best = { maxJ: J, sumJ, layout: pick.map(p => p.order.slice()) }; return; }
        const i = idx[d];
        for (const p of cands[i]) {
          if (best && sumJ + p.jitter >= best.sumJ) continue;
          let clash = false; for (const s of p.set) if (used[s]) { clash = true; break; }
          if (clash) continue;
          for (const s of p.set) used[s] = 1;
          pick[i] = p; rec(d + 1, sumJ + p.jitter);
          for (const s of p.set) used[s] = 0;
        }
      })(0, 0);
      if (best) { best.nodes = nodes; best.capped = nodes > (opts.nodeCap || 4e6); return best; }
      if (nodes > (opts.nodeCap || 4e6)) return { capped: true, maxJ: null };
    }
    return null;
  }

  // Validate a player's layout for a level: [{slots:[...]}, ...] in note order.
  function evaluate(level, layout) {
    const occ = new Map();
    for (const s of level.locked || []) occ.set(s, 'locked');
    const notes = level.notes.map((n, i) => {
      const slots = (layout[i] && layout[i].slots) || [];
      const closed = !!(layout[i] && layout[i].closed);
      const a = closed ? analyze(slots) : null;
      const target = freqOf(n.name);
      const c = a ? cents(a.f, target) : null;
      return { name: n.name, target, closed, a, cents: c, inTune: a ? Math.abs(c) <= (level.tol || TOL) : false, steady: a ? a.jitter <= level.par.maxJ : false };
    });
    let clash = false;
    layout.forEach((l, i) => (l.slots || []).forEach(s => { if (occ.has(s)) clash = true; occ.set(s, i); }));
    const done = notes.every(n => n.closed && n.inTune) && !clash;
    const maxJ = done ? Math.max(...notes.map(n => n.a.jitter)) : null;
    const sumJ = done ? notes.reduce((a, n) => a + n.a.jitter, 0) : null;
    let stars = 0;
    if (done) { stars = 1; if (maxJ <= level.par.maxJ) stars = 2; if (stars === 2 && sumJ <= level.par.sumJ) stars = 3; }
    return { notes, done, clash, maxJ, sumJ, stars, free: N - occ.size };
  }

  // Levels. tune: [noteIndex, beats] ; bpm = beats per minute. par: solver optimum (checked by tests).
  const LEVELS = [
    {
      id: 1, name: 'Operator call', notes: [{ name: 'C3', hint: [1, 1] }], locked: [], bpm: 90,
      tune: [[0, 1], [-1, 0.5], [0, 1], [-1, 0.5], [0, 2]],
      brief: 'The hooter was fitted to call the operator. One instruction that points at itself clicks once per revolution of the tank: 130.8 times a second, the note C3. Tap a word to put a HOOT there, then tap it again to close the loop.',
      par: { maxJ: 0, sumJ: 0 }
    },
    {
      id: 2, name: 'Octaves', notes: [{ name: 'C3', hint: [1, 1] }, { name: 'C4', hint: [2, 1] }, { name: 'C5', hint: [4, 1] }], locked: [], bpm: 100,
      tune: [[0, 1], [1, 1], [2, 1], [1, 1], [0, 2]],
      brief: 'Pitch is clicks per revolution. Two HOOTs half a tank apart click twice per turn: an octave up. Four, a quarter apart: two octaves. Uneven spacing makes the note wobble, so keep the gaps equal. Notes cannot share a word.',
      par: { maxJ: 0, sumJ: 0 }
    },
    {
      id: 3, name: 'Same triangle, twice', notes: [{ name: 'C4', hint: [2, 1] }, { name: 'G4', hint: [3, 1] }, { name: 'G3', hint: [3, 2] }], locked: [5, 17], bpm: 96,
      tune: [[0, 1], [2, 1], [0, 1], [1, 2], [2, 1], [0, 2]],
      brief: 'Three HOOTs 8 words apart walk a triangle once per turn: 3 clicks per revolution, G4. Walk a triangle with hops of 16 instead and it takes two turns to come home: 3 clicks per 2 revolutions, a fifth above C3, G3. The ratio is clicks : laps.',
      par: { maxJ: 0, sumJ: 0 }
    },
    {
      id: 4, name: "Hill's compromise", notes: [{ name: 'C3', hint: [1, 1] }, { name: 'E3', hint: [5, 4] }, { name: 'G3', hint: [3, 2] }, { name: 'C4', hint: [2, 1] }], locked: [3, 11, 19], bpm: 100,
      tune: [[0, 1], [1, 1], [2, 1], [3, 2], [2, 1], [1, 1], [0, 2]],
      brief: 'E3 is 5 clicks in 4 laps: a gap of 19.2 words. Words are whole, so the gaps must be 19, 19, 19, 19, 20. Geoff Hill hit the same wall on CSIRAC and built his loops from uneven waits. A wobble of one word is the best anyone can do here.',
      par: { maxJ: 1, sumJ: 1 }
    },
    {
      id: 5, name: 'Taps', notes: [{ name: 'G4', hint: [3, 1] }, { name: 'C5', hint: [4, 1] }, { name: 'E5', hint: [5, 1] }, { name: 'G5', hint: [6, 1] }], locked: [0, 9, 17], bpm: 66,
      tune: [[0, 0.75], [0, 0.25], [1, 2.5], [-1, 0.5],
             [0, 0.75], [1, 0.25], [2, 2], [-1, 0.25], [0, 0.75], [1, 0.25], [2, 2], [-1, 0.25], [0, 0.75], [1, 0.25], [2, 2], [-1, 0.5],
             [0, 0.75], [1, 0.25], [2, 1.5], [1, 0.75], [2, 0.25], [3, 1.5], [2, 1], [1, 1], [0, 2], [-1, 0.25],
             [0, 0.75], [0, 0.25], [1, 3]],
      brief: 'A bugle can only play the harmonic series. So can a delay line: 3, 4, 5 and 6 clicks per revolution are G4, C5, E5, G5, exactly the notes of Taps. But 24 words will not hold all four evenly. Find the least bad packing.',
      par: { maxJ: 2, sumJ: 4 }
    },
    {
      id: 6, name: 'Frere Jacques', notes: [{ name: 'C3', hint: [1, 1] }, { name: 'D3', hint: [9, 8] }, { name: 'E3', hint: [5, 4] }, { name: 'F3', hint: [4, 3] }, { name: 'G3', hint: [3, 2] }], locked: [0, 12], bpm: 112,
      tune: [[0, 1], [1, 1], [2, 1], [0, 1], [0, 1], [1, 1], [2, 1], [0, 1], [2, 1], [3, 1], [4, 2], [2, 1], [3, 1], [4, 2]],
      brief: 'Five notes, twenty-two words, a tank with two words already taken: it is completely full. D3 needs 9 clicks in 8 laps. Pack it all, keep it in tune, then cut it to acetate like the BBC did with the Ferranti Mark 1 in 1951.',
      par: { maxJ: 2, sumJ: 6 }
    }
  ];

  const HOOT = { N, F0, TAU, TOL, NOTE_NAMES, midiOf, freqOf, cents, nearestNote, gcd, mod, hop, analyze, clickTimes, idealSlots, ratiosFor, patterns, solve, evaluate, LEVELS };
  if (typeof module !== 'undefined' && module.exports) module.exports = HOOT;
  else root.HOOT = HOOT;
})(this);
