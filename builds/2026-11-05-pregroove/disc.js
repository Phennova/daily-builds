// Pregroove disc model: CLV spiral geometry, lazily evaluated frame stream, decoder, lag scope.
// Pure functions; runs in the browser (window.Disc) and in node (module.exports).
// Units: millimetres, seconds, radians. One CD-DA frame = 24 bytes = 6 stereo samples; 7350 frames per second.
(function (root) {
  'use strict';
  var FPS = 7350;
  var TAU = Math.PI * 2;
  var R_OUT = 58;        // outer edge of the program area we burn (mm)
  var R_HOLE = 22;       // inside this there is never data (clamp area)

  // ---------- RNG / hashing ----------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash32(x) {
    x = (x ^ 61) ^ (x >>> 16); x = Math.imul(x, 9); x ^= x >>> 4;
    x = Math.imul(x, 0x27d4eb2d); x ^= x >>> 15; return x >>> 0;
  }
  function strSeed(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  // ---------- geometry ----------
  // g = { r0: start radius (mm), p: track pitch at r0 (mm), v: linear velocity (mm/s), a: pitch drift (1/mm),
  //       phi0: start angle (rad) }
  function frameLen(g) { return g.v / FPS; }
  // Pitch may drift linearly with radius: pitch(r) = p * (1 + a * (r - r0)), a in 1/mm (g.a, default 0).
  // Then dr/dtheta = pitch(r)/TAU gives r(theta) = r0 + expm1(x)/a with x = a*p*theta/TAU, and the arc length
  // s(theta) = r0*theta + TAU/(a^2 p) * (expm1(x) - x). a = 0 is the plain Archimedean spiral.
  function em1x(x) { // expm1(x) - x without cancellation
    return Math.abs(x) < 1e-3 ? x * x * 0.5 * (1 + x / 3 * (1 + x / 4 * (1 + x / 5))) : Math.expm1(x) - x;
  }
  function rOfTheta(g, th) {
    var a = g.a || 0;
    if (a === 0) return g.r0 + g.p * th / TAU;
    var x = a * g.p * th / TAU;
    return g.r0 + (Math.abs(x) < 1e-9 ? g.p * th / TAU * (1 + x / 2) : Math.expm1(x) / a);
  }
  function sOfTheta(g, th) {
    var a = g.a || 0;
    if (a === 0) return g.r0 * th + g.p * th * th / (2 * TAU);
    var x = a * g.p * th / TAU;
    return g.r0 * th + TAU / (a * a * g.p) * em1x(x);
  }
  function thetaOfR(g, r) { // continuous turn angle where the spiral reaches radius r
    var a = g.a || 0, d = r - g.r0;
    if (a === 0) return TAU * d / g.p;
    return TAU * Math.log1p(a * d) / (a * g.p);
  }
  function thetaOfS(g, S) {
    var rc = Math.sqrt(g.r0 * g.r0 + g.p * S / Math.PI), th = TAU * (rc - g.r0) / g.p;
    if (!g.a) return th;
    for (var it = 0; it < 6; it++) {
      var f = sOfTheta(g, th) - S;
      th -= f / rOfTheta(g, th);
      if (Math.abs(f) < 1e-7) break;
    }
    return th;
  }
  // frame n (may be fractional) -> polar position on the disc. Returns false before the start.
  function forward(g, n, out) {
    if (n < 0) return false;
    var th = thetaOfS(g, n * g.v / FPS);
    out.r = rOfTheta(g, th);
    out.th = th + g.phi0;
    return true;
  }
  // turn angle theta (>= 0, measured from the start) -> frame index
  function thetaToN(g, theta) { return sOfTheta(g, theta) * FPS / g.v; }
  // point (r, phi) -> fractional frame index of the nearest spiral turn through that angle; -1 if none
  function inverse(g, r, phi) {
    var f = (phi - g.phi0) / TAU;
    f -= Math.floor(f);
    var k = Math.round(thetaOfR(g, r) / TAU - f);
    if (k < 0) return -1;
    return thetaToN(g, TAU * (k + f));
  }
  function framesTo(g, r) { return thetaToN(g, thetaOfR(g, r)); } // frame index where the spiral reaches r
  function framesPerRev(g, r) { return TAU * r / frameLen(g); }
  // frames in one full turn starting at frame n (what the lag scope measures)
  function lagAt(g, n) {
    var th = thetaOfS(g, n * g.v / FPS);
    return (sOfTheta(g, th + TAU) - sOfTheta(g, th)) * FPS / g.v;
  }

  // ---------- picture -> stream ----------
  var BAYER = (function () {
    var m = [0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22,
      3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21];
    return m.map(function (x) { return (x + 0.5) / 64; });
  })();
  var DITHER_CELL = 0.3; // mm

  // A "burn" = the true geometry plus a picture sampler pic(x, y) -> darkness 0..1, burn noise, and a seed.
  function makeBurn(truth, pic, opts) {
    opts = opts || {};
    var b = {
      g: truth, pic: pic, noise: opts.noise || 0, seed: (opts.seed >>> 0) || 1,
      nEnd: Math.floor(framesTo(truth, R_OUT)), tmp: { r: 0, th: 0 }
    };
    return b;
  }
  // value of frame n: 1 = dark (burned marks), 0 = clear; -1 = no data (before start / after end)
  function frame(b, n) {
    n = Math.floor(n);
    if (n < 0 || n >= b.nEnd) return -1;
    var t = b.tmp;
    forward(b.g, n + 0.5, t);
    var x = t.r * Math.cos(t.th), y = t.r * Math.sin(t.th);
    var d = b.pic(x, y);
    var ix = Math.floor(x / DITHER_CELL) & 7, iy = Math.floor(y / DITHER_CELL) & 7;
    var v = d > BAYER[iy * 8 + ix] ? 1 : 0;
    if (b.noise > 0 && hash32(n ^ b.seed) / 4294967296 < b.noise) v = 1 - v;
    return v;
  }

  // ---------- decoder ----------
  // Render the stream as seen through the guessed geometry into out (Float32Array size*size, values:
  // 0 clear .. 1 dark, or -1 = no data). view = mm across (default 120). ss = supersampling per axis.
  function decode(b, guess, size, ss, out, view, yA, yB) {
    view = view || 120;
    ss = ss || 1;
    yA = yA || 0; yB = yB === undefined ? size : yB;
    var half = view / 2, px = view / size, sub = px / ss;
    var i = yA * size;
    for (var yy = yA; yy < yB; yy++) {
      for (var xx = 0; xx < size; xx++, i++) {
        var acc = 0, cnt = 0, none = 0;
        for (var sy = 0; sy < ss; sy++) {
          var y = half - (yy * px + (sy + 0.5) * sub);
          for (var sx = 0; sx < ss; sx++) {
            var x = -half + xx * px + (sx + 0.5) * sub;
            var r = Math.sqrt(x * x + y * y);
            if (r < R_HOLE || r > R_OUT + 1) { none++; continue; }
            var n = inverse(guess, r, Math.atan2(y, x));
            var v = n < 0 ? -1 : frame(b, n);
            if (v < 0) { none++; continue; }
            acc += v; cnt++;
          }
        }
        out[i] = cnt ? (none * 2 > ss * ss ? -1 : acc / cnt) : -1;
      }
    }
    return out;
  }

  // Where does the point (r, phi) seen through `guess` really sit on the disc? -> {dr, dth} vs the truth
  function warpAt(truth, guess, r, phi) {
    var n = inverse(guess, r, phi), t = { r: 0, th: 0 };
    if (n < 0 || !forward(truth, n, t)) return null;
    var d = t.th - phi; d = d - TAU * Math.round(d / TAU);
    return { dr: t.r - r, dth: d };
  }
  // max |angular error| (rad) over the burned band [rA, rB]
  function twist(truth, guess, rA, rB, steps) {
    steps = steps || 40; var worst = 0;
    for (var i = 0; i <= steps; i++) {
      var r = rA + (rB - rA) * i / steps;
      var w = warpAt(truth, guess, r, 0.3);
      if (!w) return Math.PI;
      // positional error expressed as angle, including radial error
      var e = Math.abs(w.dth) + Math.abs(w.dr) / r;
      if (e > worst) worst = e;
    }
    return worst;
  }

  // ---------- lag scope ----------
  // autocorrelation of the stream window [n0, n0+W) for lags Lmin..Lmax
  function autocorr(b, n0, W, Lmin, Lmax) {
    var N = W + Lmax + 2, x = new Float32Array(N), i, L;
    var mean = 0;
    for (i = 0; i < N; i++) { var v = frame(b, n0 + i); x[i] = v < 0 ? 0.5 : v; mean += x[i]; }
    mean /= N;
    var vr = 0;
    for (i = 0; i < N; i++) { x[i] -= mean; vr += x[i] * x[i]; }
    vr = vr / N;
    var c = new Float32Array(Lmax - Lmin + 1);
    c.blank = vr < 0.004; // (nearly) all one level: a blank part of the picture has no echo
    if (c.blank) return c;
    for (L = Lmin; L <= Lmax; L++) {
      var s = 0;
      for (i = 0; i < W; i++) s += x[i] * x[i + L];
      c[L - Lmin] = s / W / vr;
    }
    return c;
  }
  // first strong peak (avoids picking 2 revolutions); sub-frame position by the centroid of the peak top
  function findPeak(c, Lmin) {
    if (c.blank) return null;
    var max = -1, i, E = 4, sorted = Array.prototype.slice.call(c).sort(function (a, b) { return a - b; });
    var med = sorted[sorted.length >> 1];
    for (i = E; i < c.length - E; i++) if (c[i] > max) max = c[i];
    if (max - med < 0.25) return null;
    // the true revolution is the strongest echo; two revolutions echo about as strongly, so prefer half of the best
    // lag when an (almost) equally strong peak sits there. Sub-revolution symmetry in the picture echoes weaker.
    var bi = -1;
    for (i = E; i < c.length - E; i++) if (c[i] === max) { bi = i; break; }
    var halfL = (Lmin + bi) / 2 - Lmin;
    if (halfL > E) {
      var w = Math.max(3, Math.round((Lmin + bi) * 0.015)), hb = -1, hv = -1;
      for (i = Math.max(E, Math.floor(halfL - w)); i <= Math.min(c.length - E - 1, Math.ceil(halfL + w)); i++) if (c[i] > hv) { hv = c[i]; hb = i; }
      if (hb > 0 && hv >= 0.93 * max) bi = hb;
    }
    var m = c[bi], sum = 0, wt = 0;
    for (var j = Math.max(0, bi - 6); j <= Math.min(c.length - 1, bi + 6); j++) {
      var q = c[j] - m * 0.4; if (q > 0) { sum += q * j; wt += q; }
    }
    return { lag: Lmin + (wt ? sum / wt : bi), corr: m, index: bi };
  }
  // unwrapped angular error (rad) of the guess at radius r: positive = picture rotated forward
  function twistAt(truth, guess, r) {
    var n = framesTo(guess, r), t = { r: 0, th: 0 }, u = { r: 0, th: 0 };
    forward(truth, n, t); forward(guess, n, u);
    return t.th - u.th;
  }
  var SCOPE = { W: 6000, Lmin: 600, Lmax: 2600 };
  function measureLag(b, n0) {
    var c = autocorr(b, n0, SCOPE.W, SCOPE.Lmin, SCOPE.Lmax);
    var pk = findPeak(c, SCOPE.Lmin);
    return { n: n0 + SCOPE.W / 2, curve: c, peak: pk };
  }
  // Fit the unknown parameters (subset of 'v', 'p', 'a') of guess g to lag readings [{n, L}], by damped
  // Gauss-Newton on relative parameter changes. Returns a new geometry (or null if it cannot fit).
  var FIT_SCALE = { v: 1300, p: 0.0016, a: 1e-3 };
  function fit(readings, g, keys) {
    keys = keys.filter(function (k) { return k in FIT_SCALE; });
    if (!keys.length || readings.length < keys.length) return null;
    var cur = Object.assign({ a: 0 }, g), lam = 1e-3, m = keys.length;
    function resid(q) {
      return readings.map(function (rd) { return lagAt(q, rd.n) - rd.L; });
    }
    function cost(res) { return res.reduce(function (s, x) { return s + x * x; }, 0); }
    var res = resid(cur), c = cost(res);
    for (var it = 0; it < 60; it++) {
      // Jacobian by finite differences in scaled units
      var J = readings.map(function () { return new Array(m).fill(0); });
      keys.forEach(function (k, j) {
        var h = FIT_SCALE[k] * 1e-7, q = Object.assign({}, cur); q[k] += h;
        var r2 = resid(q);
        for (var i = 0; i < readings.length; i++) J[i][j] = (r2[i] - res[i]) / 1e-7;
      });
      // normal equations (J^T J + lam diag) d = -J^T r
      var A = [], bv = [];
      for (var a1 = 0; a1 < m; a1++) {
        A.push(new Array(m).fill(0)); bv.push(0);
        for (var i2 = 0; i2 < readings.length; i2++) bv[a1] -= J[i2][a1] * res[i2];
        for (var a2 = 0; a2 < m; a2++) for (var i3 = 0; i3 < readings.length; i3++) A[a1][a2] += J[i3][a1] * J[i3][a2];
      }
      var improved = false;
      for (var tries = 0; tries < 12 && !improved; tries++) {
        var M = A.map(function (row, ii) { return row.map(function (x, jj) { return ii === jj ? x * (1 + lam) + 1e-12 : x; }); });
        var d = solve(M, bv.slice());
        if (!d) { lam *= 10; continue; }
        var q2 = Object.assign({}, cur);
        keys.forEach(function (k, j) { q2[k] += d[j] * FIT_SCALE[k]; });
        if (q2.v <= 0 || q2.p <= 0) { lam *= 10; continue; }
        var r3 = resid(q2), c3 = cost(r3);
        if (c3 < c) { cur = q2; res = r3; c = c3; lam = Math.max(lam / 5, 1e-9); improved = true; }
        else lam *= 10;
      }
      if (!improved || c < 1e-10) break;
    }
    cur.rms = Math.sqrt(c / readings.length);
    return cur;
  }
  // fit, then drop readings that miss by more than 2 frames (wrong echo picked) and refit
  function fitRobust(readings, g, keys) {
    var rd = readings.slice(), dropped = [], f = fit(rd, g, keys);
    while (f && rd.length > keys.length + 1) {
      var worst = -1, wi = -1;
      rd.forEach(function (x, i) { var e = Math.abs(lagAt(f, x.n) - x.L); if (e > worst) { worst = e; wi = i; } });
      if (worst < 2) break;
      dropped.push(rd[wi]); rd.splice(wi, 1);
      f = fit(rd, g, keys);
    }
    if (f) f.dropped = dropped;
    return f;
  }
  function solve(A, b) { // Gaussian elimination with partial pivoting
    var n = b.length, i, j, k;
    for (i = 0; i < n; i++) {
      var piv = i;
      for (j = i + 1; j < n; j++) if (Math.abs(A[j][i]) > Math.abs(A[piv][i])) piv = j;
      if (Math.abs(A[piv][i]) < 1e-300) return null;
      var t = A[i]; A[i] = A[piv]; A[piv] = t; var tb = b[i]; b[i] = b[piv]; b[piv] = tb;
      for (j = i + 1; j < n; j++) {
        var f = A[j][i] / A[i][i];
        for (k = i; k < n; k++) A[j][k] -= f * A[i][k];
        b[j] -= f * b[i];
      }
    }
    var x = new Array(n);
    for (i = n - 1; i >= 0; i--) {
      var s = b[i];
      for (j = i + 1; j < n; j++) s -= A[i][j] * x[j];
      x[i] = s / A[i][i];
    }
    return x;
  }

  // ---------- flags / links ----------
  var WORDS = ['ALPHA', 'BRAVO', 'DELTA', 'ECHO', 'FOXTROT', 'HOTEL', 'KILO', 'LIMA', 'OSCAR', 'ROMEO', 'SIERRA', 'TANGO',
    'VICTOR', 'ZULU', 'RAVEN', 'EMBER', 'COBALT', 'VESPER', 'NOMAD', 'ORBIT', 'QUARTZ', 'PYLON', 'SABLE', 'VIPER'];
  function makeFlag(rng) {
    var w = WORDS[Math.floor(rng() * WORDS.length)];
    var d = 10 + Math.floor(rng() * 90);
    return w + '-' + d;
  }
  function normFlag(s) { return String(s).toUpperCase().replace(/[^A-Z0-9]/g, ''); }

  function b64url(s) {
    var b = typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'binary').toString('base64');
    return b.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function unb64url(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '=';
    return typeof atob === 'function' ? atob(s) : Buffer.from(s, 'base64').toString('binary');
  }
  // dead-drop link payload: message obscured with a seed-keyed XOR (a toy, not encryption)
  function encodeDrop(msg, seed) {
    var bytes = unescape(encodeURIComponent(msg)), rng = mulberry32(seed ^ 0x5eed), o = '';
    for (var i = 0; i < bytes.length; i++) o += String.fromCharCode(bytes.charCodeAt(i) ^ Math.floor(rng() * 256));
    return b64url(String.fromCharCode(seed >>> 24 & 255, seed >>> 16 & 255, seed >>> 8 & 255, seed & 255) + o);
  }
  function decodeDrop(code) {
    try {
      var raw = unb64url(code);
      if (raw.length < 5) return null;
      var seed = ((raw.charCodeAt(0) << 24) | (raw.charCodeAt(1) << 16) | (raw.charCodeAt(2) << 8) | raw.charCodeAt(3)) >>> 0;
      var rng = mulberry32(seed ^ 0x5eed), o = '';
      for (var i = 4; i < raw.length; i++) o += String.fromCharCode(raw.charCodeAt(i) ^ Math.floor(rng() * 256));
      return { seed: seed, msg: decodeURIComponent(escape(o)) };
    } catch (e) { return null; }
  }

  // nominal geometry and the physical ranges a disc may have
  // r0 is fixed at the Red Book programme-area start (25 mm): from the stream alone, the absolute size of the
  // disc is degenerate with v and p (only its proportions show), so it is not a tunable here.
  var NOMINAL = { r0: 25, p: 0.0016, v: 1300, a: 0, phi0: 0 };
  function randomTruth(rng, drift) {
    return {
      r0: 25,
      p: 0.00154 + rng() * 0.00012,
      v: 1200 + rng() * 200,
      a: drift ? (rng() < 0.5 ? -1 : 1) * (0.15e-3 + rng() * 0.3e-3) : 0,
      phi0: (rng() * 2 - 1) * Math.PI
    };
  }

  var D = {
    FPS: FPS, R_OUT: R_OUT, R_HOLE: R_HOLE, NOMINAL: NOMINAL, SCOPE: SCOPE, WORDS: WORDS,
    mulberry32: mulberry32, hash32: hash32, strSeed: strSeed,
    frameLen: frameLen, forward: forward, inverse: inverse, thetaToN: thetaToN, framesTo: framesTo,
    framesPerRev: framesPerRev, makeBurn: makeBurn, frame: frame, decode: decode, warpAt: warpAt, twist: twist,
    autocorr: autocorr, twistAt: twistAt, findPeak: findPeak, measureLag: measureLag, fit: fit, fitRobust: fitRobust, lagAt: lagAt, rOfTheta: rOfTheta, sOfTheta: sOfTheta, thetaOfR: thetaOfR,
    makeFlag: makeFlag, normFlag: normFlag, encodeDrop: encodeDrop, decodeDrop: decodeDrop, randomTruth: randomTruth
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = D; else root.Disc = D;
})(this);
