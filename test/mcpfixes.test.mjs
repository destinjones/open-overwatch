// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// MCP answers that were wrong and must stay right: a cancelled call and the whole server, comets too far off to date, an old
// list passed off as current, country names, near-miss names, and the wording of eclipses, polar nights and detours. The
// site's data copies are read from this checkout; every other source is a stub (no network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createOverwatchServer, SITE } from '../mcp/index.mjs';
import { createFeeds } from '../mcp/feeds.mjs';
import { createTools } from '../mcp/tools.mjs';
import { findCountry, matchCountries } from '../mcp/country.mjs';
import { iso } from '../mcp/words.mjs';

const root = new URL('../', import.meta.url);
const json = v => new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } });
/** The site's data from this checkout; `routes` ([regex, value or url => value]) for the rest; anything else 404s. */
const net = (routes = []) => async url => {
  const u = String(url);
  for (const [re, v] of routes) if (re.test(u)) return json(typeof v === 'function' ? v(u) : v);
  if (u.startsWith(SITE)) {
    const f = new URL(u.slice(SITE.length), root);
    if (existsSync(f)) return new Response(readFileSync(f), { status: 200 });
  }
  return new Response('nope', { status: 404 });
};
const NOW = Date.parse('2026-11-06T12:00:00Z');
const serve = (routes, now = NOW) => createOverwatchServer({ fetchImpl: net(routes), now: () => now });
async function call(server, name, args = {}) {
  const r = (await server.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })).result;
  assert.ok(r, 'an answer');
  return r;
}
const ok = r => { assert.equal(r.isError, false, r.content[0].text); return r; };
const text = r => r.content[0].text;
const METEO = [/api\.open-meteo\.com/, { timezone: 'UTC', utc_offset_seconds: 0, hourly: { time: [], cloud_cover: [], precipitation_probability: [] } }];

// ---- #7: a cancel --------------------------------------------------------------------------------------------------
test('mcp fix: a call already cancelled asks nothing more and leaves no rejection nobody handles', async () => {
  const stray = [], onStray = e => stray.push(e); process.on('unhandledRejection', onStray);
  try {
    let asked = 0;
    const feeds = createFeeds({ fetchImpl: async () => { asked++; return new Response('nope', { status: 404 }); } });
    const c = new AbortController(); c.abort(new Error('cancelled'));
    await assert.rejects(feeds.bytes('https://example.org/tile', { signal: c.signal }), /cancelled/);
    await new Promise(r => setTimeout(r, 30));
    assert.equal(asked, 0, 'no request for a call nobody is waiting on');
    assert.deepEqual(stray, []);
    // a live call sharing a request with one that gets cancelled still hears its answer, and the failure stays handled
    let release; const gate = new Promise(r => { release = r; });
    const shared = createFeeds({ fetchImpl: async () => { await gate; return new Response('nope', { status: 404 }); } });
    const d = new AbortController(), a = shared.json('https://example.org/x', { signal: d.signal }), b = shared.json('https://example.org/x');
    d.abort(new Error('cancelled')); release();
    await assert.rejects(a, /cancelled/); await assert.rejects(b, /HTTP 404/);
    await new Promise(r => setTimeout(r, 30));
    assert.deepEqual(stray, []);
    // a cached answer still comes back
    const cached = createFeeds({ fetchImpl: async () => json({ a: 1 }) });
    await cached.json('https://example.org/y');
    assert.deepEqual(await cached.json('https://example.org/y', { signal: c.signal }), { a: 1 });
  } finally { process.off('unhandledRejection', onStray); }
});

for (const mode of ['404', 'throw']) test(`mcp fix: the real stdio server survives a cancel during wildfires while fetches fail (${mode})`, async () => {
  const server = fileURLToPath(new URL('../mcp/server.mjs', import.meta.url));
  const p = spawn(process.execPath, ['--import', new URL('helpers/mcp-failing-fetch.mjs', import.meta.url).href, server], { env: { ...process.env, OO_STUB_FETCH: mode }, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '', err = ''; p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { err += d; });
  const send = m => p.stdin.write(JSON.stringify(m) + '\n'), wait = ms => new Promise(r => setTimeout(r, ms));
  const exited = new Promise(r => p.on('exit', code => r(code)));
  send({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
  send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'wildfires', arguments: { lat: 37, lon: -120, radius_km: 800 } } });
  await wait(50);
  send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } });
  await wait(1200);   // the batches after the cancel fail here, if they are made at all
  send({ jsonrpc: '2.0', id: 2, method: 'ping' });
  await wait(300);
  const answers = out.trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  assert.ok(answers.some(m => m.id === 2 && m.result), `ping answered; stderr: ${err}`);
  assert.ok(!answers.some(m => m.id === 1), 'a cancelled call gets no answer');
  p.stdin.end();
  assert.equal(await exited, 0, err);
});

// ---- #25: comets ----------------------------------------------------------------------------------------------------
test('mcp fix: comets too far from their next return to date give their last perihelion', async () => {
  assert.equal(iso(8.7e15), null, 'past what a Date can hold'); assert.equal(iso(0), '1970-01-01T00:00:00Z');
  const server = serve([METEO]);
  for (const name of ['C/1882 F1', 'C/1889 G1', 'C/1958 D1', 'C/1933 D1', 'Peltier']) {
    const r = ok(await call(server, 'where_in_space', { name })), d = r.structuredContent;
    assert.match(text(r), /perihelion [\d.]+ AU from the Sun, last on \d{4}-\d\d-\d\d\./, name);
    assert.equal(d.perihelion_note, null, name);
    assert.ok(Date.parse(d.perihelion) < NOW, `${name}: ${d.perihelion}`);
    assert.doesNotMatch(text(r), /\+0\d{5}/);
  }
  const far = ok(await call(server, 'where_in_space', { name: 'C/1680 V1' }));   // a return in year 11050: no expanded years in words
  assert.match(text(far), /last on 1680/); assert.doesNotMatch(text(far), /\+0/);
  const hb = ok(await call(server, 'where_in_space', { name: 'Hale-Bopp' }));   // thousands of years off, still a date people can read
  assert.match(text(hb), /next around \d{4}-\d\d/); assert.ok(hb.structuredContent.perihelion_note);
  const ha = ok(await call(server, 'where_in_space', { name: 'Halley' }));
  assert.match(text(ha), /next around 20[67]\d/);
});

// ---- #26: an old list -----------------------------------------------------------------------------------------------
const feed = (at, quakes) => ({ metadata: { generated: at }, features: quakes.map(([mag, mins]) => ({ properties: { mag, place: 'Testland', time: at - mins * 60e3, type: 'earthquake', tsunami: 0 }, geometry: { coordinates: [10, 10, 10] } })) });
function clocked(answer) {
  let clock = NOW;
  const feeds = createFeeds({ fetchImpl: async u => (/usgs/.test(String(u)) ? answer() : new Response('nope', { status: 404 })), now: () => clock });
  const tool = createTools({ feeds, now: () => clock, sgp4: async () => null }).find(t => t.name === 'earthquakes');
  return { tool, at: t => { clock = t; } };
}
test('mcp fix: an old USGS list is said to be old, and its rows are held to the period', async () => {
  let down = false;
  const { tool, at } = clocked(() => (down ? new Response('down', { status: 503 }) : json(feed(NOW, [[5, 30]]))));
  const fresh = await tool.run({ min_magnitude: 4.5, period: 'hour' }, {});
  assert.match(fresh.text, /^1 earthquake of magnitude 4\.5\+ in the last hour worldwide\./); assert.equal(fresh.data.stale, false); assert.equal(fresh.data.data_at, iso(NOW));
  await tool.run({ min_magnitude: 4.5, period: 'day' }, {});
  down = true; at(NOW + 20 * 3600e3);
  const old = await tool.run({ min_magnitude: 4.5, period: 'hour' }, {});
  assert.doesNotMatch(old.text.split('\n')[0], /^\d+ earthquake/);
  assert.match(old.text, /USGS's latest list here is from 20 h ago/); assert.match(old.text, /not an all-clear/); assert.match(old.text, /1 older one left out/);
  assert.equal(old.data.stale, true); assert.equal(old.data.total, 0); assert.deepEqual(old.data.earthquakes, []);
  const day = await tool.run({ min_magnitude: 4.5, period: 'day' }, {});   // still inside the day: listed, under words that don't claim it all
  assert.match(day.text, /Up to then: 1 earthquake of magnitude 4\.5\+ within the last day worldwide/); assert.equal(day.data.total, 1); assert.equal(day.data.stale, true);
});
test('mcp fix: an old list that was empty is no all-clear, a quiet fresh one still is', async () => {
  let doc = feed(NOW, []), down = false;
  const { tool, at } = clocked(() => (down ? new Response('down', { status: 503 }) : json(doc)));
  assert.match((await tool.run({ min_magnitude: 4.5, period: 'hour' }, {})).text, /^No earthquakes of magnitude 4\.5\+ in the last hour worldwide\./);
  down = true; at(NOW + 5 * 3600e3);
  const r = await tool.run({ min_magnitude: 4.5, period: 'hour' }, {});
  assert.doesNotMatch(r.text, /^No earthquakes/); assert.match(r.text, /from 5 h ago/); assert.match(r.text, /not an all-clear/);
  // the feed is up and its newest quake is old: its own stamp says it is current
  down = false; doc = feed(NOW + 10 * 3600e3, [[5, 50]]); at(NOW + 10 * 3600e3);
  const q = await tool.run({ min_magnitude: 4.5, period: 'hour' }, {});
  assert.match(q.text, /^1 earthquake of magnitude/); assert.equal(q.data.stale, false);
});

// ---- #27, #50: names ------------------------------------------------------------------------------------------------
const FACTS = JSON.parse(readFileSync(new URL('data/countries.json', root), 'utf8')).countries;
test('mcp fix: country_briefing knows today\'s official names and their usual forms', () => {
  const want = { Eswatini: 'SZ', 'North Macedonia': 'MK', 'Cabo Verde': 'CV', 'The Gambia': 'GM', Palestine: 'PS', 'State of Palestine': 'PS', 'St Lucia': 'LC', 'St. Lucia': 'LC', 'Republic of the Congo': 'CG', 'Republic of Congo': 'CG',
    'Democratic Republic of the Congo': 'CD', 'Democratic Republic of Congo': 'CD', 'The Bahamas': 'BS', 'The Philippines': 'PH', 'The Maldives': 'MV', 'St Kitts and Nevis': 'KN', 'St Vincent and the Grenadines': 'VC', 'St. Vincent': 'VC',
    'Holy See': 'VA', 'West Bank': 'PS', Gaza: 'PS', 'Republic of Ireland': 'IE', 'Republic of Korea': 'KR', "People's Republic of China": 'CN', 'Brunei Darussalam': 'BN', 'Federated States of Micronesia': 'FM',
    // and what worked before
    Japan: 'JP', JP: 'JP', JPN: 'JP', "Côte d'Ivoire": 'CI', UK: 'GB', 'the Netherlands': 'NL', Swaziland: 'SZ', Macedonia: 'MK', Bosnia: 'BA', Herzegovina: 'BA', Trinidad: 'TT', Dominican: 'DO', Dominica: 'DM', Guinea: 'GN', Niger: 'NE', Nigeria: 'NG', Sudan: 'SD', 'South Sudan': 'SS', Marshall: 'MH', 'Marshall Islands': 'MH', Zealand: 'NZ', Emirates: 'AE', Saudi: 'SA', Philippine: 'PH' };
  for (const [q, code] of Object.entries(want)) assert.equal(findCountry(FACTS, q), code, q);
});
test('mcp fix: a name that is not a country, or could be several, is not answered with a guess', async () => {
  for (const q of ['Mars', 'land', 'stan', 'Atlantis', 'Asia', 'Africa', 'Earth', 'North', 'Central', 'Island', 'Republic', 'South', 'Saint', 'Islands', 'Congo']) assert.equal(findCountry(FACTS, q), null, q);
  assert.deepEqual(matchCountries(FACTS, 'Congo').sort(), ['CD', 'CG']);
  assert.ok(matchCountries(FACTS, 'Guine').length > 1);
  const server = serve([METEO]), r = await call(server, 'country_briefing', { country: 'Congo' });
  assert.equal(r.isError, true); assert.match(text(r), /could be several countries.*Congo \((CD|CG)\).*Congo \((CD|CG)\)/);
  const m = await call(server, 'country_briefing', { country: 'Mars' });
  assert.equal(m.isError, true); assert.match(text(m), /No country called "Mars"/);
  assert.match(text(ok(await call(server, 'country_briefing', { country: 'Eswatini' }))), /\(SZ\/SWZ\)/);
});
test('mcp fix: where_in_space answers Earth and the Sun, and says when a name is only the closest', async () => {
  const server = serve([METEO]);
  for (const name of ['Earth', 'the Earth', 'earth', 'Terra']) {
    const r = ok(await call(server, 'where_in_space', { name })), d = r.structuredContent;
    assert.equal(d.name, 'Earth', name); assert.equal(d.earth_au, 0); assert.ok(d.sun_au > 0.98 && d.sun_au < 1.02); assert.ok(d.speed_km_s > 29 && d.speed_km_s < 31);
    assert.doesNotMatch(text(r), /NaN|Earthrise/); assert.match(d.url, /f=earth/);
  }
  for (const name of ['Sun', 'the sun', 'Sol']) {
    const r = ok(await call(server, 'where_in_space', { name, lat: 60, lon: 25 })), d = r.structuredContent;
    assert.equal(d.name, 'Sun', name); assert.equal(d.sun_au, 0); assert.ok(d.earth_au > 0.98 && d.earth_au < 1.02); assert.ok(d.light_time_s > 480 && d.light_time_s < 510);
    assert.doesNotMatch(text(r), /NaN|Sun-Gao/); assert.ok(Number.isFinite(d.altitude_deg)); assert.ok(Number.isFinite(d.ra_deg));
  }
  const iss = ok(await call(server, 'where_in_space', { name: 'ISS' }));
  assert.match(text(iss), /^The closest name to "ISS" here, not an exact match/); assert.match(text(iss), /where_is_satellite/); assert.equal(iss.structuredContent.name_match, 'closest');
  for (const name of ['Mars', 'Halley', 'Titan', 'Ceres', 'JWST']) {
    const r = ok(await call(server, 'where_in_space', { name }));
    assert.equal(r.structuredContent.name_match, 'exact', name); assert.doesNotMatch(text(r), /closest name/, name);
  }
});

// ---- #51, #53: eclipses ---------------------------------------------------------------------------------------------
test('mcp fix: an eclipse limit shortens the list, not the count', async () => {
  const server = serve([METEO]), at = { lat: 25.687, lon: 32.639 };
  const one = ok(await call(server, 'eclipses', { ...at, limit: 1 }));
  assert.match(text(one), /^10 solar eclipses from now to 2030; 2 of them seen from 25\.69°N 32\.64°E; the next 1 below/);
  assert.equal(one.structuredContent.eclipses.length, 1); assert.equal(one.structuredContent.total_to_2030, 10); assert.equal(one.structuredContent.seen_from_place, 2);
  const seen = ok(await call(server, 'eclipses', { ...at, limit: 1, only_visible: true }));
  assert.match(text(seen), /^2 solar eclipses seen from 25\.69°N 32\.64°E from now to 2030, of 10 in all; the next 1 below/);
  assert.equal(seen.structuredContent.eclipses[0].date, '2027-08-02');
  assert.match(text(ok(await call(server, 'eclipses', { limit: 3 }))), /^10 solar eclipses from now to 2030; the next 3 below:/);
  assert.match(text(ok(await call(server, 'eclipses', {}))), /^10 solar eclipses from now to 2030:/);
  assert.match(text(ok(await call(server, 'eclipses', at))), /^10 solar eclipses from now to 2030; 2 of them seen from [^;]+ \(times/);
});
test('mcp fix: an annular eclipse is a ring of Sun, not the Sun hidden', async () => {
  const t = text(ok(await call(serve([METEO]), 'eclipses', {})));
  assert.match(t, /2027-02-06: Annular eclipse, .*, a ring of Sun for 7 min 46 s there in a path \d+ km wide\./);
  assert.match(t, /2027-08-02: Total eclipse, .*, the Sun hidden for 6 min/);
  assert.doesNotMatch(t.split('\n').filter(l => /Annular/.test(l)).join(' '), /Sun hidden/);
});

// ---- #52: a country or its namesake ---------------------------------------------------------------------------------
// Photon's answers for these, captured when the bug was found: the country is not among "Samoa"'s first five.
const P = (props, lon, lat) => ({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: [lon, lat] } });
const CA = P({ osm_value: 'hamlet', name: 'Samoa', state: 'California', country: 'United States', countrycode: 'US' }, -124.1864562, 40.8187334);
const SAMOA = [CA, P({ osm_value: 'census', name: 'Samoa', state: 'California', country: 'United States', countrycode: 'US', extent: [-124.197617, 40.827839, -124.178582, 40.800546] }, -124.1903045, 40.8140745),
  P({ osm_value: 'suburb', name: 'Samoa', city: 'Volta Redonda', state: 'Rio de Janeiro', country: 'Brazil', countrycode: 'BR' }, -44.0696986, -22.5347735),
  P({ osm_value: 'village', name: 'Samoa', state: 'Milne Bay Province', country: 'Papua New Guinea', countrycode: 'PG' }, 151.1879016, -10.5842507),
  P({ osm_value: 'village', name: 'Samoa', state: 'Gulf Province', country: 'Papua New Guinea', countrycode: 'PG' }, 144.373998, -7.4404232)];
const FIJI = P({ osm_value: 'country', name: 'Fiji', country: 'Fiji', countrycode: 'FJ', extent: [-180, -12.2613866, 180, -21.9434274] }, 179.0122737, -18.1239696);
const NADI = P({ osm_value: 'residential', name: 'Samoa', city: 'Nadi', country: 'Fiji', countrycode: 'FJ' }, 177.44, -17.78);
const FIJIAN_WAY = P({ osm_value: 'residential', name: 'Fijian Way', city: 'Medford', state: 'Oregon', country: 'United States', countrycode: 'US' }, -122.87, 42.33);
const photon = table => [/photon\.komoot\.io/, u => {
  const q = decodeURIComponent(u.match(/q=([^&]+)/)[1]), n = +u.match(/limit=(\d+)/)[1], biased = /lat=/.test(u);
  return { features: (table(q, biased) || []).slice(0, n) };
}];
const PHOTON_SAMOA = photon((q, biased) => (q === 'Fiji' ? (biased ? [FIJIAN_WAY] : [FIJI]) : q === 'Samoa' ? (biased ? [NADI] : SAMOA) : []));
test('mcp fix: a name that is exactly a country means the country over a small namesake', async () => {
  const server = serve([PHOTON_SAMOA]);
  const r = ok(await call(server, 'distance', { places: ['Fiji', 'Samoa'] }));
  assert.match(text(r), /^From Fiji to Samoa: 1,0\d\d km as the crow flies/); assert.doesNotMatch(text(r), /California/);
  const km = r.structuredContent.distance_km; assert.ok(km > 1000 && km < 1100, String(km));
  const three = ok(await call(server, 'distance', { places: ['Fiji', 'Samoa', '-20, 170'] }));   // one answer per name: no retries on this path
  assert.equal(three.structuredContent.places[1].name, 'Samoa');
  const w = ok(await call(serve([PHOTON_SAMOA, METEO]), 'country_briefing', { place: 'Samoa' }));
  assert.match(text(w), /\(WS\/WSM\)/);
});
test('mcp fix: the country rule leaves real places alone', async () => {
  const GEORGIA = P({ osm_value: 'state', name: 'Georgia', country: 'United States', countrycode: 'US' }, -83.5, 32.7);
  const LEB = P({ osm_value: 'city', name: 'Lebanon', state: 'Pennsylvania', country: 'United States', countrycode: 'US' }, -76.4, 40.34);
  const CHAD_TOWN = P({ osm_value: 'town', name: 'Chad', state: 'Lac', country: 'Chad', countrycode: 'TD' }, 14, 13);
  const OWN = P({ osm_value: 'country', name: 'Sāmoa', country: 'Samoa', countrycode: 'WS' }, -172.2, -13.9);
  const server = serve([photon(q => ({ Georgia: [GEORGIA], Lebanon: [LEB], Chad: [CHAD_TOWN], Springfield: [P({ osm_value: 'hamlet', name: 'Springfield', country: 'Elsewhere', countrycode: 'XX' }, 2, 2)], Samoa: [CA, OWN], Atlantis: [] }[q]))]);
  const first = async q => ok(await call(server, 'distance', { places: [q, '0, 0'] })).structuredContent.places[0];
  assert.match((await first('Georgia')).name, /United States/);
  assert.match((await first('Lebanon')).name, /Pennsylvania/);
  assert.equal((await first('Chad')).lat, 13, 'its own town of that name');
  assert.equal((await first('Springfield')).lat, 2);
  assert.equal((await first('Samoa')).lon, -172.2, "the geocoder's own country hit, when it has one");
  assert.equal((await call(server, 'distance', { places: ['Atlantis', '0, 0'] })).isError, true);
  // the data copy not loading leaves the geocoder's answer
  const stub = net([PHOTON_SAMOA]), bare = createOverwatchServer({ fetchImpl: async (u, o) => (String(u).startsWith(SITE) ? new Response('down', { status: 503 }) : stub(u, o)), now: () => NOW });
  assert.match(text(ok(await call(bare, 'distance', { places: ['Samoa', '0, 0'] }))), /California/);
});

// ---- #54: a detour --------------------------------------------------------------------------------------------------
test('mcp fix: a route between the same point twice has no detour factor', async () => {
  const server = serve([[/routing\.openstreetmap\.de/, { code: 'Ok', routes: [{ distance: 0, duration: 0 }] }]]);
  for (const by of ['walk', 'drive']) {
    const r = ok(await call(server, 'distance', { places: ['48.85, 2.35', '48.85, 2.35'], by }));
    assert.doesNotMatch(text(r), /NaN|Infinity|times the straight line/); assert.match(text(r), /\(OSRM\)\./);
    assert.equal(r.structuredContent.route.detour_factor, null);
  }
  const moved = ok(await call(serve([[/routing\.openstreetmap\.de/, { code: 'Ok', routes: [{ distance: 2000, duration: 600 }] }]]), 'distance', { places: ['48.85, 2.35', '48.86, 2.35'], by: 'walk' }));
  assert.match(text(moved), /1\.8 times the straight line/); assert.ok(moved.structuredContent.route.detour_factor > 1);
});

// ---- #55: polar night -----------------------------------------------------------------------------------------------
test('mcp fix: polar night reads as polar night', async () => {
  const server = serve([METEO]), polar = { lat: 86, lon: 0 };
  const dark = ok(await call(server, 'dark_sky', polar));
  assert.match(text(dark), /Dark for the whole next 24 hours \(the Sun stays below -6°\)\./); assert.doesNotMatch(text(dark), /Dark from .* to \d\d:\d\d\./);
  const sun = ok(await call(server, 'sun_and_moon', { ...polar, date: '2026-11-06' }));
  assert.match(text(sun), /does not rise today/); assert.match(text(sun), /Solar noon \d\d:\d\d, the Sun stays 12° below the horizon\./); assert.doesNotMatch(text(sun), /-\d+° up/);
  const pole = ok(await call(server, 'sun_and_moon', { lat: 90, lon: 0, date: '2026-11-06' })).structuredContent;
  assert.equal(pole.solar_noon.slice(0, 10), '2026-11-06', 'inside the day asked about');
  // a Sun that barely rises (noon under 0° but above -0.833°) has a sunrise and a sunset: on the horizon, not below it
  let edge = null;
  for (let lat = 66; lat < 70 && !edge; lat += 0.05) {
    const r = ok(await call(server, 'sun_and_moon', { lat: +lat.toFixed(2), lon: 0, date: '2026-12-21' }));
    if (r.structuredContent.polar == null && r.structuredContent.noon_altitude_deg <= 0) edge = r;
  }
  assert.ok(edge, 'a latitude where the Sun just clears the refraction limit');
  assert.match(text(edge), /the Sun about on the horizon/); assert.doesNotMatch(text(edge), /below the horizon\./);
  assert.match(text(ok(await call(server, 'sun_and_moon', { lat: 40, lon: -105, date: '2026-11-06' }))), /Solar noon \d\d:\d\d, the Sun \d+° up\./);
  assert.match(text(ok(await call(server, 'dark_sky', { lat: 40, lon: -105 }))), /Dark from .* to \d\d:\d\d\./, 'an ordinary night keeps its clock times');
});
test('mcp fix: night_sky says the same of polar night', { skip: (await import('satellite.js').catch(() => null)) ? false : 'satellite.js is not installed (npm install)' }, async () => {
  const lib = await import('satellite.js');
  const night = createOverwatchServer({ fetchImpl: net([METEO]), sgp4: lib, now: () => NOW });
  const r = ok(await call(night, 'night_sky', { lat: 86, lon: 0 }));
  assert.match(text(r), /Dark for the whole next 24 hours/); assert.doesNotMatch(text(r), /Dark enough from/);
});

// ---- #56, #57 -------------------------------------------------------------------------------------------------------
test('mcp fix: weather\'s daily temperatures name their unit, whatever units the words use', async () => {
  const wx = [/api\.open-meteo\.com/, { timezone: 'UTC', utc_offset_seconds: 0, current: { time: '2026-11-06T12:00', temperature_2m: 9, apparent_temperature: 7, relative_humidity_2m: 80, precipitation: 0, weather_code: 3, cloud_cover: 90, wind_speed_10m: 4, wind_direction_10m: 200, wind_gusts_10m: 8 },
    daily: { time: ['2026-11-06'], weather_code: [3], temperature_2m_max: [12], temperature_2m_min: [6], precipitation_sum: [0], precipitation_probability_max: [10], wind_speed_10m_max: [6], wind_gusts_10m_max: [12], sunrise: ['2026-11-06T07:00'], sunset: ['2026-11-06T17:00'] } }];
  const r = ok(await call(serve([wx]), 'weather', { lat: 60, lon: 25, units: 'imperial' })), d = r.structuredContent.days[0];
  assert.match(text(r), /43 °F to 54 °F/);
  assert.equal(d.high_c, 12); assert.equal(d.low_c, 6); assert.ok(!('high' in d) && !('low' in d));
  assert.match(text(ok(await call(serve([wx]), 'weather', { lat: 60, lon: 25 }))), /6 °C to 12 °C/);
});
test('mcp fix: the satellite examples in the schemas are ones the website has', async () => {
  const tools = (await serve().handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).result.tools;
  const blurb = JSON.stringify(tools.filter(t => ['show_on_globe', 'where_is_satellite'].includes(t.name)).map(t => t.inputSchema));
  assert.doesNotMatch(blurb, /NOAA 19/); assert.match(blurb, /NOAA 20/);
  const tle = new URL('data/tle/weather.txt', root);
  if (existsSync(tle)) assert.match(readFileSync(tle, 'utf8'), /^NOAA 20/m);
});
