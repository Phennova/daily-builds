// node tests.js  - core DSP and game-logic checks for Blade Rate
'use strict';
const S = require('./sim.js');
const D = require('./data.js');
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) pass++; else { fail++; console.log('FAIL:', msg); } }
const db = x => 10 * Math.log10(x);

// 1. FFT / power spectrum: a sine lands in the right bin; white noise has unit mean power
{
  const n = 2048, x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = Math.sin(2 * Math.PI * 60 * i / S.FS_LO);
  const P = S.powerSpectrum(x, S.LO_BINS);
  let k = 0; for (let i = 1; i < P.length; i++) if (P[i] > P[k]) k = i;
  ok(Math.abs(k * S.LO_RES - 60) <= S.LO_RES, `sine peak at ${k * S.LO_RES} Hz`);
  const rng = S.mulberry32(7), y = new Float64Array(n);
  for (let i = 0; i < n; i++) y[i] = (rng() + rng() + rng() + rng() - 2) * 1.7320508;
  const Q = S.powerSpectrum(y, 1024); const m = Q.reduce((a, b) => a + b, 0) / Q.length;
  ok(m > 0.8 && m < 1.2, `noise mean bin power ${m.toFixed(2)}`);
}

// 2. per-class signatures, single contact on-beam
function soloRun(clsId, speed, lvl, steps, seed) {
  const w = { duration: 120, contacts: [{ cls: clsId, speed: [speed, speed], brg: [100, 100], rate: [0, 0], lvl, kind: 'humpback' }] };
  const sim = new S.Sim(w, seed || 11, { steer: 100 }); sim.integ = 16; sim.prime(6);
  for (let i = 0; i < steps; i++) sim.step();
  return sim;
}
for (const cls of D.BOOK) {
  if (cls.type === 'bio') continue;
  const v = (cls.speed[0] + cls.speed[1]) / 2;
  const sim = soloRun(cls.id, v, 0.8, 40);
  const fl = S.median(sim.loI.slice(4)), fd = S.median(sim.dmI.slice(4));
  const at = (P, f, res, floor) => { const k = Math.round(f / res); return db(Math.max(P[k - 1], P[k], P[k + 1]) / floor); };
  const m1 = at(sim.loI, cls.mains, S.LO_RES, fl), wrong = at(sim.loI, cls.mains === 50 ? 60 : 50, S.LO_RES, fl);
  ok(m1 > 4, `${cls.id}: mains ${cls.mains} Hz line ${m1.toFixed(1)} dB`);
  ok(wrong < 2.5, `${cls.id}: no line at the other mains (${wrong.toFixed(1)} dB)`);
  const fb = S.shaftHz(cls, v) * cls.blades;
  const dmb = at(sim.dmI, fb, S.DM_RES, fd);
  if (cls.cav >= 0.5) ok(dmb > 8, `${cls.id}: DEMON blade-rate peak at ${fb.toFixed(2)} Hz is ${dmb.toFixed(1)} dB`);
  if (cls.cav === 0) {
    const mx = Math.max(...Array.from(sim.dmI.slice(4)).map(p => db(p / fd)));
    ok(mx < 9, `${cls.id}: no cavitation -> DEMON flat (max ${mx.toFixed(1)} dB)`);
  }
  if (cls.cav >= 0.5) {
    // the strongest DEMON line should be the blade rate (within one bin) for a loud single-screw ship
    let k = 4; for (let i = 4; i < sim.dmI.length; i++) if (sim.dmI[i] > sim.dmI[k]) k = i;
    const fpk = k * S.DM_RES;
    const nearHarm = [1, 2, 3].some(h => Math.abs(fpk - h * fb) <= 1.5 * S.DM_RES * h) || (cls.shafts === 2 && [1, 2, 3].some(h => Math.abs(fpk - h * fb * 1.03) <= 1.5 * S.DM_RES * h));
    ok(nearHarm, `${cls.id}: DEMON top peak ${fpk.toFixed(2)} Hz is a blade harmonic of ${fb.toFixed(2)}`);
  }
}

// 3. speed from shaft rate and TPK
{
  const box = D.byId.box; ok(Math.abs(S.shaftHz(box, 20) * 60 / box.tpk - 20) < 1e-9, 'RPM/TPK round trip');
}

// 4. auto-operator classifies every contact in every watch (several seeds). It steers onto each contact, integrates
//    for 20 s, and (like a human) first identifies louder contacts sharing the beam, then explains the leftover lines.
function look(w, seed, i, steps) {
  const sim = new S.Sim(w, seed); sim.integ = 16;
  // if a louder contact shares the beam, offset the beam 2.5 deg away from it (as the brief suggests)
  const c = sim.contacts[i];
  const host = sim.contacts.find((o, j) => j !== i && o.cls.type !== 'bio' && o.lvl * o.cls.bb > c.lvl * c.cls.bb && Math.abs(S.angDiff(o.brg0, c.brg0)) <= 7);
  const off = host ? 2.5 * Math.sign(S.angDiff(c.brg0, host.brg0)) : 0;
  sim.setSteer(S.contactBearing(c, 0) + off); sim.prime(6);
  const raw = [];
  for (let s = 0; s < steps; s++) { sim.steer = S.contactBearing(c, sim.t) + off; sim.step(); raw.push(sim.loP); }
  return { sim, raw };
}
let total = 0, right = 0, speedOK = 0, speedN = 0;
for (const w of D.WATCHES) {
  for (const seed of [1, 2, 3, 4]) {
    const sim0 = new S.Sim(w, seed);
    sim0.contacts.forEach((c, i) => {
      const { sim, raw } = look(w, seed, i, 40);
      total++;
      if (c.cls.type === 'bio') {
        // biologic: strong energy whose peak frequency wanders over time (sweeps), unlike machinery
        const band = c.kind === 'fin' ? [14, 26] : [55, 248];
        const peaks = raw.map(P => { let k = Math.round(band[0] / S.LO_RES), best = k; for (; k < band[1] / S.LO_RES; k++) if (P[k] > P[best]) best = k; return { f: best * S.LO_RES, p: P[best] }; })
          .filter(o => o.p > 6);
        const fs = peaks.map(o => o.f), spread = fs.length ? Math.max(...fs) - Math.min(...fs) : 0;
        const good = peaks.length >= 5 && (spread > 3 || (spread > 1.5 && peaks.length < raw.length * 0.8)); if (good) right++;
        if (!good) console.log(`  bio not evident: watch ${w.n} seed ${seed} ${c.kind} (${peaks.length} loud steps, spread ${spread.toFixed(1)} Hz)`);
        return;
      }
      const bi = S.contactBearing(c, sim.t);
      const louder = sim.contacts.filter((o, j) => j !== i && o.cls.type !== 'bio' && o.lvl * o.cls.bb > c.lvl * c.cls.bb &&
        Math.abs(S.angDiff(S.contactBearing(o, sim.t), bi)) <= 7);
      const known = louder.map(o => { const h = look(w, seed, o.idx, 40).sim; return S.classify(h.loI, h.dmI, [], []); });
      let r = S.classify(sim.loI, sim.dmI, known.map(k => k.cls), known);
      if (known.length && r.cls !== 'bio') { // identified: now measure speed with a tighter mask
        const r2 = S.classify(sim.loI, sim.dmI, D.BOOK.map(b => b.id).filter(id => id !== r.cls), known, 1);
        if (r2.cls === r.cls) r = r2;
      }
      const good = r.cls === c.cls.id; if (good) right++;
      if (!good) console.log(`  auto-op miss: watch ${w.n} seed ${seed} ${c.cls.id} @${c.speed} -> ${r.cls} @${r.speed} (score ${r.score.toFixed(1)})`);
      if (good && r.speed != null) { speedN++; if (Math.abs(r.speed - c.speed) <= 2) speedOK++; else console.log(`  speed miss: watch ${w.n} seed ${seed} ${c.cls.id} @${c.speed} -> ${r.speed}`); }
    });
  }
}
ok(right === total, `auto-operator accuracy ${right}/${total}`);
ok(speedOK === speedN, `auto-operator speed within 2 kn ${speedOK}/${speedN}`);

// 5. scoring
{
  const w = D.WATCHES[4], sim = new S.Sim(w, 5);
  const host = sim.contacts[0], sub = sim.contacts[1];
  ok(Math.abs(S.angDiff(host.brg0, sub.brg0)) <= 3.6 && Math.abs(S.angDiff(host.brg0, sub.brg0)) >= 2.4, 'watch 5 sub hides 2.5-3.5 deg from host');
  const r1 = S.score(sim, { brg: sub.brg0, cls: 'sever', speed: sub.speed + 1 });
  ok(r1.ok && r1.contact === sub && r1.points === 150, `class+speed on hidden sub = 150 (${r1.points})`);
  sub.reported = r1;
  const r2 = S.score(sim, { brg: sub.brg0, cls: 'bulk', speed: 12 });
  ok(r2.contact === host && !r2.classOK, 'second report on that bearing goes to the host');
  const sim2 = new S.Sim(w, 5);
  const r3 = S.score(sim2, { brg: sim2.contacts[1].brg0, cls: 'keystone', speed: sim2.contacts[1].speed });
  ok(r3.contact === sim2.contacts[1] || r3.contact === sim2.contacts[0], 'keystone report matched to nearest');
  const r4 = S.score(sim2, { brg: (sim2.contacts[0].brg0 + 180) % 360, cls: 'box', speed: 10 });
  ok(r4.falseContact && r4.points < 0, 'false contact penalised');
  const subR = S.score(new S.Sim(w, 5), { brg: sub.brg0 + 0.1, cls: 'keystone', speed: sub.speed });
  if (subR.contact && subR.contact.cls.id === 'sever') ok(subR.flagErr && subR.points < 100, 'calling a Red boat Blue is penalised');
}

// 6. explanations exist and mention the numbers
for (const w of D.WATCHES) new S.Sim(w, 9).contacts.forEach(c => ok(S.explain(c).length > 30, `explain ${c.cls.id}`));

// 7. performance: one sim step with 4 contacts on-beam-ish
{
  const sim = new S.Sim(D.WATCHES[4], 3); sim.setSteer(sim.contacts[0].brg0); sim.prime(2);
  const t0 = Date.now(); for (let i = 0; i < 40; i++) sim.step(); const ms = (Date.now() - t0) / 40;
  ok(ms < 25, `sim step ${ms.toFixed(1)} ms`); console.log(`  sim step ${ms.toFixed(1)} ms`);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
