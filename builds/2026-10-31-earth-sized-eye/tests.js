// node tests.js  -- unit tests for the imaging core
'use strict';
const I = require('./imaging.js');
const N = I.N;
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('  ok  ' + msg); } else { fail++; console.log('  FAIL ' + msg); } }
function approx(a, b, tol) { return Math.abs(a - b) <= tol; }

// 1. FFT round trip and agreement with a direct DFT
{
  const n = 16, re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = Math.sin(i * 1.3) + (i % 3);
  const r0 = Float64Array.from(re);
  I.fft1d(re, im, n, false);
  let maxErr = 0;
  for (let k = 0; k < n; k++) {
    let sr = 0, si = 0;
    for (let t = 0; t < n; t++) { sr += r0[t] * Math.cos(-2 * Math.PI * k * t / n); si += r0[t] * Math.sin(-2 * Math.PI * k * t / n); }
    maxErr = Math.max(maxErr, Math.abs(sr - re[k]), Math.abs(si - im[k]));
  }
  ok(maxErr < 1e-9, 'fft1d matches direct DFT (err ' + maxErr.toExponential(1) + ')');
  I.fft1d(re, im, n, true);
  let rt = 0; for (let i = 0; i < n; i++) rt = Math.max(rt, Math.abs(re[i] - r0[i]), Math.abs(im[i]));
  ok(rt < 1e-9, 'fft1d inverse round trip');
}

// 2. Full coverage reproduces the image exactly (no noise)
const ring = I.Targets.ring({ r: 21, w: 4, a: 0.6, pa: 200 });
{
  const vis = I.visibilities(ring);
  const fake = { count: new Float64Array(N * N).fill(1), ivar: new Float64Array(N * N).fill(1e30), seed: 1 };
  const d = I.makeDirty(fake, vis);
  let err = 0, mx = 0;
  for (let i = 0; i < N * N; i++) { err = Math.max(err, Math.abs(d.dirty[i] - ring[i])); mx = Math.max(mx, ring[i]); }
  ok(err < 1e-9 * mx + 1e-12, 'full uv coverage gives back the true image');
  ok(approx(d.beam[(N / 2) * N + N / 2], 1, 1e-9), 'dirty beam peak is 1 at centre');
}

// Sites (subset of the game's list)
const S = {
  ALMA: { name: 'ALMA', lat: -23.029, lon: -67.755, alt: 5070, diam: 73 },
  SPT: { name: 'SPT', lat: -89.99, lon: -45, alt: 2816, diam: 10 },
  SMA: { name: 'SMA', lat: 19.824, lon: -155.478, alt: 4080, diam: 15 },
  LMT: { name: 'LMT', lat: 18.986, lon: -97.315, alt: 4593, diam: 50 },
  IRAM: { name: 'IRAM', lat: 37.066, lon: -3.393, alt: 2850, diam: 30 },
  NOEMA: { name: 'NOEMA', lat: 44.634, lon: 5.907, alt: 2550, diam: 52 },
  SMT: { name: 'SMT', lat: 32.702, lon: -109.891, alt: 3185, diam: 10 },
  GLT: { name: 'GLT', lat: 76.535, lon: -68.686, alt: 100, diam: 12 },
  EQ1: { name: 'EQ1', lat: 0, lon: 0, alt: 0, diam: 20 },
  EQ2: { name: 'EQ2', lat: 0, lon: 60, alt: 0, diam: 20 },
};

// 3. Elevation: South Pole sees Sgr A* (dec -29) at ~29 deg all day, never M87* (dec +12)
{
  let mn = 90, mx = -90, m87 = -90;
  for (let h = 0; h < 24; h += 0.5) {
    const th = 2 * Math.PI * h / I.SIDEREAL_DAY_H;
    const e = I.elevationDeg(S.SPT, th, -29.0);
    mn = Math.min(mn, e); mx = Math.max(mx, e);
    m87 = Math.max(m87, I.elevationDeg(S.SPT, th, 12.4));
  }
  ok(approx(mn, 29, 0.6) && approx(mx, 29, 0.6), 'South Pole sees Sgr A* at constant ~29 deg (' + mn.toFixed(1) + '..' + mx.toFixed(1) + ')');
  ok(m87 < 0, 'South Pole never sees M87* (max el ' + m87.toFixed(1) + ')');
}

// 4. An east-west baseline traces an ellipse with axis ratio |sin dec| centred on the origin
{
  const dec = 40;
  const p1 = I.siteECEF(S.EQ1), p2 = I.siteECEF(S.EQ2);
  let umax = 0, vmax = 0, vmin = 0;
  for (let h = 0; h < 24; h += 0.1) {
    const th = 2 * Math.PI * h / I.SIDEREAL_DAY_H;
    const c = Math.cos(th), s = Math.sin(th);
    const a = [c * p1[0] - s * p1[1], s * p1[0] + c * p1[1], p1[2]];
    const b = [c * p2[0] - s * p2[1], s * p2[0] + c * p2[1], p2[2]];
    const uv = I.uvOf(a, b, dec);
    umax = Math.max(umax, Math.abs(uv[0])); vmax = Math.max(vmax, uv[1]); vmin = Math.min(vmin, uv[1]);
  }
  ok(approx(vmax / umax, Math.sin(40 * Math.PI / 180), 0.01) && approx(vmax, -vmin, umax * 0.01),
    'E-W baseline uv track is an origin-centred ellipse with axis ratio sin(dec) (' + (vmax / umax).toFixed(3) + ')');
  const L = Math.hypot(p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]);
  ok(approx(umax, L / I.LAMBDA, L / I.LAMBDA * 0.01), 'track semi-major axis = baseline length / lambda');
}

// 5. Fringes: a single (short-ish) baseline's dirty beam is striped perpendicular to the baseline direction
{
  const obs = new I.Observation([S.IRAM, S.NOEMA], 12.4, { noiseScale: 0 });
  obs.advance(0.25, 0.25); // one snapshot (if visible)
  let t = 0.25; while (!obs.nSamples && t < 24) { t += 0.25; obs.advance(t, 0.25); }
  const d = I.makeDirty(obs, I.visibilities(ring));
  const smp = obs.samples[0];
  // move along the fringe direction (perpendicular to uv vector): beam stays ~1
  const ang = Math.atan2(smp.v, smp.u), px = -Math.sin(ang), py = Math.cos(ang);
  const c = N / 2; let minAlong = 1;
  for (let k = 1; k < 30; k++) {
    const x = Math.round(c + px * k), y = Math.round(c - py * k);
    minAlong = Math.min(minAlong, d.beam[y * N + x]);
  }
  ok(obs.nSamples > 0 && minAlong > 0.7, 'single-baseline beam is constant along fringes (min ' + minAlong.toFixed(2) + ')');
}

// 6. Fidelity grows with array size: 2 sites < 5 sites < 8 sites; CLEAN improves on dirty
function runArray(sites, dec, truth, weather) {
  const obs = new I.Observation(sites, dec, { seed: 7, weather });
  obs.advance(24, 0.1);
  const d = I.makeDirty(obs, I.visibilities(truth));
  const st = I.cleanStart(d);
  I.cleanStep(st, 3000, 0.1, 0.03);
  const beam = I.fitBeam(obs);
  const restored = I.restore(st, beam);
  return { obs, dirtyF: I.fidelity(d.dirty, truth), cleanF: I.fidelity(restored, truth), iters: st.iter, beam };
}
{
  const m87 = I.Targets.ring({ r: 21, w: 4, a: 0.7, pa: 190 });
  const a2 = runArray([S.ALMA, S.LMT], 12.4, m87);
  const a5 = runArray([S.ALMA, S.LMT, S.SMA, S.IRAM, S.GLT], 12.4, m87);
  const a8 = runArray([S.ALMA, S.LMT, S.SMA, S.IRAM, S.GLT, S.NOEMA, S.SMT, S.SPT], 12.4, m87);
  console.log('    fidelity dirty/clean: 2 sites ' + a2.dirtyF.toFixed(3) + '/' + a2.cleanF.toFixed(3) +
    ', 5 sites ' + a5.dirtyF.toFixed(3) + '/' + a5.cleanF.toFixed(3) + ', 8 sites ' + a8.dirtyF.toFixed(3) + '/' + a8.cleanF.toFixed(3) +
    ' (5-site beam sd ' + Math.sqrt(a5.beam.sxx).toFixed(1) + 'x' + Math.sqrt(a5.beam.syy).toFixed(1) + ', clean iters ' + a8.iters + ', beam sd ' + Math.sqrt(a8.beam.sxx).toFixed(1) + 'x' + Math.sqrt(a8.beam.syy).toFixed(1) + ' px)');
  ok(a2.cleanF < a5.cleanF && a5.cleanF <= a8.cleanF + 0.02, 'more sites -> better fidelity');
  ok(a5.cleanF > a5.dirtyF, 'CLEAN improves over the dirty image');
  // clouds hurt
  const cloudy = runArray([S.ALMA, S.LMT, S.SMA, S.IRAM, S.GLT], 12.4, m87, [[[0, 24]], [], [], [[0, 24]], []]);
  ok(cloudy.cleanF < a5.cleanF, 'clouding out ALMA + IRAM lowers fidelity (' + cloudy.cleanF.toFixed(3) + ')');
}

// 7. CLEAN finds a point source where it is
{
  const pt = new Float64Array(N * N); const px = 70, py = 50; pt[py * N + px] = 1;
  const obs = new I.Observation([S.ALMA, S.LMT, S.SMA, S.IRAM, S.SMT], 12.4, { noiseScale: 0, seed: 3 });
  obs.advance(24, 0.1);
  const st = I.cleanStart(I.makeDirty(obs, I.visibilities(pt)));
  I.cleanStep(st, 200, 0.1, 0.01);
  let best = 0, bi = 0; for (let i = 0; i < N * N; i++) if (st.comps[i] > best) { best = st.comps[i]; bi = i; }
  ok(bi === py * N + px, 'CLEAN puts the brightest component on the point source');
}

// 8. Orbital dish adds long baselines and sharpens the beam
{
  const sat = { name: 'Orbiter', diam: 10, orbit: { radius: 3.2 * I.R_EARTH, periodH: 12, inc: 60, phase: 0.5, raan: 30 } };
  const ground = [S.ALMA, S.LMT, S.SMA, S.IRAM, S.SPT];
  const g = new I.Observation(ground, -29, { noiseScale: 0 }); g.advance(24, 0.1);
  const o = new I.Observation(ground.concat([sat]), -29, { noiseScale: 0 }); o.advance(24, 0.1);
  const bg = I.fitBeam(g), bo = I.fitBeam(o);
  let maxG = 0, maxO = 0;
  for (const s of g.samples) maxG = Math.max(maxG, Math.hypot(s.u, s.v));
  for (const s of o.samples) maxO = Math.max(maxO, Math.hypot(s.u, s.v));
  ok(maxO > 1.8 * maxG, 'orbiter baselines exceed Earth (' + (maxO / 1e9).toFixed(1) + ' vs ' + (maxG / 1e9).toFixed(1) + ' Glambda)');
  ok(bo.sxx * bo.syy < bg.sxx * bg.syy, 'orbiter sharpens the restoring beam');
}

// 9. Halloween targets are non-empty and distinguishable from each other
{
  const p = I.Targets.pumpkin({}), gh = I.Targets.ghost({}), bt = I.Targets.bat({});
  ok(I.ncc(p, gh) < 0.8 && I.ncc(p, bt) < 0.8 && I.ncc(gh, bt) < 0.8, 'pumpkin/ghost/bat differ (ncc ' +
    [I.ncc(p, gh), I.ncc(p, bt), I.ncc(gh, bt)].map(x => x.toFixed(2)).join(', ') + ')');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
