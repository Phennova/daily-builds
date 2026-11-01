// Greenlist - watermark core (pure logic, no DOM). Works in browser (window.WM) and node (module.exports).
// Implements a word-level version of the Kirchenbauer et al. (2023) "green list" LLM watermark:
//   colour(token_i) = H(key, previous k tokens, token_i) < gamma        (green / red)
//   generation: logit(option) += delta * (#green tokens in option)       (soft watermark)
//   detection:  z = (G - gamma*N) / sqrt(gamma*(1-gamma)*N)             (one-proportion z-test)
(function (root) {
  'use strict';

  const AWK_LOGIT = 0.9;   // each awkwardness point costs this much base logit (nats)
  const BASE_NLL = 2.2;    // log-perplexity of the most fluent wording (about 9), flavour only

  // ---------- hashing ----------
  function fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    // murmur3 finaliser for better avalanche
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
  }
  function unitHash(key, ctx, tok) {
    return fnv1a(key + '\u0001' + ctx.join('\u0002') + '\u0001' + tok) / 4294967296;
  }
  function isGreen(key, ctx, tok, gamma) { return unitHash(key, ctx, tok) < gamma; }

  // ---------- tokens ----------
  function words(text) {
    const m = text.toLowerCase().match(/[a-z0-9']+/g);
    return m ? m.map(w => w.replace(/^'+|'+$/g, '')).filter(Boolean) : [];
  }
  function contextFor(toks, i, k) {
    const ctx = [];
    for (let j = i - k; j < i; j++) ctx.push(j < 0 ? '^' : toks[j]);
    return ctx;
  }
  function colours(toks, key, k, gamma) {
    return toks.map((t, i) => isGreen(key, contextFor(toks, i, k), t, gamma));
  }
  function zScore(G, N, gamma) {
    if (N <= 0) return 0;
    return (G - gamma * N) / Math.sqrt(gamma * (1 - gamma) * N);
  }
  function detect(text, key, k, gamma) {
    const toks = words(text);
    const col = colours(toks, key, k, gamma);
    const G = col.filter(Boolean).length;
    return { toks, col, G, N: toks.length, z: zScore(G, toks.length, gamma) };
  }

  // ---------- templates ----------
  // "The {convoy|shipment|column~} leaves at {dawn|first light}."
  // Option order = model preference: awkwardness = rank, plus 1 per trailing '~'. "word=3" sets awkwardness explicitly.
  function parseTemplate(src) {
    const parts = [];
    const re = /\{([^}]*)\}/g;
    let last = 0, m;
    while ((m = re.exec(src))) {
      if (m.index > last) parts.push({ type: 'text', text: src.slice(last, m.index) });
      const opts = m[1].split('|').map((raw, rank) => {
        let s = raw.trim(), awk = rank;
        const eq = s.match(/=(\d+)$/);
        if (eq) { awk = +eq[1]; s = s.slice(0, eq.index); }
        while (s.endsWith('~')) { awk++; s = s.slice(0, -1); }
        return { text: s, awk, toks: words(s) };
      });
      if (opts.some(o => o.toks.length === 0)) throw new Error('empty option in ' + m[0]);
      parts.push({ type: 'slot', opts, slot: parts.filter(p => p.type === 'slot').length });
      last = re.lastIndex;
    }
    if (last < src.length) parts.push({ type: 'text', text: src.slice(last) });
    return parts;
  }
  function slotsOf(parts) { return parts.filter(p => p.type === 'slot'); }

  // Flatten to tokens with ownership: owner = slot index or -1 for fixed words.
  function flatten(parts, choice) {
    const toks = [], owner = [];
    for (const p of parts) {
      const ws = p.type === 'text' ? words(p.text) : p.opts[choice[p.slot]].toks;
      for (const w of ws) { toks.push(w); owner.push(p.type === 'slot' ? p.slot : -1); }
    }
    return { toks, owner };
  }

  function evaluate(parts, choice, cfg) {
    const { toks, owner } = flatten(parts, choice);
    const col = colours(toks, cfg.key, cfg.k, cfg.gamma);
    const G = col.filter(Boolean).length, N = toks.length;
    let awk = 0;
    for (const s of slotsOf(parts)) awk += s.opts[choice[s.slot]].awk;
    return { toks, owner, col, G, N, z: zScore(G, N, cfg.gamma), awk, ppl: perplexity(parts, choice) };
  }

  // Perplexity proxy under the base (unwatermarked) model: every awkwardness point is AWK_LOGIT extra nats of
  // surprise, averaged over the length of the most fluent version (so it is monotone in total awkwardness and the
  // game's fluency cap is exact). Used both for display and for the rule check.
  function baseLength(parts) {
    let n = 0;
    for (const p of parts) n += p.type === 'text' ? words(p.text).length : p.opts[0].toks.length;
    return n;
  }
  function pplFromAwk(parts, awk) { return Math.exp(BASE_NLL + AWK_LOGIT * awk / baseLength(parts)); }
  function perplexity(parts, choice) {
    let awk = 0;
    for (const s of slotsOf(parts)) awk += s.opts[choice[s.slot]].awk;
    return pplFromAwk(parts, awk);
  }

  // ---------- generation ----------
  function rng(seed) { // mulberry32
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Sample each slot left to right with watermark bias. Returns choice plus per-slot trace for the animation.
  function generate(parts, cfg, seed, delta) {
    const R = rng(seed);
    const choice = slotsOf(parts).map(() => 0);
    const trace = [];
    const toks = [];
    for (const p of parts) {
      if (p.type === 'text') { toks.push(...words(p.text)); continue; }
      const cands = p.opts.map((o, i) => {
        const tmp = toks.slice();
        let g = 0;
        const greens = [];
        for (const w of o.toks) {
          const gr = isGreen(cfg.key, contextFor(tmp.concat([w]), tmp.length, cfg.k), w, cfg.gamma);
          greens.push(gr); if (gr) g++;
          tmp.push(w);
        }
        const base = -AWK_LOGIT * o.awk;
        return { i, base, green: g, greens, logit: base + delta * g };
      });
      const mx = Math.max(...cands.map(c => c.logit));
      const w = cands.map(c => Math.exp(c.logit - mx));
      const sum = w.reduce((a, b) => a + b, 0);
      let r = R() * sum, pick = cands.length - 1;
      for (let i = 0; i < w.length; i++) { r -= w[i]; if (r <= 0) { pick = i; break; } }
      cands.forEach((c, i) => { c.p = w[i] / sum; });
      choice[p.slot] = pick;
      trace.push({ slot: p.slot, cands, pick });
      toks.push(...p.opts[pick].toks);
    }
    return { choice, trace };
  }

  // Find a seed whose draft lands in the z band [lo, hi]. Deterministic for a given night.
  function generateInBand(parts, cfg, delta, lo, hi, seed0) {
    for (let s = seed0; s < seed0 + 5000; s++) {
      const g = generate(parts, cfg, s, delta);
      const ev = evaluate(parts, g.choice, cfg);
      if (ev.z >= lo && ev.z <= hi) return Object.assign(g, { seed: s, ev });
    }
    throw new Error('no seed in band');
  }

  // ---------- exact solver (tests + par) ----------
  // Optimises G (min, or max if maximise) subject to #changed slots <= maxChanged and total awk <= maxAwk.
  // DP over slots; state = last k slot choices (each option has >= 1 word so context never reaches further back).
  function solve(parts, base, cfg, maxChanged, maxAwk, maximise) {
    const slots = slotsOf(parts);
    const k = cfg.k;
    // units: unit[-1] = fixed prefix; unit[j] = slot j words + fixed words up to next slot
    const units = [[]];
    let cur = units[0];
    for (const p of parts) {
      if (p.type === 'slot') { cur = { slot: p.slot, fixedAfter: [] }; units.push(cur); }
      else if (cur === units[0]) units[0].push(...words(p.text));
      else cur.fixedAfter.push(...words(p.text));
    }
    const prefix = units[0];
    const su = units.slice(1);
    // colour count of unit j given choices of slots j-k..j (array 'hist' oldest..newest, length up to k+1)
    function unitGreens(j, hist) {
      // build preceding context tokens: prefix + words of hist slots before j (+ their fixedAfter)
      const ctxToks = prefix.slice();
      const startSlot = j - (hist.length - 1);
      for (let t = 0; t < hist.length - 1; t++) {
        const sj = startSlot + t;
        ctxToks.push(...slots[sj].opts[hist[t]].toks, ...su[sj].fixedAfter);
      }
      const own = slots[j].opts[hist[hist.length - 1]].toks.concat(su[j].fixedAfter);
      // if startSlot > 0 the context may be truncated, but it always holds >= k tokens, which is enough
      const all = ctxToks.concat(own);
      let g = 0;
      for (let i = ctxToks.length; i < all.length; i++)
        if (isGreen(cfg.key, contextFor(all, i, k), all[i], cfg.gamma)) g++;
      return g;
    }
    let prefixG = 0;
    for (let i = 0; i < prefix.length; i++) if (isGreen(cfg.key, contextFor(prefix, i, k), prefix[i], cfg.gamma)) prefixG++;

    const better = maximise ? (a, b) => a > b : (a, b) => a < b;
    // map key: hist(last k choices).join + '|' + changed + '|' + awk  -> {g, back}
    let layer = new Map();
    layer.set('||0|0', { g: prefixG, hist: [], ch: 0, awk: 0, path: [] });
    for (let j = 0; j < slots.length; j++) {
      const next = new Map();
      for (const st of layer.values()) {
        slots[j].opts.forEach((o, oi) => {
          const ch = st.ch + (oi !== base[j] ? 1 : 0);
          const awk = st.awk + o.awk;
          if (ch > maxChanged || awk > maxAwk) return;
          const histFull = st.hist.concat([oi]);
          const g = st.g + unitGreens(j, histFull);
          const hist = histFull.slice(Math.max(0, histFull.length - k));
          const key = hist.join(',') + '|' + ch + '|' + awk;
          const ex = next.get(key);
          if (!ex || better(g, ex.g)) next.set(key, { g, hist, ch, awk, path: st.path.concat([oi]) });
        });
      }
      layer = next;
    }
    let best = null;
    for (const st of layer.values()) if (!best || better(st.g, best.g) || (st.g === best.g && st.ch < best.ch)) best = st;
    if (!best) return null;
    const ev = evaluate(parts, best.path, cfg);
    return { choice: best.path, ev };
  }

  const WM = { fnv1a, unitHash, isGreen, words, contextFor, colours, zScore, detect, parseTemplate, slotsOf,
    flatten, evaluate, perplexity, pplFromAwk, baseLength, rng, generate, generateInBand, solve, AWK_LOGIT };
  if (typeof module !== 'undefined' && module.exports) module.exports = WM;
  else root.WM = WM;
})(typeof window !== 'undefined' ? window : globalThis);
