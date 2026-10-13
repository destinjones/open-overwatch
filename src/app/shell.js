// What every page shares, loaded by one <script type="module" src="src/app/shell.js"> per page:
//   the installable app (pwa.js: service worker, offline banner, new-version prompt, install button),
//   the accessibility layer (a11y.js: focus rings, keyboard moves, screen-reader names and announcements),
//   first-run touch hints and the long press on the globe and the 2D map (gestures.js, spot.js).
// Nothing here may slow a page's own start: the work waits for the page to load, and the worker for an idle moment.
// Console handle: window.OOApp.

import { initA11y, announce } from './a11y.js';
import { initPwa, Pwa } from './pwa.js';

/** Which page this is, from its file name (archived /v/<tag>/ copies are the same pages). */
export function pageOf(pathname) {
  const f = String(pathname || '').split('/').pop() || 'index.html';
  return ({ 'index.html': 'index', 'globe.html': 'globe', 'open-overwatch.html': 'map', 'solar.html': 'solar', 'tonight.html': 'tonight', 'about.html': 'about' })[f] || 'other';
}

const PAGE = pageOf(location.pathname);
document.documentElement.dataset.ooPage = PAGE;

const css = document.createElement('link');
css.rel = 'stylesheet'; css.href = new URL('shell.css', import.meta.url).href;
document.head.appendChild(css);

const OOApp = window.OOApp = { page: PAGE, announce, pwa: Pwa };

initA11y(PAGE);
initPwa(PAGE);
if (PAGE === 'globe' || PAGE === 'map') {
  // the hints and the long press are only for the two maps; loaded after the page so they never delay it
  const later = () => import('./gestures.js').then(m => { OOApp.hints = m.showHints; m.initGestures(PAGE); });
  if (document.readyState === 'complete') later(); else addEventListener('load', later, { once: true });
}
