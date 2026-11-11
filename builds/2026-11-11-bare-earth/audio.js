// Bare Earth - procedural WebAudio: night-jungle ambience, UI ticks, laser sweep, reveal chord.
(function (root) {
  'use strict';
  let ctx = null, master = null, amb = null, muted = false, timer = null;
  try { muted = localStorage.getItem('be.mute') === '1'; } catch (e) { /* private mode */ }

  let unlocked = false;
  function ensure() {
    if (!unlocked) return false; // never create an AudioContext before a user gesture
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return true; }
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.8;
    master.connect(ctx.destination);
    return true;
  }
  function noiseBuf(sec) {
    const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * sec), ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  function env(g, t, a, peak, dec) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec);
  }
  function tone(freq, dur, type, vol, slide) {
    if (!ensure()) return;
    const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    env(g, t, 0.005, vol || 0.2, dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  function startAmbience() {
    if (!ensure() || amb) return;
    amb = ctx.createGain();
    amb.gain.value = 0;
    amb.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 3);
    amb.connect(master);
    // insect chorus: two band-passed noise beds, amplitude-modulated by fast pulse LFOs
    const nb = noiseBuf(2.5);
    [[4300, 38, 0.06], [6100, 52, 0.035]].forEach(([f, rate, vol]) => {
      const src = ctx.createBufferSource(); src.buffer = nb; src.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 9;
      const g = ctx.createGain(); g.gain.value = vol;
      const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = rate;
      const lg = ctx.createGain(); lg.gain.value = vol * 0.9;
      lfo.connect(lg); lg.connect(g.gain);
      const slow = ctx.createOscillator(); slow.frequency.value = 0.07 + Math.random() * 0.05;
      const sg = ctx.createGain(); sg.gain.value = vol * 0.5;
      slow.connect(sg); sg.connect(g.gain);
      src.connect(bp); bp.connect(g); g.connect(amb);
      src.start(); lfo.start(); slow.start();
    });
    // low wind through leaves
    const wsrc = ctx.createBufferSource(); wsrc.buffer = nb; wsrc.loop = true; wsrc.playbackRate.value = 0.5;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500;
    const wg = ctx.createGain(); wg.gain.value = 0.05;
    wsrc.connect(lp); lp.connect(wg); wg.connect(amb); wsrc.start();
    // occasional frogs and a bird
    const critter = () => {
      if (!ctx || !amb) return;
      const t = ctx.currentTime + 0.05;
      if (Math.random() < 0.7) { // frog: a few croaks
        const f = 380 + Math.random() * 500, n = 2 + (Math.random() * 4 | 0);
        for (let k = 0; k < n; k++) {
          const o = ctx.createOscillator(), g = ctx.createGain(), bp = ctx.createBiquadFilter();
          o.type = 'sawtooth'; bp.type = 'bandpass'; bp.frequency.value = f * 2; bp.Q.value = 4;
          const tt = t + k * (0.13 + Math.random() * 0.05);
          o.frequency.setValueAtTime(f, tt); o.frequency.exponentialRampToValueAtTime(f * 0.7, tt + 0.07);
          env(g, tt, 0.008, 0.05, 0.08);
          o.connect(bp); bp.connect(g); g.connect(amb); o.start(tt); o.stop(tt + 0.12);
        }
      } else { // bird: two-note whistle glide
        const f = 1800 + Math.random() * 900;
        [0, 0.28].forEach((dt, k) => {
          const o = ctx.createOscillator(), g = ctx.createGain();
          o.frequency.setValueAtTime(f * (k ? 0.8 : 1), t + dt);
          o.frequency.exponentialRampToValueAtTime(f * (k ? 1.15 : 0.75), t + dt + 0.22);
          env(g, t + dt, 0.03, 0.03, 0.2);
          o.connect(g); g.connect(amb); o.start(t + dt); o.stop(t + dt + 0.3);
        });
      }
      timer = setTimeout(critter, 2500 + Math.random() * 6000);
    };
    timer = setTimeout(critter, 1500);
  }

  const A = {
    unlock() { unlocked = true; if (ensure()) startAmbience(); },
    get muted() { return muted; },
    setMuted(m) {
      muted = m;
      try { localStorage.setItem('be.mute', m ? '1' : '0'); } catch (e) { /* ignore */ }
      if (master) master.gain.setTargetAtTime(m ? 0 : 0.8, ctx.currentTime, 0.05);
    },
    pin() { tone(880, 0.09, 'sine', 0.18, 620); },
    unpin() { tone(420, 0.1, 'triangle', 0.15, 260); },
    tick() { tone(1500, 0.03, 'square', 0.04); },
    sweep() { // laser scan: filtered noise burst sweeping up plus a faint carrier
      if (!ensure()) return;
      const t = ctx.currentTime, src = ctx.createBufferSource(); src.buffer = noiseBuf(1.4);
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 14;
      bp.frequency.setValueAtTime(700, t); bp.frequency.exponentialRampToValueAtTime(7000, t + 1.3);
      const g = ctx.createGain(); env(g, t, 0.05, 0.22, 1.3);
      src.connect(bp); bp.connect(g); g.connect(master); src.start(t); src.stop(t + 1.45);
      tone(2400, 1.2, 'sine', 0.025, 3200);
    },
    filter() { tone(300, 0.12, 'triangle', 0.08, 520); },
    reveal(pass) { // chord swell
      if (!ensure()) return;
      const t = ctx.currentTime, notes = pass ? [220, 277.2, 329.6, 440, 554.4] : [196, 233.1, 293.7, 349.2];
      notes.forEach((f, k) => {
        const o = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter();
        o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = (k - 2) * 4;
        lp.type = 'lowpass'; lp.frequency.setValueAtTime(400, t); lp.frequency.linearRampToValueAtTime(pass ? 2400 : 900, t + 1.2);
        g.gain.setValueAtTime(0.0001, t + k * 0.06);
        g.gain.exponentialRampToValueAtTime(0.045, t + 0.4 + k * 0.06);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
        o.connect(lp); lp.connect(g); g.connect(master); o.start(t + k * 0.06); o.stop(t + 3.3);
      });
    }
  };
  root.BEAudio = A;
})(this);
