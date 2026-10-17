// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// src/core/launches.js: Launch Library 2's precision codes, the end of the period an imprecise launch time names, and
// how long a launch stays on the upcoming list (the globe's list, Tonight and the MCP launches tool share it).
import test from 'node:test';
import assert from 'node:assert/strict';
import { precisionCode, periodEnd, listedUntil, upcoming, when, fromLL2 } from '../src/core/launches.js';

const T = s => Date.parse(s), iso = ms => new Date(ms).toISOString();

test('precision codes: LL2 abbrevs and names read the same', () => {
  for (const [p, c] of [['DAY', 'DAY'], ['Day', 'DAY'], ['D', 'DAY'], ['M', 'M'], ['Month', 'M'], ['Q4', 'Q4'], ['Quarter 4', 'Q4'], ['H1', 'H1'], ['Half 1', 'H1'],
    ['WK', 'WK'], ['Week', 'WK'], ['MIN', 'MIN'], ['Minute', 'MIN'], ['Second', 'SEC'], ['Year', 'Y'], ['Fiscal Year', 'FY'], ['Decade', 'DEC'], ['', ''], [undefined, '']])
    assert.equal(precisionCode(p), c, String(p));
});

test('periodEnd: the end of the UTC day, week, month, quarter, half, year or decade', () => {
  const at = T('2026-10-31T00:00:00Z');
  assert.equal(iso(periodEnd(at, 'DAY')), '2026-11-01T00:00:00.000Z');
  assert.equal(iso(periodEnd(T('2026-10-29T15:00:00Z'), 'PM')), '2026-10-30T00:00:00.000Z');
  assert.equal(iso(periodEnd(at, 'WK')), '2026-11-07T00:00:00.000Z');
  assert.equal(iso(periodEnd(at, 'M')), '2026-11-01T00:00:00.000Z');
  assert.equal(iso(periodEnd(T('2026-12-31T00:00:00Z'), 'M')), '2027-01-01T00:00:00.000Z', 'December rolls into the next year');
  assert.equal(iso(periodEnd(T('2026-12-31T00:00:00Z'), 'Q4')), '2027-01-01T00:00:00.000Z');
  assert.equal(iso(periodEnd(T('2026-03-31T00:00:00Z'), 'Quarter 1')), '2026-04-01T00:00:00.000Z');
  assert.equal(iso(periodEnd(T('2026-06-30T00:00:00Z'), 'H1')), '2026-07-01T00:00:00.000Z');
  assert.equal(iso(periodEnd(T('2026-12-31T00:00:00Z'), 'H2')), '2027-01-01T00:00:00.000Z');
  assert.equal(iso(periodEnd(at, 'Y')), '2027-01-01T00:00:00.000Z');
  assert.equal(iso(periodEnd(at, 'DEC')), '2030-01-01T00:00:00.000Z');
  for (const p of ['SEC', 'MIN', 'HR', '', 'ZZ']) assert.equal(periodEnd(at, p), null, p);
  assert.equal(periodEnd(NaN, 'M'), null);
  assert.equal(listedUntil(at, 'MIN', 2 * 3600e3), at + 2 * 3600e3);
  assert.equal(listedUntil(at, 'M', 2 * 3600e3), T('2026-11-01T00:00:00Z'));
});

test('upcoming: a "NET October" launch is listed through 31 October and gone on 1 November', () => {
  // LL2 dates a month-precision launch at the month's last day, 00:00Z (the site's data/launches.json, 2026-10-17)
  const ll2 = (id, net, abbrev, name) => fromLL2({ id, name: id, net, net_precision: { abbrev, name }, pad: { latitude: '13.72', longitude: '80.23', location: { name: 'Satish Dhawan Space Centre, India' } } });
  const list = [ll2('oct', '2026-10-31T00:00:00Z', 'M', 'Month'), ll2('day', '2026-10-31T00:00:00Z', 'DAY', 'Day'),
    ll2('q4', '2026-12-31T00:00:00Z', 'Q4', 'Quarter 4'), ll2('min', '2026-10-31T00:00:00Z', 'MIN', 'Minute')];
  const ids = at => upcoming(list, T(at)).map(l => l.id).sort();
  assert.deepEqual(ids('2026-10-31T01:59:00Z'), ['day', 'min', 'oct', 'q4']);
  assert.deepEqual(ids('2026-10-31T02:01:00Z'), ['day', 'oct', 'q4'], 'a precise time goes 2 hours after it');
  assert.deepEqual(ids('2026-10-31T12:00:00Z'), ['day', 'oct', 'q4']);
  assert.deepEqual(ids('2026-11-01T03:00:00Z'), ['q4']);
  assert.deepEqual(ids('2027-01-01T03:00:00Z'), []);
  // in flight stays; no time stays; soonest first
  assert.deepEqual(upcoming([{ net: -9e9, status: 'In Flight' }, { net: NaN }, { net: 5e6 }, { net: -9e9 }], 4e6).map(l => l.net), [-9e9, 5e6, NaN]);
});

test('when: the time only as precisely as announced', () => {
  assert.equal(when({ net: T('2026-10-29T00:00:00Z'), precision: 'DAY' }), '2026-10-29 (time not set)');
  assert.equal(when({ net: T('2026-10-31T00:00:00Z'), precision: 'M' }), 'October 2026 (no date yet)');
  assert.equal(when({ net: T('2026-12-31T00:00:00Z'), precision: 'Q4' }), 'Q4 2026 (no date yet)');
});
