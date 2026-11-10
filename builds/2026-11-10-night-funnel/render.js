// Night Funnel - canvas renderer + HUD. Draws from the NF world each frame. No DOM besides the canvas.
(function (root) {
  'use strict';
  const NF = root.NF;
  const { sub, dot, len, norm, clamp } = NF;

  const PAL = {
    nvg: { skyTop: '#031208', skyHor: '#0d3a1c', ground: '#010703', light: '#a8ffb8', dim: '#4fae65', star: '#b6ffc4', drone: '#d6ffdc', glow: '#e8ffe0', tracer: '#f2ffcf', fire: '#eaffc0', hud: '#8dff9f' },
    dusk: { skyTop: '#070b22', skyHor: '#7a3b38', ground: '#05060b', light: '#ffd48a', dim: '#9a7440', star: '#cfd8ff', drone: '#0a0d16', glow: '#ff9a40', tracer: '#ffb347', fire: '#ffb060', hud: '#8dff9f' }
  };

  const R = {};
  let cv, ctx, W = 0, H = 0, dpr = 1, F = 1000, cx = 0, cy = 0, S = 1;
  let stars = [], cityPts = [], ruralPts = [], noiseCv = null;
  const parts = [];       // world-space particles
  const flashes = [];     // glow sprites {pos, t0, dur, r, col}
  R.shake = 0;
  R.reduced = false;

  function rng(seed) { return NF.rng(seed); }

  R.init = function (canvas) {
    cv = canvas; ctx = cv.getContext('2d');
    const r = rng(99);
    stars = [];
    for (let i = 0; i < 260; i++) {
      const a = r() * Math.PI * 2, z = Math.pow(r(), 0.7) * 0.97 + 0.03, h = Math.sqrt(1 - z * z);
      stars.push({ d: [Math.cos(a) * h, Math.sin(a) * h, z], b: 0.3 + r() * 0.7 });
    }
    const ds = NF.cityDistricts();
    cityPts = ds.map(d => {
      const n = Math.floor(d.r * d.r / 4200), pts = [];
      for (let i = 0; i < n; i++) {
        const a = r() * Math.PI * 2, rr = d.r * Math.pow(r(), 0.8);
        pts.push([d.x + Math.cos(a) * rr, d.y + Math.sin(a) * rr, r() < 0.12 ? 1 : 0]);
      }
      // a few street lines of lights
      for (let k = 0; k < 3; k++) {
        const a = r() * Math.PI, ox = (r() - 0.5) * d.r;
        for (let s = -d.r; s < d.r; s += 40) pts.push([d.x + Math.cos(a) * s - Math.sin(a) * ox, d.y + Math.sin(a) * s + Math.cos(a) * ox, 0]);
      }
      return pts;
    });
    ruralPts = [];
    for (let i = 0; i < 1400; i++) ruralPts.push([(r() - 0.5) * 40000, (r() - 0.5) * 40000]);
    // pre-rendered film grain
    noiseCv = document.createElement('canvas'); noiseCv.width = noiseCv.height = 128;
    const nc = noiseCv.getContext('2d'), id = nc.createImageData(128, 128);
    for (let i = 0; i < id.data.length; i += 4) { const v = Math.floor(r() * 255); id.data[i] = v; id.data[i + 1] = 255; id.data[i + 2] = v; id.data[i + 3] = 255; }
    nc.putImageData(id, 0, 0);
    R.resize();
  };

  R.resize = function () {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = cv.clientWidth; H = cv.clientHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    S = Math.max(0.7, Math.min(W, H) / 560);
    // narrow field of view so a 2.5 m wingspan is readable at gun range
    F = W >= H ? H * 1.7 : W * 1.9;
    cx = W / 2; cy = H * 0.46;
  };

  R.reset = function () { parts.length = 0; flashes.length = 0; R.shake = 0; };

  // ---------- events -> visual effects ----------
  R.onEvent = function (e, w) {
    const many = R.reduced ? 0.3 : 1;
    if (e.type === 'hit') {
      for (let i = 0; i < 5 * many; i++) parts.push({ p: e.pos.slice(), v: [(Math.random() - 0.5) * 60, (Math.random() - 0.5) * 60, (Math.random() - 0.3) * 60], t0: w.t, life: 0.5, col: 'tracer', s: 2 });
    } else if (e.type === 'boom') {
      flashes.push({ pos: e.pos.slice(), t0: w.t, dur: 1.4, r: 38, col: 'fire' });
      for (let i = 0; i < 40 * many; i++) {
        const a = Math.random() * 6.28, b = (Math.random() - 0.4) * 3, sp = 10 + Math.random() * 70;
        parts.push({ p: e.pos.slice(), v: [Math.cos(a) * sp, Math.sin(a) * sp, b * sp * 0.6], t0: w.t, life: 1 + Math.random(), col: 'fire', s: 2.5 });
      }
      if (!R.reduced) R.shake = Math.max(R.shake, clamp(1 - e.dist / 500, 0, 1) * 14);
    } else if (e.type === 'kill') {
      flashes.push({ pos: e.pos.slice(), t0: w.t, dur: 0.6, r: 10, col: 'fire' });
    } else if (e.type === 'crash') {
      flashes.push({ pos: e.pos.slice(), t0: w.t, dur: 1.6, r: 25, col: 'fire' });
    } else if (e.type === 'impact') {
      flashes.push({ pos: e.pos.slice(), t0: w.t, dur: 3.5, r: 120, col: 'fire' });
      for (let i = 0; i < 30 * many; i++) {
        const a = Math.random() * 6.28, sp = 20 + Math.random() * 90;
        parts.push({ p: e.pos.slice(), v: [Math.cos(a) * sp, Math.sin(a) * sp, 20 + Math.random() * 90], t0: w.t, life: 1.5 + Math.random() * 1.5, col: 'fire', s: 3 });
      }
    } else if (e.type === 'damage') {
      if (!R.reduced) R.shake = Math.max(R.shake, 12);
      R.hurtAt = w.t;
    } else if (e.type === 'ground') { if (!R.reduced) R.shake = 20; }
  };

  // ---------- helpers ----------
  function camOf(j) { const f = j.f, u = j.u; return { p: j.pos, f, u, r: NF.cross(f, u) }; }
  function proj(c, p) {
    const dx = p[0] - c.p[0], dy = p[1] - c.p[1], dz = p[2] - c.p[2];
    const z = dx * c.f[0] + dy * c.f[1] + dz * c.f[2];
    if (z < 1) return null;
    const x = dx * c.r[0] + dy * c.r[1] + dz * c.r[2], y = dx * c.u[0] + dy * c.u[1] + dz * c.u[2];
    return [cx + F * x / z, cy - F * y / z, z];
  }
  function projDir(c, d) { // direction vector (at infinity)
    const z = dot(d, c.f); if (z < 0.02) return null;
    return [cx + F * dot(d, c.r) / z, cy - F * dot(d, c.u) / z, z];
  }

  // ---------- scene ----------
  function drawSky(c, P, nvg, t) {
    // horizon line: A x + B y + C = 0 in screen space
    const A = c.r[2], B = -c.u[2], C = F * c.f[2] + A * cx * 0 ; // line through the optical axis offset handled below
    // value(x,y) with x,y relative to (cx,cy): z-component of ray = f.z + (x/F) r.z - (y/F) u.z
    const n2 = Math.hypot(A, B) || 1e-9;
    const nx = A / n2, ny = B / n2, off = C / n2;     // signed distance of the line from (cx,cy): value/ n2
    // closest point of the line to (cx,cy): p0 = -off * n
    const p0x = cx - off * nx, p0y = cy - off * ny;
    const tx = -ny, ty = nx;                           // tangent
    const ang = Math.atan2(ty, tx);
    const ax = -Math.sin(ang), ay = Math.cos(ang);     // local +y axis in screen coords
    const gs = (-nx * ax - ny * ay) >= 0 ? 1 : -1;     // ground is where value < 0, i.e. along -n
    ctx.save();
    ctx.translate(p0x, p0y); ctx.rotate(ang);
    const big = Math.max(W, H) * 3;
    const g = ctx.createLinearGradient(0, 0, 0, -gs * Math.max(W, H) * 1.3);
    g.addColorStop(0, P.skyHor); g.addColorStop(0.6, P.skyTop); g.addColorStop(1, P.skyTop);
    ctx.fillStyle = g; ctx.fillRect(-big, gs > 0 ? -big : 0, big * 2, big);
    ctx.fillStyle = P.ground; ctx.fillRect(-big, gs > 0 ? 0 : -big, big * 2, big);
    // thin horizon glow
    const hg = ctx.createLinearGradient(0, -gs * 14 * S, 0, gs * 3 * S);
    hg.addColorStop(0, 'rgba(0,0,0,0)'); hg.addColorStop(0.8, nvg ? 'rgba(120,255,150,0.18)' : 'rgba(255,150,90,0.25)'); hg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = hg; ctx.fillRect(-big, -14 * S, big * 2, 17 * S);
    ctx.restore();
    // stars
    ctx.fillStyle = P.star;
    for (const s of stars) {
      const q = projDir(c, s.d); if (!q) continue;
      if (q[0] < 0 || q[0] > W || q[1] < 0 || q[1] > H) continue;
      ctx.globalAlpha = s.b * (0.7 + 0.3 * Math.sin(t * 2 + s.b * 40));
      ctx.fillRect(q[0], q[1], 1.4, 1.4);
    }
    ctx.globalAlpha = 1;
    return { ang, A, B };
  }

  function drawGround(c, w, P) {
    // dim rural lights
    ctx.fillStyle = P.dim; ctx.globalAlpha = 0.35;
    for (const p of ruralPts) {
      const dx = p[0] - c.p[0], dy = p[1] - c.p[1], dz = -c.p[2];
      const z = dx * c.f[0] + dy * c.f[1] + dz * c.f[2];
      if (z < 30 || z > 14000) continue;
      const x = dx * c.r[0] + dy * c.r[1] + dz * c.r[2], y = dx * c.u[0] + dy * c.u[1] + dz * c.u[2];
      const sx = cx + F * x / z, sy = cy - F * y / z;
      if (sx < -4 || sx > W + 4 || sy < -4 || sy > H + 4) continue;
      const s = clamp(F * 6 / z, 1, 3); ctx.fillRect(sx, sy, s, s);
    }
    ctx.globalAlpha = 1;
    // city districts
    for (let di = 0; di < w.districts.length; di++) {
      const d = w.districts[di];
      const a = d.lit ? 1 : Math.max(0, 1 - (w.t - d.darkAt) / 4);
      if (a <= 0.01) continue;
      const dxc = d.x - c.p[0], dyc = d.y - c.p[1];
      const zc = dxc * c.f[0] + dyc * c.f[1];
      if (zc < -d.r * 1.2) continue;
      const pts = cityPts[di];
      ctx.globalAlpha = a * 0.95;
      for (let pass = 0; pass < 2; pass++) {
        ctx.fillStyle = pass ? P.glow : P.light;
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i]; if ((p[2] | 0) !== pass) continue;
          const dx = p[0] - c.p[0], dy = p[1] - c.p[1], dz = -c.p[2];
          const z = dx * c.f[0] + dy * c.f[1] + dz * c.f[2];
          if (z < 20) continue;
          const x = dx * c.r[0] + dy * c.r[1] + dz * c.r[2], y = dx * c.u[0] + dy * c.u[1] + dz * c.u[2];
          const sx = cx + F * x / z, sy = cy - F * y / z;
          if (sx < -4 || sx > W + 4 || sy < -4 || sy > H + 4) continue;
          const s = clamp(F * 14 / z, 1, 3.2); ctx.fillRect(sx, sy, s, s);
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  function glow(x, y, r, col, a) {
    if (r < 0.5) return;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = a; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill(); ctx.globalAlpha = 1;
  }

  function drawDrone(c, d, w, P, nvg) {
    const q = proj(c, d.pos); if (!q) return;
    const Fr = NF.droneFrame(d), T = d.T;
    const tip = (a, b, cc) => proj(c, [d.pos[0] + Fr.fw[0] * a + Fr.rt[0] * b + Fr.up[0] * cc, d.pos[1] + Fr.fw[1] * a + Fr.rt[1] * b + Fr.up[1] * cc, d.pos[2] + Fr.fw[2] * a + Fr.rt[2] * b + Fr.up[2] * cc]);
    const nose = tip(T.lenM * 0.5, 0, 0), tail = tip(-T.lenM * 0.5, 0, 0), l = tip(-T.lenM * 0.35, -T.span / 2, 0), r = tip(-T.lenM * 0.35, T.span / 2, 0);
    const burning = d.state === 'falling';
    if (nose && tail && l && r) {
      ctx.fillStyle = P.drone; ctx.globalAlpha = nvg ? 0.92 : 1;
      ctx.beginPath(); ctx.moveTo(nose[0], nose[1]); ctx.lineTo(l[0], l[1]); ctx.lineTo(tail[0], tail[1]); ctx.lineTo(r[0], r[1]); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
    }
    // exhaust glow (piston: dull, jet: bright)
    const gr = clamp(F * (d.type === 'jet' ? 2.4 : 1.4) / q[2], 1.5, 30);
    const tl = tail || q;
    glow(tl[0], tl[1], gr, P.glow, d.type === 'jet' ? 0.9 : 0.6);
    if (burning) glow(tl[0], tl[1], clamp(F * 7 / q[2], 3, 60), P.fire, 0.9);
  }

  function drawTracers(c, w, P) {
    ctx.lineCap = 'round';
    for (const r of w.rounds) {
      if (!r.tracer) continue;
      const age = w.t - r.t0;
      const p1 = NF.roundPos(r.o, r.dir, r.v0, age), p0 = NF.roundPos(r.o, r.dir, r.v0, Math.max(0, age - 0.05));
      const a = proj(c, p0), b = proj(c, p1);
      if (!a || !b) continue;
      ctx.strokeStyle = P.tracer; ctx.lineWidth = clamp(F * 0.5 / b[2], 1, 3.5) ;
      ctx.globalAlpha = 0.95; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawFx(c, w, P) {
    for (let i = flashes.length - 1; i >= 0; i--) {
      const f = flashes[i], age = w.t - f.t0;
      if (age > f.dur) { flashes.splice(i, 1); continue; }
      const q = proj(c, f.pos); if (!q) continue;
      const k = age / f.dur, rad = clamp(F * f.r * (0.4 + k) / q[2], 4, W * 0.6);
      glow(q[0], q[1], rad, P.fire, (1 - k) * 0.95);
    }
    ctx.fillStyle = P.fire;
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i], age = w.t - p.t0;
      if (age > p.life) { parts.splice(i, 1); continue; }
      const t = Math.max(0, age);
      const pos = [p.p[0] + p.v[0] * t, p.p[1] + p.v[1] * t, p.p[2] + p.v[2] * t - 0.5 * 9.81 * t * t * 0.5];
      const q = proj(c, pos); if (!q) continue;
      ctx.globalAlpha = 1 - age / p.life;
      const s = clamp(F * p.s * 0.3 / q[2], 1.2, 5); ctx.fillRect(q[0], q[1], s, s);
    }
    ctx.globalAlpha = 1;
    // burning wrecks: flame glow trail handled in drawDrone
  }

  // ---------- HUD ----------
  const HUD = '#8dff9f';
  function txt(s, x, y, size, align, col) {
    ctx.font = '600 ' + Math.round(size) + 'px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = align || 'left'; ctx.fillStyle = col || HUD; ctx.fillText(s, x, y);
  }

  function drawFunnel(c, w, tgtRange, inRange) {
    R.batr = null;
    const pts = NF.funnel(w.hist, w.t, NF.FUNNEL_TAUS);
    const sc = [];
    for (const p of pts) {
      const q = proj(c, p.p);
      if (!q) break;
      sc.push({ x: q[0], y: q[1], range: p.range, width: 2.5 * F / Math.max(20, p.range) });
    }
    if (sc.length < 3) return;
    const L = [], Rr = [];
    for (let i = 0; i < sc.length; i++) {
      const a = sc[Math.max(0, i - 1)], b = sc[Math.min(sc.length - 1, i + 1)];
      let tx = b.x - a.x, ty = b.y - a.y; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
      const nx = -ty, ny = tx, hw = Math.max(sc[i].width / 2, 1.2);
      L.push([sc[i].x + nx * hw, sc[i].y + ny * hw]); Rr.push([sc[i].x - nx * hw, sc[i].y - ny * hw]);
    }
    const firing = w.firing;
    ctx.lineWidth = Math.max(1.4, 1.4 * S * 0.8); ctx.strokeStyle = firing ? '#d8ffe0' : HUD; ctx.globalAlpha = 0.95;
    for (const side of [L, Rr]) {
      ctx.beginPath(); side.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.stroke();
    }
    // centre line, faint dashes
    ctx.globalAlpha = 0.35; ctx.setLineDash([3, 6]); ctx.beginPath(); sc.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke(); ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    // range bars: 200, 400, 600 m
    [200, 400, 600, 800].forEach((rg, k) => {
      let i = sc.findIndex(p => p.range >= rg); if (i < 0) return;
      ctx.beginPath(); ctx.moveTo(L[i][0], L[i][1]); ctx.lineTo(Rr[i][0], Rr[i][1]); ctx.stroke();
      txt(String(rg / 100), Rr[i][0] - 6 * S, Rr[i][1] + 4 * S, 10 * S, 'right');
    });
    // BATR (bullets at target range): with a lock, a ring on the funnel where the bullets are at the
    // drone's current range. On a small screen this is easier to read than the 2.5 m wall spacing.
    if (tgtRange > 0) {
      const i = sc.findIndex(p => p.range >= tgtRange);
      if (i > 0) {
        const a = sc[i - 1], b = sc[i], k = (tgtRange - a.range) / Math.max(1e-6, b.range - a.range);
        const x = a.x + (b.x - a.x) * k, y = a.y + (b.y - a.y) * k, hw = Math.max((a.width + (b.width - a.width) * k) / 2, 1.2);
        const rr = Math.max(hw + 3 * S, 7 * S);
        ctx.strokeStyle = inRange ? '#eaffef' : HUD; ctx.lineWidth = inRange ? 2 : 1.4; ctx.globalAlpha = inRange ? 1 : 0.7;
        ctx.beginPath(); ctx.arc(x, y, rr, 0, 6.2832); ctx.stroke();
        ctx.globalAlpha = 1;
        R.batr = { x, y, r: rr };
      }
    }
  }

  function drawPitchLadder(c, hz, nvg) {
    const hx = norm([c.f[0], c.f[1], 0]);
    const hv = Math.hypot(c.f[0], c.f[1]) < 0.15; if (hv) return;
    ctx.lineWidth = 1.2; ctx.strokeStyle = HUD; ctx.globalAlpha = 0.55;
    let ang = hz.ang; if (ang > Math.PI / 2) ang -= Math.PI; if (ang < -Math.PI / 2) ang += Math.PI;
    for (let deg = -30; deg <= 30; deg += 10) {
      if (!deg) continue;
      const th = deg * Math.PI / 180;
      const d = [hx[0] * Math.cos(th), hx[1] * Math.cos(th), Math.sin(th)];
      const q = projDir(c, d); if (!q) continue;
      if (q[0] < 0 || q[0] > W || q[1] < H * 0.1 || q[1] > H * 0.85) continue;
      ctx.save(); ctx.translate(q[0], q[1]); ctx.rotate(ang);
      const hw = 34 * S;
      ctx.beginPath(); ctx.moveTo(-hw, deg < 0 ? -5 * S : 5 * S); ctx.lineTo(-hw, 0); ctx.lineTo(-hw * 0.35, 0); ctx.moveTo(hw * 0.35, 0); ctx.lineTo(hw, 0); ctx.lineTo(hw, deg < 0 ? -5 * S : 5 * S); ctx.stroke();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function drawMap(w, x0, y0, sz) {
    ctx.save();
    ctx.fillStyle = 'rgba(0,12,4,0.55)'; ctx.strokeStyle = 'rgba(141,255,159,0.5)'; ctx.lineWidth = 1;
    ctx.fillRect(x0, y0, sz, sz); ctx.strokeRect(x0, y0, sz, sz);
    const span = 34000, k = sz / span, mx = x0 + sz / 2, my = y0 + sz / 2;
    ctx.beginPath(); ctx.rect(x0, y0, sz, sz); ctx.clip();
    for (const d of w.districts) {
      ctx.fillStyle = d.lit ? 'rgba(168,255,184,0.55)' : 'rgba(60,70,60,0.5)';
      ctx.beginPath(); ctx.arc(mx + d.x * k, my - d.y * k, Math.max(2, d.r * k * 0.7), 0, 6.3); ctx.fill();
    }
    for (const d of w.drones) {
      if (d.state !== 'fly' && d.state !== 'dive') continue;
      ctx.fillStyle = d.id === w.lock ? '#ff6a55' : '#ffb0a0';
      ctx.fillRect(mx + d.pos[0] * k - 2, my - d.pos[1] * k - 2, 4, 4);
    }
    const j = w.jet, px = mx + j.pos[0] * k, py = my - j.pos[1] * k, h = Math.atan2(j.f[0], j.f[1]);
    ctx.translate(px, py); ctx.rotate(h);
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(3.5, 4); ctx.lineTo(-3.5, 4); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  function drawHud(c, w, ui, hz) {
    const j = w.jet, N = w.night;
    const fs = 12 * S;
    ctx.lineWidth = 1.5;
    drawPitchLadder(c, hz, ui.nvg);
    const dl = w.lock >= 0 ? w.drones[w.lock] : null;
    let tR = -1;
    if (dl && (dl.state === 'fly' || dl.state === 'dive')) tR = len(sub(dl.pos, j.pos));
    drawFunnel(c, w, tR > 0 && tR < 1300 ? tR : -1, tR > 150 && tR < 700);
    // gun cross + flight path marker (nose = velocity in this model)
    ctx.strokeStyle = HUD; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(cx - 9 * S, cy); ctx.lineTo(cx - 3 * S, cy); ctx.moveTo(cx + 3 * S, cy); ctx.lineTo(cx + 9 * S, cy); ctx.moveTo(cx, cy - 9 * S); ctx.lineTo(cx, cy - 3 * S); ctx.moveTo(cx, cy + 3 * S); ctx.lineTo(cx, cy + 9 * S); ctx.stroke();
    // target designator
    const d = w.lock >= 0 ? w.drones[w.lock] : null;
    let status = '';
    if (d && (d.state === 'fly' || d.state === 'dive')) {
      const rel = sub(d.pos, j.pos), Rg = len(rel), clos = -dot(sub(d.vel, j.vel), norm(rel));
      const q = proj(c, d.pos);
      const onScreen = q && q[0] > 20 && q[0] < W - 20 && q[1] > 20 && q[1] < H - 20;
      if (onScreen) {
        const bs = Math.max(13 * S, 2.6 * d.T.span * F / Rg);
        ctx.strokeStyle = Rg < 170 ? '#ff6a55' : '#ff9d8a'; ctx.lineWidth = 1.6;
        const x0 = q[0] - bs, y0 = q[1] - bs, x1 = q[0] + bs, y1 = q[1] + bs, k = bs * 0.4;
        ctx.beginPath();
        [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]].forEach(([x, y, sx, sy]) => { ctx.moveTo(x, y + sy * k); ctx.lineTo(x, y); ctx.lineTo(x + sx * k, y); });
        ctx.stroke();
        txt(Math.round(Rg) + ' m', x1 + 5 * S, q[1] - 2, fs * 0.9, 'left', '#ffb3a3');
        txt((clos >= 0 ? '+' : '') + Math.round(clos) + ' m/s', x1 + 5 * S, q[1] + fs, fs * 0.8, 'left', '#ffb3a3');
      } else {
        const rx = dot(rel, c.r), ry = dot(rel, c.u), a = Math.atan2(-ry, rx);
        const rr = Math.min(W, H) * 0.36;
        const ax = cx + Math.cos(a) * rr * (W >= H ? 1.5 : 0.9), ay = cy + Math.sin(a) * rr;
        ctx.save(); ctx.translate(ax, ay); ctx.rotate(a); ctx.fillStyle = '#ff9d8a';
        ctx.beginPath(); ctx.moveTo(10 * S, 0); ctx.lineTo(-6 * S, 6 * S); ctx.lineTo(-6 * S, -6 * S); ctx.closePath(); ctx.fill(); ctx.restore();
        txt(Math.round(Rg / 100) / 10 + ' km', ax, ay + 20 * S, fs * 0.85, 'center', '#ffb3a3');
      }
      if (Rg < 170) status = 'BREAK  WARHEAD';
      else if (Rg > 150 && Rg < 700 && onScreen) status = 'IN RANGE';
    }
    // warnings
    let warn = '';
    const vz = j.vel[2], alt = j.pos[2];
    if (j.dead) warn = '';
    else if (alt + vz * 3 < 60 && vz < -3 || alt < 90 && vz < 0) warn = 'PULL UP';
    else if (NF.nAvail(j.speed) < 1.5) warn = 'STALL';
    else if (j.fuel < N.fuel * 0.12) warn = 'BINGO FUEL';
    const flash = Math.floor(w.t * 4) % 2 === 0 || R.reduced;
    if (warn && flash) txt(warn, cx, cy + 70 * S, 22 * S, 'center', '#ff6a55');
    else if (status && (status !== 'IN RANGE' || true)) txt(status, cx, cy - 30 * S, 15 * S, 'center', status === 'IN RANGE' ? HUD : '#ff6a55');
    // data blocks
    const top = 22 * S + (ui.safeTop || 0), side = 14 * S;
    const kt = Math.round(j.speed * 1.944), ft = Math.round(alt * 3.281 / 10) * 10;
    txt(String(kt), side + 4, cy + 4, fs * 1.5, 'left'); txt('KT', side + 4, cy + 4 + fs * 1.1, fs * 0.8, 'left');
    txt(String(ft), W - side - 4, cy + 4, fs * 1.5, 'right'); txt('FT', W - side - 4, cy + 4 + fs * 1.1, fs * 0.8, 'right');
    txt('G ' + j.g.toFixed(1), side + 4, cy + 4 + fs * 3, fs * 1.1, 'left', j.g > 6.5 ? '#ffd27a' : HUD);
    txt('THR ' + Math.round(j.thr * 100) + (j.thr > 0.9 ? ' AB' : '') + (j.brake ? '  BRK' : ''), side + 4, cy + 4 + fs * 4.4, fs * 0.9, 'left');
    // heading
    const hdg = (Math.round(Math.atan2(j.f[0], j.f[1]) * 180 / Math.PI) + 360) % 360;
    txt(String(hdg).padStart(3, '0'), cx, top, fs * 1.3, 'center');
    // ammo / fuel / damage
    const bot = H - 16 * S - (ui.safeBottom || 0) - (ui.textLift || 0);
    txt('RNDS ' + w.ammo, cx, bot, fs * 1.4, 'center', w.ammo < 60 ? '#ffd27a' : HUD);
    txt('KILLS ' + w.kills + '/' + w.drones.length + '   FUEL ' + Math.round(100 * j.fuel / N.fuel) + '%' + (j.damage > 0 ? '   DMG ' + Math.round(j.damage) : ''), cx, bot - fs * 1.7, fs * 0.9, 'center', j.damage > 40 ? '#ff9d8a' : HUD);
    // map
    const ms = Math.round(Math.min(110 * S, Math.min(W, H) * 0.26));
    drawMap(w, 10 * S, H - ms - 12 * S - (ui.safeBottom || 0), ms);
    // coaching
    if (N.coach && !w.over) {
      const i = Math.min(N.coach.length - 1, Math.floor(w.t / 10));
      const line = N.coach[i];
      ctx.font = '600 ' + Math.round(13 * S) + 'px system-ui, sans-serif';
      const wrap = wrapText(line, W * 0.86);
      let yy = H * 0.14 + (ui.safeTop || 0);
      ctx.fillStyle = 'rgba(0,16,6,0.6)';
      const bw = Math.min(W * 0.9, Math.max(...wrap.map(s => ctx.measureText(s).width)) + 24);
      ctx.fillRect(cx - bw / 2, yy - 18 * S, bw, wrap.length * 17 * S + 12 * S);
      wrap.forEach((s, k) => txt(s, cx, yy + k * 17 * S, 13 * S, 'center', '#d6ffdc'));
    }
  }
  function wrapText(s, maxW) {
    const words = s.split(' '), out = []; let cur = '';
    for (const wd of words) { const t = cur ? cur + ' ' + wd : wd; if (ctx.measureText(t).width > maxW && cur) { out.push(cur); cur = wd; } else cur = t; }
    if (cur) out.push(cur); return out;
  }

  // ---------- frame ----------
  R.draw = function (w, ui) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const P = ui.nvg ? PAL.nvg : PAL.dusk;
    const c = camOf(w.jet);
    ctx.save();
    if (R.shake > 0.1) { ctx.translate((Math.random() - 0.5) * R.shake, (Math.random() - 0.5) * R.shake); R.shake *= 0.9; } else R.shake = 0;
    const hz = drawSky(c, P, ui.nvg, w.t);
    drawGround(c, w, P);
    for (const d of w.drones) if (['fly', 'dive', 'falling'].includes(d.state)) drawDrone(c, d, w, P, ui.nvg);
    drawTracers(c, w, P);
    drawFx(c, w, P);
    if (!ui.bgOnly) drawHud(c, w, ui, hz);
    ctx.restore();
    // NVG look: grain + vignette
    if (ui.nvg) {
      if (!R.reduced) {
        ctx.globalAlpha = 0.07; ctx.globalCompositeOperation = 'overlay';
        const ox = Math.floor(Math.random() * 128), oy = Math.floor(Math.random() * 128);
        const pat = ctx.createPattern(noiseCv, 'repeat'); ctx.save(); ctx.translate(-ox, -oy); ctx.fillStyle = pat; ctx.fillRect(0, 0, W + 128, H + 128); ctx.restore();
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      }
      const vg = ctx.createRadialGradient(cx, H / 2, Math.min(W, H) * 0.3, cx, H / 2, Math.max(W, H) * 0.75);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,10,2,0.75)');
      ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    }
    if (w.jet.damage > 0 && w.t - (R.hurtAt || -9) < 0.5) { ctx.fillStyle = 'rgba(255,60,40,' + (0.35 * (1 - (w.t - R.hurtAt) / 0.5)) + ')'; ctx.fillRect(0, 0, W, H); }
    if (w.jet.damage >= 45) { // cracked canopy
      ctx.strokeStyle = 'rgba(200,255,210,0.35)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(W * 0.78, 0); ctx.lineTo(W * 0.7, H * 0.18); ctx.lineTo(W * 0.74, H * 0.3); ctx.moveTo(W * 0.7, H * 0.18); ctx.lineTo(W * 0.6, H * 0.22); ctx.stroke();
    }
  };

  R.size = () => ({ W, H });
  root.NFR = R;
})(this);
