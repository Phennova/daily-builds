// Night Funnel - screens, input, main loop.
(function () {
  'use strict';
  const NF = window.NF, R = window.NFR, A = window.NFA;
  const $ = id => document.getElementById(id);
  const q = new URLSearchParams(location.search);
  const DEMO = q.has('demo');
  const cv = $('cv');
  const coarse = q.has('touch') || matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  if (!coarse) document.body.classList.add('noTouch');

  let store = {};
  try { store = JSON.parse(localStorage.getItem('nightfunnel.v1') || '{}'); } catch (e) { store = {}; }
  const save = () => { try { localStorage.setItem('nightfunnel.v1', JSON.stringify(store)); } catch (e) { /* private mode */ } };
  store.best = store.best || {};

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  R.reduced = reduced;
  R.init(cv);
  addEventListener('resize', R.resize);
  addEventListener('orientationchange', () => setTimeout(R.resize, 200));

  // safe-area insets (iPhone notch / home bar) for canvas-drawn HUD text
  const sa = document.createElement('div');
  sa.style.cssText = 'position:fixed;left:0;top:0;width:0;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)';
  document.body.appendChild(sa);
  const safe = () => { const cs = getComputedStyle(sa); return { t: parseFloat(cs.paddingTop) || 0, b: parseFloat(cs.paddingBottom) || 0 }; };

  let si = safe();
  addEventListener('resize', () => { si = safe(); });
  let screen = 'title', w = null, nightIdx = 0, nvg = true, muted = !!store.muted, resultTimer = 0, acc = 0, last = 0;
  const GRADES = { A: 5, B: 4, C: 3, D: 2, F: 1 };

  // ---------- input ----------
  const keys = {};
  const touch = { roll: 0, pull: 0, fire: false, brake: false, thr: 0.6, stickId: null, ox: 0, oy: 0 };
  let kThr = 0.6;
  const invert = () => ($('invert').checked ? -1 : 1);
  $('invert').checked = !!store.invert;
  $('invert').onchange = () => { store.invert = $('invert').checked; save(); };

  addEventListener('keydown', e => {
    if (e.repeat && ['KeyP', 'Escape', 'KeyN', 'KeyM'].includes(e.code)) return;
    keys[e.code] = true;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    if (e.code === 'KeyN') toggleNvg();
    if (e.code === 'KeyM') toggleMute();
    if ((e.code === 'KeyP' || e.code === 'Escape')) { if (screen === 'play') pause(); else if (screen === 'pause') resume(); }
    if (e.code === 'Enter' && screen === 'brief') $('flyBtn').click();
  });
  addEventListener('keyup', e => { keys[e.code] = false; });
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; if (screen === 'play') pause(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && screen === 'play') pause(); });

  // virtual stick on the left 60% of the canvas (touch or mouse drag)
  cv.addEventListener('pointerdown', e => {
    if (screen !== 'play' || touch.stickId !== null) return;
    if (e.clientX > innerWidth * 0.62 && e.pointerType === 'touch') return;
    touch.stickId = e.pointerId; touch.ox = e.clientX; touch.oy = e.clientY;
    cv.setPointerCapture(e.pointerId);
    const ring = $('stickRing'); ring.style.display = 'block'; ring.style.left = e.clientX + 'px'; ring.style.top = e.clientY + 'px';
    $('stickKnob').style.transform = 'translate(0,0)';
  });
  cv.addEventListener('pointermove', e => {
    if (e.pointerId !== touch.stickId) return;
    const rad = 62, dx = e.clientX - touch.ox, dy = e.clientY - touch.oy;
    const m = Math.hypot(dx, dy), k = m > rad ? rad / m : 1;
    const nx = dx * k / rad, ny = dy * k / rad;
    const ex = v => Math.sign(v) * Math.pow(Math.abs(v), 1.5);   // fine control near the centre
    touch.roll = ex(nx); touch.pull = ex(ny) * invert();
    $('stickKnob').style.transform = 'translate(' + (nx * 40) + 'px,' + (ny * 40) + 'px)';
  });
  const endStick = e => { if (e.pointerId !== touch.stickId) return; touch.stickId = null; touch.roll = touch.pull = 0; $('stickRing').style.display = 'none'; };
  cv.addEventListener('pointerup', endStick); cv.addEventListener('pointercancel', endStick);

  function holdBtn(el, on, off) {
    el.addEventListener('pointerdown', e => { e.preventDefault(); el.setPointerCapture(e.pointerId); el.classList.add('on'); on(); });
    const up = () => { el.classList.remove('on'); off(); };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('lostpointercapture', up);
  }
  holdBtn($('fireBtn'), () => { touch.fire = true; }, () => { touch.fire = false; });
  holdBtn($('brakeBtn'), () => { touch.brake = true; }, () => { touch.brake = false; });
  const thrWrap = $('thrWrap');
  function setThr(e) { const r = thrWrap.getBoundingClientRect(); touch.thr = kThr = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height)); $('thrFill').style.height = (touch.thr * 100) + '%'; }
  let thrId = null;
  thrWrap.addEventListener('pointerdown', e => { thrId = e.pointerId; thrWrap.setPointerCapture(e.pointerId); setThr(e); });
  thrWrap.addEventListener('pointermove', e => { if (e.pointerId === thrId) setThr(e); });
  thrWrap.addEventListener('pointerup', () => { thrId = null; });

  function readInput(dt) {
    if (DEMO && w) { const b = NF.bot(w); b.hold = false; return b; }
    let roll = touch.roll, pull = touch.pull;
    const k = e => (keys[e] ? 1 : 0);
    roll += k('ArrowRight') + k('KeyD') - k('ArrowLeft') - k('KeyA');
    pull += (k('ArrowDown') + k('KeyS') - k('ArrowUp') - k('KeyW')) * invert();
    // keyboard throttle
    const dth = (k('ShiftLeft') + k('ShiftRight') + k('KeyR') - k('ControlLeft') - k('ControlRight') - k('KeyF')) * 0.45 * dt;
    if (dth) { kThr = Math.max(0, Math.min(1, kThr + dth)); $('thrFill').style.height = (kThr * 100) + '%'; }
    return {
      roll: Math.max(-1, Math.min(1, roll)), pull: Math.max(-1, Math.min(1, pull)),
      thr: kThr, brake: touch.brake || !!keys.KeyB, fire: touch.fire || !!keys.Space || !!keys.KeyJ, hold: true
    };
  }

  // ---------- UI helpers ----------
  function show(id) { for (const s of ['title', 'how', 'brief', 'pause', 'result']) $(s).classList.toggle('hidden', s !== id); }
  function hud(on) { $('touch').classList.toggle('hidden', !on); $('topbtns').classList.toggle('hidden', !on); }
  function toggleNvg() { nvg = !nvg; $('nvgBtn').classList.toggle('off', !nvg); }
  function toggleMute() { muted = !muted; store.muted = muted; save(); A.setMuted(muted); $('muteBtn').classList.toggle('off', muted); }
  $('nvgBtn').onclick = toggleNvg; $('muteBtn').onclick = toggleMute; $('pauseBtn').onclick = () => { if (screen === 'play') pause(); };
  $('muteBtn').classList.toggle('off', muted);

  function buildNights() {
    const box = $('nights'); box.innerHTML = '';
    NF.NIGHTS.forEach((N, i) => {
      const b = document.createElement('button'); b.className = 'night';
      const best = store.best[i];
      b.innerHTML = '<div><b>' + (i + 1) + '. ' + N.name + '</b><span class="s">' + N.sub + '</span></div><div class="gr">' + (best ? best.grade : '') + '</div>';
      b.onclick = () => { A.init(); A.setMuted(muted); A.click(); openBrief(i); };
      box.appendChild(b);
    });
  }
  $('howBtn').onclick = () => show('how'); $('howClose').onclick = () => show('title');

  function openBrief(i) {
    nightIdx = i; const N = NF.NIGHTS[i];
    $('bNum').textContent = 'NIGHT ' + (i + 1) + ' OF ' + NF.NIGHTS.length;
    $('bName').textContent = N.name; $('bSub').textContent = N.sub;
    $('bGoal').textContent = 'Goal: shoot down at least ' + N.pass + ' of ' + N.drones.length + ' drone' + (N.drones.length > 1 ? 's' : '') + (N.record ? '. The Ukrainian record is ' + N.record + '. Beat it.' : '.') +
      ' 510 rounds. ' + (N.nvg ? 'Night vision is on (N toggles it).' : 'Dusk: you can see without night vision.');
    show('brief');
  }
  $('bBack').onclick = () => { show('title'); };
  $('flyBtn').onclick = () => { A.init(); A.setMuted(muted); startNight(nightIdx); };
  $('menuBtn').onclick = () => { toTitle(); };
  $('quitBtn').onclick = () => { toTitle(); };
  $('retryBtn').onclick = () => startNight(nightIdx);
  $('nextBtn').onclick = () => { if (nightIdx < NF.NIGHTS.length - 1) openBrief(nightIdx + 1); else toTitle(); };
  $('resumeBtn').onclick = () => resume();

  function toTitle() { screen = 'title'; hud(false); A.silence(); buildNights(); show('title'); w = null; draw0(); }

  function startNight(i) {
    nightIdx = i; w = NF.newWorld(i); R.reset();
    nvg = NF.NIGHTS[i].nvg !== false; $('nvgBtn').classList.toggle('off', !nvg);
    kThr = touch.thr = 0.6; $('thrFill').style.height = '60%';
    touch.fire = touch.brake = false; resultTimer = 0; acc = 0; last = performance.now();
    screen = 'play'; hud(true); show(null);
    A.resume();
  }
  function pause() { screen = 'pause'; A.silence(); show('pause'); }
  function resume() { screen = 'play'; show(null); last = performance.now(); acc = 0; }

  // ---------- result ----------
  let lastText = '';
  function showResult() {
    const r = w.result, N = w.night;
    screen = 'result'; hud(false); A.silence();
    const bad = !r.won;
    const prev = store.best[nightIdx];
    if (r.won && (!prev || GRADES[r.grade] > GRADES[prev.grade] || (GRADES[r.grade] === GRADES[prev.grade] && r.kills > prev.kills))) { store.best[nightIdx] = { grade: r.grade, kills: r.kills }; save(); }
    $('rNum').textContent = 'NIGHT ' + (nightIdx + 1) + ' - ' + N.name.toUpperCase();
    $('rTitle').textContent = r.won ? (r.record ? 'NEW RECORD' : 'Night held') : r.why === 'lost' ? 'Aircraft lost' : r.why === 'bingo' ? 'Bingo fuel: too few kills' : 'Too many got through';
    $('rGrade').textContent = r.won ? r.grade : '-'; $('rGrade').classList.toggle('bad', bad);
    const st = [
      ['Drones down', r.kills + ' / ' + r.total], ['Got through', r.through],
      ['Rounds fired', r.fired + ' (' + r.hits + ' hits)'], ['Per kill', r.kills ? Math.round(r.fired / r.kills) + ' rounds' : '-'],
      ['Districts lit', r.lit + ' / ' + r.districts], ['Aircraft damage', r.damage + '%'], ['Time', Math.round(r.time) + ' s'], ['Need', N.pass + ' kills']
    ];
    $('rStats').innerHTML = st.map(s => '<div><span>' + s[0] + '</span><br>' + s[1] + '</div>').join('');
    $('rNote').textContent = r.why === 'lost' ? 'Cause: ' + r.deadWhy + '.' : r.won && r.fired / Math.max(1, r.kills) > 80 ? 'Tip: shorter bursts inside 500 m, wingtips on the funnel walls.' : r.won ? 'Clean shooting.' : 'Tip: get the wingtips on the funnel walls before you press FIRE.';
    $('nextBtn').classList.toggle('hidden', !(r.won && nightIdx < NF.NIGHTS.length - 1));
    lastText = 'Night Funnel - night ' + (nightIdx + 1) + ' "' + N.name + '": ' + r.kills + '/' + r.total + ' drones, grade ' + (r.won ? r.grade : 'none') + ', ' + r.fired + ' rounds. https://phennova.github.io/daily-builds/builds/2026-11-10-night-funnel/';
    show('result');
    if (r.won) A.win(); else A.lose();
  }
  $('copyBtn').onclick = () => {
    const done = () => { $('copyBtn').textContent = 'Copied'; setTimeout(() => { $('copyBtn').textContent = 'Copy result'; }, 1500); };
    try { navigator.clipboard.writeText(lastText).then(done, () => { $('copyBtn').textContent = 'Copy failed'; }); } catch (e) { $('copyBtn').textContent = 'Copy failed'; }
  };

  // ---------- loop ----------
  function draw0() { // idle backdrop for menus: a slow fly-by
    const t = performance.now() / 1000;
    if (!bg) bg = NF.newWorld(1);
    bg.jet.pos = [3000 * Math.sin(t * 0.05), 1500 * Math.cos(t * 0.05) - 3000, 900 + 40 * Math.sin(t * 0.3)];
    const h = Math.atan2(Math.cos(t * 0.05), -Math.sin(t * 0.05) * 0.5) + 0.2;
    bg.jet.f = [Math.sin(h) * 0.97, Math.cos(h) * 0.97, -0.05]; bg.jet.f = NF.norm(bg.jet.f); bg.jet.u = [0, 0, 1]; bg.jet.u = NF.norm(NF.sub(bg.jet.u, NF.mul(bg.jet.f, NF.dot(bg.jet.u, bg.jet.f))));
    bg.t = t; bg.drones.forEach(d => { d.state = 'wait'; }); bg.lock = -1;
    R.draw(bg, { nvg: true, bgOnly: true });
  }
  let bg = null;

  function frame(now) {
    requestAnimationFrame(frame);
    if (screen === 'play' || (screen === 'result' && w)) {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (screen === 'play') {
        acc += dt;
        let n = 0;
        while (acc >= NF.DT && n < 12 && !w.over) {
          NF.step(w, readInput(NF.DT)); acc -= NF.DT; n++;
          for (const e of w.events) { R.onEvent(e, w); A.onEvent(e); }
          w.events.length = 0;
        }
        if (w.over) { if (!resultTimer) resultTimer = now; if (now - resultTimer > (w.result.why === 'lost' ? 2400 : 2200)) showResult(); }
        const j = w.jet, d = w.lock >= 0 ? w.drones[w.lock] : null;
        let range = -1, clos = 0, inRange = false;
        if (d && ['fly', 'dive'].includes(d.state)) { const rel = NF.sub(d.pos, j.pos); range = NF.len(rel); clos = -NF.dot(NF.sub(d.vel, j.vel), NF.norm(rel)); inRange = range > 150 && range < 700; }
        const vz = j.vel[2], alt = j.pos[2];
        const warn = j.dead ? '' : (alt + vz * 3 < 60 && vz < -3 || alt < 90 && vz < 0) ? 'pullup' : NF.nAvail(j.speed) < 1.5 ? 'stall' : '';
        A.update({ thr: j.thr, speed: j.speed, firing: w.firing, range, closure: clos, inRange, warn: w.over ? '' : warn });
      }
      R.draw(w, { nvg, safeTop: si.t, safeBottom: si.b, textLift: coarse && innerHeight > innerWidth ? 112 : 0 });
      if (w.over && screen === 'play') A.update({ thr: 0.3, speed: 100, firing: false, range: -1, closure: 0, inRange: false, warn: '' });
      return;
    }
    if (screen === 'title' || screen === 'brief' || screen === 'how') draw0();
  }

  // ---------- boot ----------
  buildNights();
  R.resize();
  if (DEMO || q.has('night')) {
    const n = Math.max(1, Math.min(5, parseInt(q.get('night') || '2', 10) || 2)) - 1;
    if (DEMO) { A.setMuted(true); }
    startNight(n);
    const ff = parseFloat(q.get('ff') || '0');
    for (let i = 0; i < ff * 120 && !w.over; i++) { NF.step(w, readInput(NF.DT)); for (const e of w.events) R.onEvent(e, w); w.events.length = 0; }
    window.__nf = { w: () => w };
  } else { show('title'); }
  last = performance.now();
  requestAnimationFrame(frame);
  window.__nfstate = () => ({ screen, t: w && w.t, kills: w && w.kills, over: w && w.over, result: w && w.result });
})();
