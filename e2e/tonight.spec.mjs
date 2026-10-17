// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Tonight above you (tonight.html): the page's clock is fixed at 2026-10-13 19:00 UTC and the location is London, so the
// sky answers (planets, meteors, the Moon, the next eclipse) are the same on every run. The data are the fixtures:
// the space stations' TLEs, the launch list, the astronauts, the OVATION grid and a clear-evening cloud forecast.
import { test, expect, PORT } from './support/fixtures.mjs';
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
  await expect(card(page).getByRole('heading', { level: 3, name: /rocket launches/i })).toBeVisible();   // still a heading for screen readers
  const toggle = card(page).locator('h3 > button.foldbtn', { hasText: /rocket launches/i });
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');   // a folding section, open by default
  await toggle.click();
  await expect(card(page).locator('[data-lch="0"]')).toBeHidden();
  await toggle.press('Enter');                                         // folds open again from the keyboard
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await card(page).locator('[data-lch="0"]').click();
  await expect(page).toHaveURL(/globe\.html#go=launches&id=e2e-1$/);
});

test('a redraw keeps keyboard focus, and the card is not one big live region', async ({ page }) => {
  await page.goto('tonight.html');
  await expect(card(page)).not.toHaveAttribute('aria-live', /./);
  await expect(page.locator('#toast')).toHaveAttribute('role', 'status');
  await page.locator('#tnLoc').click();
  await expect(card(page)).toContainText('Saturn');
  const bino = card(page).locator('[data-gear="binoculars"]');
  await bino.focus();
  await bino.press('Enter');                                           // the gear picker redraws the whole card
  await expect(card(page).locator('[data-gear="binoculars"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(card(page).locator('[data-gear="binoculars"]')).toBeFocused();   // the new button, not <body>
  const fold = card(page).locator('h3 > button.foldbtn', { hasText: /^Planets/ });
  await fold.focus();
  await card(page).locator('[data-gear="eyes"]').evaluate(b => b.click());   // a redraw while the heading's toggle has focus
  await expect(card(page).locator('[data-gear="eyes"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(card(page).locator('h3 > button.foldbtn', { hasText: /^Planets/ })).toBeFocused();
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
  expect(text).toMatch(/See yours: https:\/\/destinjones\.github\.io\/open-overwatch\/globe\.html#go=tonight$/);   // your own location never goes into a link
});

test('a link answers for its place (#at=lat,lon), and saves nothing', async ({ page }) => {
  await page.goto('tonight.html#at=28.6,77.2&name=New%20Delhi');
  await expect(card(page).locator('.k').first()).toContainText('New Delhi · 28.60, 77.20 · from a link');
  await expect(card(page).locator('h2')).toHaveText('Tonight over New Delhi');
  await expect(card(page)).toContainText(/Saturn/);
  await expect(page.locator('#tnLoc')).toBeVisible();   // and still offers your own place
  await expect(page.locator('#tnAur')).toHaveCount(0);   // an aurora alert would save the link's place
  expect(await page.evaluate(() => localStorage.getItem('oo3d.home'))).toBeNull();
});

test('a typed place: only the words go to Photon, and Share links that place', async ({ page }) => {
  await page.addInitScript(() => { delete Navigator.prototype.share; });
  const asked = [];
  await page.route('https://photon.komoot.io/**', route => { asked.push(route.request().url()); return route.fulfill({ json: { features: [
    { geometry: { coordinates: [73.8567, 18.5204] }, properties: { name: 'Pune', state: 'Maharashtra', country: 'India', osm_value: 'city' } }] } }); });
  await page.goto('tonight.html');
  await page.locator('#tnQ').fill('Pune');
  await page.locator('#tnQ').press('Enter');
  await page.locator('[data-pl="0"]').click();
  await expect(card(page).locator('.k').first()).toContainText('Pune · 18.52, 73.86 · saved on this device');
  await expect(card(page).locator('h2')).toHaveText('Tonight over Pune');
  await expect(page.locator('#tnForget')).toHaveText('Forget this place');
  expect(asked).toHaveLength(1);
  expect(new URL(asked[0]).searchParams.get('q')).toBe('Pune');
  expect(new URL(asked[0]).searchParams.has('lat')).toBe(false);   // the words only, never where the visitor is
  await expect(card(page)).toContainText('Saturn');
  await page.locator('#tnShare').click();
  await expect(page.locator('#toast')).toContainText('Copied');
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toMatch(/^Tonight's sky over Pune:/);
  expect(text).toMatch(/See it live: https:\/\/destinjones\.github\.io\/open-overwatch\/tonight\.html#at=18\.52,73\.86&name=Pune$/);
});

test('the embed: the chosen sections, no location buttons or toasts, a link back', async ({ page }) => {
  await page.goto('tonight.html#embed=1&at=28.6,77.2&name=Delhi&sections=passes,planets');
  await expect(card(page).locator('h2')).toHaveText('Tonight over Delhi');
  await expect(card(page)).toContainText(/Saturn/);
  await expect(card(page).locator('h3 > button.foldbtn', { hasText: /^Planets/ })).toHaveAttribute('aria-expanded', 'true');
  await expect(card(page).locator('h3 > button.foldbtn', { hasText: /^Moon/ })).toHaveAttribute('aria-expanded', 'false');
  for (const id of ['#tnLoc', '#tnForget', '#tnShare', '#tnAur']) await expect(page.locator(id)).toHaveCount(0);
  await expect(page.locator('#toast')).toBeHidden();
  await expect(page.locator('footer a').first()).toHaveAttribute('href', 'https://destinjones.github.io/open-overwatch/tonight.html#at=28.6,77.2&name=Delhi');
});
