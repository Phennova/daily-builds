// levels.js - each level is a real HTML page + a stylesheet with a few editable declarations.
// Coordinates: the page is 360 x 540 CSS px. Base font: generated pixel font, 20px (12px per character).
window.LEVELS = [
  {
    id: 'ragged', title: 'Ragged Right', url: 'blog.example/ragged-right',
    teach: 'text-align moves where every line starts and ends. A ragged edge is a staircase.',
    hint: 'Readers walk right and drop off the end of each line. Give them steps going down to the right.',
    hatch: { x: 34, y: 20, dir: 1 }, count: 8, need: 6, edits: 2, par: 1,
    html: `<div class="nav nosolid">blog.example &middot; posts &middot; about</div>
<h1 class="t">Hello,</h1>
<p class="post">Every line of this<br>post is a step. The<br>browser decides where<br>they end. You decide<br>how the text is aligned.</p>
<div class="foot solid"></div><a class="exit">home</a>`,
    css: `.nav{position:absolute;left:20px;top:8px;font-size:10px;line-height:10px;color:#888}
.t{position:absolute;left:20px;top:60px;font-size:40px;line-height:40px}
.post{position:absolute;left:20px;top:120px;width:320px;line-height:30px}
.foot{position:absolute;left:190px;top:330px;width:170px;height:12px;background:#d9d2c3}
.exit{position:absolute;left:290px;top:310px;line-height:20px}`,
    rules: [{ sel: '.post', decls: [{ p: 'text-align', opts: ['right', 'center', 'left'], v: 0 }] }],
    solution: [{ t: 0, r: 0, d: 0, o: 2 }]
  },
  {
    id: 'gap', title: 'Mind the Gap', url: 'transit.example/notices',
    teach: 'letter-spacing adds space after every character, so a line gets longer. Too long and it wraps.',
    hint: 'The bridge has to reach the far platform, but the box is only so wide.',
    hatch: { x: 30, y: 150, dir: 1 }, count: 8, need: 6, edits: 3, par: 1,
    html: `<h1 class="t nosolid">Service notice</h1>
<p class="bridge">mind the gap</p>
<p class="far">platform 2 <a class="exit">exit</a></p>`,
    css: `.t{position:absolute;left:20px;top:40px;font-size:30px;line-height:30px;color:#a33}
.bridge{position:absolute;left:10px;top:220px;width:220px;line-height:20px}
.far{position:absolute;left:200px;top:220px;line-height:20px;white-space:nowrap}`,
    rules: [{ sel: '.bridge', decls: [{ p: 'letter-spacing', opts: ['0px', '2px', '4px', '8px'], v: 0 }] }],
    solution: [{ t: 0, r: 0, d: 0, o: 2 }]
  },
  {
    id: 'nowrap', title: 'Refuses to Wrap', url: 'news.example/longread',
    teach: 'white-space: nowrap keeps a paragraph on one line, even if it overflows its column.',
    hint: 'One long line could reach all the way across.',
    hatch: { x: 30, y: 100, dir: 1 }, count: 8, need: 6, edits: 3, par: 1,
    html: `<p class="col">this sentence refuses to wrap</p>
<div class="pillar solid"></div><p class="far"><a class="exit">read on</a></p>`,
    css: `.col{position:absolute;left:10px;top:160px;width:150px;line-height:30px}
.pillar{position:absolute;left:270px;top:185px;width:90px;height:355px;background:#d9d2c3}
.far{position:absolute;left:276px;top:165px;line-height:20px}`,
    rules: [{ sel: '.col', decls: [{ p: 'white-space', opts: ['normal', 'nowrap'], v: 0 }, { p: 'font-size', opts: ['20px', '10px'], v: 0 }] }],
    solution: [{ t: 0, r: 0, d: 0, o: 1 }]
  },
  {
    id: 'cookies', title: 'Accept All Cookies', url: 'shop.example/checkout',
    teach: 'display: none removes a box from the layout. visibility: hidden only makes it invisible: it still takes up its space. opacity: 0 is still solid.',
    hint: 'The banner sits inside the line the readers walk on. Which way of hiding it closes the gap?',
    hatch: { x: 20, y: 230, dir: 1 }, count: 8, need: 6, edits: 3, par: 1,
    html: `<h1 class="t nosolid">Checkout</h1>
<p class="road">walk on <span class="cookie solid">We use cookies. ACCEPT ALL?</span>to the <a class="exit">basket</a></p>`,
    css: `.t{position:absolute;left:20px;top:40px;font-size:30px;line-height:30px}
.road{position:absolute;left:0;top:250px;width:360px;line-height:20px;white-space:nowrap}
.cookie{display:inline-block;width:110px;height:80px;vertical-align:bottom;background:#f4e3b5;font-size:10px;line-height:12px;white-space:normal;padding:6px;color:#6b5320}`,
    rules: [{ sel: '.cookie', decls: [{ p: 'display', opts: ['inline-block', 'none'], v: 0 }, { p: 'visibility', opts: ['visible', 'hidden'], v: 0 }, { p: 'opacity', opts: ['1', '0'], v: 0 }] }],
    solution: [{ t: 0, r: 0, d: 0, o: 1 }]
  },
  {
    id: 'flex', title: 'Flexbox Stairs', url: 'gallery.example/cards',
    teach: 'flex-direction sets which way the cards line up; align-items sets where each card sits across that line.',
    hint: 'The readers can survive a drop of about four lines. Build stairs that go down to the right.',
    hatch: { x: 16, y: 240, dir: 1 }, count: 8, need: 6, edits: 4, par: 2,
    html: `<div class="ledgeL solid"></div><div class="cards"><div class="c solid">40</div><div class="c solid">80</div><div class="c solid">120</div><div class="c solid">160</div></div>
<div class="ledgeR solid"></div><a class="exit">next</a>`,
    css: `.ledgeL{position:absolute;left:0;top:260px;width:40px;height:280px;background:#d9d2c3}
.ledgeR{position:absolute;left:320px;top:380px;width:40px;height:160px;background:#d9d2c3}
.exit{position:absolute;left:322px;top:360px;line-height:20px;font-size:10px}
.cards{position:absolute;left:40px;top:260px;width:280px;height:280px;display:flex}
.c{width:70px;flex:none;background:#c9d8e8;font-size:10px;line-height:10px;padding:4px;color:#46617d}
.c:nth-child(1){height:40px}.c:nth-child(2){height:80px}.c:nth-child(3){height:120px}.c:nth-child(4){height:160px}`,
    rules: [{ sel: '.cards', decls: [{ p: 'flex-direction', opts: ['row', 'row-reverse', 'column'], v: 0 }, { p: 'align-items', opts: ['flex-start', 'center', 'flex-end'], v: 0 }] }],
    solution: [{ t: 0, r: 0, d: 0, o: 1 }, { t: 0, r: 0, d: 1, o: 1 }]
  },
  {
    id: 'lift', title: 'The em Elevator', url: 'hotel.example/lobby',
    teach: 'The lift is height: 12em. An em is the font-size, so a bigger font makes a taller box, and it pushes up whatever stands on it.',
    hint: 'Wait until readers are standing on the lift, then grow it.',
    hatch: { x: 24, y: 280, dir: 1 }, count: 10, need: 8, edits: 3, par: 1, time: 4200, interval: 25,
    html: `<p class="ledge solid">lobby</p><div class="lift solid"><span class="nosolid">LIFT</span></div>
<div class="tower solid"></div><p class="roof"><a class="exit">roof</a></p>`,
    css: `.ledge{position:absolute;left:0;top:300px;width:120px;height:240px;background:#efe9dc;line-height:20px}
.lift{position:absolute;left:120px;bottom:0;width:120px;height:12em;background:#c9d8e8;font-size:20px;line-height:20px;text-align:center}
.tower{position:absolute;left:240px;top:252px;width:120px;height:288px;background:#d9d2c3}
.roof{position:absolute;left:300px;top:232px;line-height:20px}`,
    rules: [{ sel: '.lift', decls: [{ p: 'font-size', opts: ['20px', '24px', '30px'], v: 0 }] }],
    solution: [{ t: 500, r: 0, d: 0, o: 1 }]
  },
  {
    id: 'ship', title: 'Ship It', url: 'launch.example/',
    teach: 'Everything at once: a banner in the way, a line that has to stay on one line, and the em lift.',
    hint: 'Clear the road, build the bridge, then catch the crowd on the lift before you grow it.',
    hatch: { x: 20, y: 280, dir: 1 }, count: 10, need: 7, edits: 5, par: 3, time: 4800, interval: 25,
    html: `<h1 class="t nosolid">Ship it.</h1><p class="sub nosolid">launch night, 3 a.m.</p>
<p class="road">walk <span class="cookie solid">Cookies? ACCEPT ALL to continue</span>on</p>
<p class="bridge">over gap</p>
<div class="lift solid"><span class="nosolid">LIFT</span></div><div class="tower solid"></div><p class="roof"><a class="exit">up</a></p>`,
    css: `.t{position:absolute;left:20px;top:40px;font-size:40px;line-height:40px}
.sub{position:absolute;left:20px;top:90px;font-size:10px;line-height:10px;color:#888}
.road{position:absolute;left:0;top:300px;line-height:20px;white-space:nowrap}
.cookie{display:inline-block;width:80px;height:70px;vertical-align:bottom;background:#f4e3b5;font-size:10px;line-height:12px;white-space:normal;padding:6px;color:#6b5320}
.bridge{position:absolute;left:80px;top:300px;width:60px;line-height:20px}
.lift{position:absolute;left:176px;bottom:0;width:124px;height:12em;font-size:20px;line-height:20px;background:#c9d8e8;text-align:center}
.tower{position:absolute;left:300px;top:252px;width:60px;height:288px;background:#d9d2c3}
.roof{position:absolute;left:318px;top:232px;line-height:20px}`,
    rules: [
      { sel: '.cookie', decls: [{ p: 'display', opts: ['inline-block', 'none'], v: 0 }, { p: 'visibility', opts: ['visible', 'hidden'], v: 0 }] },
      { sel: '.bridge', decls: [{ p: 'white-space', opts: ['normal', 'nowrap'], v: 0 }] },
      { sel: '.lift', decls: [{ p: 'font-size', opts: ['20px', '24px', '30px'], v: 0 }] }
    ],
    solution: [{ t: 0, r: 0, d: 0, o: 1 }, { t: 0, r: 1, d: 0, o: 1 }, { t: 630, r: 2, d: 0, o: 1 }]
  }
];
