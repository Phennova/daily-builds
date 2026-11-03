/* Blade Rate - signal model and DSP (pure; runs in the browser and in node).
 * Everything the player sees on LOFAR/DEMON is an FFT of samples generated here. */
(function (G) {
  'use strict';
  const D = (typeof module !== 'undefined' && module.exports) ? require('./data.js') : G.BRDATA;

  const FS_LO = 1000, FS_HI = 4000, STEP = 0.5;        // sample rates (Hz), sim step (s)
  const N_LO = 2048, N_ENV = 1024, ENV_DEC = 20;         // LOFAR FFT, DEMON FFT, envelope decimation
  const FS_ENV = FS_HI / ENV_DEC;                        // 200 Hz
  const LO_MAX = 250, DM_MAX = 40;                       // display ranges (Hz)
  const LO_BINS = Math.round(LO_MAX * N_LO / FS_LO);     // 512
  const DM_BINS = Math.round(DM_MAX * N_ENV / FS_ENV);   // 205
  const LO_RES = FS_LO / N_LO, DM_RES = FS_ENV / N_ENV;  // Hz per bin
  const BEAM_SIGMA = 4, BEAM_FLOOR = 0.015;
  const TWIN_DETUNE = 1.03;

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  // fast approximately-Gaussian noise (Irwin-Hall n=4, unit variance)
  function gaussFn(rng) { return () => (rng() + rng() + rng() + rng() - 2) * 1.7320508; }
  const lerp = (a, b, t) => a + (b - a) * t;
  const pick = (rng, r) => Array.isArray(r) ? lerp(r[0], r[1], rng()) : r;
  const angDiff = (a, b) => { let d = ((a - b) % 360 + 540) % 360 - 180; return d; };
  const wrap360 = a => ((a % 360) + 360) % 360;

  // ---------- FFT (radix-2, in place) ----------
  const fftCache = {};
  function fftTables(n) {
    if (fftCache[n]) return fftCache[n];
    const rev = new Uint32Array(n), bits = Math.log2(n);
    for (let i = 0; i < n; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); rev[i] = r; }
    const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos(2 * Math.PI * i / n); sin[i] = -Math.sin(2 * Math.PI * i / n); }
    const hann = new Float64Array(n); let s1 = 0, s2 = 0;
    for (let i = 0; i < n; i++) { hann[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n); s1 += hann[i]; s2 += hann[i] * hann[i]; }
    return (fftCache[n] = { rev, cos, sin, hann, s1, s2 });
  }
  function fft(re, im) {
    const n = re.length, T = fftTables(n);
    for (let i = 0; i < n; i++) { const j = T.rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = 0, k = 0; j < half; j++, k += step) {
          const a = i + j, b = a + half;
          const tr = re[b] * T.cos[k] - im[b] * T.sin[k], ti = re[b] * T.sin[k] + im[b] * T.cos[k];
          re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        }
      }
    }
  }
  // Hann-windowed power spectrum normalised so white noise of variance s^2 gives mean bin power s^2.
  function powerSpectrum(x, bins, removeMean) {
    const n = x.length, T = fftTables(n), re = new Float64Array(n), im = new Float64Array(n);
    let mean = 0; if (removeMean) { for (let i = 0; i < n; i++) mean += x[i]; mean /= n; }
    for (let i = 0; i < n; i++) re[i] = (x[i] - mean) * T.hann[i];
    fft(re, im);
    const out = new Float64Array(bins);
    for (let k = 0; k < bins; k++) out[k] = (re[k] * re[k] + im[k] * im[k]) / T.s2;
    return out;
  }

  // ---------- acoustic signature ----------
  function shaftHz(cls, speed) { return speed * cls.tpk / 60; }

  // narrowband lines a ship radiates (LOFAR band)
  function linesFor(cls, speed) {
    if (!cls || cls.type === 'bio') return [];
    const fs = shaftHz(cls, speed), L = [];
    cls.mainsAmp.forEach((a, k) => L.push({ f: cls.mains * (k + 1), a, kind: 'mains' }));
    const shafts = cls.shafts === 2 ? [fs, fs * TWIN_DETUNE] : [fs];
    shafts.forEach((s, si) => {
      const m = si ? 0.8 : 1;
      L.push({ f: s, a: cls.shaftAmp * m, kind: 'shaft' });
      cls.bladeAmp.forEach((a, k) => L.push({ f: s * cls.blades * (k + 1), a: a * m, kind: 'blade' }));
      if (cls.cyl) L.push({ f: s * cls.cyl, a: cls.firingAmp * m, kind: 'firing' }, { f: 2 * s * cls.cyl, a: cls.firingAmp * 0.4 * m, kind: 'firing' });
    });
    cls.fixed.forEach(([f, a]) => L.push({ f, a, kind: 'aux' }));
    return L;
  }
  // DEMON (envelope) modulation components: blade-rate harmonics + shaft asymmetry, per shaft
  function modsFor(cls, speed) {
    if (!cls || cls.type === 'bio' || !cls.cav) return [];
    const fs = shaftHz(cls, speed), shafts = cls.shafts === 2 ? [fs, fs * TWIN_DETUNE] : [fs], M = [];
    shafts.forEach(s => {
      M.push({ f: s, a: 0.22 / shafts.length });
      [0.5, 0.26, 0.13].forEach((a, k) => M.push({ f: s * cls.blades * (k + 1), a: a / shafts.length }));
    });
    return M;
  }

  // ---------- watch / contacts ----------
  function makeContacts(watch, seed) {
    const rng = mulberry32(seed >>> 0), out = [], ids = {};
    watch.contacts.forEach((spec, i) => {
      const cls = D.byId[spec.cls];
      const c = {
        idx: i, cls, spec, speed: cls.type === 'bio' ? 0 : Math.round(pick(rng, spec.speed) * 10) / 10,
        lvl: spec.lvl, quiet: !!spec.quiet, kind: spec.kind || null, reported: null,
        ph: [], events: [], seed: (rng() * 4294967296) >>> 0
      };
      if (spec.brgRel) {
        const host = ids[spec.brgRel];
        const off = pick(rng, spec.off) * (rng() < 0.5 ? -1 : 1);
        c.brg0 = wrap360(host.brg0 + off); c.rate = host.rate;
      } else { c.brg0 = pick(rng, spec.brg); c.rate = pick(rng, spec.rate); }
      c.lines = linesFor(cls, c.speed); c.mods = modsFor(cls, c.speed);
      c.lines.forEach(() => c.ph.push(rng() * Math.PI * 2));
      c.mph = c.mods.map(() => rng() * Math.PI * 2);
      if (cls.type === 'bio') c.events = bioEvents(c.kind, mulberry32(c.seed), (watch.duration || 300) + 120);
      if (spec.id) ids[spec.id] = c;
      out.push(c);
    });
    return out;
  }
  function bioEvents(kind, rng, T) {
    const ev = []; let t = -10 + rng() * 3;
    while (t < T) {
      if (kind === 'fin') { // 20 Hz down-swept pulses, ~1 s long
        ev.push({ t0: t, d: 1.0, f0: 23 + rng(), f1: 17 + rng(), a: 0.55, h2: 0.25 });
        t += 5 + rng() * 2.5;
      } else { // humpback moans and whoops
        const f0 = 90 + rng() * 130, d = 1.2 + rng() * 2.2;
        ev.push({ t0: t, d, f0, f1: f0 * (0.65 + rng() * 0.8), a: 0.42, h2: 0.35 });
        t += d + 0.6 + rng() * 3.5;
      }
    }
    return ev;
  }
  function contactBearing(c, t) { return wrap360(c.brg0 + c.rate * t); }
  function beamGain(steer, brg) {
    const d = angDiff(steer, brg) / BEAM_SIGMA;
    return Math.max(BEAM_FLOOR, Math.exp(-0.5 * d * d));
  }

  // ---------- simulation ----------
  function Sim(watch, seed, opts) {
    opts = opts || {};
    this.watch = watch; this.seed = seed >>> 0;
    this.contacts = makeContacts(watch, this.seed);
    this.rng = mulberry32((this.seed ^ 0x9e3779b9) >>> 0); this.gn = gaussFn(this.rng);
    this.t = 0; this.steer = opts.steer != null ? opts.steer : 0; this.integ = 4;
    this.lo = new Float64Array(N_LO); this.env = new Float64Array(N_ENV);
    this.loP = null; this.dmP = null; this.loI = null; this.dmI = null;
    this.btr = null;
  }
  Sim.prototype.setSteer = function (b) {
    this.steer = wrap360(b);
    this.loI = null; this.dmI = null; // integration restarts on a new beam
  };
  Sim.prototype.bearings = function () { return this.contacts.map(c => contactBearing(c, this.t)); };

  Sim.prototype.genLow = function (n, t0) {
    const out = new Float64Array(n), gn = this.gn;
    let varTot = 1;
    const act = [];
    for (const c of this.contacts) {
      const g = beamGain(this.steer, contactBearing(c, t0)) * c.lvl;
      if (c.cls.type === 'bio') { varTot += (0.25 * g) ** 2; if (g > 0.02) act.push([c, g]); continue; }
      varTot += (c.cls.bb * g) ** 2 * 0.5;
      if (g > 0.02) act.push([c, g]);
    }
    const sd = Math.sqrt(varTot);
    for (let i = 0; i < n; i++) out[i] = gn() * sd;
    for (const [c, g] of act) {
      if (c.cls.type === 'bio') { addBio(out, c, g, t0, FS_LO); continue; }
      for (let j = 0; j < c.lines.length; j++) {
        const L = c.lines[j]; if (L.f >= FS_LO / 2) continue;
        const A = L.a * g, w = 2 * Math.PI * L.f, ph = c.ph[j];
        for (let i = 0; i < n; i++) out[i] += A * Math.sin(w * (t0 + i / FS_LO) + ph);
      }
    }
    return out;
  };
  function addBio(out, c, g, t0, fs) {
    const n = out.length, t1 = t0 + n / fs;
    for (const e of c.events) {
      if (e.t0 > t1 || e.t0 + e.d < t0) continue;
      const k = (e.f1 - e.f0) / e.d;
      for (let i = 0; i < n; i++) {
        const tau = t0 + i / fs - e.t0; if (tau < 0 || tau > e.d) continue;
        const env = Math.sin(Math.PI * tau / e.d), ph = 2 * Math.PI * (e.f0 * tau + 0.5 * k * tau * tau);
        out[i] += g * e.a * env * (Math.sin(ph) + e.h2 * Math.sin(2 * ph));
      }
    }
  }
  // high band: cavitation hiss amplitude-modulated by the propeller; returns decimated squared envelope
  Sim.prototype.genEnv = function (n, t0) {
    const gn = this.gn, x = new Float64Array(n);
    for (let i = 0; i < n; i++) x[i] = gn();               // ambient hiss
    for (const c of this.contacts) {
      if (!c.mods.length) continue;
      const g = beamGain(this.steer, contactBearing(c, t0)) * c.lvl * c.cls.cav;
      if (g < 0.01) continue;
      for (let i = 0; i < n; i++) {
        const t = t0 + i / FS_HI; let m = 1;
        for (let j = 0; j < c.mods.length; j++) m += 0.9 * c.mods[j].a * Math.cos(2 * Math.PI * c.mods[j].f * t + c.mph[j]);
        x[i] += gn() * g * m;
      }
    }
    const out = new Float64Array(n / ENV_DEC);
    for (let b = 0; b < out.length; b++) { let s = 0; for (let i = 0; i < ENV_DEC; i++) { const v = x[b * ENV_DEC + i]; s += v * v; } out[b] = s / ENV_DEC; }
    return out;
  };
  Sim.prototype.btrRow = function () {
    const row = new Float64Array(360), bs = this.bearings();
    for (let b = 0; b < 360; b++) row[b] = 1 + 0.045 * this.gn();
    this.contacts.forEach((c, i) => {
      const P = c.cls.type === 'bio' ? 0.35 : Math.max(c.cls.bb, c.cls.cav * 0.8, c.quiet ? 0.42 : 0);
      const p = (P * c.lvl) ** 2;
      for (let d = -25; d <= 25; d++) {
        const b = wrap360(Math.round(bs[i]) + d), gg = beamGain(b, bs[i]);
        row[b] += p * gg * gg * (c.cls.type === 'bio' ? 0.6 + 0.8 * this.rng() : 1);
      }
    });
    return row;
  };
  function shiftIn(buf, add) { buf.copyWithin(0, add.length); buf.set(add, buf.length - add.length); }
  function integrate(prev, cur, k) {
    if (!prev || k <= 1) return Float64Array.from(cur);
    const out = new Float64Array(cur.length);
    for (let i = 0; i < cur.length; i++) out[i] = prev[i] + (cur[i] - prev[i]) / k;
    return out;
  }
  Sim.prototype.step = function () {
    const t0 = this.t;
    shiftIn(this.lo, this.genLow(Math.round(STEP * FS_LO), t0));
    shiftIn(this.env, this.genEnv(Math.round(STEP * FS_HI), t0));
    this.loP = powerSpectrum(this.lo, LO_BINS, false);
    this.dmP = powerSpectrum(this.env, DM_BINS, true);
    this.loI = integrate(this.loI, this.loP, this.integ);
    this.dmI = integrate(this.dmI, this.dmP, this.integ);
    this.btr = this.btrRow();
    this.t += STEP;
  };
  // fill the FFT buffers before the watch starts (negative time)
  Sim.prototype.prime = function (seconds) {
    const keep = this.t; this.t = keep - seconds;
    while (this.t < keep - 1e-9) this.step();
    this.t = keep;
  };

  // ---------- reports and scoring ----------
  function speedOf(c) { return c.speed; }
  function explain(c) {
    const cls = c.cls;
    if (cls.type === 'bio') {
      return c.kind === 'fin'
        ? 'Fin whale: one-second pulses sweeping down from about 23 to 17 Hz every 5-8 s. Machinery lines never sweep.'
        : 'Humpback whale: moans and whoops gliding across 60-350 Hz, with no steady lines and no propeller rhythm.';
    }
    const fs = shaftHz(cls, c.speed), rpm = fs * 60, parts = [];
    parts.push(`${cls.mains} Hz plant (${cls.mains === 50 ? 'lines at 50/100/150' : 'lines at 60/120/180'}).`);
    if (cls.cav) parts.push(`DEMON: blade rate ${(fs * cls.blades).toFixed(2)} Hz = ${cls.blades} x shaft ${fs.toFixed(2)} Hz${cls.shafts === 2 ? ' (twin shafts: paired lines)' : ''}.`);
    else parts.push(`No cavitation; blade-rate hull line on LOFAR at ${(fs * cls.blades).toFixed(2)} Hz = ${cls.blades} x ${fs.toFixed(2)} Hz.`);
    if (cls.cyl) parts.push(`Diesel firing line ${(fs * cls.cyl).toFixed(1)} Hz = ${cls.cyl} cylinders x shaft.`);
    cls.fixed.forEach(([f]) => parts.push(`Auxiliary line at ${f} Hz.`));
    parts.push(`${rpm.toFixed(0)} RPM / ${cls.tpk} TPK = ${c.speed.toFixed(1)} kn.`);
    return parts.join(' ');
  }
  function score(sim, rep) {
    // rep: {brg, cls, speed}
    const bs = sim.bearings();
    const cand = sim.contacts.map((c, i) => ({ c, d: Math.abs(angDiff(rep.brg, bs[i])) }))
      .filter(o => !o.c.reported && o.d <= 7);
    if (!cand.length) return { ok: false, falseContact: true, points: -25, text: 'No contact on that bearing. False report.' };
    cand.sort((a, b) => a.d - b.d);
    const hit = cand.find(o => o.c.cls.id === rep.cls) || cand[0];
    const c = hit.c, classOK = c.cls.id === rep.cls, repCls = D.byId[rep.cls];
    let pts = 0, speedErr = null, speedPts = 0;
    if (classOK) pts += 100;
    if (c.cls.type !== 'bio') {
      speedErr = rep.speed == null ? null : Math.abs(rep.speed - c.speed);
      if (speedErr != null) speedPts = speedErr <= 2 ? 50 : speedErr <= 4 ? 20 : 0;
      pts += speedPts;
    }
    const flagErr = c.cls.flag === 'Red' && (!repCls || repCls.flag !== 'Red');
    const blueOnRed = c.cls.flag !== 'Red' && repCls && repCls.flag === 'Red';
    if (flagErr) pts -= 50;
    if (blueOnRed) pts -= 30;
    return { ok: true, contact: c, classOK, speedErr, speedPts, flagErr, blueOnRed, points: pts, truth: explain(c) };
  }

  // ---------- automatic operator (used by tests to prove each contact is identifiable) ----------
  function dbAt(P, f, res, floor) {
    const k = Math.round(f / res); if (k < 1 || k >= P.length - 1) return null;
    return 10 * Math.log10(P[k] / floor);
  }
  function median(a) { const s = Array.from(a).sort((x, y) => x - y); return s[s.length >> 1]; }
  // template match: mean level of the lines a class would radiate at a given speed (nearest bin only)
  // known: [{cls, speed}] contacts already identified on this beam; their lines are masked out
  function classify(lo, dm, exclude, known, maskW) {
    exclude = exclude || []; known = known || []; maskW = maskW == null ? 2 : maskW;
    const maskLo = new Uint8Array(lo.length), maskDm = new Uint8Array(dm.length);
    for (const k of known) {
      const kc = D.byId[k.cls];
      linesFor(kc, k.speed).forEach(l => { const b = Math.round(l.f / LO_RES); for (let j = b - maskW; j <= b + maskW; j++) if (j >= 0 && j < lo.length) maskLo[j] = 1; });
      modsFor(kc, k.speed).forEach(m => { const b = Math.round(m.f / DM_RES); for (let j = b - 2; j <= b + 2; j++) if (j >= 0 && j < dm.length) maskDm[j] = 1; });
    }
    const fl = median(lo.slice(4)), fd = median(dm.slice(4));
    let dmax = 0; for (let k = 6; k < dm.length; k++) dmax = Math.max(dmax, 10 * Math.log10(dm[k] / fd));
    let best = null;
    for (const cls of D.BOOK) {
      if (cls.type === 'bio' || exclude.includes(cls.id)) continue;
      const lineMean = (L) => {
        let s = 0, w = 0;
        for (const l of L) {
          if (maskLo[Math.round(l.f / LO_RES)]) { w += l.a * 0.5; continue; }
          const d = dbAt(lo, l.f, LO_RES, fl); if (d == null) continue;
          s += Math.max(-3, Math.min(d, 12)) * l.a; w += l.a;
        }
        return w > 0 ? s / w : 0;
      };
      for (let v = cls.speed[0]; v <= cls.speed[1] + 1e-9; v += 0.1) {
        const L = linesFor(cls, v).filter(l => l.f > 3 && l.f < LO_MAX - 2);
        // fingerprint: plant mains family + auxiliary machinery (speed independent)
        const fp = lineMean(L.filter(l => l.kind === 'mains' || l.kind === 'aux'));
        // propulsion: shaft / blade / firing lines on LOFAR, plus the DEMON rhythm
        let sp = lineMean(L.filter(l => l.kind !== 'mains' && l.kind !== 'aux'));
        const M = modsFor(cls, v).filter(m => m.f < DM_MAX - 1);
        if (M.length) {
          let ds = 0, dw = 0;
          for (const m of M) { if (maskDm[Math.round(m.f / DM_RES)]) { dw += m.a * 0.5; continue; } const d = dbAt(dm, m.f, DM_RES, fd); if (d == null) continue; ds += Math.max(-3, Math.min(d, 12)) * m.a; dw += m.a; }
          if (dw > 0) sp = 0.5 * sp + 0.5 * (ds / dw);
        } else sp -= Math.max(0, dmax - 8);
        const score = 0.5 * fp + 0.5 * sp;
        if (!best || score > best.score) best = { cls: cls.id, speed: Math.round(v * 10) / 10, score };
      }
    }
    if (!best || best.score < 3) return { cls: 'bio', speed: null, score: best ? best.score : 0 };
    return best;
  }

  const API = {
    FS_LO, FS_HI, FS_ENV, STEP, N_LO, N_ENV, LO_MAX, DM_MAX, LO_BINS, DM_BINS, LO_RES, DM_RES, BEAM_SIGMA,
    mulberry32, fft, powerSpectrum, shaftHz, linesFor, modsFor, makeContacts, contactBearing, beamGain, angDiff, wrap360,
    Sim, score, explain, classify, median, speedOf
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else G.BRSIM = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
