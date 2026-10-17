// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The city sky pages (brand/tools/make_sky_pages.mjs): three fixture cities built into a temp folder for a fixed date,
// then the pages read back: titles, canonical and hreflang pairs, escaping of a hostile name, the JSON-LD, the CSP and
// accessibility checks every site page passes, the size budget, and the numbers against src/core for that date. Also
// the city list itself (data/cities.json, brand/tools/make_cities.py) and the deploy step in .github/workflows/pages.yml.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { build, writePages, loadCities, nightAnchor, cityFacts, ROOT, CSP, ldJson } from '../brand/tools/make_sky_pages.mjs';
import { riseSet, moonPhase, planetsTonight, darkWindow } from '../src/core/sky.js';
import { decodeAtlas, skyAt } from '../src/core/lightpollution.js';
import { findPasses, ecfAt, compass } from '../src/core/passes.js';
import { observer, sunEcef } from '../src/core/observer.js';
import { parseTle } from '../src/core/tle.js';
import { decodeTonight } from '../src/core/viewlink.js';
import { checkPage, cspMeta } from '../src/core/sricheck.js';
import { checkHtml } from '../src/core/a11ycheck.js';

const sl = await import('satellite.js').then(m => m.default || m, () => null);
const T0 = Date.parse('2026-10-01T06:00:00Z');   // two-thirds of a day after the fixture's ISS epoch (26274.50)
const SITE = 'https://destinjones.github.io/open-overwatch/';
const HOSTILE = 'São <Tomé> & "Co" \'x\'';
const FIXTURE = { source: 'test', cols: ['slug', 'en', 'hi', 'cc', 'lat', 'lon', 'pop', 'tz', 'qid'], rows: [
  ['pune', 'Pune', 'पुणे', 'IN', 18.521, 73.855, 6200000, 'Asia/Kolkata', 'Q1538'],
  ['new-york-city', 'New York City', null, 'US', 40.713, -74.006, 8800000, 'America/New_York', 'Q60'],
  ['sao-tome', HOSTILE, null, 'ST', 0.336, 6.731, 90000, 'Not/A_Zone', null],
] };
const sha256 = t => createHash('sha256').update(t, 'utf8').digest('base64');
const decodeEntities = s => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

const tmp = mkdtempSync(join(tmpdir(), 'oo-sky-'));
const out = join(tmp, 'site'), bare = join(tmp, 'bare');
for (const d of [out, bare]) mkdirSync(join(d, 'data', 'tle'), { recursive: true });
writeFileSync(join(tmp, 'cities.json'), JSON.stringify(FIXTURE));
writeFileSync(join(out, 'data', 'tle', 'stations.txt'), readFileSync(new URL('fixtures/stations.tle', import.meta.url)));
writeFileSync(join(out, 'robots.txt'), 'User-agent: *\nAllow: /');
const result = await build(out, { t0: T0, citiesFile: join(tmp, 'cities.json'), site: SITE, sl });
const bareResult = await build(bare, { t0: T0, citiesFile: join(tmp, 'cities.json'), site: SITE, sl });   // no element sets
test.after(() => rmSync(tmp, { recursive: true, force: true }));
const page = (p, root = out) => readFileSync(join(root, 'sky', p), 'utf8');
const PAGES = ['pune/index.html', 'hi/pune/index.html', 'new-york-city/index.html', 'sao-tome/index.html', 'index.html', 'hi/index.html'];
const links = (html, rel) => [...html.matchAll(/<link rel="(\w+)"(?: hreflang="([\w-]+)")? href="([^"]+)">/g)].filter(m => m[1] === rel).map(m => [m[2] || null, decodeEntities(m[3])]);
const ld = html => JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
const cities = loadCities(FIXTURE), [pune, nyc] = cities;
const atlas = await decodeAtlas(readFileSync(new URL('../data/lightpollution.bin', import.meta.url)));
const hm = (ms, timeZone) => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).format(ms);

test('the files: a page per city, Hindi only for Indian cities, the lists, the stylesheet and the sitemap', () => {
  for (const p of PAGES) assert.ok(existsSync(join(out, 'sky', p)), p);
  assert.ok(!existsSync(join(out, 'sky', 'hi', 'new-york-city')), 'no Hindi page for a city outside India');
  assert.ok(existsSync(join(out, 'sky', 'sky.css')) && existsSync(join(out, 'sitemap-sky.xml')));
  assert.ok(!existsSync(join(out, 'sky.tmp')), 'the temporary folder is moved into place');
  assert.equal(result.cities, 3);
  assert.equal(result.iss, !!sl, 'ISS passes from the site\'s element-set copy');
  assert.ok(!existsSync(join(ROOT, 'sky')), 'the pages are build output, never in the repository');
  assert.throws(() => writePages(ROOT, { t0: T0, cities }), /build output/);
});

test('titles, descriptions and headings: unique, with the city, in the page\'s language', () => {
  const titles = PAGES.map(p => decodeEntities(page(p).match(/<title>([^<]*)<\/title>/)[1]));
  assert.equal(new Set(titles).size, titles.length, titles.join(' | '));
  assert.equal(titles[0], "What's in the sky tonight in Pune, India · Open Overwatch");
  assert.equal(titles[1], 'आज रात पुणे के आसमान में क्या है · Open Overwatch');
  assert.match(page('pune/index.html'), /<meta name="description" content="What&#39;s in the sky tonight in Pune: planets, Moon, ISS passes, how dark your sky is\.">/);
  assert.match(page('pune/index.html'), /<html lang="en">/);
  for (const p of ['hi/pune/index.html', 'hi/index.html']) assert.match(page(p), /<html lang="hi">/, p);
  for (const p of PAGES) assert.equal((page(p).match(/<h1>/g) || []).length, 1, p);
});

test('canonical and hreflang: each page names itself; the English and Hindi pages of an Indian city point at each other', () => {
  const en = `${SITE}sky/pune/`, hi = `${SITE}sky/hi/pune/`;
  assert.deepEqual(links(page('pune/index.html'), 'canonical'), [[null, en]]);
  assert.deepEqual(links(page('hi/pune/index.html'), 'canonical'), [[null, hi]]);
  const pair = [['en', en], ['hi', hi], ['x-default', en]];
  assert.deepEqual(links(page('pune/index.html'), 'alternate'), pair);
  assert.deepEqual(links(page('hi/pune/index.html'), 'alternate'), pair, 'the same set on both, so the pair is reciprocal');
  assert.deepEqual(links(page('new-york-city/index.html'), 'alternate'), [], 'one language, no hreflang');
  assert.match(page('pune/index.html'), /<meta property="og:url" content="https:\/\/destinjones\.github\.io\/open-overwatch\/sky\/pune\/">/);
  assert.match(page('hi/pune/index.html'), /<meta property="og:locale" content="hi_IN">/);
  const map = readFileSync(join(out, 'sitemap-sky.xml'), 'utf8');
  for (const u of [en, hi, `${SITE}sky/new-york-city/`, `${SITE}sky/sao-tome/`, `${SITE}sky/`, `${SITE}sky/hi/`]) assert.ok(map.includes(`<loc>${u}</loc>`), u);
  assert.ok(!map.includes('sky/hi/new-york-city'));
  assert.ok(map.includes(`<xhtml:link rel="alternate" hreflang="hi" href="${hi}"/>`));
  assert.ok(map.includes('<lastmod>2026-10-01</lastmod>'));
});

test('a name with markup in it is escaped everywhere: text, attributes, the live card\'s link and the JSON-LD', () => {
  const html = page('sao-tome/index.html');
  assert.ok(!html.includes('<Tomé>') && !html.includes('"Co"'), 'never raw in the HTML');
  assert.ok(html.includes('São &lt;Tomé&gt; &amp; &quot;Co&quot; &#39;x&#39;'));
  const src = decodeEntities(html.match(/<iframe src="([^"]+)"/)[1]);
  assert.ok(src.startsWith('../../tonight.html#embed=1&'));
  const live = decodeTonight(src.split('#')[1]);
  assert.equal(live.embed, true);
  assert.deepEqual(live.at, { lat: 0.34, lon: 6.73, name: 'São Tomé & "Co" \'x\'' }, 'the card gets the place (core/viewlink.js drops < and >)');
  assert.equal(ld(html).about.name, HOSTILE, 'the JSON-LD carries the name as it is');
  assert.ok(!/<\/|<!--/.test(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]));
  assert.equal(ldJson({ a: '</script><!--' }), '{"a":"\\u003c/script\\u003e\\u003c!--"}');
  assert.match(html, /times are UTC/, 'a time zone this Node does not know: UTC, said so');
});

test('JSON-LD: a WebPage about a Place with its coordinates; the lists are CollectionPages', () => {
  const d = ld(page('pune/index.html'));
  assert.equal(d['@context'], 'https://schema.org');
  assert.equal(d['@type'], 'WebPage');
  assert.equal(d.url, `${SITE}sky/pune/`);
  assert.equal(d.inLanguage, 'en');
  assert.equal(d.dateModified, '2026-10-01T06:00:00.000Z');
  assert.deepEqual(d.about.geo, { '@type': 'GeoCoordinates', latitude: 18.521, longitude: 73.855 });
  assert.equal(d.about['@type'], 'Place');
  assert.equal(d.about.sameAs, 'https://www.wikidata.org/wiki/Q1538');
  assert.equal(ld(page('hi/pune/index.html')).inLanguage, 'hi');
  assert.equal(ld(page('hi/pune/index.html')).about.name, 'पुणे');
  assert.equal(ld(page('index.html'))['@type'], 'CollectionPage');
});

test('every page: the site\'s CSP rules (no inline script), the accessibility check, under 15 KB', () => {
  for (const p of PAGES) {
    const html = page(p);
    assert.deepEqual(checkPage(html, { sha256 }).map(e => `${p}:${e.line} [${e.rule}] ${e.what}`), []);
    assert.equal(cspMeta(html).policy, CSP);
    assert.deepEqual(checkHtml(html).errors.map(e => `${p}:${e.line} [${e.rule}] ${e.what}`), []);
    assert.ok(!/<script>/.test(html), `${p}: no inline script to hash`);
    if (!['index.html', 'hi/index.html'].includes(p)) assert.ok(Buffer.byteLength(html) < 15000, `${p}: ${Buffer.byteLength(html)} bytes`);
  }
  assert.ok(Buffer.byteLength(page('index.html')) < 60000);
  assert.match(page('index.html'), /<script type="module" src="\.\.\/src\/sky\/cityfind\.js"><\/script>/);
  assert.ok(existsSync(new URL('../src/sky/cityfind.js', import.meta.url)), 'the lists\' search script is in the repo');
  assert.match(page('hi/index.html'), /src="\.\.\/\.\.\/src\/sky\/cityfind\.js"/);
  assert.match(page('pune/index.html'), /<link rel="stylesheet" href="\.\.\/sky\.css">/);
  assert.match(page('hi/pune/index.html'), /<link rel="stylesheet" href="\.\.\/\.\.\/sky\.css">/);
});

test('links: the globe, the full Tonight page, the India pages for Indian cities, each language to the other', () => {
  const en = page('pune/index.html'), hi = page('hi/pune/index.html');
  assert.ok(en.includes('href="../../globe.html#go=tonight&amp;at=18.52,73.86&amp;name=Pune"'));
  assert.ok(en.includes('href="../../tonight.html#at=18.52,73.86&amp;name=Pune"'));
  assert.ok(en.includes('href="../../india/"') && hi.includes('href="../../../india/hi/"'));
  assert.ok(en.includes('href="../hi/pune/"') && hi.includes('href="../../pune/"'));
  assert.ok(hi.includes('src="../../../tonight.html#embed=1&amp;at=18.52,73.86&amp;name=Pune"'));
  assert.ok(!page('new-york-city/index.html').includes('india/'));
  assert.ok(page('index.html').includes('<a href="pune/">Pune</a>') && page('hi/index.html').includes('<a href="pune/">पुणे</a>'));
  assert.ok(!page('hi/index.html').includes('new-york-city'), 'the Hindi list is India\'s cities');
});

test('the numbers on the page are src/core\'s for that city and date', () => {
  for (const c of [pune, nyc]) {
    const html = decodeEntities(page(`${c.slug}/index.html`)), anchor = nightAnchor(c.lon, T0), t = ms => hm(ms, c.tz);
    const set = riseSet('sun', c.lat, c.lon, anchor, { hours: 24 }).set, rise = riseSet('sun', c.lat, c.lon, set, { hours: 24 }).rise;
    assert.ok(html.includes(`sets ${t(set)}, rises ${t(rise)}`), `${c.en}: sunset ${t(set)}`);
    const dark = darkWindow(c.lat, c.lon, anchor), mp = moonPhase(dark.start);
    assert.ok(html.includes(`dark enough for the bright stars ${t(dark.start)} to ${t(dark.end)}`));
    assert.ok(html.includes(`${mp.name}, ${Math.round(mp.lit * 100)}% lit`), `${c.en}: the Moon`);
    const mr = riseSet('moon', c.lat, c.lon, anchor, { hours: 24 });
    for (const x of [mr.rise, mr.set].filter(Boolean)) assert.ok(html.includes(t(x)), `${c.en}: moonrise/set ${t(x)}`);
    const up = planetsTonight(c.lat, c.lon, anchor, { time: t }).filter(p => p.up);
    assert.ok(up.length > 0);
    for (const p of up) assert.ok(html.includes(p.text), `${c.en}: ${p.text}`);
    const s = skyAt(atlas, c.lat, c.lon);
    assert.ok(html.includes(`Bortle class ${s.bortle} (`) && html.includes(`about ${s.sqm.toFixed(1)} mag/arcsec²`), `${c.en}: Bortle ${s.bortle}`);
    if (sl) {
      const iss = parseTle(readFileSync(new URL('fixtures/stations.tle', import.meta.url), 'utf8')).find(x => x.id === '25544');
      const pass = findPasses(ecfAt(sl, sl.twoline2satrec(iss.l1, iss.l2)), observer(c.lat, c.lon, 0), T0, T0 + 72 * 3600e3, { step: 30e3, minEl: 10, sunAt: sunEcef }).find(p => p.visible);
      const day = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: c.tz }).format(pass.rise);
      assert.ok(html.includes(`next visible pass ${day} ${t(pass.rise)}: look ${compass(pass.azRise)}, it climbs to ${Math.round(pass.maxEl)}°`), `${c.en}: ISS ${day} ${t(pass.rise)}`);
    }
  }
  assert.match(page('pune/index.html'), /Computed 2026-10-01 06:00 UTC for the night of Thursday, 1 October 2026; times are Pune&#39;s clock \(Asia\/Kolkata, GMT\+5:30\)\. The live card below updates\./);
  assert.match(page('hi/pune/index.html'), /2026-10-01 06:00 UTC पर गणना/);
  assert.match(page('hi/pune/index.html'), /बोर्टल श्रेणी \d/);
  // binoculars: three deep-sky targets, brightest first, the same as cityFacts gives
  const f = cityFacts(pune, T0, { deepsky: [{ id: 'NGC 1', m: 45, type: 'OCl', ra: 56.75, dec: 24.12, mag: 1.6, name: 'Pleiades' }] });
  assert.equal(f.deep.length, 1);
  assert.match(page('pune/index.html'), /<dt>For binoculars<\/dt><dd><ol>(<li>[^<]+<\/li>){3}<\/ol>/);
});

test('without element sets the ISS line is left out, and the rest is still there', () => {
  assert.equal(bareResult.iss, false);
  const html = page('pune/index.html', bare);
  assert.ok(!html.includes('Space station') && !html.includes('next visible pass'));
  assert.ok(html.includes('<dt>Moon</dt>') && html.includes('<dt>Sky darkness</dt>'));
  assert.ok(!existsSync(join(bare, 'robots.txt')), 'no robots.txt to add to: none made');
});

test('robots.txt names the city sitemap once, however often the pages are rebuilt', () => {
  writePages(out, { t0: T0, cities, site: SITE });
  const lines = readFileSync(join(out, 'robots.txt'), 'utf8').split('\n');
  assert.deepEqual(lines.filter(l => l.startsWith('Sitemap:')), [`Sitemap: ${SITE}sitemap-sky.xml`]);
  assert.ok(lines.includes('Allow: /'), 'what was there stays');
});

test('the night a page shows: the one under way until about 3 a.m. local solar time, else the coming one', () => {
  const noon = (lon, ms) => ((ms / 3600e3 + lon / 15) % 24 + 24) % 24;
  for (const lon of [-170, -74, 0, 73.9, 151]) for (let h = 0; h < 24; h += 1) {
    const t0 = Date.parse('2026-10-01T00:00:00Z') + h * 3600e3, a = nightAnchor(lon, t0), solar = noon(lon, t0);
    assert.ok(Math.abs(noon(lon, a) - 12) < 1e-6, 'a local solar noon');
    if (solar >= 12 || solar < 3) assert.ok(a <= t0 && t0 - a < 15 * 3600e3, `lon ${lon}, solar ${solar}: the night under way`);
    else assert.ok(a > t0 && a - t0 <= 9 * 3600e3, `lon ${lon}, solar ${solar}: tonight`);
  }
});

test('data/cities.json: Wikidata, ~400 world cities plus India\'s, unique ASCII slugs, Hindi names for India, known time zones', () => {
  const doc = JSON.parse(readFileSync(new URL('../data/cities.json', import.meta.url), 'utf8')), list = loadCities(doc);
  assert.match(doc.source, /Wikidata \(CC0/);
  assert.match(doc.asked, /^\d{4}-\d\d-\d\d$/);
  assert.ok(list.length >= 400 && list.length <= 600, `${list.length} cities`);
  assert.equal(new Set(list.map(c => c.slug)).size, list.length, 'unique slugs');
  const india = list.filter(c => c.cc === 'IN');
  assert.ok(india.length >= 60, `${india.length} Indian cities`);
  for (const c of list) {
    assert.ok(Number.isFinite(c.lat) && Math.abs(c.lat) <= 90 && Number.isFinite(c.lon) && Math.abs(c.lon) <= 180, c.slug);
    assert.match(c.cc, /^[A-Z]{2}$/);
    assert.ok(c.tz, `${c.slug}: a time zone`);
    assert.equal(c.hi != null, c.cc === 'IN', `${c.slug}: a Hindi name only for India`);
    if (c.cc === 'IN') { assert.equal(c.tz, 'Asia/Kolkata'); assert.match(c.hi, /[\u0900-\u097f]/); }
    assert.match(c.qid, /^Q\d+$/);
  }
  for (const s of ['pune', 'delhi', 'mumbai', 'new-york-city', 'sao-paulo', 'tokyo', 'london', 'mexico-city']) assert.ok(list.some(c => c.slug === s), s);
  const tz = Object.fromEntries(list.map(c => [c.slug, c.tz]));
  assert.equal(tz.dallas, 'America/Chicago', 'the hand-checked zone (the nearest zone.tab city is Vincennes, on Eastern time)');
  assert.equal(tz['los-angeles'], 'America/Los_Angeles');
  assert.ok(!list.some(c => /metropolitan|province/i.test(c.en)), 'areas fold into their city');
});

test('the website build runs the generator after build_site.py, with Node set up as CI does and actions pinned', () => {
  const yml = readFileSync(new URL('../.github/workflows/pages.yml', import.meta.url), 'utf8');
  const at = s => { const i = yml.indexOf(s); assert.ok(i > 0, s); return i; };
  const build = at('python3 .github/build_site.py _site'), node = at('node brand/tools/make_sky_pages.mjs _site'), upload = at('actions/upload-pages-artifact@');
  assert.ok(build < node && node < upload, 'after the site is built, before it is uploaded');
  assert.ok(at('actions/setup-node@') < node && at('npm ci --omit=dev') < node);
  for (const [, ref] of yml.matchAll(/uses: [\w/-]+@(\S+)/g)) assert.match(ref, /^[0-9a-f]{40}$/, 'pinned by SHA');
  const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.ok(ci.includes(yml.match(/uses: (actions\/setup-node@\S+)/)[1]), 'the same setup-node as CI');
  // the /v/ copies come from git archive of the tags in build_site.py, which runs first and never sees sky/
  assert.ok(!readFileSync(new URL('../.github/build_site.py', import.meta.url), 'utf8').includes("'sky'"));
  assert.ok(!readdirSync(ROOT).includes('sky'));
});
