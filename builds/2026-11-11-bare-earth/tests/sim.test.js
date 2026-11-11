// Bare Earth - node tests for the simulation core. Run: node tests/sim.test.js
const BE = require('../sim.js');
const { N, CELL } = BE;
let fails = 0, passes = 0;
function ok(cond, msg) { if (cond) { passes++; console.log('  ok  ' + msg); } else { fails++; console.log('  FAIL ' + msg); } }
function junk(w, f, thr) { let c = 0; for (let i = 0; i < N * N; i++) if (f.dtm[i] - w.ground[i] > thr) c++; return c; }
function meanErr(w, f) { let e = 0; for (let i = 0; i < N * N; i++) e += Math.abs(f.dtm[i] - w.ground[i]); return e / (N * N); }
const shaved = (w, f, p) => BE.sampleMax(w.ground, p) - BE.sampleMax(f.dtm, p);

console.log('world generation');
const s1a = BE.makeWorld(BE.STRIPS[0]), s1b = BE.makeWorld(BE.STRIPS[0]);
let same = true;
for (let i = 0; i < N * N; i += 97) if (s1a.minZ[i] !== s1b.minZ[i] || s1a.ground[i] !== s1b.ground[i]) { same = false; break; }
ok(same, 'same seed -> identical ground and returns');
ok(s1a.features.length >= 8, 'strip 1 has ' + s1a.features.length + ' scored features');
const s2 = BE.makeWorld(BE.STRIPS[1]);
ok(s2.stats.groundFrac < s1a.stats.groundFrac / 3, `dense canopy: ground returns ${(s2.stats.groundFrac * 100).toFixed(1)}% vs thin ${(s1a.stats.groundFrac * 100).toFixed(1)}%`);
const out = [];
BE.cellReturns(s2, 12345, out);
const out2 = [];
BE.cellReturns(s2, 12345, out2);
ok(out.length > 0 && out.join() === out2.join(), 'per-cell returns are deterministic (profile slices regenerate the same points)');

console.log('ground filter');
const good2 = BE.groundFilter(s2, { win: 14, slope: 60 });
const bad2 = BE.groundFilter(s2, s2.spec.defaults);
ok(junk(s2, bad2, 1) > 10000, 'strip 2 default (small window, loose slope) leaves understory junk: ' + junk(s2, bad2, 1) + ' cells > 1 m');
ok(junk(s2, good2, 1) < 600, 'strip 2 tuned filter removes it: ' + junk(s2, good2, 1) + ' cells > 1 m');
ok(meanErr(s2, good2) < 0.15, 'tuned DTM mean error ' + meanErr(s2, good2).toFixed(3) + ' m');
const pyr2 = s2.features.find(f => f.type === 'pyramid');
ok(shaved(s2, good2, pyr2) < 1.5, 'tuned filter keeps the pyramid (shaved ' + shaved(s2, good2, pyr2).toFixed(2) + ' m)');
const s5 = BE.makeWorld(BE.STRIPS[4]);
const pyr5 = s5.features.find(f => f.type === 'pyramid');
const bad5 = BE.groundFilter(s5, s5.spec.defaults);
ok(shaved(s5, bad5, pyr5) > 6, 'strip 5 aggressive filter beheads the pyramid by ' + shaved(s5, bad5, pyr5).toFixed(1) + ' m');
const good5 = BE.groundFilter(s5, { win: 10, slope: 40 });
ok(shaved(s5, good5, pyr5) < 1.5, 'strip 5 gentler filter keeps it (shaved ' + shaved(s5, good5, pyr5).toFixed(2) + ' m)');

console.log('morphology');
const spike = new Float32Array(N * N);
spike[200 * N + 200] = 10;
for (let x = 50; x < 60; x++) for (let y = 50; y < 60; y++) spike[y * N + x] = 5;
const op = BE.open(spike, 2);
ok(op[200 * N + 200] === 0, 'opening removes a 1-cell spike');
ok(op[55 * N + 55] === 5, 'opening keeps a 10x10 block with a 5x5 window');
const op6 = BE.open(spike, 6);
ok(op6[55 * N + 55] === 0, 'opening removes the block with a 13x13 window');

console.log('visualisations');
// synthetic: flat ground with a NW-SE causeway through the centre
const flat = new Float32Array(N * N);
const cw = BE.causeway(200, 200, 600, 600, 4.5, 0.8);
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) flat[y * N + x] = 50 + cw.add((x + 0.5) * CELL, (y + 0.5) * CELL);
function contrast(h) { // spread of shade across the causeway near its middle
  let mn = 9, mx = -9;
  for (let d = -8; d <= 8; d++) { const x = 200 + d, y = 200 - d; const v = h[y * N + x]; mn = Math.min(mn, v); mx = Math.max(mx, v); }
  return mx - mn;
}
const along = contrast(BE.hillshade(flat, 315, 40)), across = contrast(BE.hillshade(flat, 45, 40));
ok(along < across / 5, `hillshade blind spot: sun along causeway contrast ${along.toFixed(3)}, across ${across.toFixed(3)}`);
const multi = contrast(BE.multiHillshade(flat, 40));
ok(multi > 0.05, 'multi-directional hillshade still shows it: ' + multi.toFixed(3));
const svf = BE.skyView(flat, 12, 16);
ok(svf[200 * N + 190] < svf[50 * N + 350] - 0.002 || svf[200 * N + 200] >= svf[50 * N + 350] - 0.001, 'sky-view factor runs and is <= 1 off-feature: ' + svf[50 * N + 350].toFixed(3));
// LRM: cone hill + small mound
const hill = new Float32Array(N * N);
const cn = BE.cone(300, 300, 40, 20, 5), md = BE.platform('mound', 600, 300, 5, 5, 1, 0, 2);
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const xm = (x + 0.5) * CELL, ym = (y + 0.5) * CELL; hill[y * N + x] = 40 + cn.add(xm, ym) + md.add(xm, ym); }
const lrm = BE.localRelief(hill, 20);
ok(lrm[150 * N + 300] > 0.5, 'LRM keeps a 1 m mound: ' + lrm[150 * N + 300].toFixed(2) + ' m');
let cmax = 0; for (let x = 110; x < 190; x++) cmax = Math.max(cmax, Math.abs(lrm[150 * N + x]));
ok(cmax < 0.35 * 20, 'LRM shrinks a 20 m cone to a ' + cmax.toFixed(1) + ' m residual');

console.log('profile + scoring');
const pr = BE.profile(s2, good2, [pyr2.x - 60, pyr2.y], [pyr2.x + 60, pyr2.y]);
ok(pr.pts.length > 100 && pr.dtm.length > 50, 'profile slice has ' + pr.pts.length + ' points');
ok(pr.pts.some(p => p.ground) && pr.pts.some(p => !p.ground), 'profile has ground and vegetation points');
const feats = s2.features;
const pins = feats.slice(0, 4).map(f => ({ x: f.x, y: f.y, type: f.type }));
pins.push({ x: feats[0].x + 1, y: feats[0].y, type: 'pyramid' }); // duplicate
const tt = s2.decoys.find(d => d.type === 'treethrow');
pins.push({ x: tt.x, y: tt.y, type: 'mound' });
const sc = BE.score(s2, good2, pins);
ok(sc.hits.length === 4 && sc.dups.length === 1, 'hits ' + sc.hits.length + ', dups ' + sc.dups.length);
ok(sc.fps.length === 1 && sc.fps[0].kind === 'treethrow', 'tree-throw pin explained as ' + (sc.fps[0] && sc.fps[0].kind));
// artefact pin: find worst junk cell under the bad filter, far from features
let wi = -1, wv = 0;
for (let i = 0; i < N * N; i++) {
  const v = bad2.dtm[i] - s2.ground[i];
  if (v > wv) { const x = (i % N + 0.5) * CELL, y = ((i / N | 0) + 0.5) * CELL; if (s2.features.every(f => BE.featDist(f, x, y) > f.r + 5) && s2.decoys.every(d => BE.featDist(d, x, y) > d.r + 5)) { wv = v; wi = i; } }
}
const sa = BE.score(s2, bad2, [{ x: (wi % N + 0.5) * CELL, y: ((wi / N | 0) + 0.5) * CELL, type: 'mound' }]);
ok(sa.fps[0].kind === 'artefact', 'pin on a filter artefact is explained as one');
const pyrPin = BE.score(s5, bad5, [{ x: pyr5.x, y: pyr5.y, type: 'pyramid' }]);
ok(pyrPin.hits[0].shaved > 6 && /shaved/.test(pyrPin.hits[0].note), 'debrief notes the beheaded pyramid');
const all = BE.score(s1a, BE.groundFilter(s1a, s1a.spec.defaults), s1a.features.map(f => ({ x: f.x, y: f.y, type: f.type })));
ok(all.pass && all.grade === 'A+', 'perfect report passes with A+');
ok(!BE.score(s1a, null, []).pass, 'empty report fails');

console.log('strips + random');
for (const sp of BE.STRIPS) {
  const w = sp === BE.STRIPS[0] ? s1a : sp === BE.STRIPS[1] ? s2 : sp === BE.STRIPS[4] ? s5 : BE.makeWorld(sp);
  ok(w.features.length >= sp.quota + 2, `${sp.name}: ${w.features.length} features, quota ${sp.quota}`);
}
for (const seed of [1, 2, 3]) {
  const w = BE.makeWorld(BE.randomSpec(seed));
  ok(w.features.length >= 6 && w.features.some(f => f.type === 'pyramid'), 'random survey ' + seed + ': ' + w.features.length + ' features');
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
