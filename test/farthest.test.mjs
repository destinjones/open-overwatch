// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// "Farthest from home" on the Tonight card (src/core/farthest.js), and the worker that works it out off the main
// thread (src/core/farthest.worker.js) against the shipped spacecraft file. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { farthestCraft, SILENT } from '../src/core/farthest.js';

const root = new URL('../', import.meta.url);
const ALL = JSON.parse(readFileSync(new URL('data/solar/spacecraft.json', root), 'utf8'));
const NOW = Date.UTC(2026, 9, 31);

test('farthest: the four farthest craft, farthest first, Voyager 1 on top, in plain words', () => {
  const rows = farthestCraft(ALL, NOW);
  assert.equal(rows.length, 4);
  assert.equal(rows[0].name, 'Voyager 1');
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].au >= rows[i].au);
  assert.ok(rows[0].au > 160 && rows[0].au < 180, `Voyager 1 at ${rows[0].au} AU`);
  assert.match(rows[0].text, /^Voyager 1: \d+\.\d billion km away \(\d+ AU\)\. Its radio signal takes \d+ h \d+ min to reach us\.$/);
  assert.equal(farthestCraft(ALL, NOW, 2).length, 2);
  assert.deepEqual(farthestCraft([], NOW), []);
});

test('farthest: a silent craft says when it went quiet', () => {
  const pioneer = ALL.find(c => c.name in SILENT);
  if (!pioneer) return;   // the file no longer carries one
  const row = farthestCraft([pioneer], NOW)[0];
  assert.match(row.text, new RegExp(`Silent since ${SILENT[pioneer.name]}; a signal from there would take`));
});

test('farthest worker: answers with the rows, or the error, by id', async () => {
  const sent = [], realFetch = globalThis.fetch;
  globalThis.self = { postMessage: m => sent.push(m) };
  try {
    globalThis.fetch = async u => new Response(readFileSync(new URL('data/solar/spacecraft.json', root)), { status: String(u).startsWith('http://x.test/') ? 200 : 404 });
    await import('../src/core/farthest.worker.js');
    await self.onmessage({ data: { id: 7, now: NOW, base: 'http://x.test/tonight.html' } });
    assert.equal(sent[0].id, 7); assert.equal(sent[0].rows[0].name, 'Voyager 1');
    globalThis.fetch = async () => new Response('', { status: 500 });
    await self.onmessage({ data: { id: 8, now: NOW, base: 'http://x.test/' } });
    assert.equal(sent[1].id, 8); assert.match(sent[1].error, /could not load/);
  } finally { globalThis.fetch = realFetch; delete globalThis.self; }
});
