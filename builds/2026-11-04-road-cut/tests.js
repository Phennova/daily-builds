// Road Cut - model tests. Run: node tests.js        (quick: ~100 seeds per level)
//                               node tests.js --full (300 seeds per level)
'use strict';
var G = require('./geo.js');
var full = process.argv.indexOf('--full') >= 0;
var SEEDS = full ? 300 : 100;
var fails = 0, passes = 0;
function ok(cond, msg) { if (cond) passes++; else { fails++; console.log('FAIL: ' + msg); } }
function near(a, b, eps) { return Math.abs(a - b) <= (eps || 1e-6); }
function flat(level, kind) { return { kind: kind || 'surface', level: level, a1: 0, l1: 1, p1: 0, a2: 0, l2: 1, p2: 0, animTop: level + 100 }; }
var s = G.newSample();

// ---- RNG determinism ----
(function () {
  var a = G.makeRng('x'), b = G.makeRng('x'), c = G.makeRng('y'), same = true, diff = false;
  for (var i = 0; i < 50; i++) { var va = a.next(), vb = b.next(), vc = c.next(); if (va !== vb) same = false; if (va !== vc) diff = true; if (va < 0 || va >= 1) same = false; }
  ok(same, 'rng is deterministic and in [0,1)'); ok(diff, 'different seeds differ');
  var p1 = G.generate('det', 5), p2 = G.generate('det', 5);
  ok(JSON.stringify(p1.events) === JSON.stringify(p2.events), 'generate is deterministic');
})();

// ---- evaluation sanity on hand-built worlds ----
(function () {
  // stacked deposits read bottom-up, surface makes air
  var ev = [{ kind: 'basement', level: 20, rock: 'gneiss' },
    { kind: 'deposit', rock: 'sandstone', level: 50, animFrom: 20, animTo: 50 },
    { kind: 'deposit', rock: 'shale', level: Infinity, animFrom: 50, animTo: 110 },
    flat(150)];
  var n = ev.length - 1;
  ok(G.evaluate(ev, 100, 10, n, 1, s).mat === 0, 'basement at the bottom');
  ok(G.evaluate(ev, 100, 30, n, 1, s).mat === 1, 'first deposit above basement');
  ok(G.evaluate(ev, 100, 100, n, 1, s).mat === 2, 'second deposit on top');
  ok(G.evaluate(ev, 100, 170, n, 1, s).mat === -1, 'air above the land surface');
  // partial deposit: halfway through the first deposit the level is 35
  ok(G.evaluate(ev, 100, 30, 1, 0.5, s).mat === 1 && G.evaluate(ev, 100, 40, 1, 0.5, s).mat === -1, 'partial deposit rises');

  // tilt rotates bedding: pattern coords are the inverse-rotated point
  var ang = 30 * Math.PI / 180;
  var ev2 = ev.slice(0, 3).concat([{ kind: 'tilt', px: 180, py: 100, ang: ang }, flat(190)]);
  var x = 250, y = 60;
  G.evaluate(ev2, x, y, 4, 1, s);
  var c = Math.cos(-ang), sn = Math.sin(-ang), lx = 180 + (x - 180) * c - (y - 100) * sn, ly = 100 + (x - 180) * sn + (y - 100) * c;
  ok(near(s.fx, lx) && near(s.fy, ly), 'tilt: pattern coordinates are the pre-tilt position');
  ok(s.mat === (ly < 20 ? 0 : ly < 50 ? 1 : 2), 'tilt: material from the pre-tilt height');
  // a horizontal boundary becomes a line of slope tan(ang)
  function boundaryY(world, xx, upto, from) {
    from = from || 0;
    var prev = G.evaluate(world, xx, 0, upto, 1, s).mat;
    for (var yy = 0; yy < 200; yy += 0.05) { var m = G.evaluate(world, xx, yy, upto, 1, s).mat; if (m !== prev && prev === from) return yy; prev = m; }
    return NaN;
  }
  var b1 = boundaryY(ev2, 150, 4, 1), b2 = boundaryY(ev2, 170, 4, 1);
  ok(near((b2 - b1) / 20, Math.tan(ang), 0.02), 'tilt: boundary slope = tan(angle) (' + ((b2 - b1) / 20).toFixed(3) + ')');

  // fault displaces the hanging wall by the slip along the plane
  var dip = 60 * Math.PI / 180, ux = Math.cos(dip), uy = Math.sin(dip);
  var nx = -uy, ny = ux; // up-left normal: hanging wall on the upper-left side
  var fault = { kind: 'fault', px: 180, py: 100, ux: ux, uy: uy, nx: nx, ny: ny, slip: -20, normal: true };
  var ev3 = ev.slice(0, 3).concat([fault, flat(190)]);
  var foot = boundaryY(ev3, 300, 4), hang = boundaryY(ev3, 40, 4);
  ok(near(foot, 20, 0.06), 'fault: footwall boundary unchanged (' + foot.toFixed(2) + ')');
  ok(near(hang, 20 - 20 * uy, 0.06), 'fault: hanging wall dropped by slip*sin(dip) (' + hang.toFixed(2) + ')');
  G.evaluate(ev3, 180, 100, 4, 1, s);
  ok(s.fidx === 3 && s.fdist < 1e-6 && (s.faulted & 8), 'fault: trace and faulted mask recorded');

  // erosion makes air; younger deposits fill only air; intrusions only replace rock
  var ev4 = [{ kind: 'basement', level: 20, rock: 'gneiss' },
    { kind: 'deposit', rock: 'sandstone', level: 100, animFrom: 20, animTo: 100 },
    { kind: 'dike', rock: 'basalt', x: 180, lean: 0, w: 10, wob: 0, wl: 5, ph: 0 },
    flat(190)];
  ok(G.evaluate(ev4, 180, 50, 3, 1, s).mat === 2, 'dike replaces rock');
  ok(G.evaluate(ev4, 180, 150, 3, 1, s).mat === -1, 'dike does not fill air');
  ok(G.evaluate(ev4, 100, 50, 3, 1, s).mat === 1, 'rock beside the dike untouched');
  var ev5 = [{ kind: 'basement', level: 20, rock: 'gneiss' },
    { kind: 'deposit', rock: 'sandstone', level: Infinity, animFrom: 20, animTo: 100 },
    flat(80, 'erosion'),
    { kind: 'deposit', rock: 'shale', level: Infinity, animFrom: 80, animTo: 140 },
    flat(190)];
  ok(G.evaluate(ev5, 50, 70, 2, 1, s).mat === 1 && G.evaluate(ev5, 50, 90, 2, 1, s).mat === -1, 'erosion leaves air above its surface');
  ok(G.evaluate(ev5, 50, 90, 4, 1, s).mat === 3 && G.evaluate(ev5, 50, 70, 4, 1, s).mat === 1, 'deposit after erosion fills only the air');
})();

// ---- generator, constraints, checker ----
var levels = [1, 2, 3, 4, 5, 6, 7, 8, 0];
var t0 = Date.now(), maxCards = 0, totalCons = 0, totalPuzzles = 0;
levels.forEach(function (lv) {
  var bad = 0, attempts = 0;
  for (var k = 0; k < SEEDS; k++) {
    var p = G.generate('t' + k, lv);
    if (!p) { bad++; continue; }
    totalPuzzles++;
    attempts += p.attempts;
    var an = p.analysis, ev = p.events, cards = an.cards;
    maxCards = Math.max(maxCards, cards.length);
    totalCons += an.constraints.length;
    var where = 'L' + lv + ' seed t' + k;
    if (!an.valid) ok(false, where + ' invalid: ' + an.problems.join(','));
    // template shape: every non-basement non-surface event is a card
    var expected = ev.filter(function (e, i) { return e.kind !== 'surface' && (e.kind !== 'basement' || an.visible[0]); }).length;
    if (cards.length !== expected) ok(false, where + ' card count ' + cards.length + ' vs ' + expected);
    // letters unique
    var L = {}; cards.forEach(function (c) { L[ev[c].letter] = true; });
    if (Object.keys(L).length !== cards.length) ok(false, where + ' letters not unique');
    // every derived constraint is a true chronological order
    var allTrue = an.constraints.every(function (c) { return c.a < c.b; });
    if (!allTrue) ok(false, where + ' a constraint contradicts the true history');
    // true order passes
    var tr = G.trueOrder(p);
    if (!G.check(p, tr).ok) ok(false, where + ' true order rejected');
    // every card is tied to at least one relationship
    var deg = {}; an.constraints.forEach(function (c) { deg[c.a] = 1; deg[c.b] = 1; });
    cards.forEach(function (c) { if (!deg[c]) ok(false, where + ' card ' + ev[c].kind + ' has no evidence'); });
    // swapping any constrained pair is rejected, with a sensible explanation
    var r = G.makeRng(where);
    for (var q = 0; q < 3 && an.constraints.length; q++) {
      var c = r.pick(an.constraints);
      var o = tr.slice(), ia = o.indexOf(c.a), ib = o.indexOf(c.b); o[ia] = c.b; o[ib] = c.a;
      var res = G.check(p, o);
      if (res.ok || !res.violated) ok(false, where + ' swapped pair accepted');
      else {
        var txt = G.explain(p, res.violated);
        if (/undefined|NaN/.test(txt)) ok(false, where + ' bad explanation: ' + txt);
      }
    }
    // labels for everything that has a place on the cliff
    cards.forEach(function (c) {
      var e = ev[c];
      if (e.kind !== 'tilt' && e.kind !== 'fold' && !an.labels[c]) ok(false, where + ' no label for ' + e.kind);
    });
    // incomplete order is reported as missing
    if (G.check(p, tr.slice(1)).ok) ok(false, where + ' incomplete order accepted');
    // replay continuity: progress 1 of event k equals the full state; progress 0 is close to the previous state
    if (k < 4) {
      var n = ev.length, diff0 = 0, diff1 = 0, tot = 0, s2 = G.newSample();
      for (var kk = 1; kk < n; kk++) {
        for (var gy = 0; gy < 20; gy++) for (var gx = 0; gx < 36; gx++) {
          var X = gx * 10 + 5, Y = gy * 10 + 5;
          var prev = G.evaluate(ev, X, Y, kk - 1, 1, s).mat;
          var at0 = G.evaluate(ev, X, Y, kk, 0, s2).mat;
          if (prev !== at0) diff0++;
          var a1 = G.evaluate(ev, X, Y, kk, 1, s).mat;
          var nx1 = kk + 1 < n ? G.evaluate(ev, X, Y, kk + 1, 0, s2).mat : a1;
          tot++;
          if (kk + 1 < n && ev[kk + 1].kind !== 'deposit' && ev[kk + 1].kind !== 'erosion' && a1 !== nx1) diff1++;
        }
      }
      if (diff0 / tot > 0.04) ok(false, where + ' replay jumps at progress 0: ' + (100 * diff0 / tot).toFixed(1) + '%');
      if (diff1 > 0) ok(false, where + ' replay start differs for non-deposit event');
    }
    passes++;
  }
  ok(bad === 0, 'L' + lv + ': all seeds generate (' + bad + ' failed)');
  console.log('L' + (lv || 'endless') + ': ' + SEEDS + ' seeds, avg attempts ' + (attempts / Math.max(1, SEEDS - bad)).toFixed(1));
});
console.log('generator: ' + totalPuzzles + ' puzzles in ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s, max cards ' + maxCards +
  ', avg constraints ' + (totalCons / totalPuzzles).toFixed(1));

// ---- random orders are mostly rejected (the puzzle is not trivially loose) ----
(function () {
  var p = G.generate('loose', 6), r = G.makeRng('perm'), accepted = 0;
  for (var i = 0; i < 2000; i++) {
    var o = p.analysis.cards.slice();
    for (var j = o.length - 1; j > 0; j--) { var k = Math.floor(r.next() * (j + 1)); var t = o[j]; o[j] = o[k]; o[k] = t; }
    if (G.check(p, o).ok) accepted++;
  }
  ok(accepted < 20, 'random orders rejected (' + accepted + '/2000 accepted)');
})();

// ---- performance: a full-resolution render pass ----
(function () {
  var p = G.generate('perf', 8), ev = p.events, n = ev.length, t = Date.now(), w = 720, h = 400;
  for (var j = 0; j < h; j++) for (var i = 0; i < w; i++) G.evaluate(ev, (i + 0.5) * G.W / w, G.H - (j + 0.5) * G.H / h, n - 1, 1, s);
  var ms = Date.now() - t;
  ok(ms < 600, 'render 720x400 in ' + ms + ' ms');
  console.log('perf: 720x400 evaluate pass ' + ms + ' ms');
})();

console.log((fails ? 'FAILED ' : 'OK ') + passes + ' passed, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
