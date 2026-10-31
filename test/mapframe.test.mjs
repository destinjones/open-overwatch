// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The 2D map's frame budget (src/map/frame.js): the canvas's own Mercator placement, the colour and text-width caches,
// which feeds may start in a tick (hidden-tab rest, staggered boots) and the redraw cadence while the map moves. The
// wiring in engine.js / detail.js / util.js is checked as text (those modules need Leaflet and a page).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPlacer, createWidths, dueFeeds, hexA, mercator, moveRedrawGap } from '../src/map/frame.js';

const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b}`);
/** Leaflet 1.9's EPSG:3857 projection, written out as it does it (SphericalMercator + the 0.5/(πR) transformation). */
function leaflet(lat, lon, scale) {
  const R = 6378137, d = Math.PI / 180, max = 85.0511287798, s = Math.sin(Math.max(Math.min(max, lat), -max) * d);
  const x = R * lon * d, y = R * Math.log((1 + s) / (1 - s)) / 2, k = 0.5 / (Math.PI * R);
  return { x: scale * (k * x + 0.5), y: scale * (-k * y + 0.5) };
}

test('mercator: the same world pixels as Leaflet, at every zoom, clamped at the poles', () => {
  const out = { x: 0, y: 0 };
  for (const z of [2, 3.5, 7, 12, 18]) for (const [lat, lon] of [[0, 0], [51.5, -0.12], [-33.9, 151.2], [64.1, -21.9], [89.9, 179.9], [-90, -180]]) {
    const L = leaflet(lat, lon, 256 * 2 ** z); mercator(lat, lon, 256 * 2 ** z, out);
    near(out.x, L.x, 1e-6 * 2 ** z, `x ${lat},${lon} z${z}`); near(out.y, L.y, 1e-6 * 2 ** z, `y ${lat},${lon} z${z}`);
  }
  assert.deepEqual(mercator(0, 0, 256, out), { x: 128, y: 128 });
  near(mercator(85.0511287798, 0, 256, out).y, 0, 1e-6, 'the top edge'); near(mercator(90, 0, 256, out).y, 0, 1e-6, 'clamped');
});

test('createPlacer: container points of every on-screen copy; nothing for what is off screen or not a number', () => {
  const place = createPlacer(), P = place.pts;
  // zoom 2 (a 1024 px world) on a 1920 px wide screen whose left edge is world x 0: the date line shows twice
  place.frame(1024, 0, 0, 1920, 900);
  assert.equal(place(0, 179), 2, 'x≈1021, and the copy one world west at x≈-3 (inside the 30 px slack)');
  near(P[1].x, 1024 * (0.5 + 179 / 360), 1e-9); near(P[0].x, P[1].x - 1024, 1e-9);
  assert.equal(place(0, -179), 2, 'x≈3 and ≈1027');
  near(P[0].x, 1024 * (0.5 - 179 / 360), 1e-9);
  // a city view: one copy, where Leaflet puts it
  const z = 10, sc = 256 * 2 ** z, c = leaflet(48.85, 2.35, sc); place.frame(sc, c.x - 400, c.y - 300, 800, 600);
  assert.equal(place(48.85, 2.35), 1); near(P[0].x, 400, 1e-6); near(P[0].y, 300, 1e-6);
  assert.equal(place(48.85, 2.35 + 360), 1, 'a longitude off the ±180 range lands on the same spot'); near(P[0].x, 400, 1e-6);
  assert.equal(place(40, 2.35), 0, 'south of the screen'); assert.equal(place(48.85, 30), 0, 'east of it');
  const edge = leaflet(48.85, 2.35, sc); place.frame(sc, edge.x + 20, edge.y - 300, 800, 600);
  assert.equal(place(48.85, 2.35), 1, 'within the 30 px slack (a glyph half off the edge still draws)');
  place.frame(sc, edge.x + 40, edge.y - 300, 800, 600); assert.equal(place(48.85, 2.35), 0, 'beyond it');
  assert.equal(place(NaN, 2), 0); assert.equal(place(10, null), 0); assert.equal(place(undefined, 2), 0);
  // never more copies than it has room for, however small the world
  place.frame(64, 0, 0, 4000, 900); assert.equal(place(0, 0), P.length);
});

test('hexA: rgba text from #rgb and #rrggbb, the same string object for a repeat', () => {
  assert.equal(hexA('#7dffa6', .5), 'rgba(125,255,166,0.5)');
  assert.equal(hexA('#fff', 1), 'rgba(255,255,255,1)');
  assert.equal(hexA('ff4d5e', .35), 'rgba(255,77,94,0.35)', 'a missing # too');
  assert.equal(hexA('#5fd3ff', .8), hexA('#5fd3ff', .8));
  for (let i = 0; i < 5000; i++) hexA('#' + (i % 4096).toString(16).padStart(3, '0'), i / 5000);   // the cache empties itself rather than growing for ever
  assert.equal(hexA('#000000', 0), 'rgba(0,0,0,0)');
});

test('createWidths: measures a label once, then remembers it; bounded', () => {
  let calls = 0; const w = createWidths(t => { calls++; return t.length * 7; }, 3);
  assert.equal(w('BAW12 FL370'), 77); assert.equal(w('BAW12 FL370'), 77); assert.equal(calls, 1);
  w('a'); w('bb'); assert.equal(w.size(), 3); w('ccc'); assert.ok(w.size() <= 3, 'full: starts again');
  assert.equal(w('ccc'), 21); w.clear(); assert.equal(w.size(), 0);
});

test('dueFeeds: due ones oldest first and at most max; a hidden tab runs only the kept (alert) feeds, at a third of their cadence', () => {
  const now = 1e6, F = (id, nextAt, o = {}) => ({ id, nextAt, interval: 60, retry: 30, status: 'ok', running: false, layer: { on: true }, ...o });
  const list = [F('a', now - 10), F('b', now - 500), F('c', now + 10), F('d', now - 1, { running: true }), F('e', now - 1, { layer: { on: false } }), F('f', now - 300), F('g', now)];
  assert.deepEqual(dueFeeds(list, now).map(f => f.id), ['b', 'f', 'a', 'g'], 'not the future, the running or the switched-off');
  assert.deepEqual(dueFeeds(list, now, { max: 2 }).map(f => f.id), ['b', 'f'], 'a boot burst is spread: the rest wait a tick');
  const keep = f => f.id === 'q';
  assert.deepEqual(dueFeeds(list, now, { hidden: true, keep }).map(f => f.id), [], 'hidden: everything else rests');
  const q = F('q', now - 100e3), q2 = F('q', now - 100e3, { status: 'error' });
  assert.deepEqual(dueFeeds([q], now, { hidden: true, keep }), [], 'kept, but a 60 s feed waits 180 s hidden');
  assert.deepEqual(dueFeeds([F('q', now - 121e3)], now, { hidden: true, keep }).length, 1);
  assert.deepEqual(dueFeeds([q2], now, { hidden: true, keep }).length, 1, 'an erroring kept feed: three times its retry (90 s)');
  // the scheduler in engine.js uses it, with three starts a tick and the alert feeds kept
  const engine = read('src/map/engine.js');
  assert.match(engine, /dueFeeds\(Feeds\.list, Date\.now\(\), \{ hidden: document\.hidden, keep: keepHidden, max: 3 \}\)/);
  assert.match(engine, /KEEP_HIDDEN = new Set\(\['air_emg', 'quakes', 'nws'\]\)/);
});

test('moveRedrawGap: every frame while a draw is cheap, slower as it gets dear, never slower than 4 a second', () => {
  assert.equal(moveRedrawGap(0), 0); assert.equal(moveRedrawGap(undefined), 0); assert.equal(moveRedrawGap(3.9), 0);
  assert.equal(moveRedrawGap(10), 60); assert.equal(moveRedrawGap(100), 250);
  assert.ok(moveRedrawGap(8) < moveRedrawGap(20));
});

test('the canvas and its panels keep to the frame budget (engine.js, detail.js, util.js wiring)', () => {
  const engine = read('src/map/engine.js'), detail = read('src/map/detail.js'), util = read('src/map/util.js');
  const draw = engine.slice(engine.indexOf('  draw() {'), engine.indexOf('/* ---- what a glyph says on hover'));
  assert.doesNotMatch(draw, /latLngToContainerPoint|getBounds\(\)/, 'placed by frame.js createPlacer, not a LatLng per object per copy');
  assert.doesNotMatch(draw, /measureText\(text\)/, 'label widths come from the cache');
  assert.match(draw, /createWidths\(t => ctx\.measureText\(t\)\.width\)/);
  assert.doesNotMatch(draw, /ctx\.save\(\)|ctx\.restore\(\)/, 'rotated glyphs: one setTransform, no state stack');
  assert.doesNotMatch(draw, /tip: ms\.tip\(o\)|tip: `\$\{(s\.name|text|s\.id)|tip: `Radiosonde/, 'per-object tips are functions, built when hovered (only the few ship cluster bubbles build theirs)');
  assert.match(engine, /c\.style\.display = ''; this\._dpr = dpr; requestDraw\(\);/, 'moveend, zoomend and viewreset share one draw');
  assert.match(engine, /m\.on\('move', this\._moving, this\)/, 'glyphs follow a drag or a fly-to');
  assert.match(engine, /UI\.refreshLayer\(d\); requestDraw\(\); \},/, 'a layer switch draws in the next frame');
  assert.match(engine, /refreshGroups\(\) \{ if \(this\._grpQ\) return;/, 'group counts once a frame');
  assert.match(detail, /this\.el\.style\.transform = `translate3d\(/, 'the hover tip moves on the compositor');
  assert.match(detail, /if \(html !== this\.key\)/, 'and is measured only when its text changes');
  assert.match(util, /requestIdleCallback\(go, \{ timeout: 1500 \}\)/, 'log rows are built in idle batches');
  assert.match(util, /export \{ hexA \} from '\.\/frame\.js'/);
});

test('feed refreshes diff instead of rebuilding, and nothing encodes or parses in one long task', () => {
  const feeds = read('src/map/feeds.js'), sats = read('src/map/satellites.js'), engine = read('src/map/engine.js');
  assert.doesNotMatch(feeds, /gNws\.clearLayers\(\)/, 'NWS keeps the polygons of alerts that did not change');
  assert.match(feeds, /if \(!e \|\| e\.sent !== p\.sent \|\| !gNws\.hasLayer\(e\.g\)\)/);
  assert.match(feeds, /for \(const \[id, e\] of nwsPolys\) if \(!seen\.has\(id\)\) \{ gNws\.removeLayer\(e\.g\)/, 'and drops the expired ones');
  assert.doesNotMatch(feeds, /toDataURL\(/, 'the aurora image is encoded with toBlob, off the main thread');
  assert.match(feeds, /URL\.revokeObjectURL\(old\)/, 'and the last one is let go');
  assert.match(sats, /await sleep\(0\);[^\n]*\n\s*try \{ const txt = await this\.loadGroup\(g\)/, 'a task per satellite group');
  assert.match(engine, /now - gc\.t < 2000/, 'ship cluster bubbles are binned at most every 2 s');
});

test('the map page: transform/opacity motion on the shared tokens, reduced motion honoured, finger-sized controls', () => {
  const page = read('open-overwatch.html'), view = read('src/map/mapview.js');
  assert.match(page, /--ease:var\(--oo-ease-out,/, 'the shared token when it is defined');
  assert.match(page, /@keyframes sheetin\{from\{opacity:\.4;transform:translateY\(24px\)\}\}/);
  for (const k of [...page.matchAll(/@keyframes (\w+)\{([^}]*\{[^}]*\})*\}/g)]) assert.doesNotMatch(k[0], /\b(top|left|height|width|margin|padding)\s*:/, `${k[1]} animates layout`);
  assert.doesNotMatch(page.slice(0, page.indexOf('</style>')), /#rail,#panel\{width:var\(--rail-w\)[^}]*backdrop-filter/, 'no blur on the desktop rails');
  assert.match(page, /@media \(prefers-reduced-motion:reduce\)\{[^\n]*\n\s*#rail,#panel,\.tab\.on/, 'sheets, tabs and cards do not animate');
  assert.match(view, /REDUCED\.matches \? this\.setView\(c, z, \{ animate: false \}\)/, 'and the map jumps instead of flying');
  assert.match(page, /\.layer,\.group > summary,details\.setup > summary\{min-height:var\(--tap\)\}/);
  assert.match(page, /#mobilebar button\{[^}]*min-height:52px/);
  assert.match(page, /\.boot\{[^}]*min-height:154px\}/, 'the boot card has room for its seven lines from the start');
  assert.match(page, /\.layer \.st\{[^}]*min-width:44px/, 'a count arriving does not shift the row');
});
