// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The fixed grid of 250 nm tiles (core/airgrid.js) and what the public relay carries from adsb.lol.
import test from 'node:test';
import assert from 'node:assert/strict';
import { gridRow, tileAt, onGrid, nearestTiles, adsbLolTtl, adsbLolRelayable, AIR_TTL, TILE_KM } from '../src/core/airgrid.js';
import { publicRelayable } from '../src/core/relay.js';

test('airgrid: every tile the 2D map sweeps is on the grid, and nothing else is', () => {
  let n = 0;
  for (let r = -12; r <= 12; r++) {
    const g = gridRow(r); if (Math.abs(g.lat) > 80) continue;
    for (let k = -90; k <= 90; k++) { const t = tileAt(g.lat, k * g.dLon + g.off); assert.ok(onGrid(t.lat, t.lon), `${t.lat},${t.lon}`); n++; }
  }
  assert.ok(n > 1000);
  for (const [la, lo] of [[0, 0.001], [0.001, 0], [6.25, 0], [51.5, -0.12], [90, 0], [0, 180], [NaN, 0]]) assert.equal(onGrid(la, lo), false, `${la},${lo}`);
  assert.ok(onGrid(0, 0));
});

// The grid spaces its rows for a flat hexagonal packing, so slivers between the circles reach ~14% past 250 nm (the 2D
// map's sweep has always had them; the planes there show in the next pass's neighbour or fly out of them in minutes).
test('airgrid: the nearest tile is never far off (slivers only, to 78°)', () => {
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 2000; i++) {
    const lat = -78 + 156 * rnd(), lon = -180 + 360 * rnd(), near = nearestTiles(lat, lon, 3);
    assert.equal(near.length, 3);
    assert.ok(near[0].km <= TILE_KM * (Math.abs(lat) < 70 ? 1.16 : 1.4), `${lat},${lon}: ${near[0].km} km`);
    for (const t of near) assert.ok(onGrid(t.lat, t.lon));
    assert.ok(near[0].km <= near[1].km && near[1].km <= near[2].km);
  }
  const wrap = nearestTiles(0, 179.9, 3);   // across the antimeridian: longitudes stay in [-180, 180)
  for (const t of wrap) assert.ok(t.lon >= -180 && t.lon < 180);
});

test('airgrid: which adsb.lol queries the relay shares, and for how long', () => {
  const t = nearestTiles(40.7, -74, 1)[0];
  assert.equal(adsbLolTtl('/v2/mil'), AIR_TTL.mil);
  assert.equal(adsbLolTtl('/v2/squawk/7700'), AIR_TTL.squawk);
  assert.equal(adsbLolTtl('/v2/squawk/7500'), AIR_TTL.squawk);
  assert.equal(adsbLolTtl(`/v2/point/${t.lat}/${t.lon}/250`), AIR_TTL.point);
  for (const p of ['/v2/squawk/1200', `/v2/point/${t.lat}/${t.lon}/100`, '/v2/point/40.7/-74/250', '/v2/hex/abc123', '/v2/callsign/BAW1', '/v2/registration/N1', '/v2/mil/', '/v2/ladd'])
    assert.equal(adsbLolTtl(p), 0, p);
  assert.ok(AIR_TTL.mil >= 30 && AIR_TTL.mil <= 60 && AIR_TTL.point >= 30 && AIR_TTL.point <= 60);
  assert.ok(adsbLolRelayable('https://api.adsb.lol/v2/mil'));
  for (const u of ['https://api.adsb.lol/v2/mil?x=1', 'http://api.adsb.lol/v2/mil', 'https://api.adsb.lol:444/v2/mil', 'https://opendata.adsb.fi/api/v2/mil', 'not a url'])
    assert.equal(adsbLolRelayable(u), false, u);
});

test('relay routing: the website sends the listed hosts through the relay, and no aircraft feed (adsb.lol refuses Cloudflare)', () => {
  const t = nearestTiles(51.5, -0.1, 1)[0];
  for (const u of ['https://www.nhc.noaa.gov/CurrentStorms.json', 'https://www.ndbc.noaa.gov/activestations.xml']) assert.ok(publicRelayable(u), u);
  for (const u of ['https://api.adsb.lol/v2/mil', `https://api.adsb.lol/v2/point/${t.lat}/${t.lon}/250`, 'https://opensky-network.org/api/states/all', 'https://opendata.adsb.fi/api/v2/mil', 'https://api.airplanes.live/v2/mil', 'https://api.adsb.lol/v2/hex/abc123', 'https://api.adsb.lol/v2/point/51.5/-0.1/250'])
    assert.equal(publicRelayable(u), false, u);
});
