// Greenlist tests: node tests.js   (exit code 1 on failure)
'use strict';
const WM = require('./wm.js');
const NIGHTS = require('./nights.js');
let fails = 0, passes = 0;
function ok(cond, msg) { if (cond) passes++; else { fails++; console.log('FAIL:', msg); } }
const near = (a, b, e = 1e-9) => Math.abs(a - b) < e;

// 1. hashing is deterministic and roughly uniform
ok(WM.fnv1a('abc') === WM.fnv1a('abc'), 'fnv deterministic');
ok(WM.unitHash('k', ['a'], 'b') !== WM.unitHash('k2', ['a'], 'b'), 'key changes hash');
{
  let g = 0; const T = 200000;
  for (let i = 0; i < T; i++) if (WM.isGreen('key' + (i % 7), ['w' + (i % 101)], 't' + i, 0.25)) g++;
  ok(Math.abs(g / T - 0.25) < 0.005, 'green rate ~ gamma, got ' + (g / T));
}

// 2. z-score formula: KGW one-proportion z-test
ok(near(WM.zScore(25, 100, 0.25), 0), 'z=0 at expectation');
ok(near(WM.zScore(50, 100, 0.25), 25 / Math.sqrt(18.75)), 'z hand value');
ok(WM.zScore(0, 0, 0.25) === 0, 'empty text z=0');

// 3. tokenizer
ok(JSON.stringify(WM.words("Don't carry 21:00, SCRIBE!")) === '["don\'t","carry","21","00","scribe"]', 'tokenizer');

// 4. null hypothesis: unwatermarked random text has mean z ~ 0, sd ~ 1
{
  const vocab = 'the a of to and in that is was for on with as by at from this be not or but'.split(' ')
    .concat(Array.from({ length: 400 }, (_, i) => 'w' + i));
  const R = WM.rng(7); const zs = [];
  for (let n = 0; n < 400; n++) {
    const toks = Array.from({ length: 60 }, () => vocab[Math.floor(R() * vocab.length)]);
    const col = WM.colours(toks, 'null-' + n, 1, 0.25);
    zs.push(WM.zScore(col.filter(Boolean).length, toks.length, 0.25));
  }
  const m = zs.reduce((a, b) => a + b) / zs.length;
  const sd = Math.sqrt(zs.reduce((a, b) => a + (b - m) ** 2, 0) / zs.length);
  ok(Math.abs(m) < 0.2 && sd > 0.8 && sd < 1.2, `null z mean ${m.toFixed(3)} sd ${sd.toFixed(3)}`);
}

// 5. template parsing and awkwardness
{
  const p = WM.parseTemplate('A {b|c d|e~|f=5} g.');
  const s = WM.slotsOf(p)[0];
  ok(s.opts.map(o => o.awk).join() === '0,1,3,5', 'awk ranks ' + s.opts.map(o => o.awk).join());
  ok(s.opts[1].toks.length === 2, 'multi-word option');
}

// 6. locality: changing slot j only re-colours tokens within k words after it
for (const k of [1, 2]) {
  const parts = WM.parseTemplate('{x|y|z} {p|q|r} {m|n|o} {s|t|u} {a|b|c} end');
  const cfg = { key: 'loc', k, gamma: 0.5 };
  let okAll = true;
  for (let trial = 0; trial < 200; trial++) {
    const R = WM.rng(trial);
    const c = [0, 1, 2, 3, 4].map(() => Math.floor(R() * 3));
    const j = Math.floor(R() * 5);
    const c2 = c.slice(); c2[j] = (c2[j] + 1 + Math.floor(R() * 2)) % 3;
    const a = WM.evaluate(parts, c, cfg).col, b = WM.evaluate(parts, c2, cfg).col;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && (i < j || i > j + k)) okAll = false;
  }
  ok(okAll, 'edit locality k=' + k);
}

// 7. solver is exact: compare with brute force on small templates
for (const k of [1, 2]) {
  const parts = WM.parseTemplate('So {we|they|you} {must|should|will} {go|run|leave} to the {river|bridge|mill} {now|soon|tonight}.');
  for (let t = 0; t < 6; t++) {
    const cfg = { key: 'bf' + t, k, gamma: 0.25 };
    const base = [1, 0, 2, 0, 1];
    const maxCh = 1 + (t % 4), maxAwk = 3 + t;
    let bestMin = Infinity, bestMax = -Infinity;
    for (let n = 0; n < 243; n++) {
      const c = [0, 1, 2, 3, 4].map(i => Math.floor(n / 3 ** i) % 3);
      const ch = c.filter((v, i) => v !== base[i]).length;
      const ev = WM.evaluate(parts, c, cfg);
      if (ch > maxCh || ev.awk > maxAwk) continue;
      bestMin = Math.min(bestMin, ev.G); bestMax = Math.max(bestMax, ev.G);
    }
    const smin = WM.solve(parts, base, cfg, maxCh, maxAwk, false);
    const smax = WM.solve(parts, base, cfg, maxCh, maxAwk, true);
    ok(smin && smin.ev.G === bestMin, `solver min k=${k} t=${t}: ${smin && smin.ev.G} vs ${bestMin}`);
    ok(smax && smax.ev.G === bestMax, `solver max k=${k} t=${t}: ${smax && smax.ev.G} vs ${bestMax}`);
  }
}

// 8. generation: watermark bias raises z; delta=0 is unbiased
{
  const n = NIGHTS[0], parts = WM.parseTemplate(n.text);
  let zw = 0, z0 = 0;
  for (let s = 0; s < 300; s++) {
    zw += WM.evaluate(parts, WM.generate(parts, n, s, 4).choice, n).z;
    z0 += WM.evaluate(parts, WM.generate(parts, n, s, 0).choice, n).z;
  }
  ok(zw / 300 > 2.5 && Math.abs(z0 / 300) < 0.6, `mean z watermarked ${(zw / 300).toFixed(2)} vs plain ${(z0 / 300).toFixed(2)}`);
}

// 9. perplexity proxy: monotone in awkwardness; all-first-choice is the minimum
{
  const n = NIGHTS[1], parts = WM.parseTemplate(n.text);
  const zero = WM.slotsOf(parts).map(() => 0);
  const p0 = WM.perplexity(parts, zero);
  ok(near(p0, Math.exp(2.2), 1e-9), 'base perplexity');
  const c = zero.slice(); c[3] = 2;
  ok(WM.perplexity(parts, c) > p0, 'awkward option raises perplexity');
}

// 10. every night: draft in band, and solvable within its budget and fluency cap (with slack reported)
for (const n of NIGHTS) {
  const parts = WM.parseTemplate(n.text);
  const g = WM.generateInBand(parts, n, n.delta, n.band[0], n.band[1], n.seed);
  ok(g.ev.z >= n.band[0] && g.ev.z <= n.band[1], `night ${n.id} draft z ${g.ev.z.toFixed(2)} in band`);
  if (n.mode === 'scrub') ok(g.ev.z >= 4, `night ${n.id} draft is flagged MACHINE`);
  const spoof = n.mode === 'spoof';
  let minCh = null, sol = null;
  for (let c = 0; c <= n.maxChanged; c++) {
    const s = WM.solve(parts, g.choice, n, c, n.maxAwk, spoof);
    if (s && (spoof ? s.ev.z >= n.passZ : s.ev.z < n.passZ)) { minCh = c; sol = s; break; }
  }
  ok(minCh !== null, `night ${n.id} solvable within ${n.maxChanged} swaps`);
  if (sol) {
    ok(sol.ev.awk <= n.maxAwk, `night ${n.id} solution fluent`);
    console.log(`  night ${n.id} "${n.title}": ${WM.slotsOf(parts).length} slots, ${g.ev.N} words, draft z=${g.ev.z.toFixed(2)} ` +
      `awk=${g.ev.awk}/${n.maxAwk}; par ${minCh} swaps of ${n.maxChanged} (z ${sol.ev.z.toFixed(2)})`);
  }
}

console.log(`${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
