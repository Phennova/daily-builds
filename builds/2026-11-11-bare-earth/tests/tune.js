// grid search filter settings per strip (tuning aid, not a test)
const BE = require('../sim.js');
const { N } = BE;
function junk(w, f, thr) { let c = 0; for (let i = 0; i < N * N; i++) if (f.dtm[i] - w.ground[i] > thr) c++; return c; }
const ids = process.argv[2] ? process.argv[2].split(',').map(Number) : [1, 2, 3, 4, 5];
for (const id of ids) {
  const w = BE.makeWorld(BE.STRIPS[id - 1]);
  const pyr = w.features.filter(f => f.type === 'pyramid');
  const plats = w.features.filter(f => f.type === 'platform');
  const rows = [];
  for (const win of [6, 10, 14, 18, 22, 26, 30, 34, 40]) for (const slope of [20, 30, 40, 50, 60, 70, 80, 100, 120]) {
    const f = BE.groundFilter(w, { win, slope });
    const j = junk(w, f, 1.0);
    const sh = Math.max(0, ...pyr.map(p => BE.sampleMax(w.ground, p) - BE.sampleMax(f.dtm, p)));
    const psh = Math.max(0, ...plats.map(p => BE.sampleMax(w.ground, p) - BE.sampleMax(f.dtm, p)));
    rows.push({ win, slope, j, sh: +sh.toFixed(1), psh: +psh.toFixed(1), cost: j + 400 * Math.max(0, sh - 1) + 200 * Math.max(0, psh - 0.8) });
  }
  rows.sort((a, b) => a.cost - b.cost);
  console.log('strip', id, 'best:', rows.slice(0, 6).map(r => `${r.win}/${r.slope} j${r.j} sh${r.sh} p${r.psh}`).join(' | '));
  const d = rows.find(r => r.win === w.spec.defaults.win && r.slope === w.spec.defaults.slope);
  console.log('   defaults', w.spec.defaults.win, w.spec.defaults.slope, d ? `j${d.j} sh${d.sh} p${d.psh}` : '(off grid)');
  // where does junk sit? report bounding bins
  const f = BE.groundFilter(w, { win: rows[0].win, slope: rows[0].slope });
  const bins = {};
  for (let i = 0; i < N * N; i++) if (f.dtm[i] - w.ground[i] > 1) { const k = ((i % N) / 50 | 0) + ',' + ((i / N | 0) / 50 | 0); bins[k] = (bins[k] || 0) + 1; }
  console.log('   junk bins (x,y per 100m):', JSON.stringify(bins));
}
