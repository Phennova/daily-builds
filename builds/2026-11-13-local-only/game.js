// LOCAL ONLY - UI, level flow and content. Depends on proto.js (LO), audio.js (SFX), bench.js (BENCH).
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const H2 = LO.hex2;
  const params = new URLSearchParams(location.search);
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------------- content ----------------
  const DEVICE_KIND = { pads: 'purifier', timer: 'purifier', lock: 'lock', thermo: 'thermo', prov: 'prov' };
  const BRIEF = {
    pads: 'You opened the purifier and found four test pads between the Wi-Fi module and the motor board. The sniffer is clipped on. The motor controller supports a TURBO speed that the app never shows.',
    timer: 'The app pushed a firmware update an hour ago (of course it did). New framing, and a sleep timer the app only sets in whole hours. You want 90 minutes, and 12 hours for the night you are away.',
    lock: 'The front-door deadbolt talks to the app over your LAN. As of last month, "Unlock from app" needs AirLux Premium. You still have lock.log from yesterday, when unlocking was free.',
    thermo: 'The thermostat speaks Bluetooth and its bytes look like noise. You are travelling next week: you want frost protection at 7.0 \u00b0C, and the app refuses anything under 16.0.',
    prov: 'Last step. You factory-reset the purifier; it is waiting for a set-up frame over Bluetooth. The app sends it the Wi-Fi details and the URLs of the servers it should trust. Your Raspberry Pi at 10.0.0.2 serves http://10.0.0.2/root.pem and https://10.0.0.2/iot/r0, ready to stand in for the cloud.',
  };
  const LESSON = {
    pads: ['<b>Framing.</b> A wire is just a stream of bytes. A frame needs a way to say where it starts (a magic or sync byte), how long it is (a length field) and whether it arrived intact (a checksum). Reverse engineers find these by <i>comparison</i>: bytes that never change are magic, a byte that tracks the size is a length, a byte that changes with the button is the command, the unpredictable last byte is usually a checksum.',
      '<b>A checksum is not security.</b> It protects against line noise, not against you: anyone who knows the algorithm can compute a valid one for any frame they like. Which is exactly what you are about to do.'],
    timer: ['<b>Endianness.</b> A number above 255 needs two bytes, and the designer picks the order. Little-endian puts the low byte first (90 = <code>5A 00</code>), big-endian the high byte first (90 = <code>00 5A</code>). Read it off a value you already know: "Timer 8 h" is 480 minutes = 0x01E0.',
      '<b>Off by a header.</b> Length fields count different things: only the payload, everything after themselves, or the whole frame including magic and checksum. Checksums may or may not include the magic. Try the options until every frame agrees.'],
    lock: ['<b>Replay protection.</b> A captured "unlock" frame is a key anyone can copy, unless the device remembers a sequence number and only accepts frames that are newer. That stops naive replays, but not forgery: here the only integrity check is a public CRC, so you can compute a valid frame for any sequence number.',
      '<b>CRCs are not signatures.</b> They are linear and keyless, great at catching random bit errors, useless against someone who wants to change the frame. Real devices need a keyed MAC (HMAC, AES-CMAC) with a secret the attacker does not have.'],
    thermo: ['<b>XOR is not encryption.</b> Scrambling every byte with a short repeating key hides the structure, but the key repeats and you know a lot of the plaintext (lengths, commands, the temperature you just set). XOR a scrambled byte with what you expect and the key falls out. This vendor went further and derived the key from the MAC address, which the device broadcasts and prints on its sticker.',
      '<b>Silent failure.</b> This device says nothing when a frame is wrong, as most real devices do. Prove your dissector against the captures before you transmit; every bad frame counts against you. Real products use authenticated encryption (AES-CCM/GCM) with per-device secrets.'],
    prov: ['<b>Provisioning is where trust is born.</b> During set-up the app tells the device which Wi-Fi to join and which servers to trust. The real purifier this level is modelled on fetches its root certificate over plain HTTP from a URL it is given during set-up, so whoever sends the set-up frame decides whom the device trusts. A hole for the vendor, a gift for right-to-repair.',
      '<b>TLV</b> (type, length, value) packs variable fields: one byte says what it is, one byte how long, then the bytes. Change a string and you must change its length byte, then the frame length, then the checksum.'],
  };
  const HINTS = {
    pads: ['Select "Speed 1", tick "diff vs selected", then look at "Speed 2" and "Speed 3": only two bytes change, the value and the last byte.',
      'The length byte counts CMD and DATA - not the magic, not itself, not the checksum.',
      'When DATA goes up by 1 and the last byte goes up by 1 too, the checksum is additive: try SUM-8 over LEN..DATA. Then forge the SPEED command with DATA 04.'],
    timer: ['Two magic bytes now. The third byte still tracks the size, but it is bigger than before: count the whole frame.',
      'Timer 1 h = 3C 00, 2 h = 78 00: minutes, low byte first (little-endian). 90 min = 5A 00, 12 h = 720 min = D0 02. The u16 LE helper in the Forge does this for you.',
      'If SUM-8 never matches, try XOR-8 and LRC-8, and let the checksum cover the magic bytes too.'],
    lock: ['Select yesterday\'s unlock (from lock.log), press "raw \u2192 forge" and send it: ERR SEQ. The byte after the magic grows by one with every frame from the app.',
      'Here the length byte comes after the command and counts only DATA. The checksum is 2 bytes: try the CRC-16 family and both byte orders.',
      'Unlock is the Lock command with DATA 00 (see the log). 5 minutes = 300 s, and these values are big-endian: 01 2C. Leave SEQ empty and the forge uses the next number.'],
    thermo: ['Only the first byte is readable. Look closely at the sticker on the thermostat.',
      'Put the last 4 bytes of the MAC in the XOR key box. When it is right, the frames snap into the level-1 shape: LEN, CMD, DATA, CHECK.',
      'Setpoint is in tenths of a degree, big-endian: 21.0 \u00b0C = 00 D2, so 7.0 \u00b0C = 00 46. The checksum is one of the CRC-8s. Make sure the mode is Heat.'],
    prov: ['Select the "Set up" frame and press "DATA \u2192 forge". Strings appear in quotes in the DATA box; edit them there.',
      'Each URL is preceded by its type byte (04, 05) and its length byte. The Forge shows the byte count of every quoted string in hex: update the length bytes to match.',
      'LEN is 2 bytes, big-endian, counting DATA only. The checksum is a 16-bit CRC over LEN and DATA. Keep SSID, password and token exactly as captured.'],
  };

  // ---------------- persistent run ----------------
  const STORE = 'lo-run-v1';
  let run = load();
  function load() {
    try { const r = JSON.parse(localStorage.getItem(STORE)); if (r && r.seed) return r; } catch (e) { /* ignore */ }
    return fresh();
  }
  function fresh() { return { seed: (Math.random() * 2 ** 31) >>> 0, unlocked: 1, stars: {}, dis: {}, cur: 0, done: false }; }
  const NOSAVE = params.has('selftest') || params.has('demo');
  function save() { if (NOSAVE) return; try { localStorage.setItem(STORE, JSON.stringify(run)); } catch (e) { /* ignore */ } }

  // ---------------- session state ----------------
  const S = { li: 0, lab: null, dis: null, v: null, sel: -1, selField: -1, tab: 'pDevice', ticks: 0, forge: { cmd: '', data: '', seq: '', raw: '' }, hintsShown: 0, midnight: false, unseen: 0 };
  const blankDis = () => ({ fields: [], xorKey: null });

  function startLevel(li) {
    S.li = li; run.cur = li; save();
    S.lab = LO.createLab(li, run.seed);
    S.dis = run.dis[li] ? JSON.parse(JSON.stringify(run.dis[li])) : blankDis();
    S.sel = -1; S.selField = -1; S.ticks = 0; S.hintsShown = 0; S.midnight = false; S.completeShown = false;
    S.forge = { cmd: '', data: '', seq: '', raw: '' };
    $('optRaw').checked = false;
    $('console').innerHTML = '';
    const L = S.lab.level;
    logLine('n', `${L.clock}  level ${L.id}: ${L.title}`);
    logLine('n', 'sniffer attached. app start-up traffic captured.');
    renderAll();
    setTab('pDevice');
  }

  // ---------------- helpers ----------------
  function kind() { return DEVICE_KIND[S.lab.level.key]; }
  function clockStr() {
    const [h, m] = S.lab.level.clock.split(':').map(Number);
    const t = h * 60 + m + Math.min(55, S.ticks);
    return `Fri 13 Nov ${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  }
  function toast(msg, ms) {
    const t = $('toast'); t.textContent = msg; t.classList.add('on');
    clearTimeout(toast._h); toast._h = setTimeout(() => t.classList.remove('on'), ms || 2600);
  }
  function logLine(cls, msg) {
    const c = $('console');
    const d = el('div', 'l ' + cls); d.textContent = msg; c.appendChild(d);
    while (c.children.length > 120) c.removeChild(c.firstChild);
    c.scrollTop = c.scrollHeight;
  }
  // DATA notation: hex bytes, "quoted text", le16:N, be16:N, u8:N
  function parseData(str) {
    const out = []; const strings = [];
    const re = /"((?:[^"\\]|\\.)*)"|(le16|be16|u8):(\d+)|([0-9a-fA-F]+)|(\S)/g;
    let m;
    while ((m = re.exec(str))) {
      if (m[1] !== undefined) { const s = m[1].replace(/\\(.)/g, '$1'); strings.push(s); s.split('').forEach(ch => out.push(ch.charCodeAt(0) & 0xFF)); }
      else if (m[2]) {
        const n = +m[3];
        if (m[2] === 'u8') { if (n > 255) return { err: 'u8 value over 255' }; out.push(n); }
        else { if (n > 65535) return { err: '16-bit value over 65535' }; LO.u16(n, m[2] === 'le16' ? 'LE' : 'BE').forEach(b => out.push(b)); }
      } else if (m[4]) {
        if (m[4].length % 2) return { err: `odd number of hex digits in "${m[4]}"` };
        for (let i = 0; i < m[4].length; i += 2) out.push(parseInt(m[4].substr(i, 2), 16));
      } else return { err: `don't understand "${m[5]}"` };
    }
    return { bytes: out, strings };
  }
  function fmtData(bytes) {             // bytes -> notation, printable runs of 4+ become "text"
    const parts = []; let i = 0;
    while (i < bytes.length) {
      let j = i;
      while (j < bytes.length && bytes[j] >= 0x20 && bytes[j] < 0x7F && bytes[j] !== 0x22 && bytes[j] !== 0x5C) j++;
      if (j - i >= 5 && bytes[i] === j - i - 1) { parts.push(H2(bytes[i])); i++; }   // a printable length prefix stays hex
      if (j - i >= 4) { parts.push('"' + String.fromCharCode.apply(null, bytes.slice(i, j)) + '"'); i = j; }
      else { parts.push(H2(bytes[i])); i++; }
    }
    return parts.join(' ');
  }
  function capsForValidation() { return S.lab.caps; }
  function revalidate() { S.v = LO.validate(S.dis, capsForValidation()); }
  function fresh_v() { if (!S.v || S.v.per.length !== S.lab.caps.length) revalidate(); }
  function persistDis() { run.dis[S.li] = JSON.parse(JSON.stringify(S.dis)); save(); }

  // ---------------- rendering ----------------
  function renderAll() {
    revalidate();
    renderHeader(); renderApp(); renderGoals(); renderWalk(); renderNotebook();
    renderTotals(); renderCaps(); renderInspect(); renderDis(); renderForge();
  }
  function renderHeader() {
    const L = S.lab.level;
    $('clock').textContent = clockStr();
    $('cloudline').innerHTML = S.midnight ? 'AirLux cloud: <b class="off">gone</b>' : 'AirLux cloud: <b class="on">online</b> \u00b7 shuts down at midnight';
    $('lvlNum').textContent = `Level ${L.id} of ${LO.LEVELS.length} \u00b7 ${L.clock}`;
    $('lvlTitle').textContent = L.title;
    $('lvlSub').textContent = L.sub;
    $('btnMute').textContent = SFX.isMuted() ? 'Sound off' : 'Sound on';
  }
  function renderApp() {
    const box = $('appBtns'); box.innerHTML = '';
    S.lab.spec.app.forEach(b => {
      const btn = el('button', b.premium ? 'premium' : '', esc(b.label));
      btn.type = 'button';
      btn.onclick = () => appPress(b.id, btn);
      box.appendChild(btn);
    });
    $('appNote').textContent = S.midnight ? 'cannot reach AirLux servers' : 'works until midnight';
  }
  function renderGoals() {
    const g = $('goals'); g.innerHTML = '<div class="boxtitle">Goals</div>';
    const p = el('p', '', esc(BRIEF[S.lab.level.key])); p.style.margin = '0 0 6px'; p.style.color = 'var(--dim)'; p.style.fontSize = '13px';
    g.appendChild(p);
    S.lab.spec.goals.forEach(goal => {
      const d = el('div', 'goal' + (S.lab.goalsDone[goal.id] ? ' done' : ''), `<i>${S.lab.goalsDone[goal.id] ? '\u2713' : ''}</i><span>${esc(goal.text)}</span>`);
      g.appendChild(d);
    });
    g.appendChild(el('div', 'meta', `Frames you sent: ${S.lab.sent} \u00b7 rejected: <b style="color:${S.lab.badFrames ? 'var(--bad)' : 'inherit'}">${S.lab.badFrames}</b> \u00b7 ${S.lab.spec.chatty ? 'device reports errors' : 'device is <b>silent</b> on errors'}`));
  }
  function walkSteps() {
    const lab = S.lab, t = S.v.tot, fs = S.dis.fields;
    const appTx = lab.caps.filter(c => c.src === 'app' && c.dir === 'tx').length;
    const types = fs.map(f => f.type).join(' ');
    return [
      ['Press buttons in the AirLux app. Each press puts a frame on the wire (\u2192 to the device, \u2190 its reply). Capture at least 6.', appTx >= 6],
      ['Every frame starts with the same byte. In <b>Your dissector</b>, add a <b>MAGIC</b> field (1 byte).', fs.length > 0 && fs[0].type === 'MAGIC' && t.magic[0] === t.magic[1] && t.magic[1] > 0],
      ['Add the rest of the layout in order: <b>LEN</b>, <b>CMD</b>, <b>DATA</b> (the variable part), <b>CHECK</b>. When it fits, every frame is coloured.', /MAGIC LEN CMD DATA CHECK/.test(types) && t.fit === t.used],
      ['Tap the LEN chip and choose which fields it counts until LEN is \u2713 on every frame.', t.len[1] > 0 && t.len[0] === t.len[1] && t.fit === t.used],
      ['Tap the CHECK chip: pick an algorithm and the bytes it covers until CHK is \u2713 everywhere.', t.chk[1] > 0 && t.chk[0] === t.chk[1] && t.fit === t.used],
      ['Open the <b>Forge</b>. Choose the command that "Speed 2" used, DATA <code>04</code>, and send it.', !!lab.goalsDone.turbo],
    ];
  }
  function renderWalk() {
    const w = $('walk');
    if (S.lab.level.key !== 'pads') { w.innerHTML = ''; return; }
    const steps = walkSteps();
    const now = steps.findIndex(s => !s[1]);
    w.innerHTML = '<div class="boxtitle">Walkthrough</div>' + steps.map((s, i) => `<div class="step${s[1] ? ' done' : ''}${i === now ? ' now' : ''}">${s[0]}</div>`).join('');
  }
  function renderNotebook() {
    const k = S.lab.level.key;
    const nb = $('notebook');
    nb.innerHTML = '<div class="boxtitle">Notebook</div>' + LESSON[k].map(p => `<p>${p}</p>`).join('');
    for (let i = 0; i < S.hintsShown; i++) nb.appendChild(el('div', 'hint', esc(HINTS[k][i])));
    if (S.hintsShown < HINTS[k].length) {
      const b = el('button', 'small', S.hintsShown ? 'Another hint' : 'Hint');
      b.type = 'button';
      b.onclick = () => { S.hintsShown++; renderNotebook(); };
      nb.appendChild(b);
    }
  }
  function badge(label, pair, extra) {
    if (!pair[1]) return `<span class="badge na">${label} \u2014</span>`;
    const good = pair[0] === pair[1];
    return `<span class="badge ${good ? 'ok' : 'bad'}">${label} ${pair[0]}/${pair[1]}${extra || ''}</span>`;
  }
  function renderTotals() {
    const t = S.v.tot;
    const probs = LO.problems(S.dis);
    let h = '';
    if (!S.dis.fields.length) h = '<span class="badge na">no dissector yet: frames are shown raw</span>';
    else if (probs.length) h = `<span class="badge bad">${esc(probs[0])}</span>`;
    else {
      h += badge('FIT', [t.fit, t.used]);
      h += badge('MAGIC', t.magic) + badge('LEN', t.len) + badge('CHK', t.chk) + badge('SEQ', t.seq);
      if (t.allGood && t.len[1] + t.chk[1] > 0) h += '<span class="badge ok">explains every frame</span>';
    }
    $('totals').innerHTML = h;
    $('tabBadge').textContent = S.unseen ? `+${S.unseen}` : '';
  }
  function fieldOf(spans, i) { if (!spans) return -1; for (let k = 0; k < spans.length; k++) if (i >= spans[k].start && i < spans[k].end) return k; return -1; }
  function bytesHtml(bytes, spans, fields, diffAgainst, badMask) {
    let h = '';
    let prevF = -2;
    for (let i = 0; i < bytes.length; i++) {
      const fi = fieldOf(spans, i);
      let cls = 'by';
      if (fi >= 0) { cls += ' f-' + fields[fi].type; if (fi !== prevF && i > 0) cls += ' gap'; if (badMask && badMask[fi]) cls += ' f-bad'; }
      if (diffAgainst && (i >= diffAgainst.length || diffAgainst[i] !== bytes[i])) cls += ' diff';
      prevF = fi;
      h += `<span class="${cls}">${H2(bytes[i])}</span>`;
    }
    return h;
  }
  function verdictHtml(p) {
    if (!S.dis.fields.length || LO.problems(S.dis).length) return '';
    if (p.excluded) return '<span class="vds"><span class="vd bad">rejected</span></span>';
    if (!p.fit) return '<span class="vds"><span class="vd bad">no fit</span></span>';
    let h = '';
    if (p.magicOk === false) h += '<span class="vd bad">MAGIC\u2717</span>';
    if (p.len !== null) h += `<span class="vd ${p.len ? 'ok' : 'bad'}">LEN${p.len ? '\u2713' : '\u2717'}</span>`;
    if (p.chk !== null) h += `<span class="vd ${p.chk ? 'ok' : 'bad'}">CHK${p.chk ? '\u2713' : '\u2717'}</span>`;
    if (p.seqOk !== null) h += `<span class="vd ${p.seqOk ? 'ok' : 'bad'}">SEQ${p.seqOk ? '\u2713' : '\u2717'}</span>`;
    return `<span class="vds">${h}</span>`;
  }
  function badMaskOf(p) {
    if (!p.fit) return null;
    return S.dis.fields.map(f => (f.type === 'LEN' && p.len === false) || (f.type === 'CHECK' && p.chk === false));
  }
  function renderCaps() {
    const box = $('caps');
    const keepBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 30;
    box.innerHTML = '';
    const showRx = $('optReplies').checked;
    const diff = $('optDiff').checked && S.sel >= 0 ? S.v.per[S.sel].bytes : null;
    const valid = S.dis.fields.length && !LO.problems(S.dis).length;
    let shown = 0;
    S.lab.caps.forEach((c, i) => {
      if (c.dir === 'rx' && !showRx && i !== S.sel) return;
      const p = S.v.per[i];
      const row = el('div', `cap ${c.dir}${i === S.sel ? ' sel' : ''}${c.excluded ? ' excl' : ''}`);
      const who = c.src === 'player' ? 'you' : c.src === 'log' ? 'log' : c.dir === 'tx' ? 'app' : 'device';
      const lab = c.dir === 'rx' ? (c.label === 'error' ? 'error reply' : 'reply') : c.label;
      row.innerHTML = `<div class="dir">${c.dir === 'tx' ? '\u2192' : '\u2190'}<br><small>${i + 1}</small></div>` +
        `<div><div class="lab"><span class="src-${c.src}"><b>${esc(lab)}</b> <small>${who}${c.err ? ' \u00b7 ERR ' + c.err : ''}</small></span>${verdictHtml(p)}</div>` +
        `<div class="bytes">${bytesHtml(valid ? p.bytes : c.bytes, valid && p.fit ? p.spans : null, S.dis.fields, diff && i !== S.sel ? diff : null, valid ? badMaskOf(p) : null)}</div></div>`;
      row.onclick = () => { S.sel = S.sel === i ? -1 : i; SFX.click(); renderCaps(); renderInspect(); };
      box.appendChild(row);
      shown++;
    });
    if (!shown) box.innerHTML = '<div class="empty">Nothing captured yet. Press a button in the AirLux app.</div>';
    if (keepBottom) box.scrollTop = box.scrollHeight;
  }
  function renderInspect() {
    const box = $('inspect');
    if (S.sel < 0 || !S.lab.caps[S.sel]) { box.innerHTML = '<div class="boxtitle">Inspector</div><small>Tap a frame to inspect it. Tick "diff vs selected" to highlight the bytes that differ from it.</small>'; return; }
    const c = S.lab.caps[S.sel], p = S.v.per[S.sel];
    let h = `<div class="boxtitle">Frame ${S.sel + 1} \u00b7 ${c.dir === 'tx' ? 'to device' : 'from device'} \u00b7 ${c.bytes.length} bytes</div>`;
    h += `<div class="row"><span class="k">raw</span><span class="v">${LO.toHex(c.bytes)}</span></div>`;
    if (S.dis.xorKey && S.dis.xorKey.length) h += `<div class="row"><span class="k">unXORed</span><span class="v">${LO.toHex(p.bytes)}</span></div>`;
    if (p.fit && S.dis.fields.length && !LO.problems(S.dis).length) {
      S.dis.fields.forEach((f, i) => {
        const b = p.bytes.slice(p.spans[i].start, p.spans[i].end);
        let v = LO.toHex(b) || '(empty)';
        if (f.type === 'LEN') { const cover = p.spans[f.to].end - p.spans[f.from].start; v += ` = ${p.values[i]} (fields ${f.from + 1}..${f.to + 1} are ${cover} bytes) ${p.len ? '\u2713' : '\u2717'}`; }
        if (f.type === 'CHECK') { const cover = p.bytes.slice(p.spans[f.from].start, p.spans[f.to].end); const want = LO.ALGOS[f.algo].fn(cover); v += ` \u00b7 ${LO.ALGOS[f.algo].name} gives ${LO.toHex(LO.writeUint(want, LO.ALGOS[f.algo].w, f.endian || 'BE'))} ${p.chk ? '\u2713' : '\u2717'}`; }
        if (f.type === 'SEQ' || f.type === 'CMD') v += ` = ${b[0]}`;
        if (f.type === 'DATA' && b.length) {
          v += `<br>u8: ${b.join(' ')}`;
          if (b.length === 2) v += `<br>u16 LE ${LO.readUint(b, 'LE')} \u00b7 BE ${LO.readUint(b, 'BE')}`;
          if (b.length > 2 && b.length <= 8 && b.length % 2 === 0) { const pr = []; for (let k = 0; k < b.length; k += 2) pr.push(LO.readUint(b.slice(k, k + 2), 'BE')); v += `<br>u16 BE pairs: ${pr.join(' ')}`; }
          const txt = b.map(x => x >= 32 && x < 127 ? String.fromCharCode(x) : '\u00b7').join('');
          if (b.some(x => x >= 65 && x < 123)) v += `<br>text: ${esc(txt)}`;
        }
        h += `<div class="row"><span class="k" style="color:var(--f-${f.type.toLowerCase() === 'check' ? 'check' : f.type.toLowerCase()})">${i + 1} ${f.type}</span><span class="v">${v}</span></div>`;
      });
    } else if (S.dis.fields.length) h += '<div class="row"><small>Your dissector does not fit this frame.</small></div>';
    h += '<div class="acts"><button type="button" class="small" id="actRaw">raw \u2192 forge</button>';
    if (p.fit && p.data) h += '<button type="button" class="small" id="actData">DATA \u2192 forge</button>';
    h += '</div>';
    box.innerHTML = h;
    $('actRaw').onclick = () => { S.forge.raw = LO.toHex(c.bytes); $('optRaw').checked = true; renderForge(); setTab('pForge'); toast('Raw frame loaded into the forge'); };
    if ($('actData')) $('actData').onclick = () => {
      S.forge.data = fmtData(p.data);
      if (p.cmd !== null) S.forge.cmd = H2(p.cmd);
      $('optRaw').checked = false; renderForge(); setTab('pForge'); toast('CMD and DATA loaded into the forge');
    };
  }

  // ---------------- dissector editor ----------------
  const ADD_ORDER = ['MAGIC', 'LEN', 'SEQ', 'CMD', 'DATA', 'CHECK'];
  function newField(type, i) {
    if (type === 'MAGIC') return { type, w: 1 };
    if (type === 'LEN') return { type, w: 1, endian: 'BE', from: i + 1, to: i + 1 };
    if (type === 'CHECK') return { type, algo: 'SUM8', endian: 'BE', from: 0, to: Math.max(0, i - 1) };
    return { type };
  }
  function fixRefsAfterDelete(k) {
    S.dis.fields.forEach(f => {
      if (f.from === undefined) return;
      if (f.from > k) f.from--; if (f.to > k) f.to--;
      if (f.to < f.from) f.to = f.from;
    });
  }
  function fieldLabel(f, i) {
    let w = f.type === 'DATA' ? 'n' : LO.fieldWidth(f);
    let extra = '';
    if (f.type === 'LEN') extra = ` ${f.from + 1}..${f.to + 1}` + (f.w === 2 ? ' ' + f.endian : '');
    if (f.type === 'CHECK') extra = ' ' + LO.ALGOS[f.algo].name.replace('CRC-', 'CRC') + (LO.ALGOS[f.algo].w === 2 ? ' ' + (f.endian || 'BE') : '') + ` ${f.from + 1}..${f.to + 1}`;
    return `<small>${i + 1} \u00b7 ${w} byte${w === 1 ? '' : 's'}</small><b>${f.type}</b><small>${esc(extra)}</small>`;
  }
  function changed() { persistDis(); revalidate(); renderTotals(); renderCaps(); renderInspect(); renderDis(); renderForge(); renderWalk(); }
  function renderDis() {
    const box = $('dis'); box.innerHTML = '';
    const fs = S.dis.fields;
    const chips = el('div', 'chips');
    fs.forEach((f, i) => {
      const c = el('button', `chip t-${f.type}${i === S.selField ? ' sel' : ''}`, fieldLabel(f, i));
      c.type = 'button';
      c.onclick = () => { S.selField = S.selField === i ? -1 : i; SFX.click(); renderDis(); };
      chips.appendChild(c);
    });
    if (!fs.length) chips.appendChild(el('div', 'empty', 'Add fields left to right to describe one frame.'));
    box.appendChild(chips);
    const add = el('div', 'addrow');
    ADD_ORDER.forEach(t => {
      const b = el('button', '', t); b.type = 'button';
      b.title = 'Add a ' + t + ' field at the end';
      b.onclick = () => { fs.push(newField(t, fs.length)); S.selField = fs.length - 1; SFX.click(); changed(); };
      add.appendChild(b);
    });
    box.appendChild(add);
    if (S.selField >= 0 && fs[S.selField]) box.appendChild(editor(S.selField));
    if (S.li >= 3) {
      const x = el('div', 'xorrow');
      x.innerHTML = '<span><b>Descramble</b> <small>XOR every byte after the first MAGIC field with a repeating key</small></span>';
      const inp = el('input'); inp.type = 'text'; inp.placeholder = 'key, e.g. 1A 2B 3C 4D'; inp.value = S.dis.xorKey ? LO.toHex(S.dis.xorKey) : '';
      inp.setAttribute('autocapitalize', 'characters'); inp.setAttribute('spellcheck', 'false');
      inp.oninput = () => {
        const k = inp.value.trim() ? LO.parseHex(inp.value) : [];
        if (k === null) { inp.style.borderColor = 'var(--bad)'; return; }
        inp.style.borderColor = '';
        S.dis.xorKey = k.length ? k : null;
        persistDis(); revalidate(); renderTotals(); renderCaps(); renderInspect(); renderForge();
      };
      x.appendChild(inp);
      box.appendChild(x);
    }
    const probs = LO.problems(S.dis).filter(p => p !== 'no fields yet');
    if (probs.length) box.appendChild(el('div', 'probs', probs.map(esc).join('<br>')));
    // tools: clear / copy from previous level
    const tools = $('disTools'); tools.innerHTML = '';
    if (S.li > 0 && run.dis[S.li - 1] && run.dis[S.li - 1].fields.length) {
      const b = el('button', 'small', 'copy level ' + S.li + ' dissector'); b.type = 'button';
      b.onclick = () => { S.dis = JSON.parse(JSON.stringify(run.dis[S.li - 1])); if (S.li < 3) S.dis.xorKey = null; S.selField = -1; changed(); toast('Copied. Firmware changes things - check every badge.'); };
      tools.appendChild(b);
    }
    if (fs.length) {
      const b = el('button', 'small', 'clear'); b.type = 'button';
      b.onclick = () => { S.dis = blankDis(); S.selField = -1; changed(); };
      tools.appendChild(b);
    }
  }
  function sel(options, value, onchange) {
    const s = el('select');
    options.forEach(([v, label]) => { const o = el('option', '', esc(label)); o.value = v; if (String(v) === String(value)) o.selected = true; s.appendChild(o); });
    s.onchange = () => onchange(s.value);
    return s;
  }
  function editor(i) {
    const fs = S.dis.fields, f = fs[i];
    const ed = el('div', 'editor');
    const row = (label, ...nodes) => { const r = el('div', 'er'); r.appendChild(el('span', '', label)); nodes.forEach(n => r.appendChild(typeof n === 'string' ? el('span', 'note', n) : n)); ed.appendChild(r); };
    const fieldOpts = fs.map((g, k) => [k, `${k + 1} ${g.type}`]);
    row('type', sel(ADD_ORDER.map(t => [t, t]), f.type, v => { const nf = newField(v, i); fs[i] = nf; changed(); }));
    if (f.type === 'MAGIC') row('width', sel([[1, '1 byte'], [2, '2 bytes'], [3, '3 bytes'], [4, '4 bytes']], f.w, v => { f.w = +v; changed(); }));
    if (f.type === 'LEN') {
      row('width', sel([[1, '1 byte'], [2, '2 bytes']], f.w, v => { f.w = +v; changed(); }));
      if (f.w === 2) row('order', sel([['BE', 'big-endian (high byte first)'], ['LE', 'little-endian (low byte first)']], f.endian, v => { f.endian = v; changed(); }));
      row('counts', sel(fieldOpts, f.from, v => { f.from = +v; if (f.to < f.from) f.to = f.from; changed(); }), 'to', sel(fieldOpts, f.to, v => { f.to = +v; if (f.to < f.from) f.from = f.to; changed(); }));
      ed.appendChild(el('div', 'note', 'The value must equal the number of bytes in those fields, inclusive.'));
    }
    if (f.type === 'SEQ') ed.appendChild(el('div', 'note', '1 byte. Checked: it must grow (by 1..16) from one frame to the next in the same direction.'));
    if (f.type === 'CMD') ed.appendChild(el('div', 'note', '1 byte: the opcode. The forge lets you pick any value you have seen.'));
    if (f.type === 'DATA') ed.appendChild(el('div', 'note', 'Variable length: whatever is left between the fields before and after it.'));
    if (f.type === 'CHECK') {
      row('algorithm', sel(LO.ALGO_ORDER.map(a => [a, LO.ALGOS[a].name]), f.algo, v => { f.algo = v; changed(); }));
      ed.appendChild(el('div', 'note', esc(LO.ALGOS[f.algo].note)));
      if (LO.ALGOS[f.algo].w === 2) row('order', sel([['BE', 'big-endian (high byte first)'], ['LE', 'little-endian (low byte first)']], f.endian || 'BE', v => { f.endian = v; changed(); }));
      row('covers', sel(fieldOpts, f.from, v => { f.from = +v; if (f.to < f.from) f.to = f.from; changed(); }), 'to', sel(fieldOpts, f.to, v => { f.to = +v; if (f.to < f.from) f.from = f.to; changed(); }));
    }
    const acts = el('div', 'er');
    const mk = (label, fn, dis) => { const b = el('button', 'small', label); b.type = 'button'; b.disabled = !!dis; b.onclick = fn; acts.appendChild(b); };
    mk('\u25c0 move', () => { swap(i, i - 1); S.selField = i - 1; changed(); }, i === 0);
    mk('move \u25b6', () => { swap(i, i + 1); S.selField = i + 1; changed(); }, i === fs.length - 1);
    mk('delete', () => { fs.splice(i, 1); fixRefsAfterDelete(i); S.selField = -1; changed(); });
    ed.appendChild(acts);
    return ed;
  }
  function swap(a, b) {
    const fs = S.dis.fields;
    [fs[a], fs[b]] = [fs[b], fs[a]];
    fs.forEach(f => {
      if (f.from === undefined) return;
      const m = x => x === a ? b : x === b ? a : x;
      f.from = m(f.from); f.to = m(f.to);
      if (f.to < f.from) [f.from, f.to] = [f.to, f.from];
    });
  }

  // ---------------- forge ----------------
  function seenCmds() {
    fresh_v();
    const map = new Map();
    if (!S.dis.fields.some(f => f.type === 'CMD')) return map;
    S.lab.caps.forEach((c, i) => {
      const p = S.v.per[i];
      if (c.dir !== 'tx' || !p.fit || p.cmd === null || c.excluded) return;
      if (!map.has(p.cmd)) map.set(p.cmd, new Set());
      map.get(p.cmd).add(c.src === 'player' ? 'you' : c.label.replace(/ \(.*\)/, ''));
    });
    return map;
  }
  function autoSeq() {
    fresh_v();
    let last = null;
    S.lab.caps.forEach((c, i) => { const p = S.v.per[i]; if (c.dir === 'tx' && c.session === 1 && !c.excluded && p.fit && p.seq !== null) last = p.seq; });
    return last === null ? 0 : (last + 1) & 0xFF;
  }
  function buildForge() {
    if ($('optRaw').checked) {
      const b = LO.parseHex(S.forge.raw);
      return b === null ? { err: 'raw: hex bytes only (00-FF), spaces optional' } : b.length ? { bytes: b } : { err: 'type some hex bytes' };
    }
    const probs = LO.problems(S.dis);
    if (probs.length) return { err: 'fix your dissector first: ' + probs[0] };
    const fs = S.dis.fields;
    const d = parseData(S.forge.data);
    if (d.err) return { err: 'DATA: ' + d.err };
    if (!fs.some(f => f.type === 'DATA') && d.bytes.length) return { err: 'your dissector has no DATA field' };
    let cmd = 0;
    if (fs.some(f => f.type === 'CMD')) {
      const c = LO.parseHex(S.forge.cmd);
      if (!c || c.length !== 1) return { err: 'CMD: one hex byte, e.g. 2A' };
      cmd = c[0];
    }
    let seq = autoSeq();
    if (S.forge.seq.trim()) { const q = LO.parseHex(S.forge.seq); if (!q || q.length !== 1) return { err: 'SEQ: one hex byte or empty for auto' }; seq = q[0]; }
    const magic = S.v.refMagic || [];
    if (fs.some(f => f.type === 'MAGIC') && !magic.length) return { err: 'no MAGIC seen in captures yet' };
    const bytes = LO.forge(S.dis, { magic, seq, cmd, data: d.bytes });
    return { bytes, strings: d.strings, plain: LO.applyXor(bytes, S.dis.xorKey, LO.xorStart(S.dis)) };
  }
  function renderForge() {
    const box = $('forge'); box.innerHTML = '';
    const raw = $('optRaw').checked;
    const fs = S.dis.fields;
    if (raw) {
      const r = el('div', 'fr'); r.appendChild(el('span', '', 'RAW'));
      const inp = el('input'); inp.type = 'text'; inp.value = S.forge.raw; inp.placeholder = 'e.g. A5 02 21 04 27'; inp.setAttribute('spellcheck', 'false'); inp.setAttribute('autocapitalize', 'characters');
      inp.oninput = () => { S.forge.raw = inp.value; updatePreview(); };
      r.appendChild(inp); box.appendChild(r);
      box.appendChild(el('div', 'fnote', 'Raw mode sends exactly these bytes: nothing is computed for you. Good for replay experiments.'));
    } else if (!fs.length) {
      box.appendChild(el('div', 'fnote', 'The forge builds frames from <b>your dissector</b>: MAGIC, LEN, SEQ and CHECK are filled in using your definitions. Build a dissector first (Wire tab), or use raw hex.'));
    } else {
      const cmds = seenCmds();
      fs.forEach((f, i) => {
        const r = el('div', 'fr');
        r.appendChild(el('span', '', `${i + 1} ${f.type}`));
        r.firstChild.style.color = `var(--f-${f.type.toLowerCase()})`;
        if (f.type === 'CMD') {
          const wrap = el('div', 'helpers');
          const inp = el('input'); inp.type = 'text'; inp.value = S.forge.cmd; inp.placeholder = 'hex'; inp.style.width = '64px'; inp.setAttribute('autocapitalize', 'characters'); inp.setAttribute('spellcheck', 'false');
          inp.oninput = () => { S.forge.cmd = inp.value; updatePreview(); };
          wrap.appendChild(inp);
          if (cmds.size) {
            const opts = [['', 'seen\u2026']].concat(Array.from(cmds.entries()).map(([c, set]) => [H2(c), `${H2(c)} \u00b7 ${Array.from(set).slice(0, 3).join(', ')}`]));
            wrap.appendChild(sel(opts, '', v => { if (v) { S.forge.cmd = v; renderForge(); } }));
          }
          r.appendChild(wrap);
        } else if (f.type === 'DATA') {
          const wrap = el('div');
          const inp = el('input'); inp.type = 'text'; inp.value = S.forge.data; inp.placeholder = 'hex, "text", le16:90, be16:300'; inp.setAttribute('spellcheck', 'false'); inp.setAttribute('autocomplete', 'off');
          inp.oninput = () => { S.forge.data = inp.value; updatePreview(); };
          wrap.appendChild(inp);
          const hp = el('div', 'helpers'); hp.style.marginTop = '5px';
          const num = el('input'); num.type = 'text'; num.inputMode = 'numeric'; num.placeholder = 'number';
          hp.appendChild(num);
          [['u8', 'u8'], ['le16', 'u16 LE'], ['be16', 'u16 BE']].forEach(([k, label]) => {
            const b = el('button', 'small', '+ ' + label); b.type = 'button';
            b.onclick = () => {
              const n = parseInt(num.value, 10);
              if (!(n >= 0) || n > (k === 'u8' ? 255 : 65535)) { toast(k === 'u8' ? 'u8 takes 0..255' : 'u16 takes 0..65535'); return; }
              const bytes = k === 'u8' ? [n] : LO.u16(n, k === 'le16' ? 'LE' : 'BE');
              S.forge.data = (S.forge.data.trim() + ' ' + LO.toHex(bytes)).trim(); renderForge();
            };
            hp.appendChild(b);
          });
          const clr = el('button', 'small', 'clear'); clr.type = 'button'; clr.onclick = () => { S.forge.data = ''; renderForge(); }; hp.appendChild(clr);
          wrap.appendChild(hp);
          wrap.appendChild(el('div', 'fnote', '')).id = 'strInfo';
          r.appendChild(wrap);
        } else if (f.type === 'SEQ') {
          const inp = el('input'); inp.type = 'text'; inp.value = S.forge.seq; inp.placeholder = `auto: ${H2(autoSeq())} (last seen + 1)`; inp.setAttribute('spellcheck', 'false');
          inp.oninput = () => { S.forge.seq = inp.value; updatePreview(); };
          r.appendChild(inp);
        } else if (f.type === 'MAGIC') {
          r.appendChild(el('span', 'auto', 'auto \u00b7 as captured'));
        } else r.appendChild(el('span', 'auto', 'auto \u00b7 computed by your dissector'));
        box.appendChild(r);
      });
    }
    const pv = el('div', 'preview bytes'); pv.id = 'fPreview'; box.appendChild(pv);
    const note = el('div', 'fnote'); note.id = 'fNote'; box.appendChild(note);
    const send = el('button', 'primary', 'Send to device'); send.type = 'button'; send.id = 'fSend';
    send.onclick = doSend;
    box.appendChild(send);
    updatePreview();
  }
  function updatePreview() {
    const r = buildForge();
    const pv = $('fPreview'), note = $('fNote'), send = $('fSend');
    if (!pv) return;
    if (r.err) { pv.innerHTML = ''; note.textContent = r.err; note.className = 'fnote bad'; send.disabled = true; return; }
    send.disabled = S.midnight;
    const raw = $('optRaw').checked;
    const spans = !raw && S.dis.fields.length ? LO.layout(S.dis, r.bytes.length) : null;
    pv.innerHTML = bytesHtml(r.bytes, spans, S.dis.fields, null, null);
    let n = `${r.bytes.length} bytes on the wire`;
    if (!raw && S.dis.xorKey && S.dis.xorKey.length) n += ' (scrambled with your XOR key)';
    note.textContent = n; note.className = 'fnote';
    const si = $('strInfo');
    if (si) si.textContent = r.strings && r.strings.length ? r.strings.map(s => `"${s.length > 26 ? s.slice(0, 24) + '\u2026' : s}" = ${s.length} bytes (${H2(s.length)})`).join(' \u00b7 ') : '';
  }

  // ---------------- actions ----------------
  function afterTraffic(r) {
    BENCH.traffic('tx'); if (r.rx) setTimeout(() => BENCH.traffic('rx'), 280);
    SFX.wire(r.tx.bytes, 'tx'); if (r.rx) setTimeout(() => SFX.wire(r.rx.bytes, 'rx'), 300);
    if (S.tab !== 'pWire' && window.innerWidth < 900) S.unseen += r.rx ? 2 : 1;
    S.ticks++;
  }
  function deviceFeedback(prevState) {
    const s = S.lab.state, k = kind();
    if (k === 'lock' && prevState.bolt !== s.bolt) setTimeout(SFX.clunk, 300);
    if (k === 'thermo' && (prevState.setpoint !== s.setpoint || prevState.mode !== s.mode)) setTimeout(SFX.beep, 320);
    updateFan();
  }
  function updateFan() {
    const s = S.lab.state, k = kind();
    if (k === 'purifier') SFX.fan(s.power ? s.speed : 0);
    else if (k === 'prov') SFX.fan(s.prov ? 1 : 0);
    else SFX.fan(0);
  }
  function appPress(id, btn) {
    if (S.midnight) { toast('The app cannot reach AirLux servers.'); SFX.nak(); return; }
    const prev = Object.assign({}, S.lab.state);
    const r = S.lab.appPress(id);
    if (!r) return;
    if (r.premium) { toast('Unlock from app requires AirLux Premium (\u20ac4.99/month).', 3200); SFX.nak(); return; }
    if (btn) { btn.classList.add('flash'); setTimeout(() => btn.classList.remove('flash'), 300); }
    afterTraffic(r);
    deviceFeedback(prev);
    renderAll();
  }
  function doSend() {
    if (S.midnight) return;
    const f = buildForge();
    if (f.err) { toast(f.err); return; }
    const prev = Object.assign({}, S.lab.state);
    const r = S.lab.send(f.bytes);
    revalidate();
    afterTraffic(r);
    const res = r.res;
    logLine('t', `\u2192 you   ${LO.toHex(f.bytes)}`);
    setTimeout(() => {
      if (res.accepted) {
        logLine('r', `\u2190 ${S.lab.spec.chatty ? 'ACK' : 'reply'}  ${LO.toHex(r.rx.bytes)}`);
        if (S.lab.level.key === 'prov') logLine('r', `   device: ${LO.PROV_STATUS[S.lab.state.prov === 'local' ? 0x11 : 0x10]}`);
        SFX.ack(); BENCH.blink(true);
      } else if (r.rx) {
        if (S.lab.level.key === 'prov') {
          const d = LO.parse(S.lab.spec.proto, r.rx.bytes).data || [];
          logLine('e', `\u2190 reply ${LO.toHex(r.rx.bytes)}\n   device: ${LO.PROV_STATUS[d[d.length - 1]] || 'error'}`);
        } else logLine('e', `\u2190 ${LO.toHex(r.rx.bytes)}\n   ${LO.describeError(res.err)}`);
        SFX.nak(); BENCH.blink(false);
      } else {
        logLine('n', res.err === 'MAGIC' && S.lab.spec.chatty ? '\u2026 no reply: ' + LO.describeError('MAGIC') : '\u2026 no reply. (the device ignored it)');
        SFX.drop();
      }
      if (res.goals && res.goals.length) {
        res.goals.forEach(id => { const g = S.lab.spec.goals.find(x => x.id === id); logLine('g', '\u2605 goal: ' + g.text); });
        SFX.goal(); toast('Goal complete!');
      }
      deviceFeedback(prev);
      renderGoals(); renderWalk();
      if (S.lab.allDone() && !S.completeShown) { S.completeShown = true; setTimeout(levelComplete, 1100); }
    }, 320);
    renderHeader(); renderTotals(); renderCaps(); renderInspect(); renderForge(); renderGoals(); renderWalk();
  }

  // ---------------- overlays ----------------
  function overlay(html, wire) {
    $('card').innerHTML = html; $('overlay').hidden = false;
    if (wire) wire($('card'));
    const first = $('card').querySelector('button'); if (first) first.focus({ preventScroll: true });
  }
  function closeOverlay() { $('overlay').hidden = true; }
  const starStr = n => '\u2605'.repeat(n) + '\u2606'.repeat(3 - n);
  function titleCard() {
    const started = run.unlocked > 1 || Object.keys(run.dis).length > 0;
    overlay(`<h1>LOCAL<b>ONLY</b></h1>
      <p class="lede">Friday 13 November 2026, 19:00</p>
      <div class="notice">AirLux end-of-service notice<br><br>The AirLux Cloud will be permanently shut down on Friday 13 November 2026 at 23:59. After this time the AirLux app will stop working and connected products may become unresponsive. Thank you for being part of the AirLux family.</div>
      <p>Your air purifier, your front-door lock and your thermostat all talk to that cloud. You have five hours, a logic sniffer, and an app that works until midnight. Learn how they talk. Then talk to them yourself.</p>
      <ul>
        <li>Press buttons in the <b>AirLux app</b>: every press puts a frame on the wire, captured by the <b>Sniffer</b>.</li>
        <li>Build a <b>dissector</b>, your guess at the frame layout. It is tested live against every captured frame: green means your guess explains it.</li>
        <li>The <b>Forge</b> builds frames with <i>your</i> dissector. Send them to make the device do what the app won't.</li>
      </ul>
      <p><small>In 1960 a paper in <i>Science</i> ("Doomsday: Friday, 13 November, A.D. 2026") predicted that the world population would become infinite today. AirLux's doomsday is smaller, and it's at midnight. AirLux and its devices are fictional; the techniques are real.</small></p>
      <div class="btns"><button type="button" class="primary" id="bGo">${started ? 'Continue' : 'Start'}</button><button type="button" id="bLv">Levels</button></div>`,
    c => {
      c.querySelector('#bGo').onclick = () => { closeOverlay(); startLevel(Math.min(run.cur || 0, run.unlocked - 1)); };
      c.querySelector('#bLv').onclick = () => { levelsCard(); };
    });
  }
  function levelsCard() {
    const total = Object.values(run.stars).reduce((a, b) => a + b, 0);
    let h = `<h2>Friday night</h2><p class="lede">Stars: ${total} / ${LO.LEVELS.length * 3}. Every rejected frame you send costs: 0-1 bad frames \u2605\u2605\u2605, 2-4 \u2605\u2605, more \u2605.</p><div class="lvls">`;
    LO.LEVELS.forEach((L, i) => {
      const locked = i + 1 > run.unlocked;
      h += `<button type="button" data-l="${i}" ${locked ? 'disabled' : ''}><span>${L.clock} \u00b7 ${L.id}. ${esc(L.title)}<br><small>${esc(L.sub)}</small></span><span class="stars">${run.stars[i] ? starStr(run.stars[i]) : locked ? '\u{1F512}' : ''}</span></button>`;
    });
    h += `</div><div class="btns">${run.done ? '<button type="button" id="bMid">Watch midnight again</button>' : ''}<button type="button" id="bNew">New run (new bytes)</button><button type="button" id="bClose">Close</button></div>`;
    overlay(h, c => {
      c.querySelectorAll('[data-l]').forEach(b => b.onclick = () => { closeOverlay(); startLevel(+b.dataset.l); });
      c.querySelector('#bClose').onclick = () => { closeOverlay(); if (!S.lab) startLevel(0); };
      c.querySelector('#bNew').onclick = () => { if (confirm('Start a new run? Magic bytes, opcodes, keys and checksums are reshuffled; progress and dissectors reset.')) { run = fresh(); save(); closeOverlay(); startLevel(0); } };
      const m = c.querySelector('#bMid'); if (m) m.onclick = () => { closeOverlay(); midnight(); };
    });
  }
  function levelComplete() {
    const li = S.li, stars = S.lab.stars();
    run.stars[li] = Math.max(run.stars[li] || 0, stars);
    run.unlocked = Math.max(run.unlocked, Math.min(LO.LEVELS.length, li + 2));
    const last = li === LO.LEVELS.length - 1;
    if (last) run.done = true;
    save();
    SFX.chime();
    const next = LO.LEVELS[li + 1];
    overlay(`<h2>${esc(S.lab.level.title)}: done</h2>
      <div class="stars">${starStr(stars)}</div>
      <p>Frames you sent: ${S.lab.sent}, rejected: ${S.lab.badFrames}.</p>
      <p class="lede">${LESSON[S.lab.level.key][1]}</p>
      <div class="btns">${last ? '<button type="button" class="primary" id="bNext">Wait for midnight</button>' : `<button type="button" class="primary" id="bNext">Next: ${next.clock} \u00b7 ${esc(next.title)}</button>`}<button type="button" id="bStay">Stay here</button></div>`,
    c => {
      c.querySelector('#bNext').onclick = () => { closeOverlay(); if (last) midnight(); else startLevel(li + 1); };
      c.querySelector('#bStay').onclick = closeOverlay;
    });
  }
  function midnight() {
    S.midnight = true;
    if (S.lab) { S.lab.state.cloud = false; renderAll(); }
    const total = Object.values(run.stars).reduce((a, b) => a + b, 0);
    const lines = [
      ['', '23:59:58  api.airlux-cloud.com  200 OK'],
      ['', '23:59:59  api.airlux-cloud.com  200 OK'],
      ['dead', '00:00:00  api.airlux-cloud.com  503 Service Unavailable'],
      ['dead', '00:00:03  mqtt.airlux-cloud.com:8883  connection refused'],
      ['dead', '00:00:07  flat 2F  purifier: "Cannot reach AirLux. Retrying\u2026"'],
      ['dead', '00:00:12  flat 3A  smart lock: offline, door stuck locked, locksmith called'],
      ['dead', '00:00:19  flat 1C  thermostat: offline, holding last setpoint forever'],
      ['alive', '00:00:21  your purifier  online via LOCAL server 10.0.0.2, fan humming'],
      ['alive', '00:00:21  your door lock  answering your frames on the LAN'],
      ['alive', '00:00:22  your thermostat  frost guard 7.0 \u00b0C, waiting for your trip'],
    ];
    overlay(`<h2>Midnight</h2><div class="ticker" id="tick"></div><div id="sum" hidden>
      <p>Stars: <span class="stars">${total}</span> / ${LO.LEVELS.length * 3}</p>
      <p class="lede">You framed, measured, proved, replayed, descrambled and re-provisioned: the same moves real reverse engineers use to keep hardware alive after its vendor walks away. AirLux is fictional, but cloud shutdowns that brick working hardware are not.</p>
      <div class="btns"><button type="button" class="primary" id="bAgain">New run with new bytes</button><button type="button" id="bLv2">Levels</button></div></div>`,
    c => {
      const tick = c.querySelector('#tick');
      let i = 0;
      const step = () => {
        if (i < lines.length) {
          const [cls, txt] = lines[i++];
          const d = el('div', cls); d.textContent = txt; tick.appendChild(d);
          if (i === 3) SFX.midnight('down'); else if (cls === 'alive') SFX.ack(); else SFX.click();
          setTimeout(step, reduced ? 120 : i < 3 ? 900 : 650);
        } else { c.querySelector('#sum').hidden = false; }
      };
      SFX.midnight(1);
      setTimeout(step, 500);
      c.querySelector('#bAgain').onclick = () => { run = fresh(); save(); closeOverlay(); startLevel(0); };
      c.querySelector('#bLv2').onclick = levelsCard;
    });
  }

  // ---------------- tabs / wiring ----------------
  function setTab(id) {
    S.tab = id;
    document.querySelectorAll('.panel').forEach(p => p.classList.toggle('on', p.id === id));
    document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === id));
    if (id === 'pWire') { S.unseen = 0; $('tabBadge').textContent = ''; const c = $('caps'); c.scrollTop = c.scrollHeight; }
    if (window.innerWidth < 900) window.scrollTo(0, 0);
  }
  document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => { SFX.click(); setTab(b.dataset.tab); });
  $('optReplies').onchange = renderCaps;
  $('optDiff').onchange = () => { if ($('optDiff').checked && S.sel < 0) toast('Select a frame first: others are compared with it.'); renderCaps(); };
  $('optRaw').onchange = () => { if ($('optRaw').checked && !S.forge.raw && S.sel >= 0) S.forge.raw = LO.toHex(S.lab.caps[S.sel].bytes); renderForge(); };
  $('btnLevels').onclick = () => { levelsCard(); };
  $('btnMute').onclick = () => { SFX.setMuted(!SFX.isMuted()); renderHeader(); updateFan(); };
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('overlay').hidden && S.lab) closeOverlay(); });

  // bench animation
  function frameLoop() {
    if (S.lab && document.visibilityState === 'visible') {
      const cv = $('bench');
      if (cv.offsetParent !== null) BENCH.draw(cv, kind(), S.lab.state, { reduced, local: S.lab.level.key === 'prov' && S.lab.state.prov === 'local' });
    }
    requestAnimationFrame(frameLoop);
  }

  // ---------------- self-test & demo ----------------
  function selfTest() {
    const out = [];
    LO.LEVELS.forEach((L, li) => {
      startLevel(li);
      S.dis = JSON.parse(JSON.stringify(S.lab.spec.proto));
      S.lab.spec.app.forEach(b => { if (!b.premium) appPress(b.id); });
      revalidate();
      const good = S.v.tot.allGood;
      const sol = {
        pads: [['SPEED', '04']], timer: [['TIMER', 'le16:90'], ['TIMER', 'le16:720']], lock: [['BOLT', '00'], ['AUTOLOCK', 'be16:300']],
        thermo: [['MODE', '01'], ['SETPOINT', 'be16:70']],
      }[L.key];
      if (sol) sol.forEach(([c, d]) => { S.forge.cmd = H2(S.lab.spec.cmds[c]); S.forge.data = d; const f = buildForge(); S.lab.send(f.bytes); });
      else {
        const cap = S.lab.caps.find(c => c.label.indexOf('Set up') === 0);
        let data = fmtData(LO.parse(S.lab.spec.proto, cap.bytes).data);
        // edit the URLs and their length bytes the way a player would
        const sp = S.lab.spec;
        data = data.replace(`${H2(sp.cloudUrls.ca.length)} "${sp.cloudUrls.ca}"`, `${H2(sp.home.ca.length)} "${sp.home.ca}"`)
          .replace(`${H2(sp.cloudUrls.cert.length)} "${sp.cloudUrls.cert}"`, `${H2(sp.home.cert.length)} "${sp.home.cert}"`);
        S.forge.data = data; S.forge.cmd = '';
        S.lab.send(buildForge().bytes);
      }
      out.push(`${L.key}:${good && S.lab.allDone() && S.lab.badFrames === 0 ? 'ok' : 'FAIL'}`);
    });
    // exercise the end-of-level and midnight overlays too
    S.completeShown = true; levelComplete(); levelsCard(); midnight();
    out.push('overlay:' + (document.querySelector('#tick') ? 'ok' : 'FAIL'));
    const pass = out.every(s => /ok$/.test(s));
    document.title = (pass ? 'SELFTEST PASS ' : 'SELFTEST FAIL ') + out.join(' ');
    const d = el('div', '', document.title); d.id = 'selftest'; document.body.appendChild(d);
    run = fresh(); // do not persist the test run
  }
  function demo() {
    run = fresh(); run.seed = 20261113;
    startLevel(0);
    ['s1', 's3', 'light', 'power', 'power', 's2'].forEach(id => S.lab.appPress(id));
    S.dis = { fields: [{ type: 'MAGIC', w: 1 }, { type: 'LEN', w: 1, endian: 'BE', from: 2, to: 3 }, { type: 'CMD' }, { type: 'DATA' }, { type: 'CHECK', algo: 'XOR8', endian: 'BE', from: 1, to: 3 }], xorKey: null };
    S.sel = 4; $('optDiff').checked = true; S.selField = 4;
    S.forge.cmd = H2(S.lab.spec.cmds.SPEED); S.forge.data = '04';
    renderAll();
  }

  // ---------------- boot ----------------
  // audio may only start after a user gesture
  window.addEventListener('pointerdown', () => SFX.init());
  window.addEventListener('keydown', () => SFX.init());
  window.addEventListener('resize', () => { if (window.innerWidth >= 900) document.querySelectorAll('.panel').forEach(p => p.classList.add('on')); else setTab(S.tab); });
  if (params.has('selftest')) { selfTest(); }
  else if (params.has('demo')) { demo(); }
  else { startLevel(Math.min(run.cur || 0, run.unlocked - 1)); titleCard(); }
  if (window.innerWidth >= 900) document.querySelectorAll('.panel').forEach(p => p.classList.add('on'));
  requestAnimationFrame(frameLoop);
  if (params.has('probe')) setTimeout(() => {   // layout probe for headless checks
    const tab = params.get('tab'); if (tab) setTab(tab);
    const wide = Array.from(document.querySelectorAll('body *')).filter(e => e.offsetParent !== null && e.getBoundingClientRect().right > window.innerWidth + 1).map(e => e.tagName + '#' + e.id + '.' + e.className).slice(0, 6);
    document.title = 'PROBE ' + JSON.stringify({ vw: window.innerWidth, sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight, wide });
  }, 300);
  window.__LO = { S, run: () => run, startLevel, buildForge };
})();
