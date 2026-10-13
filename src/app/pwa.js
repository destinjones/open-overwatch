// The installable app, page side: registers ../../sw.js (see the decision in core/pwa.js), shows a banner while the
// device is offline, offers a reload when a new version has been published, and an Install button where the browser
// allows one (Chrome, Edge, Android; iPhones install from Safari's Share menu).
//
// Archived /v/<tag>/ pages do none of it and never touch the site's worker. On the local helper (serve.js, the
// download) the worker is off unless ?sw=1 asks for it; ?sw=0 turns it off again and removes it.

import { swDecision, offlineWords } from '../core/pwa.js';
import { announce } from './a11y.js';

const SW_URL = new URL('../../sw.js', import.meta.url);
const ROOT = new URL('./', SW_URL).href;
const sw = navigator.serviceWorker;

export const Pwa = {
  decision: null, reg: null, build: null, installEvent: null, reloading: false,
  /** Install the app (only after the browser offered it: Pwa.canInstall). */
  async install() {
    const e = this.installEvent; if (!e) return false;
    this.installEvent = null; installButtons(false);
    e.prompt();
    const r = await e.userChoice.catch(() => null);
    return !!r && r.outcome === 'accepted';
  },
  get canInstall() { return !!this.installEvent; },
  /** What the worker has saved: { build, caches: { name: entries }, savedAt } (null without a worker). */
  status() { return ask(sw && sw.controller, { type: 'status' }); },
  /** Forget saved data, tiles and libraries (the pages stay, so the app still opens offline). */
  clearSaved() { return ask(sw && sw.controller, { type: 'clear-saved' }); },
  /** Check for a new version now. */
  async update() {
    const reg = this.reg || (sw && this.decision && this.decision.register && await sw.getRegistration(ROOT).catch(() => null));
    return reg ? reg.update().catch(() => null) : null;
  },
};

/** A question to a worker over a MessageChannel; null if there is no answer within 3 s. */
function ask(worker, msg) {
  if (!worker) return Promise.resolve(null);
  return new Promise(res => {
    const ch = new MessageChannel(), t = setTimeout(() => res(null), 3000);
    ch.port1.onmessage = e => { clearTimeout(t); res(e.data); };
    worker.postMessage(msg, [ch.port2]);
  });
}

export function initPwa(page) {
  let stored = null;
  try { stored = localStorage.getItem('oo-sw'); } catch { /* storage blocked */ }
  const d = Pwa.decision = swDecision(location, stored, !!sw);
  if (d.reason === 'archived') return;                   // a frozen version: nothing to register, nothing to remove
  try { if (d.remember === '1') localStorage.setItem('oo-sw', '1'); else if (d.remember === '') localStorage.removeItem('oo-sw'); } catch { }
  initOffline();
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); Pwa.installEvent = e; installButtons(true, page); });
  addEventListener('appinstalled', () => { Pwa.installEvent = null; installButtons(false); announce('Open Overwatch is installed'); });
  if (!sw) return;
  if (!d.register) { if (d.reason === 'local' || d.reason === 'switched-off') removeOwnWorker(); return; }
  const go = () => register().catch(e => console.warn('[oo] service worker:', e && e.message));
  // after the page has loaded and settled: installing the worker reads every page and module once, and must not
  // compete with the globe's or the map's own start
  const idle = () => ('requestIdleCallback' in window ? requestIdleCallback(go, { timeout: 8000 }) : setTimeout(go, 3000));
  if (document.readyState === 'complete') setTimeout(idle, 2500); else addEventListener('load', () => setTimeout(idle, 2500), { once: true });
}

/** Take away the site worker on a local helper that no longer wants it (the notification worker is left alone). */
async function removeOwnWorker() {
  const regs = await sw.getRegistrations().catch(() => []);
  for (const r of regs) {
    const w = r.active || r.waiting || r.installing;
    if (r.scope === ROOT && w && w.scriptURL === SW_URL.href) {
      await r.unregister();
      console.info('[oo] site worker removed (local helper; ?sw=1 turns it on)');
    }
  }
  // its saved copies too (the page it still controls until it is left may save a few more: they go next time)
  const mine = /^oo-(shell|data|asset|lib|tile)-/;
  for (const k of await caches.keys().catch(() => [])) if (mine.test(k)) await caches.delete(k);
}

async function register() {
  const reg = Pwa.reg = await sw.register(SW_URL.href, { scope: ROOT, updateViaCache: 'none' });
  const hadController = !!sw.controller;
  // a worker already waiting (published while this tab was closed): offer it now
  if (reg.waiting && hadController) offerUpdate(reg.waiting);
  reg.addEventListener('updatefound', () => {
    const w = reg.installing; if (!w) return;
    w.addEventListener('statechange', () => { if (w.state === 'installed' && sw.controller) offerUpdate(w); });
  });
  sw.addEventListener('controllerchange', () => { if (Pwa.reloading) location.reload(); });
  ask(sw.controller, { type: 'build' }).then(r => { if (r) Pwa.build = r.build; });
  // phones keep tabs for days: look for a new version when the tab comes back, at most every 15 minutes
  let last = Date.now();
  const check = () => { if (document.visibilityState === 'visible' && Date.now() - last > 15 * 60e3) { last = Date.now(); reg.update().catch(() => {}); } };
  document.addEventListener('visibilitychange', check);
  setInterval(check, 5 * 60e3);
  return reg;
}

// ---- the bar at the top: offline, back online, new version ----

let bar = null, barTimer = 0;
function showBar(kind, html, { buttons = [], hideAfter = 0 } = {}) {
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'ooBar'; bar.setAttribute('role', 'status'); bar.setAttribute('aria-live', 'polite');
    document.body.appendChild(bar);
  }
  clearTimeout(barTimer);
  bar.className = 'oo-bar oo-bar-' + kind;
  bar.innerHTML = `<span class="oo-bar-t">${html}</span>`;
  for (const b of buttons) {
    const el = document.createElement('button'); el.type = 'button'; el.className = 'oo-bar-b' + (b.main ? ' main' : ''); el.textContent = b.label;
    if (b.aria) el.setAttribute('aria-label', b.aria);
    el.addEventListener('click', b.run); bar.appendChild(el);
  }
  bar.hidden = false;
  if (hideAfter) barTimer = setTimeout(hideBar, hideAfter);
}
function hideBar(kind) { if (bar && (!kind || bar.classList.contains('oo-bar-' + kind))) bar.hidden = true; }

function initOffline() {
  const off = async () => {
    const st = await Pwa.status().catch(() => null);
    const words = offlineWords(true, st && st.savedAt);
    showBar('offline', words, { buttons: [{ label: '✕', aria: 'Hide this message', run: () => hideBar() }] });
    document.documentElement.classList.add('oo-offline');
  };
  addEventListener('offline', off);
  addEventListener('online', () => {
    document.documentElement.classList.remove('oo-offline');
    if (bar && !bar.hidden && bar.classList.contains('oo-bar-offline')) showBar('online', 'Back online. Live feeds resume on their next refresh.', { hideAfter: 4000 });
  });
  if (navigator.onLine === false) off();
}

function offerUpdate(worker) {
  ask(worker, { type: 'build' }).then(r => {
    const v = r && r.build && r.build !== 'dev' ? ' (v' + r.build.split('+')[0] + ')' : '';
    showBar('update', 'A new version of Open Overwatch is ready' + v + '.', { buttons: [
      { label: 'Reload', main: true, run: () => { Pwa.reloading = true; worker.postMessage({ type: 'skip-waiting' }); setTimeout(() => location.reload(), 4000); } },
      { label: 'Later', run: () => hideBar('update') },
    ] });
  });
}

/** The Install buttons: the landing page's (#ooInstall, or one added to its nav) appear only when the browser offers it. */
function installButtons(on, page) {
  let btns = [...document.querySelectorAll('[data-oo-install]')];
  if (on && !btns.length && page === 'index') {
    const launch = document.querySelector('#nav .btn.primary');   // next to "Launch map", which phones also show
    if (launch) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn small oo-install'; b.dataset.ooInstall = '';
      b.textContent = 'Install app'; b.title = 'Add Open Overwatch to your home screen or desktop: it opens like an app, and works offline';
      b.addEventListener('click', () => Pwa.install());
      launch.before(b); btns = [b];
    }
  }
  for (const b of btns) b.hidden = !on;
}
