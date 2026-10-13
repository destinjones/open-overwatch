// Tonight above you (tonight.html): the page's clock is fixed at 2026-10-13 19:00 UTC and the location is London, so the
// sky answers (planets, meteors, the Moon, the next eclipse) are the same on every run. The data are the fixtures:
// the space stations' TLEs, the launch list, the astronauts, the OVATION grid and a clear-evening cloud forecast.
import { test, expect, PORT } from './support/test.mjs';
import { stubNetwork } from './support/net.mjs';

const AT = '2026-10-13T19:00:00Z';
test.use({ fixedNow: AT, geolocation: { latitude: 51.5, longitude: -0.12 }, permissions: ['geolocation', 'clipboard-read', 'clipboard-write'] });
const card = page => page.locator('#card');

test('asks first, then answers for where you are', async ({ page }) => {
  await page.goto('tonight.html');
  await expect(page.locator('#tnLoc')).toBeVisible();
  await expect(card(page)).toContainText('Your location is used on this device only');
  await page.locator('#tnLoc').click();
  await expect(card(page).locator('.k').first()).toContainText('51.50, -0.12');
  // the sky over London at 19:00 UTC on Tuesday 13 October 2026
  for (const line of [
    /Saturn: up \d+:\d\d PM to Wed \d+:\d\d AM, highest in the S around 11:\d\d PM \(40°\)/,
    /Venus: not up while it's dark/,
    /Jupiter: halfway up in the SE before dawn/,
    /Orionids peaks in 7 nights/,
    /Waxing crescent · 10% lit/,
    /Next full Moon: Monday, Oct 26, 4:16 AM · the Hunter's Moon/,
    /Sat, Nov 7: the Moon passes 1\.0° from Venus/,
    /Mostly clear all night/,                                                    // the cloud fixture: clear evenings
    /Next launch anywhere: Falcon 9 Block 5 \(SpaceX\), Thu 1:00 AM from Vandenberg SFB, CA, USA/,   // 30 h after the fixed moment
    /Right now the ISS is over [A-Z][^,]+, 4\d\d km up/,
    /14 people are in space right now: 11 on the ISS and 3 on Tiangong/,
    /August 2, 2027.*the Moon covers \d+% of the Sun from here/,
  ]) await expect(card(page), String(line)).toContainText(line, { timeout: 20000 });
  await expect(card(page)).not.toContainText('unreachable');
});

test('remembers the place for the next visit, and forgets it on request', async ({ page }) => {
  await page.goto('tonight.html');
  await page.locator('#tnLoc').click();
  await expect(card(page).locator('.k').first()).toContainText('saved on this device');
  await page.reload();
  await expect(card(page).locator('.k').first()).toContainText('51.50, -0.12', { timeout: 20000 });   // straight away, no button
  await page.locator('#tnForget').click();
  await expect(page.locator('#tnLoc')).toBeVisible();
  await page.reload();
  await expect(page.locator('#tnLoc')).toBeVisible();
});

test('Try Greenwich works without the location permission', async ({ browser }) => {
  const context = await browser.newContext({ permissions: [], baseURL: `http://localhost:${PORT}/` });
  await stubNetwork(context, { port: PORT, now: () => Date.parse(AT) });
  await context.clock.setFixedTime(Date.parse(AT));
  const page = await context.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('tonight.html');
  await page.locator('#tnGreen').click();
  await expect(card(page).locator('.k').first()).toContainText('Greenwich, London (example)');
  await expect(card(page)).toContainText(/Saturn: up/);
  await expect(page.locator('#tnLoc')).toBeVisible();   // the example still offers your own place
  expect(errors).toEqual([]);
  await context.close();
});

test('a launch\'s Details open it on the globe', async ({ page }) => {
  await page.goto('tonight.html');
  await page.locator('#tnLoc').click();
  await expect(card(page)).toContainText('Next launch anywhere');
  const heading = card(page).locator('h3', { hasText: /rocket launches/i });
  await expect(heading).toHaveAttribute('aria-expanded', 'true');   // a folding section, open by default
  await heading.click();
  await expect(card(page).locator('[data-lch="0"]')).toBeHidden();
  await heading.press('Enter');                                        // folds open again from the keyboard
  await card(page).locator('[data-lch="0"]').click();
  await expect(page).toHaveURL(/globe\.html#go=launches&id=e2e-1$/);
});

test('Share tonight copies the summary and a link', async ({ page }) => {
  await page.addInitScript(() => { delete Navigator.prototype.share; });   // the clipboard path (a desktop browser's share sheet would open)
  await page.goto('tonight.html');
  await page.locator('#tnLoc').click();
  await expect(card(page)).toContainText('Saturn');
  await page.locator('#tnShare').click();
  await expect(page.locator('#toast')).toContainText('Copied');
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toMatch(/Saturn/);
  expect(text).toMatch(/See yours: https:\/\/destinjones\.github\.io\/open-overwatch\/globe\.html#go=tonight$/);
});
