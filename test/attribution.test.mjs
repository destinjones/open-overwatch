// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Credits, licences, privacy notices and public claims against the code: what the pages and docs say about the data
// (who made it, what it may be used for, who is sent what, how much there is) must match what the code does. Each test
// reads the number or the list it checks from the code where it can, so a change on one side fails here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { SOURCES } from '../src/core/liveprov.js';
import { PUBLIC_RELAY_HOSTS } from '../src/core/relay.js';
import { inlineScripts } from '../src/core/sricheck.js';

const root = new URL('../', import.meta.url);
const read = p => readFileSync(new URL(p, root), 'utf8').replace(/\r\n/g, '\n');
const plain = html => html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const sentences = t => t.split(/(?<=\.)\s+/);
const between = (s, a, b) => { const i = s.indexOf(a); assert.ok(i >= 0, a); return s.slice(i, s.indexOf(b, i + a.length)); };
const index = read('index.html'), guide = read('guide.html'), ds = read('docs/DATA_SOURCES.md'), readme = read('README.md');
const walk = d => readdirSync(new URL(d, root), { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(d + e.name + '/') : [d + e.name]);

test('OpenSky data carries its paper, Schäfer et al. 2014, wherever OpenSky is credited', () => {
  assert.match(SOURCES.opensky.licence, /Schäfer et al\. 2014/, 'every aircraft card from the OpenSky feed');
  assert.match(ds, /Matthias Schäfer, Martin Strohmeier, Vincent Lenders, Ivan Martinovic and Matthias Wilhelm, "Bringing Up OpenSky: A Large-scale ADS-B Sensor Network for Research", IPSN 2014/);
  for (const [f, s] of [['index.html', index], ['README.md', readme], ['about.html', read('about.html')], ['guide.html', guide]]) {
    assert.match(s, /OpenSky/, f);
    assert.match(s, /Schäfer/, `${f} credits OpenSky without the paper`);
  }
  assert.match(between(index, '<details class="licences">', '</details>'), /Bringing Up OpenSky: A Large-scale ADS-B Sensor Network for Research”, IPSN 2014/);
});

test('Esri basemaps: "Powered by Esri" and each service\'s own source line (Vantor, not Maxar); every Esri layer is credited', () => {
  for (const f of ['src/globe/earth.js', 'src/map/mapview.js']) {
    const s = read(f);
    assert.match(s, /Powered by <a href="https:\/\/www\.esri\.com\/"/, f);
    assert.match(s, /Esri, Vantor, Earthstar Geographics, and the GIS User Community/, f);
  }
  for (const f of walk('src/').filter(f => /\.(js|css|html)$/.test(f))) assert.doesNotMatch(read(f), /Maxar/, f);
  const map = read('src/map/mapview.js'), esriLayers = [...map.matchAll(/ESRI \+ '([^']+)', \{([^}]*)\}/g)];
  assert.ok(esriLayers.length >= 7, `Esri layers found: ${esriLayers.length}`);
  for (const [, path, opts] of esriLayers) assert.match(opts, /attribution:/, `the 2D map shows ${path} with no credit`);
  for (const f of ['index.html', 'README.md']) assert.match(read(f).replace(/\s+/g, ' '), /Powered by Esri \(Esri, Vantor, Earthstar Geographics, and the GIS User Community\)/, f);
});

test('OpenStreetMap credits link to openstreetmap.org/copyright on the 2D map and the globe', () => {
  const link = /<a href="https:\/\/www\.openstreetmap\.org\/copyright"[^>]*>OpenStreetMap<\/a> contributors/;
  for (const f of ['src/map/mapview.js', 'src/globe/earth.js', 'src/globe/tilebuildings.js', 'src/globe/military.js', 'src/globe/traffic.js', 'src/globe/alpr.js']) {
    const s = read(f);
    assert.match(s, link, f);
    // the credit strings themselves: Cesium Credits on the globe, Leaflet attributions on the map
    const credits = [...s.matchAll(/new C\.Credit\((['`])(.*?)\1\)|attribution: (['`])(.*?)\3/g)].map(m => m[2] ?? m[4]);
    assert.ok(credits.length, f);
    for (const c of credits) assert.doesNotMatch(c, /(?:©|&copy;) OpenStreetMap contributors/, `${f}: an OpenStreetMap credit without the link: ${c}`);
  }
  for (const f of ['src/globe/tilebuildings.js', 'src/globe/military.js', 'src/globe/traffic.js'])
    assert.match(read(f), /© <a href="https:\/\/www\.openmaptiles\.org\/"[^>]*>OpenMapTiles<\/a>/, f);
});

test('DATA_SOURCES: every source with non-commercial or personal-use terms is in "Data you may not use commercially"', () => {
  const sec = between(ds, '## Data you may not use commercially', '\n## ');
  const nc = /non-commercial|personal use|personal and educational|CC BY-NC/i;
  // a row that only says what is left out for its licence ("Mission images are not used (CC BY-NC)") restricts nothing
  const rows = ds.split('\n').filter(l => l.startsWith('|') && nc.test(l) && !/not used \(CC BY-NC\)/.test(l));
  assert.ok(rows.length >= 8, `rows with such terms: ${rows.length}`);
  const missing = rows.filter(r => ![...r.matchAll(/\[([^\]]+)\]\(/g)].some(([, name]) => sec.includes(name))).map(r => r.slice(0, 90));
  assert.deepEqual(missing, [], 'each such row names (as a link) a source the section lists');
  for (const f of ['data/wind.json', 'data/lightpollution.bin', 'Open-Meteo', 'TeleGeography', 'RainViewer', 'Cesium ion', 'OpenSky', 'adsb.fi'])
    assert.ok(sec.includes(f), f);
  assert.doesNotMatch(sec, /One dataset may not/);
  // the about page and the home page's licence table say the same
  const about = read('about.html');
  for (const name of ['Open-Meteo', 'TeleGeography', 'RainViewer', 'Photorealistic', 'OpenSky', 'adsb.fi', 'Falchi']) assert.ok(about.includes(name), `about.html: ${name}`);
});

test('the home page licence table names every licensed source a visitor or a fork meets', () => {
  const table = between(index, '<details class="licences">', '</details>');
  for (const name of ['TeleGeography', 'CC BY-NC-SA 3.0', 'Falchi et al. 2016', 'CC BY-NC 4.0', 'OpenNGC', 'ECMWF', 'EMSC', 'OpenFreeMap', 'OpenMapTiles', 'Re:Earth', 'Mapterhorn', 'Cesium ion', 'hls.js', 'd3-celestial', 'RainViewer', 'OpenSky'])
    assert.ok(table.includes(name), name);
  for (const doi of ['10.5880/GFZ.1.4.2016.001', '10.1126/sciadv.1600377']) assert.ok(table.includes(doi), doi);
  const volunteers = table.match(/<tr><td>Volunteer networks:([^<]*)<\/td>/)[1];
  assert.doesNotMatch(volunteers, /RainViewer|OpenSky/, 'a company and a research network are not volunteer networks');
  assert.match(table, /RainViewer<\/a> radar<\/td><td><b>Personal and educational use only<\/b>/);
});

test('NOTICE names the non-MIT textures and data the download zip ships', () => {
  const notice = read('NOTICE').replace(/\s+/g, ' '), rel = read('.github/workflows/release.yml');
  for (const p of ['brand/textures/planets', 'brand/textures/moons', 'brand/textures/sky ', 'sky_equirect', 'data/countries.json']) assert.ok(rel.includes(p), `the zip ships ${p}`);
  assert.match(notice, /brand\/textures\/planets\/ [^-]*Solar System Scope[^-]{0,120}CC BY 4\.0/);
  assert.match(notice, /milkyway\*\.jpg: NASA\/JPL-Caltech\/R\. Hurt/);
  assert.match(notice, /brand\/textures\/sky\/[\s\S]{0,200}NASA\/Goddard Space Flight Center Scientific Visualization Studio[\s\S]{0,120}ESA\/Gaia\/DPAC/);
  assert.match(notice, /data\/countries\.json:[\s\S]{0,120}World Bank[\s\S]{0,80}CC BY 4\.0[\s\S]{0,200}Wikidata \(CC0\)/);
  const maps = JSON.parse(read('brand/textures/moons/maps.json')).maps;
  for (const m of Object.values(maps)) if (!/^public domain/i.test(m.licence)) {
    assert.ok(notice.includes(m.file) && notice.includes(m.file_1k), `${m.file} (${m.licence}) is named in NOTICE`);
    if (/BY-SA/.test(m.licence)) assert.match(notice, /CC BY-SA 3\.0 IGO: credit required, and changed copies must be shared under the same licence/);
  }
});

test('privacy notices: location only from the device, the Tonight forecast, the relay\'s real hosts, both models, Photoreal search', () => {
  const home = plain(between(index, '<h3>Privacy</h3>', '</div>')), guideP = plain(between(guide, '<section id="privacy"', '</section>'));
  // a word each notice uses for every host the public relay carries: a host added to the relay must be named
  const named = { 'www.nhc.noaa.gov': /hurricanes/, 'webcams.nyctmc.org': /NYC cameras/, 'www.submarinecablemap.com': /cable routes/,
    'www.drivebc.ca': /camera lists/, 'traveler.modot.org': /camera lists/, 'kamera.atlas.vegvesen.no': /camera pictures/,
    'atmsqf.iowadot.gov': /camera pictures/, 'trafficcam.calgary.ca': /camera pictures/, 'images.data.gov.sg': /camera pictures/,
    'www.ndbc.noaa.gov': /DART/, 'www.tsunami.gov': /tsunami warning centres/ };
  assert.deepEqual(PUBLIC_RELAY_HOSTS.filter(h => !named[h]), [], 'a relay host this test has no word for: add it to both notices and here');
  for (const [where, t] of [['index.html', home], ['guide.html', guideP]]) {
    for (const h of PUBLIC_RELAY_HOSTS) assert.match(t, named[h], `${where}: the relay's ${h}`);
    assert.doesNotMatch(t, /ipapi/i, where);
    assert.match(t, /only from your device and only when you ask/, where);
    assert.match(t, /no lookup by IP address/, where);
    assert.match(t, /Tonight[^.]*Open-Meteo rounded to about 10 km/, where);
    assert.match(t, /NOAA's (GFS )?and ECMWF's/, where);
    assert.match(t, /Google's geocoder through Cesium ion/, where);
    assert.match(t, /never connects to aisstream\.io/, where);
  }
  assert.doesNotMatch(ds, /ipapi/, 'DATA_SOURCES lists no IP-location service: there is none');
  assert.doesNotMatch(index, /list exactly which services/, 'the home page does not claim the notice is exact');
});

test('aisstream.io: worldwide ships are promised only with the download (aisstream does not permit browser connections)', () => {
  const promise = /aisstream|world's shipping|worldwide ships|global ships/i;
  for (const [f, s] of [['index.html', plain(index.slice(index.indexOf('<body')))], ['guide.html', plain(guide.slice(guide.indexOf('<body')))]])
    for (const line of sentences(s)) if (promise.test(line) && !/^Data: /.test(line.trim())) assert.match(line, /download|helper|never connects/i, `${f}: ${line.trim().slice(0, 140)}`);
  assert.match(ds, /\| Ships \(worldwide\) \|[^\n]*\*\*download version only\*\*[^\n]*does not permit browser connections/);
});

test('claims: satellites, the depth range, the download size, the forecast horizon and the accuracy table match the code', () => {
  for (const [f, s] of [['README.md', readme], ['index.html', index], ['guide.html', guide]]) {
    assert.doesNotMatch(s, /every tracked satellite|every satellite CelesTrak publishes/i, f);
    assert.match(s, /18,000\+ satellites/, f);
  }
  const layers = read('src/globe/layers.js');
  assert.match(layers, /'active'/); assert.match(layers, /Fengyun|debris/i);   // "every active one plus three debris clouds"
  // the Solar System camera's near and far planes give the orders of magnitude
  const cam = read('src/solar/main.js').match(/PerspectiveCamera\(50, [^,]+, ([\de.+-]+), ([\de.+-]+)\)/);
  const orders = Math.round(Math.log10(Number(cam[2]) / Number(cam[1])));
  for (const f of ['README.md', 'docs/ARCHITECTURE.md']) {
    assert.match(read(f), new RegExp(`\\b${orders} orders of magnitude`), f);
    assert.doesNotMatch(read(f), new RegExp(`\\b(?!${orders}\\b)\\d+ orders of magnitude`), f);
  }
  for (const [f, s] of [['index.html', index], ['guide.html', guide]]) { assert.doesNotMatch(s, /about 70 MB/i, f); assert.match(s, /about 85 MB/i, f); }
  // the forecast horizon: the globe's MAX_H on phones and elsewhere
  const h = read('src/globe/model.js').match(/MAX_H = PHONE \? (\d+) : (\d+)/);
  assert.match(index, new RegExp(`${h[2] / 24} days ahead \\(${h[1] / 24} on phones\\)`));
  // the accuracy table: measured on the fixture's date; a planet with no fixture vector is said to be unchecked
  assert.doesNotMatch(readme, /Accuracy \(asserted by the tests/);
  assert.match(readme, /## Accuracy \(measured on 2 Oct 2026 against JPL Horizons/);
  const fixture = JSON.parse(read('test/fixtures/horizons_2026-10-02.json'));
  for (const p of ['uranus']) {
    const has = Object.keys(fixture.bodies).includes(p), says = new RegExp(`${p[0].toUpperCase() + p.slice(1)} is not checked`).test(readme);
    assert.equal(says, !has, `README on ${p}: the fixture ${has ? 'has' : 'lacks'} it`);
  }
});

test('the download\'s own instructions: the views need a web server, the relayed hosts are serve.js\'s list, the ADS-B pace', () => {
  const txt = read('README.txt'), bat = read('Start Open Overwatch.bat');
  assert.doesNotMatch(txt, /open open-overwatch\.html directly as a file/);
  assert.doesNotMatch(bat, /still open open-overwatch\.html directly/);
  assert.match(txt, /ES modules, which browsers will not load from a file opened directly/);
  assert.match(bat, /browsers do not load/);
  assert.match(read('serve.js'), /const ALLOWED_HOSTS = new Set\(/);
  assert.match(txt, /ALLOWED_HOSTS at the top of serve\.js/);
  const air = read('src/map/aircraft.js'), gap = +air.match(/paced\(src\) \{ return this\.gap\[src\] \|\| (\d+);/)[1], min = +air.match(/Math\.max\((\d+), Math\.round\(this\.paced/)[1];
  assert.match(txt.replace(/\s+/g, ' '), new RegExp(`one ADS-B request every ${gap / 1000} s per network, never under ${min / 1000} s`));
});

test('the MCP privacy text names every service a tool sends the place asked about', () => {
  const priv = between(read('mcp/README.md'), '## Privacy', '\n## ').replace(/\s+/g, ' ');
  for (const [file, host, name] of [['mcp/distance.mjs', 'routing.openstreetmap.de', 'FOSSGIS OSRM servers (routing.openstreetmap.de)'],
    ['mcp/fires.mjs', 'gibs.earthdata.nasa.gov', 'NASA GIBS (the fire tiles around the place asked about)'],
    ['src/core/metar.js', 'aviationweather.gov', "airport code to NOAA's Aviation Weather Center"]]) {
    assert.ok(read(file).includes(host), `${file} still asks ${host}`);
    assert.ok(priv.includes(name), name);
  }
});

test('the site build\'s data/wind.json says where it comes from and under what licence', () => {
  const fn = between(read('.github/build_site.py'), 'def mirror_wind(path):', '\ndef ');
  assert.match(fn, /json\.dump\(\{'source': 'Open-Meteo\.com \(https:\/\/open-meteo\.com\), CC BY 4\.0, free for non-commercial use',\s*'licence': 'https:\/\/creativecommons\.org\/licenses\/by\/4\.0\/'/);
});

/** Devanagari text on an English page that no element marks as Hindi (WCAG 3.1.2, language of parts). */
function unmarkedHindi(html) {
  const body = html.slice(html.indexOf('<body')).replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
  const stack = [], bad = [];
  for (const m of body.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*)>|([^<]+)/g)) {
    if (m[4] !== undefined) {
      if (/[ऀ-ॿ]/.test(m[4]) && ([...stack].reverse().find(e => e.lang) || { lang: 'en' }).lang !== 'hi') bad.push(m[4].trim());
      continue;
    }
    const [, close, name, attrs] = m, tag = name.toLowerCase();
    if (close) { const i = stack.map(e => e.tag).lastIndexOf(tag); if (i >= 0) stack.length = i; continue; }
    if (VOID.has(tag) || /\/\s*$/.test(attrs)) continue;
    stack.push({ tag, lang: (attrs.match(/\slang="([^"]*)"/) || [])[1] });
  }
  return bad;
}

test('language of parts: Hindi words on the English pages are marked lang="hi"', () => {
  assert.deepEqual(unmarkedHindi('<body><p>in English and हिन्दी.</p></body>'), ['in English and हिन्दी.'], 'the check finds unmarked Hindi');
  assert.deepEqual(unmarkedHindi('<body><p>in English and <span lang="hi">हिन्दी</span>.</p><br></body>'), []);
  for (const f of ['index.html', '404.html', 'about.html', 'guide.html']) {
    const html = read(f);
    assert.match(html, /<html lang="en"/, f);
    assert.deepEqual(unmarkedHindi(html), [], f);
  }
});

test('home page: the live feed is not a live region around clocks that tick every second', () => {
  const js = inlineScripts(index).map(s => s.text).join('\n');
  assert.match(js, /setInterval\(\(\) => \{ \$\('#utc'\)\.textContent =/, 'the UTC clock ticks every second');
  assert.match(js, /tick\(\); setInterval\(tick, 1000\)/, 'the launch countdown ticks every second');
  const ticking = ['utc', 'lch', 'iss'];
  for (const m of index.matchAll(/<(\w+)\b[^>]*\baria-live="(polite|assertive)"[^>]*>/g)) {
    const inner = index.slice(m.index, index.indexOf(`</${m[1]}>`, m.index));
    for (const id of ticking) if (inner.includes(`id="${id}"`)) assert.match(inner, new RegExp(`id="${id}"[^>]*aria-live="off"|aria-live="off"[^>]*id="${id}"`), `#${id} is read out on every tick`);
  }
});

test('home page: the demo clips can be paused, play through once, and the tabs are a full tab pattern', () => {
  const js = inlineScripts(index).map(s => s.text).join('\n');
  assert.doesNotMatch(js, /show\(\(cur \+ 1\) % tabs\.length\)/, 'no endless cycle');
  assert.doesNotMatch(js, /pv\.currentTime = 0, pv\.play\(\)/, 'a picked clip does not loop forever');
  assert.match(js, /if \(auto && cur \+ 1 < tabs\.length\) show\(cur \+ 1\)/);
  assert.match(js, /if \(playing\(\)\) \{ held = true; pv\.pause\(\); return; \}/, 'the button over the screen pauses');
  assert.match(js, /'Pause the recordings' : 'Play the recordings'/);
  assert.match(js, /cur = i; started = true; playBtn\.hidden = false;/, 'the button stays while the clips play');
  assert.match(js, /ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1/);
  assert.match(js, /e\.key === 'Home' \? 0 : e\.key === 'End'/);
  assert.match(index, /<div class="tabs" role="tablist" aria-label="[^"]+">/);
  assert.match(index, /<div class="screen" id="phoneScreen" role="tabpanel"/);
  const tabs = [...index.matchAll(/<button class="tab" role="tab"[^>]*>/g)].map(m => m[0]);
  assert.equal(tabs.length, 5);
  for (const t of tabs) assert.match(t, /aria-controls="phoneScreen" aria-selected="(true|false)" tabindex="(0|-1)"/, t);
  assert.equal(tabs.filter(t => /tabindex="0"/.test(t)).length, 1, 'one tab in the tab order');
});
