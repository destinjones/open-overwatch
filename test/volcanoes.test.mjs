// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The volcano list (data/volcanoes.json, from Wikidata by brand/tools/make_volcanoes.py): heights in metres only. Wikidata's
// plain value keeps the unit it was entered in, and summits in feet once showed as "16,390 m" (Mount Blackburn).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const doc = JSON.parse(readFileSync(new URL('data/volcanoes.json', root), 'utf8'));
const col = Object.fromEntries(doc.cols.map((c, i) => [c, i]));

test('volcanoes: the file has its columns and a sane row for every volcano', () => {
  assert.deepEqual(doc.cols, ['name', 'lat', 'lon', 'elevationM', 'country', 'type', 'wiki']);
  assert.equal(doc.count, doc.rows.length); assert.ok(doc.count > 2000, String(doc.count));
  assert.match(doc.source, /Wikidata/);
  for (const r of doc.rows) {
    assert.equal(r.length, doc.cols.length);
    assert.ok(typeof r[col.name] === 'string' && r[col.name], JSON.stringify(r));
    assert.ok(Math.abs(r[col.lat]) <= 90 && Math.abs(r[col.lon]) <= 180, JSON.stringify(r));
    assert.match(r[col.wiki], /^Q\d+$/);
  }
});

test('volcanoes: every summit is in metres (none above 7,000 m: the highest volcano on Earth is under 6,900 m)', () => {
  const tall = doc.rows.filter(r => r[col.elevationM] != null && r[col.elevationM] > 7000);
  assert.deepEqual(tall.map(r => `${r[col.name]} ${r[col.elevationM]}`), []);
  for (const r of doc.rows) if (r[col.elevationM] != null) assert.ok(Number.isInteger(r[col.elevationM]) && r[col.elevationM] > -11000, JSON.stringify(r));
  const h = name => doc.rows.find(r => r[col.name] === name)?.[col.elevationM];
  // summits Wikidata gives in feet, now in metres (16,390 ft, 10,363 ft, 6,601 ft); ones in metres unchanged
  assert.ok(Math.abs(h('Mount Blackburn') - 4996) < 30, String(h('Mount Blackburn')));
  assert.ok(Math.abs(h('South Sister') - 3157) < 30, String(h('South Sister')));
  assert.ok(Math.abs(h('Frosty Volcano') - 2012) < 30, String(h('Frosty Volcano')));
  assert.ok(Math.abs(h('Mount Fuji') - 3776) < 10, String(h('Mount Fuji')));
});

test('volcanoes: the generator asks for normalised metres, and asks again when its cache is from another query', () => {
  const py = readFileSync(new URL('brand/tools/make_volcanoes.py', root), 'utf8');
  assert.match(py, /psn:P2044\/wikibase:quantityAmount/);
  assert.doesNotMatch(py, /wdt:P2044/);   // the raw value, in whatever unit it was entered
  assert.match(py, /c\.get\('query'\) == Q/);
});
