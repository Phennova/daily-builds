// node tests/proto.test.js  - core logic tests for LOCAL ONLY
'use strict';
const LO = require('../proto.js');
let fails = 0, checks = 0;
function ok(cond, msg) { checks++; if (!cond) { fails++; console.log('FAIL:', msg); } }

// 1. checksum catalogue check values over "123456789"
const nine = LO.ascii('123456789');
const expect = { CRC8: 0xF4, CRC8M: 0xA1, MODBUS: 0x4B37, CCITT: 0x29B1, XMODEM: 0x31C3, SUM8: 0xDD, XOR8: 0x31, LRC8: 0x23 };
for (const k of Object.keys(expect)) ok(LO.ALGOS[k].fn(nine) === expect[k], `${k} check value ${LO.ALGOS[k].fn(nine).toString(16)}`);

// helpers
const SEEDS = 60;
function pressAll(lab) { for (const b of lab.spec.app) if (!b.premium) lab.appPress(b.id); }
const clone = d => JSON.parse(JSON.stringify(d));

// scripted solutions with the TRUE protocol: list of (lab) => [{cmd, data}] frames
const SOLUTIONS = {
  pads: lab => [{ cmd: lab.spec.cmds.SPEED, data: [4] }],
  timer: lab => [{ cmd: lab.spec.cmds.TIMER, data: LO.u16(90, 'LE') }, { cmd: lab.spec.cmds.TIMER, data: LO.u16(720, 'LE') }],
  lock: lab => [{ cmd: lab.spec.cmds.BOLT, data: [0] }, { cmd: lab.spec.cmds.AUTOLOCK, data: LO.u16(300, 'BE') }],
  thermo: lab => [{ cmd: lab.spec.cmds.MODE, data: [1] }, { cmd: lab.spec.cmds.SETPOINT, data: LO.u16(70, 'BE') }],
  prov: lab => {
    const s = lab.spec, T = s.T, st = lab.state;
    return [{ data: s.tlv([[T.CMD, [2]], [T.SSID, LO.ascii(st.ssid)], [T.PWD, LO.ascii(st.pwd)], [T.CA, LO.ascii(s.home.ca)], [T.CERT, LO.ascii(s.home.cert)], [T.TOKEN, LO.ascii(st.token)]]) }];
  },
};

// alternative dissectors: vary LEN coverage/endianness and CHECK algorithm/coverage/endianness
function alternatives(trueD) {
  const n = trueD.fields.length;
  const out = [];
  const lenIdx = trueD.fields.findIndex(f => f.type === 'LEN');
  const chkIdx = trueD.fields.findIndex(f => f.type === 'CHECK');
  const ranges = [];
  for (let a = 0; a < n; a++) for (let b = a; b < n; b++) ranges.push([a, b]);
  const lenOpts = [];
  for (const [a, b] of ranges) for (const e of (trueD.fields[lenIdx].w === 2 ? ['BE', 'LE'] : ['BE'])) lenOpts.push({ from: a, to: b, endian: e });
  const chkOpts = [];
  for (const algo of LO.ALGO_ORDER) for (const [a, b] of ranges) {
    if (a <= chkIdx && chkIdx <= b) continue;
    for (const e of (LO.ALGOS[algo].w === 2 ? ['BE', 'LE'] : ['BE'])) chkOpts.push({ algo, from: a, to: b, endian: e });
  }
  for (const lo of lenOpts) for (const co of chkOpts) {
    const d = clone(trueD);
    Object.assign(d.fields[lenIdx], lo);
    Object.assign(d.fields[chkIdx], co);
    out.push(d);
  }
  return out;
}

let ambiguous = 0, altTested = 0;
for (let li = 0; li < LO.LEVELS.length; li++) {
  const key = LO.LEVELS[li].key;
  for (let seed = 1; seed <= SEEDS; seed++) {
    // 2. prelude + every app button: the true dissector validates every capture
    const lab = LO.createLab(li, seed * 7919);
    ok(lab.caps.length >= 2, `${key}/${seed}: prelude captures exist`);
    ok(lab.caps.filter(c => c.src !== 'log').every(c => !c.excluded), `${key}/${seed}: app traffic accepted`);
    pressAll(lab);
    const v = LO.validate(lab.spec.proto, lab.caps);
    ok(v.tot.allGood, `${key}/${seed}: true dissector validates all captures ${JSON.stringify(v.tot)}`);
    ok(lab.caps.every(c => c.src === 'log' || !c.excluded), `${key}/${seed}: all app presses accepted`);

    // 3. disambiguation: any alternative that validates all captures forges identical goal frames
    if (seed <= 12) {
      const sol = SOLUTIONS[key](lab);
      for (const d of alternatives(lab.spec.proto)) {
        if (!LO.validate(d, lab.caps).tot.allGood) continue;
        altTested++;
        const same = sol.every(m => {
          const p = { magic: lab.spec.magic, seq: 0x42, cmd: m.cmd, data: m.data };
          return LO.eq(LO.forge(d, p), LO.forge(lab.spec.proto, p));
        });
        if (!same) { ambiguous++; if (ambiguous < 6) console.log('ambiguous', key, seed, JSON.stringify(d.fields)); }
      }
    }

    // 4. scripted solution completes every goal, with zero bad frames
    const lab2 = LO.createLab(li, seed * 7919);
    for (const m of SOLUTIONS[key](lab2)) {
      const bytes = LO.forge(lab2.spec.proto, { magic: lab2.spec.magic, seq: lab2.nextSeq(), cmd: m.cmd, data: m.data });
      const r = lab2.send(bytes);
      ok(r.res.accepted, `${key}/${seed}: solution frame accepted (${r.res.err})`);
    }
    ok(lab2.allDone() && lab2.badFrames === 0, `${key}/${seed}: all goals done`);
    ok(LO.validate(lab2.spec.proto, lab2.caps).tot.allGood, `${key}/${seed}: still validates with player frames`);

    // goals are not satisfiable by app traffic alone
    const lab3 = LO.createLab(li, seed * 7919);
    pressAll(lab3); pressAll(lab3);
    ok(!Object.keys(lab3.goalsDone).length, `${key}/${seed}: app alone cannot finish goals`);
  }
}

// 5. specific behaviours
{
  const li = LO.LEVELS.findIndex(l => l.key === 'lock');
  for (let seed = 1; seed <= 20; seed++) {
    const lab = LO.createLab(li, seed);
    const old = lab.caps.find(c => c.src === 'log' && c.dir === 'tx');
    const r = lab.send(old.bytes.slice());
    ok(!r.res.accepted && r.res.err === 'SEQ', `lock/${seed}: replaying yesterday's unlock is rejected for SEQ`);
    ok(r.rx && LO.parse(lab.spec.proto, r.rx.bytes).cmd === 0xFF, `lock/${seed}: NAK frame`);
    const lockFrame = lab.caps.find(c => c.src === 'app' && c.label === 'Lock');
    ok(lab.send(lockFrame.bytes.slice()).res.err === 'SEQ', `lock/${seed}: replaying today's frame rejected`);
    ok(lab.badFrames === 2 && lab.stars() === 2, `lock/${seed}: bad frame count/stars`);
    ok(lab.appPress('unlock').premium, `lock/${seed}: unlock is premium`);
    // checksum wrong -> CHK; length wrong -> LEN
    const good = LO.forge(lab.spec.proto, { magic: lab.spec.magic, seq: lab.nextSeq(), cmd: lab.spec.cmds.BOLT, data: [0] });
    const bad = good.slice(); bad[bad.length - 1] ^= 1;
    ok(lab.send(bad).res.err === 'CHK', `lock/${seed}: bad checksum`);
  }
}
{
  const li = LO.LEVELS.findIndex(l => l.key === 'thermo');
  for (let seed = 1; seed <= 20; seed++) {
    const lab = LO.createLab(li, seed);
    const key = lab.spec.mac.slice(2);
    ok(LO.eq(key, lab.spec.proto.xorKey), `thermo/${seed}: key = MAC tail`);
    const noKey = clone(lab.spec.proto); noKey.xorKey = null;
    ok(!LO.validate(noKey, lab.caps).tot.allGood, `thermo/${seed}: without the key nothing validates`);
    const bad = LO.forge(noKey, { magic: lab.spec.magic, cmd: lab.spec.cmds.SETPOINT, data: LO.u16(70, 'BE') });
    const r = lab.send(bad);
    ok(!r.res.accepted && !r.rx, `thermo/${seed}: unscrambled frame silently dropped`);
  }
}
{
  const li = LO.LEVELS.findIndex(l => l.key === 'prov');
  const lab = LO.createLab(li, 99);
  const s = lab.spec, T = s.T, st = lab.state;
  const mk = (ca, tok) => LO.forge(s.proto, { magic: s.magic, data: s.tlv([[T.CMD, [2]], [T.SSID, LO.ascii(st.ssid)], [T.PWD, LO.ascii(st.pwd)], [T.CA, LO.ascii(ca)], [T.CERT, LO.ascii(s.home.cert)], [T.TOKEN, LO.ascii(tok)]]) });
  let r = lab.send(mk('http://evil.example/root.pem', st.token));
  ok(!r.res.accepted && r.rx, 'prov: wrong server -> status reply (handled), not accepted');
  ok(lab.state.prov === 'cloud', 'prov: still cloud');
  r = lab.send(mk(s.home.ca, 'deadbeef0000'));
  ok(lab.state.prov === 'cloud', 'prov: bad token does not provision');
  r = lab.send(mk(s.home.ca, st.token));
  ok(lab.state.prov === 'local' && lab.allDone(), 'prov: local provisioning works');
}

console.log(`alternative dissectors that validated: ${altTested}, ambiguous (validate but forge differently): ${ambiguous}`);
ok(ambiguous === 0, 'captures disambiguate every plausible alternative');
console.log(`${checks - fails}/${checks} checks passed`);
process.exit(fails ? 1 : 0);
