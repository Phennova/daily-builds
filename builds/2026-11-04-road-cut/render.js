/* Road Cut - cross-section renderer. Depends on Geo. Draws into ImageData; no DOM access other than the canvas passed in. */
(function (root) {
  'use strict';
  var Geo = root.Geo;

  function hash(i, j, k) {
    var h = (Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263) + Math.imul(k | 0, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function mod(a, b) { var r = a % b; return r < 0 ? r + b : r; }

  var BASE = {
    gneiss: [146, 128, 138], sandstone: [216, 192, 142], shale: [132, 136, 124], limestone: [182, 191, 192],
    conglomerate: [198, 166, 122], siltstone: [180, 164, 136], dolomite: [200, 186, 160], redbed: [168, 98, 76],
    coal: [50, 46, 44], basalt: [64, 67, 72], granite: [224, 192, 180]
  };
  var INK = {
    gneiss: [98, 84, 98], sandstone: [148, 118, 78], shale: [86, 90, 82], limestone: [116, 126, 130],
    conglomerate: [120, 92, 60], siltstone: [124, 110, 88], dolomite: [138, 122, 98], redbed: [124, 64, 50],
    coal: [92, 88, 84], basalt: [40, 42, 46], granite: [140, 100, 100]
  };

  // Writes rgb of a rock pixel into out[0..2]. u,v: pattern coords (world units), m: event index, px: world units per pixel.
  function rockColor(rock, u, v, m, px, out) {
    var b = BASE[rock], ink = INK[rock], k = 0, lw = Math.max(0.32, px * 0.55), tint = 0.94 + 0.12 * hash(m, 7, 3);
    var r = b[0], g = b[1], bl = b[2], ci, cj, cx, cy, d, row, h1;
    switch (rock) {
      case 'sandstone':
        ci = Math.floor(u / 2.6); cj = Math.floor(v / 2.6);
        cx = (ci + 0.2 + 0.6 * hash(ci, cj, m)) * 2.6; cy = (cj + 0.2 + 0.6 * hash(cj, ci, m + 9)) * 2.6;
        d = Math.hypot(u - cx, v - cy);
        if (d < Math.max(0.42, px * 0.6)) k = 0.85;
        tint *= 0.97 + 0.03 * Math.sin(v * 0.9);
        break;
      case 'shale':
        row = Math.floor(v / 2.2);
        if (Math.abs(v - (row + 0.5) * 2.2) < lw * 0.8 && mod(u + row * 3.1, 5) < 3.1) k = 0.9;
        break;
      case 'limestone':
        row = Math.floor(v / 4);
        if (mod(v, 4) < lw || mod(u + (row & 1) * 4, 8) < lw) k = 0.85;
        break;
      case 'conglomerate':
        ci = Math.floor(u / 5); cj = Math.floor(v / 5);
        h1 = hash(ci, cj, m + 31);
        cx = (ci + 0.3 + 0.4 * hash(ci, cj, m + 5)) * 5; cy = (cj + 0.3 + 0.4 * h1) * 5;
        var rr = 0.9 + 0.8 * h1;
        d = Math.hypot((u - cx) * 0.85, v - cy);
        if (Math.abs(d - rr) < lw * 0.8) k = 0.9;
        else if (d < rr) tint *= 1.06;
        break;
      case 'siltstone':
        row = Math.floor(v / 3);
        if (Math.abs(v - row * 3) < lw * 0.6 && mod(u + row * 2.3, 6) < 2.4) k = 0.8;
        else {
          ci = Math.floor(u / 1.8); cj = Math.floor(v / 1.8);
          if (hash(ci, cj, m) < 0.25 && Math.hypot(u - (ci + 0.5) * 1.8, v - (cj + 0.5) * 1.8) < Math.max(0.3, px * 0.5)) k = 0.7;
        }
        break;
      case 'dolomite':
        row = Math.floor(v / 4);
        if (mod(v, 4) < lw || mod(u + v * 0.55 + (row & 1) * 4, 8) < lw) k = 0.8;
        break;
      case 'redbed':
        tint *= 0.95 + 0.06 * Math.sin(v * 2.1 + 0.4 * Math.sin(u * 0.3));
        ci = Math.floor(u / 7); cj = Math.floor(v / 5);
        if (hash(ci, cj, m) < 0.12 && Math.hypot(u - (ci + 0.5) * 7, (v - (cj + 0.5) * 5) * 1.6) < 1.3) { r = 150; g = 160; bl = 130; }
        break;
      case 'coal':
        if (mod(u + v * 0.1, 3.5) < lw * 0.6) k = 0.6;
        break;
      case 'gneiss':
        var w = Math.sin((v + 3 * Math.sin(u / 9) + 1.4 * Math.sin(u / 3.7 + v / 8)) * 0.85);
        if (w > 0.55) { r = 182; g = 168; bl = 172; } else if (w < -0.6) k = 0.75;
        break;
      case 'basalt':
        tint *= 0.9 + 0.2 * hash(Math.floor(u * 1.3), Math.floor(v * 1.3), m);
        break;
      case 'granite':
        ci = Math.floor(u / 4); cj = Math.floor(v / 4);
        cx = (ci + 0.3 + 0.4 * hash(ci, cj, m)) * 4; cy = (cj + 0.3 + 0.4 * hash(cj, ci, m)) * 4;
        var du = Math.abs(u - cx), dv = Math.abs(v - cy), arm = 1.1, th = Math.max(0.28, px * 0.5);
        if ((du < th && dv < arm) || (dv < th && du < arm)) k = 0.9;
        else if (hash(Math.floor(u * 1.5), Math.floor(v * 1.5), m + 2) < 0.04) k = 0.6;
        break;
    }
    r *= tint; g *= tint; bl *= tint;
    if (k) { r += (ink[0] - r) * k; g += (ink[1] - g) * k; bl += (ink[2] - bl) * k; }
    out[0] = r; out[1] = g; out[2] = bl;
  }

  /* Compute a frame of the cross-section at w x h pixels, after events 0..upto (event upto at progress t).
   * Returns { w, h, rgba, mat, fault, econ } where fault[i] = fault event index if the pixel is on a fault trace (wide),
   * econ[i] = erosion event index if the pixel lies on an unconformity contact. */
  function computeFrame(ev, upto, t, w, h, opts) {
    opts = opts || {};
    var N = w * h, rgba = new Uint8ClampedArray(N * 4), mat = new Int16Array(N), fault = new Int8Array(N).fill(-1),
      econ = new Int8Array(N).fill(-1);
    var px = Geo.W / w, s = Geo.newSample(), col = [0, 0, 0], i, j, idx, x, y, m;
    var n = ev.length, final = upto === n - 1 && t >= 1;
    var water = opts.water;
    var lastE = new Int16Array(n), le = -1;
    for (i = 0; i < n; i++) { lastE[i] = le; if (ev[i].kind === 'erosion') le = i; }
    var faultLW = Math.max(0.45, px * 0.7), faultHL = Math.max(1.8, px * 3);
    for (j = 0; j < h; j++) {
      y = Geo.H - (j + 0.5) * (Geo.H / h);
      for (i = 0; i < w; i++) {
        x = (i + 0.5) * px;
        Geo.evaluate(ev, x, y, upto, t, s);
        idx = j * w + i; m = s.mat; mat[idx] = m;
        var o = idx * 4;
        if (m < 0) {
          var f = j / h;
          if (water) { rgba[o] = 92 + 30 * f; rgba[o + 1] = 132 + 24 * f; rgba[o + 2] = 140 + 14 * f; }
          else { rgba[o] = 196 + 34 * f; rgba[o + 1] = 210 + 20 * f; rgba[o + 2] = 216 + 4 * f; }
          rgba[o + 3] = 255;
          continue;
        }
        rockColor(ev[m].rock, s.fx, s.fy, m, px, col);
        if (s.fidx >= 0) {
          if (s.fdist < faultLW) { col[0] = col[0] * 0.25 + 10; col[1] = col[1] * 0.25 + 8; col[2] = col[2] * 0.25 + 8; }
          if (s.fdist < faultHL) fault[idx] = s.fidx;
        }
        rgba[o] = col[0]; rgba[o + 1] = col[1]; rgba[o + 2] = col[2]; rgba[o + 3] = 255;
      }
    }
    // contacts: thin dark line at every contact, heavier wavy line at unconformities
    var thick = Math.max(1, Math.round(0.6 / px));
    for (j = 0; j < h; j++) {
      for (i = 0; i < w; i++) {
        idx = j * w + i; m = mat[idx];
        if (m < 0) continue;
        var nb = -2;
        if (i + 1 < w && mat[idx + 1] !== m) nb = mat[idx + 1];
        else if (j + 1 < h && mat[idx + w] !== m) nb = mat[idx + w];
        else if (i > 0 && mat[idx - 1] !== m) nb = mat[idx - 1];
        else if (j > 0 && mat[idx - w] !== m) nb = mat[idx - w];
        if (nb === -2 || nb < 0) continue;
        var a = Math.min(m, nb), b = Math.max(m, nb), dark = 0.62;
        if (ev[b].kind === 'deposit' && lastE[b] >= 0 && a < lastE[b]) {
          dark = 0.32;
          for (var dy = -thick; dy <= thick; dy++) {
            var jj = j + dy; if (jj < 0 || jj >= h) continue;
            var q = jj * w + i; econ[q] = lastE[b];
            if (mat[q] >= 0) { rgba[q * 4] *= 0.55; rgba[q * 4 + 1] *= 0.5; rgba[q * 4 + 2] *= 0.48; }
          }
        }
        var o2 = idx * 4;
        rgba[o2] *= dark; rgba[o2 + 1] *= dark; rgba[o2 + 2] *= dark;
      }
    }
    // soil and grass along the present land surface
    if (final) {
      var soil = Math.max(2, Math.round(2.6 / px)), grass = Math.max(1, Math.round(1.1 / px));
      for (i = 0; i < w; i++) {
        for (j = 0; j < h; j++) if (mat[j * w + i] >= 0) break;
        for (var d = 0; d < soil && j + d < h; d++) {
          var p = ((j + d) * w + i) * 4;
          if (d < grass) { rgba[p] = 104; rgba[p + 1] = 124 + 14 * hash(i, d, 1); rgba[p + 2] = 72; }
          else { var kk = 0.55 + 0.3 * (d / soil); rgba[p] = rgba[p] * kk + 92 * (1 - kk); rgba[p + 1] = rgba[p + 1] * kk + 72 * (1 - kk); rgba[p + 2] = rgba[p + 2] * kk + 54 * (1 - kk); }
        }
      }
    }
    return { w: w, h: h, rgba: rgba, mat: mat, fault: fault, econ: econ, px: px };
  }

  /* Overlay mask for highlighting a card's object: returns rgba (transparent except highlight) */
  function highlightMask(frame, ev, idx, color) {
    var N = frame.w * frame.h, out = new Uint8ClampedArray(N * 4), e = ev[idx], c = color || [255, 214, 92];
    var any = false;
    for (var i = 0; i < N; i++) {
      var on = false;
      if (Geo.isMaterial(e)) on = frame.mat[i] === idx;
      else if (e.kind === 'fault') on = frame.fault[i] === idx;
      else if (e.kind === 'erosion') on = frame.econ[i] === idx;
      else if (Geo.isDeform(e)) on = frame.mat[i] >= 0 && frame.mat[i] < idx && ev[frame.mat[i]].kind === 'deposit';
      if (on) { any = true; var o = i * 4; out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = Geo.isMaterial(e) || Geo.isDeform(e) ? 92 : 230; }
    }
    return any ? out : null;
  }

  /* Which card object is at canvas pixel (i,j) of a frame: fault/erosion trace first, then the material. */
  function pickAt(frame, i, j, cards) {
    var r = Math.max(2, Math.round(1.6 / frame.px)), best = -1;
    var isCard = {}; cards.forEach(function (c) { isCard[c] = true; });
    for (var dj = -r; dj <= r && best < 0; dj++) for (var di = -r; di <= r; di++) {
      var ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= frame.w || jj >= frame.h) continue;
      var q = jj * frame.w + ii;
      if (frame.fault[q] >= 0 && isCard[frame.fault[q]] && Math.abs(di) + Math.abs(dj) <= r) { best = frame.fault[q]; break; }
    }
    if (best >= 0) return best;
    var q0 = j * frame.w + i;
    if (frame.econ[q0] >= 0 && isCard[frame.econ[q0]]) return frame.econ[q0];
    var m = frame.mat[q0];
    return m >= 0 && isCard[m] ? m : -1;
  }

  root.Render = { computeFrame: computeFrame, highlightMask: highlightMask, pickAt: pickAt, rockColor: rockColor, BASE: BASE, INK: INK };
})(typeof self !== 'undefined' ? self : this);
