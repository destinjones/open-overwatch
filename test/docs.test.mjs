// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The docs against the code: the user guide (guide.html), the link format (docs/LINK_FORMAT.md), the developer guide
// (docs/DEVELOPING.md) and the core reference (docs/CORE.md) must name what the code has. A layer, link parameter,
// sensor, weather source, band button, voice example or core module added without a line in the docs fails here; so
// does a link in the docs to a file or anchor that is gone, or an export the docs name that the code no longer has.
// The globe's modules touch the DOM, so their lists are read from the source text, not imported.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { GO } from '../src/core/viewlink.js';
import { SENSORS, EXAMPLES } from '../src/core/voicecmd.js';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8').replace(/\r\n/g, '\n');
const guide = read('guide.html'), linkDoc = read('docs/LINK_FORMAT.md'), devDoc = read('docs/DEVELOPING.md');
const text = html => html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const missing = (list, where, has) => list.filter(x => !has(x, where));

const globeLayers = [...read('src/globe/layers.js').matchAll(/\{ id: '([a-z0-9_-]+)', group: '/g)].map(m => m[1]);
// every Layers.add in the 2D map's modules (they spread over feeds, aircraft, satellites, cities, hazards, osmlayers…)
const mapLayers = readdirSync(new URL('src/map/', root)).filter(f => f.endsWith('.js')).flatMap(f => [...read('src/map/' + f).matchAll(/Layers\.add\(\{\s*id: '([a-z0-9_]+)'/g)].map(m => m[1]));
const weatherSets = Object.keys(Function(`return ${read('src/globe/weather.js').match(/sets: (\{[^\n]*?\} \}),?\n/)[1]}`)());

test('docs: the source lists were found (so the checks below check something)', () => {
  assert.ok(globeLayers.length >= 30, `globe layers: ${globeLayers.length}`);
  assert.ok(mapLayers.length >= 20, `2D map layers: ${mapLayers.length}`);
  for (const id of ['ir', 'radar', 'rain', 'lightning', 'wind', 'temp']) assert.ok(weatherSets.includes(id), `weather set ${id}: ${weatherSets}`);
});

test('docs: every globe layer is in the guide and in the link format', () => {
  assert.deepEqual(missing(globeLayers, guide, (id, s) => s.includes(`<code>${id}</code>`)), [], 'guide.html #layers');
  assert.deepEqual(missing(globeLayers, linkDoc, (id, s) => s.includes('`' + id + '`')), [], 'LINK_FORMAT.md, the `l` section');
});

test('docs: the guide names no globe layer the code lacks', () => {
  const table = guide.slice(guide.indexOf('id="layers-h"'), guide.indexOf('id="cards"'));
  const named = [...table.matchAll(/<td><span class="dot"[^>]*><\/span><code>([a-z0-9_-]+)<\/code>/g)].map(m => m[1]);
  assert.deepEqual(named, globeLayers, 'the layer table lists the layers in the dock\'s order, no more, no fewer');
});

test('docs: every 2D map layer is in the guide', () => {
  assert.deepEqual(missing(mapLayers, guide, (id, s) => s.includes(`<code>${id}</code>`)), []);
});

test('docs: every share-link parameter is described in LINK_FORMAT.md', () => {
  const src = read('src/core/viewlink.js');
  const keys = new Set([...src.matchAll(/p\.(?:set|get|has)\('([a-z]+)'/g)].map(m => m[1]));
  for (const k of ['c', 'l', 'a', 'x', 'w', 't', 'k', 'f', 'o', 'd', 's', 'go', 'id']) assert.ok(keys.has(k), `viewlink.js no longer reads "${k}": update this test and the docs`);
  assert.match(read('src/globe/env.js'), /embed=1/); keys.add('embed');
  assert.match(read('src/globe/director.js'), /scene=/); keys.add('scene');
  const headed = new Set([...linkDoc.matchAll(/^### (.+)$/gm)].flatMap(m => [...m[1].split(' — ')[0].matchAll(/`([a-z]+)`/g)].map(k => k[1])));
  assert.deepEqual([...keys].filter(k => !headed.has(k)), [], 'a "### `key`" section for each');
  assert.deepEqual([...headed].filter(k => !keys.has(k)), [], 'no section for a parameter the code does not read');
  const glance = linkDoc.slice(linkDoc.indexOf('## The parameters at a glance'), linkDoc.indexOf('## Two kinds of link'));
  assert.deepEqual([...keys].filter(k => !glance.includes('| `' + k + '` |')), [], 'and a row in the table at a glance');
});

test('docs: panels, sensors and weather sources a link can name', () => {
  assert.deepEqual(missing([...GO], linkDoc, (g, s) => s.includes('| `' + g + '` |')), [], 'the go= table');
  assert.deepEqual(missing([...SENSORS], linkDoc, (x, s) => s.includes('| `' + x + '` |')), [], 'the o= table');
  assert.deepEqual(missing([...SENSORS], guide, (x, s) => s.includes(`<code>${x}</code>`)), [], 'the guide\'s Ops table');
  assert.deepEqual(missing(weatherSets, linkDoc, (x, s) => s.includes('| `' + x + '` |')), [], 'the w= table');
  assert.deepEqual(missing(weatherSets, guide, (x, s) => s.includes(`<code>${x}</code>`)), [], 'the guide\'s weather table');
});

test('docs: the examples in LINK_FORMAT.md decode as the text says', async () => {
  const { decodeView, decodeExtras } = await import('../src/core/viewlink.js');
  const { decodeScene } = await import('../src/core/scene.js');
  const hashes = [...linkDoc.matchAll(/^#((?:c|go|embed)=[^\s]+)/gm)].map(m => '#' + m[1]);
  assert.ok(hashes.length >= 5, `examples found: ${hashes.length}`);
  for (const h of hashes) assert.ok(decodeView(h) || decodeExtras(h).go, `${h} is a usable link`);
  const drawn = decodeView(hashes.find(h => h.includes('&d=')));
  assert.deepEqual(drawn.drawing, [{ kind: 'pin', coords: [[-0.1246, 51.5007]], name: 'Big Ben' }, { kind: 'arrow', coords: [[2.3522, 48.8566], [13.405, 52.52]], road: true }, { kind: 'outline', iso: 'FR' }]);
  const scene = linkDoc.match(/#scene=([A-Za-z0-9_-]+)/)[1], plain = linkDoc.match(/^(v1;[^\n]+)$/m)[1];
  assert.equal(decodeScene(scene).length, 2); assert.equal(Buffer.from(scene, 'base64url').toString(), plain);
  const t = linkDoc.match(/#c=[^\s]*&t=([\d.]+),(\d+)\s+(\S+) (\d\d:\d\d) UTC/);
  assert.equal(new Date((+t[1] - 2440587.5) * 864e5).toISOString().slice(0, 16), `${t[3]}T${t[4]}`, 'the Julian Date example says its own date');
});

test('docs: every band button and its label is in the guide', () => {
  const band = read('globe.html').match(/<nav id="band"[\s\S]*?<\/nav>/)[0];
  const buttons = [...band.matchAll(/data-go="([a-z]+)"[^>]*>([^<]+)<\/button>/g)].map(m => [m[1], m[2].trim()]);
  assert.ok(buttons.length >= 15, `band buttons: ${buttons.length}`);
  assert.deepEqual(buttons.filter(([, label]) => !guide.includes(`<td><code>${label}</code></td>`)).map(([go]) => go), []);
});

test('docs: the guide offers every voice example the app suggests', () => {
  const said = new Set([...guide.matchAll(/<li>([^<]+)<\/li>/g)].map(m => text(m[1]).trim()));
  assert.deepEqual(EXAMPLES.filter(e => !said.has(e)), []);
});

test('docs: links in the docs point at files and anchors that exist', () => {
  const ids = new Set([...guide.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
  for (const [, href] of guide.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
    if (/^(https?:|mailto:)/.test(href)) continue;
    const [path, hash] = href.split('#');
    if (!path) { assert.ok(ids.has(hash), `guide.html: #${hash} has no target`); continue; }
    assert.ok(existsSync(new URL(path, root)), `guide.html links to ${path}, which is missing`);
  }
  const onramp = ['README.md', 'CONTRIBUTING.md', 'GOVERNANCE.md', 'SECURITY.md', 'CHANGELOG.md', '.devcontainer/README.md'].map(f => [f, read(f)]);
  for (const [name, md] of [['docs/LINK_FORMAT.md', linkDoc], ['docs/DEVELOPING.md', devDoc], ...onramp]) {
    const anchors = new Set([...md.matchAll(/^#{2,3} (.+)$/gm)].map(m => m[1].toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s/g, '-')));
    for (const [, href] of md.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^https?:/.test(href)) continue;
      const [path, hash] = href.split('#');
      if (!path) { assert.ok(anchors.has(hash), `${name}: #${hash} has no heading`); continue; }
      assert.ok(existsSync(new URL(path, new URL(name, root))), `${name} links to ${path}, which is missing`);
    }
  }
});

test('docs: files and names DEVELOPING.md points at are real', () => {
  for (const [, path] of devDoc.matchAll(/`((?:src|mcp|test|brand\/tools|relay|\.github\/workflows|docs)\/[\w./-]+\.(?:js|mjs|py|md|yml|toml))`/g)) {
    if (path.includes('tides')) continue;   // the worked example of a new layer
    assert.ok(existsSync(new URL(path, root)), `DEVELOPING.md names ${path}, which does not exist`);
  }
  for (const f of ['serve.js', 'serve.py', 'Publish Update.bat', '.github/build_site.py', 'mcp/manifest.json', 'sitemap.xml']) assert.ok(devDoc.includes(f) && existsSync(new URL(f, root)), f);
  assert.ok(devDoc.includes('.claude/launch.json'), '.claude/launch.json');   // named, but gitignored: a fresh checkout (CI) doesn't have it
  assert.match(read('src/globe/main.js'), /function applyAll\(\)/, 'DEVELOPING.md section 5 tells people to wire layers in applyAll()');
  assert.match(read('src/map/util.js'), /export const NEEDS_RELAY/, 'DEVELOPING.md section 6 says NEEDS_RELAY lives in src/map/util.js');
});

test('docs: files CONTRIBUTING.md and GOVERNANCE.md point at are real, and the good first issues are still open', () => {
  for (const name of ['CONTRIBUTING.md', 'GOVERNANCE.md']) {
    for (const [, path] of read(name).matchAll(/`((?:src|mcp|mcp-worker|test|e2e|brand\/tools|relay|\.github\/workflows|\.github|docs)\/[\w./-]+\.(?:js|mjs|py|md|yml|json))`/g))
      assert.ok(existsSync(new URL(path, root)), `${name} names ${path}, which does not exist`);
  }
  const contrib = read('CONTRIBUTING.md'), header = read('serve.js').split('\n')[1];
  assert.ok(contrib.includes(header), 'CONTRIBUTING.md quotes the copyright line every source file starts with');
  // a good first issue that is done should leave the list: ROADMAP ticks it, this fails, CONTRIBUTING.md loses it.
  // Each pair is [the item's bold title in CONTRIBUTING.md, its open line in ROADMAP.md]; the list has exactly these.
  const open = read('ROADMAP.md').split('\n').filter(l => l.startsWith('- [ ]')).join('\n');
  const issues = contrib.slice(contrib.indexOf('### Good first issues'), contrib.indexOf('\n## ', contrib.indexOf('### Good first issues')));
  const titles = [...issues.matchAll(/^- \*\*(.+?)\*\*/gm)].map(m => m[1]);
  const pairs = [
    ["The globe's zoom pad covers the end of the band at 1366x820", 'zoom pad covers'],
    ['An `earth_now` MCP tool.', 'An `earth_now` MCP tool'],
    ['Kepler-90\'s planets are called "KOI-351 b" … instead of "Kepler-90 b" …', "Kepler-90's planet cards keep the archive's designations"],
    ['Scan every tracked text file for local home-folder paths.', 'test/localpaths.test.mjs scans chosen folders'],
  ];
  assert.deepEqual(titles, pairs.map(p => p[0]), 'CONTRIBUTING.md lists these good first issues, in this order (update the pairs here with it)');
  for (const [title, item] of pairs)
    assert.ok(open.includes(item), `ROADMAP no longer has "${item}" open: take "${title}" off CONTRIBUTING.md's good first issues`);
});

test('docs: CORE.md has a section for every core module, and every export it names exists', async () => {
  const core = read('docs/CORE.md'), files = readdirSync(new URL('src/core/', root)).filter(f => f.endsWith('.js')).sort();
  const sections = core.split(/^### `([\w.-]+\.js)`$/m).slice(1);
  const named = new Map(); for (let i = 0; i < sections.length; i += 2) named.set(sections[i], sections[i + 1]);
  assert.deepEqual(files.filter(f => !named.has(f)), [], 'a "### `module.js`" section for each file in src/core/');
  assert.deepEqual([...named.keys()].filter(f => !files.includes(f)), [], 'no section for a module that is gone');
  for (const [file, body] of named) {
    if (file.endsWith('.worker.js')) continue;   // a Web Worker: no exports, and it needs a worker's `self` to load
    const mod = await import(new URL(`src/core/${file}`, root));
    // an export is named as `name` followed by ':' ',' '.' ')' ' and' or ' (' (prose like "`webkitCompassHeading` →" is not a claim)
    const listed = [...body.matchAll(/`([A-Za-z_$][\w$]*)`(?=[:,.)]| and | \(|$)/gm)].map(m => m[1]);
    const exported = new Set(Object.keys(mod));
    const notThere = listed.filter(n => !exported.has(n));
    assert.deepEqual(notThere, [], `${file}: CORE.md names exports the module doesn't have`);
    const mentioned = new Set(listed);
    assert.ok([...exported].filter(n => mentioned.has(n)).length >= Math.min(2, exported.size), `${file}: CORE.md should name its main exports`);
  }
});

test('docs: the README\'s numbers are the data\'s (lead, feature list and comparison table)', () => {
  const readme = read('README.md'), json = p => JSON.parse(read(p));
  const n = x => x.toLocaleString('en-US');
  const asteroids = ['asteroids_a.bin', 'asteroids_b.bin'].reduce((s, f) => s + statSync(new URL('data/solar/' + f, root)).size, 0) / 15;
  assert.ok(Number.isInteger(asteroids), 'asteroid files are 15-byte records');
  const cities = json('data/cities.json'), cc = cities.cols.indexOf('cc');
  const said = [
    [`${(asteroids / 1e6).toFixed(2)} million asteroids`, 'the lead'],
    [`${(asteroids / 1e6).toFixed(2)}M asteroids`, 'the comparison table'],
    [`${n(json('data/solar/exoplanets.json').planets)} exoplanets`, 'exoplanets.json'],
    [`${n(json('data/solar/galaxies.json').count)} galaxies`, 'galaxies.json'],
    [`${json('data/solar/spacecraft.json').length} spacecraft`, 'spacecraft.json'],
    [`${json('mcp/manifest.json').tools.length} tools`, 'mcp/manifest.json'],
    [`${json('mcp/manifest.json').tools.length}-tool MCP server`, 'the comparison table'],
    [`each of ${cities.rows.length} cities`, 'data/cities.json'],
    [`India's ${cities.rows.filter(r => r[cc] === 'IN').length} cities`, 'data/cities.json (the Hindi pages)'],
  ];
  for (const [s, from] of said) assert.ok(readme.replace(/\s+/g, ' ').includes(s), `README.md should say "${s}" (${from})`);
  const words = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen'];
  const activities = (read('teach/index.html').match(/<h4[\s>]/g) || []).length;
  assert.match(readme, new RegExp(`${words[activities]} classroom activities`, 'i'), `teach/index.html has ${activities} activities`);
});

test('docs: the landing page links to the guide', () => {
  assert.match(read('index.html'), /href="guide\.html"/);
});

test('docs: long code in the guide can wrap on a phone (a link or an embed snippet must not widen the page)', () => {
  // A 412 px phone fits about 40 characters of code in a paragraph; a longer unbroken run (the Tonight iframe src, a
  // #at= link) pushed the page to 736 px in the browser suite. Paragraph and list code wraps anywhere; table code scrolls
  // inside its .tbl box.
  const body = guide.slice(guide.indexOf('<body')).replace(/<td[\s\S]*?<\/td>/g, '');
  const long = [...body.matchAll(/<code>([\s\S]*?)<\/code>/g)].map(m => m[1].replace(/&amp;/g, '&').replace(/&lt;|&gt;/g, '<'))
    .flatMap(t => t.split(/\s+/)).filter(run => run.split(/(?<=-)/).some(s => s.length > 40));
  if (long.length) assert.match(guide, /p code,li code\{overflow-wrap:anywhere\}/, `guide.html has unbreakable code: ${long[0]}`);
  for (const m of body.matchAll(/<table/g)) assert.match(body.slice(m.index - 40, m.index), /class="tbl"[^>]*>\s*$/, 'guide.html: every table sits in its .tbl scroll box');
});
