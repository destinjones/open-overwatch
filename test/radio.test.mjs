// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
import test from 'node:test';
import assert from 'node:assert/strict';
import { httpUrl, httpsUrl, tidyName, cleanStations, tunerSet, dLon, dialPos, dialIndex } from '../src/core/radio.js';

const row = (o = {}) => ({ stationuuid: 'u' + Math.random().toString(36).slice(2), name: 'Test FM', url: 'https://a.example/s', url_resolved: 'https://a.example/s.mp3',
  homepage: 'https://a.example/', tags: 'jazz,news', country: 'Testland', countrycode: 'tl', state: 'Capital', codec: 'MP3', bitrate: 128,
  votes: 10, clickcount: 5, hls: 0, geo_lat: 10, geo_long: 20, ...o });

test('radio: link schemes', () => {
  assert.equal(httpUrl('https://x.example/a?b=1'), 'https://x.example/a?b=1');
  assert.equal(httpUrl('HTTP://x.example'), 'http://x.example/');
  for (const bad of ['javascript:alert(1)', ' javascript:alert(1)', 'data:text/html,hi', '//x.example', 'ftp://x', '', null, 42]) assert.equal(httpUrl(bad), '');
  assert.equal(httpsUrl('http://x.example/live'), '');
  assert.equal(httpsUrl('https://x.example/live'), 'https://x.example/live');
});

test('radio: names are tidied and capped', () => {
  assert.equal(tidyName('  ## Radio One  '), 'Radio One');
  assert.equal(tidyName(''), 'Unnamed station');
  const t = tidyName('Super Station Of Everything - the best hits jazz rock pop dance chill 24/7 live');
  assert.equal(t, 'Super Station Of Everything');
  assert.ok(tidyName('x'.repeat(80)).length <= 42);
});

test('radio: cleanStations keeps geolocated https streams only', () => {
  const rows = [
    row({ stationuuid: 'a' }),
    row({ stationuuid: 'a' }),                                            // duplicate
    row({ stationuuid: 'b', url_resolved: 'http://plain.example/s', url: 'http://plain.example/s' }),   // http only: mixed content
    row({ stationuuid: 'c', url_resolved: 'http://plain.example/s', url: 'https://ok.example/s' }),     // falls back to an https url
    row({ stationuuid: 'd', geo_lat: null }),
    row({ stationuuid: 'e', geo_lat: 0, geo_long: 0 }),
    row({ stationuuid: 'f', geo_lat: 95 }),
    row({ stationuuid: 'g', hls: 1, url_resolved: 'https://h.example/live.m3u8' }),
    row({ stationuuid: 'h', homepage: 'javascript:alert(1)', tags: 'a,b,c,d,e,f,g,h' }),
  ];
  const all = cleanStations(rows);
  assert.deepEqual(all.map(s => s.id), ['a', 'c', 'g', 'h']);
  assert.equal(all[1].url, 'https://ok.example/s');
  assert.equal(all[3].homepage, '');
  assert.equal(all[3].tags.length, 6);
  assert.equal(all[0].cc, 'TL');
  assert.deepEqual(cleanStations(rows, { hls: false }).map(s => s.id), ['a', 'c', 'h']);
  assert.equal(cleanStations(rows, { max: 2 }).length, 2);
});

test('radio: dLon wraps across the date line', () => {
  assert.equal(dLon(170, -170), 20);
  assert.equal(dLon(-170, 170), -20);
  assert.equal(dLon(0, 180), 180);
  assert.equal(dLon(10, 10), 0);
});

test('radio: tunerSet picks the nearest, caps crowded spots, sorts west to east', () => {
  const list = cleanStations([
    row({ stationuuid: 'far', geo_lat: 48, geo_long: 30 }),
    row({ stationuuid: 'w', geo_lat: 50, geo_long: 9 }),
    row({ stationuuid: 'e', geo_lat: 50, geo_long: 11 }),
    ...Array.from({ length: 6 }, (_, i) => row({ stationuuid: 'hub' + i, geo_lat: 50.3, geo_long: 10, votes: i, name: 'Hub ' + i })),
  ]);
  const set = tunerSet(list, 10, 50, { n: 6, perSpot: 2 });
  assert.equal(set.length, 5);   // 2 from the crowded spot, w, e, far
  assert.deepEqual(set.map(x => x.st.id), ['w', 'hub4', 'hub5', 'e', 'far']);   // the two best-voted at the hub, by name
  assert.ok(set.every((x, i) => i === 0 || dLon(10, set[i - 1].st.lon) <= dLon(10, x.st.lon)));
  assert.ok(set[0].km > 70 && set[0].km < 75);   // 1 degree of longitude at 50 N
  assert.strictEqual(set[0].st, list[1]);        // the station objects themselves, not copies
  // across the date line: west of 180 comes before east of it
  const pac = cleanStations([row({ stationuuid: 'fiji', geo_lat: -18, geo_long: 178 }), row({ stationuuid: 'samoa', geo_lat: -14, geo_long: -172 })]);
  assert.deepEqual(tunerSet(pac, 179, -16).map(x => x.st.id), ['fiji', 'samoa']);
});

test('radio: dial position and detents round-trip', () => {
  assert.equal(dialPos(0, 1), 0.5); assert.equal(dialPos(0, 5), 0); assert.equal(dialPos(4, 5), 1); assert.equal(dialPos(2, 5), 0.5);
  assert.equal(dialIndex(0.5, 0), -1); assert.equal(dialIndex(0.9, 1), 0);
  for (let n = 2; n < 50; n += 7) for (let i = 0; i < n; i++) assert.equal(dialIndex(dialPos(i, n), n), i);
  assert.equal(dialIndex(-3, 10), 0); assert.equal(dialIndex(7, 10), 9); assert.equal(dialIndex(NaN, 10), 0);
  assert.equal(dialIndex(0.12, 5), 0); assert.equal(dialIndex(0.13, 5), 1);
});

test('radio mirrors: the first that answers wins, else the first error', async () => {
  const { firstMirror, radioTagUrl, radioSearchUrl, RADIO_HOSTS } = await import('../src/core/radio.js');
  const tried = [];
  const r = await firstMirror(async host => { tried.push(host); if (host.startsWith('all')) throw new Error('CORS'); return 42; });
  assert.deepEqual(r, { host: 'de1.api.radio-browser.info', value: 42 }); assert.deepEqual(tried, ['all.api.radio-browser.info', 'de1.api.radio-browser.info']);
  await assert.rejects(firstMirror(async h => { throw new Error('down ' + h); }), /down all\.api/);
  assert.equal(radioTagUrl('x.example', 'dub techno'), 'https://x.example/json/stations/bytag/dub%20techno?limit=14&hidebroken=true&order=clickcount&reverse=true');
  assert.match(radioSearchUrl('x.example', '3000x'), /limit=0$/);
  assert.equal(RADIO_HOSTS.length, 3);
});
