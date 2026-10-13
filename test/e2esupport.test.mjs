// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The browser tests' own machinery (e2e/support/), checked without a browser: the PNG codec and picture comparison the
// screenshot checks rest on, and the canned feed answers, read by the same parsers the pages use (so a fixture can't
// drift from the real feed's shape without this failing), and the stub network's routing table.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { compare, decodePng, downscale, encodePng, tilePng, upscale } from '../e2e/support/png.mjs';
import * as F from '../e2e/support/feeds.mjs';
import { fixtureFor } from '../e2e/support/net.mjs';
import { parseUsgs, largest } from '../src/core/quakes.js';
import { parseEonet } from '../src/core/eonet.js';
import { readsb, openskyState } from '../src/core/aircraft.js';
import { latestKp, parseOvation, ovationAt } from '../src/core/aurora.js';
import { fromLL2, upcoming } from '../src/core/launches.js';
import { fromLL2Astronaut, whoIsUp } from '../src/core/crew.js';
import { parseTle } from '../src/core/tle.js';
import { decodeView, encodeView } from '../src/core/viewlink.js';

const NOW = Date.UTC(2026, 9, 13, 19);
const img = (w, h, f) => { const d = new Uint8Array(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.set(f(x, y), (y * w + x) * 4); return { width: w, height: h, data: d }; };

test('e2e png: encode then decode gives back every pixel', () => {
  const a = img(37, 23, (x, y) => [x * 7 & 255, y * 11 & 255, (x * y) & 255, 200 + (x & 31)]);
  const b = decodePng(encodePng(a.width, a.height, a.data));
  assert.equal(b.width, 37); assert.equal(b.height, 23); assert.deepEqual([...b.data], [...a.data]);
});

test('e2e png: decodes RGB rows written with every filter (as browsers write them)', () => {
  const w = 5, h = 5, rows = [], want = img(w, h, (x, y) => [x * 40, y * 50, (x + y) * 20, 255]);
  const px = (x, y, c) => (x < 0 || y < 0 ? 0 : want.data[(y * w + x) * 4 + c]);
  for (let y = 0; y < h; y++) {   // filter type y: 0 none, 1 sub, 2 up, 3 average, 4 Paeth
    const row = [y];
    for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) {
      const v = px(x, y, c), a = px(x - 1, y, c), b = px(x, y - 1, c), cc = px(x - 1, y - 1, c);
      const p = a + b - cc, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - cc), paeth = pa <= pb && pa <= pc ? a : pb <= pc ? b : cc;
      row.push((v - [0, a, b, (a + b) >> 1, paeth][y] + 256) & 255);
    }
    rows.push(...row);
  }
  const chunk = (t, d) => { const b = Buffer.alloc(8 + d.length + 4); b.writeUInt32BE(d.length); b.write(t, 4, 'ascii'); d.copy(b, 8); return b; };   // the CRC is not checked by the decoder
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const file = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.from(rows))), chunk('IEND', Buffer.alloc(0))]);
  assert.deepEqual([...decodePng(file).data], [...want.data]);
});

test('e2e png: downscale averages areas; compare finds a change and ignores none', () => {
  const checker = img(64, 32, (x, y) => ((x + y) & 1 ? [255, 255, 255, 255] : [0, 0, 0, 255]));
  const small = downscale(checker, 16, 8);
  assert.ok([...small.data].every((v, i) => (i % 4 === 3 ? v === 255 : Math.abs(v - 128) <= 1)), 'a fine checkerboard averages to grey');
  const same = compare(small, downscale(checker, 16, 8));
  assert.equal(same.mean, 0); assert.equal(same.bad, 0);
  const moved = img(64, 32, (x, y) => (x < 32 ? [255, 255, 255, 255] : [0, 0, 0, 255])), half = img(64, 32, (x, y) => (x < 16 ? [255, 255, 255, 255] : [0, 0, 0, 255]));
  const r = compare(downscale(moved, 16, 8), downscale(half, 16, 8));
  assert.equal(r.bad, 0.25); assert.ok(Math.abs(r.mean - 255 / 4) < 1e-9);
  assert.equal(upscale(small, 3).width, 48);
  assert.throws(() => compare(small, checker), /size/);
});

test('e2e png: stand-in tiles are 256 px PNGs', () => {
  const t = decodePng(tilePng([24, 28, 34]));
  assert.equal(t.width, 256); assert.deepEqual([...t.data.slice(4 * 300, 4 * 300 + 4)], [24, 28, 34, 255]);
});

test('e2e fixtures: quakes, events, Kp and the aurora grid parse with the pages\' parsers', () => {
  const q = parseUsgs(F.usgs(NOW));
  assert.equal(q.length, 5); assert.equal(largest(q).place, '112 km E of Hachinohe, Japan'); assert.ok(q.every(x => x.time < NOW && x.time > NOW - 24 * 3600e3));
  const ev = parseEonet(F.eonet(NOW));
  assert.deepEqual(ev.map(e => e.cat), ['wildfires', 'volcanoes', 'severeStorms']); assert.equal(ev[2].track.length, 4); assert.equal(ev[2].kt, 85);
  assert.equal(latestKp(F.kp(NOW)).kp, 3.67);
  const { grid, peak } = parseOvation(F.ovation(NOW));
  assert.equal(peak, 40);
  assert.equal(ovationAt(grid, 63, -70), 40, 'the oval over Canada'); assert.equal(ovationAt(grid, 0, 0), 0);
});

test('e2e fixtures: aircraft, launches, crew and TLEs parse too', () => {
  const mil = F.readsb('https://api.adsb.lol/v2/mil', NOW).ac.map(a => readsb(a, { mil: true }));
  assert.equal(mil.filter(Boolean).length, 3); assert.ok(mil.every(a => a.mil));
  const near = F.readsb('https://opendata.adsb.fi/api/v2/lat/48.85/lon/2.35/dist/250', NOW).ac.map(a => readsb(a));
  assert.equal(near.filter(a => a.emerg).length, 1); assert.ok(near.every(a => Math.abs(a.lat - 48.85) < 1.5));
  assert.equal(F.opensky(NOW).states.map(openskyState).filter(Boolean).length, 4);
  const l = upcoming(F.launches(NOW).results.map(fromLL2).filter(Boolean), NOW);
  assert.ok(l.length >= 3); assert.equal(l[0].id, 'e2e-1');
  const crew = whoIsUp(F.astronauts(NOW).results.map(fromLL2Astronaut).filter(Boolean));
  assert.ok(crew);
  assert.deepEqual(parseTle(F.tle()).map(t => t.id), ['25544', '48274', '66052']);
});

test('e2e network: which feed gets which fixture, and what is left to block', () => {
  assert.equal(fixtureFor('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson', NOW).features.length, 5);
  assert.equal(fixtureFor('https://api.open-meteo.com/v1/forecast?latitude=51.5&longitude=-0.1&hourly=cloud_cover', NOW).hourly.time.length, 120);
  assert.equal(fixtureFor('https://api.open-meteo.com/v1/forecast?latitude=51.5,52&longitude=-0.1,0&hourly=cloud_cover', NOW), undefined, 'a grid of points is never answered: the weather panel stays off');
  assert.equal(fixtureFor('https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=2011-03-11T00:00:00&endtime=2011-03-12T00:00:00', NOW).features[0].properties.mag, 9.1, 'time travel: the catalogue');
  assert.equal(fixtureFor('https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=2011-03-10T00:00:00', NOW).features.length, 0);
  assert.equal(fixtureFor('https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=TLE', NOW), undefined);
  assert.equal(fixtureFor('https://example.com/anything', NOW), undefined);
});

test('e2e links the specs build round-trip through the core', () => {
  const v = decodeView('#' + encodeView({ lon: 1, lat: 50, height: 900000, heading: 0, pitch: -90, drawing: [{ kind: 'line', coords: [[-0.1276, 51.5072], [2.3522, 48.8566]] }] }));
  assert.equal(v.drawing.length, 1); assert.ok(Math.abs(v.drawing[0].coords[1][0] - 2.3522) < 1e-4);
});
