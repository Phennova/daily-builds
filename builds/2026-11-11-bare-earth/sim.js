// Bare Earth - pure simulation (no DOM). Browser: window.BE, node: require('./sim.js').
// Grid: N x N cells of CELL metres. Cell (x, y): x east, y south (row 0 = north edge).
// Heights in metres. Azimuth in degrees clockwise from north.
(function (root) {
  'use strict';

  const N = 400, CELL = 2, SIZE = N * CELL;
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  const lerp = (a, b, t) => a + (b - a) * t;

  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash2(x, y, s) {
    let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function vnoise(x, y, s) {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  }
  function fbm(x, y, s, oct) {
    let a = 0.5, f = 1, t = 0, n = 0;
    for (let k = 0; k < oct; k++) { t += a * vnoise(x * f, y * f, s + k * 131); n += a; a *= 0.5; f *= 2.03; }
    return t / n; // ~[0,1]
  }
  function gauss(r) { // approx standard normal
    return (r() + r() + r() + r() + r() + r() - 3) * 1.414;
  }

  // ---------------- feature shapes (archaeology + natural decoys) ----------------
  // Every shape: {kind, type?, x, y (m), bbox [x0,y0,x1,y1] m, add(xm, ym) -> dz, label, r (match radius)}
  function local(f, xm, ym) {
    const dx = xm - f.x, dy = ym - f.y, c = Math.cos(f.rot), s = Math.sin(f.rot);
    return [dx * c + dy * s, -dx * s + dy * c];
  }
  function rectEdge(f, u, v) { // signed distance inside (positive) to the footprint edge
    if (f.oval) { const d = Math.hypot(u / f.a, v / f.b); return (1 - d) * Math.min(f.a, f.b); }
    return Math.min(f.a - Math.abs(u), f.b - Math.abs(v));
  }
  function pyramid(x, y, a, b, h, rot, opt) {
    opt = opt || {};
    const f = { kind: 'arch', type: 'pyramid', x, y, a, b, h, rot, oval: !!opt.oval, steps: opt.steps || 4, top: opt.top || 0.28 };
    const R = Math.hypot(a, b) + 2;
    f.bbox = [x - R, y - R, x + R, y + R];
    f.r = Math.max(a, b) + 8;
    f.add = (xm, ym) => {
      const [u, v] = local(f, xm, ym);
      const e = rectEdge(f, u, v);
      if (e <= 0) return 0;
      const run = Math.min(f.a, f.b) * (1 - f.top);
      const s = clamp(e / run, 0, 1);
      const q = s * f.steps, st = Math.floor(q), fr = q - st;
      const stepped = Math.min(1, (st + smooth(0.45, 1, fr)) / f.steps);
      return f.h * (0.65 * stepped + 0.35 * s);
    };
    return f;
  }
  function platform(type, x, y, a, b, h, rot, batter, oval) {
    const f = { kind: 'arch', type, x, y, a, b, h, rot, oval: !!oval, batter: batter || 2.5 };
    const R = Math.hypot(a, b) + 2;
    f.bbox = [x - R, y - R, x + R, y + R];
    f.r = Math.max(a, b) + (type === 'mound' ? 6 : 7);
    f.add = (xm, ym) => {
      const [u, v] = local(f, xm, ym);
      const e = rectEdge(f, u, v);
      return e <= 0 ? 0 : f.h * smooth(0, 1, e / f.batter);
    };
    return f;
  }
  function segDist(px, py, x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy || 1;
    const t = clamp(((px - x0) * dx + (py - y0) * dy) / L2, 0, 1);
    return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
  }
  function causeway(x0, y0, x1, y1, w, h) {
    const f = { kind: 'arch', type: 'causeway', x: (x0 + x1) / 2, y: (y0 + y1) / 2, x0, y0, x1, y1, w, h };
    f.bbox = [Math.min(x0, x1) - w - 4, Math.min(y0, y1) - w - 4, Math.max(x0, x1) + w + 4, Math.max(y0, y1) + w + 4];
    f.r = w + 10;
    f.dist = (xm, ym) => segDist(xm, ym, x0, y0, x1, y1);
    f.add = (xm, ym) => { const d = f.dist(xm, ym); return d >= w ? 0 : h * smooth(0, 1, (w - d) / 2.5); };
    return f;
  }
  function reservoir(x, y, a, b, depth, rot) {
    const f = { kind: 'arch', type: 'reservoir', x, y, a, b, depth, rot, oval: true };
    const R = Math.max(a, b) * 1.45 + 2;
    f.bbox = [x - R, y - R, x + R, y + R];
    f.r = Math.max(a, b) + 8;
    f.add = (xm, ym) => {
      const [u, v] = local(f, xm, ym);
      const d = Math.hypot(u / a, v / b);
      if (d < 1) return -depth * (1 - smooth(0.62, 1, d));
      if (d < 1.4) return 0.55 * Math.sin((d - 1) / 0.4 * Math.PI); // spoil berm
      return 0;
    };
    return f;
  }
  // plaza: levelling, applied before additive features. Not scored on its own.
  function plaza(x, y, a, b, rot, raise) {
    return { kind: 'plaza', type: 'plaza', x, y, a, b, rot, raise: raise || 0.4, bbox: [x - a - 14, y - b - 14, x + a + 14, y + b + 14] };
  }
  // natural decoys
  function cone(x, y, R, h, seed) {
    const f = { kind: 'decoy', type: 'cone', x, y, R, h, seed };
    f.bbox = [x - R * 1.4, y - R * 1.4, x + R * 1.4, y + R * 1.4];
    f.r = R * 0.9;
    f.add = (xm, ym) => {
      const dx = xm - x, dy = ym - y, r = Math.hypot(dx, dy);
      const ang = Math.atan2(dy, dx);
      const wob = 1 + 0.28 * (vnoise(Math.cos(ang) * 1.6 + 5, Math.sin(ang) * 1.6 + 5, seed) - 0.5) * 2;
      const t = r / (R * wob);
      return t >= 1 ? 0 : h * Math.pow(1 - t * t, 1.7);
    };
    return f;
  }
  function sinkhole(x, y, R, depth) {
    const f = { kind: 'decoy', type: 'sinkhole', x, y, R, depth };
    f.bbox = [x - R - 1, y - R - 1, x + R + 1, y + R + 1];
    f.r = R + 5;
    f.add = (xm, ym) => { const t = Math.hypot(xm - x, ym - y) / R; return t >= 1 ? 0 : -depth * Math.pow(1 - t, 1.4); };
    return f;
  }
  function treethrow(x, y, ang) {
    const f = { kind: 'decoy', type: 'treethrow', x, y, ang };
    f.bbox = [x - 6, y - 6, x + 6, y + 6];
    f.r = 6;
    const ox = Math.cos(ang) * 2.2, oy = Math.sin(ang) * 2.2;
    f.add = (xm, ym) => {
      const p = Math.hypot(xm - x + ox, ym - y + oy), m = Math.hypot(xm - x - ox, ym - y - oy);
      return -0.45 * Math.max(0, 1 - (p / 2.2) ** 2) + 0.6 * Math.max(0, 1 - (m / 2.6) ** 2);
    };
    return f;
  }
  function track(pts, w, depth) { // modern logging track: sunken, curving polyline
    const f = { kind: 'decoy', type: 'track', pts, w, depth, x: pts[pts.length >> 1][0], y: pts[pts.length >> 1][1] };
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const p of pts) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
    f.bbox = [x0 - w - 3, y0 - w - 3, x1 + w + 3, y1 + w + 3];
    f.r = w + 8;
    f.dist = (xm, ym) => {
      let d = 1e9;
      for (let i = 0; i + 1 < pts.length; i++) d = Math.min(d, segDist(xm, ym, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]));
      return d;
    };
    f.add = (xm, ym) => {
      const d = f.dist(xm, ym);
      if (d >= w + 1.5) return 0;
      const rut = Math.abs(d - w * 0.5) < 0.6 ? -0.12 : 0;
      return -depth * (1 - smooth(w - 0.8, w + 1.5, d)) + rut + 0.15 * Math.max(0, 1 - Math.abs(d - w - 0.9) / 0.9);
    };
    return f;
  }
  function trackPath(r, x0, y0, heading, len) {
    const pts = [[x0, y0]];
    let x = x0, y = y0, hd = heading, turn = 0;
    for (let s = 0; s < len; s += 10) {
      turn = clamp(turn + (r() - 0.5) * 0.07, -0.05, 0.05);
      hd += turn;
      x += Math.cos(hd) * 10; y += Math.sin(hd) * 10;
      pts.push([x, y]);
      if (x < -20 || y < -20 || x > SIZE + 20 || y > SIZE + 20) break;
    }
    return pts;
  }

  // ---------------- strips ----------------
  // A ceremonial group: plaza, pyramid on one side, range platforms on two others.
  function group(r, x, y, rot, size, opt) {
    opt = opt || {};
    const out = [];
    const pa = 28 * size, pb = 22 * size;
    out.push(plaza(x, y, pa, pb, rot, 0.4));
    const c = Math.cos(rot), s = Math.sin(rot);
    const at = (u, v) => [x + u * c - v * s, y + u * s + v * c];
    const ph = opt.pyrH || 11 * size;
    const pyrSize = Math.max(opt.pyrA || 0, ph * 1.65); // keeps faces near 45 deg (eroded Maya pyramids)
    let p = at(0, -(pb + pyrSize - 2));
    out.push(pyramid(p[0], p[1], pyrSize * (opt.oval ? 1.15 : 1), pyrSize * (opt.oval ? 0.85 : 1), ph, rot, { oval: opt.oval, steps: 4 }));
    p = at(pa + 6, 0); out.push(platform('platform', p[0], p[1], 6, pb * 0.8, 2.2 + r() * 1.2, rot));
    p = at(-pa - 6, 2); out.push(platform('platform', p[0], p[1], 6, pb * 0.7, 1.8 + r() * 1.0, rot));
    if (opt.south) { p = at(0, pb + 6); out.push(platform('platform', p[0], p[1], pa * 0.6, 5, 1.5 + r(), rot)); }
    return out;
  }
  function mounds(r, n, cx, cy, spread, avoid) {
    const out = [];
    let tries = 0;
    while (out.length < n && tries++ < 500) {
      const a = r() * Math.PI * 2, d = spread * (0.25 + 0.75 * Math.sqrt(r()));
      const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
      if (x < 30 || y < 30 || x > SIZE - 30 || y > SIZE - 30) continue;
      if (avoid.some(f => Math.hypot(f.x - x, f.y - y) < (f.r || 20) + 14)) continue;
      if (out.some(f => Math.hypot(f.x - x, f.y - y) < 30)) continue;
      const m = platform('mound', x, y, 4 + r() * 3, 3.5 + r() * 2.5, 0.7 + r() * 0.6, r() * Math.PI, 2.2);
      out.push(m);
    }
    return out;
  }
  function scatter(r, n, make, avoid, margin) {
    const out = [];
    let tries = 0;
    while (out.length < n && tries++ < 800) {
      const x = 40 + r() * (SIZE - 80), y = 40 + r() * (SIZE - 80);
      if (avoid.some(f => Math.hypot(f.x - x, f.y - y) < (f.r || 20) + margin)) continue;
      out.push(make(x, y));
      avoid = avoid.concat([out[out.length - 1]]);
    }
    return out;
  }

  const STRIPS = [
    {
      id: 1, name: 'Clearing', seed: 1101,
      brief: 'Secondary forest over flat ground, thin canopy. A plaza group is somewhere in this tile. Drag the sun, look for straight edges and corners, and pin what you find.',
      lesson: 'Straight lines and right angles are the tell: nature rarely makes them.',
      cover: 0.5, coverVar: 0.25, pen: 0.5, ucov: 0.3, upen: 0.5, canopyH: 16, density: 6, relief: 5, micro: 0.25,
      defaults: { win: 14, slope: 60, view: 'hill', az: 315, alt: 40 }, quota: 4, maxFP: 3,
      layout(r) {
        const g = group(r, 430, 360, 0.18, 1, { south: true });
        const ms = mounds(r, 6, 430, 380, 230, g);
        const d = scatter(r, 3, (x, y) => treethrow(x, y, r() * 6.28), g.concat(ms), 20)
          .concat([sinkhole(180, 620, 16, 4)]);
        return { arch: g.concat(ms), decoys: d };
      }
    },
    {
      id: 2, name: 'High Forest', seed: 2207,
      brief: 'Mature rainforest, canopy 25 m and closed. Few pulses reach the ground, so the filter has to guess. The default filter settings leave junk in. Check suspicious bumps with a profile slice.',
      lesson: 'A mound built from points 3 m up in the understory is not a mound. Trust shapes that have ground returns on them.',
      cover: 0.93, coverVar: 0.08, pen: 0.13, ucov: 0.78, upen: 0.35, canopyH: 26, density: 5, relief: 6, micro: 0.2, patchy: 1,
      defaults: { win: 6, slope: 120, view: 'hill', az: 315, alt: 40 }, quota: 5, maxFP: 3,
      layout(r) {
        const g = group(r, 300, 470, -0.35, 0.8, {});
        const res = reservoir(470, 560, 22, 15, 2.2, 0.4);
        const ms = mounds(r, 8, 380, 420, 300, g.concat([res]));
        const d = scatter(r, 4, (x, y) => treethrow(x, y, r() * 6.28), g.concat(ms, [res]), 20);
        return { arch: g.concat(ms, [res]), decoys: d };
      }
    },
    {
      id: 3, name: 'Karst', seed: 3313,
      brief: 'Cone karst: limestone hills and sinkholes everywhere. Some hilltops carry shrines, most are just hills. Big topography drowns small relief, so try the Local Relief view.',
      lesson: 'A Local Relief Model subtracts the hills and leaves the small stuff. Round and lumpy is geology; flat-topped with corners is architecture.',
      cover: 0.86, coverVar: 0.1, pen: 0.22, ucov: 0.6, upen: 0.4, canopyH: 22, density: 5, relief: 10, micro: 0.25, patchy: 0.6,
      defaults: { win: 16, slope: 80, view: 'hill', az: 315, alt: 40 }, quota: 6, maxFP: 3,
      layout(r) {
        const g = group(r, 400, 420, 0.55, 0.85, { south: true });
        const cones = [];
        const spots = [[160, 170], [620, 160], [690, 470], [150, 520], [560, 690], [300, 230], [260, 690], [700, 700], [520, 250]];
        for (const [x, y] of spots) cones.push(cone(x + (r() - 0.5) * 40, y + (r() - 0.5) * 40, 32 + r() * 22, 12 + r() * 14, (r() * 1e6) | 0));
        // shrines on two hilltops (platforms on the summit)
        const shrines = [cones[1], cones[3]].map(cn => platform('platform', cn.x, cn.y, 8, 6, 1.6, r() * 3, 2));
        const sinks = scatter(r, 6, (x, y) => sinkhole(x, y, 10 + r() * 10, 3 + r() * 5), g.concat(cones), 12);
        const ms = mounds(r, 6, 400, 430, 260, g.concat(cones, sinks));
        return { arch: g.concat(shrines, ms), decoys: cones.concat(sinks) };
      }
    },
    {
      id: 4, name: 'Sacbe', seed: 4421,
      brief: 'Two plaza groups were once linked by a raised causeway (sacbe). A modern logging track also crosses the tile. The causeway is the prize: find it. Single-direction hillshade has a blind spot.',
      lesson: 'Hillshade hides any linear feature that runs parallel to the light. Multi-directional hillshade and Sky-View Factor have no blind azimuth.',
      cover: 0.88, coverVar: 0.1, pen: 0.2, ucov: 0.6, upen: 0.4, canopyH: 23, density: 5, relief: 5, micro: 0.22, patchy: 0.5,
      defaults: { win: 14, slope: 70, view: 'hill', az: 315, alt: 40 }, quota: 6, maxFP: 3,
      layout(r) {
        // causeway runs NW-SE, exactly along the default 315 deg sun
        const a = group(r, 175, 175, Math.PI / 4, 0.75, {});
        const b = group(r, 625, 615, Math.PI / 4, 0.7, {});
        const cw = causeway(215, 215, 585, 585, 4.5, 0.8);
        cw.required = true;
        const res = reservoir(640, 300, 20, 13, 2, 0.2);
        const tr = track(trackPath(r, -10, 560, -0.35, 1000), 2.2, 0.35);
        const ms = mounds(r, 6, 400, 400, 330, a.concat(b, [cw, res, tr]));
        const tt = scatter(r, 3, (x, y) => treethrow(x, y, r() * 6.28), a.concat(b, ms, [cw, res, tr]), 20);
        return { arch: a.concat(b, [cw, res], ms), decoys: [tr].concat(tt) };
      }
    },
    {
      id: 5, name: 'Cliff Edge', seed: 5531,
      brief: 'A hilltop on the edge of an escarpment, under 25 m of forest. Somewhere up there: a levelled plaza, an oval pyramid, a raised courtyard and a flat-bottomed reservoir. The previous analyst left a very aggressive filter on.',
      lesson: 'An aggressive ground filter beheads tall structures: it treats a pyramid top like a tree. Tune the window and slope until the pyramid keeps its height and the junk is still gone.',
      cover: 0.94, coverVar: 0.06, pen: 0.15, ucov: 0.75, upen: 0.35, canopyH: 27, density: 5, relief: 6, micro: 0.22, patchy: 0.9,
      cliff: { x: 540, h: 24 },
      defaults: { win: 34, slope: 22, view: 'hill', az: 315, alt: 40 }, quota: 7, maxFP: 3,
      layout(r) {
        const g = group(r, 420, 380, 0.1, 0.9, { oval: true, pyrH: 12 });
        g[1].required = true;
        const court = platform('platform', 395, 470, 18, 13, 3.2, 0.1, 3);
        const res = reservoir(300, 300, 17, 12, 2.4, -0.3);
        const ms = mounds(r, 7, 330, 420, 230, g.concat([court, res]));
        const cones = [cone(150, 650, 40, 16, 77), cone(140, 180, 30, 10, 78)];
        const sinks = [sinkhole(250, 560, 14, 5), sinkhole(680, 300, 12, 4)];
        const tt = scatter(r, 3, (x, y) => treethrow(x, y, r() * 6.28), g.concat(ms, [court, res], cones, sinks), 20);
        return { arch: g.concat([court, res], ms), decoys: cones.concat(sinks, tt) };
      }
    }
  ];

  function randomSpec(seed) {
    const r = rng(seed * 7919 + 13);
    const cover = 0.6 + r() * 0.34;
    return {
      id: 0, name: 'Survey ' + seed, seed,
      brief: 'Unsurveyed tile, random seed. Anything could be under there.',
      lesson: 'Every tile is different: process, look from several suns, verify, then report.',
      cover, coverVar: 0.1, pen: 0.35 - cover * 0.22, ucov: 0.4 + r() * 0.4, upen: 0.4, canopyH: 18 + r() * 9, density: 5,
      relief: 4 + r() * 8, micro: 0.22, patchy: r(),
      cliff: r() < 0.3 ? { x: 450 + r() * 200, h: 15 + r() * 15 } : null,
      defaults: { win: 14, slope: 70, view: 'hill', az: 315, alt: 40 }, quota: 6, maxFP: 3,
      layout(r2) {
        const x = 220 + r2() * 300, y = 220 + r2() * 300;
        const g = group(r2, x, y, r2() * 3.14, 0.75 + r2() * 0.3, { oval: r2() < 0.4, south: r2() < 0.5 });
        let arch = g.slice();
        if (r2() < 0.6) {
          const g2x = clamp(x + (r2() < 0.5 ? -1 : 1) * (200 + r2() * 120), 120, SIZE - 120), g2y = clamp(y + (r2() - 0.5) * 400, 120, SIZE - 120);
          const g2 = group(r2, g2x, g2y, r2() * 3.14, 0.65, {});
          const ang = Math.atan2(g2y - y, g2x - x), off = 45;
          const cw = causeway(x + Math.cos(ang) * off, y + Math.sin(ang) * off, g2x - Math.cos(ang) * off, g2y - Math.sin(ang) * off, 4.5, 0.8);
          arch = arch.concat(g2, [cw]);
        }
        const res = scatter(r2, 1, (a, b) => reservoir(a, b, 15 + r2() * 8, 11 + r2() * 5, 2, r2() * 3), arch, 30);
        arch = arch.concat(res);
        const cones = scatter(r2, (r2() * 6) | 0, (a, b) => cone(a, b, 28 + r2() * 20, 10 + r2() * 12, (r2() * 1e6) | 0), arch, 40);
        const sinks = scatter(r2, (r2() * 4) | 0, (a, b) => sinkhole(a, b, 10 + r2() * 8, 3 + r2() * 4), arch.concat(cones), 12);
        const ms = mounds(r2, 6 + ((r2() * 4) | 0), x, y, 300, arch.concat(cones, sinks));
        arch = arch.concat(ms);
        let decoys = cones.concat(sinks);
        if (r2() < 0.5) decoys.push(track(trackPath(r2, -10, 100 + r2() * 600, (r2() - 0.5) * 0.8, 1000), 2.2, 0.35));
        decoys = decoys.concat(scatter(r2, 3, (a, b) => treethrow(a, b, r2() * 6.28), arch.concat(decoys), 20));
        return { arch, decoys };
      }
    };
  }

  // ---------------- world generation ----------------
  function applyShape(grid, f) {
    const x0 = clamp(Math.floor(f.bbox[0] / CELL), 0, N - 1), x1 = clamp(Math.ceil(f.bbox[2] / CELL), 0, N - 1);
    const y0 = clamp(Math.floor(f.bbox[1] / CELL), 0, N - 1), y1 = clamp(Math.ceil(f.bbox[3] / CELL), 0, N - 1);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const dz = f.add((x + 0.5) * CELL, (y + 0.5) * CELL);
      if (dz) grid[y * N + x] += dz;
    }
  }
  function applyPlaza(grid, f) {
    const cx = clamp(Math.floor(f.x / CELL), 0, N - 1), cy = clamp(Math.floor(f.y / CELL), 0, N - 1);
    const L = grid[cy * N + cx] + f.raise;
    const x0 = clamp(Math.floor(f.bbox[0] / CELL), 0, N - 1), x1 = clamp(Math.ceil(f.bbox[2] / CELL), 0, N - 1);
    const y0 = clamp(Math.floor(f.bbox[1] / CELL), 0, N - 1), y1 = clamp(Math.ceil(f.bbox[3] / CELL), 0, N - 1);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const [u, v] = local(f, (x + 0.5) * CELL, (y + 0.5) * CELL);
      const e = rectEdge(f, u, v);
      const w = smooth(-12, 2, e);
      if (w > 0) { const i = y * N + x; grid[i] = lerp(grid[i], L, w); }
    }
  }

  function makeWorld(spec) {
    const seed = spec.seed;
    const r = rng(seed);
    const natural = new Float32Array(N * N);
    const base = 60 + r() * 40;
    const tiltX = (r() - 0.5) * 0.012, tiltY = (r() - 0.5) * 0.012;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const xm = x * CELL, ym = y * CELL;
      let z = base + tiltX * xm + tiltY * ym;
      z += spec.relief * (fbm(xm / 260, ym / 260, seed + 1, 4) - 0.5) * 2;
      z += spec.micro * (fbm(xm / 9, ym / 9, seed + 2, 3) - 0.5) * 2;
      if (spec.cliff) {
        const edge = spec.cliff.x + 40 * (fbm(ym / 180, 3.3, seed + 9, 3) - 0.5) * 2;
        z += spec.cliff.h * (1 - smooth(edge - 14, edge + 14, xm)) + 3 * (fbm(xm / 30, ym / 30, seed + 10, 2) - 0.5) * (Math.abs(xm - edge) < 20 ? 1 : 0);
      }
      natural[y * N + x] = z;
    }
    const lay = spec.layout(rng(seed * 31 + 7));
    // decoys are part of nature
    for (const d of lay.decoys) applyShape(natural, d);
    const ground = Float32Array.from(natural);
    for (const f of lay.arch) if (f.kind === 'plaza') applyPlaza(ground, f);
    for (const f of lay.arch) if (f.kind === 'arch') applyShape(ground, f);
    const features = lay.arch.filter(f => f.kind === 'arch');
    features.forEach((f, k) => { f.id = k; });

    // canopy: crowns on a jittered grid, height above ground
    const canopy = new Float32Array(N * N), cover = new Float32Array(N * N), pen = new Float32Array(N * N);
    const crowns = [];
    const sp = 9;
    for (let gy = -1; gy < SIZE / sp + 1; gy++) for (let gx = -1; gx < SIZE / sp + 1; gx++) {
      crowns.push([(gx + r()) * sp, (gy + r()) * sp, 4 + r() * 5, spec.canopyH * (0.7 + r() * 0.45)]);
    }
    const cg = Math.ceil(SIZE / sp) + 2;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const xm = (x + 0.5) * CELL, ym = (y + 0.5) * CELL;
      const gx = Math.floor(xm / sp) + 1, gy = Math.floor(ym / sp) + 1;
      let best = 0;
      for (let j = gy - 1; j <= gy + 1; j++) for (let k = gx - 1; k <= gx + 1; k++) {
        const c = crowns[j * cg + k];
        if (!c) continue;
        const d = Math.hypot(xm - c[0], ym - c[1]) / c[2];
        if (d < 1) best = Math.max(best, c[3] * Math.sqrt(1 - d * d * 0.6));
      }
      const i = y * N + x;
      const cv = clamp(spec.cover + spec.coverVar * (fbm(xm / 60, ym / 60, seed + 3, 3) - 0.5) * 3, 0.05, 0.99);
      const patch = spec.patchy ? smooth(0.58, 0.72, fbm(xm / 22, ym / 22, seed + 4, 3)) * spec.patchy : 0;
      cover[i] = best > 0 ? cv : cv * 0.3;
      pen[i] = spec.pen * (1 - 0.7 * patch);
      canopy[i] = best > 0 ? best : spec.canopyH * 0.35;
    }
    const w = { spec, seed, natural, ground, canopy, cover, pen, features, decoys: lay.decoys, plazas: lay.arch.filter(f => f.kind === 'plaza') };
    scanAll(w);
    return w;
  }

  // ---------------- lidar pulses ----------------
  // Deterministic per cell: returns [z, layer] pairs (layer 0 canopy, 1 understory, 2 ground) into out.
  function cellReturns(w, i, out) {
    const s = w.spec, r = rng((w.seed * 2654435761 + i * 40503) >>> 0);
    const g = w.ground[i], ch = w.canopy[i];
    const n = s.density;
    out.length = 0;
    const patch = w.pen[i] < s.pen * 0.5;
    const ucov = patch ? Math.min(0.97, s.ucov + 0.2) : s.ucov;
    for (let p = 0; p < n; p++) {
      let alive = true;
      if (r() < w.cover[i]) {
        out.push(g + ch * (0.82 + 0.18 * r()) + gauss(r) * 0.15, 0);
        alive = r() < w.pen[i];
      }
      if (alive && r() < ucov) {
        out.push(g + 3.4 + r() * 3.2 + gauss(r) * 0.1, 1);
        alive = r() < s.upen * (patch ? 0.5 : 1);
      }
      if (alive) out.push(g + gauss(r) * 0.07, 2);
    }
    return out;
  }
  function scanAll(w) {
    const minZ = new Float32Array(N * N), maxZ = new Float32Array(N * N), nearMin = new Uint8Array(N * N);
    const out = [];
    let ground = 0, total = 0;
    for (let i = 0; i < N * N; i++) {
      cellReturns(w, i, out);
      let mn = 1e9, mx = -1e9;
      for (let k = 0; k < out.length; k += 2) { mn = Math.min(mn, out[k]); mx = Math.max(mx, out[k]); if (out[k + 1] === 2) ground++; total++; }
      if (out.length === 0) { mn = mx = w.ground[i] + w.canopy[i]; }
      let c = 0;
      for (let k = 0; k < out.length; k += 2) if (out[k] < mn + 0.4) c++;
      minZ[i] = mn; maxZ[i] = mx; nearMin[i] = c;
    }
    w.minZ = minZ; w.maxZ = maxZ; w.nearMin = nearMin;
    w.stats = { returns: total, groundFrac: ground / Math.max(1, total), pulses: N * N * w.spec.density };
  }

  // ---------------- ground filter (progressive morphological, Zhang et al. 2003) ----------------
  function slide(src, dst, n, stride, off, rad, isMin, tmp) { // 1D sliding min/max via monotonic deque
    const q = tmp; let h = 0, t = 0;
    for (let k = 0; k < n + rad; k++) {
      if (k < n) {
        const v = src[off + k * stride];
        while (t > h && (isMin ? src[off + q[t - 1] * stride] >= v : src[off + q[t - 1] * stride] <= v)) t--;
        q[t++] = k;
      }
      const c = k - rad;
      if (c >= 0) {
        while (q[h] < c - rad) h++;
        dst[off + c * stride] = src[off + q[h] * stride];
      }
    }
  }
  function morph(src, rad, isMin) {
    const a = new Float32Array(N * N), b = new Float32Array(N * N), tmp = new Int32Array(N + 2 * rad + 4);
    for (let y = 0; y < N; y++) slide(src, a, N, 1, y * N, rad, isMin, tmp);
    for (let x = 0; x < N; x++) slide(a, b, N, N, x, rad, isMin, tmp);
    return b;
  }
  const open = (src, rad) => morph(morph(src, rad, true), rad, false);

  // settings: {win: max window metres, slope: % } -> {dtm, groundMask}
  function groundFilter(w, settings) {
    const s = settings.slope / 100, dh0 = 0.3, dhMax = 8;
    const rMax = Math.max(1, Math.round(settings.win / CELL / 2));
    const flag = new Uint8Array(N * N);
    let surf = w.minZ;
    let prevW = 1;
    for (let rad = 1; rad <= rMax; rad++) {
      const wk = 2 * rad + 1;
      const op = open(surf, rad);
      const dh = Math.min(dhMax, dh0 + s * (wk - prevW) * CELL);
      for (let i = 0; i < N * N; i++) if (surf[i] - op[i] > dh) flag[i] = 1;
      surf = op; prevW = wk;
    }
    const dtm = new Float32Array(N * N), mask = new Uint8Array(N * N);
    for (let i = 0; i < N * N; i++) if (!flag[i]) { dtm[i] = w.minZ[i]; mask[i] = 1; }
    fillHoles(dtm, mask);
    return { dtm, mask, settings: { win: settings.win, slope: settings.slope } };
  }
  // push-pull hole filling (multi-resolution average)
  function fillHoles(z, mask) {
    const levels = [];
    let n = N, val = new Float32Array(N * N), wt = new Float32Array(N * N);
    for (let i = 0; i < N * N; i++) if (mask[i]) { val[i] = z[i]; wt[i] = 1; }
    levels.push({ n, val, wt });
    while (n > 1) {
      const m = Math.ceil(n / 2), v2 = new Float32Array(m * m), w2 = new Float32Array(m * m);
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const i = y * n + x, j = (y >> 1) * m + (x >> 1);
        v2[j] += val[i] * wt[i]; w2[j] += wt[i];
      }
      for (let j = 0; j < m * m; j++) if (w2[j] > 0) { v2[j] /= w2[j]; w2[j] = Math.min(1, w2[j]); }
      levels.push({ n: m, val: v2, wt: w2 });
      n = m; val = v2; wt = w2;
    }
    for (let l = levels.length - 2; l >= 0; l--) {
      const L = levels[l], C = levels[l + 1];
      for (let y = 0; y < L.n; y++) for (let x = 0; x < L.n; x++) {
        const i = y * L.n + x;
        if (L.wt[i] >= 1) continue;
        // bilinear sample of coarse level
        const fx = clamp((x + 0.5) / 2 - 0.5, 0, C.n - 1), fy = clamp((y + 0.5) / 2 - 0.5, 0, C.n - 1);
        const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(C.n - 1, x0 + 1), y1 = Math.min(C.n - 1, y0 + 1);
        const tx = fx - x0, ty = fy - y0;
        const cv = lerp(lerp(C.val[y0 * C.n + x0], C.val[y0 * C.n + x1], tx), lerp(C.val[y1 * C.n + x0], C.val[y1 * C.n + x1], tx), ty);
        L.val[i] = L.val[i] * L.wt[i] + cv * (1 - L.wt[i]);
        L.wt[i] = 1;
      }
    }
    for (let i = 0; i < N * N; i++) if (!mask[i]) z[i] = levels[0].val[i];
  }

  // ---------------- visualisations (return Float32Array in [0,1] or signed) ----------------
  function hillshade(z, az, alt, zf) {
    zf = zf || 2;
    const out = new Float32Array(N * N);
    const A = az * Math.PI / 180, E = alt * Math.PI / 180;
    // light vector: x east, y south(grid), z up. Azimuth from north clockwise -> (sin A, -cos A)
    const lx = Math.sin(A) * Math.cos(E), ly = -Math.cos(A) * Math.cos(E), lz = Math.sin(E);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const xl = x > 0 ? x - 1 : x, xr = x < N - 1 ? x + 1 : x, yu = y > 0 ? y - 1 : y, yd = y < N - 1 ? y + 1 : y;
      const dzdx = (z[y * N + xr] - z[y * N + xl]) / ((xr - xl) * CELL) * zf;
      const dzdy = (z[yd * N + x] - z[yu * N + x]) / ((yd - yu) * CELL) * zf;
      const inv = 1 / Math.sqrt(dzdx * dzdx + dzdy * dzdy + 1);
      out[y * N + x] = Math.max(0, (-dzdx * lx - dzdy * ly + lz) * inv);
    }
    return out;
  }
  function multiHillshade(z, alt) {
    const out = new Float32Array(N * N), azs = [0, 60, 120, 180, 240, 300];
    for (const a of azs) { const h = hillshade(z, a, alt, 2); for (let i = 0; i < N * N; i++) out[i] += h[i] / azs.length; }
    return out;
  }
  // 3-directional hillshade (Kokalj 2016): one sun per colour channel, no blind azimuth
  function rgbHillshade(z, alt) { return [hillshade(z, 0, alt, 2), hillshade(z, 120, alt, 2), hillshade(z, 240, alt, 2)]; }
  function slopeDeg(z) {
    const out = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const xl = x > 0 ? x - 1 : x, xr = x < N - 1 ? x + 1 : x, yu = y > 0 ? y - 1 : y, yd = y < N - 1 ? y + 1 : y;
      const gx = (z[y * N + xr] - z[y * N + xl]) / ((xr - xl) * CELL), gy = (z[yd * N + x] - z[yu * N + x]) / ((yd - yu) * CELL);
      out[y * N + x] = Math.atan(Math.hypot(gx, gy)) * 180 / Math.PI;
    }
    return out;
  }
  function boxMean(z, rad) {
    const I = new Float64Array((N + 1) * (N + 1));
    for (let y = 0; y < N; y++) { let row = 0; for (let x = 0; x < N; x++) { row += z[y * N + x]; I[(y + 1) * (N + 1) + x + 1] = I[y * (N + 1) + x + 1] + row; } }
    const out = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const x0 = Math.max(0, x - rad), x1 = Math.min(N, x + rad + 1), y0 = Math.max(0, y - rad), y1 = Math.min(N, y + rad + 1);
      const s = I[y1 * (N + 1) + x1] - I[y0 * (N + 1) + x1] - I[y1 * (N + 1) + x0] + I[y0 * (N + 1) + x0];
      out[y * N + x] = s / ((x1 - x0) * (y1 - y0));
    }
    return out;
  }
  function localRelief(z, radiusM) { // Simple LRM: DTM minus mean-filtered trend (metres, signed)
    const m = boxMean(z, Math.max(1, Math.round(radiusM / CELL)));
    const out = new Float32Array(N * N);
    for (let i = 0; i < N * N; i++) out[i] = z[i] - m[i];
    return out;
  }
  function skyView(z, radiusM, dirs) { // Zaksek et al. 2011; 1 = open sky, lower = enclosed
    dirs = dirs || 16;
    const R = Math.round(radiusM / CELL), out = new Float32Array(N * N);
    const dx = [], dy = [];
    for (let d = 0; d < dirs; d++) { const a = d / dirs * Math.PI * 2; dx.push(Math.cos(a)); dy.push(Math.sin(a)); }
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const z0 = z[y * N + x];
      let acc = 0;
      for (let d = 0; d < dirs; d++) {
        let mx = 0; // max tan(elevation)
        for (let s = 1; s <= R; s++) {
          const xi = Math.round(x + dx[d] * s), yi = Math.round(y + dy[d] * s);
          if (xi < 0 || yi < 0 || xi >= N || yi >= N) break;
          const t = (z[yi * N + xi] - z0) / (s * CELL);
          if (t > mx) mx = t;
        }
        acc += Math.sin(Math.atan(mx));
      }
      out[y * N + x] = 1 - acc / dirs;
    }
    return out;
  }
  function lowPointDensity(w) { const o = new Float32Array(N * N); for (let i = 0; i < N * N; i++) o[i] = w.nearMin[i]; return o; }

  // ---------------- profile slice ----------------
  // a, b: [xm, ym]. Returns {len, pts: [{d, z, ground}], dtm: [[d,z]]}
  function profile(w, filt, a, b, halfWidth) {
    halfWidth = halfWidth || 1.5;
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
    const seen = new Set(), pts = [], line = [], out = [];
    for (let d = 0; d <= L; d += CELL / 2) {
      for (let o = -halfWidth; o <= halfWidth; o += CELL / 2) {
        const xm = a[0] + ux * d - uy * o, ym = a[1] + uy * d + ux * o;
        const cx = Math.floor(xm / CELL), cy = Math.floor(ym / CELL);
        if (cx < 0 || cy < 0 || cx >= N || cy >= N) continue;
        const i = cy * N + cx;
        if (seen.has(i)) continue;
        seen.add(i);
        cellReturns(w, i, out);
        const pr = rng(i * 7 + 3);
        const cd = ((cx + 0.5) * CELL - a[0]) * ux + ((cy + 0.5) * CELL - a[1]) * uy;
        for (let k = 0; k < out.length; k += 2) {
          const z = out[k];
          pts.push({ d: cd + (pr() - 0.5) * CELL, z, ground: filt ? (filt.mask[i] && z < filt.dtm[i] + 0.35) || Math.abs(z - filt.dtm[i]) < 0.25 : false });
        }
      }
      const cx = Math.floor((a[0] + ux * d) / CELL), cy = Math.floor((a[1] + uy * d) / CELL);
      if (filt && cx >= 0 && cy >= 0 && cx < N && cy < N) line.push([d, filt.dtm[cy * N + cx]]);
    }
    return { len: L, pts, dtm: line };
  }

  // ---------------- scoring ----------------
  const TYPES = ['pyramid', 'platform', 'mound', 'causeway', 'reservoir'];
  function featDist(f, x, y) {
    if (f.type === 'causeway' || f.type === 'track') return f.dist(x, y);
    return Math.hypot(f.x - x, f.y - y);
  }
  function sampleMax(z, f) { // max of z over the feature footprint core (cells within 40% of size)
    let best = -1e9;
    const R = Math.min(f.a || 4, f.b || 4) * 0.4;
    for (let y = Math.floor((f.y - R) / CELL); y <= Math.floor((f.y + R) / CELL); y++)
      for (let x = Math.floor((f.x - R) / CELL); x <= Math.floor((f.x + R) / CELL); x++)
        if (x >= 0 && y >= 0 && x < N && y < N) best = Math.max(best, z[y * N + x]);
    return best;
  }
  const DECOY_NOTE = {
    cone: 'Karst cone: a natural limestone hill. Round, lumpy, no flat top and no corners.',
    sinkhole: 'Sinkhole: a natural collapse, funnel-shaped. A reservoir has a flat bottom and a spoil berm.',
    track: 'Modern logging track: sunken ruts that curve with the terrain. A causeway is raised and dead straight.',
    treethrow: 'Tree-throw: the pit-and-mound left when a big tree falls and rips up its roots.'
  };
  function score(w, filt, pins) {
    const res = { hits: [], fps: [], dups: [], missed: [], points: 0 };
    const matched = new Map();
    const ordered = pins.map((p, k) => ({ p, k }));
    for (const { p, k } of ordered) {
      let best = null, bd = 1e9;
      for (const f of w.features) {
        const d = featDist(f, p.x, p.y);
        if (d < f.r && d / f.r < bd) { bd = d / f.r; best = f; }
      }
      if (best) {
        if (matched.has(best.id)) { res.dups.push({ pin: k, feature: best.id }); continue; }
        matched.set(best.id, k);
        const typeOk = p.type === best.type || (p.type === 'platform' && best.type === 'pyramid' && false);
        const hit = { pin: k, feature: best.id, type: best.type, typeOk, note: '' };
        if (best.type === 'pyramid' && filt) {
          const trueTop = sampleMax(w.ground, best), got = sampleMax(filt.dtm, best);
          hit.shaved = Math.max(0, trueTop - got);
          if (hit.shaved > 2) hit.note = 'Your ground filter shaved ' + hit.shaved.toFixed(1) + ' m off the top of this pyramid.';
        }
        res.hits.push(hit);
        res.points += 100 + (typeOk ? 50 : 0);
        continue;
      }
      // false positive: explain
      let why = 'Nothing built here: natural micro-relief.', kind = 'nothing';
      for (const d of w.decoys) if (featDist(d, p.x, p.y) < d.r) { why = DECOY_NOTE[d.type]; kind = d.type; break; }
      if (kind === 'nothing' && filt) {
        let worst = 0;
        const cx = Math.floor(p.x / CELL), cy = Math.floor(p.y / CELL);
        for (let y = cy - 4; y <= cy + 4; y++) for (let x = cx - 4; x <= cx + 4; x++)
          if (x >= 0 && y >= 0 && x < N && y < N) worst = Math.max(worst, filt.dtm[y * N + x] - w.ground[y * N + x]);
        if (worst > 0.8) { why = 'Filter artefact: no pulse reached the ground here, so the "ground" is understory returns ' + worst.toFixed(1) + ' m up.'; kind = 'artefact'; }
      }
      res.fps.push({ pin: k, kind, why });
      res.points -= 75;
    }
    for (const f of w.features) if (!matched.has(f.id)) res.missed.push(f.id);
    const req = w.features.filter(f => f.required);
    res.requiredOk = req.every(f => matched.has(f.id));
    res.quota = w.spec.quota; res.maxFP = w.spec.maxFP; res.total = w.features.length;
    res.pass = res.hits.length >= w.spec.quota && res.fps.length <= w.spec.maxFP && res.requiredOk;
    res.points = Math.max(0, res.points);
    const frac = res.hits.length / res.total;
    res.grade = !res.pass ? 'F' : frac >= 0.9 && res.fps.length === 0 ? 'A+' : frac >= 0.75 && res.fps.length <= 1 ? 'A' : frac >= 0.6 ? 'B' : 'C';
    return res;
  }

  const BE = {
    N, CELL, SIZE, STRIPS, TYPES, rng, fbm, vnoise, clamp, smooth,
    pyramid, platform, causeway, reservoir, cone, sinkhole, track,
    randomSpec, makeWorld, cellReturns, groundFilter, open, fillHoles,
    hillshade, multiHillshade, rgbHillshade, slopeDeg, localRelief, skyView, boxMean, lowPointDensity, profile, score, sampleMax, featDist, DECOY_NOTE
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = BE;
  else root.BE = BE;
})(this);
