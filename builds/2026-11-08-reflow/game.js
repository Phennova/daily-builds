// game.js - UI, loop, rendering, audio for Reflow.
(function () {
  'use strict';
  const E = Engine, LV = window.LEVELS;
  const $ = id => document.getElementById(id);
  const page = $('page'), styleEl = $('lvl'), fx = $('fx'), ctx = fx.getContext('2d');
  const qs = new URLSearchParams(location.search);
  const DEMO = qs.has('demo');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const store = {
    get(k, d) { try { const v = localStorage.getItem('reflow.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('reflow.' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
  };
  let stars = store.get('stars', {});
  let muted = store.get('muted', false);

  // ---------- audio (generated) ----------
  let ac = null, master = null;
  function audio() {
    if (ac) return ac;
    try {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      master = ac.createGain(); master.gain.value = muted ? 0 : 0.5; master.connect(ac.destination);
    } catch (e) { ac = null; }
    if (ac && ac.state === 'suspended') ac.resume();
    return ac;
  }
  function tone(f, dur, type, vol, slide, delay) {
    if (!ac || muted || ac.state !== 'running') return;
    const t = ac.currentTime + (delay || 0);
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, f * slide), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol || 0.2, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
  }
  let noiseBuf = null;
  function noise(dur, f0, f1, vol, q) {
    if (!ac || muted) return;
    if (!noiseBuf) { noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
    const t = ac.currentTime, s = ac.createBufferSource(), bp = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = noiseBuf; bp.type = 'bandpass'; bp.Q.value = q || 2; bp.frequency.setValueAtTime(f0, t); bp.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(vol || 0.3, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(bp); bp.connect(g); g.connect(master); s.start(t); s.stop(t + dur + 0.02);
  }
  const sfx = {
    spawn() { tone(740, 0.06, 'square', 0.05, 1.3); },
    land(h) { if (h > 40) tone(140, 0.07, 'triangle', 0.08, 0.6); },
    splat() { noise(0.25, 900, 120, 0.35, 1); tone(90, 0.18, 'sine', 0.25, 0.5); },
    save(n) { const f = 660 * Math.pow(1.0595, (n % 8) * 2); tone(f, 0.12, 'triangle', 0.12); tone(f * 1.5, 0.18, 'triangle', 0.09, null, 0.07); },
    lost() { tone(300, 0.3, 'sine', 0.08, 0.3); },
    reflow() { noise(0.22, 300, 3200, 0.22, 3); tone(1200, 0.03, 'square', 0.05); },
    eject() { tone(320, 0.18, 'square', 0.05, 2.2); },
    deny() { tone(160, 0.12, 'square', 0.08); tone(120, 0.14, 'square', 0.08, null, 0.08); },
    win() { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.25, 'triangle', 0.13, null, i * 0.1)); },
    fail() { [392, 330, 262].forEach((f, i) => tone(f, 0.3, 'sine', 0.12, null, i * 0.14)); }
  };

  // ---------- state ----------
  let L = null, li = 0, choice = null, sim = null, edits = 0, editsUsed = 0;
  let running = false, paused = false, fast = false, inspect = false, ended = false;
  let parts = [], shake = 0, demoQueue = [], acc = 0, last = 0, scale = 1, titleDemo = false;
  let flashTimer = 0;

  function measure() { return E.measure(page); }

  function loadLevel(i, opts) {
    opts = opts || {};
    li = i; L = LV[i];
    choice = E.initialChoice(L);
    page.innerHTML = L.html;
    styleEl.textContent = E.levelCSS(L, choice);
    sim = new E.Sim(L, measure);
    edits = L.edits; editsUsed = 0; ended = false; parts = []; acc = 0;
    paused = false; fast = false;
    $('url').textContent = L.url;
    $('lvlName').textContent = (i + 1) + '. ' + L.title;
    $('teach').innerHTML = '<b>' + L.title + '.</b> ' + esc(L.teach);
    demoQueue = opts.demo ? L.solution.slice().sort((a, b) => a.t - b.t) : [];
    buildPane();
    updateHud();
    syncButtons();
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  // Pane and cards are built from our own level data (no user input); strings go through esc().
  function buildPane() {
    const R = $('rules'); R.innerHTML = '';
    L.rules.forEach((r, i) => {
      const div = document.createElement('div'); div.className = 'rule';
      div.innerHTML = '<div class="sel">' + esc(r.sel) + ' {</div>';
      r.decls.forEach((d, j) => {
        const row = document.createElement('div'); row.className = 'decl';
        row.innerHTML = '<span class="prop">' + esc(d.p) + '</span>:';
        d.opts.forEach((o, k) => {
          const b = document.createElement('button'); b.className = 'opt'; b.textContent = o;
          b.dataset.r = i; b.dataset.d = j; b.dataset.o = k;
          b.addEventListener('click', () => pick(i, j, k));
          row.appendChild(b);
        });
        row.appendChild(document.createTextNode(';'));
        div.appendChild(row);
      });
      div.appendChild(document.createElement('div')).textContent = '}';
      R.appendChild(div);
    });
    refreshPane();
  }
  function refreshPane() {
    for (const b of $('rules').querySelectorAll('.opt')) {
      const r = +b.dataset.r, d = +b.dataset.d, o = +b.dataset.o;
      const on = choice[r][d] === o;
      b.classList.toggle('on', on);
      b.classList.toggle('changed', on && o !== (L.rules[r].decls[d].v || 0));
      b.disabled = !on && (edits <= 0 || ended);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    $('editsLeft').innerHTML = 'edits left <b>' + edits + '</b>/' + L.edits;
  }

  function pick(r, d, o, fromDemo) {
    if (!L || ended) return;
    if (choice[r][d] === o) return;
    if (!fromDemo && edits <= 0) { sfx.deny(); toast('No edits left. Restart (R) to try again.'); return; }
    if (!fromDemo) audio();
    choice[r][d] = o;
    if (!fromDemo) { edits--; editsUsed++; } else { edits = Math.max(0, edits - 1); editsUsed++; }
    styleEl.textContent = E.levelCSS(L, choice);
    sim.relayout();
    sfx.reflow();
    // flash the elements this rule matches
    clearTimeout(flashTimer);
    for (const el of page.querySelectorAll('.flash')) el.classList.remove('flash');
    for (const el of page.querySelectorAll(L.rules[r].sel)) el.classList.add('flash');
    flashTimer = setTimeout(() => { for (const el of page.querySelectorAll('.flash')) el.classList.remove('flash'); }, 450);
    if (!reduced) spawnBurst(null);
    refreshPane(); updateHud();
  }

  function updateHud() {
    if (!L) return;
    $('sSaved').textContent = sim.saved + '/' + L.need + (L.count !== L.need ? ' of ' + L.count : '');
    $('sSaved').className = sim.saved >= L.need ? 'win' : '';
    $('sEdits').textContent = edits;
    $('sTime').textContent = Math.max(0, Math.ceil((sim.limit - sim.t) / 60)) + 's';
  }
  function syncButtons() {
    $('bPlay').innerHTML = paused ? '&#9654;' : '&#10073;&#10073;';
    $('bPlay').classList.toggle('on', paused);
    $('bFast').classList.toggle('on', fast);
    $('bInspect').classList.toggle('on', inspect);
    $('bMute').innerHTML = muted ? '&#215;&#9835;' : '&#9835;';
    $('bMute').classList.toggle('on', muted);
  }
  let toastT = 0;
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2200); }

  // ---------- layout / scaling ----------
  function fit() {
    const wrap = $('stageWrap'); const W = wrap.clientWidth, H = wrap.clientHeight;
    const pad = 8;
    scale = Math.max(0.3, Math.min((W - pad * 2) / 360, (H - pad * 2) / 568));
    const st = $('stage');
    st.style.transform = 'scale(' + scale + ')';
    st.style.left = Math.round((W - 360 * scale) / 2) + 'px';
    st.style.top = Math.round((H - 568 * scale) / 2) + 'px';
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    fx.width = Math.round(360 * scale * dpr); fx.height = Math.round(540 * scale * dpr);
    fx._k = scale * dpr;
  }

  // ---------- particles ----------
  function spawnBurst(ev) {
    if (!ev) return;
    const n = ev.type === 'splat' ? 18 : ev.type === 'save' ? 12 : 6;
    for (let i = 0; i < n; i++) {
      const a = ev.type === 'save' ? -Math.PI / 2 + (Math.random() - 0.5) * 2.2 : Math.random() * Math.PI * 2;
      const sp = ev.type === 'splat' ? 0.6 + Math.random() * 1.6 : 0.4 + Math.random() * 1.2;
      parts.push({ x: ev.x, y: ev.y - 4, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (ev.type === 'splat' ? 1 : 0.6), life: 40 + Math.random() * 30, kind: ev.type });
    }
  }
  function handleEvents() {
    for (const ev of sim.events) {
      if (ev.type === 'spawn') sfx.spawn();
      else if (ev.type === 'land') sfx.land(ev.h);
      else if (ev.type === 'splat') { sfx.splat(); if (!reduced) { spawnBurst(ev); shake = 6; } }
      else if (ev.type === 'save') { sfx.save(sim.saved); if (!reduced) spawnBurst(ev); }
      else if (ev.type === 'lost') sfx.lost();
      else if (ev.type === 'eject') sfx.eject();
    }
    sim.events.length = 0;
  }

  // ---------- rendering ----------
  const SK = '#f2c7a0', HAIR = '#3b2a1f', SHIRT = '#2f6fd6', LEG = '#23272f';
  function drawWalker(w, t) {
    const x = Math.round(w.x), y = Math.round(w.y);
    const f = w.dir;
    const px = (dx, dy, wd, ht, c) => { ctx.fillStyle = c; ctx.fillRect(x + (f > 0 ? dx : -dx - wd), y + dy, wd, ht); };
    const fall = w.state === 'fall';
    const step = fall ? 0 : Math.floor(w.age / 8) % 2;
    px(-2, -12, 4, 2, HAIR); px(-2, -10, 4, 3, SK); px(1, -10, 1, 1, '#000');
    px(-2, -7, 4, 4, SHIRT);
    if (fall) { px(-3, -11, 1, 3, SK); px(2, -11, 1, 3, SK); } else { px(step ? 2 : -3, -6, 1, 2, SK); }
    if (fall) { px(-2, -3, 1, 3, LEG); px(1, -3, 1, 3, LEG); }
    else if (step) { px(-2, -3, 1, 3, LEG); px(1, -3, 1, 3, LEG); }
    else { px(-1, -3, 2, 3, LEG); }
  }
  function render() {
    const k = fx._k || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, fx.width, fx.height);
    let sx = 0, sy = 0;
    if (shake > 0) { sx = (Math.random() - 0.5) * shake; sy = (Math.random() - 0.5) * shake; shake *= 0.85; if (shake < 0.3) shake = 0; }
    ctx.setTransform(k, 0, 0, k, sx * k, sy * k);
    if (!sim) return;
    const t = performance.now() / 1000;
    if (inspect) {
      ctx.lineWidth = 1 / k * 1.5;
      for (const s of sim.solids) {
        ctx.strokeStyle = s.kind === 'box' ? 'rgba(40,120,255,.8)' : 'rgba(220,40,160,.75)';
        ctx.fillStyle = s.kind === 'box' ? 'rgba(40,120,255,.08)' : 'rgba(220,40,160,.08)';
        ctx.fillRect(s.l, s.t, s.r - s.l, s.b - s.t); ctx.strokeRect(s.l, s.t, s.r - s.l, s.b - s.t);
        ctx.fillStyle = s.kind === 'box' ? 'rgba(40,120,255,.9)' : 'rgba(220,40,160,.9)'; ctx.fillRect(s.l, s.t - 1, s.r - s.l, 2);
      }
    }
    // exit glow
    const e = sim.exit;
    if (e) {
      const p = 0.5 + 0.5 * Math.sin(t * 4);
      ctx.strokeStyle = 'rgba(40,180,90,' + (0.35 + 0.4 * p) + ')'; ctx.lineWidth = 2;
      ctx.strokeRect(e.l - 3 - p * 2, e.t - 3 - p * 2, e.r - e.l + 6 + p * 4, e.b - e.t + 6 + p * 4);
      ctx.fillStyle = 'rgba(40,180,90,.9)'; ctx.font = "10px 'Reflow Pixel', monospace";
      ctx.fillText('EXIT', (e.l + e.r) / 2 - 12, e.t - 7 - p * 2);
    }
    // hatch: a little drop chute
    const h = L.hatch;
    ctx.fillStyle = '#5a554c'; ctx.fillRect(h.x - 9, h.y - 16, 18, 4); ctx.fillRect(h.x - 9, h.y - 12, 3, 4); ctx.fillRect(h.x + 6, h.y - 12, 3, 4);
    if (sim.spawned < L.count) { ctx.fillStyle = 'rgba(90,85,76,' + (0.4 + 0.3 * Math.sin(t * 6)) + ')'; ctx.fillRect(h.x - 1, h.y - 8, 2, 3); }
    for (const w of sim.walkers) if (w.state === 'walk' || w.state === 'fall') drawWalker(w, t);
    for (const q of parts) {
      ctx.globalAlpha = Math.max(0, Math.min(1, q.life / 30));
      ctx.fillStyle = q.kind === 'splat' ? '#c0392b' : q.kind === 'save' ? '#38c172' : '#4f9dff';
      ctx.fillRect(q.x - 1, q.y - 1, 2, 2);
    }
    ctx.globalAlpha = 1;
  }
  function stepParts() {
    for (const q of parts) { q.x += q.vx; q.y += q.vy; q.vy += 0.06; q.life--; }
    parts = parts.filter(q => q.life > 0);
  }

  // ---------- loop ----------
  let rafPending = false, lastFrameT = 0;
  function schedule() { if (rafPending) return; rafPending = true; requestAnimationFrame(t => { rafPending = false; frame(t); }); }
  // watchdog: keeps the sim alive where rAF is throttled (headless capture, some embedded views)
  setInterval(() => { if (performance.now() - lastFrameT > 150) frame(performance.now()); }, 100);
  function frame(now) {
    lastFrameT = performance.now();
    schedule();
    const dt = Math.min(0.1, (now - last) / 1000 || 0); last = now;
    if (sim && running && !paused && !ended) {
      acc += dt * 60 * (fast ? 3 : 1);
      let n = 0;
      while (acc >= 1 && n < 12) {
        acc -= 1; n++;
        while (demoQueue.length && demoQueue[0].t <= sim.t) { const q = demoQueue.shift(); pick(q.r, q.d, q.o, true); }
        sim.step(); handleEvents(); stepParts();
        if (sim.finished()) { finish(); break; }
      }
      if (n) updateHud();
    } else if (parts.length) stepParts();
    render();
  }

  function finish() {
    ended = true; refreshPane(); updateHud();
    if (titleDemo) { setTimeout(() => { if (titleDemo) { loadLevel(0, { demo: true }); running = true; } }, 1500); return; }
    if (DEMO) return;
    const win = sim.saved >= L.need;
    let st = 0;
    if (win) {
      st = 1 + (editsUsed <= L.par ? 1 : 0) + (sim.saved === L.count ? 1 : 0);
      if ((stars[L.id] || 0) < st) { stars[L.id] = st; store.set('stars', stars); }
      sfx.win();
    } else sfx.fail();
    setTimeout(() => showResult(win, st), 700);
  }

  // ---------- screens ----------
  function show(html) { $('card').innerHTML = html; $('overlay').classList.add('show'); const b = $('card').querySelector('button.primary'); if (b) b.focus({ preventScroll: true }); }
  function hide() { $('overlay').classList.remove('show'); }
  function starStr(n) { return '\u2605'.repeat(n) + '\u2606'.repeat(3 - n); }
  function unlocked(i) { return i === 0 || !!stars[LV[i - 1].id] || DEMO; }

  function titleScreen() {
    titleDemo = true; loadLevel(0, { demo: true }); running = true;
    show(`<h1>REFLOW</h1>
<p>Lemmings on a real web page. The floors are the line boxes your browser just laid out, and your only tools are CSS declarations.</p>
<p class="dim">Tap a value in the Styles pane and the page reflows under the readers' feet.</p>
<div class="row"><button class="primary" data-a="levels">Play</button><button data-a="how">How to play</button></div>`);
  }
  function howScreen() {
    show(`<h2>How to play</h2>
<ul>
<li>Readers drop from the chute and walk. They stand on the tops of lines of text and on boxes, turn around at walls, and fall off edges.</li>
<li>A fall of more than about four lines (96px) is fatal. Falling off the bottom of the page loses them.</li>
<li>Tap a value in the <b>Styles</b> pane to change the page's CSS. The browser reflows the page instantly, even mid-run. Each change costs one edit.</li>
<li>If text or a box grows into a reader, it pushes the reader up on top. That is how lifts work.</li>
<li>Get the required number of readers to the <span class="win">EXIT</span>. Stars: pass, edits at par, everyone saved.</li>
</ul>
<p class="dim">Keys: Space pause, F fast, R restart, I line boxes, H hint, M mute, Esc levels. You can pause and edit.</p>
<div class="row"><button class="primary" data-a="levels">Levels</button><button data-a="title">Back</button></div>`);
  }
  function levelsScreen() {
    titleDemo = false; running = false;
    const total = LV.reduce((a, l) => a + (stars[l.id] || 0), 0);
    show(`<h2>Pages to fix</h2><p class="dim">${total} / ${LV.length * 3} stars</p><div class="levels">` +
      LV.map((l, i) => `<button data-a="intro" data-i="${i}" ${unlocked(i) ? '' : 'disabled'}><span class="n">${i + 1} &middot; ${esc(l.url)}</span>${esc(l.title)}<span class="stars">${unlocked(i) ? starStr(stars[l.id] || 0) : 'locked'}</span></button>`).join('') +
      `</div><div class="row"><button data-a="how">How to play</button><button data-a="title">Title</button></div>`);
  }
  function introScreen(i) {
    titleDemo = false; running = false;
    loadLevel(i);
    const l = LV[i];
    show(`<p class="dim">${i + 1} / ${LV.length} &middot; ${esc(l.url)}</p><h2>${esc(l.title)}</h2>
<p>${esc(l.teach)}</p>
<p>Save <b>${l.need}</b> of ${l.count} readers. Edits: <b>${l.edits}</b> (par ${l.par}).</p>
<p class="dim">Tip: press boxes to see the line boxes the readers walk on.</p>
<div class="row"><button class="primary" data-a="start">Start</button><button data-a="levels">Levels</button></div>`);
  }
  function showResult(win, st) {
    const last = li === LV.length - 1;
    const fin = win && last;
    const total = LV.reduce((a, l) => a + (stars[l.id] || 0), 0);
    show(fin ? `<h2 class="win">Page shipped.</h2><p class="big">${starStr(st)}</p>
<p>Saved <b>${sim.saved}</b> of ${L.count} with <b>${editsUsed}</b> edits (par ${L.par}).</p>
<p>Every floor in this game was a line box the browser laid out from the stylesheet you edited. Total: <b>${total}</b> / ${LV.length * 3} stars.</p>
<div class="row"><button class="primary" data-a="levels">Levels</button><button data-a="retry">Replay</button></div>`
      : `<h2 class="${win ? 'win' : 'lose'}">${win ? 'Reflowed.' : 'Not enough readers made it.'}</h2>
${win ? `<p class="big">${starStr(st)}</p>` : ''}
<p class="res">Saved <b>${sim.saved}</b> (needed ${L.need} of ${L.count}) &middot; splatted <b>${sim.splat}</b> &middot; lost <b>${sim.lost}</b> &middot; edits <b>${editsUsed}</b> (par ${L.par})</p>
${win ? '' : `<p class="dim">Hint: ${esc(L.hint)}</p>`}
<div class="row">${win ? `<button class="primary" data-a="next">Next page</button><button data-a="retry">Retry</button>` : `<button class="primary" data-a="retry">Retry</button><button data-a="levels">Levels</button>`}</div>`);
  }
  function start() { hide(); audio(); running = true; paused = false; syncButtons(); }

  $('card').addEventListener('click', ev => {
    const b = ev.target.closest('button'); if (!b) return;
    audio(); tone(900, 0.03, 'square', 0.04);
    const a = b.dataset.a;
    if (a === 'levels') levelsScreen();
    else if (a === 'how') howScreen();
    else if (a === 'title') titleScreen();
    else if (a === 'intro') introScreen(+b.dataset.i);
    else if (a === 'start') start();
    else if (a === 'retry') { loadLevel(li); start(); }
    else if (a === 'next') introScreen(Math.min(li + 1, LV.length - 1));
  });

  // ---------- controls ----------
  function togglePause() { if (!running || titleDemo) return; paused = !paused; syncButtons(); toast(paused ? 'Paused. You can still edit.' : 'Running'); }
  function restart() { if (titleDemo || !L) return; loadLevel(li); start(); }
  $('bPlay').addEventListener('click', togglePause);
  $('bFast').addEventListener('click', () => { fast = !fast; syncButtons(); });
  $('bRestart').addEventListener('click', restart);
  $('bInspect').addEventListener('click', () => { inspect = !inspect; syncButtons(); });
  $('bHint').addEventListener('click', () => { if (L) toast(L.hint); });
  $('bMute').addEventListener('click', () => { muted = !muted; store.set('muted', muted); audio(); if (master) master.gain.value = muted ? 0 : 0.5; syncButtons(); });
  $('bMenu').addEventListener('click', levelsScreen);
  addEventListener('keydown', ev => {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const k = ev.key.toLowerCase();
    const overlay = $('overlay').classList.contains('show');
    if (k === 'escape') { levelsScreen(); return; }
    if (overlay) return;
    if (k === ' ') { ev.preventDefault(); togglePause(); }
    else if (k === 'f') $('bFast').click();
    else if (k === 'r') restart();
    else if (k === 'i') $('bInspect').click();
    else if (k === 'h') $('bHint').click();
    else if (k === 'm') $('bMute').click();
  });
  addEventListener('resize', fit);
  document.addEventListener('visibilitychange', () => { if (document.hidden && running && !paused && !titleDemo && !ended) { paused = true; syncButtons(); } });

  // ---------- boot ----------
  ReflowFont.load('Reflow Pixel').then(ok => {
    if (!ok) toast('Pixel font failed to load: layouts may differ on this browser.');
    fit();
    if (DEMO) {
      const i = Math.max(0, Math.min(LV.length - 1, (+qs.get('demo') || 1) - 1));
      loadLevel(i, { demo: true }); hide(); running = true;
      const skip = Math.min(20000, +qs.get('t') || 0);
      for (let s = 0; s < skip && !sim.finished(); s++) {
        while (demoQueue.length && demoQueue[0].t <= sim.t) { const q = demoQueue.shift(); pick(q.r, q.d, q.o, true); }
        sim.step(); sim.events.length = 0;
      }
      updateHud();
      if (qs.has('inspect')) { inspect = true; syncButtons(); }
    } else titleScreen();
    last = performance.now(); schedule();
  });
})();
