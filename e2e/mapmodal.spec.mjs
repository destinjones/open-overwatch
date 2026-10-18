// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The 2D map for keyboards and privacy: the first-run welcome is a modal dialog; a click on a dot that has no card (the
// plate-reader cloud) opens the probe instead of a broken card; and "Center on me" without a device fix asks for a tap
// on the map instead of an IP lookup, keeps that place rounded, and Setup forgets it.
import { test, expect, openMap } from './support/fixtures.mjs';

const inside = page => page.evaluate(() => !!document.activeElement?.closest('#welcome'));
const behindInert = page => page.evaluate(() => ['#top', '#rail', '#mapwrap', '#panel'].map(q => document.querySelector(q).inert));

test('the welcome card holds the focus, keeps Tab inside, and hands the map back', async ({ page }) => {
  await openMap(page, '', { welcome: true });
  const card = page.locator('#welcome');
  await expect(card).toBeVisible();
  await expect(card.locator('[role="dialog"]')).toHaveAttribute('aria-modal', 'true');
  await expect(card.locator('.wgrid .view').first()).toBeFocused();   // not <body>: the splash that had the focus is gone
  expect(await behindInert(page)).toEqual([true, true, true, true]);
  for (let i = 0; i < 12; i++) { await page.keyboard.press('Tab'); expect(await inside(page), `Tab ${i + 1}`).toBe(true); }
  await page.keyboard.press('Shift+Tab'); expect(await inside(page)).toBe(true);
  await card.locator('#wSkip').focus();
  await page.keyboard.press('Space');   // a real button: Space works (it did not on the old <a role=button>)
  await expect(card).toBeHidden();
  expect(await behindInert(page)).toEqual([false, false, false, false]);
  await expect(page.locator('#map')).toBeFocused();
});

test('a click on a dot that has no card (the plate-reader cloud) opens the probe, and selects nothing', async ({ page }) => {
  await openMap(page);
  const at = await page.evaluate(() => {
    OW.Layers.apply(['quakes']); OW.map.setView([10, 10], 8, { animate: false });
    // the ALPR layer's heat dots below zoom 10: no kind, no obj
    OW.Points.define('e2e_cloud', 'quakes'); const items = [];
    for (let i = -5; i <= 5; i++) for (let j = -5; j <= 5; j++) items.push({ lat: 10 + i * .02, lon: 10 + j * .02, r: 1.4, color: '#ff3b8f', alpha: .55, fillAlpha: .9 });
    OW.Points.set('e2e_cloud', items); OW.glyphs.draw();
    const p = OW.map.latLngToContainerPoint([10, 10]), r = document.querySelector('#map').getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y };
  });
  await page.mouse.click(at.x, at.y);
  await expect(page.locator('.probe')).toBeVisible();
  expect(await page.evaluate(() => [OW.Sel.kind ?? null, OW.Sel.obj ?? null])).toEqual([null, null]);
});

test('Center on me without a device fix asks for a tap, keeps that place rounded, and Setup forgets it: no IP lookup', async ({ page, net }) => {
  await page.addInitScript(() => {
    // an older version kept this from its ipapi.co fallback; and the device has no fix (not a refusal: the old code's IP case)
    try { localStorage.setItem('ow.pos', JSON.stringify({ lat: 40.712776, lon: -74.005974, how: 'approximate (IP)', t: Date.now() })); } catch (e) { }
    const g = { getCurrentPosition: (ok, err) => setTimeout(() => err({ code: 2, message: 'position unavailable' }), 10), watchPosition: () => 0, clearWatch: () => { } };
    Object.defineProperty(navigator, 'geolocation', { get: () => g, configurable: true });
  });
  await openMap(page);
  expect(await page.evaluate(() => [OW.Locate.pos, localStorage.getItem('ow.pos')])).toEqual([null, null]);   // dropped at load
  await page.evaluate(() => { OW.Layers.apply([]); OW.map.setView([48.8512, 2.2912], 12, { animate: false }); });
  await page.locator('#btnLocate').click();
  await expect(page.locator('#toast')).toContainText('Tap the map where you are');
  const at = await page.evaluate(() => { const p = OW.map.latLngToContainerPoint([48.8512, 2.2912]), r = document.querySelector('#map').getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; });
  await page.mouse.click(at.x, at.y);
  await expect(page.locator('#toast')).toContainText('Your place is set here');
  await expect(page.locator('.probe')).toHaveCount(0);   // the tap was the answer, not a probe
  const kept = await page.evaluate(() => [OW.Locate.pos, JSON.parse(localStorage.getItem('ow.pos'))]);
  expect(kept[0]).toMatchObject({ lat: 48.85, lon: 2.29, how: 'picked' });   // to 0.01°, about 1 km
  expect(kept[1]).toEqual(kept[0]);
  await page.evaluate(() => OW.showTab('setup'));
  await page.locator('#keysForgetPlace').click();
  await expect(page.locator('#toast')).toContainText('forgotten');
  expect(await page.evaluate(() => [OW.Locate.pos, localStorage.getItem('ow.pos')])).toEqual([null, null]);
  expect(net.blocked.filter(u => /ipapi|ip-api|ipinfo/.test(u)), 'no IP-location request').toEqual([]);
});
