// font.js - builds a tiny monospace pixel TrueType font in memory and registers it with the FontFace API.
// Why: puzzle terrain comes from real text layout, so every device must break lines identically.
// Glyphs are 5x7 bitmaps (+2 descender rows) on a 6 px advance; 1 px = 100 font units, 1 em = 10 px.
(function (global) {
  'use strict';
  const G = {
    ' ': '', 'A': '.###. #...# #...# ##### #...# #...# #...#', 'B': '####. #...# #...# ####. #...# #...# ####.',
    'C': '.###. #...# #.... #.... #.... #...# .###.', 'D': '####. #...# #...# #...# #...# #...# ####.',
    'E': '##### #.... #.... ####. #.... #.... #####', 'F': '##### #.... #.... ####. #.... #.... #....',
    'G': '.###. #...# #.... #.### #...# #...# .####', 'H': '#...# #...# #...# ##### #...# #...# #...#',
    'I': '.###. ..#.. ..#.. ..#.. ..#.. ..#.. .###.', 'J': '..### ...#. ...#. ...#. ...#. #..#. .##..',
    'K': '#...# #..#. #.#.. ##... #.#.. #..#. #...#', 'L': '#.... #.... #.... #.... #.... #.... #####',
    'M': '#...# ##.## #.#.# #.#.# #...# #...# #...#', 'N': '#...# #...# ##..# #.#.# #..## #...# #...#',
    'O': '.###. #...# #...# #...# #...# #...# .###.', 'P': '####. #...# #...# ####. #.... #.... #....',
    'Q': '.###. #...# #...# #...# #.#.# #..#. .##.#', 'R': '####. #...# #...# ####. #.#.. #..#. #...#',
    'S': '.#### #.... #.... .###. ....# ....# ####.', 'T': '##### ..#.. ..#.. ..#.. ..#.. ..#.. ..#..',
    'U': '#...# #...# #...# #...# #...# #...# .###.', 'V': '#...# #...# #...# #...# #...# .#.#. ..#..',
    'W': '#...# #...# #...# #.#.# #.#.# #.#.# .#.#.', 'X': '#...# #...# .#.#. ..#.. .#.#. #...# #...#',
    'Y': '#...# #...# .#.#. ..#.. ..#.. ..#.. ..#..', 'Z': '##### ....# ...#. ..#.. .#... #.... #####',
    'a': '..... ..... .###. ....# .#### #...# .####', 'b': '#.... #.... #.##. ##..# #...# #...# ####.',
    'c': '..... ..... .###. #.... #.... #...# .###.', 'd': '....# ....# .##.# #..## #...# #...# .####',
    'e': '..... ..... .###. #...# ##### #.... .###.', 'f': '..##. .#..# .#... ###.. .#... .#... .#...',
    'g': '..... ..... .#### #...# #...# #...# .#### ....# .###.', 'h': '#.... #.... #.##. ##..# #...# #...# #...#',
    'i': '..#.. ..... .##.. ..#.. ..#.. ..#.. .###.', 'j': '...#. ..... ..##. ...#. ...#. ...#. ...#. #..#. .##..',
    'k': '#.... #.... #..#. #.#.. ##... #.#.. #..#.', 'l': '.##.. ..#.. ..#.. ..#.. ..#.. ..#.. .###.',
    'm': '..... ..... ##.#. #.#.# #.#.# #.#.# #.#.#', 'n': '..... ..... #.##. ##..# #...# #...# #...#',
    'o': '..... ..... .###. #...# #...# #...# .###.', 'p': '..... ..... ####. #...# #...# #...# ####. #.... #....',
    'q': '..... ..... .#### #...# #...# #...# .#### ....# ....#', 'r': '..... ..... #.##. ##..# #.... #.... #....',
    's': '..... ..... .###. #.... .###. ....# ####.', 't': '.#... .#... ###.. .#... .#... .#..# ..##.',
    'u': '..... ..... #...# #...# #...# #..## .##.#', 'v': '..... ..... #...# #...# #...# .#.#. ..#..',
    'w': '..... ..... #...# #...# #.#.# #.#.# .#.#.', 'x': '..... ..... #...# .#.#. ..#.. .#.#. #...#',
    'y': '..... ..... #...# #...# #...# #...# .#### ....# .###.', 'z': '..... ..... ##### ...#. ..#.. .#... #####',
    '0': '.###. #...# #..## #.#.# ##..# #...# .###.', '1': '..#.. .##.. ..#.. ..#.. ..#.. ..#.. .###.',
    '2': '.###. #...# ....# ...#. ..#.. .#... #####', '3': '##### ...#. ..#.. ...#. ....# #...# .###.',
    '4': '...#. ..##. .#.#. #..#. ##### ...#. ...#.', '5': '##### #.... ####. ....# ....# #...# .###.',
    '6': '..##. .#... #.... ####. #...# #...# .###.', '7': '##### ....# ...#. ..#.. .#... .#... .#...',
    '8': '.###. #...# #...# .###. #...# #...# .###.', '9': '.###. #...# #...# .#### ....# ...#. .##..',
    '!': '..#.. ..#.. ..#.. ..#.. ..#.. ..... ..#..', '"': '.#.#. .#.#.', '#': '.#.#. .#.#. ##### .#.#. ##### .#.#. .#.#.',
    '$': '..#.. .#### #.#.. .###. ..#.# ####. ..#..', '%': '##... ##..# ...#. ..#.. .#... #..## ...##',
    '&': '.##.. #..#. #.#.. .#... #.#.# #..#. .##.#', "'": '..#.. ..#..',
    '(': '...#. ..#.. .#... .#... .#... ..#.. ...#.', ')': '.#... ..#.. ...#. ...#. ...#. ..#.. .#...',
    '*': '..... ..#.. #.#.# .###. #.#.# ..#..', '+': '..... ..#.. ..#.. ##### ..#.. ..#..',
    ',': '..... ..... ..... ..... ..... .##.. ..#.. .#...', '-': '..... ..... ..... #####',
    '.': '..... ..... ..... ..... ..... .##.. .##..', '/': '..... ....# ...#. ..#.. .#... #....',
    ':': '..... .##.. .##.. ..... .##.. .##..', ';': '..... .##.. .##.. ..... .##.. ..#.. .#...',
    '<': '...#. ..#.. .#... #.... .#... ..#.. ...#.', '=': '..... ..... ##### ..... #####',
    '>': '.#... ..#.. ...#. ....# ...#. ..#.. .#...', '?': '.###. #...# ....# ...#. ..#.. ..... ..#..',
    '@': '.###. #...# ....# .##.# #.#.# #.#.# .###.', '[': '.###. .#... .#... .#... .#... .#... .###.',
    '\\': '..... #.... .#... ..#.. ...#. ....#', ']': '.###. ...#. ...#. ...#. ...#. ...#. .###.',
    '^': '..#.. .#.#. #...#', '_': '..... ..... ..... ..... ..... ..... #####', '`': '.#... ..#..',
    '{': '...#. ..#.. ..#.. .#... ..#.. ..#.. ...#.', '|': '..#.. ..#.. ..#.. ..#.. ..#.. ..#.. ..#..',
    '}': '.#... ..#.. ..#.. ...#. ..#.. ..#.. .#...', '~': '..... ..... .#... #.#.# ...#.'
  };
  const PX = 100, ADV = 600, ASC = 800, DESC = 200, UPEM = 1000;

  // Greedy rectangle cover of a bitmap: horizontal runs merged downward when identical.
  function rects(rows) {
    const used = rows.map(r => r.split('').map(() => false));
    const out = [];
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < 5; c++) {
        if (rows[r][c] !== '#' || used[r][c]) continue;
        let w = 0; while (c + w < 5 && rows[r][c + w] === '#' && !used[r][c + w]) w++;
        let h = 1;
        outer: while (r + h < rows.length) {
          for (let k = 0; k < w; k++) if (rows[r + h][c + k] !== '#' || used[r + h][c + k]) break outer;
          h++;
        }
        for (let y = 0; y < h; y++) for (let k = 0; k < w; k++) used[r + y][c + k] = true;
        out.push({ c, r, w, h });
      }
    }
    return out;
  }

  function glyphData(ch) {
    const src = G[ch];
    if (!src) return null;
    const rows = src.split(' ');
    const rs = rects(rows);
    if (!rs.length) return null;
    // contours: rectangle, clockwise in y-up space: BL -> TL -> TR -> BR
    const pts = [];
    let xMin = 1e9, yMin = 1e9, xMax = -1e9, yMax = -1e9;
    for (const q of rs) {
      const x0 = q.c * PX, x1 = (q.c + q.w) * PX;
      const y1 = (7 - q.r) * PX, y0 = (7 - q.r - q.h) * PX;
      pts.push([[x0, y0], [x0, y1], [x1, y1], [x1, y0]]);
      xMin = Math.min(xMin, x0); xMax = Math.max(xMax, x1); yMin = Math.min(yMin, y0); yMax = Math.max(yMax, y1);
    }
    const n = pts.length, np = n * 4;
    const buf = new DataView(new ArrayBuffer(10 + 2 * n + 2 + np + np * 4));
    let o = 0;
    buf.setInt16(o, n); buf.setInt16(o + 2, xMin); buf.setInt16(o + 4, yMin); buf.setInt16(o + 6, xMax); buf.setInt16(o + 8, yMax); o = 10;
    for (let i = 0; i < n; i++) { buf.setUint16(o, i * 4 + 3); o += 2; }
    buf.setUint16(o, 0); o += 2; // no instructions
    for (let i = 0; i < np; i++) buf.setUint8(o++, 1); // on-curve, 16-bit deltas
    let px = 0, py = 0;
    const flat = pts.flat();
    for (const p of flat) { buf.setInt16(o, p[0] - px); px = p[0]; o += 2; }
    for (const p of flat) { buf.setInt16(o, p[1] - py); py = p[1]; o += 2; }
    return { bytes: new Uint8Array(buf.buffer), xMin, yMin, xMax, yMax, n, np };
  }

  function build() {
    const chars = []; for (let c = 32; c <= 126; c++) chars.push(String.fromCharCode(c));
    const glyphs = [null].concat(chars.map(glyphData)); // glyph 0 = .notdef (empty)
    const numGlyphs = glyphs.length;
    let maxP = 0, maxC = 0, bx0 = 0, by0 = 0, bx1 = 0, by1 = 0;
    for (const g of glyphs) if (g) { maxP = Math.max(maxP, g.np); maxC = Math.max(maxC, g.n); bx0 = Math.min(bx0, g.xMin); by0 = Math.min(by0, g.yMin); bx1 = Math.max(bx1, g.xMax); by1 = Math.max(by1, g.yMax); }

    const T = {};
    const dv = (len, fill) => { const d = new DataView(new ArrayBuffer(len)); fill(d); return new Uint8Array(d.buffer); };
    // glyf + loca
    const parts = []; const loca = []; let off = 0;
    for (const g of glyphs) {
      loca.push(off);
      if (g) { let b = g.bytes; const pad = (4 - b.length % 4) % 4; if (pad) { const nb = new Uint8Array(b.length + pad); nb.set(b); b = nb; } parts.push(b); off += b.length; }
    }
    loca.push(off);
    const glyf = new Uint8Array(off); { let p = 0; for (const b of parts) { glyf.set(b, p); p += b.length; } }
    T.glyf = glyf;
    T.loca = dv(loca.length * 4, d => loca.forEach((v, i) => d.setUint32(i * 4, v)));
    T.head = dv(54, d => {
      d.setUint32(0, 0x00010000); d.setUint32(4, 0x00010000); d.setUint32(8, 0); d.setUint32(12, 0x5F0F3CF5);
      d.setUint16(16, 0x000B); d.setUint16(18, UPEM); // created/modified 20..35 = 0
      d.setInt16(36, bx0); d.setInt16(38, by0); d.setInt16(40, bx1); d.setInt16(42, by1);
      d.setUint16(44, 0); d.setUint16(46, 8); d.setInt16(48, 2); d.setInt16(50, 1); d.setInt16(52, 0);
    });
    T.hhea = dv(36, d => {
      d.setUint32(0, 0x00010000); d.setInt16(4, ASC); d.setInt16(6, -DESC); d.setInt16(8, 0); d.setUint16(10, ADV);
      d.setInt16(12, 0); d.setInt16(14, ADV - bx1); d.setInt16(16, bx1); d.setInt16(18, 1); d.setInt16(20, 0); d.setInt16(22, 0);
      d.setInt16(34 - 0, numGlyphs); d.setInt16(32, 0);
    });
    T.maxp = dv(32, d => {
      d.setUint32(0, 0x00010000); d.setUint16(4, numGlyphs); d.setUint16(6, maxP); d.setUint16(8, maxC);
      d.setUint16(14, 2); // maxZones
    });
    T.hmtx = dv(numGlyphs * 4, d => glyphs.forEach((g, i) => { d.setUint16(i * 4, ADV); d.setInt16(i * 4 + 2, g ? g.xMin : 0); }));
    T['OS/2'] = dv(96, d => {
      d.setUint16(0, 4); d.setInt16(2, ADV); d.setUint16(4, 400); d.setUint16(6, 5); d.setUint16(8, 0);
      d.setInt16(10, 650); d.setInt16(12, 700); d.setInt16(14, 0); d.setInt16(16, 140);
      d.setInt16(18, 650); d.setInt16(20, 700); d.setInt16(22, 0); d.setInt16(24, 480);
      d.setInt16(26, 50); d.setInt16(28, 250); d.setInt16(30, 0);
      d.setUint8(32 + 3, 9); // panose bProportion = 9 (monospaced)
      d.setUint32(42, 1); // Basic Latin
      d.setUint8(58, 82); d.setUint8(59, 70); d.setUint8(60, 76); d.setUint8(61, 87); // 'RFLW'
      d.setUint16(62, 0x00C0); d.setUint16(64, 32); d.setUint16(66, 126);
      d.setInt16(68, ASC); d.setInt16(70, -DESC); d.setInt16(72, 0); d.setUint16(74, ASC); d.setUint16(76, DESC);
      d.setUint32(78, 1); d.setUint32(82, 0); d.setInt16(86, 500); d.setInt16(88, 700); d.setUint16(90, 0); d.setUint16(92, 32); d.setUint16(94, 1);
    });
    T.post = dv(32, d => { d.setUint32(0, 0x00030000); d.setInt16(8, -100); d.setInt16(10, 50); d.setUint32(12, 1); });
    // cmap format 4: segment 32..126 -> 1..95, plus 0xFFFF terminator
    T.cmap = dv(12 + 32, d => {
      d.setUint16(0, 0); d.setUint16(2, 1); d.setUint16(4, 3); d.setUint16(6, 1); d.setUint32(8, 12);
      const s = 12; const segX2 = 4;
      d.setUint16(s, 4); d.setUint16(s + 2, 32); d.setUint16(s + 4, 0);
      d.setUint16(s + 6, segX2); d.setUint16(s + 8, 4); d.setUint16(s + 10, 1); d.setUint16(s + 12, 0);
      d.setUint16(s + 14, 126); d.setUint16(s + 16, 0xFFFF); d.setUint16(s + 18, 0); // endCodes, reservedPad
      d.setUint16(s + 20, 32); d.setUint16(s + 22, 0xFFFF); // startCodes
      d.setInt16(s + 24, 1 - 32); d.setInt16(s + 26, 1); // idDelta
      d.setUint16(s + 28, 0); d.setUint16(s + 30, 0); // idRangeOffset
    });
    // name table
    const names = [[1, 'Reflow Pixel'], [2, 'Regular'], [3, 'Reflow Pixel Regular 1.0'], [4, 'Reflow Pixel Regular'], [5, 'Version 1.0'], [6, 'ReflowPixel-Regular']];
    const strs = names.map(n => { const s = n[1]; const b = new Uint8Array(s.length * 2); for (let i = 0; i < s.length; i++) { b[i * 2] = 0; b[i * 2 + 1] = s.charCodeAt(i); } return b; });
    const strLen = strs.reduce((a, b) => a + b.length, 0);
    T.name = dv(6 + names.length * 12 + strLen, d => {
      d.setUint16(0, 0); d.setUint16(2, names.length); d.setUint16(4, 6 + names.length * 12);
      let so = 0;
      names.forEach((n, i) => {
        const o = 6 + i * 12; d.setUint16(o, 3); d.setUint16(o + 2, 1); d.setUint16(o + 4, 0x409); d.setUint16(o + 6, n[0]);
        d.setUint16(o + 8, strs[i].length); d.setUint16(o + 10, so);
        for (let k = 0; k < strs[i].length; k++) d.setUint8(6 + names.length * 12 + so + k, strs[i][k]);
        so += strs[i].length;
      });
    });

    const tags = Object.keys(T).sort();
    const nt = tags.length;
    let total = 12 + nt * 16; const offs = {};
    for (const t of tags) { offs[t] = total; total += Math.ceil(T[t].length / 4) * 4; }
    const out = new Uint8Array(total); const D = new DataView(out.buffer);
    const es = Math.floor(Math.log2(nt)), sr = Math.pow(2, es) * 16;
    D.setUint32(0, 0x00010000); D.setUint16(4, nt); D.setUint16(6, sr); D.setUint16(8, es); D.setUint16(10, nt * 16 - sr);
    const csum = (b) => { const p = new Uint8Array(Math.ceil(b.length / 4) * 4); p.set(b); const v = new DataView(p.buffer); let s = 0; for (let i = 0; i < p.length; i += 4) s = (s + v.getUint32(i)) >>> 0; return s; };
    tags.forEach((t, i) => {
      const o = 12 + i * 16;
      for (let k = 0; k < 4; k++) D.setUint8(o + k, t.charCodeAt(k));
      D.setUint32(o + 4, csum(T[t])); D.setUint32(o + 8, offs[t]); D.setUint32(o + 12, T[t].length);
      out.set(T[t], offs[t]);
    });
    const adj = (0xB1B0AFBA - csum(out)) >>> 0;
    D.setUint32(offs.head + 8, adj);
    return out.buffer;
  }

  global.ReflowFont = {
    build,
    ADV_EM: ADV / UPEM,
    // Resolves true if the generated font is active, false if we fell back.
    load(family) {
      try {
        const ff = new FontFace(family, build());
        return ff.load().then(f => { document.fonts.add(f); return true; }).catch(e => { console.warn('pixel font rejected', e); return false; });
      } catch (e) { console.warn('FontFace unavailable', e); return Promise.resolve(false); }
    }
  };
})(window);
