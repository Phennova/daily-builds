/* Road Cut - game UI, deep-time replay, audio, campaign. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var params = new URLSearchParams(location.search);
  var SELFTEST = params.has('selftest'), DEMO = params.get('demo');
  var reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  var STOPS = [
    { name: 'Highway 9 cut', lesson: 'Layers stack up from the bottom: the lowest is oldest. Anything that cuts through rock (like a dike of frozen magma) is younger than what it cuts.' },
    { name: 'Quarry Road', lesson: 'Faults break and offset layers, so a fault is younger than every layer it breaks. A dike that crosses a fault unbroken came after it.' },
    { name: 'Siccar Point bend', lesson: 'Angular unconformity: tilted layers cut flat by an erosion line, with flat layers on top. Layers, then tilting, then erosion, then new layers.' },
    { name: 'Granite Pass', lesson: 'A granite pluton rose from below and cooled underground. If an erosion line slices its top, the granite is older than the erosion.' },
    { name: 'Fold Creek', lesson: 'Folding bends layers into waves. Folded layers are older than the folding; the flat layers laid on the eroded folds are younger.' },
    { name: 'Fault Line Drive', lesson: 'Sometimes the rocks cannot tell you the order of two events (a fault and a tilt, say). Any order the evidence allows is accepted.' },
    { name: 'Two Gaps Canyon', lesson: 'Two erosion lines means two long gaps in time. Work from the bottom up, one package at a time.' },
    { name: 'Deep Time Summit', lesson: 'Everything at once. Start with what is cut by nothing, and what cuts everything.' }
  ];
  var NSTOPS = STOPS.length;

  // ---------- persistence ----------
  var SAVE_KEY = 'roadcut.v1';
  var save = { stars: [], muted: false, endless: 0 };
  try { var raw = localStorage.getItem(SAVE_KEY); if (raw && !SELFTEST) save = Object.assign(save, JSON.parse(raw)); } catch (e) { }
  function persist() { if (SELFTEST || DEMO) return; try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { } }

  // ---------- state ----------
  var S = {
    mode: 'title', level: 1, endless: false, seed: '', puzzle: null, seq: [], mistakes: 0, hints: 2,
    selected: -1, hlA: -1, hlB: -1, solved: false,
    replay: { v: 0, playing: false, last: 0, lastK: -1 }
  };

  // ---------- canvas ----------
  var cv = $('cliff'), ctx = cv.getContext('2d');
  var frameCanvas = document.createElement('canvas'), fctx = frameCanvas.getContext('2d');
  var hlCanvas = document.createElement('canvas'), hctx = hlCanvas.getContext('2d');
  var frame = null, hlKey = '';
  var FW = 720, FH = 400;

  function sizeCanvas() {
    var r = cv.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    var w = Math.max(300, Math.round(r.width * dpr)), h = Math.round(w / 1.8);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    var fw = Math.min(900, w);
    if (fw !== FW) { FW = fw; FH = Math.round(fw / 1.8); return true; }
    return false;
  }

  function computeStatic() {
    if (!S.puzzle) return;
    var ev = S.puzzle.events;
    frame = Render.computeFrame(ev, ev.length - 1, 1, FW, FH);
    putFrame(frame);
    hlKey = '';
  }
  function putFrame(f) {
    if (frameCanvas.width !== f.w || frameCanvas.height !== f.h) { frameCanvas.width = f.w; frameCanvas.height = f.h; }
    fctx.putImageData(new ImageData(f.rgba, f.w, f.h), 0, 0);
  }

  function draw() {
    if (!S.puzzle) return;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(frameCanvas, 0, 0, cv.width, cv.height);
    if (S.mode === 'replay' && S.replay.v < S.puzzle.events.length) { drawShake(); return; }
    // highlight overlay
    var key = S.selected + '|' + S.hlA + '|' + S.hlB + '|' + FW;
    if (key !== hlKey) {
      hlKey = key;
      hlCanvas.width = frame.w; hlCanvas.height = frame.h;
      hctx.clearRect(0, 0, frame.w, frame.h);
      var ev = S.puzzle.events;
      [[S.hlA, [59, 109, 140]], [S.hlB, [163, 68, 47]], [S.selected, [235, 170, 70]]].forEach(function (p) {
        if (p[0] < 0) return;
        var m = Render.highlightMask(frame, ev, p[0], p[1]);
        if (!m) return;
        var tmp = document.createElement('canvas'); tmp.width = frame.w; tmp.height = frame.h;
        tmp.getContext('2d').putImageData(new ImageData(m, frame.w, frame.h), 0, 0);
        hctx.drawImage(tmp, 0, 0);
      });
    }
    if (S.selected >= 0 || S.hlA >= 0 || S.hlB >= 0) ctx.drawImage(hlCanvas, 0, 0, cv.width, cv.height);
    drawLabels();
  }
  var shake = 0;
  function drawShake() { }

  function w2c(x, y) { return [x / Geo.W * cv.width, (Geo.H - y) / Geo.H * cv.height]; }
  function drawLabels() {
    var an = S.puzzle.analysis, ev = S.puzzle.events;
    var cssW = cv.getBoundingClientRect().width || cv.width, dpr = cv.width / cssW;
    var s = Math.max(15, Math.min(24, cssW / 32)) * dpr;
    ctx.font = '800 ' + Math.round(s * 0.72) + 'px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    an.cards.forEach(function (c) {
      var L = an.labels[c]; if (!L) return;
      var p = w2c(L.x, L.y), e = ev[c];
      var x = Math.max(s * 0.7, Math.min(cv.width - s * 0.7, p[0])), y = Math.max(s * 0.7, Math.min(cv.height - s * 0.7, p[1]));
      var hot = c === S.selected || c === S.hlA || c === S.hlB;
      ctx.lineWidth = Math.max(1.5, s / 12);
      ctx.fillStyle = hot ? '#2b2620' : 'rgba(248,243,232,0.93)';
      ctx.strokeStyle = '#2b2620';
      ctx.beginPath();
      if (e.kind === 'fault' || e.kind === 'erosion') ctx.arc(x, y, s * 0.55, 0, 6.2832);
      else roundRect(x - s * 0.55, y - s * 0.55, s * 1.1, s * 1.1, s * 0.18);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = hot ? '#f8f3e8' : '#2b2620';
      ctx.fillText(e.letter, x, y + 1);
    });
  }
  function roundRect(x, y, w, h, r) {
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  // ---------- audio ----------
  var AC = null, master = null, noiseBuf = null;
  function audio() {
    if (save.muted) return null;
    if (!AC) {
      var C = window.AudioContext || window.webkitAudioContext; if (!C) return null;
      try { AC = new C(); } catch (e) { return null; }
      master = AC.createGain(); master.gain.value = 0.8; master.connect(AC.destination);
      noiseBuf = AC.createBuffer(1, AC.sampleRate * 2, AC.sampleRate);
      var d = noiseBuf.getChannelData(0); for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (AC.state === 'suspended') AC.resume();
    return AC;
  }
  function tone(f, dur, type, vol, when, f2) {
    var a = audio(); if (!a) return;
    var t = a.currentTime + (when || 0), o = a.createOscillator(), g = a.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol || 0.08, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
  }
  function noise(dur, ftype, f0, f1, vol, q, when) {
    var a = audio(); if (!a) return;
    var t = a.currentTime + (when || 0), src = a.createBufferSource(), fl = a.createBiquadFilter(), g = a.createGain();
    src.buffer = noiseBuf; src.loop = true;
    fl.type = ftype; fl.frequency.setValueAtTime(f0, t); if (f1) fl.frequency.exponentialRampToValueAtTime(f1, t + dur); fl.Q.value = q || 0.8;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.25, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(fl); fl.connect(g); g.connect(master); src.start(t); src.stop(t + dur + 0.05);
  }
  var sfx = {
    tap: function () { tone(700, 0.05, 'sine', 0.04); },
    place: function () { tone(520, 0.08, 'triangle', 0.07); tone(780, 0.07, 'sine', 0.03, 0.03); },
    remove: function () { tone(360, 0.08, 'triangle', 0.06); },
    wrong: function () { tone(190, 0.28, 'triangle', 0.09); tone(150, 0.3, 'triangle', 0.07, 0.05); },
    solve: function () { [523, 659, 784, 1047].forEach(function (f, i) { tone(f, 0.5, 'sine', 0.07, i * 0.09); }); },
    hint: function () { tone(880, 0.12, 'sine', 0.04); tone(990, 0.15, 'sine', 0.04, 0.08); },
    event: function (kind) {
      switch (kind) {
        case 'deposit': noise(1.0, 'bandpass', 1500, 2200, 0.05, 0.6); break;
        case 'erosion': noise(1.6, 'bandpass', 380, 1300, 0.07, 2.5); noise(1.4, 'bandpass', 900, 500, 0.03, 3, 0.2); break;
        case 'tilt': case 'fold': noise(1.3, 'lowpass', 140, 90, 0.18, 0.7); tone(48, 1.2, 'sine', 0.12); break;
        case 'fault': noise(0.09, 'highpass', 1800, 0, 0.25, 0.7); tone(75, 0.6, 'sine', 0.2, 0.02, 40); noise(0.7, 'lowpass', 200, 80, 0.1, 0.7, 0.05); break;
        case 'dike': case 'pluton':
          noise(1.0, 'lowpass', 300, 160, 0.06, 0.7);
          for (var i = 0; i < 8; i++) { var f = 140 + Math.random() * 260; tone(f, 0.09, 'sine', 0.05, Math.random() * 0.9, f * 1.6); }
          break;
        case 'surface': noise(0.5, 'lowpass', 900, 120, 0.22, 0.7, 0.4); tone(60, 0.5, 'sine', 0.15, 0.4, 35); break;
        case 'basement': tone(110, 0.6, 'sine', 0.05); break;
      }
    }
  };

  // ---------- puzzle setup ----------
  function startStop(level) {
    S.endless = false; S.level = level; S.seed = 'stop' + level;
    loadPuzzle(Geo.generate(S.seed, level));
  }
  function startEndless(seed) {
    S.endless = true; S.level = 0;
    S.seed = seed || Math.random().toString(36).slice(2, 8);
    loadPuzzle(Geo.generate(S.seed, 0));
    if (!SELFTEST && !DEMO) try { history.replaceState(null, '', '?seed=' + encodeURIComponent(S.seed)); } catch (e) { }
  }
  function loadPuzzle(p) {
    S.puzzle = p; S.seq = []; S.mistakes = 0; S.hints = 2; S.selected = -1; S.hlA = S.hlB = -1; S.solved = false;
    S.mode = 'play'; S.replay.v = 0; S.replay.playing = false; S.replay.lastK = -1;
    $('title').hidden = true; $('endScreen').hidden = true; $('replayBar').hidden = true; $('clock').hidden = true;
    $('panel').style.display = '';
    setFeedback('', '');
    setInfo('Tap the rock or a card to identify it.');
    if (S.endless) $('intro').innerHTML = '<b>Endless road &middot; seed ' + esc(S.seed) + '</b>A random outcrop. Share the URL to challenge a friend with the same cliff.';
    else $('intro').innerHTML = '<b>Stop ' + S.level + ': ' + STOPS[S.level - 1].name + '</b>' + STOPS[S.level - 1].lesson;
    updateHud();
    sizeCanvas();
    computeStatic();
    renderCards();
    draw();
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  // innerHTML is only ever fed generated text from geo.js/STOPS; the one URL-controlled value (seed) goes through esc().

  function cardName(e) {
    switch (e.kind) {
      case 'basement': return 'Gneiss basement';
      case 'deposit': return Geo.ROCKS[e.rock].name;
      case 'dike': return 'Basalt dike';
      case 'pluton': return 'Granite pluton';
      case 'fault': return e.normal ? 'Normal fault' : 'Reverse fault';
      case 'erosion': return 'Erosion surface';
      case 'tilt': return 'Tilting';
      case 'fold': return 'Folding';
    }
    return e.kind;
  }

  function swatch(e, idx, w, h) {
    var c = document.createElement('canvas'); c.width = w; c.height = h;
    var x = c.getContext('2d');
    if (Geo.isMaterial(e)) {
      var img = x.createImageData(w, h), col = [0, 0, 0], px = 0.45;
      for (var j = 0; j < h; j++) for (var i = 0; i < w; i++) {
        Render.rockColor(e.rock, i * px + 3, (h - j) * px + 3, idx, px, col);
        var o = (j * w + i) * 4; img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2]; img.data[o + 3] = 255;
      }
      x.putImageData(img, 0, 0);
    } else {
      x.fillStyle = '#e6dcc8'; x.fillRect(0, 0, w, h);
      x.strokeStyle = '#2b2620'; x.lineWidth = Math.max(1.5, w / 14); x.beginPath();
      if (e.kind === 'fault') {
        // offset layers + fault line
        x.fillStyle = '#b9a989'; x.fillRect(0, h * 0.35, w / 2, h * 0.25); x.fillRect(w / 2, h * 0.55, w / 2, h * 0.25);
        x.moveTo(w * 0.35, h); x.lineTo(w * 0.65, 0);
      } else if (e.kind === 'erosion') {
        x.moveTo(0, h * 0.5);
        for (var k = 0; k <= w; k += 2) x.lineTo(k, h * 0.5 + Math.sin(k / w * 9) * h * 0.1);
      } else if (e.kind === 'tilt') {
        for (var t = 0; t < 3; t++) { x.moveTo(0, h * (0.55 + t * 0.22)); x.lineTo(w, h * (0.05 + t * 0.22)); }
      } else if (e.kind === 'fold') {
        for (var f = 0; f < 3; f++) {
          x.moveTo(0, h * (0.3 + f * 0.25));
          for (var k2 = 0; k2 <= w; k2 += 2) x.lineTo(k2, h * (0.3 + f * 0.25) - Math.sin(k2 / w * Math.PI) * h * 0.2);
        }
      }
      x.stroke();
    }
    return c;
  }

  function makeChip(idx, inSeq) {
    var e = S.puzzle.events[idx];
    var b = document.createElement('button');
    b.className = 'chip'; b.dataset.idx = idx;
    b.setAttribute('aria-label', (inSeq ? 'Remove ' : 'Add ') + e.letter + ', ' + cardName(e));
    b.appendChild(swatch(e, idx, 26, 30));
    var L = document.createElement('span'); L.className = 'L'; L.textContent = e.letter; b.appendChild(L);
    var nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = cardName(e); b.appendChild(nm);
    if (idx === S.selected) b.classList.add('sel');
    if (idx === S.hlA) b.classList.add('hlA');
    if (idx === S.hlB) b.classList.add('hlB');
    b.addEventListener('click', function () { if (inSeq) removeCard(idx); else addCard(idx); });
    return b;
  }

  var lastAdded = -1;
  function renderCards() {
    var seq = $('seq'), pool = $('pool');
    seq.textContent = ''; pool.textContent = '';
    S.seq.forEach(function (c) { var ch = makeChip(c, true); if (c === lastAdded) ch.classList.add('pop'); seq.appendChild(ch); });
    var rest = S.puzzle.analysis.cards.filter(function (c) { return S.seq.indexOf(c) < 0; })
      .sort(function (a, b) { return S.puzzle.events[a].letter < S.puzzle.events[b].letter ? -1 : 1; });
    rest.forEach(function (c) { pool.appendChild(makeChip(c, false)); });
    var full = rest.length === 0;
    $('bCheck').disabled = !full || S.solved;
    $('bUndo').disabled = !S.seq.length || S.solved;
    $('bClear').disabled = !S.seq.length || S.solved;
    $('bHint').disabled = S.hints <= 0 || S.solved;
    $('bHint').textContent = 'Hint (' + S.hints + ')';
    lastAdded = -1;
  }

  function select(idx, quiet) {
    S.selected = idx;
    if (idx >= 0) {
      var e = S.puzzle.events[idx];
      setInfo('<b>' + e.letter + ' &middot; ' + esc(cardName(e)) + '.</b> ' + esc(Geo.describe(S.puzzle, idx).replace(/^[^:]*: /, '')));
      if (!quiet) sfx.tap();
    }
    renderCards(); draw();
  }
  function setInfo(html) { $('info').innerHTML = html; }
  function setFeedback(cls, html) { var f = $('feedback'); f.className = cls; f.innerHTML = html; }

  function addCard(idx) {
    if (S.solved || S.seq.indexOf(idx) >= 0) return;
    S.seq.push(idx); lastAdded = idx; sfx.place();
    S.hlA = S.hlB = -1; setFeedback('', '');
    S.selected = idx;
    var e = S.puzzle.events[idx];
    setInfo('<b>' + e.letter + ' &middot; ' + esc(cardName(e)) + '.</b> ' + esc(Geo.describe(S.puzzle, idx).replace(/^[^:]*: /, '')));
    if (S.seq.length === S.puzzle.analysis.cards.length) setFeedback('', 'All events placed. Press <b>Check</b> when you are happy with the order.');
    renderCards(); draw();
  }
  function removeCard(idx) {
    if (S.solved) return;
    var i = S.seq.indexOf(idx); if (i < 0) return;
    S.seq.splice(i, 1); sfx.remove(); S.hlA = S.hlB = -1; setFeedback('', '');
    S.selected = idx;
    renderCards(); draw();
  }

  function check() {
    if (S.solved || !S.puzzle) return;
    var res = Geo.check(S.puzzle, S.seq);
    if (res.missing) { setFeedback('bad', 'Place all ' + S.puzzle.analysis.cards.length + ' events first.'); sfx.wrong(); return; }
    if (res.ok) { solved(); return; }
    S.mistakes++;
    var c = res.violated, ev = S.puzzle.events;
    S.hlA = c.a; S.hlB = c.b; S.selected = -1;
    setFeedback('bad', 'Not quite: ' + ev[c.a].letter + ' must come before ' + ev[c.b].letter +
      (res.nViolated > 1 ? ' (and ' + (res.nViolated - 1) + ' more clue' + (res.nViolated > 2 ? 's' : '') + ' disagree)' : '') +
      '.<span class="why">' + esc(Geo.explain(S.puzzle, c)) + '</span>');
    sfx.wrong();
    bump();
    renderCards(); draw(); updateHud();
  }
  function bump() {
    if (reduceMotion) return;
    var w = $('cliffWrap');
    if (w.animate) w.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(0)' }], { duration: 220 });
  }

  function hint() {
    if (S.hints <= 0 || S.solved) return;
    var cons = S.puzzle.analysis.constraints, pos = {};
    S.seq.forEach(function (c, i) { pos[c] = i; });
    var pick = null;
    // 1) a relationship the current partial order already breaks
    var broken = cons.filter(function (c) { return pos[c.a] !== undefined && pos[c.b] !== undefined && pos[c.a] > pos[c.b]; });
    if (broken.length) pick = broken[0];
    // 2) a placed card that has to come before something already placed but is missing ("what goes next")
    if (!pick) {
      var cand = cons.filter(function (c) { return pos[c.a] === undefined && pos[c.b] === undefined; });
      if (!cand.length) cand = cons.filter(function (c) { return pos[c.a] === undefined || pos[c.b] === undefined; });
      if (!cand.length) cand = cons;
      cand.sort(function (p, q) { return p.a - q.a || p.b - q.b; });
      pick = cand[0];
    }
    S.hints--;
    S.hlA = pick.a; S.hlB = pick.b; S.selected = -1;
    setFeedback('', 'Clue: ' + esc(Geo.explain(S.puzzle, pick)));
    sfx.hint();
    renderCards(); draw();
  }

  function starsFor(m) { return m === 0 ? 3 : m <= 2 ? 2 : 1; }
  function solved() {
    S.solved = true; S.hlA = S.hlB = -1; S.selected = -1;
    var st = starsFor(S.mistakes);
    if (!S.endless) { save.stars[S.level - 1] = Math.max(save.stars[S.level - 1] || 0, st); }
    else save.endless = (save.endless || 0) + 1;
    persist();
    setFeedback('good', 'Correct! ' + '&#9733;'.repeat(st) + '&#9734;'.repeat(3 - st) +
      (S.mistakes ? ' (' + S.mistakes + ' mistake' + (S.mistakes > 1 ? 's' : '') + ')' : ' First try.') + ' Watch the cliff being made.');
    sfx.solve();
    updateHud(); renderCards();
    startReplay();
  }

  // ---------- replay ----------
  var DUR = { basement: 0.7, deposit: 1.1, erosion: 1.7, tilt: 1.4, fold: 1.5, fault: 1.0, dike: 1.0, pluton: 1.4, surface: 1.3 };
  function startReplay() {
    S.mode = 'replay'; S.replay.v = 0; S.replay.playing = true; S.replay.last = performance.now(); S.replay.lastK = -1;
    $('replayBar').hidden = false; $('clock').hidden = false;
    $('bNext').textContent = S.endless ? 'Next outcrop \u2192' : (S.level < NSTOPS ? 'Next stop \u2192' : 'Finish trip \u2192');
    $('bPlay').innerHTML = '&#10074;&#10074;';
    requestAnimationFrame(tick);
  }
  var lastRF = 0;
  function tick(now) {
    if (S.mode !== 'replay') return;
    var ev = S.puzzle.events, n = ev.length;
    if (S.replay.playing) {
      var dt = Math.min(0.1, (now - S.replay.last) / 1000);
      var k = Math.min(n - 1, Math.floor(S.replay.v));
      if (reduceMotion) {
        // step through events with a pause on each (no sliding animation)
        S.replay.hold = (S.replay.hold || 0) + dt;
        if (S.replay.hold > 1.1) { S.replay.hold = 0; S.replay.v = Math.min(n, Math.floor(S.replay.v) + 1); }
      } else S.replay.v = Math.min(n, S.replay.v + dt / (DUR[ev[k].kind] || 1.2));
      if (S.replay.v >= n) { S.replay.playing = false; $('bPlay').innerHTML = '&#9654;'; }
    }
    S.replay.last = now;
    renderReplay(S.replay.playing);
    if (S.replay.playing) requestAnimationFrame(tick);
  }
  function replayState(v) {
    var n = S.puzzle.events.length;
    if (v >= n) return { k: n - 1, t: 1 };
    var k = Math.floor(v); return { k: k, t: reduceMotion ? 1 : v - k };
  }
  function renderReplay(fast) {
    var ev = S.puzzle.events, n = ev.length, st = replayState(S.replay.v);
    if (st.k !== S.replay.lastK) {
      S.replay.lastK = st.k;
      if (S.replay.playing) sfx.event(ev[st.k].kind);
    }
    if (S.replay.v >= n) {
      computeStatic(); draw();
    } else {
      var w = fast ? Math.min(FW, 420) : FW, h = Math.round(w / 1.8);
      var f = Render.computeFrame(ev, st.k, st.t, w, h, { water: ev[st.k].kind === 'deposit' });
      putFrame(f);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(frameCanvas, 0, 0, f.w, f.h, 0, 0, cv.width, cv.height);
    }
    $('scrub').value = Math.round(S.replay.v / n * 1000);
    // clock + caption
    var e = ev[st.k], prevAge = st.k > 0 ? ev[st.k - 1].age : e.age;
    var age = Math.round(prevAge + (e.age - prevAge) * st.t);
    $('clock').innerHTML = (S.replay.v >= n ? 'Today' : age.toLocaleString('en-US') + ' million years ago') + '<small>' + esc(caption(st.k)) + '</small>';
  }
  function caption(k) {
    var e = S.puzzle.events[k], L = e.letter ? ' ' + e.letter : '', hidden = !e.letter && e.kind !== 'surface';
    switch (e.kind) {
      case 'basement': return 'Ancient gneiss basement' + L + (hidden ? ' (buried too deep to see today)' : '');
      case 'deposit': return Geo.ROCKS[e.rock].name + L + ' settles out of the water' + (hidden ? ' (later lost to erosion)' : '');
      case 'erosion': return 'The land rises; erosion' + L + ' grinds it down';
      case 'tilt': return 'Tilting' + L + ': the crust tips ' + Math.round(Math.abs(e.ang) * 180 / Math.PI) + '\u00b0';
      case 'fold': return 'Folding' + L + ': compression buckles the layers';
      case 'fault': return (e.normal ? 'Normal' : 'Reverse') + ' fault' + L + ' slips ' + Math.round(Math.abs(e.slip) / 2) + ' m';
      case 'dike': return 'Magma forces its way up a crack: dike' + L;
      case 'pluton': return 'A granite pluton' + L + ' rises from below';
      case 'surface': return 'Recent erosion shapes today\u2019s hill; the highway crew blasts the cut';
    }
    return '';
  }
  function scrubTo(v) {
    S.replay.v = v; S.replay.playing = false; $('bPlay').innerHTML = '&#9654;';
    renderReplay(true);
    clearTimeout(scrubTo.t);
    scrubTo.t = setTimeout(function () { if (S.mode === 'replay' && !S.replay.playing) renderReplay(false); }, 140);
  }

  function nextAfterSolve() {
    if (S.endless) { startEndless(); return; }
    if (S.level < NSTOPS) startStop(S.level + 1);
    else showEnd();
  }
  function showEnd() {
    var tot = save.stars.reduce(function (a, b) { return a + (b || 0); }, 0);
    $('endStars').innerHTML = '&#9733; ' + tot + ' / ' + NSTOPS * 3;
    $('endText').textContent = tot >= NSTOPS * 3 ? 'A perfect field season. Every cliff read on the first try.' :
      'You read ' + NSTOPS + ' cliffs and rewound billions of years of Earth history. Replay any stop from the road map to polish your stars, or keep driving: the endless road never runs out of rock.';
    $('endScreen').hidden = false;
    S.mode = 'end';
  }

  // ---------- title / map ----------
  function nextUnsolved() { for (var i = 0; i < NSTOPS; i++) if (!save.stars[i]) return i + 1; return 0; }
  function showTitle() {
    S.mode = 'title';
    var map = $('map'); map.textContent = '';
    var nu = nextUnsolved();
    for (var i = 0; i < NSTOPS; i++) {
      if (i) { var sg = document.createElement('div'); sg.className = 'seg'; map.appendChild(sg); }
      var st = save.stars[i] || 0, unlocked = i === 0 || save.stars[i - 1] || st;
      var b = document.createElement('button');
      b.className = 'stop' + (st ? ' done' : '') + (unlocked ? '' : ' locked');
      b.innerHTML = '<span class="dot">' + (i + 1) + '</span><span class="st">' + (st ? '\u2605'.repeat(st) : '') + '</span>';
      b.setAttribute('aria-label', 'Stop ' + (i + 1) + ': ' + STOPS[i].name + (st ? ', ' + st + ' stars' : unlocked ? '' : ', locked'));
      b.title = STOPS[i].name;
      (function (lv, ok) { b.addEventListener('click', function () { if (ok) { sfx.tap(); startStop(lv); } }); })(i + 1, unlocked);
      map.appendChild(b);
    }
    $('bStart').textContent = nu === 1 ? 'Start the road trip' : nu ? 'Continue: stop ' + nu : 'Drive the trip again';
    $('title').hidden = false;
    // background cliff
    if (!S.puzzle) { S.puzzle = Geo.generate('title', 6); sizeCanvas(); computeStatic(); draw(); }
    updateHud();
  }
  function updateHud() {
    var tot = save.stars.reduce(function (a, b) { return a + (b || 0); }, 0);
    $('hStars').textContent = '\u2605 ' + tot + '/' + NSTOPS * 3;
    if (S.mode === 'title') $('hStop').textContent = 'A geology road trip';
    else if (S.endless) $('hStop').textContent = 'Endless road \u00b7 ' + (save.endless || 0) + ' solved' + (S.mistakes ? ' \u00b7 mistakes ' + S.mistakes : '');
    else $('hStop').textContent = 'Stop ' + S.level + '/' + NSTOPS + ' \u00b7 ' + STOPS[S.level - 1].name + (S.mistakes ? ' \u00b7 mistakes ' + S.mistakes : '');
    $('bMute').classList.toggle('off', !!save.muted);
  }

  function buildLegend() {
    var lg = $('legend'); lg.textContent = '';
    ['gneiss', 'sandstone', 'shale', 'limestone', 'conglomerate', 'siltstone', 'dolomite', 'redbed', 'coal', 'basalt', 'granite'].forEach(function (r, i) {
      var d = document.createElement('div');
      var c = swatch({ kind: 'deposit', rock: r }, i + 3, 34, 24);
      d.appendChild(c);
      var s = document.createElement('span'); s.textContent = Geo.ROCKS[r].name.replace(' dike', ''); d.appendChild(s);
      lg.appendChild(d);
    });
    var f = document.createElement('div'); f.appendChild(swatch({ kind: 'fault' }, 0, 34, 24)); f.appendChild(document.createTextNode('Fault (thin black line)')); lg.appendChild(f);
    var e = document.createElement('div'); e.appendChild(swatch({ kind: 'erosion' }, 0, 34, 24)); e.appendChild(document.createTextNode('Erosion surface (heavy line)')); lg.appendChild(e);
  }

  // ---------- input ----------
  cv.addEventListener('click', function (ev) {
    if (!S.puzzle || S.mode !== 'play' || !frame) return;
    var r = cv.getBoundingClientRect();
    var i = Math.floor((ev.clientX - r.left) / r.width * frame.w), j = Math.floor((ev.clientY - r.top) / r.height * frame.h);
    // labels first (tap target)
    var an = S.puzzle.analysis, best = -1, bd = 1e9;
    an.cards.forEach(function (c) {
      var L = an.labels[c]; if (!L) return;
      var p = w2c(L.x, L.y), dx = p[0] / cv.width * r.width - (ev.clientX - r.left), dy = p[1] / cv.height * r.height - (ev.clientY - r.top);
      var d = dx * dx + dy * dy; if (d < bd) { bd = d; best = c; }
    });
    if (bd > 22 * 22) best = Render.pickAt(frame, Math.max(0, Math.min(frame.w - 1, i)), Math.max(0, Math.min(frame.h - 1, j)), an.cards);
    S.hlA = S.hlB = -1;
    if (best < 0) { S.selected = -1; setInfo('Nothing to identify there (sky). Tap the rock.'); renderCards(); draw(); return; }
    select(best === S.selected ? -1 : best);
    if (S.selected < 0) setInfo('Tap the rock or a card to identify it.');
  });
  $('bUndo').addEventListener('click', function () { if (S.seq.length && !S.solved) removeCard(S.seq[S.seq.length - 1]); });
  $('bClear').addEventListener('click', function () { if (S.solved) return; S.seq = []; S.hlA = S.hlB = -1; setFeedback('', ''); sfx.remove(); renderCards(); draw(); });
  $('bHint').addEventListener('click', hint);
  $('bCheck').addEventListener('click', check);
  $('bPlay').addEventListener('click', function () {
    if (S.mode !== 'replay') return;
    if (S.replay.playing) { S.replay.playing = false; $('bPlay').innerHTML = '&#9654;'; renderReplay(false); return; }
    if (S.replay.v >= S.puzzle.events.length) S.replay.v = 0;
    S.replay.playing = true; S.replay.last = performance.now(); S.replay.lastK = -1; $('bPlay').innerHTML = '&#10074;&#10074;';
    requestAnimationFrame(tick);
  });
  $('scrub').addEventListener('input', function () { if (S.mode === 'replay') scrubTo(this.value / 1000 * S.puzzle.events.length); });
  $('bNext').addEventListener('click', function () { sfx.tap(); nextAfterSolve(); });
  $('bStart').addEventListener('click', function () { audio(); var nu = nextUnsolved(); startStop(nu || 1); });
  $('bEndless').addEventListener('click', function () { audio(); startEndless(); });
  $('bHome').addEventListener('click', function () { if (S.mode === 'replay') S.mode = 'play'; showTitle(); });
  function openGuide() { $('guide').hidden = false; }
  $('bGuide').addEventListener('click', openGuide);
  $('bGuide2').addEventListener('click', openGuide);
  $('bGuideClose').addEventListener('click', function () { $('guide').hidden = true; });
  $('guide').addEventListener('click', function (e) { if (e.target === this) this.hidden = true; });
  $('bMute').addEventListener('click', function () {
    save.muted = !save.muted; persist(); updateHud();
    if (AC) { if (save.muted) AC.suspend(); else AC.resume(); }
    if (!save.muted) sfx.tap();
  });
  $('bEndEndless').addEventListener('click', function () { startEndless(); });
  $('bEndMap').addEventListener('click', function () { $('endScreen').hidden = true; showTitle(); });
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (!$('guide').hidden) { if (e.key === 'Escape') $('guide').hidden = true; return; }
    if (S.mode === 'replay') {
      if (e.key === ' ') { e.preventDefault(); $('bPlay').click(); }
      else if (e.key === 'Enter') $('bNext').click();
      return;
    }
    if (S.mode !== 'play') return;
    if (e.key === 'Backspace') { e.preventDefault(); $('bUndo').click(); return; }
    if (e.key === 'Enter') { e.preventDefault(); if (!$('bCheck').disabled) check(); return; }
    if (e.key === '?') { openGuide(); return; }
    var k = e.key.toUpperCase();
    if (k.length === 1 && k >= 'A' && k <= 'Z') {
      var c = S.puzzle.analysis.cards.filter(function (c) { return S.puzzle.events[c].letter === k; })[0];
      if (c !== undefined) { if (S.seq.indexOf(c) < 0) addCard(c); else select(c); }
    }
  });
  var rT = 0;
  window.addEventListener('resize', function () {
    clearTimeout(rT);
    rT = setTimeout(function () {
      var changed = sizeCanvas();
      if (S.mode === 'replay' && S.replay.v < S.puzzle.events.length) renderReplay(false);
      else { if (changed || !frame) computeStatic(); draw(); }
    }, 120);
  });

  // ---------- boot ----------
  buildLegend();
  updateHud();
  if (SELFTEST) runSelftest();
  else if (DEMO) runDemo(DEMO);
  else if (params.get('seed')) { $('title').hidden = true; startEndless(params.get('seed')); }
  else showTitle();

  function runDemo(kind) {
    save.muted = true;
    startStop(6);
    var tr = Geo.trueOrder(S.puzzle);
    if (kind === 'replay') {
      tr.forEach(addCard); check();
      S.replay.playing = false; S.replay.v = S.puzzle.events.length * 0.55; renderReplay(false);
      $('bPlay').innerHTML = '&#9654;';
    } else {
      tr.slice(0, 4).forEach(addCard);
      select(tr[5], true);
    }
  }

  // ---------- in-page self test ----------
  function runSelftest() {
    save.muted = true;
    var out = [], pass = 0, fail = 0;
    function t(name, fn) {
      try { var r = fn(); if (r === false) throw new Error('returned false'); pass++; out.push('ok ' + name); }
      catch (e) { fail++; out.push('FAIL ' + name + ': ' + (e && e.message)); }
    }
    t('all campaign stops generate and accept the true order', function () {
      for (var lv = 1; lv <= NSTOPS; lv++) {
        var p = Geo.generate('stop' + lv, lv);
        if (!p) throw new Error('stop ' + lv + ' failed');
        if (!Geo.check(p, Geo.trueOrder(p)).ok) throw new Error('stop ' + lv + ' rejects truth');
      }
    });
    t('play stop 1 by tapping chips in the true order', function () {
      startStop(1);
      var tr = Geo.trueOrder(S.puzzle);
      tr.forEach(function (c) { var b = $('pool').querySelector('[data-idx="' + c + '"]'); if (!b) throw new Error('chip missing'); b.click(); });
      if ($('bCheck').disabled) throw new Error('check disabled when full');
      $('bCheck').click();
      if (!S.solved || S.mode !== 'replay') throw new Error('not solved');
      if ($('replayBar').hidden) throw new Error('replay bar hidden');
      return save.stars[0] === 3;
    });
    t('replay renders every event at several progress values', function () {
      var n = S.puzzle.events.length;
      S.replay.playing = false;
      for (var v = 0; v <= n; v += 0.37) { S.replay.v = v; renderReplay(true); }
      S.replay.v = n; renderReplay(false);
      return /Today/.test($('clock').textContent);
    });
    t('wrong order is rejected with an explanation and highlights', function () {
      startStop(3);
      var tr = Geo.trueOrder(S.puzzle).reverse();
      tr.forEach(function (c) { $('pool').querySelector('[data-idx="' + c + '"]').click(); });
      $('bCheck').click();
      if (S.solved) throw new Error('reversed order accepted');
      if (S.mistakes !== 1) throw new Error('mistake not counted');
      if (!/must come before/.test($('feedback').textContent)) throw new Error('no explanation');
      if (S.hlA < 0 || S.hlB < 0) throw new Error('no highlight');
      return $('seq').querySelectorAll('.hlA, .hlB').length === 2;
    });
    t('undo, clear and hint work', function () {
      var before = S.seq.length;
      $('bUndo').click(); if (S.seq.length !== before - 1) throw new Error('undo');
      $('bClear').click(); if (S.seq.length) throw new Error('clear');
      $('bHint').click(); if (S.hints !== 1 || !/Clue/.test($('feedback').textContent)) throw new Error('hint');
      $('bHint').click(); return $('bHint').disabled;
    });
    t('tapping the cliff identifies a unit', function () {
      var r = cv.getBoundingClientRect(), L = S.puzzle.analysis.labels, c = S.puzzle.analysis.cards[0];
      var key = Object.keys(L)[0], p = w2c(L[key].x, L[key].y);
      cv.dispatchEvent(new MouseEvent('click', { clientX: r.left + p[0] / cv.width * r.width, clientY: r.top + p[1] / cv.height * r.height, bubbles: true }));
      return S.selected === +key && /\u00b7/.test($('info').textContent);
    });
    t('endless mode with a fixed seed is reproducible', function () {
      startEndless('abc123'); var a = JSON.stringify(S.puzzle.events);
      startEndless('abc123'); return a === JSON.stringify(S.puzzle.events) && S.puzzle.analysis.cards.length >= 6;
    });
    t('keyboard: letters add cards, Backspace undoes', function () {
      var c = S.puzzle.analysis.cards[0], L = S.puzzle.events[c].letter;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: L.toLowerCase() }));
      if (S.seq[0] !== c) throw new Error('letter');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace' }));
      return S.seq.length === 0;
    });
    t('finishing stop 8 shows the end screen', function () {
      startStop(8);
      Geo.trueOrder(S.puzzle).forEach(addCard); check();
      $('bNext').click();
      return !$('endScreen').hidden && /24/.test($('endStars').textContent);
    });
    var el = $('selftest');
    el.hidden = false;
    el.textContent = (fail ? 'SELFTEST FAIL ' : 'SELFTEST PASS ') + pass + '/' + (pass + fail) + '\n' + out.join('\n');
    el.style.cssText = 'position:fixed;left:0;bottom:0;z-index:99;background:#fff;white-space:pre;font:12px monospace;padding:6px;border:2px solid #000';
  }
})();
