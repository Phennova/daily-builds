// Pregroove: game UI. Depends on disc.js (window.Disc).
(function () {
  'use strict';
  var D = window.Disc, TAU = Math.PI * 2;
  function $(id) { return document.getElementById(id); }
  var Q = new URLSearchParams(location.search);
  var reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function fmtTime(sec) { sec = Math.max(0, Math.floor(sec)); return Math.floor(sec / 60) + ':' + ('0' + sec % 60).slice(-2); }
  var toastT = 0;
  function toast(msg, ms) {
    var t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('show'); }, ms || 2600);
  }

  // ================= audio =================
  var AC = null, muted = false;
  try { muted = localStorage.getItem('pregroove-muted') === '1'; } catch (e) { }
  var gestured = false; // browsers only allow audio after a user gesture; never try before one
  ['pointerdown', 'keydown'].forEach(function (ev) { window.addEventListener(ev, function () { gestured = true; }, { capture: true, once: true }); });
  function ac() {
    if (!gestured) return null;
    if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { AC = null; } }
    if (AC && AC.state === 'suspended') AC.resume();
    return AC;
  }
  function tone(f, dur, type, gain, delay, f2) {
    if (muted) return; var a = ac(); if (!a) return;
    var t = a.currentTime + (delay || 0), o = a.createOscillator(), g = a.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain || 0.08, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
  }
  var lastTick = 0;
  function tick(step) {
    var now = performance.now(); if (now - lastTick < 35) return; lastTick = now;
    tone(1800 + (step || 0) * 260, 0.025, 'square', 0.018);
  }
  function chime() { [523, 659, 784, 1047].forEach(function (f, i) { tone(f, 0.5, 'sine', 0.07, i * 0.09); tone(f * 2, 0.3, 'sine', 0.015, i * 0.09); }); }
  function buzz() { tone(140, 0.22, 'sawtooth', 0.05, 0, 90); }
  function blip() { tone(880, 0.07, 'triangle', 0.05); }
  var listenSrc = null;
  // Play the actual frames: each frame = 6 stereo samples of the byte pattern that burns dark (0x0D0D) or clear (0xAAAA)
  function listen(n0) {
    var a = ac(); if (!a || !S.burn) return;
    if (muted) { toast('Sound is muted (the note button, top right).'); return; }
    if (listenSrc) { try { listenSrc.stop(); } catch (e) { } listenSrc = null; }
    var frames = Math.floor(D.FPS * 2.2), sr = 44100, buf = a.createBuffer(1, frames * 6, sr), ch = buf.getChannelData(0);
    var DARK = 0x0D0D / 32768, CLEAR = (0xAAAA - 65536) / 32768, mean = 0, i, k;
    for (i = 0; i < frames; i++) {
      var v = D.frame(S.burn, n0 + i), s = v === 1 ? DARK : v === 0 ? CLEAR : 0;
      for (k = 0; k < 6; k++) ch[i * 6 + k] = s;
      mean += s * 6;
    }
    mean /= ch.length;
    var hp = 0, prev = 0, len = ch.length;
    for (i = 0; i < len; i++) { var x = ch[i] - mean; hp = 0.995 * (hp + x - prev); prev = x; ch[i] = hp * 0.32; }
    for (i = 0; i < 2000; i++) { ch[i] *= i / 2000; ch[len - 1 - i] *= i / 2000; }
    var src = a.createBufferSource(); src.buffer = buf; src.connect(a.destination); src.start(); listenSrc = src;
    var t = { r: 0, th: 0 }; D.forward(S.burn.g, n0, t);
    toast('Playing the track at ' + fmtTime(n0 / D.FPS) + '. The flutter is the disc turning, about ' + (S.burn.g.v / (TAU * t.r)).toFixed(1) + ' times a second.', 4200);
  }

  // ================= hidden picture =================
  var PIC_PX = 1000, PIC_MM = 120, K = PIC_PX / PIC_MM; // px per mm
  var BANDS = [{ id: 'hub', r: 28.5, w: 2.6, tick: 0.085 }, { id: 'mid', r: 36, w: 1.4, tick: 0.055 }, { id: 'rim', r: 53, w: 1.4, tick: 0.04 }];
  var TICKS = [0, 0.61, 1.05, 1.9, 2.42, 3.3, 3.74, 4.6, 5.52]; // irregular, so the ring offset is unambiguous
  var FONT = 'ui-monospace, "Cascadia Mono", Consolas, Menlo, monospace';
  function arcText(ctx, text, rmm, hmm, top, weight) {
    var R = rmm * K, cx = PIC_PX / 2, cy = PIC_PX / 2;
    ctx.font = (weight || 'bold') + ' ' + Math.round(hmm * K / 0.72) + 'px ' + FONT;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    var ws = [], tot = 0, gap = hmm * K * 0.12;
    for (var i = 0; i < text.length; i++) { var w = ctx.measureText(text[i]).width + gap; ws.push(w); tot += w; }
    var span = tot / R, cum = 0;
    for (i = 0; i < text.length; i++) {
      var mid = (cum + ws[i] / 2) / R, al;
      if (top) al = -Math.PI / 2 - span / 2 + mid; else al = Math.PI / 2 + span / 2 - mid;
      ctx.save(); ctx.translate(cx + R * Math.cos(al), cy + R * Math.sin(al));
      ctx.rotate(top ? al + Math.PI / 2 : al - Math.PI / 2);
      ctx.fillText(text[i], 0, 0); ctx.restore();
      cum += ws[i];
    }
  }
  function makePicture(spec) {
    var cv = document.createElement('canvas'); cv.width = cv.height = PIC_PX;
    var ctx = cv.getContext('2d'), c = PIC_PX / 2;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, PIC_PX, PIC_PX);
    ctx.fillStyle = '#000'; ctx.strokeStyle = '#000';
    if (spec.ticks) {
      BANDS.forEach(function (b) {
        TICKS.forEach(function (t) {
          ctx.beginPath();
          // ticks drawn in disc-math angle t (counter-clockwise, y up) -> canvas angle -t
          ctx.arc(c, c, (b.r + b.w / 2) * K, -t - b.tick / 2, -t + b.tick / 2);
          ctx.arc(c, c, (b.r - b.w / 2) * K, -t + b.tick / 2, -t - b.tick / 2, true);
          ctx.closePath(); ctx.fill();
        });
      });
      // thin guide circles bracketing the hub band
      ctx.lineWidth = 0.35 * K;
      [25.6, 31.4].forEach(function (r) { ctx.beginPath(); ctx.arc(c, c, r * K, 0, TAU); ctx.stroke(); });
    }
    if (!spec.ticks) { // no calibration ticks: faint burn-in dashes (decor, but they also give the echo something to lock onto at every radius)
      var dr = D.mulberry32(77);
      for (var q = 0; q < 9000; q++) {
        var rr = 26.2 + dr() * 31, a0 = dr() * TAU, sz = (0.25 + dr() * 0.3) * K;
        if ((rr > 39.5 && rr < 48.5) || rr > 53.6) continue;
        ctx.fillRect(c + rr * K * Math.cos(a0), c - rr * K * Math.sin(a0), sz, sz);
      }
    }
    arcText(ctx, spec.flag, 44, spec.small ? 5.2 : 6.6, true);
    if (spec.line2) arcText(ctx, spec.line2, 43.6, 4.2, false);
    if (spec.title) arcText(ctx, spec.title, 56.3, 2.6, true, '600');
    if (spec.title2) arcText(ctx, spec.title2, 56.1, 2.6, false, '600');
    var img = ctx.getImageData(0, 0, PIC_PX, PIC_PX).data, raster = new Uint8Array(PIC_PX * PIC_PX);
    for (var i = 0; i < raster.length; i++) raster[i] = 255 - img[i * 4];
    function pic(x, y) {
      var ix = ((x + 60) * K) | 0, iy = ((60 - y) * K) | 0;
      if (ix < 0 || iy < 0 || ix >= PIC_PX || iy >= PIC_PX) return 0;
      return raster[iy * PIC_PX + ix] / 255;
    }
    return { pic: pic, raster: raster };
  }

  // ================= levels =================
  var LEVELS = [
    { name: 'Factory spec', unknown: ['v'], start: { v: 3.5e-5 }, ticks: true, noise: 0, drift: false, readout: true,
      text: 'A courier\'s disc on a common brand. The rip came with the brand geometry, but this burner ran a hair fast. The tick rings bow and smear when the velocity is off. Drag the v strip, watch the hub ticks straighten and the ring offsets go to zero, then read the flag on the upper arc.' },
    { name: 'Off-brand', unknown: ['v'], ticks: true, noise: 0, drift: false, readout: true,
      text: 'Unknown dye, unknown speed: the picture is noise. Open the lag scope. Neighbouring turns of the spiral carry the same picture, so the stream echoes itself once per revolution. Take a reading, fit v, then finish by eye with the fine steps.' },
    { name: 'Second source', unknown: ['v', 'p'], ticks: true, noise: 0, drift: false, readout: true,
      text: 'Velocity and track pitch are both unknown, and they trade off against each other: one reading cannot separate them. Take readings spread across the whole disc, fit both, then null the ring offsets. Pitch errors grow towards the rim faster than velocity errors.' },
    { name: 'Zoned pitch', unknown: ['v', 'p'], ticks: true, noise: 0, drift: true, readout: true,
      text: 'This burn is on a drifting pitch: it widens across the disc, and the drift (ppm per mm) is printed on the label because the model needs it. The echo lag now bends with radius. Take readings spread across the disc, fit v and p, then balance hub, mid and rim.' },
    { name: 'Worn CD-RW', unknown: ['v', 'p', 'phi0'], ticks: false, noise: 0.1, drift: false, readout: false, small: true,
      text: 'Rewritten a hundred times: one frame in ten is flipped, there are no calibration ticks, and the start angle is lost, so the picture may come out rotated. Scope, fit, then trust your eyes. Smaller print, too.' }
  ];
  var PARAMS = {
    v: { label: 'v', desc: 'linear velocity', unit: 'm/s', k: 1e-3, dec: 9, steps: [1e-3, 1e-4, 1e-5, 1e-6, 1e-7] },
    p: { label: 'p', desc: 'track pitch', unit: '\u00b5m', k: 1e3, dec: 7, steps: [1e-2, 1e-3, 1e-4, 1e-5, 1e-6] },
    a: { label: 'drift', desc: 'pitch drift', unit: 'ppm/mm', k: 1e6, dec: 3, steps: [100, 10, 1, 0.1, 0.01] },
    phi0: { label: '\u03c60', desc: 'start angle', unit: '\u00b0', k: 180 / Math.PI, dec: 2, steps: [10, 1, 0.1, 0.01] }
  };
  var LABELS = ['PIRATE RADIO KESTREL \u00b7 2031', 'NOT FOR BROADCAST \u00b7 SIDE A', 'CARRIER NIGHT \u00b7 RELAY 9', 'NO NETWORK \u00b7 NO TRACE', 'LAST COPY \u00b7 BURN AFTER READING'];

  var S = { li: 0, results: [], drop: null };

  function setupLevel(li, dropSpec, tryNo, seedIn) {
    tryNo = tryNo || 0;
    var L = dropSpec ? dropSpec.level : LEVELS[li];
    var seed = seedIn != null ? seedIn : dropSpec ? dropSpec.seed : (Q.get('seed') ? D.strSeed(Q.get('seed') + ':' + li) : (Math.random() * 4294967296) >>> 0);
    var rng = D.mulberry32(seed);
    var truth = D.randomTruth(rng, L.drift);
    if (!L.unknown.includes('phi0')) truth.phi0 = 0; // label orientation known: picture comes out upright
    var flag = dropSpec ? dropSpec.msg.toUpperCase() : D.makeFlag(rng);
    var picture = makePicture({
      flag: flag, small: L.small, ticks: L.ticks,
      line2: dropSpec ? 'DEAD DROP' : 'DROP ' + (li + 1) + ' OF 5',
      title: LABELS[dropSpec ? 0 : li], title2: dropSpec ? 'CALIBRATE TO READ' : 'CASE ' + (1000 + Math.floor(rng() * 9000))
    });
    var burn = D.makeBurn(truth, picture.pic, { noise: L.noise, seed: seed });
    if (!dropSpec && tryNo < 20 && !Q.has('noVet')) { // re-roll discs where an ordinary 8-reading scope fit leaves too much twist to finish by eye
      var vg = Object.assign({}, truth), vk = L.unknown.filter(function (k) { return k !== 'phi0'; }), vr = [];
      vk.forEach(function (k) { vg[k] = D.NOMINAL[k]; });
      for (var fr = 0.05; fr < 0.97; fr += 0.04) { var vm = D.measureLag(burn, Math.floor(burn.nEnd * fr)); if (vm.peak) vr.push({ n: vm.n, L: vm.peak.lag }); }
      var vf = vr.length >= vk.length + 2 ? D.fitRobust(vr, vg, vk) : null, vt = 99;
      if (vf) { vt = 0; for (var rr = 27; rr <= 57; rr += 3) vt = Math.max(vt, Math.abs(D.twistAt(truth, vf, rr))); }
      if (vt > (L.readout ? 1.5 : 1.0)) return setupLevel(li, dropSpec, tryNo + 1, D.hash32(seed + tryNo + 1) >>> 0);
    }
    var guess = Object.assign({}, truth);
    L.unknown.forEach(function (k) {
      if (L.start && L.start[k]) guess[k] = truth[k] * (1 + (rng() < 0.5 ? -1 : 1) * L.start[k]);
      else guess[k] = D.NOMINAL[k];
    });
    S.L = L; S.li = li; S.truth = truth; S.guess = guess; S.start = Object.assign({}, guess); S.burn = burn;
    S.picture = picture; S.flag = flag; S.readings = []; S.wrong = 0; S.t0 = performance.now(); S.solved = false;
    S.focus = L.unknown[0]; S.steps = {};
    L.unknown.forEach(function (k) { S.steps[k] = k === 'v' ? (L.start && L.start.v ? 2 : 1) : (k === 'phi0' ? 0 : 1); });
    S.templates = L.readout ? BANDS.map(function (b) { return ringTemplate(b); }) : null;
    S.offsets = null;
  }

  // ================= bench UI =================
  function digits(k, val) {
    var P = PARAMS[k], d = val * P.k, s = d.toFixed(P.dec), step = P.steps[S.steps[k]];
    var sd = Math.max(0, Math.round(-Math.log10(step))), dot = s.indexOf('.');
    var cut = dot < 0 ? s.length : dot + (sd ? sd + 1 : 0);
    return '<span class="hi">' + s.slice(0, cut) + '</span><span class="lo">' + s.slice(cut) + '</span>';
  }
  function buildParams() {
    var box = $('params'); box.innerHTML = '';
    S.L.unknown.forEach(function (k) {
      var P = PARAMS[k], row = document.createElement('div');
      row.className = 'param'; row.dataset.k = k;
      row.innerHTML = '<div class="pHead"><span class="pName">' + P.label + '</span><span class="pDesc">' + P.desc + '</span>' +
        '<span class="pVal"></span> <span class="pDesc" style="flex:0">' + P.unit + '</span></div>' +
        '<div class="pCtl"><button class="minus" aria-label="decrease ' + P.desc + '">&minus;</button><div class="jog" role="slider" aria-label="jog ' + P.desc + '"></div>' +
        '<button class="plus" aria-label="increase ' + P.desc + '">+</button></div><div class="steps"></div>';
      box.appendChild(row);
      var st = row.querySelector('.steps');
      P.steps.forEach(function (s, i) {
        var b = document.createElement('button'); b.textContent = '\u00b1' + (s >= 1 ? s : s.toExponential(0).replace('e', 'e'));
        b.addEventListener('click', function () { S.steps[k] = i; S.focus = k; refreshParams(); blip(); });
        st.appendChild(b);
      });
      row.addEventListener('pointerdown', function () { if (S.focus !== k) { S.focus = k; refreshParams(); } });
      holdRepeat(row.querySelector('.minus'), function () { jog(k, -1); });
      holdRepeat(row.querySelector('.plus'), function () { jog(k, 1); });
      bindJog(row.querySelector('.jog'), k);
    });
    var known = ['v', 'p', 'a', 'phi0'].filter(function (k) { return S.L.unknown.indexOf(k) < 0 && (k !== 'a' || S.L.drift); });
    var kn = document.createElement('p'); kn.className = 'fine'; kn.style.margin = '0';
    kn.innerHTML = 'From the label: ' + known.map(function (k) { return PARAMS[k].label + ' = ' + (S.truth[k] * PARAMS[k].k).toFixed(k === 'phi0' ? 0 : PARAMS[k].dec) + ' ' + PARAMS[k].unit; }).join(', ') +
      (S.L.drift ? '' : ', no pitch drift') + '. Start radius 25 mm (Red Book).';
    box.appendChild(kn);
    refreshParams();
  }
  function refreshParams() {
    document.querySelectorAll('.param').forEach(function (row) {
      var k = row.dataset.k;
      row.querySelector('.pVal').innerHTML = digits(k, S.guess[k]);
      row.classList.toggle('focus', S.focus === k);
      row.querySelectorAll('.steps button').forEach(function (b, i) { b.classList.toggle('sel', i === S.steps[k]); });
    });
  }
  function jog(k, nSteps) {
    var P = PARAMS[k], step = P.steps[S.steps[k]] / P.k;
    S.guess[k] += nSteps * step;
    if (k === 'phi0') { S.guess.phi0 = ((S.guess.phi0 + Math.PI) % TAU + TAU) % TAU - Math.PI; }
    if (k === 'v') S.guess.v = clamp(S.guess.v, 900, 1800);
    if (k === 'p') S.guess.p = clamp(S.guess.p, 0.0012, 0.0021);
    if (k === 'a') S.guess.a = clamp(S.guess.a, -0.005, 0.005);
    S.focus = k; refreshParams(); tick(S.steps[k]); requestRender(true);
  }
  function holdRepeat(btn, fn) {
    var t1 = 0, t2 = 0;
    function stop() { clearTimeout(t1); clearInterval(t2); }
    btn.addEventListener('pointerdown', function (e) {
      e.preventDefault(); fn(); stop();
      t1 = setTimeout(function () { t2 = setInterval(fn, 70); }, 380);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) { btn.addEventListener(ev, stop); });
  }
  function bindJog(el, k) {
    var active = false, lastX = 0, acc = 0;
    el.addEventListener('pointerdown', function (e) {
      active = true; lastX = e.clientX; acc = 0; el.classList.add('active');
      try { el.setPointerCapture(e.pointerId); } catch (er) { }
      e.preventDefault();
    });
    el.addEventListener('pointermove', function (e) {
      if (!active) return;
      acc += (e.clientX - lastX) / 9; lastX = e.clientX;
      var whole = acc > 0 ? Math.floor(acc) : Math.ceil(acc);
      if (whole) { acc -= whole; jog(k, whole); el.style.backgroundPosition = (e.clientX % 12) + 'px 0'; }
    });
    function end() { active = false; el.classList.remove('active'); }
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  }

  // ================= decoded view =================
  var view = $('viewCv'), vctx = view.getContext('2d');
  var buf = document.createElement('canvas'), bctx = buf.getContext('2d');
  var LUT = (function () {
    var lut = new Uint8ClampedArray(257 * 3), c0 = [214, 236, 230], c1 = [38, 26, 74];
    for (var i = 0; i <= 256; i++) { var t = i / 256; for (var j = 0; j < 3; j++) lut[i * 3 + j] = c0[j] + (c1[j] - c0[j]) * t; }
    return lut;
  })();
  var R = { dirty: false, fastUntil: 0, job: null, out: null, size: 0 };
  function viewRes() { var w = view.getBoundingClientRect().width || 480; return clamp(Math.round(w * Math.min(2, window.devicePixelRatio || 1)), 240, 760); }
  function requestRender(fast) {
    R.dirty = true; if (fast) R.fastUntil = performance.now() + 220;
    R.job = null;
  }
  function paint(out, size) {
    if (buf.width !== size) { buf.width = buf.height = size; }
    var img = bctx.createImageData(size, size), d = img.data;
    for (var i = 0, j = 0; i < out.length; i++, j += 4) {
      var v = out[i];
      if (v < 0) { d[j] = 9; d[j + 1] = 11; d[j + 2] = 17; d[j + 3] = 255; continue; }
      var q = (v * 256) | 0; q *= 3;
      d[j] = LUT[q]; d[j + 1] = LUT[q + 1]; d[j + 2] = LUT[q + 2]; d[j + 3] = 255;
    }
    bctx.putImageData(img, 0, 0);
    var W = view.width; if (W !== viewRes()) { W = view.width = view.height = viewRes(); }
    vctx.imageSmoothingEnabled = true;
    vctx.fillStyle = '#05060a'; vctx.fillRect(0, 0, W, W);
    vctx.drawImage(buf, 0, 0, W, W);
    // rim and data-start guides
    vctx.strokeStyle = 'rgba(127,224,208,0.25)'; vctx.lineWidth = Math.max(1, W / 480);
    [25, 58].forEach(function (r) { vctx.beginPath(); vctx.arc(W / 2, W / 2, r / 120 * W, 0, TAU); vctx.stroke(); });
  }
  function frameLoop() {
    var now = performance.now();
    if (S.L && !$('bench').hidden) {
      if (R.dirty) {
        R.dirty = false;
        var fast = now < R.fastUntil;
        var size = fast ? Math.min(viewRes(), 340) : Math.min(viewRes(), 400);
        var out = new Float32Array(size * size);
        D.decode(S.burn, S.guess, size, 1, out);
        paint(out, size);
        if (!fast) { R.job = { size: viewRes(), y: 0, out: null, at: now + 140 }; updateReadout(); }
        else R.fastPending = true;
      } else if (R.fastPending && now > R.fastUntil) {
        R.fastPending = false; R.dirty = true; R.fastUntil = 0;
      } else if (R.job && now >= R.job.at) {
        var J = R.job;
        if (!J.out) J.out = new Float32Array(J.size * J.size);
        var t0 = performance.now();
        while (J.y < J.size && performance.now() - t0 < 10) {
          var y1 = Math.min(J.size, J.y + 8);
          D.decode(S.burn, S.guess, J.size, 2, J.out, 120, J.y, y1); J.y = y1;
        }
        if (J.y >= J.size) { paint(J.out, J.size); R.job = null; }
      }
      $('timer').textContent = fmtTime(((S.solved ? S.tSolve : now) - S.t0) / 1000);
    }
    requestAnimationFrame(frameLoop);
  }

  // ring readout: circular cross-correlation of the decoded ring against the known tick pattern
  var RING_N = 720;
  function ringTemplate(b) {
    var t = new Float32Array(RING_N), m = 0;
    for (var j = 0; j < RING_N; j++) {
      var ph = j * TAU / RING_N, s = 0;
      for (var q = -1; q <= 1; q++) { var r = b.r + q * b.w * 0.3; s += S.picture.pic(r * Math.cos(ph), r * Math.sin(ph)); }
      t[j] = s / 3; m += t[j];
    }
    m /= RING_N; for (j = 0; j < RING_N; j++) t[j] -= m;
    return t;
  }
  function ringOffset(bi) {
    var b = BANDS[bi], T = S.templates[bi], d = new Float32Array(RING_N), m = 0, j, cnt = 0;
    for (j = 0; j < RING_N; j++) {
      var ph = j * TAU / RING_N, s = 0, c = 0;
      for (var q = -1; q <= 1; q++) {
        var r = b.r + q * b.w * 0.3, n = D.inverse(S.guess, r, ph), v = n < 0 ? -1 : D.frame(S.burn, n);
        if (v >= 0) { s += v; c++; }
      }
      d[j] = c ? s / c : 0.5; m += d[j]; cnt += c;
    }
    if (!cnt) return null;
    m /= RING_N; var dd = 0, tt = 0;
    for (j = 0; j < RING_N; j++) { d[j] -= m; dd += d[j] * d[j]; tt += T[j] * T[j]; }
    var best = -1e9, bm = 0, cc = new Float32Array(RING_N);
    for (var sh = 0; sh < RING_N; sh++) {
      var s2 = 0;
      for (j = 0; j < RING_N; j++) { var jj = j + sh; if (jj >= RING_N) jj -= RING_N; s2 += d[j] * T[jj]; }
      cc[sh] = s2; if (s2 > best) { best = s2; bm = sh; }
    }
    var a = cc[(bm + RING_N - 1) % RING_N], z = cc[(bm + 1) % RING_N], den = a - 2 * best + z;
    var off = den ? 0.5 * (a - z) / den : 0;
    var ang = (bm + clamp(off, -0.5, 0.5)) * TAU / RING_N; if (ang > Math.PI) ang -= TAU;
    return { off: ang, q: best / Math.sqrt(dd * tt + 1e-12) };
  }
  function updateReadout() {
    var note = $('viewNote');
    if (!S.templates) { note.textContent = 'decoded with your geometry'; return; }
    S.offsets = BANDS.map(function (b, i) { return ringOffset(i); });
    note.innerHTML = 'ring offsets ' + S.offsets.map(function (o, i) {
      var id = BANDS[i].id;
      if (!o || o.q < 0.35) return id + ' <span style="color:#ff8a6b">no lock</span>';
      var a = Math.abs(o.off), col = a < 0.03 ? '#9be37a' : a < 0.25 ? '#ffd27f' : '#ff8a6b';
      return id + ' <span style="color:' + col + '">' + (o.off >= 0 ? '+' : '\u2212') + a.toFixed(2) + '</span>';
    }).join(' \u00b7 ') + ' rad';
  }

  // ================= lag scope =================
  var scopeCv = $('scopeCv'), sctx = scopeCv.getContext('2d'), scopeT = 0, lastScope = null;
  function scopeN() { return Math.floor(+$('scopePos').value * S.burn.nEnd); }
  function updateScope() {
    var n0 = scopeN();
    $('scopePosLbl').textContent = fmtTime(n0 / D.FPS) + ' into the track (frame ' + n0.toLocaleString('en-US') + ')';
    clearTimeout(scopeT);
    scopeT = setTimeout(function () { lastScope = D.measureLag(S.burn, n0); drawScope(); }, 60);
  }
  function drawScope() {
    var W = scopeCv.width, H = scopeCv.height, m = lastScope, c = m.curve, L0 = D.SCOPE.Lmin, L1 = D.SCOPE.Lmax;
    sctx.fillStyle = '#080a10'; sctx.fillRect(0, 0, W, H);
    function X(L) { return (L - L0) / (L1 - L0) * W; }
    function Y(v) { return H - 14 - (v + 0.2) / 1.2 * (H - 24); }
    sctx.strokeStyle = '#1d2533'; sctx.lineWidth = 1; sctx.font = '11px ' + FONT; sctx.fillStyle = '#56627a';
    for (var L = 800; L < L1; L += 400) { sctx.beginPath(); sctx.moveTo(X(L), 0); sctx.lineTo(X(L), H - 12); sctx.stroke(); sctx.fillText(L, X(L) - 12, H - 2); }
    sctx.beginPath(); sctx.moveTo(0, Y(0)); sctx.lineTo(W, Y(0)); sctx.stroke();
    // what your geometry predicts
    var pred = D.lagAt(S.guess, m.n);
    if (pred > L0 && pred < L1) {
      sctx.setLineDash([4, 4]); sctx.strokeStyle = '#c9a6ff'; sctx.beginPath(); sctx.moveTo(X(pred), 0); sctx.lineTo(X(pred), H - 12); sctx.stroke(); sctx.setLineDash([]);
    }
    sctx.strokeStyle = '#7fe0d0'; sctx.lineWidth = 1.4; sctx.beginPath();
    for (var i = 0; i < c.length; i += 2) { var x = X(L0 + i), y = Y(c[i]); if (i) sctx.lineTo(x, y); else sctx.moveTo(x, y); }
    sctx.stroke();
    var pk = m.peak, txt;
    if (pk) {
      sctx.fillStyle = '#ffd27f'; sctx.beginPath(); sctx.arc(X(pk.lag), Y(pk.corr), 4, 0, TAU); sctx.fill();
      txt = 'echo at ' + pk.lag.toFixed(2) + ' frames (corr ' + pk.corr.toFixed(2) + ')';
    } else txt = c.blank ? 'blank stretch of track: no picture, no echo' : 'no clear echo here';
    sctx.fillStyle = '#d9e2ea'; sctx.fillText(txt, 8, 14);
    sctx.fillStyle = '#c9a6ff'; sctx.fillText('dashed: your geometry predicts ' + pred.toFixed(2), 8, 28);
  }
  function fitKeys() { return S.L.unknown.filter(function (k) { return k !== 'phi0'; }); }
  function refreshReadings() {
    var r = S.readings;
    $('readings').textContent = r.length ? r.map(function (x, i) { return String.fromCharCode(65 + i) + ' ' + fmtTime(x.n / D.FPS) + ': ' + x.L.toFixed(2); }).join('  ') : 'No readings yet.';
    var need = fitKeys().length;
    $('estBtn').disabled = r.length < need;
    $('estBtn').textContent = 'Fit ' + fitKeys().map(function (k) { return PARAMS[k].label; }).join(', ') + ' (' + Math.min(r.length, need) + '/' + need + '+ readings)';
  }
  function takeReading() {
    if (!lastScope || !lastScope.peak) { toast('No clear echo at this position. Move the slider a little.'); buzz(); return; }
    var n = lastScope.n;
    if (S.readings.some(function (x) { return Math.abs(x.n - n) < 20000; })) { toast('Already have a reading here: spread them across the track.'); return; }
    S.readings.push({ n: n, L: lastScope.peak.lag });
    if (S.readings.length > 8) S.readings.shift();
    S.readings.sort(function (a, b) { return a.n - b.n; });
    blip(); refreshReadings();
  }
  function doFit() {
    var keys = fitKeys(), f = D.fitRobust(S.readings, S.guess, keys);
    if (!f) { toast('Fit failed: need more readings.'); buzz(); return; }
    if (f.dropped.length) {
      S.readings = S.readings.filter(function (x) { return f.dropped.indexOf(x) < 0; });
      refreshReadings();
      toast('Dropped ' + f.dropped.length + ' reading' + (f.dropped.length > 1 ? 's' : '') + ' that did not fit (probably a half-turn echo).', 3600);
    }
    keys.forEach(function (k) { S.guess[k] = f[k]; });
    $('estNote').textContent = 'fit rms ' + f.rms.toFixed(3) + ' frames over ' + S.readings.length + ' readings';
    refreshParams(); requestRender(); drawScope(); chimeSmall();
    toast('Fitted. Now finish by eye with the finer steps.');
  }
  function chimeSmall() { tone(660, 0.15, 'sine', 0.06); tone(990, 0.2, 'sine', 0.05, 0.08); }

  // ================= flag / reveal =================
  function submitFlag(e) {
    e.preventDefault();
    var v = $('flagIn').value, msg = $('flagMsg');
    if (!D.normFlag(v)) { msg.textContent = 'Type what the upper arc says.'; msg.className = 'bad'; return; }
    if (D.normFlag(v) === D.normFlag(S.flag)) { solve(); return; }
    S.wrong++; buzz(); msg.className = 'bad';
    msg.textContent = 'Not it. Letters smear first where the twist is worst; get the offsets nearer zero and look again.';
  }
  function residual() {
    var w = 0;
    for (var r = 27; r <= 57; r += 3) w = Math.max(w, Math.abs(D.twistAt(S.truth, S.guess, r)));
    return w;
  }
  function solve() {
    S.solved = true; S.tSolve = performance.now(); chime();
    var secs = (S.tSolve - S.t0) / 1000, res = residual();
    S.results[S.li] = { name: S.L.name, secs: secs, wrong: S.wrong, res: res };
    $('flagMsg').textContent = ''; $('flagIn').value = '';
    $('revealTitle').textContent = S.drop ? 'Dead drop read' : 'Flag ' + S.flag + ' confirmed';
    var parts = [];
    S.L.unknown.forEach(function (k) {
      var P = PARAMS[k];
      parts.push(P.label + ' ' + (S.guess[k] * P.k).toFixed(P.dec - 2) + ' (true ' + (S.truth[k] * P.k).toFixed(P.dec - 2) + ')');
    });
    $('revealText').innerHTML = (S.drop ? 'The message: <b>' + escapeHtml(S.flag) + '</b>. ' : '') + 'Read in ' + fmtTime(secs) + (S.wrong ? ' with ' + S.wrong + ' wrong guess' + (S.wrong > 1 ? 'es' : '') : ' first try') +
      '. Worst remaining twist ' + res.toFixed(2) + ' rad.<br><span class="fine">' + parts.join(' \u00b7 ') + '</span><br>' +
      'This is what the courier\'s disc itself looks like: the picture lives in the dye, under the rainbow of the track grating.';
    $('nextBtn').textContent = S.drop ? 'Back to the title' : (S.li < LEVELS.length - 1 ? 'Next disc' : 'Debrief');
    show('reveal');
    startDiscAnim($('revealCv'), S.picture.raster, true);
  }
  // the dead-drop message comes from the URL, so it is escaped before going into innerHTML
  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function next() {
    stopDiscAnim();
    if (S.drop) { S.drop = null; history.replaceState(null, '', location.pathname + location.search); goTitle(); return; }
    if (S.li < LEVELS.length - 1) startLevel(S.li + 1); else showEnd();
  }
  function showEnd() {
    var tot = 0, rows = '<tr><th>Disc</th><th>Time</th><th>Wrong</th><th>Twist</th></tr>';
    S.results.forEach(function (r, i) { if (!r) return; tot += r.secs; rows += '<tr><td>' + (i + 1) + '. ' + r.name + '</td><td>' + fmtTime(r.secs) + '</td><td>' + r.wrong + '</td><td>' + r.res.toFixed(2) + '</td></tr>'; });
    $('endTable').innerHTML = rows;
    $('endText').textContent = 'Total ' + fmtTime(tot) + '. Every disc was a real 20,000-turn spiral; you found its geometry to about one part in a million from nothing but the rip.';
    show('end'); chime();
  }

  // ================= physical disc render (title + reveal) =================
  var anim = { id: 0, cv: null, pre: null, light: -0.6, target: -0.6, auto: true };
  function prepDisc(cv, raster) {
    var W = cv.width, n = W * W, rr = new Float32Array(n), ph = new Float32Array(n), dye = new Float32Array(n);
    for (var y = 0; y < W; y++) for (var x = 0; x < W; x++) {
      var i = y * W + x, mx = (x + 0.5) / W * 120 - 60, my = 60 - (y + 0.5) / W * 120;
      rr[i] = Math.sqrt(mx * mx + my * my); ph[i] = Math.atan2(my, mx);
      if (raster) {
        var ix = ((mx + 60) * K) | 0, iy = ((60 - my) * K) | 0;
        dye[i] = raster[iy * PIC_PX + ix] / 255;
      }
    }
    return { W: W, rr: rr, ph: ph, dye: dye, img: cv.getContext('2d').createImageData(W, W) };
  }
  function drawDisc(pre, light, burnedOnly) {
    var W = pre.W, d = pre.img.data, rr = pre.rr, ph = pre.ph, dye = pre.dye;
    var cl = Math.cos(light), sl = Math.sin(light);
    for (var i = 0, j = 0; i < rr.length; i++, j += 4) {
      var r = rr[i];
      if (r > 60 || r < 7.5) { d[j + 3] = 0; continue; }
      var a = ph[i], ca = Math.cos(a), sa = Math.sin(a);
      var along = ca * cl + sa * sl, perp = ca * sl - sa * cl; // position relative to the light axis
      var R0, G0, B0, al = 255;
      if (r < 16) { // clear polycarbonate hub
        var t = 0.35 + 0.25 * along; R0 = 120 * t + 60; G0 = 128 * t + 64; B0 = 140 * t + 70; al = r < 10.5 ? 120 : 190;
        if (r > 10.5 && r < 11.2) { R0 += 40; G0 += 40; B0 += 40; }
      } else {
        // base reflective layer: cool silver with a soft gradient along the light
        var base = 150 + 60 * along * (r / 60);
        R0 = base * 0.86; G0 = base * 0.92; B0 = base;
        if (r >= 22.5 && r <= 58.6) {
          // dye: phthalocyanine-ish pale green-gold; burned marks go dark violet-brown
          var dk = dye[i] * 0.85;
          R0 = R0 * (0.92 - 0.55 * dk) + 18 * dk; G0 = G0 * (0.98 - 0.62 * dk); B0 = B0 * (0.78 - 0.4 * dk) + 30 * dk;
          // first-order diffraction: rainbow band along the axis perpendicular to the light, hue by radius
          var band = Math.exp(-perp * perp * 26) * (0.55 + 0.45 * Math.abs(along));
          var hue = r * 0.16 + along * 2.2 + light;
          var k = band * (1 - 0.6 * dk) * 150;
          R0 += k * (0.5 + 0.5 * Math.cos(hue)); G0 += k * (0.5 + 0.5 * Math.cos(hue - 2.094)); B0 += k * (0.5 + 0.5 * Math.cos(hue + 2.094));
        }
        if (r > 58.6) { R0 *= 0.75; G0 *= 0.75; B0 *= 0.8; }
        if (r > 59.6) { al = 160; }
        // specular glint
        var sp = Math.exp(-((along - 0.7) * (along - 0.7)) * 40 - perp * perp * 60) * 70;
        R0 += sp; G0 += sp; B0 += sp;
      }
      d[j] = R0; d[j + 1] = G0; d[j + 2] = B0; d[j + 3] = al;
    }
    var ctx = (anim.cv || $('heroCv')).getContext('2d');
    ctx.clearRect(0, 0, W, W); ctx.putImageData(pre.img, 0, 0);
  }
  function startDiscAnim(cv, raster, spin) {
    stopDiscAnim();
    anim.cv = cv; anim.pre = prepDisc(cv, raster); anim.auto = true; anim.t0 = performance.now();
    function loop(now) {
      if (anim.auto && !reduced) anim.target = -0.6 + (now - anim.t0) / 2600;
      anim.light += (anim.target - anim.light) * 0.12;
      drawDisc(anim.pre, anim.light);
      if (!reduced || Math.abs(anim.target - anim.light) > 0.002) anim.id = requestAnimationFrame(loop);
      else anim.id = 0;
    }
    anim.id = requestAnimationFrame(loop);
  }
  function stopDiscAnim() { if (anim.id) cancelAnimationFrame(anim.id); anim.id = 0; }
  function bindLight(cv) {
    cv.addEventListener('pointermove', function (e) {
      var b = cv.getBoundingClientRect(), x = e.clientX - b.left - b.width / 2, y = e.clientY - b.top - b.height / 2;
      anim.auto = false; anim.target = Math.atan2(-y, x);
      if (!anim.id && anim.cv === cv) startDiscAnimKeep();
    });
  }
  function startDiscAnimKeep() {
    function loop() {
      anim.light += (anim.target - anim.light) * 0.15; drawDisc(anim.pre, anim.light);
      if (Math.abs(anim.target - anim.light) > 0.002) anim.id = requestAnimationFrame(loop); else anim.id = 0;
    }
    anim.id = requestAnimationFrame(loop);
  }

  // ================= screens =================
  var OVERLAYS = ['reveal', 'end', 'how', 'drop'];
  function show(id) {
    if (OVERLAYS.indexOf(id) >= 0) { $(id).hidden = false; return; } // overlays sit on top of whatever is showing
    $('title').hidden = id !== 'title'; $('bench').hidden = id !== 'bench';
    OVERLAYS.forEach(function (s) { $(s).hidden = true; });
  }
  var heroRaster = null;
  function goTitle() {
    show('title'); $('bench').hidden = true; $('discLabel').textContent = ''; $('timer').textContent = '';
    if (!heroRaster) heroRaster = makePicture({ flag: 'PREGROOVE', ticks: true, line2: 'DISC FORENSICS', title: LABELS[0], title2: 'NOT FOR BROADCAST' }).raster;
    startDiscAnim($('heroCv'), heroRaster, true);
  }
  function startLevel(li, dropSpec) {
    stopDiscAnim();
    setupLevel(li, dropSpec);
    S.drop = dropSpec || null;
    show('bench');
    $('discLabel').textContent = dropSpec ? 'Dead drop' : 'Disc ' + (li + 1) + '/5 \u00b7 ' + S.L.name;
    $('caseTitle').textContent = dropSpec ? 'DEAD DROP' : 'CASE ' + (li + 1) + ': ' + S.L.name.toUpperCase();
    $('caseText').textContent = dropSpec ? 'Someone burned this for you. Velocity and pitch are unknown. Use the lag scope to fit them, null the ring offsets, and type the message to confirm.' : S.L.text;
    $('flagMsg').textContent = ''; $('flagIn').value = '';
    $('scope').hidden = li < 1 && !dropSpec; $('scopeBtn').textContent = $('scope').hidden ? 'Lag scope' : 'Hide scope';
    $('estNote').textContent = '';
    buildParams(); refreshReadings();
    requestAnimationFrame(function () { requestRender(); if (!$('scope').hidden) updateScope(); });
  }

  // dead drop maker
  function makeDrop() {
    var msg = $('dropMsg').value.trim().toUpperCase().replace(/\s+/g, ' ');
    if (!msg) { $('dropOut').textContent = 'Type a message first (up to 18 characters).'; return; }
    var seed = (Math.random() * 4294967296) >>> 0, code = D.encodeDrop(msg, seed);
    var url = location.origin + location.pathname + '#d=' + code;
    $('dropOut').textContent = url;
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(function () { toast('Link copied.'); }, function () { toast('Copy the link above.'); });
    else toast('Copy the link above.');
    blip();
  }
  function dropFromHash() {
    var m = /#d=([A-Za-z0-9_-]+)/.exec(location.hash);
    if (!m) return null;
    var d = D.decodeDrop(m[1]);
    if (!d || !d.msg || d.msg.length > 40) return null;
    return { seed: d.seed, msg: d.msg, level: { name: 'Dead drop', unknown: ['v', 'p'], ticks: true, noise: 0, drift: false, readout: true } };
  }

  // ================= wiring =================
  $('startBtn').addEventListener('click', function () { ac(); S.results = []; startLevel(0); });
  $('howBtn').addEventListener('click', function () { show('how'); });
  $('helpBtn').addEventListener('click', function () { show('how'); });
  $('howClose').addEventListener('click', function () { $('how').hidden = true; });
  $('makeBtn').addEventListener('click', function () { show('drop'); });
  $('endMakeBtn').addEventListener('click', function () { show('drop'); });
  $('dropClose').addEventListener('click', function () { $('drop').hidden = true; });
  $('dropMake').addEventListener('click', makeDrop);
  $('homeBtn').addEventListener('click', function () { goTitle(); });
  $('nextBtn').addEventListener('click', next);
  $('againBtn').addEventListener('click', function () { S.results = []; startLevel(0); });
  $('flagForm').addEventListener('submit', submitFlag);
  $('scopeBtn').addEventListener('click', function () {
    var h = !$('scope').hidden; $('scope').hidden = h; this.textContent = h ? 'Lag scope' : 'Hide scope';
    if (!h) updateScope();
  });
  $('scopePos').addEventListener('input', updateScope);
  $('readBtn').addEventListener('click', takeReading);
  $('estBtn').addEventListener('click', doFit);
  $('listenBtn').addEventListener('click', function () { listen($('scope').hidden ? Math.floor(S.burn.nEnd * 0.3) : scopeN()); });
  $('resetBtn').addEventListener('click', function () { S.guess = Object.assign({}, S.start); refreshParams(); requestRender(); toast('Guess reset to the label values.'); });
  $('muteBtn').addEventListener('click', function () {
    muted = !muted; this.classList.toggle('off', muted);
    try { localStorage.setItem('pregroove-muted', muted ? '1' : '0'); } catch (e) { }
    if (muted && listenSrc) { try { listenSrc.stop(); } catch (e) { } }
    if (!muted) { ac(); blip(); }
  });
  $('muteBtn').classList.toggle('off', muted);
  bindLight($('heroCv')); bindLight($('revealCv'));
  window.addEventListener('resize', function () { if (S.L) requestRender(); });
  document.addEventListener('keydown', function (e) {
    if ($('bench').hidden || !$('reveal').hidden || !$('how').hidden || !$('drop').hidden || !$('end').hidden) {
      if (e.key === 'Escape') { $('how').hidden = true; $('drop').hidden = true; }
      return;
    }
    if (document.activeElement && document.activeElement.tagName === 'INPUT' && document.activeElement.type === 'text') return;
    var ks = S.L.unknown, i = ks.indexOf(S.focus);
    if (e.key === 'ArrowUp') { S.focus = ks[(i + ks.length - 1) % ks.length]; refreshParams(); e.preventDefault(); }
    else if (e.key === 'ArrowDown') { S.focus = ks[(i + 1) % ks.length]; refreshParams(); e.preventDefault(); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { jog(S.focus, (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 10 : 1)); e.preventDefault(); }
    else if (e.key === '[') { S.steps[S.focus] = Math.max(0, S.steps[S.focus] - 1); refreshParams(); }
    else if (e.key === ']') { S.steps[S.focus] = Math.min(PARAMS[S.focus].steps.length - 1, S.steps[S.focus] + 1); refreshParams(); }
    else if (e.key === 'Enter') { $('flagIn').focus(); }
  });

  // ================= boot / demo / selftest =================
  var drop = dropFromHash();
  if (drop) { $('dropInBtn').hidden = false; $('dropInBtn').addEventListener('click', function () { ac(); startLevel(0, drop); }); }
  requestAnimationFrame(frameLoop);
  var demo = Q.get('demo'), lvl = Q.get('level');
  function playtest() {
    var out = [], okAll = true, seeds = ['a', 'b', 'c', 'd'];
    for (var li = 0; li < LEVELS.length; li++) seeds.forEach(function (sd) {
      Q = new URLSearchParams('seed=' + sd + (location.search.indexOf('errs') >= 0 ? '&errs=1' : '') + (location.search.indexOf('novet') >= 0 ? '&noVet=1' : ''));
      startLevel(li);
      var rd = [];
      for (var fr = 0.05; fr < 0.97; fr += 0.04) { var m = D.measureLag(S.burn, Math.floor(S.burn.nEnd * fr)); if (m.peak) rd.push({ n: m.n, L: m.peak.lag }); }
      if (location.search.indexOf('dbg') >= 0 && li === 4) { var ds = []; for (var f2 = 0.05; f2 < 0.97; f2 += 0.04) { var mm2 = D.measureLag(S.burn, Math.floor(S.burn.nEnd * f2)), cc = mm2.curve, mx = -9, tl = Math.round(D.lagAt(S.truth, mm2.n)) - D.SCOPE.Lmin; for (var qq = 4; qq < cc.length - 4; qq++) if (cc[qq] > mx) mx = cc[qq]; ds.push((cc.blank ? 'B' : mx.toFixed(2)) + '/' + (cc.blank ? '-' : cc[tl].toFixed(2))); } out.push('     dbg ' + ds.join(' ')); }
      if (Q.has('errs')) out.push('     errs ' + rd.map(function (x) { return (x.L - D.lagAt(S.truth, x.n)).toFixed(3) + '@' + (D.lagAt(S.truth, x.n)).toFixed(0); }).join(' '));
      var keys = S.L.unknown.filter(function (k) { return k === 'v' || k === 'p' || k === 'a'; });
      var f = D.fitRobust(rd, S.guess, keys), tw0 = -1, tw1 = -1, line;
      if (f) { keys.forEach(function (k) { S.guess[k] = f[k]; }); tw0 = residual(); }
      var steps = 0;
      if (S.L.readout) { // emulate the player: nudge v/p/a to null the ring offsets, coarse to fine
        var offs = function () { return BANDS.map(function (b, i) { var o = ringOffset(i); return o ? o.off : 0; }); };
        for (var it = 0; it < 12; it++) { // Gauss-Newton on the three ring offsets (what a careful player does by hand)
          var o0 = offs(), J = keys.map(function (k) {
            var h = (k === 'v' ? 1300 : k === 'p' ? 0.0016 : 1e-3) * (k === 'a' ? 0.02 : 1e-6), sv = S.guess[k]; S.guess[k] = sv + h; var o1 = offs(); S.guess[k] = sv;
            return o1.map(function (x, i) { return (x - o0[i]) / h; });
          });
          var m = keys.length, A = [], bv = [];
          for (var i = 0; i < m; i++) { A.push([]); bv.push(0); for (var j = 0; j < m; j++) { var sum = 0; for (var q = 0; q < 3; q++) sum += J[i][q] * J[j][q]; A[i].push(sum + (i === j ? 1e-3 * Math.abs(sum) + 1e-12 : 0)); } for (q = 0; q < 3; q++) bv[i] -= J[i][q] * o0[q]; }
          var dd = D.solveLin ? D.solveLin(A, bv) : null; if (!dd) break;
          var base = o0.reduce(function (t, x) { return t + Math.abs(x); }, 0), sv0 = Object.assign({}, S.guess), lamb = 1;
          for (var h2 = 0; h2 < 6; h2++) {
            keys.forEach(function (k, i) { S.guess[k] = sv0[k] + lamb * dd[i]; });
            if (offs().reduce(function (t, x) { return t + Math.abs(x); }, 0) < base) break;
            lamb /= 2; Object.assign(S.guess, sv0);
          }
          steps++;
        }
      }
      tw1 = residual();
      var size = 220, o = new Float32Array(size * size);
      D.decode(S.burn, S.guess, size, 1, o);
      var same = 0, tot = 0;
      for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) {
        var mx = -60 + (x + .5) * 120 / size, my = 60 - (y + .5) * 120 / size, r = Math.hypot(mx, my), v = o[y * size + x];
        if (r < 27 || r > 57 || v < 0) continue; tot++; if ((v > .5) === (S.picture.pic(mx, my) > .5)) same++;
      }
      var good; good = S.L.unknown.indexOf('phi0') >= 0 ? true : same / tot > 0.97;
      if (S.L.readout && tw1 > 0.3) good = false;
      if (!S.L.readout && tw1 > 1.0) good = false;
      if (!f || !good) okAll = false;
      out.push((good && f ? 'ok   ' : 'FAIL ') + 'L' + (li + 1) + ' seed ' + sd + ': readings ' + rd.length + ' twist after fit ' + tw0.toFixed(2) + ' after ring-nulling ' + tw1.toFixed(3) + ' (' + steps + ' moves) match ' + (100 * same / tot).toFixed(0) + '%');
    });
    var pre = document.createElement('pre'); pre.id = 'selftest'; pre.textContent = (okAll ? 'PLAYTEST PASS' : 'PLAYTEST FAIL') + '\n' + out.join('\n');
    document.body.appendChild(pre);
  }
  if (Q.has('playtest')) playtest(); else
  if (Q.has('selftest')) selftest();
  else if (demo !== null || lvl) {
    var li = clamp((+lvl || (demo === 'reveal' ? 5 : 3)) - 1, 0, LEVELS.length - 1);
    startLevel(li);
    if (demo !== null) {
      S.guess = Object.assign({}, S.truth);
      if (demo === '' || demo === '1') { S.guess.v = S.truth.v * (1 + 2.5e-6); S.guess.p = S.truth.p * (1 - 1.5e-6); }
      refreshParams();
      $('scope').hidden = false; $('scopeBtn').textContent = 'Hide scope'; $('scopePos').value = 0.42; updateScope();
      S.readings = [];
      [0.1, 0.45, 0.8].forEach(function (f) { var m = D.measureLag(S.burn, Math.floor(S.burn.nEnd * f)); if (m.peak) S.readings.push({ n: m.n, L: m.peak.lag }); });
      refreshReadings(); requestRender();
      if (demo === 'reveal') setTimeout(solve, 300);
    }
  } else goTitle();

  function selftest() {
    var out = [], okAll = true;
    function ok(c, m) { out.push((c ? 'ok   ' : 'FAIL ') + m); if (!c) okAll = false; }
    startLevel(2);
    var size = 200, buf2 = new Float32Array(size * size);
    D.decode(S.burn, S.truth, size, 1, buf2);
    var same = 0, tot = 0;
    for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) {
      var mx = -60 + (x + 0.5) * 120 / size, my = 60 - (y + 0.5) * 120 / size, r = Math.hypot(mx, my), v = buf2[y * size + x];
      if (r < 27 || r > 57 || v < 0) continue;
      tot++; if ((v > 0.5) === (S.picture.pic(mx, my) > 0.5)) same++;
    }
    ok(same / tot > 0.8, 'decode at the truth matches the picture (' + (100 * same / tot).toFixed(1) + '%)');
    S.guess = Object.assign({}, S.truth); var offs = BANDS.map(function (b, i) { return ringOffset(i); });
    ok(offs.every(function (o) { return o && Math.abs(o.off) < 0.02 && o.q > 0.5; }), 'ring offsets ~0 at the truth: ' + offs.map(function (o) { return o && o.off.toFixed(3) + '/' + o.q.toFixed(2); }).join(' '));
    S.guess.v = S.truth.v * (1 + 4e-6); var o2 = ringOffset(2);
    var expect = D.twistAt(S.truth, S.guess, BANDS[2].r);
    ok(o2 && Math.abs(o2.off - expect) < 0.05, 'rim offset tracks the true twist (' + (o2 && o2.off.toFixed(3)) + ' vs ' + expect.toFixed(3) + ')');
    S.guess = Object.assign({}, S.start);
    var rd = [];
    for (var fr = 0.03; fr < 0.97; fr += 0.04) {
      var mm = D.measureLag(S.burn, Math.floor(S.burn.nEnd * fr));
      if (mm.peak) {
        rd.push({ n: mm.n, L: mm.peak.lag });
        if (Math.abs(mm.peak.lag - D.lagAt(S.truth, mm.n)) > 5) {
          var dk = 0; for (var q = 0; q < 6000; q++) dk += D.frame(S.burn, Math.floor(S.burn.nEnd * fr) + q) === 1 ? 1 : 0;
          var tL = Math.round(D.lagAt(S.truth, mm.n)) - D.SCOPE.Lmin;
          out.push('     BAD at fr ' + fr.toFixed(2) + ' dark ' + dk + '/6000 corr@pk ' + mm.peak.corr.toFixed(3) + ' corr@true ' + mm.curve[tL].toFixed(3) + ' r ' + Math.sqrt(625 + fr * (3364 - 625)).toFixed(1));
        }
      }
    }
    ok(rd.length >= 6, rd.length + ' of 24 scope positions give an echo');
    var f = D.fitRobust(rd, S.guess, ['v', 'p']), tw = 0;
    out.push('     readings ' + rd.map(function (x) { return x.L.toFixed(2) + '/' + D.lagAt(S.truth, x.n).toFixed(2); }).join(' ') + ' fit v ' + (f && f.v.toFixed(4)) + ' p ' + (f && f.p.toFixed(8)) + ' truth ' + S.truth.v.toFixed(4) + ' ' + S.truth.p.toFixed(8));
    for (var rr = 27; rr <= 57; rr += 5) tw = Math.max(tw, Math.abs(D.twistAt(S.truth, f, rr)));
    ok(tw < 3, 'scope fit from nominal leaves twist ' + tw.toFixed(2) + ' rad');
    ok(D.normFlag(S.flag).length >= 5, 'flag generated: ' + S.flag);
    var pre = document.createElement('pre'); pre.id = 'selftest'; pre.textContent = (okAll ? 'SELFTEST PASS' : 'SELFTEST FAIL') + '\n' + out.join('\n');
    pre.style.cssText = 'position:fixed;left:0;top:0;z-index:99;background:#000;color:#9be37a;padding:10px;margin:0;font:12px monospace';
    document.body.appendChild(pre);
    document.title = okAll ? 'SELFTEST PASS' : 'SELFTEST FAIL';
  }
})();
