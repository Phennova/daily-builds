// quick physics probe (not the test suite)
const S = require('../sim.js');
const dt = 1 / 120;
const rpm = (s) => Math.round(s.we * S.W2RPM);

// free rev in neutral
let s = S.createSim(S.MISSIONS[1]);
for (let i = 0; i < 120; i++) S.step(s, { throttle: 0 }, dt);
console.log('idle rpm', rpm(s));
let t0 = s.t;
while (rpm(s) < 2500 && s.t - t0 < 5) S.step(s, { throttle: 1 }, dt);
console.log('free rev 600->2500 s', (s.t - t0).toFixed(2), 'rpm', rpm(s));
t0 = s.t;
while (rpm(s) > 1200 && s.t - t0 < 10) S.step(s, { throttle: 0 }, dt);
console.log('decay 2500->1200 s', (s.t - t0).toFixed(2));
for (let i = 0; i < 240; i++) S.step(s, { throttle: 0 }, dt);
console.log('settle', rpm(s));

// bot through every mission
for (const m of S.MISSIONS) {
  const s = S.createSim(m);
  const b = S.createBot();
  let maxMph = 0, log = [];
  let lastGear = 0;
  while (!s.done && s.t < 600) {
    const inp = S.botInput(b, s, dt);
    S.step(s, inp, dt);
    maxMph = Math.max(maxMph, s.v * S.MPH);
    if (s.gear !== lastGear) { log.push(`${s.t.toFixed(1)}s x${Math.round(s.x)} g${s.gear}`); lastGear = s.gear; }
    for (const e of s.events) if (e.type !== 'clunk' && e.type !== 'pop') log.push(`${s.t.toFixed(1)}s ${e.type}`);
    s.events.length = 0;
  }
  const sc = S.score(s);
  console.log(`\n${m.id}: t=${s.t.toFixed(0)} done=${s.done} failed=${s.failed} health=${s.health.toFixed(1)} maxMph=${maxMph.toFixed(1)} grade=${sc.grade} pts=${sc.pts}`);
  console.log(JSON.stringify(s.stats));
  console.log(log.slice(0, 60).join(' | '));
}
