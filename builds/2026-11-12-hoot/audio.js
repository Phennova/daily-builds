// HOOT - audio. Click trains are rendered sample by sample from the loop's gap sequence and pushed through a
// crude "hooter" model (damped resonance per pulse + soft clip). Nothing is synthesised from note names.
(function (root) {
  'use strict';
  const H = root.HOOT;
  let silent = false, ctx = null, master = null, muted = false, cur = null;
  try { muted = localStorage.getItem('hoot.muted') === '1'; } catch (e) {}

  function init() {
    if (silent) return null;
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return ctx; }
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.55;
    master.connect(ctx.destination);
    return ctx;
  }
  function setMuted(m) {
    muted = m;
    try { localStorage.setItem('hoot.muted', m ? '1' : '0'); } catch (e) {}
    if (master) master.gain.value = m ? 0 : 0.55;
  }
  const isMuted = () => muted;
  const rate = () => (ctx ? ctx.sampleRate : 44100);

  // Add the hooter pulse for a click at fractional sample position p.
  function pulse(buf, p, amp, sr) {
    const i0 = Math.floor(p), len = Math.floor(sr * 0.007);
    const w = 2 * Math.PI * 1500 / sr, dec = 1 / (sr * 0.0007);
    for (let n = 0; n < len; n++) {
      const j = i0 + n; if (j < 0 || j >= buf.length) continue;
      buf[j] += amp * Math.sin(w * (n + (p - i0))) * Math.exp(-n * dec);
    }
  }
  function finish(buf, sr) {
    for (let i = 0; i < buf.length; i++) buf[i] = Math.tanh(buf[i] * 1.8) * 0.8;
    return buf;
  }

  // Samples for `dur` seconds of the loop (slots) playing from its first instruction.
  function noteSamples(slots, dur, sr) {
    const a = H.analyze(slots), n = Math.max(1, Math.round(dur * sr)), buf = new Float32Array(n);
    if (!a) return buf;
    let t = 0, i = 0;
    while (t / sr < dur + 1) {
      const tt = t * H.TAU * sr; if (tt >= n) break;
      pulse(buf, tt, 0.55, sr);
      t += a.gaps[i % a.k]; i++;
    }
    return buf;
  }

  // Looping preview buffer: whole number of loop periods, >= 0.4 s.
  function loopBuffer(slots, sr) {
    const a = H.analyze(slots); if (!a) return null;
    const per = a.T * H.TAU, reps = Math.max(1, Math.ceil(0.4 / per));
    const n = Math.round(per * reps * sr), buf = new Float32Array(n);
    let t = 0;
    for (let r = 0; r < reps; r++) for (const g of a.gaps) { pulse(buf, t * H.TAU * sr, 0.55, sr); t += g; }
    return finish(buf, sr);
  }

  // Whole tune (pure, testable without an AudioContext). Returns {data, starts:[{t0,t1,note}]}
  function renderTune(level, layout, sr, acetate) {
    const spb = 60 / level.bpm, starts = [];
    let total = 0;
    for (const [ni, beats] of level.tune) { starts.push({ t0: total, t1: total + beats * spb * 0.97, note: ni }); total += beats * spb; }
    const n = Math.round((total + 0.3) * sr), buf = new Float32Array(n);
    starts.forEach(s => {
      if (s.note < 0) return;
      const l = layout[s.note]; if (!l || !l.slots.length) return;
      const seg = noteSamples(l.slots, s.t1 - s.t0, sr), off = Math.round(s.t0 * sr), fade = Math.floor(sr * 0.006);
      for (let i = 0; i < seg.length && off + i < n; i++) {
        const g = Math.min(1, (seg.length - i) / fade);
        buf[off + i] += seg[i] * g;
      }
    });
    finish(buf, sr);
    let data = buf;
    if (acetate) data = cutAcetate(buf, sr);
    return { data, starts, dur: total + 0.3 };
  }

  // 1951-ish disc: slow wow, dull top end, surface crackle. Deterministic PRNG so tests are stable.
  function cutAcetate(src, sr) {
    let seed = 1951; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const out = new Float32Array(src.length);
    let pos = 0, lp = 0, pop = 0;
    for (let i = 0; i < out.length; i++) {
      pos += 1 + 0.006 * Math.sin(i / sr * 2 * Math.PI * 0.55) + 0.002 * Math.sin(i / sr * 2 * Math.PI * 5.3);
      const p0 = Math.min(src.length - 2, Math.floor(pos)), fr = pos - p0;
      const v = src[p0] * (1 - fr) + src[p0 + 1] * fr;
      lp += 0.32 * (v - lp);
      if (rnd() < 14 / sr) pop = (rnd() * 0.5 + 0.1) * (rnd() < 0.5 ? -1 : 1);
      pop *= 0.82;
      out[i] = lp * 0.9 + pop + (rnd() - 0.5) * 0.02;
    }
    return out;
  }

  function stop() {
    if (cur) { try { cur.src.stop(); } catch (e) {} if (cur.timer) clearTimeout(cur.timer); cur = null; }
  }
  function playData(data, loop, onend, maxMs) {
    if (!init()) { if (onend) setTimeout(onend, (data.length / 44100) * 1000); return; }
    stop();
    const b = ctx.createBuffer(1, data.length, ctx.sampleRate); b.copyToChannel(data, 0);
    const src = ctx.createBufferSource(); src.buffer = b; src.loop = !!loop; src.connect(master); src.start();
    const me = { src, timer: null }; cur = me;
    if (!loop) src.onended = () => { if (cur === me) { cur = null; if (onend) onend(); } };
    if (maxMs) me.timer = setTimeout(() => { if (cur === me) { stop(); if (onend) onend(); } }, maxMs);
  }
  function previewLoop(slots, ms) {
    init(); const buf = loopBuffer(slots, rate()); if (buf) playData(buf, true, null, ms || 1800);
  }
  function playTune(level, layout, acetate, onend) {
    init();
    const r = renderTune(level, layout, rate(), acetate);
    playData(r.data, false, onend);
    return r;
  }
  // Tiny UI tick: a single hooter pulse.
  function tick(freq) {
    if (!init()) return;
    const sr = ctx.sampleRate, buf = new Float32Array(Math.round(sr * 0.04));
    pulse(buf, 0, 0.5, sr); finish(buf, sr);
    const b = ctx.createBuffer(1, buf.length, sr); b.copyToChannel(buf, 0);
    const s = ctx.createBufferSource(); s.buffer = b; s.playbackRate.value = freq || 1; s.connect(master); s.start();
  }

  root.HOOTAUDIO = { setSilent: v => { silent = v; }, init, setMuted, isMuted, stop, previewLoop, playTune, tick, renderTune, loopBuffer, noteSamples, cutAcetate };
})(this);
