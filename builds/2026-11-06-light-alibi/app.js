// Light Alibi - UI, globe renderer, input, audio, game flow.
(function () {
  'use strict';
  var LA = window.LA;
  var $ = function (id) { return document.getElementById(id); };
  var params = new URLSearchParams(location.search);
  var reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var D2R = Math.PI / 180, R2D = 180 / Math.PI;
  function fmt(n) { return Math.round(n).toLocaleString('en-US'); }
  function fmt1(n) { return (Math.round(n * 10) / 10).toFixed(1); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // ---------------- land mask ----------------
  var MW = 2048, MH = 1024, MASK = new Uint8Array(MW * MH);
  (function buildMask() {
    var c = document.createElement('canvas'); c.width = MW; c.height = MH;
    var x = c.getContext('2d');
    x.fillStyle = '#fff'; x.beginPath();
    for (var i = 0; i < LAND_RINGS.length; i++) {
      var r = LAND_RINGS[i];
      for (var j = 0; j < r.length; j += 2) {
        var px = (r[j] / 10 + 180) / 360 * MW, py = (90 - r[j + 1] / 10) / 180 * MH;
        if (j === 0) x.moveTo(px, py); else x.lineTo(px, py);
      }
      x.closePath();
    }
    x.fill('evenodd');
    var d = x.getImageData(0, 0, MW, MH).data;
    for (var k = 0; k < MASK.length; k++) MASK[k] = d[k * 4 + 3];
  })();
  function landAt(lat, lon) {
    var mx = Math.floor((lon + 180) / 360 * MW), my = Math.floor((90 - lat) / 180 * MH);
    return MASK[clamp(my, 0, MH - 1) * MW + clamp(mx, 0, MW - 1)];
  }

  // area grid (1 degree) for feasible-region size
  var GRID = [], GRIDW = [];
  for (var gla = -89.5; gla < 90; gla += 1) for (var glo = -179.5; glo < 180; glo += 1) { GRID.push(LA.toVec(gla, glo)); GRIDW.push(Math.cos(gla * D2R) * 111.195 * 111.195); }

  // ---------------- audio ----------------
  var AC = null, muted = false;
  try { muted = localStorage.getItem('la-muted') === '1'; } catch (e) {}
  function ac() {
    if (muted) return null;
    if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { AC = null; } }
    if (AC && AC.state === 'suspended') AC.resume();
    return AC;
  }
  function tone(f, t, dur, type, vol, f2) {
    var a = ac(); if (!a) return;
    var t0 = a.currentTime + t, o = a.createOscillator(), g = a.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(f, t0);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(a.destination); o.start(t0); o.stop(t0 + dur + 0.05);
  }
  function noise(t, dur, vol, freq) {
    var a = ac(); if (!a) return;
    var n = Math.floor(a.sampleRate * dur), b = a.createBuffer(1, n, a.sampleRate), ch = b.getChannelData(0);
    for (var i = 0; i < n; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / n);
    var s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    s.buffer = b; f.type = 'lowpass'; f.frequency.value = freq || 800; g.gain.value = vol;
    s.connect(f); f.connect(g); g.connect(a.destination); s.start(a.currentTime + t);
  }
  var sfx = {
    ping: function () { for (var i = 0; i < 5; i++) tone(1750, i * 0.045, 0.03, 'sine', 0.05); },
    echo: function () { tone(980, 0, 0.16, 'triangle', 0.08, 760); },
    proof: function () { tone(660, 0, 0.12, 'sine', 0.09); tone(990, 0.11, 0.2, 'sine', 0.09); },
    shrink: function () { tone(1300, 0, 0.5, 'sine', 0.06, 380); },
    stamp: function () { noise(0, 0.12, 0.35, 700); tone(95, 0, 0.18, 'sine', 0.2); },
    good: function () { [523, 659, 784, 1046].forEach(function (f, i) { tone(f, 0.25 + i * 0.09, 0.22, 'triangle', 0.07); }); },
    bad: function () { tone(220, 0.25, 0.45, 'sawtooth', 0.04, 150); },
    tick: function () { tone(1200, 0, 0.02, 'square', 0.02); },
    deny: function () { tone(180, 0, 0.12, 'square', 0.03); }
  };
  function setMute(m) {
    muted = m; try { localStorage.setItem('la-muted', m ? '1' : '0'); } catch (e) {}
    $('muteBtn').innerHTML = m ? '&#128263;' : '&#128266;';
    $('muteBtn').setAttribute('aria-label', m ? 'Unmute' : 'Mute');
    if (m && AC) AC.suspend();
  }

  // ---------------- canvas / view ----------------
  var cv = $('globe'), ctx = cv.getContext('2d');
  var W = 1, H = 1, dpr = 1;
  var view = { lat: 25, lon: 10, zoom: 1 };
  var buf = document.createElement('canvas'), bctx = buf.getContext('2d'), img = null;
  var dirty = true, hiResDue = 0, lowRes = false;
  var STARS = []; (function () { var r = LA.rng(7); for (var i = 0; i < 90; i++) STARS.push([r(), r(), r()]); })();
  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(1, cv.clientWidth); H = Math.max(1, cv.clientHeight);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    dirty = true;
  }
  function globeR() { return Math.min(W, H) * 0.44 * view.zoom; }
  function V() { return LA.makeView(view.lat, view.lon); }
  function toScreen(vw, lat, lon) {
    var p = vw.project(lat, lon), R = globeR();
    return { x: W / 2 + p.x * R, y: H / 2 - p.y * R, z: p.z };
  }
  function fromScreen(vw, sx, sy) {
    var R = globeR();
    return vw.unproject((sx - W / 2) / R, (H / 2 - sy) / R);
  }

  function renderGlobe(q) {
    var cap = Math.sqrt(1.3e6 / Math.max(1, W * dpr * H * dpr));
    if (q > cap) q = cap;
    var bw = Math.max(1, Math.round(W * dpr * q)), bh = Math.max(1, Math.round(H * dpr * q));
    if (buf.width !== bw || buf.height !== bh) { buf.width = bw; buf.height = bh; img = null; }
    if (!img) img = bctx.createImageData(bw, bh);
    var data = img.data; data.fill(0);
    var vw = V(), e = vw.e, n = vw.n, f = vw.f;
    var s = bw / W, R = globeR() * s, cx = bw / 2, cy = bh / 2;
    var x0 = Math.max(0, Math.floor(cx - R)), x1 = Math.min(bw, Math.ceil(cx + R));
    var y0 = Math.max(0, Math.floor(cy - R)), y1 = Math.min(bh, Math.ceil(cy + R));
    var disks = G.disks, nd = disks.length, dv = [], dc = [];
    for (var i = 0; i < nd; i++) { dv.push(disks[i].vec); dc.push(Math.cos(disks[i].shown / LA.R_EARTH)); }
    var degPx = R2D / R, thr = degPx * 0.7;
    var showRegion = nd > 0;
    for (var py = y0; py < y1; py++) {
      var y = (cy - py - 0.5) / R;
      for (var px = x0; px < x1; px++) {
        var x = (px + 0.5 - cx) / R, r2 = x * x + y * y;
        if (r2 > 1) continue;
        var z = Math.sqrt(1 - r2);
        var vx = x * e[0] + y * n[0] + z * f[0], vy = x * e[1] + y * n[1] + z * f[1], vz = x * e[2] + y * n[2] + z * f[2];
        var lat = Math.asin(vz > 1 ? 1 : vz < -1 ? -1 : vz) * R2D, lon = Math.atan2(vy, vx) * R2D;
        var mx = ((lon + 180) / 360 * MW) | 0, my = ((90 - lat) / 180 * MH) | 0;
        if (mx >= MW) mx = MW - 1; if (my >= MH) my = MH - 1;
        var a = MASK[my * MW + mx] / 255;
        var light = 0.42 + 0.58 * z;
        var rr = 11 + a * 39, gg = 24 + a * 43, bb = 42 + a * 22;
        // graticule every 30 degrees
        var gl = Math.abs(lat - Math.round(lat / 30) * 30), go = Math.abs(lon - Math.round(lon / 30) * 30) * Math.cos(lat * D2R);
        if (gl < thr || go < thr) { rr += 10; gg += 14; bb += 20; }
        if (showRegion) {
          var k = 0;
          for (var j = 0; j < nd; j++) { var d = dv[j]; if (vx * d[0] + vy * d[1] + vz * d[2] >= dc[j]) k++; }
          if (k === nd) { rr = rr * 0.4 + 255 * 0.6; gg = gg * 0.4 + 191 * 0.6; bb = bb * 0.4 + 94 * 0.6; light = 0.75 + 0.25 * light; }
          else {
            var t = k / nd * 0.22;
            rr = (rr * (1 - t) + 127 * t) * 0.62; gg = (gg * (1 - t) + 214 * t) * 0.62; bb = (bb * (1 - t) + 255 * t) * 0.62;
          }
        }
        var o = (py * bw + px) * 4;
        // soft edge
        var edge = (1 - Math.sqrt(r2)) * R; var al = edge < 1 ? edge * 255 : 255;
        data[o] = rr * light; data[o + 1] = gg * light; data[o + 2] = bb * light; data[o + 3] = al;
      }
    }
    bctx.putImageData(img, 0, 0);
  }

  function strokePath(vw, pts, closed) { // pts: [[lat,lon],...]; breaks across the horizon
    var started = false, first = null;
    ctx.beginPath();
    for (var i = 0; i < pts.length; i++) {
      var p = toScreen(vw, pts[i][0], pts[i][1]);
      if (p.z > 0) { if (!started) { ctx.moveTo(p.x, p.y); started = true; if (i === 0) first = p; } else ctx.lineTo(p.x, p.y); }
      else started = false;
    }
    if (closed && first && started) ctx.lineTo(first.x, first.y);
    ctx.stroke();
  }
  function circlePts(c, radius) {
    var pts = [];
    for (var i = 0; i <= 180; i++) { var d = LA.destination(c, i * 2, Math.min(radius, LA.HALF_CIRC - 1)); pts.push([d.lat, d.lon]); }
    return pts;
  }
  function arcPts(a, b, nseg) {
    var va = LA.toVec(a.lat, a.lon), vb = LA.toVec(b.lat, b.lon);
    var dot = clamp(va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2], -1, 1), om = Math.acos(dot), pts = [];
    for (var i = 0; i <= nseg; i++) {
      var t = i / nseg, s0 = om < 1e-6 ? 1 - t : Math.sin((1 - t) * om) / Math.sin(om), s1 = om < 1e-6 ? t : Math.sin(t * om) / Math.sin(om);
      var g = LA.fromVec([va[0] * s0 + vb[0] * s1, va[1] * s0 + vb[1] * s1, va[2] * s0 + vb[2] * s1]);
      pts.push([g.lat, g.lon]);
    }
    return pts;
  }
  var COAST = LAND_RINGS.map(function (r) { var p = []; for (var j = 0; j < r.length; j += 2) p.push([r[j + 1] / 10, r[j] / 10]); return p; });

  function label(text, x, y, color, align) {
    ctx.font = '600 12px system-ui,-apple-system,Segoe UI,sans-serif';
    ctx.textAlign = align || 'left'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(5,10,18,.85)'; ctx.strokeText(text, x, y);
    ctx.fillStyle = color; ctx.fillText(text, x, y);
  }

  function draw(now) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#070d16'; ctx.fillRect(0, 0, W, H);
    for (var i = 0; i < STARS.length; i++) { var st = STARS[i]; ctx.fillStyle = 'rgba(200,220,255,' + (0.08 + st[2] * 0.25) + ')'; ctx.fillRect(st[0] * W, st[1] * H, 1.2, 1.2); }
    var R = globeR();
    var g = ctx.createRadialGradient(W / 2, H / 2, R * 0.96, W / 2, H / 2, R * 1.12);
    g.addColorStop(0, 'rgba(127,214,255,.22)'); g.addColorStop(1, 'rgba(127,214,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(W / 2, H / 2, R * 1.12, 0, 7); ctx.fill();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(buf, 0, 0, W, H);
    var vw = V();
    // coastline
    ctx.lineWidth = 0.8; ctx.strokeStyle = 'rgba(150,185,195,.35)';
    for (var c = 0; c < COAST.length; c++) strokePath(vw, COAST[c], true);
    // disks
    for (var d = 0; d < G.disks.length; d++) {
      var dk = G.disks[d];
      if (!dk.pts || dk.ptsR !== dk.shown) { dk.pts = circlePts(dk.lm, dk.shown); dk.ptsR = dk.shown; }
      var proves = LA.dist(dk.lm, G.cs.claimPlace) > dk.radius;
      ctx.lineWidth = proves ? 2 : 1.4; ctx.strokeStyle = proves ? 'rgba(255,107,107,.95)' : 'rgba(127,214,255,.85)';
      strokePath(vw, dk.pts, true);
    }
    // ripples
    for (var r = G.ripples.length - 1; r >= 0; r--) {
      var rp = G.ripples[r], t = (now - rp.t0) / rp.dur;
      if (t >= 1) continue;
      var rad = rp.radius * (1 - Math.pow(1 - t, 2));
      ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(127,214,255,' + (0.9 - 0.6 * t) + ')';
      strokePath(vw, circlePts(rp.lm, Math.max(10, rad)), true);
    }
    // reveal arcs
    if (G.submitted) {
      ctx.setLineDash([5, 4]);
      G.disks.forEach(function (dk) {
        var via = G.cs.detours[dk.id];
        if (via) { ctx.lineWidth = 1.2; ctx.strokeStyle = 'rgba(255,191,94,.7)'; strokePath(vw, arcPts(dk.lm, LA.place(via), 60).concat(arcPts(LA.place(via), G.cs.truthPlace, 60)), false); }
      });
      ctx.setLineDash([]);
      if (!G.cs.honest) { ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(126,224,161,.9)'; strokePath(vw, arcPts(G.cs.claimPlace, G.cs.truthPlace, 80), false); }
    }
    // client
    if (!G.cs.pingable) {
      var cp = toScreen(vw, G.cs.clientPlace.lat, G.cs.clientPlace.lon);
      if (cp.z > 0) { ctx.fillStyle = '#c9a2ff'; ctx.beginPath(); ctx.arc(cp.x, cp.y, 4.5, 0, 7); ctx.fill(); label('you (' + G.cs.clientPlace.name + ')', cp.x + 8, cp.y, '#c9a2ff'); }
    }
    // landmarks
    var showAll = view.zoom >= 2.6;
    G.lms.forEach(function (id) {
      var p = LA.place(id), s = toScreen(vw, p.lat, p.lon);
      if (s.z <= 0.02) return;
      var off = G.cs.offline.indexOf(id) >= 0, done = G.probed[id];
      if (off) { ctx.strokeStyle = 'rgba(140,150,165,.6)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(s.x - 3, s.y - 3); ctx.lineTo(s.x + 3, s.y + 3); ctx.moveTo(s.x + 3, s.y - 3); ctx.lineTo(s.x - 3, s.y + 3); ctx.stroke(); return; }
      ctx.beginPath(); ctx.arc(s.x, s.y, done ? 4.5 : 3.2, 0, 7);
      ctx.fillStyle = done ? '#7fd6ff' : 'rgba(255,255,255,.85)'; ctx.fill();
      if (G.hover === id) { ctx.strokeStyle = '#ffbf5e'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(s.x, s.y, 8, 0, 7); ctx.stroke(); }
      if (done || showAll || G.hover === id) label(p.name, s.x + 7, s.y - 1, done ? '#bfe9ff' : 'rgba(220,230,240,.8)');
    });
    // claim
    var cl = G.cs.claimPlace, cs2 = toScreen(vw, cl.lat, cl.lon);
    if (cs2.z > 0) {
      ctx.save(); ctx.translate(cs2.x, cs2.y); ctx.rotate(Math.PI / 4);
      ctx.fillStyle = '#ff6b6b'; ctx.strokeStyle = '#2a0b0b'; ctx.lineWidth = 1.5; ctx.fillRect(-5, -5, 10, 10); ctx.strokeRect(-5, -5, 10, 10); ctx.restore();
      label('claim: ' + cl.name, cs2.x + 10, cs2.y + 12, '#ff9b9b');
    }
    // pin
    if (G.pin) {
      var ps = toScreen(vw, G.pin.lat, G.pin.lon);
      if (ps.z > 0) {
        ctx.fillStyle = '#ffbf5e'; ctx.strokeStyle = '#2b1a00'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(ps.x, ps.y); ctx.lineTo(ps.x - 6, ps.y - 13); ctx.arc(ps.x, ps.y - 15, 6.3, Math.PI * 0.82, Math.PI * 0.18); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#2b1a00'; ctx.beginPath(); ctx.arc(ps.x, ps.y - 15, 2.2, 0, 7); ctx.fill();
        label('your pin', ps.x + 9, ps.y - 15, '#ffd89a');
      }
    }
    // truth
    if (G.submitted) {
      var tp = G.cs.truthPlace, ts = toScreen(vw, tp.lat, tp.lon);
      if (ts.z > 0) {
        var pulse = reduced ? 0 : (Math.sin(now / 220) + 1) * 3;
        ctx.strokeStyle = 'rgba(126,224,161,.8)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(ts.x, ts.y, 8 + pulse, 0, 7); ctx.stroke();
        ctx.fillStyle = '#7ee0a1'; ctx.beginPath(); ctx.arc(ts.x, ts.y, 4.5, 0, 7); ctx.fill();
        label('actually: ' + tp.name, ts.x + 12, ts.y - 12, '#a9f0c2');
      }
    }
  }

  // ---------------- animation loop ----------------
  var tween = null;
  function flyTo(lat, lon, zoom, ms) {
    if (reduced || !ms) { view.lat = lat; view.lon = lon; if (zoom) view.zoom = zoom; dirty = true; return; }
    var dl = ((lon - view.lon + 540) % 360) - 180;
    tween = { t0: performance.now(), ms: ms, a: { lat: view.lat, lon: view.lon, zoom: view.zoom }, b: { lat: lat, lon: view.lon + dl, zoom: zoom || view.zoom } };
  }
  function frame(now) {
    var animating = false;
    if (tween) {
      var t = clamp((now - tween.t0) / tween.ms, 0, 1), k = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      view.lat = tween.a.lat + (tween.b.lat - tween.a.lat) * k; view.lon = tween.a.lon + (tween.b.lon - tween.a.lon) * k;
      view.zoom = tween.a.zoom + (tween.b.zoom - tween.a.zoom) * k;
      dirty = true; animating = true;
      if (t >= 1) tween = null;
    }
    // disks easing to their radius (shrinks after measuring C)
    for (var i = 0; i < G.disks.length; i++) {
      var dk = G.disks[i];
      if (dk.shown !== dk.radius) {
        var diff = dk.radius - dk.shown;
        dk.shown = (reduced || Math.abs(diff) < 5) ? dk.radius : dk.shown + diff * 0.12;
        dirty = true; animating = true;
      }
    }
    // ripples finishing
    for (var r = G.ripples.length - 1; r >= 0; r--) {
      var rp = G.ripples[r];
      if (now - rp.t0 >= rp.dur) { G.ripples.splice(r, 1); rp.done(); }
    }
    if (dirty) {
      renderGlobe(animating || dragState ? 0.5 : 1);
      lowRes = animating || !!dragState;
      dirty = false; hiResDue = now + 160;
    } else if (lowRes && now > hiResDue) { renderGlobe(1); lowRes = false; }
    draw(now);
    requestAnimationFrame(frame);
  }

  // ---------------- input ----------------
  var pointers = new Map(), dragState = null, pinch = null;
  function rel(e) { var b = cv.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; }
  function hitLandmark(x, y) {
    var vw = V(), best = null, bd = 18;
    G.lms.forEach(function (id) {
      if (G.cs.offline.indexOf(id) >= 0) return;
      var p = LA.place(id), s = toScreen(vw, p.lat, p.lon);
      if (s.z <= 0.05) return;
      var d = Math.hypot(s.x - x, s.y - y);
      if (d < bd) { bd = d; best = id; }
    });
    return best;
  }
  cv.addEventListener('pointerdown', function (e) {
    cv.setPointerCapture(e.pointerId);
    var p = rel(e); pointers.set(e.pointerId, p);
    if (pointers.size === 1) dragState = { x: p.x, y: p.y, sx: p.x, sy: p.y, t: performance.now(), moved: false };
    else if (pointers.size === 2) {
      var ps = Array.from(pointers.values()); pinch = { d: Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y), z: view.zoom }; if (dragState) dragState.moved = true;
    }
    tween = null;
  });
  cv.addEventListener('pointermove', function (e) {
    var p = rel(e);
    if (!pointers.has(e.pointerId)) {
      if (e.pointerType === 'mouse') { var h = hitLandmark(p.x, p.y); if (h !== G.hover) { G.hover = h; } cv.style.cursor = h ? 'pointer' : ''; }
      return;
    }
    pointers.set(e.pointerId, p);
    if (pointers.size === 2 && pinch) {
      var ps = Array.from(pointers.values()), d = Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y);
      view.zoom = clamp(pinch.z * d / Math.max(10, pinch.d), 0.8, 6); dirty = true; return;
    }
    if (!dragState) return;
    var dx = p.x - dragState.x, dy = p.y - dragState.y;
    if (Math.hypot(p.x - dragState.sx, p.y - dragState.sy) > 6) { dragState.moved = true; cv.classList.add('dragging'); }
    if (dragState.moved) {
      var R = globeR();
      view.lon -= dx / R * R2D; view.lat = clamp(view.lat + dy / R * R2D, -80, 80);
      view.lon = ((view.lon + 540) % 360) - 180;
      dirty = true;
    }
    dragState.x = p.x; dragState.y = p.y;
  });
  function endPointer(e) {
    var p = rel(e);
    var wasTap = dragState && !dragState.moved && pointers.size === 1 && performance.now() - dragState.t < 600;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) { dragState = null; cv.classList.remove('dragging'); dirty = true; }
    if (wasTap && e.type === 'pointerup') tap(p.x, p.y);
  }
  cv.addEventListener('pointerup', endPointer);
  cv.addEventListener('pointercancel', endPointer);
  cv.addEventListener('wheel', function (e) { e.preventDefault(); view.zoom = clamp(view.zoom * Math.exp(-e.deltaY * 0.0015), 0.8, 6); dirty = true; tween = null; }, { passive: false });
  $('zIn').onclick = function () { flyTo(view.lat, view.lon, clamp(view.zoom * 1.5, 0.8, 6), 250); };
  $('zOut').onclick = function () { flyTo(view.lat, view.lon, clamp(view.zoom / 1.5, 0.8, 6), 250); };
  $('zHome').onclick = function () { flyTo(G.cs.claimPlace.lat, G.cs.claimPlace.lon, Math.max(view.zoom, 1.3), 600); };
  function tap(x, y) {
    ac();
    var lm = hitLandmark(x, y);
    if (lm && !G.probed[lm]) { probe(lm); return; }
    if (G.submitted) return;
    var g = fromScreen(V(), x, y);
    if (!g) return;
    G.pin = g; sfx.tick(); updateUI();
  }

  // ---------------- game ----------------
  var G = { mode: 'campaign', idx: 0, cs: null, disks: [], ripples: [], probed: {}, selfC: null, budget: 0, verdict: null, pin: null, submitted: false, total: 0, history: [], lms: LA.landmarkIds(), hover: null };
  var BASE_SEED = (Date.now() / 1000) | 0;
  function startCase(cs) {
    G.cs = cs; G.disks = []; G.ripples = []; G.probed = {}; G.selfC = null; G.budget = cs.budget; G.verdict = null; G.pin = null; G.submitted = false;
    G.rnd = LA.rng(cs.seed ^ 0x9e3779b9);
    $('filter').value = '';
    flyTo(cs.claimPlace.lat * 0.8, cs.claimPlace.lon, 1.25, 900);
    buildList(); updateUI();
    toast(cs.pingable ? 'Tap a landmark to ping the exit.' : 'This exit ignores pings: you can only time traffic through it.');
  }
  function measureFor(id) {
    var cs = G.cs;
    return cs.pingable ? LA.measureDirect(cs, id, G.rnd) : LA.measureThrough(cs, id, G.rnd);
  }
  function probe(id) {
    if (G.submitted) { toast('Report filed. Start the next case.'); return; }
    if (G.cs.offline.indexOf(id) >= 0) { sfx.deny(); toast(LA.place(id).name + ' landmark is offline.'); return; }
    if (G.probed[id]) return;
    if (G.budget <= 0) { sfx.deny(); toast('No probes left. Make your call.'); return; }
    G.budget--;
    var m = measureFor(id), p = LA.place(id);
    G.probed[id] = { min: m.min, samples: m.samples, pending: true };
    var disk = LA.diskFor(id, m.min, G.selfC);
    var dur = clamp(m.min * 7, 380, 1700);
    sfx.ping();
    var finish = function () {
      G.probed[id].pending = false;
      disk.vec = LA.toVec(p.lat, p.lon); disk.shown = disk.radius;
      G.disks.push(disk); dirty = true; sfx.echo();
      var proves = LA.dist(p, G.cs.claimPlace) > disk.radius;
      if (proves) { setTimeout(sfx.proof, 120); toast(p.name + ' disk leaves ' + G.cs.claimPlace.name + ' outside: that claim is impossible.'); }
      else if (!G.cs.pingable && G.selfC == null) toast('Huge disk: B still includes your own leg to the proxy. Measure C.');
      updateUI();
    };
    if (reduced) setTimeout(finish, dur);
    else G.ripples.push({ lm: p, radius: disk.radius, t0: performance.now(), dur: dur, done: finish });
    updateUI();
  }
  function measureSelf() {
    if (G.submitted || G.selfC != null) return;
    if (G.budget <= 0) { sfx.deny(); toast('No probes left.'); return; }
    G.budget--;
    var m = LA.measureSelf(G.cs, G.rnd);
    G.selfC = m.min; G.selfSamples = m.samples;
    G.disks.forEach(function (dk) { var nd = LA.diskFor(dk.id, dk.rtt, G.selfC); dk.eff = nd.eff; dk.radius = nd.radius; });
    sfx.ping(); setTimeout(sfx.shrink, 250);
    if (G.disks.length) toast('Subtracting half of C from every reading: disks shrink to the proxy\'s own leg.');
    else toast('C measured. New probes will use A = B - C/2.');
    updateUI();
  }
  function regionArea() {
    var ds = G.disks; if (!ds.length) return null;
    var cosr = ds.map(function (d) { return Math.cos(d.radius / LA.R_EARTH); }), a = 0;
    for (var i = 0; i < GRID.length; i++) {
      var v = GRID[i], ok = true;
      for (var j = 0; j < ds.length; j++) { var w = ds[j].vec; if (v[0] * w[0] + v[1] * w[1] + v[2] * w[2] < cosr[j]) { ok = false; break; } }
      if (ok) a += GRIDW[i];
    }
    return a;
  }
  function buildList() {
    var cs = G.cs, q = $('filter').value.trim().toLowerCase();
    var ids = G.lms.slice().sort(function (a, b) { return LA.dist(LA.place(a), cs.claimPlace) - LA.dist(LA.place(b), cs.claimPlace); });
    var html = '';
    ids.forEach(function (id) {
      var p = LA.place(id);
      if (q && (p.name + ' ' + p.country).toLowerCase().indexOf(q) < 0) return;
      var off = cs.offline.indexOf(id) >= 0, pr = G.probed[id];
      var cls = 'prow' + (off ? ' off' : '') + (pr ? ' done' : '');
      var dClaim = LA.dist(p, cs.claimPlace);
      var res = '';
      if (off) res = '<div class="res" style="color:var(--dim)">offline for maintenance</div>';
      else if (pr && pr.pending) res = '<div class="res">pinging...</div>';
      else if (pr) {
        var dk = G.disks.filter(function (d) { return d.id === id; })[0];
        var out = dClaim > dk.radius;
        var meas = cs.pingable ? 'RTT ' + fmt1(dk.rtt) + ' ms' : 'B ' + fmt1(dk.rtt) + ' ms' + (G.selfC != null ? ' - C/2 = A ' + fmt1(dk.eff) + ' ms' : '');
        res = '<div class="res">' + meas + ' &rarr; r &le; ' + fmt(dk.radius) + ' km &middot; ' + (out ? '<b class="x">claim outside &#10007;</b>' : '<b class="in">claim inside</b>') + '</div>';
      }
      html += '<button class="' + cls + '" data-id="' + id + '"' + (off || pr ? ' tabindex="-1"' : '') + '><span class="nm">' + esc(p.name) + ' <span class="small">' + esc(p.country) + '</span></span><span class="ds">' + fmt(dClaim) + ' km from claim</span>' + res + '</button>';
    });
    $('probeList').innerHTML = html || '<div class="small">No landmark matches.</div>';
  }
  $('probeList').addEventListener('click', function (e) {
    var b = e.target.closest('.prow'); if (!b) return;
    ac(); var id = b.getAttribute('data-id');
    if (G.probed[id]) { var p = LA.place(id); flyTo(p.lat, p.lon, view.zoom, 500); return; }
    probe(id);
  });
  $('filter').addEventListener('input', buildList);

  function updateUI() {
    var cs = G.cs;
    var label = G.mode === 'campaign' ? 'Case ' + (G.idx + 1) + '/' + LA.CASES.length + ' \u00b7 ' + cs.title : 'Night shift \u00b7 case ' + (G.history.length + 1);
    $('caseLabel').textContent = label;
    $('scoreLabel').textContent = fmt(G.total) + ' pts';
    $('caseTitle').textContent = cs.title + ' \u00b7 ' + cs.provider;
    $('claimCity').textContent = cs.claimPlace.name + ', ' + cs.claimPlace.country;
    $('claimMeta').textContent = 'exit ' + cs.exit + ' \u00b7 ' + (cs.pingable ? 'answers pings' : 'ignores pings, you are in ' + cs.clientPlace.name);
    $('brief').textContent = cs.brief;
    var bh = ''; for (var i = 0; i < cs.budget; i++) bh += '<span class="pip' + (i < G.budget ? ' on' : '') + '"></span>';
    $('budget').innerHTML = bh + '<span class="small" style="margin-left:6px">' + G.budget + ' of ' + cs.budget + ' probes left</span>';
    $('selfRow').classList.toggle('on', !cs.pingable);
    $('selfBtn').disabled = G.selfC != null || G.budget <= 0 || G.submitted;
    $('selfInfo').innerHTML = G.selfC != null ? 'C = ' + fmt1(G.selfC) + ' ms (you &rarr; proxy &rarr; you, twice). Your leg is C/2 = ' + fmt1(G.selfC / 2) + ' ms; it is subtracted from every B.' : 'Times a connection through the proxy back to yourself. Costs one probe.';
    buildList();
    var st = '';
    var settled = G.disks.length;
    if (!settled) st = 'No measurements yet.';
    else {
      var ex = LA.excluding(G.disks, cs.claimPlace);
      var area = regionArea();
      st = settled + ' disk' + (settled > 1 ? 's' : '') + ' \u00b7 possible region about ' + (area > 1e6 ? fmt1(area / 1e6) + ' M' : fmt(area)) + ' km&sup2;<br>';
      if (ex.length) st += '<span class="x">Claim excluded by ' + ex.map(function (d) { return esc(d.lm.name); }).join(', ') + '.</span>';
      else st += 'The claim is inside every disk so far.';
    }
    $('status').innerHTML = st;
    $('vImp').classList.toggle('sel', G.verdict === 'impossible');
    $('vCant').classList.toggle('sel', G.verdict === 'cant');
    $('vImp').disabled = $('vCant').disabled = G.submitted;
    var pi = '';
    if (!G.pin) pi = 'Tap the globe where you think the exit really is.';
    else {
      var exP = LA.excluding(G.disks, G.pin);
      pi = 'Pin at ' + fmt1(Math.abs(G.pin.lat)) + '\u00b0' + (G.pin.lat >= 0 ? 'N' : 'S') + ' ' + fmt1(Math.abs(G.pin.lon)) + '\u00b0' + (G.pin.lon >= 0 ? 'E' : 'W') + ' \u00b7 ' +
        (exP.length ? '<span style="color:var(--red)">outside the ' + esc(exP[0].lm.name) + ' disk</span>' : (G.disks.length ? 'inside every disk' : 'no disks yet'));
    }
    $('pinInfo').innerHTML = pi;
    var pending = G.ripples.length > 0;
    $('submitBtn').disabled = !(G.verdict && G.pin) || G.submitted || pending;
    $('submitBtn').textContent = !G.verdict ? 'Choose a verdict' : !G.pin ? 'Place your pin' : 'File report';
  }
  $('vImp').onclick = function () { if (G.submitted) return; G.verdict = 'impossible'; sfx.tick(); updateUI(); };
  $('vCant').onclick = function () { if (G.submitted) return; G.verdict = 'cant'; sfx.tick(); updateUI(); };
  $('selfBtn').onclick = function () { ac(); measureSelf(); };
  $('submitBtn').onclick = function () { submit(); };

  function submit() {
    if (G.submitted || !G.verdict || !G.pin) return;
    var cs = G.cs;
    var sc = LA.score(cs, G.disks, G.verdict, G.pin, G.budget);
    G.submitted = true; G.total += sc.total; G.history.push({ title: cs.title, claim: cs.claimPlace.name, truth: cs.truthPlace.name, score: sc.total, max: 800 + cs.budget * 50 });
    sfx.stamp();
    var good = sc.verdictPts >= 400;
    if (good) sfx.good(); else sfx.bad();
    var mid = LA.fromVec(LA.toVec(cs.claimPlace.lat, cs.claimPlace.lon).map(function (v, i) { return v + LA.toVec(cs.truthPlace.lat, cs.truthPlace.lon)[i]; }));
    var span = LA.dist(cs.claimPlace, cs.truthPlace);
    flyTo(cs.honest ? cs.truthPlace.lat : mid.lat, cs.honest ? cs.truthPlace.lon : mid.lon, span > 6000 ? 1.0 : span > 2500 ? 1.4 : 2.2, 900);
    updateUI();
    setTimeout(function () { showResult(sc); }, reduced ? 200 : 1400);
  }
  function showResult(sc) {
    var cs = G.cs, span = LA.dist(cs.claimPlace, cs.truthPlace);
    var head = cs.honest ? 'Honest exit' : 'Lying exit';
    var where = cs.honest ? 'The exit really was in ' + cs.truthPlace.name + '.' : 'The exit was in ' + cs.truthPlace.name + ', ' + cs.truthPlace.country + ', ' + fmt(span) + ' km from ' + cs.claimPlace.name + '.';
    var det = Object.keys(cs.detours).filter(function (k) { return G.probed[k]; }).map(function (k) { return LA.place(k).name + ' routed via ' + LA.place(cs.detours[k]).name; });
    var html = '<h2>' + head + ' \u00b7 ' + fmt(sc.total) + ' pts</h2><p>' + esc(where) + '</p>' +
      '<p>' + esc(sc.verdictMsg) + '</p>' +
      (det.length ? '<p class="small">Circuitous routes you probed: ' + esc(det.join('; ')) + ' (dashed on the globe).</p>' : '') +
      '<div class="row"><span>Verdict</span><span>' + sc.verdictPts + ' / 400</span></div>' +
      '<div class="row"><span>Pin (' + fmt(sc.pinErr) + ' km off' + (sc.pinInside ? '' : ', impossible spot') + ')</span><span>' + sc.pinPts + ' / 400</span></div>' +
      '<div class="row"><span>Unused probes</span><span>' + sc.probePts + ' / ' + cs.budget * 50 + '</span></div>' +
      '<p class="lesson">' + esc(cs.lesson) + '</p>';
    var last = G.mode === 'campaign' && G.idx >= LA.CASES.length - 1;
    html += '<div class="btns">' + (G.mode === 'night' ? '<button id="endBtn">End shift</button>' : '') + '<button id="lookBtn">Look at the globe</button><button id="nextBtn" class="primary">' + (last ? 'Shift report' : 'Next case') + '</button></div>';
    openModal(html);
    $('nextBtn').onclick = function () { closeModal(); next(); };
    $('lookBtn').onclick = function () { closeModal(); toast('Tap "Next case" in the panel when you are done looking.'); showNextInPanel(); };
    if ($('endBtn')) $('endBtn').onclick = function () { closeModal(); summary(); };
  }
  function showNextInPanel() {
    var b = $('submitBtn'); b.disabled = false; b.textContent = 'Next case';
    b.onclick = function () { b.onclick = function () { submit(); }; next(); };
  }
  function next() {
    $('submitBtn').onclick = function () { submit(); };
    if (G.mode === 'campaign') {
      if (G.idx >= LA.CASES.length - 1) { summary(); return; }
      G.idx++; startCase(LA.campaignCase(G.idx, BASE_SEED + G.idx * 101));
    } else {
      startCase(LA.randomCase(BASE_SEED + 7777 + G.history.length * 131));
    }
  }
  function rank(total, max) {
    var f = total / max;
    return f >= 0.86 ? 'Light-cone auditor' : f >= 0.7 ? 'Senior verifier' : f >= 0.5 ? 'Analyst' : 'Trainee (the proxies thank you)';
  }
  function summary() {
    var max = G.history.reduce(function (a, h) { return a + h.max; }, 0) || 1;
    var rows = G.history.map(function (h) { return '<div class="row"><span>' + esc(h.title) + ' <span class="small">claimed ' + esc(h.claim) + ', was ' + esc(h.truth) + '</span></span><span>' + fmt(h.score) + '</span></div>'; }).join('');
    var best = 0; try { best = +localStorage.getItem('la-best-' + G.mode) || 0; if (G.total > best) localStorage.setItem('la-best-' + G.mode, String(G.total)); } catch (e) {}
    var html = '<h2>' + (G.mode === 'campaign' ? 'Shift report' : 'Night shift report') + '</h2>' +
      '<p><b>' + fmt(G.total) + '</b> of ' + fmt(max) + ' points \u00b7 rank: <b>' + rank(G.total, max) + '</b>' + (best && best >= G.total ? ' \u00b7 best ' + fmt(best) : (best ? ' \u00b7 new best!' : '')) + '</p>' + rows +
      '<p class="lesson">Researchers using this exact method found that a third of 2,269 commercial proxies were definitely not in the country advertised, mostly sitting in cheap, well-connected hosting countries.</p>' +
      '<div class="btns"><button id="againBtn" class="primary">Play the 5 cases again</button><button id="night2Btn">Night shift (endless)</button></div>';
    openModal(html);
    $('againBtn').onclick = function () { closeModal(); begin('campaign'); };
    $('night2Btn').onclick = function () { closeModal(); begin('night'); };
  }
  function begin(mode) {
    G.mode = mode; G.idx = 0; G.total = 0; G.history = []; BASE_SEED = (Date.now() / 1000) | 0;
    startCase(mode === 'campaign' ? LA.campaignCase(0, BASE_SEED) : LA.randomCase(BASE_SEED + 7777));
  }

  // ---------------- modal / toast ----------------
  function openModal(html) { $('resultBody').innerHTML = html; $('result').classList.add('on'); var b = $('resultBody').querySelector('button.primary'); if (b) b.focus(); }
  function closeModal() { $('result').classList.remove('on'); }
  var toastT = 0;
  function toast(msg) { var t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('show'); }, 3400); }
  $('helpBtn').onclick = function () {
    openModal('<h2>How it works</h2><div class="eq">max distance = (RTT / 2) &times; 200 km/ms</div>' +
      '<p>Light in optical fibre covers about 200 km per millisecond. Queues, routers and detours only ever <i>add</i> delay, so a round-trip time gives a hard upper bound on distance: a disk around the landmark.</p>' +
      '<p>The exit must sit inside every disk at once (the amber region). If the claimed city is outside any disk, the claim is physically impossible. If it is inside all of them you cannot disprove it, and RTT can never prove it true.</p>' +
      '<p>Exits that ignore pings: time client &rarr; proxy &rarr; landmark (B) and a connection through the proxy back to yourself (C = your leg twice). The proxy\'s leg is A = B - C/2.</p>' +
      '<p>Scoring: correct, supported verdict 400; accusing without a disk that proves it scores 0. Pin up to 400 (halved if outside a disk). 50 per unused probe.</p>' +
      '<p class="small">Controls: drag to rotate, pinch or scroll to zoom, tap a landmark (white dot) to probe, tap elsewhere to pin. Keyboard: arrow keys rotate, +/- zoom.</p>' +
      '<div class="btns"><button id="closeHelp" class="primary">Back to the case</button></div>');
    $('closeHelp').onclick = closeModal;
  };
  $('muteBtn').onclick = function () { setMute(!muted); if (!muted) { ac(); sfx.tick(); } };
  document.addEventListener('keydown', function (e) {
    if (e.target && e.target.tagName === 'INPUT') return;
    var step = 8 / view.zoom;
    if (e.key === 'ArrowLeft') { view.lon -= step; dirty = true; }
    else if (e.key === 'ArrowRight') { view.lon += step; dirty = true; }
    else if (e.key === 'ArrowUp') { view.lat = clamp(view.lat + step, -80, 80); dirty = true; }
    else if (e.key === 'ArrowDown') { view.lat = clamp(view.lat - step, -80, 80); dirty = true; }
    else if (e.key === '+' || e.key === '=') { view.zoom = clamp(view.zoom * 1.25, 0.8, 6); dirty = true; }
    else if (e.key === '-') { view.zoom = clamp(view.zoom / 1.25, 0.8, 6); dirty = true; }
    else if (e.key === 'Escape' && $('result').classList.contains('on') && $('closeHelp')) closeModal();
  });
  $('startBtn').onclick = function () { ac(); $('intro').classList.remove('on'); begin('campaign'); };
  $('nightBtn').onclick = function () { ac(); $('intro').classList.remove('on'); begin('night'); };

  // ---------------- boot ----------------
  window.addEventListener('resize', resize);
  setMute(muted);
  resize();
  G.cs = LA.campaignCase(0, BASE_SEED);
  updateUI();

  if (params.has('demo')) {
    $('intro').classList.remove('on');
    reduced = true;
    var di = clamp(parseInt(params.get('demo'), 10) || 2, 1, 5) - 1;
    G.mode = 'campaign'; G.idx = di; G.total = 0;
    startCase(LA.campaignCase(di, 4242));
    var picks = { 0: ['ams', 'par', 'waw'], 1: ['dub', 'sto', 'mad', 'rey'], 2: ['fra', 'mad', 'mow'], 3: ['sel', 'tyo', 'mnl'], 4: ['nbo', 'cpt', 'cai'] }[di];
    if (!G.cs.pingable) measureSelf();
    picks.forEach(function (id) {
      G.budget++; var m = measureFor(id), p = LA.place(id), dk = LA.diskFor(id, m.min, G.selfC);
      G.probed[id] = { min: m.min, samples: m.samples }; dk.vec = LA.toVec(p.lat, p.lon); dk.shown = dk.radius; G.disks.push(dk); G.budget--;
    });
    G.budget = Math.max(0, G.cs.budget - picks.length - (G.cs.pingable ? 0 : 1));
    G.verdict = 'impossible'; G.pin = { lat: G.cs.truthPlace.lat + 1.2, lon: G.cs.truthPlace.lon - 1.5 };
    var dz = { 0: [50, 8, 2.4], 1: [57, -4, 1.9], 2: [30, 5, 1.2], 3: [25, 118, 1.7], 4: [-20, 15, 1.4] }[di];
    view.lat = dz[0]; view.lon = dz[1]; view.zoom = dz[2]; tween = null; dirty = true;
    $('toast').classList.remove('show');
    updateUI();
  }
  if (params.has('selftest')) {
    var res = [];
    res.push(['land Sahara', landAt(23, 10) > 128]);
    res.push(['ocean Pacific', landAt(0, -150) < 128]);
    res.push(['land Antarctica', landAt(-85, 40) > 128]);
    res.push(['ocean Atlantic', landAt(30, -40) < 128]);
    var vw = V(), s = toScreen(vw, view.lat, view.lon); res.push(['centre projects to middle', Math.abs(s.x - W / 2) < 1e-6 && Math.abs(s.y - H / 2) < 1e-6]);
    var back = fromScreen(vw, W / 2 + 10, H / 2 - 10); var s2 = toScreen(vw, back.lat, back.lon); res.push(['screen round trip', Math.abs(s2.x - W / 2 - 10) < 1e-6]);
    var t0 = performance.now(); renderGlobe(1); var ms = performance.now() - t0; res.push(['render ' + ms.toFixed(0) + 'ms', ms < 2000]);
    var bad = res.filter(function (r) { return !r[1]; });
    document.title = (bad.length ? 'SELFTEST FAIL ' : 'SELFTEST PASS ') + res.map(function (r) { return r[0] + ':' + (r[1] ? 'ok' : 'FAIL'); }).join(', ');
    console.log(document.title);
  }
  if (params.has('playtest')) {
    // Scripted full run through the 5 cases using the real UI handlers; result goes to document.title.
    reduced = true;
    var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    var log = [];
    (async function () {
      try {
        $('startBtn').click();
        for (var ci = 0; ci < LA.CASES.length; ci++) {
          var cs = G.cs;
          if (!cs.pingable) { $('selfBtn').click(); }
          var order = G.lms.filter(function (l) { return cs.offline.indexOf(l) < 0 && !cs.detours[l]; })
            .sort(function (a, b) { return LA.dist(LA.place(a), cs.claimPlace) - LA.dist(LA.place(b), cs.claimPlace); });
          for (var oi = 0; oi < order.length && G.budget > 0; oi++) {
            var row = $('probeList').querySelector('[data-id="' + order[oi] + '"]');
            row.click();
            await sleep(1800);
            if (LA.excluding(G.disks, cs.claimPlace).length) break;
          }
          var proof = LA.excluding(G.disks, cs.claimPlace).length > 0;
          (proof ? $('vImp') : $('vCant')).click();
          G.pin = { lat: cs.truthPlace.lat + 0.3, lon: cs.truthPlace.lon }; updateUI();
          if ($('submitBtn').disabled) throw new Error('submit disabled in ' + cs.key);
          $('submitBtn').click();
          await sleep(400);
          var body = $('resultBody').textContent;
          log.push(cs.key + ':' + G.history[G.history.length - 1].score + (proof === !cs.honest ? '' : '(verdict mismatch)'));
          if (!/pts/.test(body)) throw new Error('no result modal');
          $('nextBtn').click();
          await sleep(100);
        }
        var sum = $('resultBody').textContent;
        if (!/Shift report/.test(sum)) throw new Error('no summary');
        document.title = 'PLAYTEST PASS total=' + G.total + ' ' + log.join(' ');
      } catch (err) { document.title = 'PLAYTEST FAIL ' + err.message + ' ' + log.join(' '); }
      console.log(document.title);
    })();
  }
  requestAnimationFrame(frame);
})();
