/* Road Cut - geology model.
 * Pure logic, no DOM. Runs in the browser (window.Geo) and in node (require).
 *
 * World: a vertical cross-section W x H units, x to the right, y UP (elevation).
 * A world is a chronological list of events. Every event is defined in the coordinates of its own time.
 * A point of the present cliff is evaluated by walking backwards through time, undoing each deformation,
 * until its state is known (it was air above an erosion surface, or it is in the initial basement / air),
 * then replaying the fill rules forwards:
 *   deposit   fills only AIR below its level            (sediment settles in the basin)
 *   intrusion replaces only SOLID rock inside its shape (dike, pluton)
 *   erosion   turns everything above its surface into air
 * The material's pattern coordinates are the point's coordinates at the material's formation time, so bedding
 * patterns tilt, fold and slide with the rock.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Geo = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var W = 360, H = 200;
  var MAX_EVENTS = 30;

  // ---------- RNG ----------
  function hashSeed(s) {
    s = String(s);
    var h = 1779033703 ^ s.length;
    for (var i = 0; i < s.length; i++) {
      h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  }
  function makeRng(seed) {
    var a = hashSeed(seed);
    function next() {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    return {
      next: next,
      range: function (lo, hi) { return lo + (hi - lo) * next(); },
      int: function (lo, hi) { return lo + Math.floor(next() * (hi - lo + 1)); },
      pick: function (arr) { return arr[Math.floor(next() * arr.length)]; },
      sign: function () { return next() < 0.5 ? -1 : 1; },
      chance: function (p) { return next() < p; }
    };
  }

  // ---------- rocks ----------
  var ROCKS = {
    gneiss:       { name: 'Gneiss',        group: 'basement',    blurb: 'ancient crystalline basement, squeezed and banded deep in the crust' },
    sandstone:    { name: 'Sandstone',     group: 'sedimentary', blurb: 'sand from beaches, rivers and dunes, cemented into rock' },
    shale:        { name: 'Shale',         group: 'sedimentary', blurb: 'mud that settled in quiet deep water' },
    limestone:    { name: 'Limestone',     group: 'sedimentary', blurb: 'shells and lime mud from a warm shallow sea' },
    conglomerate: { name: 'Conglomerate',  group: 'sedimentary', blurb: 'rounded pebbles dumped by fast rivers' },
    siltstone:    { name: 'Siltstone',     group: 'sedimentary', blurb: 'silt from floodplains and deltas' },
    dolomite:     { name: 'Dolomite',      group: 'sedimentary', blurb: 'limestone altered by magnesium-rich water' },
    redbed:       { name: 'Red mudstone',  group: 'sedimentary', blurb: 'iron-stained mud from a dry continental basin' },
    coal:         { name: 'Coal',          group: 'sedimentary', blurb: 'buried swamp forests' },
    basalt:       { name: 'Basalt dike',   group: 'igneous',     blurb: 'magma that forced its way up a crack and froze' },
    granite:      { name: 'Granite',       group: 'igneous',     blurb: 'a huge body of magma that cooled slowly underground' }
  };
  var SED = ['sandstone', 'shale', 'limestone', 'conglomerate', 'siltstone', 'dolomite', 'redbed', 'coal'];

  var KIND_NAME = {
    basement: 'Basement', deposit: 'Layer', tilt: 'Tilting', fold: 'Folding', fault: 'Fault',
    dike: 'Dike', pluton: 'Pluton', erosion: 'Erosion', surface: 'Present land surface'
  };
  function isMaterial(e) { return e.kind === 'basement' || e.kind === 'deposit' || e.kind === 'dike' || e.kind === 'pluton'; }
  function isIntrusion(e) { return e.kind === 'dike' || e.kind === 'pluton'; }
  function isDeform(e) { return e.kind === 'tilt' || e.kind === 'fold'; }

  // ---------- event geometry ----------
  function surfaceY(e, x, t) {
    var y = e.level + e.a1 * Math.sin(x / e.l1 + e.p1) + e.a2 * Math.sin(x / e.l2 + e.p2);
    if (t < 1) y += (1 - t) * (e.animTop - e.level);
    return y;
  }
  function depositLevel(e, t) {
    if (t >= 1) return e.level;
    return e.animFrom + (e.animTo - e.animFrom) * t;
  }
  function dikeCenter(e, y) { return e.x + (y - H / 2) * e.lean + e.wob * Math.sin(y / e.wl + e.ph); }
  function insideIntrusion(e, x, y, t) {
    if (e.kind === 'dike') {
      if (t < 1 && y > -60 + t * (H + 160)) return false;
      return Math.abs(x - dikeCenter(e, y)) < e.w / 2;
    }
    // pluton: lobed blob rising from below
    var dx = x - e.cx, dy = (y - e.cy) / e.sq;
    var r = Math.sqrt(dx * dx + dy * dy);
    var ang = Math.atan2(dy, dx);
    var R = e.r * (1 + 0.13 * Math.sin(3 * ang + e.a1) + 0.07 * Math.sin(5 * ang + e.a2));
    if (t < 1) R *= t;
    return r < R;
  }

  // scratch buffers for evaluate()
  var LX = new Float64Array(MAX_EVENTS), LY = new Float64Array(MAX_EVENTS), FD = new Float64Array(MAX_EVENTS);

  /* Evaluate the point (px, py) after events 0..upto, where event `upto` is applied with progress t (0..1).
   * Writes into out: mat (event index of the material, -1 for air), fx, fy (pattern coordinates in the material's
   * own frame), faulted (bitmask of faults that broke this rock), side (bitmask: hanging-wall side of each fault),
   * fdist (distance to the nearest fault plane that broke it), fidx (that fault's index, -1 if none). */
  function evaluate(ev, px, py, upto, t, out) {
    var x = px, y = py, k, e, tt, c, s, dx, dy, d;
    var stop = -1, stopAir = true;
    for (k = upto; k >= 0; k--) {
      e = ev[k]; tt = k === upto ? t : 1;
      LX[k] = x; LY[k] = y;
      switch (e.kind) {
        case 'tilt':
          if (tt !== 0) {
            c = Math.cos(-e.ang * tt); s = Math.sin(-e.ang * tt);
            dx = x - e.px; dy = y - e.py;
            x = e.px + dx * c - dy * s; y = e.py + dx * s + dy * c;
          }
          break;
        case 'fold':
          y -= e.amp * tt * Math.sin(x / e.wl + e.ph);
          break;
        case 'fault':
          d = (x - e.px) * e.nx + (y - e.py) * e.ny;
          FD[k] = d;
          if (d > 0) { x -= e.slip * tt * e.ux; y -= e.slip * tt * e.uy; }
          break;
        case 'erosion':
        case 'surface':
          if (y > surfaceY(e, x, tt)) { stop = k; stopAir = true; }
          break;
        case 'basement':
          stop = 0; stopAir = !(y < e.level);
          break;
      }
      if (stop >= 0) break;
    }
    var mat = -1, fx = 0, fy = 0, faulted = 0, side = 0, fdist = 1e9, fidx = -1;
    if (!stopAir) { mat = 0; fx = LX[0]; fy = LY[0]; }
    for (k = stop + 1; k <= upto; k++) {
      e = ev[k]; tt = k === upto ? t : 1;
      x = LX[k]; y = LY[k];
      switch (e.kind) {
        case 'deposit':
          if (mat < 0 && y < depositLevel(e, tt)) { mat = k; fx = x; fy = y; }
          break;
        case 'dike':
        case 'pluton':
          if (mat >= 0 && tt > 0 && insideIntrusion(e, x, y, tt)) {
            mat = k; fx = x; fy = y; faulted = 0; side = 0; fdist = 1e9; fidx = -1;
          }
          break;
        case 'fault':
          if (mat >= 0) {
            faulted |= (1 << k);
            if (FD[k] > 0) side |= (1 << k);
            d = Math.abs(FD[k]);
            if (d < fdist) { fdist = d; fidx = k; }
          }
          break;
        case 'erosion':
        case 'surface':
          if (y > surfaceY(e, x, tt)) { mat = -1; faulted = 0; side = 0; fdist = 1e9; fidx = -1; }
          break;
      }
    }
    out.mat = mat; out.fx = fx; out.fy = fy; out.faulted = faulted; out.side = side;
    out.fdist = fdist; out.fidx = fidx;
    return out;
  }
  function newSample() { return { mat: -1, fx: 0, fy: 0, faulted: 0, side: 0, fdist: 1e9, fidx: -1 }; }

  // ---------- generator ----------
  // Templates: P<n> = package of n layers (the last one has no top; the next erosion trims it),
  // def = tilt or fold, intr = dike or pluton, E = erosion.
  var TEMPLATES = {
    1: ['P3', 'dike'],
    2: ['P4', 'fault', 'dike'],
    3: ['P3', 'tilt', 'E', 'P2'],
    4: ['P3', 'pluton', 'E', 'P3', 'fault'],
    5: ['P3', 'fold', 'E', 'P2', 'dike'],
    6: ['P3', 'fault', 'tilt', 'E', 'P2', 'dike'],
    7: ['P3', 'tilt', 'dike', 'E', 'P2', 'fault', 'E', 'P2'],
    8: ['P4', 'fold', 'pluton', 'E', 'P2', 'fault', 'dike', 'E', 'P2', 'dike']
  };
  var ENDLESS = [
    ['P3', 'def', 'intr', 'E', 'P2', 'fault', 'dike'],
    ['P3', 'fault', 'def', 'E', 'P3', 'intr'],
    ['P3', 'def', 'E', 'P2', 'fault', 'E', 'P2', 'dike'],
    ['P4', 'intr', 'fault', 'E', 'P2', 'def', 'E', 'P2'],
    ['P3', 'tilt', 'fault', 'dike', 'E', 'P2', 'fold', 'E', 'P2', 'fault'],
    ['P3', 'fold', 'pluton', 'E', 'P2', 'dike', 'fault', 'E', 'P2']
  ];

  function wavy(r, level, amp) {
    return {
      level: level,
      a1: r.range(0.4, 1) * amp, l1: r.range(25, 60), p1: r.range(0, 6.283),
      a2: r.range(0.1, 0.4) * amp, l2: r.range(6, 14), p2: r.range(0, 6.283)
    };
  }

  function build(r, template) {
    var ev = [];
    var nE = template.filter(function (s) { return s === 'E'; }).length;
    // target erosion levels (present-day frame, roughly)
    var eLevels = nE === 0 ? [] : nE === 1 ? [r.range(85, 118)] : [r.range(62, 80), r.range(118, 138)];
    var surfLevel = r.range(178, 188);
    var used = {};
    var lastRock = null;
    function pickRock() {
      var free = SED.filter(function (x) { return !used[x] && x !== lastRock; });
      var pool = free.length ? free : SED.filter(function (x) { return x !== lastRock; });
      // coal is a thin seam: rarer
      var rock = r.pick(pool);
      if (rock === 'coal' && r.chance(0.5)) rock = r.pick(pool);
      used[rock] = true; lastRock = rock;
      return rock;
    }
    var base = r.range(8, 42);
    ev.push({ kind: 'basement', level: base, rock: 'gneiss' });
    var bottom = base, eIdx = 0, tilts = 0;
    var deformed = false;
    for (var i = 0; i < template.length; i++) {
      var tok = template[i];
      if (tok.charAt(0) === 'P') {
        var n = +tok.slice(1);
        var top = eIdx < eLevels.length ? eLevels[eIdx] : surfLevel;
        // spread the layers so the whole package spans past the next erosion (deformation shifts things)
        var span = Math.max(40, top - bottom) + (deformed ? 0 : 10) + r.range(0, 25);
        var lv = bottom;
        for (var j = 0; j < n; j++) {
          var rock = pickRock();
          var thick = span / (n - 0.6) * r.range(0.75, 1.25);
          if (rock === 'coal') thick *= 0.45;
          var from = lv;
          var level = j === n - 1 ? Infinity : lv + thick;
          ev.push({ kind: 'deposit', rock: rock, level: level, animFrom: from, animTo: j === n - 1 ? from + Math.max(thick, 60) : level });
          lv = lv + thick;
        }
        deformed = false;
      } else if (tok === 'E') {
        var lvl = eLevels[eIdx++];
        var er = wavy(r, lvl, r.range(3, 9));
        er.kind = 'erosion'; er.animTop = lvl + 140;
        ev.push(er);
        bottom = lvl + 2;
        lastRock = null;
      } else {
        var kind = tok;
        if (kind === 'def') kind = (tilts > 0 || r.chance(0.5)) ? 'fold' : 'tilt';
        if (kind === 'intr') kind = r.chance(0.55) ? 'dike' : 'pluton';
        var nextE = eIdx < eLevels.length ? eLevels[eIdx] : surfLevel;
        if (kind === 'tilt') {
          tilts++;
          ev.push({ kind: 'tilt', px: r.range(140, 220), py: r.range(50, 110), ang: r.sign() * r.range(14, 32) * Math.PI / 180 });
          deformed = true;
        } else if (kind === 'fold') {
          ev.push({ kind: 'fold', amp: r.range(14, 26), wl: r.range(32, 60), ph: r.range(0, 6.283) });
          deformed = true;
        } else if (kind === 'fault') {
          var dip = r.range(52, 74) * Math.PI / 180, sx = r.sign();
          var ux = sx * Math.cos(dip), uy = Math.sin(dip);
          var nx = -uy, ny = ux;
          if (ny < 0) { nx = -nx; ny = -ny; }
          var normal = r.chance(0.65);
          ev.push({ kind: 'fault', px: r.range(110, 250), py: r.range(50, 130), ux: ux, uy: uy, nx: nx, ny: ny,
            dip: dip, slip: (normal ? -1 : 1) * r.range(18, 38), normal: normal });
        } else if (kind === 'dike') {
          ev.push({ kind: 'dike', rock: 'basalt', x: r.range(50, 310), lean: r.range(-0.4, 0.4), w: r.range(6, 11),
            wob: r.range(0.5, 3.5), wl: r.range(5, 12), ph: r.range(0, 6.283) });
        } else if (kind === 'pluton') {
          var rad = r.range(70, 105);
          var ptop = Math.min(nextE + r.range(8, 30), 170);
          ev.push({ kind: 'pluton', rock: 'granite', cx: r.range(90, 270), cy: ptop - rad * 0.8, sq: 0.8, r: rad,
            a1: r.range(0, 6.283), a2: r.range(0, 6.283) });
        }
      }
    }
    var sf = wavy(r, surfLevel, r.range(2, 5));
    sf.kind = 'surface'; sf.animTop = surfLevel + 60;
    ev.push(sf);
    // ages (Ma) at the end of each event
    var dur = ev.map(function (e) {
      if (e.kind === 'erosion') return r.range(30, 90);
      if (e.kind === 'deposit') return r.range(6, 25);
      if (e.kind === 'surface') return r.range(5, 30);
      return r.range(4, 18);
    });
    dur[0] = 0;
    var total = dur.reduce(function (a, b) { return a + b; }, 0);
    var start = r.range(380, 560);
    var acc = 0;
    ev[0].age = Math.round(r.range(1100, 1900));
    for (var k = 1; k < ev.length; k++) { acc += dur[k]; ev[k].age = Math.max(0, Math.round(start * (1 - acc / total))); }
    ev[0].age0 = ev[0].age; // basement formation
    return ev;
  }

  // ---------- analysis: label map, visibility, constraints ----------
  var GW = 180, GH = 100;

  function analyze(ev, opts) {
    opts = opts || {};
    var gw = opts.gw || GW, gh = opts.gh || GH, cw = W / gw, ch = H / gh;
    var n = ev.length, N = gw * gh;
    var mat = new Int16Array(N), faulted = new Int32Array(N), side = new Int32Array(N), fmark = new Int16Array(N);
    var smp = newSample(), i, j, x, y, idx;
    var markW = Math.max(cw, ch) * 0.75;
    for (j = 0; j < gh; j++) {
      y = H - (j + 0.5) * ch;
      for (i = 0; i < gw; i++) {
        x = (i + 0.5) * cw;
        evaluate(ev, x, y, n - 1, 1, smp);
        idx = j * gw + i;
        mat[idx] = smp.mat; faulted[idx] = smp.faulted; side[idx] = smp.side;
        fmark[idx] = smp.fdist < markW ? smp.fidx : -1;
      }
    }
    var area = new Array(n).fill(0), markCount = new Array(n).fill(0), offsetEv = new Array(n).fill(0);
    var eContact = new Array(n).fill(0), eBelow = []; for (i = 0; i < n; i++) eBelow.push({});
    var cons = {}, consList = [];
    var lastErosionBefore = new Array(n).fill(-1), le = -1;
    for (i = 0; i < n; i++) { lastErosionBefore[i] = le; if (ev[i].kind === 'erosion') le = i; }
    var touches = []; for (i = 0; i < n; i++) touches.push({});
    var markPts = []; for (i = 0; i < n; i++) markPts.push([]);
    var contactPts = []; for (i = 0; i < n; i++) contactPts.push([]);

    function add(a, b, why, gi) {
      var key = a + '>' + b;
      var c = cons[key];
      if (!c) {
        c = cons[key] = { a: a, b: b, why: why, n: 0, x: 0, y: 0 };
        consList.push(c);
      }
      c.n++;
      if (c.n === 1 || (c.n & 7) === 0) { c.x = ((gi % gw) + 0.5) * cw; c.y = H - (Math.floor(gi / gw) + 0.5) * ch; }
    }
    function pair(p, q) {
      var a = mat[p], b = mat[q];
      if (a < 0 || b < 0 || a === b) return;
      var acr = faulted[p] & faulted[q] & (side[p] ^ side[q]);
      if (acr) {
        // contact across a fault plane: not a depositional/intrusive contact; evidence of offset
        for (var f = 0; f < n; f++) if (acr & (1 << f)) offsetEv[f]++;
        return;
      }
      if (a > b) { var tmp = a; a = b; b = tmp; var tq = p; p = q; q = tq; }
      touches[a][b] = true; touches[b][a] = true;
      var eb = ev[b];
      if (eb.kind === 'deposit') {
        var E = lastErosionBefore[b];
        if (E >= 0 && a < E) {
          add(a, E, 'eroded', p); add(E, b, 'onlap', q);
          eContact[E]++; eBelow[E][a] = true;
          contactPts[E].push(p);
        } else add(a, b, 'super', q);
      } else if (isIntrusion(eb)) {
        add(a, b, 'intrudes', q);
      }
    }
    function markPair(p, q) {
      // p carries a fault mark; q is a neighbour
      var f = fmark[p];
      if (f < 0 || mat[q] < 0 || mat[p] < 0) return;
      if (faulted[q] & (1 << f)) return;
      var y = mat[q];
      if (y < f) return;
      var E = lastErosionBefore[y];
      if (ev[y].kind === 'deposit' && E >= 0 && f < E) add(f, E, 'fault-eroded', p);
      else if (isIntrusion(ev[y])) add(f, y, 'cuts-fault', q);
    }
    for (j = 0; j < gh; j++) {
      for (i = 0; i < gw; i++) {
        idx = j * gw + i;
        var m = mat[idx];
        if (m >= 0) area[m]++;
        if (fmark[idx] >= 0 && m >= 0) {
          markCount[fmark[idx]]++;
          markPts[fmark[idx]].push(idx);
          add(m, fmark[idx], 'faulted', idx);
        }
        if (i + 1 < gw) { pair(idx, idx + 1); markPair(idx, idx + 1); markPair(idx + 1, idx); }
        if (j + 1 < gh) { pair(idx, idx + gw); markPair(idx, idx + gw); markPair(idx + gw, idx); }
      }
    }
    var minArea = N * 0.012;
    var visible = new Array(n).fill(false);
    for (i = 0; i < n; i++) {
      var e = ev[i];
      if (isMaterial(e)) visible[i] = area[i] >= (e.kind === 'dike' ? N * 0.006 : minArea);
    }
    // deformation evidence: visible layers formed before it are deformed; visible layers after are less deformed
    for (var D = 0; D < n; D++) {
      if (!isDeform(ev[D])) continue;
      var firstE = -1;
      for (i = D + 1; i < n; i++) if (ev[i].kind === 'erosion') { firstE = i; break; }
      for (i = 0; i < n; i++) {
        if (ev[i].kind !== 'deposit' || !visible[i]) continue;
        var pt = labelPointGrid(mat, i, gw, gh);
        var gi = pt ? pt.gi : 0;
        if (i < D) {
          add(i, D, 'deformed', gi);
          if (firstE >= 0 && eBelow[firstE][i]) add(D, firstE, 'angular', contactPts[firstE].length ? contactPts[firstE][contactPts[firstE].length >> 1] : gi);
        } else add(D, i, 'undeformed', gi);
      }
    }

    // ---- validation ----
    var problems = [];
    for (i = 1; i < n; i++) {
      var ei = ev[i];
      if (ei.kind === 'deposit' && !visible[i]) problems.push('layer ' + i + ' hidden');
      if (isIntrusion(ei)) {
        if (!visible[i]) problems.push('intrusion ' + i + ' hidden');
        else {
          var older = Object.keys(touches[i]).filter(function (k) { return +k < i; }).length;
          if (older < 2) problems.push('intrusion ' + i + ' cuts too little');
        }
      }
      if (ei.kind === 'fault') {
        if (markCount[i] < 25) problems.push('fault ' + i + ' trace too short');
        if (offsetEv[i] < 6) problems.push('fault ' + i + ' offsets nothing');
      }
      if (ei.kind === 'erosion') {
        if (eContact[i] < 25) problems.push('erosion ' + i + ' contact too short');
        if (Object.keys(eBelow[i]).length < 2) problems.push('erosion ' + i + ' truncates too little');
      }
      if (isDeform(ei)) {
        var pre = 0;
        for (j = 0; j < i; j++) if (ev[j].kind === 'deposit' && visible[j]) pre++;
        if (pre < 1) problems.push('deformation ' + i + ' shows nothing');
      }
    }
    // no air below the present surface inside the window (a cave would be a bug)
    for (i = 0; i < gw; i += 3) {
      x = (i + 0.5) * cw;
      var sy = surfaceY(ev[n - 1], x, 1);
      for (j = 0; j < gh; j++) {
        y = H - (j + 0.5) * ch;
        if (y < sy - 2 && mat[j * gw + i] < 0) { problems.push('air pocket'); i = gw; break; }
      }
    }
    // cards: every visible event (basement only if visible), excluding the present surface
    var cards = [];
    for (i = 0; i < n; i++) {
      var ek = ev[i];
      if (ek.kind === 'surface') continue;
      if (isMaterial(ek) && !visible[i]) continue;
      cards.push(i);
    }
    // keep only constraints between cards
    var isCard = {}; cards.forEach(function (c) { isCard[c] = true; });
    consList = consList.filter(function (c) { return isCard[c.a] && isCard[c.b]; });
    // labels
    var labels = {};
    cards.forEach(function (c) {
      var e = ev[c], p = null;
      if (isMaterial(e)) p = labelPointGrid(mat, c, gw, gh);
      else if (e.kind === 'fault') p = midPoint(markPts[c], gw);
      else if (e.kind === 'erosion') p = midPoint(contactPts[c], gw);
      if (p) labels[c] = { x: (p.i + 0.5) * cw, y: H - (p.j + 0.5) * ch };
    });
    return {
      valid: problems.length === 0, problems: problems, cards: cards, constraints: consList, labels: labels,
      area: area, visible: visible, grid: { gw: gw, gh: gh, mat: mat, fmark: fmark }
    };
  }

  function midPoint(list, gw) {
    if (!list.length) return null;
    var s = list.slice().sort(function (a, b) { return (a % gw) - (b % gw); });
    var gi = s[s.length >> 1];
    return { i: gi % gw, j: Math.floor(gi / gw), gi: gi };
  }

  // deepest interior point of a material on the grid (chamfer distance transform)
  function labelPointGrid(mat, m, gw, gh) {
    var N = gw * gh, d = new Float32Array(N), i, j, idx, BIG = 1e6;
    for (idx = 0; idx < N; idx++) d[idx] = mat[idx] === m ? BIG : 0;
    for (j = 0; j < gh; j++) for (i = 0; i < gw; i++) {
      idx = j * gw + i; if (!d[idx]) continue;
      var v = d[idx];
      v = Math.min(v, i > 0 ? d[idx - 1] + 1 : 1, j > 0 ? d[idx - gw] + 1 : 1,
        i > 0 && j > 0 ? d[idx - gw - 1] + 1.414 : 1, i < gw - 1 && j > 0 ? d[idx - gw + 1] + 1.414 : 1);
      d[idx] = v;
    }
    var best = -1, bi = -1;
    for (j = gh - 1; j >= 0; j--) for (i = gw - 1; i >= 0; i--) {
      idx = j * gw + i; if (!d[idx]) continue;
      var w = d[idx];
      w = Math.min(w, i < gw - 1 ? d[idx + 1] + 1 : 1, j < gh - 1 ? d[idx + gw] + 1 : 1,
        i < gw - 1 && j < gh - 1 ? d[idx + gw + 1] + 1.414 : 1, i > 0 && j < gh - 1 ? d[idx + gw - 1] + 1.414 : 1);
      d[idx] = w;
      // prefer central points slightly (avoid hugging the edge of the window)
      var score = w - Math.abs(i - gw / 2) * 0.004;
      if (score > best) { best = score; bi = idx; }
    }
    if (bi < 0) return null;
    return { i: bi % gw, j: Math.floor(bi / gw), gi: bi, depth: best };
  }

  var LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  function assignLetters(ev, cards, r) {
    var L = LETTERS.slice(0, cards.length).split('');
    for (var i = L.length - 1; i > 0; i--) { var j = Math.floor(r.next() * (i + 1)); var t = L[i]; L[i] = L[j]; L[j] = t; }
    cards.forEach(function (c, i) { ev[c].letter = L[i]; });
  }

  function templateFor(level, r) {
    if (TEMPLATES[level]) return TEMPLATES[level];
    return r.pick(ENDLESS);
  }

  /* generate(seed, level) -> puzzle. level 1..8 = campaign templates, anything else = endless. */
  function generate(seed, level) {
    var r = makeRng('roadcut:' + seed + ':' + level);
    var tpl = templateFor(level, r);
    for (var attempt = 0; attempt < 600; attempt++) {
      var ev = build(r, tpl);
      var an = analyze(ev);
      if (!an.valid) continue;
      assignLetters(ev, an.cards, r);
      return { seed: seed, level: level, template: tpl, events: ev, analysis: an, attempts: attempt + 1 };
    }
    return null;
  }

  // ---------- checking ----------
  var WHY_RANK = { super: 0, intrudes: 1, faulted: 2, 'cuts-fault': 3, eroded: 4, onlap: 5, 'fault-eroded': 6, deformed: 7, angular: 8, undeformed: 9 };

  /* order: array of event indices, oldest first. Returns {ok, violated, missing} */
  function check(puzzle, order) {
    var cards = puzzle.analysis.cards;
    if (order.length !== cards.length) return { ok: false, missing: cards.length - order.length, violated: null };
    var pos = {};
    order.forEach(function (c, i) { pos[c] = i; });
    for (var i = 0; i < cards.length; i++) if (pos[cards[i]] === undefined) return { ok: false, missing: 1, violated: null };
    var bad = puzzle.analysis.constraints.filter(function (c) { return pos[c.a] > pos[c.b]; });
    if (!bad.length) return { ok: true, violated: null, nViolated: 0 };
    // report the most basic violated relationship, the earliest in the player's sequence
    bad.sort(function (p, q) {
      return (WHY_RANK[p.why] - WHY_RANK[q.why]) || (Math.min(pos[p.a], pos[p.b]) - Math.min(pos[q.a], pos[q.b]));
    });
    return { ok: false, violated: bad[0], nViolated: bad.length };
  }

  function nameOf(e) {
    if (e.kind === 'deposit' || e.kind === 'basement') return ROCKS[e.rock].name + ' ' + e.letter;
    if (e.kind === 'dike') return 'dike ' + e.letter;
    if (e.kind === 'pluton') return 'granite ' + e.letter;
    if (e.kind === 'fault') return 'fault ' + e.letter;
    if (e.kind === 'erosion') return 'erosion surface ' + e.letter;
    if (e.kind === 'tilt') return 'tilting ' + e.letter;
    if (e.kind === 'fold') return 'folding ' + e.letter;
    return e.kind;
  }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  /* Plain-language explanation of a constraint (a is older than b). */
  function explain(puzzle, c) {
    var ev = puzzle.events, A = nameOf(ev[c.a]), B = nameOf(ev[c.b]);
    switch (c.why) {
      case 'super': return cap(B) + ' lies on top of ' + A + ', so ' + A + ' is older (superposition).';
      case 'intrudes': return cap(B) + ' cuts across ' + A + ', so ' + A + ' was already there (cross-cutting).';
      case 'faulted': return cap(B) + ' breaks and offsets ' + A + ', so ' + A + ' is older than the fault (cross-cutting).';
      case 'cuts-fault': return cap(B) + ' cuts straight across ' + A + ' without being offset, so the fault came first.';
      case 'eroded': return cap(B) + ' slices across the top of ' + A + ', so ' + A + ' was there before the erosion.';
      case 'onlap': return cap(B) + ' was laid down on ' + A + ', so the erosion came before it (unconformity).';
      case 'fault-eroded': return cap(A) + ' stops dead at ' + B + ': the fault happened, then erosion planed it off.';
      case 'deformed': return cap(A) + ' is bent by ' + B + ', so it was there before ' + B + ' (original horizontality).';
      case 'undeformed': return cap(B) + ' is less deformed than the rocks below, so ' + A + ' happened before it was laid down.';
      case 'angular': return cap(B) + ' cuts across layers bent by ' + A + ', so ' + A + ' came before the erosion (angular unconformity).';
    }
    return cap(A) + ' is older than ' + B + '.';
  }

  function trueOrder(puzzle) { return puzzle.analysis.cards.slice().sort(function (a, b) { return a - b; }); }

  function describe(puzzle, i) {
    var e = puzzle.events[i];
    var r = ROCKS[e.rock];
    switch (e.kind) {
      case 'basement': return 'Crystalline basement: ' + r.blurb + '.';
      case 'deposit': return r.name + ': ' + r.blurb + '.';
      case 'dike': return 'Basalt dike: ' + r.blurb + '.';
      case 'pluton': return 'Granite pluton: ' + r.blurb + '.';
      case 'fault': return (e.normal ? 'Normal fault: the crust stretched and the upper block slid down.' : 'Reverse fault: the crust was squeezed and the upper block was shoved up.');
      case 'erosion': return 'Erosion surface: the land rose above the sea and was worn down for millions of years.';
      case 'tilt': return 'Tilting: the whole block of crust was tipped by tectonic forces.';
      case 'fold': return 'Folding: compression buckled the layers into waves.';
    }
    return '';
  }

  return {
    W: W, H: H, ROCKS: ROCKS, KIND_NAME: KIND_NAME, TEMPLATES: TEMPLATES,
    makeRng: makeRng, hashSeed: hashSeed, evaluate: evaluate, newSample: newSample,
    surfaceY: surfaceY, generate: generate, build: build, analyze: analyze, check: check, explain: explain,
    trueOrder: trueOrder, nameOf: nameOf, describe: describe, isMaterial: isMaterial, isIntrusion: isIntrusion,
    isDeform: isDeform
  };
});
