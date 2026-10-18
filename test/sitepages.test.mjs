// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The folder pages wired into the site: /teach/ (for teachers) and /sky/ (the city sky pages, built at each website
// deploy by brand/tools/make_sky_pages.mjs; the repo holds only stand-ins for the two lists, so every link to sky/
// resolves in the download, locally and in the e2e link checks). Each is findable from the pages that should name it, in
// the sitemaps (sitemap.xml is a sitemap index), in the service worker, the download zip and the CSP and a11y checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = p => readFileSync(new URL(p, root), 'utf8');
const SITE = 'https://destinjones.github.io/open-overwatch/';
const hrefs = html => [...html.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)].map(m => m[1]);
const listIn = (file, name) => JSON.parse(read(file).match(new RegExp(`const ${name} = (\\[[^\\]]*\\])`))[1].replace(/'/g, '"'));

test('sitemap.xml is a sitemap index of sitemap-pages.xml and sitemap-sky.xml, both in the repo, both on the site', () => {
  const idx = read('sitemap.xml');
  assert.match(idx, /<sitemapindex xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.doesNotMatch(idx, /<urlset/);
  const locs = [...idx.matchAll(/<sitemap><loc>([^<]+)<\/loc><\/sitemap>/g)].map(m => m[1]);
  assert.deepEqual(locs, [SITE + 'sitemap-pages.xml', SITE + 'sitemap-sky.xml']);
  for (const l of locs) assert.ok(existsSync(new URL(l.slice(SITE.length), root)), l);   // the sky one: a stand-in the deploy overwrites
  assert.match(read('robots.txt'), new RegExp(`^Sitemap: ${SITE.replace(/[.]/g, '\\.')}sitemap\\.xml$`, 'm'));
  assert.match(read('.github/build_site.py'), /date_sitemap\(os\.path\.join\(OUT, "sitemap-pages\.xml"\)\)/, 'the build dates the list of pages');
});

test('every <loc> in sitemap-pages.xml and the sky stand-in is a page in the repo; /teach/ is listed, the sky lists are in theirs', () => {
  const pages = [...read('sitemap-pages.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  const sky = [...read('sitemap-sky.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  assert.ok(pages.includes(SITE + 'teach/'));
  assert.ok(!pages.some(u => u.startsWith(SITE + 'sky/')), 'the city pages are in sitemap-sky.xml only');
  assert.deepEqual(sky, [SITE + 'sky/', SITE + 'sky/hi/']);
  for (const u of [...pages, ...sky]) {
    assert.ok(u.startsWith(SITE), u);
    const p = u.slice(SITE.length);
    assert.ok(existsSync(new URL(p === '' || p.endsWith('/') ? p + 'index.html' : p, root)), u);
  }
});

test('the sky stand-ins: self-canonical, no script, and they point at the website\'s city pages and at Tonight', () => {
  for (const [p, canon, web, tonight] of [['sky/index.html', 'sky/', 'sky/', '../tonight.html'], ['sky/hi/index.html', 'sky/hi/', 'sky/hi/', '../../tonight.html']]) {
    const html = read(p);
    assert.match(html, /^<!doctype html>\n<!-- Copyright \(c\) 2026 Destin Jones\./, p);
    assert.ok(html.includes(`<link rel="canonical" href="${SITE}${canon}">`), p);
    assert.doesNotMatch(html, /<script/, p);
    assert.ok(hrefs(html).includes(SITE + web) && hrefs(html).includes(tonight), p);
  }
  assert.match(read('sky/index.html'), /<p id="in">/, 'india/ links to sky/#in: the stand-in has the anchor too');
  assert.match(read('sky/hi/index.html'), /<html lang="hi">/);
});

test('the pages that should name them link to /sky/ and /teach/', () => {
  for (const p of ['index.html', 'tonight.html', 'guide.html', 'about.html']) assert.ok(hrefs(read(p)).includes('sky/'), `${p} links to sky/`);
  for (const p of ['index.html', 'guide.html', 'about.html']) assert.ok(hrefs(read(p)).includes('teach/'), `${p} links to teach/`);
  assert.match(read('index.html'), /<a href="sky\/">What's in the sky tonight in your city<\/a>/);
  assert.match(read('index.html'), /<footer>[\s\S]*<a href="teach\/">For teachers<\/a>[\s\S]*<\/footer>/);
  // the India page in each language: the list of Indian cities in that language (the other one is hidden by the toggle)
  for (const [p, up] of [['india/index.html', '../'], ['india/hi/index.html', '../../']]) {
    const html = read(p);
    assert.ok(html.includes(`<a class="btn small" href="${up}sky/#in" lang="en">`), p);
    assert.ok(html.includes(`<a class="btn small" href="${up}sky/hi/" lang="hi">`), p);
  }
});

test('the service worker saves /teach/ for offline use, never the 6-hourly sky pages', () => {
  const pages = listIn('sw.js', 'PAGES');
  assert.ok(pages.includes('teach/'));
  assert.ok(!pages.some(p => p.startsWith('sky')));
});

test('the download zip, the CSP check and the accessibility check cover teach/ and the sky stand-ins', () => {
  assert.match(read('.github/workflows/release.yml'), /cp -r india teach sky "\$D\/"/);
  for (const p of ['teach/index.html', 'sky/index.html', 'sky/hi/index.html']) {
    assert.ok(listIn('brand/tools/a11y_check.mjs', 'PAGES').includes(p), `a11y_check.mjs: ${p}`);
    assert.ok(read('brand/tools/sri.mjs').includes(`'${p}'`) && read('test/sri.test.mjs').includes(`'${p}'`), `sri: ${p}`);
    assert.ok(read('test/a11y.test.mjs').includes(`['${p}']`), `a11y.test.mjs: ${p}`);
  }
});
