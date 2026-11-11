// Playability check: with sensible ("intended") filter settings, is every strip solvable?
// For each real feature we measure its signal in the Local Relief Model (LRM, 16 m trend, like the game default)
// against the background noise of the tile, and count how many features stand out. The quota must be reachable
// with margin, and the required features (causeway on Sacbe, pyramid on Cliff Edge) must be visible.
// Also checks the strip's teaching point: the DEFAULT settings are worse than the intended ones where they should be.
// Run: node tests/playable.js
const BE = require('../sim.js');
const { N, CELL } = BE;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  FAIL ' + m); } };

// intended settings (what a player who learned the lesson would use); from tests/tune.js grid search
const INTENDED = { 1: { win: 14, slope: 60 }, 2: { win: 14, slope: 60 }, 3: { win: 14, slope: 50 }, 4: { win: 10, slope: 50 }, 5: { win: 10, slope: 40 } };

function robustStd(a) { // MAD-based std of a sample
  const s = Float32Array.from(a).sort(), med = s[s.length >> 1];
  const d = Float32Array.from(a, v => Math.abs(v - med)).sort();
  return 1.4826 * d[d.length >> 1];
}
function featSignal(f, lrm) {
  // peak signed relief over the footprint core, in the direction the feature should have
  if (f.type === 'causeway') { // mean relief along the centre line (a long feature integrates signal)
    let s = 0, n = 0;
    for (let t = 0.05; t <= 0.95; t += 0.01) {
      const x = f.x0 + (f.x1 - f.x0) * t, y = f.y0 + (f.y1 - f.y0) * t;
      s += lrm[Math.floor(y / CELL) * N + Math.floor(x / CELL)]; n++;
    }
    return s / n;
  }
  const R = Math.max(2, Math.min(f.a || 4, f.b || 4) * 0.5);
  let best = f.type === 'reservoir' ? 1e9 : -1e9;
  for (let y = Math.floor((f.y - R) / CELL); y <= Math.floor((f.y + R) / CELL); y++)
    for (let x = Math.floor((f.x - R) / CELL); x <= Math.floor((f.x + R) / CELL); x++) {
      if (x < 0 || y < 0 || x >= N || y >= N) continue;
      const v = lrm[y * N + x];
      best = f.type === 'reservoir' ? Math.min(best, v) : Math.max(best, v);
    }
  return f.type === 'reservoir' ? -best : best;
}

for (const spec of BE.STRIPS) {
  console.log(`strip ${spec.id} ${spec.name}`);
  const w = BE.makeWorld(spec);
  const good = BE.groundFilter(w, INTENDED[spec.id]);
  const lrm = BE.localRelief(good.dtm, 16);
  // noise floor: robust spread of the relief over the whole tile (features are a small fraction of it)
  const sample = [];
  for (let i = 0; i < N * N; i += 7) sample.push(lrm[i]);
  const noise = Math.max(0.05, robustStd(sample));
  const sig = w.features.map(f => ({ f, s: featSignal(f, lrm) / noise }));
  const visible = sig.filter(o => o.s > (o.f.type === 'causeway' ? 1.5 : 3));
  const weak = sig.filter(o => !visible.includes(o)).map(o => `${o.f.type}#${o.f.id} ${o.s.toFixed(1)}`);
  console.log(`     noise ${noise.toFixed(2)} m, visible ${visible.length}/${w.features.length}` + (weak.length ? `, weak: ${weak.join(', ')}` : ''));
  ok(visible.length >= spec.quota + 1, `quota ${spec.quota} reachable with margin (visible ${visible.length})`);
  for (const f of w.features.filter(f => f.required)) ok(visible.some(o => o.f === f), `required ${f.type} visible (snr ${sig.find(o => o.f === f).s.toFixed(1)})`);
  // the good settings should not behead the pyramid
  for (const p of w.features.filter(f => f.type === 'pyramid')) {
    const sh = BE.sampleMax(w.ground, p) - BE.sampleMax(good.dtm, p);
    ok(sh < 1.5, `pyramid #${p.id} kept (shaved ${sh.toFixed(1)} m)`);
  }
  // teaching points: defaults should be visibly worse where the lesson is about the filter
  if (spec.id === 2 || spec.id === 5) {
    const def = BE.groundFilter(w, spec.defaults);
    const junk = f => { let c = 0; for (let i = 0; i < N * N; i++) if (f.dtm[i] - w.ground[i] > 1) c++; return c; };
    const shave = f => Math.max(0, ...w.features.filter(x => x.type === 'pyramid').map(p => BE.sampleMax(w.ground, p) - BE.sampleMax(f.dtm, p)));
    if (spec.id === 2) ok(junk(def) > 5 * junk(good), `defaults leave much more junk (${junk(def)} vs ${junk(good)} cells)`);
    if (spec.id === 5) ok(shave(def) > 3, `default filter beheads the pyramid (${shave(def).toFixed(1)} m)`);
  }
  // Sacbe: the causeway is (nearly) invisible in the default single hillshade but visible from the side
  if (spec.id === 4) {
    const cw = w.features.find(f => f.type === 'causeway');
    const contrast = az => {
      const h = BE.hillshade(good.dtm, az, 40, 1);
      let s = 0, n = 0;
      for (let t = 0.1; t <= 0.9; t += 0.005) {
        const ang = Math.atan2(cw.y1 - cw.y0, cw.x1 - cw.x0), nx = -Math.sin(ang), ny = Math.cos(ang);
        const x = cw.x0 + (cw.x1 - cw.x0) * t, y = cw.y0 + (cw.y1 - cw.y0) * t;
        const at = (d) => h[Math.floor((y + ny * d) / CELL) * N + Math.floor((x + nx * d) / CELL)];
        s += Math.abs(at(-3) - at(3)); n++; // left flank vs right flank brightness
      }
      return s / n;
    };
    const along = contrast(spec.defaults.az), across = contrast(spec.defaults.az + 90);
    ok(across > 2.5 * along, `causeway flank contrast across-sun ${across.toFixed(3)} vs along-sun ${along.toFixed(3)}`);
  }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
