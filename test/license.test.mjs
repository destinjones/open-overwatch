// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The licence check CI runs on the production dependency tree (brand/tools/license_check.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, openSync, readSync, closeSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { licenceOk, declared, check } from '../brand/tools/license_check.mjs';

test('SPDX expressions against the allowlist', () => {
  for (const ok of ['MIT', 'ISC', 'BSD-3-Clause', 'Apache-2.0', 'BlueOak-1.0.0', '(MIT OR GPL-3.0)', 'MIT OR (ISC AND LGPL-2.1)', 'Apache-2.0 WITH LLVM-exception'])
    assert.equal(licenceOk(ok), true, ok);
  for (const bad of ['GPL-3.0', 'LGPL-2.1', 'AGPL-3.0-only', 'MPL-2.0', '(MIT AND GPL-3.0)', 'UNLICENSED', 'SEE LICENSE IN LICENSE', '', null, undefined])
    assert.equal(licenceOk(bad), false, String(bad));
});

test('licence fields old and new', () => {
  assert.equal(declared({ license: 'MIT' }), 'MIT');
  assert.equal(declared({ license: { type: 'ISC' } }), 'ISC');
  assert.equal(declared({ licenses: [{ type: 'MIT' }, { type: 'GPL-2.0' }] }), 'MIT AND GPL-2.0');
  assert.equal(declared({}), null);
});

test('the production tree passes (satellite.js is MIT)', () => {
  const rows = check(new URL('../', import.meta.url));
  const sat = rows.find(r => r.name === 'satellite.js');
  assert.equal(sat?.licence, 'MIT');
  assert.deepEqual(rows.filter(r => !r.ok), []);
});

// NOTICE's list of data under its own licence must name every file docs/DATA_SOURCES.md (or the file's own header) gives a
// share-alike, non-commercial, ODbL or BSD licence: those terms travel with the copy, so the two documents cannot drift apart.
test('NOTICE names every data file that carries its own licence', () => {
  const root = new URL('../', import.meta.url);
  const notice = readFileSync(new URL('NOTICE', root), 'utf8');
  const own = /CC[ -]BY[ -](?:NC|SA)|ODbL|BSD/i;
  const tracked = new Set(execFileSync('git', ['ls-files', 'data'], { cwd: fileURLToPath(root), encoding: 'utf8' }).split('\n').filter(Boolean));
  const need = new Set();
  for (const row of readFileSync(new URL('docs/DATA_SOURCES.md', root), 'utf8').split('\n').filter(l => l.startsWith('|') && own.test(l)))
    for (const [f] of row.matchAll(/data\/[\w./-]+\.(?:json|bin)/g)) if (tracked.has(f)) need.add(f);
  for (const f of tracked) {   // the licence or source a data file declares in its first bytes
    if (!f.endsWith('.json')) continue;
    const fd = openSync(new URL(f, root)), head = Buffer.alloc(400);
    const n = readSync(fd, head, 0, 400, 0); closeSync(fd);
    const m = head.toString('utf8', 0, n).match(/"(?:licen[cs]e|source)"\s*:\s*"[^"]*"/g);
    if (m && m.some(s => own.test(s))) need.add(f);
  }
  for (const f of ['data/solar/stars.json', 'data/lighthouses.json', 'data/constellations.json', 'data/deepsky.json', 'data/lightpollution.bin'])
    assert.ok(need.has(f), f + ' is found');
  assert.deepEqual([...need].filter(f => !notice.includes(f)).sort(), []);
});
