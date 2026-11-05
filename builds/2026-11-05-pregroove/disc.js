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
  // g = { r0: start radius (mm), p: track pitch (mm), v: linear velocity (mm/s), phi0: start angle (rad) }
  function frameLen(g) { return g.v / FPS; }
  // frame n (may be fractional) -> polar position on the disc. Returns false before the start.
  function forward(g, n, out) {
    if (n < 0) return false;
    var s = n * g.v / FPS;
    var r = Math.sqrt(g.r0 * g.r0 + g.p * s / Math.PI);
    out.r = r;
    out.th = TAU * (r - g.r0) / g.p + g.phi0;
    return true;
  }
  // turn angle theta (>= 0, measured from the start) -> frame index
  function thetaToN(g, theta) {
    var s = g.r0 * theta + g.p * theta * theta / (2 * TAU);
    return s * FPS / g.v;
  }
  // point (r, phi) -> fractional frame index of the nearest spiral turn through that angle; -1 if none
  function inverse(g, r, phi) {
    var a = (phi - g.phi0) / TAU;
    a -= Math.floor(a);
    var k = Math.round((r - g.r0) / g.p - a);
    if (k < 0) return -1;
    return thetaToN(g, TAU * (k + a));
  }
  function framesTo(g, r) { // frame index where the spiral reaches radius r
    return Math.PI * (r * r - g.r0 * g.r0) / g.p * FPS / g.v;
  }
  function framesPerRev(g, r) { return TAU * r / frameLen(g); }

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
    vr = vr / N || 1e-9;
    var c = new Float32Array(Lmax - Lmin + 1);
    for (L = Lmin; L <= Lmax; L++) {
      var s = 0;
      for (i = 0; i < W; i++) s += x[i] * x[i + L];
      c[L - Lmin] = s / W / vr;
    }
    return c;
  }
  // first strong peak (avoids picking 2 revolutions); parabolic refinement
  function findPeak(c, Lmin) {
    var max = -1, i;
    for (i = 1; i < c.length - 1; i++) if (c[i] > max) max = c[i];
    for (i = 1; i < c.length - 1; i++) {
      if (c[i] >= c[i - 1] && c[i] >= c[i + 1] && c[i] >= 0.8 * max) {
        var a = c[i - 1], m = c[i], z = c[i + 1], den = a - 2 * m + z;
        var off = den !== 0 ? 0.5 * (a - z) / den : 0;
        if (off > 0.5) off = 0.5; if (off < -0.5) off = -0.5;
        return { lag: Lmin + i + off, corr: m, index: i };
      }
    }
    return null;
  }
  var SCOPE = { W: 6000, Lmin: 600, Lmax: 2600 };
  function measureLag(b, n0) {
    var c = autocorr(b, n0, SCOPE.W, SCOPE.Lmin, SCOPE.Lmax);
    var pk = findPeak(c, SCOPE.Lmin);
    return { n: n0 + SCOPE.W / 2, curve: c, peak: pk };
  }
  // two readings {n, L} + assumed start radius r0 -> {v, p}.  L^2 = (TAU*FPS/v)^2 r0^2 + (2*TAU*FPS*p/v) n
  function estimate(r1, r2, r0) {
    var B = (r2.L * r2.L - r1.L * r1.L) / (r2.n - r1.n);
    var A = r1.L * r1.L - B * r1.n;
    if (!(A > 0) || !(B > 0)) return null;
    var v = TAU * FPS * r0 / Math.sqrt(A);
    var p = B * v / (2 * TAU * FPS);
    return { v: v, p: p };
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
  var NOMINAL = { r0: 25, p: 0.0016, v: 1300, phi0: 0 };
  var RANGE = { r0: [24, 26], p: [0.00150, 0.00170], v: [1150, 1450], phi0: [-Math.PI, Math.PI] };
  function randomTruth(rng) {
    return {
      r0: 24.6 + rng() * 0.8,
      p: 0.00154 + rng() * 0.00012,
      v: 1200 + rng() * 200,
      phi0: (rng() * 2 - 1) * Math.PI
    };
  }

  var D = {
    FPS: FPS, R_OUT: R_OUT, R_HOLE: R_HOLE, NOMINAL: NOMINAL, RANGE: RANGE, SCOPE: SCOPE, WORDS: WORDS,
    mulberry32: mulberry32, hash32: hash32, strSeed: strSeed,
    frameLen: frameLen, forward: forward, inverse: inverse, thetaToN: thetaToN, framesTo: framesTo,
    framesPerRev: framesPerRev, makeBurn: makeBurn, frame: frame, decode: decode, warpAt: warpAt, twist: twist,
    autocorr: autocorr, findPeak: findPeak, measureLag: measureLag, estimate: estimate,
    makeFlag: makeFlag, normFlag: normFlag, encodeDrop: encodeDrop, decodeDrop: decodeDrop, randomTruth: randomTruth
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = D; else root.Disc = D;
})(this);
