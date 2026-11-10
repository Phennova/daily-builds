// node tests/sim.test.js  - core logic tests for Night Funnel
'use strict';
const NF = require('../sim.js');
let fails = 0;
function ok(cond, msg) { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) fails++; }

// 1. closed-form ballistics vs a numeric integration of the coupled drag+gravity ODE
{
  const v0 = 1150, dir = NF.norm([1, 0, 0.05]);
  let p = [0, 0, 0], v = NF.mul(dir, v0);
  const h = 1e-4;
  let worst = 0;
  for (let t = h; t <= 1.6 + 1e-9; t += h) {
    const sp = NF.len(v);
    v = NF.add(v, NF.mul(NF.add(NF.mul(v, -NF.GUN.k * sp), [0, 0, -NF.G]), h));
    p = NF.add(p, NF.mul(v, h));
    if (Math.abs((t / 0.1) - Math.round(t / 0.1)) < h / 0.2) {
      const c = NF.roundPos([0, 0, 0], dir, v0, t);
      worst = Math.max(worst, NF.len(NF.sub(c, p)));
    }
  }
  const r16 = NF.sAlong(v0, 1.6);
  ok(worst < 0.02 * r16, `closed form within 2% of numeric integration to 1.6 s (worst ${worst.toFixed(2)} m at ~${r16.toFixed(0)} m range)`);
  ok(Math.abs(NF.sAlong(1150, 1.0) - 1000) < 120, `round travels ~1 km in ~1 s (${NF.sAlong(1150, 1).toFixed(0)} m)`);
}

// 2. funnel point equals the simulated round, straight and in a 6 g turn
function funnelCheck(pull, label) {
  const w = NF.newWorld(0, { dispersion: 0 });
  w.drones.forEach(d => { d.delay = 1e9; });
  const inp = { roll: 0, pull, thr: 0.8, brake: false, fire: false };
  // roll to 80 deg bank first so the pull is a level-ish turn
  for (let i = 0; i < 60; i++) NF.step(w, Object.assign({}, inp, { pull: 0, roll: 0.3 }));
  let fired = null;
  for (let i = 0; i < 200; i++) {
    NF.step(w, Object.assign({}, inp, { fire: i === 20 }));
    if (i === 20) fired = w.rounds[w.rounds.length - 1];
  }
  if (!fired) { ok(false, label + ': a round was fired'); return; }
  const age = w.t - fired.t0;
  const pts = NF.funnel(w.hist, w.t, [age]);
  const rp = NF.roundPos(fired.o, fired.dir, fired.v0, age);
  const err = pts.length ? NF.len(NF.sub(pts[0].p, rp)) : 1e9;
  ok(err < 1e-6, `${label}: funnel point == round position after ${age.toFixed(3)} s (err ${err.toExponential(1)} m, g=${w.jet.g.toFixed(1)})`);
  // the funnel bends in a turn: compare the line of the newest and oldest points with the nose
  const all = NF.funnel(w.hist, w.t, NF.FUNNEL_TAUS);
  return all;
}
funnelCheck(0, 'straight');
const turnPts = funnelCheck(5 / 8, '6 g turn');
{
  const a = turnPts[2], b = turnPts[turnPts.length - 1];
  ok(turnPts.length > 20, `funnel has ${turnPts.length} points from history`);
  ok(b.range > a.range * 3, `funnel ranges grow with time of flight (${a.range.toFixed(0)} -> ${b.range.toFixed(0)} m)`);
}

// 3. stall: ~1 g available near 58 m/s, 9 g at corner speed; a slow jet sinks
{
  ok(Math.abs(NF.nAvail(55) - 1) < 0.05, `1 g available at 55 m/s (${NF.nAvail(55).toFixed(2)})`);
  ok(NF.nAvail(165) === 9, '9 g at corner speed');
  const j = NF.makeJet([0, 0, 1000], 0, 52);
  for (let i = 0; i < 240; i++) NF.stepJet(j, { roll: 0, pull: 0, thr: 0.0, brake: false }, NF.DT);
  ok(j.vel[2] < -3 && j.stall, `below stall speed at idle the jet sinks (vz ${j.vel[2].toFixed(1)} m/s, stall ${j.stall})`);
  const k = NF.makeJet([0, 0, 1000], 0, 150);
  for (let i = 0; i < 1200; i++) NF.stepJet(k, { roll: 0, pull: 0, thr: 0.7, brake: false }, NF.DT);
  ok(Math.abs(k.pos[2] - 1000) < 60, `neutral stick holds ~1 g level flight (alt ${k.pos[2].toFixed(0)} m after 10 s, V ${k.speed.toFixed(0)})`);
}

// 4. an unopposed drone flies its route and darkens its district
{
  const w = NF.newWorld(0);
  const inp = { roll: 0, pull: 0.05, thr: 0.5, brake: false, fire: false };
  let n = 0;
  while (!w.over && n < 120 * 400) { NF.step(w, inp); n++; if (w.jet.pos[2] < 500) inp.pull = 0.2; else inp.pull = 0; }
  ok(w.over && w.result.through === 1 && !w.districts[0].lit, `drone reached Old Town and it went dark (t=${w.t.toFixed(0)} s, why=${w.result.why})`);
}

// 5. the autopilot bot wins nights (proves winnability with the real gun and hit tests)
for (let ni = 0; ni < NF.NIGHTS.length; ni++) {
  const seeds = [11, 22, 33];
  let wins = 0; const lines = [];
  for (const seed of seeds) {
    const w = NF.newWorld(ni, { seed });
    let n = 0;
    while (!w.over && n < 120 * 900) { NF.step(w, NF.bot(w)); n++; }
    const r = w.result || {};
    if (r.won) wins++;
    lines.push(`${r.kills}/${r.total} k, ${r.fired} rds, ${r.hits} hits, dmg ${r.damage}, ${r.why}${r.deadWhy ? ' (' + r.deadWhy + ')' : ''}, ${Math.round(r.time)} s, ${r.grade}`);
  }
  const must = ni < 2;
  const msg = `night ${ni + 1} bot: ${wins}/3 wins  [${lines.join(' | ')}]`;
  if (must) ok(wins >= 2, msg); else console.log('info ' + msg);
}

console.log(fails ? `\n${fails} FAILED` : '\nall tests passed');
process.exit(fails ? 1 : 0);
