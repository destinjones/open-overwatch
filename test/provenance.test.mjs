// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { source, provenance, provenanceText, provenanceHtml, ageText } from '../src/core/provenance.js';

const now = Date.parse('2026-10-14T12:00:00Z');
const min = 60e3;

test('two fresh agreeing sources are confirmed', () => {
  const r = provenance([{ id: 'usgs', name: 'USGS', dataAt: now - 3 * min }, { id: 'emsc', name: 'EMSC', dataAt: now - 5 * min }], { now });
  assert.equal(r.confidence, 'confirmed');
  assert.equal(r.agree, 2); assert.equal(r.of, 2);
  assert.equal(r.ageMs, 3 * min);
  assert.equal(provenanceText(r), 'USGS + EMSC · 2 of 2 agree · data 3 min old · confirmed');
});

test('one fresh source is reported; a disagreeing source does not confirm', () => {
  assert.equal(provenance([{ id: 'a', dataAt: now - min }], { now }).confidence, 'reported');
  const r = provenance([{ id: 'a', dataAt: now - min }, { id: 'b', dataAt: now - min }], { now, agreeing: ['a'] });
  assert.equal(r.confidence, 'reported'); assert.equal(r.agree, 1); assert.equal(r.of, 2);
});

test('age is the data time, not the download time; old data is stale', () => {
  const r = provenance([source({ id: 'mirror', name: 'Site copy', dataAt: now - 7 * 3600e3, fetchedAt: now, cached: true })], { now, maxAgeMs: 6 * 3600e3 });
  assert.equal(r.confidence, 'stale');
  assert.match(provenanceText(r), /Site copy \(copy\) · data 7\.0 h old · stale/);
});

test('no data time is unknown; ISO strings are accepted', () => {
  assert.equal(provenance([{ id: 'x' }], { now }).confidence, 'unknown');
  assert.equal(provenanceText(provenance([{ id: 'x', name: 'X' }], { now })), 'X · data age unknown · unknown');
  assert.equal(provenance([{ id: 'x', dataAt: '2026-10-14T11:59:00Z' }], { now }).ageMs, min);
  assert.throws(() => source({ name: 'no id' }));
});

test('the card escapes upstream strings and links only https', () => {
  const h = provenanceHtml(provenance([{ id: 'e', name: '<b>x</b>', url: 'javascript:alert(1)', dataAt: now }], { now }));
  assert.ok(!h.includes('<b>x</b>') && !h.includes('javascript:'));
  assert.match(provenanceHtml(provenance([{ id: 'u', name: 'USGS', url: 'https://earthquake.usgs.gov/', dataAt: now }], { now })), /<a href="https:\/\/earthquake\.usgs\.gov\/"/);
});

test('ageText', () => {
  assert.equal(ageText(40e3), '40 s');
  assert.equal(ageText(2.5 * 3600e3), '2.5 h');
  assert.equal(ageText(4 * 86400e3), '4 days');
  assert.equal(ageText(null), 'unknown age');
});

test('the confidence rule reaches screen readers as hidden text, not only a hover tooltip', () => {
  const r = provenance([{ id: 'usgs', name: 'USGS', dataAt: now - min }], { now });
  const h = provenanceHtml(r);
  assert.match(h, /<abbr class="prov-conf" title="[^"]+">reported<\/abbr>/, 'the abbr stays');
  const sr = h.match(/<span class="oo-sr">: ([^<]+)<\/span><\/div>$/);
  assert.ok(sr, 'the rule follows as visually hidden text');
  assert.ok(sr[1].length > 20 && r.rule.startsWith(sr[1].slice(0, 20)), 'it is the rule itself');
  // .oo-sr is defined once, in the shell every page that shows provenance loads (src/app/shell.js)
  assert.match(readFileSync(new URL('../src/app/shell.css', import.meta.url), 'utf8'), /\.oo-sr\{position:absolute/);
});
