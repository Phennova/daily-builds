// Bare Earth - UI, map, tools, screens.
(function () {
  'use strict';
  const { N, CELL, SIZE } = BE;
  const $ = id => document.getElementById(id);
  const AU = window.BEAudio;
  const reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const params = new URLSearchParams(location.search);

  // ---------- error surface (no silent failures) ----------
  function showErr(msg) { const e = $('err'); e.textContent = 'Error: ' + msg; e.classList.remove('hidden'); }
  window.addEventListener('error', e => showErr(e.message || String(e)));

  const TYPE_INFO = {
    pyramid: { label: 'Pyramid', short: 'P', col: '#f0c24a' },
    platform: { label: 'Platform', short: 'L', col: '#e8875a' },
    mound: { label: 'Mound', short: 'M', col: '#c9a0ff' },
    causeway: { label: 'Causeway', short: 'C', col: '#6fd0e0' },
    reservoir: { label: 'Reservoir', short: 'R', col: '#6aa0ff' }
  };
  const VIEWS = [
    ['hill', 'Hillshade'], ['multi', '3-sun RGB'], ['lrm', 'Relief'], ['svf', 'Sky-view'],
    ['slope', 'Slope'], ['height', 'Height'], ['cover', 'Coverage'], ['canopy', 'Canopy']
  ];

  // ---------- state ----------
  const S = {
    spec: null, world: null, filt: null, view: 'hill', az: 315, alt: 40, lrmR: 16,
    pins: [], ptype: 'pyramid', mode: 'pin', prof: null, profData: null,
    zoom: 1, cx: SIZE / 2, cy: SIZE / 2, scan: 1, layers: {}, img: null, canopyImg: null, viewHist: new Set(),
    stripIndex: 0, result: null
  };
  let progress = {};
  try { progress = JSON.parse(localStorage.getItem('be.progress') || '{}'); } catch (e) { progress = {}; }
  const saveProgress = () => { try { localStorage.setItem('be.progress', JSON.stringify(progress)); } catch (e) { /* ignore */ } };

  // ---------- offscreen image of the current view ----------
  const off = document.createElement('canvas'); off.width = N; off.height = N;
  const offCtx = off.getContext('2d');
  const canOff = document.createElement('canvas'); canOff.width = N; canOff.height = N;
  const truthOff = document.createElement('canvas'); truthOff.width = N; truthOff.height = N;

  const SAND = [238, 228, 206], SOIL = [22, 18, 14];
  function ramp(v, a, b) { return [a[0] + (b[0] - a[0]) * v, a[1] + (b[1] - a[1]) * v, a[2] + (b[2] - a[2]) * v]; }
  function shadeToImg(px, h, gamma) {
    for (let i = 0; i < N * N; i++) {
      const v = Math.pow(Math.min(1, h[i]), gamma || 1);
      px[i * 4] = SOIL[0] + (SAND[0] - SOIL[0]) * v; px[i * 4 + 1] = SOIL[1] + (SAND[1] - SOIL[1]) * v; px[i * 4 + 2] = SOIL[2] + (SAND[2] - SOIL[2]) * v; px[i * 4 + 3] = 255;
    }
  }
  function layer(key, fn) { if (!S.layers[key]) S.layers[key] = fn(); return S.layers[key]; }

  function renderView() {
    const w = S.world, z = S.filt.dtm;
    const im = offCtx.createImageData(N, N), px = im.data;
    const v = S.view;
    if (v === 'hill') shadeToImg(px, BE.hillshade(z, S.az, S.alt, 2), 1.1);
    else if (v === 'multi') {
      const [r, g, b] = layer('rgb', () => BE.rgbHillshade(z, 35));
      const st = x => 255 * Math.max(0, Math.min(1, (x - 0.12) / 0.8));
      for (let i = 0; i < N * N; i++) { px[i * 4] = st(r[i]) * 0.95 + 10; px[i * 4 + 1] = st(g[i]) * 0.9 + 8; px[i * 4 + 2] = st(b[i]) * 0.85 + 6; px[i * 4 + 3] = 255; }
    }
    else if (v === 'slope') {
      const s = layer('slope', () => BE.slopeDeg(z));
      for (let i = 0; i < N * N; i++) { const t = 1 - Math.min(1, s[i] / 40); const c = ramp(t, SOIL, SAND); px[i * 4] = c[0]; px[i * 4 + 1] = c[1]; px[i * 4 + 2] = c[2]; px[i * 4 + 3] = 255; }
    } else if (v === 'lrm') {
      const l = layer('lrm' + S.lrmR, () => BE.localRelief(z, S.lrmR));
      const h = layer('multi', () => BE.multiHillshade(z, 40));
      const NEG = [36, 98, 112], MID = [226, 219, 200], POS = [196, 76, 36];
      for (let i = 0; i < N * N; i++) {
        const t = Math.max(-1, Math.min(1, l[i] / 1.1));
        const c = t < 0 ? ramp(-t, MID, NEG) : ramp(t, MID, POS);
        const k = 0.72 + 0.35 * h[i];
        px[i * 4] = c[0] * k; px[i * 4 + 1] = c[1] * k; px[i * 4 + 2] = c[2] * k; px[i * 4 + 3] = 255;
      }
    } else if (v === 'svf') {
      const s = layer('svf', () => BE.skyView(z, 12, 16));
      for (let i = 0; i < N * N; i++) { const t = Math.max(0, Math.min(1, (s[i] - 0.82) / 0.18)); const c = ramp(Math.pow(t, 1.6), SOIL, SAND); px[i * 4] = c[0]; px[i * 4 + 1] = c[1]; px[i * 4 + 2] = c[2]; px[i * 4 + 3] = 255; }
    } else if (v === 'height') {
      const h = layer('multi', () => BE.multiHillshade(z, 40));
      let mn = 1e9, mx = -1e9;
      for (let i = 0; i < N * N; i++) { mn = Math.min(mn, z[i]); mx = Math.max(mx, z[i]); }
      const stops = [[46, 92, 60], [120, 150, 70], [214, 190, 110], [180, 110, 70], [240, 236, 228]];
      for (let i = 0; i < N * N; i++) {
        const t = (z[i] - mn) / (mx - mn || 1) * (stops.length - 1), k = Math.min(stops.length - 2, Math.floor(t));
        const c = ramp(t - k, stops[k], stops[k + 1]), s = 0.45 + 0.65 * h[i];
        px[i * 4] = c[0] * s; px[i * 4 + 1] = c[1] * s; px[i * 4 + 2] = c[2] * s; px[i * 4 + 3] = 255;
      }
    } else if (v === 'cover') {
      const h = layer('multi', () => BE.multiHillshade(z, 40));
      for (let i = 0; i < N * N; i++) {
        const s = 0.35 + 0.5 * h[i];
        if (!S.filt.mask[i]) { px[i * 4] = 210 * s; px[i * 4 + 1] = 52 * s; px[i * 4 + 2] = 40 * s; }
        else { const t = Math.min(1, w.nearMin[i] / 3); const c = ramp(t, [70, 70, 64], [240, 232, 210]); px[i * 4] = c[0] * (s + 0.2); px[i * 4 + 1] = c[1] * (s + 0.2); px[i * 4 + 2] = c[2] * (s + 0.2); }
        px[i * 4 + 3] = 255;
      }
    } else if (v === 'canopy') {
      offCtx.drawImage(canOff, 0, 0);
      S.img = off; draw(); return;
    }
    offCtx.putImageData(im, 0, 0);
    S.img = off;
    draw();
  }
  function makeCanopyImage(w) {
    const dsm = new Float32Array(N * N);
    for (let i = 0; i < N * N; i++) dsm[i] = w.maxZ[i];
    const h = BE.hillshade(dsm, 135, 50, 1);
    const c = canOff.getContext('2d'), im = c.createImageData(N, N), px = im.data;
    for (let i = 0; i < N * N; i++) {
      const top = w.maxZ[i] - w.ground[i];
      const s = 0.25 + 0.85 * h[i], n = BE.vnoise((i % N) / 3, (i / N | 0) / 3, 99) * 0.25 + 0.85;
      if (top < 4) { px[i * 4] = 120 * s; px[i * 4 + 1] = 112 * s; px[i * 4 + 2] = 70 * s; }
      else { px[i * 4] = 34 * s * n; px[i * 4 + 1] = (70 + top * 2) * s * n; px[i * 4 + 2] = 34 * s * n; }
      px[i * 4 + 3] = 255;
    }
    c.putImageData(im, 0, 0);
  }
  function makeTruthImage(w) {
    const a = BE.hillshade(w.ground, 315, 35, 2), b = BE.hillshade(w.ground, 45, 35, 2);
    for (let i = 0; i < N * N; i++) a[i] = 0.5 * (a[i] + b[i]);
    const c = truthOff.getContext('2d'), im = c.createImageData(N, N);
    shadeToImg(im.data, a, 1.2);
    c.putImageData(im, 0, 0);
  }

  // ---------- map drawing ----------
  const map = $('map'), mctx = map.getContext('2d');
  let dpr = 1, MW = 1, MH = 1;
  function resize() {
    const r = map.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    MW = Math.max(1, r.width); MH = Math.max(1, r.height);
    map.width = Math.round(MW * dpr); map.height = Math.round(MH * dpr);
    const p = $('prof'), pr = p.getBoundingClientRect();
    p.width = Math.round(pr.width * dpr); p.height = Math.round(pr.height * dpr);
    draw(); drawProfile();
  }
  const ppm = () => Math.min(MW, MH) / SIZE * S.zoom;
  const toScreen = (x, y) => [(x - S.cx) * ppm() + MW / 2, (y - S.cy) * ppm() + MH / 2];
  const toWorld = (sx, sy) => [(sx - MW / 2) / ppm() + S.cx, (sy - MH / 2) / ppm() + S.cy];
  function clampView() {
    S.zoom = Math.max(1, Math.min(8, S.zoom));
    const half = Math.min(MW, MH) / 2 / ppm();
    S.cx = Math.max(Math.min(half, SIZE / 2), Math.min(SIZE - Math.min(half, SIZE / 2), S.cx));
    S.cy = Math.max(Math.min(half, SIZE / 2), Math.min(SIZE - Math.min(half, SIZE / 2), S.cy));
  }
  let drawQueued = false;
  function draw() { if (!drawQueued) { drawQueued = true; requestAnimationFrame(drawNow); } }
  function drawNow() {
    drawQueued = false;
    if (!S.world) return;
    const c = mctx;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = '#070806'; c.fillRect(0, 0, MW, MH);
    const [x0, y0] = toScreen(0, 0), sz = SIZE * ppm();
    c.imageSmoothingEnabled = S.zoom < 3.5;
    if (S.scan < 1) {
      c.drawImage(canOff, x0, y0, sz, sz);
      const rows = Math.floor(S.scan * N);
      if (rows > 0) c.drawImage(S.img, 0, 0, N, rows, x0, y0, sz, sz * rows / N);
      const yl = y0 + sz * S.scan;
      c.fillStyle = 'rgba(255,60,40,0.85)'; c.fillRect(x0, yl - 1, sz, 2);
      c.fillStyle = 'rgba(255,90,60,0.5)';
      for (let k = 0; k < 120; k++) c.fillRect(x0 + Math.random() * sz, yl - Math.random() * 10, 1.5, 1.5);
    } else if (S.img) c.drawImage(S.img, x0, y0, sz, sz);
    // pins
    S.pins.forEach(p => drawPin(c, p, null));
    // profile line
    if (S.prof) {
      const [ax, ay] = toScreen(S.prof.a[0], S.prof.a[1]), [bx, by] = toScreen(S.prof.b[0], S.prof.b[1]);
      c.strokeStyle = 'rgba(0,0,0,.6)'; c.lineWidth = 4; c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by); c.stroke();
      c.strokeStyle = '#ffe9a8'; c.lineWidth = 2; c.setLineDash([6, 4]); c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by); c.stroke(); c.setLineDash([]);
      c.fillStyle = '#ffe9a8'; c.font = 'bold 12px system-ui';
      c.fillText('A', ax + 5, ay - 5); c.fillText('B', bx + 5, by - 5);
    }
    // sun indicator for hillshade
    if (S.view === 'hill' && S.scan >= 1) {
      const a = S.az * Math.PI / 180, cx = MW - 34, cy = 34;
      c.fillStyle = 'rgba(10,12,9,.7)'; c.beginPath(); c.arc(cx, cy, 24, 0, 7); c.fill();
      c.strokeStyle = '#6a6655'; c.lineWidth = 1; c.beginPath(); c.arc(cx, cy, 18, 0, 7); c.stroke();
      const sx = cx + Math.sin(a) * 18, sy = cy - Math.cos(a) * 18;
      c.strokeStyle = 'rgba(255,214,110,.7)'; c.beginPath(); c.moveTo(sx, sy); c.lineTo(cx, cy); c.stroke();
      c.fillStyle = '#ffd66e'; c.beginPath(); c.arc(sx, sy, 5, 0, 7); c.fill();
      c.fillStyle = '#bdb7a3'; c.font = '10px system-ui'; c.textAlign = 'center'; c.fillText('N', cx, cy - 26 + 8 > 4 ? cy - 27 : 10); c.textAlign = 'left';
    }
    // scale bar
    const m = S.zoom > 3 ? 20 : S.zoom > 1.5 ? 50 : 100, L = m * ppm();
    c.fillStyle = 'rgba(10,12,9,.7)'; c.fillRect(8, MH - 26, L + 46, 18);
    c.fillStyle = '#e8e2d2'; c.fillRect(12, MH - 19, L, 3);
    c.font = '11px system-ui'; c.fillText(m + ' m', 16 + L, MH - 13);
  }
  function pinShape(c, x, y, col, label, ring) {
    c.fillStyle = 'rgba(0,0,0,.55)'; c.beginPath(); c.arc(x, y + 1, 10, 0, 7); c.fill();
    c.fillStyle = col; c.beginPath(); c.arc(x, y, 9, 0, 7); c.fill();
    c.strokeStyle = 'rgba(12,10,6,.85)'; c.lineWidth = 1.5; c.stroke();
    if (ring) { c.strokeStyle = ring; c.lineWidth = 3; c.beginPath(); c.arc(x, y, 12, 0, 7); c.stroke(); }
    c.fillStyle = '#111'; c.font = 'bold 11px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(label, x, y + 0.5); c.textAlign = 'left'; c.textBaseline = 'alphabetic';
  }
  function drawPin(c, p, ring, tf) {
    const [x, y] = (tf || toScreen)(p.x, p.y);
    pinShape(c, x, y, TYPE_INFO[p.type].col, TYPE_INFO[p.type].short, ring);
  }

  // ---------- input on the map ----------
  const ptrs = new Map();
  let gest = null;
  map.addEventListener('pointerdown', e => {
    AU.unlock();
    map.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, [e.offsetX, e.offsetY]);
    if (ptrs.size === 1) {
      gest = { kind: 'one', sx: e.offsetX, sy: e.offsetY, cx: S.cx, cy: S.cy, moved: false };
      if (S.mode === 'slice') { const a = toWorld(e.offsetX, e.offsetY); gest.slice = a; }
    } else if (ptrs.size === 2) {
      const [p, q] = [...ptrs.values()];
      gest = { kind: 'pinch', d: Math.hypot(p[0] - q[0], p[1] - q[1]) || 1, zoom: S.zoom, mid: toWorld((p[0] + q[0]) / 2, (p[1] + q[1]) / 2) };
    }
  });
  map.addEventListener('pointermove', e => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, [e.offsetX, e.offsetY]);
    if (!gest) return;
    if (gest.kind === 'one') {
      const dx = e.offsetX - gest.sx, dy = e.offsetY - gest.sy;
      if (Math.hypot(dx, dy) > 7) gest.moved = true;
      if (!gest.moved) return;
      if (S.mode === 'slice' && gest.slice) {
        S.prof = { a: gest.slice, b: toWorld(e.offsetX, e.offsetY) };
        draw();
      } else {
        S.cx = gest.cx - dx / ppm(); S.cy = gest.cy - dy / ppm(); clampView(); draw();
      }
    } else if (gest.kind === 'pinch' && ptrs.size === 2) {
      const [p, q] = [...ptrs.values()];
      const d = Math.hypot(p[0] - q[0], p[1] - q[1]) || 1;
      S.zoom = gest.zoom * d / gest.d; clampView();
      const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
      S.cx = gest.mid[0] - (mx - MW / 2) / ppm(); S.cy = gest.mid[1] - (my - MH / 2) / ppm(); clampView();
      draw();
    }
  });
  function endPtr(e) {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    if (gest && gest.kind === 'one' && ptrs.size === 0) {
      if (!gest.moved) tap(e.offsetX, e.offsetY);
      else if (S.mode === 'slice' && S.prof) computeProfile();
    }
    if (ptrs.size === 0) gest = null;
    else if (ptrs.size === 1) gest = null; // finishing a pinch: wait for a fresh touch
  }
  map.addEventListener('pointerup', endPtr);
  map.addEventListener('pointercancel', e => { ptrs.delete(e.pointerId); gest = null; });
  map.addEventListener('wheel', e => {
    e.preventDefault();
    const before = toWorld(e.offsetX, e.offsetY);
    S.zoom *= Math.exp(-e.deltaY * 0.0015); clampView();
    const after = toWorld(e.offsetX, e.offsetY);
    S.cx += before[0] - after[0]; S.cy += before[1] - after[1]; clampView(); draw();
  }, { passive: false });

  function tap(sx, sy) {
    if (S.mode !== 'pin' || S.scan < 1) return;
    // remove an existing pin?
    for (let k = S.pins.length - 1; k >= 0; k--) {
      const [x, y] = toScreen(S.pins[k].x, S.pins[k].y);
      if (Math.hypot(x - sx, y - sy) < 14) { S.pins.splice(k, 1); AU.unpin(); updatePins(); draw(); return; }
    }
    const [x, y] = toWorld(sx, sy);
    if (x < 0 || y < 0 || x > SIZE || y > SIZE) return;
    S.pins.push({ x, y, type: S.ptype });
    AU.pin(); updatePins(); draw();
    if (S.spec.id === 1) tutorial('pinned');
  }
  function updatePins() { $('pinCount').textContent = S.pins.length + ' pin' + (S.pins.length === 1 ? '' : 's') + ' \u00b7 need ' + S.spec.quota; }

  // ---------- profile ----------
  function computeProfile() {
    if (!S.prof) return;
    const L = Math.hypot(S.prof.b[0] - S.prof.a[0], S.prof.b[1] - S.prof.a[1]);
    if (L < 6) { S.prof = null; S.profData = null; $('profSec').classList.add('hidden'); draw(); return; }
    if (L > 300) { // keep slices readable
      const t = 300 / L;
      S.prof.b = [S.prof.a[0] + (S.prof.b[0] - S.prof.a[0]) * t, S.prof.a[1] + (S.prof.b[1] - S.prof.a[1]) * t];
    }
    S.profData = BE.profile(S.world, S.filt, S.prof.a, S.prof.b, 1.5);
    $('profSec').classList.remove('hidden');
    resize();
    AU.tick();
    if (S.spec.id === 2) tutorial('sliced');
    // make sure the panel shows it on phones
    const sec = $('profSec');
    if (sec.scrollIntoView && window.innerWidth < 760) sec.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
  }
  function drawProfile() {
    const cv = $('prof'), c = cv.getContext('2d'), d = S.profData;
    const W = cv.width / dpr, H = cv.height / dpr;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = '#0a0c09'; c.fillRect(0, 0, W, H);
    if (!d) return;
    let zmin = 1e9, zmax = -1e9;
    for (const p of d.dtm) { zmin = Math.min(zmin, p[1]); zmax = Math.max(zmax, p[1]); }
    for (const p of d.pts) { zmax = Math.max(zmax, p.z); }
    zmin -= 1.5; zmax += 1;
    const pad = 22, sx = (W - pad - 6) / d.len, sy = (H - 18) / (zmax - zmin);
    const X = v => pad + v * sx, Y = z => H - 12 - (z - zmin) * sy;
    // grid
    c.strokeStyle = '#1e211a'; c.lineWidth = 1; c.fillStyle = '#7d786a'; c.font = '10px system-ui';
    const step = (zmax - zmin) > 30 ? 10 : 5;
    for (let z = Math.ceil(zmin / step) * step; z < zmax; z += step) { c.beginPath(); c.moveTo(pad, Y(z)); c.lineTo(W, Y(z)); c.stroke(); }
    c.fillText(Math.round(zmax - zmin) + ' m', 2, 12);
    c.fillText(Math.round(d.len) + ' m', W - 34, H - 2);
    c.fillText('A', 4, H - 2); c.fillText('B', W - 10, 12);
    for (const p of d.pts) {
      if (p.d < 0 || p.d > d.len) continue;
      c.fillStyle = p.ground ? '#c88a4a' : 'rgba(79,174,85,.75)';
      c.fillRect(X(p.d) - 1, Y(p.z) - 1, p.ground ? 2.4 : 2, p.ground ? 2.4 : 2);
    }
    c.strokeStyle = '#f4eedc'; c.lineWidth = 1.3; c.beginPath();
    d.dtm.forEach((p, k) => { if (k) c.lineTo(X(p[0]), Y(p[1])); else c.moveTo(X(p[0]), Y(p[1])); });
    c.stroke();
    $('profInfo').textContent = 'vertical x' + (sy / sx).toFixed(1);
  }

  // ---------- panel controls ----------
  // (innerHTML below only ever receives strings built from constants in this file, never user input)
  function buildPanel() {
    const pt = $('ptypes'); pt.innerHTML = '';
    BE.TYPES.forEach(t => {
      const b = document.createElement('button');
      b.innerHTML = '<span class="sw" style="background:' + TYPE_INFO[t].col + '"></span>' + TYPE_INFO[t].label;
      b.dataset.t = t;
      b.onclick = () => { S.ptype = t; setMode('pin'); syncChips(); AU.tick(); };
      pt.appendChild(b);
    });
    const vs = $('views'); vs.innerHTML = '';
    VIEWS.forEach(([k, label], n) => {
      const b = document.createElement('button');
      b.textContent = label; b.dataset.v = k; b.title = label + ' (' + (n + 1) + ')';
      b.onclick = () => setView(k);
      vs.appendChild(b);
    });
    $('tools').querySelectorAll('button').forEach(b => { b.onclick = () => { setMode(b.dataset.mode); AU.tick(); }; });
  }
  function setMode(m) {
    S.mode = m;
    $('tools').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
    $('ptypes').classList.toggle('hidden', m !== 'pin');
    map.style.cursor = m === 'slice' ? 'crosshair' : 'pointer';
    if (S.spec && S.spec.id === 2 && m === 'slice') tutorial('slicemode');
  }
  function syncChips() {
    $('ptypes').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.t === S.ptype));
    $('views').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === S.view));
    $('sunCtl').classList.toggle('hidden', S.view !== 'hill');
    $('lrmCtl').classList.toggle('hidden', S.view !== 'lrm');
  }
  function setView(v) {
    S.view = v; S.viewHist.add(v);
    syncChips(); AU.tick(); renderView();
    if (S.spec.id === 3 && v === 'lrm') tutorial('lrm');
    if (S.spec.id === 4 && (v === 'multi' || v === 'svf')) tutorial('multi');
  }
  function syncLabels() {
    $('azV').textContent = S.az + '\u00b0 ' + compass(S.az);
    $('altV').textContent = S.alt + '\u00b0';
    $('lrmV').textContent = S.lrmR + ' m';
    $('winV').textContent = $('win').value + ' m';
    $('slopeV').textContent = $('slope').value + '%';
  }
  function compass(a) { return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(a / 45) % 8]; }
  $('az').addEventListener('input', () => { S.az = +$('az').value; syncLabels(); drawDial(); renderView(); });
  $('alt').addEventListener('input', () => { S.alt = +$('alt').value; syncLabels(); renderView(); });
  $('lrm').addEventListener('input', () => { S.lrmR = +$('lrm').value; syncLabels(); renderView(); });
  let filtTimer = null;
  function filterSoon(delay) {
    syncLabels();
    clearTimeout(filtTimer);
    $('busy').classList.remove('hidden');
    filtTimer = setTimeout(runFilter, delay);
  }
  $('win').addEventListener('input', () => filterSoon(180));
  $('slope').addEventListener('input', () => filterSoon(180));
  $('win').addEventListener('change', () => filterSoon(0));
  $('slope').addEventListener('change', () => filterSoon(0));
  function runFilter() {
    const s = { win: +$('win').value, slope: +$('slope').value };
    if (S.filt && S.filt.settings.win === s.win && S.filt.settings.slope === s.slope) { $('busy').classList.add('hidden'); return; }
    S.filt = BE.groundFilter(S.world, s);
    S.layers = {};
    let g = 0; for (let i = 0; i < N * N; i++) g += S.filt.mask[i];
    $('filtInfo').textContent = Math.round(g / (N * N) * 100) + '% of cells kept as ground';
    $('busy').classList.add('hidden');
    AU.filter();
    if (S.profData) { S.profData = BE.profile(S.world, S.filt, S.prof.a, S.prof.b, 1.5); drawProfile(); }
    renderView();
    if (S.spec.id === 2) tutorial('filtered');
  }
  // sun dial
  const dial = $('dial');
  function drawDial() {
    const c = dial.getContext('2d'), R = 36;
    c.clearRect(0, 0, 88, 88);
    c.strokeStyle = '#4b4a3a'; c.lineWidth = 1; c.beginPath(); c.arc(44, 44, R, 0, 7); c.stroke();
    c.fillStyle = '#9c9786'; c.font = '10px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('N', 44, 6); c.fillText('S', 44, 82); c.fillText('E', 82, 44); c.fillText('W', 6, 44);
    const a = S.az * Math.PI / 180, x = 44 + Math.sin(a) * (R - 6), y = 44 - Math.cos(a) * (R - 6);
    c.strokeStyle = 'rgba(255,214,110,.6)'; c.beginPath(); c.moveTo(44, 44); c.lineTo(x, y); c.stroke();
    c.fillStyle = '#ffd66e'; c.beginPath(); c.arc(x, y, 7, 0, 7); c.fill();
  }
  let dialDrag = false;
  function dialSet(e) {
    const r = dial.getBoundingClientRect(), dx = e.clientX - r.left - r.width / 2, dy = e.clientY - r.top - r.height / 2;
    let a = Math.round(Math.atan2(dx, -dy) * 180 / Math.PI); if (a < 0) a += 360;
    S.az = a % 360; $('az').value = S.az; syncLabels(); drawDial(); renderView();
  }
  dial.addEventListener('pointerdown', e => { dialDrag = true; dial.setPointerCapture(e.pointerId); dialSet(e); });
  dial.addEventListener('pointermove', e => { if (dialDrag) dialSet(e); });
  dial.addEventListener('pointerup', () => { dialDrag = false; if (S.spec && S.spec.id === 1) tutorial('sun'); });

  // ---------- tutorial hints ----------
  const hintEl = $('hint');
  let hintStage = '';
  function hint(t) { if (!t) { hintEl.classList.add('hidden'); return; } hintEl.innerHTML = t; hintEl.classList.remove('hidden'); }
  function tutorial(ev) {
    const id = S.spec.id;
    if (id === 1) {
      if (ev === 'start') { hintStage = 'sun'; hint('Drag the <b>sun dial</b> (or the azimuth slider) and watch shapes appear and vanish under the raking light.'); }
      else if (ev === 'sun' && hintStage === 'sun') { hintStage = 'pin'; hint('Something has straight edges near the middle. Pick a type (Pyramid, Platform, Mound...) and <b>tap the map</b> to pin it. Pinch or scroll to zoom.'); }
      else if (ev === 'pinned' && hintStage === 'pin') { hintStage = 'more'; hint('Keep going: there are platforms around a plaza and small house mounds scattered around. Tap a pin to remove it. <b>Submit</b> when you have at least ' + S.spec.quota + '.'); }
    } else if (id === 2) {
      if (ev === 'start') { hintStage = 'f'; hint('This bumpy mess is the filter keeping understory points as "ground". Raise the <b>Window</b> and lower the <b>Slope</b> to strip it.'); }
      else if (ev === 'filtered' && hintStage === 'f') { hintStage = 's'; hint('Better? Now switch the tool to <b>Slice</b> and drag a line across a bump to see the raw points under it.'); }
      else if (ev === 'slicemode' && hintStage === 's') { hint('Drag across a bump. Brown = points your filter calls ground, green = vegetation.'); }
      else if (ev === 'sliced') { hintStage = 'done'; hint('A real mound has brown points on it. If the brown line sits on top of a band of green understory points, the filter is fooling you. Also try the <b>Coverage</b> view.'); setTimeout(() => { if (hintStage === 'done') hint(''); }, 9000); }
    } else if (id === 3) {
      if (ev === 'start') { hintStage = 'l'; hint('Hills everywhere. Try the <b>Relief</b> view: it subtracts the smoothed terrain so metre-high features stand out.'); }
      else if (ev === 'lrm') { hint('Round blobs are cone hills; look for sharp-cornered shapes, including on hilltops.'); setTimeout(() => hint(''), 7000); }
    } else if (id === 4) {
      if (ev === 'start') hint('The causeway is required. If you cannot see it, think about which way the light comes from.');
      else if (ev === 'multi') { hint('No blind azimuth now. A causeway is raised and dead straight; a logging track is sunken and curves.'); setTimeout(() => hint(''), 8000); }
    } else if (id === 5) {
      if (ev === 'start') { hint('Look at the hilltop. Is that pyramid as tall as it should be? Slice it, then fix the filter.'); setTimeout(() => hint(''), 9000); }
    } else if (ev === 'start') hint('');
  }

  // ---------- screens ----------
  function show(id) {
    ['title', 'how', 'game', 'brief', 'debrief'].forEach(s => $(s).classList.toggle('hidden', s !== id && !(id === 'brief' && s === 'game') && !(id === 'debrief' && s === 'game')));
    if (id === 'title') titleBg(); else cancelAnimationFrame(tbg.raf);
  }
  // ---------- title background: strip 1 with and without its forest, a scan line sweeping between ----------
  let worldCache = null;
  const tbg = $('titleBg');
  tbg.raf = 0;
  function titleBg() {
    if (!tbg.truth) { // build once, after the title has painted
      if (!tbg.pending) tbg.pending = setTimeout(() => {
        const w = BE.makeWorld(BE.STRIPS[0]); worldCache = w;
        makeCanopyImage(w); makeTruthImage(w);
        const cp = src => { const c = document.createElement('canvas'); c.width = N; c.height = N; c.getContext('2d').drawImage(src, 0, 0); return c; };
        tbg.can = cp(canOff); tbg.truth = cp(truthOff);
        if (!$('title').classList.contains('hidden')) titleBg();
      }, 60);
      return;
    }
    cancelAnimationFrame(tbg.raf);
    const t0 = performance.now();
    const frame = () => {
      const r = tbg.getBoundingClientRect(), d = Math.min(2, window.devicePixelRatio || 1);
      const W = Math.round(r.width * d), H = Math.round(r.height * d);
      if (tbg.width !== W || tbg.height !== H) { tbg.width = W; tbg.height = H; }
      const c = tbg.getContext('2d');
      // plaza group in the free margin beside the card on wide screens, centred on phones
      const wide = r.width > 900, fx = wide ? Math.max(W * 0.17, 140 * d) : W / 2;
      const s = Math.max(W, H) / (N * (wide ? 0.5 : 0.7)), ox = fx - 215 * s, oy = H / 2 - 185 * s;
      const u = reduced ? 0.55 : 0.5 + 0.45 * Math.sin((performance.now() - t0) / 3800 - 1.2);
      const xl = Math.round(W * u);
      c.drawImage(tbg.can, ox, oy, N * s, N * s);
      c.save(); c.beginPath(); c.rect(0, 0, xl, H); c.clip(); c.drawImage(tbg.truth, ox, oy, N * s, N * s); c.restore();
      c.fillStyle = 'rgba(255,70,45,.85)'; c.fillRect(xl - d, 0, 2 * d, H);
      const g = c.createLinearGradient(xl, 0, xl + 40 * d, 0); g.addColorStop(0, 'rgba(255,70,45,.25)'); g.addColorStop(1, 'rgba(255,70,45,0)');
      c.fillStyle = g; c.fillRect(xl, 0, 40 * d, H);
      if (!reduced && !$('title').classList.contains('hidden')) tbg.raf = requestAnimationFrame(frame);
    };
    frame();
  }
  function buildTitle() {
    const box = $('strips'); box.innerHTML = '';
    BE.STRIPS.forEach((sp, k) => {
      const b = document.createElement('button');
      b.className = 'strip';
      const g = progress[sp.id] || '';
      b.innerHTML = '<span class="n">' + sp.id + '</span><span class="t">' + sp.name + '<small>' + sp.lesson.split('.')[0] + '.</small></span><span class="g">' + g + '</span>';
      b.onclick = () => { AU.unlock(); startStrip(k); };
      box.appendChild(b);
    });
  }
  function startStrip(k, specOverride) {
    S.stripIndex = k;
    S.spec = specOverride || BE.STRIPS[k];
    $('busy').classList.remove('hidden');
    show('game');
    $('stripName').textContent = (S.spec.id ? S.spec.id + '. ' : '') + S.spec.name;
    hint('');
    setTimeout(() => {
      S.world = worldCache && worldCache.spec === S.spec ? worldCache : BE.makeWorld(S.spec);
      const d = S.spec.defaults;
      $('win').value = d.win; $('slope').value = d.slope;
      S.az = d.az; S.alt = d.alt; S.view = d.view; S.lrmR = 16;
      $('az').value = S.az; $('alt').value = S.alt; $('lrm').value = S.lrmR;
      S.pins = []; S.prof = null; S.profData = null; S.viewHist = new Set([S.view]); S.result = null;
      $('profSec').classList.add('hidden');
      S.zoom = 1; S.cx = SIZE / 2; S.cy = SIZE / 2;
      S.filt = null; S.layers = {};
      makeCanopyImage(S.world);
      runFilter();
      syncChips(); syncLabels(); drawDial(); updatePins(); setMode('pin');
      resize();
      $('briefTitle').textContent = (S.spec.id ? 'Strip ' + S.spec.id + ': ' : '') + S.spec.name;
      $('briefText').textContent = S.spec.brief;
      const req = S.world.features.filter(f => f.required).map(f => TYPE_INFO[f.type].label.toLowerCase());
      $('briefQuota').textContent = 'Report at least ' + S.spec.quota + ' real features with no more than ' + S.spec.maxFP + ' false positives' + (req.length ? '. Required: the ' + req.join(', ') : '') + '. ' + (S.world.stats.groundFrac * 100).toFixed(0) + '% of returns reached the ground.';
      show('brief');
    }, 30);
  }
  $('briefGo').onclick = () => { AU.unlock(); show('game'); scanIntro(); };
  $('briefBtn').onclick = () => show('brief');
  function scanIntro() {
    if (reduced || S.scanned === S.spec.seed) { S.scan = 1; draw(); tutorial('start'); return; }
    S.scanned = S.spec.seed;
    S.scan = 0; AU.sweep();
    const t0 = performance.now();
    const step = () => { S.scan = Math.min(1, (performance.now() - t0) / 1500); drawNow(); if (S.scan < 1) requestAnimationFrame(step); else { draw(); tutorial('start'); } };
    requestAnimationFrame(step);
  }

  // ---------- debrief ----------
  function bearingDiff(a, b) { let d = Math.abs(a - b) % 180; return Math.min(d, 180 - d); }
  function submit() {
    if (!S.pins.length) { hint('Pin at least one feature before you submit. Choose a type, then tap the map.'); return; }
    const w = S.world, res = BE.score(w, S.filt, S.pins);
    S.result = res;
    const li = [];
    const fl = id => w.features[id];
    res.hits.forEach(h => {
      const f = fl(h.feature), p = S.pins[h.pin];
      li.push([h.typeOk ? 'hit' : 'half', '<b>' + TYPE_INFO[f.type].label + '</b> ' + (h.typeOk ? 'correct (+150).' : '(you said ' + TYPE_INFO[p.type].label.toLowerCase() + ', +100).') + ' ' + describe(f) + (h.note ? ' <i>' + h.note + '</i>' : '')]);
    });
    res.fps.forEach(fp => li.push(['fp', '<b>False positive</b> (' + TYPE_INFO[S.pins[fp.pin].type].label.toLowerCase() + ', -75). ' + fp.why]));
    res.dups.forEach(d => li.push(['dup', 'Second pin on the same ' + TYPE_INFO[fl(d.feature).type].label.toLowerCase() + ' (no effect).']));
    res.missed.forEach(id => {
      const f = fl(id);
      let why = describe(f);
      if (f.type === 'causeway' && !S.viewHist.has('multi') && !S.viewHist.has('svf') && bearingDiff(S.az, causewayBearing(f)) < 25) why += ' Your sun was shining along it, so it was invisible in hillshade.';
      else if ((f.type === 'pyramid' || f.type === 'platform') && BE.sampleMax(w.ground, f) - BE.sampleMax(S.filt.dtm, f) > 1.5) why += ' Your filter removed most of it.';
      else if (f.type === 'mound') why += ' House mounds are under ~1.3 m: Relief or a low sun helps.';
      li.push(['miss', '<b>Missed ' + TYPE_INFO[f.type].label.toLowerCase() + '</b>. ' + why]);
    });
    const pass = res.pass;
    $('dbTitle').textContent = pass ? 'Report accepted \u2014 grade ' + res.grade : 'Report rejected';
    let sum = res.hits.length + ' of ' + res.total + ' features found, ' + res.fps.length + ' false positive' + (res.fps.length === 1 ? '' : 's') + '. Score ' + res.points + '.';
    if (!pass) {
      const why = [];
      if (res.hits.length < res.quota) why.push('needed ' + res.quota + ' real features');
      if (res.fps.length > res.maxFP) why.push('more than ' + res.maxFP + ' false positives');
      if (!res.requiredOk) why.push('the required ' + w.features.filter(f => f.required).map(f => f.type).join(', ') + ' was not reported');
      sum += ' Rejected: ' + why.join('; ') + '.';
    }
    $('dbSummary').textContent = sum;
    $('dbLesson').textContent = S.spec.lesson;
    $('dbList').innerHTML = li.map(([c, t]) => '<li class="' + c + '">' + t + '</li>').join('');
    if (pass && S.spec.id) {
      const order = ['F', 'C', 'B', 'A', 'A+'];
      if (order.indexOf(res.grade) > order.indexOf(progress[S.spec.id] || 'F')) { progress[S.spec.id] = res.grade; saveProgress(); }
    }
    $('dbNext').textContent = S.spec.id && S.spec.id < BE.STRIPS.length ? 'Next strip' : 'New random survey';
    $('dbNext').classList.toggle('hidden', !pass && !!S.spec.id);
    makeTruthImage(w);
    show('debrief');
    AU.reveal(pass);
    peel(reduced ? 100 : 0);
    if (!reduced) {
      const t0 = performance.now();
      const st = () => { const t = Math.min(1, (performance.now() - t0) / 2200); peel(Math.round(100 * t * t * (3 - 2 * t))); if (t < 1 && !$('debrief').classList.contains('hidden')) requestAnimationFrame(st); };
      requestAnimationFrame(st);
    }
  }
  function causewayBearing(f) { let a = Math.atan2(f.x1 - f.x0, -(f.y1 - f.y0)) * 180 / Math.PI; return (a + 360) % 360; }
  function describe(f) {
    if (f.type === 'pyramid') return (f.oval ? 'Oval' : 'Stepped') + ' pyramid, ' + f.h.toFixed(0) + ' m tall.';
    if (f.type === 'platform') return 'Flat-topped platform, ' + f.h.toFixed(1) + ' m high, ' + Math.round(f.a * 2) + ' x ' + Math.round(f.b * 2) + ' m.';
    if (f.type === 'mound') return 'House mound, ' + f.h.toFixed(1) + ' m high.';
    if (f.type === 'causeway') return 'Raised causeway, ' + f.h.toFixed(1) + ' m high and ' + Math.round(Math.hypot(f.x1 - f.x0, f.y1 - f.y0)) + ' m long.';
    if (f.type === 'reservoir') return 'Flat-bottomed reservoir, ' + f.depth.toFixed(1) + ' m deep, with a spoil berm.';
    return '';
  }
  const pm = $('peelMap');
  function peel(v) {
    $('peel').value = v;
    const r = pm.getBoundingClientRect(), W = Math.max(200, Math.round(r.width * dpr));
    pm.width = W; pm.height = W;
    const c = pm.getContext('2d'), k = W / SIZE;
    c.drawImage(canOff, 0, 0, W, W);
    c.globalAlpha = v / 100; c.drawImage(truthOff, 0, 0, W, W); c.globalAlpha = 1;
    if (v < 60 || !S.result) return;
    const a = Math.min(1, (v - 60) / 30);
    c.globalAlpha = a;
    const tf = (x, y) => [x * k, y * k];
    // ground-truth outlines
    const lw = Math.max(1.5, W / 400);
    S.world.features.forEach(f => {
      const found = S.result.hits.some(h => h.feature === f.id);
      c.setLineDash(found ? [] : [5, 4]);
      c.strokeStyle = 'rgba(8,8,5,.75)'; c.lineWidth = lw + 2.5; outline(c, f, k, 2.5); // dark halo: outlines must read on pale ground
      c.strokeStyle = found ? '#8fd18a' : '#8fd0ff'; c.lineWidth = lw; outline(c, f, k, 0);
    });
    c.setLineDash([]);
    const ring = new Map();
    S.result.hits.forEach(h => ring.set(h.pin, h.typeOk ? '#8fd18a' : '#e3c160'));
    S.result.fps.forEach(f => ring.set(f.pin, '#e8735a'));
    S.result.dups.forEach(d => ring.set(d.pin, '#9c9786'));
    S.pins.forEach((p, i) => drawPin(c, p, ring.get(i), tf));
    c.globalAlpha = 1;
  }
  function outline(c, f, k, extra) {
    c.beginPath();
    if (f.type === 'causeway') { const lw = c.lineWidth; c.moveTo(f.x0 * k, f.y0 * k); c.lineTo(f.x1 * k, f.y1 * k); c.lineWidth = Math.max(3, f.w * 2 * k) + extra; c.stroke(); c.lineWidth = lw; return; }
    if (f.oval) { c.ellipse(f.x * k, f.y * k, f.a * k + 2, f.b * k + 2, f.rot, 0, 7); c.stroke(); return; }
    const cs = Math.cos(f.rot), sn = Math.sin(f.rot), a = f.a + 1.5, b = f.b + 1.5;
    [[-a, -b], [a, -b], [a, b], [-a, b]].forEach(([u, v], i) => {
      const x = (f.x + u * cs - v * sn) * k, y = (f.y + u * sn + v * cs) * k;
      if (i) c.lineTo(x, y); else c.moveTo(x, y);
    });
    c.closePath(); c.stroke();
  }
  $('peel').addEventListener('input', () => peel(+$('peel').value));
  $('submitBtn').onclick = submit;
  $('submitBar').onclick = submit;
  $('dbRetry').onclick = () => { show('game'); draw(); };
  $('dbMenu').onclick = () => { buildTitle(); show('title'); };
  $('dbNext').onclick = () => {
    if (S.spec.id && S.spec.id < BE.STRIPS.length) startStrip(S.spec.id);
    else randomSurvey();
  };
  function randomSurvey(seed) {
    seed = seed || (1 + Math.floor(Math.random() * 99999));
    startStrip(-1, BE.randomSpec(seed));
  }
  $('randBtn').onclick = () => { AU.unlock(); randomSurvey(); };
  $('menuBtn').onclick = () => { buildTitle(); show('title'); };
  $('howBtn').onclick = () => show('how');
  $('howClose').onclick = () => show('title');
  function syncMute() { $('muteBtn').style.opacity = AU.muted ? 0.4 : 1; $('muteBtn').title = AU.muted ? 'Sound off (M)' : 'Sound on (M)'; }
  $('muteBtn').onclick = () => { AU.unlock(); AU.setMuted(!AU.muted); syncMute(); };

  // keyboard
  window.addEventListener('keydown', e => {
    if ($('game').classList.contains('hidden') || !$('brief').classList.contains('hidden') || !$('debrief').classList.contains('hidden')) return;
    if (e.target && e.target.tagName === 'INPUT' && e.key.length > 1 && e.key.startsWith('Arrow')) return;
    const k = e.key;
    if (k >= '1' && k <= '8') setView(VIEWS[+k - 1][0]);
    else if (k === 'p' || k === 'P') setMode('pin');
    else if (k === 's' || k === 'S') setMode('slice');
    else if (k === 'm' || k === 'M') { AU.setMuted(!AU.muted); syncMute(); }
    else if (k === '+' || k === '=') { S.zoom *= 1.25; clampView(); draw(); }
    else if (k === '-') { S.zoom /= 1.25; clampView(); draw(); }
    else if (k.startsWith('Arrow')) {
      const d = 60 / S.zoom;
      if (k === 'ArrowLeft') S.cx -= d; if (k === 'ArrowRight') S.cx += d; if (k === 'ArrowUp') S.cy -= d; if (k === 'ArrowDown') S.cy += d;
      clampView(); draw(); e.preventDefault();
    }
  });
  window.addEventListener('resize', resize);

  // ---------- boot ----------
  buildPanel(); buildTitle(); syncMute();
  if (params.has('demo')) {
    // screenshot mode: strip 5 with a tuned filter, east sun, pins and a slice over the pyramid
    S.scanned = 5531;
    startStrip(4);
    setTimeout(() => {
      show('game');
      $('win').value = 12; $('slope').value = 45; runFilter();
      S.az = 60; S.alt = 30; $('az').value = 60; $('alt').value = 30; syncLabels(); drawDial();
      const fs = S.world.features;
      fs.slice(0, 6).forEach(f => S.pins.push({ x: f.x + 3, y: f.y - 2, type: f.type }));
      const p = fs.find(f => f.type === 'pyramid');
      S.prof = { a: [p.x - 70, p.y + 10], b: [p.x + 70, p.y - 10] };
      computeProfile();
      S.zoom = 1.9; S.cx = p.x + 10; S.cy = p.y + 70; clampView();
      updatePins(); renderView();
    }, 120);
  } else if (params.has('debrief')) {
    S.scanned = 1101;
    startStrip(0);
    setTimeout(() => {
      S.world.features.slice(0, 7).forEach(f => S.pins.push({ x: f.x, y: f.y, type: f.type }));
      S.pins.push({ x: S.world.decoys[0].x, y: S.world.decoys[0].y, type: 'mound' });
      submit();
    }, 150);
  } else if (params.has('selftest')) {
    // click-through of every screen and tool; result goes into #selftest for --dump-dom
    const log = [], out = document.createElement('pre'); out.id = 'selftest'; document.body.appendChild(out);
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const overflow = name => { // layout check: nothing visible may stick out of the viewport sideways
      const bad = [];
      document.querySelectorAll('button, input, canvas, h1, h2, p, label, #bar > div').forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.width && r.height && (r.right > innerWidth + 1 || r.left < -1)) bad.push((el.id || el.tagName) + ' ' + Math.round(r.left) + '..' + Math.round(r.right));
      });
      log.push('layout ' + name + ' @' + innerWidth + 'x' + innerHeight + ': ' + (bad.length ? 'OVERFLOW ' + bad.slice(0, 5).join(', ') : 'ok'));
    };
    overflow('title');
    (async () => {
      try {
        for (let k = 0; k < BE.STRIPS.length; k++) {
          startStrip(k); await wait(80);
          if ($('brief').classList.contains('hidden')) throw new Error('brief not shown for strip ' + (k + 1));
          $('briefGo').click(); await wait(20);
          if (k === 0) overflow('game');
          VIEWS.forEach(([v]) => setView(v));
          $('az').value = 45; $('az').dispatchEvent(new Event('input'));
          $('win').value = 12; $('slope').value = 50; runFilter();
          S.prof = { a: [300, 300], b: [420, 330] }; computeProfile();
          S.scan = 1; resize();
          const [sx, sy] = toScreen(S.world.features[0].x, S.world.features[0].y);
          S.ptype = S.world.features[0].type; setMode('pin'); tap(sx, sy); tap(sx, sy); tap(sx, sy); // add, remove, add
          S.world.features.slice(1, S.spec.quota + 1).forEach(f => S.pins.push({ x: f.x, y: f.y, type: f.type }));
          submit(); await wait(30);
          const r = S.result;
          log.push(`strip ${k + 1}: pins ${S.pins.length} hits ${r.hits.length}/${r.total} fps ${r.fps.length} pass ${r.pass} grade ${r.grade} li ${$('dbList').children.length}`);
          if (k === 0) overflow('debrief');
          peel(50); peel(100);
        }
        randomSurvey(4242); await wait(80); $('briefGo').click(); submit(); await wait(20);
        log.push('random: ' + S.world.features.length + ' features, zero-pin submit refused: ' + !S.result);
        buildTitle(); show('title');
        out.textContent = 'SELFTEST OK\n' + log.join('\n');
        if (parent !== window) parent.postMessage(out.textContent, '*'); // lets a narrow iframe harness read the result
      } catch (e) { out.textContent = 'SELFTEST FAIL ' + e.message + '\n' + (e.stack || '') + '\n' + log.join('\n'); }
    })();
  } else show('title');
})();
