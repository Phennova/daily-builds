/* Call the Ball - renderer, input, audio, UI flow. Depends on sim.js (window.Sim). */
(function () {
  'use strict';
  var S = window.Sim, C = S.C, DEG = S.DEG;
  var $ = function (id) { return document.getElementById(id); };
  var Q = new URLSearchParams(location.search);
  var DEMO = Q.has('demo');
  var AUTO = Q.has('auto'); // test hook: autopilot flies your passes
  var SPEED = Math.max(1, Math.min(20, parseFloat(Q.get('speed') || '1') || 1)); // test hook: time multiplier
  var reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------------- Canvas ----------------
  var cv = $('view'), g = cv.getContext('2d');
  var W = 0, H = 0, DPR = 1, F = 600, CX = 0, CY = 0;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    F = Math.max((W / 2) / Math.tan(22 * DEG), (H / 2) / Math.tan(30 * DEG));
    CX = W / 2; CY = H * 0.42;
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------------- Ship geometry (ship frame: u fwd from stern, w to starboard) ----------------
  var SA = C.ANGLE_DECK, cosA = Math.cos(SA), sinA = Math.sin(SA);
  var RAMP_U = 0, RAMP_W = -5;
  function ship2deck(u, w) { // -> [x, z] in landing frame
    var du = u - RAMP_U, dw = w - RAMP_W;
    return [C.RAMP_X + du * cosA - dw * sinA, du * sinA + dw * cosA];
  }
  var DECK_OUTLINE = [[-2, -18], [0, 30], [20, 36], [200, 38], [270, 30], [320, 12], [332, 0], [326, -10], [272, -24],
    [228, -30], [222, -56], [160, -52], [60, -42], [10, -31]].map(function (p) { return ship2deck(p[0], p[1]); });
  var HULL_OUTLINE = DECK_OUTLINE.map(function (p) { // narrower at the waterline, pulled toward ship centreline
    var c = ship2deck(165, 0);
    return [c[0] + (p[0] - c[0]) * 0.9, c[1] + (p[1] - c[1]) * 0.62];
  });
  var ISLAND = [[188, 27], [216, 27], [216, 37], [188, 37]].map(function (p) { return ship2deck(p[0], p[1]); });
  // parked aircraft: simple delta silhouettes in ship frame (nose toward u+)
  var PARKED = [];
  [[250, 26], [262, 18], [274, 10], [150, 30], [130, 30], [110, 30], [90, 31], [232, 30], [300, 6]].forEach(function (c) {
    var u = c[0], w = c[1], a = [[u + 9, w], [u - 7, w - 6], [u - 9, w - 6], [u - 9, w + 6], [u - 7, w + 6]];
    PARKED.push(a.map(function (p) { return ship2deck(p[0], p[1]); }));
  });
  var CATS = [[[230, -6], [325, -2]], [[230, 6], [325, 2]]].map(function (l) { return [ship2deck(l[0][0], l[0][1]), ship2deck(l[1][0], l[1][1])]; });
  var SHIP_AXIS = [cosA, sinA]; // ship heading in landing frame (x,z)
  var SHIP_SPEED = 20 * 0.5144;
  var LENS = { x: 6, z: -17.5, y: 1.4 };

  // ---------------- Camera ----------------
  var cam = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, fx: 0, fz: 0, rx: 0, rz: 0, cp: 1, sp: 0, cr: 1, sr: 0 };
  function setCam(x, y, z, yaw, pitch, roll) {
    cam.x = x; cam.y = y; cam.z = z;
    cam.fx = Math.cos(yaw); cam.fz = Math.sin(yaw); cam.rx = -Math.sin(yaw); cam.rz = Math.cos(yaw);
    cam.cp = Math.cos(pitch); cam.sp = Math.sin(pitch); cam.cr = Math.cos(roll); cam.sr = Math.sin(roll);
  }
  // world -> camera coords [right, up, forward]
  function toCam(x, y, z, out) {
    var dx = x - cam.x, dy = y - cam.y, dz = z - cam.z;
    var r = dx * cam.rx + dz * cam.rz;
    var fh = dx * cam.fx + dz * cam.fz;
    var f = fh * cam.cp + dy * cam.sp;
    var u = dy * cam.cp - fh * cam.sp;
    out[0] = r * cam.cr - u * cam.sr;
    out[1] = u * cam.cr + r * cam.sr;
    out[2] = f;
    return out;
  }
  var tmp = [0, 0, 0];
  function proj(x, y, z) {
    toCam(x, y, z, tmp);
    if (tmp[2] < 0.5) return null;
    return [CX + tmp[0] / tmp[2] * F, CY - tmp[1] / tmp[2] * F, tmp[2]];
  }
  // project a polygon given world points, clipping against the near plane
  var NEAR = 0.6;
  function projPoly(pts) {
    var cs = pts.map(function (p) { return toCam(p[0], p[1], p[2], [0, 0, 0]); });
    var outp = [], n = cs.length;
    for (var i = 0; i < n; i++) {
      var a = cs[i], b = cs[(i + 1) % n];
      var ina = a[2] >= NEAR, inb = b[2] >= NEAR;
      if (ina) outp.push(a);
      if (ina !== inb) {
        var t = (NEAR - a[2]) / (b[2] - a[2]);
        outp.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, NEAR]);
      }
    }
    return outp.map(function (c) { return [CX + c[0] / c[2] * F, CY - c[1] / c[2] * F]; });
  }
  function fillPoly(pts, style) {
    var p = projPoly(pts);
    if (p.length < 3) return;
    g.beginPath(); g.moveTo(p[0][0], p[0][1]);
    for (var i = 1; i < p.length; i++) g.lineTo(p[i][0], p[i][1]);
    g.closePath(); g.fillStyle = style; g.fill();
  }
  function line3(a, b, style, w) {
    var p = projPoly([a, b, b]);
    if (p.length < 2) return;
    toCam((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, tmp);
    if (w < 0) w = Math.max(0.8, Math.min(4, -w * F / Math.max(1, tmp[2])));
    g.beginPath(); g.moveTo(p[0][0], p[0][1]); g.lineTo(p[1][0], p[1][1]);
    g.strokeStyle = style; g.lineWidth = w; g.stroke();
  }
  function light(x, y, z, color, size, glow, maxR) {
    var p = proj(x, y, z);
    if (!p) return;
    var r = Math.max(0.9, Math.min(maxR || 3.2, size * F / p[2]));
    if (glow) {
      g.globalAlpha = 0.35;
      g.beginPath(); g.arc(p[0], p[1], r * (glow === 2 ? 1.8 : 2.6) + 1.2, 0, 6.283); g.fillStyle = color; g.fill();
      g.globalAlpha = 1;
    }
    g.beginPath(); g.arc(p[0], p[1], r, 0, 6.283); g.fillStyle = color; g.fill();
  }

  // ---------------- Palettes ----------------
  var PAL = {
    day: { skyTop: '#2f6fb3', skyHor: '#cfe3f1', seaHor: '#3f6280', seaNear: '#0c2a44', deck: '#6d7278', hull: '#3a4048',
      hullDark: '#2a2f36', mark: 'rgba(250,250,245,.95)', island: '#7a8089', wake: 'rgba(215,232,242,.04)', jets: '#3a3f46', clouds: 'rgba(255,255,255,.75)', cap: 'rgba(235,245,255,.55)', lights: 0.25, stars: 0 },
    dusk: { skyTop: '#1c2547', skyHor: '#f29a5a', seaHor: '#6a4c52', seaNear: '#0e1a2b', deck: '#3a3d44', hull: '#22252c',
      hullDark: '#181a20', mark: 'rgba(235,230,220,.7)', island: '#3a3e46', wake: 'rgba(240,200,170,.05)', jets: '#1c1e23', clouds: 'rgba(255,170,120,.45)', cap: 'rgba(255,215,180,.4)', lights: 0.8, stars: 0.25, sun: true },
    night: { skyTop: '#02040a', skyHor: '#0c1626', seaHor: '#08101c', seaNear: '#010204', deck: '#15171b', hull: '#0b0d10',
      hullDark: '#07080a', mark: 'rgba(120,120,120,.18)', island: '#0c0d10', wake: 'rgba(120,150,170,.04)', jets: '#0a0b0d', cap: 'rgba(160,190,210,.08)', lights: 1, stars: 1 }
  };

  // sea caps (whitecaps) in a water frame that drifts aft relative to the ship
  var CAPS = [];
  (function () { var r = S.rng(7); for (var i = 0; i < 420; i++) CAPS.push([r() * 2400 - 1200, r() * 2400 - 1200, 0.6 + r() * 1.8]); })();
  var FOAM = [];
  (function () { var r = S.rng(31); for (var i = 0; i < 260; i++) FOAM.push([r() * 900, (r() * 2 - 1) * Math.sqrt(r()), 0.5 + r() * 1.4]); })();
  var CLOUDS = [];
  (function () { var r = S.rng(23); for (var i = 0; i < 14; i++) CLOUDS.push([r() * 1.6 - 0.8, 0.03 + r() * 0.12, 0.08 + r() * 0.2]); })();
  var STARS = [];
  (function () { var r = S.rng(11); for (var i = 0; i < 260; i++) STARS.push([r() * 6.283, Math.asin(r() * 0.95) , r()]); })();

  // ---------------- Scene drawing ----------------
  function drawSky(P, t) {
    // horizon: project far points straight ahead at eye height
    var a = proj(cam.x + cam.fx * 1e5 - cam.rx * 1e5, cam.y, cam.z + cam.fz * 1e5 - cam.rz * 1e5);
    var b = proj(cam.x + cam.fx * 1e5 + cam.rx * 1e5, cam.y, cam.z + cam.fz * 1e5 + cam.rz * 1e5);
    var c = proj(cam.x + cam.fx * 1e5, cam.y, cam.z + cam.fz * 1e5);
    if (!a || !b || !c) { g.fillStyle = P.skyTop; g.fillRect(0, 0, W, H); return; }
    var dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy); dx /= len; dy /= len;
    var nx = -dy, ny = dx; // normal pointing "down" (toward the sea)
    var big = Math.max(W, H) * 3;
    var hx = c[0], hy = c[1];
    // sky
    var sg = g.createLinearGradient(hx - nx * H, hy - ny * H, hx, hy);
    sg.addColorStop(0, P.skyTop); sg.addColorStop(1, P.skyHor);
    g.fillStyle = sg; g.fillRect(0, 0, W, H);
    if (P.stars) {
      g.fillStyle = '#fff';
      for (var i = 0; i < STARS.length; i++) {
        var st = STARS[i], ce = Math.cos(st[1]);
        var p = proj(cam.x + Math.cos(st[0]) * ce * 1e5, cam.y + Math.sin(st[1]) * 1e5 + 800, cam.z + Math.sin(st[0]) * ce * 1e5);
        if (!p) continue;
        g.globalAlpha = P.stars * (0.25 + 0.75 * st[2]) * (0.8 + 0.2 * Math.sin(t * 3 + i));
        g.fillRect(p[0], p[1], st[2] > 0.85 ? 2 : 1.2, st[2] > 0.85 ? 2 : 1.2);
      }
      g.globalAlpha = 1;
    }
    if (P.clouds) {
      g.fillStyle = P.clouds;
      for (var ci = 0; ci < CLOUDS.length; ci++) {
        var cl = CLOUDS[ci];
        var cp = proj(cam.x + Math.cos(cl[0]) * 2e4, cam.y + cl[1] * 2e4, cam.z + Math.sin(cl[0]) * 2e4);
        if (!cp) continue;
        var cw = cl[2] * F;
        g.globalAlpha = 0.5;
        for (var cj = 0; cj < 5; cj++) { g.beginPath(); g.ellipse(cp[0] + (cj - 2) * cw * 0.32, cp[1] + Math.sin(cj * 2.1 + ci) * cw * 0.03, cw * (0.32 - Math.abs(cj - 2) * 0.05), cw * 0.07, 0, 0, 6.283); g.fill(); }
      }
      g.globalAlpha = 1;
    }
    if (P.sun) {
      var sp = proj(cam.x + 1e5 * Math.cos(-0.5), cam.y + 2500, cam.z + 1e5 * Math.sin(-0.5));
      if (sp) {
        var rg = g.createRadialGradient(sp[0], sp[1], 0, sp[0], sp[1], F * 0.25);
        rg.addColorStop(0, 'rgba(255,220,160,.95)'); rg.addColorStop(0.08, 'rgba(255,190,120,.8)'); rg.addColorStop(1, 'rgba(255,140,80,0)');
        g.fillStyle = rg; g.fillRect(sp[0] - F * 0.25, sp[1] - F * 0.25, F * 0.5, F * 0.5);
      }
    }
    // sea
    var seaG = g.createLinearGradient(hx, hy, hx + nx * H * 0.9, hy + ny * H * 0.9);
    seaG.addColorStop(0, P.seaHor); seaG.addColorStop(1, P.seaNear);
    g.beginPath();
    g.moveTo(hx - dx * big, hy - dy * big); g.lineTo(hx + dx * big, hy + dy * big);
    g.lineTo(hx + dx * big + nx * big, hy + dy * big + ny * big); g.lineTo(hx - dx * big + nx * big, hy - dy * big + ny * big);
    g.closePath(); g.fillStyle = seaG; g.fill();
    return { hx: hx, hy: hy, dx: dx, dy: dy };
  }

  function drawSea(P, s) {
    // whitecaps drift aft relative to the ship
    var off = SHIP_SPEED * s.t;
    var ox = -SHIP_AXIS[0] * off, oz = -SHIP_AXIS[1] * off;
    var wy = C.WATER_Y;
    g.fillStyle = P.cap;
    for (var i = 0; i < CAPS.length; i++) {
      var c = CAPS[i];
      var x = c[0] + ox, z = c[1] + oz;
      // wrap into a 2400 m tile centred ahead of the camera
      var cxw = cam.x + cam.fx * 1000, czw = cam.z + cam.fz * 1000;
      x = cxw + (((x - cxw) % 2400) + 3600) % 2400 - 1200;
      z = czw + (((z - czw) % 2400) + 3600) % 2400 - 1200;
      var p = proj(x, wy, z);
      if (!p || p[2] > 2600) continue;
      var r = Math.min(14, c[2] * F / p[2]);
      if (r < 0.25) continue;
      g.globalAlpha = Math.min(1, 1.4 - p[2] / 2000) * Math.min(1, p[2] / 150);
      g.beginPath(); g.ellipse(p[0], p[1], r * 2, Math.max(0.5, r * 0.35), 0, 0, 6.283); g.fill();
    }
    g.globalAlpha = 1;
    // wake: trailing aft from the stern, widening and fading
    var st = ship2deck(0, 0);
    var ax = -SHIP_AXIS[0], az = -SHIP_AXIS[1], nx = -az, nz = ax;
    var segs = [[0, 15], [140, 20], [420, 28], [900, 34]];
    var widths = [1, 0.7, 0.45, 0.22];
    for (var wi = 0; wi < widths.length; wi++) {
      var ws = widths[wi];
      for (var k = 0; k < segs.length - 1; k++) {
        var a0 = segs[k], a1 = segs[k + 1];
        g.globalAlpha = (1 - k / (segs.length - 1) * 0.9) * 0.7;
        fillPoly([[st[0] + ax * a0[0] + nx * a0[1] * ws, wy, st[1] + az * a0[0] + nz * a0[1] * ws], [st[0] + ax * a0[0] - nx * a0[1] * ws, wy, st[1] + az * a0[0] - nz * a0[1] * ws],
          [st[0] + ax * a1[0] - nx * a1[1] * ws, wy, st[1] + az * a1[0] - nz * a1[1] * ws], [st[0] + ax * a1[0] + nx * a1[1] * ws, wy, st[1] + az * a1[0] + nz * a1[1] * ws]], P.wake);
      }
    }
    g.globalAlpha = 1;
    // foam: flecks along the wake, fixed in the water (they stream aft)
    g.fillStyle = P.cap;
    for (var fi = 0; fi < FOAM.length; fi++) {
      var fm = FOAM[fi];
      var along = (fm[0] + off) % 900;
      var half = 15 + along * 0.022;
      var fx = st[0] + ax * along + nx * fm[1] * half, fz = st[1] + az * along + nz * fm[1] * half;
      var fp = proj(fx, wy, fz);
      if (!fp) continue;
      var fr = Math.min(10, fm[2] * F / fp[2]);
      if (fr < 0.3) continue;
      g.globalAlpha = (1 - along / 900) * Math.min(1, fp[2] / 120) * 0.9;
      g.beginPath(); g.ellipse(fp[0], fp[1], fr * 1.6, Math.max(0.5, fr * 0.3), 0, 0, 6.283); g.fill();
    }
    g.globalAlpha = 1;
  }

  function deckPt(s, x, z, h) { return [x, S.deckY(s, x) + (h || 0), z]; }

  function drawShip(P, s, t) {
    var wy = C.WATER_Y;
    // hull: waterline polygon then sides (far first)
    var dk = DECK_OUTLINE.map(function (p) { return deckPt(s, p[0], p[1], 0); });
    var hl = HULL_OUTLINE.map(function (p) { return [p[0], wy + S.deckY(s, p[0]) * 0.3, p[1]]; });
    fillPoly(hl, P.hullDark);
    var sides = [];
    for (var i = 0; i < dk.length; i++) {
      var j = (i + 1) % dk.length;
      var mx = (dk[i][0] + dk[j][0]) / 2, mz = (dk[i][2] + dk[j][2]) / 2;
      sides.push({ d: Math.hypot(mx - cam.x, mz - cam.z), q: [dk[i], dk[j], hl[j], hl[i]], i: i });
    }
    sides.sort(function (a, b) { return b.d - a.d; });
    sides.forEach(function (sd) { fillPoly(sd.q, sd.i % 2 ? P.hull : P.hullDark); });
    fillPoly(dk, P.deck);

    // landing area markings
    var X0 = C.RAMP_X, X1 = C.END_X, HW = C.DECK_HALF;
    var mk = P.mark;
    if (P.lights < 0.5) fillPoly([deckPt(s, X0, -HW, 0.02), deckPt(s, X1, -HW, 0.02), deckPt(s, X1, HW, 0.02), deckPt(s, X0, HW, 0.02)], 'rgba(30,32,36,.45)');
    line3(deckPt(s, X0, -HW, 0.05), deckPt(s, X1, -HW, 0.05), mk, -0.6);
    line3(deckPt(s, X0, HW, 0.05), deckPt(s, X1, HW, 0.05), mk, -0.6);
    for (var x = X0 + 4; x < X1; x += 18) line3(deckPt(s, x, 0, 0.05), deckPt(s, x + 9, 0, 0.05), mk, -0.5);
    // wires
    C.WIRES.forEach(function (wx) { line3(deckPt(s, wx, -HW + 1, 0.15), deckPt(s, wx, HW - 1, 0.15), P.lights > 0.5 ? 'rgba(90,90,90,.5)' : 'rgba(12,12,12,.95)', -0.35); });
    // parked jets on the bow and along the starboard side (dark silhouettes)
    for (var pj = 0; pj < PARKED.length; pj++) {
      var J = PARKED[pj];
      var jp = J.map(function (q) { return deckPt(s, q[0], q[1], 0.6); });
      fillPoly(jp, P.jets || 'rgba(20,22,26,.9)');
    }
    // elevators / bow cat tracks
    CATS.forEach(function (c) { line3(deckPt(s, c[0][0], c[0][1], 0.05), deckPt(s, c[1][0], c[1][1], 0.05), P.lights > 0.5 ? 'rgba(80,80,80,.35)' : 'rgba(40,40,40,.6)', -0.3); });
    // island
    var isl = ISLAND.map(function (p) { return deckPt(s, p[0], p[1], 0); });
    var islT = ISLAND.map(function (p) { return deckPt(s, p[0], p[1], 24); });
    for (i = 0; i < 4; i++) { j = (i + 1) % 4; fillPoly([isl[i], isl[j], islT[j], islT[i]], i % 2 ? P.island : P.hull); }
    fillPoly(islT, P.island);
    var mast = ship2deck(204, 32);
    line3(deckPt(s, mast[0], mast[1], 24), deckPt(s, mast[0], mast[1], 42), P.lights > 0.5 ? '#111' : '#4a5058', 2);

    // lights (brighter at night)
    var L = P.lights;
    if (L > 0.1) {
      g.globalAlpha = L;
      for (x = X0; x <= X1; x += 15) { light(x, S.deckY(s, x) + 0.2, -HW, '#fff3c8', 0.2, L > 0.5 ? 2 : 0, 2.2); light(x, S.deckY(s, x) + 0.2, HW, '#fff3c8', 0.2, L > 0.5 ? 2 : 0, 2.2); }
      for (x = X0 + 6; x <= X1; x += 12) light(x, S.deckY(s, x) + 0.2, 0, '#ffffff', 0.18, L > 0.5 ? 2 : 0, 2);
      for (var zz = -HW; zz <= HW; zz += 3) light(X0, S.deckY(s, X0) + 0.2, zz, '#ff4a3a', 0.22, L > 0.5);
      // drop lights: vertical line below the ramp on the centreline
      for (var dy = 1.5; dy <= 12; dy += 1.5) light(X0 - 1, S.deckY(s, X0) - dy, 0, '#ffb347', 0.28, L > 0.5);
      // island + mast lights
      light(mast[0], S.deckY(s, mast[0]) + 42, mast[1], '#ff3030', 0.5, true);
      light(isl[0][0], isl[0][1] + 20, isl[0][2], '#ff3030', 0.4, true);
      g.globalAlpha = 1;
    }
    drawLens(P, s, t);
  }

  // IFLOLS on the port side of the landing area
  function lensState(s) {
    var b = S.ballCells(s);
    var wo = s.waveoffAt >= 0 && s.phase !== 'trapped';
    var cut = s.lsoCutUntil && s.t < s.lsoCutUntil;
    return { b: b, red: b < -3.2, gone: Math.abs(b) > 6.5, wo: wo, cut: cut };
  }
  function drawLens(P, s, t) {
    var ls = lensState(s), y0 = S.deckY(s, LENS.x) + LENS.y, x = LENS.x, z = LENS.z;
    fillPoly([[x, y0 - 1.4, z - 0.5], [x, y0 - 1.4, z + 0.5], [x, y0 + 1.4, z + 0.5], [x, y0 + 1.4, z - 0.5]], '#050505');
    for (var k = 1; k <= 5; k++) { light(x, y0, z - 0.3 - k * 0.75, '#33ff77', 0.17, true); light(x, y0, z + 0.3 + k * 0.75, '#33ff77', 0.17, true); }
    if (!ls.gone) light(x, y0 + Math.max(-6, Math.min(6, ls.b)) * 0.2, z, ls.red ? '#ff2a2a' : '#ffae2e', 0.2, true);
    var blink = Math.floor(t * 3) % 2 === 0;
    if (ls.wo && blink) for (k = -2; k <= 2; k++) { light(x, y0 + k * 0.4, z - 5, '#ff2020', 0.2, true); light(x, y0 + k * 0.4, z + 5, '#ff2020', 0.2, true); }
    if (ls.cut) for (k = -2; k <= 2; k++) light(x, y0 + 1.7, z + k * 0.5, '#33ff77', 0.18, true);
  }

  // magnified lens repeater inset (2D)
  function drawRepeater(s, t) {
    var ls = lensState(s);
    var w = Math.min(150, W * 0.3), h = w * 0.62, x0 = 10 + (window.visualViewport ? 0 : 0), y0 = 46;
    g.save();
    g.fillStyle = 'rgba(0,0,0,.55)'; g.strokeStyle = 'rgba(255,255,255,.18)'; g.lineWidth = 1;
    roundRect(x0, y0, w, h, 8); g.fill(); g.stroke();
    var cx = x0 + w / 2, cy = y0 + h / 2, cell = h / 16;
    g.fillStyle = '#0a0a0a'; g.fillRect(cx - w * 0.12, y0 + h * 0.08, w * 0.24, h * 0.84);
    var lr = Math.max(2.5, w * 0.03);
    for (var k = 0; k < 4; k++) {
      dot(cx - w * 0.17 - k * w * 0.075, cy, lr, '#33ff77');
      dot(cx + w * 0.17 + k * w * 0.075, cy, lr, '#33ff77');
    }
    if (!ls.gone) {
      var by = cy - Math.max(-6, Math.min(6, ls.b)) * cell;
      g.fillStyle = ls.red ? '#ff2a2a' : '#ffae2e';
      g.shadowColor = g.fillStyle; g.shadowBlur = 10;
      roundRect(cx - w * 0.07, by - cell * 0.6, w * 0.14, cell * 1.2, 3); g.fill();
      g.shadowBlur = 0;
    }
    if (ls.wo && Math.floor(t * 3) % 2 === 0) {
      g.fillStyle = '#ff2020';
      g.fillRect(x0 + 4, y0 + h * 0.2, 5, h * 0.6); g.fillRect(x0 + w - 9, y0 + h * 0.2, 5, h * 0.6);
    }
    if (ls.cut) for (k = -1; k <= 1; k++) dot(cx + k * w * 0.06, y0 + h * 0.08, lr * 0.9, '#33ff77');
    g.fillStyle = 'rgba(225,238,248,.95)'; g.font = '600 11px ui-monospace, Menlo, Consolas, monospace';
    g.fillText('LENS', x0 + 6, y0 + h - 5);
    g.restore();
  }
  function dot(x, y, r, c) { g.beginPath(); g.arc(x, y, r, 0, 6.283); g.fillStyle = c; g.fill(); }
  function roundRect(x, y, w, h, r) {
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }

  // ---------------- HUD ----------------
  var HUDC = 'rgba(120,255,150,.92)';
  function drawHUD(s, hor) {
    g.save();
    g.strokeStyle = HUDC; g.fillStyle = HUDC; g.lineWidth = 1.6;
    g.font = '700 16px ui-monospace, Menlo, Consolas, monospace';
    g.shadowColor = 'rgba(0,0,0,.85)'; g.shadowBlur = 3;
    // velocity vector (deck-relative flight path)
    var vx = s.vx, vy = s.vy, vz = s.vz;
    var p = proj(cam.x + vx * 50, cam.y + vy * 50, cam.z + vz * 50);
    if (p && s.phase !== 'trapped') {
      var r = 7;
      g.beginPath(); g.arc(p[0], p[1], r, 0, 6.283); g.stroke();
      g.beginPath(); g.moveTo(p[0] - r - 9, p[1]); g.lineTo(p[0] - r, p[1]); g.moveTo(p[0] + r, p[1]); g.lineTo(p[0] + r + 9, p[1]);
      g.moveTo(p[0], p[1] - r); g.lineTo(p[0], p[1] - r - 6); g.stroke();
      // AOA E-bracket (on speed: centred on the velocity vector)
      var bx = p[0] - 22;
      g.beginPath(); g.moveTo(bx + 5, p[1] - 14); g.lineTo(bx, p[1] - 14); g.lineTo(bx, p[1] + 14); g.lineTo(bx + 5, p[1] + 14);
      g.moveTo(bx, p[1]); g.lineTo(bx + 4, p[1]); g.stroke();
    }
    // numbers
    var altFt = Math.max(0, (s.y + C.HOOK_EYE - C.WATER_Y)) * 3.28;
    var vsi = Math.round(s.vy * 196.85 / 10) * 10;
    var lx = Math.max(CX - 260, 52), rx = Math.min(CX + 260, W - 118), ty = CY - Math.min(90, H * 0.11);
    g.textAlign = 'right'; g.fillText('140', lx, ty); g.font = '600 12px ui-monospace, Menlo, Consolas, monospace'; g.fillText('KTS', lx, ty + 16);
    g.font = '700 16px ui-monospace, Menlo, Consolas, monospace';
    g.textAlign = 'left'; g.fillText('ALT ' + Math.round(altFt), rx, ty);
    g.font = '600 13px ui-monospace, Menlo, Consolas, monospace';
    g.fillText((vsi > 0 ? '+' : '') + vsi + ' FPM', rx, ty + 18);
    g.fillText(S.distNm(s).toFixed(2) + ' NM', rx, ty + 34);
    // throttle gauge (right edge)
    var gx = W - 22, gy0 = H * 0.3, gh = H * 0.36;
    g.globalAlpha = 0.85; g.strokeRect(gx, gy0, 8, gh);
    var th = s.throttle, ts = s.thrust;
    g.fillRect(gx, gy0 + gh * (1 - ts), 8, gh * ts);
    g.beginPath(); g.moveTo(gx - 8, gy0 + gh * (1 - th)); g.lineTo(gx - 1, gy0 + gh * (1 - th)); g.lineWidth = 3; g.stroke();
    g.lineWidth = 1; g.beginPath(); g.moveTo(gx - 3, gy0 + gh * (1 - C.TRIM)); g.lineTo(gx + 11, gy0 + gh * (1 - C.TRIM)); g.setLineDash([2, 2]); g.stroke(); g.setLineDash([]);
    g.textAlign = 'center'; g.font = '700 12px ui-monospace, Menlo, Consolas, monospace';
    g.fillText(th > 0.97 ? 'MIL' : 'PWR', gx + 4, gy0 + gh + 14);
    g.globalAlpha = 1;
    g.restore();
  }

  // ---------------- Audio ----------------
  var AC = null, master = null, eng = null, muted = localStorage.getItem('ctb.mute') === '1';
  var voiceOn = localStorage.getItem('ctb.voice') !== '0' && 'speechSynthesis' in window;
  function noiseBuffer(sec) {
    var b = AC.createBuffer(1, AC.sampleRate * sec, AC.sampleRate), d = b.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  function initAudio() {
    if (AC) { if (AC.state === 'suspended') AC.resume(); return; }
    var A = window.AudioContext || window.webkitAudioContext;
    if (!A) return;
    AC = new A();
    master = AC.createGain(); master.gain.value = muted ? 0 : 0.55; master.connect(AC.destination);
    var nb = noiseBuffer(2);
    // engine: turbine whine + roar
    var roarSrc = AC.createBufferSource(); roarSrc.buffer = nb; roarSrc.loop = true;
    var roarF = AC.createBiquadFilter(); roarF.type = 'lowpass'; roarF.frequency.value = 500;
    var roarG = AC.createGain(); roarG.gain.value = 0;
    roarSrc.connect(roarF); roarF.connect(roarG); roarG.connect(master); roarSrc.start();
    var whine = AC.createOscillator(); whine.type = 'sawtooth'; whine.frequency.value = 900;
    var whF = AC.createBiquadFilter(); whF.type = 'bandpass'; whF.frequency.value = 1800; whF.Q.value = 6;
    var whG = AC.createGain(); whG.gain.value = 0;
    whine.connect(whF); whF.connect(whG); whG.connect(master); whine.start();
    var rumble = AC.createOscillator(); rumble.type = 'triangle'; rumble.frequency.value = 48;
    var ruG = AC.createGain(); ruG.gain.value = 0; rumble.connect(ruG); ruG.connect(master); rumble.start();
    var windSrc = AC.createBufferSource(); windSrc.buffer = nb; windSrc.loop = true; windSrc.playbackRate.value = 0.7;
    var windF = AC.createBiquadFilter(); windF.type = 'bandpass'; windF.frequency.value = 900; windF.Q.value = 0.6;
    var windG = AC.createGain(); windG.gain.value = 0; windSrc.connect(windF); windF.connect(windG); windG.connect(master); windSrc.start();
    eng = { roarF: roarF, roarG: roarG, whine: whine, whG: whG, whF: whF, rumble: rumble, ruG: ruG, windG: windG, nb: nb };
  }
  function engineUpdate(thrust, on) {
    if (!eng) return;
    var t = AC.currentTime, k = on ? 1 : 0;
    eng.roarF.frequency.setTargetAtTime(300 + thrust * 1400, t, 0.1);
    eng.roarG.gain.setTargetAtTime(k * (0.08 + thrust * 0.28), t, 0.1);
    eng.whine.frequency.setTargetAtTime(700 + thrust * 900, t, 0.15);
    eng.whF.frequency.setTargetAtTime(1400 + thrust * 1500, t, 0.15);
    eng.whG.gain.setTargetAtTime(k * (0.015 + thrust * 0.03), t, 0.15);
    eng.rumble.frequency.setTargetAtTime(38 + thrust * 30, t, 0.2);
    eng.ruG.gain.setTargetAtTime(k * (0.05 + thrust * 0.12), t, 0.2);
    eng.windG.gain.setTargetAtTime(k * 0.06, t, 0.3);
  }
  function burst(opts) { // generic noise/tone burst
    if (!AC || muted) return;
    var t = AC.currentTime + (opts.delay || 0);
    var gn = AC.createGain(); gn.connect(master);
    gn.gain.setValueAtTime(0, t); gn.gain.linearRampToValueAtTime(opts.vol || 0.3, t + (opts.a || 0.005));
    gn.gain.exponentialRampToValueAtTime(0.0008, t + opts.dur);
    var src;
    if (opts.freq) {
      src = AC.createOscillator(); src.type = opts.type || 'sine'; src.frequency.setValueAtTime(opts.freq, t);
      if (opts.to) src.frequency.exponentialRampToValueAtTime(opts.to, t + opts.dur);
    } else { src = AC.createBufferSource(); src.buffer = eng.nb; }
    var node = src;
    if (opts.filter) {
      var f = AC.createBiquadFilter(); f.type = opts.filter; f.frequency.value = opts.ff || 1000; f.Q.value = opts.q || 1;
      src.connect(f); node = f;
    }
    node.connect(gn); src.start(t); src.stop(t + opts.dur + 0.05);
  }
  function sfxSquelch() { burst({ dur: 0.09, vol: 0.12, filter: 'bandpass', ff: 2400, q: 1.5 }); }
  function sfxTrap(wire) {
    burst({ freq: 70, to: 30, dur: 0.5, vol: 0.7, type: 'sine' });
    burst({ dur: 0.35, vol: 0.4, filter: 'lowpass', ff: 600 });
    burst({ freq: 220 + wire * 15, to: 90, dur: 1.3, vol: 0.12, type: 'sawtooth', delay: 0.05 });
    burst({ dur: 1.6, vol: 0.18, filter: 'bandpass', ff: 3500, q: 4, delay: 0.05 });
  }
  function sfxCrash() {
    burst({ dur: 2.2, vol: 0.9, filter: 'lowpass', ff: 900, a: 0.01 });
    burst({ freq: 60, to: 20, dur: 1.5, vol: 0.8 });
  }
  function sfxWaveoffBeep() { burst({ freq: 880, dur: 0.12, vol: 0.12, type: 'square' }); burst({ freq: 660, dur: 0.12, vol: 0.12, type: 'square', delay: 0.15 }); }

  var voice = null;
  function pickVoice() {
    if (!('speechSynthesis' in window)) return;
    var vs = speechSynthesis.getVoices().filter(function (v) { return /^en/i.test(v.lang); });
    voice = vs.filter(function (v) { return v.localService && /US|GB/i.test(v.lang); })[0] || vs.filter(function (v) { return v.localService; })[0] || vs[0] || null;
  }
  if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
  function speak(text, pilot, urgent) {
    if (!voiceOn || muted || !('speechSynthesis' in window)) return;
    try {
      speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text.replace('5.2', 'five point two').replace('301', 'three oh one'));
      if (voice) u.voice = voice;
      u.rate = urgent ? 1.35 : 1.15; u.pitch = pilot ? 1.1 : 0.85; u.volume = 0.9;
      speechSynthesis.speak(u);
    } catch (e) { /* speech is optional */ }
  }

  // ---------------- Input ----------------
  var input = { throttle: C.TRIM, bank: 0, keys: {}, drag: null };
  function inFlight() { return mode === 'fly' && !paused; }
  cv.addEventListener('pointerdown', function (e) {
    initAudio();
    if (!inFlight() || DEMO) return;
    cv.setPointerCapture(e.pointerId);
    input.drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, th0: input.throttle, x: e.clientX, y: e.clientY };
    var th = $('thumb'); th.style.display = 'block'; th.style.left = e.clientX + 'px'; th.style.top = e.clientY + 'px';
    $('thumbDot').style.transform = 'translate(0,0)';
  });
  cv.addEventListener('pointermove', function (e) {
    var d = input.drag; if (!d || d.id !== e.pointerId) return;
    d.x = e.clientX; d.y = e.clientY;
    var sens = Math.max(220, H * 0.42);
    input.throttle = Math.max(0, Math.min(1, d.th0 + (d.y0 - d.y) / sens));
    input.bank = Math.max(-1, Math.min(1, (d.x - d.x0) / Math.max(70, W * 0.14)));
    var ddx = Math.max(-40, Math.min(40, d.x - d.x0)), ddy = Math.max(-40, Math.min(40, d.y - d.y0));
    $('thumbDot').style.transform = 'translate(' + ddx + 'px,' + ddy + 'px)';
  });
  function endDrag(e) {
    var d = input.drag; if (!d || d.id !== e.pointerId) return;
    input.drag = null; input.bank = 0; $('thumb').style.display = 'none';
  }
  cv.addEventListener('pointerup', endDrag);
  cv.addEventListener('pointercancel', endDrag);
  window.addEventListener('keydown', function (e) {
    var k = e.key.toLowerCase();
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].indexOf(k) >= 0 && mode === 'fly') e.preventDefault();
    if (k === 'p' || k === 'escape') { if (mode === 'fly') togglePause(); return; }
    if (k === 'm') { toggleMute(); return; }
    if (k === ' ' && inFlight()) input.throttle = 1;
    if ((k === 'enter') && !e.repeat) { var b = document.querySelector('.screen.show button.primary'); if (b) b.click(); }
    initAudio();
    input.keys[k] = true;
  });
  window.addEventListener('keyup', function (e) { input.keys[e.key.toLowerCase()] = false; });
  function keyInput(dt) {
    var K = input.keys;
    if (K.w || K.arrowup) input.throttle = Math.min(1, input.throttle + 0.65 * dt);
    if (K.s || K.arrowdown) input.throttle = Math.max(0, input.throttle - 0.65 * dt);
    var kb = (K.d || K.arrowright ? 1 : 0) - (K.a || K.arrowleft ? 1 : 0);
    if (!input.drag) {
      if (kb) input.bank = Math.max(-1, Math.min(1, input.bank + kb * 4 * dt));
      else input.bank *= Math.max(0, 1 - 10 * dt);
    }
  }

  // ---------------- Game flow ----------------
  var mode = 'title', paused = false, sim = null, levelIdx = 0, cruise = null, practice = false;
  var shake = 0, flash = 0, endTimer = 0, alertTimer = 0, subTimer = 0;
  var best = parseFloat(localStorage.getItem('ctb.best') || '');

  function show(id) {
    document.querySelectorAll('.screen').forEach(function (el) { el.classList.toggle('show', el.id === id); });
  }
  function setAlert(html, sec) { var a = $('alert'); a.innerHTML = html; a.classList.add('show'); alertTimer = sec || 1.6; }
  function setSub(text, cls, sec) {
    var el = $('subtitle'); el.textContent = text; el.className = 'show ' + (cls || ''); subTimer = sec || 2;
  }

  function startCruise() { practice = false; cruise = { passes: [], idx: 0 }; levelIdx = 0; brief(); }
  function brief() {
    var L = S.LEVELS[levelIdx];
    $('briefKicker').textContent = practice ? 'Practice' : 'Pass ' + (levelIdx + 1) + ' of ' + S.LEVELS.length;
    $('briefName').textContent = L.name;
    $('briefText').textContent = L.brief;
    mode = 'brief'; show('scrBrief');
    sim = S.create(levelIdx, (Date.now() & 0xffff) + levelIdx); // backdrop for the brief
  }
  function fly() {
    if (!DEMO) initAudio();
    sim = S.create(levelIdx, DEMO ? 3 + levelIdx : (Math.random() * 1e9) | 0);
    input.throttle = C.TRIM; input.bank = 0; input.drag = null; $('thumb').style.display = 'none';
    shake = 0; flash = 0; endTimer = 0;
    mode = 'fly'; paused = false; show(null);
    $('passinfo').textContent = (practice ? 'PRACTICE' : 'PASS ' + (levelIdx + 1) + '/6') + '  ' + sim.L.name.toUpperCase();
    if (!DEMO && !localStorage.getItem('ctb.hinted')) {
      setAlert('<small>DRAG UP/DOWN = POWER &middot; LEFT/RIGHT = LINEUP</small>', 3.5);
      localStorage.setItem('ctb.hinted', '1');
    }
  }
  function tileHTML(gr, wire) {
    if (!gr) return '<div class="tile empty"></div>';
    var sym = gr.under ? '<span class="u">OK</span>' : gr.sym.replace('---', '&mdash;');
    var sub = gr.wire ? '#' + gr.wire : gr.key === 'B' ? 'bolt' : gr.key === 'WO' ? 'w/o' : gr.key === 'C' ? 'cut' : '';
    return '<div class="tile ' + gr.color + '" title="' + gr.name + '">' + sym + '<small>' + sub + '</small></div>';
  }
  function boardHTML(list) {
    var h = '';
    for (var i = 0; i < S.LEVELS.length; i++) h += tileHTML(list[i]);
    return h;
  }
  function fmtCode(code) { return code.replace(/_([A-Z]+)_/g, '<u>$1</u>'); }
  function tipFor(gr, s) {
    var codes = gr.tokens.map(function (t) { return t.code; }).join(' ');
    if (s.outcome && s.outcome.kind === 'crash') {
      if (/Ramp/.test(s.crash)) return 'Low in close is the most dangerous place in naval aviation. Red ball = full power, right now: the engines need a second to answer.';
      if (/after/.test(gr.why) || s.waveoffAt >= 0) return 'When Paddles says "Wave off", it is an order: full power (drag up / Space) and climb. Landing after a wave-off is a Cut.';
      if (/Bolter/.test(s.crash)) return 'Navy pilots go to full power the moment the wheels touch. If the hook skips the wires, that power is what keeps you out of the water.';
      if (/edge|parked/.test(s.crash)) return 'Lineup! The landing area creeps right because it is angled 9 degrees off the ship\'s heading. Fix lineup early, small and often.';
      return 'Watch the ball and your sink rate: power controls the glideslope.';
    }
    if (gr.key === 'C') return 'When Paddles says "Wave off", it is an order: full power and climb. Landing after a wave-off is a Cut.';
    if (gr.key === 'WO') return s.waveoffWhy === 'lineup' ? 'Lineup drifted too far. The deck runs away to the right: hold a little right bank early, before it gets big.' :
      'The pass got unsafe, so Paddles waved you off. Correct earlier and smaller: the jet answers about a second after you move the throttle.';
    if (gr.key === 'B') return 'You landed long (or flat) and the hook missed the wires. Keep the ball centred all the way to touchdown; don\'t float at the ramp.';
    if (/SD/.test(codes)) return 'The burble (turbulent air behind the island) pushes you down just before the ramp. Expect it: a little power at the ramp.';
    if (/LO/.test(codes)) return 'Power is your glideslope. When the ball drops, add power early and then take some back as it rises, or you will balloon high.';
    if (/OC/.test(codes)) return 'Over-controlled: small throttle movements, then wait a second for the jet to respond. Chasing the ball makes you porpoise.';
    if (/LUL/.test(codes)) return 'Lined up left: the deck creeps right as the ship steams ahead. Keep a small right correction going.';
    if (/LUR/.test(codes)) return 'Lined up right: you over-corrected for the creep, or the crosswind pushed you. Small corrections in close.';
    if (/H/.test(codes)) return 'High: ease power a little to settle onto the glideslope, and don\'t dive for the deck in close (that is how 1-wires happen).';
    if (gr.wire === 1) return '1-wire: you were a little low at the end. Aim to keep the ball centred right to the deck for the 3-wire.';
    if (gr.wire === 2 || gr.wire === 4) return 'Nice trap. The 3-wire is the target: a centred ball to touchdown puts the hook between the 2 and 3 wires.';
    return gr.key === 'OKU' ? 'OK underline. Pilots go hundreds of traps without one. Rock god.' : 'A clean pass. That is what Paddles wants to see every time.';
  }
  // note: all innerHTML below is built from fixed strings and sim output (no user input)
  function debrief() {
    var s = sim, gr = s.grade;
    mode = 'debrief'; engineUpdate(0, false);
    if (!practice && cruise) cruise.passes[levelIdx] = gr;
    $('gradeTile').className = 'tile big ' + gr.color;
    $('gradeTile').innerHTML = gr.under ? '<span class="u">OK</span>' : gr.sym.replace('---', '&mdash;');
    $('gradeName').textContent = gr.name + '  \u00b7  ' + gr.pts + ' pts';
    var res = gr.wire ? 'Caught the ' + gr.wire + '-wire. ' : gr.key === 'B' ? 'Bolter. ' : '';
    if (s.outcome.kind === 'crash') res = s.crash + '. ';
    else if (gr.why) res += gr.why + '. ';
    $('gradeDesc').textContent = res + gr.desc;
    $('shorthand').innerHTML = fmtCode(gr.shorthand.replace('_OK_', '_OK_'));
    var ul = $('comments'); ul.innerHTML = '';
    if (!gr.tokens.length) ul.innerHTML = '<li><code>&nbsp;</code>No comments. Paddles has nothing to say.</li>';
    gr.tokens.forEach(function (t) {
      var li = document.createElement('li');
      li.innerHTML = '<code>' + fmtCode(t.code) + '</code> ' + t.text;
      ul.appendChild(li);
    });
    $('tip').textContent = tipFor(gr, s);
    $('boardWrap').style.display = practice ? 'none' : '';
    if (!practice) $('board').innerHTML = boardHTML(cruise.passes);
    $('btnNext').textContent = practice ? 'Fly again' : (levelIdx + 1 < S.LEVELS.length ? 'Next pass' : 'Cruise results');
    show('scrDebrief');
  }
  function next() {
    if (practice) { fly(); return; }
    if (levelIdx + 1 < S.LEVELS.length) { levelIdx++; brief(); return; }
    summary();
  }
  function summary() {
    var ps = cruise.passes, sum = 0, traps = 0, oks = 0;
    ps.forEach(function (p) { sum += p.pts; if (p.wire) traps++; if (p.pts >= 4) oks++; });
    var gpa = sum / ps.length;
    var title = gpa >= 4 ? 'Top Hook' : gpa >= 3.3 ? 'Solid ball flyer' : gpa >= 2.5 ? 'Qualified - barely' : 'Paddles wants a word';
    $('sumTitle').textContent = title;
    var isBest = !(best >= gpa);
    if (isBest) { best = gpa; localStorage.setItem('ctb.best', gpa.toFixed(2)); }
    $('sumText').innerHTML = 'Landing grade average <b>' + gpa.toFixed(2) + '</b> &middot; ' + traps + '/6 traps &middot; ' + oks + ' OK passes' +
      (isBest ? ' &middot; <b>new personal best</b>' : ' &middot; best ' + best.toFixed(2)) +
      '<br><span class="small">Fleet pilots average around 3.0-3.3. Top Hook usually means 3.5+ over a whole cruise.</span>';
    $('sumBoard').innerHTML = boardHTML(ps);
    mode = 'summary'; show('scrSummary');
    updateBest();
  }
  function updateBest() {
    $('bestLine').textContent = best >= 0 ? 'Best cruise average: ' + best.toFixed(2) : 'Best on a phone in portrait or landscape; keyboard works too.';
  }
  function toTitle() { titleScene(); mode = 'title'; paused = false; show('scrTitle'); engineUpdate(0, false); if ('speechSynthesis' in window) speechSynthesis.cancel(); }
  function togglePause() {
    paused = !paused; show(paused ? 'scrPause' : null);
    if (paused) { engineUpdate(0, false); if ('speechSynthesis' in window) speechSynthesis.cancel(); }
  }
  function toggleMute() {
    muted = !muted; localStorage.setItem('ctb.mute', muted ? '1' : '0');
    if (master) master.gain.value = muted ? 0 : 0.55;
    if (muted && 'speechSynthesis' in window) speechSynthesis.cancel();
    $('btnMute').classList.toggle('off', muted);
  }
  function toggleVoice() {
    voiceOn = !voiceOn && ('speechSynthesis' in window); localStorage.setItem('ctb.voice', voiceOn ? '1' : '0');
    $('btnVoice').classList.toggle('off', !voiceOn);
  }

  // buttons
  function on(id, fn) { $(id).addEventListener('click', function (e) { initAudio(); fn(e); }); }
  on('btnCruise', startCruise);
  on('btnPractice', function () { show('scrPractice'); });
  on('btnPracticeBack', function () { show('scrTitle'); });
  on('btnHow', function () { show('scrHow'); });
  on('btnHowBack', function () { show(mode === 'title' ? 'scrTitle' : 'scrTitle'); });
  on('btnFly', fly);
  on('btnNext', next);
  on('btnQuit', toTitle);
  on('btnAgain', startCruise);
  on('btnSumTitle', toTitle);
  on('btnResume', togglePause);
  on('btnAbort', toTitle);
  on('btnMute', toggleMute);
  on('btnVoice', toggleVoice);
  on('btnPause', function () { if (mode === 'fly') togglePause(); });
  $('btnMute').classList.toggle('off', muted);
  $('btnVoice').classList.toggle('off', !voiceOn);
  if (!('speechSynthesis' in window)) $('btnVoice').style.display = 'none';
  (function () {
    var list = $('levelList');
    S.LEVELS.forEach(function (L, i) {
      var b = document.createElement('button');
      b.innerHTML = (i + 1) + '. ' + L.name + '<span>' + L.brief + '</span>';
      b.addEventListener('click', function () { initAudio(); practice = true; levelIdx = i; brief(); });
      list.appendChild(b);
    });
  })();
  updateBest();
  function titleScene() { sim = S.create(3, 4); sim.x = -420; sim.y = S.gsHeight(sim.x) + 3; sim.z = -6; sim.psi = 0.02; }
  titleScene();

  // ---------------- Events from the sim ----------------
  function handleEvents(s) {
    s.events.forEach(function (e) {
      if (e.type === 'call') {
        var urgent = e.key === 'waveoff' || e.key === 'power2' || e.key === 'bolter';
        setSub((e.pilot ? 'YOU: ' : 'PADDLES: ') + e.text, e.pilot ? 'pilot' : urgent ? 'urgent' : '', urgent ? 2.4 : 1.8);
        sfxSquelch(); speak(e.text, e.pilot, urgent);
        if (e.key === 'power' || e.key === 'power2' || e.key === 'settle') s.lsoCutUntil = s.t + 0.9;
        if (e.key === 'waveoff') { setAlert('WAVE OFF<small>FULL POWER &middot; DRAG UP / SPACE</small>', 2.5); sfxWaveoffBeep(); }
        if (e.key === 'bolter') setAlert('BOLTER<small>FULL POWER!</small>', 2);
      } else if (e.type === 'trap') {
        sfxTrap(e.wire); shake = reduceMotion ? 0 : 1; setAlert('<span style="color:#7dff9a">' + e.wire + '-WIRE</span>', 1.8);
      } else if (e.type === 'crash') {
        sfxCrash(); shake = reduceMotion ? 0 : 1.6; flash = 1; setAlert(e.why.toUpperCase(), 2.6);
      } else if (e.type === 'done') {
        endTimer = s.outcome.kind === 'crash' ? 2.4 : 1.6;
      }
    });
    s.events.length = 0;
  }

  // ---------------- Main loop ----------------
  var last = performance.now(), acc = 0, DT = 1 / 120;
  function frame(now) {
    var dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (mode === 'fly' && !paused) {
      keyInput(dt);
      acc += dt * SPEED;
      while (acc >= DT) {
        var inp = DEMO || AUTO ? S.autopilot(sim) : { throttle: input.throttle, bank: input.bank };
        if (DEMO || AUTO) input.throttle = inp.throttle;
        if (!sim.done || sim.phase === 'trapped' || sim.phase === 'waveoff' || sim.phase === 'crashed') {
          if (!sim.done) S.step(sim, DT, inp);
          else postStep(sim, DT, inp);
        }
        acc -= DT;
      }
      handleEvents(sim);
      engineUpdate(sim.phase === 'crashed' ? 0 : sim.thrust, sim.phase !== 'crashed');
      if (sim.done && endTimer > 0) {
        endTimer -= dt * SPEED;
        if (endTimer <= 0) { if (DEMO) { fly(); } else debrief(); }
      }
    } else acc = 0;
    if (alertTimer > 0) { alertTimer -= dt; if (alertTimer <= 0) $('alert').classList.remove('show'); }
    if (subTimer > 0) { subTimer -= dt; if (subTimer <= 0) $('subtitle').classList.remove('show'); }
    render(dt);
    requestAnimationFrame(frame);
  }
  // after the pass is graded keep the picture alive (fly away / roll out)
  function postStep(s, dt, inp) {
    if (s.phase === 'waveoff' || s.flyaway) { s.t += dt; s.vy += (6 - s.vy) * dt; s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt; s.thrust += (1 - s.thrust) * dt * 2; }
    else if (s.phase === 'trapped') { s.t += dt; }
    else s.t += dt;
  }

  function render(dt) {
    var s = sim || (sim = S.create(0, 1));
    var P = PAL[s.L.tod];
    // camera at the pilot's eye
    var ex = s.x + C.EYE_FWD, ey = s.y + C.HOOK_EYE, ez = s.z;
    var gam = Math.atan2(s.vy, Math.max(20, s.vx));
    var pitch = gam * 0.5 - 1.2 * DEG, roll = s.phi, yaw = s.psi;
    if (s.phase === 'trapped') { pitch = -3 * DEG; roll *= 0.9; }
    if (s.phase === 'crashed') { pitch = -6 * DEG; }
    var sx = 0, sy = 0;
    if (shake > 0) { sx = (Math.random() - 0.5) * 0.6 * shake; sy = (Math.random() - 0.5) * 0.6 * shake; shake = Math.max(0, shake - dt * 1.6); }
    // gentle turbulence jiggle
    var jig = reduceMotion ? 0 : s.L.turb * 0.002 * Math.sin(s.t * 9.1);
    setCam(ex, ey + sy, ez + sx, yaw, pitch + jig, roll);
    g.clearRect(0, 0, W, H);
    var hor = drawSky(P, s.t);
    drawSea(P, s);
    drawShip(P, s, s.t);
    if (mode === 'fly' || DEMO) {
      drawHUD(s, hor);
      drawRepeater(s, s.t);
    }
    if (flash > 0) { g.fillStyle = 'rgba(255,120,60,' + (flash * 0.6) + ')'; g.fillRect(0, 0, W, H); flash = Math.max(0, flash - dt * 0.8); }
    if (mode !== 'fly') { // idle drift behind the menus
      s.t += dt * 0.25;
    }
  }

  // ---------------- Self test (?test) ----------------
  if (Q.has('test')) {
    var res = [];
    for (var l = 0; l < S.LEVELS.length; l++) { var r = S.runPass(l, 5, S.autopilot); res.push(S.LEVELS[l].id + ':' + r.grade.key + (r.grade.wire ? '#' + r.grade.wire : '')); }
    var el = $('selftest'); el.hidden = false; el.textContent = 'SELFTEST ' + res.join(' ');
  }

  if (DEMO) {
    levelIdx = Math.max(0, Math.min(5, parseInt(Q.get('level') || '0', 10) || 0));
    practice = true; fly();
    var ff = parseFloat(Q.get('t') || '0');
    for (var i = 0; i < ff * 120 && !sim.done; i++) { S.step(sim, DT, S.autopilot(sim)); }
    sim.events.length = 0;
  }
  requestAnimationFrame(frame);
})();

// iOS Safari ignores touch-action in places: cancel page-level drags/pinch unless inside a scrollable panel.
(function () {
  function scrollable(el) {
    for (; el && el !== document.body; el = el.parentElement) {
      var o = getComputedStyle(el).overflowY;
      if ((o === 'auto' || o === 'scroll') && el.scrollHeight > el.clientHeight) return true;
    }
    return false;
  }
  document.addEventListener('touchmove', function (e) { if (!scrollable(e.target)) e.preventDefault(); }, { passive: false });
  ['gesturestart', 'gesturechange', 'dblclick'].forEach(function (t) { document.addEventListener(t, function (e) { e.preventDefault(); }); });
})();
