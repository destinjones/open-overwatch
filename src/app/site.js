// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The content pages' nav (src/app/site.css .site-nav), loaded by shell.js only where the page has one:
//   - .over bars (index, india) turn solid once the page leaves the top, seen by an IntersectionObserver on a sentinel,
//     so no scroll handler runs per frame (the pages' own scripts may also toggle .solid; both agree)
//   - data-menu="shared" bars (about, guide, teach) get the phone menu: the button opens the same links under the bar
//     and moves focus to the first one; a link, Escape, a tap outside or a wide screen closes it.
//   - pages with content-visibility sections (.cv) keep their in-page jumps landing on the right place.
// (index.html and india/india.js wire their own menus, which their tests pin.)

/** Pages with .cv sections (site.css): before any jump to a #section, lay the whole page out for real, so the jump
 *  lands on the target and not on the placeholder sizes of the sections skipped above it. */
export function keepJumpsTrue(doc = document) {
  if (!doc.querySelector('.cv')) return;
  const html = doc.documentElement, off = () => html.classList.add('cv-off');
  const target = () => { try { return location.hash.length > 1 && doc.getElementById(decodeURIComponent(location.hash.slice(1))); } catch (e) { return null; } };
  // a click on an in-page link: before the browser's own scroll, which then measures the real layout
  doc.addEventListener('click', e => { const a = e.target instanceof Element && e.target.closest('a[href^="#"]'); if (a && a.getAttribute('href').length > 1) off(); }, true);
  // an address that already names a section (a shared link, a reload): the browser jumped early, on placeholders
  const t = target();
  if (t) { off(); requestAnimationFrame(() => t.scrollIntoView()); }
  // back and forward land before this runs: put the section back in view once the layout is real
  addEventListener('hashchange', () => { if (html.classList.contains('cv-off')) return; off(); const el = target(); if (el) requestAnimationFrame(() => el.scrollIntoView()); });
}

export function initSite(doc = document) {
  keepJumpsTrue(doc);
  const nav = doc.querySelector('.site-nav');
  if (!nav) return null;
  if (nav.classList.contains('over') && 'IntersectionObserver' in window) {
    const s = doc.createElement('div');
    s.setAttribute('aria-hidden', 'true');
    s.style.cssText = 'position:absolute;top:0;left:0;width:1px;height:40px;pointer-events:none;visibility:hidden';
    doc.body.prepend(s);
    new IntersectionObserver(([e]) => nav.classList.toggle('solid', !e.isIntersecting)).observe(s);
  }
  if (nav.dataset.menu !== 'shared') return nav;
  const btn = nav.querySelector('.menu-btn'), links = nav.querySelector('.links');
  if (!btn || !links) return nav;
  const isOpen = () => nav.classList.contains('open');
  const setMenu = (open, focus) => {
    nav.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', String(open));
    if (open && focus) links.querySelector('a')?.focus({ preventScroll: true });
  };
  btn.addEventListener('click', () => setMenu(!isOpen(), true));
  links.addEventListener('click', e => { if (e.target.closest('a')) setMenu(false); });
  addEventListener('keydown', e => { if (e.key === 'Escape' && isOpen()) { setMenu(false); btn.focus(); } });
  addEventListener('click', e => { if (isOpen() && !nav.contains(e.target)) setMenu(false); });
  matchMedia('(min-width:861px)').addEventListener('change', e => { if (e.matches) setMenu(false); });
  return nav;
}
