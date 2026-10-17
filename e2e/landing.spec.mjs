// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The landing page (index.html): the live strip reads the (stubbed) feeds, the version picker re-points the launch
// buttons, the fleet viewer and the phone demo respond, and every link to this site's own pages resolves.
import { test, expect } from './support/fixtures.mjs';

test.beforeEach(async ({ page }) => { await page.goto('index.html'); });

test('the live strip shows the ISS, the day\'s quakes and the next launch', async ({ page }) => {
  await expect(page.locator('#iss')).toContainText('50.2°N 1.4°W');
  await expect(page.locator('#iss small')).toContainText('418 km up · 27,580 km/h · daylight');
  await expect(page.locator('#qk')).toContainText('5 quakes');
  await expect(page.locator('#qk small')).toContainText('largest M6.1 · 112 km E of Hachinohe, Japan');
  await expect(page.locator('#lchRow')).toBeVisible();
  await expect(page.locator('#lch')).toHaveText(/^T-1 d \d\d:\d\d:\d\d/);   // the fixture's first launch is 30 h out
  await expect(page.locator('#lch small')).toContainText('Falcon 9 Block 5 · SDA Tranche 1 Transport Layer A · Vandenberg SFB, CA, USA');
  await expect(page.locator('#utc')).toHaveText(/^\d\d:\d\d:\d\d UTC$/);
  await expect(page.locator('#ver')).toHaveText('Version v0.9.2.9 · Oct 13, 2026 · Win · Mac · Linux');
});

test('the version picker re-points the launch buttons', async ({ page }) => {
  const sel = page.locator('#verSel');
  await expect(sel.locator('option')).toHaveCount(2);
  await expect(sel.locator('option').first()).toHaveText(/v0\.9\.2\.9 · latest · Oct 13, 2026/);
  await expect(page.locator('#goSolar')).toHaveAttribute('href', 'v/v0.9.2.9/solar.html');
  await sel.selectOption('v0.9.1');
  await expect(page.locator('#goMap')).toHaveAttribute('href', 'v/v0.9.1/open-overwatch.html');
  await expect(page.locator('#goGlobe')).toHaveAttribute('href', 'v/v0.9.1/globe.html');
  await expect(page.locator('#goSolar')).toHaveAttribute('aria-disabled', 'true');   // the Solar System came later
  await expect(page.locator('#goSolar')).not.toHaveAttribute('href', /./);
  await expect(page.locator('#verNotes')).toContainText('The rebuild');
  await expect(page.locator('#verList .vrow')).toHaveCount(3);
  await expect(page.locator('#verList .vrow').nth(1).locator('a', { hasText: '.zip' })).toHaveAttribute('href', 'https://github.com/destinjones/open-overwatch/releases/download/v0.9.1/open-overwatch.zip');
});

test('a retired version is in the history as a download, not in the picker', async ({ page }) => {
  await expect(page.locator('#verSel option')).toHaveCount(2);
  await expect(page.locator('#verSel option', { hasText: 'v0.5' })).toHaveCount(0);
  const row = page.locator('#verList .vrow').nth(2);
  await expect(row).toContainText('v0.5');
  await expect(row).toContainText('download only');
  await expect(row.locator('a', { hasText: 'Map' })).toHaveCount(0);
  await expect(row.locator('a', { hasText: '.zip' })).toHaveAttribute('href', 'https://github.com/destinjones/open-overwatch/releases/download/v0.5/open-overwatch.zip');
});

test('?v= opens the picker on that version', async ({ page }) => {
  await page.goto('index.html?v=v0.9.1');
  await expect(page.locator('#verSel')).toHaveValue('v0.9.1');
  await expect(page.locator('#goSolar')).toHaveAttribute('aria-disabled', 'true');
  await page.goto('index.html?v=v0.5');   // retired: the newest one, rather than a launch button that leads nowhere
  await expect(page.locator('#verSel')).toHaveValue('v0.9.2.9');
  await expect(page.locator('#goMap')).toHaveAttribute('href', 'v/v0.9.2.9/open-overwatch.html');
});

test('the fleet viewer swaps models and their specs', async ({ page }) => {
  const picker = page.locator('#picker button');
  await expect(picker).toHaveCount(10);
  await expect(picker.filter({ hasText: 'ISS' })).toHaveAttribute('aria-pressed', 'true');
  await picker.filter({ hasText: 'Hubble' }).click();
  await expect(picker.filter({ hasText: 'Hubble' })).toHaveAttribute('aria-pressed', 'true');
  await expect(picker.filter({ hasText: 'ISS' })).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => page.locator('#mv').evaluate(el => el.src)).toMatch(/brand\/models\/hubble\.glb$/);   // model-viewer keeps src as a property
  expect(await page.locator('#mv').evaluate(el => el.alt)).toBe('3D model: Space telescope');
  await expect(page.locator('#spec')).toContainText('~530 km LEO');
  for (const k of ['iss', 'css', 'hubble', 'soyuz', 'starlink', 'gnss', 'geo', 'weather', 'smallsat', 'rocketbody']) {
    const r = await page.request.head(`brand/models/${k}.glb`);
    expect(r.status(), `brand/models/${k}.glb`).toBe(200);
  }
});

test('the phone demo plays the tab that was picked', async ({ page }) => {
  const tab = page.locator('.tab[data-clip="hazards"]');
  await tab.scrollIntoViewIfNeeded();
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.tab[data-clip="air_world"]')).toHaveAttribute('aria-selected', 'false');
  await expect(page.locator('#phoneVid')).toHaveAttribute('src', 'brand/lander/clips/hazards.mp4');
  expect((await page.request.head('brand/lander/clips/hazards.jpg')).status()).toBe(200);
});

test('every link to this site\'s own pages and files resolves', async ({ page }) => {
  const links = await page.$$eval('a[href]', as => [...new Set(as.map(a => a.getAttribute('href')))]);
  const own = links.filter(h => !/^(https?:|mailto:|#|javascript:)/.test(h) && !/^v\//.test(h));   // v/<tag>/ exists only on the website
  expect(own.length).toBeGreaterThan(5);
  for (const h of own) {
    const [file, frag] = h.split('#');
    if (file) expect((await page.request.get(file)).status(), h).toBe(200);
    if (frag && !/=/.test(frag)) {   // an anchor on that page (not a globe link like #go=launches)
      const html = await (await page.request.get(file || 'index.html')).text();
      expect(html, `${h}: no element with that id`).toContain(`id="${frag}"`);
    }
  }
});

test('the hero, nav and download button are on screen', async ({ page }) => {
  await expect(page.locator('#nav')).toBeVisible();
  await expect(page.locator('#dlBtn')).toHaveAttribute('href', /releases\/latest\/download\/open-overwatch\.zip$/);
  await page.mouse.wheel(0, 600);
  await expect(page.locator('#nav')).toHaveClass(/solid/);
});
