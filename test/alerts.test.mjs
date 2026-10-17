// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Tab reminders (src/core/ics.js reminderPlan, run by src/globe/alerts.js): each fires once, on time or late after the
// tab slept, never twice (a second tab, a late timer), and long-stale ones are dropped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { reminderPlan } from '../src/core/ics.js';

const MIN = 60e3, HOUR = 3600e3, T = Date.parse('2026-10-17T20:00:00Z');
const r = (tag, at) => ({ tag, at, title: tag, body: 'b' });

test('reminders: due now, still to come (soonest first) and the wait to the next', () => {
  const p = reminderPlan([r('later', T + 2 * HOUR), r('now', T), r('soon', T + 5 * MIN)], T);
  assert.deepEqual(p.due.map(a => a.tag), ['now']); assert.equal(p.due[0].late, undefined, 'on time: not late');
  assert.deepEqual(p.pending.map(a => a.tag), ['soon', 'later']);
  assert.equal(p.next, 5 * MIN);
  assert.equal(reminderPlan([], T).next, null);
  assert.deepEqual(reminderPlan(null, T), { due: [], pending: [], next: null });
});

test('reminders: one that came due while the tab slept fires when it wakes, marked late; a stale one is dropped', () => {
  const p = reminderPlan([r('slept', T - 90 * MIN), r('yesterday', T - 20 * HOUR), r('throttled', T - 70e3), r('just', T - 30e3)], T);
  assert.deepEqual(p.due.map(a => a.tag), ['slept', 'throttled', 'just'], 'an hour and a half late still fires (it used to be dropped after a minute)');
  assert.equal(p.due[0].late, 90 * MIN);
  assert.equal(p.due[1].late, undefined, 'a background tab\'s throttled timer a minute behind is not "missed"');
  assert.equal(p.due[2].late, undefined, 'under a minute is on time');
  assert.equal(p.pending.length, 0, 'yesterday\'s is gone, not kept forever');
  assert.equal(reminderPlan([r('x', T - 3 * HOUR)], T).due.length, 0, 'two hours is the default grace');
  assert.equal(reminderPlan([r('x', T - 2 * HOUR)], T, { grace: HOUR }).due.length, 0, 'grace is the limit');
});

test('reminders: one with an end (`until`: the pass sets) is dropped once that is past, whatever the grace', () => {
  const pass = { ...r('pass', T - 10 * MIN), until: T - 2 * MIN }, launch = { ...r('launch', T - 50 * MIN), until: T + 10 * MIN };
  assert.deepEqual(reminderPlan([pass, launch], T).due.map(a => a.tag), ['launch'], 'the pass is over: no "in 10 minutes" for it');
  assert.equal(reminderPlan([{ ...r('long', T - 5 * HOUR), until: T + MIN }], T).due.length, 1, 'until can also reach past the grace');
});

test('reminders: fire once, as alerts.js runs them (store what is pending, then show what is due), across two tabs', () => {
  let stored = [r('pass', T + 10 * MIN), r('pass', T + 9 * MIN), r('launch', T + HOUR)];   // the same tag twice: the last wins
  const shown = [];
  const check = now => { const p = reminderPlan(stored, now); stored = p.pending; shown.push(...p.due.map(a => a.tag)); return p; };
  assert.equal(check(T).pending.filter(a => a.tag === 'pass').length, 1);
  check(T + 9 * MIN + 1);              // tab A's timer
  check(T + 9 * MIN + 5);              // tab B's timer, a moment later, reading the same storage
  check(T + 30 * MIN);                 // a late timer or a wake-up look
  assert.deepEqual(shown, ['pass'], 'shown once');
  check(T + 3 * HOUR);                 // the computer slept through the launch
  assert.deepEqual(shown, ['pass', 'launch']);
  check(T + 3 * HOUR + MIN); assert.deepEqual(shown, ['pass', 'launch'], 'and not again');
});

test('alerts.js: claims before it shows, waits for the worker, and looks again when the page wakes', () => {
  const src = readFileSync(new URL('../src/globe/alerts.js', import.meta.url), 'utf8');
  const check = src.slice(src.indexOf('function check()'), src.indexOf('function wire()'));
  assert.ok(check.indexOf("store.set('alerts', pending)") >= 0 && check.indexOf("store.set('alerts', pending)") < check.indexOf('show('), 'pending is stored before anything is shown');
  assert.match(src.slice(src.indexOf('async function show('), src.indexOf('const hm')), /await worker\(\)/, 'a notification waits for the worker registration');
  assert.match(src, /visibilitychange/); assert.match(src, /setInterval\(check/);
});
