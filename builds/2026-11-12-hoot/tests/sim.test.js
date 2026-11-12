// HOOT - node tests for the logic core. Run: node tests/sim.test.js
const H = require('../sim.js');
let passes = 0, fails = 0;
function ok(c, m) { if (c) { passes++; console.log('  ok  ' + m); } else { fails++; console.log('  FAIL ' + m); } }
const near = (a, b, e) => Math.abs(a - b) <= e;

console.log('machine');
ok(near(H.TAU * 1e6, 318.5, 0.1), 'word time ' + (H.TAU * 1e6).toFixed(2) + ' us');
ok(near(H.freqOf('A4'), 440, 1e-9) && near(H.freqOf('C3'), H.F0, 1e-9), 'note frequencies (A4 = 440, C3 = tank frequency)');
ok(H.hop(5, 5) === 24 && H.hop(5, 6) === 1 && H.hop(23, 0) === 1 && H.hop(6, 5) === 23, 'hop: self = full revolution, next word = 1, wraps');

console.log('loops');
let a = H.analyze([7]);
ok(a.k === 1 && a.R === 1 && near(a.f, H.F0, 1e-9) && a.jitter === 0, 'one self-loop = C3, steady');
a = H.analyze([0, 12]);
ok(a.ratio.join('/') === '2/1' && a.jitter === 0, 'diameter = 2 clicks/rev = C4');
a = H.analyze([0, 8, 16]);
ok(a.ratio.join('/') === '3/1' && a.gaps.join() === '8,8,8', 'triangle walked once = 3/1 (G4)');
a = H.analyze([0, 16, 8]);
ok(a.ratio.join('/') === '3/2' && a.gaps.join() === '16,16,16' && near(H.cents(a.f, H.freqOf('G3')), 1.955, 0.01), 'same triangle with hops of 16 = 3/2 = G3 +1.96 c');
a = H.analyze([0, 19, 14, 9, 4]);
ok(a.ratio.join('/') === '5/4' && a.jitter === 1 && near(H.cents(a.f, H.freqOf('E3')), -13.69, 0.01), 'E3 = 5/4 with gaps 19,19,19,19,20: jitter 1, -13.7 c (just major third)');
a = H.analyze([0, 1]);
ok(a.R === 1 && a.gaps.join() === '1,23' && a.jitter === 22, 'lopsided pair: still 2/1 on average but jitter 22');
let sumOK = true;
for (let t = 0; t < 300; t++) { const k = 1 + (t % 7); const s = new Set(); while (s.size < k) s.add((Math.random() * 24) | 0); const r = H.analyze([...s]); if (r.T % 24) sumOK = false; }
ok(sumOK, 'any closed loop lasts a whole number of revolutions (300 random loops)');
const ct = H.clickTimes([0, 12], 2);
ok(ct.length === 4 && near(ct[1], 12 * H.TAU, 1e-12) && near(ct[3], 36 * H.TAU, 1e-12), 'click times follow the gaps');
ok(H.idealSlots(5, 4, 0).join() === '0,19,14,9,4', 'ideal ghosts for 5/4 from slot 0');
ok(H.idealSlots(3, 2, 2).join() === '2,18,10', 'ideal ghosts for 3/2 from slot 2');

console.log('number theory');
ok(H.patterns(5, 4, 0).length === 0, '5 clicks in 4 laps can never be steady in 24 words');
ok(H.patterns(9, 8, 0).length === 0 && H.patterns(9, 8, 1).length > 0, '9/8 needs a wobble of 1');
ok(H.patterns(6, 1, 0).length === 4 && H.patterns(3, 1, 0).length === 8, 'even hexagons: 4 placements, triangles: 8');

console.log('levels (solver proves par; this is the slow part)');
for (const L of H.LEVELS) {
  const t = Date.now();
  const s = H.solve(L, { Jcap: 4 });
  ok(s && !s.capped && s.maxJ === L.par.maxJ && s.sumJ === L.par.sumJ, `L${L.id} ${L.name}: solver optimum maxJ ${s && s.maxJ}, sumJ ${s && s.sumJ} matches par (${Date.now() - t} ms, ${s && s.nodes} nodes)`);
  if (s && s.layout) {
    const ev = H.evaluate(L, s.layout.map(sl => ({ slots: sl, closed: true })));
    ok(ev.done && ev.stars === 3 && !ev.clash, `L${L.id} solver layout evaluates to 3 stars`);
  }
  for (const n of L.notes) {
    const h = n.hint, f = h[0] / h[1] * H.F0;
    if (!(Math.abs(H.cents(f, H.freqOf(n.name))) <= H.TOL)) ok(false, `L${L.id} hint ${h.join('/')} for ${n.name} in tune`);
  }
  for (const s0 of L.locked) if (s0 < 0 || s0 >= H.N) ok(false, 'locked slot in range');
  ok(L.tune.every(([i, b]) => i >= -1 && i < L.notes.length && b > 0), `L${L.id} tune references valid notes`);
}
const L5 = H.LEVELS[4];
const s5 = H.solve(Object.assign({}, L5, { par: L5.par }), { Jcap: 1 });
ok(s5 === null, 'Taps: no packing with jitter <= 1 exists (proof by exhaustive search)');

console.log('evaluate');
const L4 = H.LEVELS[3];
let ev = H.evaluate(L4, [{ slots: [0], closed: true }, { slots: [0, 19, 14, 9, 4], closed: true }, { slots: [2, 18, 10], closed: true }, { slots: [1, 13], closed: true }]);
ok(ev.clash && !ev.done, 'two notes on one word = clash');
ev = H.evaluate(L4, [{ slots: [5], closed: true }, { slots: [0, 20, 15, 10, 4], closed: true }, { slots: [2, 18, 10], closed: true }, { slots: [1, 13], closed: true }]);
ok(ev.clash, 'note on another note\'s word (10) = clash');
ev = H.evaluate(L4, [{ slots: [5], closed: true }, { slots: [0, 20, 16, 12, 6], closed: true }, { slots: [2, 18, 9], closed: true }, { slots: [1, 13], closed: true }]);
ok(ev.done && ev.stars === 1 && ev.maxJ > 1, 'in tune but wobbly = 1 star (maxJ ' + ev.maxJ + ')');
ev = H.evaluate(L4, [{ slots: [5], closed: true }, { slots: [0, 1, 2], closed: true }, { slots: [2, 18, 10], closed: false }, { slots: [], closed: false }]);
ok(!ev.done && ev.notes[1].a.ratio.join('/') === '3/1' && !ev.notes[1].inTune, 'wrong ratio for E3 is out of tune; open loops are not done');

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
