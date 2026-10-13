// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The user guide (guide.html) and the about page: every "on this page" link lands on its section, every link into the
// site opens a page that exists (and the section it names), outside links are https, and the skip link works.
import { test, expect } from './support/fixtures.mjs';

const pageHtml = new Map();
async function html(request, file) {
  if (!pageHtml.has(file)) { const r = await request.get(file); expect(r.status(), file).toBe(200); pageHtml.set(file, await r.text()); }
  return pageHtml.get(file);
}

for (const file of ['guide.html', 'about.html']) {
  test(`${file}: every link resolves, in the page and across the site`, async ({ page }) => {
    await page.goto(file);
    const hrefs = await page.$$eval('a[href]', as => [...new Set(as.map(a => a.getAttribute('href')))]);
    const ids = new Set(await page.$$eval('[id]', els => els.map(e => e.id)));
    const outside = [], broken = [];
    for (const h of hrefs) {
      if (/^https?:/.test(h)) { outside.push(h); continue; }
      if (/^mailto:/.test(h) || h === '#') continue;   // '#': script-handled (the shell's skip link)
      const [f, frag] = h.split('#');
      if (!f) { if (!ids.has(frag)) broken.push(`${h}: no such section here`); continue; }
      const target = await html(page.request, f);
      if (frag && !/=/.test(frag) && !target.includes(`id="${frag}"`)) broken.push(`${h}: ${f} has no id "${frag}"`);
    }
    expect(broken).toEqual([]);
    expect(outside.filter(h => !h.startsWith('https://')), 'outside links over plain http').toEqual([]);
  });
}

test('the guide\'s "on this page" links scroll to their sections', async ({ page }) => {
  await page.goto('guide.html');
  const toc = page.locator('.toc a');
  expect(await toc.count()).toBeGreaterThanOrEqual(18);
  for (const name of ['Keyboard', 'The 2D map', 'Privacy']) {
    const a = toc.filter({ hasText: new RegExp(`^${name}$`) });
    const id = (await a.getAttribute('href')).slice(1);
    await a.click();
    await expect(page).toHaveURL(new RegExp(`#${id}$`));
    await expect(page.locator(`#${id} h2`)).toBeInViewport();
  }
});

test('every guide section is labelled by its own heading', async ({ page }) => {
  await page.goto('guide.html');
  const sections = await page.$$eval('main section', ss => ss.map(s => ({ id: s.id, by: s.getAttribute('aria-labelledby'), h: s.querySelector('h2')?.id, text: s.querySelector('h2')?.textContent.trim() })));
  expect(sections.length).toBeGreaterThanOrEqual(18);
  for (const s of sections) { expect(s.by, s.id).toBe(s.h); expect(s.text, s.id).toBeTruthy(); }
  // the keyboard tables list keys for each view
  expect(await page.locator('#keys kbd').count()).toBeGreaterThan(20);
});

test('the skip link moves the focus past the navigation', async ({ page }) => {
  await page.goto('guide.html');
  await page.keyboard.press('Tab');
  const skip = page.locator('a.skip');
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();   // shown when focused, hidden otherwise
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#main$/);
});

test('the guide\'s buttons open each view', async ({ page }) => {
  await page.goto('guide.html');
  for (const [text, file] of [['The 2D map', 'open-overwatch.html'], ['The Solar System', 'solar.html'], ['Tonight above you', 'tonight.html']])
    await expect(page.locator('.cta a', { hasText: text })).toHaveAttribute('href', file);
  await page.locator('.cta a', { hasText: 'Tonight above you' }).click();
  await expect(page).toHaveURL(/tonight\.html$/);
  await expect(page.locator('#card h2')).toHaveText('Tonight above you');
});
