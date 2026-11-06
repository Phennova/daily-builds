// node tests/core.test.js
var LA = require('../core.js');
var fails = 0, n = 0;
function ok(c, msg) { n++; if (!c) { fails++; console.log('FAIL', msg); } }
function near(a, b, tol, msg) { ok(Math.abs(a - b) <= tol, msg + ' got ' + a.toFixed(2) + ' want ' + b); }
var P = LA.place;

// distances (reference values from standard great-circle calculators)
near(LA.dist(P('lon'), P('nyc')), 5570, 25, 'London-New York');
near(LA.dist(P('sin'), P('hkg')), 2580, 30, 'Singapore-Hong Kong');
near(LA.dist(P('syd'), P('lax')), 12060, 60, 'Sydney-LA');
near(LA.dist(P('lon'), P('ams')), 358, 10, 'London-Amsterdam');

// projection round trip
var v = LA.makeView(30, 40);
[[10, 20], [45, 60], [-10, 35], [30, 40]].forEach(function (q) {
  var p = v.project(q[0], q[1]);
  ok(p.z > 0, 'visible ' + q);
  var u = v.unproject(p.x, p.y);
  near(u.lat, q[0], 1e-6, 'rt lat'); near(u.lon, q[1], 1e-6, 'rt lon');
});
var c0 = v.project(30, 40); near(c0.x, 0, 1e-9, 'centre x'); near(c0.y, 0, 1e-9, 'centre y');
var nth = v.project(40, 40); ok(nth.y > 0 && Math.abs(nth.x) < 1e-9, 'north is up');
var est = v.project(30, 50); ok(est.x > 0, 'east is right');

// destination
var d1 = LA.destination(P('lon'), 90, 1000); near(LA.dist(P('lon'), d1), 1000, 1, 'destination distance');

// physics: no measurement beats light in fibre, B - C/2 stays safe
var lms = LA.landmarkIds(), minSlack = Infinity, violations = 0;
for (var s = 1; s <= 400; s++) {
  var cs = LA.randomCase(s * 7919);
  var r = LA.rng(s);
  lms.forEach(function (l) {
    var d = LA.dist(P(l), cs.truthPlace);
    if (cs.pingable) {
      var m = LA.measureDirect(cs, l, r);
      var disk = LA.diskFor(l, m.min, null);
      if (disk.radius < d) violations++;
      minSlack = Math.min(minSlack, disk.radius - d);
    } else {
      var C = LA.measureSelf(cs, r).min, B = LA.measureThrough(cs, l, r).min;
      var dk = LA.diskFor(l, B, C);
      if (dk.radius < d) violations++;
      minSlack = Math.min(minSlack, dk.radius - d);
      ok(LA.diskFor(l, B, null).radius >= dk.radius, 'B disk >= A disk');
    }
  });
}
ok(violations === 0, 'no disk excludes the truth (' + violations + ' violations)');
console.log('min slack (km) over 400 random cases x', lms.length, 'landmarks:', minSlack.toFixed(1));

// campaign solvability
LA.CASES.forEach(function (def, i) {
  var cs = LA.campaignCase(i, 12345 + i);
  var r = LA.rng(99 + i);
  var C = cs.pingable ? null : LA.measureSelf(cs, r).min;
  var avail = lms.filter(function (l) { return cs.offline.indexOf(l) < 0; });
  var disks = avail.map(function (l) {
    var m = cs.pingable ? LA.measureDirect(cs, l, r) : LA.measureThrough(cs, l, r);
    return LA.diskFor(l, m.min, C);
  });
  ok(LA.inAll(disks, cs.truthPlace), def.key + ': truth inside all disks');
  var provers = LA.excluding(disks, cs.claimPlace).map(function (d) { return d.id; });
  var rawProvers = [];
  if (!cs.pingable) {
    var rawDisks = avail.map(function (l) { return LA.diskFor(l, LA.measureThrough(cs, l, r).min, null); });
    rawProvers = LA.excluding(rawDisks, cs.claimPlace).map(function (d) { return d.id; });
  }
  if (cs.honest) ok(provers.length === 0, def.key + ': honest claim not excluded');
  else ok(provers.length > 0, def.key + ': lie is provable');
  var detourSet = Object.keys(cs.detours);
  detourSet.forEach(function (l) { ok(provers.indexOf(l) < 0, def.key + ': detoured ' + l + ' cannot prove'); });
  console.log(def.key, 'provers:', provers.join(',') || '-', cs.pingable ? '' : '| without C: ' + (rawProvers.join(',') || '-'));
  // scoring sanity
  var sc = LA.score(cs, disks, cs.honest ? 'cant' : 'impossible', cs.truthPlace, 1);
  ok(sc.total === 400 + 400 + 50, def.key + ': perfect score ' + sc.total);
});

// unsupported accusation
var cs0 = LA.campaignCase(1, 5);
var s0 = LA.score(cs0, [], 'impossible', null, 0);
ok(s0.verdictPts === 0, 'accusation without disks scores 0');

console.log(n - fails + '/' + n + ' passed');
process.exit(fails ? 1 : 0);
