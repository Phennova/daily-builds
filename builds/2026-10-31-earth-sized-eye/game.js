// Earth-Sized Eye: game shell, rendering, audio and UI.
(function () {
  'use strict';
  const I = window.Imaging, N = I.N;
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const DEMO = params.has('demo'), SELFTEST = params.has('selftest');
  const reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const DT = 0.1; // observation step in hours
  const ORBIT_R = 3.2 * I.R_EARTH;

  // ---------- observatories (effective dish diameter for phased arrays) ----------
  const SITES = [
    { id: 'ALMA', name: 'ALMA', where: 'Atacama, Chile', lat: -23.029, lon: -67.755, alt: 5070, diam: 73, cost: 4, wx: 0.10 },
    { id: 'APEX', name: 'APEX', where: 'Atacama, Chile', lat: -23.006, lon: -67.759, alt: 5104, diam: 12, cost: 1, wx: 0.10 },
    { id: 'LMT', name: 'LMT', where: 'Sierra Negra, Mexico', lat: 18.986, lon: -97.315, alt: 4593, diam: 50, cost: 3, wx: 0.30 },
    { id: 'SMA', name: 'SMA', where: 'Mauna Kea, Hawaii', lat: 19.824, lon: -155.478, alt: 4080, diam: 15, cost: 2, wx: 0.20 },
    { id: 'SMT', name: 'SMT', where: 'Mt Graham, Arizona', lat: 32.702, lon: -109.891, alt: 3185, diam: 10, cost: 1, wx: 0.25 },
    { id: 'IRAM', name: 'IRAM 30m', where: 'Pico Veleta, Spain', lat: 37.066, lon: -3.393, alt: 2850, diam: 30, cost: 3, wx: 0.35 },
    { id: 'NOEMA', name: 'NOEMA', where: 'French Alps', lat: 44.634, lon: 5.907, alt: 2550, diam: 52, cost: 3, wx: 0.40 },
    { id: 'SPT', name: 'SPT', where: 'South Pole', lat: -89.99, lon: -45, alt: 2816, diam: 10, cost: 2, wx: 0.05 },
    { id: 'GLT', name: 'GLT', where: 'Pituffik, Greenland', lat: 76.535, lon: -68.686, alt: 100, diam: 12, cost: 2, wx: 0.25 },
    { id: 'AMT', name: 'AMT*', where: 'Gamsberg, Namibia (planned)', lat: -23.34, lon: 16.23, alt: 2347, diam: 15, cost: 2, wx: 0.15 },
    { id: 'HAN', name: 'Hanle*', where: 'Ladakh, India (hypothetical)', lat: 32.779, lon: 78.964, alt: 4500, diam: 15, cost: 2, wx: 0.25 },
    { id: 'ATCA', name: 'Narrabri*', where: 'NSW, Australia (hypothetical)', lat: -30.313, lon: 149.55, alt: 237, diam: 22, cost: 2, wx: 0.45 },
    { id: 'ORB', name: 'Orbiter', where: 'space dish, 8 h orbit', diam: 12, cost: 5, wx: 0,
      orbit: { radius: ORBIT_R, periodH: 8.05, inc: 58, phase: 0.6, raan: 40 } },
  ];
  const SITE = Object.fromEntries(SITES.map((s) => [s.id, s]));
  const PAIR_COLORS = ['#ffb347', '#7fc8ff', '#8be28b', '#ff7aa8', '#c9a0ff', '#ffe066', '#5ee0d0', '#ff8a5c', '#a0b4ff', '#e6e6e6', '#b5e655', '#ffa0e0'];

  // ---------- nights ----------
  const GROUND = SITES.filter((s) => !s.orbit).map((s) => s.id);
  function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
  function makeNight(idx, rng) {
    const T = I.Targets;
    if (idx === 0) {
      const angles = [0, 45, 90, 135], a = pick(rng, angles);
      const mk = (ang) => T.binary({ sep: 46, angle: ang, size: 6, ratio: 0.75 });
      return {
        title: 'First fringes', target: 'a close pair of radio hot spots', dec: 30,
        story: 'Three dishes are already linked for you: Mauna Kea, Mexico and Spain. Your target is a pair of hot spots far too close together for any single telescope to split.',
        goal: 'Watch how each pair of dishes paints stripes ("fringes") onto the image, and how the turning Earth fills in the picture.',
        question: 'Which way is the pair lined up?', fixed: ['SMA', 'LMT', 'IRAM'], avail: ['SMA', 'LMT', 'IRAM'], budget: 0, maxSites: 3,
        truth: mk(a), options: angles.map((g) => ({ label: ['east-west', 'tilted /', 'north-south', 'tilted \\'][angles.indexOf(g)], img: mk(g) })), correct: angles.indexOf(a),
      };
    }
    if (idx === 1) {
      const kinds = ['ring', 'disk', 'crescent'], k = pick(rng, kinds);
      const mk = (kk) => kk === 'ring' ? T.ring({ r: 24, w: 4, a: 0.1, pa: 0 }) : kk === 'disk' ? T.disk({ r: 26 }) : T.ring({ r: 22, w: 6, a: 0.95, pa: 300 });
      return {
        title: 'Ring or disk?', target: 'a test source of unknown shape', dec: -8,
        story: 'Now you choose. Pick any four observatories. Far-apart dishes see fine detail; dishes spread in many directions fill the picture evenly.',
        goal: 'Spread your four dishes out. The shaded tracks on the (u,v) plane preview what each choice will measure.',
        question: 'What shape is it?', fixed: [], avail: GROUND, budget: 0, maxSites: 4,
        truth: mk(k), options: kinds.map((kk) => ({ label: kk, img: mk(kk) })), correct: kinds.indexOf(k),
      };
    }
    if (idx === 2) {
      const pas = [0, 90, 180, 270], p = pick(rng, pas), jit = (rng() - 0.5) * 30;
      const mk = (pa, j) => T.ring({ r: 21, w: 4, a: 0.75, pa: pa + (j || 0) });
      return {
        title: 'M87*', target: 'the black hole in galaxy M87, 55 million light-years away', dec: 12.39,
        story: 'The real thing: 6.5 billion Suns of black hole, whose shadow is 42 microarcseconds across. That is a doughnut on the Moon, seen from Earth. You have 10 credits; big dishes cost more but are far more sensitive.',
        goal: 'Get a ring. Hot gas whirling around the hole near light speed is beamed toward us on one side, so one side of the ring is brighter.',
        question: 'Where is the bright side of the ring?', fixed: [], avail: GROUND, budget: 10, maxSites: 99,
        truth: mk(p, jit), options: pas.map((pa) => ({ label: ['12 o\u2019clock', '3 o\u2019clock', '6 o\u2019clock', '9 o\u2019clock'][pas.indexOf(pa)], img: mk(pa) })), correct: pas.indexOf(p),
      };
    }
    if (idx === 3) {
      const ds = [36, 48, 60], d = pick(rng, ds), pa = rng() * 360;
      const mk = (dd, pp) => T.ring({ r: dd / 2, w: 4, a: 0.35, pa: pp });
      return {
        title: 'Sgr A*', target: 'the black hole at the centre of our own Milky Way', dec: -29.0,
        story: 'Sagittarius A* sits low in the northern sky (declination -29\u00b0). Some dishes will barely see it; one at the bottom of the world sees it all night. Budget: 9 credits.',
        goal: 'The ring\u2019s diameter tells you the mass: twice the diameter means twice the mass.',
        question: 'How big is the ring, and so how heavy is the black hole?', fixed: [], avail: GROUND, budget: 9, maxSites: 99,
        truth: mk(d, pa), options: ds.map((dd) => ({ label: dd + ' \u00b5as \u00b7 ' + (4.3 * dd / 52).toFixed(1) + 'M \u2609', img: mk(dd, 200) })), correct: ds.indexOf(d),
      };
    }
    const kinds = ['pumpkin', 'ghost', 'bat', 'ring'], k = pick(rng, kinds);
    const mk = (kk) => kk === 'ring' ? T.ring({ r: 30, w: 6, a: 0.4, pa: 120 }) : T[kk]({ scale: 1 });
    return {
      title: 'Something in the dark', target: 'an unknown object that appeared tonight', dec: 20,
      story: 'Halloween. A bright new radio source has appeared where the catalogues show nothing. Every observatory is yours for 14 credits, and the space agency is offering time on an orbiting dish whose baselines reach far beyond the Earth.',
      goal: 'Earth-sized baselines may not be enough to tell what this is. Longer baselines mean finer detail.',
      question: 'What is it?', fixed: [], avail: SITES.map((s) => s.id), budget: 14, maxSites: 99,
      truth: mk(k), options: kinds.map((kk) => ({ label: kk === 'ring' ? 'black hole' : kk, img: mk(kk) })), correct: kinds.indexOf(k),
    };
  }
  const NIGHTS = 5;

  // ---------- state ----------
  const S = {
    screen: 'title', nightIdx: 0, night: null, selected: new Set(), obs: null, vis: null, t: 0, speed: 1,
    dirty: null, dirtyAt: 0, cleanSt: null, restored: null, beam: null, fid: 0, answer: -1, results: [],
    planT: 0, preview: null, previewKey: '', log: [], weather: null, uvDirty: true, imgDirty: true, lastSamples: [],
    seed: (Date.now() & 0xffffff) | 1,
  };

  // ---------- canvas helpers ----------
  function fit(cv) {
    const r = cv.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; return { w, h, dpr, changed: true }; }
    return { w, h, dpr, changed: false };
  }
  function afm(t) { t = Math.max(0, Math.min(1, t)); return [Math.min(1, 2 * t) * 255, Math.max(0, Math.min(1, 2 * t - 0.5)) * 255, Math.max(0, Math.min(1, 2 * t - 1)) * 255]; }
  const imgOff = document.createElement('canvas'); imgOff.width = imgOff.height = N;
  const imgOffCtx = imgOff.getContext('2d');
  const imgData = imgOffCtx.createImageData(N, N);
  function paintImage(ctx, img, x, y, size, opts) {
    opts = opts || {};
    let mx = 1e-12;
    for (let i = 0; i < img.length; i++) if (img[i] > mx) mx = img[i];
    const d = imgData.data, g = opts.gamma || 0.85;
    for (let i = 0; i < img.length; i++) {
      const c = afm(Math.pow(Math.max(0, img[i] / mx), g));
      d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = 255;
    }
    imgOffCtx.putImageData(imgData, 0, 0);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(imgOff, x, y, size, size);
  }
  function thumb(img, px, opts) {
    const c = document.createElement('canvas'); c.width = c.height = px;
    paintImage(c.getContext('2d'), img, 0, 0, px, opts);
    return c;
  }

  // ---------- globe ----------
  const LAND = (function () {
    const raw = atob(window.LAND_MASK_B64), bits = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bits[i] = raw.charCodeAt(i);
    const isLand = (lat, lon) => {
      const y = Math.min(179, Math.max(0, Math.floor(90 - lat))), x = ((Math.floor(lon + 180) % 360) + 360) % 360;
      const k = y * 360 + x; return (bits[k >> 3] >> (k & 7)) & 1;
    };
    const pts = [];
    for (let lat = -87; lat <= 87; lat += 1.8) {
      const step = 1.8 / Math.max(0.15, Math.cos(lat * Math.PI / 180));
      for (let lon = -180; lon < 180; lon += step) {
        if (!isLand(lat, lon)) continue;
        const a = lat * Math.PI / 180, b = lon * Math.PI / 180;
        pts.push(Math.cos(a) * Math.cos(b), Math.cos(a) * Math.sin(b), Math.sin(a));
      }
    }
    return Float32Array.from(pts);
  })();
  function theta(t) { return 2 * Math.PI * t / I.SIDEREAL_DAY_H; }
  function viewBasis(dec) { const d = dec * Math.PI / 180; return { sd: Math.sin(d), cd: Math.cos(d) }; }
  // project an inertial position (m) to screen
  function proj(p, vb, cx, cy, scale) {
    const X = p[1], Y = -vb.sd * p[0] + vb.cd * p[2], Z = vb.cd * p[0] + vb.sd * p[2];
    return { x: cx + X * scale, y: cy - Y * scale, z: Z };
  }
  let globeZoom = 1; // 1 = Earth fills view; smaller when an orbiter is in play
  function currentT() { return S.screen === 'plan' || S.screen === 'title' || S.screen === 'brief' ? S.planT : S.t; }
  function drawGlobe(now) {
    const cv = $('globe'), f = fit(cv), ctx = cv.getContext('2d');
    const W = f.w, H = f.h; ctx.clearRect(0, 0, W, H);
    const dec = S.night ? S.night.dec : 20, vb = viewBasis(dec);
    const wantZoom = S.selected.has('ORB') ? (I.R_EARTH * 1.02) / (ORBIT_R + I.R_EARTH * 0.2) : 1;
    globeZoom += (wantZoom - globeZoom) * (reduceMotion ? 1 : 0.08);
    const R = Math.min(W, H) * 0.42 * globeZoom, cx = W / 2, cy = H / 2 + 6 * f.dpr, sc = R / I.R_EARTH;
    const th = theta(currentT()), c = Math.cos(th), s = Math.sin(th);
    // ocean
    const g = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.35, R * 0.1, cx, cy, R);
    g.addColorStop(0, '#16233a'); g.addColorStop(1, '#0a0f1a');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
    // land dots (bucketed by depth for fewer style changes)
    const dot = Math.max(1, 1.5 * f.dpr * Math.min(1, R / (220 * f.dpr)) + 0.3);
    const buckets = [[], [], [], []];
    for (let i = 0; i < LAND.length; i += 3) {
      const x = c * LAND[i] - s * LAND[i + 1], y = s * LAND[i] + c * LAND[i + 1], z = LAND[i + 2];
      const Z = vb.cd * x + vb.sd * z;
      if (Z <= 0) continue;
      const X = y, Y = -vb.sd * x + vb.cd * z;
      buckets[Math.min(3, (Z * 4) | 0)].push(cx + X * R, cy - Y * R);
    }
    const shades = ['#34445c', '#4d6385', '#6a87ad', '#8eaad0'];
    for (let b = 0; b < 4; b++) {
      ctx.fillStyle = shades[b]; const L = buckets[b];
      for (let i = 0; i < L.length; i += 2) ctx.fillRect(L[i] - dot / 2, L[i + 1] - dot / 2, dot, dot);
    }
    // limb + elevation limit
    ctx.strokeStyle = '#2b3a55'; ctx.lineWidth = 1 * f.dpr; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([4 * f.dpr, 5 * f.dpr]); ctx.strokeStyle = 'rgba(255,179,71,.28)';
    ctx.beginPath(); ctx.arc(cx, cy, R * Math.cos(15 * Math.PI / 180), 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    if (!S.night) return;
    // stations
    const t = currentT(), sd = I.sourceDir(dec);
    const st = [];
    const ids = S.night.avail;
    for (const id of ids) {
      const site = SITE[id], p = I.stationECI(site, th, t), q = proj(p, vb, cx, cy, sc);
      const up = I.canSee(site, p, sd), sel = S.selected.has(id);
      const cloudy = S.obs && S.weatherIdx && sel ? S.obs.cloudy(S.weatherIdx[id], t) : false;
      st.push({ id, site, q, up, sel, cloudy, p });
    }
    // orbit path
    if (S.selected.has('ORB') || (S.night.avail.includes('ORB') && S.screen === 'plan')) {
      const o = SITE.ORB;
      ctx.strokeStyle = S.selected.has('ORB') ? 'rgba(127,200,255,.35)' : 'rgba(127,200,255,.12)'; ctx.lineWidth = f.dpr;
      ctx.beginPath();
      for (let k = 0; k <= 96; k++) {
        const q = proj(I.stationECI(o, th, t + o.orbit.periodH * k / 96), vb, cx, cy, sc);
        k ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y);
      }
      ctx.stroke();
    }
    // baselines
    const live = st.filter((a) => a.sel && a.up && !a.cloudy && (a.site.orbit || a.q.z > 0));
    ctx.lineWidth = 1.5 * f.dpr;
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
      ctx.strokeStyle = PAIR_COLORS[pairIndex(live[i].id, live[j].id) % PAIR_COLORS.length];
      ctx.globalAlpha = S.screen === 'observe' ? 0.75 : 0.35;
      ctx.beginPath(); ctx.moveTo(live[i].q.x, live[i].q.y); ctx.lineTo(live[j].q.x, live[j].q.y); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // markers
    ctx.font = `${11 * f.dpr}px ui-sans-serif, system-ui, sans-serif`; ctx.textBaseline = 'middle';
    for (const a of st) {
      const hidden = !a.site.orbit ? a.q.z <= 0 : (a.q.z < 0 && Math.hypot(a.q.x - cx, a.q.y - cy) < R);
      if (hidden) continue;
      const r = (a.sel ? 5 : 3.5) * f.dpr;
      if (a.sel) {
        if (a.up && !a.cloudy) {
          const pulse = reduceMotion ? 0 : (Math.sin(now / 300 + a.q.x) + 1) * 0.5;
          ctx.fillStyle = `rgba(255,179,71,${0.15 + 0.15 * pulse})`; ctx.beginPath(); ctx.arc(a.q.x, a.q.y, r * 2.6, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = a.cloudy ? '#8a93a6' : a.up ? '#ffb347' : '#8a5a22';
        ctx.beginPath(); ctx.arc(a.q.x, a.q.y, r, 0, Math.PI * 2); ctx.fill();
        if (a.cloudy) drawCloud(ctx, a.q.x + 7 * f.dpr, a.q.y - 8 * f.dpr, f.dpr);
      } else {
        ctx.strokeStyle = a.up ? '#c9cfdb' : '#59617a'; ctx.lineWidth = 1.5 * f.dpr;
        ctx.beginPath(); ctx.arc(a.q.x, a.q.y, r, 0, Math.PI * 2); ctx.stroke();
      }
      if (a.sel || S.screen === 'plan') {
        ctx.fillStyle = a.sel ? (a.up ? '#ffd9a3' : '#a07a50') : '#8d96aa';
        ctx.fillText(a.site.name, a.q.x + r + 4 * f.dpr, a.q.y);
      }
    }
    S._globeHit = { st, dpr: f.dpr };
  }
  function drawCloud(ctx, x, y, dpr) {
    ctx.fillStyle = 'rgba(200,210,225,.9)';
    for (const [dx, dy, r] of [[0, 0, 4], [5, -2, 5], [10, 0, 4]]) { ctx.beginPath(); ctx.arc(x + dx * dpr, y + dy * dpr, r * dpr, 0, Math.PI * 2); ctx.fill(); }
  }
  function pairIndex(a, b) {
    const ia = SITES.findIndex((s) => s.id === a), ib = SITES.findIndex((s) => s.id === b);
    const i = Math.min(ia, ib), j = Math.max(ia, ib);
    return i * 13 + j;
  }

  // ---------- uv plane ----------
  function uvExtent() {
    const r = S.selected.has('ORB') ? ORBIT_R + I.R_EARTH : 2 * I.R_EARTH;
    return 1.08 * r / I.LAMBDA;
  }
  function drawUV() {
    const cv = $('uv'), f = fit(cv), ctx = cv.getContext('2d'), W = f.w, H = f.h;
    ctx.clearRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2 + 6 * f.dpr, half = Math.min(W, H) * 0.44, ext = uvExtent(), sc = half / ext;
    // axes + Earth-diameter circle
    ctx.strokeStyle = '#1f2533'; ctx.lineWidth = f.dpr;
    ctx.beginPath(); ctx.moveTo(cx - half, cy); ctx.lineTo(cx + half, cy); ctx.moveTo(cx, cy - half); ctx.lineTo(cx, cy + half); ctx.stroke();
    ctx.setLineDash([3 * f.dpr, 4 * f.dpr]); ctx.strokeStyle = '#33405a';
    const er = 2 * I.R_EARTH / I.LAMBDA * sc;
    ctx.beginPath(); ctx.arc(cx, cy, er, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#4a556e'; ctx.font = `${10 * f.dpr}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillText('Earth diameter', cx + er * 0.72 + 3 * f.dpr, cy - er * 0.72);
    const ds = Math.max(1.5, 1.8 * f.dpr);
    // planned tracks preview
    if (S.preview && (S.screen === 'plan' || S.screen === 'observe')) {
      ctx.fillStyle = 'rgba(140,155,185,.18)';
      for (const p of S.preview) {
        ctx.fillRect(cx + p.u * sc - ds / 2, cy - p.v * sc - ds / 2, ds, ds);
        ctx.fillRect(cx - p.u * sc - ds / 2, cy + p.v * sc - ds / 2, ds, ds);
      }
    }
    if (S.obs) {
      const smp = S.obs.samples, ids = S.obsIds;
      for (let k = 0; k < smp.length; k++) {
        const p = smp[k];
        ctx.fillStyle = PAIR_COLORS[pairIndex(ids[p.i], ids[p.j]) % PAIR_COLORS.length];
        ctx.fillRect(cx + p.u * sc - ds / 2, cy - p.v * sc - ds / 2, ds, ds);
        ctx.fillRect(cx - p.u * sc - ds / 2, cy + p.v * sc - ds / 2, ds, ds);
      }
    }
  }

  // ---------- image panel ----------
  function drawImagePanel() {
    const cv = $('image'), f = fit(cv), ctx = cv.getContext('2d'), W = f.w, H = f.h;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    const size = Math.min(W, H - 34 * f.dpr), x = (W - size) / 2, y = 22 * f.dpr + (H - 34 * f.dpr - size) / 2;
    const img = S.restored || S.dirty;
    if (img) paintImage(ctx, img, x, y, size);
    else {
      ctx.fillStyle = '#3a4152'; ctx.font = `${12 * f.dpr}px ui-sans-serif, system-ui, sans-serif`; ctx.textAlign = 'center';
      ctx.fillText(S.screen === 'plan' ? 'no data yet: pick dishes, then observe' : 'no data yet', W / 2, H / 2); ctx.textAlign = 'left';
    }
    // scale bar 50 uas
    const px = size / I.FOV_UAS * 50;
    ctx.strokeStyle = '#c9cfdb'; ctx.lineWidth = 2 * f.dpr;
    ctx.beginPath(); ctx.moveTo(x + size - px - 8 * f.dpr, y + size - 10 * f.dpr); ctx.lineTo(x + size - 8 * f.dpr, y + size - 10 * f.dpr); ctx.stroke();
    ctx.fillStyle = '#c9cfdb'; ctx.font = `${10 * f.dpr}px ui-sans-serif, system-ui, sans-serif`; ctx.textAlign = 'right';
    ctx.fillText('50 \u00b5as', x + size - 8 * f.dpr, y + size - 18 * f.dpr); ctx.textAlign = 'left';
    // beam ellipse
    if (S.beam && img) {
      const b = S.beam, k = size / N;
      const tr = (b.sxx + b.syy) / 2, dd = Math.sqrt(Math.max(0, ((b.sxx - b.syy) / 2) ** 2 + b.sxy * b.sxy));
      const l1 = Math.sqrt(tr + dd), l2 = Math.sqrt(Math.max(0.01, tr - dd)), ang = 0.5 * Math.atan2(2 * b.sxy, b.sxx - b.syy);
      ctx.strokeStyle = 'rgba(127,200,255,.9)'; ctx.lineWidth = 1.5 * f.dpr;
      ctx.beginPath(); ctx.ellipse(x + 22 * f.dpr, y + size - 22 * f.dpr, l1 * 1.177 * k, l2 * 1.177 * k, ang, 0, Math.PI * 2); ctx.stroke();
    }
  }

  // ---------- audio ----------
  const Sfx = {
    ctx: null, master: null, muted: localStorage.getItem('ese_muted') === '1', hum: null, lastTick: 0,
    ensure() {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      this.ctx = new AC(); this.master = this.ctx.createGain(); this.master.gain.value = this.muted ? 0 : 0.6;
      this.master.connect(this.ctx.destination);
    },
    setMuted(m) { this.muted = m; localStorage.setItem('ese_muted', m ? '1' : '0'); if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.6, this.ctx.currentTime, 0.05); },
    tone(freq, dur, vol, type, when) {
      if (!this.ctx || this.muted) return;
      const t = this.ctx.currentTime + (when || 0), o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = type || 'sine'; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
    },
    tick(frac, amp) { // a measured visibility: pitch = baseline length, loudness = fringe amplitude
      if (!this.ctx || this.muted) return;
      const now = performance.now(); if (now - this.lastTick < 55) return; this.lastTick = now;
      const scale = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
      const note = scale[Math.min(scale.length - 1, Math.floor(frac * scale.length))];
      this.tone(330 * Math.pow(2, note / 12), 0.18, 0.02 + 0.10 * Math.min(1, amp), 'sine');
    },
    humOn() {
      if (!this.ctx || this.hum) return;
      const c = this.ctx, g = c.createGain(), f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 260;
      g.gain.value = 0; g.gain.setTargetAtTime(0.05, c.currentTime, 0.4);
      const os = [55, 55.4, 82.6].map((fr) => { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fr; o.connect(f); o.start(); return o; });
      f.connect(g); g.connect(this.master); this.hum = { g, os };
    },
    humOff() {
      if (!this.hum) return; const h = this.hum, c = this.ctx; this.hum = null;
      h.g.gain.setTargetAtTime(0, c.currentTime, 0.3); setTimeout(() => h.os.forEach((o) => o.stop()), 1500);
    },
    whoosh() {
      if (!this.ctx || this.muted) return;
      const c = this.ctx, len = c.sampleRate * 0.6, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * i / len);
      const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
      f.type = 'bandpass'; f.frequency.value = 700; f.Q.value = 0.7; g.gain.value = 0.12;
      src.buffer = buf; src.connect(f); f.connect(g); g.connect(this.master); src.start();
    },
    click() { this.tone(880, 0.06, 0.05, 'triangle'); },
    chord(good) {
      const base = good ? [261.6, 329.6, 392, 523.3] : [196, 233.1, 293.7];
      base.forEach((fr, i) => this.tone(fr, 1.4, 0.07, good ? 'triangle' : 'sine', i * 0.09));
    },
  };

  // ---------- UI helpers ----------
  // note: html strings passed here are always built from this file's own constants (no user input), so innerHTML is safe
  function el(tag, attrs, html) {
    const e = document.createElement(tag);
    if (attrs) for (const k in attrs) { if (k === 'class') e.className = attrs[k]; else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]); else e.setAttribute(k, attrs[k]); }
    if (html != null) e.innerHTML = html;
    return e;
  }
  let lastBuild = null;
  function showModal(build, isHelp) { if (!isHelp) lastBuild = build; const card = $('card'); card.innerHTML = ''; build(card); $('modal').classList.remove('hidden'); const b = card.querySelector('.btn'); if (b && !DEMO) b.focus(); }
  function hideModal() { $('modal').classList.add('hidden'); }
  function spent() { let c = 0; for (const id of S.selected) if (!S.night.fixed.includes(id)) c += SITE[id].cost; return c; }
  function fmtH(t) { const h = Math.floor(t), m = Math.floor((t - h) * 60); return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0'); }
  // highest elevation a ground site ever reaches for this source
  function maxEl(site, dec) {
    if (site.orbit) return 90;
    return 90 - Math.abs(site.lat - dec);
  }

  // ---------- screens ----------
  function setNightLabel() {
    $('nightLabel').textContent = S.night ? `Night ${S.nightIdx + 1}/${NIGHTS} \u00b7 ${S.night.title}` : 'Very long baseline interferometry';
  }
  function titleScreen() {
    S.screen = 'title'; S.night = null; S.selected.clear(); S.obs = null; S.dirty = S.restored = S.beam = null; S.preview = null;
    setNightLabel(); renderCtrl();
    const best = +localStorage.getItem('ese_best') || 0;
    showModal((c) => {
      c.append(el('div', { class: 'kick' }, 'Daily build #2 \u00b7 a game about very long baseline interferometry'));
      c.append(el('h1', null, 'EARTH-SIZED EYE'));
      c.append(el('p', null, 'No telescope on Earth is big enough to see a black hole. So astronomers <b>link radio dishes across the planet</b> and let the Earth\u2019s rotation sweep them into one telescope the size of the world.'));
      c.append(el('p', null, 'Five nights. Choose your observatories, beat the weather, run CLEAN, and work out what you are looking at.'));
      if (best) c.append(el('p', { class: 'fine' }, 'Best campaign: ' + best + ' / ' + NIGHTS * 1000));
      const a = el('div', { class: 'actions' });
      a.append(el('button', { class: 'btn big', onclick: () => { Sfx.ensure(); Sfx.click(); startCampaign(); } }, 'Start observing'));
      a.append(el('button', { class: 'btn ghost', onclick: () => { Sfx.ensure(); helpModal(titleScreen); } }, 'How it works'));
      c.append(a);
    });
  }
  function helpModal(back) {
    showModal((c) => {
      c.append(el('h2', null, 'How it works'));
      c.append(el('ul', null,
        '<li><b>Two dishes = one measurement.</b> Recording the same radio waves at two sites (time-stamped by atomic clocks) and combining them measures one <i>Fourier component</i> of the sky: a set of stripes whose spacing depends on how far apart the dishes look from the target.</li>' +
        '<li><b>The (u,v) plane</b> is the Earth as the target sees it. Every pair of dishes is a point on it; as the planet turns, each point draws an arc. The more of the plane you cover, the more of the picture you get.</li>' +
        '<li><b>Resolution</b> comes from the longest baselines: at 1.3 mm wavelength an Earth-wide pair resolves about 20 microarcseconds.</li>' +
        '<li><b>Sensitivity</b> comes from big dishes: baselines between small dishes are noisy. Dishes must see the target above 15\u00b0 elevation (dashed circle on the globe), and clouds blind them.</li>' +
        '<li><b>CLEAN</b> (H\u00f6gbom, 1974) removes the stripes left by the gaps: it repeatedly finds the brightest spot and subtracts the pattern your array would make from a single point there.</li>'));
      c.append(el('p', { class: 'fine' }, 'Controls: tap a dish on the globe or in the list to add it; drag the globe to spin the Earth while planning. Keys: Enter = main action, 1\u20134 = answers, M = mute.'));
      c.append(el('p', { class: 'fine' }, 'Sites marked * are planned or hypothetical 1.3 mm stations; the orbiter is fiction (for now). Targets are simplified models, and the imaging skips calibration and closure phases.'));
      const a = el('div', { class: 'actions' });
      a.append(el('button', { class: 'btn', onclick: () => { Sfx.click(); back(); } }, 'Got it'));
      c.append(a);
    }, true);
  }
  function startCampaign() { S.results = []; startNight(0); }
  function startNight(idx) {
    S.nightIdx = idx;
    const rng = I.mulberry32(DEMO ? 1234 + idx : (S.seed + idx * 7919 + (S.results[idx] ? 101 : 0)) >>> 0);
    S.seed = (S.seed * 1103515245 + 12345) >>> 0;
    S.night = makeNight(idx, rng);
    S.vis = I.visibilities(S.night.truth);
    S.selected = new Set(S.night.fixed);
    S.obs = null; S.dirty = S.restored = S.beam = null; S.cleanSt = null; S.answer = -1; S.t = 0; S.log = [];
    S.planT = 0; S.previewKey = ''; updatePreview();
    S.screen = 'brief'; setNightLabel(); renderCtrl();
    const n = S.night;
    showModal((c) => {
      c.append(el('div', { class: 'kick' }, `Night ${idx + 1} of ${NIGHTS}`));
      c.append(el('h2', null, n.title));
      c.append(el('p', { class: 'fine' }, 'Target: ' + n.target + ' \u00b7 declination ' + (n.dec > 0 ? '+' : '') + n.dec + '\u00b0'));
      c.append(el('p', null, n.story));
      c.append(el('p', null, n.goal));
      c.append(el('p', null, '<b>Afterwards you will be asked:</b> ' + n.question));
      const a = el('div', { class: 'actions' });
      a.append(el('button', { class: 'btn big', onclick: () => { Sfx.click(); hideModal(); S.screen = 'plan'; renderCtrl(); } }, n.fixed.length ? 'Look at the array' : 'Plan the array'));
      c.append(a);
    });
  }
  function toggleSite(id) {
    const n = S.night;
    if (S.screen !== 'plan' || n.fixed.includes(id) || !n.avail.includes(id)) return;
    if (S.selected.has(id)) S.selected.delete(id);
    else {
      if (n.budget && spent() + SITE[id].cost > n.budget) { flash('Not enough credits for ' + SITE[id].name); return; }
      if (S.selected.size >= n.maxSites) { flash('Maximum ' + n.maxSites + ' dishes tonight'); return; }
      S.selected.add(id);
    }
    Sfx.click(); updatePreview(); renderCtrl();
  }
  let flashTimer = 0;
  function flash(msg) { const e = $('imgNote'); e.textContent = msg; e.style.color = 'var(--bad)'; clearTimeout(flashTimer); flashTimer = setTimeout(() => { e.textContent = ''; e.style.color = ''; }, 2200); }
  function updatePreview() {
    const ids = [...S.selected], key = ids.sort().join(',') + S.nightIdx;
    if (key === S.previewKey) return; S.previewKey = key;
    if (ids.length < 2) { S.preview = null; return; }
    const o = new I.Observation(ids.map((id) => SITE[id]), S.night.dec, { noiseScale: 0 });
    o.advance(24, 0.25); S.preview = o.samples;
  }

  function startObserve() {
    const n = S.night, ids = [...S.selected];
    if (ids.length < 2) return;
    Sfx.ensure();
    const rng = I.mulberry32(DEMO ? 99 : (Date.now() & 0xfffffff));
    const weather = ids.map((id) => {
      const s = SITE[id];
      if (rng() >= s.wx) return [];
      const a = rng() * 20, d = 3 + rng() * 7; return [[a, Math.min(24, a + d)]];
    });
    S.obsIds = ids; S.weatherIdx = Object.fromEntries(ids.map((id, i) => [id, i]));
    S.obs = new I.Observation(ids.map((id) => SITE[id]), n.dec, { weather, seed: 17 + S.nightIdx });
    S.t = 0; S.dirty = S.restored = null; S.cleanSt = null; S.beam = null; S.log = [];
    S.cloudState = ids.map(() => false);
    S.speed = reduceMotion ? 4 : 1; S.screen = 'observe';
    const never = ids.filter((id) => maxEl(SITE[id], n.dec) < 15);
    S.log.push(['00:00', 'Correlator armed. ' + ids.length + ' dishes, ' + (ids.length * (ids.length - 1) / 2) + ' baselines.']);
    if (never.length) S.log.push(['00:00', never.map((id) => SITE[id].name).join(', ') + ' can never see this target.', 'w']);
    Sfx.humOn(); renderCtrl();
  }
  function stepObserve(dtSec) {
    const rate = 24 / 18 * S.speed; // hours per second
    const t1 = Math.min(24, S.t + rate * dtSec);
    const added = S.obs.advance(t1, DT);
    S.t = S.obs.t;
    // weather events
    S.obsIds.forEach((id, i) => {
      const c = S.obs.cloudy(i, S.t);
      if (c !== S.cloudState[i]) {
        S.cloudState[i] = c; S.log.push([fmtH(S.t), (c ? 'Clouds over ' : 'Skies clear at ') + SITE[id].where.split(',')[0] + '.', 'w']);
        if (c) Sfx.whoosh(); renderCtrl();
      }
    });
    if (added.length) {
      const ext = 2 * I.R_EARTH / I.LAMBDA;
      const p = added[Math.floor(Math.random() * added.length)];
      const ku = ((Math.round(p.u / I.DU) % N) + N) % N, kv = ((-Math.round(p.v / I.DU) % N) + N) % N, c = kv * N + ku;
      const amp = Math.hypot(S.vis.re[c], S.vis.im[c]) / S.vis.re[0];
      Sfx.tick(Math.min(0.999, Math.hypot(p.u, p.v) / ext), amp);
    }
    const now = performance.now();
    if (S.obs.nSamples && (now - S.dirtyAt > 110 || S.t >= 24)) {
      const d = I.makeDirty(S.obs, S.vis);
      if (d) { S.dirtyRes = d; S.dirty = d.dirty; S.beam = I.fitBeam(S.obs); }
      S.dirtyAt = now;
    }
    updateClock();
    if (S.t >= 24 - 1e-6) endObserve();
  }
  function endObserve() {
    Sfx.humOff();
    if (!S.obs.nSamples) {
      S.screen = 'plan'; S.obs = null; renderCtrl();
      flash('No two dishes saw the target at the same time. Try again.');
      return;
    }
    S.log.push(['24:00', 'Night over. ' + S.obs.nSamples + ' visibilities recorded.']);
    S.screen = 'clean'; renderCtrl(); updateClock();
  }
  function startClean() {
    if (!S.dirtyRes || S.cleanSt) return;
    S.cleanSt = I.cleanStart(S.dirtyRes);
    S.beam = I.fitBeam(S.obs);
    renderCtrl();
    if (reduceMotion || DEMO) finishCleanNow();
  }
  function stepClean() {
    const st = S.cleanSt;
    I.cleanStep(st, 4, 0.1, 0.03);
    S.restored = I.restore(st, S.beam);
    if (st.iter % 3 === 0) Sfx.tone(220 * Math.pow(2, Math.min(36, st.iter / 6) / 12), 0.12, 0.03, 'triangle');
    updateCleanInfo();
    if (st.done) cleanDone();
  }
  function finishCleanNow() { I.cleanStep(S.cleanSt, 3000, 0.1, 0.03); S.restored = I.restore(S.cleanSt, S.beam); cleanDone(); }
  function cleanDone() {
    S.fid = I.fidelity(S.restored, S.night.truth);
    S.screen = 'question'; renderCtrl();
  }
  function answer(k) {
    if (S.screen !== 'question') return;
    S.answer = k; Sfx.ensure();
    const n = S.night, correct = k === n.correct;
    Sfx.chord(correct);
    const imgScore = Math.round(600 * Math.max(0, Math.min(1, (S.fid - 0.55) / (0.97 - 0.55))));
    const thrift = n.budget ? Math.round(100 * (n.budget - spent()) / n.budget) : 100;
    const total = imgScore + (correct ? 300 : 0) + thrift;
    const stars = (correct ? 1 : 0) + (imgScore >= 300 ? 1 : 0) + (imgScore >= 480 ? 1 : 0);
    const prev = S.results[S.nightIdx];
    if (!prev || total > prev.total) S.results[S.nightIdx] = { total, stars, correct, imgScore };
    S.screen = 'reveal'; renderCtrl();
    showModal((c) => {
      c.append(el('div', { class: 'kick' }, `Night ${S.nightIdx + 1} \u00b7 ${n.title}`));
      c.append(el('h2', { class: correct ? 'ok' : 'bad' }, correct ? 'Correct: ' + n.options[n.correct].label : 'Not quite: it was ' + n.options[n.correct].label));
      const st = el('div', { class: 'stars' });
      for (let i = 0; i < 3; i++) st.append(el('span', { class: i < stars ? '' : 'off' }, '\u2605'));
      c.append(st);
      const cmp = el('div', { class: 'cmp' });
      const blurred = I.convolve(n.truth, I.gaussianKernel({ sxx: 25, syy: 25, sxy: 0 }));
      [[S.restored, 'Your image'], [blurred, 'Truth, ideal Earth-sized eye'], [n.truth, 'The truth']].forEach(([img, lab]) => {
        const fg = el('figure'); fg.append(thumb(img, 256)); fg.append(el('figcaption', null, lab)); cmp.append(fg);
      });
      c.append(cmp);
      const sc = el('div', { class: 'score' });
      sc.innerHTML = `<span>Image fidelity (${Math.round(S.fid * 100)}% match)</span><span class="v">${imgScore}</span>` +
        `<span>Interpretation</span><span class="v">${correct ? 300 : 0}</span>` +
        `<span>${n.budget ? 'Credits saved (' + (n.budget - spent()) + '/' + n.budget + ')' : 'Thrift bonus'}</span><span class="v">${thrift}</span>` +
        `<span><b>Night score</b></span><span class="v"><b>${total}</b> / 1000</span>`;
      c.append(sc);
      c.append(el('p', { class: 'fine' }, tipFor()));
      const a = el('div', { class: 'actions' });
      const last = S.nightIdx === NIGHTS - 1;
      a.append(el('button', { class: 'btn big', onclick: () => { Sfx.click(); last ? finalScreen() : startNight(S.nightIdx + 1); } }, last ? 'Campaign results' : 'Next night'));
      a.append(el('button', { class: 'btn ghost', onclick: () => { Sfx.click(); startNight(S.nightIdx); } }, 'Retry night'));
      c.append(a);
    });
  }
  function tipFor() {
    const n = S.night, ids = [...S.selected];
    const never = ids.filter((id) => maxEl(SITE[id], n.dec) < 15);
    if (never.length) return 'Tip: ' + never.map((id) => SITE[id].name).join(', ') + ' never rose above 15\u00b0 for this target, so those credits were wasted.';
    if (ids.includes('ALMA') && ids.includes('APEX')) return 'Tip: ALMA and APEX sit on the same plateau. A baseline that short measures almost nothing new.';
    if (S.nightIdx === 4 && !ids.includes('ORB')) return 'Tip: the orbiter\u2019s baselines are several times longer than the Earth. That is how you would see real detail.';
    if (S.fid < 0.8) return 'Tip: spread dishes across continents and both hemispheres; the (u,v) plane should be filled evenly in every direction.';
    return 'Real EHT images are also blurry rings: the black hole shadow is only about two resolution elements across.';
  }
  function finalScreen() {
    S.screen = 'final'; renderCtrl();
    const total = S.results.reduce((a, r) => a + (r ? r.total : 0), 0), stars = S.results.reduce((a, r) => a + (r ? r.stars : 0), 0);
    const best = Math.max(total, +localStorage.getItem('ese_best') || 0); localStorage.setItem('ese_best', best);
    const rank = total >= 4300 ? 'Event Horizon Telescope Director' : total >= 3600 ? 'VLBI Scientist' : total >= 2600 ? 'Correlator Operator' : 'Graduate Student, Night Shift';
    Sfx.chord(true);
    showModal((c) => {
      c.append(el('div', { class: 'kick' }, 'Campaign complete'));
      c.append(el('h2', null, rank));
      const st = el('div', { class: 'stars' }, `${stars} <span style="font-size:16px">/ ${NIGHTS * 3} \u2605</span>`);
      c.append(st);
      const sc = el('div', { class: 'score' });
      let h = '';
      for (let i = 0; i < NIGHTS; i++) { const r = S.results[i]; h += `<span>Night ${i + 1}: ${makeNightTitle(i)}</span><span class="v">${r ? r.total : 0}</span>`; }
      h += `<span><b>Total</b></span><span class="v"><b>${total}</b> / ${NIGHTS * 1000}</span><span class="fine">Best ever</span><span class="v fine">${best}</span>`;
      sc.innerHTML = h; c.append(sc);
      c.append(el('p', { class: 'fine' }, 'The real Event Horizon Telescope imaged M87* (2019) and Sgr A* (2022) with eight-ish dishes, petabytes of hard drives flown to two correlators, and a lot more calibration than this game does. Next goal: movies.'));
      const a = el('div', { class: 'actions' });
      a.append(el('button', { class: 'btn big', onclick: () => { Sfx.click(); startCampaign(); } }, 'Observe again'));
      a.append(el('button', { class: 'btn ghost', onclick: () => { Sfx.click(); titleScreen(); } }, 'Title'));
      c.append(a);
    });
  }
  function makeNightTitle(i) { return ['First fringes', 'Ring or disk?', 'M87*', 'Sgr A*', 'Something in the dark'][i]; }

  // ---------- control panel ----------
  function updateClock() {
    const c = $('clock');
    if (S.screen === 'observe' || S.screen === 'clean' || S.screen === 'question') {
      c.classList.remove('hidden'); c.innerHTML = 'T+' + fmtH(S.t) + '<br><span style="color:var(--dim);font-weight:400">of 24:00</span>';
    } else c.classList.add('hidden');
    const m = document.querySelector('#obsMeter > i'); if (m) m.style.width = (S.t / 24 * 100) + '%';
  }
  function updateCleanInfo() { const e = $('cleanInfo'); if (e && S.cleanSt) e.textContent = 'Iteration ' + S.cleanSt.iter + (S.cleanSt.done ? ' \u00b7 converged' : ''); }
  function renderCtrl() {
    const b = $('ctrlBody'); b.innerHTML = '';
    $('imgCap').textContent = S.restored ? 'Your image (CLEANed)' : S.dirty ? 'Your image (dirty: raw, with sidelobes)' : 'Your image';
    updateClock();
    const n = S.night;
    if (!n || S.screen === 'title' || S.screen === 'brief') {
      b.append(el('div', { class: 'h' }, 'Standing by'));
      b.append(el('div', { class: 'sub' }, 'The correlator is cold. Start a night to begin.'));
      return;
    }
    if (S.screen === 'plan') {
      b.append(el('div', { class: 'h' }, n.fixed.length ? 'Your array' : 'Choose observatories'));
      const cost = spent();
      if (n.budget) {
        b.append(el('div', { class: 'row' }, `<span class="grow sub">Credits</span><b>${n.budget - cost}</b><span class="sub">/ ${n.budget} left</span>`));
        const m = el('div', { class: 'meter' }, '<i></i>'); m.firstChild.style.width = (cost / n.budget * 100) + '%'; b.append(m);
      } else if (!n.fixed.length) b.append(el('div', { class: 'sub' }, `Pick up to ${n.maxSites} dishes (${S.selected.size} chosen).`));
      else b.append(el('div', { class: 'sub' }, 'Three dishes are linked for you tonight. Drag the globe to spin the Earth.'));
      const list = el('div', { class: 'sites' });
      for (const id of n.avail) {
        const s = SITE[id], on = S.selected.has(id), never = maxEl(s, n.dec) < 15, fixed = n.fixed.includes(id);
        const meta = `${s.where} \u00b7 ${s.diam} m${never ? ' \u00b7 <span class="bad">never sees target</span>' : ''} \u00b7 cloud risk ${Math.round(s.wx * 100)}%`;
        const btn = el('button', { class: 'site' + (on ? ' on' : '') + (never ? ' never' : '') + (fixed ? ' fixed' : ''), 'aria-pressed': on ? 'true' : 'false',
          onclick: () => toggleSite(id) }, `<span class="dot"></span><span class="nm">${s.name}</span><span class="cost">${n.budget ? s.cost + 'c' : fixed ? 'linked' : ''}</span><span class="meta">${meta}</span>`);
        list.append(btn);
      }
      b.append(list);
      const go = el('button', { class: 'btn big', onclick: () => { Sfx.click(); startObserve(); } }, 'Observe \u25b6');
      if (S.selected.size < 2) { go.disabled = true; go.textContent = 'Pick at least 2 dishes'; }
      b.append(go);
      return;
    }
    if (S.screen === 'observe') {
      b.append(el('div', { class: 'h' }, 'Observing'));
      const m = el('div', { class: 'meter', id: 'obsMeter' }, '<i></i>'); b.append(m);
      b.append(el('div', { class: 'sub' }, 'Each coloured arc is one pair of dishes. Listen: higher notes are longer baselines, louder means more signal.'));
      const r = el('div', { class: 'row' });
      r.append(el('button', { class: 'btn ghost grow', onclick: () => { S.speed = S.speed === 1 ? 4 : 1; renderCtrl(); } }, S.speed === 1 ? 'Faster \u23e9' : 'Normal speed'));
      r.append(el('button', { class: 'btn ghost grow', onclick: () => { S.speed = 1000; } }, 'Skip to end'));
      b.append(r);
      b.append(logEl()); updateClock();
      return;
    }
    if (S.screen === 'clean') {
      b.append(el('div', { class: 'h' }, 'Night over: deconvolve'));
      b.append(el('div', { class: 'sub' }, 'The raw "dirty" image is the truth seen through your array\u2019s gappy (u,v) coverage: real structure plus ghostly stripes. CLEAN models the sky as points and removes those stripes.'));
      b.append(el('button', { class: 'btn big', id: 'cleanBtn', onclick: () => { Sfx.click(); startClean(); } }, S.cleanSt ? 'Cleaning\u2026' : 'Run CLEAN'));
      b.append(el('div', { class: 'sub', id: 'cleanInfo' }, ''));
      if (S.cleanSt) $('cleanBtn').disabled = true;
      b.append(logEl());
      return;
    }
    if (S.screen === 'question' || S.screen === 'reveal' || S.screen === 'final') {
      b.append(el('div', { class: 'h' }, 'Interpret'));
      b.append(el('div', null, n.question));
      b.append(el('div', { class: 'sub' }, 'Compare your image with these models. The beam (blue ellipse) shows your resolution.'));
      const o = el('div', { class: 'opts' });
      n.options.forEach((op, k) => {
        const bt = el('button', { class: 'opt', onclick: () => answer(k), 'aria-label': op.label });
        bt.append(thumb(op.img, 160)); bt.append(el('span', null, (k + 1) + '. ' + op.label));
        if (S.screen !== 'question') bt.disabled = true;
        o.append(bt);
      });
      b.append(o);
    }
  }
  function logEl() {
    const l = el('div', { class: 'log' });
    for (const [t, msg, cls] of S.log.slice(-7)) l.append(el('div', cls ? { class: cls } : null, `<b>${t}</b> ${msg}`));
    return l;
  }

  // ---------- input ----------
  (function globeInput() {
    const g = $('globeWrap'); let down = null;
    g.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t0: S.planT, drag: false }; g.setPointerCapture(e.pointerId); });
    g.addEventListener('pointermove', (e) => {
      if (!down || S.screen !== 'plan') return;
      const dx = e.clientX - down.x;
      if (Math.abs(dx) > 6) down.drag = true;
      if (down.drag) { S.planT = ((down.t0 - dx / g.clientWidth * 14) % 24 + 24) % 24; }
    });
    g.addEventListener('pointerup', (e) => {
      if (!down) return; const wasDrag = down.drag; down = null;
      if (wasDrag || S.screen !== 'plan' || !S._globeHit) return;
      const r = $('globe').getBoundingClientRect(), dpr = S._globeHit.dpr;
      const x = (e.clientX - r.left) * dpr, y = (e.clientY - r.top) * dpr;
      let best = null, bd = 26 * dpr;
      for (const a of S._globeHit.st) {
        if (!a.site.orbit && a.q.z <= 0) continue;
        const d = Math.hypot(a.q.x - x, a.q.y - y); if (d < bd) { bd = d; best = a; }
      }
      if (best) toggleSite(best.id);
    });
    g.addEventListener('pointercancel', () => { down = null; });
  })();
  $('muteBtn').addEventListener('click', () => { Sfx.ensure(); Sfx.setMuted(!Sfx.muted); syncMute(); });
  function syncMute() { $('muteBtn').classList.toggle('off', Sfx.muted); $('muteBtn').setAttribute('aria-label', Sfx.muted ? 'Unmute' : 'Mute'); }
  $('helpBtn').addEventListener('click', () => {
    Sfx.ensure();
    const wasHidden = $('modal').classList.contains('hidden'), prev = lastBuild;
    helpModal(() => { if (wasHidden || !prev) hideModal(); else showModal(prev); });
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'm' || e.key === 'M') { Sfx.ensure(); Sfx.setMuted(!Sfx.muted); syncMute(); return; }
    if (e.key === 'Escape' && !$('modal').classList.contains('hidden') && S.screen !== 'title' && S.screen !== 'brief' && S.screen !== 'reveal' && S.screen !== 'final') { hideModal(); return; }
    if (S.screen === 'question' && /^[1-4]$/.test(e.key)) { const k = +e.key - 1; if (k < S.night.options.length) answer(k); return; }
    if (e.key === 'Enter' && $('modal').classList.contains('hidden')) {
      if (S.screen === 'plan' && S.selected.size >= 2) startObserve();
      else if (S.screen === 'clean') startClean();
    }
  });
  document.addEventListener('gesturestart', (e) => e.preventDefault());

  // ---------- main loop ----------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (S.screen === 'title') S.planT = (S.planT + dt * (reduceMotion ? 0 : 0.6)) % 24;
    if (S.screen === 'observe') stepObserve(dt);
    if (S.screen === 'clean' && S.cleanSt && !S.cleanSt.done) stepClean();
    drawGlobe(now); drawUV(); drawImagePanel();
    requestAnimationFrame(frame);
  }

  // ---------- demo + self test ----------
  function runDemo() {
    const nightIdx = Math.max(0, Math.min(NIGHTS - 1, (+params.get('demo') || 3) - 1));
    hideModal(); startNight(nightIdx); hideModal(); S.screen = 'plan';
    const picks = { 0: [], 1: ['ALMA', 'IRAM', 'SMA', 'GLT'], 2: ['ALMA', 'LMT', 'SMA', 'IRAM'], 3: ['ALMA', 'LMT', 'SPT', 'AMT'], 4: ['ALMA', 'LMT', 'IRAM', 'ORB'] }[nightIdx];
    for (const id of picks) S.selected.add(id);
    updatePreview(); startObserve();
    const stopAt = +(params.get('t') || 8);
    stepObserve(stopAt / (24 / 18));
    S.speed = 0; // freeze for the screenshot
    const d = I.makeDirty(S.obs, S.vis); S.dirty = d.dirty; S.dirtyRes = d; S.beam = I.fitBeam(S.obs);
    if (params.has('clean')) { S.speed = 1000; stepObserve(1); startClean(); }
    renderCtrl();
  }
  function selfTest() {
    const out = [];
    const okk = (c, m) => out.push((c ? 'PASS ' : 'FAIL ') + m);
    okk(LAND.length > 3000, 'land dots ' + LAND.length / 3);
    for (let i = 0; i < NIGHTS; i++) {
      const n = makeNight(i, I.mulberry32(5 + i));
      okk(n.options.length >= 3 && n.correct >= 0 && n.correct < n.options.length, 'night ' + (i + 1) + ' has options and a correct answer');
      okk(n.avail.every((id) => SITE[id]), 'night ' + (i + 1) + ' sites exist');
    }
    okk(maxEl(SITE.SPT, 12.39) < 15 && maxEl(SITE.SPT, -29) > 15, 'South Pole visibility rule');
    const pre = el('pre', { id: 'selftest' }, out.join('\n'));
    pre.style.cssText = 'position:fixed;left:0;bottom:0;z-index:99;background:#000;color:#8f8;margin:0;padding:6px;font-size:11px';
    document.body.append(pre);
    document.title = (out.some((l) => l.startsWith('FAIL')) ? 'SELFTEST FAIL' : 'SELFTEST PASS');
  }

  syncMute();
  if (DEMO) runDemo(); else titleScreen();
  if (SELFTEST) selfTest();
  requestAnimationFrame(frame);
})();
