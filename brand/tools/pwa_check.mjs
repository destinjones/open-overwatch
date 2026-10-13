// pwa_check.mjs — the installable app in a real browser, on a copy of the website's layout:
//   /open-overwatch/            this folder (the site root, the worker's scope)
//   /open-overwatch/v/<tag>/    an archived version from git (default the newest v* tag) and /v/v9.9.9/, this folder
//                               again, standing in for a future archived version that carries src/app/shell.js
// It checks: no worker on the local helper unless ?sw=1 (the download), the worker installs and takes over, archived
// versions are never served by it and never register one, pages open offline with the offline banner, an unsaved page
// gets offline.html, a new worker shows the "new version" prompt and Reload swaps to it, ?sw=0 removes it all.
//   node brand/tools/pwa_check.mjs [chromium|webkit] [tag]       (chromium = the installed Edge)
// Playwright lives outside the repo: PLAYWRIGHT_DIR, default ~/open-overwatch-work/pw (see webkit_journey.mjs).
import { createRequire } from 'node:module';
import http from 'node:http';
import { readFile, stat, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const require = createRequire(path.join(process.env.PLAYWRIGHT_DIR || path.join(os.homedir(), 'open-overwatch-work', 'pw'), 'package.json'));
const pw = require('playwright');
const ENGINE = process.argv[2] || 'chromium';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TAG = process.argv[3] || execFileSync('git', ['tag', '-l', 'v*', '--sort=-v:refname'], { cwd: ROOT }).toString().split(/\s+/)[0];
const BASE_PATH = '/open-overwatch/';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bin': 'application/octet-stream', '.glb': 'model/gltf-binary', '.txt': 'text/plain' };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// the archived tag, extracted from git like build_site.py does
const ARCH = await mkdtemp(path.join(os.tmpdir(), 'oo-arch-'));
execFileSync('git', ['archive', '--format=tar', '-o', path.join(ARCH, 'a.tar'), TAG, '--', 'open-overwatch.html', 'globe.html', 'solar.html', 'tonight.html', 'manifest.webmanifest', 'src'], { cwd: ROOT });
execFileSync(process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:/Windows', 'System32', 'tar.exe') : 'tar', ['-xf', path.join(ARCH, 'a.tar'), '-C', ARCH]);

let build = 'check-1', down = false;
const hits = [];
const server = http.createServer(async (req, res) => {
  if (down) return req.socket.destroy();   // "offline": the connection drops, as with no network
  const u = new URL(req.url, 'http://x');
  hits.push(u.pathname);
  if (!u.pathname.startsWith(BASE_PATH)) { res.writeHead(404); return res.end(); }
  let rel = decodeURIComponent(u.pathname.slice(BASE_PATH.length)) || 'index.html', dir = ROOT;
  const m = /^v\/([^/]+)\/(.*)$/.exec(rel);
  if (m) { dir = m[1] === 'v9.9.9' ? ROOT : ARCH; rel = m[2] || 'index.html'; }
  const file = path.join(dir, rel);
  if (!file.startsWith(dir)) { res.writeHead(403); return res.end(); }
  try {
    if (!(await stat(file)).isFile()) throw new Error('dir');
    let body = await readFile(file);
    if (rel === 'sw.js' && !m) body = Buffer.from(body.toString().replace("const BUILD = 'dev';", `const BUILD = '${build}';`));
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': rel === 'sw.js' ? 'max-age=600' : 'max-age=600', 'Last-Modified': new Date(Date.now() - 3600e3).toUTCString() });
    res.end(body);
  } catch { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const SITE = `http://localhost:${server.address().port}${BASE_PATH}`;

const browser = ENGINE === 'webkit' ? await pw.webkit.launch() : await pw.chromium.launch({ channel: 'msedge' });
const ctx = await browser.newContext(ENGINE === 'webkit' ? { ...pw.devices['iPhone 15'] } : { viewport: { width: 1280, height: 800 } });
// only this server and the pinned libraries: never live feeds from a test
await ctx.route(url => !/^(localhost|127\.0\.0\.1|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|fonts\.(googleapis|gstatic)\.com)$/.test(new URL(url).hostname), r => r.abort());
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e.message).split('\n')[0]));

const results = [];
async function check(name, fn) {
  let ok = false, note = '';
  try { const r = await fn(); ok = r !== false && !(r && r.ok === false); note = (r && r.note) || (typeof r === 'string' ? r : ''); } catch (e) { note = 'FAILED: ' + e.message.split('\n')[0]; }
  results.push({ name, ok, note });
  console.log(`${ok ? '✓' : '✗'} ${name.padEnd(58)} ${note}`);
}
const regs = () => page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map(r => r.scope));
const fromWorker = [];
page.on('response', r => fromWorker.push({ url: r.url(), sw: r.fromServiceWorker() }));
const swFetched = prefix => fromWorker.filter(r => r.url.startsWith(prefix) && r.sw).map(r => r.url);

console.log(`${ENGINE}: site ${SITE}, archived ${TAG}`);
await check('local helper, no ?sw=1: no worker (the download)', async () => {
  await page.goto(SITE + 'index.html'); await sleep(7000);
  const r = await regs(); return { ok: r.length === 0, note: `registrations: ${r.length}` };
});
await check('?sw=1: the worker installs and takes over', async () => {
  await page.goto(SITE + 'solar.html?sw=1');
  const t0 = Date.now();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 90e3 });
  const st = await page.evaluate(() => OOApp.pwa.status());
  const r = await regs();
  return { ok: r.length === 1 && r[0] === SITE, note: `${((Date.now() - t0) / 1000).toFixed(1)} s, scope ${r[0]}, saved ${JSON.stringify(st && st.caches)}` };
});
await check('a controlled visit saves libraries and data as it goes', async () => {
  await page.goto(SITE + 'solar.html'); await sleep(8000);
  const st = await page.evaluate(() => OOApp.pwa.status());
  return { ok: !!st && (st.caches['oo-lib-v1'] || 0) > 0, note: JSON.stringify(st.caches) };
});
await check(`archived ${TAG}: nothing comes from the worker`, async () => {
  fromWorker.length = 0;
  await page.goto(SITE + `v/${TAG}/solar.html`); await sleep(5000);
  const sw = swFetched(SITE + 'v/'), all = fromWorker.filter(r => r.url.startsWith(SITE + 'v/')).length;
  const r = await regs();
  return { ok: sw.length === 0 && all > 3 && r.length === 1 && r[0] === SITE, note: `${all} requests, ${sw.length} from the worker, registrations ${JSON.stringify(r)}` };
});
await check('a future archived copy (with the shell) leaves the worker alone', async () => {
  fromWorker.length = 0;
  await page.goto(SITE + 'v/v9.9.9/solar.html'); await sleep(5000);
  const d = await page.evaluate(() => window.OOApp && OOApp.pwa.decision);
  const sw = swFetched(SITE + 'v/'), r = await regs();
  const rootAsked = fromWorker.filter(x => x.url.startsWith(SITE + 'data/') && x.sw).length;
  return { ok: d && d.reason === 'archived' && sw.length === 0 && rootAsked === 0 && r.length === 1, note: `decision ${d && d.reason}, ${sw.length} via worker, root data via worker ${rootAsked}, registrations ${r.length}` };
});
// offline = the server drops every connection; Chromium is also told it is offline (navigator.onLine, the banner).
// WebKit's emulated offline mode can't be used with service workers in Playwright ("internal error").
const goOffline = async on => { down = on; if (ENGINE !== 'webkit') await ctx.setOffline(on); };
await check('offline: the landing page and the Solar System open', async () => {
  await goOffline(true);
  const a = await page.goto(SITE + 'index.html');
  const bar = await page.waitForSelector('#ooBar.oo-bar-offline', { timeout: 8000 }).then(e => e.textContent()).catch(() => '');
  const b = await page.goto(SITE + 'solar.html'); await sleep(5000);
  const solarOk = await page.evaluate(() => !!document.querySelector('#c') && !document.querySelector('#err')?.textContent);
  return { ok: a.ok() && a.fromServiceWorker() && b.ok() && (!!bar || ENGINE === 'webkit') && solarOk, note: `banner "${bar.slice(0, 70)}…", solar drawn: ${solarOk}` };
});
await check('offline: a page never saved gets the offline page', async () => {
  const r = await page.goto(SITE + 'never-saved.html');
  const t = await page.title();
  return { ok: /offline/i.test(t), note: `${r && r.status()} "${t}"` };
});
await check(`offline: the archived ${TAG} is not served from the cache`, async () => {
  const r = await page.goto(SITE + `v/${TAG}/solar.html`).catch(e => null);
  return { ok: !r || !r.fromServiceWorker(), note: r ? `status ${r.status()}` : 'network error, as without a worker' };
});
await goOffline(false);
await check('a new version: the prompt shows, Reload swaps to it', async () => {
  await page.goto(SITE + 'index.html'); await sleep(1500);
  build = 'check-2';
  await page.evaluate(() => OOApp.pwa.update());
  const bar = await page.waitForSelector('#ooBar.oo-bar-update', { timeout: 60e3 });
  const text = await bar.textContent();
  await Promise.all([page.waitForNavigation({ timeout: 20e3 }), page.click('#ooBar .oo-bar-b.main')]);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  const st = await page.evaluate(() => OOApp.pwa.status());
  const names = Object.keys(st.caches);
  return { ok: st.build === 'check-2' && !names.includes('oo-shell-check-1'), note: `"${text.slice(0, 60)}", now ${st.build}, caches ${names.join(' ')}` };
});
await check('?sw=0 removes the worker and its caches', async () => {
  await page.goto(SITE + 'index.html?sw=0'); await sleep(2000);
  await page.goto(SITE + 'index.html'); await sleep(2000);   // the next visit, no longer controlled, clears what the last one saved
  const r = await regs(), c = await page.evaluate(async () => (await caches.keys()).filter(k => k.startsWith('oo-')));
  return { ok: r.length === 0 && c.length === 0, note: `registrations ${r.length}, caches ${c.length}` };
});

console.log(errors.length ? 'page errors:\n  ' + [...new Set(errors)].slice(0, 8).join('\n  ') : 'no page errors');
await browser.close(); server.close(); await rm(ARCH, { recursive: true, force: true });
const bad = results.filter(r => !r.ok).length;
console.log(`${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
