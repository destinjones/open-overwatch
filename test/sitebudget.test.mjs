// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The site build's Pages budget (.github/build_site.py), run in Python: only the newest releases keep a full copy under
// /v/<tag>/ (the rest point at their release zip), and the dev-only folders stay off the site, except a file a page
// really loads. Skipped when no Python is installed. Never runs main() (it downloads from CelesTrak and the rest).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const py = ['python3', 'python'].find(p => spawnSync(p, ['-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)']).status === 0);
const skip = !py && 'no Python here';

/** Run `body` (Python, with the build script imported as b) and return the JSON it prints last. */
function run(body, ...args) {
  const script = `import sys, json, importlib.util
spec = importlib.util.spec_from_file_location('b', ${JSON.stringify(join(root, '.github/build_site.py'))}); b = importlib.util.module_from_spec(spec); spec.loader.exec_module(b)
${body}`;
  const r = spawnSync(py, ['-I', '-c', script, ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

// the 23 tags of 2026-10-15 plus two that sort wrongly as text, in no particular order
const TAGS = ['v0.5', 'v0.6', 'v0.7', 'v0.8', 'v0.9', 'v0.9.1', 'v0.9.2', 'v0.9.2.1', 'v0.9.2.2', 'v0.9.2.3', 'v0.9.2.4', 'v0.9.2.5', 'v0.9.2.6',
  'v0.9.2.7', 'v0.9.2.8', 'v0.9.2.9', 'v0.9.2.10', 'v0.9.2.11', 'v0.9.2.12', 'v0.9.2.13', 'v0.9.2.14', 'v0.5.1', 'v0.6.2'];

test('site build: the newest 6 releases stay online, chosen by version number, not as text', { skip }, () => {
  const out = run(`t = json.loads(sys.argv[1])
print(json.dumps({'keep': b.ARCHIVE_KEEP, 'six': sorted(b.online_tags(t), key=b.version_key),
  'more': sorted(b.online_tags(t + ['v0.10'], 6), key=b.version_key), 'few': sorted(b.online_tags(t[:3], 6), key=b.version_key),
  'none': sorted(b.online_tags(t, 0)), 'empty': sorted(b.online_tags([]))}))`, JSON.stringify(TAGS));
  assert.equal(out.keep, 6, 'the owner chose six (2026-10-17)');
  assert.deepEqual(out.six, ['v0.9.2.9', 'v0.9.2.10', 'v0.9.2.11', 'v0.9.2.12', 'v0.9.2.13', 'v0.9.2.14']);
  assert.deepEqual(out.more, ['v0.9.2.10', 'v0.9.2.11', 'v0.9.2.12', 'v0.9.2.13', 'v0.9.2.14', 'v0.10'], 'a new release retires the oldest online one');
  assert.deepEqual(out.few, ['v0.5', 'v0.6', 'v0.7'], 'fewer tags than the budget: all of them');
  assert.deepEqual(out.none, []);
  assert.deepEqual(out.empty, []);
});

test('site build: a retired version\'s page points at its release zip and loads nothing', { skip }, () => {
  const out = run(`print(json.dumps(b.retired_page(sys.argv[1])))`, 'v0.9.2.3');
  assert.match(out, /href="https:\/\/github\.com\/destinjones\/open-overwatch\/releases\/download\/v0\.9\.2\.3\/open-overwatch\.zip"/);
  assert.match(out, /href="https:\/\/github\.com\/destinjones\/open-overwatch\/releases\/tag\/v0\.9\.2\.3"/);
  assert.match(out, /href="\.\.\/\.\.\/index\.html#launch"/, 'back to the landing page from /v/<tag>/');
  assert.match(out, /default-src 'none'/);
  assert.doesNotMatch(out, /<script|<img|<link|\son\w+=/i);
  const odd = run(`print(json.dumps(b.retired_page(sys.argv[1])))`, 'v1<b>"&');
  assert.ok(!odd.includes('<b>') && odd.includes('v1&lt;b&gt;&quot;&amp;') && odd.includes('/download/v1%3Cb%3E%22%26/'), 'the tag is escaped');
});

test('site build: dev-only folders stay off the site, except what a page loads', { skip }, () => {
  const names = ['test/mcp.test.mjs', 'test/fixtures/adsbdb-4ca87c.json', 'test/', 'e2e/snapshots/globe-europe.png', 'notes/handoff-2026-10-06.md',
    'relay/worker.js', 'mcp-worker/wrangler.toml', 'brand/clip/open-overwatch-zoom.mp4', 'brand/source/x.psd', '.github/build_site.py',
    'test/fixtures/horizons_2026-10-02.json', 'docs/NOTES.md', 'src/solar/nerd.js', 'index.html', 'testing.html', 'brand/clipart.png', 'mcp/server.mjs', '.devcontainer/README.md', 'tsconfig.json', 'types/page.d.ts', 'eslint.config.mjs', 'playwright.config.mjs'];
  const out = run(`n = json.loads(sys.argv[1])
print(json.dumps({x: b.published(x, b.SKIP_ROOT, b.KEEP_ROOT) for x in n} | {'keep': list(b.KEEP_ROOT), 'skip': list(b.SKIP_ROOT)}))`, JSON.stringify(names));
  const on = names.filter(n => out[n]);
  assert.deepEqual(on, ['test/fixtures/horizons_2026-10-02.json', 'docs/NOTES.md', 'src/solar/nerd.js', 'index.html', 'testing.html', 'brand/clipart.png',
    'mcp/server.mjs', '.devcontainer/README.md']);
  // every quoted path a published page or script (in any folder) names under a skipped folder must be in KEEP_ROOT
  // (prefix checks like sw.js's 'brand/clip/' end in a slash and are not loads)
  const files = readdirSync(root, { recursive: true }).map(f => f.replace(/\\/g, '/'))
    .filter(f => /\.(html|js)$/.test(f) && !/(^|\/)(node_modules|\.git)\//.test(f) && !out.skip.some(s => f.startsWith(s)));
  assert.ok(files.includes('india/india.js') && files.includes('src/solar/main.js') && !files.some(f => f.startsWith('test/')));
  const loads = new Set();
  for (const f of files) {
    for (const m of readFileSync(join(root, f), 'utf8').matchAll(/['"`]((?:\.\.\/)*([\w.\-]+\/[^'"`\s]*))['"`]/g)) {
      const p = m[1].replace(/^(\.\.\/)+/, '');
      if (out.skip.some(s => p.startsWith(s)) && !p.endsWith('/')) loads.add(p);
    }
  }
  assert.ok(loads.has('test/fixtures/horizons_2026-10-02.json'), 'the scan finds the Solar view\'s accuracy fixture');
  for (const p of loads) assert.ok(out.keep.includes(p), `${p} is loaded by a page but skipped by the site build`);
});
