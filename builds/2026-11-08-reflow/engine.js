// engine.js - terrain from real layout + reader physics. No DOM writes here except reading layout.
(function (global) {
  'use strict';
  const W = 360, H = 540;
  const P = { SPEED: 0.5, G: 0.12, VMAX: 3.5, STEP: 4, BODY: 12, SAFE: 96, PAD: 3 };

  // Read the laid-out page: every visible text fragment (one rect per line box) and every .solid box.
  function measure(pageEl) {
    const pr = pageEl.getBoundingClientRect();
    const s = pr.width / W;
    const tr = r => ({ l: (r.left - pr.left) / s, t: (r.top - pr.top) / s, r: (r.right - pr.left) / s, b: (r.bottom - pr.top) / s });
    const solids = [];
    const range = document.createRange();
    const tw = document.createTreeWalker(pageEl, NodeFilter.SHOW_TEXT);
    const visCache = new Map();
    const visible = el => {
      if (visCache.has(el)) return visCache.get(el);
      const v = getComputedStyle(el).visibility === 'visible' && !el.closest('.nosolid');
      visCache.set(el, v); return v;
    };
    let n;
    while ((n = tw.nextNode())) {
      if (!/\S/.test(n.data)) continue;
      const el = n.parentElement; if (!el || !visible(el)) continue;
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) {
        if (r.width < 1 || r.height < 1) continue;
        const q = tr(r); q.kind = 'text'; q.el = el; solids.push(q);
      }
    }
    for (const el of pageEl.querySelectorAll('.solid')) {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1 || !visible(el)) continue;
      const q = tr(r); q.kind = 'box'; q.el = el; solids.push(q);
    }
    let exit = null;
    const ex = pageEl.querySelector('.exit');
    if (ex) { const r = ex.getBoundingClientRect(); if (r.width > 0) exit = tr(r); }
    return { solids, exit };
  }

  class Sim {
    constructor(level, measureFn) {
      this.L = level; this.measureFn = measureFn;
      this.walkers = []; this.t = 0; this.spawned = 0;
      this.saved = 0; this.splat = 0; this.lost = 0;
      this.events = [];
      this.delay = level.delay == null ? 60 : level.delay;
      this.interval = level.interval || 50;
      this.limit = level.time || 3600;
      this.relayout();
    }
    relayout() {
      const m = this.measureFn();
      this.solids = m.solids; this.exit = m.exit;
      for (const w of this.walkers) if (w.state === 'walk' || w.state === 'fall') this.eject(w);
    }
    // A reader whose feet ended up inside a solid after a reflow is pushed up onto its top.
    eject(w) {
      let moved = false;
      for (let k = 0; k < 12; k++) {
        let hit = null;
        for (const s of this.solids) if (w.x > s.l && w.x < s.r && s.t < w.y - 0.5 && s.b > w.y - 0.5) { if (!hit || s.t < hit.t) hit = s; }
        if (!hit) break;
        w.y = hit.t; moved = true;
      }
      if (moved) { w.fallStart = w.y; if (w.state === 'fall') { w.state = 'walk'; w.vy = 0; } this.events.push({ type: 'eject', x: w.x, y: w.y }); }
    }
    active() { return this.walkers.filter(w => w.state === 'walk' || w.state === 'fall').length; }
    finished() { return this.t >= this.limit || (this.spawned >= this.L.count && this.active() === 0); }
    step() {
      const L = this.L;
      if (this.spawned < L.count && this.t >= this.delay && (this.t - this.delay) % this.interval === 0) {
        this.walkers.push({ id: this.spawned, x: L.hatch.x, y: L.hatch.y, dir: L.hatch.dir || 1, state: 'fall', vy: 0, fallStart: L.hatch.y, age: 0 });
        this.spawned++; this.events.push({ type: 'spawn', x: L.hatch.x, y: L.hatch.y });
      }
      for (const w of this.walkers) this.stepWalker(w);
      this.t++;
    }
    support(x, y) {
      let best = null;
      for (const s of this.solids) if (x >= s.l && x <= s.r && s.t >= y - P.STEP && s.t <= y + 1) { if (!best || s.t < best.t) best = s; }
      return best;
    }
    stepWalker(w) {
      if (w.state !== 'walk' && w.state !== 'fall') return;
      w.age++;
      if (w.state === 'walk') {
        let nx = w.x + w.dir * P.SPEED;
        let blocked = nx < P.PAD || nx > W - P.PAD;
        if (!blocked) for (const s of this.solids) {
          const inNew = nx >= s.l && nx <= s.r, inOld = w.x >= s.l && w.x <= s.r;
          if (inNew && !inOld && s.t < w.y - P.STEP && s.b > w.y - P.BODY) { blocked = true; break; }
        }
        if (blocked) { w.dir = -w.dir; this.events.push({ type: 'turn', x: w.x, y: w.y }); }
        else w.x = nx;
        const sp = this.support(w.x, w.y);
        if (sp) w.y = sp.t; else { w.state = 'fall'; w.vy = 0; w.fallStart = w.y; }
      } else {
        w.vy = Math.min(w.vy + P.G, P.VMAX);
        const ny = w.y + w.vy;
        let land = null;
        for (const s of this.solids) if (w.x >= s.l && w.x <= s.r && s.t >= w.y - 0.01 && s.t <= ny) { if (!land || s.t < land.t) land = s; }
        if (land) {
          w.y = land.t; w.vy = 0;
          if (w.y - w.fallStart > P.SAFE) { w.state = 'splat'; this.splat++; this.events.push({ type: 'splat', x: w.x, y: w.y }); return; }
          w.state = 'walk'; this.events.push({ type: 'land', x: w.x, y: w.y, h: w.y - w.fallStart });
        } else {
          w.y = ny;
          if (w.y > H + 30) { w.state = 'lost'; this.lost++; this.events.push({ type: 'lost', x: w.x, y: H }); return; }
        }
      }
      const e = this.exit;
      if (e && w.state === 'walk' && w.x >= e.l - P.PAD && w.x <= e.r + P.PAD && w.y >= e.t - P.PAD && w.y <= e.b + P.PAD) {
        w.state = 'saved'; this.saved++; this.events.push({ type: 'save', x: w.x, y: w.y });
      }
    }
  }

  // Stylesheet text for a level given current choices (choice[ruleIdx][declIdx] = option index).
  function levelCSS(level, choice) {
    const scope = css => css.replace(/([^{}]+)\{/g, (m, sel) => sel.split(',').map(x => '#page ' + x.trim()).join(', ') + ' {');
    let out = scope(level.css || '');
    level.rules.forEach((r, i) => {
      out += '\n' + scope(r.sel + ' {') + r.decls.map((d, j) => ' ' + d.p + ': ' + d.opts[choice[i][j]] + ';').join('') + ' }';
    });
    return out;
  }
  function initialChoice(level) { return level.rules.map(r => r.decls.map(d => d.v || 0)); }

  global.Engine = { W, H, P, measure, Sim, levelCSS, initialChoice };
})(window);
