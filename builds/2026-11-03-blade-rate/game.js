/* Blade Rate - UI, rendering, audio, campaign. */
(function () {
  'use strict';
  const S = window.BRSIM, D = window.BRDATA;
  const $ = id => document.getElementById(id);
  const Q = new URLSearchParams(location.search);
  const DEMO = Q.has('demo');
  const RM = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fmtB = b => String(Math.round(S.wrap360(b)) % 360).padStart(3, '0');

  // ---------------- state ----------------
  const G = {
    wi: 0, sim: null, running: false, paused: true, score: 0, watchPts: 0, results: [], falseReports: 0,
    loF: null, dmF: null, zoom: 250, integ: 4, acc: 0, last: 0, tut: -1, lost: false, ended: false,
    tags: [], bookOpened: false, muted: false, campaign: []
  };

  // ---------------- colour map ----------------
  const LUT = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    const r = t < 0.7 ? 6 + 40 * t : 34 + (t - 0.7) / 0.3 * 200;
    const g = 8 + 250 * Math.pow(t, 0.8);
    const b = t < 0.75 ? 6 + 30 * t : 28 + (t - 0.75) / 0.25 * 190;
    LUT[i * 3] = r; LUT[i * 3 + 1] = g; LUT[i * 3 + 2] = b;
  }
  class Fall {
    constructor(bins, rows) {
      this.bins = bins; this.rows = rows;
      this.c = document.createElement('canvas'); this.c.width = bins; this.c.height = rows;
      this.x = this.c.getContext('2d'); this.x.fillStyle = '#020604'; this.x.fillRect(0, 0, bins, rows);
      this.img = this.x.createImageData(bins, 1);
    }
    push(vals, tint) {
      this.x.drawImage(this.c, 0, 0, this.bins, this.rows - 1, 0, 1, this.bins, this.rows - 1);
      const d = this.img.data;
      for (let i = 0; i < this.bins; i++) {
        const v = tint ? 0 : Math.max(0, Math.min(255, Math.round(vals[i] * 255))) * 3;
        if (tint) { d[i * 4] = 90; d[i * 4 + 1] = 70; d[i * 4 + 2] = 20; }
        else { d[i * 4] = LUT[v]; d[i * 4 + 1] = LUT[v + 1]; d[i * 4 + 2] = LUT[v + 2]; }
        d[i * 4 + 3] = 255;
      }
      this.x.putImageData(this.img, 0, 0);
    }
  }
  const FALL_LO = new Fall(S.LO_BINS, 150), FALL_DM = new Fall(S.DM_BINS, 90), FALL_BTR = new Fall(360, 140);
  let markLO = false;

  const toDb = (p, floor) => 10 * Math.log10(Math.max(p, 1e-9) / floor);
  function rowLO(P) { const fl = S.median(P.slice(4)); const o = new Float32Array(P.length); for (let i = 0; i < P.length; i++) o[i] = Math.pow(Math.max(0, (toDb(P[i], fl) + 0.5) / 12), 0.85); return o; }
  function rowDM(P) { const fl = S.median(P.slice(4)); const o = new Float32Array(P.length); for (let i = 0; i < P.length; i++) o[i] = i < 3 ? 0 : Math.pow(Math.max(0, (toDb(P[i], fl) + 0.5) / 14), 0.85); return o; }
  function rowBTR(P) {
    const o = new Float32Array(360);
    for (let b = 0; b < 360; b++) { const x = (b + 180) % 360; o[x] = Math.pow(Math.max(0, (toDb(P[b], 1) + 0.25) / 3.2), 0.7); }
    return o;
  }

  // ---------------- canvases ----------------
  const cv = { btr: $('cBTR'), lo: $('cLO'), dm: $('cDM') };
  const ctx = { btr: cv.btr.getContext('2d'), lo: cv.lo.getContext('2d'), dm: cv.dm.getContext('2d') };
  let DPR = 1;
  function resize() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    for (const k in cv) { const c = cv[k], r = c.getBoundingClientRect(); c.width = Math.max(10, Math.round(r.width * DPR)); c.height = Math.max(10, Math.round(r.height * DPR)); }
    draw();
  }
  window.addEventListener('resize', resize);

  const BAFFLE = 150; // relative bearing beyond which we are deaf
  const xOfBrg = (b, W) => ((S.angDiff(b, 0) + 180) / 360) * W;
  const brgOfX = (x, W) => S.wrap360(x / W * 360 - 180);

  function drawBTR() {
    const c = ctx.btr, W = cv.btr.width, H = cv.btr.height, top = 16 * DPR;
    c.fillStyle = '#020604'; c.fillRect(0, 0, W, H);
    c.imageSmoothingEnabled = true;
    c.drawImage(FALL_BTR.c, 0, 0, 360, FALL_BTR.rows, 0, top, W, H - top);
    // baffles
    c.fillStyle = 'rgba(2,6,4,.72)';
    const bx = xOfBrg(-BAFFLE, W), bx2 = xOfBrg(BAFFLE, W);
    c.fillRect(0, top, bx, H - top); c.fillRect(bx2, top, W - bx2, H - top);
    c.strokeStyle = 'rgba(95,139,108,.25)'; c.lineWidth = 1;
    for (let y = top - H; y < H; y += 10 * DPR) {
      c.beginPath(); c.moveTo(0, y); c.lineTo(bx, y + bx); c.stroke();
      c.beginPath(); c.moveTo(bx2, y); c.lineTo(W, y + (W - bx2)); c.stroke();
    }
    // scale
    c.fillStyle = '#5f8b6c'; c.font = `${10 * DPR}px ui-monospace, monospace`; c.textAlign = 'center';
    for (let r = -180; r <= 180; r += 30) {
      const x = (r + 180) / 360 * W; c.fillRect(x, top - 4 * DPR, 1, 4 * DPR);
      if (r > -180 && r < 180) c.fillText(fmtB(r), x, 10 * DPR);
    }
    // tags for reported contacts
    if (G.sim) {
      c.font = `${10 * DPR}px ui-monospace, monospace`;
      G.sim.contacts.forEach(ct => {
        if (!ct.reported) return;
        const x = xOfBrg(S.contactBearing(ct, G.sim.t), W);
        c.fillStyle = ct.cls.flag === 'Red' ? '#ff5a4f' : ct.cls.flag === 'Blue' ? '#6fb6ff' : '#b8e6c4';
        c.fillText(ct.tag, x, top + 12 * DPR);
      });
      // beam
      const x = xOfBrg(G.sim.steer, W), bw = S.BEAM_SIGMA * 2 / 360 * W;
      c.fillStyle = 'rgba(255,191,90,.10)'; c.fillRect(x - bw / 2, top, bw, H - top);
      c.strokeStyle = '#ffbf5a'; c.beginPath(); c.moveTo(x, top); c.lineTo(x, H); c.globalAlpha = .55; c.stroke(); c.globalAlpha = 1;
      c.fillStyle = '#ffbf5a'; c.beginPath(); c.moveTo(x, top + 1); c.lineTo(x - 5 * DPR, top - 5 * DPR); c.lineTo(x + 5 * DPR, top - 5 * DPR); c.fill();
    }
  }

  function drawSpec(c, W, H, P, nBins, binHz, maxHz, floorDb, spanDb) {
    // averaged spectrum trace on top strip
    const sh = Math.round(H * 0.3);
    c.fillStyle = '#041009'; c.fillRect(0, 0, W, sh);
    if (!P) return sh;
    const fl = S.median(P.slice(4));
    c.beginPath();
    const n = Math.min(nBins, Math.round(maxHz / binHz));
    for (let i = 0; i < n; i++) {
      const x = i / n * W, v = (toDb(P[i], fl) - floorDb) / spanDb;
      const y = sh - 3 - Math.max(0, Math.min(1, v)) * (sh - 8);
      i ? c.lineTo(x, y) : c.moveTo(x, y);
    }
    c.strokeStyle = '#7dffa8'; c.lineWidth = DPR; c.stroke();
    return sh;
  }
  function drawCursor(c, W, top, H, f, maxHz, labelFn, color, nmax) {
    if (f == null || f <= 0) return;
    c.font = `${10 * DPR}px ui-monospace, monospace`; c.textAlign = 'center';
    for (let k = 1; k <= nmax && k * f <= maxHz; k++) {
      const x = k * f / maxHz * W;
      c.strokeStyle = color; c.globalAlpha = k === 1 ? .9 : .45; c.lineWidth = DPR;
      c.setLineDash(k === 1 ? [] : [4 * DPR, 4 * DPR]);
      c.beginPath(); c.moveTo(x, top); c.lineTo(x, H); c.stroke();
      c.globalAlpha = 1; c.setLineDash([]);
      c.fillStyle = color; if (labelFn) c.fillText(labelFn(k), x, top + 11 * DPR);
    }
  }
  function drawLO() {
    const c = ctx.lo, W = cv.lo.width, H = cv.lo.height;
    c.fillStyle = '#020604'; c.fillRect(0, 0, W, H);
    const P = G.sim && G.sim.loI;
    const sh = drawSpec(c, W, H, P, S.LO_BINS, S.LO_RES, G.zoom, -2, 16);
    const srcW = Math.round(G.zoom / S.LO_RES);
    c.imageSmoothingEnabled = true;
    c.drawImage(FALL_LO.c, 0, 0, srcW, FALL_LO.rows, 0, sh, W, H - sh);
    // axis
    c.fillStyle = '#5f8b6c'; c.font = `${10 * DPR}px ui-monospace, monospace`; c.textAlign = 'center';
    const step = G.zoom > 100 ? 25 : 10;
    for (let f = step; f < G.zoom; f += step) { const x = f / G.zoom * W; c.fillRect(x, sh - 3 * DPR, 1, 3 * DPR); if (f % (step * 2) === 0) c.fillText(f, x, sh - 5 * DPR); }
    drawCursor(c, W, sh, H, G.loF, G.zoom, k => k === 1 ? '' : 'x' + k, '#ffbf5a', 12);
  }
  function drawDM() {
    const c = ctx.dm, W = cv.dm.width, H = cv.dm.height;
    c.fillStyle = '#020604'; c.fillRect(0, 0, W, H);
    const P = G.sim && G.sim.dmI;
    const sh0 = Math.round(H * 0.3);
    // DEMON: bigger line trace (55%) + waterfall
    const sh = Math.round(H * 0.55);
    c.fillStyle = '#041009'; c.fillRect(0, 0, W, sh);
    if (P) {
      const fl = S.median(P.slice(4)); c.beginPath();
      for (let i = 0; i < S.DM_BINS; i++) {
        const x = i / S.DM_BINS * W, v = i < 3 ? 0 : (toDb(P[i], fl) + 1) / 18;
        const y = sh - 3 - Math.max(0, Math.min(1, v)) * (sh - 16 * DPR);
        i ? c.lineTo(x, y) : c.moveTo(x, y);
      }
      c.strokeStyle = '#7dffa8'; c.lineWidth = DPR; c.stroke();
    }
    c.imageSmoothingEnabled = true;
    c.drawImage(FALL_DM.c, 0, 0, S.DM_BINS, FALL_DM.rows, 0, sh, W, H - sh);
    c.fillStyle = '#5f8b6c'; c.font = `${10 * DPR}px ui-monospace, monospace`; c.textAlign = 'center';
    for (let f = 5; f < S.DM_MAX; f += 5) { const x = f / S.DM_MAX * W; c.fillRect(x, sh - 3 * DPR, 1, 3 * DPR); if (f % 10 === 0) c.fillText(f, x, sh - 5 * DPR); }
    drawCursor(c, W, 2 * DPR, H, G.dmF, S.DM_MAX, k => String(k), '#ffbf5a', 40);
    void sh0;
  }
  function draw() { drawBTR(); drawLO(); drawDM(); }

  // ---------------- readouts ----------------
  function updROs() {
    if (!G.sim) return;
    $('roBeam').textContent = `BEAM ${fmtB(G.sim.steer)}  INT ${G.integ}`;
    $('roLo').textContent = G.loF ? `CURSOR ${G.loF.toFixed(1)} Hz  x2 ${(2 * G.loF).toFixed(1)}  x3 ${(3 * G.loF).toFixed(1)}` : 'drag to place harmonic cursor';
    $('roDm').textContent = G.dmF ? `SHAFT? ${G.dmF.toFixed(2)} Hz = ${Math.round(G.dmF * 60)} RPM` : 'drag to place shaft-rate cursor';
    $('roLoRange').textContent = `0-${G.zoom} Hz`;
    $('bInt').textContent = `INT ${G.integ}`;
    $('bZoom').textContent = G.zoom === 250 ? '0-250' : '0-60';
  }
  function updHud() {
    const w = D.WATCHES[G.wi];
    $('hWatch').textContent = `WATCH ${G.wi + 1}/${D.WATCHES.length}`;
    $('hName').textContent = w.name.toUpperCase();
    $('hScore').textContent = G.score + G.watchPts;
    if (G.sim) {
      const left = Math.max(0, w.duration - G.sim.t), m = Math.floor(left / 60), s = Math.floor(left % 60);
      $('hClock').textContent = `${m}:${String(s).padStart(2, '0')}`;
      if (w.clock) {
        const reds = G.sim.contacts.filter(c => c.cls.flag === 'Red');
        const done = reds.every(c => c.reported);
        const th = $('threat');
        th.hidden = false; th.classList.toggle('safe', done);
        $('threatLbl').textContent = done ? 'RED BOAT TRACKED' : 'COUNTER-DETECTION';
        $('threatBar').style.width = (done ? 100 : Math.min(100, G.sim.t / w.clock * 100)) + '%';
      } else $('threat').hidden = true;
    }
  }

  // ---------------- interaction ----------------
  function setSteer(b, quiet) {
    if (!G.sim) return;
    const rel = S.angDiff(b, 0);
    if (Math.abs(rel) > BAFFLE) { b = Math.sign(rel) * BAFFLE; if (!quiet) toast('Baffles: we are deaf astern.'); }
    const nb = S.wrap360(Math.round(b));
    if (nb === Math.round(G.sim.steer) % 360) return;
    G.sim.setSteer(nb); markLO = true;
    A.steer(); updROs(); draw(); tutCheck();
  }
  function bindDrag(canvas, fn) {
    let down = false;
    const at = e => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }; };
    canvas.addEventListener('pointerdown', e => { if (!G.running) return; down = true; canvas.setPointerCapture(e.pointerId); A.unlock(); fn(at(e), false); e.preventDefault(); });
    canvas.addEventListener('pointermove', e => { if (down) fn(at(e), false); });
    const up = e => { if (down) { down = false; fn(at(e), true); } };
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  }
  // snap a cursor to the local peak of the averaged spectrum within +-r bins
  function snap(P, f, res, r) {
    if (!P) return f; const k = Math.round(f / res); let best = k;
    for (let j = Math.max(1, k - r); j <= Math.min(P.length - 1, k + r); j++) if (P[j] > P[best]) best = j;
    const fl = S.median(P.slice(4)); if (toDb(P[best], fl) < 3) return f;
    // parabolic interpolation for sub-bin accuracy
    const a = P[best - 1] || P[best], b = P[best], c = P[best + 1] || P[best];
    const den = a - 2 * b + c, off = den ? 0.5 * (a - c) / den : 0;
    return (best + Math.max(-0.5, Math.min(0.5, off))) * res;
  }
  bindDrag(cv.btr, p => setSteer(brgOfX(p.x * cv.btr.width, cv.btr.width), true));
  bindDrag(cv.lo, (p, end) => {
    let f = p.x * G.zoom; if (f < 0.5) f = 0.5;
    if (end) f = snap(G.sim.loI, f, S.LO_RES, 2);
    G.loF = f; updROs(); drawLO(); if (end) tutCheck();
  });
  bindDrag(cv.dm, (p, end) => {
    let f = p.x * S.DM_MAX; if (f < 0.3) f = 0.3;
    if (end) f = snap(G.sim.dmI, f, S.DM_RES, 1);
    G.dmF = f; updROs(); drawDM(); if (end) tutCheck();
  });
  $('bLeft').onclick = () => setSteer(G.sim.steer - 1);
  $('bRight').onclick = () => setSteer(G.sim.steer + 1);
  $('bInt').onclick = () => { G.integ = G.integ === 1 ? 4 : G.integ === 4 ? 16 : 1; if (G.sim) G.sim.integ = G.integ; A.click(); updROs(); };
  $('bZoom').onclick = () => { G.zoom = G.zoom === 250 ? 62.5 : 250; A.click(); updROs(); drawLO(); };
  $('bReport').onclick = openReport;
  let secureArm = 0;
  $('bSecure').onclick = () => {
    if (!G.running) return;
    if (Date.now() - secureArm < 3000) { secureArm = 0; $('bSecure').textContent = 'SECURE'; endWatch('secured'); return; }
    secureArm = Date.now(); $('bSecure').textContent = 'SURE?'; toast('Tap SECURE again to end the watch. Unreported contacts count as missed.', 2800);
    setTimeout(() => { if (secureArm && Date.now() - secureArm >= 2900) { secureArm = 0; $('bSecure').textContent = 'SECURE'; } }, 3000);
  };
  $('bBook').onclick = () => { openBook(); };
  $('bHelp').onclick = () => show('oHelp');
  $('bMute').onclick = () => { G.muted = !G.muted; A.mute(G.muted); $('bMute').classList.toggle('off', G.muted); };
  document.querySelectorAll('.ovl .close').forEach(b => b.addEventListener('click', () => { hide(b.closest('.ovl').id); }));
  window.addEventListener('keydown', e => {
    if (e.target && e.target.tagName === 'INPUT') return;
    const open = document.querySelector('.ovl:not([hidden])');
    if (e.key === 'Escape' && open && open.id !== 'oTitle' && open.id !== 'oBrief' && open.id !== 'oDebrief' && open.id !== 'oFinal') { hide(open.id); return; }
    if (open || !G.running) return;
    const k = e.key.toLowerCase();
    if (e.key === 'ArrowLeft') { setSteer(G.sim.steer - (e.shiftKey ? 5 : 1)); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { setSteer(G.sim.steer + (e.shiftKey ? 5 : 1)); e.preventDefault(); }
    else if (k === 'i') $('bInt').click(); else if (k === 'z') $('bZoom').click();
    else if (k === 'r') openReport(); else if (k === 'b') openBook(); else if (k === 'm') $('bMute').click();
  });

  function show(id) { $(id).hidden = false; G.paused = isPausing(); A.duck(G.paused); }
  function hide(id) { $(id).hidden = true; G.paused = isPausing(); A.duck(G.paused); }
  function isPausing() { return Array.from(document.querySelectorAll('.ovl')).some(o => !o.hidden); }
  let toastT = 0;
  function toast(msg, ms) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, ms || 2200); }

  // ---------------- book ----------------
  function bookHtml() {
    return D.BOOK.map(b => {
      const facts = b.type === 'bio' ? 'no steady lines &middot; no DEMON rhythm &middot; sweeping moans / pulses'
        : [`${b.mains} Hz plant`, `${b.shafts} shaft${b.shafts > 1 ? 's' : ''}`, `${b.blades} blades`, `TPK ${b.tpk}`,
          b.cyl ? `${b.cyl}-cyl direct drive` : null, ...b.fixed.map(([f]) => `aux ${f} Hz`), `${b.speed[0]}-${b.speed[1]} kn`,
          b.cav ? null : 'no cavitation'].filter(Boolean).join(' &middot; ');
      return `<div class="bookItem"><h3>${b.name}<span class="flag ${b.flag}">${b.flag.toUpperCase()}</span></h3><div class="facts">${facts}</div><div class="notes">${b.notes}</div></div>`;
    }).join('');
  }
  function openBook() { $('bookList').innerHTML = bookHtml(); show('oBook'); G.bookOpened = true; A.click(); tutCheck(); }

  // ---------------- report ----------------
  let rep = { cls: null, speed: 10 };
  function openReport() {
    if (!G.running || G.ended) return;
    A.click();
    rep = { cls: null, speed: rep.speed || 10 };
    $('repBrg').textContent = `BRG ${fmtB(G.sim.steer)}`;
    $('repClasses').innerHTML = D.BOOK.map(b => `<button class="chip ${b.flag === 'Red' ? 'red' : b.flag === 'Blue' ? 'blue' : ''}" data-id="${b.id}">${b.short}</button>`).join('');
    $('repClasses').querySelectorAll('.chip').forEach(ch => ch.onclick = () => { rep.cls = ch.dataset.id; renderRep(); A.click(); });
    renderRep(); show('oReport');
  }
  function setSpeed(v) { rep.speed = Math.max(0, Math.min(30, Math.round(v * 10) / 10)); renderRep(); }
  function renderRep() {
    $('repClasses').querySelectorAll('.chip').forEach(ch => ch.classList.toggle('on', ch.dataset.id === rep.cls));
    const cls = rep.cls && D.byId[rep.cls], bio = cls && cls.type === 'bio';
    $('repSpeedRow').style.display = bio ? 'none' : '';
    $('spOut').textContent = rep.speed.toFixed(1) + ' kn'; $('spRange').value = rep.speed;
    const calc = $('calc'); calc.innerHTML = '';
    if (!cls) { calc.textContent = 'Pick a class to see speed calculations from your cursors.'; }
    else if (!bio) {
      const add = (txt, v) => { const d = document.createElement('div'); d.innerHTML = `<span>${txt}</span>`; const b = document.createElement('button'); b.textContent = `use ${v.toFixed(1)} kn`; b.onclick = () => { setSpeed(v); A.click(); tutCheck(); }; d.appendChild(b); calc.appendChild(d); };
      if (G.dmF) add(`DEMON shaft ${G.dmF.toFixed(2)} Hz x 60 = ${Math.round(G.dmF * 60)} RPM / TPK ${cls.tpk}`, G.dmF * 60 / cls.tpk);
      if (G.loF) add(`LOFAR blade line ${G.loF.toFixed(2)} Hz / ${cls.blades} blades x 60 = ${Math.round(G.loF / cls.blades * 60)} RPM / TPK ${cls.tpk}`, G.loF / cls.blades * 60 / cls.tpk);
      if (!G.dmF && !G.loF) calc.textContent = 'Place a DEMON or LOFAR cursor to compute speed.';
    }
    $('repSend').disabled = !rep.cls;
  }
  $('spMinus').onclick = () => setSpeed(rep.speed - 0.5);
  $('spPlus').onclick = () => setSpeed(rep.speed + 0.5);
  $('spRange').oninput = e => setSpeed(+e.target.value);
  $('repCancel').onclick = () => hide('oReport');
  $('repSend').onclick = () => {
    if (!rep.cls) return;
    hide('oReport');
    const cls = D.byId[rep.cls];
    const r = S.score(G.sim, { brg: G.sim.steer, cls: rep.cls, speed: cls.type === 'bio' ? null : rep.speed });
    G.watchPts += r.points;
    let html;
    if (r.falseContact) {
      G.falseReports++; A.bad();
      html = `<h2 class="bad">No contact</h2><p>Nothing holds on bearing ${fmtB(G.sim.steer)}. The OOD is not impressed. <b class="bad">-25</b></p>`;
    } else {
      const c = r.contact; c.reported = { rep: { ...rep, brg: G.sim.steer }, r };
      c.tag = 'S' + (G.sim.contacts.filter(o => o.reported).length);
      G.results.push(c);
      r.classOK ? A.good() : A.bad();
      const sp = c.cls.type === 'bio' ? '' : `<p>Speed: you said ${rep.speed.toFixed(1)} kn, actual ${c.speed.toFixed(1)} kn ${r.speedPts === 50 ? '<b class="good">+50</b>' : r.speedPts ? '<b class="meh">+20</b>' : '<b class="bad">+0</b>'}</p>`;
      html = `<h2 class="${r.classOK ? 'good' : 'bad'}">${c.tag}: ${r.classOK ? 'Classified' : 'Misclassified'}</h2>
        <p>You reported <b>${cls.short}</b>. It is ${r.classOK ? '' : '<b>'}${c.cls.name}${r.classOK ? '' : '</b>'}. ${r.classOK ? '<b class="good">+100</b>' : ''}</p>${sp}
        ${r.flagErr ? '<p class="bad">You called a Red boat friendly or neutral. -50</p>' : ''}
        ${r.blueOnRed ? '<p class="bad">You called a non-hostile contact Red. Blue on blue is how accidents start. -30</p>' : ''}
        <p class="why">${r.truth}</p>`;
    }
    $('resBody').innerHTML = html; show('oResult');
    updHud(); draw(); tutCheck();
  };

  // ---------------- tutorial (watch 1) ----------------
  const TUT = [
    { t: 'The top display is BROADBAND: bearing across (our bow in the centre), time flowing down. The bright streak is a ship. <b>Tap the streak</b> to steer your listening beam onto it.',
      ok: () => G.sim.contacts.some(c => Math.abs(S.angDiff(G.sim.steer, S.contactBearing(c, G.sim.t))) <= 4) },
    { t: 'On the beam. (Headphones: that slow thrum is its propeller.) The LOFAR shows machinery as vertical lines. <b>Drag on the LOFAR</b> to put the harmonic cursor on the bright line near 60 Hz.',
      ok: () => G.loF && (Math.abs(G.loF - 60) < 1.5 || Math.abs(G.loF - 50) < 1.5) },
    { t: 'Its harmonics fall on 120 and 180 Hz: a <b>60 Hz</b> electrical plant. Now the DEMON shows the propeller rhythm. <b>Drag the DEMON cursor onto the small line at the far left</b> (the shaft rate): its numbered ticks should land on every taller line.',
      ok: () => { const c = G.sim.contacts[0], fs = S.shaftHz(c.cls, c.speed); return G.dmF && Math.abs(G.dmF - fs) / fs < 0.06; } },
    { t: 'The tallest line sits on tick <b>5</b>: five blades. Shaft rate x 60 = RPM. Now open the <b>BOOK</b> and look for a 60 Hz ship with 5 blades.',
      ok: () => G.bookOpened },
    { t: 'Press <b>REPORT</b>, pick the class, then tap <b>use</b> on the DEMON line to turn RPM into knots with the book\'s turns-per-knot. File it.',
      ok: () => G.results.length > 0 }
  ];
  function tutShow() {
    if (G.tut < 0 || G.tut >= TUT.length) { $('tut').hidden = true; return; }
    $('tutText').innerHTML = TUT[G.tut].t; $('tut').hidden = false;
  }
  function tutCheck() {
    if (G.tut < 0 || !G.sim) return;
    let adv = false;
    while (G.tut < TUT.length && TUT[G.tut].ok()) { G.tut++; adv = true; }
    if (adv) { if (G.tut < TUT.length) A.tick(); tutShow(); }
  }
  $('tutSkip').onclick = () => { G.tut = -1; $('tut').hidden = true; };

  // ---------------- campaign flow ----------------
  function seedFor(i) { return Q.has('seed') ? (+Q.get('seed') + i) : ((Date.now() ^ (i * 7919)) >>> 0); }
  function brief(i) {
    G.wi = i; const w = D.WATCHES[i];
    $('briefTitle').textContent = `Watch ${i + 1}: ${w.name}`;
    $('briefText').textContent = w.brief;
    $('briefMeta').textContent = `Watch length ${Math.round(w.duration / 60 * 10) / 10} min${w.clock ? ` &middot; counter-detection in ${Math.round(w.clock / 6) / 10} min` : ''}`.replace('&middot;', '\u00b7');
    updHud(); show('oBrief');
  }
  function startWatch(i) {
    const w = D.WATCHES[i];
    G.wi = i; G.sim = new S.Sim(w, seedFor(i)); G.sim.integ = G.integ;
    G.watchPts = 0; G.results = []; G.falseReports = 0; G.lost = false; G.ended = false;
    G.loF = null; G.dmF = null; G.bookOpened = false;
    // begin with the beam on our bow and a minute of history so the displays are alive
    G.sim.setSteer(0);
    const hist = 140;
    G.sim.t = -hist * S.STEP; G.sim.prime(5.5); G.sim.t = -hist * S.STEP;
    for (let k = 0; k < hist; k++) { stepOnce(true); }
    G.sim.t = 0;
    G.tut = w.tutorial && !DEMO ? 0 : -1; tutShow();
    A.build(G.sim);
    G.running = true; G.acc = 0; G.last = performance.now();
    updHud(); updROs(); draw();
  }
  function stepOnce(silent) {
    G.sim.step();
    FALL_BTR.push(rowBTR(G.sim.btr));
    if (markLO) { FALL_LO.push(null, true); FALL_DM.push(null, true); markLO = false; }
    FALL_LO.push(rowLO(G.sim.loI)); FALL_DM.push(rowDM(G.sim.dmI));
    if (!silent) A.update(G.sim);
  }
  function endWatch(why) {
    if (G.ended) return;
    G.ended = true; G.running = false; $('tut').hidden = true;
    const w = D.WATCHES[G.wi], sim = G.sim;
    const all = sim.contacts.every(c => c.reported);
    const timeBonus = all && why !== 'lost' ? Math.floor(Math.max(0, w.duration - sim.t) / 3) : 0;
    const lossPen = why === 'lost' ? -100 : 0;
    const pts = G.watchPts + timeBonus + lossPen;
    G.score += pts; G.watchPts = 0;
    G.campaign[G.wi] = { name: w.name, pts, lost: why === 'lost' };
    const rows = sim.contacts.map(c => {
      const r = c.reported && c.reported.r;
      const you = r ? `${D.byId[c.reported.rep.cls].short}${c.cls.type === 'bio' ? '' : ' @ ' + c.reported.rep.speed.toFixed(1) + ' kn'}` : '<span class="bad">missed</span>';
      const truth = `${c.cls.short}${c.cls.type === 'bio' ? (c.kind === 'fin' ? ' (fin whale)' : ' (humpback)') : ' @ ' + c.speed.toFixed(1) + ' kn'}`;
      return `<tr><td>${c.tag || '-'}</td><td>${fmtB(S.contactBearing(c, sim.t))}</td><td>${truth}</td><td>${you}</td><td class="${r ? (r.points >= 100 ? 'good' : r.points > 0 ? 'meh' : 'bad') : 'bad'}">${r ? r.points : 0}</td></tr>
        ${r && r.classOK ? '' : `<tr><td></td><td colspan="4" class="why">${S.explain(c)}</td></tr>`}`;
    }).join('');
    const title = why === 'lost' ? '<h2 class="torp">WATCH LOST</h2><p>The Red boat heard us first. The torpedo was a war-game simulation shot, and the umpire is unforgiving: <b class="bad">-100</b>.</p>'
      : `<h2>Watch ${G.wi + 1} debrief: ${w.name}</h2>`;
    $('debBody').innerHTML = `${title}<table class="deb"><tr><th>tag</th><th>brg</th><th>truth</th><th>your report</th><th>pts</th></tr>${rows}</table>
      <p>${G.falseReports ? `False reports: ${G.falseReports} (-${25 * G.falseReports}). ` : ''}${timeBonus ? `Time bonus +${timeBonus}. ` : ''}Watch total <b>${pts}</b> &middot; patrol score <b>${G.score}</b></p>`;
    const row = $('debRow'); row.innerHTML = '';
    const mk = (txt, fn, ghost) => { const b = document.createElement('button'); b.className = 'big' + (ghost ? ' ghost' : ''); b.textContent = txt; b.onclick = fn; row.appendChild(b); };
    mk('RETRY WATCH', () => { G.score -= pts; hide('oDebrief'); startWatchFlow(G.wi); }, true);
    if (G.wi + 1 < D.WATCHES.length) mk('NEXT WATCH', () => { hide('oDebrief'); brief(G.wi + 1); });
    else mk('END PATROL', () => { hide('oDebrief'); final(); });
    A.stopContacts();
    updHud();
    show('oDebrief');
  }
  function startWatchFlow(i) { brief(i); }
  function final() {
    const ranks = [[0, 'Sonar trainee'], [400, 'Sonar Technician 3rd class'], [900, 'Sonar Technician 1st class'], [1400, 'Sonar Supervisor'], [1800, 'Acoustic Intelligence Specialist'], [2200, 'Golden Ears']];
    const rank = ranks.filter(r => G.score >= r[0]).pop()[1];
    let best = 0; try { best = +localStorage.getItem('bladeRateBest') || 0; if (G.score > best) localStorage.setItem('bladeRateBest', String(G.score)); } catch (e) { /* private mode */ }
    $('finBody').innerHTML = `<h2>Patrol complete</h2><p>Score <b class="good">${G.score}</b> &middot; ${rank}${best && G.score <= best ? ` &middot; best ${best}` : G.score > best ? ' &middot; new best' : ''}</p>
      <table class="deb">${G.campaign.map((c, i) => c ? `<tr><td>${i + 1}</td><td>${c.name}</td><td class="${c.lost ? 'bad' : 'good'}">${c.lost ? 'lost' : 'held'}</td><td>${c.pts}</td></tr>` : '').join('')}</table>
      <h2>What was real</h2>
      <p class="why">LOFAR and DEMON are the two classic passive-sonar processing chains. DEMON really is "detection of envelope modulation on noise": bandpass the cavitation hiss, take its envelope, FFT it, read shaft rate and blade rate.</p>
      <p class="why">Soviet and Russian submarines ran 50 Hz electrical plants and US boats 60 Hz, so the plant line was a famous national tell. Speeds really are estimated from turn counts and turns-per-knot.</p>
      <p class="why">Cold-war SOSUS operators learned that fin whales pulse near 20 Hz, right where machinery lives; the downward sweep gives them away. Submarines really do hide in merchant ships' noise, and steering slightly off the merchant helps.</p>
      <p class="why">Ship classes here are fictional composites; the numbers are plausible, not intelligence.</p>`;
    show('oFinal');
  }

  // ---------------- torpedo ----------------
  function torpedo() {
    G.running = false;
    const red = G.sim.contacts.find(c => c.cls.flag === 'Red' && !c.reported);
    A.torpedo();
    toast(`TRANSIENT, TRANSIENT! TORPEDO IN THE WATER, BEARING ${fmtB(S.contactBearing(red, G.sim.t))}!`, 3200);
    $('flash').classList.add('on'); setTimeout(() => $('flash').classList.remove('on'), 500);
    if (!RM) { $('stack').classList.add('shake'); setTimeout(() => $('stack').classList.remove('shake'), 1400); }
    setTimeout(() => endWatch('lost'), 3300);
  }

  // ---------------- main loop ----------------
  function frame(now) {
    const dt = Math.min(0.25, (now - G.last) / 1000); G.last = now;
    if (G.running && !G.paused) {
      G.acc += dt;
      let stepped = false;
      while (G.acc >= S.STEP) { G.acc -= S.STEP; stepOnce(false); stepped = true; }
      if (stepped) afterStep();
    }
    requestAnimationFrame(frame);
  }
  function afterStep() {
    const w = D.WATCHES[G.wi];
    draw(); updHud();
    if (w.clock && G.sim.t >= w.clock && G.sim.contacts.some(c => c.cls.flag === 'Red' && !c.reported)) torpedo();
    else if (G.sim.t >= w.duration) endWatch('time');
    else if (G.sim.contacts.every(c => c.reported) && isPausingFree()) endWatch('all');
    tutCheck();
  }
  function isPausingFree() { return !isPausing(); }

  // ---------------- audio ----------------
  const A = (function () {
    let ac = null, master = null, out = null, noiseBuf = null, nodes = [], amb = null, muted = false, duckG = null;
    function ensure() {
      if (ac) return true;
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return false;
      try { ac = new AC(); } catch (e) { return false; }
      out = ac.createDynamicsCompressor(); out.connect(ac.destination);
      master = ac.createGain(); master.gain.value = muted ? 0 : 0.7; master.connect(out);
      duckG = ac.createGain(); duckG.gain.value = 1; duckG.connect(master);
      noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
      const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      // ambient sea
      const n = ac.createBufferSource(); n.buffer = noiseBuf; n.loop = true;
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700;
      amb = ac.createGain(); amb.gain.value = 0.06; n.connect(lp).connect(amb).connect(duckG); n.start();
      return true;
    }
    function unlock() { const fresh = !ac; if (ensure() && ac.state === 'suspended') ac.resume(); if (fresh && G.sim && G.running) build(G.sim); }
    function noiseSrc() { const s = ac.createBufferSource(); s.buffer = noiseBuf; s.loop = true; s.start(0, Math.random() * 1.9); return s; }
    function stopContacts() { nodes.forEach(n => { try { n.stop.forEach(s => s.stop()); n.bus.disconnect(); } catch (e) { /* already stopped */ } }); nodes = []; }
    function build(sim) {
      if (!ac) return; stopContacts(); // audio only after a user gesture (unlock)
      sim.contacts.forEach(c => {
        const bus = ac.createGain(); bus.gain.value = 0; bus.connect(duckG);
        const stop = [], node = { c, bus, stop, bio: null };
        if (c.cls.type === 'bio') {
          const o = ac.createOscillator(); o.type = 'triangle'; const g = ac.createGain(); g.gain.value = 0;
          o.connect(g).connect(bus); o.start(); stop.push(o); node.bio = { o, g, next: 0 };
        } else {
          if (c.cls.cav) { // cavitation hiss modulated by the propeller (PeriodicWave at shaft rate)
            const src = noiseSrc(), bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1500; bp.Q.value = 0.7;
            const vca = ac.createGain(); vca.gain.value = 0.55 * c.cls.cav;
            const shaftHz = S.shaftHz(c.cls, c.speed), nH = c.cls.blades * 3 + 1;
            const re = new Float32Array(nH + 1), im = new Float32Array(nH + 1);
            re[1] = 0.22; [0.5, 0.26, 0.13].forEach((a, k) => { if (c.cls.blades * (k + 1) <= nH) re[c.cls.blades * (k + 1)] = a; });
            const wave = ac.createPeriodicWave(re, im, { disableNormalization: true });
            const shafts = c.cls.shafts === 2 ? [shaftHz, shaftHz * 1.03] : [shaftHz];
            shafts.forEach(f => {
              const mod = ac.createOscillator(); mod.setPeriodicWave(wave); mod.frequency.value = f;
              const depth = ac.createGain(); depth.gain.value = 0.55 * c.cls.cav * 0.9 / shafts.length;
              mod.connect(depth).connect(vca.gain); mod.start(); stop.push(mod);
            });
            src.connect(bp).connect(vca).connect(bus); stop.push(src);
          }
          // machinery hum: the strongest lines (audible on headphones)
          c.lines.filter(l => l.f > 25).forEach(l => {
            const o = ac.createOscillator(); o.frequency.value = l.f; const g = ac.createGain(); g.gain.value = l.a * 0.35;
            o.connect(g).connect(bus); o.start(); stop.push(o);
          });
          // low rumble of broadband machinery
          const src = noiseSrc(), lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220;
          const g = ac.createGain(); g.gain.value = 0.25 * c.cls.bb; src.connect(lp).connect(g).connect(bus); stop.push(src);
        }
        nodes.push(node);
      });
      update(sim);
    }
    function update(sim) {
      if (!ac) return;
      const now = ac.currentTime;
      nodes.forEach(n => {
        const g = S.beamGain(sim.steer, S.contactBearing(n.c, sim.t)) * n.c.lvl;
        n.bus.gain.setTargetAtTime(g * g, now, 0.15);
        if (n.bio) { // schedule whale calls from the same event list the sim uses
          const ev = n.c.events;
          while (n.bio.next < ev.length && ev[n.bio.next].t0 < sim.t + 1) {
            const e = ev[n.bio.next++]; if (e.t0 + e.d < sim.t) continue;
            const st = now + Math.max(0, e.t0 - sim.t), fin = n.c.kind === 'fin';
            const mul = fin ? 2 : 1; // fin whales are below most speakers: play the 2nd harmonic
            n.bio.o.frequency.setValueAtTime(e.f0 * mul, st); n.bio.o.frequency.linearRampToValueAtTime(e.f1 * mul, st + e.d);
            n.bio.g.gain.setValueAtTime(0, st); n.bio.g.gain.linearRampToValueAtTime(fin ? 0.5 : 0.25, st + e.d * 0.3);
            n.bio.g.gain.linearRampToValueAtTime(0, st + e.d);
          }
        }
      });
    }
    function steer() { blip(880, 0.03, 0.05); }
    // (all innerHTML in this file is built from the static book/watch data and numbers, never from user input)
    function blip(f, dur, vol, type) {
      if (!ac) return; const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime;
      o.type = type || 'sine'; o.frequency.value = f; g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.02);
    }
    function good() { if (!ac) return; blip(660, 0.12, 0.12); setTimeout(() => blip(990, 0.18, 0.12), 110); }
    function bad() { if (!ac) return; blip(220, 0.25, 0.14, 'square'); }
    function click() { blip(1200, 0.02, 0.04); }
    function tick() { blip(1320, 0.06, 0.06); }
    function torpedo() {
      if (!ac) return; const t = ac.currentTime;
      // high-speed screws: whine with fast amplitude modulation, rising doppler
      const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(900, t); o.frequency.linearRampToValueAtTime(1500, t + 3);
      const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 3;
      const vca = ac.createGain(); vca.gain.value = 0.18;
      const lfo = ac.createOscillator(); lfo.frequency.value = 55; const lg = ac.createGain(); lg.gain.value = 0.12; lfo.connect(lg).connect(vca.gain);
      const env = ac.createGain(); env.gain.setValueAtTime(0.0001, t); env.gain.exponentialRampToValueAtTime(1, t + 2.5); env.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
      o.connect(bp).connect(vca).connect(env).connect(master); o.start(t); lfo.start(t); o.stop(t + 3.3); lfo.stop(t + 3.3);
      for (let k = 0; k < 4; k++) blip(740, 0.18, 0.12, 'square'), setTimeout(() => blip(740, 0.18, 0.12, 'square'), k * 380);
    }
    function mute(m) { muted = m; if (master) master.gain.setTargetAtTime(m ? 0 : 0.7, ac.currentTime, 0.05); }
    function duck(p) { if (duckG) duckG.gain.setTargetAtTime(p ? 0.25 : 1, ac.currentTime, 0.1); }
    return { unlock, build, update, steer, good, bad, click, tick, torpedo, mute, duck, stopContacts };
  })();

  // ---------------- title art: a little live DEMON-style waterfall ----------------
  function titleArt() {
    const c = $('cTitle'), x = c.getContext('2d'), W = c.width, H = c.height;
    const sim = new S.Sim(D.WATCHES[0], 4); const ct = sim.contacts[0]; sim.setSteer(ct.brg0); sim.integ = 4; sim.prime(5.5);
    const f = new Fall(S.LO_BINS, 60);
    for (let i = 0; i < 60; i++) { sim.step(); f.push(rowLO(sim.loI)); }
    let last = 0;
    function tick(now) {
      if (!$('oTitle').hidden) {
        if (now - last > 500 && !RM) { last = now; sim.step(); f.push(rowLO(sim.loI)); }
        x.imageSmoothingEnabled = true; x.drawImage(f.c, 0, 0, S.LO_BINS * 0.5, 60, 0, 0, W, H);
        requestAnimationFrame(tick);
      }
    }
    requestAnimationFrame(tick);
  }

  // ---------------- boot ----------------
  function boot() {
    try { const b = +localStorage.getItem('bladeRateBest'); if (b) $('best').textContent = `Best patrol: ${b}`; } catch (e) { /* ignore */ }
    resize(); titleArt();
    $('bStart').onclick = () => { A.unlock(); hide('oTitle'); G.score = 0; G.campaign = []; brief(Q.has('watch') ? Math.max(0, Math.min(4, +Q.get('watch') - 1)) : 0); };
    $('bHow').onclick = () => show('oHelp');
    $('bGo').onclick = () => { A.unlock(); hide('oBrief'); startWatch(G.wi); G.paused = isPausing(); };
    $('bAgain').onclick = () => { hide('oFinal'); G.score = 0; G.campaign = []; brief(0); };
    requestAnimationFrame(t => { G.last = t; requestAnimationFrame(frame); });
    if (DEMO) {
      hide('oTitle');
      const wi = Q.has('watch') ? +Q.get('watch') - 1 : 0;
      G.integ = 16; startWatch(wi);
      const c = G.sim.contacts[0];
      G.sim.setSteer(Math.round(c.brg0)); markLO = true;
      for (let k = 0; k < 90; k++) stepOnce(true);
      G.loF = snap(G.sim.loI, 60, S.LO_RES, 3); G.dmF = snap(G.sim.dmI, S.shaftHz(c.cls, c.speed), S.DM_RES, 1);
      G.paused = false; updROs(); updHud(); draw();
      if (Q.has('report')) { openReport(); rep.cls = c.cls.id; renderRep(); }
      if (Q.has('dbg')) { const r = cv.btr.getBoundingClientRect(); document.body.setAttribute('data-dbg', JSON.stringify({ vw: innerWidth, vh: innerHeight, btr: [r.left, r.width, cv.btr.width], steer: G.sim.steer, x: xOfBrg(G.sim.steer, cv.btr.width) })); }
    }
  }
  boot();

  // ---------------- ?selftest : drives the whole UI flow headlessly ----------------
  if (Q.has('selftest')) {
    const log = [], ok = (n, c) => log.push((c ? 'PASS ' : 'FAIL ') + n);
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const click = id => $(id).click();
    const sleepStep = n => { for (let k = 0; k < n && G.running; k++) { stepOnce(true); afterStep(); } };
    (async () => {
      try {
        click('bStart'); ok('brief shown', !$('oBrief').hidden);
        for (let wi = 0; wi < D.WATCHES.length; wi++) {
          const w = D.WATCHES[wi];
          if (wi > 0) { $('debRow').lastChild.click(); }
          click('bGo'); ok('watch ' + (wi + 1) + ' running', G.running && G.sim);
          if (wi === 3) { // test torpedo / lost path: just run the clock out
            let n = 0; while (G.running && n++ < 5000) { stepOnce(true); afterStep(); }
            await wait(3600); ok('watch 4 lost path -> debrief', !$('oDebrief').hidden && /WATCH LOST|debrief/.test($('debBody').textContent));
            continue;
          }
          const cts = G.sim.contacts.slice();
          for (const c of cts) {
            sleepStep(3);
            G.sim.setSteer(Math.round(S.contactBearing(c, G.sim.t))); markLO = true; G.integ = 16; G.sim.integ = 16;
            sleepStep(60);
            G.loF = snap(G.sim.loI, c.lines && c.lines[0] ? c.lines[0].f : 60, S.LO_RES, 3);
            G.dmF = c.cls.type === 'bio' ? null : snap(G.sim.dmI, S.shaftHz(c.cls, c.speed), S.DM_RES, 1);
            click('bReport'); ok('report opens', !$('oReport').hidden);
            $('repClasses').querySelector('[data-id="' + c.cls.id + '"]').click();
            if (c.cls.type !== 'bio') { const b = $('calc').querySelector('button'); if (b) b.click(); }
            ok('file enabled', !$('repSend').disabled);
            click('repSend'); ok('result shown', !$('oResult').hidden && /Classified|Misclassified|No contact/.test($('resBody').textContent));
            $('oResult').querySelector('.close').click();
            ok('resumed', !isPausing() || G.ended);
          }
          let n = 0; while (G.running && n++ < 5000) { sleepStep(1); }
          ok('watch ' + (wi + 1) + ' ended -> debrief', !$('oDebrief').hidden);
          ok('score finite', Number.isFinite(G.score));
        }
        click('bSecure'); // not running: harmless
        $('debRow').lastChild.click(); // next / end patrol
        ok('final or brief shown', !$('oFinal').hidden || !$('oBrief').hidden);
      } catch (e) { log.push('EXCEPTION ' + e.message + ' ' + (e.stack || '').split('|')[1]); }
      document.body.setAttribute('data-selftest', log.join(' | ') + ' || score=' + G.score);
    })();
  }
})();
