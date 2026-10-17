// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The India landing page (india/index.html, src/core/india.js): every deep link decodes into the view it promises, both
// languages are there for every piece of text, nothing tracks, and the launch, pass and address logic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { decodeView, decodeExtras } from '../src/core/viewlink.js';
import { decodeSolarView } from '../src/core/solarlink.js';
import { trackPosition, moonCenterAt } from '../src/core/craft.js';
import { jdFromMs } from '../src/core/time.js';
import { LAYERS, WEATHER } from '../mcp/place.mjs';
import { parseTle } from '../src/core/tle.js';
import { ecfAt } from '../src/core/passes.js';
import { cleanUrl, fromIndia, indianLaunches, launchWhen, dir8, CITIES, cityPasses, overIndia, inSouthAsia } from '../src/core/india.js';
import { build, hindiPage, EN_URL, HI_URL, HI } from '../brand/tools/india_hi.mjs';

const root = new URL('../', import.meta.url);
const read = p => readFileSync(new URL(p, root), 'utf8');
const html = read('india/index.html');
const body = html.slice(html.indexOf('<body'));
const hrefs = [...body.matchAll(/href="([^"]+)"/g)].map(m => m[1].replace(/&amp;/g, '&'));

test('every globe link opens a view (or a panel) over India with layers the globe has', () => {
  const globe = hrefs.filter(h => h.startsWith('../globe.html#'));
  assert.ok(globe.length >= 15, `${globe.length} globe links`);
  for (const h of globe) {
    const hash = h.slice(h.indexOf('#'));
    const v = decodeView(hash);
    if (!v) { assert.ok(decodeExtras(hash).go, `${h}: neither a view nor a panel`); continue; }
    assert.ok(v.lon > 60 && v.lon < 100 && v.lat > 5 && v.lat < 40, `${h}: the camera is not over India`);
    for (const id of [...(v.add || []), ...(v.drop || []), ...(v.layers || [])]) assert.ok(LAYERS.includes(id), `${h}: no layer ${id}`);
    for (const id of v.weather || []) assert.ok(WEATHER.includes(id), `${h}: no weather source ${id}`);
    if (v.weather) assert.ok(v.height >= 3e6, `${h}: weather links show the whole Earth`);
    if (v.sat) assert.match(v.sat, /^(25544|44804|65053)$/, `${h}: a satellite the page names`);
    assert.ok(!(v.add || []).includes('air') && !(v.add || []).includes('mil'), `${h}: the website has no live aircraft to show`);
  }
  // the launch panel links carry Launch Library 2 ids the page fills in (and one plain one)
  assert.ok(globe.some(h => decodeExtras(h.slice(h.indexOf('#'))).go === 'launches'));
});

test('the 2D map, Solar System and Tonight links', t => {
  const map = hrefs.filter(h => h.startsWith('../open-overwatch.html#'));
  assert.equal(map.length, 1);
  const v = decodeView(map[0].slice(map[0].indexOf('#')));
  assert.ok(v && v.lon === 80 && v.lat === 22 && v.add.includes('quakes'));
  const solar = hrefs.filter(h => h.startsWith('../solar.html#'));
  // ISRO's missions: every link focuses a craft in the Solar System view's data, at a time it has a position
  const craft = JSON.parse(read('data/solar/spacecraft.json')), views = solar.map(h => decodeSolarView(h.slice(h.indexOf('#'))));
  assert.deepEqual([...new Set(views.map(v => v.focus))], ['craft:Chandrayaan-2', 'craft:Aditya-L1', 'craft:Vikram lander (Chandrayaan-3)', 'craft:Mars Orbiter Mission', 'craft:Chandrayaan-1']);
  for (const v of views) {
    const c = craft.find(x => 'craft:' + x.name === v.focus);
    assert.ok(c && c.agency === 'ISRO', v.focus);
    const jd = v.jd ?? jdFromMs(Date.UTC(2026, 9, 17));
    assert.ok(trackPosition(c, jd, {}, moonCenterAt), `${v.focus}: a position at ${v.jd ?? 'today'}`);
    // a "now" link (no &t=) shows "No published position after <date>" once the track runs out (Chandrayaan-2 2026-11-08,
    // Aditya-L1 2027-01-19). Warn two weeks ahead, on the real date, without failing CI for an unrelated change: the
    // refresh is python brand/tools/make_spacecraft.py --only "Chandrayaan-2,Aditya-L1" (ROADMAP)
    if (v.jd == null && !trackPosition(c, jdFromMs(Date.now()) + 14, {}, moonCenterAt))
      t.diagnostic(`WARNING ${v.focus}: its track ends ${new Date((c.end_jd - 2440587.5) * 864e5).toISOString().slice(0, 10)}; rerun python brand/tools/make_spacecraft.py --only "Chandrayaan-2,Aditya-L1"`);
  }
  // the Hindi page (/india/hi/, one folder deeper) carries the same missions and none of the old "not drawn" copy
  if (existsSync(new URL('india/hi/index.html', root))) {
    const hi = read('india/hi/index.html');
    assert.doesNotMatch(hi, /not drawn|ख़ुद नहीं/, 'india/hi/: the missions are drawn now');
    const hiFocus = new Set([...hi.matchAll(/href="\.\.\/\.\.\/solar\.html(#[^"]*)"/g)].map(m => decodeSolarView(m[1].replace(/&amp;/g, '&')).focus));
    for (const f of new Set(views.map(v => v.focus))) assert.ok(hiFocus.has(f), `india/hi/: links ${f} (as ../../solar.html#…)`);
  }
  assert.match(read('src/solar/spacecraft.js'), /'L1', 'Sun-Earth L1', '[^']*Aditya-L1/, 'the L1 card names Aditya-L1');
  assert.doesNotMatch(body, /not drawn|ख़ुद नहीं/, 'the page no longer says the missions are missing');
  assert.ok(hrefs.includes('../tonight.html'));
  for (const h of hrefs.filter(h => h.startsWith('../') && !h.includes('#'))) {
    const f = h.slice(3) || 'index.html';
    assert.ok(existsSync(new URL(f.endsWith('/') ? f + 'index.html' : f, root)), h);
  }
});

test('both languages for every piece of text, and lang attributes on each', () => {
  const en = (body.match(/<span lang="en"/g) || []).length, hi = (body.match(/<span lang="hi"/g) || []).length;
  assert.ok(en > 100, `${en} English pieces`);
  assert.equal(en, hi, 'every English piece has its Hindi one');
  for (const m of body.matchAll(/<span lang="hi"[^>]*>([^<]*)/g)) if (m[1].trim()) assert.match(m[1], /[ऀ-ॿ]|^[\w\s.·:/()-]+$/u, `Hindi text without Devanagari: ${m[1]}`);
  assert.match(html, /<html lang="en" data-lang="en">/, 'English by default');
  // the head script picks the language before the page paints; the choice is kept with try/catch around storage
  const head = html.slice(0, html.indexOf('</head>')), inline = head.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.match(inline, /localStorage\.getItem\('oo-lang'\)/);
  assert.equal((inline.match(/try \{/g) || []).length, 3);
  assert.ok(head.indexOf('<script>') < head.indexOf('<link rel="stylesheet"'), 'the language is set before the styles apply');
});

test('a self-hosted Devanagari font, with its licence; no Google Fonts', () => {
  const css = read('brand/fonts/fonts.css');
  assert.match(css, /font-family: 'Noto Sans Devanagari';[^}]*url\(noto-sans-devanagari-var-devanagari\.woff2\)[^}]*unicode-range: U\+0900-097F/);
  assert.ok(statSync(new URL('brand/fonts/noto-sans-devanagari-var-devanagari.woff2', root)).size > 50e3);
  assert.match(read('brand/fonts/OFL-notosansdevanagari.txt'), /SIL Open Font License, Version 1\.1/);
  assert.match(html, /--deva:"Noto Sans Devanagari"/);
  assert.doesNotMatch(html, /fonts\.(googleapis|gstatic)\.com/);
});

test('no tracking: no pixel, no analytics, utm tags only removed', () => {
  const js = read('india/india.js');
  for (const t of [html, js]) assert.doesNotMatch(t, /fbq\(|connect\.facebook|facebook\.net|gtag\(|googletagmanager|google-analytics|plausible|clarity\.ms|document\.cookie/i);
  assert.ok(!/utm_/.test(js.replace(/\/\/.*$/gm, '')), 'india.js never reads utm_ parameters itself (src/core/india.js cleanUrl does the removal)');
  assert.equal(cleanUrl('https://destinjones.github.io/open-overwatch/india/?utm_source=meta&utm_medium=paid_social&utm_campaign=in_launch&fbclid=AbC'), 'https://destinjones.github.io/open-overwatch/india/');
  assert.equal(cleanUrl('https://destinjones.github.io/open-overwatch/india/?lang=hi&utm_content=v1#iss'), 'https://destinjones.github.io/open-overwatch/india/?lang=hi');
  assert.match(html, /<meta property="og:image" content="https:\/\/destinjones\.github\.io\/open-overwatch\/brand\/india\/og-india-1200x630\.jpg">/);
  assert.ok(existsSync(new URL('brand/india/og-india-1200x630.jpg', root)));
});

test('the site ships the page: service worker, sitemap, guide, the main page footer', () => {
  assert.match(read('sw.js'), /const PAGES = \[[^\]]*'india\/'/);
  assert.match(read('sitemap.xml'), /<loc>https:\/\/destinjones\.github\.io\/open-overwatch\/india\/<\/loc>/);
  assert.match(read('guide.html'), /href="india\/"/);
  assert.match(read('index.html'), /<footer>[\s\S]*href="india\/"/);
  for (const c of ['india_sats', 'delhi_dive', 'airq', 'lookup']) {
    assert.match(body, new RegExp(`data-clip="${c}"`));
    for (const ext of ['mp4', 'jpg']) assert.ok(statSync(new URL(`brand/india/clips/${c}.${ext}`, root)).size > 10e3, `${c}.${ext}`);
  }
});

test('launches from India, and when they are due only as precisely as announced', () => {
  const pad = (name, cc) => ({ location: { name, country_code: cc } });
  const now = Date.parse('2026-10-15T12:00:00Z');
  const list = [
    { id: 'a', net: '2026-12-31T00:00:00Z', net_precision: { abbrev: 'M' }, pad: pad('Satish Dhawan Space Centre, India') },
    { id: 'b', net: '2026-10-20T09:30:00Z', net_precision: { abbrev: 'MIN' }, pad: pad('Cape Canaveral SFS, FL, USA', 'USA') },
    { id: 'c', net: '2026-10-31T00:00:00Z', net_precision: { abbrev: 'M' }, pad: pad('Somewhere', 'IND') },
    { id: 'd', net: '2026-10-14T09:30:00Z', net_precision: { abbrev: 'SEC' }, pad: pad('Satish Dhawan Space Centre, India') },   // flown
    null, 'junk',
  ];
  assert.deepEqual(indianLaunches(list, now).map(r => r.id), ['c', 'a']);
  assert.ok(fromIndia(list[0]) && !fromIndia(list[1]) && !fromIndia({}));
  assert.equal(launchWhen(list[2], 'en'), 'target: October 2026');
  assert.match(launchWhen(list[2], 'hi'), /^लक्ष्य: अक्[तट]ूबर 2026$/);
  assert.equal(launchWhen({ net: '2026-10-20T09:30:00Z', net_precision: { abbrev: 'MIN' } }, 'en'), '20 Oct 2026, 3:00 pm IST');
  // Launch Library 2's real codes (lldev.thespacedevs.com netprecision): DAY, not D; WK, not W; Q1-Q4 and H1/H2
  assert.equal(launchWhen({ net: '2026-10-20T20:00:00Z', net_precision: { abbrev: 'DAY', name: 'Day' } }, 'en'), '21 Oct 2026', 'the day in India');
  assert.match(launchWhen({ net: '2026-10-29T00:00:00Z', net_precision: { abbrev: 'DAY' } }, 'hi'), /^29 अक्[तट]ू?॰? 2026$/u);
  assert.equal(launchWhen({ net: '2026-10-29T00:00:00Z', net_precision: { name: 'Day' } }, 'en'), '29 Oct 2026', 'the name when there is no abbrev');
  assert.equal(launchWhen({ net: '2026-10-29T00:00:00Z', net_precision: { abbrev: 'D' } }, 'en'), '29 Oct 2026', 'the old code still reads as a day');
  assert.equal(launchWhen({ net: '2026-12-31T00:00:00Z', net_precision: { abbrev: 'Q4', name: 'Quarter 4' } }, 'en'), 'target: Q4 2026');
  assert.equal(launchWhen({ net: '2026-12-31T00:00:00Z', net_precision: { abbrev: 'Q4' } }, 'hi'), 'लक्ष्य: 2026 की चौथी तिमाही');
  assert.equal(launchWhen({ net: '2027-06-30T00:00:00Z', net_precision: { abbrev: 'H1' } }, 'en'), 'target: H1 2027');
  assert.equal(launchWhen({ net: '2027-06-30T00:00:00Z', net_precision: { abbrev: 'H1' } }, 'hi'), 'लक्ष्य: 2027 की पहली छमाही');
  assert.equal(launchWhen({ net: '2026-11-30T00:00:00Z', net_precision: { abbrev: 'M' } }, 'en'), 'target: November 2026');
  assert.match(launchWhen({ net: '2026-11-30T00:00:00Z', net_precision: { abbrev: 'M' } }, 'hi'), /^लक्ष्य: नवंबर 2026$/u);
  assert.equal(launchWhen({ net: '2026-11-30T00:00:00Z', net_precision: { abbrev: 'WK' } }, 'en'), 'target: November 2026');
  assert.equal(launchWhen({ net: '2027-12-31T00:00:00Z', net_precision: { abbrev: 'Y' } }, 'hi'), 'लक्ष्य: 2027');
  assert.equal(launchWhen({ net: 'soon' }, 'en'), 'date to be set');
});

test('an imprecise Indian launch stays listed until the period it names is over', () => {
  const shar = { location: { name: 'Satish Dhawan Space Centre, India' } };
  const list = [
    { id: 'oct', net: '2026-10-31T00:00:00Z', net_precision: { abbrev: 'M', name: 'Month' }, pad: shar },   // "NET October"
    { id: 'day', net: '2026-10-31T00:00:00Z', net_precision: { abbrev: 'DAY' }, pad: shar },
    { id: 'q4', net: '2026-12-31T00:00:00Z', net_precision: { abbrev: 'Q4' }, pad: shar },
    { id: 'min', net: '2026-10-31T00:00:00Z', net_precision: { abbrev: 'MIN' }, pad: shar },
  ];
  const ids = at => indianLaunches(list, Date.parse(at)).map(r => r.id).sort();
  assert.deepEqual(ids('2026-10-31T00:30:00Z'), ['day', 'min', 'oct', 'q4']);
  assert.deepEqual(ids('2026-10-31T01:30:00Z'), ['day', 'oct', 'q4'], 'a precise time goes an hour after it');
  assert.deepEqual(ids('2026-10-31T12:00:00Z'), ['day', 'oct', 'q4'], 'still due "in October" on 31 October');
  assert.deepEqual(ids('2026-11-01T03:00:00Z'), ['q4'], 'October is over');
  assert.deepEqual(ids('2026-12-31T23:00:00Z'), ['q4']);
  assert.deepEqual(ids('2027-01-01T00:00:01Z'), []);
});

test('screen readers: a quiet live strip, a pausable demo with real tabs, and labels in the language they are in', () => {
  const js = read('india/india.js');
  // the strip's clock ticks every second and the ISS every 10 s: no live region around them (WCAG 4.1.3 noise)
  const feed = body.match(/<aside class="feed[^"]*"[^>]*>[\s\S]*?<\/aside>/)[0];
  assert.doesNotMatch(feed, /aria-live/, 'the live strip is not a live region');
  assert.match(feed, /id="ist"/);
  // the clips: a pause control, one round and no endless loop (WCAG 2.2.2)
  const video = js.slice(js.indexOf('// ---- phone demo'), js.indexOf('// ---- share'));
  assert.match(video, /if \(!pv\.paused && !pv\.ended\) \{ want = false; pv\.pause\(\); \}/, '#phonePlay pauses a running clip');
  assert.match(video, /'Pause the recordings'/);
  assert.match(video, /playBtn\.hidden = false/, 'the button stays on screen while the clips run');
  assert.match(video, /if \(auto && cur < tabs\.length - 1\) show\(cur \+ 1, true\); else \{ want = false;/, 'auto-advance stops after the last clip');
  assert.doesNotMatch(video, /% tabs\.length\)\)|pv\.currentTime = 0, pv\.play/, 'no endless cycle, no endless loop of a picked clip');
  assert.match(video, /else if \(want\) pv\.play\(\)/, 'scrolling back does not undo a pause');
  assert.match(body, /<button class="play" id="phonePlay"[^>]*>(?=[\s\S]*?class="i-play")(?=[\s\S]*?class="i-pause")/, 'a play and a pause icon');
  // the tabs: a tab list with a panel, roving tabindex and arrow keys
  assert.match(body, /<div class="tabs" role="tablist" aria-label="Clips" aria-orientation="vertical">/);
  assert.match(body, /<div class="screen" id="clipPanel" role="tabpanel">/);
  assert.match(video, /t\.setAttribute\('aria-controls', panel\.id\)/);
  assert.match(video, /t\.tabIndex = j === i \? 0 : -1/);
  assert.match(video, /ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1/);
  // the language button speaks in its label's language, and the CSS never hides it for that (class="keep")
  assert.match(body, /<button class="btn small lang-btn keep" id="langBtn"/);
  assert.match(js, /langBtn\.lang = l === 'hi' \? 'en' : 'hi';/);
  assert.match(html, /:root\[data-lang=en\] \[lang=hi\]:not\(\.keep\)/, 'the hiding rule spares .keep');
  // the Clips list and the recording are named in the page's language too
  assert.match(js, /\$\('\.tabs'\)\.setAttribute\('aria-label', l === 'hi' \? 'क्लिप' : 'Clips'\)/);
  assert.match(js, /\$\('#phoneVid'\)\.setAttribute\('aria-label', l === 'hi' \? '[^']*[ऀ-ॿ][^']*' : 'A recording of the globe over India'\)/u);
});

test('the forecast promise matches the globe: five days, three on phones', () => {
  assert.match(read('src/globe/model.js'), /export const MAX_H = PHONE \? 72 : 120;/, 'the globe still stops at 72 h on phones');
  for (const page of [body, hiHtml.slice(hiHtml.indexOf('<body'))]) {
    assert.match(page, /NOAA GFS forecast up to five days ahead \(three on phones\)/);
    assert.match(page, /पाँच दिन आगे तक \(फ़ोन पर तीन दिन\)/);
  }
  assert.doesNotMatch(body, /five days ahead,/);
});

test('the six cities, the ISS passes over them, and the directions in two languages', async () => {
  assert.equal(CITIES.length, 6);
  for (const [, hi, lat, lon] of CITIES) { assert.match(hi, /^[ऀ-ॿ]+$/); assert.ok(overIndia(lat, lon)); }
  assert.ok(!overIndia(51.5, -0.1) && inSouthAsia([84.7, 28.2]) && !inSouthAsia([139.7, 35.7]));
  assert.equal(dir8(0, 'en'), 'N'); assert.equal(dir8(224, 'hi'), 'दक्षिण-पश्चिम'); assert.equal(dir8(359, 'hi'), 'उत्तर'); assert.equal(dir8(-90, 'en'), 'W');
  const sl = await import('satellite.js');
  const iss = parseTle(read('test/fixtures/stations.tle')).find(s => s.id === '25544');
  const epoch = Date.UTC(2000 + +iss.l1.slice(18, 20), 0, 1) + (+iss.l1.slice(20, 32) - 1) * 864e5;
  const pos = ecfAt(sl, sl.twoline2satrec(iss.l1, iss.l2));
  for (const [name, , lat, lon] of CITIES) {
    const { next, visible } = cityPasses(pos, lat, lon, epoch, 7);
    assert.ok(next, `${name}: the ISS passes over every one of these cities within a week`);
    assert.ok(next.rise < next.peak && next.peak < next.set && next.maxEl >= 10 && next.set - next.rise < 15 * 60e3, name);
    if (visible) assert.ok(visible.visible && visible.rise >= next.rise, name);
  }
});

// ---- the Hindi page (india/hi/): its own address for search and Hindi ads, made from the English one
const hiHtml = read('india/hi/index.html');
const PAGE_OF_URL = { [EN_URL]: html, [HI_URL]: hiHtml };
const linkTags = h => [...h.slice(0, h.indexOf('</head>')).matchAll(/<link rel="(canonical|alternate)"(?: hreflang="([^"]+)")? href="([^"]+)">/g)].map(m => ({ rel: m[1], lang: m[2], href: m[3] }));

test('india/hi/index.html is india/index.html made Hindi, and up to date (node brand/tools/india_hi.mjs)', () => {
  assert.equal(hiHtml, build(root), 'india/hi/index.html is out of date: run node brand/tools/india_hi.mjs');
  const hiBody = hiHtml.slice(hiHtml.indexOf('<body'));
  // the same page one folder deeper: the body differs only in its paths and the picture's alt text
  const norm = b => b.replace(/ src="(\.\.\/)?india\.js"/, ' src="INDIA_JS"').replace(/ (href|src|srcset|poster)="(\.\.\/)+/g, ' $1="UP/').replace(/ alt="[^"]*" data-alt-hi="([^"]*)"(?: data-alt-en="[^"]*")?/g, ' data-alt-hi="$1"');
  assert.equal(norm(hiBody), norm(body));
  assert.match(hiHtml, /<html lang="hi" data-lang="hi" data-home="hi">/, 'opens in Hindi');
  assert.match(hiHtml, /<script type="module" src="\.\.\/india\.js"><\/script>/, 'the same india.js');
  const hiHrefs = [...hiHtml.matchAll(/ (?:href|src|srcset|poster)="([^"#]+)/g)].map(m => m[1]).filter(h => !/^https?:/.test(h));
  assert.ok(hiHrefs.length > 20, `${hiHrefs.length} links`);
  for (const h of hiHrefs) {
    const f = new URL(h, new URL('india/hi/index.html', root));
    assert.ok(existsSync(f.pathname.endsWith('/') ? new URL('index.html', f) : f), `india/hi/: ${h} does not resolve`);
  }
});

test('india_hi.mjs stops rather than ship English alt text on the Hindi page', () => {
  for (const [, alt] of hiHtml.slice(hiHtml.indexOf('<body')).matchAll(/<img\b[^>]* alt="([^"]*)" data-alt-hi=/g)) assert.match(alt, /[ऀ-ॿ]/, alt);
  const flipped = html.replace(/ alt="([^"]*)" data-alt-hi="([^"]*)"/, ' data-alt-hi="$2" alt="$1"');
  assert.notEqual(flipped, html, 'the English page has a data-alt-hi picture');
  assert.throws(() => hindiPage(flipped, () => ''), /data-alt-hi/);
});

test('the Hindi head: title, description and share card in Hindi', () => {
  const head = hiHtml.slice(0, hiHtml.indexOf('</head>')), meta = n => (head.match(new RegExp(`<meta (?:name|property)="${n}" content="([^"]*)">`)) || [])[1];
  assert.equal(head.match(/<title>([^<]*)<\/title>/)[1], HI.title);
  assert.ok(read('india/india.js').includes(`hi: '${HI.title}'`), 'india.js names the page the same when the toggle switches back');
  for (const n of ['description', 'og:title', 'og:description', 'og:image:alt', 'twitter:title', 'twitter:description']) assert.match(meta(n), /[ऀ-ॿ]/, `${n} in Hindi`);
  assert.equal(meta('og:url'), HI_URL);
  assert.equal(meta('og:locale'), 'hi_IN'); assert.equal(meta('og:locale:alternate'), 'en_IN');
  const ld = JSON.parse(head.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(ld['@id'], HI_URL); assert.equal(ld.inLanguage, 'hi-IN');
});

test('hreflang: each language has its own self-canonical page, and both pages name the same pair', () => {
  for (const [url, page] of Object.entries(PAGE_OF_URL)) {
    const links = linkTags(page);
    assert.deepEqual(links.filter(l => l.rel === 'canonical').map(l => l.href), [url], `${url} is its own canonical`);
    assert.deepEqual(links.filter(l => l.rel === 'alternate').map(l => [l.lang, l.href]), [['en-IN', EN_URL], ['hi-IN', HI_URL], ['x-default', EN_URL]]);
    for (const l of links.filter(l => l.rel === 'alternate')) {   // Google drops an alternate whose page canonicalises elsewhere
      assert.ok(PAGE_OF_URL[l.href], `${l.href} is one of the two pages`);
      assert.deepEqual(linkTags(PAGE_OF_URL[l.href]).filter(c => c.rel === 'canonical').map(c => c.href), [l.href], `${l.href} is self-canonical`);
    }
  }
  assert.match(read('sitemap.xml'), /<loc>https:\/\/destinjones\.github\.io\/open-overwatch\/india\/hi\/<\/loc>/);
  assert.match(read('sw.js'), /const PAGES = \[[^\]]*'india\/hi\/'/, 'the installed app keeps the Hindi page offline');
  assert.match(read('brand/tools/sri.mjs'), /'india\/hi\/index\.html'/, 'the CSP and SRI check covers it');
  assert.match(read('index.html'), /<footer>[\s\S]*href="india\/hi\/" lang="hi"/, 'the main page sends Hindi readers to the Hindi page');
});

test('the head script: india/ follows the remembered choice, india/hi/ opens in Hindi unless ?lang=en', () => {
  const inline = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.equal(hiHtml.match(/<script>([\s\S]*?)<\/script>/)[1], inline, 'one script (and one CSP hash) for both pages');
  const run = (home, search, stored) => {
    const attrs = home ? { 'data-home': home } : {}, store = stored ? { 'oo-lang': stored } : {};
    const d = { lang: '', getAttribute: k => attrs[k] ?? null, setAttribute: (k, v) => { attrs[k] = v; } };
    new Function('document', 'location', 'localStorage', inline)({ documentElement: d }, { search }, { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; } });
    assert.equal(attrs['data-lang'], d.lang);
    return d.lang;
  };
  assert.equal(run(null, '', null), 'en');
  assert.equal(run(null, '', 'hi'), 'hi', 'india/ remembers a Hindi reader');
  assert.equal(run(null, '?lang=hi', null), 'hi');
  assert.equal(run('hi', '', null), 'hi');
  assert.equal(run('hi', '', 'en'), 'hi', 'india/hi/ is Hindi even after English was picked on india/');
  assert.equal(run('hi', '?lang=en&utm_source=meta', null), 'en', 'the toggle on india/hi/ writes ?lang=en, so a reload keeps English');
});

test('india.js reaches site files from its own address, so india/ and india/hi/ both work', () => {
  const js = read('india/india.js').replace(/^import .*$/gm, '').replace(/new URL\('\.\.\/', import\.meta\.url\)/, 'SITE_URL');
  assert.doesNotMatch(js, /['"`]\.\.\//, 'no document-relative ../ paths (they break one folder deeper)');
  assert.match(js, /const SITE = SITE_URL/);
  // the shared shell knows both addresses as the India page (accessibility layer, installable app)
  const src = read('src/app/shell.js'), at = src.indexOf('export function pageOf');
  const pageOf = new Function(src.slice(at, src.indexOf('\n}\n', at) + 2).replace('export function pageOf', 'return function pageOf'))();
  for (const p of ['/open-overwatch/india/', '/open-overwatch/india/index.html', '/open-overwatch/india/hi/', '/open-overwatch/v/v0.9.2.15/india/hi/index.html']) assert.equal(pageOf(p), 'india', p);
  assert.equal(pageOf('/open-overwatch/'), 'index'); assert.equal(pageOf('/open-overwatch/hi/'), 'index'); assert.equal(pageOf('/open-overwatch/globe.html'), 'globe');
});
