// The Solar System view (solar.html, three.js in software WebGL): boot, "Where is it now?" search (planets, spacecraft,
// comets, keyboard), the view as a link both ways, the clock, the layer menu and the mission and comet lists.
import { test, expect, openSolar } from './support/fixtures.mjs';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });
const focus = page => page.evaluate(() => OOSS.nav.focus?.key);

test('boots on Earth, live, with the planets and the scale ladder', async ({ page }) => {
  await openSolar(page);
  await expect(page.locator('#tRate')).toHaveText('real time');
  await expect(page.locator('#tDate')).toContainText(new Date().toISOString().slice(0, 4));
  expect(await page.evaluate(() => ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'].every(k => OOSS.byKey[k]))).toBe(true);
  expect(await page.locator('#rungs .rung').count()).toBeGreaterThanOrEqual(5);
  await expect(page.locator('#sName')).not.toHaveText('');
  expect(await page.evaluate(() => OOSS.renderer.getContext().isContextLost())).toBe(false);
});

test('search: Mars by name, with its distance, and Enter flies there', async ({ page }) => {
  await openSolar(page);
  await page.locator('#q').fill('mars');
  const hits = page.locator('#hits button');
  await expect(hits.first()).toContainText('Mars');
  await expect(hits.first().locator('em')).toContainText(/from Earth/);
  await page.locator('#q').press('Enter');
  await expect(page.locator('#hits')).toBeHidden();
  await expect(page.locator('#q')).toHaveValue('');
  await expect.poll(() => focus(page)).toBe('mars');
  await expect(page.locator('#card')).toContainText('Mars');
  await expect(page).toHaveURL(/#f=mars/, { timeout: 20000 });   // the address follows the view
});

test('search: a spacecraft, a comet, arrow keys, Escape and nothing found', async ({ page }) => {
  await openSolar(page);
  await page.keyboard.press('/');
  await expect(page.locator('#q')).toBeFocused();
  await page.keyboard.type('voyager');
  const hits = page.locator('#hits button');
  await expect(hits.first()).toContainText('Voyager');
  await expect(hits.first().locator('small')).toHaveText(/spacecraft/);
  expect(await hits.count()).toBeGreaterThanOrEqual(2);
  await page.keyboard.press('ArrowDown');
  await expect(hits.nth(1)).toHaveClass(/\bsel\b/);
  await expect(hits.first()).not.toHaveClass(/\bsel\b/);
  await page.keyboard.press('Escape');
  await expect(page.locator('#hits')).toBeHidden();

  await page.locator('#q').fill('halley');
  await expect(hits.first()).toContainText('Halley');
  await expect(hits.first().locator('small')).toHaveText('comet');
  await hits.first().click();
  await expect.poll(() => focus(page)).toMatch(/^comet:.*Halley/);

  await page.locator('#q').fill('qqxzzv');
  await expect(page.locator('#hits .note')).toContainText('Nothing found');
});

test('a link opens that body at that moment, paused, and Share copies it back', async ({ page }) => {
  await openSolar(page, '#f=jupiter&t=2026-10-12T06:00&d=0.02&r=0');
  await expect.poll(() => focus(page), { timeout: 30000 }).toBe('jupiter');
  await expect(page.locator('#tRate')).toHaveText('paused');
  await expect(page.locator('#tDate')).toContainText('2026-10-12');
  expect(await page.evaluate(() => OOSS.clock.live)).toBe(false);
  await expect.poll(() => page.evaluate(() => +OOSS.camera.position.distanceTo(OOSS.controls.target).toPrecision(2)), { timeout: 20000 }).toBe(0.02);
  await expect(page.locator('#cap')).toContainText('Shared view');
  await page.locator('#card [data-share]').click();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toMatch(/solar\.html#f=jupiter&t=2026-10-12T06%3A00&r=0&d=0\.02$/);
  await page.locator('#now').click();
  await expect(page.locator('#tRate')).toHaveText('real time');
  expect(await page.evaluate(() => OOSS.clock.live)).toBe(true);
});

test('a hand-written search link (#q=) finds its body', async ({ page }) => {
  await openSolar(page, '#q=saturn');
  await expect.poll(() => focus(page), { timeout: 30000 }).toBe('saturn');
});

test('the clock buttons change the rate', async ({ page }) => {
  await openSolar(page);
  const jd0 = await page.evaluate(() => OOSS.clock.jd);
  await page.locator('#time [data-rate="5"]').click();
  await expect(page.locator('#tRate')).toHaveText('1 month per second');
  await expect(page.locator('#time [data-rate="5"]')).toHaveClass(/\bon\b/);
  await expect.poll(() => page.evaluate(j => OOSS.clock.jd - j, jd0), { timeout: 15000 }).toBeGreaterThan(20);
  await page.locator('#time [data-rate="-4"]').click();
  await expect(page.locator('#tRate')).toHaveText('1 day per second, backwards');
  await page.locator('#time [data-rate="0"]').click();
  await expect(page.locator('#tRate')).toHaveText('paused');
});

test('the dock switches layers and opens the mission and comet lists', async ({ page }) => {
  await openSolar(page);
  await expect(page.locator('#dock')).toBeVisible();   // always shown on a desktop; phones open it with the menu button (phone.spec.mjs)
  const first = page.locator('#lys .ly[data-id]').first();
  const id = await first.getAttribute('data-id');
  const wasOff = await first.evaluate(b => b.classList.contains('off'));
  await first.click();
  expect(await page.locator(`#lys .ly[data-id="${id}"]`).evaluate(b => b.classList.contains('off'))).toBe(!wasOff);
  await page.locator(`#lys .ly[data-id="${id}"]`).click();
  expect(await page.locator(`#lys .ly[data-id="${id}"]`).evaluate(b => b.classList.contains('off'))).toBe(wasOff);

  await page.locator('#bMissions').click();
  await expect(page.locator('#list')).toBeVisible();
  await expect(page.locator('#listB')).toContainText('Voyager 1');
  await page.locator('#listX').click();
  await expect(page.locator('#list')).toBeHidden();
  await page.locator('#bComets').click();
  await expect(page.locator('#list')).toBeVisible();
  expect(await page.locator('#listB tr[data-row]').count()).toBeGreaterThan(3);
});
