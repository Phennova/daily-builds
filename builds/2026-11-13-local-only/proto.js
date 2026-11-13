// LOCAL ONLY - pure protocol core (no DOM). Browser: window.LO, node: require('./proto.js').
// Fictional AirLux devices, their true wire protocols, a generic field-based dissector engine (used both for
// the true protocols and the player's guesses), checksums, captures and device models.
(function (root) {
  'use strict';

  // ---------- utils ----------
  function rng(seed) {                       // mulberry32
    let a = seed >>> 0;
    const f = function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    f.int = (lo, hi) => lo + Math.floor(f() * (hi - lo + 1));
    f.pick = arr => arr[Math.floor(f() * arr.length)];
    return f;
  }
  const hex2 = b => (b & 0xFF).toString(16).toUpperCase().padStart(2, '0');
  const toHex = (bytes, sep = ' ') => Array.from(bytes, hex2).join(sep);
  function parseHex(str) {
    const s = String(str).replace(/0x/gi, '').replace(/[\s,:;\-]/g, '');
    if (s.length % 2 || /[^0-9a-f]/i.test(s)) return null;
    const out = [];
    for (let i = 0; i < s.length; i += 2) out.push(parseInt(s.substr(i, 2), 16));
    return out;
  }
  const ascii = str => Array.from(str, c => c.charCodeAt(0) & 0xFF);
  const fromAscii = bytes => String.fromCharCode.apply(null, bytes);
  const u16 = (v, endian) => endian === 'LE' ? [v & 0xFF, (v >> 8) & 0xFF] : [(v >> 8) & 0xFF, v & 0xFF];
  function readUint(bytes, endian) {
    let v = 0;
    if (endian === 'LE') for (let i = bytes.length - 1; i >= 0; i--) v = v * 256 + bytes[i];
    else for (let i = 0; i < bytes.length; i++) v = v * 256 + bytes[i];
    return v;
  }
  function writeUint(v, w, endian) {
    const out = [];
    for (let i = 0; i < w; i++) out.push(Math.floor(v / Math.pow(256, i)) & 0xFF); // LE
    return endian === 'LE' ? out : out.reverse();
  }
  const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

  // ---------- checksums ----------
  function crc8(bytes, poly) {
    let c = 0;
    for (const b of bytes) { c ^= b; for (let i = 0; i < 8; i++) c = (c & 0x80) ? ((c << 1) ^ poly) & 0xFF : (c << 1) & 0xFF; }
    return c;
  }
  function crc8r(bytes, rpoly) {
    let c = 0;
    for (const b of bytes) { c ^= b; for (let i = 0; i < 8; i++) c = (c & 1) ? (c >>> 1) ^ rpoly : c >>> 1; }
    return c;
  }
  function crc16(bytes, init) {             // poly 0x1021, MSB first, no reflection
    let c = init;
    for (const b of bytes) { c ^= b << 8; for (let i = 0; i < 8; i++) c = (c & 0x8000) ? ((c << 1) ^ 0x1021) & 0xFFFF : (c << 1) & 0xFFFF; }
    return c;
  }
  function crc16r(bytes, init, rpoly) {
    let c = init;
    for (const b of bytes) { c ^= b; for (let i = 0; i < 8; i++) c = (c & 1) ? (c >>> 1) ^ rpoly : c >>> 1; }
    return c;
  }
  const ALGOS = {
    SUM8: { w: 1, name: 'SUM-8', note: 'add all bytes, keep the low 8 bits', fn: b => b.reduce((s, x) => s + x, 0) & 0xFF },
    LRC8: { w: 1, name: 'LRC-8', note: 'two\'s complement of the sum: the whole range then adds up to 00', fn: b => (-b.reduce((s, x) => s + x, 0)) & 0xFF },
    XOR8: { w: 1, name: 'XOR-8', note: 'XOR of all bytes', fn: b => b.reduce((s, x) => s ^ x, 0) },
    CRC8: { w: 1, name: 'CRC-8', note: 'poly 07, init 00 (SMBus)', fn: b => crc8(b, 0x07) },
    CRC8M: { w: 1, name: 'CRC-8/MAXIM', note: 'poly 31 reflected, init 00 (1-Wire)', fn: b => crc8r(b, 0x8C) },
    MODBUS: { w: 2, name: 'CRC-16/MODBUS', note: 'poly 8005 reflected, init FFFF; sent low byte first', fn: b => crc16r(b, 0xFFFF, 0xA001) },
    CCITT: { w: 2, name: 'CRC-16/CCITT-FALSE', note: 'poly 1021, init FFFF', fn: b => crc16(b, 0xFFFF) },
    XMODEM: { w: 2, name: 'CRC-16/XMODEM', note: 'poly 1021, init 0000', fn: b => crc16(b, 0x0000) },
  };
  const ALGO_ORDER = ['SUM8', 'LRC8', 'XOR8', 'CRC8', 'CRC8M', 'MODBUS', 'CCITT', 'XMODEM'];

  // ---------- dissector engine ----------
  // dissector = { fields: [ {type, w, endian, from, to, algo} ], xorKey: [bytes] | null }
  // types: MAGIC (w 1..4), LEN (w 1|2, endian, from..to field indexes inclusive), SEQ (1), CMD (1),
  //        DATA (variable, at most one), CHECK (w from algo, endian, from..to).
  const TYPES = ['MAGIC', 'LEN', 'SEQ', 'CMD', 'DATA', 'CHECK'];
  function fieldWidth(f) {
    if (f.type === 'DATA') return 0;
    if (f.type === 'CHECK') return (ALGOS[f.algo] || ALGOS.SUM8).w;
    if (f.type === 'SEQ' || f.type === 'CMD') return 1;
    return Math.max(1, f.w | 0);
  }
  function problems(d) {                    // structural problems in a dissector (for the UI)
    const out = [];
    const fs = d.fields;
    if (!fs.length) out.push('no fields yet');
    if (fs.filter(f => f.type === 'DATA').length > 1) out.push('only one DATA field can have a variable length');
    fs.forEach((f, i) => {
      if (f.type === 'LEN' || f.type === 'CHECK') {
        if (f.type === 'LEN' && f.from >= fs.length && f.from === i + 1) out.push(`field ${i + 1} (LEN) counts the fields after it: add them next`);
        else if (!(f.from >= 0 && f.to >= f.from && f.to < fs.length)) out.push(`field ${i + 1} (${f.type}) covers an invalid range`);
        else if (f.type === 'CHECK' && f.from <= i && i <= f.to) out.push(`field ${i + 1}: a checksum cannot cover itself`);
      }
    });
    return out;
  }
  function xorStart(d) { return d.fields.length && d.fields[0].type === 'MAGIC' ? fieldWidth(d.fields[0]) : 0; }
  function applyXor(bytes, key, start) {
    if (!key || !key.length) return bytes.slice();
    return bytes.map((b, i) => i < start ? b : b ^ key[(i - start) % key.length]);
  }
  // Lay the fields over a frame. Returns null if they cannot fit.
  function layout(d, n) {
    const fs = d.fields;
    const di = fs.findIndex(f => f.type === 'DATA');
    const ws = fs.map(fieldWidth);
    const fixed = ws.reduce((a, b) => a + b, 0);
    if (di < 0) { if (fixed !== n) return null; }
    else if (fixed > n) return null;
    if (fs.filter(f => f.type === 'DATA').length > 1) return null;
    const spans = [];
    let p = 0;
    for (let i = 0; i < fs.length; i++) {
      const w = i === di ? n - fixed : ws[i];
      spans.push({ start: p, end: p + w });
      p += w;
    }
    return spans;
  }
  function rangeBytes(bytes, spans, from, to) {
    if (!(from >= 0 && to >= from && to < spans.length)) return null;
    return bytes.slice(spans[from].start, spans[to].end);
  }
  // Parse one frame with a dissector: spans, decoded values, per-field verdicts (len/chk true/false/null).
  function parse(d, raw) {
    const bytes = applyXor(raw, d.xorKey, xorStart(d));
    const spans = layout(d, bytes.length);
    const res = { bytes, spans, fit: !!spans, values: [], len: null, chk: null, magic: null, seq: null, cmd: null, data: null };
    if (!spans || problems(d).length) { res.fit = false; return res; }
    d.fields.forEach((f, i) => {
      const fb = bytes.slice(spans[i].start, spans[i].end);
      let v = fb;
      if (f.type === 'LEN' || f.type === 'CHECK') v = readUint(fb, f.endian || 'BE');
      if (f.type === 'SEQ' || f.type === 'CMD') v = fb[0];
      res.values.push(v);
      if (f.type === 'LEN') {
        const cover = rangeBytes(bytes, spans, f.from, f.to);
        const ok = cover !== null && v === cover.length;
        res.len = res.len === null ? ok : res.len && ok;
      } else if (f.type === 'CHECK') {
        const cover = rangeBytes(bytes, spans, f.from, f.to);
        const ok = cover !== null && v === ALGOS[f.algo].fn(cover);
        res.chk = res.chk === null ? ok : res.chk && ok;
      } else if (f.type === 'MAGIC' && res.magic === null) res.magic = fb;
      else if (f.type === 'SEQ' && res.seq === null) res.seq = fb[0];
      else if (f.type === 'CMD' && res.cmd === null) res.cmd = fb[0];
      else if (f.type === 'DATA') res.data = fb;
    });
    return res;
  }
  // Validate a dissector against a list of captures [{bytes, dir, session}] -> per frame + totals.
  function validate(d, caps) {
    const per = caps.map(c => parse(d, c.bytes));
    const tot = { n: caps.length, used: 0, fit: 0, len: [0, 0], chk: [0, 0], magic: [0, 0], seq: [0, 0] };
    let refMagic = null;
    const lastSeq = {};
    per.forEach((p, i) => {
      p.seqOk = null; p.magicOk = null;
      if (caps[i].excluded) { p.excluded = true; return; }
      tot.used++;
      if (!p.fit) return;
      tot.fit++;
      if (p.len !== null) { tot.len[1]++; if (p.len) tot.len[0]++; }
      if (p.chk !== null) { tot.chk[1]++; if (p.chk) tot.chk[0]++; }
      if (p.magic) {
        if (!refMagic) refMagic = p.magic;
        p.magicOk = eq(p.magic, refMagic);
        tot.magic[1]++; if (p.magicOk) tot.magic[0]++;
      }
      if (p.seq !== null) {
        const key = caps[i].dir + '/' + (caps[i].session || 0);
        if (key in lastSeq) {
          const dd = (p.seq - lastSeq[key]) & 0xFF;
          p.seqOk = dd >= 1 && dd <= 16;
          tot.seq[1]++; if (p.seqOk) tot.seq[0]++;
        }
        lastSeq[key] = p.seq;
      }
    });
    tot.allGood = tot.used > 0 && tot.fit === tot.used && tot.len[0] === tot.len[1] && tot.chk[0] === tot.chk[1] &&
      tot.magic[0] === tot.magic[1] && tot.seq[0] === tot.seq[1];
    return { per, tot, refMagic };
  }
  // Build a frame from a dissector. params: {magic:[...], seq, cmd, data:[...]}.
  function forge(d, params) {
    if (problems(d).length) return null;
    const fs = d.fields;
    const data = params.data || [];
    const ws = fs.map(fieldWidth);
    const spans = []; let p = 0;
    fs.forEach((f, i) => { const w = f.type === 'DATA' ? data.length : ws[i]; spans.push({ start: p, end: p + w }); p += w; });
    const out = new Array(p).fill(0);
    const put = (i, arr) => arr.forEach((b, k) => { out[spans[i].start + k] = b & 0xFF; });
    let magicUsed = 0;
    fs.forEach((f, i) => {
      if (f.type === 'MAGIC') {
        const m = params.magic || [];
        put(i, Array.from({ length: ws[i] }, (_, k) => m[magicUsed + k] || 0));
        magicUsed += ws[i];
      } else if (f.type === 'SEQ') put(i, [params.seq | 0]);
      else if (f.type === 'CMD') put(i, [params.cmd | 0]);
      else if (f.type === 'DATA') put(i, data);
    });
    fs.forEach((f, i) => {
      if (f.type === 'LEN') put(i, writeUint(spans[f.to].end - spans[f.from].start, ws[i], f.endian || 'BE'));
    });
    fs.forEach((f, i) => {
      if (f.type === 'CHECK') put(i, writeUint(ALGOS[f.algo].fn(out.slice(spans[f.from].start, spans[f.to].end)), ws[i], f.endian || 'BE'));
    });
    return applyXor(out, d.xorKey, xorStart(d));
  }

  // ---------- levels ----------
  const ERR = { LEN: 0x01, CHK: 0x02, CMD: 0x03, VAL: 0x04, SEQ: 0x05 };
  const ERR_NAME = { 1: 'LEN', 2: 'CHK', 3: 'CMD', 4: 'VAL', 5: 'SEQ' };
  const F = (type, o) => Object.assign({ type }, o || {});
  function distinctCmds(r, names, lo, hi) {
    const used = new Set(), out = {};
    for (const n of names) { let c; do c = r.int(lo, hi); while (used.has(c)); used.add(c); out[n] = c; }
    return out;
  }
  const MAGIC1 = [0xA5, 0x5A, 0xAA, 0xC3, 0x3C, 0x96, 0x69, 0xE7];

  // Each level: make(r) -> spec { proto, magic, cmds, state, app[], goals[], chatty, prelude(lab) , handle(lab, f) }
  const LEVELS = [
    {
      id: 1, key: 'pads', device: 'purifier', clock: '19:00', title: 'The test pads',
      sub: 'Purifier, UART between the Wi-Fi module and the motor board',
      make(r) {
        const magic = [r.pick(MAGIC1)];
        const proto = { fields: [F('MAGIC', { w: 1 }), F('LEN', { w: 1, from: 2, to: 3 }), F('CMD'), F('DATA'), F('CHECK', { algo: 'SUM8', from: 1, to: 3 })], xorKey: null };
        const cmds = distinctCmds(r, ['STATUS', 'POWER', 'SPEED', 'LIGHT'], 0x10, 0x4F);
        const state = { power: 1, speed: 1, light: 1, pm: r.int(9, 31), cloud: true };
        return {
          proto, magic, cmds, state, chatty: true,
          statusData: s => [s.power, s.speed, s.light, s.pm],
          app: [
            { id: 'power', label: 'Power', make: s => ({ cmd: cmds.POWER, data: [s.power ? 0 : 1] }) },
            { id: 's1', label: 'Speed 1', make: () => ({ cmd: cmds.SPEED, data: [1] }) },
            { id: 's2', label: 'Speed 2', make: () => ({ cmd: cmds.SPEED, data: [2] }) },
            { id: 's3', label: 'Speed 3', make: () => ({ cmd: cmds.SPEED, data: [3] }) },
            { id: 'light', label: 'Light', make: s => ({ cmd: cmds.LIGHT, data: [s.light ? 0 : 1] }) },
            { id: 'sync', label: 'Refresh', make: () => ({ cmd: cmds.STATUS, data: [] }) },
          ],
          prelude: ['sync', 's2'],
          handle(s, cmd, data) {
            if (cmd === cmds.STATUS) return data.length ? 'VAL' : { reply: this.statusData(s) };
            if (data.length !== 1) return 'VAL';
            const v = data[0];
            if (cmd === cmds.POWER) { if (v > 1) return 'VAL'; s.power = v; return { reply: [v] }; }
            if (cmd === cmds.LIGHT) { if (v > 1) return 'VAL'; s.light = v; return { reply: [v] }; }
            if (cmd === cmds.SPEED) { if (v < 1 || v > 4) return 'VAL'; s.speed = v; s.power = 1; return { reply: [v] }; }
            return 'CMD';
          },
          goals: [{ id: 'turbo', text: 'Spin the fan at TURBO (speed 4) - the motor has it, the app never offers it', test: s => s.speed === 4 && s.power === 1 }],
        };
      },
    },
    {
      id: 2, key: 'timer', device: 'purifier', clock: '20:00', title: 'Sleep timer',
      sub: 'Purifier after a firmware update: new framing, 16-bit values',
      make(r) {
        const magic = [r.pick(MAGIC1), r.int(0x10, 0xEF)];
        const algo = r.pick(['XOR8', 'LRC8']);
        const proto = { fields: [F('MAGIC', { w: 2 }), F('LEN', { w: 1, from: 0, to: 4 }), F('CMD'), F('DATA'), F('CHECK', { algo, from: 0, to: 3 })], xorKey: null };
        const cmds = distinctCmds(r, ['STATUS', 'POWER', 'SPEED', 'TIMER'], 0x20, 0x6F);
        const state = { power: 1, speed: 2, light: 1, timer: 0, pm: r.int(9, 31), cloud: true };
        return {
          proto, magic, cmds, state, chatty: true,
          statusData: s => [s.power, s.speed].concat(u16(s.timer, 'LE'), [s.pm]),
          app: [
            { id: 'power', label: 'Power', make: s => ({ cmd: cmds.POWER, data: [s.power ? 0 : 1] }) },
            { id: 's1', label: 'Speed 1', make: () => ({ cmd: cmds.SPEED, data: [1] }) },
            { id: 's3', label: 'Speed 3', make: () => ({ cmd: cmds.SPEED, data: [3] }) },
            { id: 't1', label: 'Timer 1 h', make: () => ({ cmd: cmds.TIMER, data: u16(60, 'LE') }) },
            { id: 't2', label: 'Timer 2 h', make: () => ({ cmd: cmds.TIMER, data: u16(120, 'LE') }) },
            { id: 't4', label: 'Timer 4 h', make: () => ({ cmd: cmds.TIMER, data: u16(240, 'LE') }) },
            { id: 't8', label: 'Timer 8 h', make: () => ({ cmd: cmds.TIMER, data: u16(480, 'LE') }) },
            { id: 't0', label: 'Timer off', make: () => ({ cmd: cmds.TIMER, data: u16(0, 'LE') }) },
            { id: 'sync', label: 'Refresh', make: () => ({ cmd: cmds.STATUS, data: [] }) },
          ],
          prelude: ['sync', 't2'],
          handle(s, cmd, data) {
            if (cmd === cmds.STATUS) return data.length ? 'VAL' : { reply: this.statusData(s) };
            if (cmd === cmds.TIMER) {
              if (data.length !== 2) return 'VAL';
              const m = readUint(data, 'LE'); if (m > 1440) return 'VAL';
              s.timer = m; return { reply: data.slice() };
            }
            if (data.length !== 1) return 'VAL';
            const v = data[0];
            if (cmd === cmds.POWER) { if (v > 1) return 'VAL'; s.power = v; return { reply: [v] }; }
            if (cmd === cmds.SPEED) { if (v < 1 || v > 4) return 'VAL'; s.speed = v; s.power = 1; return { reply: [v] }; }
            return 'CMD';
          },
          goals: [
            { id: 't90', text: 'Set the sleep timer to 90 minutes (the app only does whole hours)', test: (s, ev) => ev && ev.src === 'player' && ev.cmd === cmds.TIMER && s.timer === 90 },
            { id: 't720', text: 'Set the sleep timer to 12 hours', test: (s, ev) => ev && ev.src === 'player' && ev.cmd === cmds.TIMER && s.timer === 720 },
          ],
        };
      },
    },
    {
      id: 3, key: 'lock', device: 'lock', clock: '21:00', title: 'Premium unlock',
      sub: 'Smart deadbolt on the LAN: sequence numbers and a CRC',
      make(r) {
        const magic = [r.pick(MAGIC1), r.int(0x10, 0xEF)];
        const ck = r.pick([{ algo: 'MODBUS', endian: 'LE' }, { algo: 'XMODEM', endian: 'BE' }]);
        const proto = { fields: [F('MAGIC', { w: 2 }), F('SEQ'), F('CMD'), F('LEN', { w: 1, from: 4, to: 4 }), F('DATA'), F('CHECK', { algo: ck.algo, endian: ck.endian, from: 1, to: 4 })], xorKey: null };
        const cmds = distinctCmds(r, ['STATUS', 'BOLT', 'AUTOLOCK'], 0x10, 0x6F);
        const state = { bolt: 1, battery: r.int(41, 88), autolock: 60, seq: r.int(0x30, 0xC0), cloud: true };
        return {
          proto, magic, cmds, state, chatty: true, seqWindow: 16,
          statusData: s => [s.bolt, s.battery].concat(u16(s.autolock, 'BE')),
          app: [
            { id: 'lock', label: 'Lock', make: () => ({ cmd: cmds.BOLT, data: [1] }) },
            { id: 'unlock', label: 'Unlock', premium: true },
            { id: 'a30', label: 'Auto-lock 30 s', make: () => ({ cmd: cmds.AUTOLOCK, data: u16(30, 'BE') }) },
            { id: 'a60', label: 'Auto-lock 60 s', make: () => ({ cmd: cmds.AUTOLOCK, data: u16(60, 'BE') }) },
            { id: 'a120', label: 'Auto-lock 2 min', make: () => ({ cmd: cmds.AUTOLOCK, data: u16(120, 'BE') }) },
            { id: 'sync', label: 'Refresh', make: () => ({ cmd: cmds.STATUS, data: [] }) },
          ],
          prelude: ['sync', 'lock'],
          // yesterday's log: a real unlock frame with a stale sequence number
          log(lab) {
            const seq = (state.seq - r.int(9, 40)) & 0xFF;
            const tx = forge(proto, { magic, seq, cmd: cmds.BOLT, data: [0] });
            const rx = forge(proto, { magic, seq, cmd: cmds.BOLT | 0x80, data: [0] });
            return [{ dir: 'tx', bytes: tx, label: 'Unlock (yesterday, from lock.log)', session: 0, src: 'log' },
              { dir: 'rx', bytes: rx, label: 'reply', session: 0, src: 'log' }];
          },
          handle(s, cmd, data) {
            if (cmd === cmds.STATUS) return data.length ? 'VAL' : { reply: this.statusData(s) };
            if (cmd === cmds.BOLT) { if (data.length !== 1 || data[0] > 1) return 'VAL'; s.bolt = data[0]; return { reply: data.slice() }; }
            if (cmd === cmds.AUTOLOCK) {
              if (data.length !== 2) return 'VAL';
              const t = readUint(data, 'BE'); if (t < 5 || t > 3600) return 'VAL';
              s.autolock = t; return { reply: data.slice() };
            }
            return 'CMD';
          },
          goals: [
            { id: 'unlock', text: 'Unlock the door without Premium (a fresh frame, not a replay)', test: (s, ev) => ev && ev.src === 'player' && ev.cmd === cmds.BOLT && s.bolt === 0 },
            { id: 'a300', text: 'Set auto-lock to 5 minutes', test: (s, ev) => ev && ev.src === 'player' && ev.cmd === cmds.AUTOLOCK && s.autolock === 300 },
          ],
        };
      },
    },
    {
      id: 4, key: 'thermo', device: 'thermo', clock: '22:00', title: 'Holiday mode',
      sub: 'Thermostat over Bluetooth: the bytes are scrambled',
      make(r) {
        const mac = [0x3C, 0x71, 0xBF, r.int(0, 255), r.int(0, 255), r.int(0, 255)];
        // make sure the key never contains 00 so it visibly scrambles every byte
        for (let i = 2; i < 6; i++) if (mac[i] === 0) mac[i] = 0x5D;
        const key = mac.slice(2);
        const magic = [r.pick(MAGIC1)];
        const algo = r.pick(['CRC8', 'CRC8M']);
        const proto = { fields: [F('MAGIC', { w: 1 }), F('LEN', { w: 1, from: 2, to: 3 }), F('CMD'), F('DATA'), F('CHECK', { algo, from: 1, to: 3 })], xorKey: key };
        const cmds = distinctCmds(r, ['STATUS', 'MODE', 'SETPOINT'], 0x10, 0x6F);
        const state = { mode: 1, setpoint: 205, room: r.int(188, 214), mac, cloud: true };
        return {
          proto, magic, cmds, state, chatty: false, mac,
          statusData: s => [s.mode].concat(u16(s.setpoint, 'BE'), u16(s.room, 'BE')),
          app: [
            { id: 'down', label: '- 0.5 \u00b0C', make: s => ({ cmd: cmds.SETPOINT, data: u16(Math.max(160, s.setpoint - 5), 'BE') }) },
            { id: 'up', label: '+ 0.5 \u00b0C', make: s => ({ cmd: cmds.SETPOINT, data: u16(Math.min(260, s.setpoint + 5), 'BE') }) },
            { id: 'heat', label: 'Heat', make: () => ({ cmd: cmds.MODE, data: [1] }) },
            { id: 'off', label: 'Off', make: () => ({ cmd: cmds.MODE, data: [0] }) },
            { id: 'sync', label: 'Refresh', make: () => ({ cmd: cmds.STATUS, data: [] }) },
          ],
          prelude: ['sync', 'up'],
          handle(s, cmd, data) {
            if (cmd === cmds.STATUS) return data.length ? 'VAL' : { reply: this.statusData(s) };
            if (cmd === cmds.MODE) { if (data.length !== 1 || data[0] > 1) return 'VAL'; s.mode = data[0]; return { reply: data.slice() }; }
            if (cmd === cmds.SETPOINT) {
              if (data.length !== 2) return 'VAL';
              const t = readUint(data, 'BE'); if (t < 50 || t > 300) return 'VAL';
              s.setpoint = t; return { reply: data.slice() };
            }
            return 'CMD';
          },
          goals: [{ id: 'frost', text: 'Holiday frost protection: set 7.0 \u00b0C while heating (the app stops at 16.0)', test: s => s.setpoint === 70 && s.mode === 1 }],
        };
      },
    },
    {
      id: 5, key: 'prov', device: 'prov', clock: '23:00', title: 'Re-provision',
      sub: 'Purifier after a factory reset, Bluetooth set-up frames',
      make(r) {
        const magic = ascii('P2');
        const ck = r.pick([{ algo: 'CCITT', endian: 'BE' }, { algo: 'XMODEM', endian: 'BE' }, { algo: 'MODBUS', endian: 'LE' }]);
        const proto = { fields: [F('MAGIC', { w: 2 }), F('LEN', { w: 2, endian: 'BE', from: 2, to: 2 }), F('DATA'), F('CHECK', { algo: ck.algo, endian: ck.endian, from: 1, to: 2 })], xorKey: null };
        const words = ['larch', 'cobalt', 'otter', 'pylon', 'saffron', 'quartz', 'tundra', 'mosaic', 'ember', 'fjord'];
        const ssid = 'Flat-' + r.int(2, 9) + String.fromCharCode(65 + r.int(0, 5));
        const pwd = r.pick(words) + '-' + r.pick(words) + '-' + r.int(10, 99);
        let token = ''; for (let i = 0; i < 12; i++) token += '0123456789abcdef'[r.int(0, 15)];
        const cloud = { ca: 'http://ca.airlux-cloud.com/root.pem', cert: 'https://cert.airlux-cloud.com/iot/r0' };
        const home = { ca: 'http://10.0.0.2/root.pem', cert: 'https://10.0.0.2/iot/r0' };
        const T = { CMD: 0x01, SSID: 0x02, PWD: 0x03, CA: 0x04, CERT: 0x05, TOKEN: 0x06, MODEL: 0x07, FW: 0x08, STATUS: 0x09 };
        const tlv = list => list.reduce((a, [t, v]) => a.concat([t, v.length], v), []);
        const state = { prov: null, ssid, pwd, token, cloud: true };
        return {
          proto, magic, cmds: {}, state, chatty: false, T, home, cloudUrls: cloud, tlv,
          app: [
            { id: 'ident', label: 'Identify', make: () => ({ data: tlv([[T.CMD, [0x01]]]) }) },
            { id: 'setup', label: 'Set up (AirLux cloud)', make: () => ({ data: tlv([[T.CMD, [0x02]], [T.SSID, ascii(ssid)], [T.PWD, ascii(pwd)], [T.CA, ascii(cloud.ca)], [T.CERT, ascii(cloud.cert)], [T.TOKEN, ascii(token)]]) }) },
          ],
          prelude: ['ident', 'setup'],
          parseTlv(data) {
            const out = {}; let i = 0;
            while (i < data.length) {
              if (i + 2 > data.length) return null;
              const t = data[i], l = data[i + 1];
              if (i + 2 + l > data.length || t in out) return null;
              out[t] = data.slice(i + 2, i + 2 + l); i += 2 + l;
            }
            return out;
          },
          handle(s, cmd, data) {
            const t = this.parseTlv(data);
            if (!t || !t[T.CMD] || t[T.CMD].length !== 1) return 'VAL';
            const st = code => ({ reply: tlv([[T.STATUS, [code]]]), fail: code >= 0x80 });
            if (t[T.CMD][0] === 0x01) return { reply: tlv([[T.MODEL, ascii('AL-AP1 IconAir')], [T.FW, ascii('4.2.17')], [T.STATUS, [s.prov === 'local' ? 0x11 : s.prov === 'cloud' ? 0x10 : 0x00]]]) };
            if (t[T.CMD][0] !== 0x02) return 'VAL';
            for (const k of [T.SSID, T.PWD, T.CA, T.CERT, T.TOKEN]) if (!t[k]) return st(0x81);       // missing field
            if (fromAscii(t[T.SSID]) !== ssid || fromAscii(t[T.PWD]) !== pwd) return st(0x82);         // wifi join failed
            const ca = fromAscii(t[T.CA]), cert = fromAscii(t[T.CERT]);
            if (!/^https?:\/\/[\w.\-]+(:\d+)?\/\S*$/.test(ca) || !/^https?:\/\/[\w.\-]+(:\d+)?\/\S*$/.test(cert)) return st(0x83); // bad url
            let to;
            if (ca === cloud.ca && cert === cloud.cert) to = 'cloud';
            else if (ca === home.ca && cert === home.cert) to = 'local';
            else return st(0x84);                                                                   // cert fetch failed
            if (fromAscii(t[T.TOKEN]) !== token) return st(0x85);                                    // enrolment refused
            s.prov = to;
            return st(to === 'local' ? 0x11 : 0x10);
          },
          goals: [{ id: 'local', text: 'Provision the purifier against YOUR server (10.0.0.2) so it survives midnight', test: s => s.prov === 'local' }],
        };
      },
    },
  ];
  const PROV_STATUS = { 0x00: 'not provisioned', 0x10: 'online via AirLux cloud', 0x11: 'online via LOCAL server', 0x81: 'set-up field missing', 0x82: 'Wi-Fi join failed', 0x83: 'malformed URL', 0x84: 'could not fetch root CA / certificate from that server', 0x85: 'enrolment token refused' };

  // ---------- lab: one level instance (device + app + wire) ----------
  function createLab(levelIndex, seed) {
    const L = LEVELS[levelIndex];
    const r = rng((seed >>> 0) ^ (0x9E3779B9 * (levelIndex + 1)));
    const spec = L.make(r);
    const lab = {
      level: L, spec, seed, caps: [], badFrames: 0, sent: 0, goalsDone: {}, events: [], session: 1,
      state: spec.state,
    };
    const P = spec.proto;
    const hasSeq = P.fields.some(f => f.type === 'SEQ');
    function frame(cmd, data, seq) { return forge(P, { magic: spec.magic, seq, cmd, data }); }
    // device side: parse with the TRUE protocol
    function receive(bytes, src) {
      const s = lab.state;
      const res = { accepted: false, err: null, reply: null, silent: false };
      const mw = fieldWidth(P.fields[0]);
      if (bytes.length < mw || !eq(bytes.slice(0, mw), spec.magic)) { res.err = 'MAGIC'; res.silent = true; return res; }
      const p = parse(P, bytes);
      let seq = 0;
      const nak = code => {
        res.err = code;
        if (spec.chatty) res.reply = frame(0xFF, [ERR[code]], seq);
        else res.silent = true;
        return res;
      };
      if (!p.fit || p.len === false) return nak('LEN');
      if (p.chk === false) return nak('CHK');
      if (hasSeq) {
        seq = p.seq;
        const d = (p.seq - s.seq) & 0xFF;
        if (d < 1 || d > (spec.seqWindow || 16)) return nak('SEQ');
        s.seq = p.seq;
      }
      spec._src = src;
      const out = spec.handle(s, p.cmd, p.data || []);
      if (typeof out === 'string') return nak(out);
      res.accepted = !out.fail;
      if (out.fail) res.err = 'VAL';
      res.cmd = p.cmd; res.data = p.data;
      const rcmd = p.cmd === null ? 0 : p.cmd | 0x80;
      res.reply = frame(rcmd, out.reply || [], seq);
      return res;
    }
    function checkGoals(ev) {
      const newly = [];
      for (const g of spec.goals) {
        if (lab.goalsDone[g.id]) continue;
        if (ev.src === 'player' && g.test(lab.state, ev)) { lab.goalsDone[g.id] = true; newly.push(g.id); }
      }
      return newly;
    }
    function push(dir, bytes, label, src) {
      const c = { dir, bytes, label, session: lab.session, src, i: lab.caps.length };
      lab.caps.push(c); return c;
    }
    lab.appPress = function (id) {
      const b = spec.app.find(a => a.id === id);
      if (!b) return null;
      if (b.premium) return { premium: true };
      const m = b.make(lab.state);
      const seq = hasSeq ? (lab.state.seq + 1) & 0xFF : 0;
      const bytes = frame(m.cmd, m.data, seq);
      const tx = push('tx', bytes, b.label, 'app');
      const res = receive(bytes, 'app');
      const rx = res.reply ? push('rx', res.reply, res.accepted ? 'reply' : 'error', 'device') : null;
      return { tx, rx, res };
    };
    lab.send = function (bytes) {
      bytes = bytes.map(b => b & 0xFF);
      lab.sent++;
      const tx = push('tx', bytes, 'you', 'player');
      const res = receive(bytes, 'player');
      const rx = res.reply ? push('rx', res.reply, res.accepted ? 'reply' : 'error', 'device') : null;
      if (!res.accepted) { lab.badFrames++; tx.excluded = true; tx.err = res.err; if (rx) rx.excluded = true; }
      const ev = { src: 'player', cmd: res.cmd, data: res.data, accepted: res.accepted };
      res.goals = res.accepted ? checkGoals(ev) : [];
      return { tx, rx, res };
    };
    lab.allDone = () => spec.goals.every(g => lab.goalsDone[g.id]);
    lab.stars = () => lab.badFrames <= 1 ? 3 : lab.badFrames <= 4 ? 2 : 1;
    lab.nextSeq = () => (lab.state.seq + 1) & 0xFF;
    lab.frame = frame;
    lab.receive = receive;
    // prelude: yesterday's log (if any), then the app's start-up traffic
    if (spec.log) { lab.session = 0; spec.log(lab).forEach(c => push(c.dir, c.bytes, c.label, c.src)); lab.session = 1; }
    for (const id of spec.prelude) lab.appPress(id);
    return lab;
  }

  // Describe a reply/err for the device console.
  function describeError(code) {
    return {
      MAGIC: 'frame ignored (no start marker the device recognises)',
      LEN: 'ERR LEN - the length field does not match the frame',
      CHK: 'ERR CHK - checksum mismatch',
      CMD: 'ERR CMD - unknown command',
      VAL: 'ERR VAL - command understood, value rejected',
      SEQ: 'ERR SEQ - sequence number not newer than the last one (replay?)',
    }[code] || code;
  }

  const API = {
    rng, hex2, toHex, parseHex, ascii, fromAscii, u16, readUint, writeUint, eq,
    ALGOS, ALGO_ORDER, TYPES, fieldWidth, problems, layout, parse, validate, forge, applyXor, xorStart,
    LEVELS, ERR, ERR_NAME, PROV_STATUS, createLab, describeError,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.LO = API;
})(typeof window !== 'undefined' ? window : this);
