// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// core/poll.js: the globe's feed timers rest in a hidden tab, catch up once (staggered) on return, keep the feeds an
// armed alert needs, and stop for good only on a not-carried error. A fake clock and fake timers, no waiting.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPoller } from '../src/core/poll.js';

function clock() {
  let t = 0, id = 0; const timers = new Map();
  const c = {
    now: () => t,
    setTimer: (fn, ms) => { timers.set(++id, { fn, at: t + ms }); return id; },
    clearTimer: i => timers.delete(i),
    pending: () => [...timers.values()].map(x => x.at - t).sort((a, b) => a - b),
    /** Move the clock to t + ms, firing each timer at its time (in time order), letting promises settle between. */
    async advance(ms) {
      const end = t + ms;
      for (;;) {
        await new Promise(res => setImmediate(res));
        let next = null; for (const [k, x] of timers) if (x.at <= end && (!next || x.at < next[1].at)) next = [k, x];
        if (!next) break;
        timers.delete(next[0]); t = Math.max(t, next[1].at); next[1].fn();
      }
      t = end; await new Promise(res => setImmediate(res));
    },
  };
  return c;
}

test('poll: runs now and every ms while visible', async () => {
  const c = clock(), p = createPoller(c), runs = [];
  p.add(1000, () => { runs.push(c.now()); });
  await c.advance(3500);
  assert.deepEqual(runs, [0, 1000, 2000, 3000]);
});

test('poll: a hidden page asks nothing; coming back runs each due feed once, staggered', async () => {
  const c = clock(), p = createPoller({ ...c, stagger: 1500 }), a = [], b = [], slow = [];
  p.add(1000, () => { a.push(c.now()); });
  p.add(2000, () => { b.push(c.now()); });
  p.add(60e3, () => { slow.push(c.now()); });
  await c.advance(10);
  p.setHidden(true);
  await c.advance(30e3);
  assert.deepEqual(a, [0], 'no runs while hidden'); assert.deepEqual(b, [0]); assert.deepEqual(slow, [0]);
  assert.deepEqual(c.pending().length, 1, 'only the feed not yet due still has a timer');
  p.setHidden(false);
  await c.advance(1);
  assert.deepEqual(a, [0, 30010], 'the first due feed at once');
  assert.deepEqual(b, [0], 'the second waits its turn');
  await c.advance(1500);
  assert.deepEqual(b, [0, 31510], 'a stagger later');
  assert.deepEqual(slow, [0], 'a feed whose time has not come keeps its own schedule');
  await c.advance(60e3 - 31511);
  assert.deepEqual(slow, [0, 60e3]);
});

test('poll: a page that opens hidden waits for its first look', async () => {
  const c = clock(), p = createPoller(c), runs = [];
  p.setHidden(true);
  p.add(1000, () => { runs.push(c.now()); });
  await c.advance(5000);
  assert.deepEqual(runs, []);
  p.setHidden(false); await c.advance(0);
  assert.deepEqual(runs, [5000]);
});

test('poll: keep() lets a feed run hidden (an armed alert needs its fixes)', async () => {
  const c = clock(), p = createPoller(c), runs = []; let armed = true;
  p.add(1000, () => { runs.push(c.now()); }, { keep: () => armed });
  p.setHidden(true);
  await c.advance(2500);
  assert.deepEqual(runs, [0, 1000, 2000]);
  armed = false; await c.advance(2000);
  assert.deepEqual(runs, [0, 1000, 2000], 'disarmed: it rests like the others');
});

test('poll: a not-carried error stops the feed for the visit; other errors are retried and counted', async () => {
  const c = clock(), p = createPoller(c), stops = [], errs = []; let n = 0, m = 0;
  const f = p.add(1000, () => { n++; throw Object.assign(new Error('not carried by the website'), { notCarried: true }); }, { onStop: e => stops.push(e.message), onError: () => errs.push('x') });
  p.add(1000, () => { m++; return Promise.reject(new Error('HTTP 503')); }, { onError: (e, fails) => errs.push(fails) });
  await c.advance(5500);
  assert.equal(n, 1, 'one request, then none'); assert.ok(f.stopped); assert.deepEqual(stops, ['not carried by the website']);
  assert.equal(m, 6); assert.deepEqual(errs, [1, 2, 3, 4, 5, 6], 'an outage keeps its timer and its count');
  assert.equal(p.feeds.size, 1);
});

test('poll: a success resets the failure count; a slow run never overlaps the next', async () => {
  const c = clock(), p = createPoller(c), fails = []; let k = 0, live = 0, most = 0;
  p.add(1000, () => { k++; live++; most = Math.max(most, live); return new Promise((res, rej) => c.setTimer(() => { live--; k === 3 ? res() : rej(new Error('timeout')); }, 1500)); }, { onError: (e, n) => fails.push(n) });
  await c.advance(8000);
  assert.equal(most, 1, 'one at a time');
  assert.deepEqual(fails.slice(0, 3), [1, 2, 1], 'the third run answered, so the count began again');
});

test('poll: start: false waits one interval before the first run', async () => {
  const c = clock(), p = createPoller(c), runs = [];
  p.add(1000, () => { runs.push(c.now()); }, { start: false });
  await c.advance(2500);
  assert.deepEqual(runs, [1000, 2000]);
});
