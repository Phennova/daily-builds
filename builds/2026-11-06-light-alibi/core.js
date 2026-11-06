// Light Alibi - core logic: geometry, latency model, cases, scoring. No DOM. Works in browser and node.
(function (root) {
  'use strict';
  var R_EARTH = 6371.0;          // km
  var FIBER = 200.0;             // km per ms, ~2/3 c: nothing on the internet is faster
  var HALF_CIRC = Math.PI * R_EARTH;
  var D2R = Math.PI / 180;

  // ---------- geometry ----------
  function toVec(lat, lon) {
    var la = lat * D2R, lo = lon * D2R, c = Math.cos(la);
    return [c * Math.cos(lo), c * Math.sin(lo), Math.sin(la)];
  }
  function fromVec(v) {
    var n = Math.hypot(v[0], v[1], v[2]);
    return { lat: Math.asin(Math.max(-1, Math.min(1, v[2] / n))) / D2R, lon: Math.atan2(v[1], v[0]) / D2R };
  }
  function dist(a, b) { // great-circle km, a/b = {lat,lon}
    var p1 = a.lat * D2R, p2 = b.lat * D2R, dp = p2 - p1, dl = (b.lon - a.lon) * D2R;
    var h = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  // Orthographic view: camera looks at (lat0, lon0). Returns rotation helpers.
  function makeView(lat0, lon0) {
    var la = lat0 * D2R, lo = lon0 * D2R;
    var cl = Math.cos(la), sl = Math.sin(la), co = Math.cos(lo), so = Math.sin(lo);
    // basis: f = forward (toward viewer = centre point), e = east, n = north
    var f = [cl * co, cl * so, sl], e = [-so, co, 0], n = [-sl * co, -sl * so, cl];
    return {
      f: f, e: e, n: n,
      project: function (lat, lon) { // -> {x,y,z} with x right, y up, z toward viewer (visible if z>0), unit sphere
        var v = toVec(lat, lon);
        return { x: v[0] * e[0] + v[1] * e[1] + v[2] * e[2], y: v[0] * n[0] + v[1] * n[1] + v[2] * n[2], z: v[0] * f[0] + v[1] * f[1] + v[2] * f[2] };
      },
      unproject: function (x, y) { // unit disk -> {lat,lon} or null
        var r2 = x * x + y * y;
        if (r2 > 1) return null;
        var z = Math.sqrt(1 - r2);
        return fromVec([x * e[0] + y * n[0] + z * f[0], x * e[1] + y * n[1] + z * f[1], x * e[2] + y * n[2] + z * f[2]]);
      }
    };
  }
  // destination point given start, bearing (deg), distance km
  function destination(p, brg, d) {
    var a = d / R_EARTH, b = brg * D2R, p1 = p.lat * D2R, l1 = p.lon * D2R;
    var p2 = Math.asin(Math.sin(p1) * Math.cos(a) + Math.cos(p1) * Math.sin(a) * Math.cos(b));
    var l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(a) * Math.cos(p1), Math.cos(a) - Math.sin(p1) * Math.sin(p2));
    return { lat: p2 / D2R, lon: ((l2 / D2R + 540) % 360) - 180 };
  }
  function radiusFromRtt(rttMs) { return Math.min(HALF_CIRC, Math.max(0, rttMs) / 2 * FIBER); }

  // ---------- places ----------
  // id: [name, country, lat, lon, landmark?]
  var PLACES = {
    sea: ['Seattle', 'USA', 47.61, -122.33, 1], sfo: ['San Francisco', 'USA', 37.77, -122.42, 1],
    lax: ['Los Angeles', 'USA', 34.05, -118.24, 1], den: ['Denver', 'USA', 39.74, -104.99, 1],
    dfw: ['Dallas', 'USA', 32.78, -96.80, 1], chi: ['Chicago', 'USA', 41.88, -87.63, 1],
    yyz: ['Toronto', 'Canada', 43.65, -79.38, 1], nyc: ['New York', 'USA', 40.71, -74.01, 1],
    was: ['Washington', 'USA', 38.91, -77.04, 1], mia: ['Miami', 'USA', 25.76, -80.19, 1],
    mex: ['Mexico City', 'Mexico', 19.43, -99.13, 1], bog: ['Bogota', 'Colombia', 4.71, -74.07, 1],
    lim: ['Lima', 'Peru', -12.05, -77.04, 1], sao: ['Sao Paulo', 'Brazil', -23.55, -46.63, 1],
    scl: ['Santiago', 'Chile', -33.45, -70.67, 1], bue: ['Buenos Aires', 'Argentina', -34.60, -58.38, 1],
    rey: ['Reykjavik', 'Iceland', 64.15, -21.94, 1], dub: ['Dublin', 'Ireland', 53.35, -6.26, 1],
    lon: ['London', 'UK', 51.51, -0.13, 1], par: ['Paris', 'France', 48.86, 2.35, 1],
    mad: ['Madrid', 'Spain', 40.42, -3.70, 1], ams: ['Amsterdam', 'Netherlands', 52.37, 4.90, 1],
    fra: ['Frankfurt', 'Germany', 50.11, 8.68, 1], sto: ['Stockholm', 'Sweden', 59.33, 18.07, 1],
    waw: ['Warsaw', 'Poland', 52.23, 21.01, 1], prg: ['Prague', 'Czechia', 50.08, 14.44, 1],
    rom: ['Rome', 'Italy', 41.90, 12.50, 1], ist: ['Istanbul', 'Turkey', 41.01, 28.98, 1],
    mow: ['Moscow', 'Russia', 55.76, 37.62, 1], cai: ['Cairo', 'Egypt', 30.04, 31.24, 1],
    los: ['Lagos', 'Nigeria', 6.52, 3.38, 1], nbo: ['Nairobi', 'Kenya', -1.29, 36.82, 1],
    jnb: ['Johannesburg', 'South Africa', -26.20, 28.05, 1], cpt: ['Cape Town', 'South Africa', -33.92, 18.42, 1],
    dxb: ['Dubai', 'UAE', 25.20, 55.27, 1], bom: ['Mumbai', 'India', 19.08, 72.88, 1],
    blr: ['Bengaluru', 'India', 12.97, 77.59, 1], sin: ['Singapore', 'Singapore', 1.35, 103.82, 1],
    hkg: ['Hong Kong', 'China', 22.32, 114.17, 1], mnl: ['Manila', 'Philippines', 14.60, 120.98, 1],
    tpe: ['Taipei', 'Taiwan', 25.03, 121.57, 1], tyo: ['Tokyo', 'Japan', 35.68, 139.69, 1],
    sel: ['Seoul', 'South Korea', 37.57, 126.98, 1], syd: ['Sydney', 'Australia', -33.87, 151.21, 1],
    per: ['Perth', 'Australia', -31.95, 115.86, 1], akl: ['Auckland', 'New Zealand', -36.85, 174.76, 1],
    hnl: ['Honolulu', 'USA', 21.31, -157.86, 1], anc: ['Anchorage', 'USA', 61.22, -149.90, 1],
    // claim-only (no landmark server there)
    shn: ['Jamestown', 'Saint Helena', -15.92, -5.72, 0], tdc: ['Edinburgh of the Seven Seas', 'Tristan da Cunha', -37.07, -12.31, 0],
    nuk: ['Nuuk', 'Greenland', 64.18, -51.72, 0], uln: ['Ulaanbaatar', 'Mongolia', 47.89, 106.91, 0],
    pyy: ['Port Louis', 'Mauritius', -20.16, 57.50, 0], ppt: ['Papeete', 'French Polynesia', -17.54, -149.57, 0],
    ala: ['Almaty', 'Kazakhstan', 43.24, 76.89, 0], lpb: ['La Paz', 'Bolivia', -16.50, -68.15, 0],
    ccs: ['Caracas', 'Venezuela', 10.48, -66.90, 0], add: ['Addis Ababa', 'Ethiopia', 9.03, 38.74, 0],
    kbl: ['Kabul', 'Afghanistan', 34.53, 69.17, 0], ktm: ['Kathmandu', 'Nepal', 27.72, 85.32, 0],
    svd: ['Suva', 'Fiji', -18.14, 178.44, 0], lyr: ['Longyearbyen', 'Svalbard', 78.22, 15.65, 0],
    teh: ['Tehran', 'Iran', 35.69, 51.39, 0], dak: ['Dakar', 'Senegal', 14.72, -17.47, 0]
  };
  function place(id) { var p = PLACES[id]; return { id: id, name: p[0], country: p[1], lat: p[2], lon: p[3], landmark: !!p[4] }; }
  function landmarkIds() { return Object.keys(PLACES).filter(function (k) { return PLACES[k][4]; }); }
  var HUBS = ['fra', 'ams', 'lon', 'prg', 'par', 'sto', 'nyc', 'was', 'dfw', 'lax', 'mia', 'chi', 'sin', 'tyo', 'hkg', 'sao', 'jnb', 'syd', 'mow', 'waw', 'mad', 'dxb', 'bom'];

  // ---------- deterministic randomness ----------
  function hashStr(s) { var h = 2166136261 >>> 0; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; }
  function rng(seed) { var a = seed >>> 0; return function () { a = (a + 0x6D2B79F5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  // ---------- latency model ----------
  // One-way path between two points: great-circle distance x inflation, at fibre speed, plus router/serialisation base.
  // detour: {via: place} sends the path through another city (circuitous routing).
  function pathRtt(a, b, keyStr, detourVia) {
    var u = rng(hashStr(keyStr))();
    var infl = 1.25 + 0.5 * u;                      // 1.25 .. 1.75
    var d = detourVia ? dist(a, detourVia) + dist(detourVia, b) : dist(a, b);
    return 2 * d * infl / FIBER + 0.8 + 0.6 * u;    // ms
  }
  function jitterSample(r) { return -Math.log(1 - r() * 0.999) * 2.5; } // exponential queueing delay, mean 2.5 ms
  // Ping the target from a landmark (pingable target). Returns samples + min.
  function measureDirect(caseObj, lmId, r) {
    var lm = place(lmId), t = caseObj.truthPlace;
    var via = caseObj.detours && caseObj.detours[lmId] ? place(caseObj.detours[lmId]) : null;
    var base = pathRtt(lm, t, 'p:' + lmId + '>' + t.id + ':' + caseObj.seed, via) + caseObj.lastMile;
    var s = [];
    for (var i = 0; i < 5; i++) s.push(base + jitterSample(r));
    return { samples: s, min: Math.min.apply(null, s), via: via };
  }
  // Through the proxy: client -> proxy -> landmark -> proxy -> client (B).
  function measureThrough(caseObj, lmId, r) {
    var lm = place(lmId), t = caseObj.truthPlace, cl = caseObj.clientPlace;
    var via = caseObj.detours && caseObj.detours[lmId] ? place(caseObj.detours[lmId]) : null;
    var leg = pathRtt(cl, t, 'c:' + cl.id + '>' + t.id + ':' + caseObj.seed, null) + caseObj.lastMile;
    var far = pathRtt(t, lm, 'p:' + lmId + '>' + t.id + ':' + caseObj.seed, via);
    var s = [];
    for (var i = 0; i < 5; i++) s.push(leg + far + jitterSample(r));
    return { samples: s, min: Math.min.apply(null, s), via: via };
  }
  // Client -> proxy -> client (your own listener) -> proxy -> client: twice the client leg (C).
  function measureSelf(caseObj, r) {
    var t = caseObj.truthPlace, cl = caseObj.clientPlace;
    var leg = pathRtt(cl, t, 'c:' + cl.id + '>' + t.id + ':' + caseObj.seed, null) + caseObj.lastMile;
    var s = [];
    for (var i = 0; i < 5; i++) s.push(2 * leg + jitterSample(r));
    return { samples: s, min: Math.min.apply(null, s) };
  }

  // ---------- cases ----------
  var CASES = [
    { key: 'first-light', title: 'First Light', provider: 'NordStar VPN', exit: 'de-fra-07', claim: 'fra', truth: 'fra',
      pingable: true, budget: 5, lastMile: 0.4,
      brief: 'A new provider says this exit is in Frankfurt. Ping it from a few landmarks and see where light allows it to be.',
      lesson: 'Every disk is an upper bound: (RTT / 2) x 200 km/ms. The exit can be anywhere inside all of them, so an honest claim can never be proven true, only left standing.' },
    { key: 'northern-lie', title: 'Northern Lie', provider: 'Aurora Privacy', exit: 'is-rey-03', claim: 'rey', truth: 'ams',
      pingable: true, budget: 4, lastMile: 0.4,
      brief: 'Cheap Icelandic exits are popular for privacy. Is this one really in Reykjavik?',
      lesson: 'A slow ping from the Reykjavik landmark is only suspicious: RTT gives no lower bound on distance. The proof is a short ping from somewhere else whose disk leaves Reykjavik outside.' },
    { key: 'saint-helena', title: 'Saint Helena', provider: 'GlobeHop Residential', exit: 'sh-jam-01', claim: 'shn', truth: 'prg',
      pingable: false, budget: 5, lastMile: 0.5, client: 'blr',
      brief: 'Proxy lists sell exits "everywhere, even Saint Helena". This one ignores pings. You can only time traffic through it from your desk in Bengaluru. Tip: a lying exit is usually somewhere cheap and well connected, so probe from more than one direction.',
      lesson: 'Through a proxy you measure B = your leg + its leg. Time a connection back to yourself (C = your leg twice) and the landmark leg is A = B - C/2. Without C the disks are true but uselessly huge.' },
    { key: 'detour', title: 'Detour', provider: 'StraitNet', exit: 'sg-sin-12', claim: 'sin', truth: 'hkg',
      pingable: true, budget: 3, lastMile: 0.4, offline: ['hkg', 'sin'], detours: { mnl: 'lax', tpe: 'lax' },
      brief: 'A Singapore exit. The Hong Kong and Singapore landmarks are down for maintenance, and some regional routes are known to be circuitous.',
      lesson: 'Packets follow peering, not great circles: Manila or Taipei to Hong Kong may go via California. Detours only make disks bigger (still safe), but a wasted probe is a wasted probe.' },
    { key: 'edge-of-the-world', title: 'Edge of the World', provider: 'FarReach Residential', exit: 'ta-tdc-02', claim: 'tdc', truth: 'jnb',
      pingable: false, budget: 4, lastMile: 0.5, client: 'blr', detours: { cpt: 'lon', los: 'lon' },
      brief: 'An exit on Tristan da Cunha, the most remote inhabited island on Earth, 2,400 km from anywhere. It ignores pings.',
      lesson: 'African traffic often "trombones" through Europe: Cape Town to Johannesburg via London. When the obvious landmark detours, the proof has to come from one that does not.' }
  ];
  var CLAIM_POOL = ['rey', 'shn', 'tdc', 'nuk', 'uln', 'pyy', 'ppt', 'ala', 'lpb', 'ccs', 'add', 'kbl', 'ktm', 'svd', 'lyr', 'teh', 'dak',
    'lim', 'bog', 'scl', 'nbo', 'los', 'cai', 'ist', 'mnl', 'akl', 'per', 'anc', 'hnl', 'mex', 'bue', 'cpt'];
  var PROVIDERS = ['Halcyon VPN', 'PeerMesh Residential', 'Obsidian Proxy', 'CloakLine', 'Kestrel Exit', 'Mirage Residential', 'NullRoute VPN', 'SableNet'];

  function buildCase(def, seed) {
    var c = {};
    for (var k in def) c[k] = def[k];
    c.seed = seed >>> 0;
    c.claimPlace = place(def.claim);
    c.truthPlace = place(def.truth);
    c.clientPlace = place(def.client || 'blr');
    c.honest = def.claim === def.truth;
    c.offline = def.offline || [];
    c.detours = def.detours || {};
    return c;
  }
  function campaignCase(i, seed) { return buildCase(CASES[i], seed); }
  function randomCase(seed) {
    var r = rng(seed);
    var claim = CLAIM_POOL[Math.floor(r() * CLAIM_POOL.length)];
    var cp = place(claim);
    var honest = r() < 0.42;
    var truth = claim;
    if (!honest) {
      var far = HUBS.filter(function (h) { return dist(place(h), cp) > 1800; });
      truth = far[Math.floor(r() * far.length)];
    }
    var tp = place(truth);
    var lms = landmarkIds();
    var detours = {};
    var nd = 1 + Math.floor(r() * 3);
    var near = lms.filter(function (l) { return l !== truth; }).sort(function (a, b) { return dist(place(a), tp) - dist(place(b), tp); }).slice(0, 8);
    for (var i = 0; i < nd; i++) {
      var l = near[Math.floor(r() * near.length)];
      var vias = HUBS.filter(function (h) { var d1 = dist(place(h), tp); return d1 > 3000 && h !== l; });
      detours[l] = vias[Math.floor(r() * vias.length)];
    }
    var offline = [];
    if (r() < 0.6 && place(truth).landmark) offline.push(truth);
    if (cp.landmark && r() < 0.5) offline.push(claim);
    var pingable = r() < 0.5;
    var residential = r() < 0.5;
    var def = {
      key: 'night-' + seed, title: 'Night Shift', provider: PROVIDERS[Math.floor(r() * PROVIDERS.length)],
      exit: (cp.country.slice(0, 2).toLowerCase()) + '-' + claim + '-' + (10 + Math.floor(r() * 89)),
      claim: claim, truth: truth, pingable: pingable, budget: pingable ? 4 : 5, lastMile: residential ? 3 + r() * 6 : 0.4,
      client: 'blr', offline: offline, detours: detours,
      brief: (residential ? 'A residential exit' : 'A datacenter exit') + ' claiming ' + cp.name + ', ' + cp.country + '.' + (pingable ? '' : ' It ignores pings.'),
      lesson: honest ? 'This one was where it said. Not every exit lies - but you can only ever fail to disprove.' : 'Exits cluster where hosting is cheap and well connected. The advertised country was a label in a database.'
    };
    return buildCase(def, seed);
  }

  // ---------- evaluation ----------
  // disks: [{lm:{lat,lon}, radius}] ; returns ids of disks that exclude point p
  // A probe result -> disk. Through-proxy results use A = B - C/2 once C (selfMin) is known, else B.
  function diskFor(lmId, rtt, selfMin) {
    var eff = selfMin != null ? rtt - selfMin / 2 : rtt;
    var lm = place(lmId);
    return { id: lmId, lm: lm, rtt: rtt, eff: eff, radius: radiusFromRtt(eff) };
  }
  function excluding(disks, p) { return disks.filter(function (d) { return dist(d.lm, p) > d.radius + 1e-6; }); }
  function inAll(disks, p) { return excluding(disks, p).length === 0; }
  function score(caseObj, disks, verdict, pin, probesLeft) {
    var proof = excluding(disks, caseObj.claimPlace);
    var out = { verdictPts: 0, pinPts: 0, probePts: probesLeft * 50, notes: [] };
    if (verdict === 'impossible') {
      if (proof.length) { out.verdictPts = 400; out.verdictMsg = 'Proven: the claim lies outside a light-speed disk.'; }
      else { out.verdictPts = 0; out.verdictMsg = caseObj.honest ? 'Wrong: the claim was true.' : 'Unsupported accusation: no disk excluded the claim, so you had no proof.'; }
    } else {
      if (caseObj.honest) { out.verdictPts = 400; out.verdictMsg = 'Correct: the claim survives every disk.'; }
      else if (proof.length) { out.verdictPts = 50; out.verdictMsg = 'You had the proof on the globe and let it go.'; }
      else { out.verdictPts = 150; out.verdictMsg = 'The lie got past you: none of your disks excluded the claim.'; }
    }
    if (pin) {
      var err = dist(pin, caseObj.truthPlace);
      out.pinErr = err;
      var pts = 400 * Math.max(0, 1 - err / 2000);
      out.pinInside = inAll(disks, pin);
      if (!out.pinInside) { pts *= 0.5; out.notes.push('Your pin was outside a disk: physically impossible.'); }
      out.pinPts = Math.round(pts);
    }
    out.total = out.verdictPts + out.pinPts + out.probePts;
    return out;
  }

  var api = { R_EARTH: R_EARTH, FIBER: FIBER, HALF_CIRC: HALF_CIRC, toVec: toVec, fromVec: fromVec, dist: dist, makeView: makeView,
    destination: destination, radiusFromRtt: radiusFromRtt, PLACES: PLACES, place: place, landmarkIds: landmarkIds, HUBS: HUBS,
    rng: rng, hashStr: hashStr, pathRtt: pathRtt, measureDirect: measureDirect, measureThrough: measureThrough, measureSelf: measureSelf,
    CASES: CASES, campaignCase: campaignCase, randomCase: randomCase, diskFor: diskFor, excluding: excluding, inAll: inAll, score: score };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.LA = api;
})(this);
