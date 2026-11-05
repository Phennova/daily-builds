// node tests for disc.js:  node tests.js
'use strict';
var D = require('./disc.js');
var fails = 0, passes = 0;
function ok(cond, msg) { if (cond) { passes++; console.log('  ok  ' + msg); } else { fails++; console.log('FAIL  ' + msg); } }

var rng = D.mulberry32(1234);
var truth = D.randomTruth(rng);
console.log('truth', JSON.stringify(truth));

// synthetic picture: blocky checker + a dark band, enough structure to test
function pic(x, y) {
  var c = ((Math.floor(x / 4) + Math.floor(y / 4)) & 1) ? 0.85 : 0.1;
  if (Math.abs(y - 30) < 3 && Math.abs(x) < 20) c = 1;
  return c;
}
var burn = D.makeBurn(truth, pic, { seed: 7 });

// 1. forward / inverse round trip
(function () {
  var t = { r: 0, th: 0 }, worst = 0;
  for (var i = 0; i < 2000; i++) {
    var n = Math.floor(rng() * burn.nEnd) + 0.5;
    D.forward(truth, n, t);
    var back = D.inverse(truth, t.r, t.th);
    worst = Math.max(worst, Math.abs(back - n));
  }
  ok(worst < 0.01, 'forward/inverse round trip, worst ' + worst.toExponential(2) + ' frames');
  var rEnd = (D.forward(truth, burn.nEnd, t), t.r);
  ok(Math.abs(rEnd - D.R_OUT) < 1e-6, 'nEnd reaches the outer radius (' + rEnd.toFixed(6) + ' mm)');
  var minutes = burn.nEnd / D.FPS / 60;
  ok(minutes > 60 && minutes < 90, 'program length is CD-like: ' + minutes.toFixed(1) + ' min, ' + (burn.nEnd / 1e6).toFixed(1) + 'M frames');
})();

// helper: agreement between decode and the dithered picture sampled directly at pixel centres
function agreement(guess, size) {
  var out = new Float32Array(size * size);
  var t0 = Date.now();
  D.decode(burn, guess, size, 1, out);
  var ms = Date.now() - t0;
  var px = 120 / size, same = 0, tot = 0, i = 0;
  for (var yy = 0; yy < size; yy++) for (var xx = 0; xx < size; xx++, i++) {
    var x = -60 + (xx + 0.5) * px, y = 60 - (yy + 0.5) * px, r = Math.hypot(x, y);
    if (r < truth.r0 + 1 || r > D.R_OUT - 1 || out[i] < 0) continue;
    var want = pic(x, y) > 0.5 ? 1 : 0;
    tot++; if ((out[i] > 0.5 ? 1 : 0) === want) same++;
  }
  return { frac: same / tot, ms: ms };
}
// 2. decoding with the true geometry reproduces the picture
(function () {
  var a = agreement(truth, 300);
  ok(a.frac > 0.85, 'true geometry decodes the picture: ' + (a.frac * 100).toFixed(1) + '% agreement (' + a.ms + ' ms at 300px)');
  var g = Object.assign({}, truth, { v: truth.v * (1 + 1e-4) });
  var b = agreement(g, 300);
  ok(b.frac < 0.65, 'v off by 1e-4 scrambles it: ' + (b.frac * 100).toFixed(1) + '%');
  var g2 = Object.assign({}, truth, { p: truth.p * (1 + 1e-4) });
  var c = agreement(g2, 300);
  ok(c.frac < 0.65, 'p off by 1e-4 scrambles it: ' + (c.frac * 100).toFixed(1) + '%');
  var g3 = Object.assign({}, truth, { v: truth.v * (1 + 2e-7) });
  var d = agreement(g3, 300);
  ok(d.frac > 0.74, 'v off by 2e-7 still reads: ' + (d.frac * 100).toFixed(1) + '%');
  var t1 = Date.now(); var out = new Float32Array(440 * 440); D.decode(burn, truth, 440, 1, out);
  console.log('      decode 440px 1x: ' + (Date.now() - t1) + ' ms');
})();

// 3. twist magnitudes
(function () {
  var tw = D.twist(truth, truth, 26, 57);
  ok(tw < 1e-4, 'zero twist at the truth (' + tw.toExponential(2) + ')');
  var e5 = D.twist(truth, Object.assign({}, truth, { v: truth.v * (1 + 1e-5) }), 26, 57);
  ok(e5 > 0.3 && e5 < 3, 'v error 1e-5 twists by ' + e5.toFixed(2) + ' rad (expected ~1)');
  var rot = D.twist(truth, Object.assign({}, truth, { phi0: truth.phi0 + 0.1 }), 26, 57);
  ok(Math.abs(rot - 0.1) < 0.01, 'phi0 error is a pure rotation: ' + rot.toFixed(4));
  var dr0 = D.twist(truth, Object.assign({}, truth, { r0: truth.r0 + 0.01 }), 26, 57);
  ok(dr0 > 0.5, 'r0 error of 10 um is large: ' + dr0.toFixed(2) + ' rad');
})();

// 4. lag scope finds one revolution
(function () {
  var t = { r: 0, th: 0 }, worst = 0, ms = 0, rd = [];
  [0.08, 0.3, 0.55, 0.85].forEach(function (f) {
    var n0 = Math.floor(burn.nEnd * f);
    var t0 = Date.now(); var m = D.measureLag(burn, n0); ms = Math.max(ms, Date.now() - t0);
    D.forward(truth, m.n, t);
    var want = D.framesPerRev(truth, t.r);
    var err = m.peak ? Math.abs(m.peak.lag - want) : 999;
    worst = Math.max(worst, err);
    console.log('      n=' + m.n + ' r=' + t.r.toFixed(2) + ' want ' + want.toFixed(2) + ' got ' + (m.peak && m.peak.lag.toFixed(2)) + ' corr ' + (m.peak && m.peak.corr.toFixed(2)));
    rd.push({ n: m.n, L: m.peak.lag });
  });
  ok(worst < 0.5, 'lag scope within 0.5 frames of one revolution (worst ' + worst.toFixed(3) + ', ' + ms + ' ms per reading)');
  var est = D.fit(rd, D.NOMINAL, ['v', 'p']);
  var ev = Math.abs(est.v / truth.v - 1), ep = Math.abs(est.p / truth.p - 1);
  ok(ev < 1e-4 && ep < 1e-4, 'fit v,p from nominal: v rel err ' + ev.toExponential(2) + ', p rel err ' + ep.toExponential(2) + ', rms ' + est.rms.toFixed(3));
  var e1 = D.fit([rd[1]], Object.assign({}, truth, { v: 1300 }), ['v']);
  ok(Math.abs(e1.v / truth.v - 1) < 3e-4, 'fit v alone from one reading: rel err ' + Math.abs(e1.v / truth.v - 1).toExponential(2));
  // with noise
  var noisy = D.makeBurn(truth, pic, { seed: 9, noise: 0.12 });
  var m = D.measureLag(noisy, Math.floor(noisy.nEnd * 0.5));
  D.forward(truth, m.n, t);
  ok(m.peak && Math.abs(m.peak.lag - D.framesPerRev(truth, t.r)) < 0.8, 'lag scope survives 12% burn noise (corr ' + (m.peak && m.peak.corr.toFixed(2)) + ')');
})();

// 4b. pitch drift geometry
(function () {
  var g = D.randomTruth(D.mulberry32(77), true), t = { r: 0, th: 0 }, worst = 0;
  console.log('drift truth', JSON.stringify(g));
  var nEnd = D.framesTo(g, D.R_OUT);
  for (var i = 0; i < 2000; i++) {
    var n = Math.floor(rng() * nEnd) + 0.5;
    D.forward(g, n, t);
    worst = Math.max(worst, Math.abs(D.inverse(g, t.r, t.th) - n));
  }
  ok(worst < 0.01, 'drift: forward/inverse round trip, worst ' + worst.toExponential(2));
  var g0 = Object.assign({}, g, { a: 1e-13 }), g00 = Object.assign({}, g, { a: 0 });
  var nn = nEnd * 0.7, t1 = { r: 0, th: 0 }, t2 = { r: 0, th: 0 };
  D.forward(g0, nn, t1); D.forward(g00, nn, t2);
  ok(Math.abs(t1.th - t2.th) < 1e-4, 'tiny drift matches the Archimedean spiral (dth ' + Math.abs(t1.th - t2.th).toExponential(2) + ')');
  var b = D.makeBurn(g, pic, { seed: 3 }), rd = [];
  [0.03, 0.2, 0.4, 0.6, 0.8, 0.95].forEach(function (f) { var m = D.measureLag(b, Math.floor(b.nEnd * f)); rd.push({ n: m.n, L: m.peak.lag }); });
  var ft = D.fit(rd, D.NOMINAL, ['v', 'p', 'a']);
  var prof = [27, 32, 40, 48, 56].map(function (r) { return D.twistAt(g, ft, r); });
  var worstT = Math.max.apply(null, prof.map(Math.abs));
  ok(worstT < 3.5, 'fit v,p,drift from 6 readings leaves twist <= ' + worstT.toFixed(2) + ' rad (profile ' + prof.map(function (x) { return x.toFixed(2); }).join(' ') + '), rms ' + ft.rms.toFixed(3));
  var tz = Math.abs(D.twistAt(g, Object.assign({}, ft, { a: 0 }), 56));
  ok(tz > 10, 'drift matters: dropping it twists the rim by ' + tz.toFixed(0) + ' rad');
  var tw0 = D.twistAt(truth, Object.assign({}, truth, { v: truth.v * (1 + 1e-5) }), 56);
  ok(Math.abs(tw0) > 0.5 && Math.abs(tw0) < 1.5, 'unwrapped twist at the rim for v + 1e-5: ' + tw0.toFixed(2) + ' rad');
})();

// 5. flags and dead-drop links
(function () {
  var a = D.makeFlag(D.mulberry32(5)), b = D.makeFlag(D.mulberry32(5));
  ok(a === b && /^[A-Z]+-\d\d$/.test(a), 'flag deterministic per seed: ' + a);
  ok(D.normFlag(' raven 47 ') === 'RAVEN47' && D.normFlag('RAVEN-47') === 'RAVEN47', 'flag normalisation');
  var code = D.encodeDrop('MEET AT PIER 9 — 0300', 0xdeadbeef);
  var back = D.decodeDrop(code);
  ok(back && back.msg === 'MEET AT PIER 9 — 0300' && back.seed === 0xdeadbeef, 'dead-drop link round trip (' + code + ')');
  ok(D.decodeDrop('!!') === null || D.decodeDrop('x') === null, 'bad links rejected');
})();

console.log('\n' + passes + ' passed, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
