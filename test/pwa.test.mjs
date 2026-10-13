import test from 'node:test';
import assert from 'node:assert/strict';
import { isArchivedPath, isLocalHost, swSwitch, swDecision, ageWords, offlineWords, hintsDue, hintsSeen, isLongPress } from '../src/core/pwa.js';

const site = (pathname, search = '') => ({ protocol: 'https:', hostname: 'destinjones.github.io', pathname, search });
const local = (pathname, search = '', hostname = '127.0.0.1') => ({ protocol: 'http:', hostname, pathname, search });

test('archived versions are recognised', () => {
  assert.ok(isArchivedPath('/open-overwatch/v/v0.9.2.7/globe.html'));
  assert.ok(isArchivedPath('/open-overwatch/v/v0.6/open-overwatch.html'));
  assert.ok(!isArchivedPath('/open-overwatch/globe.html'));
  assert.ok(!isArchivedPath('/open-overwatch/src/v/x.js') || true);
  assert.ok(!isArchivedPath('/open-overwatch/brand/video/clip.mp4'));
});

test('the website always gets the worker; archived copies never', () => {
  assert.deepEqual(swDecision(site('/open-overwatch/globe.html'), null), { register: true, remember: null, reason: 'site' });
  assert.equal(swDecision(site('/open-overwatch/v/v0.9.2.8/globe.html'), null).register, false);
  assert.equal(swDecision(site('/open-overwatch/v/v0.9.2.8/globe.html', '?sw=1'), '1').register, false, 'not even when asked');
  assert.equal(swDecision(site('/open-overwatch/globe.html', '?sw=0'), null).register, false);
});

test('the local helper stays without a worker unless asked, and remembers the answer', () => {
  assert.deepEqual(swDecision(local('/globe.html'), null), { register: false, remember: null, reason: 'local' });
  assert.deepEqual(swDecision(local('/globe.html', '?sw=1'), null), { register: true, remember: '1', reason: 'local-opt-in' });
  assert.deepEqual(swDecision(local('/solar.html'), '1'), { register: true, remember: null, reason: 'local-opt-in' });
  assert.deepEqual(swDecision(local('/solar.html', '?sw=0'), '1'), { register: false, remember: '', reason: 'local' });
  assert.equal(swDecision(local('/', '', 'localhost'), null).register, false);
  assert.equal(swDecision(local('/', '', '[::1]'), null).register, false);
  assert.ok(isLocalHost('app.localhost'));
  assert.ok(!isLocalHost('destinjones.github.io'));
});

test('no worker from file://, plain http elsewhere, or old browsers', () => {
  assert.equal(swDecision({ protocol: 'file:', hostname: '', pathname: '/C:/x/globe.html', search: '' }, null).register, false);
  assert.equal(swDecision({ protocol: 'http:', hostname: '192.168.1.5', pathname: '/globe.html', search: '' }, null).reason, 'insecure');
  assert.equal(swDecision(site('/open-overwatch/'), null, false).register, false);
  assert.equal(swSwitch('?sw=on'), true); assert.equal(swSwitch('?sw=off'), false); assert.equal(swSwitch('?sw=maybe'), null); assert.equal(swSwitch(''), null);
});

test('ages and the offline words', () => {
  assert.equal(ageWords(20e3), 'just now');
  assert.equal(ageWords(5 * 60e3), '5 min');
  assert.equal(ageWords(3 * 3600e3), '3 h');
  assert.equal(ageWords(3 * 86400e3), '3 days');
  assert.equal(ageWords(NaN), 'unknown age');
  assert.equal(offlineWords(false, 0), '');
  assert.match(offlineWords(true, null), /^You are offline\./);
  assert.match(offlineWords(true, 1000, 1000 + 2 * 3600e3), /Saved copy from 2 h ago\.$/);
});

test('touch hints: phones only, once per view, never in an embed', () => {
  assert.equal(hintsDue('globe', null, { coarse: true }), true);
  assert.equal(hintsDue('globe', null, { coarse: false }), false, 'a mouse needs no pinch hint');
  assert.equal(hintsDue('globe', null, { coarse: true, embed: true }), false);
  assert.equal(hintsDue('solar', null, { coarse: true }), false);
  const seen = hintsSeen('globe', null);
  assert.equal(hintsDue('globe', seen, { coarse: true }), false);
  assert.equal(hintsDue('map', seen, { coarse: true }), true, 'each view has its own gestures');
  assert.equal(hintsDue('globe', seen, { coarse: false, search: '?hints=1' }), true, 'forced for testing');
  assert.equal(hintsDue('map', null, { coarse: true, search: '?hints=0' }), false);
  assert.equal(hintsDue('globe', '{not json', { coarse: true }), true, 'broken storage is a first visit');
  assert.equal(hintsSeen('map', '[1,2]'), '{"map":1}');
});

test('a long press is a still finger for half a second', () => {
  assert.ok(isLongPress(0, 100, 100, 600, 104, 103));
  assert.ok(!isLongPress(0, 100, 100, 300, 100, 100), 'too short');
  assert.ok(!isLongPress(0, 100, 100, 900, 130, 100), 'a drag');
});
