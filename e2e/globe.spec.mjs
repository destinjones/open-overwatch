// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The 3D globe (globe.html, CesiumJS in software WebGL): boot, the counters from the (stubbed) feeds, the layer dock,
// the time bar, the band's panels (search, launches, eclipses, measure), the share link both ways, the link to the 2D
// map, and a hostile link.
import { test, expect, openGlobe } from './support/fixtures.mjs';
import { encodeView } from '../src/core/viewlink.js';
import { jdFromMs } from '../src/core/time.js';

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
