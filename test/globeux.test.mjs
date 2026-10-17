// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The globe's phone layout and boot fixes from the 2026-10-17 audit, checked offline: the boot watchdog (run in a small
// fake page), push-to-talk's Space guard, and the CSS that keeps the dock, the card and the time-travel strip apart.
// The globe's modules touch the DOM, so the pieces are read from the source text, not imported.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const html = read('globe.html'), css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));

// ---- the boot watchdog, in a fake page
const watchdog = html.match(/<script>(\/\* Boot watchdog[\s\S]*?)<\/script>/)[1];
class El {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.text = ''; this.listeners = {}; this.classes = new Set(); this.attrs = {}; }
  get textContent() { return this.text + this.children.map(c => typeof c === 'string' ? c : c.textContent).join(''); }
  set textContent(t) { this.text = String(t); this.children = []; }
  get firstElementChild() { return this.children.find(c => typeof c !== 'string') || null; }
  get classList() { return { add: c => this.classes.add(c), contains: c => this.classes.has(c) }; }
  append(...xs) { this.children.push(...xs); }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  getContext() { return null; }
}
function page({ cesium = true, webgl = true, booted = false, protocol = 'https:' } = {}) {
  const boot = new El('div'), box = new El('div'); box.textContent = 'Initialising orbital view…'; boot.append(box);
  const timers = [], listeners = [];
  const win = {
    location: { protocol, href: 'https://example.org/globe.html#c=1,2,3', reload() { win.reloaded = true; } },
    document: { getElementById: id => id === 'boot' ? boot : null, createElement: tag => { const e = new El(tag); if (tag === 'canvas') e.getContext = k => webgl && k === 'webgl' ? {} : null; return e; } },
    setTimeout: (fn, ms) => timers.push({ fn, ms }),
    addEventListener: (type, fn, capture) => listeners.push({ type, fn, capture }),
    ErrorEvent: class ErrorEvent { constructor(o) { Object.assign(this, o); } },
  };
  win.window = win;
  if (cesium) win.Cesium = {};
  if (booted) win.OO3D = {};
  vm.runInNewContext(watchdog, win);
  const run = (max = Infinity) => { for (const t of timers.splice(0)) if (t.ms <= max) t.fn(); };
  const fire = e => listeners.filter(l => l.type === 'error').forEach(l => l.fn(e));
  const links = () => box.children.filter(c => typeof c !== 'string').flatMap(p => p.children).filter(c => typeof c !== 'string' && c.tagName === 'A');
  return { win, boot, box, timers, listeners, run, fire, links };
}

test('boot watchdog: a healthy boot is never touched, however slow', () => {
  const p = page({ booted: true });
  assert.ok(p.listeners.some(l => l.type === 'error' && l.capture), 'listens in the capture phase (script load errors do not bubble)');
  assert.ok(p.timers.some(t => t.ms === 20000), 'a 20 s timer');
  p.fire({ target: { tagName: 'SCRIPT' } }); p.run();
  assert.equal(p.box.textContent, 'Initialising orbital view…');
  assert.ok(!p.boot.classList.contains('fail'));
});

test('boot watchdog: the CDN blocked says so, with Retry and the 2D map', () => {
  const p = page({ cesium: false });
  p.fire({ target: { tagName: 'SCRIPT', src: 'https://cdn.jsdelivr.net/npm/cesium@1.146.0/Build/Cesium/Cesium.js' } });
  p.run(5000);
  assert.match(p.box.textContent, /didn't load from cdn\.jsdelivr\.net/);
  assert.ok(p.boot.classList.contains('fail'));
  const [retry, map] = p.links();
  assert.equal(retry.textContent, 'Retry'); assert.equal(map.textContent, 'Open the 2D map'); assert.equal(map.href, 'open-overwatch.html');
  let prevented = false; retry.listeners.click({ preventDefault: () => { prevented = true; } });
  assert.ok(prevented && p.win.reloaded, 'Retry reloads (a link to the same #hash would not)');
});

test('boot watchdog: no WebGL, a thrown error, a timeout, and what it ignores', () => {
  const nogl = page({ webgl: false });
  nogl.fire(new nogl.win.ErrorEvent({ filename: 'https://cdn.jsdelivr.net/npm/cesium@1.146.0/Build/Cesium/Cesium.js', message: 'WebGL' })); nogl.run(5000);
  assert.match(nogl.box.textContent, /no WebGL/);
  const thrown = page();
  thrown.fire(new thrown.win.ErrorEvent({ filename: 'https://example.org/src/globe/viewer.js' })); thrown.run(5000);
  assert.match(thrown.box.textContent, /could not start/);
  const slow = page(); slow.run();
  assert.match(slow.box.textContent, /taking much longer/);
  const quiet = page();
  quiet.fire({ target: { tagName: 'IMG' } }); quiet.fire(new quiet.win.ErrorEvent({ filename: 'https://example.org/src/app/shell.js' }));
  assert.equal(quiet.timers.length, 1, 'an image that failed, or the shell, is not the globe failing');
  const file = page({ cesium: false, protocol: 'file:' }); file.run();
  assert.equal(file.box.textContent, 'Initialising orbital view…', 'file:// keeps its own note');
  assert.doesNotMatch(watchdog, /innerHTML|insertAdjacentHTML|document\.write/, 'text and links only');
});

test('boot watchdog: it sits before the Cesium script, so it hears that script fail', () => {
  assert.ok(html.indexOf('Boot watchdog') < html.indexOf('Build/Cesium/Cesium.js"'));
});

// ---- push to talk
test('push-to-talk: Space arms the mic only over the globe or with nothing focused', () => {
  const src = read('src/globe/voice.js');
  const NOT_PTT = src.match(/const NOT_PTT = ('[^']+');/)[1], fn = src.match(/const pttTarget = (\(t, doc = document\) => [^\n]+);/)[1];
  const pttTarget = Function('document', `const NOT_PTT = ${NOT_PTT}; return ${fn};`)(null);
  const sel = s => s.split(',').map(x => x.trim());
  // a fake element: what it is (selectors it matches) and whether it sits inside #globe
  const el = (is = [], inGlobe = false) => ({ closest: s => sel(s).includes('#globe') ? (inGlobe ? {} : null) : sel(s).some(x => is.includes(x)) ? {} : null });
  const doc = { body: el(), documentElement: el() };
  assert.ok(pttTarget(doc.body, doc), 'nothing focused');
  assert.ok(pttTarget(el([], true), doc), 'the globe itself (a11y.js gives it tabindex 0)');
  for (const t of ['summary', 'a[href]', '[role=button]', '[role=slider]', 'button', 'input', 'select', 'textarea'])
    assert.ok(!pttTarget(el([t]), doc), `${t} keeps its Space`);
  assert.ok(!pttTarget(el([]), doc), 'any other focused element outside the globe ([tabindex] cards and lists) too');
  assert.ok(!pttTarget(el(['button'], true), doc), 'a control inside #globe');
  assert.match(src, /\|\| !pttTarget\(e\.target\)\) return;/, 'the keydown handler uses it');
});

// ---- layout
test('phones: the dock and the card never share their slot', () => {
  const m = read('src/globe/mobile.js');
  assert.match(m, /^\s*if \(k === 'layers'\) \{ if \(!\$\('#dock'\)\.classList\.contains\('open'\)\) hooks\.closeCard\?\.\(\); \$\('#btnDock'\)\.click\(\); sync\(\); \} else if \(k === 'lookup'\) band\.querySelector\('\[data-go="lookup"\]'\)\.click\(\); else northUp\(\);$/m,
    'opening Layers closes the card (and Look up and North stay wired, not swallowed by a comment)');
  assert.match(m, /new MutationObserver\(\(\) => \{ const now = \$\('#card'\)\.classList\.contains\('show'\); if \(now && !cardShown\) \$\('#dock'\)\.classList\.remove\('open'\)/, 'a card that opens closes the dock');
  assert.match(css, /body\.m #dock\.open ~ #card\.show\{display:none\}/, 'the CSS backstop');
  assert.ok(html.indexOf('<aside id="dock"') < html.indexOf('<section id="card"'), 'the ~ backstop needs the dock first');
});

test('phones: a card opened under Time travel sits above the strip', () => {
  const strip = css.match(/body\.m #tt\{[^}]*max-height:(\d+)dvh/)[1];
  const card = css.match(/body\.m\.tt-open #card\{bottom:calc\((\d+)dvh \+ 96px[^;]*\);max-height:max\(120px,calc\((\d+)dvh/);
  assert.ok(card, 'a body.m.tt-open #card rule');
  assert.equal(card[1], strip, 'the card starts where the strip ends');
  assert.equal(+card[1] + +card[2], 100);
});

test('coarse pointers: the small controls get finger-sized, after the rules they override', () => {
  const blocks = src => [...src.matchAll(/@media \(pointer:coarse\)\{/g)].map(m => {   // each block's body, to its matching brace
    let i = m.index + m[0].length, depth = 1; const start = i;
    while (depth && i < src.length) { if (src[i] === '{') depth++; else if (src[i] === '}') depth--; i++; }
    return src.slice(start, i - 1);
  });
  const coarse = blocks(css), has = sel => coarse.some(b => b.includes(sel));
  for (const sel of ['#lookup select,#lookup .lu-when input{min-height:40px}', '.tt-st .tt-on{min-height:36px', '#tt .x,.wx-head .x{font-size:24px'])
    assert.ok(has(sel), sel);
  for (const [base, bump] of [['.tt-st .tt-on{padding:3px 7px;min-height:0}', '.tt-st .tt-on{min-height:36px'], ['#tt .x{position:sticky', '#tt .x,.wx-head .x{font-size:24px'], ['.wx-head .x{border:0', '#tt .x,.wx-head .x{font-size:24px'], ['#lookup select{', '#lookup select,#lookup .lu-when input{min-height:40px}']])
    assert.ok(css.indexOf(base) >= 0 && css.indexOf(base) < css.indexOf(bump), `${bump} comes after ${base}`);
  const radio = read('src/globe/radio.css');
  assert.ok(blocks(radio).some(b => b.includes('#rdTuner .rd-x{font-size:24px')), 'radio.css has the bump in a coarse block');
  assert.ok(radio.indexOf('#rdTuner .rd-x{font-size:17px') < radio.indexOf('@media (pointer:coarse){#rdTuner .rd-x{font-size:24px'), 'the radio tuner\'s close too');
});

test('desktop toasts clear the OPS rail', () => {
  const rail = read('src/globe/ops.css').match(/#opsRail\{[^}]*top:(\d+)px/)[1], btn = read('src/globe/ops.css').match(/#opsRail button\{[^}]*height:(\d+)px/);
  const toast = +css.match(/#toast\{position:fixed;left:50%;top:(\d+)px/)[1];
  assert.ok(toast >= +rail + (btn ? +btn[1] : 30) + 8, `toast top ${toast}px, rail ${rail}px`);
});

test('copy: no "prototype" on the shipped globe; the gesture note fits the device; Look up says why it shows Greenwich', () => {
  assert.doesNotMatch(html.match(/<div class="brand glass">[\s\S]*?<\/div><\/div>/)[0], /prototype/i);
  const layers = read('src/globe/layers.js');
  assert.match(layers, /PHONE \? 'Drag to turn, pinch to zoom, two fingers up or down to tilt\. Tap anything for details\.'/);
  const lu = read('src/globe/lookup.js');
  assert.match(lu, /name: 'Greenwich \(example\)'/);
  assert.match(lu, /if \(!loc\) noLocation\(S\.geoErr\);/, 'a refused location is explained, with Allow location');
  assert.match(lu, /b\.textContent = 'Allow location'/);
});
