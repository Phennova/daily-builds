// Greenlist - UI and game flow. Core logic lives in wm.js, content in nights.js.
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const Q = new URLSearchParams(location.search);
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------- storage ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem('greenlist.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('greenlist.' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
  };

  // ---------- audio ----------
  let unlocked = false; // browsers refuse AudioContext before a user gesture
  ['pointerdown', 'keydown', 'touchend'].forEach(ev => addEventListener(ev, () => { unlocked = true; }, { capture: true }));
  let AC = null, master = null, muted = store.get('muted', false), drone = null;
  function audio() {
    if (AC || muted || !unlocked) return AC;
    try {
      AC = new (window.AudioContext || window.webkitAudioContext)();
      master = AC.createGain(); master.gain.value = 0.5; master.connect(AC.destination);
    } catch (e) { AC = null; }
    return AC;
  }
  function tone(freq, dur, type, vol, slideTo, delay) {
    if (muted || !audio()) return;
    const t = AC.currentTime + (delay || 0);
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = type || 'square'; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol || 0.05, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur, vol, lp) {
    if (muted || !audio()) return;
    const n = Math.floor(AC.sampleRate * dur), buf = AC.createBuffer(1, n, AC.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = AC.createBufferSource(); s.buffer = buf;
    const f = AC.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp || 800;
    const g = AC.createGain(); g.gain.value = vol || 0.2;
    s.connect(f); f.connect(g); g.connect(master); s.start();
  }
  const sfx = {
    tick() { tone(1400 + Math.random() * 300, 0.03, 'square', 0.025); },
    pick() { tone(520, 0.07, 'triangle', 0.08); tone(780, 0.08, 'triangle', 0.06, null, 0.05); },
    deny() { tone(150, 0.15, 'sawtooth', 0.06); },
    sweep() { tone(180, 1.2, 'sawtooth', 0.025, 900); },
    stamp(ok) { noise(0.35, 0.5, 400); tone(ok ? 90 : 70, 0.35, 'sine', 0.3, 40); if (ok) tone(660, 0.25, 'triangle', 0.08, null, 0.12); },
    win() { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.25, 'triangle', 0.07, null, i * 0.09)); }
  };
  function startDrone() {
    if (muted || drone || !audio()) return;
    const g = AC.createGain(); g.gain.value = 0.018; g.connect(master);
    const a = AC.createOscillator(), b = AC.createOscillator();
    a.frequency.value = 55; b.frequency.value = 55.7; a.type = b.type = 'sine';
    a.connect(g); b.connect(g); a.start(); b.start(); drone = { g, a, b };
  }
  function stopDrone() { if (drone) { try { drone.a.stop(); drone.b.stop(); } catch (e) { } drone = null; } }
  function setMuted(m) {
    muted = m; store.set('muted', m);
    $('mute').classList.toggle('off', m); $('mute').setAttribute('aria-pressed', String(m));
    if (m) stopDrone(); else startDrone();
  }

  // ---------- state ----------
  const S = {
    ni: 0, night: null, parts: null, draft: null, choice: null, trace: null, par: null,
    phase: 'title', scan: null, scansLeft: 0, attempts: 0, scores: [], selSlot: -1, genUpto: 0, shownZ: 0, targetZ: 0,
    genTimer: 0, demo: Q.has('demo')
  };

  const cfgOf = n => ({ key: n.key, k: n.k, gamma: n.gamma });
  const evalNow = () => WM.evaluate(S.parts, S.choice, cfgOf(S.night));
  const changedCount = ch => ch.reduce((a, c, i) => a + (c !== S.draft[i] ? 1 : 0), 0);
  const isSpoof = () => S.night.mode === 'spoof';

  // ---------- walking the text ----------
  // Emits words/punct/space with token index, slot index and sentence index, matching WM.words() tokenisation.
  function walk(parts, choice, upto) {
    const items = []; let tok = 0, sent = 0;
    function feed(text, slot) {
      const re = /([A-Za-z0-9']+)|([.!?])|([^A-Za-z0-9'.!?]+)/g; let m;
      while ((m = re.exec(text))) {
        if (m[1]) {
          const stripped = m[1].replace(/^'+|'+$/g, '');
          if (stripped) items.push({ k: 'w', t: m[1], tok: tok++, slot, s: sent });
          else items.push({ k: 'p', t: m[1], slot, s: sent });
        } else if (m[2]) { items.push({ k: 'p', t: m[2], slot, s: sent }); items.push({ k: 'end', s: sent }); sent++; }
        else items.push({ k: 'sp', t: m[3], slot, s: sent });
      }
    }
    for (const p of parts) {
      if (p.type === 'text') { feed(p.text, -1); continue; }
      if (upto != null && p.slot >= upto) break;
      feed(p.opts[choice[p.slot]].text, p.slot);
    }
    return items;
  }

  // ---------- rendering the dispatch ----------
  function renderDispatch(opts) {
    opts = opts || {};
    const n = S.night, ev = evalNow();
    const showCol = n.show === 'colours' && !opts.hideColours;
    const upto = opts.upto;
    const items = walk(S.parts, S.choice, upto);
    let html = '', curSlot = null, buf = '';
    const flush = () => {
      if (curSlot == null) return;
      const changed = S.choice[curSlot] !== S.draft[curSlot];
      const cls = 'chip' + (changed ? ' changed' : '') + (S.selSlot === curSlot ? ' sel' : '') + (opts.locked ? ' ghost' : '');
      html += `<button class="${cls}" data-slot="${curSlot}" ${opts.locked ? 'tabindex="-1"' : ''} aria-label="word choice ${curSlot + 1}">${buf}</button>`;
      curSlot = null; buf = '';
    };
    const sentInfo = S.scan && n.show === 'scan' && !opts.hideColours ? S.scan.sent : null;
    for (const it of items) {
      const out = it.k === 'end' ? '' : (it.k === 'w'
        ? `<span class="w ${showCol ? (ev.col[it.tok] ? 'g' : 'r') : ''}">${esc(it.t)}</span>` : esc(it.t));
      if (it.slot >= 0) { if (curSlot !== it.slot) { flush(); curSlot = it.slot; } buf += out; }
      else { flush(); html += out; }
      if (it.k === 'end') {
        flush();
        if (sentInfo && sentInfo[it.s]) {
          const si = sentInfo[it.s], stale = sentSig(it.s) !== si.sig;
          html += `<span class="badge${stale ? ' stale' : ''}" title="green words in this sentence${stale ? ' (edited since scan)' : ''}">${si.g}/${si.n}</span>`;
        }
      }
    }
    flush();
    if (opts.cursor) html += '<span class="cursor"></span>';
    const el = $('dispatch'), top = el.scrollTop;
    el.innerHTML = html;
    el.scrollTop = opts.follow ? el.scrollHeight : top;
  }
  function sentSig(s) {
    const items = walk(S.parts, S.choice);
    const slots = new Set(items.filter(i => i.s === s && i.slot >= 0).map(i => i.slot));
    return [...slots].map(x => S.choice[x]).join(',');
  }
  function doScan() {
    const n = S.night, ev = evalNow(), items = walk(S.parts, S.choice), sent = {};
    for (const it of items) {
      if (it.k !== 'w') continue;
      const e = sent[it.s] || (sent[it.s] = { g: 0, n: 0, sig: '' });
      e.n++; if (ev.col[it.tok]) e.g++;
    }
    for (const s in sent) sent[s].sig = sentSig(+s);
    S.scan = { z: ev.z, sent, choiceSnap: S.choice.join(',') };
    S.targetZ = ev.z;
  }

  // ---------- gauge ----------
  const cv = $('gauge'), cx = cv.getContext('2d');
  let gW = 300, gH = 104, raf = 0;
  function sizeGauge() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    gW = cv.clientWidth || 300; gH = cv.clientHeight || 104;
    cv.width = Math.round(gW * dpr); cv.height = Math.round(gH * dpr);
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  const ZMIN = -3, ZMAX = 8;
  const pdf = z => Math.exp(-z * z / 2);
  function drawGauge() {
    const n = S.night; if (!n) return;
    const W = gW, H = gH, padX = 8, base = H - 20, top = 20;
    const X = z => padX + (z - ZMIN) / (ZMAX - ZMIN) * (W - 2 * padX);
    cx.clearRect(0, 0, W, H);
    const lo = n.passZ === 4 ? 4 : 2;
    const regions = [[ZMIN, 2, 'rgba(95,211,138,.28)'], [2, 4, 'rgba(232,176,74,.28)'], [4, ZMAX, 'rgba(217,105,95,.30)']];
    for (const [a, b, col] of regions) {
      cx.beginPath(); cx.moveTo(X(a), base);
      for (let z = a; z <= b + 0.001; z += 0.1) cx.lineTo(X(z), base - pdf(z) * (base - top));
      cx.lineTo(X(b), base); cx.closePath(); cx.fillStyle = col; cx.fill();
    }
    cx.strokeStyle = '#8b8f98'; cx.lineWidth = 1; cx.beginPath();
    for (let z = ZMIN; z <= ZMAX; z += 0.1) { const x = X(z), y = base - pdf(z) * (base - top); z === ZMIN ? cx.moveTo(x, y) : cx.lineTo(x, y); }
    cx.stroke();
    cx.beginPath(); cx.moveTo(padX, base); cx.lineTo(W - padX, base); cx.stroke();
    cx.font = '10px ui-monospace,Consolas,monospace'; cx.textAlign = 'center'; cx.fillStyle = '#8b8f98';
    cx.fillText('HUMAN', (X(ZMIN) + X(2)) / 2, H - 6);
    cx.fillText('UNCERTAIN', X(3), H - 6);
    cx.fillText('MACHINE', (X(4) + X(ZMAX)) / 2, H - 6);
    // goal line
    cx.setLineDash([3, 3]); cx.strokeStyle = '#e4e1d6'; cx.beginPath(); cx.moveTo(X(lo), top - 6); cx.lineTo(X(lo), base); cx.stroke(); cx.setLineDash([]);
    cx.textAlign = 'left'; cx.fillText(isSpoof() ? 'GOAL z>=4' : 'GOAL z<2', Math.min(X(lo) + 4, W - 70), 12);
    // needle
    const blind = n.show === 'scan';
    const unknown = blind && !S.scan;
    if (!unknown) {
      const stale = blind && S.scan && S.scan.choiceSnap !== S.choice.join(',');
      const z = Math.max(ZMIN, Math.min(ZMAX, S.shownZ));
      cx.globalAlpha = stale ? 0.45 : 1;
      cx.strokeStyle = '#fff'; cx.lineWidth = 2; cx.beginPath(); cx.moveTo(X(z), top - 4); cx.lineTo(X(z), base + 2); cx.stroke();
      cx.fillStyle = '#fff'; cx.beginPath(); cx.moveTo(X(z) - 5, top - 8); cx.lineTo(X(z) + 5, top - 8); cx.lineTo(X(z), top); cx.fill();
      cx.globalAlpha = 1;
    }
    cx.textAlign = 'right'; cx.fillStyle = '#e4e1d6'; cx.font = 'bold 13px ui-monospace,Consolas,monospace';
    const label = unknown ? 'z ?  (scan to read)' : 'z ' + (blind ? S.scan.z : S.targetZ).toFixed(2) + (blind && S.scan.choiceSnap !== S.choice.join(',') ? ' (stale)' : '');
    cx.fillText(label, W - padX, 12);
  }
  function animateGauge() {
    cancelAnimationFrame(raf);
    const step = () => {
      const d = S.targetZ - S.shownZ;
      if (REDUCED || Math.abs(d) < 0.01) { S.shownZ = S.targetZ; drawGauge(); return; }
      S.shownZ += d * 0.18; drawGauge(); raf = requestAnimationFrame(step);
    };
    step();
  }

  // ---------- HUD ----------
  function updateHud(ev) {
    ev = ev || evalNow();
    const n = S.night, used = changedCount(S.choice);
    $('nightlabel').textContent = `NIGHT ${n.id}/${NIGHTS.length} - ${n.title.toUpperCase()}`;
    $('swaps').innerHTML = 'SWAPS ' + Array.from({ length: n.maxChanged }, (_, i) => `<i class="${i < used ? 'used' : ''}"></i>`).join('');
    const ppl = WM.pplFromAwk(S.parts, ev.awk), cap = WM.pplFromAwk(S.parts, n.maxAwk), p0 = WM.pplFromAwk(S.parts, 0);
    const maxP = cap * 1.5;
    $('pplval').textContent = `perplexity ${ppl.toFixed(1)} / cap ${cap.toFixed(1)}`;
    $('pplbar').style.width = Math.min(100, ((ppl - p0 * 0.9) / (maxP - p0 * 0.9)) * 100) + '%';
    $('pplbar').classList.toggle('bad', ev.awk > n.maxAwk);
    $('pplcap').style.left = ((cap - p0 * 0.9) / (maxP - p0 * 0.9)) * 100 + '%';
    $('btn-scan').hidden = !(n.scans > 0);
    $('btn-scan').textContent = `SCAN (${S.scansLeft})`;
    $('btn-scan').disabled = S.scansLeft <= 0 || S.phase !== 'edit';
    if (n.show === 'colours') S.targetZ = ev.z;
    animateGauge();
  }

  // ---------- sheet ----------
  function openSheet(slot) {
    if (S.phase !== 'edit') return;
    S.selSlot = slot;
    const part = S.parts.find(p => p.type === 'slot' && p.slot === slot), n = S.night, cur = evalNow();
    $('sheettitle').textContent = `Word ${slot + 1} - choose a wording`;
    const used = changedCount(S.choice);
    $('options').innerHTML = part.opts.map((o, i) => {
      const trial = S.choice.slice(); trial[slot] = i;
      const lock = i !== S.draft[slot] && S.choice[slot] === S.draft[slot] && used >= n.maxChanged;
      let dz = '';
      if (n.preview && i !== S.choice[slot]) {
        const e2 = WM.evaluate(S.parts, trial, cfgOf(n)), d = e2.z - cur.z;
        const good = isSpoof() ? d > 0 : d < 0;
        dz = `<span class="dz ${good ? '' : 'up'}">${d >= 0 ? '+' : ''}${d.toFixed(2)} z</span>`;
      }
      const dots = o.awk ? '&#9679;'.repeat(Math.min(o.awk, 6)) : '&#9675;';
      return `<button class="opt${i === S.choice[slot] ? ' cur' : ''}${i === S.draft[slot] ? ' draft' : ''}" data-opt="${i}" ${lock ? 'disabled' : ''}>` +
        `<span class="t">${i < 9 ? i + 1 + '. ' : ''}${esc(o.text)}</span><span class="m"><span class="dots" title="awkwardness">${dots}</span>${dz}${lock ? '<span>no swaps left</span>' : ''}</span></button>`;
    }).join('');
    $('sheet').hidden = false; $('actions').hidden = true;
    renderDispatch();
    const chip = $('dispatch').querySelector(`[data-slot="${slot}"]`);
    if (chip && chip.scrollIntoView) chip.scrollIntoView({ block: 'nearest' });
  }
  function closeSheet() {
    S.selSlot = -1; $('sheet').hidden = true; $('actions').hidden = false;
    if (S.phase === 'edit') renderDispatch();
  }
  function pick(slot, opt) {
    const was = S.choice[slot];
    if (was === opt) { closeSheet(); return; }
    const trial = S.choice.slice(); trial[slot] = opt;
    if (changedCount(trial) > S.night.maxChanged) { sfx.deny(); toast('No swaps left - undo one first'); return; }
    S.choice = trial; sfx.pick();
    closeSheet(); renderDispatch(); updateHud();
  }

  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast.h); toast.h = setTimeout(() => { t.hidden = true; }, 1800);
  }

  // ---------- overlay cards ----------
  function card(html, onReady) {
    $('card').innerHTML = html; $('overlay').hidden = false;
    $('card').scrollTop = 0;
    if (onReady) onReady($('card'));
  }
  function hideCard() { $('overlay').hidden = true; }

  function showTitle() {
    S.phase = 'title'; S.ni = 0; S.scores = []; S.attempts = 0;
    stopDrone();
    const best = store.get('best', {});
    const tot = Object.values(best).reduce((a, b) => a + b, 0);
    card(`<h1>GREEN<span>LIST</span></h1>
      <div class="sub">MINISTRY OF PROVENANCE &middot; 2031</div>
      <p>Every sentence published in the republic must be certified <b>HUMAN</b> or <b>MACHINE</b>. Machine text is traced to its licence holder.</p>
      <p>The underground press drafts its dispatches with <b>SCRIBE</b>, a stolen language model. SCRIBE hides a secret statistical watermark in every word it writes. Each night: swap synonyms until the Ministry's detector stops seeing it, without making the prose so clumsy that the <i>other</i> detector flags it as unnatural.</p>
      <details><summary>How the watermark works (real science)</summary>
        <p>This is the "green list" scheme of Kirchenbauer et al. (2023). A secret key plus the previous word is hashed to split the vocabulary into <span class="good">green</span> (25%) and red words. The model nudges its choices towards green. Human text is green about 25% of the time; watermarked text far more.</p>
        <p>The detector counts green words and computes <code>z = (G - 0.25N) / sqrt(0.25 * 0.75 * N)</code>. Above 4 is "machine", under 2 is "human".</p>
        <p>Because a word's colour depends on the word before it, swapping one word also re-rolls its neighbour. That is the whole puzzle.</p></details>
      <details><summary>Controls</summary><p>Tap a dotted word to see its alternatives. Dots under an option show how awkward it sounds. Amber underline = changed from the draft. Keys: 1-4 pick, Esc closes, Enter submits.</p></details>
      ${tot ? `<p class="sub">BEST TOTAL SO FAR: ${tot}</p>` : ''}
      <div class="row"><button class="primary" id="go">BEGIN</button></div>`, c => {
      c.querySelector('#go').onclick = () => { audio(); startDrone(); beginNight(0); };
    });
  }

  function beginNight(i) {
    S.ni = i; S.night = NIGHTS[i]; S.attempts = 0;
    const n = S.night;
    S.parts = WM.parseTemplate(n.text);
    const g = WM.generateInBand(S.parts, n, n.delta, n.band[0], n.band[1], n.seed);
    S.draft = g.choice.slice(); S.choice = g.choice.slice(); S.trace = g.trace;
    S.par = null; S.scan = null; S.scansLeft = n.scans; S.selSlot = -1; S.phase = 'brief';
    S.shownZ = 0; S.targetZ = 0;
    $('dispatch').innerHTML = ''; $('sampler').hidden = true; $('stamp').hidden = true;
    updateHud(WM.evaluate(S.parts, S.draft, cfgOf(n)));
    S.shownZ = S.targetZ = 0; drawGauge();
    const spoof = isSpoof();
    card(`<div class="sub">NIGHT ${n.id} OF ${NIGHTS.length}</div><h2>${esc(n.title)}</h2>
      <p>${esc(n.brief)}</p>
      <dl class="stats">
        <dt>Goal</dt><dd>${spoof ? 'detector score <b>z &ge; 4.0</b> (stamped MACHINE)' : 'detector score <b>z &lt; 2.0</b> (stamped HUMAN)'}</dd>
        <dt>Swaps</dt><dd>at most ${n.maxChanged} words changed from the draft</dd>
        <dt>Fluency</dt><dd>perplexity at most ${WM.pplFromAwk(S.parts, n.maxAwk).toFixed(1)}</dd>
        ${n.scans ? `<dt>Scanner</dt><dd>${n.scans} charges</dd>` : ''}
      </dl>
      <div class="row"><button class="primary" id="go">${spoof ? 'LOAD THE SPEECH' : 'SCRIBE, WRITE'}</button></div>`, c => {
      c.querySelector('#go').onclick = () => { audio(); startDrone(); hideCard(); generate(); };
    });
  }

  // ---------- generation animation ----------
  function generate() {
    S.phase = 'gen';
    const n = S.night, tr = S.trace;
    $('actions').hidden = true; closeSheetQuiet();
    S.genUpto = 0;
    if (isSpoof()) { // nothing to generate: the Minister's own hand-written text; show instantly
      S.phase = 'edit'; finishGeneration(); return;
    }
    $('sampler').hidden = false;
    const base = tr.map(t => t.cands.map(c => Math.exp(c.base)));
    const step = () => {
      if (S.phase !== 'gen') return;
      if (S.genUpto >= tr.length) { finishGeneration(); return; }
      const t = tr[S.genUpto], sb = base[S.genUpto].reduce((a, b) => a + b, 0);
      S.genUpto++;
      renderDispatch({ upto: S.genUpto, hideColours: false, cursor: true, follow: true, locked: true });
      const rows = t.cands.map((c, i) => {
        const lab = esc(S.parts.find(p => p.type === 'slot' && p.slot === t.slot).opts[i].text);
        return `<div class="row"><div class="lab${i === t.pick ? ' pick' : ''}">${i === t.pick ? '&#9658; ' : ''}${lab}</div><div class="track">` +
          `<div class="wm${c.green ? '' : ' red'}" style="width:${(c.p * 100).toFixed(1)}%"></div><div class="base" style="width:${(base[S.genUpto - 1][i] / sb * 100).toFixed(1)}%;opacity:.8"></div></div></div>`;
      }).join('');
      $('sampler').innerHTML = `<div style="color:var(--dim);margin-bottom:3px">SCRIBE sampling word ${S.genUpto}/${tr.length}</div>${rows}` +
        `<div class="hint">grey = what the base model wants &middot; <span class="good">green</span> = after +&delta; boost for green-list words</div>`;
      sfx.tick();
      S.genTimer = setTimeout(step, S.demo ? 30 : 150);
    };
    if (REDUCED) { S.genUpto = tr.length; finishGeneration(); return; }
    $('sampler').onclick = $('dispatch').onclick = null;
    $('sampler').onclick = () => { if (S.phase === 'gen') { clearTimeout(S.genTimer); finishGeneration(); } };
    step();
  }
  function closeSheetQuiet() { S.selSlot = -1; $('sheet').hidden = true; }
  function finishGeneration() {
    clearTimeout(S.genTimer);
    $('sampler').hidden = true; $('sampler').onclick = null;
    S.phase = 'edit'; $('actions').hidden = false; $('btn-submit').disabled = false;
    renderDispatch({ follow: false }); $('dispatch').scrollTop = 0;
    const n = S.night, ev = evalNow();
    if (n.show === 'colours') { S.shownZ = 0; S.targetZ = ev.z; }
    updateHud(ev);
    const awkOver = ev.awk > n.maxAwk;
    toast(isSpoof() ? 'Tap words to edit the speech' : (awkOver ? 'SCRIBE made it clunky too (above the fluency cap)' : 'Draft ready - tap a dotted word'));
    if (S.demo) runDemo();
  }

  // ---------- par (computed lazily) ----------
  function computePar() {
    if (S.par) return S.par;
    const n = S.night, cfg = cfgOf(n), spoof = isSpoof();
    for (let m = 0; m <= n.maxChanged; m++) {
      const r = WM.solve(S.parts, S.draft, cfg, m, n.maxAwk, spoof);
      if (r && (spoof ? r.ev.z >= n.passZ : r.ev.z < n.passZ)) { S.par = { swaps: m, choice: r.choice, z: r.ev.z }; return S.par; }
    }
    S.par = { swaps: n.maxChanged, choice: S.draft.slice(), z: NaN }; return S.par;
  }

  // ---------- submit / verdict ----------
  function verdictOf(ev) {
    const n = S.night;
    if (isSpoof()) {
      if (ev.awk > n.maxAwk) return { cls: 'unnat', text: 'UNNATURAL', ok: false, why: 'The speech reads too strangely to be believed as the Minister\'s own prose or SCRIBE\'s.' };
      if (ev.z >= n.passZ) return { cls: 'machine', text: 'MACHINE-GENERATED', ok: true, why: 'The Minister\'s hand-written broadcast is now certified as machine text. Spoofed.' };
      return { cls: ev.z >= 2 ? 'unc' : 'human', text: ev.z >= 2 ? 'UNCERTAIN' : 'HUMAN-AUTHORED', ok: false, why: `Score ${ev.z.toFixed(2)} is below ${n.passZ}: the Ministry still believes the Minister.` };
    }
    if (ev.awk > n.maxAwk) return { cls: 'unnat', text: 'UNNATURAL', ok: false, why: 'The perplexity filter flagged it: nobody writes like that.' };
    if (ev.z < n.passZ) return { cls: 'human', text: 'HUMAN-AUTHORED', ok: true, why: 'The watermark is gone and the prose reads like a person wrote it.' };
    if (ev.z >= 4) return { cls: 'machine', text: 'MACHINE-GENERATED', ok: false, why: `Score ${ev.z.toFixed(2)}: the watermark is still plainly visible.` };
    return { cls: 'unc', text: 'UNCERTAIN', ok: false, why: `Score ${ev.z.toFixed(2)} is in the grey zone. The Ministry holds anything above ${n.passZ.toFixed(1)}.` };
  }

  function submit() {
    if (S.phase !== 'edit') return;
    closeSheet(); S.phase = 'scanning';
    const n = S.night, ev = evalNow(), v = verdictOf(ev);
    $('btn-submit').disabled = true;
    // reveal truth during the scan
    const reveal = () => {
      renderDispatch({ hideColours: false });
      if (n.show === 'scan') { S.shownZ = ev.z; }
      S.targetZ = ev.z; if (n.show === 'scan') { S.scan = S.scan || { z: ev.z, sent: {}, choiceSnap: '' }; S.scan.z = ev.z; S.scan.choiceSnap = S.choice.join(','); }
      // in blind mode show true colours at the verdict
      if (n.show === 'scan') {
        const saved = n.show; n.show = 'colours'; renderDispatch(); n.show = saved;
      }
      animateGauge();
    };
    const line = $('scanline'), dur = REDUCED ? 100 : 1300;
    line.hidden = false; line.classList.remove('go'); void line.offsetWidth; if (!REDUCED) line.classList.add('go');
    sfx.sweep();
    setTimeout(() => {
      line.hidden = true; reveal();
      const st = $('stamp'); st.className = v.cls; st.textContent = v.text; st.hidden = false; void st.offsetWidth; st.classList.add('show');
      sfx.stamp(v.ok);
      setTimeout(() => showResult(ev, v), REDUCED || S.demo === 'fast' ? 100 : 1500);
    }, dur);
  }

  function showResult(ev, v) {
    const n = S.night, used = changedCount(S.choice), par = computePar();
    const cap = WM.pplFromAwk(S.parts, n.maxAwk), ppl = WM.pplFromAwk(S.parts, ev.awk);
    let score = 0;
    if (v.ok) {
      const zMargin = isSpoof() ? ev.z - n.passZ : n.passZ - ev.z;
      score = 300 + 50 * (n.maxChanged - used) + Math.round(40 * Math.max(0, zMargin)) + Math.round(8 * Math.max(0, cap - ppl)) +
        (used <= par.swaps ? 150 : 0) - 100 * S.attempts;
      score = Math.max(50, score);
      S.scores[S.ni] = score; sfx.win();
      const best = store.get('best', {}); if (!best[n.id] || score > best[n.id]) { best[n.id] = score; store.set('best', best); }
    }
    const last = S.ni === NIGHTS.length - 1;
    card(`<div class="sub">NIGHT ${n.id} &middot; ${v.ok ? 'DISPATCH SENT' : 'DISPATCH INTERCEPTED'}</div>
      <h2 class="${v.ok ? 'good' : 'bad'}">${esc(v.text)}</h2><p>${esc(v.why)}</p>
      <dl class="stats">
        <dt>Detector score</dt><dd>z = ${ev.z.toFixed(2)} (goal ${isSpoof() ? '&ge;' : '&lt;'} ${n.passZ.toFixed(1)}), ${ev.G}/${ev.N} green</dd>
        <dt>Perplexity</dt><dd class="${ev.awk > n.maxAwk ? 'bad' : ''}">${ppl.toFixed(1)} (cap ${cap.toFixed(1)})</dd>
        <dt>Swaps</dt><dd>${used} of ${n.maxChanged}, par ${par.swaps}${v.ok && used <= par.swaps ? ' &#9733; PAR' : ''}</dd>
        ${v.ok ? `<dt>Score</dt><dd class="good"><b>${score}</b>${S.attempts ? ` (after ${S.attempts} failed attempt${S.attempts > 1 ? 's' : ''})` : ''}</dd>` : ''}
      </dl>
      <div class="row">${v.ok ? `<button class="primary" id="next">${last ? 'FINISH' : 'NEXT NIGHT'}</button>`
        : '<button id="back">KEEP EDITING</button><button class="primary" id="retry">NEW COPY OF DRAFT</button>'}</div>`, c => {
      if (v.ok) c.querySelector('#next').onclick = () => { $('stamp').hidden = true; hideCard(); last ? showEnd() : beginNight(S.ni + 1); };
      else {
        c.querySelector('#back').onclick = () => { $('stamp').hidden = true; hideCard(); S.attempts++; S.phase = 'edit'; $('btn-submit').disabled = false; renderDispatch(); updateHud(); };
        c.querySelector('#retry').onclick = () => { $('stamp').hidden = true; hideCard(); S.attempts++; S.choice = S.draft.slice(); S.scan = null; S.phase = 'edit'; $('btn-submit').disabled = false; S.shownZ = 0; renderDispatch(); updateHud(); };
      }
    });
  }

  function showEnd() {
    S.phase = 'end'; stopDrone();
    const total = S.scores.reduce((a, b) => a + (b || 0), 0), bestT = store.get('bestTotal', 0);
    if (total > bestT) store.set('bestTotal', total);
    card(`<div class="sub">THE PRESS ENDURES</div><h2>All five dispatches sent</h2>
      <dl class="stats"><dt>Total score</dt><dd class="good"><b>${total}</b></dd><dt>Best total</dt><dd>${Math.max(total, bestT)}</dd></dl>
      <p><b>What was real:</b> the green-list watermark, the hash colouring, the z-test and the "swapping a word re-colours its neighbour" effect are the actual scheme from Kirchenbauer et al., "A Watermark for Large Language Models" (2023), scaled down to a few dozen words. Real models have 100,000-word vocabularies and hundreds of tokens, which is why real watermarks are much harder to scrub by hand, and why long texts are easier to detect.</p>
      <p><b>What was a game:</b> the synonym menus, the "perplexity" meter (a simple awkwardness model, not a real LM) and the Ministry. Night 5 is the spoofing attack: anyone with the key can make human text look machine-written, which is why a watermark is evidence, not proof.</p>
      <div class="row"><button class="primary" id="again">PLAY AGAIN</button></div>`, c => {
      c.querySelector('#again').onclick = () => { hideCard(); showTitle(); };
    });
  }

  // ---------- demo ----------
  function runDemo() {
    const par = computePar(), diffs = [];
    par.choice.forEach((c, i) => { if (c !== S.draft[i]) diffs.push(i); });
    let i = 0;
    const next = () => {
      if (i >= diffs.length) { if (Q.get('demo') === 'submit') setTimeout(() => { S.demo = 'fast'; submit(); }, 300); return; }
      const slot = diffs[i++]; S.choice[slot] = par.choice[slot];
      renderDispatch(); updateHud(); setTimeout(next, 120);
    };
    setTimeout(next, 200);
  }

  // ---------- events ----------
  $('dispatch').addEventListener('click', e => {
    const b = e.target.closest('.chip'); if (!b || S.phase !== 'edit') return;
    openSheet(+b.dataset.slot);
  });
  $('options').addEventListener('click', e => {
    const b = e.target.closest('.opt'); if (!b || b.disabled) return;
    pick(S.selSlot, +b.dataset.opt);
  });
  $('sheetclose').onclick = closeSheet;
  $('btn-submit').onclick = submit;
  $('btn-reset').onclick = () => {
    if (S.phase !== 'edit') return;
    S.choice = S.draft.slice(); S.scan = null; closeSheet(); renderDispatch(); updateHud(); toast('Back to the draft');
  };
  $('btn-scan').onclick = () => {
    if (S.phase !== 'edit' || S.scansLeft <= 0) return;
    S.scansLeft--; sfx.sweep(); doScan(); S.shownZ = S.targetZ;
    renderDispatch(); updateHud();
    const l = $('scanline'); l.hidden = false; l.classList.remove('go'); void l.offsetWidth; if (!REDUCED) l.classList.add('go');
    setTimeout(() => { l.hidden = true; }, 1300);
  };
  $('mute').onclick = () => setMuted(!muted);
  addEventListener('keydown', e => {
    if (!$('overlay').hidden) { if (e.key === 'Enter') { const b = $('card').querySelector('.primary'); if (b) b.click(); } return; }
    if (e.key === 'Escape') closeSheet();
    else if (e.key >= '1' && e.key <= '9' && S.selSlot >= 0) { const o = $('options').querySelector(`[data-opt="${+e.key - 1}"]`); if (o && !o.disabled) pick(S.selSlot, +e.key - 1); }
    else if (e.key === 'Enter' && S.phase === 'edit' && S.selSlot < 0 && document.activeElement === document.body) submit();
  });
  addEventListener('resize', () => { sizeGauge(); drawGauge(); });
  $('mute').classList.toggle('off', muted);

  // ---------- boot ----------
  sizeGauge();
  const startNight = Q.get('night') ? Math.max(0, Math.min(NIGHTS.length - 1, +Q.get('night') - 1)) : null;
  if (Q.has('demo') || startNight != null) {
    S.night = NIGHTS[startNight || 0];
    if (Q.has('demo')) { beginNight(startNight || 0); hideCard(); generate(); }
    else beginNight(startNight);
  } else { S.night = NIGHTS[0]; S.parts = WM.parseTemplate(S.night.text); S.choice = S.draft = S.parts.filter(p => p.type === 'slot').map(() => 0); showTitle(); }

  window.GL = { S, evalNow, computePar, verdictOf }; // handy for tests/debug
  if (Q.has('report')) setTimeout(() => { // layout self-check for headless runs
    const r = id => { const b = $(id).getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; };
    const px = cx.getImageData(0, 0, cv.width, cv.height).data; let lit = 0; for (let i = 3; i < px.length; i += 4) if (px[i]) lit++;
    document.body.setAttribute('data-report', JSON.stringify({ vw: innerWidth, vh: innerHeight, dispatch: r('dispatch'), meters: r('meters'), actions: r('actions'), sheet: r('sheet'),
      overlayHidden: $('overlay').hidden, phase: S.phase, chips: document.querySelectorAll('.chip').length, green: document.querySelectorAll('.w.g').length,
      words: document.querySelectorAll('.w').length, gaugePixels: lit, z: S.targetZ, swaps: changedCount(S.choice), stamp: $('stamp').textContent, card: $('card').innerText.slice(0, 160) }));
  }, +(Q.get('report')) || 6000);
})();
