// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The teachers page (teach/index.html): every activity is complete (goal, 15-45 minutes of steps, questions, what to
// check), every link decodes with the real link decoders into a view the site can show and opens a page that exists,
// the facts the page states agree with the data (eclipses, TRAPPIST-1, Halley, the dates its links set, the orbits),
// the citation is CITATION.cff's, and the page passes the CSP and accessibility checks and prints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { decodeView, decodeExtras, decodeTonight, GO } from '../src/core/viewlink.js';
import { decodeSolarView } from '../src/core/solarlink.js';
import { PLANET_KEYS } from '../src/core/planets.js';
import { cometFromRow, cometPeriodYears, conicInPlane } from '../src/core/comets.js';
import { msFromJd } from '../src/core/time.js';
import { LAYERS, WEATHER } from '../mcp/place.mjs';
import { checkPage, inlineScripts } from '../src/core/sricheck.js';
import { checkHtml } from '../src/core/a11ycheck.js';

const root = new URL('../', import.meta.url);
const read = p => readFileSync(new URL(p, root), 'utf8');
const html = read('teach/index.html');
const js = read('teach/teach.js');
const SITE = 'https://destinjones.github.io/open-overwatch/';
const unamp = s => s.replace(/&amp;/g, '&');
const text = s => unamp(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

// ---- the activities, cut out of the markup
const activities = [...html.matchAll(/<article class="activity" id="([^"]+)" data-age="([^"]+)" data-minutes="(\d+)"([^>]*)>([\s\S]*?)<\/article>/g)]
  .map(([, id, age, minutes, attrs, body]) => ({
    id, age, minutes: +minutes, attrs, body,
    title: text((body.match(/<h3[^>]*>([\s\S]*?)<\/h3>/) || [])[1] || ''),
    meta: text((body.match(/<p class="meta">([\s\S]*?)<\/p>/) || [])[1] || ''),
    goal: text((body.match(/<p class="goal">([\s\S]*?)<\/p>/) || [])[1] || ''),
    steps: [...((body.match(/<ol class="steps">([\s\S]*?)<\/ol>/) || [])[1] || '').matchAll(/<li>/g)].length,
    ask: [...((body.match(/<ul class="ask">([\s\S]*?)<\/ul>/) || [])[1] || '').matchAll(/<li>/g)].length,
    check: text((body.match(/<p class="check">([\s\S]*?)<\/p>/) || [])[1] || ''),
    links: [...body.matchAll(/<li><a href="([^"]+)">([\s\S]*?)<\/a><code class="url">([^<]+)<\/code><\/li>/g)].map(m => ({ href: unamp(m[1]), label: text(m[2]), shown: unamp(m[3]) })),
  }));
const AGES = ['7-11', '11-14', '14-18'];
const allLinks = activities.flatMap(a => a.links.map(l => ({ ...l, activity: a.id })));
const checkOf = id => activities.find(a => a.id === id).check;

test('8 to 12 activities in three age groups, each complete', () => {
  assert.ok(activities.length >= 8 && activities.length <= 12, `${activities.length} activities`);
  assert.equal(new Set(activities.map(a => a.id)).size, activities.length, 'ids are unique');
  for (const age of AGES) {
    const n = activities.filter(a => a.age === age).length;
    assert.ok(n >= 3, `ages ${age}: ${n} activities`);
    assert.match(html, new RegExp(`<div class="age" id="ages-${age}"[^>]*>\\s*<h3>Ages ${age}</h3>`), `the ages ${age} group has its heading`);
  }
  for (const a of activities) {
    assert.ok(AGES.includes(a.age), `${a.id}: age ${a.age}`);
    assert.ok(a.minutes >= 15 && a.minutes <= 45, `${a.id}: ${a.minutes} minutes`);
    assert.ok(a.meta.startsWith(`Ages ${a.age} · ${a.minutes} minutes`), `${a.id}: the meta line says the same age and time (${a.meta})`);
    assert.ok(a.title.length > 8, `${a.id}: a title`);
    assert.ok(a.goal.startsWith('Goal:') && a.goal.length > 40, `${a.id}: a goal`);
    assert.ok(a.steps >= 3 && a.steps <= 6, `${a.id}: ${a.steps} steps`);
    assert.ok(a.ask >= 2, `${a.id}: questions to ask`);
    assert.ok(a.check.length > 80, `${a.id}: what to check`);
    assert.ok(a.links.length >= 1, `${a.id}: a link that opens the view`);
    assert.match(a.body, new RegExp(`<button type="button" class="btn small" data-print="${a.id}" hidden>Print this activity</button>`), `${a.id}: its own print button`);
    assert.match(a.attrs, new RegExp(`aria-labelledby="${a.id}-h"`), `${a.id}: named by its heading`);
    assert.match(a.body, new RegExp(`<h3 id="${a.id}-h">`), `${a.id}: the heading it is named by`);
  }
  // the topics the page promises
  for (const t of [/night/i, /Moon/, /Solar System/, /storm/i, /plate boundaries/i, /ISS/, /Seasons/, /Light pollution/i, /Kepler/, /TRAPPIST-1/, /eclipses/i])
    assert.ok(activities.some(a => t.test(a.title)), `an activity about ${t}`);
});

// what the Solar System view can focus: the Sun, the planets, the Moon, the exoplanet systems and the comets in its data
const exo = JSON.parse(read('data/solar/exoplanets.json'));
const small = JSON.parse(read('data/solar/small_bodies.json'));
const SOLAR_KEYS = new Set(['sun', 'moon', ...PLANET_KEYS, ...exo.list.map(s => 'exo:' + s.host), ...small.comets.map(r => 'comet:' + r[0])]);
const ECLIPSES = JSON.parse(read('data/eclipses.json')).eclipses;

test('every activity link decodes with the real decoders and opens a page that exists', () => {
  assert.ok(allLinks.length >= 20, `${allLinks.length} links`);
  const pages = new Set();
  for (const { href, shown, activity } of allLinks) {
    const where = `${activity}: ${href}`;
    assert.ok(href.startsWith('../'), `${where}: relative, so the download version opens its own copy`);
    assert.equal(shown, SITE + href.slice(3), `${where}: the address printed under the link is the link`);
    const [file, hash = ''] = href.slice(3).split('#');
    assert.ok(existsSync(new URL(file, root)), `${where}: ${file} exists`);
    pages.add(file);
    if (file === 'globe.html') {
      if (!hash) continue;   // the plain globe (search for your own town)
      const v = decodeView('#' + hash);
      if (!v) {   // a panel link
        const x = decodeExtras('#' + hash);
        assert.ok(x.go && GO.includes(x.go), `${where}: neither a view nor a panel`);
        if (x.go === 'eclipses') assert.ok(ECLIPSES.some(e => e.date === x.id), `${where}: an eclipse in data/eclipses.json`);
        if (hash.includes('id=')) assert.ok(x.id, `${where}: the id survives the decoder`);
        continue;
      }
      assert.ok(v.height >= 150 && v.height <= 6e8, `${where}: a camera height the globe goes to`);
      for (const id of [...(v.add || []), ...(v.drop || []), ...(v.layers || [])]) assert.ok(LAYERS.includes(id), `${where}: no layer ${id}`);
      assert.ok(!v.layers, `${where}: links made outside the globe use a= and x=, not l=`);
      for (const id of v.weather || []) assert.ok(WEATHER.includes(id), `${where}: no weather source ${id}`);
      if (v.weather) assert.ok(v.height >= 3e6, `${where}: weather links show the whole Earth`);
      if (hash.includes('t=')) assert.ok(v.time && v.time.rate === 0, `${where}: the clock is set, and paused at that moment`);
      if (hash.includes('s=')) assert.equal(v.sat, '25544', `${where}: the ISS`);
      if (new URLSearchParams(hash).get('go')) assert.equal(new URLSearchParams(hash).get('go'), 'history', `${where}: only go=history works over a view`);
      assert.ok(!(v.add || []).includes('air') && !(v.add || []).includes('mil'), `${where}: the website has no live aircraft`);
    } else if (file === 'solar.html') {
      const v = decodeSolarView('#' + hash);
      assert.ok(v && v.focus, `${where}: a focus`);
      assert.ok(SOLAR_KEYS.has(v.focus), `${where}: the Solar System view has ${v.focus}`);
      const p = new URLSearchParams(hash);
      if (p.has('t')) assert.ok(v.jd != null, `${where}: the time is inside the view's 1800-2200`);
      if (p.has('r')) assert.ok(v.rate != null && v.rate > 0, `${where}: a running clock`);
      if (p.has('d')) assert.ok(v.dist != null, `${where}: a camera distance`);
    } else if (file === 'tonight.html') {
      if (hash) assert.ok(decodeTonight('#' + hash).at, `${where}: a place`);
    } else assert.fail(`${where}: an activity opens the globe, the Solar System or Tonight`);
  }
  assert.deepEqual([...pages].sort(), ['globe.html', 'solar.html', 'tonight.html']);
});

test('every other link on the page opens a page and a section that exist', () => {
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
  const hrefs = [...html.slice(html.indexOf('<body')).matchAll(/href="([^"]+)"/g)].map(m => unamp(m[1]));
  for (const h of hrefs) {
    if (/^https:\/\//.test(h)) continue;
    assert.ok(!/^http:/.test(h), `${h}: https`);
    if (h.startsWith('#')) { assert.ok(ids.has(h.slice(1)), `${h}: a section on this page`); continue; }
    assert.ok(h.startsWith('../') || h === 'teach.js', `${h}: relative to teach/`);
    const [f, frag] = h.slice(3).split('#');
    assert.ok(existsSync(new URL(f || 'index.html', root)), `${h}: ${f} exists`);
    if (frag && !frag.includes('=')) assert.match(read(f), new RegExp(`id="${frag}"`), `${h}: ${f} has the section ${frag}`);
  }
  for (const s of ['../brand/fonts/fonts.css', '../brand/emblem/favicon.svg', '../brand/emblem/emblem-256.png', '../manifest.webmanifest', '../src/app/shell.js'])
    assert.ok(html.includes(`"${s}"`) && existsSync(new URL(s.slice(3), root)), s);
});

test('the dates the links set are the dates their labels give', () => {
  const at = jd => new Date(msFromJd(jd)).toISOString().slice(0, 16);
  const want = {
    'December solstice': '2026-12-21T12:00', 'March equinox': '2027-03-20T12:00', 'June solstice': '2027-06-21T12:00',
    'Hurricane Ian': '2022-09-28T19:05',   // landfall at Cayo Costa, 3:05 pm EDT
    'Tōhoku': '2011-03-12T06:00',          // the day after: the 24 hours before include the 05:46 UTC main shock
  };
  for (const [label, iso] of Object.entries(want)) {
    const l = allLinks.find(x => x.label.includes(label));
    assert.ok(l, `a link labelled ${label}`);
    assert.equal(at(decodeView('#' + l.href.split('#')[1]).time.jd), iso, label);
  }
  // the Solar System links carry their dates in plain ISO
  const shadow = allLinks.find(l => l.label.startsWith("The Moon's shadow"));
  assert.equal(new Date(msFromJd(decodeSolarView('#' + shadow.href.split('#')[1]).jd)).toISOString().slice(0, 16), '2027-08-02T10:07');
});

test('the eclipses the page lists are the ones in data/eclipses.json', () => {
  const span = ECLIPSES.filter(e => e.date >= '2027' && e.date < '2031');
  const of = type => span.filter(e => e.type === type).map(e => e.date);
  assert.deepEqual(of('total'), ['2027-08-02', '2028-07-22', '2030-11-25']);
  assert.deepEqual(of('annular'), ['2027-02-06', '2028-01-26', '2030-06-01']);
  assert.deepEqual(of('partial').map(d => d.slice(0, 4)), ['2029', '2029', '2029', '2029']);
  const c = checkOf('eclipses');
  assert.match(c, /three total eclipses \(2 August 2027, 22 July 2028, 25 November 2030\), three annular ones \(6 February 2027, 26 January 2028, 1 June 2030\) and four partial ones in 2029/);
});

test('TRAPPIST-1: the zone, the distances and the light the page gives come from the data', () => {
  const s = exo.list.find(x => x.host === 'TRAPPIST-1'), act = activities.find(a => a.id === 'trappist');
  const L = 10 ** s.lum, F = exo.planet_fields, A = F.indexOf('a_AU'), HZ = F.indexOf('in_HZ'), P = F.indexOf('P_days');
  assert.equal(L.toFixed(5), '0.00055');
  assert.match(act.body, /about 0\.00055 times the Sun's light/);
  assert.deepEqual(s.pl.filter(p => p[HZ]).map(p => p[0]), ['e', 'f', 'g'], 'e, f and g are in the habitable zone');
  assert.match(act.check, new RegExp(`about ${s.hz[0].toFixed(3)} to ${s.hz[1].toFixed(3)} AU`), 'the zone as the card prints it');
  assert.equal(Math.sqrt(L).toFixed(4), '0.0235');
  assert.match(act.check, /square root of 0\.00055 is about 0\.0235/);
  const light = name => { const p = s.pl.find(x => x[0] === name); return L / p[A] ** 2; };
  assert.match(act.check, new RegExp(`about ${Math.round(light('e') * 100)}%, ${Math.round(light('f') * 100)}% and ${Math.round(light('g') * 100)}%`));
  assert.match(act.check, new RegExp(`d, just inside it, gets about ${light('d').toFixed(1)} times`));
  const dists = s.pl.map(p => `${p[0]} ${p[A].toFixed(3)}`).join(', ').replace(/, (h [\d.]+)$/, ' and $1');
  assert.ok(act.body.includes(`distances from the star are ${dists} AU`), dists);
  const years = s.pl.map(p => p[P]);
  assert.match(act.check, new RegExp(`from ${Math.min(...years).toFixed(1)} to ${Math.round(Math.max(...years))} days`));
});

test('Halley: the date the view brings it closest (its plain ellipse) is the one the page gives', () => {
  const c = cometFromRow(small.comets.find(r => r[0] === '1P/Halley'));
  let next = c.tp; while (next < 2461000) next += cometPeriodYears(c) * 365.25;   // about the next perihelion after 2026...
  let best = next;   // ...found the way the view moves it (conicInPlane), to the day
  for (let jd = next - 30; jd <= next + 30; jd += 0.25) if (conicInPlane(c, jd).r < conicInPlane(c, best).r) best = jd;
  const d = new Date(msFromJd(best));
  const said = `${d.getUTCDate()} ${d.toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' })} ${d.getUTCFullYear()}`;
  assert.match(checkOf('halley'), new RegExp(`brings it closest on about ${said}; astronomers, who add the pull of Jupiter and Saturn, predict 28 July 2061\\. The five-month gap`));
  const tp = best;
  const link = allLinks.find(l => l.activity === 'halley'), v = decodeSolarView('#' + link.href.split('#')[1]);
  assert.ok(v.jd < tp && tp - v.jd < 365 * 1.5, 'the link starts before the closest point, close enough to reach it in a lesson');
});

test("the orbit numbers in Kepler's third law activity are right", () => {
  const GM = 398600.4418, T = a => 2 * Math.PI * Math.sqrt(a ** 3 / GM), hm = s => `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`;
  const c = checkOf('orbits');
  assert.match(c, new RegExp(`a ≈ 6,790 km, T ≈ ${(T(6790) / 60).toFixed(1)} min`));
  assert.match(c, new RegExp(`a ≈ 26,560 km, T ≈ ${hm(T(26560))}`));
  assert.match(c, new RegExp(`a ≈ 42,164 km, T ≈ ${hm(T(42164))}`));
  assert.equal((4 * Math.PI ** 2 / GM).toExponential(1), '9.9e-5');
  assert.match(c, /9\.9 × 10⁻⁵ s²\/km³/);
});

test('how to cite: the DOI, author, title and address are CITATION.cff\'s', () => {
  const cff = read('CITATION.cff'), get = k => (cff.match(new RegExp(`^\\s*-?\\s*${k}:\\s*"?([^"\\n]+)"?`, 'm')) || [])[1];
  const doi = get('doi'), year = get('date-released').slice(0, 4);
  assert.equal(doi, '10.5281/zenodo.23348946');
  const apa = text(html.match(/<pre class="cite" id="cite-apa"[^>]*>([\s\S]*?)<\/pre>/)[1]);
  assert.equal(apa, `${get('family-names')}, ${get('given-names')[0]}. (${year}). ${get('title')} [Computer software]. Zenodo. https://doi.org/${doi}`);
  const bib = unamp(html.match(/<pre class="cite" id="cite-bibtex"[^>]*>([\s\S]*?)<\/pre>/)[1]);
  for (const [k, v] of [['author', `${get('family-names')}, ${get('given-names')}`], ['title', get('title')], ['year', year], ['doi', doi], ['url', get('url')], ['license', get('license')]])
    assert.match(bib, new RegExp(`\\b${k}\\s*= \\{${v.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}\\}`), `BibTeX ${k}`);
  assert.ok((html.match(/10\.5281\/zenodo\.23348946/g) || []).length >= 3, 'the DOI is in the page, the citation and the structured data');
  for (const id of ['cite-apa', 'cite-bibtex']) assert.match(html, new RegExp(`data-copy="${id}" hidden`));
});

test('the CSP and accessibility checks pass; no inline script to hash', () => {
  const sha256 = t => createHash('sha256').update(t, 'utf8').digest('base64');
  assert.deepEqual(checkPage(html, { sha256 }).map(e => `${e.rule}: ${e.what}`), []);
  assert.deepEqual(inlineScripts(html), [], 'teach.js is a file, so the CSP needs no hash');
  assert.match(html, /script-src 'self';/);
  const { errors } = checkHtml(html);
  assert.deepEqual(errors.map(e => `teach/index.html:${e.line} [${e.rule}] ${e.what}`), []);
  assert.match(html, /<a class="skip" href="#main">/);
  assert.match(html, /<html lang="en">/);
  assert.match(html, /@media \(prefers-reduced-motion:reduce\)/);
});

test('it prints: no navigation or buttons, every activity on its own when it fits, one activity alone on request', () => {
  const print = html.slice(html.indexOf('@media print{'), html.indexOf('</style>'));
  assert.ok(print.length > 200, 'print styles');
  assert.match(print, /nav,footer,[^{]*\.tools[^{]*\{display:none !important\}/);
  assert.match(print, /\.activity\{break-inside:avoid;page-break-inside:avoid/);
  assert.match(print, /html,body\{background:#fff !important;color:#000 !important/);
  assert.match(print, /body\.print-one>\*:not\(#printOne\)\{display:none !important\}/);
  assert.match(html, /#printOne\{display:none\}/, 'the copy for printing never shows on screen');
  // teach.js: the print and copy buttons, nothing else
  assert.match(js, /^\/\/ Copyright \(c\) 2026 Destin Jones\. Open Overwatch, MIT License \(see LICENSE and NOTICE\)\./);
  assert.match(js, /box\.id = 'printOne'/);
  assert.match(js, /addEventListener\('afterprint', done, \{ once: true \}\)/);
  assert.match(js, /removeAttribute\('id'\)/, 'the printed copy has no repeated ids');
  assert.doesNotMatch(js, /fetch\(|XMLHttpRequest|localStorage|sessionStorage|document\.cookie|sendBeacon/, 'no network, no storage');
  assert.match(html, /<script type="module" src="teach\.js"><\/script>/);
  assert.match(html, /^<!doctype html>\n<!-- Copyright \(c\) 2026 Destin Jones\. Open Overwatch, MIT License \(see LICENSE and NOTICE\)\. -->/);
});

test('privacy for schools: no tracking, and the page says what does leave the device', () => {
  for (const t of [html, js]) assert.doesNotMatch(t, /fbq\(|connect\.facebook|facebook\.net|gtag\(|googletagmanager|google-analytics|plausible|clarity\.ms|fonts\.(googleapis|gstatic)\.com/i);
  const privacy = text(html.slice(html.indexOf('<section id="privacy"'), html.indexOf('</section>', html.indexOf('<section id="privacy"'))));
  for (const t of [/No accounts, no ads, no cookies, no analytics, no tracking/, /rounds it to about 1 km/, /IP address/, /Photon/, /Not for safety decisions/]) assert.match(privacy, t);
  assert.match(html, /<link rel="canonical" href="https:\/\/destinjones\.github\.io\/open-overwatch\/teach\/">/);
});
