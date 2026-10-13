// The installable app's decisions, DOM-free so Node can test them (src/app/pwa.js and src/app/gestures.js use them).
//   - whether this page may run the site's service worker (not in an archived /v/<tag>/ copy, not on the local helper
//     unless asked, never from file://),
//   - how to word the age of a saved copy,
//   - when the first-run touch hints are due.

/** An archived version on the website lives under /v/<tag>/ (build_site.py). Those pages must never register or talk to
 *  the root service worker: they are frozen copies, and the root worker passes their requests straight through. */
export function isArchivedPath(pathname) {
  return /\/v\/v?\d[\w.-]*\//.test(String(pathname || ''));
}

/** Local hosts: the download (serve.js / serve.py on 127.0.0.1:8787) and the developers' preview servers. */
export function isLocalHost(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.localhost');
}

/** The ?sw=1 / ?sw=0 switch in a query string: true, false, or null when the query does not say. */
export function swSwitch(search) {
  const v = new URLSearchParams(String(search || '')).get('sw');
  if (v === null) return null;
  return /^(1|on|yes|true)$/i.test(v) ? true : /^(0|off|no|false)$/i.test(v) ? false : null;
}

/**
 * Should this page register the service worker?
 * loc: { protocol, hostname, pathname, search }; stored: the remembered local opt-in ('1' or null); supported: the
 * browser has navigator.serviceWorker. Returns { register, remember, reason }: remember is '1' to store an opt-in,
 * '' to forget it, null to leave storage alone.
 * The website gets it always. On the local helper it stays off unless asked with ?sw=1 (remembered until ?sw=0):
 * several copies of the site share localhost:8787 during development, and a cached app there would serve old code.
 */
export function swDecision(loc, stored, supported = true) {
  const sw = swSwitch(loc && loc.search);
  const remember = sw === true ? '1' : sw === false ? '' : null;
  if (!supported) return { register: false, remember, reason: 'unsupported' };
  if (!loc || (loc.protocol !== 'https:' && loc.protocol !== 'http:')) return { register: false, remember, reason: 'not-http' };
  if (isArchivedPath(loc.pathname)) return { register: false, remember: null, reason: 'archived' };
  if (isLocalHost(loc.hostname)) {
    const on = sw === true || (sw === null && stored === '1');
    return { register: on, remember, reason: on ? 'local-opt-in' : 'local' };
  }
  if (loc.protocol !== 'https:') return { register: false, remember, reason: 'insecure' };
  return { register: sw !== false, remember: null, reason: sw === false ? 'switched-off' : 'site' };
}

/** "3 min", "2 h", "5 days": how old a saved copy is (ms). */
export function ageWords(ms) {
  if (!Number.isFinite(ms) || ms < 0) return 'unknown age';
  const m = ms / 60e3;
  if (m < 1) return 'just now';
  if (m < 60) return Math.round(m) + ' min';
  const h = m / 60;
  if (h < 36) return Math.round(h) + ' h';
  return Math.round(h / 24) + ' days';
}

/** The words of the offline banner. offline: navigator.onLine is false; savedAt: when the page's copy was saved (ms) or null. */
export function offlineWords(offline, savedAt, now = Date.now()) {
  if (!offline) return '';
  const age = savedAt ? ' Saved ' + ageWords(now - savedAt) + (now - savedAt < 60e3 ? '' : ' ago') + '.' : '';
  return 'You are offline: live feeds are paused, this is the saved copy.' + age;
}

export const HINT_KEY = 'oo-hints';
export const HINT_PAGES = Object.freeze(['globe', 'map']);

/**
 * Are the touch hints due on this page? stored: the JSON the hint overlay keeps ({ globe: 1, map: 1 } once seen);
 * env: { coarse: a touch screen is the main pointer, embed: the page is framed or ?embed, reduced: no animation wanted
 * (still shown, just still), search }. ?hints=1 forces them (for testing), ?hints=0 never.
 */
export function hintsDue(page, stored, env = {}) {
  if (!HINT_PAGES.includes(page)) return false;
  const q = new URLSearchParams(String(env.search || '')).get('hints');
  if (q === '1') return true;
  if (q === '0' || env.embed || !env.coarse) return false;
  let seen = {};
  try { seen = JSON.parse(stored || '{}') || {}; } catch { seen = {}; }
  return !seen[page];
}

/** The stored value after the hints on `page` were seen. */
export function hintsSeen(page, stored) {
  let seen = {};
  try { seen = JSON.parse(stored || '{}') || {}; } catch { seen = {}; }
  if (typeof seen !== 'object' || Array.isArray(seen)) seen = {};
  seen[page] = 1;
  return JSON.stringify(seen);
}

/** Does a pointer that went down at (x0, y0) at t0 and is now at (x, y) at t count as a long press? */
export function isLongPress(t0, x0, y0, t, x, y, holdMs = 550, slopPx = 10) {
  return t - t0 >= holdMs && Math.hypot(x - x0, y - y0) <= slopPx;
}
