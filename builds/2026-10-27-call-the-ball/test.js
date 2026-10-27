// Unit tests for the flight model, wires and LSO grading. Run: node test.js
'use strict';
var S = require('./sim.js');
var C = S.C;
var pass = 0, fail = 0;
function ok(cond, msg) { if (cond) pass++; else { fail++; console.log('FAIL:', msg); } }
function near(a, b, eps, msg) { ok(Math.abs(a - b) <= eps, msg + ' (got ' + a + ', want ' + b + ')'); }

// Geometry
near(S.gsHeight(-1000), 1000 * Math.tan(3.5 * S.DEG), 1e-9, 'glideslope height');
near(C.VY_TRIM, -3.61, 0.05, 'trim sink rate ~ 710 fpm');
var s0 = S.create(0, 1); s0.y = S.gsHeight(s0.x); s0.z = 0;
near(S.ballCells(s0), 0, 1e-9, 'centred ball on glideslope');
s0.y = S.gsHeight(s0.x) + Math.tan(C.CELL) * -s0.x;
near(S.ballCells(s0), 1, 0.01, 'one cell high');

// Hand-crafted touchdown -> wire mapping
function landAt(xTouch) {
  var s = S.create(0, 2);
  s.z = 0; s.L = S.LEVELS[0];
  // place aircraft just above deck before the touchdown point, descending
  s.x = xTouch - 0.5; s.y = 0.03; s.vy = -3.6; s.phase = 'groove';
  s.lso.ballCalled = s.lso.rogered = true;
  for (var i = 0; i < 400 && !s.done; i++) S.step(s, 1 / 60, { throttle: C.TRIM, bank: 0 });
  return s;
}
ok(landAt(-25).wire === 1, '1 wire when landing short');
ok(landAt(-10).wire === 2, '2 wire');
ok(landAt(0).wire === 3, '3 wire at the aim point');
ok(landAt(10).wire === 4, '4 wire');
var lb = landAt(25); ok(lb.phase === 'bolter' || lb.outcome.kind === 'bolter' || lb.outcome.kind === 'crash', 'past 4 wire is a bolter');
ok(lb.outcome.kind === 'crash', 'bolter without power goes off the angle');

// Autopilot flies calm passes to 3-wire OKs (model is flyable)
for (var seed = 1; seed <= 10; seed++) {
  var a = S.runPass(0, seed, S.autopilot);
  ok(a.grade.key === 'OK' && a.grade.wire === 3, 'autopilot calm seed ' + seed + ': ' + a.grade.shorthand);
}
// Autopilot survives every level (no crashes) on most seeds
var crashes = 0, total = 0;
for (var l = 0; l < S.LEVELS.length; l++) for (seed = 1; seed <= 10; seed++) {
  var b = S.runPass(l, seed, S.autopilot); total++;
  if (b.outcome.kind === 'crash' || b.grade.key === 'C') crashes++;
}
ok(crashes <= 2, 'autopilot crash count across all levels ' + crashes + '/' + total);

// Hands-off (no lineup correction) gets waved off or worse: the deck creeps right
var h = S.runPass(0, 1, function () { return { throttle: C.TRIM, bank: 0 }; });
ok(['WO', 'C', 'NG'].indexOf(h.grade.key) >= 0, 'hands-off pass is not graded OK: ' + h.grade.shorthand);
ok(h.calls.some(function (c) { return c.key === 'right'; }), 'LSO calls "Right for lineup" for lineup creep');

// Flying low all the way: power calls then wave-off; obeying (full power) => WO 1 point
var low = S.runPass(0, 3, function (s) {
  if (s.waveoffAt >= 0) return { throttle: 1, bank: 0 };
  var ap = S.autopilot(s); ap.throttle -= 0.12; return ap;
});
ok(low.calls.some(function (c) { return c.key === 'power' || c.key === 'power2'; }), 'LSO calls power when low');
ok(low.grade.key === 'WO' || low.grade.tokens.some(function (t) { return /LO/.test(t.code); }), 'low pass graded low or waved off: ' + low.grade.shorthand);

// Ignoring a wave-off and landing anyway = Cut
var ign = S.runPass(0, 1, function (s) { var ap = S.autopilot(s); if (s.x > -700) ap.throttle = C.TRIM - 0.25; return ap; });
ok(ign.waveoffAt >= 0, 'LSO waves off a pass that settles below glideslope');
ok(ign.grade.key === 'C', 'ignoring the wave-off is a cut: ' + ign.grade.shorthand + ' ' + (ign.grade.why || ''));

// Diving into the ramp is a ramp strike
var ramp = S.create(0, 1); ramp.lso.ballCalled = ramp.lso.rogered = true;
ramp.x = -80; ramp.y = 0.5; ramp.z = 0; ramp.vy = -4;
for (var i = 0; i < 300 && !ramp.done; i++) S.step(ramp, 1 / 60, { throttle: 0.3, bank: 0 });
ok(ramp.outcome && ramp.outcome.kind === 'crash' && /Ramp/.test(ramp.crash), 'ramp strike detected: ' + ramp.crash);

// Shorthand formatting
var g = S.runPass(2, 2, S.autopilot).grade;
ok(typeof g.shorthand === 'string' && g.shorthand.length > 2, 'shorthand string: ' + g.shorthand);
ok(g.tokens.every(function (t) { return t.text && t.code; }), 'every token has plain-English text');

// Points table matches the real LSO scale
var P = S.GRADE_INFO;
ok(P.OKU.pts === 5 && P.OK.pts === 4 && P.FAIR.pts === 3 && P.B.pts === 2.5 && P.NG.pts === 2 && P.WO.pts === 1 && P.C.pts === 0, 'points scale');

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
