// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The 2D map (open-overwatch.html): boot, the counters from the (stubbed) feeds, the layer rail, views, the guarded
// balloon layer, the intel tabs, search, keyboard shortcuts, clicking a quake, and the share link both ways.
import { test, expect, openMap } from './support/fixtures.mjs';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

/** The rail row of a layer, its group opened the way a visitor would (a click on the group's heading). */
async function layerRow(page, id) {
  const group = page.locator(`#layers details.group:has(label.layer[data-id="${id}"])`);
  if (!(await group.evaluate(d => d.open))) await group.locator('summary').click();
  const row = page.locator(`label.layer[data-id="${id}"]`);
  await row.scrollIntoViewIfNeeded();
  return row;
}

test('boots past the splash with the feeds\' numbers in the header', async ({ page, net }) => {
  await openMap(page);
  await expect(page.locator('#verTag')).toHaveText(/^v\d+\.\d+\.\d+\.\d+$/);
  await expect(page.locator('#chipKp b')).toHaveText('3.7');                       // the fixture's last Kp, 3.67
  await expect(page.locator('#chipMil b')).toHaveText('3');                        // three on /v2/mil
  await expect(page.locator('#chipEmg b')).toHaveText('1');                        // the Cessna squawking 7700
  await expect(page.locator('#chipSat b')).not.toHaveText('—', { timeout: 30000 }); // satellites propagated from the fixture TLEs
  await expect(page.locator('#clockUtc')).toHaveText(/^\d\d:\d\d:\d\d$/);
  await expect(page.locator('.leaflet-tile-loaded').first()).toBeAttached();       // stand-in tiles drew
  expect(net.relayed.some(u => u.startsWith('https://api.adsb.lol/v2/mil'))).toBe(true);
  expect(net.celestrak, 'CelesTrak was asked first (off the website) and refused by the suite').toBeGreaterThan(0);
  await expect(page.locator('#log')).toContainText('helper', { ignoreCase: true });
});

test('switching a layer on and off sticks across a reload', async ({ page }) => {
  await openMap(page);
  const row = await layerRow(page, 'terminator');
  const box = row.locator('input');
  const was = await box.isChecked();
  await row.click();
  await expect(box).toBeChecked({ checked: !was });
  expect(await page.evaluate(() => OW.Layers.on('terminator'))).toBe(!was);
  await page.reload();
  await page.locator('#enterSilent').click();
  await expect(page.locator('#ly_terminator')).toBeChecked({ checked: !was });
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => /layers$/.test(k))))['terminator'])).toBe(!was);
});

test('the earthquake layer draws the day\'s quakes and a click opens one', async ({ page }) => {
  await openMap(page);
  await page.evaluate(() => { OW.Layers.set('quakes', true); OW.map.setView([40.6, 142.9], 6, { animate: false }); });
  await expect.poll(() => page.evaluate(() => (OW.Points.sets.quakes || Object.values(OW.Points.sets).find(s => s.layerId === 'quakes'))?.items.length || 0), { timeout: 30000 }).toBe(5);
  const at = await page.evaluate(() => { const p = OW.map.latLngToContainerPoint([40.6, 142.9]), r = document.querySelector('#map').getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; });
  await page.mouse.click(at.x, at.y);
  await expect(page.locator('#tab-detail')).toHaveClass(/on/);
  await expect(page.locator('#detail')).toContainText('Hachinohe');
  await expect(page.locator('#detail')).toContainText('6.1');
  await page.keyboard.press('Escape');
});

test('a view preset switches its layers', async ({ page }) => {
  await openMap(page);
  await page.locator('#views .view[data-preset="hazards"]').click();
  await expect(page.locator('#views .view[data-preset="hazards"]')).toHaveClass(/\bon\b/);
  await expect(page.locator('#toast')).toContainText('View: Storms & quakes');
  const on = await page.evaluate(() => OW.Layers.defs.filter(d => d.on).map(d => d.id).sort());
  expect(on).toEqual(['events', 'gdacs', 'nws', 'osm_scan', 'quakes', 'radar', 'storms', 'terminator']);
  await page.locator('#views .view[data-preset="space"]').click();
  await expect(page.locator('#ly_sats')).toBeChecked();
  await expect(page.locator('#ly_quakes')).not.toBeChecked();
});

test('a first visit offers views to start from, and picking one applies it', async ({ page }) => {
  await openMap(page, '', { welcome: true });
  const card = page.locator('#welcome');
  await expect(card).toBeVisible();
  // the splash is still fading over the card (650 ms, longer on a slow runner): click until the card has gone
  await expect(async () => { await card.locator('.view[data-preset="mil"]').click({ timeout: 5000 }); await expect(card).toBeHidden({ timeout: 2000 }); }).toPass({ timeout: 60000 });
  await expect(page.locator('#views .view[data-preset="mil"]')).toHaveClass(/\bon\b/);
  expect(await page.evaluate(() => ['air_mil', 'quakes'].map(id => OW.Layers.on(id)))).toEqual([true, false]);
  await page.reload();
  await page.locator('#enterSilent').click();
  await expect(page.locator('#splash')).toHaveClass(/out/);   // fading out (its hide timer waits on the test's frozen clock)
  await expect(card).toBeHidden();   // shown once
});

test('the balloon layer asks before it switches on', async ({ page }) => {
  await openMap(page);
  const id = await page.evaluate(() => OW.Layers.defs.find(d => d.guard)?.id);
  expect(id, 'a layer with a warning').toBeTruthy();
  const row = page.locator(`label.layer[data-id="${id}"]`);
  await page.evaluate(i => document.querySelector(`label.layer[data-id="${i}"]`).closest('details').open = true, id);
  await row.click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('[data-no]')).toBeFocused();          // the safe choice has the focus
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.locator(`#ly_${id}`)).not.toBeChecked();
  expect(await page.evaluate(i => OW.Layers.on(i), id)).toBe(false);
  await row.click();
  await dialog.locator('[data-yes]').click();
  await expect(page.locator(`#ly_${id}`)).toBeChecked();
  expect(await page.evaluate(i => OW.Layers.on(i), id)).toBe(true);
  // accepted once per session: off and on again without asking
  await row.click(); await row.click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(`#ly_${id}`)).toBeChecked();
});

test('the intel tabs switch, and the feed log clears', async ({ page }) => {
  await openMap(page);
  for (const tab of ['detail', 'log', 'setup', 'brief']) {
    await page.locator(`.tabs button[data-tab="${tab}"]`).click();
    await expect(page.locator(`#tab-${tab}`)).toHaveClass(/\bon\b/);
    await expect(page.locator(`#tab-${tab}`)).toBeVisible();
  }
  await expect(page.locator('#brief')).not.toContainText('Feeds are starting');
  await page.locator('.tabs button[data-tab="log"]').click();
  expect(await page.locator('#log > *').count()).toBeGreaterThan(2);
  await page.locator('#btnLogClear').click();
  await expect(page.locator('#log > *')).toHaveCount(0);
  await page.locator('.tabs button[data-tab="setup"]').click();
  await expect(page.locator('#setup')).not.toBeEmpty();
});

test('search finds a place by coordinates and a satellite by name', async ({ page }) => {
  await openMap(page);
  await page.locator('#q').fill('48.8566, 2.3522');
  await page.locator('#q').press('Enter');
  await expect.poll(() => page.evaluate(() => { const c = OW.map.getCenter(); return [+c.lat.toFixed(2), +c.lng.toFixed(2), OW.map.getZoom() >= 8]; }), { timeout: 15000 }).toEqual([48.86, 2.35, true]);
  await page.evaluate(() => OW.Layers.set('sats', true));
  await expect.poll(() => page.evaluate(() => OW.Dyn.sats.length), { timeout: 30000 }).toBeGreaterThan(0);
  await page.locator('#q').fill('tianhe');
  await page.locator('#q').press('Enter');
  await expect(page.locator('#tab-detail')).toHaveClass(/\bon\b/);
  await expect(page.locator('#detail')).toContainText('TIANHE');
});

test('keyboard: / focuses search, L hides the layer rail, Esc leaves the box', async ({ page }) => {
  await openMap(page);
  await page.locator('#map').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('/');
  await expect(page.locator('#q')).toBeFocused();
  await page.keyboard.type('l');                     // typing in the box is not a shortcut
  await expect(page.locator('#rail')).not.toHaveClass(/hidden/);
  await page.keyboard.press('Escape');
  await expect(page.locator('#q')).not.toBeFocused();
  await page.keyboard.press('l');
  await expect(page.locator('#rail')).toHaveClass(/hidden/);
  await page.keyboard.press('l');
  await expect(page.locator('#rail')).not.toHaveClass(/hidden/);
});

test('the share link round trip: view, layers and drawing come back', async ({ page, context }) => {
  await openMap(page);
  await page.evaluate(() => {
    OW.Layers.apply(['quakes', 'terminator', 'events']);
    OW.map.setView([35.68, 139.69], 7, { animate: false });
    return OW.Measure.importShapes([{ kind: 'line', coords: [[139.69, 35.68], [135.5, 34.69]] }, { kind: 'pin', coords: [[138.73, 35.36]], name: 'Fuji' }]);
  });
  await page.locator('#btnShare').click();
  await expect(page.locator('#toast')).toContainText('Link copied, with the drawing (2 shapes)');
  const link = await page.evaluate(() => navigator.clipboard.readText());
  const hash = decodeURIComponent(new URL(link).hash);
  expect(link).toMatch(/\/open-overwatch\.html#/);
  expect(hash).toMatch(/^#c=139\.\d+,35\.\d+,\d+,0,-90&/);
  expect(hash).toMatch(/&l=[^&]*events/);
  expect(hash).toMatch(/&d=/);

  const other = await context.newPage();
  await other.goto(link);
  await other.locator('#enterSilent').click();
  await other.waitForFunction(() => window.OW && OW.map);
  await expect.poll(() => other.evaluate(() => { const c = OW.map.getCenter(); return [+c.lat.toFixed(1), +c.lng.toFixed(1), OW.map.getZoom()]; })).toEqual([35.7, 139.7, 7]);
  expect(await other.evaluate(() => OW.Layers.defs.filter(d => d.on).map(d => d.id).sort())).toEqual(['events', 'quakes', 'terminator']);
  await expect(other.locator('#toast')).toContainText('A shared drawing: 2 shapes');
  const shapes = await other.evaluate(() => OW.Measure.exportShapes());
  expect(shapes.map(x => x.kind)).toEqual(['line', 'pin']);
  expect(shapes[0].coords[1][0]).toBeCloseTo(135.5, 3);
  expect(shapes[1].name).toBe('Fuji');
  await expect(other).toHaveURL(/open-overwatch\.html$/);   // the hash is consumed: the map keeps its own view from here on
  await other.close();
});

test('the 3D globe button carries the place and the matching layers', async ({ page }) => {
  await openMap(page);
  await page.evaluate(() => { OW.Layers.apply(['quakes', 'sats']); OW.map.setView([51.5, -0.12], 9, { animate: false }); });
  const href = await page.evaluate(() => OW.Share.globeLink());
  const hash = decodeURIComponent(href.slice(href.indexOf('#')));
  expect(href).toMatch(/^globe\.html#/);
  expect(hash).toMatch(/^#c=-0\.12,51\.5,\d+,0,-90&a=quakes$/);
  // a middle-click (a new tab) gets the same address on the button itself
  await page.locator('#btnGlobe').click({ button: 'middle' });
  await expect(page.locator('#btnGlobe')).toHaveAttribute('href', href);
});

test('a link made on the globe opens here with its counterpart layers', async ({ page }) => {
  await page.goto('open-overwatch.html#c=2.35,48.85,25000,0,-90&l=quakes,storms,stations');
  await page.locator('#enterSilent').click();
  await page.waitForFunction(() => window.OW && OW.map);
  await expect.poll(() => page.evaluate(() => { const c = OW.map.getCenter(); return [+c.lat.toFixed(1), +c.lng.toFixed(1)]; })).toEqual([48.9, 2.4]);
  const on = await page.evaluate(() => ['quakes', 'storms', 'sats'].map(id => OW.Layers.on(id)));
  expect(on).toEqual([true, true, true]);
});

test('a hostile link is refused and the map still boots', async ({ page }) => {
  await page.goto('open-overwatch.html#c=999,999,-5,0,0&l=<img src=x onerror=alert(1)>&d=AAAA');
  page.on('dialog', d => { throw new Error('a dialog opened: ' + d.message()); });
  await page.locator('#enterSilent').click();
  await page.waitForFunction(() => window.OW && OW.map);
  const c = await page.evaluate(() => OW.map.getCenter());
  expect(Math.abs(c.lat)).toBeLessThanOrEqual(90);
  expect(await page.locator('img[src=x]').count()).toBe(0);
});
