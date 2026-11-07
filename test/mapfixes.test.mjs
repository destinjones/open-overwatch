// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// 2D map behaviour that lives in page modules (src/map needs Leaflet and a page): the pieces with logic are lifted out of
// the source text and run here; the wiring is checked as text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { alprTileZoom, milTileZoom } from '../src/core/osmtiles.js';
import { bustNow, bustUrl, stillRefresh } from '../src/core/cameras.js';

const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const MAP = f => read('src/map/' + f);
/** The text of `name(...) { ... }` from a module's source, braces matched. */
function block(text, start) {
  const i = text.indexOf(start); assert.ok(i >= 0, 'not found: ' + start);
  let depth = 0, j = text.indexOf('{', i);
  for (; j < text.length; j++) { if (text[j] === '{') depth++; else if (text[j] === '}' && --depth === 0) break; }
  return text.slice(i, j + 1);
}
const later = () => { let ok, no; const p = new Promise((a, b) => { ok = a; no = b; }); return { p, ok, no }; };
const tick = () => new Promise(r => setTimeout(r, 0));

test('tile zooms are whole at the half levels the map rests on (zoomSnap 0.5)', () => {
  for (let z = 3; z <= 19; z += 0.5) {
    assert.ok(Number.isInteger(alprTileZoom(z)), `plate readers at ${z}`);
    assert.ok(Number.isInteger(milTileZoom(z)), `military areas at ${z}`);
  }
  assert.equal(alprTileZoom(6.5), 3); assert.equal(alprTileZoom(9.5), 6); assert.equal(alprTileZoom(10), 9); assert.equal(alprTileZoom(11.5), 9); assert.equal(alprTileZoom(13.5), 11); assert.equal(alprTileZoom(16), 12);
  assert.equal(milTileZoom(8), 9); assert.equal(milTileZoom(11.5), 9); assert.equal(milTileZoom(13.5), 11); assert.equal(milTileZoom(18), 12);
  const src = MAP('osmlayers.js');
  assert.match(src, /tz = alprTileZoom\(zm\)/); assert.match(src, /tz = milTileZoom\(map\.getZoom\(\)\)/);
});

test('camera refresh: each kind of still has its own way, and NYC keeps the one address the relay takes', () => {
  assert.equal(stillRefresh({ fresh: true }, false), 'list');
  assert.equal(stillRefresh({ relayImage: true }, true), 'fetch');
  assert.equal(stillRefresh({ relayImage: true }, false), 'bust', 'NYC direct: no relay to refuse the query');
  assert.equal(stillRefresh({}, false), 'bust');
  assert.equal(bustNow('https://a/b.jpg', 5), 'https://a/b.jpg?t=5');
  assert.equal(bustNow('https://a/b.jpg?x=1', 5), 'https://a/b.jpg?x=1&t=5');
  assert.notEqual(bustNow('https://a/b.jpg', 1), bustNow('https://a/b.jpg', 2), 'two presses in the same minute differ');
  assert.equal(bustUrl('https://a/n', { net: 'nyc' }), 'https://a/n', 'relay refuses t= for NYC');
});

test('a relayed still asks in CORS mode (the relay refuses a request with no Origin), a direct one does not', () => {
  const src = MAP('feeds.js');
  assert.match(src, /co = relayed \? ' crossorigin="anonymous"' : ''/);
  assert.match(src, /class="camstill" src="[^"]+" alt="[^"]+" referrerpolicy="no-referrer"\$\{co\}>/);
  assert.match(src, /const w = c\.relayImage \? Relay\.wrap\(c\.image\) : null; return \{ img: w \|\| c\.image, relayed: !!w \}/);
  assert.ok(!/data-do="rerender"/.test(src) && !/rerender/.test(MAP('main.js')), 'no refresh link that re-renders the same address');
});

test('areas on the map: the click reaches the map, a glyph beats the area, the measure tool beats both', () => {
  for (const f of ['feeds.js', 'osmlayers.js']) assert.ok(!/bubblingMouseEvents/.test(MAP(f)), f + ' swallows no clicks');
  const feeds = MAP('feeds.js');
  assert.equal((feeds.match(/Detail\.area\(\(\) => Detail\.show\('nws', p, p\.id\)\)/g) || []).length, 2);
  assert.match(MAP('osmlayers.js'), /poly\.on\('click', Detail\.area\(\(\) => Detail\.show\('milarea', a, a\.id\)\)\)/);
  const click = block(MAP('detail.js'), "map.on('click', e =>");
  const at = s => { const i = click.indexOf(s); assert.ok(i >= 0, s); return i; };
  assert.ok(at('Measure.armed') < at('glyphs.hitTest') && at('glyphs.hitTest') < at('ooArea') && at('ooArea') < at('cableHit') && at('cableHit') < at('Probe.open'));
});

test('measure: every shape on the one canvas that gets the clicks; a canvas shape lets the click through while a tool is armed', () => {
  const src = MAP('measure.js');
  for (const m of src.matchAll(/L\.(polyline|polygon|circleMarker)\(/g)) {
    const line = src.slice(m.index, src.indexOf('\n', m.index));
    assert.match(line, /renderer: vecRenderer/, line.slice(0, 60));
  }
  const add = block(src, 'const add = l =>');
  assert.ok(!/stopPropagation\(e\);\s*if \(!Measure\.tool\)/.test(add), 'an armed click must reach the map');
  assert.match(add, /if \(Measure\.tool\) \{[^\n]*return; \}/);
  assert.match(src, /Measure\.cur === sh && i === 0 && sh\.kind === 'area' && c\.length >= 3\) \{ L\.DomEvent\.stopPropagation\(e\); Measure\.finish\(\)/, 'the first corner still closes');
});

// ---- Wx.load: the race (src/map/weather.js)
function wx(momentOf) {
  const code = block(MAP('weather.js'), '  load() {');
  const o = new Function('momentOf', `return ({${code}});`)(momentOf);
  return Object.assign(o, { key: '', loading: null, cur: null, cmp: null, model: { id: 'gfs', def: { short: 'GFS' } }, other: null, compare: false, on: ['wind'], charts: new Map(),
    advance() {}, checkRun() {}, t: () => 100, kinds() { return this.on; }, repaint() {} });
}
const feedSees = async (w, kind) => { const c = await w.load(); if (!c) return 'quiet'; if (!c.a[kind]) throw new Error('no ' + kind); return 'ok'; };

test('Wx.load: a load overtaken by a newer one answers with the newer one, not with nothing', async () => {
  const fields = { wind: later(), temp: later() };
  const w = wx(async (m, t, kinds) => { const a = {}; for (const k of kinds) a[k] = await fields[k].p; return { a, model: m }; });
  const first = feedSees(w, 'wind'); w.on = ['wind', 'temp']; const second = feedSees(w, 'temp');
  fields.wind.ok(1); await tick(); await tick();
  fields.temp.ok(2);
  assert.equal(await first, 'ok', 'wind, on first use, is not reported missing');
  assert.equal(await second, 'ok');
  assert.ok(w.cur.a.wind && w.cur.a.temp);
});

test('Wx.load: a load whose key was dropped with no newer load ends quietly (no self-resolving promise, no false error)', async () => {
  const f = later();
  const w = wx(async () => { await f.p; return { a: { wind: 1 } }; });
  const run = feedSees(w, 'wind');
  w.key = '';   // setModel, setCompare, a newer run, the last layer off: the feeds are run again by whoever did it
  f.ok();
  assert.equal(await run, 'quiet');
});

test('Wx.load: a real failure still says so, and the next try fetches again', async () => {
  const w = wx(async () => null);
  await assert.rejects(w.load(), /GFS is not reachable/);
  await tick();
  assert.equal(w.key, '');
});

test('the forecast feed reads a dropped load as nothing to say, and missing data as an error', () => {
  const src = MAP('weather.js');
  assert.match(src, /if \(!c\) return;[^\n]*\n\s*if \(!c\.a\[kind\]\) throw new Error/);
});

// ---- Sats.syncTrack: the ground track follows the selection (src/map/satellites.js)
function sats() {
  const src = MAP('satellites.js'), group = new Set();
  const Sel = { kind: null, id: null, obj: null }, Layers = { opt: () => true }, draws = [];
  const Tracks = { group: { hasLayer: l => group.has(l), removeLayer: l => group.delete(l) }, clear() { group.clear(); } };
  const S = new Function('Sel', 'Layers', 'Tracks', `return ({${block(src, '  syncTrack() {')},\n${block(src, '  clearTrack() {')}});`)(Sel, Layers, Tracks);
  S.drawTrack = o => { draws.push(o.id); S.trackAt = Date.now(); S.trackId = o.id; S.clearedId = null; if (S.trackLayer) group.delete(S.trackLayer); S.trackLayer = {}; group.add(S.trackLayer); };
  const pick = o => { Sel.kind = o ? 'sat' : 'air'; Sel.id = o ? o.id : 'abc'; Sel.obj = o; S.syncTrack(); };
  return { S, Sel, Layers, Tracks, draws, group, pick };
}

test('ground track: selecting another satellite redraws at once, and something else removes it', () => {
  const { S, draws, group, pick } = sats(), A = { id: 1 }, B = { id: 2 };
  pick(A); assert.deepEqual(draws, [1]);
  S.syncTrack(); assert.deepEqual(draws, [1], 'not again within 30 s');
  pick(B); assert.deepEqual(draws, [1, 2], 'B at once, not 30 s later');
  S.trackAt = Date.now() - 31000; S.syncTrack(); assert.deepEqual(draws, [1, 2, 2], 'the 30 s refresh stays');
  pick(null); assert.equal(group.size, 0, 'a card with no Clear track button leaves no track');
  pick(B); assert.equal(draws.at(-1), 2); assert.equal(group.size, 1);
});

test('ground track: Clear track stays cleared until another selection or the button; a track wiped elsewhere comes back', () => {
  const { S, Tracks, draws, group, pick } = sats(), A = { id: 1 }, B = { id: 2 };
  pick(A); S.clearTrack(); assert.equal(group.size, 0);
  S.trackAt = 0; S.syncTrack(); assert.deepEqual(draws, [1], 'stays cleared past the 30 s');
  pick(B); assert.deepEqual(draws, [1, 2]);
  pick(A); assert.deepEqual(draws, [1, 2, 1], 'cleared only until another was selected');
  S.clearTrack(); S.drawTrack(A); S.syncTrack(); assert.equal(group.size, 1, 'the Ground track button brings it back');
  Tracks.clear(); S.syncTrack(); assert.equal(group.size, 1, 'wiped by something else while selected: back on the next update');
});

test('ground track wiring: every selection and every position update sync it; the Locate marker is not in the track group', () => {
  assert.match(MAP('detail.js'), /Sel\.id = id \?\? obj\.id \?\? obj\.hex; late\.Sats\?\.syncTrack\(\);/);
  assert.match(MAP('satellites.js'), /requestDraw\(\);\n\s*this\.syncTrack\(\);/);
  assert.match(MAP('main.js'), /'clear-track': \(\) => Sats\.clearTrack\(\)/);
  const presets = MAP('presets.js');
  assert.ok(!/Tracks/.test(presets), 'presets.js adds nothing to Tracks');
  assert.match(block(presets, '  forget(quiet = false) {'), /map\.removeLayer\(this\.marker\)/, 'forgetting the place removes its marker');
});

test('fonts: the map page uses the size-matched fallbacks, so the splash does not jump when the fonts land', () => {
  const html = read('open-overwatch.html'), fonts = read('brand/fonts/fonts.css');
  for (const [v, f] of [['display', 'Big Shoulders Fallback'], ['body', 'Barlow Fallback'], ['mono', 'Plex Mono Fallback']]) {
    assert.ok(fonts.includes(`font-family: '${f}'`), f);
    assert.match(html, new RegExp(`--font-${v}:"[^"]+","${f}"`));
  }
});

test('skip link: out of the flow before shell.css arrives, and top is left to shell.css so :focus can reveal it', () => {
  const fn = block(read('src/app/a11y.js'), 'function skipLink(');
  assert.ok(fn.indexOf("a.style.position = 'fixed'") >= 0 && fn.indexOf("a.style.position = 'fixed'") < fn.indexOf('document.body.prepend(a)'));
  assert.ok(!/style\.top/.test(fn));
});

test('cameras: the show-regions button comes back after the pills, keeping its place in the tour', () => {
  const sub = block(MAP('feeds.js'), "export const lyCams = Layers.add({").slice(0, 2000);
  const m = sub.match(/const r = \(\) => \{ UI\.pills\(el,[\s\S]*?el\.appendChild\(b\); \};/);
  assert.ok(m, 'r() re-adds the button');
  assert.ok(sub.indexOf('let i = 0') < sub.indexOf('const r = '), 'i is kept outside r()');
});

test('area scan: switching the row back on restores its status and count, and a first scan with no feed yet does not throw', () => {
  const m = MAP('feeds.js').match(/lyScan\.enable = (\(\) => \{.*?\}\s*\}|\(\) => \{.*?\});/);
  assert.ok(m);
  const set = [], lyScan = { last: null, feed: undefined };
  const enable = new Function('lyScan', 'Points', `return ${m[1]};`)(lyScan, { set: (...a) => set.push(a) });
  enable(); assert.equal(set.length, 0);
  lyScan.last = [1, 2, 3]; enable(); assert.equal(set.length, 1, 'no feed yet');
  lyScan.feed = { status: 'idle', count: 0 }; enable(); assert.deepEqual(lyScan.feed, { status: 'ok', count: 3 });
});

test('all-aircraft sweep: a layer switched off stops the pass, keeps its aircraft out, and records nothing', () => {
  const src = MAP('aircraft.js'), pass = block(src, '  async pass() {');
  assert.match(pass, /if \(!lyAirLocal\.on \|\| this\.key !== key\) return;/);
  assert.match(pass, /await Air\.getFrom\(src, 'point', t\.lat, t\.lon, 250\); if \(!lyAirLocal\.on\) return; n \+= Air\.ingest/);
  const stop = pass.indexOf('if (!lyAirLocal.on) return n;');
  assert.ok(stop > pass.indexOf('await Promise.all(srcs.map(worker))') && stop < pass.indexOf('if (!done && errs.length)') && stop < pass.indexOf('this.passMs ='), 'before the error, the TTL and the description');
  assert.match(src, /await AirSweep\.pass\(\); if \(lyAirLocal\.on\) lyAirLocal\.feed\.count/);
});
