// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The teachers page (teach/): the print and copy buttons appear and work, printing one activity prints only that one,
// every link resolves, and the page fits a phone. The links' contents are checked in Node (test/teach.test.mjs).
import { test, expect, expectFitsWidth } from './support/fixtures.mjs';

test('the buttons appear; "Print this activity" prints that activity alone', async ({ page }) => {
  await page.addInitScript(() => { window.__prints = 0; window.print = () => { window.__prints++; }; });
  await page.goto('teach/');
  await expect(page).toHaveTitle('For teachers: classroom activities | Open Overwatch');
  await expect(page.locator('article.activity')).toHaveCount(12);
  await expect(page.locator('button[data-print]:visible')).toHaveCount(13);   // the page, and each activity
  await page.locator('button[data-print="iss"]').click();
  expect(await page.evaluate(() => window.__prints)).toBe(1);
  await expect(page.locator('#printOne article')).toHaveCount(1);
  expect(await page.evaluate(() => document.querySelectorAll('#printOne [id]').length)).toBe(0);   // no repeated ids
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('#printOne h3')).toHaveText('The ISS: why you see it at night');
  await expect(page.locator('#printOne')).toBeVisible();
  await expect(page.locator('main')).toBeHidden();
  await expect(page.locator('#printOne .tools')).toBeHidden();
  await page.evaluate(() => dispatchEvent(new Event('afterprint')));
  await expect(page.locator('#printOne')).toHaveCount(0);
  // the whole page on paper: no navigation, every activity there, white paper
  await expect(page.locator('main')).toBeVisible();
  await expect(page.locator('nav')).toBeHidden();
  await expect(page.locator('article.activity:visible')).toHaveCount(12);
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(255, 255, 255)');
  await page.emulateMedia({ media: 'screen' });
});

test('Copy puts the citation on the clipboard', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: t => { window.__copied = t; return Promise.resolve(); } }, configurable: true }); });
  await page.goto('teach/');
  await page.locator('button[data-copy="cite-apa"]').click();
  expect(await page.evaluate(() => window.__copied)).toMatch(/^Jones, D\. \(2026\)\. Open Overwatch \[Computer software\]\. Zenodo\. https:\/\/doi\.org\/10\.5281\/zenodo\.23348946$/);
  await expect(page.locator('.status')).toHaveText('Copied to the clipboard.');
  await page.locator('button[data-copy="cite-bibtex"]').click();
  expect(await page.evaluate(() => window.__copied)).toMatch(/^@software\{jones_open_overwatch_2026,[\s\S]*doi\s+= \{10\.5281\/zenodo\.23348946\}/);
});

test('every link resolves, and the page fits a phone', async ({ page }) => {
  await page.goto('teach/');
  const hrefs = await page.$$eval('a[href]', as => [...new Set(as.map(a => a.href))]);
  for (const h of hrefs.filter(h => h.startsWith(new URL('/', page.url()).href))) {
    const r = await page.request.get(h.split('#')[0]);
    expect(r.status(), h).toBe(200);
  }
  await page.setViewportSize({ width: 360, height: 760 });
  await expectFitsWidth(page, ['nav', '.wrap', '.activity', '.cite', '.url']);
});
