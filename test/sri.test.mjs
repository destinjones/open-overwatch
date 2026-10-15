// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The supply-chain check (src/core/sricheck.js): its rules on small pages, then every page the site ships. Offline:
// it checks that hashes are present and agree, not that they match the CDN's bytes (node brand/tools/sri.mjs --fetch).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { checkPage, EVAL_OK, cdnTags, importMaps, inlineScripts, withCspHashes, cdnUrlsIn, isExact, parseCsp, cspMeta, scriptText } from '../src/core/sricheck.js';

const root = new URL('../', import.meta.url);
const read = p => readFileSync(new URL(p, root), 'utf8');
const sha256 = t => createHash('sha256').update(t, 'utf8').digest('base64');
const PAGES = [...readdirSync(root).filter(f => f.endsWith('.html')).sort(), 'india/index.html'];   // + the folder pages
const H = 'sha384-' + 'A'.repeat(64);
const CSP = (s = "script-src 'self' https://cdn.jsdelivr.net") => `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; ${s}; style-src 'self' https://cdn.jsdelivr.net; object-src 'none'; base-uri 'self'">`;
const page = (head, csp = CSP()) => `<!doctype html><html><head><meta charset="utf-8">${csp}${head}</head><body></body></html>`;
const rules = (html) => checkPage(html, { sha256 }).map(e => e.rule);
const LIB = 'https://cdn.jsdelivr.net/npm/lib@1.2.3/dist/lib.min.js';

test('exact versions only', () => {
  assert.ok(isExact(LIB));
  assert.ok(isExact('https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js'));
  assert.ok(isExact('https://cdn.jsdelivr.net/npm/@google/model-viewer@4.0.0/dist/model-viewer.min.js'));
  for (const u of ['https://cdn.jsdelivr.net/npm/lib@1/x.js', 'https://cdn.jsdelivr.net/npm/lib@1.2/x.js', 'https://cdn.jsdelivr.net/npm/lib@latest/x.js',
    'https://cdn.jsdelivr.net/npm/lib/x.js', 'https://unpkg.com/lib@^1.2.3/x.js', 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9/leaflet.js'])
    assert.ok(!isExact(u), u);
});

test('a CDN tag needs integrity and crossorigin; a range fails', () => {
  assert.deepEqual(rules(page(`<script src="${LIB}" integrity="${H}" crossorigin="anonymous"></script>`)), []);
  assert.deepEqual(rules(page(`<script src="${LIB}"></script>`)).sort(), ['crossorigin', 'integrity']);
  assert.ok(rules(page(`<script src="${LIB.replace('1.2.3', '1')}" integrity="${H}" crossorigin="anonymous"></script>`)).includes('version'));
  assert.deepEqual(rules(page(`<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/lib@1.2.3/x.css">`)).sort(), ['crossorigin', 'integrity']);
  assert.deepEqual(rules(page('<script src="src/app.js"></script>')), [], 'our own files are not CDN tags');
});

test('import maps: every exact module URL has an integrity entry', () => {
  const map = (imports, integrity) => `<script type="importmap">${JSON.stringify({ imports, integrity })}</script>`;
  const ok = page(map({ lib: LIB, 'lib/': 'https://cdn.jsdelivr.net/npm/lib@1.2.3/' }, { [LIB]: H }));
  assert.deepEqual(checkPage(ok, {}).map(e => e.rule), []);
  assert.ok(checkPage(page(map({ lib: LIB }, {})), {}).some(e => e.rule === 'integrity'));
  assert.ok(checkPage(page(map({ lib: LIB.replace('1.2.3', '1') }, {})), {}).some(e => e.rule === 'version'));
});

test('the CSP: present, first, object-src none, base-uri, no eval, CDN origins named', () => {
  assert.ok(rules(page('', '')).includes('csp'));
  assert.ok(rules(`<html><head><script src="src/a.js"></script>${CSP()}</head></html>`).includes('csp'), 'a meta after a script does not govern it');
  assert.ok(rules(page('', CSP().replace("object-src 'none'", "object-src 'self'"))).includes('csp'));
  assert.ok(rules(page('', CSP().replace("; base-uri 'self'", ''))).includes('csp'));
  assert.ok(rules(page('', CSP("script-src 'self' 'unsafe-eval'"))).includes('csp'));
  assert.deepEqual(checkPage(page('', CSP("script-src 'self' 'unsafe-eval'")), { evalOk: true }), [], 'the globe: Cesium widgets need it');
  assert.deepEqual([...EVAL_OK], ['globe.html'], 'eval stays the exception');
  assert.ok(rules(page('', CSP("script-src 'self' https:"))).includes('csp'), 'a whole scheme is not a CDN origin');
  assert.ok(rules(page(`<script src="${LIB}" integrity="${H}" crossorigin="anonymous"></script>`, CSP("script-src 'self'"))).includes('csp'));
});

test('inline scripts are allowed by hash, and --csp keeps the list in step', () => {
  const html = page('<script>go()</script>', CSP("script-src 'self'"));
  assert.deepEqual(rules(html), ['csp-hash']);
  const fixed = withCspHashes(html, sha256);
  assert.deepEqual(rules(fixed), []);
  assert.match(fixed, new RegExp(`'sha256-${sha256('go()').replace(/[+/]/g, '\\$&')}'`));
  assert.deepEqual(rules(fixed.replace('go()', 'gone()')).sort(), ['csp-hash', 'csp-hash'], 'an edited script, and a hash left over');
  assert.equal(sha256(scriptText('a\r\nb')), sha256('a\nb'), 'a CRLF checkout hashes as the browser sees it');
  assert.deepEqual(rules(page('<script type="application/ld+json">{}</script>', CSP("script-src 'self'"))), [], 'data blocks never run');
  const unsafe = page('<script>go()</script>', CSP("script-src 'self' 'unsafe-inline'"));
  assert.deepEqual(rules(unsafe), []);
  assert.equal(withCspHashes(unsafe, sha256), unsafe, "a page on 'unsafe-inline' gets no hashes");
  assert.deepEqual(rules(unsafe.replace("'unsafe-inline'", `'unsafe-inline' 'sha256-${sha256('go()')}'`)), ['csp'], 'a hash would switch unsafe-inline off');
});

test('every page: CDN tags pinned and hashed, the same hash everywhere, a CSP that matches its inline scripts', () => {
  const sri = new Map();
  for (const p of PAGES) {
    const html = read(p);
    for (const t of cdnTags(html)) if (t.attrs.integrity && !sri.has(t.url)) sri.set(t.url, t.attrs.integrity);
    for (const m of importMaps(html)) for (const [u, h] of Object.entries(m.integrity)) if (!sri.has(u)) sri.set(u, h);
  }
  for (const p of PAGES) assert.deepEqual(checkPage(read(p), { sha256, sri, evalOk: EVAL_OK.has(p) }).map(e => `${p}:${e.line} [${e.rule}] ${e.what}`), []);
  // every library URL in the code (hls.js's dynamic import, satellite.js in the worker source) is hashed on some page
  const walk = d => readdirSync(new URL(d, root), { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(`${d}${e.name}/`) : e.name.endsWith('.js') ? [`${d}${e.name}`] : []);
  for (const f of walk('src/')) for (const u of cdnUrlsIn(read(f))) assert.ok(sri.has(u), `${f}: ${u} is not pinned with integrity on any page`);
});

test('no page asks Google Fonts; fonts come from brand/fonts', () => {
  for (const p of PAGES) assert.doesNotMatch(read(p), /fonts\.(googleapis|gstatic)\.com/, p);
  const css = read('brand/fonts/fonts.css');
  for (const [, file] of css.matchAll(/url\(([^)]+)\)/g)) assert.ok(readFileSync(new URL(`brand/fonts/${file}`, root)).length > 1000, file);
  for (const fam of ['Big Shoulders Display', 'Barlow', 'IBM Plex Mono']) assert.ok(css.includes(`font-family: '${fam}'`), fam);
});

test("the build's rewrites leave inline scripts alone (their hashes would break on the archived copies)", () => {
  // .github/build_site.py fix_archived_links rewrites 'cwbhood' and href="index.html|about.html in the archived pages
  const archived = read('.github/build_site.py').match(/APP_PATHS = \[([^\]]*)\]/)[1].match(/'[^']+\.html'/g).map(s => s.slice(1, -1));
  assert.ok(archived.includes('globe.html'));
  for (const p of archived) {
    const csp = cspMeta(read(p)); if (!csp || parseCsp(csp.policy).get('script-src')?.includes("'unsafe-inline'")) continue;
    for (const s of inlineScripts(read(p))) assert.doesNotMatch(s.text, /cwbhood|href="(index|about)\.html/, `${p}:${s.line}`);
  }
});
