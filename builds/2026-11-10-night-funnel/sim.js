// Night Funnel - pure simulation (no DOM). Usable in the browser (window.NF) and in node (require).
// World frame: x east, y north, z up, metres, seconds. Ground is the plane z = 0.
(function (root) {
  'use strict';

  const G = 9.81;
  const DT = 1 / 120;

  // ---------- small vector helpers (plain arrays [x, y, z]) ----------
  const v3 = (x = 0, y = 0, z = 0) => [x, y, z];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const len = a => Math.hypot(a[0], a[1], a[2]);
  const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  // rotate vector a around unit axis k by angle th (Rodrigues)
  function rot(a, k, th) {
    const c = Math.cos(th), s = Math.sin(th), kd = dot(k, a), kx = cross(k, a);
    return [a[0] * c + kx[0] * s + k[0] * kd * (1 - c), a[1] * c + kx[1] * s + k[1] * kd * (1 - c), a[2] * c + kx[2] * s + k[2] * kd * (1 - c)];
  }

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
  function gauss(r) { let u = 0, v = 0; while (u === 0) u = r(); v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

  // ---------- aircraft (F-16-ish point mass, nose = velocity vector) ----------
  const AC = {
    mass: 11000, S: 27.87, cd0: 0.024, k: 0.12, cdBrake: 0.07,
    tMil: 76000, tAB: 127000, vCorner: 165, nMax: 9, nMin: -3, rollMax: 4.0,
    gLag: 0.12, burnIdle: 0.25, burnMil: 1.2, burnAB: 6.0
  };
  const rho = z => 1.225 * Math.exp(-Math.max(0, z) / 8500);
  // load factor the wing can give at speed V (stall model): 1 g at ~55 m/s, 9 g at the corner speed
  const nAvail = V => Math.min(AC.nMax, AC.nMax * (V / AC.vCorner) * (V / AC.vCorner));
  function thrustOf(thr) { // thr 0..1; 0.9..1 = afterburner zone
    if (thr <= 0.9) return AC.tMil * (0.04 + 0.96 * thr / 0.9);
    return AC.tMil + (AC.tAB - AC.tMil) * (thr - 0.9) / 0.1;
  }
  function burnOf(thr) {
    if (thr <= 0.9) return AC.burnIdle + (AC.burnMil - AC.burnIdle) * Math.pow(thr / 0.9, 2);
    return AC.burnMil + (AC.burnAB - AC.burnMil) * (thr - 0.9) / 0.1;
  }

  function makeJet(pos, hdg, speed) {
    const f = [Math.sin(hdg), Math.cos(hdg), 0];
    return {
      pos: pos.slice(), vel: mul(f, speed), f, u: [0, 0, 1], n: 1, nCmd: 1, thr: 0.6, brake: false,
      damage: 0, fuel: 1000, dead: false, deadWhy: '', aoaWarn: false
    };
  }

  // input: {roll: -1..1 (right +), pull: -1..1 (pull +), thr: 0..1, brake: bool}
  function stepJet(j, inp, dt) {
    let V = len(j.vel);
    const f = j.f, u = j.u, r = cross(f, u);
    // roll about the velocity vector
    const pmax = AC.rollMax * clamp(V / 150, 0.35, 1);
    const p = clamp(inp.roll, -1, 1) * pmax;
    j.u = norm(rot(u, f, p * dt));
    // FBW G command: stick neutral = 1 g, pull to the limit, push to -3 g
    const pull = clamp(inp.pull, -1, 1);
    // inp.hold (human pilots): neutral stick holds the flight-path angle when banked, like the F-16's flight-path-hold
    const bRaw = Math.sqrt(Math.max(0, 1 - j.f[2] * j.f[2])) / Math.max(0.3, j.u[2]);
    const base = inp.hold ? clamp(1 + (bRaw - 1) * smooth(0.05, 0.4, j.u[2]), 0.3, 3.3) : 1;
    j.nCmd = pull >= 0 ? base + pull * (AC.nMax - base) : base + pull * (base - AC.nMin);
    j.n += (j.nCmd - j.n) * Math.min(1, dt / AC.gLag);
    const na = nAvail(V);
    const n = clamp(j.n, -na * 0.5, na);
    j.nEff = n;
    j.stall = j.nCmd > na + 0.05 || na < 1.15;
    // forces
    const q = 0.5 * rho(j.pos[2]) * V * V;
    const CL = (n * AC.mass * G) / Math.max(1, q * AC.S);
    const cd = AC.cd0 + 0.05 * smooth(300, 380, V) + AC.k * CL * CL + (inp.brake ? AC.cdBrake : 0);
    const D = q * AC.S * cd;
    j.thr = clamp(inp.thr, 0, 1);
    const T = j.fuel > 0 ? thrustOf(j.thr) : 0;
    const ax = (T - D) / AC.mass;
    const acc = add(add(mul(f, ax), mul(j.u, n * G)), [0, 0, -G]);
    j.vel = add(j.vel, mul(acc, dt));
    j.pos = add(j.pos, mul(j.vel, dt));
    V = len(j.vel);
    if (V < 25) { j.vel = mul(norm(j.vel), 25); V = 25; } // keep the point mass well-defined (it is falling anyway)
    const nf = mul(j.vel, 1 / V);
    let nu = sub(j.u, mul(nf, dot(j.u, nf)));
    if (len(nu) < 1e-6) nu = cross(cross(nf, [0, 0, 1]), nf);
    j.f = nf; j.u = norm(nu);
    j.fuel = Math.max(0, j.fuel - burnOf(j.thr) * dt);
    j.g = n; j.speed = V;
    return j;
  }

  // ---------- M61A1-style gun and ballistics ----------
  const GUN = { rate: 100, muzzle: 1030, k: 3.5e-4, life: 2.6, sigma: 0.0022 };
  // distance along the line of fire after t seconds with quadratic drag: dv/dt = -k v^2
  const sAlong = (v0, t) => Math.log(1 + GUN.k * v0 * t) / GUN.k;
  const vAlong = (v0, t) => v0 / (1 + GUN.k * v0 * t);
  // position of a round fired from (o, dir unit, v0) after t seconds (drag along the line + gravity drop)
  function roundPos(o, dir, v0, t) {
    const s = sAlong(v0, t);
    return [o[0] + dir[0] * s, o[1] + dir[1] * s, o[2] + dir[2] * s - 0.5 * G * t * t];
  }
  // the launch state of a round from a given aircraft state
  function launchOf(pos, vel, f) {
    const v = add(vel, mul(f, GUN.muzzle));
    const v0 = len(v);
    return { o: pos.slice(), dir: mul(v, 1 / v0), v0 };
  }

  // ---------- EEGS funnel from own-ship history ----------
  // history: ring of {t, pos, vel, f}; returns points [{tau, p (world), range}] for a set of time-of-flight samples
  function funnel(hist, now, taus) {
    const out = [];
    const cur = hist.last();
    if (!cur) return out;
    for (const tau of taus) {
      const h = hist.at(now - tau);
      if (!h) break;
      const L = launchOf(h.pos, h.vel, h.f);
      const dt = now - h.t; // exact age of the stored sample
      const p = roundPos(L.o, L.dir, L.v0, dt);
      out.push({ tau: dt, p, range: len(sub(p, cur.pos)) });
    }
    return out;
  }
  function History(maxAge) {
    const buf = [];
    return {
      push(t, j) { buf.push({ t, pos: j.pos.slice(), vel: j.vel.slice(), f: j.f.slice() }); while (buf.length && t - buf[0].t > maxAge) buf.shift(); },
      last() { return buf[buf.length - 1]; },
      // the stored sample closest to time t (samples are at sim steps)
      at(t) {
        if (!buf.length || t < buf[0].t - 1e-9) return null;
        let lo = 0, hi = buf.length - 1;
        while (hi - lo > 1) { const m = (lo + hi) >> 1; if (buf[m].t <= t) lo = m; else hi = m; }
        return Math.abs(buf[lo].t - t) <= Math.abs(buf[hi].t - t) ? buf[lo] : buf[hi];
      },
      get length() { return buf.length; },
      clear() { buf.length = 0; }
    };
  }
  const FUNNEL_TAUS = []; for (let i = 0; i <= 26; i++) FUNNEL_TAUS.push(0.06 + i * 0.055);

  // ---------- drones ----------
  const DRONE = {
    piston: { speed: 51, turn: 0.13, climb: 6, span: 2.5, lenM: 3.5, hp: 3, warheadP: 0.65 },
    jet: { speed: 140, turn: 0.22, climb: 14, span: 2.6, lenM: 3.4, hp: 2, warheadP: 0.65 }
  };
  const BLAST_R = 150, DEBRIS_R = 14;

  function makeDrone(id, spec, rand) {
    const T = DRONE[spec.type];
    const r = spec.route;
    const h = Math.atan2(r[1].x - r[0].x, r[1].y - r[0].y);
    return {
      id, type: spec.type, T, pos: [r[0].x, r[0].y, r[0].alt], hdg: h, gam: 0, spd: T.speed, route: r, wp: 1,
      target: spec.target, delay: spec.delay || 0, state: 'wait', hp: T.hp, hits: 0, bank: 0,
      weave: spec.weave || 0, phase: rand() * 6.28, vel: [0, 0, 0], fallV: null, burn: 0
    };
  }

  function stepDrone(d, w, dt) {
    if (d.state === 'wait') { if (w.t >= d.delay) d.state = 'fly'; else return; }
    if (d.state === 'fly' || d.state === 'dive') {
      const T = d.T;
      const goal = d.route[Math.min(d.wp, d.route.length - 1)];
      const dx = goal.x - d.pos[0], dy = goal.y - d.pos[1];
      const dh = Math.hypot(dx, dy);
      const last = d.wp >= d.route.length - 1;
      if (!last && dh < 400) d.wp++;
      let want = Math.atan2(dx, dy);
      if (d.weave && !last) want += Math.sin(w.t * 0.45 + d.phase) * d.weave;
      let e = want - d.hdg; while (e > Math.PI) e -= 2 * Math.PI; while (e < -Math.PI) e += 2 * Math.PI;
      const rate = clamp(e * 0.8, -T.turn, T.turn);
      d.hdg += rate * dt;
      d.bank += (clamp(rate / T.turn, -1, 1) * 0.5 - d.bank) * Math.min(1, dt * 2);
      let altT = last && d.route.length > 1 ? d.route[d.route.length - 2].alt : goal.alt;
      if (d.weave && !last) altT += Math.sin(w.t * 0.31 + d.phase * 1.7) * 60;
      if (last && d.state === 'fly' && dh < Math.max(200, d.pos[2] * 1.6)) d.state = 'dive';
      let vz;
      if (d.state === 'dive') { d.spd = Math.min(d.spd + 6 * dt, T.speed * 1.35); vz = -d.spd * clamp(d.pos[2] / Math.max(dh, 1), 0.2, 0.9); }
      else vz = clamp((altT - d.pos[2]) * 0.25, -T.climb, T.climb);
      const vh = Math.sqrt(Math.max(1, d.spd * d.spd - vz * vz));
      d.vel = [Math.sin(d.hdg) * vh, Math.cos(d.hdg) * vh, vz];
      d.gam = Math.atan2(vz, vh);
      d.pos = add(d.pos, mul(d.vel, dt));
      if (d.pos[2] <= 2) { // impact on the aim point's district
        d.pos[2] = 0; d.state = 'impact';
        const dist = w.districts[d.target];
        if (dist && dist.lit) { dist.lit = false; dist.darkAt = w.t; }
        w.events.push({ type: 'impact', pos: d.pos.slice(), district: d.target });
      }
    } else if (d.state === 'falling') {
      d.fallV[2] -= G * dt; d.fallV = mul(d.fallV, 1 - 0.15 * dt);
      d.vel = d.fallV; d.pos = add(d.pos, mul(d.vel, dt)); d.burn += dt;
      d.gam = Math.atan2(d.vel[2], Math.hypot(d.vel[0], d.vel[1])); d.bank += dt * 2.5;
      if (d.pos[2] <= 0) { d.pos[2] = 0; d.state = 'dead'; w.events.push({ type: 'crash', pos: d.pos.slice() }); }
    }
  }

  // drone body frame (forward, right, up) for hit testing and rendering
  function droneFrame(d) {
    const ch = Math.cos(d.gam);
    const fw = [Math.sin(d.hdg) * ch, Math.cos(d.hdg) * ch, Math.sin(d.gam)];
    let rt = norm(cross(fw, [0, 0, 1]));
    let up = cross(rt, fw);
    // bank
    const c = Math.cos(d.bank), s = Math.sin(d.bank);
    const rt2 = add(mul(rt, c), mul(up, -s)), up2 = add(mul(up, c), mul(rt, s));
    return { fw, rt: rt2, up: up2 };
  }

  // segment (a->b, relative to the drone centre) against the drone's ellipsoid. returns true on hit
  function segHitsDrone(a, b, d) {
    const F = droneFrame(d);
    const ax = [dot(a, F.fw) / (d.T.lenM * 0.5), dot(a, F.rt) / (d.T.span * 0.5), dot(a, F.up) / 0.45];
    const bx = [dot(b, F.fw) / (d.T.lenM * 0.5), dot(b, F.rt) / (d.T.span * 0.5), dot(b, F.up) / 0.45];
    const dv = sub(bx, ax);
    const A = dot(dv, dv), B = 2 * dot(ax, dv), C = dot(ax, ax) - 1;
    if (C <= 0) return true;
    if (A < 1e-12) return false;
    const disc = B * B - 4 * A * C;
    if (disc < 0) return false;
    const t1 = (-B - Math.sqrt(disc)) / (2 * A);
    return t1 >= 0 && t1 <= 1;
  }

  // ---------- missions ----------
  // city at the origin; districts are where drones aim. Routes are lists of {x, y, alt}.
  function cityDistricts() {
    const ds = [{ name: 'Old Town', x: 0, y: 0, r: 1300 }];
    const names = ['Rail Yards', 'Riverside', 'North Works', 'Hospital Hill', 'Airport Road', 'Water Plant', 'University', 'Harbour', 'East Grid'];
    for (let i = 0; i < 9; i++) {
      const a = i / 9 * Math.PI * 2 + 0.3;
      const rr = i % 2 ? 3600 : 2600;
      ds.push({ name: names[i], x: Math.sin(a) * rr, y: Math.cos(a) * rr, r: 900 + (i % 3) * 200 });
    }
    return ds.map((d, i) => Object.assign({ id: i, lit: true, darkAt: -1 }, d));
  }
  function along(from, to, n, alt) { // straight route helper, returns waypoint list
    const out = [];
    for (let i = 0; i <= n; i++) out.push({ x: from.x + (to.x - from.x) * i / n, y: from.y + (to.y - from.y) * i / n, alt });
    return out;
  }

  const NIGHTS = [
    {
      id: 1, name: 'Boresight', sub: 'Dusk. One slow drone, straight and level.', dusk: true, nvg: false,
      fuel: 900, pass: 1,
      coach: [
        'Follow the box. Throttle back: the drone flies at 185 km/h, you stall near 210.',
        'The curved green line is the funnel: where your last 1.5 s of bullets are right now.',
        'The small ring on the funnel is your bullets at the drone's range. Put the drone in the ring.',
        'Up close, the funnel walls are exactly its wingspan apart where it sits: wingtips on the walls.',
        'IN RANGE at 150-700 m. Short bursts. Stay beyond 150 m when it blows.'
      ],
      player: { x: 0, y: 7000, alt: 700, hdg: Math.PI, speed: 130 },
      drones: [{ type: 'piston', target: 0, route: [{ x: 0, y: 5600, alt: 650 }, { x: 0, y: 3000, alt: 650 }, { x: 0, y: 0, alt: 650 }] }]
    },
    {
      id: 2, name: 'First Stream', sub: 'Three piston drones in trail, turning toward the river.', nvg: true, fuel: 1000, pass: 2,
      player: { x: 9000, y: 9000, alt: 800, hdg: -Math.PI * 0.75, speed: 140 },
      drones: [0, 1, 2].map(i => ({
        type: 'piston', target: 2, delay: i * 30,
        route: [{ x: 7200, y: 7600, alt: 600 }, { x: 5200, y: 6400, alt: 600 }, { x: 4200, y: 3600, alt: 600 }, { x: 0, y: 2600, alt: 550 }, cityDistricts()[2]].map((p, k) => ({ x: p.x, y: p.y, alt: k === 4 ? 0 : p.alt }))
      }))
    },
    {
      id: 3, name: 'Low and Slow', sub: 'Three drones at 120 m. Ground, stall, blast: pick two.', nvg: true, fuel: 1000, pass: 2,
      player: { x: -8500, y: 6000, alt: 450, hdg: Math.PI * 0.62, speed: 130 },
      drones: [0, 1, 2].map(i => ({
        type: 'piston', target: [4, 5, 6][i], delay: i * 24,
        route: [{ x: -7600 + i * 300, y: 4800 - i * 500, alt: 120 }, { x: -5200, y: 2400 - i * 900, alt: 110 }].concat([cityDistricts()[[4, 5, 6][i]]].map(p => ({ x: p.x, y: p.y, alt: 0 })))
      }))
    },
    {
      id: 4, name: 'Jet Drones', sub: 'Three jet-powered drones at 500 km/h, weaving. Tail chase.', nvg: true, fuel: 1100, pass: 2,
      player: { x: 2000, y: -15000, alt: 1500, hdg: 0, speed: 190 },
      drones: [0, 1, 2].map(i => ({
        type: 'jet', target: [7, 1, 8][i], delay: i * 16, weave: 0.35,
        route: [{ x: 2600 - i * 800, y: -12500, alt: 1200 }, { x: 1800 - i * 1200, y: -7000, alt: 900 }, { x: 0, y: -3500, alt: 800 }].concat([cityDistricts()[[7, 1, 8][i]]].map(p => ({ x: p.x, y: p.y, alt: 0 })))
      }))
    },
    {
      id: 5, name: 'The Record', sub: 'Ten drones on three axes. 510 rounds, one tank of fuel. Beat nine.', nvg: true, fuel: 700, pass: 3, record: 9,
      player: { x: 1500, y: 16500, alt: 750, hdg: Math.PI * 0.95, speed: 150 },
      drones: (function () {
        const out = [];
        const axes = [
          { from: { x: 2500, y: 13000 }, mid: { x: 1000, y: 7500 }, alt: 600, targets: [3, 0, 1, 9], type: 'piston' },
          { from: { x: 12500, y: 2000 }, mid: { x: 7000, y: 500 }, alt: 300, targets: [2, 4, 0], type: 'piston' },
          { from: { x: -9000, y: 12000 }, mid: { x: -5000, y: 6000 }, alt: 900, targets: [9, 7, 5], type: 'jet' }
        ];
        const ds = cityDistricts();
        const delays = [[0, 26, 52, 78], [40, 70, 100], [95, 125, 150]];
        axes.forEach((ax, a) => ax.targets.forEach((t, i) => out.push({
          type: ax.type, target: t, delay: delays[a][i], weave: ax.type === 'jet' ? 0.3 : 0,
          route: [{ x: ax.from.x, y: ax.from.y, alt: ax.alt }, { x: ax.mid.x, y: ax.mid.y, alt: ax.alt }, { x: ds[t].x, y: ds[t].y, alt: 0 }]
        })));
        return out;
      })()
    }
  ];

  // ---------- world ----------
  function newWorld(nightIdx, opts) {
    opts = opts || {};
    const N = NIGHTS[nightIdx];
    const rand = rng(opts.seed || (1234 + nightIdx * 77));
    const p = N.player;
    const jet = makeJet([p.x, p.y, p.alt], p.hdg, p.speed);
    jet.fuel = N.fuel;
    const w = {
      night: N, idx: nightIdx, t: 0, rand, jet, hist: History(2.0), rounds: [], drones: [], districts: cityDistricts(),
      events: [], fx: [], ammo: 510, fired: 0, hits: 0, kills: 0, fireAcc: 0, over: false, result: null,
      lock: -1, firing: false, dispersion: opts.dispersion === undefined ? GUN.sigma : opts.dispersion
    };
    N.drones.forEach((s, i) => w.drones.push(makeDrone(i, s, rand)));
    w.hist.push(0, jet);
    return w;
  }

  function fireRound(w) {
    const j = w.jet;
    const L = launchOf(j.pos, j.vel, j.f);
    let dir = L.dir;
    if (w.dispersion > 0) {
      const r = cross(dir, j.u);
      dir = norm(add(dir, add(mul(r, gauss(w.rand) * w.dispersion), mul(j.u, gauss(w.rand) * w.dispersion))));
    }
    w.rounds.push({ o: L.o, dir, v0: L.v0, t0: w.t, prev: L.o.slice(), tracer: w.fired % 5 === 0 });
    w.ammo--; w.fired++;
  }

  function kill(w, d) {
    w.kills++;
    const j = w.jet;
    if (w.rand() < d.T.warheadP) {
      d.state = 'dead';
      const dist = len(sub(d.pos, j.pos));
      w.events.push({ type: 'boom', pos: d.pos.slice(), dist });
      w.fx.push({ type: 'fireball', pos: d.pos.slice(), t: w.t, r: 30 });
      if (dist < BLAST_R) {
        const dmg = 75 * Math.pow(1 - dist / BLAST_R, 1.4);
        hurt(w, dmg, 'warhead blast at ' + Math.round(dist) + ' m');
      }
    } else {
      d.state = 'falling';
      d.fallV = add(d.vel, [0, 0, -5]);
      w.events.push({ type: 'kill', pos: d.pos.slice(), dist: len(sub(d.pos, j.pos)) });
    }
  }
  function hurt(w, dmg, why) {
    const j = w.jet;
    j.damage = Math.min(100, j.damage + dmg);
    w.events.push({ type: 'damage', amount: dmg, why });
    if (j.damage >= 100 && !j.dead) { j.dead = true; j.deadWhy = why; }
  }

  // input: {roll, pull, thr, brake, fire}
  function step(w, inp) {
    if (w.over) return;
    const j = w.jet, dt = DT;
    w.t += dt;
    stepJet(j, inp, dt);
    w.hist.push(w.t, j);
    // gun
    w.firing = !!inp.fire && w.ammo > 0 && !j.dead;
    if (w.firing) {
      if (!w.wasFiring) w.fireAcc = Math.max(w.fireAcc, 1 - GUN.rate * dt); // first round on the trigger step
      w.fireAcc += GUN.rate * dt;
      while (w.fireAcc >= 1 && w.ammo > 0) { fireRound(w); w.fireAcc -= 1; }
    } else w.fireAcc = Math.min(w.fireAcc, 0.999);
    w.wasFiring = w.firing;
    // drones
    for (const d of w.drones) stepDrone(d, w, dt);
    // rounds: move and hit-test
    const live = w.drones.filter(d => d.state === 'fly' || d.state === 'dive');
    for (let i = w.rounds.length - 1; i >= 0; i--) {
      const r = w.rounds[i];
      const age = w.t - r.t0;
      const p = roundPos(r.o, r.dir, r.v0, age);
      let hit = false;
      for (const d of live) {
        if (d.state !== 'fly' && d.state !== 'dive') continue;
        const dPrev = sub(d.pos, mul(d.vel, dt));
        if (Math.abs(p[0] - d.pos[0]) > 40 && Math.abs(r.prev[0] - d.pos[0]) > 40) continue;
        if (segHitsDrone(sub(r.prev, dPrev), sub(p, d.pos), d)) {
          hit = true; w.hits++; d.hits++; d.hp--;
          w.events.push({ type: 'hit', pos: p.slice(), dist: len(sub(p, j.pos)) });
          if (d.hp <= 0) kill(w, d);
          break;
        }
      }
      if (hit || age > GUN.life || p[2] < 0) { if (p[2] < 0 && !hit) w.events.push({ type: 'splash', pos: p }); w.rounds.splice(i, 1); }
      else r.prev = p;
    }
    // debris and fireballs
    for (const d of w.drones) {
      if (d.state === 'falling' && len(sub(d.pos, j.pos)) < DEBRIS_R) { d.state = 'dead'; hurt(w, 35, 'flew through debris'); w.events.push({ type: 'debris' }); }
    }
    for (let i = w.fx.length - 1; i >= 0; i--) {
      const fx = w.fx[i];
      if (w.t - fx.t > 1.2) { w.fx.splice(i, 1); continue; }
      if (!fx.touched && len(sub(fx.pos, j.pos)) < fx.r) { fx.touched = true; hurt(w, 30, 'flew through the fireball'); }
    }
    // ground
    if (j.pos[2] <= 3 && !j.dead) { j.dead = true; j.deadWhy = 'flew into the ground'; j.damage = 100; w.events.push({ type: 'ground' }); }
    // lock: nearest live drone ahead-ish
    let best = -1, bs = 1e18;
    for (const d of w.drones) {
      if (d.state !== 'fly' && d.state !== 'dive') continue;
      const rel = sub(d.pos, j.pos), R = len(rel);
      const score = R * (1.6 - dot(rel, j.f) / R);
      if (score < bs) { bs = score; best = d.id; }
    }
    if (w.lock < 0 || !['fly', 'dive'].includes(w.drones[w.lock].state)) w.lock = best;
    else if (best >= 0 && best !== w.lock) {
      const cur = w.drones[w.lock], rc = sub(cur.pos, j.pos), Rc = len(rc);
      const sc = Rc * (1.6 - dot(rc, j.f) / Rc);
      if (bs < sc * 0.55) w.lock = best; // hysteresis
    }
    // end conditions
    const unresolved = w.drones.some(d => ['wait', 'fly', 'dive', 'falling'].includes(d.state));
    if (j.dead) end(w, 'lost');
    else if (j.fuel <= 0) end(w, 'bingo');
    else if (!unresolved && w.rounds.length === 0) end(w, 'clear');
  }

  function end(w, why) {
    // drones still flying when you leave reach their targets
    let through = 0;
    for (const d of w.drones) {
      if (['wait', 'fly', 'dive'].includes(d.state)) {
        d.state = 'impact'; through++;
        const dist = w.districts[d.target]; if (dist.lit) { dist.lit = false; dist.darkAt = w.t; }
      } else if (d.state === 'impact') through++;
    }
    const lit = w.districts.filter(d => d.lit).length;
    const N = w.night;
    const won = why !== 'lost' && w.kills >= N.pass;
    let grade = 'F';
    if (won) {
      const eff = w.kills / Math.max(1, w.drones.length);
      const ammoEff = w.kills / Math.max(1, w.fired / 50); // >1 means better than 50 rounds per kill
      const sc = eff * 0.6 + Math.min(1.2, ammoEff) * 0.25 + (1 - w.jet.damage / 100) * 0.15;
      grade = sc > 0.95 ? 'A' : sc > 0.82 ? 'B' : sc > 0.68 ? 'C' : 'D';
    }
    w.over = true;
    w.result = { why, won, kills: w.kills, total: w.drones.length, through, fired: w.fired, hits: w.hits, ammo: w.ammo, lit, districts: w.districts.length, damage: Math.round(w.jet.damage), grade, deadWhy: w.jet.deadWhy, time: w.t, record: N.record && w.kills > N.record };
  }

  // ---------- flight director / autopilot (used by ?demo and the headless tests) ----------
  // returns stick input that points the velocity vector along dir (unit), with a G limit
  function director(j, dir, gLimit) {
    const V = len(j.vel);
    const f = j.f, r = cross(f, j.u);
    const err = sub(dir, mul(f, dot(dir, f)));
    const behind = dot(dir, f) < 0;
    const e = behind ? norm(err) : err;
    const aDes = add(mul(e, V * (behind ? 3 : 1.6)), [0, 0, G]);
    const aPerp = sub(aDes, mul(f, dot(aDes, f)));
    const au = dot(aPerp, j.u), ar = dot(aPerp, r);
    const pmax = AC.rollMax * clamp(V / 150, 0.35, 1);
    // small corrections with the lift vector roughly right: push/pull without rolling inverted
    let phi;
    if (au < 0 && Math.abs(ar) < -au * 0.6 && -au < 1.6 * G) phi = Math.atan2(-ar, -au) * 0.5;
    else phi = Math.atan2(ar, au);
    const roll = clamp(phi * 4 / pmax, -1, 1);
    const lim = Math.min(gLimit || 7, nAvail(V) * 0.92);
    const nUse = clamp(au / G, -1.5, lim);
    const pull = nUse >= 1 ? (nUse - 1) / (AC.nMax - 1) : (nUse - 1) / (1 - AC.nMin);
    return { roll, pull: clamp(pull, -1, 1) };
  }

  function funnelMiss(w, d, R) {
    const pts = funnel(w.hist, w.t, FUNNEL_TAUS);
    for (let i = 1; i < pts.length; i++) {
      if (pts[i].range >= R) {
        const a = pts[i - 1], b = pts[i], k = (R - a.range) / Math.max(1e-6, b.range - a.range);
        const p = add(a.p, mul(sub(b.p, a.p), k));
        return len(sub(p, d.pos));
      }
    }
    return 1e9;
  }

  function bot(w) {
    const j = w.jet;
    const inp = { roll: 0, pull: 0, thr: 0.7, brake: false, fire: false };
    const d = w.lock >= 0 ? w.drones[w.lock] : null;
    let dir;
    if (!d || !['fly', 'dive'].includes(d.state)) {
      // orbit over the city, wait for the next drone
      const wait = w.drones.find(x => x.state === 'wait');
      const tgt = wait ? [wait.route[0].x, wait.route[0].y, wait.route[0].alt + 150] : [0, 0, 900];
      dir = norm(sub(tgt, j.pos));
      inp.thr = 0.55;
    } else {
      const rel = sub(d.pos, j.pos), R = len(rel);
      // lead: time of flight from the drag law, gravity drop compensation
      const v0 = len(j.vel) + GUN.muzzle;
      const tof = (Math.exp(GUN.k * R) - 1) / (GUN.k * v0);
      const aim = add(add(d.pos, mul(d.vel, tof)), [0, 0, 0.5 * G * tof * tof]);
      // approach from behind: chase a point behind the drone that slides onto it as range closes
      const back = add(sub(aim, mul(norm(d.vel), clamp(R - 450, 0, 700))), [0, 0, -clamp(R - 450, 0, 700) * 0.08]);
      dir = norm(sub(back, j.pos));
      const closV = dot(sub(j.vel, d.vel), norm(rel));
      const wantClose = clamp((R - 330) * 0.06, -8, 70);
      const vMin = bot.vMin;
      const wantV = Math.max(vMin, len(d.vel) + wantClose);
      const V = len(j.vel);
      inp.thr = clamp(0.5 + (wantV - V) * 0.05, 0.05, 0.95);
      inp.brake = V > wantV + 10;
      const ang = Math.acos(clamp(dot(norm(sub(aim, j.pos)), j.f), -1, 1));
      if (bot.useFunnel) {
        // shoot like a pilot: only the funnel is consulted (where earlier rounds are now at the drone's range)
        const m = funnelMiss(w, d, R);
        inp.fire = R > 190 && R < 720 && m < bot.tol && d.state === 'fly';
      } else inp.fire = R > 190 && R < 720 && ang * R < bot.tol && d.state === 'fly';
      if (R < 170) { // break off: too close to the warhead - slide out to the side
        dir = norm(add(j.f, mul(cross(j.f, [0, 0, 1]), 0.5)));
        inp.fire = false;
      }
      // never follow a diving drone into the ground
      const minZ = -clamp((j.pos[2] - 90) / 700, 0, 0.5);
      if (dir[2] < minZ) dir = norm([dir[0], dir[1], minZ]);
      void closV;
    }
    // ground avoidance: look 4 s ahead
    const zAhead = j.pos[2] + Math.min(0, j.vel[2]) * 3.5;
    if (zAhead < 75) {
      const hz = norm([j.f[0], j.f[1], 0]);
      dir = norm(add(hz, [0, 0, clamp((75 - zAhead) / 80, 0.25, 1.5)]));
      inp.fire = false; inp.brake = false; inp.thr = Math.max(inp.thr, 0.85);
    }
    const st = director(j, dir, 6);
    inp.roll = st.roll; inp.pull = st.pull;
    return inp;
  }

  bot.vMin = 62; bot.tol = 2.2; bot.useFunnel = false;

  const NF = {
    G, DT, AC, GUN, DRONE, BLAST_R, NIGHTS, FUNNEL_TAUS,
    v3, add, sub, mul, dot, cross, len, norm, rot, clamp, rng,
    nAvail, thrustOf, makeJet, stepJet, sAlong, vAlong, roundPos, launchOf, funnel, History,
    makeDrone, stepDrone, droneFrame, segHitsDrone, cityDistricts, newWorld, step, end, director, bot
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = NF;
  else root.NF = NF;
})(this);
