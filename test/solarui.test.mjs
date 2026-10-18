// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The Solar System page's phone, keyboard and failure fixes from the 2026-10-17 audit, checked offline: the boot
// watchdog (run in a small fake page), the lists, search and Under the hood run against a fake DOM (three.js is stubbed:
// the modules only need its Vector3 at import), and the phone CSS, the credits sheet and the page's claims read from
// the source.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import vm from 'node:vm';
import { planetPosition } from '../src/core/planets.js';

// 'three' -> a stub with the one class src/solar/world.js makes at import
const THREE_STUB = 'data:text/javascript,' + encodeURIComponent('export class Vector3 { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } }');
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) { return s === 'three' ? { url: ${JSON.stringify(THREE_STUB)}, shortCircuit: true } : next(s, c); }`));

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const json = p => JSON.parse(read(p));
const html = read('solar.html'), css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
const phoneCss = css.split('@media (max-width: 900px)').slice(1).join('\n');

// ---- a fake DOM: elements by selector, with what the modules touch
const flush = () => new Promise(r => setImmediate(r));
function fakeDom({ width = 1280 } = {}) {
  const els = {}, intervals = [];
  const el = sel => (els[sel] ||= {
    sel, style: {}, innerHTML: '', value: '', dataset: {}, listeners: {}, children: [], classes: new Set(),
    classList: { add: c => els[sel].classes.add(c), remove: c => els[sel].classes.delete(c), contains: c => els[sel].classes.has(c), toggle: (c, on) => (on ?? !els[sel].classes.has(c)) ? els[sel].classes.add(c) : els[sel].classes.delete(c) },
    addEventListener(t, f) { this.listeners[t] = f; }, contains: x => !!x && x.inside === sel, querySelectorAll: () => [], getBoundingClientRect: () => ({ left: 200 }),
    blur() {}, focus() { document.activeElement = this; },
  });
  const document = {
    querySelector: el, querySelectorAll: () => [], activeElement: null, body: { classList: { contains: () => false }, appendChild() {} },
    documentElement: { classList: { contains: () => false } }, addEventListener() {},
  };
  Object.assign(globalThis, { document, innerWidth: width, addEventListener() {}, location: { href: 'http://localhost/solar.html', search: '' } });
  globalThis.setInterval = fn => { intervals.push(fn); return intervals.length; };
  globalThis.clearInterval = () => {};
  return { el, els, intervals, document, tick: () => intervals.at(-1)() };
}
const realTimers = { setInterval, clearInterval };
test.afterEach(() => Object.assign(globalThis, realTimers));

const world = await import('../src/solar/world.js');
const { createLists } = await import('../src/solar/lists.js');
const { createFind } = await import('../src/solar/find.js');
const { createNerd } = await import('../src/solar/nerd.js');
for (const id of ['craft', 'asteroids', 'eclipses', 'stars']) world.defineLayer({ id, name: id, c: '#fff', on: true });
world.addBody({ key: 'earth', name: 'Earth', kind: 'planet', big: true, pos: { x: 1, y: 0, z: 0, distanceTo: () => 1 } });
world.addBody({ key: 'mars', name: 'Mars', kind: 'planet', big: true, pos: { x: 1.5, y: 0, z: 0, distanceTo: () => 0.5 } });

const JD = 2461331.5;   // 2026-10-18
const SPACECRAFT = json('data/solar/spacecraft.json'), SB = json('data/solar/small_bodies.json');
function lists({ width = 1280, craftRows = SPACECRAFT, eclipses = null, retry } = {}) {
  const dom = fakeDom({ width }), flights = [];
  for (const s of craftRows) if (!world.byKey['craft:' + s.name]) world.addBody({ key: 'craft:' + s.name, name: s.name, kind: 'spacecraft', launched: true, pos: { distanceTo: () => 1 } });
  const craft = { craft: craftRows.map(s => ({ s })), centerAt: (k, jd, out) => (k === 'moon' ? null : planetPosition(k, jd, out)) };
  const comets = { rows: SB.comets, cometBody: row => ({ key: 'comet:' + row[0], name: row[0] }) };
  const ecl = eclipses || { ready: false, failedAt: -Infinity, events: [], load: () => new Promise(() => {}) };
  const find = { flyTo: b => flights.push({ b, listOpen: dom.el('#list').style.display }) };
  const L = createLists({ craft, comets, small: { S: { made: SB.made } }, clock: { jd: JD, live: true }, find, eclipses: ecl, ...(retry ? { retry } : {}) });
  const click = target => dom.el('#listB').listeners.click({ target });
  return { ...dom, L, flights, ecl, click, box: () => dom.el('#listB').innerHTML };
}
/** A click target inside a row: closest() answers for the row (and no button). */
const inRow = dataset => ({ closest: s => (s.startsWith('tr') ? { dataset } : null) });
const onButton = dataset => ({ closest: s => (s.startsWith('[data-jump]') ? { dataset } : null) });

// ---------------------------------------------------------------- the lists
test('lists: every mission and comet row has a real button to fly there (the keyboard can reach them)', () => {
  const p = lists();
  p.L.show('missions');
  const m = p.box(), rows = m.match(/<tr data-key=/g).length;
  assert.ok(rows >= 20, 'the missions are listed');
  assert.equal((m.match(/<button class="fly" data-fly="key:craft:/g) || []).length, rows, 'one fly-to button per mission row');
  p.L.show('comets');
  const c = p.box(), crows = (c.match(/<tr data-row=/g) || []).length;
  assert.ok(crows > 0);
  assert.equal((c.match(/<button class="fly" data-fly="row:/g) || []).length, crows, 'one per comet row');
});

test('lists: on a phone a picked row closes the list first, so the card it opens is not hidden under it', () => {
  const phone = lists({ width: 400 });
  phone.L.show('missions');
  phone.click(inRow({ key: 'craft:' + SPACECRAFT[0].name }));
  assert.equal(phone.flights.length, 1);
  assert.equal(phone.flights[0].listOpen, 'none', 'closed before the flight (and its card)');
  const desk = lists({ width: 1280 });
  desk.L.show('missions');
  desk.click(inRow({ key: 'craft:' + SPACECRAFT[0].name }));
  assert.equal(desk.flights[0].listOpen, 'block', 'a desktop keeps the list open beside the card');
});

test('lists: the comet notes say which SBDB copy they come from', () => {
  assert.match(SB.made, /^\d{4}-\d{2}-\d{2}$/, 'small_bodies.json says when it was made');
  const p = lists(); p.L.show('comets');
  assert.match(p.box(), new RegExp(`JPL SBDB, copy of ${SB.made}`));
  const py = read('brand/tools/make_small_bodies.py');
  assert.match(py, /meta = \{"made": made_date\(\), "epoch_jd"/, 'build() writes it');
  assert.match(py, /meta = \{"made": made_date\(\), \*\*\{k: v for k, v in meta\.items\(\) if k != "made"\}\}/, 'and --comets-only refreshes it');
});

test('lists: a failed eclipse load shows the error with Try again, and does not fetch again every 2 s', async () => {
  let calls = 0;
  const ecl = { ready: false, failedAt: -Infinity, events: [], load() { calls++; return Promise.reject(new Error('offline')).catch(e => { ecl.failedAt = performance.now(); throw e; }); } };
  const p = lists({ eclipses: ecl });
  p.L.show('events');
  assert.match(p.box(), /Loading the Sun and the Moon/);
  await flush(); await flush();
  assert.match(p.box(), /did not load/); assert.match(p.box(), /data-retry="eclipses"/);
  for (let i = 0; i < 5; i++) p.tick();
  assert.equal(calls, 1, 'the 2 s refresh shows the error; it does not ask again');
  assert.match(p.box(), /Try again/);
  p.click({ closest: s => (s.startsWith('[data-jump]') ? { dataset: { retry: 'eclipses' } } : null) });
  assert.equal(calls, 2, 'Try again asks again');
});

test('lists: a late eclipse failure does not overwrite the list the reader moved on to', async () => {
  let fail;
  const ecl = { ready: false, failedAt: -Infinity, events: [], load: () => new Promise((_, rej) => { fail = () => { ecl.failedAt = performance.now(); rej(new Error('offline')); }; }) };
  const p = lists({ eclipses: ecl });
  p.L.show('events'); p.L.show('missions');
  const missions = p.box();
  fail(); await flush(); await flush();
  assert.equal(p.box(), missions, 'still the missions');
});

test('lists: missions that failed to load say so with Try again, not a bare table header', () => {
  world.layer('craft').failed = true;
  const asked = [];
  const p = lists({ craftRows: [], retry: id => { asked.push(id); return Promise.resolve(); } });
  p.L.show('missions');
  assert.match(p.box(), /The spacecraft data did not load/); assert.doesNotMatch(p.box(), /<table>/);
  p.click({ closest: s => (s.startsWith('[data-jump]') ? { dataset: { retry: 'craft' } } : null) });
  assert.deepEqual(asked, ['craft']);
  assert.match(p.box(), /Loading the spacecraft/, 'loading again');
  world.layer('craft').failed = false;
});

test('lists: Try again pressed from the keyboard leaves the focus on Close, not <body>, once its button is gone', () => {
  world.layer('craft').failed = true;
  const p = lists({ craftRows: [], retry: () => new Promise(() => {}) });
  p.L.show('missions');
  p.document.activeElement = { inside: '#listB', dataset: { retry: 'craft' } };
  p.click({ closest: s => (s.startsWith('[data-jump]') ? { dataset: { retry: 'craft' } } : null) });
  assert.match(p.box(), /Loading the spacecraft/);
  assert.equal(p.document.activeElement, p.el('#listX'), 'the Close button has the focus');
  world.layer('craft').failed = false;
});

test('lists: the 2 s refresh waits while a keyboard user is inside the list', () => {
  const p = lists(); p.L.show('missions');
  p.box(); p.els['#listB'].innerHTML = 'kept';
  p.document.activeElement = { inside: '#list', dataset: { fly: 'key:craft:Juno' } };
  p.document.documentElement.classList.contains = c => c === 'oo-kbd';
  p.tick();
  assert.equal(p.box(), 'kept', 'not redrawn under the keyboard focus');
  p.document.documentElement.classList.contains = () => false;
  p.tick();
  assert.notEqual(p.box(), 'kept', 'a mouse user (focus left on a clicked row) still sees the numbers move');
});

test('lists: an eclipse Jump on a phone closes the list too', () => {
  const e = { words: { key: 'eclipse:x' } }, jumps = [];
  const ecl = { ready: true, failedAt: -Infinity, events: [e], around: () => [], jump: () => jumps.push(document.querySelector('#list').style.display) };
  const p = lists({ width: 400, eclipses: ecl });
  p.L.show('events');
  p.click(onButton({ jump: 'eclipse:x' }));
  assert.deepEqual(jumps, ['none']);
});

// ---------------------------------------------------------------- search
function search() {
  const dom = fakeDom(), flights = [];
  const nav = { focusOn: b => flights.push(b.key) };
  createFind({ nav, story: { stopTour() {} }, small: { S: { named: [] } }, comets: { rows: [] }, exo: null, clock: { live: true, jd: JD, rate: 1 }, camera: {}, controls: {}, caption() {} });
  const q = dom.el('#q'), hits = dom.el('#hits');
  const type = v => { q.value = v; q.listeners.input(); };
  const key = k => q.listeners.keydown({ key: k, preventDefault() {} });
  const focus = () => q.listeners.focus();
  return { q, hits, type, key, focus, flights };
}
test('search: Enter in a one-letter or emptied box does not fly to a stale, hidden result', () => {
  const s = search();
  s.type('Mars'); assert.equal(s.hits.style.display, 'block');
  s.type('M'); s.key('Enter');
  assert.deepEqual(s.flights, [], 'the Mars hit was hidden: Enter does nothing');
  s.type('Mars'); s.key('Enter');
  assert.deepEqual(s.flights, ['mars']);
  assert.equal(s.q.value, '', 'the box empties after a pick');
  s.key('Enter');
  assert.deepEqual(s.flights, ['mars'], 'Enter in the emptied box does not repeat the flight');
  s.type('Mars'); s.key('Escape'); s.key('Enter');
  assert.deepEqual(s.flights, ['mars'], 'nor after Escape hid the list');
  assert.equal(s.hits.style.display, 'block', 'that Enter shows the results again');
  s.key('Enter');
  assert.deepEqual(s.flights, ['mars', 'mars'], 'and the next Enter flies');
});

test('search: back in a box that still says "Mars" after a tap outside, the results show again and Enter flies', () => {
  const s = search();
  s.type('Mars'); s.hits.style.display = 'none';   // the document click handler hid them
  s.focus();
  assert.equal(s.hits.style.display, 'block');
  s.key('Enter');
  assert.deepEqual(s.flights, ['mars']);
  s.type('M'); s.hits.style.display = 'none'; s.focus();
  assert.equal(s.hits.style.display, 'none', 'a one-letter box shows nothing');
});

// ---------------------------------------------------------------- Under the hood
test('under the hood: the 500 ms redraw keeps the Close button (and its keyboard focus)', async t => {
  const realFetch = globalThis.fetch; globalThis.fetch = () => Promise.reject(new Error('offline'));   // no network: the accuracy table says so
  t.after(() => { globalThis.fetch = realFetch; });
  const dom = fakeDom(); let assigned = 0;
  const made = [];
  dom.document.createElement = tag => {
    const e = { tagName: tag.toUpperCase(), children: [], attrs: {}, hidden: false, className: '', id: '', textContent: '',
      append(...xs) { this.children.push(...xs); }, setAttribute(k, v) { this.attrs[k] = v; } };
    let inner = '';
    Object.defineProperty(e, 'innerHTML', { get: () => inner, set: v => { inner = v; if (e.tagName === 'SECTION') assigned++; } });
    made.push(e); return e;
  };
  const nerd = createNerd({ renderer: { info: { render: { calls: 1, points: 0, triangles: 0 } }, getPixelRatio: () => 1 },
    quality: { gpu: 'test', LEVELS: { high: { name: 'High' } }, level: 'high', chosen: 'auto' }, small: { S: { files: [] } }, exo: { X: { data: null } }, moons: { count: 20 } });
  const section = made.find(e => e.tagName === 'SECTION'), close = section.children[0];
  assert.equal(close.tagName, 'BUTTON'); assert.equal(close.attrs['aria-label'], 'Close');
  nerd.toggle(); dom.intervals.at(-1)(); dom.intervals.at(-1)();
  assert.equal(section.children[0], close, 'the same Close button after redraws');
  assert.equal(assigned, 0, 'the panel itself is never rewritten');
  assert.match(section.children[1].innerHTML, /Under the hood/);
  await flush(); await flush();
  assert.match(section.children[1].innerHTML, /reference data unavailable/);
  assert.equal(section.children[0], close);
  nerd.toggle();
});

// ---------------------------------------------------------------- layer panel, stars, header clock (source: three.js modules)
test('layer panel: switching a layer updates its button in place (focus stays), with aria-pressed', () => {
  const ui = read('src/solar/ui.js'), start = ui.indexOf('  function renderLayers() {'), body = ui.slice(start, ui.indexOf('\n  }\n', start));
  assert.ok(start > 0);
  assert.doesNotMatch(body, /innerHTML|insertAdjacentHTML/, 'no rebuild by markup');
  assert.match(body, /if \(shape !== lyShape\)/, 'built again only when the set of buttons changes');
  assert.match(body, /aria-pressed/);
  assert.match(body, /\.focus\(\{ preventScroll: true \}\)/, 'and a rebuild gives the focus back');
});

test('stars: a failed load is tried again after a minute, never every frame, and never once the points exist', async () => {
  const src = read('src/solar/deepspace.js'), block = src.match(/  let starsAsked[\s\S]*?\n  };\n/)[0];
  const run = (outcome, points = null) => {
    const L = {}, calls = [], clock = { t: 0 };
    const needStars = Function('loadStars', 'layer', 'performance', 'starPoints', 'console', `${block}; return needStars;`)(
      () => { calls.push(clock.t); return outcome(); }, () => L, { now: () => clock.t }, points, { warn() {} });
    return { needStars, calls, clock, L };
  };
  const f = run(() => Promise.reject(new Error('offline')));
  f.needStars(); await flush();
  assert.equal(f.L.failed, true, 'the layer says so');
  f.clock.t = 30e3; f.needStars(); f.needStars();
  assert.deepEqual(f.calls, [0], 'not again within the minute (frame() calls it every frame)');
  f.clock.t = 61e3; f.needStars();
  assert.deepEqual(f.calls, [0, 61e3], 'tried again after it');
  const partial = run(() => Promise.reject(new Error('late')), {});
  partial.needStars(); await flush(); partial.clock.t = 120e3; partial.needStars();
  assert.deepEqual(partial.calls, [0], 'a failure after the points were made is not retried (the named stars would double)');
});

test('header clock: a phone keeps "UTC" (dropping the year while it is this year)', async () => {
  const { formatUtc } = await import('../src/core/time.js');
  const src = read('src/solar/ui.js'), fn = src.match(/const headerDate = (\([^\n]+);\n/)[1];
  const headerDate = Function('formatUtc', `return ${fn}`)(formatUtc);
  assert.equal(headerDate(2461331.5, true, 2026), '10-18 00:00 UTC');
  assert.equal(headerDate(2461331.5, false, 2026), '2026-10-18 00:00 UTC');
  assert.equal(headerDate(2451545.0, true, 2026), '2000-01-01 12:00 UTC', 'another year keeps its year');
  assert.match(src, /\$\('#tDate'\)\.textContent = headerDate\(clock\.jd, PHONE\)/);
});

// ---------------------------------------------------------------- the page
test('phone: a new details card closes the list and Under the hood, which share its place and draw over it', () => {
  const z = (sel, text) => +(text.match(new RegExp(`${sel}\\{[^}]*z-index:(\\d+)`)) || [])[1];
  assert.ok(z('#list', css) > z('#card', css) && z('#nerd', css) > z('#card', css), 'both draw over the card');
  assert.match(phoneCss, /#card\{left:10px;right:10px;width:auto;top:auto;bottom:86px/);
  assert.match(phoneCss, /#list\{left:10px;right:10px;width:auto;top:auto;bottom:86px/, 'in the same place');
  const ui = read('src/solar/ui.js'), start = ui.indexOf('  function showCard(b) {'), body = ui.slice(start, ui.indexOf('\n  }\n', start));
  const fresh = body.indexOf("$('#cardB').innerHTML"), same = body.indexOf('markTimeline(); return; }');
  const close = body.indexOf("$('#listX').click()"), nerd = body.indexOf("$('#nerd .x').click()");
  assert.ok(same > 0 && close > same && nerd > same && close < fresh && nerd < fresh, 'on a new card only (the 1 s refresh of the same card leaves an opened list alone)');
  assert.match(body, /if \(innerWidth <= 900\) \{/, "at the phone layout's width");
});

test('solar.html: the credits stay reachable on a phone (a menu button opens them as a sheet)', () => {
  assert.match(phoneCss, /#credits\{display:none\}/);
  assert.match(phoneCss, /#credits\.open\{display:block;/);
  assert.match(phoneCss, /\.btn\.show-s\{display:flex\}/);
  const dock = html.slice(html.indexOf('<div id="dock"'), html.indexOf('<div id="band"'));
  assert.match(dock, /<button class="btn show-s" id="bCredits" aria-controls="credits" aria-expanded="false">/);
  assert.match(html, /<div id="credits"><button class="x" id="creditsX" aria-label="Close the credits">/);
  for (const who of ['Solar System Scope', 'HYG', 'Phobos: ESA/DLR/FU Berlin']) assert.ok(html.slice(html.indexOf('<div id="credits"')).includes(who), who);
  const ui = read('src/solar/ui.js');
  assert.match(ui, /creditsBtn\.onclick = \(\) => showCredits/);
  assert.match(ui, /\$\('#creditsX'\)\.onclick = \(\) => \{ showCredits\(false\); \$\('#menuBtn'\)\.focus\(\); \}/, 'the X hands the focus to the menu button');
  assert.match(ui, /\$\('#menuBtn'\)\.onclick = \(\) => \{ if \(\$\('#dock'\)\.classList\.toggle\('open'\)\) showCredits\(false\); \}/, 'opening the menu closes the sheet');
  const card = ui.slice(ui.indexOf('function showCard'), ui.indexOf("$('#cardB').innerHTML"));
  assert.match(card, /if \(innerWidth <= 900\) \{[^}]*showCredits\(false\)/, 'a new card on a phone closes the sheet too');
});

test('solar.html: the description counts what the view really has', () => {
  const d = html.match(/<meta name="description" content="([^"]+)">/)[1];
  assert.doesNotMatch(d, /every planet, moon/);
  assert.ok(d.includes(`${json('data/solar/moons.json').moons.length} major moons`), d);
  assert.ok(d.includes(`${SPACECRAFT.length} spacecraft`), d);
});

// ---- the boot watchdog, in a fake page
const watchdog = html.match(/<script>(\/\* Boot watchdog[\s\S]*?)<\/script>/)[1];
class El {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.text = ''; this.listeners = {}; this.classes = new Set(); this.id = ''; }
  get textContent() { return this.text + this.children.map(c => typeof c === 'string' ? c : c.textContent).join(''); }
  set textContent(t) { this.text = String(t); this.children = []; }
  get classList() { return { add: c => this.classes.add(c), contains: c => this.classes.has(c) }; }
  append(...xs) { for (const x of xs) { if (typeof x !== 'string') x.parentNode = this; this.children.push(x); } }
  addEventListener(type, fn) { this.listeners[type] = fn; }
}
function page({ booted = false, search = '', protocol = 'https:' } = {}) {
  const load = new El('div'), box = new El('div'), msg = new El('span');
  load.id = 'load'; msg.id = 'loadMsg'; msg.textContent = 'loading the planets…'; box.append(msg); load.append(box);
  const timers = [], listeners = [];
  const byId = id => id === 'load' ? load : id === 'loadMsg' ? msg : box.children.find(c => typeof c !== 'string' && c.id === id) || null;
  const win = {
    location: { protocol, search, href: 'https://example.org/solar.html#f=craft:Juno', reload() { win.reloaded = true; } },
    document: { getElementById: byId, createElement: tag => new El(tag) },
    URLSearchParams, setTimeout: (fn, ms) => timers.push({ fn, ms }), addEventListener: (type, fn, capture) => listeners.push({ type, fn, capture }),
    ErrorEvent: class ErrorEvent { constructor(o) { Object.assign(this, o); } },
  };
  win.window = win;
  if (booted) win.OOSS = {};
  vm.runInNewContext(watchdog, win);
  const run = (max = Infinity) => { for (const t of timers.splice(0)) if (t.ms <= max) t.fn(); };
  const fire = e => listeners.filter(l => l.type === 'error').forEach(l => l.fn(e));
  const links = () => (byId('loadLinks')?.children || []).filter(c => typeof c !== 'string');
  return { win, load, msg, timers, listeners, run, fire, links };
}

test('boot watchdog: a healthy start is never touched, however slow', () => {
  const p = page({ booted: true });
  assert.ok(p.listeners.some(l => l.type === 'error' && l.capture), 'listens in the capture phase (script load errors do not bubble)');
  assert.ok(p.timers.some(t => t.ms === 15000), 'a 15 s timer');
  p.fire({ target: { tagName: 'SCRIPT' } }); p.run();
  assert.equal(p.msg.textContent, 'loading the planets…');
  assert.ok(!p.load.classList.contains('fail'));
});

test('boot watchdog: a blocked CDN says so, with Reload, the 3D globe and Home', () => {
  const p = page();
  p.fire({ target: { tagName: 'SCRIPT', src: 'https://example.org/src/solar/main.js' } });
  p.run(5000);
  assert.match(p.msg.textContent, /could not load \(network or a blocker\)\. Its 3D engine comes from cdn\.jsdelivr\.net/);
  assert.ok(p.load.classList.contains('fail'));
  const [reload, globe, home] = p.links();
  assert.deepEqual([reload.textContent, globe.textContent, home.textContent], ['Reload', '3D globe', 'Home']);
  assert.equal(globe.href, 'globe.html'); assert.equal(home.href, 'index.html');
  let prevented = false; reload.listeners.click({ preventDefault: () => { prevented = true; } });
  assert.ok(prevented && p.win.reloaded, 'Reload reloads (a link to the same #hash would not)');
  p.run(); assert.equal(p.links().length, 3, 'shown twice, the links are not doubled');
});

test('boot watchdog: slow, thrown, and what it ignores', () => {
  const slow = page(); slow.run();
  assert.match(slow.msg.textContent, /taking much longer/);
  const thrown = page();
  thrown.fire(new thrown.win.ErrorEvent({ filename: 'https://example.org/src/solar/planets.js' })); thrown.run(5000);
  assert.match(thrown.msg.textContent, /could not start/);
  const quiet = page();
  quiet.fire(new quiet.win.ErrorEvent({ filename: 'chrome-extension://abc/content.js' })); quiet.fire({ target: { tagName: 'IMG' } });
  quiet.fire(new quiet.win.ErrorEvent({ filename: 'https://example.org/src/app/shell.js' }));
  quiet.fire({ target: { tagName: 'SCRIPT', src: 'https://example.org/src/app/shell.js' } });
  assert.equal(quiet.timers.length, 1, 'an extension, an image or the shell (thrown or failed to load) is not the view failing');
  const embed = page({ search: '?embed=1' });
  assert.equal(embed.timers.length + embed.listeners.length, 0, 'inside the globe it does nothing (the globe has its own)');
  const file = page({ protocol: 'file:' }); file.run();
  assert.equal(file.msg.textContent, 'loading the planets…');
  assert.doesNotMatch(watchdog, /innerHTML|insertAdjacentHTML|document\.write/, 'text and links only');
});

test('boot watchdog: it runs before the module script, so it hears that script fail', () => {
  assert.ok(html.indexOf('Boot watchdog') > 0 && html.indexOf('Boot watchdog') < html.indexOf('<script type="module" src="src/solar/main.js">'));
});

test('another solar system: the caption counts both habitable zones, as the card does (core/habitable.js zoneWords)', async () => {
  const { zoneCounts, zoneWords } = await import('../src/core/habitable.js');
  const ui = read('src/solar/ui.js');
  assert.match(ui, /const n = s\.pl\.length, z = zoneCounts\(s\), zw = zoneWords\(s\)\.slice\(String\(n\)\.length\);/);
  assert.doesNotMatch(ui, /s\.pl\.filter\(p => p\[11\]\)|\(green band\)/, 'not the conservative in_HZ flags alone');
  const tpl = ui.match(/caption\(nm \+ ': another solar system', (`[^\n]*?`), 'From the NASA Exoplanet Archive\.'\)/)[1];
  const list = json('data/solar/exoplanets.json').list;
  const say = host => { const s = list.find(x => x.host === host), n = s.pl.length;
    return new Function('n', 'z', 'zw', 's', `return ${tpl};`)(n, zoneCounts(s), zoneWords(s).slice(String(n).length), s); };
  assert.match(say('K2-18'), /^2 known planets \(1 in the optimistic zone\), 124 light-years from us\. The green bands are its habitable zones \(the fainter one is the optimistic zone\)\. They move/);
  assert.match(say("Teegarden's Star"), /^3 known planets \(1 in the habitable zone, 1 more in the optimistic zone\), 12 light-years/);
  assert.match(say('51 Peg'), /^1 known planet, \d+ light-years from us\. They move/);
});
