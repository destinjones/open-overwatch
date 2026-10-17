// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The Tonight card (src/globe/tonight.js, tonight.html) for keyboard and screen-reader users, and its "look up now"
// nudges in a tab left open. The nudges run for real: tonight.js is loaded with a few browser names stubbed, SGP4 is
// the vendored copy (src/vendor/satellite.min.js), the stations are test/fixtures/stations.tle and the clock is mocked.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { parseTle } from '../src/core/tle.js';
import { observer, sunEcef } from '../src/core/observer.js';
import { findPasses, ecfAt } from '../src/core/passes.js';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const src = read('src/globe/tonight.js'), html = read('tonight.html');

test('tonight.html: the card is not a live region, the toasts are a status line, the fold toggle has its own style', () => {
  const card = html.match(/<section id="card"[^>]*>/)[0];
  assert.doesNotMatch(card, /aria-live/, 'every redraw of the whole card would be read aloud');
  assert.match(card, /role="region" aria-label="Tonight above you"/);
  assert.match(html, /<div id="toast" class="glass" role="status"><\/div>/);
  assert.match(html, /#card \.foldbtn\{all:unset;[^}]*\}/);
  assert.match(html, /#card \.foldbtn:focus-visible\{outline:/, 'all:unset must not take the focus ring away');
});

test('tonight.js: headings stay headings, a redraw keeps focus, the summary and the pass reminder are announced', () => {
  assert.doesNotMatch(src, /setAttribute\('role', 'button'\)/, 'no role=button on an <h3>');
  assert.doesNotMatch(src, /h\.tabIndex = 0/);
  assert.match(src, /b\.type = 'button'; b\.className = 'foldbtn'; b\.dataset\.fold = name; b\.setAttribute\('aria-controls'/);
  assert.match(src, /b\.setAttribute\('aria-expanded', String\(!shut\)\)/);
  // card(): the focused control's key before the rewrite, the same control focused after it; an unchanged card is left alone
  const card = src.slice(src.indexOf('function card('), src.indexOf('// sections fold'));
  assert.ok(card.indexOf('focusKey(c)') < card.indexOf('c.innerHTML =') && card.indexOf('c.innerHTML =') < card.indexOf('refocus(c, f)'), card);
  assert.match(card, /if \(reuse && drawn && drawn\.html === html/);
  assert.match(src, /focus\(\{ preventScroll: true \}\)/);
  for (const k of ['fold', 'gear', 'rem', 'cal', 'dso', 'met', 'lch']) assert.match(src, new RegExp(`FOCUS_KEYS = \\[[^\\]]*'${k}'`), k);
  assert.match(src, /if \(S\.say && !S\.computing\) \{ S\.say = false; announce\(S\.summary\); \}/);
  assert.match(src, /S\.say = true; render\(true\);/);
  // a newly saved place re-arms the nudges; forgetting it stops them
  assert.match(src, /if \(NUDGE\.on && !samePlace\(was, h\)\) Tonight\.armNudges\(\)/);
  assert.match(src, /forget: \(\) => \{[^\n]*clearNudges\(\); \}/);
});

// ---- the nudges, run ----
const HOUR = 3600e3, T0 = Date.UTC(2026, 9, 1, 12);   // the fixture's epochs are 2026-10-01
vm.runInThisContext(read('src/vendor/satellite.min.js'));   // window.satellite, in this realm (it checks instanceof Date)
const sl = globalThis.satellite;
const stations = parseTle(read('test/fixtures/stations.tle'));
const iss = stations.find(s => s.id === '25544'), issRec = sl.twoline2satrec(iss.l1, iss.l2);
const good = (lat, lon, t0, t1) => findPasses(ecfAt(sl, issRec), observer(lat, lon), t0, t1, { step: 30e3, sunAt: sunEcef }).filter(q => q.visible && q.maxEl >= 20);

/** A place whose next visible ISS pass (at least 20 degrees high) rises 13 to 23 hours after T0: past the first 12-hour
 *  search, so only a tab that re-arms its nudges says it. */
function placeWithLatePass() {
  for (let lat = -50; lat <= 60; lat += 5) for (let lon = -180; lon < 180; lon += 15) {
    const first = good(lat, lon, T0, T0 + 30 * HOUR)[0];
    if (first && first.rise > T0 + 13 * HOUR && first.rise < T0 + 23 * HOUR) return { lat, lon, pass: first };
  }
  return null;
}

test('the "look up now" nudges: re-armed every 6 h, said once and urgently, stopped when the place is forgotten', async () => {
  const at = placeWithLatePass();
  assert.ok(at, 'the fixture has a place whose next visible ISS pass is 13 to 23 hours away');
  // the few browser names tonight.js and its imports touch
  const mem = new Map(), said = [], toastEl = { textContent: '', aria: [], classList: { add() {}, remove() {} }, setAttribute(k, v) { this.aria.push([k, v]); }, removeAttribute(k) { this.aria.push([k, null]); } };
  Object.assign(globalThis, {
    window: globalThis, location: new URL('http://localhost:8787/tonight.html'), matchMedia: () => ({ matches: false, addEventListener() {} }),
    localStorage: { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) },
    document: { querySelector: s => (s === '#toast' ? toastEl : null), querySelectorAll: () => [], addEventListener() {}, createElement: () => ({ style: {} }), documentElement: { classList: { add() {}, remove() {} } } },
    addEventListener() {}, requestIdleCallback: f => f(), OOApp: { announce: (t, o) => said.push({ t, o, at: Date.now() }) },
  });
  mem.set('oo3d.home', JSON.stringify({ lat: at.lat, lon: at.lon }));
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: T0 });
  try {
    const { Tonight } = await import('../src/globe/tonight.js');
    const byId = new Map(), list = [];
    for (const t of stations) { const s = { kind: 'sat', ...t, layer: 'stations' }; list.push(s); byId.set(t.id, s); }
    Tonight.use({ sats: { list, byId } });
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    const run = async ms => { for (let t = 0; t < ms; t += 60e3) { mock.timers.tick(Math.min(60e3, ms - t)); await flush(); } };   // a minute at a time, so a re-arm's async work lands before its timers are due
    const nudges = () => said.filter(x => /^The ISS is rising/.test(x.t));
    const near = (ms, x) => Math.abs(x.at - (ms - 60e3)) < 5 * 60e3;

    await Tonight.peek(); await flush();
    await Tonight.armNudges();   // armed twice: the first call's timers are cleared, not doubled
    await run(at.pass.rise - T0 - 60e3);
    assert.equal(nudges().length, 1, 'the pass 13+ hours after the page opened is nudged (the tab used to go quiet after 12 h)');
    assert.ok(near(at.pass.rise, nudges()[0]), 'a minute before it rises');
    assert.deepEqual(nudges()[0].o, { urgent: true });
    assert.deepEqual(toastEl.aria[0], ['aria-hidden', 'true'], 'the toast is hidden from screen readers while it repeats the words');
    assert.match(toastEl.textContent, /^The ISS is rising/, '...and still on screen');

    // re-armed just after the nudge, and again with the pass under way (a search from now starts it now): not said again
    await Tonight.armNudges(); await run(2 * 60e3);
    await Tonight.armNudges(); await run(10 * 60e3);
    assert.equal(nudges().length, 1, 'a pass already nudged is not nudged again');

    // forgetting the place stops what is armed
    mem.delete('oo3d.home');
    assert.equal(await Tonight.armNudges(), null);
    const before = nudges().length;
    await run(24 * HOUR);
    assert.equal(nudges().length, before, 'no place, no nudges');
  } finally { mock.timers.reset(); }
});
