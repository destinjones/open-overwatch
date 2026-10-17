// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The clean-machine install test (.github/workflows/install-test.yml) and its helper (test/helpers/installsmoke.mjs):
// the zip script is release.yml's own step, the crawl finds what a page loads and reports what is missing, this checkout
// serves every page and file with no 404, the MCP round trip works, the workflow is pinned and wired to the helper.
// Also the GitHub social preview image (brand/social/github-preview-1280x640.png): 1280x640 and under 1 MB.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipScript, pageRefs, moduleRefs, cssRefs, checkSite, mcpRoundTrip, entryPages, DATA_FILES } from './helpers/installsmoke.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = p => readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n');

test('install test: the zip script is release.yml\'s "Build the download zip" step, dedented and nothing more', () => {
  const sh = zipScript(read('.github/workflows/release.yml'));
  const lines = sh.trimEnd().split('\n');
  assert.equal(lines[0], 'set -euo pipefail');
  assert.equal(lines[1], 'D=dist/open-overwatch', 'the first line of the step, without its YAML indent');
  assert.ok(sh.includes('(cd dist && zip -qr open-overwatch.zip open-overwatch)'), 'it ends in the zip itself');
  assert.ok(sh.includes('cp -r src "$D/"'));
  assert.ok(!/actions\/setup-node|npm ci|uses:|- name:/.test(sh), 'the next step is not part of it');
  assert.ok(!lines.some(l => l.startsWith('          ')), 'dedented (continuation lines keep only their own extra indent)');
  assert.throws(() => zipScript('jobs:\n  x:\n    steps:\n      - run: echo\n'), /no "Build the download zip" step/);
  // CRLF and the step being last in the file
  assert.equal(zipScript('      - name: Build the download zip\r\n        run: |\r\n          echo a\r\n          echo b\r\n'), 'set -euo pipefail\necho a\necho b\n');
});

test('install test: the crawl reads what pages, modules and stylesheets load, and skips remote and template URLs', () => {
  const html = `<link rel="stylesheet" href="brand/fonts/fonts.css"><img src="a.png" srcset="b.webp 1x, c.webp 2x">
    <a href="https://example.org/">x</a><a href="#top">t</a><img src="\${x}.png"><a href="india/">India</a><video poster="p.jpg">
    <script type="module">import { x } from './src/app/a.js'; import('./src/app/b.js');</script>
    <script type="module" src="src/globe/main.js"></script><script src="https://cdn.jsdelivr.net/npm/x@1/x.js"></script>`;
  assert.deepEqual(pageRefs(html).sort(), ['./src/app/a.js', './src/app/b.js', 'a.png', 'b.webp', 'brand/fonts/fonts.css', 'c.webp', 'india/', 'p.jpg', 'src/globe/main.js'].sort());
  const js = `import * as THREE from 'three';\nimport { a } from './a.js';\nexport { b } from '../core/b.js';\nimport './side.js';\n` +
    `const w = new Worker(new URL('./w.worker.js', import.meta.url));\nconst m = await import('./lazy.js');\nfetch('data/x.json');`;
  assert.deepEqual(moduleRefs(js), ['./a.js', '../core/b.js', './side.js', './w.worker.js', './lazy.js'], 'in source order; three and data/ are not modules here');
  assert.deepEqual(cssRefs("@font-face { src: url(a.woff2) format('woff2'); } x { background: url('data:image/png;base64,AA') }"), ['a.woff2']);
});

test('install test: this checkout, served by serve.js, answers 200 for every page and every file they load', async () => {
  const r = await checkSite(root);
  assert.deepEqual(r.bad.map(b => `${b.status} ${b.url} (from ${b.from})`), []);
  const paths = r.ok.map(u => new URL(u).pathname);
  assert.ok(paths.length >= 200, `only ${paths.length} files: the crawl stopped early`);
  for (const p of ['/open-overwatch.html', '/globe.html', '/solar.html', '/src/globe/main.js', '/src/core/time.js', '/brand/fonts/fonts.css', '/india/', '/manifest.webmanifest'])
    assert.ok(paths.includes(p), `${p} was reached`);
  assert.ok(paths.some(p => p.endsWith('.woff2')), 'fonts from the stylesheet');
  for (const d of DATA_FILES) assert.ok(paths.includes('/' + d), d);
  assert.ok(entryPages(root).includes('globe.html') && !entryPages(root).includes('404.html'));
});

test('install test: a folder with a missing module, font or data file fails the check, and says where it came from', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'oo-install-'));
  try {
    copyFileSync(join(root, 'serve.js'), join(dir, 'serve.js'));
    for (const d of ['src/app', 'brand/fonts', 'data/solar']) mkdirSync(join(dir, d), { recursive: true });
    writeFileSync(join(dir, 'open-overwatch.html'), '<link rel="stylesheet" href="brand/fonts/fonts.css"><script type="module" src="src/app/main.js"></script>');
    writeFileSync(join(dir, 'brand/fonts/fonts.css'), "@font-face { src: url(here.woff2) } @font-face { src: url(gone.woff2) }");
    writeFileSync(join(dir, 'brand/fonts/here.woff2'), 'x');
    writeFileSync(join(dir, 'src/app/main.js'), "import { a } from './a.js';\nimport { b } from '../core/b.js';\n");
    writeFileSync(join(dir, 'src/app/a.js'), 'export const a = 1;\n');
    const r = await checkSite(dir);
    const bad = r.bad.map(b => `${new URL(b.url).pathname} ${b.status} ${b.from}`);
    assert.ok(bad.includes('/src/core/b.js 404 /src/app/main.js'), bad.join('\n'));
    assert.ok(bad.includes('/brand/fonts/gone.woff2 404 /brand/fonts/fonts.css'), bad.join('\n'));
    assert.ok(bad.includes('/data/solar/stars.bin 404 (start)'), 'the data files are checked too');
    assert.ok(!bad.some(b => b.startsWith('/src/app/a.js') || b.startsWith('/brand/fonts/here.woff2')), 'present files pass');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('install test: the MCP round trip against mcp/server.mjs (what the workflow runs on the installed package)', async () => {
  const r = await mcpRoundTrip(join(root, 'mcp/server.mjs'));
  const pkg = JSON.parse(read('package.json'));
  assert.equal(r.code, 0, r.err);
  assert.equal(r.init.serverInfo.name, 'open-overwatch'); assert.equal(r.init.serverInfo.version, pkg.version);
  assert.ok(r.tools.length >= 30 && r.tools.some(t => t.name === 'earthquakes'), `${r.tools.length} tools`);
});

test('install test: the workflow is pinned, runs on the three systems and on releases, and calls the helper as written', () => {
  const yml = read('.github/workflows/install-test.yml');
  assert.ok(yml.startsWith('# Copyright (c) 2026 Destin Jones.'));
  const uses = [...yml.matchAll(/uses:\s*(\S+)/g)].map(m => m[1]);
  assert.ok(uses.length >= 8);
  for (const u of uses) assert.match(u, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, `${u} is pinned to a commit`);
  for (const t of ['release:\n    types: [published]', 'workflow_dispatch:', 'branches: [ci-e2e]', 'workflows: [Release]'])
    assert.ok(yml.includes(t), t);
  assert.match(read('.github/workflows/release.yml'), /^name: Release$/m, 'workflow_run names the release workflow');
  assert.equal((yml.match(/os: \[ubuntu-latest, windows-latest, macos-latest\]/g) || []).length, 2, 'site and mcp jobs on all three');
  for (const c of ['installsmoke.mjs zip-script', 'installsmoke.mjs site', 'installsmoke.mjs mcp', 'npm pack --ignore-scripts', 'npx --no-install open-overwatch-mcp --version', 'Expand-Archive'])
    assert.ok(yml.includes(c), c);
  assert.ok(!/npm publish|wrangler|celestrak/i.test(yml), 'it publishes and deploys nothing');
  assert.match(yml, /^permissions:\n {2}contents: read$/m);
});

test('GitHub social preview: brand/social/github-preview-1280x640.png is a 1280x640 PNG under 1 MB', () => {
  const p = join(root, 'brand/social/github-preview-1280x640.png'), b = readFileSync(p);
  assert.equal(b.subarray(1, 4).toString(), 'PNG');
  assert.equal(b.readUInt32BE(16), 1280); assert.equal(b.readUInt32BE(20), 640);
  assert.ok(statSync(p).size < 1024 * 1024, `${statSync(p).size} bytes (GitHub's limit is 1 MB)`);
});
