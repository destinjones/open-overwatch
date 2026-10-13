// The `test` every spec imports: Playwright's, with the stub network in front of every page and a watch on script
// errors. A test fails if, at its end, the page threw, logged console.error, or got an error status for one of the
// site's own files (a missing module or texture is a real bug), unless the test said it expects that message with
// `errors.allow(/.../)`. Failed loads of things the stub network refused on purpose don't count.
import { test as base, expect } from '@playwright/test';
import { stubNetwork } from './net.mjs';

export const PORT = +(process.env.OO_E2E_PORT || 8805);
/** Site files that only the site build makes (or that a checkout may lack): their 404 is expected on a local server. */
const OPTIONAL = /\/(data\/(flybys|news|wind|launches|crew|conj|socrates|cables|alpr)[\w.-]*\.json|data\/tle\/|versions\.json|favicon\.ico)/;

export const test = base.extend({
  net: [async ({ context }, use) => {
    const log = await stubNetwork(context, { port: PORT });
    // the first-run touch hints (src/app/gestures.js) would take the first tap; the tests that want them clear this
    await context.addInitScript(() => { try { localStorage.setItem('oo-hints', '{"globe":1,"map":1}'); } catch (e) { } });
    await use(log);
  }, { auto: true }],

  errors: [async ({ page, net }, use, testInfo) => {
    const seen = [], allowed = [];
    const own = url => { try { const u = new URL(url); return (u.hostname === 'localhost' || u.hostname === '127.0.0.1') && +u.port === PORT; } catch (e) { return false; } };
    const refused = url => net.blocked.includes(url) || /celestrak/.test(url) || /\/proxy\?/.test(url);
    page.on('pageerror', e => seen.push(`uncaught: ${String(e.message || e).split('\n')[0].slice(0, 300)}`));
    page.on('console', m => {
      if (m.type() !== 'error') return;
      const text = m.text(), url = m.location()?.url || '';
      if (/^Failed to load resource/.test(text)) {   // the browser's own note about a failed request: judged by the response below, or a refusal
        if (refused(url) || !own(url) || OPTIONAL.test(url)) return;
      }
      seen.push(`console.error: ${text.slice(0, 300)}${url && !text.includes(url) ? ' @ ' + url : ''}`);
    });
    page.on('response', r => { const url = r.url(); if (own(url) && r.status() >= 400 && !OPTIONAL.test(url) && !/\/proxy\?/.test(url)) seen.push(`HTTP ${r.status()} for ${new URL(url).pathname}`); });
    const api = { list: seen, allow(re) { allowed.push(re); }, get unexpected() { return seen.filter(s => !allowed.some(re => re.test(s))); } };
    await use(api);
    if (net.blocked.length) await testInfo.attach('blocked-requests.txt', { body: [...new Set(net.blocked)].join('\n'), contentType: 'text/plain' });
    if (seen.length) await testInfo.attach('page-errors.txt', { body: seen.join('\n'), contentType: 'text/plain' });
    expect(api.unexpected, 'script errors on the page').toEqual([]);
  }, { auto: true }],
});
export { expect };

/** Fail with what is in the way when an element sticks out of the viewport sideways or the page scrolls sideways. */
export async function expectFitsWidth(page, selectors) {
  const r = await page.evaluate(sel => {
    const vw = document.documentElement.clientWidth, out = [];
    if (document.documentElement.scrollWidth > vw + 1) out.push(`page scrolls sideways: ${document.documentElement.scrollWidth} > ${vw}`);
    for (const s of sel) for (const el of document.querySelectorAll(s)) {
      const b = el.getBoundingClientRect(), cs = getComputedStyle(el);
      if (!b.width || cs.visibility === 'hidden' || cs.display === 'none') continue;
      if (b.left < -1 || b.right > vw + 1) out.push(`${s} spans ${Math.round(b.left)}..${Math.round(b.right)} of ${vw}`);
    }
    return out;
  }, selectors);
  expect(r, 'layout fits the phone screen').toEqual([]);
}

/** Wait for the 2D map to boot and close its splash without audio. A first visit then shows the welcome card (the
 *  views to start from): { welcome: true } leaves it open, otherwise it is skipped like a visitor would. */
export async function openMap(page, hash = '', { welcome = false } = {}) {
  await page.goto('open-overwatch.html' + hash);
  await page.locator('#enterSilent').click();
  await expect(page.locator('#splash')).toBeHidden({ timeout: 15000 });
  await page.waitForFunction(() => window.OW && OW.Layers && OW.Layers.defs.length > 10);
  if (!welcome && await page.locator('#welcome').isVisible()) { await page.locator('#wSkip').click(); await expect(page.locator('#welcome')).toBeHidden(); }
}

/** Wait for the globe to boot (the boot screen gone, Cesium rendering). */
export async function openGlobe(page, hash = '') {
  await page.goto('globe.html' + hash);
  await page.waitForFunction(() => window.OO3D && OO3D.viewer && (!document.querySelector('#boot') || document.querySelector('#boot').classList.contains('out')), null, { timeout: 120000 });
}

/** Wait for the Solar System view to load its planets. */
export async function openSolar(page, hash = '') {
  await page.goto('solar.html' + hash);
  await page.waitForFunction(() => window.OOSS && document.querySelector('#load')?.classList.contains('gone'), null, { timeout: 120000 });
}
