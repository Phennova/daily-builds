// LOCAL ONLY - the bench: canvas drawings of the devices, the sniffer and the probe wires. window.BENCH
(function () {
  'use strict';
  const W = 640, H = 400;
  let fanAngle = 0, lastT = 0;
  const pulses = [];             // traffic pulses travelling along the probe wire
  let flash = null;              // {t, ok}

  function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  function text(c, s, x, y, size, color, align, font) {
    c.font = (font || '600 ') + size + 'px ' + (font && font.indexOf('mono') >= 0 ? '' : 'ui-monospace, Menlo, Consolas, monospace');
    c.fillStyle = color; c.textAlign = align || 'left'; c.textBaseline = 'middle'; c.fillText(s, x, y);
  }
  function cloudIcon(c, x, y, on, s) {
    s = s || 1;
    c.save(); c.translate(x, y); c.scale(s, s);
    c.beginPath(); c.arc(-8, 2, 7, Math.PI * 0.5, Math.PI * 1.5); c.arc(0, -4, 9, Math.PI, 0); c.arc(9, 2, 7, Math.PI * 1.5, Math.PI * 0.5); c.closePath();
    c.fillStyle = on ? '#f2c35b' : '#3a2524'; c.fill();
    if (!on) { c.strokeStyle = '#ff7a6b'; c.lineWidth = 2.2; c.beginPath(); c.moveTo(-14, 10); c.lineTo(15, -12); c.stroke(); }
    c.restore();
  }

  function bench(c) {
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#12181c'); g.addColorStop(1, '#0b1012');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    // cutting-mat grid
    c.strokeStyle = 'rgba(120,170,150,0.06)'; c.lineWidth = 1;
    for (let x = 0; x <= W; x += 20) { c.beginPath(); c.moveTo(x + 0.5, 0); c.lineTo(x + 0.5, H); c.stroke(); }
    for (let y = 0; y <= H; y += 20) { c.beginPath(); c.moveTo(0, y + 0.5); c.lineTo(W, y + 0.5); c.stroke(); }
  }

  function sniffer(c, now, kind) {
    const x = 470, y = 268, w = 150, h = 96;
    // probe wires: from the analyser to the device's test pads
    const tx = kind === 'lock' ? 262 : kind === 'thermo' ? 300 : 300, ty = kind === 'lock' ? 300 : kind === 'thermo' ? 300 : 320;
    const wires = [['#a99bff', 0], ['#63d6e6', 8], ['#8be08f', 16]];
    wires.forEach(([col, o]) => {
      c.strokeStyle = col; c.globalAlpha = 0.55; c.lineWidth = 2.2;
      c.beginPath(); c.moveTo(x + 12 + o, y + 4); c.bezierCurveTo(x - 30 + o, y - 70, tx + 80, ty + 60, tx + o, ty); c.stroke();
      c.globalAlpha = 1;
      c.fillStyle = '#2a2f33'; rr(c, tx + o - 3, ty - 6, 6, 9, 2); c.fill();
    });
    // pulses on the data wire
    for (let i = pulses.length - 1; i >= 0; i--) {
      const p = pulses[i];
      const k = (now - p.t) / 650;
      if (k > 1) { pulses.splice(i, 1); continue; }
      const u = p.dir === 'tx' ? 1 - k : k;      // tx travels analyser->device visually reversed? keep: tx goes to device
      const s = 1 - u;
      // cubic bezier point (x+28,y+4) -> (tx+16,ty)
      const P0 = [x + 28, y + 4], P1 = [x - 14, y - 70], P2 = [tx + 96, ty + 60], P3 = [tx + 16, ty];
      const bx = s * s * s * P0[0] + 3 * s * s * u * P1[0] + 3 * s * u * u * P2[0] + u * u * u * P3[0];
      const by = s * s * s * P0[1] + 3 * s * s * u * P1[1] + 3 * s * u * u * P2[1] + u * u * u * P3[1];
      c.fillStyle = p.dir === 'tx' ? '#7cc4ff' : '#8be08f';
      c.shadowColor = c.fillStyle; c.shadowBlur = 12;
      c.beginPath(); c.arc(bx, by, 4, 0, Math.PI * 2); c.fill(); c.shadowBlur = 0;
    }
    // analyser box
    c.fillStyle = '#1b2227'; rr(c, x, y, w, h, 8); c.fill();
    c.strokeStyle = '#2d3a43'; c.lineWidth = 1.5; c.stroke();
    text(c, 'SNIFF-8', x + 12, y + 18, 12, '#8796a1');
    text(c, 'LOGIC / UART / BLE', x + 12, y + 34, 9, '#55636e');
    const active = pulses.length > 0;
    c.fillStyle = active ? '#8be08f' : '#23412e'; c.beginPath(); c.arc(x + w - 16, y + 18, 5, 0, Math.PI * 2); c.fill();
    // tiny scrolling trace
    c.strokeStyle = '#3f6f55'; c.lineWidth = 1.2; c.beginPath();
    for (let i = 0; i <= 120; i++) {
      const xx = x + 14 + i, bit = active ? ((Math.floor((now / 12 + i) / 5) * 2654435761) >>> 0) % 3 === 0 : 0;
      const yy = y + 66 - (bit ? 10 : 0);
      if (i === 0) c.moveTo(xx, yy); else c.lineTo(xx, yy);
    }
    c.stroke();
  }

  function purifier(c, s, now, dt, reduced, prov) {
    const cx = 200, cy = 190;
    // shadow + body
    c.fillStyle = 'rgba(0,0,0,0.35)'; c.beginPath(); c.ellipse(cx, 352, 120, 14, 0, 0, Math.PI * 2); c.fill();
    const g = c.createLinearGradient(cx - 110, 0, cx + 110, 0);
    g.addColorStop(0, '#cbbfa8'); g.addColorStop(0.5, '#ddd2bd'); g.addColorStop(1, '#b9ad97');
    c.fillStyle = g; rr(c, cx - 110, 40, 220, 300, 26); c.fill();
    // legs
    c.strokeStyle = '#6b4e33'; c.lineWidth = 7; c.lineCap = 'round';
    c.beginPath(); c.moveTo(cx - 80, 338); c.lineTo(cx - 92, 356); c.moveTo(cx + 80, 338); c.lineTo(cx + 92, 356); c.stroke();
    // display strip
    c.fillStyle = '#1a1d1f'; rr(c, cx - 62, 56, 124, 30, 8); c.fill();
    const on = prov ? !!s.prov : s.power;
    let disp;
    if (prov) disp = s.prov === 'local' ? 'LOCAL' : s.prov === 'cloud' ? 'CLOUD' : 'SET-UP';
    else disp = !s.power ? '--' : (s.speed === 4 ? 'TURBO' : 'SPD ' + s.speed) + (s.timer ? '  ' + Math.floor(s.timer / 60) + ':' + String(s.timer % 60).padStart(2, '0') : '');
    text(c, disp, cx, 71, disp.length > 8 ? 12 : 14, on ? (s.speed === 4 && !prov ? '#7cc4ff' : '#8be08f') : '#3c4a40', 'center');
    // front: LED ring + grille + fan
    const R = 86, fy = 210;
    const pm = s.pm || 12;
    const ringCol = !on ? '#2b2b2b' : prov ? (s.prov === 'local' ? '#6fd39a' : s.prov === 'cloud' ? '#f2c35b' : '#7cc4ff') : (s.speed === 4 ? '#9fd8ff' : pm < 15 ? '#6fd39a' : pm < 25 ? '#d8d36f' : '#f2a05b');
    c.save();
    if (on) { c.shadowColor = ringCol; c.shadowBlur = s.speed === 4 && !prov ? 26 : 12; }
    c.strokeStyle = ringCol; c.lineWidth = 6; c.beginPath(); c.arc(cx, fy, R + 6, 0, Math.PI * 2); c.stroke();
    c.restore();
    c.fillStyle = '#2a2724'; c.beginPath(); c.arc(cx, fy, R, 0, Math.PI * 2); c.fill();
    const speed = prov ? (s.prov ? 1 : 0) : (s.power ? s.speed : 0);
    if (!reduced) fanAngle += dt * (speed === 0 ? 0 : 4 + speed * speed * 3.2);
    c.save(); c.translate(cx, fy); c.rotate(fanAngle);
    const blades = 7;
    for (let i = 0; i < blades; i++) {
      c.rotate(Math.PI * 2 / blades);
      c.fillStyle = speed >= 3 && !reduced ? 'rgba(120,120,115,0.45)' : '#6d6a64';
      c.beginPath(); c.moveTo(6, -4); c.quadraticCurveTo(R * 0.55, -R * 0.42, R * 0.86, -6); c.quadraticCurveTo(R * 0.5, 6, 6, 6); c.closePath(); c.fill();
    }
    c.restore();
    c.fillStyle = '#4b4741'; c.beginPath(); c.arc(cx, fy, 14, 0, Math.PI * 2); c.fill();
    // grille rings
    c.strokeStyle = 'rgba(210,200,185,0.22)'; c.lineWidth = 1;
    for (let r = 22; r < R; r += 9) { c.beginPath(); c.arc(cx, fy, r, 0, Math.PI * 2); c.stroke(); }
    // light
    if (!prov && s.light && s.power) { c.fillStyle = '#ffd98a'; c.beginPath(); c.arc(cx + 88, 71, 4, 0, Math.PI * 2); c.fill(); }
    // BLE pulse during provisioning
    if (prov && !reduced) {
      const k = (now / 1200) % 1;
      c.strokeStyle = 'rgba(124,196,255,' + (1 - k) * 0.6 + ')'; c.lineWidth = 2;
      c.beginPath(); c.arc(cx + 92, 106, 6 + k * 18, 0, Math.PI * 2); c.stroke();
    }
    if (prov) text(c, '\u16D2 BLE', cx + 80, 106, 10, '#7cc4ff', 'center');
    // label plate
    text(c, 'AirLux IconAir', cx, 322, 11, '#6e6455', 'center');
  }

  function lock(c, s, now) {
    // door
    const dx = 60, dy = 30, dw = 300, dh = 340;
    const g = c.createLinearGradient(dx, 0, dx + dw, 0);
    g.addColorStop(0, '#4a3324'); g.addColorStop(1, '#5c4030');
    c.fillStyle = g; c.fillRect(dx, dy, dw, dh);
    c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = 2;
    c.strokeRect(dx + 26, dy + 26, dw - 52, 130); c.strokeRect(dx + 26, dy + 180, dw - 52, 134);
    // frame + strike
    c.fillStyle = '#2b2522'; c.fillRect(dx + dw, dy - 10, 34, dh + 20);
    c.fillStyle = '#8d8a83'; rr(c, dx + dw + 6, 172, 20, 46, 3); c.fill();
    c.fillStyle = '#1a1716'; rr(c, dx + dw + 11, 186, 10, 18, 2); c.fill();
    // lock body
    const bx = dx + dw - 110, by = 140;
    c.fillStyle = '#20262b'; rr(c, bx, by, 92, 112, 12); c.fill();
    c.strokeStyle = '#39444d'; c.lineWidth = 1.5; c.stroke();
    // bolt (animated toward state)
    s._b = s._b === undefined ? s.bolt : s._b + (s.bolt - s._b) * 0.18;
    const ext = 6 + s._b * 32;
    c.fillStyle = '#b8b5ad'; rr(c, bx + 92 - 6, 188, ext + 6, 14, 3); c.fill();
    // keypad
    for (let r = 0; r < 3; r++) for (let q = 0; q < 3; q++) { c.fillStyle = '#2e373e'; rr(c, bx + 14 + q * 22, by + 40 + r * 20, 18, 14, 3); c.fill(); }
    const col = s.bolt ? '#ff7a6b' : '#6fd39a';
    c.save(); c.shadowColor = col; c.shadowBlur = 10; c.fillStyle = col; c.beginPath(); c.arc(bx + 46, by + 20, 5, 0, Math.PI * 2); c.fill(); c.restore();
    text(c, s.bolt ? 'LOCKED' : 'UNLOCKED', bx + 46, by + 108 + 18, 12, col, 'center');
    text(c, 'auto-lock ' + (s.autolock >= 60 && s.autolock % 60 === 0 ? s.autolock / 60 + ' min' : s.autolock + ' s'), bx + 46, by + 108 + 36, 10.5, '#b9c2c8', 'center');
    text(c, 'batt ' + s.battery + '%', bx + 46, by + 108 + 52, 10.5, '#8796a1', 'center');
    // handle
    c.fillStyle = '#9a968e'; rr(c, bx - 12, 240, 46, 12, 6); c.fill();
  }

  function thermo(c, s, now, reduced) {
    const cx = 200, cy = 180;
    // wall
    c.fillStyle = '#1d2327'; rr(c, 60, 30, 290, 330, 14); c.fill();
    c.fillStyle = 'rgba(0,0,0,0.3)'; c.beginPath(); c.arc(cx + 4, cy + 8, 104, 0, Math.PI * 2); c.fill();
    const g = c.createRadialGradient(cx - 30, cy - 40, 10, cx, cy, 104);
    g.addColorStop(0, '#e9ecee'); g.addColorStop(1, '#a9b0b5');
    c.fillStyle = g; c.beginPath(); c.arc(cx, cy, 100, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#101417'; c.beginPath(); c.arc(cx, cy, 78, 0, Math.PI * 2); c.fill();
    // setpoint arc 5..30 C
    const k = Math.max(0, Math.min(1, (s.setpoint - 50) / 250));
    const a0 = Math.PI * 0.75, a1 = a0 + Math.PI * 1.5 * k;
    c.lineCap = 'round';
    c.strokeStyle = '#2b3338'; c.lineWidth = 6; c.beginPath(); c.arc(cx, cy, 66, a0, a0 + Math.PI * 1.5); c.stroke();
    const col = s.mode ? (s.setpoint < 100 ? '#7cc4ff' : '#ff9a62') : '#55636e';
    c.strokeStyle = col; c.beginPath(); c.arc(cx, cy, 66, a0, a1); c.stroke();
    text(c, (s.setpoint / 10).toFixed(1) + '\u00b0', cx, cy - 4, 34, s.mode ? '#f3f6f8' : '#6b7780', 'center');
    text(c, s.mode ? (s.setpoint < 100 ? 'FROST GUARD' : 'HEAT') : 'OFF', cx, cy + 30, 11, col, 'center');
    text(c, 'room ' + (s.room / 10).toFixed(1) + '\u00b0', cx, cy - 42, 11, '#8796a1', 'center');
    if (s.mode && s.setpoint > s.room && !reduced) {
      const f = 0.6 + 0.4 * Math.sin(now / 160);
      c.fillStyle = 'rgba(255,154,98,' + f + ')';
      c.beginPath(); c.moveTo(cx, cy + 44); c.quadraticCurveTo(cx + 9, cy + 54, cx, cy + 62); c.quadraticCurveTo(cx - 9, cy + 54, cx, cy + 44); c.fill();
    }
    // the sticker (the key is printed right here)
    const mac = s.mac.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(':');
    c.save(); c.translate(cx, 318); c.rotate(-0.025);
    c.fillStyle = '#e8e4d8'; rr(c, -122, -24, 244, 48, 4); c.fill();
    text(c, 'AirLux T3  BLE', -112, -10, 10, '#4b4a44');
    text(c, 'MAC ' + mac, -112, 9, 13.5, '#1b1a17', 'left', '700 ');
    c.restore();
  }

  function draw(cv, kind, s, opts) {
    const c = cv.getContext('2d');
    const now = performance.now();
    const dt = lastT ? Math.min(0.05, (now - lastT) / 1000) : 0; lastT = now;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = Math.round(cv.clientWidth * dpr) || W, ch = Math.round(cv.clientWidth * dpr * H / W) || H;
    if (cv.width !== cw || cv.height !== ch) { cv.width = cw; cv.height = ch; }
    c.setTransform(cv.width / W, 0, 0, cv.height / H, 0, 0);
    bench(c);
    sniffer(c, now, kind);
    if (kind === 'purifier' || kind === 'prov') purifier(c, s, now, dt, opts.reduced, kind === 'prov');
    else if (kind === 'lock') lock(c, s, now);
    else if (kind === 'thermo') thermo(c, s, now, opts.reduced);
    // cloud lamp
    cloudIcon(c, 590, 34, s.cloud !== false, 1.1);
    text(c, s.cloud !== false ? 'cloud' : 'cloud gone', 590, 60, 10, s.cloud !== false ? '#8796a1' : '#ff7a6b', 'center');
    if (opts.local) { text(c, 'LOCAL \u2713', 590, 80, 11, '#6fd39a', 'center'); }
    // flash on reply / error
    if (flash) {
      const k = (now - flash.t) / 500;
      if (k > 1) flash = null;
      else { c.fillStyle = (flash.ok ? 'rgba(111,211,154,' : 'rgba(255,122,107,') + (0.16 * (1 - k)) + ')'; c.fillRect(0, 0, W, H); }
    }
  }
  function traffic(dir) { pulses.push({ t: performance.now(), dir }); }
  function blink(ok) { flash = { t: performance.now(), ok }; }
  window.BENCH = { draw, traffic, blink };
})();
