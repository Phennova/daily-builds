/* Blade Rate - Acoustic Intelligence book and watch definitions.
 * Classes are fictional composites; the acoustic principles are real (see README).
 * Amplitudes are relative to the per-sample ambient noise (sigma = 1) at level 1 on-beam. */
(function (G) {
  'use strict';

  const BOOK = [
    {
      id: 'box', name: 'Panamax container ship', short: 'Container ship', type: 'merchant', flag: 'Neutral',
      shafts: 1, blades: 5, tpk: 4.5, speed: [14, 22], mains: 60, mainsAmp: [0.30, 0.16, 0.10, 0.05],
      cyl: 7, firingAmp: 0.28, fixed: [], shaftAmp: 0.14, bladeAmp: [0.26, 0.12, 0.06], cav: 1.0, bb: 1.1,
      notes: 'Slow-turning, direct-drive 7-cylinder two-stroke diesel: a firing line at 7 x shaft rate. Very loud cavitation.'
    },
    {
      id: 'bulk', name: 'Handymax bulk carrier', short: 'Bulk carrier', type: 'merchant', flag: 'Neutral',
      shafts: 1, blades: 4, tpk: 7, speed: [11, 15], mains: 60, mainsAmp: [0.26, 0.14, 0.08],
      cyl: 6, firingAmp: 0.24, fixed: [], shaftAmp: 0.12, bladeAmp: [0.22, 0.10, 0.05], cav: 0.85, bb: 0.9,
      notes: 'Direct-drive 6-cylinder two-stroke: firing line at 6 x shaft rate. 4-bladed propeller.'
    },
    {
      id: 'tanker', name: 'Coastal product tanker', short: 'Coastal tanker', type: 'merchant', flag: 'Neutral',
      shafts: 1, blades: 4, tpk: 14, speed: [10, 14], mains: 50, mainsAmp: [0.24, 0.12, 0.07],
      cyl: 0, fixed: [[37.5, 0.22], [75, 0.10]], shaftAmp: 0.10, bladeAmp: [0.20, 0.10, 0.05], cav: 0.7, bb: 0.75,
      notes: 'European-built: 50 Hz plant. Geared medium-speed main engine; 750 rpm generator set gives 37.5 Hz and 75 Hz.'
    },
    {
      id: 'trawler', name: 'Stern trawler', short: 'Trawler', type: 'fishing', flag: 'Neutral',
      shafts: 1, blades: 3, tpk: 28, speed: [3, 9], mains: 50, mainsAmp: [0.20, 0.10],
      cyl: 0, fixed: [[84, 0.22], [168, 0.08]], shaftAmp: 0.10, bladeAmp: [0.20, 0.10, 0.06], cav: 0.6, bb: 0.6,
      notes: 'Fast-turning 3-bladed propeller (high turns per knot). Hydraulic winch pump at 84 Hz while trawling.'
    },
    {
      id: 'ffg', name: 'Allied frigate (FFG)', short: 'Frigate (Blue)', type: 'warship', flag: 'Blue',
      shafts: 2, blades: 5, tpk: 10, speed: [12, 24], mains: 60, mainsAmp: [0.22, 0.12, 0.08],
      cyl: 0, fixed: [[141, 0.18]], shaftAmp: 0.08, bladeAmp: [0.18, 0.10, 0.06], cav: 0.8, bb: 0.85,
      notes: 'Twin shafts turning at slightly different rates: DEMON blade lines come in close pairs. Gearbox mesh at 141 Hz.'
    },
    {
      id: 'ladoga', name: 'Ladoga-class diesel-electric submarine', short: 'Ladoga SSK (Red)', type: 'submarine', flag: 'Red',
      shafts: 1, blades: 6, tpk: 18, speed: [3, 6], mains: 50, mainsAmp: [0.14, 0.09, 0.06],
      cyl: 0, fixed: [[23, 0.09]], shaftAmp: 0.05, bladeAmp: [0.09, 0.05], cav: 0, bb: 0.12,
      notes: 'On battery it does not cavitate: nothing on DEMON. Faint 50 Hz family, battery-ventilation fan at 23 Hz, blade-rate hull lines (6 blades) low on the LOFAR.'
    },
    {
      id: 'sever', name: 'Sever-class nuclear attack submarine', short: 'Sever SSN (Red)', type: 'submarine', flag: 'Red',
      shafts: 1, blades: 7, tpk: 9, speed: [6, 14], mains: 50, mainsAmp: [0.17, 0.11, 0.07],
      cyl: 0, fixed: [[43, 0.14]], shaftAmp: 0.05, bladeAmp: [0.12, 0.07], cav: 0.32, bb: 0.2,
      notes: 'Quiet. 50 Hz plant and a reactor coolant pump at 43 Hz. 7-bladed skewed propeller; faint DEMON at best.'
    },
    {
      id: 'keystone', name: 'Keystone-class nuclear attack submarine', short: 'Keystone SSN (Blue)', type: 'submarine', flag: 'Blue',
      shafts: 1, blades: 7, tpk: 9, speed: [6, 14], mains: 60, mainsAmp: [0.14, 0.09, 0.06],
      cyl: 0, fixed: [[56, 0.11]], shaftAmp: 0.05, bladeAmp: [0.09, 0.05], cav: 0.3, bb: 0.2,
      notes: 'Friendly boat. 60 Hz plant and a coolant pump at 56 Hz. Same propeller family as the Sever: do not mix them up.'
    },
    {
      id: 'bio', name: 'Biologic (whale)', short: 'Biologic', type: 'bio', flag: 'Neutral',
      notes: 'Moans and pulses that sweep in frequency and come and go. No steady machinery lines, no propeller rhythm. Fin whales pulse near 20 Hz.'
    }
  ];

  const byId = {};
  BOOK.forEach(b => { byId[b.id] = b; });

  // Contact spec: cls, speed (kn), brg (deg), rate (deg/s), lvl (received level, 1 = loud and close), bio kind.
  const WATCHES = [
    {
      n: 1, name: 'Shakedown', duration: 300, tutorial: true,
      brief: 'Calm water, one merchant on the display. Learn the stack: steer the beam onto the trace, read its lines, measure the propeller, file a report.',
      contacts: [{ cls: 'box', speed: [16, 20], brg: [35, 55], rate: [-0.03, 0.03], lvl: 1.0 }]
    },
    {
      n: 2, name: 'Fishing grounds', duration: 300,
      brief: 'Busy shallows on the shelf edge. Classify everything you hold. Biologics count too.',
      contacts: [
        { cls: 'trawler', speed: [4, 8], brg: [290, 320], rate: [-0.02, 0.02], lvl: 0.9 },
        { cls: 'bulk', speed: [12, 14.5], brg: [60, 95], rate: [0.01, 0.04], lvl: 0.8 },
        { cls: 'bio', kind: 'humpback', brg: [110, 135], rate: [-0.01, 0.01], lvl: 0.9 }
      ]
    },
    {
      n: 3, name: 'The strait', duration: 330,
      brief: 'A choke point. Warships use it too: watch for twin-shaft propellers. One sound near 20 Hz is not what it seems.',
      contacts: [
        { cls: 'ffg', speed: [15, 22], brg: [10, 35], rate: [0.02, 0.05], lvl: 0.9 },
        { cls: 'tanker', speed: [10.5, 13.5], brg: [95, 120], rate: [-0.03, 0], lvl: 0.85 },
        { cls: 'bio', kind: 'fin', brg: [235, 265], rate: [-0.01, 0.01], lvl: 1.0 }
      ]
    },
    {
      n: 4, name: 'Battery', duration: 330, clock: 270,
      brief: 'Intel: a Red diesel boat sailed two days ago and went quiet. A friendly SSN is also in the area. If the Red boat hears us first, we are the target. Classify it before the clock runs out.',
      contacts: [
        { cls: 'box', speed: [15, 19], brg: [60, 80], rate: [-0.03, 0.03], lvl: 0.85 },
        { cls: 'ladoga', speed: [3.5, 5.5], brg: [315, 345], rate: [-0.02, 0.02], lvl: 0.85, quiet: true },
        { cls: 'keystone', speed: [7, 11], brg: [225, 255], rate: [-0.02, 0.02], lvl: 0.85, quiet: true }
      ]
    },
    {
      n: 5, name: 'In the shadow', duration: 360, clock: 300,
      brief: 'A Red SSN is known to trail merchants to hide in their noise. Check every big trace closely. If it gets a firing solution on us before we classify it, the watch is over.',
      contacts: [
        { cls: 'box', speed: [16, 20], brg: [80, 100], rate: [0.02, 0.03], lvl: 1.0, id: 'host' },
        { cls: 'sever', speed: [9, 12], brgRel: 'host', off: [2.5, 3.5], lvl: 0.9, quiet: true },
        { cls: 'bulk', speed: [11, 14], brg: [195, 215], rate: [-0.03, 0.03], lvl: 0.75 },
        { cls: 'bio', kind: 'humpback', brg: [300, 330], rate: [-0.01, 0.01], lvl: 0.8 }
      ]
    }
  ];

  const API = { BOOK, byId, WATCHES };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else G.BRDATA = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
