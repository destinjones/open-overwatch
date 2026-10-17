// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Picture checks of a few views that hold still: a fixed moment, a fixed camera, fixture data, the interface's clocks
// hidden. References are thumbnails in e2e/snapshots/ (support/snap.mjs explains the tolerances and how to update).
import { test, expect, openMap, openGlobe, openSolar } from './support/fixtures.mjs';
import { expectLooksLike } from './support/snap.mjs';
import { jdFromMs } from '../src/core/time.js';

const AT = '2026-10-13T19:00:00Z';
test.skip(!!process.env.OO_E2E_GPU, 'picture checks need the software renderer (the references are SwiftShader pictures)');
test.use({ fixedNow: AT });

/** Wait until nothing has been fetched for a while and two more frames have been drawn. */
async function settle(page, ms = 1500) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(ms);
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
}

test('the globe over Europe at a fixed moment', async ({ page }, testInfo) => {
  // on GitHub's runner this picture comes out two ways from run to run (the day/night shading, or the stand-in tiles evenly
  // lit, whichever layer finishes first), so it can't be a pass/fail check there; it still runs locally and with OO_E2E_ALL=1
  test.skip(!!process.env.CI && !process.env.OO_E2E_ALL, 'flaky on the CI runner: two pictures run to run (see the comment)');
  // SwiftShader starts the globe on Low. Low now renders at 0.75 scale with no FXAA, limb halo or cloud relief, and no
  // other level matches the old Low the reference was taken at, so globe-europe.png is to be refreshed (OO_E2E_ALL=1,
  // OO_E2E_UPDATE=1) on the next GitHub run rather than pinned to a level here
  const jd = jdFromMs(Date.parse(AT));
  await openGlobe(page, `#c=10,30,16000000,0,-90&t=${jd},0&l=stations,quakes,clouds,night`);
  await page.waitForFunction(() => OO3D.viewer.scene.globe.tilesLoaded, null, { timeout: 60000 });
  await settle(page, 3000);
  await page.waitForFunction(() => OO3D.viewer.scene.globe.tilesLoaded, null, { timeout: 60000 });
  await expectLooksLike(page, testInfo, 'globe-europe', { hide: ['body > *:not(#globe)', '.cesium-widget-credits'], maxMean: 6, maxBad: 0.03 });
});

test('Saturn from close by, paused', async ({ page }, testInfo) => {
  await openSolar(page, '#f=saturn&t=2026-10-12T06:00&d=0.004&r=0');
  await expect.poll(() => page.evaluate(() => OOSS.nav.focus?.key), { timeout: 30000 }).toBe('saturn');
  await expect.poll(() => page.evaluate(() => +OOSS.camera.position.distanceTo(OOSS.controls.target).toPrecision(2)), { timeout: 30000 }).toBe(0.004);
  await settle(page, 2500);
  await expectLooksLike(page, testInfo, 'solar-saturn', { hide: ['body > *:not(#c)'], maxMean: 6, maxBad: 0.03 });
});

test('the 2D map\'s first screen with the stand-in tiles and the fixture feeds', async ({ page }, testInfo) => {
  await openMap(page, '#c=0,30,20000000,0,-90&l=quakes,air_mil,terminator');
  await expect(page.locator('#chipMil b')).toHaveText('3');
  await expect.poll(() => page.evaluate(() => Object.values(OW.Points.sets).find(s => s.layerId === 'quakes')?.items.length || 0), { timeout: 30000 }).toBe(5);
  await settle(page);
  await expectLooksLike(page, testInfo, 'map-first-screen', { hide: ['#clockUtc', '#clockLocal', '#hudPos', '#hudSweep', '#toast', '#brief', '#log', '#logCount'], maxMean: 6, maxBad: 0.04 });
});

test('the guide\'s first screen', async ({ page }, testInfo) => {
  await page.goto('guide.html');
  await settle(page, 500);
  await expectLooksLike(page, testInfo, 'guide-top', { maxMean: 5, maxBad: 0.03 });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  test('Tonight at Greenwich', async ({ page }, testInfo) => {
    await page.goto('tonight.html');
    await page.locator('#tnGreen').tap();
    await expect(page.locator('#card')).toContainText('Next launch anywhere');
    await expect(page.locator('#card')).toContainText('the Moon covers');
    await settle(page, 800);
    await expectLooksLike(page, testInfo, 'tonight-phone', { width: 103, hide: ['#toast'], maxMean: 5, maxBad: 0.03 });
  });
});
