// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The npm package (open-overwatch-mcp) carries exactly what mcp/server.mjs loads: every module it imports, directly or
// through others, and nothing else (no tests, site data or brand assets). A new src/core import in mcp/ fails here until
// its file joins "files" in package.json. Also the bin's shebang, the dependencies and the MCP Registry entry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';
import { posix } from 'node:path';

const root = new URL('../', import.meta.url), cwd = fileURLToPath(root);
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));

// import/export ... from '…', import '…', import('…') with a literal, and new URL('./…', import.meta.url) (a worker file)
const SPEC = /^\s*(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)|new URL\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*,\s*import\.meta\.url/gm;

/** Every repo file `entry` loads (repo-relative, forward slashes) and the bare package names it imports. */
export function importGraph(entry) {
  const files = new Set(), bare = new Set(), todo = [entry];
  while (todo.length) {
    const f = todo.pop();
    if (files.has(f)) continue;
    assert.ok(existsSync(new URL(f, root)), `${f} is imported but missing`);
    files.add(f);
    for (const m of readFileSync(new URL(f, root), 'utf8').matchAll(SPEC)) {
      const s = m[1] || m[2] || m[3] || m[4];
      if (/^\.{1,2}\//.test(s)) todo.push(posix.normalize(posix.join(posix.dirname(f), s)));
      else if (!s.startsWith('node:') && !builtinModules.includes(s)) bare.add(s.startsWith('@') ? s.split('/').slice(0, 2).join('/') : s.split('/')[0]);
    }
  }
  return { files, bare };
}

test('npm pack: the tarball is the server and what it imports, plus the package metadata', () => {
  const [packed] = JSON.parse(execSync('npm pack --dry-run --json --ignore-scripts', { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  const inTar = new Set(packed.files.map(f => f.path.replace(/\\/g, '/')));
  const { files, bare } = importGraph('mcp/server.mjs');
  // npm always ships the root README* and LICENSE; src/package.json makes src/core/*.js ES modules; NOTICE goes with LICENSE.
  const meta = ['package.json', 'README.md', 'README.txt', 'LICENSE', 'NOTICE', 'mcp/README.md', 'src/package.json'];
  assert.deepEqual([...files].filter(f => !inTar.has(f)).sort(), [], 'imported by mcp/server.mjs but not in the package: add to "files"');
  assert.deepEqual([...inTar].filter(f => !files.has(f) && !meta.includes(f)).sort(), [], 'in the package but never loaded: take out of "files"');
  for (const f of ['LICENSE', 'NOTICE', 'mcp/README.md', 'src/package.json']) assert.ok(inTar.has(f), f);
  assert.ok(files.has('mcp/http-node.mjs'), 'the --http path is a dynamic import and still counted');
  assert.equal(packed.name, pkg.name); assert.equal(packed.version, pkg.version);
  assert.deepEqual([...bare].sort(), Object.keys(pkg.dependencies).sort(), 'bare imports are exactly the dependencies');
});

test('npm pack: every load in the graph is one the scan can follow (no computed imports or runtime file reads)', () => {
  // The scan above only sees string literals. A template or computed import(), import.meta.url outside
  // new URL('./…', import.meta.url), require() or a file read would load something the test cannot check, so it fails here.
  for (const f of importGraph('mcp/server.mjs').files) {
    const src = readFileSync(new URL(f, root), 'utf8').replace(/^\s*\/\/.*$/gm, '');
    for (const m of src.matchAll(/\bimport\(\s*([^)]*)\)/g)) assert.match(m[1], /^(['"])[^'"`]+\1\s*$/, `${f}: import(${m[1]}) is not a plain string literal`);
    assert.equal(src.replace(/new URL\(\s*['"]\.{1,2}\/[^'"]+['"]\s*,\s*import\.meta\.url\s*\)/g, '').match(/import\.meta\.(?:url|dirname|filename|resolve)/), null, `${f}: import.meta used outside new URL('./…', import.meta.url)`);
    assert.equal(src.match(/\b(?:require|createRequire|readFileSync|readFile|__dirname|__filename)\b/), null, `${f}: loads files at run time`);
  }
});

test('npm pack: mcp/README.md (the npm page) links only to absolute URLs, #anchors or ](../ and ](./ (rewritten in npm.yml)', () => {
  const md = readFileSync(new URL('mcp/README.md', root), 'utf8');
  const ok = /^(?:https?:|mailto:|#)/, md_ = [...md.matchAll(/\]\(\s*([^)\s]+)/g)].map(m => m[1]);
  const html = [...md.matchAll(/\b(?:src|href)=["']([^"']+)/g)].map(m => m[1]);
  assert.deepEqual(md_.filter(l => !ok.test(l) && !/^\.{1,2}\//.test(l)), [], 'a bare relative link breaks on npmjs.com: start it with ./ or ../, or make it absolute');
  assert.deepEqual(html.filter(l => !ok.test(l)), [], 'HTML src/href is not rewritten for npm: make it absolute');
});

test('npm pack: the bin runs on any OS (node shebang, LF endings) and the package is set up for provenance', () => {
  assert.deepEqual(pkg.bin, { 'open-overwatch-mcp': 'mcp/server.mjs' });
  const bin = readFileSync(new URL(pkg.bin['open-overwatch-mcp'], root), 'utf8');
  assert.ok(bin.startsWith('#!/usr/bin/env node\n'), 'shebang on the first line');
  assert.ok(!bin.includes('\r'), 'LF line endings (a CR breaks the shebang on Linux and macOS)');
  assert.deepEqual(pkg.publishConfig, { access: 'public', provenance: true });
  assert.equal(pkg.license, 'MIT');
  assert.match(pkg.repository.url, /github\.com\/destinjones\/open-overwatch\.git$/, 'provenance checks the repository against the workflow');
  assert.match(pkg.engines.node, /^>=\d+/);
});

test('MCP Registry: mcp/server.json names the npm package and matches package.json', () => {
  const s = JSON.parse(readFileSync(new URL('mcp/server.json', root), 'utf8'));
  assert.match(s.$schema, /^https:\/\/static\.modelcontextprotocol\.io\/schemas\/\d{4}-\d{2}-\d{2}\/server\.schema\.json$/);
  assert.equal(s.name, pkg.mcpName, 'the registry checks package.json mcpName against this name');
  assert.match(s.name, /^io\.github\.destinjones\/[a-zA-Z0-9._-]+$/, 'a GitHub namespace the owner can log in to');
  assert.ok(s.description.length >= 1 && s.description.length <= 100, `description is ${s.description.length} characters (max 100)`);
  assert.ok(s.title.length <= 100);
  assert.equal(s.version, pkg.version);
  assert.equal(s.packages.length, 1);
  const [p] = s.packages;
  assert.equal(p.registryType, 'npm'); assert.equal(p.identifier, pkg.name); assert.equal(p.version, pkg.version);
  assert.deepEqual(p.transport, { type: 'stdio' });
  assert.equal(s.repository.source, 'github'); assert.equal(s.repository.url, 'https://github.com/destinjones/open-overwatch');
  for (const i of s.icons) assert.ok(existsSync(new URL(i.src.replace('https://destinjones.github.io/open-overwatch/', ''), root)), i.src);
});
