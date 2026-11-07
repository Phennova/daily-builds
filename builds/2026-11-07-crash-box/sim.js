/* Crash Box - drivetrain + vehicle simulation (pure logic, no DOM).
   GMC CCKW 2.5-ton 6x6 with a Warner T93 unsynchronised 5-speed ("crash box").
   Units: SI internally (rad/s, N.m, m, m/s). Helpers convert to rpm / mph for display.
   Works as a classic browser script (window.CrashSim) and as a CommonJS module (node tests). */
(function (root) {
  'use strict';

  const TAU = Math.PI * 2;
  const W2RPM = 60 / TAU;          // rad/s -> rpm
  const RPM2W = TAU / 60;          // rpm -> rad/s
  const MPH = 2.23694;             // m/s -> mph
  const YD = 1 / 0.9144;           // m -> yards
  const G = 9.81;

  // Approximate CCKW data (loaded). Transfer case assumed in high range (1:1).
  const TRUCK = {
    mass: 7100,          // kg, ~4.6 t truck + 2.5 t of jerrycans
    r: 0.52,             // m, 7.50-20 tyre rolling radius
    axle: 6.6,           // final drive
    ratios: [0, 6.06, 3.50, 1.80, 1.00, 0.80],
    Ie: 0.9,             // engine + flywheel + clutch cover, kg.m2
    Ii: 0.06,            // clutch disc + input shaft + countershaft cluster
    cdA: 0.9 * 6.0,
    crr: 0.015,
    clutchMax: 540,      // N.m clutch torque capacity fully engaged
    brakeMax: 40000,     // N
    governor: 2750,      // rpm, road-speed governor on the GMC 270
    idle: 600,
    stallRpm: 260,
    overRev: 3400,
  };

  // Full-throttle gross torque of the GMC 270 straight six (approx. 293 N.m at 1400 rpm).
  const TORQUE_PTS = [[0, 110], [400, 185], [800, 245], [1400, 293], [2000, 286], [2750, 262], [3200, 214], [3800, 0]];
  function fullTorque(rpm) {
    if (rpm <= 0) return TORQUE_PTS[0][1];
    for (let i = 1; i < TORQUE_PTS.length; i++) {
      const [r1, t1] = TORQUE_PTS[i];
      if (rpm <= r1) {
        const [r0, t0] = TORQUE_PTS[i - 1];
        return t0 + (t1 - t0) * (rpm - r0) / (r1 - r0);
      }
    }
    return 0;
  }
  // Friction + pumping torque with the throttle shut (engine braking), N.m, always >= 0.
  function friction(rpm) {
    const r = Math.max(0, rpm);
    return 15 + 0.018 * r + 4e-6 * r * r;
  }

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const approach = (v, target, up, down, dt) =>
    v < target ? Math.min(target, v + up * dt) : Math.max(target, v - down * dt);

  // ---------------------------------------------------------------- terrain
  // segments: [[length m, grade %], ...]; grade blends smoothly over 40 m at each joint.
  function buildTerrain(segments) {
    const len = segments.reduce((a, s) => a + s[0], 0);
    const n = Math.ceil(len) + 400;
    const grade = new Float32Array(n);
    const elev = new Float32Array(n);
    const joints = [];
    let x0 = 0;
    for (const [l, g] of segments) { joints.push([x0, x0 + l, g / 100]); x0 += l; }
    const rawGrade = (x) => {
      for (const [a, b, g] of joints) if (x < b) return g;
      return 0; // flat run-out after the finish
    };
    const B = 40;
    for (let i = 0; i < n; i++) {
      // box-blur the piecewise grade for smooth transitions
      let acc = 0, k = 0;
      for (let d = -B / 2; d <= B / 2; d += 4) { acc += rawGrade(i + d); k++; }
      grade[i] = acc / k;
      elev[i] = i === 0 ? 0 : elev[i - 1] + grade[i - 1];
    }
    const sample = (arr, x) => {
      const xi = clamp(x, 0, n - 2);
      const i = Math.floor(xi), f = xi - i;
      return arr[i] * (1 - f) + arr[i + 1] * f;
    };
    return {
      len, n,
      grade: (x) => sample(grade, x),
      elev: (x) => (x < 0 ? x * grade[0] : sample(elev, x)),
    };
  }

  // ---------------------------------------------------------------- missions
  const MISSIONS = [
    {
      id: 'motor-pool', name: 'Motor Pool, Saint-L\u00f4', len: 520, tol: 260, lead: false, night: false, coach: true,
      par: 75, segments: [[520, 0]],
      brief: 'Learn the crash box. Pull away in 1st and double-clutch up through 2nd into 3rd before the gate.',
    },
    {
      id: 'n12', name: 'Route N12', len: 2200, tol: 160, lead: true, night: false,
      segments: [[260, 0], [200, 2], [260, 0], [260, 4.5], [220, -3], [380, 0.5], [240, 3], [380, -1]],
      brief: 'Join the convoy. Up into 4th, hold 60 yards behind the truck ahead, 25 mph max. Downshift for the rise.',
    },
    {
      id: 'grade', name: 'The Long Grade', len: 2400, tol: 140, lead: true, night: false, brakes: true,
      segments: [[260, 0], [180, 3], [380, 7], [300, 9], [160, 1.5], [160, -2], [420, -7], [320, -3], [220, 0]],
      brief: 'A steep climb: 4-3-2 on the way up. Then down the far side in a low gear - ride the brakes and they fade.',
    },
    {
      id: 'blackout', name: 'Blackout Run', len: 2400, tol: 140, lead: true, night: true,
      segments: [[240, 0], [260, 2.5], [220, 5], [240, -2], [300, 0], [260, 4], [200, 6], [260, -4], [420, 0]],
      brief: 'Night. Blackout lights only - the dash is dark. Shift by ear: listen for the revs to meet the gear.',
    },
    {
      id: 'linkage', name: 'Snapped Linkage', len: 2300, tol: 150, lead: true, night: false, breakAt: 170,
      segments: [[300, 0], [260, 1.5], [240, 4], [300, -1.5], [300, 0], [260, 3.5], [240, -3], [400, 0]],
      brief: 'Something in the clutch linkage sounds wrong. If it goes, keep rolling: float the gears with no clutch.',
    },
  ];

  // ---------------------------------------------------------------- simulation
  function createSim(mission, opts) {
    opts = opts || {};
    const m = mission || MISSIONS[1];
    const terrain = buildTerrain(m.segments);
    const s = {
      mission: m, terrain, t: 0,
      x: 0, v: 0,
      we: TRUCK.idle * RPM2W, wi: TRUCK.idle * RPM2W,
      gear: 0, running: true,
      pedal: 0, thr: 0, brake: 0,        // actuator states (pedal 1 = clutch fully down)
      engage: 1, tcl: 0, locked: true,
      tol: (opts.tol || m.tol) * RPM2W,
      health: 100, grind: 0, grindTarget: 0, stuck: false, overrev: false,
      brakeTemp: 20, clutchBroken: false,
      // lead truck
      lead: m.lead ? { x: 55, v: 0 } : null,
      // stats
      stats: { grinds: 0, stalls: 0, clashes: 0, healthLost: 0, bandTime: 0, bandEligible: 0, speeding: 0, shifts: 0 },
      events: [],
      done: false, failed: null, lever: 0,
    };
    return s;
  }

  function engagementFromPedal(p) { return clamp((0.8 - p) / 0.55, 0, 1); }

  function outputW(s) { return (s.v / TRUCK.r) * TRUCK.axle; }  // gearbox output shaft speed (rad/s)
  function gearInputW(s, g) { return outputW(s) * TRUCK.ratios[g]; } // input speed gear g needs at this road speed

  function idleThrottle(rpm) { return clamp((780 - rpm) / 180 * 0.13, 0, 0.45); }

  function engineTorque(s, rpm) {
    if (!s.running) return -(friction(rpm) + 20) * clamp(rpm / 40, 0, 1);
    let thr = Math.max(s.thr, idleThrottle(rpm));
    // governor: shuts the throttle from 2650 to 2850 rpm
    thr *= clamp((TRUCK.governor + 100 - rpm) / 200, 0, 1);
    return thr * fullTorque(rpm) - friction(rpm);
  }

  /* Two inertias joined by a dry clutch. Returns [we, wi, tcl, locked]. */
  function clutchStep(we, wi, Ie, Ii, Te, Ti, Tc, locked, dt) {
    if (locked) {
      const a = (Te + Ti) / (Ie + Ii);
      const tcl = Te - Ie * a;
      if (Math.abs(tcl) <= Tc) {
        const w = wi + a * dt;
        return [w, w, tcl, true];
      }
    }
    const diff = we - wi;
    let dir = Math.sign(diff);
    if (dir === 0) dir = Math.sign(Te / Ie - Ti / Ii) || 1;
    const tcl = dir * Tc;
    const we2 = we + (Te - tcl) / Ie * dt;
    const wi2 = wi + (Ti + tcl) / Ii * dt;
    const diff2 = we2 - wi2;
    if (Tc > 0 && (Math.sign(diff2) !== dir || Math.abs(diff2) < 0.3)) {
      // speeds crossed: lock if the clutch can hold the shared acceleration
      const w = (Ie * we2 + Ii * wi2) / (Ie + Ii);
      const a = (Te + Ti) / (Ie + Ii);
      if (Math.abs(Te - Ie * a) <= Tc) return [w, w, Te - Ie * a, true];
    }
    return [we2, wi2, tcl, false];
  }

  /* input: { clutch 0..1 (1 = pedal down), throttle 0..1, brake 0..1, lever: null|0..5, start: bool } */
  function step(s, input, dt) {
    if (s.done) return s;
    const T = TRUCK, m = s.mission;
    s.t += dt;

    // actuators: pedal goes down fast, comes up at a rate a driver's foot can feather
    const wantClutch = s.clutchBroken ? 0 : clamp(input.clutch || 0, 0, 1);
    const slow = s.pedal > 0.2 && s.pedal < 0.85;
    s.pedal = approach(s.pedal, wantClutch, 9, slow ? 1.5 : 4, dt);
    s.thr = approach(s.thr, clamp(input.throttle || 0, 0, 1), 6, 8, dt);
    s.brake = approach(s.brake, clamp(input.brake || 0, 0, 1), 6, 8, dt);
    if (s.clutchBroken) s.pedal = 0;
    s.engage = engagementFromPedal(s.pedal);
    const Tc = T.clutchMax * Math.pow(s.engage, 1.3);

    if (m.breakAt && !s.clutchBroken && s.x >= m.breakAt) {
      s.clutchBroken = true; s.pedal = 0; s.engage = 1;
      s.events.push({ type: 'linkage' });
    }

    // engine start (starter motor) in neutral or with the clutch down
    if (input.start && !s.running && (s.gear === 0 || s.engage < 0.15)) {
      s.running = true; s.we = Math.max(s.we, 650 * RPM2W);
      if (s.engage > 0.9 && s.gear === 0) s.wi = s.we;
      s.events.push({ type: 'start' });
    }

    // road loads
    const gr = terrain(s).grade(s.x);
    const sin = gr / Math.sqrt(1 + gr * gr), cos = 1 / Math.sqrt(1 + gr * gr);
    const fade = 1 / (1 + Math.max(0, s.brakeTemp - 260) / 140);
    const Fbrake = s.brake * T.brakeMax * fade;
    const Froll = T.crr * T.mass * G * cos;
    const Fgrav = T.mass * G * sin;
    const Faero = 0.5 * 1.2 * T.cdA * s.v * s.v;
    const Ffric = (Froll + Fbrake) * (s.v > 0.02 ? 1 : 0);

    // ---- lever / dog clutch logic
    const req = input.lever;
    s.stuck = false;
    let grindTorque = 0;
    s.grind = 0; s.grindTarget = 0;
    if (req !== null && req !== undefined && req !== s.gear) {
      if (s.gear !== 0) {
        // pull out of gear: only if the dogs are unloaded (clutch down, or throttle feathered)
        if (Math.abs(s.tcl) < 28 || s.engage < 0.05) {
          s.gear = 0; s.events.push({ type: 'pop' });
        } else {
          s.stuck = true;
        }
      }
      if (s.gear === 0 && req > 0) {
        const need = gearInputW(s, req);
        const d = s.wi - need;
        if (Math.abs(d) < s.tol) {
          s.gear = req;
          s.stats.shifts++;
          s.events.push({ type: 'clunk', strength: Math.abs(d) / s.tol, gear: req });
          // snap the input side onto the gear; with the clutch locked the engine snaps with it
          if (s.locked) s.we = need;
          s.wi = need;
        } else {
          // teeth clash: grinding friction drags the free input shaft toward the gear's speed
          s.grind = Math.abs(d) * W2RPM;
          s.grindTarget = req;
          grindTorque = -Math.sign(d) * 9;
          if (!s.grinding) {
            s.stats.grinds++; s.stats.clashes++;
            s.health -= 1.5; s.stats.healthLost += 1.5;
            s.events.push({ type: 'grind', gear: req });
          }
          const dmg = s.grind * dt * 0.006;
          s.health -= dmg; s.stats.healthLost += dmg;
        }
      }
    }
    s.grinding = s.grind > 0;

    // ---- dynamics
    const rpmE = s.we * W2RPM;
    const Te = engineTorque(s, rpmE);
    if (s.gear > 0) {
      const Gr = T.ratios[s.gear] * T.axle;
      const Ieq = T.Ii + (T.mass * T.r * T.r) / (Gr * Gr);
      const Ti = -((Fgrav + Faero + Ffric) * T.r) / Gr;
      const out = clutchStep(s.we, s.wi, T.Ie, Ieq, Te, Ti, Tc, s.locked, dt);
      [s.we, s.wi, s.tcl, s.locked] = out;
      if (s.wi < 0) { s.wi = 0; if (s.locked) s.we = 0; }
      s.v = (s.wi / Gr) * T.r;
    } else {
      const Ti = -(1.5 + 0.004 * s.wi) * Math.sign(s.wi) + grindTorque;
      const out = clutchStep(s.we, s.wi, T.Ie, T.Ii, Te, Ti, Tc, s.locked, dt);
      [s.we, s.wi, s.tcl, s.locked] = out;
      if (Tc === 0) s.tcl = 0;
      if (s.wi < 0 && s.we >= 0 && Tc === 0) s.wi = Math.max(0, s.wi);
      // free-rolling truck
      const Fother = -Fgrav - Faero;
      const Fr = Froll + Fbrake;
      if (s.v > 0.02) s.v += (Fother - Fr) / T.mass * dt;
      else if (Fother > Fr) s.v += (Fother - Fr) / T.mass * dt;
      if (s.v < 0) s.v = 0;
    }
    if (s.we < 0) s.we = 0;

    // ---- engine state
    const rpm = s.we * W2RPM;
    if (s.running && rpm < T.stallRpm) {
      s.running = false; s.stats.stalls++;
      s.events.push({ type: 'stall' });
    } else if (!s.running && rpm > 450 && s.engage > 0.8 && s.gear > 0) {
      s.running = true; s.events.push({ type: 'bumpstart' });   // rolling bump start
    }
    s.overrev = rpm > T.overRev;
    if (s.overrev) { const d = (rpm - T.overRev) * 0.004 * dt; s.health -= d; s.stats.healthLost += d; }

    // brakes heat with the power they absorb, cool with airflow
    s.brakeTemp += (Fbrake * s.v) * dt / 9000 - (s.brakeTemp - 20) * (0.04 + 0.004 * s.v) * dt;

    s.x += s.v * dt;

    // ---- convoy
    if (s.lead) {
      const L = s.lead;
      const lg = terrain(s).grade(L.x + 20);
      let vt = 11.0;
      if (lg > 0.075) vt = 5.0; else if (lg > 0.055) vt = 6.6; else if (lg > 0.035) vt = 8.8;
      if (lg < -0.05) vt = 6.4; else if (lg < -0.025) vt = 9.0;
      if (s.t < 4) vt = 0;
      if (L.x > m.len + 40) vt = 0;
      L.v = approach(L.v, vt, 0.45, 0.9, dt);
      L.x += L.v * dt;
      const gap = L.x - s.x;
      if (s.t > 25 && s.x < m.len) {
        s.stats.bandEligible += dt;
        if (gap >= 27 && gap <= 110) s.stats.bandTime += dt;
      }
      if (gap > 420) { s.done = true; s.failed = 'lost'; }
    }
    if (s.v * MPH > 27.5) s.stats.speeding += dt;

    if (s.health <= 0) { s.health = 0; s.done = true; s.failed = 'gearbox'; }
    if (s.x >= m.len) { s.done = true; }
    return s;
  }
  function terrain(s) { return s.terrain; }

  // ---------------------------------------------------------------- scoring
  function score(s) {
    const st = s.stats, m = s.mission;
    let pts = 1000;
    const lines = [];
    const add = (label, delta) => { if (delta) { pts += delta; lines.push([label, Math.round(delta)]); } };
    add('Grinds (' + st.grinds + ')', -45 * st.grinds);
    add('Gearbox wear', -Math.round(4 * Math.max(0, st.healthLost - 1.5 * st.grinds)));
    add('Stalls (' + st.stalls + ')', -90 * st.stalls);
    if (s.lead && st.bandEligible > 0) {
      const f = st.bandTime / st.bandEligible;
      add('Out of interval (' + Math.round((1 - f) * 100) + '% of the run)', -Math.round(420 * (1 - f)));
    }
    add('Speeding (' + Math.round(st.speeding) + ' s over 27 mph)', -Math.round(12 * st.speeding));
    if (m.par) add('Over par time (' + Math.round(Math.max(0, s.t - m.par)) + ' s)', -Math.round(6 * Math.max(0, s.t - m.par)));
    if (s.failed) pts = Math.min(pts, 200);
    pts = Math.max(0, Math.round(pts));
    const grade = s.failed ? 'F' : pts >= 900 ? 'S' : pts >= 780 ? 'A' : pts >= 620 ? 'B' : pts >= 450 ? 'C' : 'D';
    return { pts, grade, lines };
  }

  // ---------------------------------------------------------------- autopilot
  /* A tidy double-clutcher (or float shifter when the linkage is gone). Used by ?demo and the tests. */
  function createBot() {
    return { phase: 'idle', next: 0, timer: 0, want: 0 };
  }
  function botInput(b, s, dt) {
    const T = TRUCK;
    const inp = { clutch: 0, throttle: 0, brake: 0, lever: null, start: false };
    const rpm = s.we * W2RPM;
    const gr = s.terrain.grade(s.x + 25);
    let vt = 10.6;
    if (s.lead) {
      const gap = s.lead.x - s.x;
      vt = clamp(s.lead.v + (gap - 55) * 0.08, 0, 11.4);
    }
    if (s.mission.len - s.x < 0) vt = 0;
    if (!s.running) { inp.clutch = 1; inp.lever = 0; inp.start = true; b.phase = 'idle'; return inp; }
    b.timer += dt;
    const rpmIn = (g) => gearInputW(s, g) * W2RPM;
    const floatMode = s.clutchBroken;
    if (floatMode && ['cin1', 'neutral', 'cout1', 'match', 'cin2', 'engage', 'cout2'].includes(b.phase)) {
      b.phase = s.gear === 0 ? 'fmatch' : 'idle'; b.timer = 0;
    }

    // pick the gear we want
    const want = () => {
      if (s.gear === 0) return s.v < 1.5 ? 1 : bestGear();
      const r = rpmIn(s.gear);
      const climbing = gr > 0.02;
      if (s.gear < 5 && r > (climbing ? 2500 : 2250) && rpmIn(s.gear + 1) > 1150 && vt > s.v - 0.3) {
        // will the next gear pull on this grade?
        if (!(gr > 0.03) || rpmIn(s.gear + 1) > 1600) return s.gear + 1;
      }
      if (s.gear > 1 && r < (gr > 0.03 ? 1300 : 1000)) return s.gear - 1;
      if (s.gear > 1 && gr < -0.045 && s.gear > 2 && rpmIn(s.gear - 1) < 2600) return s.gear - 1;
      if (s.gear === 5 && gr > 0.005) return 4;
      return s.gear;
    };
    function bestGear() {
      let g = 1;
      for (let k = 1; k <= 4; k++) if (rpmIn(k) > 1250 && rpmIn(k) < 2500) g = k;
      return g;
    }
    // cruise control
    const cruise = () => {
      const err = vt - s.v;
      inp.throttle = clamp(0.35 + err * 0.6 + gr * 6, 0, 1);
      if (err < -1.0) { inp.throttle = 0; inp.brake = clamp(-err * 0.15 - 0.1, 0, 0.6); }
    };

    switch (b.phase) {
      case 'idle': {
        if (s.gear === 0) { b.next = want(); b.phase = floatMode ? 'fmatch' : 'cin2'; b.timer = 0; }
        else {
          cruise();
          const w = want();
          if (w !== s.gear && b.timer > 1.2) { b.next = w; b.phase = floatMode ? 'fout' : 'cin1'; b.timer = 0; }
        }
        break;
      }
      // ---- double clutch
      case 'cin1': inp.clutch = 1; if (s.engage <= 0) { b.phase = 'neutral'; } break;
      case 'neutral': inp.clutch = 1; inp.lever = 0; if (s.gear === 0) b.phase = 'cout1'; break;
      case 'cout1': inp.clutch = 0; inp.lever = 0; if (s.locked && s.engage >= 1) { b.phase = 'match'; b.timer = 0; } break;
      case 'match': {
        inp.lever = 0;
        const target = rpmIn(b.next) + (b.next > s.gear ? 0 : 60);
        inp.throttle = clamp((target - rpm) / 250 + 0.12, 0, 1);
        if (Math.abs(rpm - target) < s.tol * W2RPM * 0.45 || b.timer > 4) b.phase = 'cin2';
        break;
      }
      case 'cin2': {
        inp.clutch = 1; inp.lever = 0;
        const target = rpmIn(b.next);
        inp.throttle = s.engage > 0 ? clamp((target - rpm) / 250 + 0.12, 0, 1) : 0;
        if (s.engage <= 0) { b.phase = 'engage'; b.timer = 0; }
        break;
      }
      case 'engage':
        inp.clutch = 1;
        // wait for the free input shaft to coast onto the gear's speed before pushing the lever
        inp.lever = Math.abs(s.wi - gearInputW(s, b.next)) < s.tol * 0.7 ? b.next : 0;
        if (s.gear === b.next) { b.phase = 'cout2'; b.timer = 0; }
        else if (b.timer > 3) { b.phase = 'idle'; }
        break;
      case 'cout2':
        inp.clutch = 0; inp.lever = null;
        inp.throttle = s.gear === 1 && s.v < 2 ? 0.3 : 0.25;
        if (s.engage >= 1) { b.phase = 'idle'; b.timer = 0; }
        break;
      // ---- float shift (no clutch)
      case 'fout': {
        inp.lever = 0;
        // feather the throttle until the dogs unload
        inp.throttle = clamp(b.timer * 0.5, 0, 0.5);
        if (s.gear === 0) { b.phase = 'fmatch'; b.timer = 0; }
        if (b.timer > 2.5) b.phase = 'idle';
        break;
      }
      case 'fmatch': {
        const target = rpmIn(b.next);
        inp.throttle = clamp((target - rpm) / 250 + 0.12, 0, 1);
        if (Math.abs(rpm - target) < s.tol * W2RPM * 0.4) inp.lever = b.next;
        else inp.lever = 0;
        if (s.gear === b.next) { b.phase = 'idle'; b.timer = 0; }
        if (b.timer > 5) { b.next = Math.max(1, bestGear()); b.timer = 0; }
        break;
      }
    }
    return inp;
  }

  const API = {
    TRUCK, MISSIONS, W2RPM, RPM2W, MPH, YD,
    fullTorque, friction, buildTerrain, createSim, step, score, gearInputW, outputW,
    engagementFromPedal, engineTorque, clutchStep, createBot, botInput,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.CrashSim = API;
})(typeof self !== 'undefined' ? self : this);
