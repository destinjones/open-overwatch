// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The India landing page (india/): English first, the हिन्दी toggle and its memory, ad tags out of the address bar and
// out of shared links, the live strip and the pass table from the (stubbed) feeds, and every link resolving.
import { test, expect } from './support/fixtures.mjs';

const AT = '2026-10-02T12:00:00Z';   // a day after the fixture TLE's epoch (test/fixtures/stations.tle)
test.use({ fixedNow: AT });

test('English by default; the toggle switches to Hindi, and the choice is remembered', async ({ page }) => {
  await page.goto('india/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('h1 [lang="en"]').first()).toBeVisible();
  await expect(page.locator('h1 [lang="hi"]').first()).toBeHidden();
  await expect(page).toHaveTitle('India, live from space · Open Overwatch');
  await page.locator('#langBtn').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'hi');
  await expect(page.locator('h1 [lang="hi"]').first()).toHaveText('भारत, अंतरिक्ष से लाइव।');
  await expect(page.locator('h1 [lang="en"]').first()).toBeHidden();
  await expect(page).toHaveTitle('भारत, अंतरिक्ष से लाइव · Open Overwatch');
  expect(await page.evaluate(() => localStorage.getItem('oo-lang'))).toBe('hi');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'hi');
  await expect(page.locator('#langBtn .to-en')).toBeVisible();   // the button offers the other language
  await page.locator('#langBtn').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  // the Devanagari face is the self-hosted one
  await page.goto('india/?lang=hi');
  await expect.poll(() => page.evaluate(async () => { await document.fonts.ready; return [...document.fonts].some(f => f.family.replace(/"/g, '') === 'Noto Sans Devanagari' && f.status === 'loaded'); })).toBe(true);
});

test('?lang=hi opens in Hindi; utm tags leave the address bar and never reach a shared link', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(navigator, 'share', { value: d => { window.__shared = d; return Promise.resolve(); }, configurable: true }); });
  await page.goto('india/?utm_source=meta&utm_medium=paid_social&utm_campaign=in_launch&utm_content=v1&lang=hi&fbclid=x1');
  await expect(page.locator('html')).toHaveAttribute('lang', 'hi');
  await expect.poll(() => page.url()).toMatch(/\/india\/\?lang=hi$/);
  await page.locator('#shareBtn').click();
  const shared = await page.evaluate(() => window.__shared);
  expect(shared.url).toMatch(/\/india\/hi\/$/);   // the Hindi page itself, so the preview card is in Hindi too
  expect(shared.url).not.toMatch(/utm_|fbclid/);
  expect(shared.title).toBe('भारत, अंतरिक्ष से लाइव · Open Overwatch');
});

test('the live strip, the launch list and the pass table', async ({ page }) => {
  await page.goto('india/');
  await expect(page.locator('#ist')).toHaveText(/^\d\d:\d\d:\d\d IST$/);
  await expect(page.locator('#ist')).toHaveText('17:30:00 IST');   // 12:00 UTC, the fixed clock
  await expect(page.locator('#issNow')).toContainText('50.2°N 1.4°W');
  await expect(page.locator('#issNow small [lang="en"]')).toHaveText('418 km up · 27,580 km/h');
  await expect(page.locator('#qk [lang="en"]').first()).toHaveText('0 quakes');   // the fixture's quakes are all outside South Asia
  // the fixture's launches are none of them from India: the list says so, the strip row stays hidden
  await expect(page.locator('#inLaunches')).toContainText('No launch from India is on the list');
  await expect(page.locator('#lchRow')).toBeHidden();
  await page.locator('#iss').scrollIntoViewIfNeeded();
  const rows = page.locator('.passes tbody tr');
  await expect(rows).toHaveCount(6, { timeout: 30_000 });
  await expect(rows.first().locator('td').first()).toContainText('Delhi');
  for (let i = 0; i < 6; i++) await expect(rows.nth(i).locator('td').nth(1)).toContainText(/\d+ min · up to \d+°/);
});

test('an Indian launch in the copy shows in the list and the strip', async ({ page, context }) => {
  await context.route(/\/data\/launches\.json$/, route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results: [
    { id: 'e2e-shar-1', name: 'PSLV-XL | TDS-01', net: '2026-11-30T00:00:00Z', net_precision: { abbrev: 'M' }, rocket: { configuration: { full_name: 'PSLV XL' } }, mission: { name: 'TDS-01' },
      pad: { name: 'Satish Dhawan Space Centre First Launch Pad', location: { name: 'Satish Dhawan Space Centre, India' } } },
    { id: 'e2e-ksc-1', name: 'Falcon 9', net: '2026-10-03T00:00:00Z', net_precision: { abbrev: 'MIN' }, pad: { location: { name: 'Kennedy Space Center, FL, USA', country_code: 'USA' } } },
  ] }) }));
  await page.goto('india/');
  await expect(page.locator('#inLaunches li')).toHaveCount(1);
  await expect(page.locator('#inLaunches li a')).toHaveText('PSLV XL · TDS-01');
  await expect(page.locator('#inLaunches li a')).toHaveAttribute('href', /^https?:\/\/[^/]+\/(.*\/)?globe\.html#go=launches&id=e2e-shar-1$/);
  expect(await page.locator('#inLaunches li a').evaluate(a => a.href)).toBe(new URL('globe.html#go=launches&id=e2e-shar-1', new URL('../', page.url())).href);
  await expect(page.locator('#inLaunches li small [lang="en"]')).toHaveText('target: November 2026');
  await expect(page.locator('#lchRow')).toBeVisible();
});

test('the phone demo plays the tab that was picked', async ({ page }) => {
  await page.goto('india/');
  const tab = page.locator('.tab[data-clip="lookup"]');
  await tab.scrollIntoViewIfNeeded();
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#phoneVid')).toHaveAttribute('src', new URL('../brand/india/clips/lookup.mp4', page.url()).href);
  // a real tab list: the phone screen is the panel, one tab in the tab order, the arrow keys move the selection
  await expect(tab).toHaveAttribute('aria-controls', 'clipPanel');
  await expect(tab).toHaveAttribute('tabindex', '0');
  await expect(page.locator('#clipPanel')).toHaveAttribute('aria-labelledby', await tab.getAttribute('id'));
  await tab.press('ArrowUp');
  const airq = page.locator('.tab[data-clip="airq"]');
  await expect(airq).toHaveAttribute('aria-selected', 'true');
  await expect(airq).toBeFocused();
  await expect(tab).toHaveAttribute('tabindex', '-1');
  await expect(page.locator('#phoneVid')).toHaveAttribute('src', /airq\.mp4$/);
  // the play/pause button stays on screen once a clip is up
  await expect(page.locator('#phonePlay')).toBeVisible();
  await expect(page.locator('#phonePlay')).toHaveAttribute('aria-label', /^(Pause|Play) the recordings$/);
  for (const c of ['india_sats', 'delhi_dive', 'airq', 'lookup']) expect((await page.request.head(`brand/india/clips/${c}.jpg`)).status(), c).toBe(200);
});

test('every link to this site\'s own pages and files resolves', async ({ page }) => {
  await page.goto('india/');
  const links = await page.$$eval('a[href]', as => [...new Set(as.map(a => a.href))]);
  const own = links.filter(h => h.startsWith(new URL(page.url()).origin));
  expect(own.length).toBeGreaterThan(20);
  for (const h of own) {
    const u = new URL(h);
    expect((await page.request.get(u.pathname)).status(), h).toBe(200);
    if (u.hash && !u.hash.includes('=')) {   // an anchor on that page (not a globe link like #go=launches)
      const html = await (await page.request.get(u.pathname)).text();
      expect(html, `${h}: no element with that id`).toContain(`id="${u.hash.slice(1)}"`);
    }
  }
  // the main page links here
  await page.goto('index.html');
  await expect(page.locator('footer a[href="india/"]')).toBeVisible();
});

test('india/hi/ is the same page opening in Hindi, at its own address, with the site files one folder up', async ({ page }) => {
  await page.goto('india/hi/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'hi');
  await expect(page).toHaveTitle('भारत, अंतरिक्ष से लाइव · Open Overwatch');
  await expect(page.locator('h1 [lang="hi"]').first()).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://destinjones.github.io/open-overwatch/india/hi/');
  await expect(page.locator('.hero-media picture img')).toHaveAttribute('alt', /भारत/);
  expect(await page.evaluate(() => document.documentElement.dataset.ooPage)).toBe('india');
  // the live strip and the pass table load the site's copies from ../../
  await expect(page.locator('#inLaunches')).toContainText('No launch from India is on the list');
  await page.locator('#iss').scrollIntoViewIfNeeded();
  await expect(page.locator('.passes tbody tr')).toHaveCount(6, { timeout: 30_000 });
  // English on the toggle: the address says so, a reload keeps it, and sharing gives the English page
  await page.addInitScript(() => { Object.defineProperty(navigator, 'share', { value: d => { window.__shared = d; return Promise.resolve(); }, configurable: true }); });
  await page.locator('#langBtn').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect.poll(() => page.url()).toMatch(/\/india\/hi\/\?lang=en$/);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page).toHaveTitle('India, live from space · Open Overwatch');
  await page.locator('#shareBtn').click();
  expect((await page.evaluate(() => window.__shared)).url).toMatch(/\/india\/$/);
  // without ?lang=, india/hi/ is Hindi again even though English was picked
  await page.goto('india/hi/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'hi');
});

test('every link on india/hi/ resolves', async ({ page }) => {
  await page.goto('india/hi/');
  const own = (await page.$$eval('a[href], img[src], link[href], script[src]', els => [...new Set(els.map(e => e.href || e.src))]))
    .filter(h => h.startsWith(new URL(page.url()).origin));
  expect(own.length).toBeGreaterThan(20);
  for (const h of own) expect((await page.request.get(new URL(h).pathname)).status(), h).toBe(200);
});
