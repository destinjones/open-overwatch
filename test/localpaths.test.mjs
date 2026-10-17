// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The published text files (the site serves docs/, data/, brand/models/ and the root pages as they are) never carry a local
// home folder such as C:\Users\<name>\..., which would leak the maintainer's user name and folder layout into every version.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
// a drive's Users folder followed by a name (\ or \\ as in JSON, or /), or a macOS home; `C:\Users\…` in prose is fine
const LOCAL = /[A-Za-z]:(?:\\{1,2}|\/)Users(?:\\{1,2}|\/)[A-Za-z0-9]|\/Users\/[A-Za-z0-9]/;

const files = (dir, ext) => readdirSync(join(root, dir), { withFileTypes: true })
  .filter(d => d.isFile() && ext.some(e => d.name.endsWith(e))).map(d => (dir === '.' ? '' : dir + '/') + d.name);

test('the pattern finds home folders and leaves prose alone', () => {
  for (const bad of ['C:\\Users\\desti\\x', '"C:\\\\Users\\\\desti\\\\brand"', 'c:/Users/someone/x', '/Users/someone/repo', '/Users/Destin/x'])
    assert.match(bad, LOCAL, bad);
  for (const ok of ['a Windows path (`C:\\Users\\…`)', '%USERPROFILE%\\x', 'https://example.org/users/1', '$LOCALAPPDATA/…'])
    assert.doesNotMatch(ok, LOCAL, ok);
});

test('no local home folder in the published docs, data notes, model reports or root pages', () => {
  const list = [...files('docs', ['.md']), ...files('data', ['.md']), ...files('brand/models', ['.json']), ...files('.', ['.md', '.html']), ...files('india', ['.html'])];
  assert.ok(list.includes('india/index.html') && list.includes('brand/models/validation.json') && list.includes('docs/GEV_STUDY.md'), 'the scan covers the files that leaked before');
  const hits = [];
  for (const f of list) {
    readFileSync(join(root, f), 'utf8').split('\n').forEach((line, i) => { if (LOCAL.test(line)) hits.push(`${f}:${i + 1}`); });
  }
  assert.deepEqual(hits, []);
});
