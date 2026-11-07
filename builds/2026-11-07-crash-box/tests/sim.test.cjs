// Crash Box - drivetrain tests. Run: node tests/sim.test.cjs
const S = require('../sim.js');
const dt = 1 / 120;
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.log('FAIL:', msg); } }
const rpm = (w) => w * S.W2RPM;
function run(s, inp, secs, until) {
  const n = Math.round(secs / dt);
  for (let i = 0; i < n; i++) { S.step(s, typeof inp === 'function' ? inp(s) : inp, dt); if (until && until(s)) return true; }
  return false;
}
const flat = { id: 't', name: 'flat', len: 5000, tol: 140, lead: false, segments: [[5000, 0]] };

// engine idles and free-revs at sane rates
{
  const s = S.createSim(flat);
  run(s, {}, 2);
  ok(Math.abs(rpm(s.we) - 600) < 60, 'idle near 600 rpm, got ' + rpm(s.we));
  const t0 = s.t; run(s, { throttle: 1 }, 5, (s) => rpm(s.we) > 2500);
  const up = s.t - t0;
  ok(up > 0.5 && up < 2, 'free rev 600->2500 in 0.5-2 s, got ' + up.toFixed(2));
  run(s, { throttle: 1 }, 2);
  ok(rpm(s.we) < 2900, 'governor holds below 2900, got ' + rpm(s.we));
  const t1 = s.t; run(s, {}, 6, (s) => rpm(s.we) < 1200);
  const down = s.t - t1;
  ok(down > 0.8 && down < 3.5, 'decay 2750->1200 in 0.8-3.5 s, got ' + down.toFixed(2));
}

// pulling away: 1st only meshes once the free input shaft has spun down
{
  const s = S.createSim(flat);
  run(s, { clutch: 1 }, 0.3);
  ok(s.engage === 0, 'pedal down disengages');
  S.step(s, { clutch: 1, lever: 1 }, dt);
  ok(s.gear === 0 && s.grind > 0, 'selecting 1st with the shaft spinning grinds');
  const healthAfterClash = s.health;
  ok(healthAfterClash < 100, 'clash costs gearbox health');
  const s2 = S.createSim(flat);
  run(s2, { clutch: 1 }, 3);
  ok(rpm(s2.wi) < 140, 'input shaft spins down with the clutch down, got ' + rpm(s2.wi));
  S.step(s2, { clutch: 1, lever: 1 }, dt);
  ok(s2.gear === 1 && s2.stats.grinds === 0, 'then 1st goes in clean');
  run(s2, { clutch: 0, throttle: 0.6 }, 4);
  ok(s2.running && s2.v > 2, 'pulls away without stalling, v=' + s2.v.toFixed(2));
  ok(s2.locked, 'clutch locks up after the launch');
}

// dumping the clutch in 4th from a standstill stalls
{
  const s = S.createSim(flat);
  run(s, { clutch: 1 }, 3);
  // cheat 4th in at zero speed (input shaft stopped, 4th needs 0 rpm too)
  S.step(s, { clutch: 1, lever: 4 }, dt);
  ok(s.gear === 4, '4th engages at rest');
  run(s, { clutch: 0 }, 3);
  ok(!s.running && s.stats.stalls === 1, 'dumping the clutch in 4th stalls');
  S.step(s, { clutch: 1, start: true }, dt); run(s, { clutch: 1 }, 0.3);
  S.step(s, { clutch: 1, start: true }, dt);
  ok(s.running, 'restart with the clutch down');
}

// helper: drive in a gear at a given speed, steady
function cruiseIn(g, v) {
  const s = S.createSim(flat);
  s.v = v; s.gear = g; s.wi = S.gearInputW(s, g); s.we = s.wi; s.locked = true;
  return s;
}

// double-clutch upshift 3 -> 4 succeeds without grinding; single-clutch quick shift grinds
{
  const s = cruiseIn(3, 10); // ~22 mph, 3rd at ~2180 rpm
  run(s, { clutch: 1 }, 0.25);
  S.step(s, { clutch: 1, lever: 0 }, dt);
  ok(s.gear === 0, 'clutch in: lever comes out to neutral');
  run(s, { clutch: 0, lever: 0 }, 0.4);
  const need4 = rpm(S.gearInputW(s, 4));
  run(s, { clutch: 0, lever: 0 }, 4, (s) => Math.abs(rpm(s.wi) - rpm(S.gearInputW(s, 4))) < 50);
  ok(Math.abs(rpm(s.wi) - rpm(S.gearInputW(s, 4))) < 60, 'clutch out in neutral: engine drags the shaft down to 4th speed (~' + Math.round(need4) + ')');
  run(s, { clutch: 1 }, 0.25);
  S.step(s, { clutch: 1, lever: 4 }, dt);
  ok(s.gear === 4 && s.stats.grinds === 0, 'double-clutched into 4th with no grind');

  const q = cruiseIn(3, 10);
  run(q, { clutch: 1 }, 0.25);
  S.step(q, { clutch: 1, lever: 0 }, dt);
  S.step(q, { clutch: 1, lever: 4 }, dt);
  ok(q.gear === 0 && q.stats.grinds === 1, 'snatching 4th straight away grinds');
  // holding it there grinds it in (free shaft, clutch down) but costs health
  run(q, { clutch: 1, lever: 4 }, 3, (q) => q.gear === 4);
  ok(q.gear === 4, 'grinding it in eventually meshes');
  ok(q.health < 97, 'grinding it in costs health, health=' + q.health.toFixed(1));
}

// double-clutch downshift 4 -> 3 needs a blip
{
  const s = cruiseIn(4, 9);
  run(s, { clutch: 1 }, 0.25);
  S.step(s, { clutch: 1, lever: 0 }, dt);
  run(s, { clutch: 0, lever: 0 }, 0.3);
  const target = () => rpm(S.gearInputW(s, 3));
  run(s, (s) => ({ clutch: 0, lever: 0, throttle: rpm(s.we) < target() ? 0.8 : 0 }), 3, (s) => Math.abs(rpm(s.we) - target()) < 40);
  run(s, { clutch: 1, lever: 0 }, 0.25);
  S.step(s, { clutch: 1, lever: 3 }, dt);
  ok(s.gear === 3 && s.stats.grinds === 0, 'blip-matched downshift into 3rd is clean');
  const n = cruiseIn(4, 9);
  run(n, { clutch: 1 }, 0.25);
  S.step(n, { clutch: 1, lever: 0 }, dt);
  S.step(n, { clutch: 1, lever: 3 }, dt);
  ok(n.gear === 0 && n.grind > 0, 'downshift without a blip grinds');
}

// lever will not come out of gear under load with the clutch engaged; feathered throttle unloads it (float)
{
  const s = cruiseIn(4, 10);
  run(s, { throttle: 1 }, 0.5);
  S.step(s, { throttle: 1, lever: 0 }, dt);
  ok(s.gear === 4 && s.stuck, 'loaded dogs: lever stuck in 4th');
  let popped = false;
  for (let i = 0; i < 400 && !popped; i++) {
    const thr = Math.min(1, (i / 400) * 0.6);
    S.step(s, { throttle: thr, lever: 0 }, dt);
    popped = s.gear === 0;
  }
  ok(popped, 'sweeping the throttle finds the unloaded point and the lever floats out');
  // float into 3rd: match revs with the clutch still engaged
  const target = () => rpm(S.gearInputW(s, 3));
  run(s, (s) => ({ lever: 0, throttle: rpm(s.we) < target() ? 0.9 : 0 }), 3, (s) => Math.abs(rpm(s.we) - target()) < 50);
  S.step(s, { lever: 3 }, dt);
  ok(s.gear === 3 && s.stats.grinds === 0, 'clutchless float shift into 3rd');
}

// top speed / gearing sanity on the flat
{
  const tops = [];
  for (const g of [1, 2, 3, 4]) {
    const s = cruiseIn(g, [0, 2, 3, 5, 9][g]);
    run(s, { throttle: 1 }, 60);
    tops.push(s.v * S.MPH);
  }
  ok(tops[0] > 6 && tops[0] < 10, '1st tops out ~8 mph, got ' + tops[0].toFixed(1));
  ok(tops[2] > 22 && tops[2] < 30, '3rd tops out ~27 mph, got ' + tops[2].toFixed(1));
  ok(tops[3] > 33, '4th goes past 33 mph, got ' + tops[3].toFixed(1));
}

// over-rev damage on a forced downshift
{
  const s = cruiseIn(4, 15);
  s.gear = 2; s.wi = S.gearInputW(s, 2); s.we = s.wi;
  run(s, {}, 1);
  ok(s.overrev && s.health < 100, 'over-revving costs health');
}

// brakes fade when ridden
{
  const m = { id: 'b', name: 'down', len: 3000, tol: 140, lead: false, segments: [[3000, -7]] };
  const s = S.createSim(m); s.v = 8;
  run(s, (s) => ({ brake: s.v > 8 ? 0.6 : 0 }), 60);
  ok(s.brakeTemp > 260, 'riding the brakes downhill heats them past fade, T=' + s.brakeTemp.toFixed(0));
}

// the autopilot completes every run cleanly (proves each run is finishable with good technique)
for (const m of S.MISSIONS) {
  const s = S.createSim(m), b = S.createBot();
  while (!s.done && s.t < 900) S.step(s, S.botInput(b, s, dt), dt);
  const sc = S.score(s);
  ok(s.done && !s.failed, `bot finishes ${m.id}`);
  ok(s.stats.grinds === 0 && s.stats.stalls === 0, `bot drives ${m.id} without grinds or stalls`);
  ok(sc.grade === 'S' || sc.grade === 'A', `bot grades S/A on ${m.id}, got ${sc.grade} ${sc.pts}`);
}

// a do-nothing driver gets left behind and fails
{
  const s = S.createSim(S.MISSIONS[1]);
  run(s, {}, 120, (s) => s.done);
  ok(s.failed === 'lost', 'idle driver loses the convoy');
  ok(S.score(s).grade === 'F', 'and grades F');
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
