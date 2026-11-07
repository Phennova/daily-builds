/* Crash Box - procedural audio (WebAudio). The straight-six is synthesised from its firing pulses:
   one 720-degree four-stroke cycle containing six exhaust pulses is built in the time domain, turned into
   harmonics with a DFT and played as a PeriodicWave whose fundamental is rpm / 120 Hz. */
(function (root) {
  'use strict';
  const CrashAudio = {};
  let ctx = null, master = null, muted = false;
  let eng = null;

  function cycleWave(N, tau, varAmp, seed, sharp) {
    // deterministic pseudo-random per-cylinder variation, so the lope is the same every time
    let x = seed;
    const rnd = () => { x = (x * 16807) % 2147483647; return x / 2147483647; };
    const buf = new Float32Array(N);
    for (let c = 0; c < 6; c++) {
      const amp = 1 + (rnd() - 0.5) * 2 * varAmp;
      const start = (c / 6 + (rnd() - 0.5) * 0.012) * N;
      for (let i = 0; i < N; i++) {
        let t = (i - start) / N; if (t < 0) t += 1;
        const u = t / tau;
        // exhaust blow-down: fast rise, exponential decay, with a ringing overtone
        const env = u * Math.exp(1 - u);
        buf[i] += amp * (env + sharp * env * Math.sin(2 * Math.PI * t * 54));
      }
    }
    let mean = 0; for (let i = 0; i < N; i++) mean += buf[i]; mean /= N;
    for (let i = 0; i < N; i++) buf[i] -= mean;
    return buf;
  }
  function toPeriodicWave(buf, H) {
    const N = buf.length;
    const re = new Float32Array(H + 1), im = new Float32Array(H + 1);
    for (let k = 1; k <= H; k++) {
      let a = 0, b = 0;
      for (let i = 0; i < N; i++) {
        const ph = 2 * Math.PI * k * i / N;
        a += buf[i] * Math.cos(ph); b += buf[i] * Math.sin(ph);
      }
      // gentle high-harmonic roll-off so it stays a rumble rather than a buzz
      const roll = 1 / (1 + Math.pow(k / 70, 2));
      re[k] = (a / N) * roll; im[k] = (b / N) * roll;
    }
    return ctx.createPeriodicWave(re, im, { disableNormalization: false });
  }
  function noiseBuffer(seconds, brown) {
    const n = Math.floor(ctx.sampleRate * seconds);
    const b = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    return b;
  }
  function loopNoise(buf) {
    const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(); return s;
  }

  CrashAudio.init = function () {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return true; }
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = muted ? 0 : 0.55;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    master.connect(comp); comp.connect(ctx.destination);

    const H = 150, N = 2048;
    const loadWave = toPeriodicWave(cycleWave(N, 0.018, 0.16, 12345, 0.35), H);
    const coastWave = toPeriodicWave(cycleWave(N, 0.03, 0.08, 777, 0.1), H);
    const white = noiseBuffer(2, false), brown = noiseBuffer(3, true);

    eng = {};
    eng.lp = ctx.createBiquadFilter(); eng.lp.type = 'lowpass'; eng.lp.Q.value = 0.7; eng.lp.frequency.value = 600;
    eng.out = ctx.createGain(); eng.out.gain.value = 0;
    eng.lp.connect(eng.out); eng.out.connect(master);
    eng.oLoad = ctx.createOscillator(); eng.oLoad.setPeriodicWave(loadWave);
    eng.oCoast = ctx.createOscillator(); eng.oCoast.setPeriodicWave(coastWave);
    eng.gLoad = ctx.createGain(); eng.gCoast = ctx.createGain();
    eng.oLoad.connect(eng.gLoad); eng.oCoast.connect(eng.gCoast);
    eng.gLoad.connect(eng.lp); eng.gCoast.connect(eng.lp);
    eng.oLoad.start(); eng.oCoast.start();

    // intake roar
    eng.intake = loopNoise(white);
    eng.bp = ctx.createBiquadFilter(); eng.bp.type = 'bandpass'; eng.bp.Q.value = 1.2;
    eng.gIntake = ctx.createGain(); eng.gIntake.gain.value = 0;
    eng.intake.connect(eng.bp); eng.bp.connect(eng.gIntake); eng.gIntake.connect(master);

    // straight-cut gear whine (countershaft mesh)
    eng.whine = ctx.createOscillator(); eng.whine.type = 'triangle';
    eng.gWhine = ctx.createGain(); eng.gWhine.gain.value = 0;
    eng.whine.connect(eng.gWhine); eng.gWhine.connect(master); eng.whine.start();

    // grinding: tooth-clash buzz + metallic noise
    eng.grindSaw = ctx.createOscillator(); eng.grindSaw.type = 'sawtooth';
    eng.grindNoise = loopNoise(white);
    eng.grindBp = ctx.createBiquadFilter(); eng.grindBp.type = 'bandpass'; eng.grindBp.frequency.value = 2600; eng.grindBp.Q.value = 2.5;
    eng.gGrind = ctx.createGain(); eng.gGrind.gain.value = 0;
    const sawG = ctx.createGain(); sawG.gain.value = 0.5;
    eng.grindSaw.connect(sawG); sawG.connect(eng.grindBp);
    eng.grindNoise.connect(eng.grindBp); eng.grindBp.connect(eng.gGrind); eng.gGrind.connect(master);
    eng.grindSaw.start();

    // tyres / road rumble
    eng.road = loopNoise(brown);
    eng.roadLp = ctx.createBiquadFilter(); eng.roadLp.type = 'lowpass'; eng.roadLp.frequency.value = 180;
    eng.gRoad = ctx.createGain(); eng.gRoad.gain.value = 0;
    eng.road.connect(eng.roadLp); eng.roadLp.connect(eng.gRoad); eng.gRoad.connect(master);

    eng.white = white;
    return true;
  };

  const set = (param, v, tc) => param.setTargetAtTime(v, ctx.currentTime, tc || 0.03);

  /* Called every frame with a view of the sim. */
  CrashAudio.update = function (s, paused) {
    if (!ctx || !eng) return;
    const W2RPM = 60 / (2 * Math.PI);
    const rpm = Math.max(0, s.we * W2RPM);
    const alive = paused ? 0 : 1;
    const f0 = Math.max(0.5, rpm / 120);
    set(eng.oLoad.frequency, f0, 0.015); set(eng.oCoast.frequency, f0, 0.015);
    const load = s.running ? Math.min(1, s.thr * 1.2) : 0;
    const level = Math.min(1, rpm / 500) * (s.running ? 1 : 0.6) * alive;
    set(eng.gLoad.gain, (0.25 + 0.75 * load) * 0.9, 0.04);
    set(eng.gCoast.gain, (1 - load) * 0.7, 0.04);
    set(eng.out.gain, level * 0.9, 0.04);
    set(eng.lp.frequency, 220 + rpm * 0.55 + load * 1400, 0.05);
    set(eng.bp.frequency, 300 + rpm * 0.35, 0.05);
    set(eng.gIntake.gain, s.running ? alive * load * (0.02 + rpm / 2750 * 0.07) : 0, 0.05);
    // whine from the countershaft constant-mesh gear (~23 teeth), louder in the low gears
    const wi = Math.max(0, s.wi * W2RPM);
    set(eng.whine.frequency, Math.max(20, wi / 60 * 23), 0.02);
    const whineLvl = s.gear > 0 && s.gear < 4 ? (s.gear === 1 ? 0.035 : 0.022) : 0.006;
    set(eng.gWhine.gain, alive * whineLvl * Math.min(1, wi / 1500), 0.05);
    // grind
    const g = s.grind || 0;
    set(eng.grindSaw.frequency, Math.max(40, g / 60 * 30), 0.01);
    set(eng.gGrind.gain, alive * (g > 0 ? Math.min(0.5, 0.15 + g / 2500) : 0), g > 0 ? 0.005 : 0.03);
    set(eng.grindBp.frequency, 1800 + Math.min(2500, g), 0.02);
    // road
    set(eng.gRoad.gain, alive * Math.min(0.35, s.v / 11 * 0.3), 0.1);
  };

  function burst(dur, freq, q, gain, type) {
    const src = ctx.createBufferSource(); src.buffer = eng.white;
    const f = ctx.createBiquadFilter(); f.type = type || 'lowpass'; f.frequency.value = freq; f.Q.value = q || 1;
    const gn = ctx.createGain(); const t = ctx.currentTime;
    gn.gain.setValueAtTime(gain, t); gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(gn); gn.connect(master);
    src.start(t, Math.random()); src.stop(t + dur + 0.05);
  }
  function thump(freq, dur, gain) {
    const o = ctx.createOscillator(); o.type = 'sine';
    const gn = ctx.createGain(); const t = ctx.currentTime;
    o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(freq * 0.5, t + dur);
    gn.gain.setValueAtTime(gain, t); gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(gn); gn.connect(master); o.start(t); o.stop(t + dur + 0.05);
  }
  function ping(freq, dur, gain) {
    const o = ctx.createOscillator(); o.type = 'square';
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 12;
    const gn = ctx.createGain(); const t = ctx.currentTime;
    o.frequency.value = freq;
    gn.gain.setValueAtTime(gain, t); gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f); f.connect(gn); gn.connect(master); o.start(t); o.stop(t + dur + 0.05);
  }

  CrashAudio.event = function (e) {
    if (!ctx || !eng) return;
    switch (e.type) {
      case 'clunk': thump(95, 0.14, 0.5 + 0.3 * (e.strength || 0)); burst(0.06, 900, 1, 0.25 + 0.4 * (e.strength || 0), 'bandpass'); break;
      case 'pop': burst(0.04, 1400, 2, 0.18, 'bandpass'); thump(140, 0.06, 0.15); break;
      case 'grind': burst(0.12, 3200, 3, 0.35, 'bandpass'); break;
      case 'stall': thump(60, 0.35, 0.4); break;
      case 'start': case 'bumpstart': {
        // starter motor: a chattering whirr
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 95;
        const am = ctx.createOscillator(); am.frequency.value = 11; const amg = ctx.createGain(); amg.gain.value = 0.5;
        const gn = ctx.createGain(); const t = ctx.currentTime;
        gn.gain.setValueAtTime(0.0001, t); gn.gain.linearRampToValueAtTime(0.12, t + 0.05);
        gn.gain.linearRampToValueAtTime(0.0001, t + (e.type === 'start' ? 0.7 : 0.2));
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700;
        am.connect(amg); amg.connect(gn.gain);
        o.connect(f); f.connect(gn); gn.connect(master);
        o.start(t); am.start(t); o.stop(t + 0.8); am.stop(t + 0.8);
        break;
      }
      case 'linkage': ping(2300, 0.5, 0.25); ping(3450, 0.35, 0.12); thump(110, 0.1, 0.4); break;
      case 'ui': ping(1200, 0.08, 0.05); break;
      case 'win': ping(880, 0.25, 0.08); setTimeout(() => ctx && ping(1320, 0.35, 0.08), 140); break;
      case 'fail': thump(70, 0.5, 0.4); break;
    }
  };

  CrashAudio.setMuted = function (m) {
    muted = m;
    if (master) master.gain.setTargetAtTime(m ? 0 : 0.55, ctx.currentTime, 0.02);
  };
  CrashAudio.isMuted = () => muted;
  CrashAudio.suspend = function () { if (ctx && ctx.state === 'running') ctx.suspend(); };
  CrashAudio.resume = function () { if (ctx && ctx.state === 'suspended') ctx.resume(); };

  root.CrashAudio = CrashAudio;
})(typeof self !== 'undefined' ? self : this);
