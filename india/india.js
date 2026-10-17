// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The India landing page (india/index.html): the language toggle, the live strip (IST clock, ISS, South Asia quakes, the
// next launch from Sriharikota), the upcoming Indian launches, the next ISS passes over six cities (worked out here from
// the site's TLE copy, never CelesTrak), the phone demo and the Share button. Dynamic text is written in both languages
// (T()), so the toggle is only CSS. utm_* parameters are never read: they are only taken out of the address bar.
import { parseTle } from '../src/core/tle.js';
import { ecfAt } from '../src/core/passes.js';
import { fmtIST as fmt, cleanUrl, overIndia, inSouthAsia, indianLaunches, launchWhen as when, CITIES, dir8, cityPasses } from '../src/core/india.js';

const $ = s => document.querySelector(s);
const root = document.documentElement;
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** Both languages, the CSS shows one. */
const T = (en, hi = en) => `<span lang="en">${esc(en)}</span><span lang="hi">${esc(hi)}</span>`;
const both = (ms, o) => T(fmt(ms, 'en', o), fmt(ms, 'hi', o));
const CANONICAL = 'https://destinjones.github.io/open-overwatch/india/';

// ---- language: English by default; the toggle and ?lang= are remembered (the head script applied it before paint)
const TITLE = { en: document.title, hi: 'भारत, अंतरिक्ष से लाइव · Open Overwatch' };
function setLang(l, remember = true) {
  root.lang = l; root.dataset.lang = l;
  document.title = TITLE[l];
  for (const el of document.querySelectorAll('[data-alt-hi]')) {
    if (!el.dataset.altEn) el.dataset.altEn = el.alt;
    el.alt = l === 'hi' ? el.dataset.altHi : el.dataset.altEn;
  }
  $('#langBtn').setAttribute('aria-label', l === 'hi' ? 'Read this page in English' : 'यह पेज हिन्दी में पढ़ें');
  $('#menuBtn').setAttribute('aria-label', l === 'hi' ? 'मेन्यू' : 'Menu');
  $('#phonePlay').setAttribute('aria-label', l === 'hi' ? 'रिकॉर्डिंग चलाएँ' : 'Play the recordings');
  if (!remember) return;
  try { localStorage.setItem('oo-lang', l); } catch (e) { /* private mode: the choice lasts this visit */ }
  try {   // an address that says ?lang= follows the toggle, so a reload (or a shared link) keeps what is on screen
    const u = new URL(location.href);
    if (u.searchParams.has('lang')) { u.searchParams.set('lang', l); history.replaceState(history.state, '', u.href); }
  } catch (e) { /* leave the address */ }
}
setLang(root.dataset.lang === 'hi' ? 'hi' : 'en', false);
$('#langBtn').addEventListener('click', () => setLang(root.dataset.lang === 'hi' ? 'en' : 'hi'));

// ---- ad links carry utm_* tags: take them out of the address bar so a copied or shared link doesn't carry them
try {
  const clean = cleanUrl(location.href);
  if (clean !== location.href.replace(/#.*$/, '')) history.replaceState(history.state, '', clean + location.hash);
} catch (e) { /* an odd address: leave it */ }

// ---- nav background once scrolled; reveal on scroll
const nav = $('#nav');
addEventListener('scroll', () => nav.classList.toggle('solid', scrollY > 40), { passive: true });
// the phone menu (under 1020px the section links fold away behind #menuBtn; opening it moves focus to the first link, as
// the button comes after them in tab order): a link, Escape or a tap elsewhere closes it
const menuBtn = $('#menuBtn');
const setMenu = open => { nav.classList.toggle('open', open); menuBtn.setAttribute('aria-expanded', String(open)); if (open) $('#navLinks a').focus({ preventScroll: true }); };
menuBtn.addEventListener('click', () => setMenu(!nav.classList.contains('open')));
$('#navLinks').addEventListener('click', e => { if (e.target.closest('a')) setMenu(false); });
addEventListener('keydown', e => { if (e.key === 'Escape' && nav.classList.contains('open')) { setMenu(false); menuBtn.focus(); } });
addEventListener('click', e => { if (nav.classList.contains('open') && !nav.contains(e.target)) setMenu(false); });
const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: .12 });
document.querySelectorAll('.rv').forEach((el, i) => { el.style.transitionDelay = (i % 6) * 60 + 'ms'; io.observe(el); });

// ---- live strip: IST clock, the ISS, South Asia's quakes
const tickClock = () => { $('#ist').textContent = fmt(Date.now(), 'en', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) + ' IST'; };
tickClock(); setInterval(tickClock, 1000);
const deg = (v, p, n) => Math.abs(v).toFixed(1) + '°' + (v >= 0 ? p : n);
async function iss() {
  try {
    const d = await (await fetch('https://api.wheretheiss.at/v1/satellites/25544', { cache: 'no-store' })).json();
    const kmh = Math.round(d.velocity).toLocaleString('en-IN'), alt = Math.round(d.altitude);
    const where = overIndia(d.latitude, d.longitude) ? T('over India right now', 'अभी भारत के ऊपर') : T(`${alt} km up · ${kmh} km/h`, `${alt} किमी ऊपर · ${kmh} किमी/घंटा`);
    $('#issNow').innerHTML = esc(deg(d.latitude, 'N', 'S') + ' ' + deg(d.longitude, 'E', 'W')) + '<small>' + where + '</small>';
  } catch (e) { $('#issNow').innerHTML = T('signal lost', 'सिग्नल नहीं मिला') + '<small>' + T('retrying…', 'फिर कोशिश…') + '</small>'; }
}
async function quakes() {
  try {
    const d = await (await fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson')).json();
    const here = (d.features || []).filter(f => f && f.geometry && inSouthAsia(f.geometry.coordinates) && typeof f.properties?.mag === 'number');
    const big = here.reduce((a, f) => (!a || f.properties.mag > a.properties.mag ? f : a), null);
    $('#qk').innerHTML = T(here.length === 1 ? '1 quake' : `${here.length} quakes`, `${here.length} भूकंप`) + '<small>' +
      (big ? esc('M' + big.properties.mag.toFixed(1) + ' · ' + big.properties.place) : T('none in South Asia, last 24 h', 'पिछले 24 घंटों में दक्षिण एशिया में कोई नहीं')) + '</small>';
  } catch (e) { $('#qk').innerHTML = T('feed unavailable', 'फ़ीड उपलब्ध नहीं') + '<small>USGS</small>'; }
}
iss(); quakes(); setInterval(iss, 10000); setInterval(quakes, 300000);

// ---- launches from India: the site build's copy of Launch Library 2 (data/launches.json, every 6 h)
(async () => {
  const box = $('#inLaunches');
  try {
    const d = await (await fetch('../data/launches.json')).json();
    const list = indianLaunches(d.results);
    if (!list.length) { box.innerHTML = `<li class="muted">${T('No launch from India is on the list of the next 40 worldwide right now.', 'दुनिया भर के अगले 40 लॉन्च की सूची में अभी भारत से कोई लॉन्च नहीं है।')}</li>`; return; }
    const name = r => (r.rocket?.configuration?.full_name || r.rocket?.configuration?.name || 'Rocket') + ' · ' + (r.mission?.name || r.name || '');
    box.innerHTML = list.slice(0, 5).map(r => `<li><a href="../globe.html#go=launches&amp;id=${encodeURIComponent(String(r.id || '').slice(0, 40))}">${esc(name(r))}</a><small>${T(when(r, 'en'), when(r, 'hi'))}</small></li>`).join('');
    const next = list[0];
    $('#lch').href = `../globe.html#go=launches&id=${encodeURIComponent(String(next.id || '').slice(0, 40))}`;
    $('#lch').innerHTML = esc(name(next)) + `<small>${T(when(next, 'en'), when(next, 'hi'))}</small>`;
    $('#lchRow').hidden = false;
  } catch (e) {   // no launch copy here (a local preview): say so instead of a spinner
    box.innerHTML = `<li class="muted">${T('The launch list loads on the website.', 'लॉन्च सूची वेबसाइट पर दिखती है।')}</li>`;
  }
})();

// ---- the next ISS passes over six cities, in IST, worked out here (satellite.js from the CDN, pinned and hashed)
const SATJS = { src: 'https://cdn.jsdelivr.net/npm/satellite.js@5.0.0/dist/satellite.min.js', integrity: 'sha384-e6V1JVpc+kVNTxT0gEOla7yL4c92Romsw7itPoipfzHbEjzUwPhTv6oeVDMHHzqT' };
const loadSatJs = () => window.satellite ? Promise.resolve(window.satellite) : new Promise((ok, no) => {
  const s = document.createElement('script'); s.src = SATJS.src; s.integrity = SATJS.integrity; s.crossOrigin = 'anonymous';
  s.onload = () => window.satellite ? ok(window.satellite) : no(new Error('satellite.js')); s.onerror = () => no(new Error('satellite.js')); document.head.append(s);
});
async function passes() {
  const msg = $('#passMsg');
  try {
    const [sl, txt] = await Promise.all([loadSatJs(), fetch('../data/tle/stations.txt').then(r => r.ok ? r.text() : Promise.reject(new Error('no copy')))]);
    const tle = parseTle(txt).find(s => s.id === '25544');
    if (!tle) throw new Error('no ISS');
    const pos = ecfAt(sl, sl.twoline2satrec(tle.l1, tle.l2)), now = Date.now();
    const at = ms => both(ms, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
    const rows = CITIES.map(([en, hi, lat, lon]) => {
      const { next, visible } = cityPasses(pos, lat, lon, now), p = visible || next;
      if (!p) return `<tr><td>${T(en, hi)}</td><td colspan="2">${T('no pass above 10° this week', 'इस हफ़्ते 10° से ऊपर कोई पास नहीं')}</td></tr>`;
      const mins = Math.max(1, Math.round((p.set - p.rise) / 60e3));
      const path = T(`${dir8(p.azRise, 'en')} → ${dir8(p.azSet, 'en')}`, `${dir8(p.azRise, 'hi')} → ${dir8(p.azSet, 'hi')}`);
      const badge = p.visible ? `<span class="vis yes">${T('visible', 'दिखेगा')}</span>` : `<span class="vis">${T('not visible', 'नहीं दिखेगा')}</span>`;
      return `<tr><td>${T(en, hi)}</td><td>${at(p.rise)}<small>${T(`${mins} min · up to ${Math.round(p.maxEl)}°`, `${mins} मिनट · ${Math.round(p.maxEl)}° तक ऊँचा`)}</small>${badge}</td><td>${path}</td></tr>`;
    });
    $('#passBox').innerHTML = `<table class="passes"><thead><tr><th>${T('City', 'शहर')}</th><th>${T('Next pass (IST)', 'अगला पास (IST)')}</th><th>${T('From → to', 'कहाँ से → कहाँ')}</th></tr></thead><tbody>${rows.join('')}</tbody></table>
      <p class="fine">${rows.some(r => r.includes('class="vis"')) ? T('Not visible: that pass is in daylight or in Earth\'s shadow, and no visible one comes in the next 7 days. ', 'नहीं दिखेगा: वह पास दिन में या पृथ्वी की छाया में है, और अगले 7 दिनों में कोई दिखने वाला पास नहीं है। ') : ''}${T('Orbit data: CelesTrak, copied by the site every 6 hours. Times can shift by a minute or two as the orbit is updated.', 'कक्षा डेटा: CelesTrak, साइट हर 6 घंटे में कॉपी करती है। कक्षा अपडेट होने पर समय एक-दो मिनट खिसक सकता है।')}</p>`;
  } catch (e) {
    msg.innerHTML = T('The pass times load on the website (they need its copy of the orbit data). Tonight above you works them out for wherever you are.', 'पास का समय वेबसाइट पर दिखता है (उसे साइट की कक्षा डेटा कॉपी चाहिए)। Tonight above you आपकी जगह के लिए समय निकालता है।');
  }
}
const passIo = new IntersectionObserver(([e]) => { if (e.isIntersecting) { passIo.disconnect(); passes(); } }, { rootMargin: '600px 0px' });
passIo.observe($('#passBox'));

// ---- phone demo: the tabs cycle through the India clips. On a phone, or on a slow or Save-Data connection, nothing
// downloads before a tap: the poster shows with a play button, and the clips cycle from that tap on
const conn = navigator.connection;
const slowNet = !!(conn && (conn.saveData || /2g|3g/.test(conn.effectiveType || '')));
const pv = $('#phoneVid'), tabs = [...document.querySelectorAll('.tab')], playBtn = $('#phonePlay');
let cur = 0, auto = true, started = !(slowNet || matchMedia('(max-width:760px)').matches);
playBtn.hidden = started;
playBtn.addEventListener('click', () => { show(cur); pv.play().catch(() => {}); });
function show(i) {
  cur = i; started = true; playBtn.hidden = true;
  tabs.forEach((t, j) => { t.setAttribute('aria-selected', j === i); t.querySelector('.bar i').style.width = '0'; });
  const c = tabs[i].dataset.clip;
  pv.poster = '../brand/india/clips/' + c + '.jpg';
  pv.src = '../brand/india/clips/' + c + '.mp4';
  if (!reduce) pv.play().catch(() => {});
}
pv.addEventListener('timeupdate', () => { if (pv.duration) tabs[cur].querySelector('.bar i').style.width = (pv.currentTime / pv.duration * 100) + '%'; });
pv.addEventListener('ended', () => auto ? show((cur + 1) % tabs.length) : (pv.currentTime = 0, pv.play().catch(() => {})));
tabs.forEach((t, i) => t.addEventListener('click', () => { auto = false; show(i); }));
new IntersectionObserver(([e]) => { if (e.isIntersecting) { if (!started) return; if (!pv.getAttribute('src')) show(0); else if (!reduce) pv.play().catch(() => {}); } else pv.pause(); }, { threshold: .3 }).observe(pv);

// ---- share: the clean address, never the ad's tags
$('#shareBtn').addEventListener('click', async () => {
  const url = cleanUrl(location.protocol === 'file:' ? CANONICAL : location.href), note = $('#shareNote');
  const title = root.dataset.lang === 'hi' ? TITLE.hi : TITLE.en;
  try {
    if (navigator.share) { await navigator.share({ title, url }); return; }
    await navigator.clipboard.writeText(url);
    note.innerHTML = T('Link copied: ', 'लिंक कॉपी हो गया: ') + esc(url);
  } catch (e) {
    if (e && e.name === 'AbortError') return;   // the share sheet was closed
    note.innerHTML = T('Copy this link: ', 'यह लिंक कॉपी करें: ') + esc(url);
  }
});

window.OOIndia = { setLang, cleanUrl };
