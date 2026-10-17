// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The 3D globe (globe.html, CesiumJS in software WebGL): boot, the counters from the (stubbed) feeds, the layer dock,
// the time bar, the band's panels (search, launches, eclipses, measure), the share link both ways, the link to the 2D
// map, a hostile link; the panels a link opens (#go=: Earth now, falling soon, near misses, crew, flybys, find a
// flight), weather mode, an Ops look and a voice command; and the zoom out to the Solar System and back.
import { test, expect, openGlobe } from './support/fixtures.mjs';
import { encodeView } from '../src/core/viewlink.js';
import { jdFromMs } from '../src/core/time.js';
import { AU_KM } from '../src/core/units.js';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

const camera = page => page.evaluate(() => {
  const c = OO3D.viewer.camera, p = c.positionCartographic, deg = r => r * 180 / Math.PI;
  return { lon: deg(p.longitude), lat: deg(p.latitude), h: p.height, heading: deg(c.heading), pitch: deg(c.pitch) };
});

test('boots with satellites, aircraft and quakes from the feeds', async ({ page, net }) => {
  await openGlobe(page);
  await expect(page.locator('#sQk')).toHaveText('5');
  await expect(page.locator('#sMil')).toHaveText('3');
  await expect(page.locator('#sSat')).not.toHaveText(/^(—|0)$/, { timeout: 30000 });
  expect(await page.evaluate(() => OO3D.Sats.list.some(s => s.id === '25544'))).toBe(true);
  expect(await page.evaluate(() => OO3D.Quakes.list.map(q => q.mag).sort((a, b) => b - a)[0])).toBe(6.1);
  await expect(page.locator('#bandName')).not.toHaveText('—');
  await expect(page.locator('#tMode')).toHaveText('live');
  expect(net.celestrak, 'CelesTrak was tried first (off the website) and refused by the suite').toBeGreaterThan(0);
  expect(await page.evaluate(() => { const gl = OO3D.viewer.scene.context._gl; return !!gl && !gl.isContextLost(); })).toBe(true);
});

test('the layer dock switches layers, and they stay switched', async ({ page }) => {
  await openGlobe(page);
  await page.locator('#btnDock').click();
  await expect(page.locator('#dock')).toHaveClass(/\bopen\b/);
  const quakes = page.locator('#dock [data-ly="quakes"]');
  await expect(quakes).not.toHaveClass(/\boff\b/);
  await quakes.click();
  await expect(quakes).toHaveClass(/\boff\b/);
  expect(await page.evaluate(() => OO3D.L.quakes.on)).toBe(false);
  expect(await page.evaluate(() => localStorage.getItem('oo3d.ly.quakes'))).toBe('false');
  const ships = page.locator('#dock [data-ly="ships"]');
  await ships.click();
  await expect(ships).not.toHaveClass(/\boff\b/);
  await page.reload();
  await page.waitForFunction(() => window.OO3D && OO3D.L);
  expect(await page.evaluate(() => [OO3D.L.quakes.on, OO3D.L.ships.on])).toEqual([false, true]);
  await page.locator('#btnDock').click();
  await expect(page.locator('#dock [data-ly="quakes"]')).toHaveClass(/\boff\b/);
});

test('the time bar runs time forward, pauses and comes back to now', async ({ page }) => {
  await openGlobe(page);
  await page.locator('#timebar [data-rate="3600"]').click();
  await expect(page.locator('#tMode')).toHaveText(/1 h\/s/);
  await expect(page.locator('#timebar [data-rate="3600"]')).toHaveClass(/\bon\b/);
  await expect.poll(() => page.evaluate(() => OO3D.time.nowMs() - Date.now()), { timeout: 20000 }).toBeGreaterThan(2 * 3600e3);
  await page.locator('#timebar [data-rate="0"]').click();
  await expect(page.locator('#tMode')).toHaveText(/paused/);
  const t1 = await page.evaluate(() => OO3D.time.nowMs());
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => OO3D.time.nowMs())).toBe(t1);
  await page.locator('#tLive').click();
  await expect(page.locator('#tMode')).toHaveText('live');
  expect(Math.abs(await page.evaluate(() => OO3D.time.nowMs() - Date.now()))).toBeLessThan(5000);
});

test('search finds the ISS by its everyday name and opens its card', async ({ page }) => {
  await openGlobe(page);
  await page.waitForFunction(() => OO3D.Sats.list.length > 0, null, { timeout: 30000 });
  await page.locator('#band [data-go="search"]').click();
  const q = page.locator('#srQ');
  await expect(q).toBeVisible();
  await q.fill('iss');
  const first = page.locator('#srRes .sr').first();
  await expect(first).toContainText('ISS');
  await first.click();
  await expect(page.locator('#card')).toContainText('25544');
  await page.locator('#card .x').click();
  // a country by name
  await page.locator('#band [data-go="search"]').click();
  await page.locator('#srQ').fill('Japan');
  await expect(page.locator('#srRes .sr').first()).toContainText('Japan');
});

test('the band opens launches and eclipses with their lists', async ({ page }) => {
  await openGlobe(page);
  await page.locator('#band [data-go="launches"]').click();
  await expect(page.locator('#card .cj.lc').first()).toBeVisible({ timeout: 20000 });
  await expect(page.locator('#card')).toContainText('Falcon 9');
  await expect(page.locator('#card')).toContainText('Owl Night');
  await page.locator('#card .x').click();
  await page.locator('#band [data-go="eclipses"]').click();
  await expect(page.locator('#card .cj').first()).toBeVisible({ timeout: 20000 });
  expect(await page.locator('#card .cj').count()).toBeGreaterThanOrEqual(4);   // 2027-2030
  await expect(page.locator('#card')).toContainText(/2027/);
});

test('time travel: a moment from the band rewinds the quakes to the catalogue, Now brings the live feed back', async ({ page }) => {
  await openGlobe(page);
  await expect(page.locator('#sQk')).toHaveText('5');
  await page.locator('#band [data-go="history"]').click();
  await expect(page.locator('#tt')).toBeVisible();
  await page.locator('#tt [data-m="tohoku"]').click();
  await expect(page.locator('#ttNow')).toHaveText('2011-03-11 06:30 UTC');
  await expect(page.locator('#tMode')).toContainText('not live');
  // the catalogue fixture's M6+ quakes of that day, up to 06:30 (the M9.1 at 05:46 and what followed in 44 minutes)
  await expect.poll(() => page.evaluate(() => OO3D.Quakes.list.map(q => q.mag).sort((a, b) => b - a)[0]), { timeout: 20000 }).toBe(9.1);
  const n = +(await page.locator('#sQk').textContent());
  expect(n).toBeGreaterThan(1); expect(n).toBeLessThan(25);
  await expect(page.locator('#ttStatus')).toContainText('M2.5+ in the 24 h before');
  await expect(page.locator('#ttStatus')).toContainText('live or upcoming only');
  expect(await page.evaluate(() => OO3D.Share.link())).toMatch(/[#&]t=2455631\.77083(,|%2C)0\b.*&go=history$/);   // URLSearchParams writes the comma as %2C
  await page.locator('#tt [data-live]').click();
  await expect(page.locator('#tMode')).toHaveText('live');
  await expect(page.locator('#sQk')).toHaveText('5', { timeout: 10000 });
});

test('measure: M opens the panel, and a drawing in a link shows its distance', async ({ page, context }) => {
  await openGlobe(page);
  await page.keyboard.press('m');   // the guide's shortcut (the band's button can sit under the zoom pad at laptop widths)
  await expect(page.locator('#card')).toHaveClass(/show/);
  await expect(page.locator('#card h2')).toHaveText('Measure');
  await expect(page.locator('#card .k')).toHaveText('Draw and measure');
  await page.keyboard.press('m');
  await expect(page.locator('#card')).not.toHaveClass(/show/);   // M again closes it
  // a drawing arrives through a link (made with the same core/viewlink.js): London to Paris, 343.9 km on the WGS84 ellipsoid (GeographicLib agrees)
  const hash = encodeView({ lon: 1, lat: 50, height: 900000, heading: 0, pitch: -90, drawing: [{ kind: 'line', coords: [[-0.1276, 51.5072], [2.3522, 48.8566]] }] });
  await page.close();   // one software-WebGL globe at a time: two starve a 2-core runner
  const other = await context.newPage();
  await openGlobe(other, '#' + hash);
  await expect(other.locator('#card')).toContainText('213.7 mi · 343.9 km', { timeout: 30000 });
  await other.close();
});

test('the share link round trip: camera, layers and a paused time come back', async ({ page, context }) => {
  await openGlobe(page);
  await page.evaluate(jd => {
    OO3D.viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(139.7, 35.6, 2500000), orientation: { heading: Cesium.Math.toRadians(20), pitch: Cesium.Math.toRadians(-70), roll: 0 } });
    for (const l of ['quakes', 'storms']) OO3D.L[l].on = false; OO3D.L.ships.on = true; OO3D.applyVisibility();
    OO3D.time.setJd(jd, 0);   // paused
  }, jdFromMs(Date.UTC(2026, 9, 13, 18)));
  const before = await camera(page);
  await page.locator('#navpad [data-n="share"]').click();
  await expect(page.locator('#toast')).toContainText('Link to this view copied');
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(decodeURIComponent(link)).toMatch(/&t=2461327\.25\d*,0/);

  await page.close();   // one globe at a time (see measure)
  const other = await context.newPage();
  await openGlobe(other, new URL(link).hash);
  await expect.poll(async () => { const c = await camera(other); return [c.lon.toFixed(1), c.lat.toFixed(1), Math.round(c.h / 1e4), Math.round(c.heading), Math.round(c.pitch)]; }, { timeout: 30000 })
    .toEqual([before.lon.toFixed(1), before.lat.toFixed(1), Math.round(before.h / 1e4), Math.round(before.heading), Math.round(before.pitch)]);
  expect(await other.evaluate(() => [OO3D.L.quakes.on, OO3D.L.storms.on, OO3D.L.ships.on, OO3D.L.stations.on])).toEqual([false, false, true, true]);
  expect(await other.evaluate(() => [OO3D.time.live, OO3D.time.rate, new Date(OO3D.time.nowMs()).toISOString().slice(0, 16)])).toEqual([false, 0, '2026-10-13T18:00']);
  await expect(other.locator('#tMode')).toContainText('paused');
  await other.close();
});

test('"Classic map" opens the 2D map on the same place', async ({ page }) => {
  await openGlobe(page);
  await page.evaluate(() => OO3D.viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(12.5, 41.9, 300000) }));
  await page.locator('#btnClassic').hover();
  await page.locator('#btnClassic').click({ button: 'right' });   // the address is written on the way to any click
  const href = await page.locator('#btnClassic').getAttribute('href');
  expect(decodeURIComponent(href)).toMatch(/^open-overwatch\.html#c=12\.5\d*,41\.9\d*,3\d{5},0,-90/);
  await page.keyboard.press('Escape');
  await page.locator('#btnClassic').click();
  await expect(page).toHaveURL(/open-overwatch\.html/);
  await page.locator('#enterSilent').click();
  await page.waitForFunction(() => window.OW && OW.map);
  const c = await page.evaluate(() => OW.map.getCenter());
  expect(c.lat).toBeCloseTo(41.9, 0);
  expect(c.lng).toBeCloseTo(12.5, 0);
});

test('a hostile link is refused and the globe still boots', async ({ page }) => {
  let dialog = null; page.on('dialog', d => { dialog = d.message(); d.dismiss(); });
  await openGlobe(page, '#c=NaN,Infinity,-1e99,0,0&l=<script>alert(1)</script>&k=ZZ"><img src=x onerror=alert(2)>&t=1e999,5');
  await page.waitForTimeout(1500);
  expect(dialog).toBeNull();
  expect(await page.locator('img[src=x]').count()).toBe(0);
  const c = await camera(page);
  expect(Number.isFinite(c.lon) && Number.isFinite(c.lat) && c.h > 0).toBe(true);
});

// ---- the panels a link opens (#go=, core/viewlink.js GO). Several per globe boot: each software-WebGL boot is ~20 s.
const AT = '2026-10-13T19:00:00Z';   // the re-entry list and the near misses (feeds.mjs SOCRATES_AT) are fixed for this moment
const go = (page, name) => page.evaluate(n => { location.hash = '#go=' + n; }, name);   // a new hash in an open page is applied like an arriving link

test.describe('panels from a link', () => {
  test.use({ fixedNow: AT });

  test('Earth now, falling soon and near misses, from the canned feeds', async ({ page }) => {
    test.slow();   // one software-WebGL boot, then three panels that each wait on a feed
    await openGlobe(page, '#go=now');
    await expect(page.locator('#now')).toHaveClass(/\bshow\b/);
    await expect(page.locator('#nwTitle')).toHaveText('Earth now');
    await expect(page.locator('#nwBody')).toContainText('5 quakes M2.5+ in 24 h', { timeout: 30000 });
    await expect(page.locator('#nwBody')).toContainText('14 people are in space right now', { timeout: 30000 });
    await page.locator('#nwX').click();
    await expect(page.locator('#now')).not.toHaveClass(/\bshow\b/);

    // falling soon: worked out here from the TLE fixture's elements; at AT only object 66052 comes down within 30 days
    await go(page, 'reentry');
    await expect(page.locator('#card h2')).toHaveText('Falling soon');
    const falling = page.locator('#card .cjl .cj');
    await expect(falling).toHaveCount(1, { timeout: 60000 });
    await expect(falling.first()).toContainText('66052');
    await expect(page.locator('#card')).toContainText(/1 of \d+ loaded objects/);
    await falling.first().click();
    await expect(page.locator('#card h2')).toHaveText('66052');
    await expect(page.locator('#card .k')).toContainText('Re-entry');

    // near misses: data/socrates.json from test/fixtures/socrates-small.csv, the past one dropped, closest first
    await page.waitForFunction(() => OO3D.Sats.byId.has('25544'), null, { timeout: 30000 });
    await go(page, 'conj');
    await expect(page.locator('#card h2')).toHaveText('Near misses');
    const rows = page.locator('#card .cjl .cj');
    await expect(rows).toHaveCount(3, { timeout: 20000 });
    await expect(rows.first()).toContainText('412 m');
    await expect(rows.first()).toContainText('ISS (ZARYA) × COSMOS 1408 DEB');
    await expect(rows.first()).not.toHaveClass(/\bdim\b/);
    await expect(rows.nth(2)).toHaveClass(/\bdim\b/);   // neither Starlink-1007 nor the Iridium debris is in the loaded groups
    await expect(page.locator('#card')).toContainText('updated 2026-10-13 17:00 UTC');
    // picking one sets the clock to 45 s before the closest approach (20 h after AT) and follows the ISS through it
    await rows.first().click();
    await expect(page.locator('#card')).toContainText('14.21 km/s');
    await expect.poll(() => page.evaluate(() => OO3D.time.live)).toBe(false);
    const lead = await page.evaluate(tca => tca - OO3D.time.nowMs(), Date.parse(AT) + 20 * 3600e3);
    expect(lead).toBeGreaterThan(-15e3); expect(lead).toBeLessThan(46e3);
    // the followed near miss rewrites the card every 100 ms (conjunctions.js updateHud), so the button is a new element
    // faster than a software-WebGL frame: clicked without the actionability wait, through its own onclick
    await page.evaluate(() => document.querySelector('#cjNow').click());
    await expect(page.locator('#tMode')).toHaveText('live');
  });

  test('people in space, flybys and find a flight', async ({ page }) => {
    test.slow();   // as above: one boot, three panels
    await openGlobe(page, '#go=crew');   // crew has no band button: the link opens it by itself
    await expect(page.locator('#card h2')).toHaveText('People in space');
    await expect(page.locator('#card .tn-head')).toHaveText('14 people are in space right now: 11 on the ISS and 3 on Tiangong.', { timeout: 30000 });
    await expect(page.locator('#card')).toContainText('Jessica Meir');
    await expect(page.locator('#card')).toContainText('Also listed: Starman');

    // flybys: data/flybys.json is made by the site build only, so here the panel says so instead of listing
    await go(page, 'flybys');
    await expect(page.locator('#card h2')).toHaveText('Flybys');
    await expect(page.locator('#card')).toContainText("isn't available here", { timeout: 30000 });

    // find a flight: nonsense is refused; a callsign is asked of adsb.lol through the local relay (canned) and followed
    await go(page, 'flight');
    await expect(page.locator('#card h2')).toHaveText('Find a flight');
    await page.locator('#flQ').fill('!!');
    await page.locator('#flQ').press('Enter');
    await expect(page.locator('#flMsg')).toContainText("doesn't look like a flight number");
    await page.locator('#flQ').fill('RYR4TW');
    await page.locator('#flQ').press('Enter');
    await expect(page.locator('#toast')).toContainText('Found RYR4TW', { timeout: 30000 });
    await expect.poll(() => page.evaluate(() => OO3D.Flight.shareId)).toBe('RYR4TW');   // and the next share link finds it
  });
});

test('weather mode opens on the radar frames, says what it could not reach, and closes', async ({ page }) => {
  await openGlobe(page);
  // the band's button can sit under the zoom pad at laptop widths: clicked the way share.js opens a panel
  await page.evaluate(() => document.querySelector('#band [data-go="weather"]').click());
  await expect(page.locator('#wx')).toHaveClass(/\bshow\b/);
  await expect(page.locator('#wxTime')).toContainText('observed', { timeout: 60000 });
  expect(await page.evaluate(() => [OO3D.Weather.on, OO3D.Weather.radar.length, OO3D.Weather.ir.length])).toEqual([true, 13, 0]);
  await expect(page.locator('#wxSets [data-set]')).toHaveCount(9);
  await expect(page.locator('#wxNote')).toContainText('No infrared images reachable.');   // the GIBS stand-ins are blank: no scan found
  await expect(page.locator('#wxScale')).toContainText('no forecast reachable');          // the GFS and ECMWF files are not canned
  await page.locator('#wx .x').click();
  await expect(page.locator('#wx')).not.toHaveClass(/\bshow\b/);
  expect(await page.evaluate(() => OO3D.Weather.on)).toBe(false);
});

test('an Ops look from a link (thermal, HUD, boxes), a voice command, and a plain link puts it back', async ({ page }) => {
  await openGlobe(page, '#c=139.7,35.6,2500000,0,-90&o=flir.h.d');
  const body = page.locator('body');
  await expect(body).toHaveAttribute('data-sensor', 'flir', { timeout: 30000 });
  await expect(body).toHaveClass(/\bops-hud\b/);
  await expect(page.locator('#opsRail [data-s="flir"]')).toHaveClass(/\bon\b/);
  await expect(page.locator('#opsRail [data-o="detect"]')).toHaveClass(/\bon\b/);
  await expect(page.locator('#opsHud .oh-tl')).toContainText('OVERWATCH ◆ WHT');
  expect(await page.evaluate(() => [OO3D.Ops.sensor, OO3D.Ops.hud, OO3D.Ops.detect])).toEqual(['flir', true, true]);
  expect(await page.evaluate(() => OO3D.Share.link())).toMatch(/[#&]o=flir\.h\.d(&|$)/);   // the next link carries it on
  // a spoken command (Voice.run is what the microphone's transcript is handed to)
  await page.evaluate(() => OO3D.Voice.run('night vision'));
  await expect(body).toHaveAttribute('data-sensor', 'nvg');
  // a new link without &o= goes back to normal colour, no HUD, no boxes
  await page.evaluate(() => { location.hash = '#c=139.7,35.6,2500000,0,-90'; });
  await expect(body).toHaveAttribute('data-sensor', 'normal');
  await expect(body).not.toHaveClass(/\bops-hud\b/);
  expect(await page.evaluate(() => [OO3D.Ops.hud, OO3D.Ops.detect])).toEqual([false, false]);
});

// ---- one zoom: past the Moon the globe hands its camera and clock to the Solar System (src/globe/space.js, an iframe of
// solar.html?embed=1) and stops drawing; zooming into Earth there hands both back (src/solar/embed.js).
test('zooming out past the Moon hands over to the Solar System with the same clock, and zooming in hands back', async ({ page }) => {
  test.slow();   // two software-WebGL views in one page: the Solar System loads and compiles while the globe draws
  const SOLAR = 'iframe[src="solar.html?embed=1"]', AU_M = AU_KM * 1000;
  const solar = fn => page.evaluate(`(${fn})(document.querySelector('${SOLAR}').contentWindow.OOSS)`);
  // the globe's frame counter: it stands still while the globe's render loop is off
  const frameNo = () => page.evaluate(() => OO3D.viewer.scene.frameState.frameNumber);
  await openGlobe(page);
  const jd = jdFromMs(Date.UTC(2026, 9, 13, 18));
  await page.evaluate(jd => OO3D.time.setJd(jd, 0), jd);   // paused at a moment that isn't now: the Solar System must take the globe's clock
  // beyond the hand-over height (space.js ENTER_M = 3.0e8 m; the Moon is ~3.8e8 m out), looking straight down at Earth
  const H0 = 4.0e8;
  await page.evaluate(h => OO3D.viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(20, 10, h) }), H0);
  await expect(page.locator(SOLAR)).toHaveCount(1, { timeout: 30000 });
  // the hand-over waits for the Solar System to draw once and warm its shaders (at most 8 s once loaded), then cross-fades
  await expect.poll(() => page.evaluate(() => OO3D.space.active), { timeout: 240000, intervals: [1000] }).toBe(true);
  await expect.poll(() => page.evaluate(() => OO3D.viewer.useDefaultRenderLoop), { timeout: 10000 }).toBe(false);
  // only one renderer draws at a time: sampled over 1 s, longer than the battery saver's 200 ms idle frame (saver.js)
  const f0 = await frameNo();
  await page.evaluate(() => new Promise(r => setTimeout(r, 1000)));
  expect(await frameNo()).toBe(f0);
  const s = await solar(S => ({ active: S.embed.active, live: S.clock.live, jd: S.clock.jd, rate: S.clock.rate, running: S.loop.running, focus: S.nav.focus && S.nav.focus.key, au: S.camera.position.distanceTo(S.byKey.earth.pos) }));
  expect(s).toMatchObject({ active: true, live: false, rate: 0, running: true, focus: 'earth' });
  expect(Math.abs(s.jd - jd) * 86400).toBeLessThan(60);   // the globe's moment, to the minute
  expect(s.au * AU_M / (H0 + 6.378e6)).toBeCloseTo(1, 1);   // the same distance from Earth: metres crossed as ecliptic vectors, not km or AU
  await expect(page.locator(SOLAR)).toHaveCSS('opacity', '1');

  // back in: the Solar System's way home (its "3D globe" link) flies to Earth; below 2.2e8 m (embed.js EXIT_M) it hands back
  await expect.poll(() => solar(S => S.controls.enabled), { timeout: 30000 }).toBe(true);   // its arrival animation is over
  await solar(S => S.embed.goToEarth());
  await expect.poll(() => page.evaluate(() => OO3D.space.active), { timeout: 120000, intervals: [500] }).toBe(false);
  expect(await page.evaluate(() => OO3D.viewer.useDefaultRenderLoop)).toBe(true);
  const f1 = await frameNo();
  await expect.poll(frameNo, { timeout: 10000 }).toBeGreaterThan(f1);   // the globe draws again (at 5 fps once the saver idles)
  const c = await camera(page);
  expect(c.h).toBeGreaterThan(1.0e8); expect(c.h).toBeLessThan(2.2e8);   // where the Solar System left the camera
  expect(await page.evaluate(() => [OO3D.time.live, OO3D.time.rate])).toEqual([false, 0]);   // and the clock comes back with it
  expect(Math.abs(await page.evaluate(() => OO3D.time.jd()) - jd) * 86400).toBeLessThan(60);
  await expect(page.locator(SOLAR)).toHaveCSS('opacity', '0');
  await expect.poll(() => solar(S => S.loop.running), { timeout: 10000 }).toBe(false);   // the Solar System sleeps again
});
