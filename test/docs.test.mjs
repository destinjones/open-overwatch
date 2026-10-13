// The docs against the code: the user guide (guide.html), the link format (docs/LINK_FORMAT.md) and the developer guide
// (docs/DEVELOPING.md) must name what the code has. A layer, link parameter, sensor, weather source, band button or
// voice example added without a line in the docs fails here; so does a link in the docs to a file or anchor that is gone.
// The globe's modules touch the DOM, so their lists are read from the source text, not imported.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { GO } from '../src/core/viewlink.js';
import { SENSORS, EXAMPLES } from '../src/core/voicecmd.js';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8').replace(/\r\n/g, '\n');
const guide = read('guide.html'), linkDoc = read('docs/LINK_FORMAT.md'), devDoc = read('docs/DEVELOPING.md');
const text = html => html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const missing = (list, where, has) => list.filter(x => !has(x, where));

const globeLayers = [...read('src/globe/layers.js').matchAll(/\{ id: '([a-z0-9_-]+)', group: '/g)].map(m => m[1]);
const mapLayers = [...read('src/map/feeds.js').matchAll(/Layers\.add\(\{\s*id: '([a-z0-9_]+)'/g), ...read('src/map/aircraft.js').matchAll(/Layers\.add\(\{\s*id: '([a-z0-9_]+)'/g),
  ...read('src/map/satellites.js').matchAll(/Layers\.add\(\{\s*id: '([a-z0-9_]+)'/g)].map(m => m[1]);
const weatherSets = Object.keys(Function(`return ${read('src/globe/weather.js').match(/sets: (\{[^\n]*?\} \}),?\n/)[1]}`)());

test('docs: the source lists were found (so the checks below check something)', () => {
  assert.ok(globeLayers.length >= 30, `globe layers: ${globeLayers.length}`);
  assert.ok(mapLayers.length >= 20, `2D map layers: ${mapLayers.length}`);
  assert.deepEqual(weatherSets, ['ir', 'radar', 'rain', 'lightning', 'wind', 'temp']);
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
  for (const [name, md] of [['docs/LINK_FORMAT.md', linkDoc], ['docs/DEVELOPING.md', devDoc]]) {
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
  for (const f of ['serve.js', 'serve.py', 'Publish Update.bat', '.github/build_site.py', 'mcp/manifest.json', 'sitemap.xml', '.claude/launch.json']) assert.ok(devDoc.includes(f) && existsSync(new URL(f, root)), f);
  assert.match(read('src/globe/main.js'), /function applyAll\(\)/, 'DEVELOPING.md section 5 tells people to wire layers in applyAll()');
  assert.match(read('src/map/util.js'), /export const NEEDS_RELAY/, 'DEVELOPING.md section 6 says NEEDS_RELAY lives in src/map/util.js');
});

test('docs: the landing page links to the guide', () => {
  assert.match(read('index.html'), /href="guide\.html"/);
});
