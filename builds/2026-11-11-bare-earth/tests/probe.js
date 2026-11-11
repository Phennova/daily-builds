// quick probe of strip tuning (not a test)
const BE = require('../sim.js');
const { N } = BE;
function blobs(w, f, thr) { // count connected blobs where dtm - ground > thr (size >= 4 cells)
  const seen = new Uint8Array(N * N); let count = 0;
  for (let i = 0; i < N * N; i++) {
    if (seen[i] || f.dtm[i] - w.ground[i] <= thr) continue;
    let st = [i], sz = 0; seen[i] = 1;
    while (st.length) { const j = st.pop(); sz++; const x = j % N, y = (j / N) | 0;
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) { const xx = x+dx, yy = y+dy; if (xx<0||yy<0||xx>=N||yy>=N) continue; const k = yy*N+xx; if (!seen[k] && f.dtm[k]-w.ground[k] > thr) { seen[k]=1; st.push(k); } } }
    if (sz >= 6) count++;
  }
  return count;
}
const which = process.argv[2] ? [+process.argv[2]] : [1,2,3,4,5];
for (const id of which) {
  const spec = BE.STRIPS[id - 1];
  let t = Date.now();
  const w = BE.makeWorld(spec);
  const tGen = Date.now() - t;
  const pyr = w.features.filter(f => f.type === 'pyramid');
  console.log(`strip ${id} ${spec.name}: gen ${tGen}ms groundFrac ${w.stats.groundFrac.toFixed(3)} features ${w.features.length} (${w.features.map(f=>f.type[0]).join('')})`);
  const settings = [spec.defaults, { win: 6, slope: 120 }, { win: 14, slope: 60 }, { win: 20, slope: 60 }, { win: 24, slope: 80 }, { win: 30, slope: 50 }, { win: 34, slope: 22 }, {win: 20, slope: 100}, {win: 20, slope: 65}, {win: 26, slope: 55}, {win: 26, slope: 70}];
  for (const s of settings) {
    t = Date.now();
    const f = BE.groundFilter(w, s);
    const tf = Date.now() - t;
    let err = 0, n = 0;
    for (let i = 0; i < N * N; i++) { err += Math.abs(f.dtm[i] - w.ground[i]); n++; }
    const shaved = pyr.map(p => (BE.sampleMax(w.ground, p) - BE.sampleMax(f.dtm, p)).toFixed(1)).join(',');
    console.log(`  win ${s.win} slope ${s.slope}: ${tf}ms meanErr ${(err / n).toFixed(2)} artefacts>0.8 ${blobs(w, f, 0.8)} >2 ${blobs(w, f, 2)} shaved ${shaved}`);
  }
}
