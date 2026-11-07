/* Crash Box - game: input, rendering, UI flow. Depends on sim.js (CrashSim) and audio.js (CrashAudio). */
(function () {
  'use strict';
  const S = window.CrashSim, A = window.CrashAudio;
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const DEMO = params.has('demo');
  const PLAYTEST = params.has('playtest');
  const pbot = PLAYTEST ? S.createBot() : null;
  const reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const W2RPM = S.W2RPM;

  // ------------------------------------------------------------ persistence
  const STORE = 'crashbox.v1';
  let save = { best: {}, muted: false };
  try { save = Object.assign(save, JSON.parse(localStorage.getItem(STORE) || '{}')); } catch (e) { /* private mode */ }
  const persist = () => { try { localStorage.setItem(STORE, JSON.stringify(save)); } catch (e) { /* ignore */ } };
  const GRADE_RANK = { S: 5, A: 4, B: 3, C: 2, D: 1, F: 0 };

  // ------------------------------------------------------------ state
  let mode = 'title';            // title | runs | brief | drive | paused | result
  let runIdx = 0, sim = null, bot = null, endTimer = 0;
  let shake = 0, flash = 0, gearPop = 0, clunkFlash = 0;
  const particles = [];
  let linkageMsgT = -10;

  // ------------------------------------------------------------ input
  const keys = { clutch: false, gas: false, brake: false };
  let keyReq = null;           // gear requested by keyboard (held)
  const heldGearKeys = [];
  let startPressed = false;
  const touch = { clutch: false, brake: false, gas: 0 };
  const gateUI = { dragging: false, pid: null, gx: 0, gy: 0, req: null, lastGx: 0 };

  function setPedalClass() {
    $('pClutch').classList.toggle('down', !!(keys.clutch || touch.clutch) && !(sim && sim.clutchBroken));
    $('pBrake').classList.toggle('down', !!(keys.brake || touch.brake));
    $('pGas').classList.toggle('down', !!(keys.gas || touch.gas > 0));
  }

  window.addEventListener('keydown', (e) => {
    if (e.repeat && !/^Digit|^Numpad/.test(e.code)) { if (mode === 'drive') e.preventDefault(); return; }
    const k = e.key.toLowerCase();
    if (e.key === 'Shift') keys.clutch = true;
    else if (k === 'w' || e.key === 'ArrowUp') keys.gas = true;
    else if (k === 's' || e.key === 'ArrowDown') keys.brake = true;
    else if (/^[1-5]$/.test(e.key) || /^Numpad[1-5]$/.test(e.code)) {
      const g = +(e.key.match(/[1-5]/) || e.code.match(/[1-5]/))[0];
      if (!heldGearKeys.includes(g)) heldGearKeys.push(g);
      keyReq = g;
    } else if (k === 'n' || e.key === '0' || e.code === 'Numpad0') { keyReq = 0; if (!heldGearKeys.includes(0)) heldGearKeys.push(0); }
    else if (k === 'e') startPressed = true;
    else if (k === 'm') toggleMute();
    else if (k === 'p' || e.key === 'Escape') { if (mode === 'drive') pause(); else if (mode === 'paused') resume(); }
    else return;
    if (mode === 'drive') e.preventDefault();
    setPedalClass();
  });
  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (e.key === 'Shift') keys.clutch = false;
    else if (k === 'w' || e.key === 'ArrowUp') keys.gas = false;
    else if (k === 's' || e.key === 'ArrowDown') keys.brake = false;
    else {
      let g = null;
      if (/^[1-5]$/.test(e.key) || /^Numpad[1-5]$/.test(e.code)) g = +(e.key.match(/[1-5]/) || e.code.match(/[1-5]/))[0];
      else if (k === 'n' || e.key === '0' || e.code === 'Numpad0') g = 0;
      if (g !== null) {
        const i = heldGearKeys.indexOf(g); if (i >= 0) heldGearKeys.splice(i, 1);
        keyReq = heldGearKeys.length ? heldGearKeys[heldGearKeys.length - 1] : null;
      }
    }
    setPedalClass();
  });
  window.addEventListener('blur', () => {
    keys.clutch = keys.gas = keys.brake = false; keyReq = null; heldGearKeys.length = 0;
    touch.clutch = touch.brake = false; touch.gas = 0; gateUI.dragging = false; gateUI.req = null;
    setPedalClass();
    if (mode === 'drive' && !DEMO) pause();
  });

  function bindPedal(el, onDown, onMove, onUp) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault(); el.setPointerCapture(e.pointerId); A.init(); onDown(e); setPedalClass();
    });
    el.addEventListener('pointermove', (e) => { if (el.hasPointerCapture(e.pointerId) && onMove) { onMove(e); setPedalClass(); } });
    const up = (e) => { onUp(e); setPedalClass(); };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  bindPedal($('pClutch'), () => { touch.clutch = true; }, null, () => { touch.clutch = false; });
  bindPedal($('pBrake'), () => { touch.brake = true; }, null, () => { touch.brake = false; });
  const gasLevel = (e) => {
    const r = $('pGas').getBoundingClientRect();
    return clamp((1 - (e.clientY - r.top) / r.height) * 1.2, 0.12, 1);
  };
  bindPedal($('pGas'), (e) => { touch.gas = gasLevel(e); }, (e) => { touch.gas = gasLevel(e); }, () => { touch.gas = 0; });
  $('btnStart').addEventListener('click', () => { startPressed = true; });

  // ---- H-gate (1 3 5 over 2 4)
  const gateCv = $('gate'), gctx = gateCv.getContext('2d');
  const SLOT = { 1: [0, -1], 2: [0, 1], 3: [1, -1], 4: [1, 1], 5: [2, -1] };
  function gateGeom() {
    const w = gateCv.clientWidth, h = gateCv.clientHeight;
    const padX = Math.max(14, w * 0.1), padY = Math.max(14, h * 0.12);
    const left = padX, right = w - padX, top = padY, bot = h - padY;
    return { w, h, left, right, top, bot, colW: (right - left) / 2, mid: (top + bot) / 2, half: (bot - top) / 2 };
  }
  function gateToPx(gx, gy, G) { return [G.left + gx * G.colW, G.mid + gy * G.half]; }
  function constrain(gx, gy) {
    gx = clamp(gx, 0, 2); gy = clamp(gy, -1, 1);
    const c = Math.round(gx);
    if (Math.abs(gy) > 0.16) {
      gx = c;
      if (c === 2 && gy > 0) gy = Math.min(gy, 0.16);
    }
    return [gx, gy];
  }
  function slotGear(gx, gy) {
    const c = Math.round(gx);
    if (gy <= -0.55) return [1, 3, 5][c];
    if (gy >= 0.55) return [2, 4, null][c];
    return null;
  }
  function gatePointer(e) {
    const r = gateCv.getBoundingClientRect(), G = gateGeom();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    let gx = (px - G.left) / G.colW, gy = (py - G.mid) / G.half;
    [gx, gy] = constrain(gx, gy);
    gateUI.gx = gx; gateUI.gy = gy;
    const g = slotGear(gx, gy);
    if (g) gateUI.req = g;
    else if (Math.abs(gy) < 0.3) gateUI.req = 0;
    gateUI.lastGx = gx;
  }
  gateCv.addEventListener('pointerdown', (e) => {
    e.preventDefault(); A.init(); gateCv.setPointerCapture(e.pointerId);
    gateUI.dragging = true; gateUI.pid = e.pointerId;
    // grabbing the knob where it is: start from the current lever position
    gatePointer(e);
  });
  gateCv.addEventListener('pointermove', (e) => { if (gateUI.dragging && e.pointerId === gateUI.pid) gatePointer(e); });
  const gateUp = (e) => { if (e.pointerId === gateUI.pid) { gateUI.dragging = false; gateUI.req = null; } };
  gateCv.addEventListener('pointerup', gateUp); gateCv.addEventListener('pointercancel', gateUp);

  function leverRequest() {
    if (keyReq !== null) return keyReq;
    if (gateUI.dragging) return gateUI.req;
    return null;
  }

  // brake ramps up while held (so a held key/finger is progressive, not on/off)
  let brakeLvl = 0, gasLvl = 0;
  // keyboard gas also ramps (~0.8 s to full) so W can feather the engine; touch gas is already analog
  function gasRamp() {
    gasLvl = keys.gas ? Math.min(1, gasLvl + DT * 1.3 + (gasLvl < 0.15 ? DT * 3 : 0)) : Math.max(0, gasLvl - DT * 4);
    return gasLvl;
  }
  function brakeRamp() {
    const on = keys.brake || touch.brake;
    brakeLvl = on ? Math.min(1, brakeLvl + DT * 2.2 + (brakeLvl < 0.2 ? DT * 2 : 0)) : Math.max(0, brakeLvl - DT * 5);
    return brakeLvl;
  }
  function playerInput() {
    return {
      clutch: keys.clutch || touch.clutch ? 1 : 0,
      throttle: Math.max(gasRamp(), touch.gas),
      brake: brakeRamp(),
      lever: leverRequest(),
      start: startPressed,
    };
  }

  // ------------------------------------------------------------ canvases
  const scene = $('scene'), sctx = scene.getContext('2d');
  const dash = $('dash'), dctx = dash.getContext('2d');
  let DPR = 1;
  function fit(cv, ctx) {
    const w = Math.max(1, cv.clientWidth), h = Math.max(1, cv.clientHeight);
    if (cv.width !== Math.round(w * DPR) || cv.height !== Math.round(h * DPR)) {
      cv.width = Math.round(w * DPR); cv.height = Math.round(h * DPR);
    }
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    return [w, h];
  }

  // deterministic hash noise for scenery
  const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  const vnoise = (x) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return hash(i) * (1 - u) + hash(i + 1) * u; };

  const PALETTES = [
    { skyT: '#8fb0c4', skyB: '#efe2c2', hill: '#7d8a63', hedge: '#3f5130', field: '#6f7a45', road: '#4a463c', verge: '#8c8459', sun: '#fff3c8' },
    { skyT: '#7ea6c2', skyB: '#e7e3cf', hill: '#76875e', hedge: '#3a4d2c', field: '#748046', road: '#4a463c', verge: '#8f875b', sun: '#fffbe6' },
    { skyT: '#9c9fb5', skyB: '#f1cf9a', hill: '#857a5b', hedge: '#45492b', field: '#7b7442', road: '#4d473b', verge: '#94845a', sun: '#ffd58a' },
    { skyT: '#05070d', skyB: '#121826', hill: '#121611', hedge: '#0b0e09', field: '#121510', road: '#141412', verge: '#1a1a14', sun: '#d8dcff', night: true },
    { skyT: '#8e959b', skyB: '#c9c6b8', hill: '#6e7663', hedge: '#38432f', field: '#666e45', road: '#46443b', verge: '#857e5c', sun: '#f4f1e4' },
  ];

  // ------------------------------------------------------------ truck art
  function drawTruck(ctx, k, wheelRot, opts) {
    // local frame: metres, origin on the ground at the middle of the wheelbase, +x forward, +y up (we flip y)
    ctx.save();
    ctx.scale(k, -k);
    const od = opts.night ? '#20241a' : '#4b5320', odD = opts.night ? '#171a12' : '#3a4119', canvasC = opts.night ? '#25261b' : '#6e6c4b';
    // frame + bed
    ctx.fillStyle = '#23241c'; ctx.fillRect(-3.3, 0.72, 6.5, 0.22);
    ctx.fillStyle = odD; ctx.fillRect(-3.45, 0.94, 3.8, 0.66);
    ctx.fillStyle = od; for (let i = 0; i < 4; i++) ctx.fillRect(-3.4 + i * 0.95, 0.98, 0.85, 0.56);
    // canvas cover with bows
    ctx.fillStyle = canvasC;
    ctx.beginPath(); ctx.moveTo(-3.45, 1.6); ctx.lineTo(-3.45, 2.55); ctx.quadraticCurveTo(-3.4, 2.78, -3.1, 2.78);
    ctx.lineTo(0.05, 2.78); ctx.quadraticCurveTo(0.33, 2.78, 0.35, 2.55); ctx.lineTo(0.35, 1.6); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.22)'; ctx.lineWidth = 0.05;
    for (let i = 1; i < 5; i++) { ctx.beginPath(); ctx.moveTo(-3.45 + i * 0.76, 1.62); ctx.lineTo(-3.45 + i * 0.76, 2.76); ctx.stroke(); }
    // cab (open cab with canvas top)
    ctx.fillStyle = od; ctx.fillRect(0.45, 0.94, 1.25, 0.95);
    ctx.fillStyle = canvasC; ctx.fillRect(0.4, 2.2, 1.3, 0.14);
    ctx.strokeStyle = od; ctx.lineWidth = 0.08;
    ctx.beginPath(); ctx.moveTo(0.5, 1.85); ctx.lineTo(0.5, 2.25); ctx.moveTo(1.66, 1.85); ctx.lineTo(1.62, 2.25); ctx.stroke();
    // windshield
    ctx.strokeStyle = '#2b3016'; ctx.lineWidth = 0.06; ctx.beginPath(); ctx.moveTo(1.66, 1.88); ctx.lineTo(1.6, 2.22); ctx.stroke();
    // hood + grille
    ctx.fillStyle = od;
    ctx.beginPath(); ctx.moveTo(1.7, 0.95); ctx.lineTo(1.7, 1.86); ctx.lineTo(2.95, 1.78); ctx.lineTo(3.08, 1.0); ctx.closePath(); ctx.fill();
    ctx.fillStyle = odD; ctx.fillRect(3.0, 0.95, 0.1, 0.82);
    for (let i = 0; i < 4; i++) { ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(1.95 + i * 0.22, 1.25, 0.08, 0.38); }
    // front fender
    ctx.fillStyle = odD; ctx.beginPath(); ctx.moveTo(1.6, 0.95); ctx.quadraticCurveTo(2.3, 1.45, 3.1, 0.92); ctx.lineTo(3.1, 0.82);
    ctx.quadraticCurveTo(2.3, 1.25, 1.6, 0.82); ctx.fill();
    // bumper
    ctx.fillStyle = '#2a2d1d'; ctx.fillRect(3.05, 0.55, 0.3, 0.2);
    // star on the door
    if (!opts.night) {
      ctx.save(); ctx.translate(1.08, 1.42);
      ctx.strokeStyle = '#e8e4d2'; ctx.lineWidth = 0.04; ctx.beginPath(); ctx.arc(0, 0, 0.28, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#e8e4d2'; ctx.beginPath();
      for (let i = 0; i < 10; i++) { const a = Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 0.1 : 0.24; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
      ctx.fill(); ctx.restore();
      // red ball disc on the tailboard
      ctx.fillStyle = '#b8291c'; ctx.beginPath(); ctx.arc(-3.2, 1.27, 0.16, 0, Math.PI * 2); ctx.fill();
    }
    // wheels
    for (const wx of [2.3, -1.25, -2.5]) {
      ctx.save(); ctx.translate(wx, 0.52); ctx.rotate(-wheelRot);
      ctx.fillStyle = '#151512'; ctx.beginPath(); ctx.arc(0, 0, 0.52, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = opts.night ? '#1d1f17' : '#3b3f2a'; ctx.beginPath(); ctx.arc(0, 0, 0.27, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = opts.night ? '#101010' : '#24261a'; ctx.lineWidth = 0.06;
      for (let i = 0; i < 3; i++) { ctx.beginPath(); const a = i * Math.PI / 3; ctx.moveTo(Math.cos(a) * 0.25, Math.sin(a) * 0.25); ctx.lineTo(-Math.cos(a) * 0.25, -Math.sin(a) * 0.25); ctx.stroke(); }
      // tread blocks so rotation reads
      ctx.fillStyle = '#26261f';
      for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5; ctx.fillRect(Math.cos(a) * 0.47 - 0.04, Math.sin(a) * 0.47 - 0.04, 0.08, 0.08); }
      ctx.restore();
    }
    // blackout lamps
    if (opts.night) {
      ctx.fillStyle = '#ff5a3a';
      for (const dy of [0, 0.07]) { ctx.fillRect(-3.42, 0.86 + dy, 0.05, 0.035); }
      ctx.fillStyle = '#dfe6ff'; ctx.fillRect(3.12, 1.05, 0.05, 0.04);
    }
    ctx.restore();
  }

  // ------------------------------------------------------------ scene render
  let camX = 0, camE = 0;
  function renderScene(dt) {
    const [W, H] = fit(scene, sctx);
    const ctx = sctx;
    const s = sim;
    const pal = PALETTES[runIdx] || PALETTES[1];
    const k = clamp(Math.min(W / 46, H / 21), 6.5, 19);   // px per metre
    const VX = 1.7;                        // vertical exaggeration of the road profile
    const terr = s.terrain;
    const targetCam = s.x;
    camX = targetCam;
    camE += (terr.elev(s.x) - camE) * Math.min(1, dt * 4);
    const px0 = W * 0.24;
    const groundY = H * 0.68;
    if (params.has('debug') && (window.__dbgN = (window.__dbgN || 0) + 1) % 20 === 1) console.log('[dbg]', JSON.stringify({ W, H, k, camE, e: terr.elev(s.x), x: s.x, ch: scene.clientHeight, bh: scene.height }));
    const wx2sx = (x) => px0 + (x - camX) * k;
    const e2sy = (e) => groundY - (e - camE) * k * VX;

    ctx.save();
    if (shake > 0 && !reduceMotion) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    // sky
    const sky = ctx.createLinearGradient(0, 0, 0, H * 0.75);
    sky.addColorStop(0, pal.skyT); sky.addColorStop(1, pal.skyB);
    ctx.fillStyle = sky; ctx.fillRect(-10, -10, W + 20, H + 20);
    if (pal.night) {
      for (let i = 0; i < 90; i++) {
        const x = ((hash(i) * W * 1.3 - camX * 0.02 * k) % (W * 1.3) + W * 1.3) % (W * 1.3);
        const y = hash(i + 50) * H * 0.5;
        ctx.fillStyle = `rgba(220,225,255,${0.25 + hash(i + 9) * 0.6})`;
        ctx.fillRect(x, y, 1.3, 1.3);
      }
      ctx.fillStyle = '#d8dcff'; ctx.beginPath(); ctx.arc(W * 0.8, H * 0.16, 9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = pal.skyT; ctx.beginPath(); ctx.arc(W * 0.8 + 4, H * 0.16 - 2, 8, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillStyle = pal.sun; ctx.globalAlpha = 0.85; ctx.beginPath(); ctx.arc(W * 0.78, H * 0.18, 16, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
    // far hills (parallax)
    const layer = (par, baseY, amp, freq, color, seed) => {
      ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(-10, H + 10);
      for (let sx = -10; sx <= W + 10; sx += 8) {
        const wx = (sx - px0) / k * par + camX * par;
        const n = vnoise(wx * freq + seed) * 0.65 + vnoise(wx * freq * 2.7 + seed * 3) * 0.35;
        ctx.lineTo(sx, baseY - n * amp + (camE * k * VX * par * 0.2));
      }
      ctx.lineTo(W + 10, H + 10); ctx.closePath(); ctx.fill();
    };
    layer(0.12, H * 0.55, H * 0.18, 0.02, pal.hill, 3);
    // hedgerows (bocage) with trees
    const hedgePar = 0.4;
    layer(hedgePar, H * 0.62, H * 0.07, 0.08, pal.hedge, 11);
    ctx.fillStyle = pal.hedge;
    const hx0 = Math.floor(((-px0) / k * hedgePar + camX * hedgePar) / 7) - 1;
    const hx1 = hx0 + Math.ceil(W / k * hedgePar / 7) + 3;
    for (let i = hx0; i <= hx1; i++) {
      if (hash(i * 3.1) < 0.45) continue;
      const wx = i * 7 + hash(i) * 4;
      const sx = px0 + (wx - camX * hedgePar) * k / hedgePar;
      const base = H * 0.6 + (camE * k * VX * hedgePar * 0.2);
      const tall = hash(i + 7) > 0.78;
      if (tall) { // poplar
        ctx.beginPath(); ctx.ellipse(sx, base - H * 0.12, 5 + hash(i) * 3, H * 0.12, 0, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.beginPath(); ctx.arc(sx, base - H * 0.035, 8 + hash(i + 2) * 9, 0, Math.PI * 2); ctx.fill();
      }
    }

    // ground / road profile
    const xL = camX - px0 / k - 5, xR = camX + (W - px0) / k + 5;
    ctx.fillStyle = pal.field; ctx.beginPath(); ctx.moveTo(-10, H + 10);
    for (let x = xL; x <= xR; x += 2) ctx.lineTo(wx2sx(x), e2sy(terr.elev(x)));
    ctx.lineTo(W + 10, H + 10); ctx.closePath(); ctx.fill();
    ctx.lineJoin = 'round';
    ctx.strokeStyle = pal.verge; ctx.lineWidth = Math.max(6, k * 0.9);
    ctx.beginPath(); for (let x = xL; x <= xR; x += 2) ctx.lineTo(wx2sx(x), e2sy(terr.elev(x)) + k * 0.45); ctx.stroke();
    ctx.strokeStyle = pal.road; ctx.lineWidth = Math.max(4, k * 0.55);
    ctx.beginPath(); for (let x = xL; x <= xR; x += 2) ctx.lineTo(wx2sx(x), e2sy(terr.elev(x)) + k * 0.2); ctx.stroke();

    // roadside furniture
    const len = s.mission.len;
    for (let x = Math.ceil(xL / 45) * 45; x <= xR; x += 45) { // telegraph poles
      const sx = wx2sx(x), sy = e2sy(terr.elev(x)) - k * 0.1;
      ctx.strokeStyle = pal.night ? '#0d0f0b' : '#4a3d2c'; ctx.lineWidth = Math.max(1.5, k * 0.18);
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx, sy - k * 7.5); ctx.moveTo(sx - k * 0.8, sy - k * 7); ctx.lineTo(sx + k * 0.8, sy - k * 7); ctx.stroke();
    }
    if (!pal.night || true) {
      ctx.strokeStyle = pal.night ? '#0d0f0b' : 'rgba(40,35,25,.6)'; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = Math.ceil(xL / 45) * 45 - 45; x <= xR; x += 45) {
        const a = [wx2sx(x), e2sy(terr.elev(x)) - k * 7.1], b = [wx2sx(x + 45), e2sy(terr.elev(x + 45)) - k * 7.1];
        ctx.moveTo(a[0], a[1]); ctx.quadraticCurveTo((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + k * 0.9, b[0], b[1]);
      }
      ctx.stroke();
    }
    for (let x = Math.ceil(xL / 150) * 150 + 30; x <= xR; x += 150) { // Red Ball route markers
      const sx = wx2sx(x), sy = e2sy(terr.elev(x)) - k * 0.1;
      ctx.strokeStyle = pal.night ? '#0f110c' : '#5a4a33'; ctx.lineWidth = Math.max(1.5, k * 0.12);
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx, sy - k * 2.4); ctx.stroke();
      ctx.fillStyle = pal.night ? '#2a0b07' : '#efe9d6'; ctx.fillRect(sx - k * 0.6, sy - k * 3.6, k * 1.2, k * 1.2);
      ctx.fillStyle = pal.night ? '#3a0d08' : '#b8291c'; ctx.beginPath(); ctx.arc(sx, sy - k * 3, k * 0.45, 0, Math.PI * 2); ctx.fill();
    }
    for (let x = Math.ceil(xL / 100) * 100; x <= xR; x += 100) { // kilometre / hectometre stones
      if (x <= 0) continue;
      const sx = wx2sx(x), sy = e2sy(terr.elev(x)) + k * 0.1;
      ctx.fillStyle = pal.night ? '#1d1d19' : '#e9e4d4'; ctx.fillRect(sx - k * 0.3, sy - k * 0.8, k * 0.6, k * 0.8);
      ctx.fillStyle = pal.night ? '#2a0f0b' : '#b8291c'; ctx.fillRect(sx - k * 0.3, sy - k * 0.95, k * 0.6, k * 0.25);
    }
    // finish depot
    if (len > xL && len < xR + 40) {
      const sx = wx2sx(len), sy = e2sy(terr.elev(len));
      ctx.fillStyle = pal.night ? '#111' : '#5a4a33'; ctx.fillRect(sx - 1, sy - k * 5, Math.max(2, k * 0.15), k * 5);
      ctx.fillStyle = '#b8291c'; ctx.fillRect(sx, sy - k * 5, k * 1.6, k * 1);
      for (let i = 0; i < 6; i++) for (let j = 0; j < 3 - (i % 2); j++) {
        ctx.fillStyle = pal.night ? '#151711' : (j % 2 ? '#4f5a28' : '#57622c');
        ctx.fillRect(sx + k * (2 + i * 0.6), sy - k * (0.7 + j * 0.7), k * 0.5, k * 0.66);
      }
      ctx.fillStyle = pal.night ? '#3a3a30' : '#24261d'; ctx.font = `700 ${Math.max(10, k * 0.9)}px system-ui, sans-serif`;
      ctx.fillText(s.mission.coach ? 'GATE' : 'FUEL DUMP', sx + k * 2, sy - k * 3.2);
    }

    // particles (behind trucks)
    for (const p of particles) {
      const sx = wx2sx(p.x), sy = e2sy(p.e) - p.h * k;
      ctx.globalAlpha = Math.max(0, p.a * (1 - p.t / p.life));
      ctx.fillStyle = p.c;
      ctx.beginPath(); ctx.arc(sx, sy, p.r * k * (0.6 + p.t / p.life), 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    const drawTruckAt = (x, v, night, isPlayer) => {
      const e = terr.elev(x);
      const ang = Math.atan(terr.grade(x) * VX);
      ctx.save(); ctx.translate(wx2sx(x), e2sy(e)); ctx.rotate(-ang);
      let bob = 0;
      if (isPlayer && s.running && !reduceMotion) bob = Math.sin(s.t * s.we * 0.5) * 0.4 * (0.3 + s.thr);
      ctx.translate(0, bob);
      drawTruck(ctx, k, x / S.TRUCK.r, { night });
      ctx.restore();
    };
    if (s.lead) drawTruckAt(s.lead.x, s.lead.v, pal.night, false);
    drawTruckAt(s.x, s.v, pal.night, true);

    // night: darkness + lamps
    if (pal.night) {
      ctx.fillStyle = 'rgba(2,4,10,0.55)'; ctx.fillRect(-10, -10, W + 20, H + 20);
      // faint blackout headlamp spill on the road ahead
      const hx = wx2sx(s.x + 3.2), hy = e2sy(terr.elev(s.x + 3.2)) - k * 1.1;
      const g = ctx.createRadialGradient(hx + k * 6, hy + k, 0, hx + k * 6, hy + k, k * 9);
      g.addColorStop(0, 'rgba(180,190,220,0.13)'); g.addColorStop(1, 'rgba(180,190,220,0)');
      ctx.fillStyle = g; ctx.fillRect(hx - k, hy - k * 8, k * 18, k * 16);
      if (s.lead) {
        const lx = wx2sx(s.lead.x - 3.4), ly = e2sy(terr.elev(s.lead.x - 3.4)) - k * 0.9;
        ctx.fillStyle = 'rgba(255,80,50,0.9)'; ctx.beginPath(); ctx.arc(Math.min(lx, W - 4), ly, 1.8, 0, Math.PI * 2); ctx.fill();
      }
    }

    // lead indicator when the truck ahead is off screen
    if (s.lead) {
      const gap = s.lead.x - s.x;
      const lsx = wx2sx(s.lead.x - 3);
      if (lsx > W - 10) {
        const y = H * 0.42;
        ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(W - 96, y - 18, 90, 36);
        if (pal.night) {
          // blackout "cat's eye" tail lamps: separate dots when close, merged when far
          const sep = clamp(80 / gap, 0.5, 6);
          ctx.fillStyle = '#ff5a3a';
          for (const dx of [-sep, sep]) for (const dy of [-sep * 0.6, sep * 0.6]) { ctx.beginPath(); ctx.arc(W - 51 + dx * 2, y + dy * 2, 1.7, 0, Math.PI * 2); ctx.fill(); }
        } else {
          ctx.fillStyle = gap < 27 || gap > 110 ? '#ffb89c' : '#e9e3cf';
          ctx.font = '700 13px system-ui, sans-serif'; ctx.textAlign = 'center';
          ctx.fillText('\u25b6 ' + Math.round(gap * S.YD) + ' yd', W - 51, y + 5); ctx.textAlign = 'left';
        }
      }
    }
    ctx.restore();
  }

  // ------------------------------------------------------------ dashboard
  function renderDash() {
    const [W, H] = fit(dash, dctx);
    const ctx = dctx, s = sim;
    const night = !!s.mission.night;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = night ? '#08090a' : '#191b14';
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(0, 0, W, H, 10) : ctx.rect(0, 0, W, H); ctx.fill();
    if (flash > 0) { ctx.fillStyle = `rgba(224,70,40,${0.35 * flash})`; ctx.fillRect(0, 0, W, H); }
    const R = Math.min(H * 0.46, W * 0.3);
    const cx = R + 10, cy = H / 2 + 4;
    const MAXR = 3500;
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    const ang = (rpm) => a0 + (a1 - a0) * clamp(rpm / MAXR, 0, 1.03);
    const tolR = s.tol * W2RPM;

    if (night) {
      // blacked-out panel: only a dim gear plate, you drive by ear
      ctx.fillStyle = '#16181a'; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#2b2e30'; ctx.font = `700 ${R * 0.22}px system-ui, sans-serif`; ctx.textAlign = 'center';
      ctx.fillText('BLACKOUT', cx, cy - R * 0.1);
      ctx.font = `${R * 0.14}px system-ui, sans-serif`; ctx.fillText('listen to the engine', cx, cy + R * 0.18);
    } else {
      // face
      ctx.fillStyle = '#0f100c'; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#4b5320'; ctx.lineWidth = 3; ctx.stroke();
      // governed zone
      ctx.strokeStyle = '#8a2a1a'; ctx.lineWidth = R * 0.07;
      ctx.beginPath(); ctx.arc(cx, cy, R * 0.9, ang(2750), ang(MAXR)); ctx.stroke();
      // ticks + numerals
      ctx.strokeStyle = '#d8d1b8'; ctx.fillStyle = '#d8d1b8'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `600 ${Math.max(9, R * 0.13)}px system-ui, sans-serif`;
      for (let r = 0; r <= MAXR; r += 250) {
        const a = ang(r), major = r % 500 === 0;
        ctx.lineWidth = major ? 2 : 1;
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * R * (major ? 0.8 : 0.85), cy + Math.sin(a) * R * (major ? 0.8 : 0.85));
        ctx.lineTo(cx + Math.cos(a) * R * 0.93, cy + Math.sin(a) * R * 0.93); ctx.stroke();
        if (major) ctx.fillText(String(r / 100), cx + Math.cos(a) * R * 0.66, cy + Math.sin(a) * R * 0.66);
      }
      // gear ticks: rpm each gear needs at this road speed
      const wiR = s.wi * W2RPM;
      const req = leverRequest();
      for (let g = 1; g <= 5; g++) {
        const need = S.gearInputW(s, g) * W2RPM;
        if (need > MAXR * 1.02) continue;
        const a = ang(need);
        const meshOK = Math.abs(wiR - need) < tolR;
        const target = s.grindTarget === g || (req === g && s.gear !== g);
        const showWin = s.mission.coach || target || (s.gear === 0 && s.v > 0.5);
        if (showWin && s.gear !== g) {
          ctx.strokeStyle = meshOK ? 'rgba(143,224,106,.45)' : (target ? 'rgba(240,166,64,.4)' : 'rgba(240,166,64,.13)');
          ctx.lineWidth = R * 0.12;
          ctx.beginPath(); ctx.arc(cx, cy, R * 1.0, ang(Math.max(0, need - tolR)), ang(Math.min(MAXR, need + tolR))); ctx.stroke();
        }
        const col = s.gear === g ? '#fff7e0' : meshOK ? '#8fe06a' : '#7d8456';
        ctx.strokeStyle = col; ctx.lineWidth = s.gear === g ? 3 : 2;
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * R * 0.94, cy + Math.sin(a) * R * 0.94);
        ctx.lineTo(cx + Math.cos(a) * R * 1.08, cy + Math.sin(a) * R * 1.08); ctx.stroke();
        ctx.fillStyle = col; ctx.font = `800 ${Math.max(9, R * 0.14)}px system-ui, sans-serif`;
        const lr = R * 1.2;
        // stagger labels that would overlap (all gears read 0 at a standstill)
        const off = need < 60 ? (g - 3) * 0.13 : 0;
        ctx.fillText(String(g), cx + Math.cos(a + off) * lr, cy + Math.sin(a + off) * lr);
      }
      // needles: amber input shaft under white engine
      const drawNeedle = (rpm, color, wdt, len) => {
        const a = ang(rpm);
        ctx.strokeStyle = color; ctx.lineWidth = wdt; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(cx - Math.cos(a) * R * 0.12, cy - Math.sin(a) * R * 0.12);
        ctx.lineTo(cx + Math.cos(a) * R * len, cy + Math.sin(a) * R * len); ctx.stroke();
      };
      drawNeedle(wiR, '#f0a640', Math.max(2, R * 0.035), 0.92);
      drawNeedle(s.we * W2RPM, '#fff7e0', Math.max(2.5, R * 0.05), 0.82);
      ctx.fillStyle = '#2b2d22'; ctx.beginPath(); ctx.arc(cx, cy, R * 0.09, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#8f8a74'; ctx.font = `${Math.max(8, R * 0.1)}px system-ui, sans-serif`;
      ctx.fillText('RPM x100', cx, cy + R * 0.32);
      ctx.fillStyle = '#e9e3cf'; ctx.font = `700 ${Math.max(10, R * 0.15)}px ui-monospace, monospace`;
      ctx.fillText(String(Math.round(s.we * W2RPM / 10) * 10), cx, cy + R * 0.5);
    }

    // right column readouts
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    const x0 = cx + R * 1.38 + 6, colW = W - x0 - 8;
    if (colW < 60) return;
    const gearTxt = s.gear === 0 ? 'N' : String(s.gear);
    const gs = Math.min(H * 0.34, colW * 0.42) * (1 + gearPop * 0.25);
    ctx.fillStyle = night ? '#3a3d3f' : (s.grind > 0 ? '#ff8a66' : '#f0e6c4');
    ctx.font = `900 ${gs}px system-ui, sans-serif`;
    ctx.fillText(gearTxt, x0, H * 0.36);
    if (night) {
      ctx.fillStyle = '#3a3d3f'; ctx.font = `600 ${Math.max(10, H * 0.075)}px system-ui, sans-serif`;
      ctx.fillText('gearbox ' + Math.round(s.health) + '%', x0, H * 0.58);
      return;
    }
    const mph = s.v * S.MPH;
    ctx.fillStyle = mph > 27.5 ? '#ff9a7a' : '#e9e3cf';
    ctx.font = `800 ${Math.max(14, H * 0.16)}px ui-monospace, monospace`;
    const mx = x0 + Math.min(colW * 0.5, gs * 0.95);
    ctx.fillText(mph.toFixed(0), mx, H * 0.28);
    ctx.fillStyle = '#8f8a74'; ctx.font = `${Math.max(9, H * 0.065)}px system-ui, sans-serif`;
    ctx.fillText('mph / 25', mx, H * 0.37);
    // bars
    const bar = (y, label, frac, color, txt) => {
      ctx.fillStyle = '#8f8a74'; ctx.font = `${Math.max(9, H * 0.065)}px system-ui, sans-serif`;
      ctx.fillText(label, x0, y - 3);
      ctx.fillStyle = '#2c2e24'; ctx.fillRect(x0, y, colW, Math.max(5, H * 0.04));
      ctx.fillStyle = color; ctx.fillRect(x0, y, colW * clamp(frac, 0, 1), Math.max(5, H * 0.04));
      if (txt) { ctx.fillStyle = '#e9e3cf'; ctx.textAlign = 'right'; ctx.fillText(txt, x0 + colW, y - 3); ctx.textAlign = 'left'; }
    };
    let y = H * 0.52;
    if (s.lead) {
      const gap = s.lead.x - s.x;
      const ok = gap >= 27 && gap <= 110;
      bar(y, 'interval', gap / 140, ok ? '#7fbf5a' : '#e0643f', Math.round(gap * S.YD) + ' yd');
      ctx.fillStyle = '#e9e3cf';
      ctx.fillRect(x0 + colW * (55 / 140), y - 2, 2, Math.max(5, H * 0.04) + 4);
      y += H * 0.17;
    }
    bar(y, 'gearbox', s.health / 100, s.health > 50 ? '#c8b98a' : '#e0643f', Math.round(s.health) + '%');
    y += H * 0.17;
    if (s.mission.brakes) bar(y, 'brakes', (s.brakeTemp - 20) / 420, s.brakeTemp > 260 ? '#e0643f' : '#c8b98a', s.brakeTemp > 260 ? 'FADING' : '');
  }

  // ------------------------------------------------------------ gate render
  function renderGate() {
    const [W, H] = fit(gateCv, gctx);
    const ctx = gctx, G = gateGeom(), s = sim;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#23251c'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(0, 0, W, H, 10) : ctx.rect(0, 0, W, H); ctx.fill();
    // slots
    ctx.strokeStyle = '#0b0c09'; ctx.lineCap = 'round'; ctx.lineWidth = Math.max(10, G.colW * 0.22);
    ctx.beginPath();
    ctx.moveTo(...gateToPx(0, 0, G)); ctx.lineTo(...gateToPx(2, 0, G));
    for (const g of [1, 2, 3, 4, 5]) { const [c, r] = SLOT[g]; ctx.moveTo(...gateToPx(c, 0, G)); ctx.lineTo(...gateToPx(c, r, G)); }
    ctx.stroke();
    ctx.fillStyle = '#c8b98a'; ctx.font = `800 ${Math.max(11, G.colW * 0.2)}px system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const g of [1, 2, 3, 4, 5]) {
      const [c, r] = SLOT[g]; const [px, py] = gateToPx(c, r, G);
      ctx.fillStyle = s && s.gear === g ? '#fff7e0' : '#8f8a74';
      ctx.fillText(String(g), px + G.colW * 0.28, py);
    }
    ctx.fillStyle = '#5b5a48'; ctx.font = `600 ${Math.max(9, G.colW * 0.13)}px system-ui, sans-serif`;
    ctx.fillText('N', ...gateToPx(2.0, 0.42, G));
    if (!s) return;
    // knob position
    let gx, gy, jitter = 0;
    const req = leverRequest();
    if (s.gear > 0 && (req === null || req === s.gear || s.stuck)) { [gx, gy] = SLOT[s.gear]; if (s.stuck) jitter = 1.5; }
    else if (req > 0 && s.gear !== req) { const [c, r] = SLOT[req]; gx = c; gy = r * 0.72; if (s.grind > 0) jitter = 3; }
    else if (gateUI.dragging) { gx = gateUI.gx; gy = gateUI.gy; }
    else { gx = clamp(gateUI.lastGx, 0, 2); gy = 0; if (s.gear === 0 && Math.round(gx) !== gx && false) gx = 1; }
    let [kx, ky] = gateToPx(gx, gy, G);
    if (jitter && !reduceMotion) { kx += (Math.random() - 0.5) * jitter * 2; ky += (Math.random() - 0.5) * jitter * 2; }
    const kr = Math.max(13, G.colW * 0.24);
    const grad = ctx.createRadialGradient(kx - kr * 0.3, ky - kr * 0.35, kr * 0.1, kx, ky, kr);
    grad.addColorStop(0, '#6a6a5c'); grad.addColorStop(1, '#10100c');
    ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(kx, ky, kr, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = s.grind > 0 ? '#e0643f' : s.stuck ? '#e0b84a' : '#000'; ctx.lineWidth = 2; ctx.stroke();
  }

  // ------------------------------------------------------------ hints
  let hintText = '', hintCls = '';
  function setHint(t, cls) {
    if (t === hintText && cls === hintCls) return;
    hintText = t; hintCls = cls || '';
    const el = $('hint');
    el.textContent = t; el.className = (t ? 'show ' : '') + (cls || '');
  }
  const ORD = ['', '1st', '2nd', '3rd', '4th', '5th'];
  function computeHint() {
    const s = sim, m = s.mission;
    const rpm = s.we * W2RPM, wi = s.wi * W2RPM, tolR = s.tol * W2RPM;
    if (!s.running) return ['Stalled. Clutch down or neutral, then START (E).', 'warn'];
    if (s.t - linkageMsgT < 5) return ['Clutch linkage snapped! Pedal is dead. Float the gears: ease the gas to unload, match revs, slip it in.', 'warn'];
    if (s.grind > 0) return [`GRINDING ${ORD[s.grindTarget]}: input shaft ${Math.round(s.grind)} rpm off. Let go, match the revs.`, 'warn'];
    if (s.stuck) return [s.clutchBroken ? 'Gears are loaded. Feather the gas until it pops out.' : 'Gears are loaded. Clutch in (or feather the gas) to pull it out.', 'warn'];
    if (s.overrev) return ['Over-revving! Too low a gear for this speed.', 'warn'];
    if (m.brakes && s.brakeTemp > 260) return ['Brakes fading - get into a lower gear and let the engine hold you.', 'warn'];
    if (DEMO) return ['', ''];
    const coach = m.coach || runIdx === 1;
    if (!coach) {
      if (s.t < 5 && s.gear === 0 && s.v < 0.3) return ['Clutch down, wait for the amber needle to stop, then 1st.', ''];
      return ['', ''];
    }
    const need = (g) => S.gearInputW(s, g) * W2RPM;
    if (s.gear === 0) {
      if (s.v < 0.4) {
        if (s.engage > 0.05) return ['Hold the CLUTCH down (Shift).', ''];
        if (wi > tolR) return ['Wait: the amber input-shaft needle is still spinning down...', ''];
        return ['Now push the lever into 1st (hold key 1, or drag the knob up-left).', 'good'];
      }
      // rolling in neutral
      const nextUp = Math.min(5, Math.max(1, (s._lastGear || 1) + 1));
      const tgt = s._wantGear || nextUp;
      const d = wi - need(tgt);
      if (Math.abs(d) < tolR) return [s.engage > 0.05 ? `Matched for ${ORD[tgt]}! Clutch in and push it home.` : `Matched! Push into ${ORD[tgt]}.`, 'good'];
      if (s.engage < 0.5) return [d > 0 ? 'Neutral, clutch down: the shaft barely slows. Let the clutch OUT so the engine drags it down.' : 'Too slow for that gear: clutch out and blip the gas.', ''];
      return [d > 0 ? `Clutch out in neutral: let the revs fall to the ${tgt} tick...` : `Blip the gas: bring the white needle up to the ${tgt} tick.`, ''];
    }
    if (s.gear >= 1 && s.v < 1.2 && s.engage < 1) return ['Ease the clutch out with a little GAS.', ''];
    if (s.gear < 3 && rpm > 1900 && m.coach) return [`Upshift: clutch in, lever to N (key N or 0).`, ''];
    if (m.coach && s.gear >= 3) return ['Good. Hold it there and roll through the gate.', 'good'];
    if (runIdx === 1 && s.gear === 4 && rpm < 1150) return ['Lugging on the rise: double-clutch down to 3rd (blip in neutral).', ''];
    return ['', ''];
  }

  // ------------------------------------------------------------ particles / fx
  function emit(dt) {
    const s = sim;
    const night = !!s.mission.night;
    const e0 = s.terrain.elev(s.x);
    if (s.running && !reduceMotion) {
      const rate = 6 + s.thr * 36 * (s.we * W2RPM / 2000);
      if (Math.random() < rate * dt) {
        particles.push({ x: s.x + 0.1, e: e0, h: 0.5, vx: s.v * 0.7 - 1.5, vh: 0.4 + Math.random() * 0.4, r: 0.18 + s.thr * 0.25,
          t: 0, life: 1.2 + Math.random(), a: night ? 0.15 : 0.35 + s.thr * 0.3, c: s.thr > 0.6 ? '#2d2b28' : '#77756c' });
      }
    }
    if (s.v > 2 && !reduceMotion && !night && Math.random() < s.v * 0.9 * dt) {
      particles.push({ x: s.x - 2.6, e: e0, h: 0.2, vx: s.v * 0.5, vh: 0.3, r: 0.3, t: 0, life: 1.4, a: 0.25, c: '#a89a73' });
    }
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.t += dt; p.x += p.vx * dt; p.vx *= 1 - dt * 1.5; p.h += p.vh * dt;
      if (p.t > p.life) particles.splice(i, 1);
    }
    if (particles.length > 160) particles.splice(0, particles.length - 160);
  }

  function handleEvents() {
    const s = sim;
    for (const e of s.events) {
      A.event(e);
      if (e.type === 'clunk') { gearPop = 1; shake = Math.max(shake, 1.5 + 3 * (e.strength || 0)); s._lastGear = e.gear; clunkFlash = 0.3; }
      else if (e.type === 'grind') { shake = Math.max(shake, 7); flash = 1; }
      else if (e.type === 'stall') { shake = Math.max(shake, 5); }
      else if (e.type === 'linkage') { shake = Math.max(shake, 8); linkageMsgT = s.t; $('pClutch').classList.add('disabled'); }
      else if (e.type === 'pop') { if (s.gear === 0) s._lastGear = s._lastGear || 1; }
    }
    s.events.length = 0;
  }

  // ------------------------------------------------------------ main loop
  let last = performance.now(), acc = 0;
  const DT = 1 / 120;
  let rafPending = false, lastFrameT = 0;
  function schedule() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame((t) => { rafPending = false; frame(t); });
  }
  function frame(now) {
    lastFrameT = performance.now();
    const dt = clamp((now - last) / 1000, 0, 0.1); last = now;
    if (mode === 'drive' && sim) {
      acc += dt;
      while (acc >= DT) {
        acc -= DT;
        if (PLAYTEST) {   // drive the REAL player-input path (binary pedals) with the bot's decisions
          const bi = S.botInput(pbot, sim, DT);
          keys.clutch = bi.clutch > 0.5; touch.gas = bi.throttle; touch.brake = bi.brake > 0.3;
          keyReq = bi.lever; startPressed = !!bi.start;
        }
        const inp = bot ? S.botInput(bot, sim, DT) : playerInput();
        // remember which gear the player is aiming for (for the coach)
        if (inp.lever > 0) sim._wantGear = inp.lever;
        else if (sim.gear > 0) sim._wantGear = null;
        S.step(sim, inp, DT);
        startPressed = false;
        if (sim.events.length) handleEvents();
        if (sim.done) break;
      }
      if (sim.grind > 0) shake = Math.max(shake, 2.2);
      emit(dt);
      A.update(sim, false);
      const [t, c] = computeHint(); setHint(t, c);
      $('btnStart').classList.toggle('show', !sim.running);
      const km = (x) => (x / 1000).toFixed(2);
      $('progress').textContent = `${km(Math.min(sim.x, sim.mission.len))} / ${km(sim.mission.len)} km \u00b7 ${fmtTime(sim.t)}`;
      $('gasFill').style.height = Math.round(sim.thr * 100) + '%';
      if (sim.done) {
        endTimer += dt;
        if (endTimer > (sim.failed ? 1.2 : 0.9)) finishRun();
      }
    } else if (sim) {
      A.update(sim, true);
    }
    shake = Math.max(0, shake - dt * 18); flash = Math.max(0, flash - dt * 2.5); gearPop = Math.max(0, gearPop - dt * 4);
    if (sim) { renderScene(dt); renderDash(); renderGate(); }
    schedule();
  }
  // watchdog: keeps the sim alive where rAF is throttled (headless capture, some embedded views)
  setInterval(() => { if (performance.now() - lastFrameT > 150) frame(performance.now()); }, 100);
  const fmtTime = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

  // ------------------------------------------------------------ flow
  const overlays = ['ovTitle', 'ovHow', 'ovRuns', 'ovBrief', 'ovPause', 'ovResult'];
  function show(id) { for (const o of overlays) $(o).classList.toggle('show', o === id); }
  let howReturn = 'ovTitle';

  function buildRunList() {
    const list = $('runList'); list.innerHTML = '';
    S.MISSIONS.forEach((m, i) => {
      const b = document.createElement('button');
      const best = save.best[m.id];
      b.innerHTML = `<span class="n">${i + 1}</span><span class="t"><b></b><small></small></span><span class="g">${best ? best.grade : '\u2013'}</span>`;
      b.querySelector('b').textContent = m.name;
      b.querySelector('small').textContent = m.brief;
      b.addEventListener('click', () => { A.init(); A.event({ type: 'ui' }); openBrief(i); });
      list.appendChild(b);
    });
    const done = S.MISSIONS.filter((m) => save.best[m.id] && save.best[m.id].grade !== 'F');
    const total = S.MISSIONS.reduce((a, m) => a + (save.best[m.id] ? save.best[m.id].pts : 0), 0);
    $('campaign').textContent = done.length === S.MISSIONS.length
      ? `All five runs delivered. Campaign total ${total} / 5000. Keep 'em rolling - try for S on every run.`
      : `${done.length} of 5 runs delivered. Runs are open in any order; 1 to 5 is the intended path.`;
  }
  function openRuns() { buildRunList(); show('ovRuns'); mode = 'runs'; }
  function openBrief(i) {
    runIdx = i; const m = S.MISSIONS[i];
    $('briefNum').textContent = `Run ${i + 1} of 5`;
    $('briefName').textContent = m.name;
    $('briefText').textContent = m.brief;
    const rules = [`${(m.len / 1000).toFixed(1)} km`, `mesh window \u00b1${m.tol} rpm`];
    if (m.lead) rules.push('stay 30-120 yd behind the truck ahead', '25 mph limit');
    if (m.par) rules.push(`par ${m.par} s`);
    if (m.night) rules.push('no instruments');
    $('briefRules').textContent = rules.join(' \u00b7 ');
    show('ovBrief'); mode = 'brief';
    // preview the start line behind the card
    sim = S.createSim(m); particles.length = 0;
  }
  function startRun(i) {
    runIdx = i;
    sim = S.createSim(S.MISSIONS[i]);
    bot = DEMO ? S.createBot() : null;
    particles.length = 0; endTimer = 0; linkageMsgT = -10; camE = sim.terrain.elev(0);
    $('pClutch').classList.remove('disabled');
    $('runName').textContent = `${i + 1}. ${S.MISSIONS[i].name}`;
    show(null); mode = 'drive'; acc = 0; last = performance.now();
  }
  function pause() { if (mode !== 'drive') return; mode = 'paused'; show('ovPause'); A.update(sim, true); }
  function resume() { if (mode !== 'paused') return; show(null); mode = 'drive'; last = performance.now(); A.resume(); }
  function finishRun() {
    mode = 'result';
    const s = sim, m = s.mission, sc = S.score(s);
    A.update(s, true);
    A.event({ type: s.failed ? 'fail' : 'win' });
    const prev = save.best[m.id];
    const better = !prev || sc.pts > prev.pts;
    if (better) { save.best[m.id] = { grade: sc.grade, pts: sc.pts }; persist(); }
    $('resEyebrow').textContent = `Driver's log \u00b7 run ${runIdx + 1}`;
    $('resTitle').textContent = s.failed === 'gearbox' ? 'Gearbox stripped' : s.failed === 'lost' ? 'Lost the convoy' : `${m.name}: delivered`;
    const words = { S: 'keep \'em rolling', A: 'clean driving', B: 'solid', C: 'rough', D: 'the motor pool will have words', F: 'not delivered' };
    $('resGrade').innerHTML = `${sc.grade}<small>${sc.pts} pts \u00b7 ${words[sc.grade]}</small>`;
    const rows = [['Time', fmtTime(s.t)], ['Clean shifts', String(Math.max(0, s.stats.shifts))]];
    for (const [label, d] of sc.lines) rows.push([label, String(d)]);
    if (!sc.lines.length) rows.push(['Penalties', 'none']);
    const tbl = $('resLines'); tbl.innerHTML = '';
    for (const [a, b] of rows) { const tr = document.createElement('tr'); const t1 = document.createElement('td'); const t2 = document.createElement('td'); t1.textContent = a; t2.textContent = b; tr.append(t1, t2); tbl.appendChild(tr); }
    const notes = {
      gearbox: 'Too much grinding: the teeth chewed themselves up. Match the gear tick before pushing the lever.',
      lost: 'The convoy rolled on without you. Keep it moving - a missed shift on a hill costs more speed than it seems.',
    };
    $('resNote').textContent = s.failed ? notes[s.failed] : (better && prev ? `New best (was ${prev.grade} ${prev.pts}).` : (prev && !better ? `Best so far: ${prev.grade} ${prev.pts}.` : ''));
    $('btnNext').style.display = runIdx < S.MISSIONS.length - 1 ? '' : 'none';
    show('ovResult');
  }

  function toggleMute() {
    const m = !A.isMuted(); A.setMuted(m); save.muted = m; persist();
    $('btnMute').classList.toggle('off', m);
  }

  $('btnPlay').addEventListener('click', () => { A.init(); A.event({ type: 'ui' }); openRuns(); });
  $('btnHow').addEventListener('click', () => { howReturn = 'ovTitle'; show('ovHow'); });
  $('btnRunsHow').addEventListener('click', () => { howReturn = 'ovRuns'; show('ovHow'); });
  $('btnHowBack').addEventListener('click', () => { if (howReturn === 'ovRuns') openRuns(); else show('ovTitle'); });
  $('btnRunsBack').addEventListener('click', () => { show('ovTitle'); mode = 'title'; });
  $('btnBriefBack').addEventListener('click', () => openRuns());
  $('btnGo').addEventListener('click', () => { A.init(); startRun(runIdx); });
  $('btnPause').addEventListener('click', () => { if (mode === 'drive') pause(); });
  $('btnMute').addEventListener('click', toggleMute);
  $('btnResume').addEventListener('click', resume);
  $('btnRestart').addEventListener('click', () => startRun(runIdx));
  $('btnQuit').addEventListener('click', openRuns);
  $('btnNext').addEventListener('click', () => openBrief(runIdx + 1));
  $('btnRetry').addEventListener('click', () => startRun(runIdx));
  $('btnResRuns').addEventListener('click', openRuns);
  document.addEventListener('visibilitychange', () => { if (document.hidden && !DEMO) { pause(); A.suspend(); } });

  // ------------------------------------------------------------ boot
  A.setMuted(!!save.muted); $('btnMute').classList.toggle('off', !!save.muted);
  DPR = Math.min(2, window.devicePixelRatio || 1);
  window.addEventListener('resize', () => { DPR = Math.min(2, window.devicePixelRatio || 1); });
  sim = S.createSim(S.MISSIONS[0]);
  if (DEMO) {
    const n = clamp(parseInt(params.get('demo'), 10) || 2, 1, 5) - 1;
    startRun(n);
    // fast-forward so a screenshot shows the convoy under way
    const ff = parseFloat(params.get('t') || '38');
    while (sim.t < ff && !sim.done) { const inp = S.botInput(bot, sim, DT); S.step(sim, inp, DT); emit(DT); sim.events.length = 0; }
    camE = sim.terrain.elev(sim.x);
  }
  if (params.has('selftest')) {
    const out = [];
    for (const m of S.MISSIONS) {
      const s = S.createSim(m), b = S.createBot();
      while (!s.done && s.t < 900) S.step(s, S.botInput(b, s, DT), DT);
      out.push(`${m.id}: ${s.done && !s.failed ? 'PASS' : 'FAIL'} (${Math.round(s.t)} s, grade ${S.score(s).grade})`);
    }
    console.log('[selftest] ' + out.join(' | '));
    const pre = document.createElement('pre'); pre.id = 'selftest'; pre.textContent = out.join('\n');
    pre.style.cssText = 'position:fixed;left:8px;top:48px;z-index:20;background:#000c;padding:8px;margin:0;font-size:12px';
    document.body.appendChild(pre);
  }
  if (PLAYTEST) {
    const log = []; const idx = clamp(parseInt(params.get('playtest'), 10) || 1, 1, 5) - 1;
    const click = (id) => { const el = $(id); if (!el) { log.push('MISSING ' + id); return; } el.click(); };
    click('btnPlay'); log.push('runs overlay: ' + $('runList').children.length + ' entries');
    openBrief(idx); log.push('brief: ' + $('briefName').textContent); click('btnGo');
    log.push('mode after Go: ' + mode);
    const poll = setInterval(() => {
      if (mode === 'result') {
        clearInterval(poll);
        log.push('RESULT: ' + $('resTitle').textContent + ' / ' + $('resGrade').textContent + ' / ' + $('resLines').textContent);
        const pre = document.createElement('pre'); pre.id = 'playtest'; pre.textContent = log.join(' ;; '); document.body.appendChild(pre);
        console.log('[playtest] ' + log.join(' ;; '));
      }
    }, 200);
  }
  if (params.has('layout')) {
    const ids = ['sceneWrap','topbar','console','pClutch','pBrake','dashWrap','gateWrap','btnStart','pGas'];
    const rows = ids.map(id => { const r = $(id).getBoundingClientRect(); return `${id}: x${Math.round(r.left)} y${Math.round(r.top)} w${Math.round(r.width)} h${Math.round(r.height)}`; });
    rows.push(`viewport ${innerWidth}x${innerHeight} scrollW ${document.documentElement.scrollWidth} scrollH ${document.documentElement.scrollHeight}`);
    const pre = document.createElement('pre'); pre.id = 'layout'; pre.textContent = rows.join(' | '); pre.style.display = 'none'; document.body.appendChild(pre);
  }
  schedule();
})();
