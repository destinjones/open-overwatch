// Every page on a phone (the "phone" project: Pixel 7 size, touch, a mobile user agent): nothing sticks out sideways or
// scrolls the page sideways, the phone controls exist and respond to taps, and the main controls are big enough to hit.
import { test, expect, expectFitsWidth, openMap, openGlobe, openSolar } from './support/fixtures.mjs';

/** Boxes of the elements that are on screen, for "is it inside the viewport" and "can a finger hit it". */
const boxes = (page, sel) => page.$$eval(sel, els => els.filter(e => e.offsetParent || getComputedStyle(e).position === 'fixed').map(e => { const b = e.getBoundingClientRect(); return { sel: e.id || e.className || e.tagName, l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height }; }).filter(b => b.w && b.h));
async function expectOnScreen(page, sel) {
  const vw = page.viewportSize().width, vh = page.viewportSize().height;
  for (const b of await boxes(page, sel)) {
    expect(b.l, `${sel} left`).toBeGreaterThanOrEqual(-1); expect(b.r, `${sel} right`).toBeLessThanOrEqual(vw + 1);
    expect(b.t, `${sel} top`).toBeGreaterThanOrEqual(-1); expect(b.b, `${sel} bottom`).toBeLessThanOrEqual(vh + 1);
  }
}
async function expectTappable(page, sel, min = 32) {
  const small = (await boxes(page, sel)).filter(b => b.h < min || b.w < min);
  expect(small, `${sel}: smaller than ${min} px`).toEqual([]);
}

test('landing page fits a phone, with the still hero and no video', async ({ page }) => {
  await page.goto('index.html');
  await expectFitsWidth(page, ['#nav', '.wrap', '#picker', '#lch', '#iss', '#qk']);
  expect(await page.locator('#heroVid source').count()).toBe(0);   // wide screens only
  await page.locator('#picker').scrollIntoViewIfNeeded();
  await page.locator('#picker button', { hasText: 'Starlink' }).tap();
  await expect(page.locator('#picker button', { hasText: 'Starlink' })).toHaveAttribute('aria-pressed', 'true');
  await expectFitsWidth(page, ['#spec', '#mv']);
});

test('guide and about fit a phone; wide tables scroll inside their box', async ({ page }) => {
  for (const file of ['guide.html', 'about.html']) {
    await page.goto(file);
    await expectFitsWidth(page, ['nav', 'main section .wrap', 'h1', 'h2', '.toc', 'p']);
  }
  await page.goto('guide.html#keys');
  const wide = await page.$$eval('.tbl', els => els.map(e => ({ scroll: e.scrollWidth > e.clientWidth, ox: getComputedStyle(e).overflowX })));
  for (const t of wide) if (t.scroll) expect(['auto', 'scroll']).toContain(t.ox);
});

test('Tonight fits a phone and its buttons are big enough to tap', async ({ page }) => {
  await page.goto('tonight.html');
  await expect(page.locator('#tnGreen')).toBeVisible();
  await page.locator('#tnGreen').tap();
  await expect(page.locator('#card')).toContainText('Saturn');
  await expectFitsWidth(page, ['#card', '#card .tn-row', 'header', 'footer']);
  await expectTappable(page, '#card .chipbtn', 30);
});

test('2D map: the bottom bar switches between the layers, the map and the intel panel', async ({ page }) => {
  await openMap(page);
  const bar = page.locator('#mobilebar');
  await expect(bar).toBeVisible();
  await expectOnScreen(page, '#mobilebar');
  await expectTappable(page, '#mobilebar button', 36);   // 37.5 px today: under the 44-48 px touch guidelines, over the floor
  await expectFitsWidth(page, ['#top', '#mobilebar', '#mapwrap']);
  await bar.locator('[data-sheet="rail"]').tap();
  await expect(page.locator('#rail')).toBeVisible();
  await expect(page.locator('#rail')).not.toHaveClass(/hidden/);
  await expectFitsWidth(page, ['#rail']);
  await page.locator('#rail label.layer').first().scrollIntoViewIfNeeded();
  await bar.locator('[data-sheet="panel"]').tap();
  await expect(page.locator('#panel')).not.toHaveClass(/hidden/);
  await expect(page.locator('#rail')).toHaveClass(/hidden/);
  await expectFitsWidth(page, ['#panel', '#panel .tabs']);
  await bar.locator('[data-sheet="none"]').tap();
  await expect(page.locator('#panel')).toHaveClass(/hidden/);
  const map = await page.locator('#map').boundingBox();
  expect(map.width).toBeGreaterThan(page.viewportSize().width - 2);   // the map gets the whole width
});

test('2D map: tapping a quake opens its details in the intel sheet', async ({ page }) => {
  await openMap(page);
  await page.evaluate(() => { OW.Layers.set('quakes', true); OW.map.setView([-30.9, -71.5], 6, { animate: false }); });
  await expect.poll(() => page.evaluate(() => Object.values(OW.Points.sets).find(s => s.layerId === 'quakes')?.items.length || 0), { timeout: 30000 }).toBe(5);
  const at = await page.evaluate(() => { const p = OW.map.latLngToContainerPoint([-30.9, -71.5]), r = document.querySelector('#map').getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; });
  await page.touchscreen.tap(at.x, at.y);
  await expect(page.locator('#panel')).not.toHaveClass(/hidden/);
  await expect(page.locator('#detail')).toContainText('Ovalle');
});

test('globe: the phone dock replaces the band, and its sheets open and close', async ({ page }) => {
  await openGlobe(page);
  await expect(page.locator('body')).toHaveClass(/\bm\b/);
  const dock = page.locator('#mdock');
  await expect(dock.locator('.m-tab')).toHaveCount(5);
  await expectOnScreen(page, '#mdock');
  await expectTappable(page, '#mdock .m-tab', 40);
  await expectFitsWidth(page, ['#top', '#mdock', '#timebar', '#stats']);

  await dock.locator('[data-tab="explore"]').tap();
  const sheet = page.locator('#msheet');
  await expect(sheet).toHaveClass(/\bshow\b/);
  await expectFitsWidth(page, ['#msheet', '#msheet .m-item']);
  await sheet.locator('[data-go="launches"]').tap();
  await expect(page.locator('#card .cj.lc').first()).toBeVisible({ timeout: 20000 });
  await expectFitsWidth(page, ['#card']);
  await expect.poll(async () => (await page.locator('#card').boundingBox()).y + (await page.locator('#card').boundingBox()).height).toBeLessThanOrEqual(page.viewportSize().height);   // slid in, all of it on screen
  await page.locator('#card .x').tap();

  await dock.locator('[data-tab="layers"]').tap();
  await expect(page.locator('#dock')).toHaveClass(/\bopen\b/);
  await expectFitsWidth(page, ['#dock']);
  await page.locator('#dock [data-ly="quakes"]').tap();
  expect(await page.evaluate(() => OO3D.L.quakes.on)).toBe(false);
  await dock.locator('[data-tab="layers"]').tap();
  await expect(page.locator('#dock')).not.toHaveClass(/\bopen\b/);

  await dock.locator('[data-tab="time"]').tap();
  await expect(sheet).toHaveClass(/\bshow\b/);
  await expect(sheet).toContainText('1 h/s');
});

test('Solar System: the menu button opens the layers, and search results span the screen', async ({ page }) => {
  await openSolar(page);
  await expect(page.locator('#menuBtn')).toBeVisible();
  await expect(page.locator('#dock')).toBeHidden();
  await page.locator('#menuBtn').tap();
  await expect(page.locator('#dock')).toBeVisible();
  await expectFitsWidth(page, ['#dock', '#top', '#band']);
  await page.locator('#menuBtn').tap();
  await expect(page.locator('#dock')).toBeHidden();
  await page.locator('#q').tap();
  await page.keyboard.type('saturn');
  await expect(page.locator('#hits button').first()).toContainText('Saturn');
  await expectFitsWidth(page, ['#hits', '#hits button']);
  await page.locator('#hits button').first().tap();
  await expect.poll(() => page.evaluate(() => OOSS.nav.focus?.key)).toBe('saturn');
  await expectFitsWidth(page, ['#card']);
});
