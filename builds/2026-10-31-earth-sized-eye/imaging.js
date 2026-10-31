// Earth-Sized Eye: imaging core (pure logic, no DOM). Works in the browser (window.Imaging) and in node (require).
// Units: angles on the sky in microarcseconds (uas), baselines in metres, (u,v) in wavelengths.
(function (root) {
  'use strict';

  const N = 128;                       // image / uv grid size
  const FOV_UAS = 200;                 // field of view across the grid
  const UAS = Math.PI / 180 / 3600 / 1e6; // radians per microarcsecond
  const DL = FOV_UAS / N;              // pixel size in uas
  const DU = 1 / (FOV_UAS * UAS);      // uv cell size in wavelengths
  const LAMBDA = 1.3e-3;               // observing wavelength (m), 230 GHz
  const R_EARTH = 6371e3;
  const MIN_EL = 15 * Math.PI / 180;   // elevation limit for ground dishes
  const SIDEREAL_DAY_H = 23.934;

  // ---------- RNG ----------
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash2(a, b, seed) { // deterministic per-cell hash -> [0,1)
    let h = (Math.imul(a + 7919, 374761393) ^ Math.imul(b + 104729, 668265263) ^ Math.imul(seed + 1, 2246822519)) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
    return h / 4294967296;
  }
  function gaussPair(r1, r2) {
    const r = Math.sqrt(-2 * Math.log(Math.max(r1, 1e-12)));
    return [r * Math.cos(2 * Math.PI * r2), r * Math.sin(2 * Math.PI * r2)];
  }

  // ---------- FFT ----------
  function fft1d(re, im, n, inverse) {
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (inverse ? 2 : -2) * Math.PI / len;
      const wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const a = i + k, b = a + len / 2;
          const tr = re[b] * cr - im[b] * ci;
          const ti = re[b] * ci + im[b] * cr;
          re[b] = re[a] - tr; im[b] = im[a] - ti;
          re[a] += tr; im[a] += ti;
          const ncr = cr * wr - ci * wi;
          ci = cr * wi + ci * wr; cr = ncr;
        }
      }
    }
    if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
  }
  // 2D FFT in place on n*n row-major arrays
  function fft2d(re, im, n, inverse) {
    const rr = new Float64Array(n), ri = new Float64Array(n);
    for (let y = 0; y < n; y++) {
      const o = y * n;
      for (let x = 0; x < n; x++) { rr[x] = re[o + x]; ri[x] = im[o + x]; }
      fft1d(rr, ri, n, inverse);
      for (let x = 0; x < n; x++) { re[o + x] = rr[x]; im[o + x] = ri[x]; }
    }
    for (let x = 0; x < n; x++) {
      for (let y = 0; y < n; y++) { rr[y] = re[y * n + x]; ri[y] = im[y * n + x]; }
      fft1d(rr, ri, n, inverse);
      for (let y = 0; y < n; y++) { re[y * n + x] = rr[y]; im[y * n + x] = ri[y]; }
    }
  }
  // swap quadrants (N even: shift == ishift)
  function fftshift(a, n) {
    const out = new a.constructor(a.length), h = n >> 1;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++)
      out[((y + h) % n) * n + ((x + h) % n)] = a[y * n + x];
    return out;
  }

  // Visibilities of a centred image: returns {re, im} in FFT order (index ku mod N, kv mod N)
  function visibilities(img) {
    const re = fftshift(img, N), im = new Float64Array(N * N);
    fft2d(re, im, N, false);
    return { re, im };
  }

  // ---------- geometry ----------
  function deg(x) { return x * Math.PI / 180; }
  // Earth-fixed position of a ground site (spherical Earth is fine at this level)
  function siteECEF(site) {
    const r = R_EARTH + (site.alt || 0), la = deg(site.lat), lo = deg(site.lon);
    return [r * Math.cos(la) * Math.cos(lo), r * Math.cos(la) * Math.sin(lo), r * Math.sin(la)];
  }
  // Inertial position of a station at Greenwich sidereal angle theta (rad). Source sits at RA 0.
  function stationECI(st, theta, tHours) {
    if (st.orbit) {
      const o = st.orbit; // {radius (m), periodH, inc (deg), phase (rad), raan (deg)}
      const m = o.phase + 2 * Math.PI * tHours / o.periodH;
      const x0 = o.radius * Math.cos(m), y0 = o.radius * Math.sin(m);
      const ci = Math.cos(deg(o.inc)), si = Math.sin(deg(o.inc));
      const x1 = x0, y1 = y0 * ci, z1 = y0 * si;
      const cr = Math.cos(deg(o.raan || 0)), sr = Math.sin(deg(o.raan || 0));
      return [x1 * cr - y1 * sr, x1 * sr + y1 * cr, z1];
    }
    const p = st._ecef || (st._ecef = siteECEF(st));
    const c = Math.cos(theta), s = Math.sin(theta);
    return [c * p[0] - s * p[1], s * p[0] + c * p[1], p[2]];
  }
  function sourceDir(decDeg) { const d = deg(decDeg); return [Math.cos(d), 0, Math.sin(d)]; }
  // Can the station see the source? ground: elevation > limit; orbit: Earth does not block the line of sight.
  function canSee(st, pos, s) {
    const r = Math.hypot(pos[0], pos[1], pos[2]);
    const dot = (pos[0] * s[0] + pos[1] * s[1] + pos[2] * s[2]);
    if (!st.orbit) return dot / r > Math.sin(MIN_EL);
    if (dot >= 0) return true;
    const perp2 = r * r - dot * dot; // squared distance of ray line from Earth centre
    return perp2 > (R_EARTH + 100e3) ** 2;
  }
  function elevationDeg(st, theta, decDeg) {
    const p = stationECI(st, theta, 0), s = sourceDir(decDeg);
    const r = Math.hypot(p[0], p[1], p[2]);
    return Math.asin((p[0] * s[0] + p[1] * s[1] + p[2] * s[2]) / r) * 180 / Math.PI;
  }
  // (u,v) in wavelengths for baseline b = p2 - p1 and source at dec, RA 0.
  function uvOf(p1, p2, decDeg) {
    const d = deg(decDeg);
    const bx = p2[0] - p1[0], by = p2[1] - p1[1], bz = p2[2] - p1[2];
    const u = by;                                      // east unit vector (0,1,0)
    const v = -Math.sin(d) * bx + Math.cos(d) * bz;    // north unit vector (-sin d, 0, cos d)
    return [u / LAMBDA, v / LAMBDA];
  }

  // ---------- observation (accumulates samples into a uv grid) ----------
  // stations: [{name, lat, lon, alt, diam, orbit?}], weather: per station array of [startH, endH] cloudy intervals
  function Observation(stations, decDeg, opts) {
    opts = opts || {};
    this.stations = stations;
    this.dec = decDeg;
    this.seed = opts.seed || 1;
    this.noiseScale = opts.noiseScale == null ? 1 : opts.noiseScale;
    this.weather = opts.weather || stations.map(() => []);
    this.count = new Float64Array(N * N);   // samples per cell (hermitian included)
    this.ivar = new Float64Array(N * N);    // summed inverse noise variance per cell (1/sigma^2)
    this.samples = [];                      // {u, v, i, j, t} for drawing
    this.t = 0;
    this.nSamples = 0;
  }
  Observation.prototype.cloudy = function (i, t) {
    const w = this.weather[i];
    for (let k = 0; k < w.length; k++) if (t >= w[k][0] && t < w[k][1]) return true;
    return false;
  };
  // which stations can see the source right now (and are not clouded out)
  Observation.prototype.visibleAt = function (t) {
    const theta = 2 * Math.PI * t / SIDEREAL_DAY_H, s = sourceDir(this.dec);
    return this.stations.map((st, i) => {
      const p = stationECI(st, theta, t);
      return { pos: p, up: canSee(st, p, s), cloudy: this.cloudy(i, t) };
    });
  };
  // advance the observation from this.t to t1 hours in steps of dt hours; returns new samples
  Observation.prototype.advance = function (t1, dt) {
    dt = dt || 0.05;
    const added = [];
    while (this.t + dt <= t1 + 1e-9) {
      this.t += dt;
      const vis = this.visibleAt(this.t);
      for (let i = 0; i < vis.length; i++) {
        if (!vis[i].up || vis[i].cloudy) continue;
        for (let j = i + 1; j < vis.length; j++) {
          if (!vis[j].up || vis[j].cloudy) continue;
          const uv = uvOf(vis[i].pos, vis[j].pos, this.dec);
          const smp = { u: uv[0], v: uv[1], i, j, t: this.t };
          if (this.addSample(smp)) added.push(smp);
        }
      }
    }
    return added;
  };
  Observation.prototype.addSample = function (smp) {
    const ku = Math.round(smp.u / DU), kv = -Math.round(smp.v / DU); // array y runs down, sky m runs up
    if (Math.abs(ku) >= N / 2 || Math.abs(kv) >= N / 2) return false;
    const di = this.stations[smp.i].diam, dj = this.stations[smp.j].diam;
    const sigma = this.noiseScale * 0.07 * (30 / di) * (30 / dj); // per-sample thermal noise (flux units)
    for (const sgn of [1, -1]) {
      const c = ((sgn * kv + N) % N) * N + ((sgn * ku + N) % N);
      this.count[c] += 1;
      this.ivar[c] += 1 / (sigma * sigma + 1e-12);
    }
    this.samples.push(smp);
    this.nSamples++;
    return true;
  };
  Observation.prototype.coverage = function () { // fraction of cells within Earth-size disk that are filled
    let filled = 0;
    for (let c = 0; c < N * N; c++) if (this.count[c] > 0) filled++;
    return filled;
  };

  // Dirty image + dirty beam from an observation and the true visibilities.
  // Robust (Briggs-like) weighting: w = W / (1 + W / Wc), W = inverse variance of the cell mean, Wc = median W * robust.
  // High-SNR cells tend to uniform weight, noisy cells (small dishes, long thin tracks) are down-weighted.
  function makeDirty(obs, vis, robust) {
    robust = robust == null ? 1 : robust;
    const ws = [];
    for (let c = 0; c < N * N; c++) if (obs.count[c]) ws.push(obs.ivar[c]);
    if (!ws.length) return null;
    ws.sort((a, b) => a - b);
    const wc = ws[ws.length >> 1] * robust;
    const re = new Float64Array(N * N), im = new Float64Array(N * N);
    const bre = new Float64Array(N * N), bim = new Float64Array(N * N);
    let wsum = 0, nvar = 0;
    for (let kv = 0; kv < N; kv++) for (let ku = 0; ku < N; ku++) {
      const c = kv * N + ku;
      const n = obs.count[c];
      if (!n) continue;
      const W = obs.ivar[c], w = W / (1 + W / wc);
      const sig = 1 / Math.sqrt(W) / Math.SQRT2; // per real/imag component noise of the cell mean
      // hermitian-consistent noise: generate from the canonical (lexicographically smaller) cell
      const cu = ku > N / 2 ? ku - N : ku, cv = kv > N / 2 ? kv - N : kv;
      const canon = (cv < 0 || (cv === 0 && cu < 0)) ? -1 : 1;
      const g = gaussPair(hash2(canon * cu, canon * cv, obs.seed), hash2(canon * cv + 999, canon * cu, obs.seed));
      re[c] = w * (vis.re[c] + sig * g[0]);
      im[c] = w * (vis.im[c] + canon * sig * g[1]);
      bre[c] = w;
      wsum += w;
      nvar += w * w * sig * sig * 2;
    }
    if (!wsum) return null;
    fft2d(re, im, N, true);
    fft2d(bre, bim, N, true);
    const scale = N * N / wsum;
    const dirty = new Float64Array(N * N), beam = new Float64Array(N * N);
    const sre = fftshift(re, N), sbe = fftshift(bre, N);
    for (let i = 0; i < N * N; i++) { dirty[i] = sre[i] * scale; beam[i] = sbe[i] * scale; }
    return { dirty, beam, wsum, noiseRms: Math.sqrt(nvar) / wsum };
  }

  // Gaussian restoring beam estimated from the uv distribution: beam covariance = inverse uv covariance / (4 pi^2)
  function fitBeam(obs) {
    let suu = 0, svv = 0, suv = 0, n = 0;
    for (let kv = 0; kv < N; kv++) for (let ku = 0; ku < N; ku++) {
      if (!obs.count[kv * N + ku]) continue;
      const u = ku >= N / 2 ? ku - N : ku, v = kv >= N / 2 ? kv - N : kv;
      suu += u * u; svv += v * v; suv += u * v; n++;
    }
    if (!n) return { sxx: 100, syy: 100, sxy: 0 };
    suu /= n; svv /= n; suv /= n;
    suu += 0.25; svv += 0.25;                          // regularise (cell quantisation)
    const det = suu * svv - suv * suv;
    // pixel units: beam cov = [[svv,-suv],[-suv,suu]]/det / (4 pi^2) * N^2  (since du*dl*N = 1)
    const k = 0.5 * N * N / (4 * Math.PI * Math.PI) / det; // 0.5: Gaussian-of-uv estimate is ~1.4x wider than the real main lobe
    let sxx = svv * k, syy = suu * k, sxy = -suv * k;
    // clamp so a single baseline does not give an infinitely thin beam
    const minVar = 1.2 * 1.2, maxVar = 60 * 60;
    sxx = Math.min(Math.max(sxx, minVar), maxVar);
    syy = Math.min(Math.max(syy, minVar), maxVar);
    const lim = 0.95 * Math.sqrt(sxx * syy);
    sxy = Math.max(-lim, Math.min(lim, sxy));
    return { sxx, syy, sxy };
  }
  function gaussianKernel(b) { // centred, peak 1
    const out = new Float64Array(N * N);
    const det = b.sxx * b.syy - b.sxy * b.sxy;
    const ixx = b.syy / det, iyy = b.sxx / det, ixy = -b.sxy / det;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const dx = x - N / 2, dy = y - N / 2;
      const q = ixx * dx * dx + 2 * ixy * dx * dy + iyy * dy * dy;
      out[y * N + x] = q < 60 ? Math.exp(-0.5 * q) : 0;
    }
    return out;
  }
  // circular convolution of a centred image with a centred kernel
  function convolve(img, kernel) {
    const ar = fftshift(img, N), ai = new Float64Array(N * N);
    const br = fftshift(kernel, N), bi = new Float64Array(N * N);
    fft2d(ar, ai, N, false); fft2d(br, bi, N, false);
    for (let i = 0; i < N * N; i++) {
      const r = ar[i] * br[i] - ai[i] * bi[i];
      ai[i] = ar[i] * bi[i] + ai[i] * br[i]; ar[i] = r;
    }
    fft2d(ar, ai, N, true);
    return fftshift(ar, N);
  }

  const WINDOW = (function () {
    const w = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (Math.hypot(x - N / 2, y - N / 2) < N * 0.42) w.push(y * N + x);
    return Int32Array.from(w);
  })();
  // Hogbom CLEAN, run incrementally: state = {residual, comps, beam, iter, done}
  function cleanStart(d) {
    return { residual: Float64Array.from(d.dirty), comps: new Float64Array(N * N), beam: d.beam, iter: 0, done: false, peak0: 0,
      noise: d.noiseRms || 0 };
  }
  function cleanStep(st, iters, gain, thresholdFrac) {
    gain = gain || 0.1; thresholdFrac = thresholdFrac == null ? 0.04 : thresholdFrac;
    const r = st.residual, b = st.beam, h = N >> 1;
    for (let it = 0; it < iters && !st.done; it++) {
      // search only inside the clean window (central circle); stop at a fraction of the first peak or ~3 sigma noise
      let best = -Infinity, bi = 0;
      for (let i = 0; i < WINDOW.length; i++) { const k = WINDOW[i]; if (r[k] > best) { best = r[k]; bi = k; } }
      if (!st.peak0) st.peak0 = best;
      if (best <= Math.max(thresholdFrac * st.peak0, 3 * st.noise) || st.iter >= 3000) { st.done = true; break; }
      const amp = gain * best, px = bi % N, py = (bi / N) | 0;
      st.comps[bi] += amp;
      for (let y = 0; y < N; y++) {
        const by = ((y - py + h) % N + N) % N, ro = y * N, bo = by * N;
        for (let x = 0; x < N; x++) {
          const bx = ((x - px + h) % N + N) % N;
          r[ro + x] -= amp * b[bo + bx];
        }
      }
      st.iter++;
    }
    return st;
  }
  function restore(st, beamShape) {
    const k = gaussianKernel(beamShape);
    const sm = convolve(st.comps, k);
    const out = new Float64Array(N * N);
    for (let i = 0; i < N * N; i++) out[i] = sm[i] + st.residual[i];
    return out;
  }

  // normalised cross-correlation in [-1,1]
  function ncc(a, b) {
    let ma = 0, mb = 0;
    for (let i = 0; i < a.length; i++) { ma += a[i]; mb += b[i]; }
    ma /= a.length; mb /= b.length;
    let sab = 0, saa = 0, sbb = 0;
    for (let i = 0; i < a.length; i++) {
      const x = a[i] - ma, y = b[i] - mb;
      sab += x * y; saa += x * x; sbb += y * y;
    }
    return saa && sbb ? sab / Math.sqrt(saa * sbb) : 0;
  }
  // Fidelity: compare both images at a fixed reference resolution (so sharper is never punished)
  const REF_BEAM = { sxx: 5 * 5, syy: 5 * 5, sxy: 0 }; // ~19 uas FWHM
  function fidelity(image, truth) {
    const k = gaussianKernel(REF_BEAM);
    const a = convolve(image, k), b = convolve(truth, k);
    for (let i = 0; i < a.length; i++) if (a[i] < 0) a[i] = 0; // negative bowls are artefacts
    return Math.max(0, ncc(a, b));
  }

  // ---------- targets (procedural sky images, total flux ~1) ----------
  function blank() { return new Float64Array(N * N); }
  function forEachPix(fn) { // fn(l, m) in uas from centre, m up
    const img = blank();
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const l = (x - N / 2 + 0.5) * DL, m = (N / 2 - y - 0.5) * DL;
      img[y * N + x] = Math.max(0, fn(l, m));
    }
    return img;
  }
  function normalise(img, flux) {
    let s = 0; for (let i = 0; i < img.length; i++) s += img[i];
    if (s > 0) for (let i = 0; i < img.length; i++) img[i] *= (flux || 1) / s;
    return img;
  }
  function smoothstep(e0, e1, x) { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); }
  const Targets = {
    binary(p) { // two blobs separated by sep along angle (deg, 0 = east/right, CCW)
      const a = deg(p.angle), dx = Math.cos(a) * p.sep / 2, dy = Math.sin(a) * p.sep / 2, s = p.size || 7;
      return normalise(forEachPix((l, m) =>
        Math.exp(-((l - dx) ** 2 + (m - dy) ** 2) / (2 * s * s)) +
        (p.ratio || 0.8) * Math.exp(-((l + dx) ** 2 + (m + dy) ** 2) / (2 * s * s))));
    },
    ring(p) { // radius r, width w, brightness asymmetry a toward angle pa (deg, 0 = up, clockwise like a clock)
      const pa = deg(p.pa || 0);
      return normalise(forEachPix((l, m) => {
        const r = Math.hypot(l, m), th = Math.atan2(l, m); // clock angle from up
        const ring = Math.exp(-((r - p.r) ** 2) / (2 * p.w * p.w));
        return ring * (1 + (p.a || 0) * Math.cos(th - pa)) + (p.jet ? p.jet * jet(l, m, p.jetPa || 0) : 0);
      }));
    },
    disk(p) {
      return normalise(forEachPix((l, m) => 1 - smoothstep(p.r - 3, p.r + 3, Math.hypot(l, m))));
    },
    pumpkin(p) {
      const s = p.scale || 1;
      return normalise(forEachPix((L, M) => {
        const l = L / s, m = M / s;
        // body: three overlapping lobes
        let body = 0;
        for (const cx of [-22, 0, 22]) {
          const d = Math.hypot((l - cx) / 26, m / 30);
          body = Math.max(body, 1 - smoothstep(0.9, 1.0, d));
        }
        const stem = (Math.abs(l + 2) < 5 && m > 26 && m < 42) ? 1 : 0;
        // carved features (cut out)
        const tri = (cx, cy, sz) => { const y = m - cy, x = l - cx; return y < sz * 0.6 && y > -sz * 0.6 && Math.abs(x) < (sz * 0.6 - y) * 0.8; };
        let cut = tri(-15, 8, 11) || tri(15, 8, 11) || tri(0, -4, 6);
        const mouth = m < -10 && m > -22 && Math.abs(l) < 28 && !(m > -16 && (Math.abs(l) % 14) < 4);
        if (mouth) cut = true;
        return cut ? 0.05 * body : body + stem * 0.8;
      }));
    },
    ghost(p) {
      const s = p.scale || 1;
      return normalise(forEachPix((L, M) => {
        const l = L / s, m = M / s;
        let inside = false;
        if (m > 0) inside = Math.hypot(l, m) < 34;
        else if (m > -38) inside = Math.abs(l) < 34 && (m > -30 || Math.sin((l + 34) * Math.PI / 17) > (m + 34) / 4 - 0.5);
        if (!inside) return 0;
        const eye = Math.hypot(l + 12, m - 8) < 7 || Math.hypot(l - 12, m - 8) < 7;
        const mouth = Math.hypot(l / 1.2, m + 12) < 7;
        return (eye || mouth) ? 0.04 : 1;
      }));
    },
    bat(p) {
      const s = p.scale || 1;
      return normalise(forEachPix((L, M) => {
        const l = L / s, m = M / s, al = Math.abs(l);
        const body = Math.hypot(l / 9, (m + 2) / 16) < 1;
        const head = Math.hypot(l, m - 16) < 8 || (al > 2 && al < 8 && m > 16 && m < 26 - al * 0.4);
        const wingTop = 12 - (al - 8) * 0.25;
        const scallop = -4 + 5 * Math.abs(Math.sin(al * Math.PI / 16));
        const wing = al > 6 && al < 60 && m < wingTop && m > scallop - (60 - al) * 0.12;
        return body || head || wing ? 1 : 0;
      }));
    },
  };
  function jet(l, m, paDeg) { // faint knotty jet along clock angle pa
    const pa = deg(paDeg), ux = Math.sin(pa), uy = Math.cos(pa);
    const along = l * ux + m * uy, across = -l * uy + m * ux;
    if (along < 18) return 0;
    return Math.exp(-(across * across) / (2 * 4 * 4)) * Math.exp(-(along - 18) / 40) * (0.6 + 0.4 * Math.cos(along / 6));
  }

  const api = {
    N, FOV_UAS, DL, DU, LAMBDA, R_EARTH, SIDEREAL_DAY_H, UAS,
    mulberry32, fft1d, fft2d, fftshift, visibilities,
    siteECEF, stationECI, sourceDir, canSee, elevationDeg, uvOf,
    Observation, makeDirty, fitBeam, gaussianKernel, convolve,
    cleanStart, cleanStep, restore, ncc, fidelity, Targets, normalise,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Imaging = api;
})(typeof window !== 'undefined' ? window : globalThis);
