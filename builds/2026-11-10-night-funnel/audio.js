// Night Funnel - all sound is generated with WebAudio. Safe to call before init (no-ops).
(function (root) {
  'use strict';
  const A = {};
  let ac = null, master = null, muted = false, N = {}, nbuf = null;
  let lastBeep = 0, lastInRange = false;

  function noise() {
    const s = ac.createBufferSource(); s.buffer = nbuf; s.loop = true; s.start(0); return s;
  }

  A.init = function () {
    if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
    const AC = root.AudioContext || root.webkitAudioContext; if (!AC) return;
    ac = new AC();
    master = ac.createGain(); master.gain.value = muted ? 0 : 0.8; master.connect(ac.destination);
    nbuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = nbuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // engine: low saw + turbine whine + roar
    N.eng = ac.createGain(); N.eng.gain.value = 0; N.eng.connect(master);
    N.o1 = ac.createOscillator(); N.o1.type = 'sawtooth'; N.o1.frequency.value = 50;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220; N.o1.connect(lp); lp.connect(N.eng);
    N.o2 = ac.createOscillator(); N.o2.type = 'sine'; N.o2.frequency.value = 400;
    N.whine = ac.createGain(); N.whine.gain.value = 0; N.o2.connect(N.whine); N.whine.connect(master);
    const rb = ac.createBiquadFilter(); rb.type = 'bandpass'; rb.frequency.value = 500; rb.Q.value = 0.5;
    N.roar = ac.createGain(); N.roar.gain.value = 0; noise().connect(rb); rb.connect(N.roar); N.roar.connect(master);
    N.rb = rb;
    // wind
    const wh = ac.createBiquadFilter(); wh.type = 'highpass'; wh.frequency.value = 1500;
    N.wind = ac.createGain(); N.wind.gain.value = 0; noise().connect(wh); wh.connect(N.wind); N.wind.connect(master);
    // gun: 100 Hz buzz saw + noise
    N.gun = ac.createGain(); N.gun.gain.value = 0; N.gun.connect(master);
    const go = ac.createOscillator(); go.type = 'sawtooth'; go.frequency.value = 100;
    const glp = ac.createBiquadFilter(); glp.type = 'lowpass'; glp.frequency.value = 1100; go.connect(glp); glp.connect(N.gun); go.start();
    const gb = ac.createBiquadFilter(); gb.type = 'bandpass'; gb.frequency.value = 900; gb.Q.value = 0.7;
    noise().connect(gb); gb.connect(N.gun);
    // drone buzz
    N.drone = ac.createGain(); N.drone.gain.value = 0; N.drone.connect(master);
    N.d1 = ac.createOscillator(); N.d1.type = 'sawtooth'; N.d1.frequency.value = 95;
    N.d2 = ac.createOscillator(); N.d2.type = 'square'; N.d2.frequency.value = 190.5;
    const dbp = ac.createBiquadFilter(); dbp.type = 'bandpass'; dbp.frequency.value = 420; dbp.Q.value = 1.2;
    const trem = ac.createGain(); trem.gain.value = 0.6;
    const lfo = ac.createOscillator(); lfo.frequency.value = 7; const lg = ac.createGain(); lg.gain.value = 0.3; lfo.connect(lg); lg.connect(trem.gain); lfo.start();
    N.d1.connect(dbp); N.d2.connect(dbp); dbp.connect(trem); trem.connect(N.drone);
    [N.o1, N.o2, N.d1, N.d2].forEach(o => o.start());
  };

  A.setMuted = function (m) { muted = m; if (master) master.gain.setTargetAtTime(m ? 0 : 0.8, ac.currentTime, 0.03); };
  A.isMuted = () => muted;
  A.suspend = function () { if (ac && ac.state === 'running') ac.suspend(); };
  A.resume = function () { if (ac && ac.state === 'suspended') ac.resume(); };
  A.silence = function () { if (!ac) return; const t = ac.currentTime; ['eng', 'whine', 'roar', 'wind', 'gun', 'drone'].forEach(k => N[k].gain.setTargetAtTime(0, t, 0.05)); };

  function tone(f, dur, type, vol, f2) {
    if (!ac) return;
    const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
  }
  function burst(dur, f0, f1, vol, type) {
    if (!ac) return;
    const t = ac.currentTime, s = ac.createBufferSource(); s.buffer = nbuf;
    const f = ac.createBiquadFilter(); f.type = type || 'lowpass'; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ac.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(master); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }

  // st: {thr, speed, firing, range (m, -1 none), closure (m/s), warn: '' | 'stall' | 'pullup', inRange, alive}
  A.update = function (st) {
    if (!ac || ac.state !== 'running') return;
    const t = ac.currentTime, tc = 0.06;
    const thr = st.thr, v = st.speed;
    N.eng.gain.setTargetAtTime(0.12 + thr * 0.16, t, tc);
    N.o1.frequency.setTargetAtTime(45 + thr * 40, t, tc);
    N.o2.frequency.setTargetAtTime(380 + thr * 700, t, tc);
    N.whine.gain.setTargetAtTime(0.012 + thr * 0.02, t, tc);
    N.roar.gain.setTargetAtTime(0.05 + thr * 0.28 + (thr > 0.9 ? 0.15 : 0), t, tc);
    N.rb.frequency.setTargetAtTime(350 + thr * 500, t, tc);
    N.wind.gain.setTargetAtTime(Math.min(0.12, (v / 300) * (v / 300) * 0.1), t, tc);
    N.gun.gain.setTargetAtTime(st.firing ? 0.32 : 0, t, st.firing ? 0.008 : 0.05);
    if (st.range > 0) {
      const lvl = Math.min(0.3, 90 / (st.range + 60));
      N.drone.gain.setTargetAtTime(lvl * 0.5, t, 0.1);
      const dop = 1 + Math.max(-60, Math.min(60, st.closure)) / 340;
      N.d1.frequency.setTargetAtTime(95 * dop, t, 0.1); N.d2.frequency.setTargetAtTime(190.5 * dop, t, 0.1);
    } else N.drone.gain.setTargetAtTime(0, t, 0.2);
    const now = performance.now();
    if (st.inRange && !lastInRange) tone(1320, 0.12, 'sine', 0.12);
    lastInRange = st.inRange;
    if (st.warn && now - lastBeep > (st.warn === 'stall' ? 420 : 300)) {
      lastBeep = now;
      if (st.warn === 'stall') tone(740, 0.3, 'square', 0.09, 560);
      else tone(st.beepHi ? 1500 : 1000, 0.12, 'square', 0.08);
      st.beepHi = !st.beepHi;
    }
  };

  A.onEvent = function (e) {
    if (!ac || ac.state !== 'running') return;
    if (e.type === 'hit') burst(0.05, 5000, 1500, 0.14, 'highpass');
    else if (e.type === 'boom') { const g = Math.max(0.12, Math.min(0.9, 700 / (e.dist + 150))); burst(1.4, 900, 60, g, 'lowpass'); tone(70, 0.8, 'sine', g * 0.5, 30); }
    else if (e.type === 'kill') { burst(0.5, 1400, 120, 0.3, 'lowpass'); }
    else if (e.type === 'crash') burst(0.9, 700, 60, 0.4, 'lowpass');
    else if (e.type === 'impact') { burst(2.2, 600, 40, 0.7, 'lowpass'); tone(50, 1.4, 'sine', 0.4, 25); }
    else if (e.type === 'damage' || e.type === 'debris') { burst(0.35, 2500, 200, 0.5, 'lowpass'); tone(160, 0.3, 'sawtooth', 0.15, 60); }
    else if (e.type === 'ground') { burst(1.5, 1200, 40, 0.9, 'lowpass'); }
  };

  A.win = function () { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.35, 'triangle', 0.14), i * 140)); };
  A.lose = function () { [392, 330, 262, 196].forEach((f, i) => setTimeout(() => tone(f, 0.45, 'sawtooth', 0.1), i * 220)); };
  A.click = function () { tone(880, 0.06, 'square', 0.05); };

  root.NFA = A;
})(this);
