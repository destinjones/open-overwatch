// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The 2D map on phones and for keyboards (src/map/, open-overwatch.html), checked in the source because these modules need
// Leaflet and a DOM (the behaviour itself is in e2e/phone.spec.mjs and e2e/mapmodal.spec.mjs): the plate-reader tap, the
// sheets, the live cards, the modal splash and welcome, the touch sizes, and no IP-location lookup.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const page = read('open-overwatch.html'), engine = read('src/map/engine.js'), detail = read('src/map/detail.js'), brief = read('src/map/brief.js');
const presets = read('src/map/presets.js'), main = read('src/map/main.js'), setup = read('src/map/setup.js'), aircraft = read('src/map/aircraft.js');
/** The body of the first `@media (…)` block in css whose query matches q. */
function media(css, q) {
  const out = []; let i = 0;
  for (;;) {
    const at = css.indexOf('@media', i); if (at < 0) return out.join('\n');
    const open = css.indexOf('{', at), query = css.slice(at + 6, open); let depth = 1, j = open + 1;
    while (depth && j < css.length) { if (css[j] === '{') depth++; else if (css[j] === '}') depth--; j++; }
    if (q.test(query)) out.push(css.slice(open + 1, j - 1)); i = j;
  }
}

test('no IP-location lookup anywhere in the site code: a failed fix asks the visitor to pick a place', () => {
  const dirs = ['src/map', 'src/globe', 'src/app', 'src/core', 'src/solar'];
  for (const d of dirs) for (const f of readdirSync(new URL('../' + d + '/', import.meta.url)).filter(x => /\.(js|css)$/.test(x)))
    assert.doesNotMatch(read(`${d}/${f}`), /ipapi|ipinfo\.io|ip-api\.com|geoip/i, `${d}/${f}`);
  for (const f of ['open-overwatch.html', 'globe.html', 'index.html', 'tonight.html']) assert.doesNotMatch(read(f), /ipapi\.co/, f);
  assert.match(presets, /keptPlace\(Store\.get\('pos', null\)\); if \(!kept\) Store\.del\('pos'\)/, 'an old or IP-derived kept position is removed at load');
  assert.match(presets, /makePlace\(lat, lon, how\)/, 'kept rounded (core/myplace.js)');
  assert.match(presets, /this\.picking = true; toast\(`No location: \$\{e\.message\}\. Tap the map/, 'the failure asks for a tap');
  assert.match(detail, /late\.Locate && late\.Locate\.pick\(e\.latlng\.lat, e\.latlng\.lng\)/, 'the next map tap is taken as the place');
  assert.match(setup, /id="keysForgetPlace"[^]*\$\('#keysForgetPlace'\)\.addEventListener\('click', \(\) => Locate\.forget\(\)\)/, 'Setup has Forget my location');
  assert.match(setup, /id="pbHere"/, 'the probe can set the place');
});

test('plate-reader dots (no kind, no card) are not tap targets, and nothing selects every card-less dot', () => {
  assert.match(engine, /if \(it\.kind && it\.obj != null\) hits\.push\(\{ x: p\.x, y: p\.y, r: Math\.max\(r, 3\)/);
  assert.match(engine, /\(Sel\.obj != null && Sel\.obj === it\.obj\)/);
  assert.doesNotMatch(engine, /!it\.noSel && \(Sel\.obj === it\.obj/);
  assert.match(detail, /show\(kind, obj, id\) \{ if \(!kind \|\| obj == null\) return;/);
});

test('phone sheets: centring and following aim above the open sheet; a resize keeps the sheet open', () => {
  assert.match(detail, /export function sheetAware\(latlng, z = map\.getZoom\(\)\)/);
  assert.match(detail, /window\.flyTo = [^\n]*sheetAware\(/, 'Center, search and alerts');
  assert.match(aircraft, /map\.panTo\(sheetAware\(airAt\(a\)\)/, 'Follow');
  assert.match(presets, /map\.panTo\(sheetAware\(\[iss\.lat, iss\.lon\]\)/, 'Follow ISS');
  assert.match(detail, /openSheet\('panel'\); this\.reveal\(obj\);/, 'a tapped selection under the sheet is panned into view');
  assert.doesNotMatch(detail, /addEventListener\('resize', debounce\(applyLayoutMode/, 'not on every resize (rotation, keyboard)');
  assert.match(detail, /PHONE\.addEventListener\('change', applyLayoutMode\)/);
});

test('live cards: no rebuild mid-press or while the Intel sheet is down; one render when it comes up', () => {
  assert.match(detail, /if \(this\.el\.matches\(':active'\)\) \{ clearTimeout\(this\.retry\); this\.retry = setTimeout/);
  assert.match(detail, /if \(html !== this\.html \|\| !this\.el\.querySelector\('\.backlink'\)\)/, 'unchanged cards keep their nodes');
  for (const [name, src] of [['detail', detail], ['brief', brief]]) assert.match(src, /if \(\$\('#panel'\)\.classList\.contains\('hidden'\)\) return;/, name);
  assert.match(detail, /if \(which === 'panel' && was\) \{ if \(\$\('#tab-detail'\)\.classList\.contains\('on'\)\) Detail\.render\(\); else if [^\n]*late\.Brief\.render\(\)/);
});

test('phones: no backdrop blur on the sheets or the forecast bar, finger-sized controls, no text under 12 px', () => {
  const phone = media(page, /max-width:900px/), coarse = media(page, /pointer:coarse/);
  for (const css of [phone, coarse]) assert.match(css, /#rail,#panel\{backdrop-filter:none;-webkit-backdrop-filter:none;background:var\(--panel-solid\)\}/);
  const wx = media(read('src/map/weather.css'), /max-width: 900px\), \(pointer: coarse/);
  assert.match(wx, /\.wxbar \{ backdrop-filter: none;/); assert.match(wx, /\.wx-btn \{ width: 44px; height: 44px; \}/);
  const touch = media(page, /max-width:900px\),\(pointer:coarse/);
  assert.match(touch, /\.btn\.small\{min-height:44px/); assert.match(touch, /\.pill,\.tchip\{min-height:40px;min-width:40px/);
  assert.match(touch, /\.leaflet-touch \.leaflet-bar a\{width:44px;height:44px/);
  assert.match(touch, /\.chip span,\.layer \.name small,\.layer \.st,\.kv dt\{font-size:12px\}/);
});

test('the splash and the welcome card are modal for keyboards and screen readers', () => {
  assert.match(brief, /role="dialog" aria-modal="true" aria-labelledby="wt"/);
  assert.match(brief, /<button type="button" id="wSkip">Just show the map<\/button>/, 'a real button (Space works)');
  assert.doesNotMatch(brief, /<a id="wSkip"/);
  assert.match(brief, /const BEHIND = \['#top', '#rail', '#mapwrap', '#panel', '#mobilebar', '#hovertip'\]/);
  assert.match(brief, /b\.inert = true/); assert.match(brief, /b\.inert = false/);
  assert.match(brief, /first\.focus\(\{ preventScroll: true \}\)/, 'the first view has the focus');
  assert.match(brief, /e\.key !== 'Tab'/, 'Tab is kept inside the card');
  assert.match(main, /\$\('#app'\)\.inert = true; \$\('#enterSilent'\)\.focus\(/, 'the splash holds the focus, the app is inert');
  assert.match(main, /el\.inert = true; \$\('#app'\)\.inert = false;/, 'closing hands the app back');
});

test('the map page says what to do when opened as a file, and the heading line stays short over 180°', () => {
  assert.match(page, /if \(location\.protocol === 'file:'\) \{ document\.querySelector\('#boot'\)\.innerHTML = '[^']*needs the local helper/);
  assert.match(aircraft, /while \(ahead\[1\] - a\.lon > 180\) ahead\[1\] -= 360; while \(ahead\[1\] - a\.lon < -180\) ahead\[1\] \+= 360;/);
  assert.match(read('src/map/osmlayers.js'), /Net\.json\(url, \{ timeout: 20000, cache: 'default' \}\)/, 'TileJSON specs may come from the HTTP cache');
  assert.match(setup, /aisstream\.io does not permit direct browser connections, and a key typed here is visible to this page/);
});
