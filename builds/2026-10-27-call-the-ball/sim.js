/* Call the Ball - flight model, LSO and grading. Pure logic, no DOM. Works in browser and Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Sim = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---- Constants (SI units; deck-relative frame) ----
  // Frame: origin = glideslope hook touchdown point on the landing-area centreline (between 2 and 3 wire).
  // x = along landing-area centreline (+ toward the far end), y = up (deck = 0), z = right.
  var DEG = Math.PI / 180;
  var KT = 0.514444;
  var C = {
    GS: 3.5 * DEG,            // glideslope
    ANGLE_DECK: 9 * DEG,      // landing area angled to port of ship axis
    VA: 140 * KT,             // approach airspeed (on-speed AOA)
    WOD: 25 * KT,             // wind over deck along ship axis
    G: 9.81,
    START_X: -1100,           // ~0.6 nm: start of the groove
    RAMP_X: -40,
    END_X: 185,               // end of the angled deck
    WATER_Y: -20,             // flight deck ~20 m above the sea
    DECK_HALF: 12,            // landing area half-width
    WIRES: [-18, -6, 6, 18],  // wire positions (hook engages the first wire ahead of touchdown)
    CELL: 0.15 * DEG,         // one IFLOLS cell
    TRIM: 0.55,               // throttle that flies the glideslope at nominal closure
    GAIN: 14,                 // m/s of vertical speed per unit thrust
    SPOOL: 0.45,              // engine lag (s)
    VLAG: 1.1,                // vertical speed response lag (s)
    BANK_MAX: 14 * DEG,
    BANK_LAG: 0.35,
    HOOK_EYE: 4.2,            // pilot eye above hook (m)
    EYE_FWD: 6.5              // pilot eye ahead of hook (m)
  };
  C.VY_TRIM = -(C.VA - C.WOD * Math.cos(C.ANGLE_DECK)) * Math.tan(C.GS);

  // ---- Conditions for each pass of the cruise ----
  var LEVELS = [
    { id: 'case1', name: 'Case I - Blue water', tod: 'day', brief: 'Clear day, calm sea, steady 25 kt over the deck. Learn the picture.',
      turb: 0, burble: 0, cross: 0, heave: 0, pitch: 0, startErr: 0.6 },
    { id: 'xwind', name: 'Crosswind', tod: 'day', brief: 'A few knots of crosswind push you off the centreline. Hold your lineup.',
      turb: 0.35, burble: 0.3, cross: 2.6, heave: 0.08, pitch: 0.03, startErr: 1.2 },
    { id: 'chop', name: 'Choppy seas', tod: 'day', brief: 'Gusty air and a moving deck. Burble behind the island will try to settle you at the ramp.',
      turb: 0.7, burble: 0.9, cross: -1.5, heave: 0.18, pitch: 0.08, startErr: 1.6 },
    { id: 'dusk', name: 'Dusk recovery', tod: 'dusk', brief: 'Sun on the horizon, deck in shadow. Trust the ball, not the deck.',
      turb: 0.6, burble: 1.0, cross: 2.0, heave: 0.25, pitch: 0.12, startErr: 1.8 },
    { id: 'case3', name: 'Case III - Night', tod: 'night', brief: 'Black ocean, no horizon. Pitching deck. Only the lights and the ball.',
      turb: 0.8, burble: 1.3, cross: -2.4, heave: 0.35, pitch: 0.16, startErr: 2.0 },
    { id: 'bingo', name: 'Bingo fuel', tod: 'night', brief: 'Last pass. Fuel for one look and a bolter. Make it count.',
      turb: 1.0, burble: 1.5, cross: 2.8, heave: 0.4, pitch: 0.2, startErr: 2.2 }
  ];

  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function gsHeight(x) { return -x * Math.tan(C.GS); }

  function create(level, seed) {
    var r = rng(seed == null ? 1 : seed);
    var L = typeof level === 'number' ? LEVELS[level] : level;
    var errCells = (r() * 2 - 1) * L.startErr;
    var x = C.START_X;
    var y = gsHeight(x) + Math.tan(errCells * C.CELL) * -x;
    var z = (r() * 2 - 1) * (3 + L.startErr * 3);
    var s = {
      L: L, t: 0, x: x, y: y, z: z, vy: C.VY_TRIM, vx: C.VA - C.WOD * Math.cos(C.ANGLE_DECK), vz: 0,
      psi: 0.5 * C.WOD * Math.sin(C.ANGLE_DECK) / C.VA, phi: 0,
      throttle: C.TRIM, thrust: C.TRIM,
      phase: 'groove',     // groove | trapped | bolter | waveoff | crashed
      outcome: null,       // set when the pass is over: {kind, wire, ...}
      done: false,
      waveoffAt: -1, touch: null, wire: 0, crash: '', bolterPower: 0,
      p: [r() * 6.28, r() * 6.28, r() * 6.28, r() * 6.28, r() * 6.28, r() * 6.28],
      samples: [], calls: [], lso: { last: -9, lastCall: '', cond: {}, rogered: false, ballCalled: false },
      events: []           // transient events for the renderer/audio (consumed by caller)
    };
    return s;
  }

  function deckY(s, x, t) {
    var L = s.L, tt = t == null ? s.t : t;
    var heave = L.heave * Math.sin(0.62 * tt + s.p[3]);
    var pitch = L.pitch * DEG * Math.sin(0.55 * tt + s.p[4]);
    return heave + Math.tan(pitch) * (120 - x);
  }

  function turbulence(s) {
    var t = s.t, p = s.p, A = s.L.turb;
    var v = A * (0.55 * Math.sin(1.31 * t + p[0]) + 0.35 * Math.sin(2.73 * t + p[1]) + 0.4 * Math.sin(0.61 * t + p[2]));
    var l = A * (0.5 * Math.sin(0.93 * t + p[5]) + 0.3 * Math.sin(2.21 * t + p[1]));
    return { v: v, l: l };
  }

  function burble(s, x) {
    // downdraft behind the island, strongest ~100 m before touchdown
    if (x < -260 || x > -10) return 0;
    var u = (x + 110) / 90;
    return -s.L.burble * Math.exp(-u * u) * 1.6;
  }

  function ballCells(s) {
    var d = Math.max(Math.hypot(-s.x, s.z), 5);
    return Math.atan2(s.y - gsHeight(s.x), d) / C.CELL;
  }

  function lineupTol(x) { return 1.6 + Math.max(0, -x) * 0.006; }

  function distNm(s) { return Math.max(0, -s.x) / 1852; }

  function pushEvent(s, e) { s.events.push(e); }

  // ---- One physics step ----
  function step(s, dt, input) {
    if (s.done) return s;
    var th = Math.max(0, Math.min(1, input.throttle));
    var bank = Math.max(-1, Math.min(1, input.bank || 0));
    s.throttle = th;
    s.t += dt;
    s.thrust += (th - s.thrust) * Math.min(1, dt / C.SPOOL);

    if (s.phase === 'trapped') {
      s.vx = Math.max(0, s.vx - 30 * dt);
      s.x += s.vx * dt;
      s.y = deckY(s, s.x);
      s.vy = 0;
      if (s.vx <= 0 && s.t - s.touch.t > 2.2) finish(s);
      return s;
    }
    if (s.phase === 'bolter') {
      s.x += s.vx * dt;
      s.y = deckY(s, s.x);
      if (th >= 0.85) s.bolterPower += dt;
      if (s.x >= C.END_X) {
        if (s.bolterPower >= 0.5) { s.phase = 'waveoff'; s.vy = 2; s.flyaway = true; }
        else { crash(s, 'Bolter without power: dribbled off the angle'); }
      }
      return s;
    }

    // Airborne (groove or waveoff)
    var tb = turbulence(s);
    var vyT = C.VY_TRIM + (s.thrust - C.TRIM) * C.GAIN + tb.v + burble(s, s.x);
    s.vy += (vyT - s.vy) * Math.min(1, dt / C.VLAG);
    s.phi += (bank * C.BANK_MAX - s.phi) * Math.min(1, dt / C.BANK_LAG);
    s.psi += C.G * Math.tan(s.phi) / C.VA * dt;
    s.psi = Math.max(-0.2, Math.min(0.2, s.psi));
    s.vx = C.VA * Math.cos(s.psi) - C.WOD * Math.cos(C.ANGLE_DECK);
    s.vz = C.VA * Math.sin(s.psi) - C.WOD * Math.sin(C.ANGLE_DECK) + s.L.cross + tb.l * 0.6;

    var px = s.x, py = s.y;
    s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;

    if (s.phase === 'groove') sample(s);

    // crossing the ramp
    if (px < C.RAMP_X && s.x >= C.RAMP_X && Math.abs(s.z) < 30) {
      var yr = py + (s.y - py) * (C.RAMP_X - px) / (s.x - px);
      if (yr <= deckY(s, C.RAMP_X) + 0.15) { crash(s, 'Ramp strike'); return s; }
    }
    // into the sea
    if (s.y <= C.WATER_Y + 1) { crash(s, 'Flew into the water'); return s; }
    // touchdown
    if (s.x >= C.RAMP_X && s.x <= C.END_X && Math.abs(s.z) < 32 && s.y <= deckY(s, s.x)) {
      touchdown(s);
      return s;
    }
    if (s.x > C.END_X + 40) {
      // passed the ship without landing: wave-off (LSO or own)
      if (!s.outcome) s.outcome = { kind: s.flyaway ? 'bolter' : 'waveoff', ordered: s.waveoffAt >= 0 };
      finish(s);
      return s;
    }
    lsoUpdate(s, dt);
    if (s.waveoffAt >= 0 && s.phase === 'groove') s.phase = 'waveoff';
    return s;
  }

  function sample(s) {
    var b = ballCells(s);
    s.samples.push({ x: s.x, b: b, z: s.z, vy: s.vy, vz: s.vz, thr: s.throttle, vyerr: s.vy - C.VY_TRIM });
  }

  function crash(s, why) {
    s.phase = 'crashed';
    s.crash = why;
    s.outcome = { kind: 'crash', why: why };
    pushEvent(s, { type: 'crash', why: why });
    finish(s);
  }

  function touchdown(s) {
    var sink = s.vy;
    s.touch = { t: s.t, x: s.x, z: s.z, vy: sink, vz: s.vz };
    s.y = deckY(s, s.x);
    if (Math.abs(s.z) > C.DECK_HALF + 2) {
      crash(s, s.z > 0 ? 'Landed right of the landing area, into parked jets' : 'Landed off the left edge of the deck');
      return;
    }
    if (sink < -7.5) { crash(s, 'Hard landing - gear collapsed'); return; }
    var w = 0;
    for (var i = 0; i < C.WIRES.length; i++) if (s.x < C.WIRES[i]) { w = i + 1; break; }
    if (w && sink > -0.8) w = w + 1; // flat, floating touchdown: hook skips a wire
    if (w > 4) w = 0;
    if (s.waveoffAt >= 0) {
      s.outcome = { kind: 'cut', why: 'Landed after a wave-off', wire: w };
    }
    if (w) {
      s.phase = 'trapped'; s.wire = w;
      pushEvent(s, { type: 'trap', wire: w });
      if (!s.outcome) s.outcome = { kind: 'trap', wire: w };
    } else {
      s.phase = 'bolter';
      s.bolterPower = s.throttle >= 0.85 ? 0.1 : 0;
      pushEvent(s, { type: 'bolter' });
      say(s, 'Bolter, bolter, bolter!', 'bolter');
      if (!s.outcome) s.outcome = { kind: 'bolter' };
    }
  }

  function finish(s) {
    if (s.done) return;
    s.done = true;
    s.grade = grade(s);
    pushEvent(s, { type: 'done' });
  }

  // ---- LSO live calls ----
  function say(s, text, key) {
    s.calls.push({ t: s.t, text: text, key: key });
    s.lso.last = s.t; s.lso.lastCall = key;
    pushEvent(s, { type: 'call', text: text, key: key });
  }

  function lsoUpdate(s, dt) {
    var l = s.lso, t = s.t;
    if (!l.ballCalled && t > 1.0) {
      l.ballCalled = true;
      s.calls.push({ t: t, text: '301, Rhino ball, 5.2', key: 'ballcall', pilot: true });
      pushEvent(s, { type: 'call', text: '301, Rhino ball, 5.2', key: 'ballcall', pilot: true });
      return;
    }
    if (l.ballCalled && !l.rogered && t > 2.6) { l.rogered = true; say(s, 'Roger ball.', 'roger'); return; }
    if (!l.rogered || s.phase !== 'groove') return;

    var b = ballCells(s), tol = lineupTol(s.x), x = s.x;
    // wave-off decision (window closes ~0.8 s before the ramp)
    if (x < C.RAMP_X - 30) {
      var wo = '';
      if (b < -3.2 && x > -600) wo = 'low';
      else if (b < -2.2 && x > -180) wo = 'low';
      else if (Math.abs(s.z) > Math.max(9, tol * 3.6) && x > -500) wo = 'lineup';
      else if (b > 4.5 && x > -260) wo = 'high';
      if (wo) {
        s.waveoffAt = t; s.waveoffWhy = wo;
        say(s, 'Wave off, wave off!', 'waveoff');
        return;
      }
    }
    // persistent-condition calls
    var conds = {
      power2: b < -1.6 && x > -700,
      power: b < -0.7 && s.vy < C.VY_TRIM + 0.3,
      high: b > 1.3 && x < -150,
      easy: b > 0.4 && s.vy < C.VY_TRIM - 1.6,
      right: s.z < -tol * 1.3,
      left: s.z > tol * 1.3,
      settle: x > -200 && x < C.RAMP_X && s.vy < C.VY_TRIM - 1.0 && b < 0.3
    };
    var order = ['power2', 'settle', 'power', 'easy', 'right', 'left', 'high'];
    var text = { power2: 'Power! Power!', settle: 'A little power.', power: 'Power.', easy: 'Easy with it.',
      right: 'Right for lineup.', left: 'Come left.', high: "You're high." };
    for (var k in conds) l.cond[k] = conds[k] ? (l.cond[k] || 0) + dt : 0;
    if (t - l.last < 1.5) return;
    for (var i = 0; i < order.length; i++) {
      var key = order[i];
      var need = key === 'power2' || key === 'settle' ? 0.2 : 0.5;
      if (l.cond[key] >= need && !(key === l.lastCall && t - l.last < 3.2)) { say(s, text[key], key); return; }
    }
  }

  // ---- Grading ----
  var PHASES = [
    { id: 'X', name: 'at the start', from: -1200, to: -760, w: 0.5 },
    { id: 'IM', name: 'in the middle', from: -760, to: -380, w: 0.8 },
    { id: 'IC', name: 'in close', from: -380, to: -120, w: 1.2 },
    { id: 'AR', name: 'at the ramp', from: -120, to: -40, w: 1.5 }
  ];
  var SEV_W = [0, 1, 2, 4];
  var SEV_TXT = ['', 'a little ', '', 'very '];

  function sevOf(v, a, b, c) { v = Math.abs(v); return v >= c ? 3 : v >= b ? 2 : v >= a ? 1 : 0; }

  function token(code, sev, phase, text) {
    var s = sev === 1 ? '(' + code + ')' : sev === 3 ? '_' + code + '_' : code;
    return { code: s + (phase || ''), sev: sev, phase: phase, text: text };
  }

  function analyse(s) {
    var out = [];
    PHASES.forEach(function (ph) {
      var S = s.samples.filter(function (q) { return q.x >= ph.from && q.x < ph.to; });
      if (S.length < 3) return;
      var mb = 0, rb = 0, mz = 0, rz = 0, n = S.length, tol = lineupTol((ph.from + ph.to) / 2), mvy = 0;
      S.forEach(function (q) { mb += q.b; rb += q.b * q.b; mz += q.z / tol; rz += (q.z / tol) * (q.z / tol); mvy += q.vyerr; });
      mb /= n; rb = Math.sqrt(rb / n); mz /= n; rz = Math.sqrt(rz / n); mvy /= n;
      // glideslope
      var gs = sevOf(mb, 0.8, 1.6, 3.0);
      if (gs && Math.abs(mb) >= 0.55 * rb) {
        out.push(token(mb > 0 ? 'H' : 'LO', gs, ph.id, SEV_TXT[gs] + (mb > 0 ? 'high ' : 'low ') + ph.name));
      } else if (sevOf(rb, 1.0, 1.8, 3.2)) {
        var o = sevOf(rb, 1.0, 1.8, 3.2);
        out.push(token('OC', o, ph.id, SEV_TXT[o] + 'over-controlled ' + ph.name));
      }
      // lineup
      var lu = sevOf(mz, 1.0, 2.0, 3.5);
      if (lu) out.push(token(mz < 0 ? 'LUL' : 'LUR', lu, ph.id, SEV_TXT[lu] + 'lined up ' + (mz < 0 ? 'left ' : 'right ') + ph.name));
      // settle at the ramp
      if (ph.id === 'AR' && mvy < -1.0) {
        var sd = sevOf(mvy, 1.0, 1.8, 3.0);
        out.push(token('SD', sd, 'AR', SEV_TXT[sd] + 'settled at the ramp'));
      }
    });
    if (s.touch) {
      var tvz = s.touch.vz;
      var d = sevOf(tvz, 0.9, 1.6, 2.6);
      if (d) out.push(token(tvz < 0 ? 'DL' : 'DR', d, 'IW', SEV_TXT[d] + 'drifting ' + (tvz < 0 ? 'left' : 'right') + ' in the wires'));
      if (s.touch.vy < -5.5) out.push(token('TMRD', s.touch.vy < -6.5 ? 3 : 2, 'IW', 'too much rate of descent at touchdown'));
      if (s.touch.vy > -0.8 && s.outcome && s.outcome.kind !== 'crash') out.push(token('F', 2, 'IW', 'flat - floated into the wires'));
    }
    return out;
  }

  var GRADE_INFO = {
    OKU: { sym: 'OK', under: true, pts: 5, name: 'OK (underline)', color: 'okU', desc: 'A perfect pass in hard conditions. Rare.' },
    OK: { sym: 'OK', pts: 4, name: 'OK', color: 'ok', desc: 'Only minor deviations. A good pass.' },
    FAIR: { sym: '(OK)', pts: 3, name: 'Fair', color: 'fair', desc: 'Safe deviations with good corrections. Fleet average.' },
    NG: { sym: '---', pts: 2, name: 'No Grade', color: 'ng', desc: 'Gross but safe deviations.' },
    B: { sym: 'B', pts: 2.5, name: 'Bolter', color: 'bolter', desc: 'Hook missed the wires. Safe, but you go around.' },
    WO: { sym: 'WO', pts: 1, name: 'Wave-off', color: 'wo', desc: 'Unsafe approach, aborted.' },
    C: { sym: 'C', pts: 0, name: 'Cut', color: 'cut', desc: 'Unsafe pass inside the wave-off window.' }
  };

  function grade(s) {
    var tokens = analyse(s);
    var o = s.outcome || { kind: 'waveoff' };
    var key, why = '';
    var pen = 0, ugly = false;
    tokens.forEach(function (tk) {
      var ph = PHASES.filter(function (p) { return p.id === tk.phase; })[0];
      var w = ph ? ph.w : 1.5;
      pen += SEV_W[tk.sev] * w;
      if (tk.sev === 3 && (tk.phase === 'IC' || tk.phase === 'AR' || tk.phase === 'IW')) ugly = true;
    });
    if (o.kind === 'trap') {
      if (o.wire === 1) pen += 2.5;
      else if (o.wire === 2 || o.wire === 4) pen += 0.8;
      if (pen <= 0.8 && o.wire === 3 && LEVELS.indexOf(s.L) >= 3) key = 'OKU';
      else if (pen <= 1.6) key = 'OK';
      else if (pen <= 5.0 && !ugly) key = 'FAIR';
      else key = 'NG';
    } else if (o.kind === 'bolter') { key = 'B'; }
    else if (o.kind === 'waveoff') {
      key = 'WO';
      why = o.ordered ? 'LSO wave-off (' + ({ low: 'low', high: 'high', lineup: 'lineup' }[s.waveoffWhy] || 'unsafe') + ')' : 'Own wave-off';
    } else if (o.kind === 'cut') { key = 'C'; why = o.why; }
    else { key = 'C'; why = o.why; }
    var g = GRADE_INFO[key];
    var parts = tokens.map(function (t) { return t.code; });
    var wireTxt = o.kind === 'trap' ? '#' + o.wire : o.kind === 'bolter' ? 'B' : o.kind === 'waveoff' ? 'WO' : (o.wire ? '#' + o.wire : '');
    return {
      key: key, sym: g.sym, under: !!g.under, pts: g.pts, name: g.name, color: g.color, desc: g.desc,
      tokens: tokens, wire: o.kind === 'trap' ? o.wire : 0, why: why, penalty: Math.round(pen * 10) / 10,
      shorthand: (g.under ? '_OK_' : g.sym) + '  ' + parts.join(' ') + (wireTxt ? '  ' + wireTxt : '')
    };
  }

  // ---- Autopilot (used for the attract/demo mode and tests) ----
  function autopilot(s, skill) {
    skill = skill == null ? 1 : skill;
    if (s.phase === 'waveoff' || s.phase === 'bolter') return { throttle: 1, bank: 0 };
    if (s.phase === 'trapped') return { throttle: 0.2, bank: 0 };
    var e = s.y - gsHeight(s.x);
    var vyDes = -s.vx * Math.tan(C.GS) - 0.7 * e;
    var thr = C.TRIM + (vyDes - C.VY_TRIM) / C.GAIN + 0.18 * (vyDes - s.vy) - burble(s, s.x + s.vx * 1.0) / C.GAIN * skill;
    var vzDes = Math.max(-3, Math.min(3, -0.45 * s.z));
    var psiDes = Math.asin(Math.max(-0.2, Math.min(0.2, (vzDes + C.WOD * Math.sin(C.ANGLE_DECK) - s.L.cross) / C.VA)));
    var bank = Math.max(-1, Math.min(1, ((psiDes - s.psi) * 9 - s.phi * 1.2) / C.BANK_MAX * 0.25));
    return { throttle: Math.max(0, Math.min(1, thr)), bank: bank };
  }

  function runPass(level, seed, controller, dt) {
    var s = create(level, seed);
    dt = dt || 1 / 60;
    var n = 0;
    while (!s.done && n < 60 * 90) { step(s, dt, controller(s)); s.events.length = 0; n++; }
    return s;
  }

  return {
    C: C, LEVELS: LEVELS, PHASES: PHASES, GRADE_INFO: GRADE_INFO, DEG: DEG,
    create: create, step: step, deckY: deckY, gsHeight: gsHeight, ballCells: ballCells, lineupTol: lineupTol,
    distNm: distNm, grade: grade, analyse: analyse, autopilot: autopilot, runPass: runPass, rng: rng
  };
});
