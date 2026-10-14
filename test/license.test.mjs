// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The licence check CI runs on the production dependency tree (brand/tools/license_check.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
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
