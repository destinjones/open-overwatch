// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// make_sky_pages.mjs: "What's in the sky tonight in <city>" pages, one per city of data/cities.json (brand/tools/
// make_cities.py, Wikidata CC0), with tonight's facts worked out at build time by src/core (the same code as the Tonight
// card) and the live Tonight card below them. The website build runs it after .github/build_site.py, every 6 hours:
//
//   node brand/tools/make_sky_pages.mjs _site [--date 2026-10-17T06:00Z] [--cities data/cities.json] [--tle stations.txt]
//                                             [--site https://destinjones.github.io/open-overwatch/]
//
// Writes <out>/sky/<slug>/index.html for every city, <out>/sky/hi/<slug>/index.html (Hindi) for the Indian ones,
// <out>/sky/index.html and <out>/sky/hi/index.html (the lists), <out>/sky/sky.css, <out>/sitemap-sky.xml, and adds a
// Sitemap: line for it to <out>/robots.txt (harmless, but crawlers read robots.txt only at the host's root, and the
// project site lives under /open-overwatch/; search engines find sitemap-sky.xml through the site's sitemap.xml, a
// sitemap index that names it). The pages are build output: never committed (the repo's sky/ holds only stand-ins for
// the two lists, and sitemap-sky.xml a stand-in naming them, so links to sky/ resolve in the download and locally; a run
// replaces all three), never in the /v/<tag>/ copies (build_site.py makes those from git before this runs). Everything goes to <out>/sky.tmp first and is moved into place
// at the end; a run that fails on the way removes sky.tmp, so it leaves no half set. ISS passes come from the site's element-set copy
// (<out>/data/tle/stations.txt, or --tle) and satellite.js; without either the pages leave the pass out.
// The pages carry no inline script (the JSON-LD is a data block); the lists load src/sky/cityfind.js for their search.
import { readFileSync, writeFileSync, mkdirSync, rmSync, renameSync, existsSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { riseSet, moonPhase, planetsTonight, darkWindow } from '../../src/core/sky.js';
import { decodeAtlas, skyAt, BORTLE } from '../../src/core/lightpollution.js';
import { parseDeepsky, filterDeepsky, visibleTonight, label, TYPES } from '../../src/core/deepsky.js';
import { findPasses, ecfAt, compass } from '../../src/core/passes.js';
import { observer, sunEcef } from '../../src/core/observer.js';
import { parseTle } from '../../src/core/tle.js';
import { tonightHash } from '../../src/core/viewlink.js';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const SITE = 'https://destinjones.github.io/open-overwatch/';
const OG_IMAGE = 'brand/social/og-1200x630.png';
export const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'";
const ISS = 25544;

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
/** JSON for a <script type="application/ld+json"> block: no "</script>" or "<!--" can end it early. */
export const ldJson = o => JSON.stringify(o).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');

/** data/cities.json -> [{ slug, en, hi, cc, lat, lon, pop, tz, qid }] (tz: an IANA zone this Node knows, else null). */
export function loadCities(doc) {
  return doc.rows.map(r => {
    const c = Object.fromEntries(doc.cols.map((k, i) => [k, r[i]]));
    try { if (c.tz) new Intl.DateTimeFormat('en', { timeZone: c.tz }); } catch { c.tz = null; }
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(c.slug)) throw new Error(`cities.json: bad slug ${JSON.stringify(c.slug)}`);
    return c;
  });
}

/**
 * The local solar noon before the night a page should show: the night under way (evening to about 3 a.m. local solar
 * time), else the coming one. All of tonight's facts are counted from it.
 */
export function nightAnchor(lon, t0) {
  const solarH = ((t0 / 3600e3 + lon / 15) % 24 + 24) % 24, since = (solarH - 12 + 24) % 24;
  return Math.round(since < 15 ? t0 - since * 3600e3 : t0 + (12 - solarH) * 3600e3);
}

// ---- the facts (numbers only; words come with the language)

/**
 * Tonight at a city: { t0, anchor, sun: { set, rise }, dark: { start, end } | null, moon: { lit, waxing, name, at, rise,
 * set, up }, planets (sky.js planetsTonight), iss (the next visible pass, or null), sky (lightpollution.js skyAt, or null),
 * deep (deepsky.js visibleTonight, 3 binocular targets) }. ctx: { atlas, deepsky (pre-filtered), issAt (ms -> ECEF) }.
 */
export function cityFacts(city, t0, ctx = {}) {
  const { lat, lon } = city, anchor = nightAnchor(lon, t0);
  const set = riseSet('sun', lat, lon, anchor, { hours: 24 }).set;
  const rise = set ? riseSet('sun', lat, lon, set, { hours: 24 }).rise : null;
  const dark = darkWindow(lat, lon, anchor);
  const at = dark ? dark.start : anchor + 6 * 3600e3, mp = moonPhase(at), mr = riseSet('moon', lat, lon, anchor, { hours: 24 });
  const planets = planetsTonight(lat, lon, anchor, { time: clock(city.tz).hm });   // .text: sky.js's own sentence, in the city's clock
  let iss = null;
  if (ctx.issAt) iss = findPasses(ctx.issAt, observer(lat, lon, 0), t0, t0 + 72 * 3600e3, { step: 30e3, minEl: 10, sunAt: sunEcef }).find(p => p.visible) || null;
  const sky = ctx.atlas ? skyAt(ctx.atlas, lat, lon) : null;
  const deep = ctx.deepsky ? visibleTonight(ctx.deepsky, lat, lon, anchor, { minAlt: 25, limit: 3 }) : [];
  return { t0, anchor, sun: { set, rise }, dark, moon: { ...mp, at, rise: mr.rise, set: mr.set, up: mr.up }, planets, iss, sky, deep };
}

// ---- words

const PLANET_HI = { venus: 'शुक्र', jupiter: 'बृहस्पति', mars: 'मंगल', saturn: 'शनि', mercury: 'बुध' };
const PHASE_HI = { 'New Moon': 'अमावस्या (नया चाँद)', 'Waxing crescent': 'बढ़ता हुआ हँसिया चाँद', 'First quarter': 'बढ़ता हुआ आधा चाँद',
  'Waxing gibbous': 'बढ़ता हुआ, आधे से बड़ा चाँद', 'Full Moon': 'पूर्णिमा (पूरा चाँद)', 'Waning gibbous': 'घटता हुआ, आधे से बड़ा चाँद',
  'Last quarter': 'घटता हुआ आधा चाँद', 'Waning crescent': 'घटता हुआ हँसिया चाँद' };
const BORTLE_HI = ['उत्कृष्ट अँधेरी जगह', 'सचमुच अँधेरी जगह', 'गाँव का आसमान', 'गाँव और उपनगर के बीच', 'उपनगर का आसमान',
  'चमकीले उपनगर का आसमान', 'उपनगर और शहर के बीच', 'शहर का आसमान', 'शहर के बीचोंबीच का आसमान'];
const DIR_HI = ['उत्तर', 'उत्तर-पूर्व', 'पूर्व', 'दक्षिण-पूर्व', 'दक्षिण', 'दक्षिण-पश्चिम', 'पश्चिम', 'उत्तर-पश्चिम'];
const dirHi = az => DIR_HI[Math.round((((az % 360) + 360) % 360) / 45) % 8];
const TYPE_HI = { galaxy: 'आकाशगंगा', 'galaxy pair': 'आकाशगंगाओं का जोड़ा', 'open cluster': 'खुला तारागुच्छ', 'globular cluster': 'गोलाकार तारागुच्छ',
  'star association': 'तारों का समूह', 'cluster with nebula': 'नीहारिका वाला तारागुच्छ', nebula: 'नीहारिका', 'emission nebula (H II region)': 'उत्सर्जन नीहारिका',
  'emission nebula': 'उत्सर्जन नीहारिका', 'reflection nebula': 'परावर्तन नीहारिका', 'supernova remnant': 'सुपरनोवा अवशेष', 'planetary nebula': 'ग्रहीय नीहारिका' };
const heightHi = alt => alt >= 60 ? 'काफ़ी ऊँचा' : alt >= 30 ? 'आधी ऊँचाई पर' : 'नीचे, क्षितिज के पास';
/** A planet of planetsTonight in Hindi, in the same three shapes as sky.js's English sentence (after dusk, before dawn, a stretch). */
function planetHi(p, win, hm) {
  const name = PLANET_HI[p.key], dir = dirHi(p.az), mid = (win.start + win.end) / 2;
  if (p.from - win.start < 20 * 60e3 && p.to < mid) return `${name}: शाम ढलते ही ${dir} दिशा में ${heightHi(p.alt)}, लगभग ${hm(p.to)} तक`;
  if (win.end - p.to < 20 * 60e3 && p.from > mid) return `${name}: भोर से पहले ${dir} दिशा में ${heightHi(p.alt)}, लगभग ${hm(p.from)} से`;
  return `${name}: ${hm(p.from)} से ${hm(p.to)} तक ऊपर, लगभग ${hm(p.best)} पर ${dir} दिशा में सबसे ऊँचा (${Math.round(p.alt)}°)`;
}
const countryName = (cc, lang) => { try { return new Intl.DisplayNames([lang], { type: 'region' }).of(cc) || cc; } catch { return cc; } };

/** Clock times for a city: hm(ms) "21:05", day(ms) "Sat 21:05", date(ms) "Saturday 17 October 2026", zone "GMT+5:30" or "UTC". */
export function clock(tz, lang = 'en') {
  const timeZone = tz || 'UTC', loc = lang === 'hi' ? 'hi-IN' : 'en-GB';
  const hmF = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone });
  const wdF = new Intl.DateTimeFormat(loc, { weekday: 'short', timeZone });
  const dF = new Intl.DateTimeFormat(loc, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone });
  const zone = ms => tz ? (new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' }).formatToParts(ms).find(p => p.type === 'timeZoneName')?.value || tz) : 'UTC';
  return { hm: ms => hmF.format(ms), day: ms => `${wdF.format(ms)} ${hmF.format(ms)}`, date: ms => dF.format(ms), zone };
}
export const utcStamp = ms => new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

/** The ISS pass height (degrees) from which the page calls it "bright, easy to see". */
export const ISS_HIGH = 40;

/** Tonight's facts as [[term, html]] rows (already escaped) for the page's <dl>, in English or Hindi. */
export function factRows(city, f, lang = 'en') {
  const c = clock(city.tz, lang), hm = c.hm, hi = lang === 'hi', rows = [];
  const t = ms => ms == null ? '—' : hm(ms);
  // the Sun
  if (f.sun.set || f.sun.rise) {
    const darkTxt = f.dark ? (hi ? ` (तारे दिखने लायक अँधेरा ${t(f.dark.start)} से ${t(f.dark.end)} तक)` : ` (dark enough for the bright stars ${t(f.dark.start)} to ${t(f.dark.end)})`) : '';
    rows.push([hi ? 'सूर्य' : 'Sun', esc(hi ? `सूर्यास्त ${t(f.sun.set)}, सूर्योदय ${t(f.sun.rise)}${darkTxt}` : `sets ${t(f.sun.set)}, rises ${t(f.sun.rise)}${darkTxt}`)]);
  } else rows.push([hi ? 'सूर्य' : 'Sun', esc(hi ? 'आज न सूर्यास्त, न सूर्योदय' : 'no sunset or sunrise today')]);
  // the Moon: rise and set in the order they happen
  const m = f.moon, pct = Math.round(m.lit * 100);
  const ev = [[m.rise, hi ? 'उदय' : 'rises'], [m.set, hi ? 'अस्त' : 'sets']].filter(([x]) => x != null).sort((a, b) => a[0] - b[0]).map(([x, w]) => `${w} ${hm(x)}`);
  const upTxt = m.up === true ? (hi ? 'पूरे दिन ऊपर' : 'up all day') : m.up === false ? (hi ? 'पूरे दिन क्षितिज के नीचे' : 'below the horizon all day') : '';
  rows.push([hi ? 'चंद्रमा' : 'Moon', esc(`${hi ? PHASE_HI[m.name] || m.name : m.name}, ${pct}% ${hi ? 'रोशन' : 'lit'}${ev.length ? ' · ' + ev.join(', ') : ''}${upTxt ? ' · ' + upTxt : ''}`)]);
  // the planets that are up after dark
  const up = f.planets.filter(p => p.up);
  const pl = up.map(p => hi ? planetHi(p, f.dark, hm) : p.text);
  rows.push([hi ? 'ग्रह' : 'Planets', pl.length ? `<ul>${pl.map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : esc(hi ? 'अँधेरा रहते कोई चमकीला ग्रह ऊपर नहीं है।' : 'None of the bright planets is up while it is dark.')]);
  // the space station
  if (f.iss) {
    // a pass that stays low (under ~40°) is fainter and easily lost behind buildings: no "easy to see" for it
    const p = f.iss, mins = Math.max(1, Math.round((p.set - p.rise) / 60e3)), high = p.maxEl >= ISS_HIGH;
    const how = hi ? (high ? 'चमकीला, आसानी से दिखेगा' : 'नीचे रहेगा; धीरे-धीरे चलती एक स्थिर रोशनी खोजें')
      : (high ? 'bright, easy to see' : 'low; look for a steady moving light');
    rows.push([hi ? 'ISS' : 'Space station', esc(hi
      ? `${c.day(p.rise)} पर ${dirHi(p.azRise)} में उगेगा, ${Math.round(p.maxEl)}° तक ऊपर जाएगा और ${dirHi(p.azSet)} में डूबेगा · ${mins} मिनट · ${how}`
      : `next visible pass ${c.day(p.rise)}: look ${compass(p.azRise)}, it climbs to ${Math.round(p.maxEl)}° and sets in the ${compass(p.azSet)} · ${mins} min · ${how}`)]);
  }
  // how dark the sky is
  if (f.sky) {
    const s = f.sky, ratio = s.ratio >= 10 ? Math.round(s.ratio) : +s.ratio.toFixed(1);
    rows.push([hi ? 'आसमान का अँधेरा' : 'Sky darkness', esc(hi
      ? `बोर्टल श्रेणी ${s.bortle} (${BORTLE_HI[s.bortle - 1]}): साफ़, बिना चाँद की रात में सिर के ऊपर लगभग ${s.sqm.toFixed(1)} mag/arcsec²; शहर की रोशनी प्राकृतिक आसमान की ${ratio} गुना`
      : `Bortle class ${s.bortle} (${BORTLE[s.bortle - 1].name}): about ${s.sqm.toFixed(1)} mag/arcsec² overhead on a clear, moonless night; artificial light ${ratio}× the natural sky`)]);
  }
  // binocular targets
  if (f.deep.length) {
    const items = f.deep.map(d => {
      const type = TYPES[d.obj.type]?.label || d.obj.type, mag = d.obj.mag != null ? d.obj.mag.toFixed(1) : '?';
      return hi ? `${label(d.obj)}, ${TYPE_HI[type] || type}, कांतिमान ${mag}: सबसे अच्छा ${hm(d.best)} के आसपास, ${dirHi(d.az)} में ${Math.round(d.alt)}° ऊपर`
        : `${label(d.obj)}, ${type}, magnitude ${mag}: best around ${hm(d.best)}, ${Math.round(d.alt)}° up in the ${compass(d.az)}`;
    });
    rows.push([hi ? 'दूरबीन (बाइनॉकुलर) से' : 'For binoculars', `<ol>${items.map(s => `<li>${esc(s)}</li>`).join('')}</ol>`]);
  }
  return rows;
}

// ---- pages

const urls = (site, slug) => ({ en: `${site}sky/${slug}/`, hi: `${site}sky/hi/${slug}/` });
const hasHindi = c => c.cc === 'IN';
const nameIn = (c, lang) => (lang === 'hi' && c.hi) || c.en;

function head({ lang, title, desc, canonical, alternates, ld, css, ogLocale }) {
  return `<!doctype html>
<!-- Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE). Generated by brand/tools/make_sky_pages.mjs at each site build. -->
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#04060a">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(canonical)}">
${alternates.map(([h, u]) => `<link rel="alternate" hreflang="${h}" href="${esc(u)}">`).join('\n')}${alternates.length ? '\n' : ''}<meta name="robots" content="index, follow, max-image-preview:large">
<meta property="og:type" content="website"><meta property="og:site_name" content="Open Overwatch"><meta property="og:locale" content="${ogLocale}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${esc(SITE + OG_IMAGE)}"><meta name="twitter:card" content="summary_large_image">
<link rel="stylesheet" href="${css}">
<script type="application/ld+json">${ldJson(ld)}</script>
</head>
`;
}

/** One city's page in 'en' or 'hi'. f: cityFacts(); opts: { site }. */
export function renderCity(city, f, { lang = 'en', site = SITE } = {}) {
  const hi = lang === 'hi', up = hi ? '../../../' : '../../', u = urls(site, city.slug), name = nameIn(city, lang), country = countryName(city.cc, lang);
  const title = hi ? `आज रात ${name} के आसमान में क्या है · Open Overwatch` : `What's in the sky tonight in ${name}, ${country} · Open Overwatch`;
  const desc = hi ? `आज रात ${name} के आसमान में क्या है: ग्रह, चंद्रमा, ISS के पास, और आपका आसमान कितना अँधेरा है।`
    : `What's in the sky tonight in ${name}: planets, Moon, ISS passes, how dark your sky is.`;
  const canonical = hi ? u.hi : u.en;
  const alternates = hasHindi(city) ? [['en', u.en], ['hi', u.hi], ['x-default', u.en]] : [];
  const ld = {
    '@context': 'https://schema.org', '@type': 'WebPage', name: title, description: desc, url: canonical, inLanguage: lang,
    dateModified: new Date(f.t0).toISOString(), isPartOf: { '@type': 'WebSite', name: 'Open Overwatch', url: site },
    about: { '@type': 'Place', name, geo: { '@type': 'GeoCoordinates', latitude: city.lat, longitude: city.lon },
      address: { '@type': 'PostalAddress', addressCountry: city.cc }, ...(city.qid ? { sameAs: `https://www.wikidata.org/wiki/${city.qid}` } : {}) },
  };
  const c = clock(city.tz, lang), place = { lat: city.lat, lon: city.lon, name: city.en };
  const hash = tonightHash(place), night = c.date(f.anchor);
  const zoneTxt = city.tz ? (hi ? `समय ${name} की घड़ी से (${city.tz}, ${c.zone(f.anchor)})` : `times are ${name}'s clock (${city.tz}, ${c.zone(f.anchor)})`)
    : (hi ? 'समय UTC में' : 'times are UTC');
  const stamp = hi ? `${utcStamp(f.t0)} पर गणना, ${night} की रात के लिए; ${zoneTxt}। नीचे का लाइव कार्ड अपने-आप अपडेट होता है।`
    : `Computed ${utcStamp(f.t0)} for the night of ${night}; ${zoneTxt}. The live card below updates.`;
  const ns = (v, p) => `${Math.abs(v).toFixed(2)}° ${v >= 0 ? p[0] : p[1]}`;
  const where = `${name}, ${country} · ${ns(city.lat, 'NS')}, ${ns(city.lon, 'EW')}`;
  const nav = [`<a href="${up}">Open Overwatch</a>`, `<a href="../">${hi ? 'सभी शहर' : 'All cities'}</a>`];
  if (hasHindi(city)) nav.push(hi ? `<a href="../../${city.slug}/" hreflang="en" lang="en">English</a>` : `<a href="../hi/${city.slug}/" hreflang="hi" lang="hi">हिन्दी</a>`);
  const links = [
    `<a href="${up}tonight.html#${esc(hash)}">${hi ? 'पूरा "Tonight" पेज, रिमाइंडर के साथ' : 'The full Tonight page, with reminders'}</a>`,
    `<a href="${up}globe.html#go=tonight&amp;${esc(hash)}">${esc(hi ? `3D ग्लोब पर ${name} के ऊपर आज की रात` : `Tonight over ${name} on the 3D globe`)}</a>`,
  ];
  if (hasHindi(city)) links.push(`<a href="${up}${hi ? 'india/hi/' : 'india/'}">${hi ? 'भारत, अंतरिक्ष से लाइव' : 'India, live from space'}</a>`);
  const rows = factRows(city, f, lang).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('\n');
  const frameTitle = hi ? `लाइव: ${name} के ऊपर आज की रात` : `Live: tonight's sky over ${name}`;
  return head({ lang, title, desc, canonical, alternates, ld, css: hi ? '../../sky.css' : '../sky.css', ogLocale: hi ? 'hi_IN' : 'en_US' }) + `<body>
<header><nav aria-label="${hi ? 'रास्ता' : 'Breadcrumb'}">${nav.join(' · ')}</nav></header>
<main>
<h1>${esc(hi ? `आज रात ${name} के आसमान में क्या है` : `What's in the sky tonight in ${name}`)}</h1>
<p class="where">${esc(where)}</p>
<section aria-labelledby="facts">
<h2 id="facts">${hi ? 'आज रात, एक नज़र में' : "Tonight's sky at a glance"}</h2>
<p class="stamp">${esc(stamp)}</p>
<dl>
${rows}
</dl>
</section>
<section aria-labelledby="live">
<h2 id="live">${esc(frameTitle)}</h2>
${hi ? '<p class="note">लाइव कार्ड अंग्रेज़ी में है और समय आपके फ़ोन की घड़ी से दिखाता है।</p>\n' : '<p class="note">Times in the live card follow your device\'s clock.</p>\n'}<iframe src="${up}tonight.html#embed=1&amp;${esc(hash)}" title="${esc(frameTitle)}" loading="lazy"></iframe>
</section>
<section aria-labelledby="more">
<h2 id="more">${hi ? 'और देखें' : 'More'}</h2>
<ul class="links">${links.map(l => `<li>${l}</li>`).join('')}</ul>
</section>
</main>
<footer><p>${hi
    ? 'ग्रह और चंद्रमा Open Overwatch के अपने कोड से (JPL के अनुमानित स्थान); ISS: CelesTrak के कक्षा-तत्व; प्रकाश प्रदूषण: Falchi et al. 2016 का विश्व एटलस (CC BY-NC 4.0); गहरे आकाश की चीज़ें: OpenNGC (CC BY-SA 4.0); शहर: Wikidata (CC0)। बादल शामिल नहीं हैं: लाइव कार्ड बादलों का पूर्वानुमान दिखाता है।'
    : 'Planets and Moon from Open Overwatch\'s own code (JPL approximate positions); ISS from CelesTrak element sets; light pollution from the Falchi et al. 2016 World Atlas (CC BY-NC 4.0); deep-sky objects from OpenNGC (CC BY-SA 4.0); cities from Wikidata (CC0). Clouds are not included: the live card has the cloud forecast.'}</p></footer>
</body>
</html>
`;
}

/** The list of cities: by country in English (every city), or the Indian cities in Hindi. */
export function renderIndex(cities, { lang = 'en', site = SITE, t0 = Date.now() } = {}) {
  const hi = lang === 'hi', list = hi ? cities.filter(hasHindi) : cities, coll = new Intl.Collator(hi ? 'hi' : 'en');
  const groups = new Map();
  for (const c of list) { const k = countryName(c.cc, lang); (groups.get(k) || groups.set(k, []).get(k)).push(c); }
  const keys = [...groups.keys()].sort(coll.compare);
  const title = hi ? 'आज रात आपके शहर के आसमान में क्या है · Open Overwatch' : "What's in the sky tonight in your city · Open Overwatch";
  const desc = hi ? `भारत के ${list.length} शहरों के लिए आज रात के ग्रह, चंद्रमा, ISS के पास और आसमान का अँधेरा।`
    : `Tonight's planets, Moon, ISS passes and sky darkness for ${list.length} cities in ${keys.length} countries.`;
  const canonical = hi ? `${site}sky/hi/` : `${site}sky/`;
  const ld = { '@context': 'https://schema.org', '@type': 'CollectionPage', name: title, description: desc, url: canonical, inLanguage: lang, dateModified: new Date(t0).toISOString() };
  const body = keys.map(k => {   // each country's heading has its code as id: sky/#in is the Indian cities (india/ links there)
    const cs = groups.get(k).sort((a, b) => coll.compare(nameIn(a, lang), nameIn(b, lang)));
    return `<h2 id="${esc(cs[0].cc.toLowerCase())}">${esc(k)}</h2>\n<ul>${cs.map(c => `<li><a href="${c.slug}/">${esc(nameIn(c, lang))}</a>`).join('')}</ul>`;
  }).join('\n');
  return head({ lang, title, desc, canonical, alternates: [], ld, css: hi ? '../sky.css' : 'sky.css', ogLocale: hi ? 'hi_IN' : 'en_US' }) + `<body>
<header><nav aria-label="${hi ? 'रास्ता' : 'Breadcrumb'}"><a href="${hi ? '../../' : '../'}">Open Overwatch</a> · ${hi ? '<a href="../" hreflang="en" lang="en">English</a> · <a href="../../india/hi/">भारत</a>' : '<a href="hi/" hreflang="hi" lang="hi">हिन्दी</a>'}</nav></header>
<main>
<h1>${esc(hi ? 'आज रात आपके शहर का आसमान' : "Tonight's sky, city by city")}</h1>
<p>${esc(desc)} ${hi ? 'हर पेज हर 6 घंटे में नए सिरे से बनता है।' : 'Each page is worked out again every 6 hours.'}</p>
<p class="find" hidden><label for="q">${hi ? 'शहर खोजें' : 'Find a city'}</label> <input id="q" type="search" autocomplete="off"></p>
<div id="cities">
${body}
</div>
</main>
<footer><p>${hi ? 'शहर: Wikidata (CC0)।' : 'Cities: Wikidata (CC0).'} <a href="${hi ? '../../' : '../'}tonight.html">${hi ? 'अपनी जगह के लिए "Tonight" खोलें' : 'Tonight for your own spot'}</a></p></footer>
<script type="module" src="${hi ? '../../' : '../'}src/sky/cityfind.js"></script>
</body>
</html>
`;
}

export const CSS = `/* Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE). The city sky pages (brand/tools/make_sky_pages.mjs).
   441 small pages, so no web fonts and no shared files: system fonts, and the colours and radii of the site's tokens
   (src/app/shell.css, docs/DESIGN.md) written out. */
:root{color-scheme:dark;--bg:#04060a;--surface:#080c12;--line:#182230;--line-strong:#26343f;--ink:#e6edf3;--dim:#8b9bab;--faint:#738599;--accent:#7dffa6;--link:#7fd0ff}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans","Noto Sans Devanagari",sans-serif;-webkit-text-size-adjust:100%}
header,main,footer{max-width:760px;margin:0 auto;padding:0 16px}
header{padding-top:14px;font-size:14px;color:var(--faint);border-bottom:1px solid var(--line);padding-bottom:12px}
header a{color:var(--ink);font-weight:600;text-decoration:none} header a:hover{color:var(--accent)}
a{color:var(--link);text-underline-offset:.18em}
a:focus-visible,input:focus-visible,iframe:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
h1{font-size:28px;line-height:1.2;letter-spacing:-.01em;margin:22px 0 6px;text-wrap:balance}
h2{font-size:13px;line-height:1.3;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);margin:32px 0 10px}
.where,.stamp,.note{color:var(--dim);font-size:14px;margin:4px 0}
dl{margin:12px 0;display:grid;grid-template-columns:minmax(90px,max-content) 1fr;gap:10px 18px;padding:16px 18px;background:var(--surface);border:1px solid var(--line);border-radius:12px}
dt{font-weight:600;color:#fff}
dd{margin:0}
dd ul,dd ol{margin:0;padding-left:20px}
iframe{display:block;width:100%;height:820px;border:1px solid var(--line-strong);border-radius:12px;background:var(--bg);margin-top:8px}
.links{padding-left:20px}
.links li{margin:4px 0}
footer{color:var(--faint);font-size:13px;padding-bottom:32px;margin-top:32px;border-top:1px solid var(--line);padding-top:16px}
footer a{color:var(--dim)}
#cities ul{list-style:none;padding:0;margin:0;display:flex;flex-wrap:wrap;gap:6px 18px}
#cities a{display:inline-block;padding:4px 0}
.find input{font:inherit;min-height:44px;padding:8px 12px;border-radius:8px;border:1px solid var(--line-strong);background:var(--surface);color:inherit;width:min(100%,320px)}
@media (max-width:520px){dl{grid-template-columns:1fr;gap:2px}dd{margin-bottom:10px}h1{font-size:23px}iframe{height:760px}}
`;

/** sitemap-sky.xml: every page, the Hindi pairs with their hreflang links. */
export function sitemap(cities, { site = SITE, t0 = Date.now() } = {}) {
  const day = new Date(t0).toISOString().slice(0, 10);
  const alt = (u) => `\n    <xhtml:link rel="alternate" hreflang="en" href="${esc(u.en)}"/>\n    <xhtml:link rel="alternate" hreflang="hi" href="${esc(u.hi)}"/>\n    <xhtml:link rel="alternate" hreflang="x-default" href="${esc(u.en)}"/>`;
  const url = (loc, a = '') => `  <url><loc>${esc(loc)}</loc><lastmod>${day}</lastmod><changefreq>daily</changefreq>${a}</url>`;
  const idx = { en: `${site}sky/`, hi: `${site}sky/hi/` };
  const rows = [url(idx.en), url(idx.hi)];   // the lists are not translations of each other (every city / India's): no hreflang
  for (const c of cities) {
    const u = urls(site, c.slug);
    if (hasHindi(c)) rows.push(url(u.en, alt(u)), url(u.hi, alt(u)));
    else rows.push(url(u.en));
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!-- The city sky pages (brand/tools/make_sky_pages.mjs), rebuilt with the site every 6 hours. -->\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${rows.join('\n')}\n</urlset>\n`;
}

/** The ISS's Earth-fixed position by ms from a TLE file's text and satellite.js, memoised (every city walks the same
 *  30-s grid from the same t0), or null without the satellite or the library. */
export function issFrom(tleText, sl) {
  if (!tleText || !sl) return null;
  const t = parseTle(tleText).find(s => s.id === String(ISS));
  if (!t) return null;
  const at = ecfAt(sl, sl.twoline2satrec(t.l1, t.l2)), memo = new Map();
  return ms => { let p = memo.get(ms); if (p === undefined) { if (memo.size > 200000) memo.clear(); memo.set(ms, p = at(ms)); } return p; };
}

/**
 * Write every page under out. opts: { t0 (ms), cities ([...] from loadCities), site, atlas (decoded), deepsky (objects),
 * issAt (issFrom) }. Returns { pages, bytes, largest: [file, bytes] }.
 */
export function writePages(out, { t0, cities, site = SITE, atlas = null, deepsky = null, issAt = null }) {
  if (resolve(out) === resolve(ROOT)) throw new Error('make_sky_pages: write into the built site (e.g. _site), not the repository: the pages are build output');
  const tmp = join(out, 'sky.tmp'), dest = join(out, 'sky');
  rmSync(tmp, { recursive: true, force: true });
  const ctx = { atlas, deepsky, issAt };
  let pages = 0, bytes = 0, largest = ['', 0];
  try {
    const put = (rel, text) => {
      const file = join(tmp, rel); mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, text);
      const n = Buffer.byteLength(text); pages++; bytes += n; if (n > largest[1] && rel.endsWith('.html') && rel !== 'index.html' && rel !== join('hi', 'index.html')) largest = [rel, n];
    };
    for (const c of cities) {
      const f = cityFacts(c, t0, ctx);
      put(join(c.slug, 'index.html'), renderCity(c, f, { lang: 'en', site }));
      if (hasHindi(c)) put(join('hi', c.slug, 'index.html'), renderCity(c, f, { lang: 'hi', site }));
    }
    put('index.html', renderIndex(cities, { lang: 'en', site, t0 }));
    put(join('hi', 'index.html'), renderIndex(cities, { lang: 'hi', site, t0 }));
    writeFileSync(join(tmp, 'sky.css'), CSS);
  } catch (e) {
    rmSync(tmp, { recursive: true, force: true });   // never a half-written /sky.tmp/ in the uploaded site
    throw e;
  }
  rmSync(dest, { recursive: true, force: true });
  renameSync(tmp, dest);
  writeFileSync(join(out, 'sitemap-sky.xml'), sitemap(cities, { site, t0 }));
  const robots = join(out, 'robots.txt'), line = `Sitemap: ${site}sitemap-sky.xml`;
  if (existsSync(robots) && !readFileSync(robots, 'utf8').split(/\r?\n/).includes(line)) appendFileSync(robots, (readFileSync(robots, 'utf8').endsWith('\n') ? '' : '\n') + line + '\n');
  return { pages, bytes, largest };
}

/** Load the data a run needs from the repo (and the site's TLE copy) and write the pages. */
export async function build(out, { t0 = Date.now(), citiesFile = join(ROOT, 'data/cities.json'), tleFile = join(out, 'data/tle/stations.txt'), site = SITE, sl } = {}) {
  const cities = loadCities(JSON.parse(readFileSync(citiesFile, 'utf8')));
  const atlas = await decodeAtlas(readFileSync(join(ROOT, 'data/lightpollution.bin')));
  const deepsky = filterDeepsky(parseDeepsky(JSON.parse(readFileSync(join(ROOT, 'data/deepsky.json'), 'utf8'))), { maxMag: 6.5, groups: ['galaxy', 'cluster', 'nebula', 'planetary'] });
  if (sl === undefined) sl = await import('satellite.js').then(m => m.default || m, () => null);
  const tle = tleFile && existsSync(tleFile) ? readFileSync(tleFile, 'utf8') : null;
  const issAt = issFrom(tle, sl);
  return { ...writePages(out, { t0, cities, site, atlas, deepsky, issAt }), cities: cities.length, iss: !!issAt };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const out = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
  if (!out) { console.error('usage: node brand/tools/make_sky_pages.mjs <site dir> [--date ISO] [--cities file] [--tle file] [--site URL]'); process.exit(2); }
  const started = Date.now(), date = opt('--date');
  const r = await build(resolve(out), { t0: date ? Date.parse(date) : Date.now(), citiesFile: opt('--cities') && resolve(opt('--cities')), tleFile: opt('--tle') ? resolve(opt('--tle')) : undefined, site: opt('--site') || SITE });
  console.log(`sky pages: ${r.pages} files for ${r.cities} cities, ${(r.bytes / 1e6).toFixed(1)} MB (largest ${r.largest[0]}: ${(r.largest[1] / 1e3).toFixed(1)} KB), ISS passes ${r.iss ? 'in' : 'left out (no element sets or satellite.js)'}, ${((Date.now() - started) / 1e3).toFixed(0)} s`);
}

