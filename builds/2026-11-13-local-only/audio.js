// LOCAL ONLY - procedural WebAudio (no samples). window.SFX
(function () {
  'use strict';
  let ctx = null, master = null, muted = false;
  let fanSrc = null, fanFilt = null, fanGain = null, fanTarget = 0;
  try { muted = localStorage.getItem('lo-muted') === '1'; } catch (e) { /* private mode */ }

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.7;
    master.connect(ctx.destination);
    // fan: looping brown-ish noise through a band-pass, level/pitch follow the speed
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.035 * (Math.random() * 2 - 1)) / 1.035; d[i] = last * 3.2; }
    fanSrc = ctx.createBufferSource(); fanSrc.buffer = buf; fanSrc.loop = true;
    fanFilt = ctx.createBiquadFilter(); fanFilt.type = 'bandpass'; fanFilt.Q.value = 0.7; fanFilt.frequency.value = 300;
    fanGain = ctx.createGain(); fanGain.gain.value = 0;
    fanSrc.connect(fanFilt); fanFilt.connect(fanGain); fanGain.connect(master);
    fanSrc.start();
    fan(fanTarget);
  }
  function setMuted(m) {
    muted = m;
    try { localStorage.setItem('lo-muted', m ? '1' : '0'); } catch (e) { /* ignore */ }
    if (master) master.gain.setTargetAtTime(m ? 0 : 0.7, ctx.currentTime, 0.05);
  }
  function fan(speed) {
    fanTarget = speed;
    if (!ctx) return;
    const t = ctx.currentTime;
    const g = speed <= 0 ? 0 : 0.05 + 0.045 * speed;
    fanGain.gain.setTargetAtTime(g, t, 0.6);
    fanFilt.frequency.setTargetAtTime(180 + 140 * speed, t, 0.6);
  }
  function tone(freq, start, dur, type, vol, slideTo) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, start);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, start + dur);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(vol || 0.05, start + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g); g.connect(master);
    o.start(start); o.stop(start + dur + 0.02);
  }
  function noise(start, dur, vol, freq, q) {
    const n = Math.floor(ctx.sampleRate * dur);
    const b = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2);
    const s = ctx.createBufferSource(); s.buffer = b;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq || 800; f.Q.value = q || 1;
    const g = ctx.createGain(); g.gain.value = vol || 0.3;
    s.connect(f); f.connect(g); g.connect(master); s.start(start);
  }
  const ready = () => ctx && !muted;
  // a frame on the wire: one short blip per byte, pitch from the byte value (it sounds like data)
  function wire(bytes, dir) {
    if (!ready()) return;
    const t0 = ctx.currentTime + 0.01, step = 0.018;
    const base = dir === 'rx' ? 900 : 1300;
    bytes.slice(0, 40).forEach((b, i) => tone(base + (b & 0xF0) * 3 + (b & 0x0F) * 9, t0 + i * step, step * 0.7, 'square', 0.018));
  }
  function ack() { if (!ready()) return; const t = ctx.currentTime + 0.02; tone(660, t, 0.08, 'triangle', 0.08); tone(990, t + 0.07, 0.12, 'triangle', 0.08); }
  function nak() { if (!ready()) return; const t = ctx.currentTime + 0.02; tone(150, t, 0.22, 'sawtooth', 0.06, 110); }
  function drop() { if (!ready()) return; const t = ctx.currentTime + 0.02; noise(t, 0.05, 0.12, 2400, 2); }
  function clunk() { if (!ready()) return; const t = ctx.currentTime + 0.05; noise(t, 0.09, 0.5, 300, 0.8); tone(90, t, 0.18, 'sine', 0.25, 50); noise(t + 0.12, 0.05, 0.3, 1200, 3); }
  function beep() { if (!ready()) return; tone(1760, ctx.currentTime + 0.01, 0.06, 'sine', 0.06); }
  function click() { if (!ready()) return; tone(2400, ctx.currentTime + 0.005, 0.015, 'square', 0.015); }
  function chime() {
    if (!ready()) return;
    const t = ctx.currentTime + 0.03;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, t + i * 0.09, 0.5, 'triangle', 0.07));
  }
  function goal() { if (!ready()) return; const t = ctx.currentTime + 0.02; tone(784, t, 0.15, 'triangle', 0.08); tone(1175, t + 0.1, 0.3, 'triangle', 0.08); }
  function midnight(i) {   // i = strike number; the last one powers down
    if (!ready()) return;
    const t = ctx.currentTime + 0.02;
    [1, 2.76, 5.4].forEach((h, k) => tone(196 * h, t, 2.2 / (k + 1), 'sine', 0.08 / (k + 1)));
    if (i === 'down') tone(440, t, 1.6, 'sawtooth', 0.05, 40);
  }
  window.SFX = { init, setMuted, isMuted: () => muted, fan, wire, ack, nak, drop, clunk, beep, click, chime, goal, midnight };
})();
