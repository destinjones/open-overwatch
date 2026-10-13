// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Weather models at a moment (src/core/wxload.js), shared by the globe and the 2D map: which run is used, what is
// fetched for a moment and how hours are blended, the retries, and sampling a moment. The network and the decoding
// worker are fakes: what the model asks of them is checked as well as what it answers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODELS } from '../src/core/wxmodels.js';
import { runComplete, makeModel, makeModels, momentOf, momentValue, momentWind, momentReading } from '../src/core/wxload.js';

const H = 3600e3, NOW = Date.UTC(2026, 9, 13, 12, 0);   // 12:00 UTC: the newest GFS run tried is 06 UTC
const flat = (v, step = 1) => { const ni = 360 / step, nj = 180 / step + 1; return { grid: { ni, nj, la1: 90, lo1: 0, di: step, dj: step, scan: 0 }, values: new Float32Array(ni * nj).fill(v) }; };
const noSleep = () => Promise.resolve();

/** A pretend bucket: runs listed in `out` have every file; anything else is a 404 (or 503s first, `busy` times). */
function bucket(out, { busy = 0 } = {}) {
  const seen = [];
  const fetch = async (url, init) => {
    seen.push(url);
    if (busy > 0) { busy--; return { status: 503 }; }
    return { status: out.some(r => url.includes(r)) ? 206 : 404, body: { cancel() {} } };
  };
  return { fetch, seen };
}
/** A pretend worker: an inventory with every GFS field, and fields whose value is `fieldValue(key, url)`. */
function worker(fieldValue = () => 1, { fail = () => false } = {}) {
  const log = [];
  const ask = async msg => {
    log.push(msg);
    if (msg.keep) return {};
    if (msg.idx) {
      const names = [['UGRD', '10 m above ground'], ['VGRD', '10 m above ground'], ['TMP', '2 m above ground'], ['PRMSL', 'mean sea level'], ['GUST', 'surface']];
      return { rows: names.map(([variable, level], i) => ({ n: i + 1, start: i * 100, end: i * 100 + 99, variable, level, forecast: '6 hour fcst' })) };
    }
    if (fail(msg.url)) throw new Error('decode failed');
    const keys = { UGRD: 'u', VGRD: 'v', TMP: 'temp', PRMSL: 'pres', GUST: 'gust' };
    return { fields: msg.ranges.flatMap(r => r.fields.map(([v]) => keys[v])).map(key => ({ key, ...flat(fieldValue(key, msg.url)) })) };
  };
  return { ask, log };
}

test('runComplete: the last hour shown must exist; 503 Slow Down is tried again, a 404 is an answer', async () => {
  const c = { t: 0, date: '20261013', hour: '06' };
  const ok = bucket(['gfs.20261013/06/']);
  assert.equal(await runComplete(MODELS.gfs, c, 120, { fetch: ok.fetch, sleep: noSleep }), true);
  assert.match(ok.seen[0], /gfs\.t06z\.pgrb2\.1p00\.f120\.idx$/, 'asks for the inventory of hour 120');
  assert.equal(await runComplete(MODELS.gfs, c, 72, { fetch: bucket([]).fetch, sleep: noSleep }), false);
  const busy = bucket(['gfs.20261013/06/'], { busy: 3 });
  assert.equal(await runComplete(MODELS.gfs, c, 120, { fetch: busy.fetch, sleep: noSleep }), true);
  assert.equal(busy.seen.length, 4);
  const down = bucket([], { busy: 99 });
  assert.equal(await runComplete(MODELS.gfs, c, 120, { fetch: down.fetch, sleep: noSleep, tries: 5 }), false);
  assert.equal(down.seen.length, 5);
});

test('model: the newest run that reaches the last hour, and older caches dropped', async () => {
  const { fetch } = bucket(['gfs.20261013/00/']), w = worker();   // 06 UTC is not all out yet
  const m = makeModel(MODELS.gfs, { ask: w.ask, fetch, sleep: noSleep, now: () => NOW });
  const run = await m.ready();
  assert.equal(run.hour, '00'); assert.equal(run.date, '20261013');
  assert.deepEqual(w.log[0], { keep: '/gfs.20261013/00/', cache: 'oo3d-gfs' }, 'the cache is shared with the globe');
  assert.equal(await m.ready(), run, 'found once');
  const none = makeModel(MODELS.gfs, { ask: w.ask, fetch: bucket([]).fetch, sleep: noSleep, now: () => NOW });
  await assert.rejects(none.ready(), /no recent GFS run reachable/);
});

test('model.at: the two forecast hours either side, blended; pressure fetches the next hour for its trend', async () => {
  const { fetch } = bucket(['gfs.20261013/06/']);
  const w = worker((key, url) => key === 'temp' ? (url.endsWith('f003') ? 280 : 290) : key === 'pres' ? (url.endsWith('f003') ? 101000 : 100700) : 5);
  const m = makeModel(MODELS.gfs, { ask: w.ask, fetch, sleep: noSleep, now: () => NOW, res: 1 });
  const run = await m.ready(), t = run.t + 4.5 * H;
  const c = await m.at(t, ['wind', 'temp', 'pres']);
  assert.equal(c.h0, 3); assert.equal(c.h1, 6); assert.equal(c.w, 0.5);
  assert.ok(c.a.wind.u && c.a.wind.v, 'wind is u and v');
  assert.equal(momentValue(c, 'temp', 10, 10), 285 - 273.15);
  assert.equal(momentValue(c, 'pres', 0, 0), 1008.5);
  const r = momentReading(c, 0, 0);
  assert.equal(r.presTrend, -3, '1010 → 1007 hPa in 3 h');
  assert.ok(Math.abs(r.speed - Math.hypot(5, 5)) < 1e-9);
  assert.ok(Number.isNaN(r.wave) && Number.isNaN(r.cloud), 'not asked for: NaN');
  const asks = w.log.filter(x => x.url).map(x => x.url.slice(-4));
  assert.deepEqual([...new Set(asks)].sort(), ['f003', 'f006']);
  assert.ok(w.log.filter(x => x.url).every(x => x.res === 1 && x.cache === 'oo3d-gfs'));
  const n = w.log.length; await m.at(t, ['wind', 'temp']); assert.equal(w.log.length, n, 'decoded hours are kept');
  const exact = await m.at(run.t + 6 * H, ['pres']);
  assert.equal(exact.w, 0); assert.equal(exact.h0, 6);
  assert.notEqual(exact.b.pres, exact.a.pres, 'on the hour, pressure still has the next hour');
});

test('model.at: a kind missing from one hour takes the other\'s; nothing at all is an error', async () => {
  const { fetch } = bucket(['gfs.20261013/06/']);
  const w = worker(() => 7, { fail: url => url.endsWith('f003') });
  const m = makeModel(MODELS.gfs, { ask: w.ask, fetch, sleep: noSleep, now: () => NOW });
  const run = await m.ready();
  const c = await m.at(run.t + 4 * H, ['gust']);
  assert.equal(c.a.gust, c.b.gust, 'hour 6 stands in for hour 3');
  const all = worker(() => 7, { fail: () => true });
  const m2 = makeModel(MODELS.gfs, { ask: all.ask, fetch, sleep: noSleep, now: () => NOW });
  await assert.rejects(m2.at(NOW, ['gust']), /nothing reachable/);
  await assert.rejects(m2.field(3, 'snow'), /GFS has no snow/);
});

test('model: keeps only `keep` forecast hours, dropping the least recently used', async () => {
  const { fetch } = bucket(['gfs.20261013/06/']), w = worker();
  const m = makeModel(MODELS.gfs, { ask: w.ask, fetch, sleep: noSleep, now: () => NOW, keep: 2 });
  await m.ready();
  for (const h of [3, 6, 9]) await m.field(h, 'temp');
  assert.deepEqual([...m.steps.keys()].sort((a, b) => a - b), [6, 9]);
});

test('model.refresh: a newer complete run starts over', async () => {
  let now = NOW; const out = ['gfs.20261013/06/'];
  const { fetch } = bucket(out), w = worker();
  const m = makeModel(MODELS.gfs, { ask: w.ask, fetch, sleep: noSleep, now: () => now });
  await m.ready(); await m.field(3, 'temp');
  assert.equal(await m.refresh(), false, 'nothing newer');
  now += 6 * H; assert.equal(await m.refresh(), false, '12 UTC not out yet');
  out.push('gfs.20261013/12/'); assert.equal(await m.refresh(), true);
  assert.equal(m.run.hour, '12'); assert.equal(m.steps.size, 0);
});

test('momentOf: tries again while the run is known, gives null instead of throwing', async () => {
  let n = 0;
  const flaky = { run: { t: 0 }, async at() { if (++n < 3) throw new Error('503'); return 'ok'; } };
  assert.equal(await momentOf(flaky, 0, ['wind'], { sleep: noSleep }), 'ok');
  const never = { run: null, async at() { n++; throw new Error('no run'); } };
  n = 0; assert.equal(await momentOf(never, 0, ['wind'], { sleep: noSleep }), null); assert.equal(n, 1, 'no run: no point trying again');
  const stale = { run: {}, async at() { n++; throw new Error('x'); } };
  n = 0; assert.equal(await momentOf(stale, 0, ['wind'], { sleep: noSleep, still: () => false }), null); assert.equal(n, 1);
});

test('sampling a moment: unit changes, waves with land and directions, wind blended', () => {
  const g = flat(0); const wave = { wave: flat(2), wavedir: flat(350) }, wave2 = { wave: flat(4), wavedir: flat(10) };
  wave.wave.values[0] = NaN;
  const c = { a: { rain: flat(1 / 3600), cloud: flat(55), wave, wind: { u: flat(2), v: flat(0) } }, b: { rain: flat(1 / 3600), cloud: flat(55), wave: wave2, wind: { u: flat(4), v: flat(2) } }, w: 0.5, h0: 0, h1: 3 };
  assert.ok(Math.abs(momentValue(c, 'rain', 0, 0) - 1) < 1e-6, 'kg/m²/s → mm/h');
  assert.equal(momentValue(c, 'cloud', 0, 0), 55);
  assert.equal(momentValue(c, 'wave', 10, 10), 3);
  assert.ok(Math.abs(momentValue(c, 'wavedir', 10, 10)) < 1e-6 || Math.abs(momentValue(c, 'wavedir', 10, 10) - 360) < 1e-6, '350° and 10° meet at north');
  assert.deepEqual(momentWind(c, 10, 10, [0, 0]), [3, 1]);
  assert.ok(Number.isNaN(momentValue(c, 'temp', 0, 0)));
  assert.deepEqual(momentWind(null, 0, 0, [9, 9]), [0, 0]);
  assert.ok(Number.isNaN(momentReading(null, 0, 0).speed));
  assert.ok(g.values.every(v => v === 0));
});

test('makeModels: every model in core/wxmodels.js, one ask between them', () => {
  const ask = async () => ({}), ms = makeModels({ ask, maxH: 72 });
  assert.deepEqual(Object.keys(ms).sort(), Object.keys(MODELS).sort());
  assert.equal(ms.gfs.maxH, 72); assert.equal(ms.ecmwf.def, MODELS.ecmwf);
});
