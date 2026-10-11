// GFS helpers (src/core/gfs.js): which run, its files, blending between forecast hours, the weather timeline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gfsCycles, cycleAt, gfsFile, bracket, timeline, relTime, windFrom, compass } from '../src/core/gfs.js';

const H = 3600e3;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b}`);

test('runs: newest first, the newest only from 3.5 h after it starts', () => {
  const now = Date.UTC(2026, 9, 11, 1, 25);
  assert.deepEqual(gfsCycles(now, 3).map(c => c.date + c.hour), ['2026101018', '2026101012', '2026101006']);
  assert.deepEqual(gfsCycles(Date.UTC(2026, 9, 11, 3, 31), 1).map(c => c.date + c.hour), ['2026101100']);
  assert.equal(gfsFile(cycleAt(Date.UTC(2026, 9, 10, 18)), 6), 'https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.20261010/18/atmos/gfs.t18z.pgrb2.1p00.f006');
});

test('bracket: the forecast hours either side and the blend', () => {
  const c = cycleAt(Date.UTC(2026, 9, 10, 18));
  assert.deepEqual(bracket(c, c.t + 7.5 * H), { h0: 6, h1: 9, w: 0.5 });
  assert.deepEqual(bracket(c, c.t - H), { h0: 0, h1: 3, w: 0 });
  assert.deepEqual(bracket(c, c.t + 500 * H, 120), { h0: 117, h1: 120, w: 1 });
  assert.deepEqual(bracket(c, c.t + 9 * H), { h0: 9, h1: 12, w: 0 });
});

test('timeline: observed frames, then forecast hours after them', () => {
  const run = cycleAt(Date.UTC(2026, 9, 10, 18)), obsEnd = Date.UTC(2026, 9, 11, 0, 50);
  const tl = timeline({ obsEnd, obs: 6, obsStep: 30 * 60e3, run, until: obsEnd + 24 * H });
  assert.equal(tl.filter(f => !f.fcst).length, 6);
  assert.equal(tl[0].t, obsEnd - 2.5 * H); assert.equal(tl[5].t, obsEnd);
  assert.deepEqual(tl.filter(f => f.fcst).slice(0, 2).map(f => f.h), [9, 12], '03 UTC is the first model hour after 00:50');
  assert.ok(tl.every((f, i) => !i || f.t > tl[i - 1].t), 'oldest first');
  assert.equal(tl[tl.length - 1].h, 30);
  assert.equal(timeline({ obsEnd, obs: 2, run: null, until: obsEnd }).length, 2);
});

test('words: relative times, wind direction', () => {
  const now = Date.UTC(2026, 9, 11, 1);
  assert.equal(relTime(now + 5 * 60e3, now), 'now'); assert.equal(relTime(now - 40 * 60e3, now), '−40 min');
  assert.equal(relTime(now - 150 * 60e3, now), '−2 h 30 min'); assert.equal(relTime(now + 3 * H, now), '+3 h'); assert.equal(relTime(now + 54 * H, now), '+2 days 6 h');
  const w = windFrom(5, 0);   // blowing towards the east: a west wind
  near(w.speed, 5, 1e-9); near(w.from, 270, 1e-9); assert.equal(compass(w.from), 'west');
  near(windFrom(0, -3).from, 0, 1e-9, 'a north wind blows south'); assert.equal(compass(225), 'south-west');
});
