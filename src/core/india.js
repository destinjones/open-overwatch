// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The India landing page's logic without the page (india/india.js draws it): which launches are India's and when they
// are due, the six cities and their next ISS passes, compass words in English and Hindi, and the address with the ad
// tags taken out. DOM-free (test/india.test.mjs).
import { findPasses } from './passes.js';
import { observer, sunEcef } from './observer.js';
import { precisionCode, listedUntil } from './launches.js';

export const TZ = 'Asia/Kolkata';
/** A time in India, in English or Hindi (Intl: hi-IN writes Hindi month and day names with Western digits). */
export const fmtIST = (ms, lang, o) => new Intl.DateTimeFormat(lang === 'hi' ? 'hi-IN' : 'en-IN', { timeZone: TZ, ...o }).format(ms);

/** The address without utm_* and fbclid (the tags ad links carry) and without the hash; `lang` and the rest stay. */
export function cleanUrl(href) {
  const u = new URL(href);
  for (const k of [...u.searchParams.keys()]) if (/^utm_/i.test(k) || /^fbclid$/i.test(k)) u.searchParams.delete(k);
  u.hash = '';
  return u.href;
}

/** A box around India (the ISS line says "over India" inside it), and one around South Asia (the quake count). */
export const overIndia = (lat, lon) => lat >= 6 && lat <= 37.5 && lon >= 68 && lon <= 97.5;
export const inSouthAsia = ([lon, lat]) => lat >= 0 && lat <= 40 && lon >= 60 && lon <= 100;

/** A Launch Library 2 launch from India (Satish Dhawan Space Centre, Sriharikota, or any pad in India). */
export const fromIndia = r => {
  const l = r && r.pad && r.pad.location;
  return !!l && (/\bIndia\b|Sriharikota|Satish Dhawan/i.test(l.name || '') || l.country_code === 'IND' || r.pad.country?.alpha_3_code === 'IND');
};
/** A raw LL2 launch's precision code (src/core/launches.js precisionCode: 'DAY', 'M', 'Q4', …). */
const precisionOf = r => precisionCode(r && r.net_precision && (r.net_precision.abbrev || r.net_precision.name));
const IST = 5.5 * 3600e3;
/** The end (ms) of the day in India that a time falls on (the day launchWhen shows for a DAY launch). */
const istDayEnd = t => Math.floor((t + IST) / 864e5) * 864e5 + 864e5 - IST;
/** India's launches still to come, soonest first: under an hour past a precise time, or until the end of the day,
 *  month or quarter an imprecise one names (a "NET October" launch stays listed through 31 October, when the data
 *  still has it); a launch dated to the day stays to the end of that day in India too, the day the page shows. */
export function indianLaunches(results, now = Date.now()) {
  return (Array.isArray(results) ? results : []).filter(r => r && typeof r === 'object' && fromIndia(r))
    .filter(r => {
      const t = Date.parse(r.net), p = precisionOf(r);
      return !Number.isFinite(t) || Math.max(listedUntil(t, p, 3600e3), ['DAY', 'AM', 'PM'].includes(p) ? istDayEnd(t) : -Infinity) > now;
    })
    .sort((a, b) => (Date.parse(a.net) || 9e15) - (Date.parse(b.net) || 9e15));
}
const ORDINAL_HI = ['पहली', 'दूसरी', 'तीसरी', 'चौथी'];
/** When a launch is due, only as precisely as Launch Library 2 says (net_precision, its codes SEC MIN HR AM PM DAY WK M
 *  Q1-Q4 H1 H2 Y FY DEC): a time, a day, a month, a quarter or half, a (fiscal) year or a decade, in India's time zone. */
export function launchWhen(r, lang) {
  const t = Date.parse(r && r.net), p = precisionOf(r), hi = lang === 'hi', target = hi ? 'लक्ष्य: ' : 'target: ';
  if (!Number.isFinite(t)) return hi ? 'तारीख़ तय नहीं' : 'date to be set';
  if (['SEC', 'MIN', 'HR'].includes(p)) return fmtIST(t, lang, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' IST';
  if (['DAY', 'AM', 'PM'].includes(p)) return fmtIST(t, lang, { day: 'numeric', month: 'short', year: 'numeric' });
  if (p === 'M' || p === 'WK') return target + fmtIST(t, lang, { month: 'long', year: 'numeric' });
  const year = fmtIST(t, 'en', { year: 'numeric' }), part = /^([QH])([1-4])$/.exec(p);
  if (part) return target + (hi ? `${year} की ${ORDINAL_HI[+part[2] - 1]} ${part[1] === 'Q' ? 'तिमाही' : 'छमाही'}` : `${p} ${year}`);
  if (p === 'FY') return target + (hi ? `वित्त वर्ष ${year}` : `FY ${year}`);
  if (p === 'DEC') { const dec = Math.floor(+year / 10) * 10; return target + (hi ? `${dec} का दशक` : `the ${dec}s`); }
  return target + year;
}

/** The six cities on the page: English name, Hindi name, latitude, longitude (city centres; Delhi is India Gate). */
export const CITIES = Object.freeze([
  ['Delhi', 'दिल्ली', 28.6129, 77.2295], ['Mumbai', 'मुंबई', 19.076, 72.8777], ['Bengaluru', 'बेंगलुरु', 12.9716, 77.5946],
  ['Kolkata', 'कोलकाता', 22.5726, 88.3639], ['Chennai', 'चेन्नई', 13.0827, 80.2707], ['Hyderabad', 'हैदराबाद', 17.385, 78.4867],
]);
const DIRS = [['N', 'उत्तर'], ['NE', 'उत्तर-पूर्व'], ['E', 'पूर्व'], ['SE', 'दक्षिण-पूर्व'], ['S', 'दक्षिण'], ['SW', 'दक्षिण-पश्चिम'], ['W', 'पश्चिम'], ['NW', 'उत्तर-पश्चिम']];
/** An azimuth (deg) as one of eight directions, in English or Hindi. */
export const dir8 = (az, lang) => DIRS[Math.round(((az % 360) + 360) % 360 / 45) % 8][lang === 'hi' ? 1 : 0];

/** One city's passes in the coming `days`: the first of any kind and the first visible one (dark sky, sunlit station). */
export function cityPasses(positionAt, lat, lon, now, days = 7) {
  const all = findPasses(positionAt, observer(lat, lon, 0.2), now, now + days * 864e5, { step: 20e3, minEl: 10, sunAt: sunEcef });
  return { next: all[0] || null, visible: all.find(p => p.visible) || null };
}
