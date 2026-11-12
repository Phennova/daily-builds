// HOOT - game UI. Taps on the ring build loops; everything shown is derived from HOOT.analyze / HOOT.evaluate.
(function () {
  'use strict';
  const H = window.HOOT, A = window.HOOTAUDIO, N = H.N, LV = H.LEVELS;
  const COLORS = ['#e8b04a', '#6fc3d6', '#d86f8a', '#9ad66f', '#b48be8'];
  const $ = id => document.getElementById(id);
  const Q = new URLSearchParams(location.search);
  const reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const store = {
    get() { try { return JSON.parse(localStorage.getItem('hoot.stars') || '{}'); } catch (e) { return {}; } },
    set(o) { try { localStorage.setItem('hoot.stars', JSON.stringify(o)); } catch (e) {} }
  };
  const S = { li: 0, lv: null, layout: [], sel: 0, hints: true, playing: -1, tuneStart: 0, tune: null, previewNote: -1, previewUntil: 0, ev: null, busy: false };
  let screen = 'title';

  function show(name) {
    screen = name;
    for (const id of ['title', 'select', 'game']) $(id).classList.toggle('hidden', id !== name);
    if (name === 'select') buildSelect();
  }
  function modal(html, wire) {
    $('modalCard').innerHTML = html; $('modal').classList.remove('hidden');
    if (wire) wire($('modalCard'));
  }
  const closeModal = () => $('modal').classList.add('hidden');
  let toastT = 0;
  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2200);
  }

  // ---------- level select ----------
  function unlocked(i) { const st = store.get(); return Q.has('all') || i === 0 || (st[LV[i - 1].id] || 0) >= 1; }
  function buildSelect() {
    const st = store.get(), box = $('levels'); box.innerHTML = '';
    LV.forEach((l, i) => {
      const b = document.createElement('button'); b.className = 'lvl' + (unlocked(i) ? '' : ' locked');
      const s = st[l.id] || 0;
      b.innerHTML = '<b>' + l.id + '. ' + l.name + '</b><span class="st">' + '\u2605'.repeat(s) + '\u2606'.repeat(3 - s) + '</span><small>' + l.notes.map(n => n.name).join(' ') + '</small>';
      b.onclick = () => { A.init(); if (unlocked(i)) startLevel(i); else toast2('Earn a star on program ' + LV[i - 1].id + ' first.'); };
      box.appendChild(b);
    });
  }
  function toast2(m) { show('select'); const p = document.createElement('p'); p.className = 'fine pad'; p.textContent = m; $('levels').appendChild(p); }

  // ---------- level flow ----------
  function startLevel(i, prefill) {
    A.stop();
    S.li = i; S.lv = LV[i]; S.sel = 0; S.playing = -1; S.busy = false;
    S.layout = S.lv.notes.map(() => ({ slots: [], closed: false }));
    S.hints = i < 4;
    if (prefill) prefill.forEach((o, k) => { S.layout[k] = { slots: o.slice(), closed: true }; });
    show('game'); $('lvName').textContent = S.lv.id + '. ' + S.lv.name;
    resize(); refresh();
    if (!prefill) briefing();
  }
  function briefing() {
    const l = S.lv;
    modal('<h3>' + l.id + '. ' + l.name + '</h3><p>' + l.brief + '</p>' +
      '<p class="fine">Tap a free word to place a HOOT. Tap the first word again to close the loop. Tap a card to pick a note. ' +
      (l.locked.length ? 'Hatched words are taken by the tune-reader code.' : '') + '</p>' +
      '<div class="row"><button class="big" id="mOk">Begin</button></div>', c => { c.querySelector('#mOk').onclick = closeModal; });
  }
  function help() {
    modal('<h3>How it works</h3>' +
      '<p>Memory is a ring of 24 words circulating past a read head, once per revolution. An instruction can only run when its word comes round, so the <b>wait between two instructions is set by where they sit</b>.</p>' +
      '<p>Every instruction here is a HOOT: one click in the speaker. A loop of <b>k</b> clicks that takes <b>R</b> revolutions plays <b>k/R</b> times C3 (130.8 Hz). One word: C3. A diameter: C4. A triangle walked once: G4. The same triangle walked in hops of 16 (two turns): G3.</p>' +
      '<p>Uneven gaps make a note wobble (jitter, in words). Notes cannot share words. Put every note of the tune in tune (within 20 cents) and then play it.</p>' +
      '<div class="row"><button class="big" id="mOk">Got it</button></div>', c => { c.querySelector('#mOk').onclick = closeModal; });
  }

  // ---------- editing ----------
  function ownerOf(s) { return S.layout.findIndex(l => l.slots.includes(s)); }
  function tapSlot(s) {
    if (S.busy) return;
    const lv = S.lv, cur = S.layout[S.sel];
    if (lv.locked.includes(s)) { toast('Word ' + s + ' holds the tune-reader code.'); A.tick(0.6); return; }
    const o = ownerOf(s);
    if (o === S.sel) {
      if (!cur.closed && s === cur.slots[0]) { cur.closed = true; afterClose(); }
      else toast(cur.closed ? 'Loop is closed. Undo or Clear to change it.' : 'Word ' + s + ' is already in this loop.');
    } else if (o >= 0) { S.sel = o; A.tick(1.3); }
    else if (cur.closed) toast('Loop is closed. Undo or Clear to change it.');
    else { cur.slots.push(s); A.tick(1 + cur.slots.length * 0.06); }
    refresh();
  }
  function afterClose() {
    const a = H.analyze(S.layout[S.sel].slots);
    S.previewNote = S.sel; S.previewUntil = performance.now() + 1500;
    A.previewLoop(S.layout[S.sel].slots, 1500);
    // advance selection to the next empty note
    const nx = S.layout.findIndex((l, i) => !l.closed && i !== S.sel);
    if (nx >= 0) setTimeout(() => { if (S.layout[S.sel].closed && !S.busy) { S.sel = nx; refresh(); } }, 1600);
    return a;
  }
  function undo() {
    if (S.busy) return; const cur = S.layout[S.sel];
    if (cur.closed) cur.closed = false; else cur.slots.pop();
    A.stop(); refresh();
  }
  function clearNote() { if (S.busy) return; S.layout[S.sel] = { slots: [], closed: false }; A.stop(); refresh(); }
  function playNote() {
    const cur = S.layout[S.sel]; if (!cur.slots.length) { toast('Place a HOOT first.'); return; }
    S.previewNote = S.sel; S.previewUntil = performance.now() + 1800; A.previewLoop(cur.slots, 1800);
  }
  function playTune() {
    if (S.busy || !S.ev || !S.ev.done) return;
    S.busy = true; closeModal();
    const fin = S.li === LV.length - 1;
    const r = A.playTune(S.lv, S.layout, fin, () => { S.playing = -1; S.busy = false; if (fin) closeModal(); results(); });
    S.tune = r; S.tuneStart = performance.now();
    if (fin) acetateModal();
    refresh();
  }

  // ---------- results ----------
  function results() {
    const ev = S.ev, lv = S.lv; if (!ev.done) return;
    const st = store.get(); st[lv.id] = Math.max(st[lv.id] || 0, ev.stars); store.set(st);
    const next = S.li < LV.length - 1;
    const lines = [['In tune', 'all ' + lv.notes.length + ' notes (\u00b1' + H.TOL + ' cents)'],
      ['Worst wobble', ev.maxJ + ' word' + (ev.maxJ === 1 ? '' : 's') + ' (par ' + lv.par.maxJ + ')'],
      ['Total wobble', ev.sumJ + ' (par ' + lv.par.sumJ + ')'], ['Words left free', ev.free]];
    modal('<h3>' + (S.li === LV.length - 1 ? 'Cut to acetate' : 'Program accepted') + '</h3><div class="stars">' + '\u2605'.repeat(ev.stars) + '\u2606'.repeat(3 - ev.stars) + '</div>' +
      '<table>' + lines.map(r => '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td></tr>').join('') + '</table>' +
      '<p class="fine">' + (ev.stars === 3 ? 'The solver cannot do better: par is the proven minimum.' : 'Par is the solver\'s proven minimum. Can you find the packing that reaches it?') + '</p>' +
      (S.li === LV.length - 1 ? '<p class="fine">In 1951 the BBC cut the Ferranti Mark 1 playing to acetate, and the disc was later found to run at the wrong speed. Yours wobbles on purpose.</p>' : '') +
      '<div class="row">' + (next ? '<button class="big" id="rN">Next program</button>' : '') + '<button id="rR">Again</button><button id="rM">Programs</button></div>', c => {
      if (next) c.querySelector('#rN').onclick = () => { closeModal(); startLevel(S.li + 1); };
      c.querySelector('#rR').onclick = () => { closeModal(); refresh(); };
      c.querySelector('#rM').onclick = () => { closeModal(); show('select'); };
    });
  }
  let discRaf = 0;
  function acetateModal() {
    modal('<h3>Cutting to acetate&hellip;</h3><canvas id="disc" class="disc" width="260" height="260"></canvas><p class="fine" style="text-align:center">78 rpm, a little off.</p>', c => {
      const cv = c.querySelector('#disc'), g = cv.getContext('2d'); let a = 0;
      cancelAnimationFrame(discRaf);
      (function loop() {
        if ($('modal').classList.contains('hidden') || !document.getElementById('disc')) return;
        a += reduced ? 0 : 0.045 * (1 + 0.03 * Math.sin(performance.now() / 700));
        g.clearRect(0, 0, 260, 260); g.translate(130, 130);
        g.fillStyle = '#0b0a08'; g.beginPath(); g.arc(0, 0, 124, 0, 7); g.fill();
        g.strokeStyle = '#2a2620'; for (let r = 40; r < 122; r += 3.5) { g.beginPath(); g.arc(0, 0, r, 0, 7); g.stroke(); }
        g.save(); g.rotate(a); g.fillStyle = '#c9a24a'; g.beginPath(); g.arc(0, 0, 34, 0, 7); g.fill();
        g.fillStyle = '#14110d'; g.fillRect(-2, -34, 4, 12); g.beginPath(); g.arc(0, 0, 4, 0, 7); g.fill();
        g.strokeStyle = '#ffffff22'; g.lineWidth = 6; g.beginPath(); g.arc(0, 0, 80, a * 0 - 0.4, 0.4); g.stroke(); g.restore();
        g.strokeStyle = '#b8c4cc'; g.lineWidth = 4; g.beginPath(); g.moveTo(120, -120); g.lineTo(S.tune ? 70 - 40 * Math.min(1, (performance.now() - S.tuneStart) / (S.tune.dur * 1000)) : 70, -4); g.stroke();
        g.setTransform(1, 0, 0, 1, 0, 0);
        discRaf = requestAnimationFrame(loop);
      })();
    });
  }

  // ---------- state refresh / cards ----------
  function refresh() {
    S.ev = H.evaluate(S.lv, S.layout);
    const ev = S.ev;
    $('btnTune').disabled = !ev.done || S.busy;
    $('btnHint').classList.toggle('on', S.hints);
    const box = $('cards'); box.innerHTML = '';
    ev.notes.forEach((n, i) => {
      const l = S.layout[i], d = document.createElement('div');
      d.className = 'nc' + (i === S.sel ? ' sel' : '') + (i === S.playing ? ' playing' : ''); d.style.borderLeftColor = COLORS[i];
      const a = l.slots.length ? H.analyze(l.slots) : null;
      let body;
      if (!a) body = '<span class="r">empty</span>';
      else {
        const c = H.cents(a.f, n.target), ok = Math.abs(c) <= (S.lv.tol || H.TOL);
        const pos = Math.max(0, Math.min(100, 50 + c / 100 * 100 * 0.5));
        body = '<span class="r">' + (l.closed ? '' : 'open \u00b7 ') + a.k + ' HOOT' + (a.k > 1 ? 's' : '') + ' in ' + a.R + ' turn' + (a.R > 1 ? 's' : '') + '</span><br>' +
          '<b>' + a.ratio[0] + '/' + a.ratio[1] + '</b> \u00b7 ' + a.f.toFixed(1) + ' Hz<br>' +
          '<span class="' + (ok ? 'good' : 'badc') + '">' + (c >= 0 ? '+' : '') + c.toFixed(0) + ' c</span> \u00b7 wobble ' + a.jitter +
          '<div class="needle"><u></u><i style="left:' + pos + '%"></i></div>';
      }
      d.innerHTML = '<b style="color:' + COLORS[i] + '">' + n.name + '</b> <span class="r">' + n.target.toFixed(1) + ' Hz</span><br>' + body;
      d.onclick = () => { if (!S.busy) { S.sel = i; A.tick(1.3); refresh(); } };
      box.appendChild(d);
    });
    const a = S.layout[S.sel].slots.length ? H.analyze(S.layout[S.sel].slots) : null;
    $('scopeCap').textContent = a ? 'scope: ' + a.k + ' clicks over ' + a.R + ' turn' + (a.R > 1 ? 's' : '') + (a.k > 1 ? ', gaps ' + a.gaps.join('-') + ' words' : '') :
      'scope: select a word to start a loop';
    if (ev.done && !S.busy) toast('All notes in tune. Play the tune!');
    else if (ev.clash) toast('Two notes share a word.');
  }

  // ---------- drawing ----------
  const ring = $('ring'), scope = $('scope');
  let RW = 0, scW = 0, DPR = 1;
  function resize() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    const r = ring.getBoundingClientRect(); RW = Math.max(100, r.width);
    ring.width = Math.round(RW * DPR); ring.height = Math.round(RW * DPR);
    const s = scope.getBoundingClientRect(); scW = Math.max(100, s.width);
    scope.width = Math.round(scW * DPR); scope.height = Math.round(64 * DPR);
  }
  window.addEventListener('resize', () => { if (screen === 'game') resize(); });
  const ang = s => (s / N) * Math.PI * 2 - Math.PI / 2;
  function pos(s, rad) { const a = ang(s), c = RW / 2; return [c + Math.cos(a) * rad, c + Math.sin(a) * rad]; }

  function headSlot(now) { return reduced ? 0 : (now / 1000 * 0.35 * N) % N; }

  function drawRing(now) {
    const g = ring.getContext('2d'); g.setTransform(DPR, 0, 0, DPR, 0, 0); g.clearRect(0, 0, RW, RW);
    const R = RW * 0.38, sr = RW * 0.043, c = RW / 2, lv = S.lv;
    // tube
    g.strokeStyle = '#2b3338'; g.lineWidth = sr * 2.6; g.beginPath(); g.arc(c, c, R, 0, 7); g.stroke();
    g.strokeStyle = '#4b585f'; g.lineWidth = 1; g.beginPath(); g.arc(c, c, R + sr * 1.3, 0, 7); g.arc(c, c, R - sr * 1.3, 0, 7); g.stroke();
    const hs = headSlot(now);
    let activeNote = S.playing >= 0 ? S.playing : (now < S.previewUntil ? S.previewNote : -1);
    // chords
    S.layout.forEach((l, i) => {
      if (l.slots.length < 1) return;
      const col = COLORS[i], isSel = i === S.sel;
      g.strokeStyle = col; g.globalAlpha = isSel ? 0.95 : 0.5; g.lineWidth = isSel ? 3 : 2;
      const k = l.slots.length, a = H.analyze(l.slots);
      for (let j = 0; j < k; j++) {
        if (j === k - 1 && !l.closed) break;
        const s0 = l.slots[j], s1 = l.slots[(j + 1) % k];
        const [x0, y0] = pos(s0, R), [x1, y1] = pos(s1, R);
        if (s0 === s1) { g.beginPath(); g.arc(...pos(s0, R + sr * 2.1), sr * 0.9, 0, 7); g.stroke(); }
        else {
          g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
          // arrow head at 65%
          const t = 0.62, ax = x0 + (x1 - x0) * t, ay = y0 + (y1 - y0) * t, th = Math.atan2(y1 - y0, x1 - x0), z = sr * 0.5;
          g.beginPath(); g.moveTo(ax + Math.cos(th) * z, ay + Math.sin(th) * z); g.lineTo(ax + Math.cos(th + 2.5) * z, ay + Math.sin(th + 2.5) * z); g.lineTo(ax + Math.cos(th - 2.5) * z, ay + Math.sin(th - 2.5) * z); g.closePath(); g.fillStyle = col; g.fill();
        }
        if (isSel && (j < k - 1 || l.closed)) {
          const hp = H.hop(s0, s1), mx = (x0 + x1) / 2 + (c - (x0 + x1) / 2) * 0.0, my = (y0 + y1) / 2;
          g.globalAlpha = 1; g.fillStyle = '#000a'; g.fillRect(mx - sr * 0.6, my - sr * 0.45, sr * 1.2, sr * 0.9);
          g.fillStyle = col; g.font = (sr * 0.7) + 'px ui-monospace,Consolas,monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(hp, mx, my);
          g.globalAlpha = 0.95;
        }
      }
      g.globalAlpha = 1;
    });
    // hint ghosts
    const cur = S.layout[S.sel], hint = lv.notes[S.sel].hint;
    if (S.hints && hint && cur.slots.length && !cur.closed) {
      g.setLineDash([3, 3]); g.strokeStyle = COLORS[S.sel]; g.lineWidth = 1.5;
      H.idealSlots(hint[0], hint[1], cur.slots[0]).forEach(s => { g.beginPath(); g.arc(...pos(s, R), sr * 1.25, 0, 7); g.stroke(); });
      g.setLineDash([]);
    }
    // slots
    g.font = (sr * 0.85) + 'px ui-monospace,Consolas,monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let s = 0; s < N; s++) {
      const [x, y] = pos(s, R), o = ownerOf(s), locked = lv.locked.includes(s);
      let glow = 0;
      if (activeNote >= 0 && S.layout[activeNote] && S.layout[activeNote].slots.includes(s)) { const d = H.mod(hs - s, N); glow = d < 6 ? 1 - d / 6 : 0; }
      g.beginPath(); g.arc(x, y, sr, 0, 7);
      g.fillStyle = locked ? '#25211a' : o >= 0 ? COLORS[o] : '#0f1214'; g.fill();
      g.lineWidth = 1.5; g.strokeStyle = locked ? '#6b5a3a' : o >= 0 ? '#fff6' : '#5d6b73'; g.stroke();
      if (locked) { g.save(); g.beginPath(); g.arc(x, y, sr, 0, 7); g.clip(); g.strokeStyle = '#6b5a3a'; g.lineWidth = 1.5; for (let q = -2; q < 3; q++) { g.beginPath(); g.moveTo(x - sr + q * 5, y + sr); g.lineTo(x + sr + q * 5, y - sr); g.stroke(); } g.restore(); }
      if (glow > 0) { g.beginPath(); g.arc(x, y, sr * (1 + glow * 0.5), 0, 7); g.strokeStyle = 'rgba(255,255,255,' + glow + ')'; g.lineWidth = 3; g.stroke(); }
      g.fillStyle = o >= 0 ? '#111' : locked ? '#6b5a3a' : '#8a979e'; g.fillText(s, x, y + 0.5);
      // order number inside owner loop
      if (o >= 0) { const idx = S.layout[o].slots.indexOf(s); g.fillStyle = '#000b'; g.font = (sr * 0.6) + 'px ui-monospace,Consolas,monospace'; g.fillText(idx + 1, x + sr * 0.8, y - sr * 0.85); g.font = (sr * 0.85) + 'px ui-monospace,Consolas,monospace'; }
    }
    // head
    const [hx, hy] = pos(hs, R + sr * 1.8), [hx2, hy2] = pos(hs, R - sr * 1.8);
    g.strokeStyle = '#d9a441'; g.lineWidth = 3; g.beginPath(); g.moveTo(hx, hy); g.lineTo(hx2, hy2); g.stroke();
    // center text
    g.fillStyle = '#8d8472'; g.textAlign = 'center'; g.font = (RW * 0.034) + 'px ui-monospace,Consolas,monospace';
    g.fillText('MERCURY TANK', c, c - RW * 0.07); g.fillText('24 words \u00b7 130.8 rev/s', c, c - RW * 0.02);
    g.fillStyle = '#5f594c'; g.fillText('head shown ~370x slow', c, c + RW * 0.03);
    const a = cur.slots.length ? H.analyze(cur.slots) : null;
    g.fillStyle = COLORS[S.sel]; g.font = 'bold ' + (RW * 0.06) + 'px ui-monospace,Consolas,monospace';
    g.fillText(a ? a.ratio[0] + '/' + a.ratio[1] + ' \u00d7 C3' : '\u2014', c, c + RW * 0.11);
  }

  function drawScope(now) {
    const g = scope.getContext('2d'); g.setTransform(DPR, 0, 0, DPR, 0, 0); const W = scW, Hh = 64;
    g.clearRect(0, 0, W, Hh);
    const cur = S.layout[S.sel];
    g.strokeStyle = '#143322'; g.lineWidth = 1;
    if (!cur.slots.length) { g.beginPath(); g.moveTo(0, Hh - 10); g.lineTo(W, Hh - 10); g.stroke(); return; }
    const a = H.analyze(cur.slots), T = a.T, pad = 6, w = W - pad * 2;
    for (let r = 0; r <= a.R; r++) { const x = pad + r * N / T * w; g.beginPath(); g.moveTo(x, 4); g.lineTo(x, Hh - 4); g.stroke(); }
    // even-spacing reference
    g.fillStyle = '#2a6a45'; for (let i = 0; i < a.k; i++) g.fillRect(pad + i * T / a.k / T * w - 1, Hh - 9, 2, 6);
    let t = 0; g.strokeStyle = '#7dff9b'; g.lineWidth = 2; g.shadowColor = '#7dff9b'; g.shadowBlur = 6;
    for (let i = 0; i < a.k; i++) { const x = pad + t / T * w; g.beginPath(); g.moveTo(x, Hh - 12); g.lineTo(x, 8); g.stroke(); t += a.gaps[i]; }
    g.shadowBlur = 0;
  }

  function frame(now) {
    if (screen === 'game' && S.lv) {
      if (S.tune && S.busy) {
        const t = (now - S.tuneStart) / 1000; let p = -1;
        for (const e of S.tune.starts) if (t >= e.t0 && t < e.t1 && e.note >= 0) p = e.note;
        if (p !== S.playing) { S.playing = p; document.querySelectorAll('.nc').forEach((d, i) => d.classList.toggle('playing', i === p)); }
      }
      drawRing(now); drawScope(now);
    } else if (screen === 'title') drawTitle(now);
    requestAnimationFrame(frame);
  }
  function drawTitle(now) {
    const cv = $('titleRing'), r = cv.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1);
    if (cv.width !== Math.round(r.width * d)) { cv.width = Math.round(r.width * d); cv.height = Math.round(r.height * d); }
    const g = cv.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, r.width, r.height);
    const c = [r.width / 2, r.height / 2], R = Math.min(r.width, r.height) * 0.42, t = reduced ? 0 : now / 1000;
    const hs = (t * 0.25 * N) % N;
    const tri = [[0, 8, 16], [2, 14], [5, 11, 17, 23]];
    ['#e8b04a55', '#6fc3d655', '#d86f8a55'].forEach((col, k) => {
      g.strokeStyle = col; g.lineWidth = 2; g.beginPath();
      tri[k].forEach((s, j) => { const a = ang(s); const x = c[0] + Math.cos(a) * R, y = c[1] + Math.sin(a) * R; j ? g.lineTo(x, y) : g.moveTo(x, y); });
      g.closePath(); g.stroke();
    });
    for (let s = 0; s < N; s++) {
      const a = ang(s), x = c[0] + Math.cos(a) * R, y = c[1] + Math.sin(a) * R, dd = H.mod(hs - s, N), gl = dd < 5 ? 1 - dd / 5 : 0;
      g.beginPath(); g.arc(x, y, 7 + gl * 4, 0, 7); g.fillStyle = gl ? 'rgba(217,164,65,' + (0.25 + gl * 0.6) + ')' : '#2b3338'; g.fill();
    }
  }

  // ---------- input ----------
  ring.addEventListener('pointerdown', e => {
    e.preventDefault(); A.init();
    const r = ring.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * RW, y = (e.clientY - r.top) / r.height * RW;
    let best = -1, bd = 1e9; const R = RW * 0.38;
    for (let s = 0; s < N; s++) { const [px, py] = pos(s, R), d = Math.hypot(px - x, py - y); if (d < bd) { bd = d; best = s; } }
    if (bd < RW * 0.075) tapSlot(best);
  });
  $('btnPlay').onclick = () => { A.init(); show('select'); };
  $('btnHelp').onclick = help;
  document.querySelectorAll('[data-go]').forEach(b => b.onclick = () => show(b.dataset.go));
  $('btnMenu').onclick = () => { A.stop(); closeModal(); S.busy = false; show('select'); };
  $('btnBrief').onclick = () => briefing();
  $('btnUndo').onclick = undo; $('btnClear').onclick = clearNote; $('btnNote').onclick = () => { A.init(); playNote(); };
  $('btnTune').onclick = () => { A.init(); playTune(); };
  $('btnHint').onclick = () => { S.hints = !S.hints; refresh(); };
  function syncMute() { document.querySelectorAll('.mute').forEach(b => { b.classList.toggle('on', !A.isMuted()); b.title = A.isMuted() ? 'Sound off' : 'Sound on'; b.textContent = A.isMuted() ? '\u266a\u00d7' : '\u266a'; }); }
  document.querySelectorAll('.mute').forEach(b => b.onclick = () => { A.init(); A.setMuted(!A.isMuted()); syncMute(); });
  syncMute();
  document.addEventListener('keydown', e => {
    if (screen !== 'game') return;
    if (e.key === ' ') { e.preventDefault(); S.ev && S.ev.done ? playTune() : playNote(); }
    else if (e.key === 'u' || e.key === 'U') undo();
    else if (e.key === 'Escape') { closeModal(); }
    else if (/^[1-5]$/.test(e.key) && +e.key <= S.layout.length) { S.sel = +e.key - 1; refresh(); }
  });

  // ---------- demo / selftest ----------
  function selftest() {
    const out = []; let fail = 0; const ck = (n, ok, info) => { out.push((ok ? 'PASS ' : 'FAIL ') + n + (info ? ' ' + info : '')); if (!ok) fail++; };
    const t0 = performance.now(); A.setSilent(true);
    LV.forEach((lv, i) => {
      startLevel(i, null); closeModal();
      const sol = H.solve(lv);
      ck('L' + lv.id + ' solver', !!sol && !sol.capped, sol ? 'maxJ=' + sol.maxJ + ' sumJ=' + sol.sumJ : '');
      sol.layout.forEach((order, n) => { S.sel = n; order.forEach(s => tapSlot(s)); tapSlot(order[0]); });
      ck('L' + lv.id + ' done via taps', S.ev.done);
      ck('L' + lv.id + ' 3 stars', S.ev.stars === 3, 'stars=' + S.ev.stars);
      const r = A.renderTune(lv, S.layout, 22050, i === LV.length - 1);
      let pk = 0, nz = 0; for (const v of r.data) { if (Math.abs(v) > pk) pk = Math.abs(v); if (v) nz++; }
      ck('L' + lv.id + ' tune audio', pk > 0.2 && pk <= 1 && nz > 1000, 'peak=' + pk.toFixed(2) + ' dur=' + r.dur.toFixed(1) + 's');
      // taps on locked/ foreign slots must not break state
      if (lv.locked.length) { const before = JSON.stringify(S.layout); tapSlot(lv.locked[0]); ck('L' + lv.id + ' locked slot ignored', before === JSON.stringify(S.layout)); }
      S.busy = false; closeModal();
    });
    startLevel(0, null); closeModal(); S.sel = 0; tapSlot(5); tapSlot(5);
    ck('single HOOT = C3', S.ev.notes[0].inTune && Math.abs(S.ev.notes[0].cents) < 0.01);
    undo(); ck('undo reopens', !S.layout[0].closed);
    startLevel(4, null); closeModal();
    const rc = id => { const r = $(id).getBoundingClientRect(); return id + '=' + [r.left, r.top, r.width, r.height].map(Math.round).join(','); };
    ck('layout', true, innerWidth + 'x' + innerHeight + ' ' + ['ring', 'cards', 'scope', 'btnTune'].map(rc).join(' ') + ' scrollW=' + document.documentElement.scrollWidth + ' playScrollH=' + document.querySelector('.play').scrollHeight + '/' + document.querySelector('.play').clientHeight);
    ck('time', true, Math.round(performance.now() - t0) + 'ms');
    const pre = $('selftest'); pre.classList.remove('hidden'); pre.textContent = out.join('\n') + '\nSELFTEST ' + (fail ? 'FAILED ' + fail : 'OK');
    document.title = fail ? 'SELFTEST FAILED' : 'SELFTEST OK';
    return !fail;
  }

  if (Q.has('selftest')) { window.addEventListener('load', () => { try { selftest(); } catch (e) { $('selftest').classList.remove('hidden'); $('selftest').textContent = 'SELFTEST CRASH ' + e.stack; } }); }
  else if (Q.has('demo')) {
    window.addEventListener('load', () => {
      const i = Math.min(LV.length - 1, Math.max(0, (+Q.get('demo') || 5) - 1)); const sol = H.solve(LV[i]);
      startLevel(i, sol.layout); closeModal(); S.sel = 1; S.previewNote = 1; S.previewUntil = 1e12; refresh();
    });
  }
  requestAnimationFrame(frame);
  window.HOOTGAME = { S, tapSlot, startLevel };
})();
