// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The Sun side of space weather, from NOAA SWPC (US Government, public domain, no key, sends CORS): the solar wind at
// the L1 point a million and a half km sunward (speed, density, and the magnetic field's Bz: southward opens Earth's
// field to the wind and feeds the aurora), the Sun's X-ray flares from GOES, and SWPC's watches, warnings and alerts in
// plain words. Pure: the views and the MCP server fetch, this parses and words. Every part carries a provenance record
// (core/provenance.js) whose data time is the feed's own time tag, never the download.
//
// The old products/solar-wind/*-1-day.json files are gone (404 since SWPC moved to json/rtsw/, which mixes every
// spacecraft at L1 and flags the operational one `active`). The products/summary/ files are the latest minute only.

import { provenance } from './provenance.js';
import { esc } from './format.js';

export const SWPC = 'https://services.swpc.noaa.gov/';
export const SW_URLS = Object.freeze({
  mag: SWPC + 'json/rtsw/rtsw_mag_1m.json',          // 1-minute field, the last day, newest first (~160 kB gzipped)
  wind: SWPC + 'json/rtsw/rtsw_wind_1m.json',        // 1-minute plasma, the last day (~100 kB gzipped)
  xrays: SWPC + 'json/goes/primary/xrays-1-day.json', // GOES X-ray flux, both channels, 1-minute (~105 kB gzipped)
  flare: SWPC + 'json/goes/primary/xray-flares-latest.json',
  flares: SWPC + 'json/goes/primary/xray-flares-7-day.json',   // every flare of the week (~4 kB): the day's peak without the flux file
  alerts: SWPC + 'products/alerts.json',
  magNow: SWPC + 'products/summary/solar-wind-mag-field.json',   // the latest minute only (60 bytes): for a one-line summary
  windNow: SWPC + 'products/summary/solar-wind-speed.json',
});
const PAGE = { wind: 'https://www.swpc.noaa.gov/products/real-time-solar-wind', xrays: 'https://www.swpc.noaa.gov/products/goes-x-ray-flux', alerts: 'https://www.swpc.noaa.gov/products/alerts-watches-and-warnings' };
const LICENCE = 'Public domain (US Government, NOAA SWPC)';
/** How old each part may be before its card says stale: Bz and the wind change by the minute; flares the same. */
export const SW_MAX_AGE = Object.freeze({ mag: 15 * 60e3, wind: 15 * 60e3, xrays: 15 * 60e3, flare: 15 * 60e3 });
/** The spacecraft at L1 behind the real-time solar wind, by SWPC's source tag. */
export const CRAFT = Object.freeze({ SOLAR1: 'SWFO-L1', ACE: 'ACE', DSCOVR: 'DSCOVR', IMAP: 'IMAP' });
const L1_KM = 1.5e6;
const MIN = 60e3, HOUR = 3600e3, DAY = 24 * HOUR;

const fin = Number.isFinite;
/** SWPC time tags come with and without the Z and with a space for the T; all are UTC. */
export const swTime = t => { if (typeof t !== 'string' || !t) return NaN; const s = t.trim().replace(' ', 'T'); return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s + 'Z'); };
const num = (v, lim) => { const n = v == null || v === '' ? NaN : +v; return fin(n) && n > -9000 && (lim == null || Math.abs(n) <= lim) ? n : NaN; };
const byTime = (a, b) => a.t - b.t;
/** Rows of the operational spacecraft only, when the feed marks one (json/rtsw has three spacecraft side by side). */
const operational = rows => rows.some(r => r && r.active === true) ? rows.filter(r => r && r.active === true) : rows;

/** The magnetic field at L1 (json/rtsw/rtsw_mag_1m.json, or the one-row summary) → [{ t, bz, bt, source }] oldest first. */
export function parseMag(doc) {
  const out = [];
  for (const r of operational(Array.isArray(doc) ? doc : [])) {
    if (!r || typeof r !== 'object') continue;
    const t = swTime(r.time_tag), bz = num(r.bz_gsm, 200), bt = num(r.bt, 200);
    if (!fin(t) || !fin(bz)) continue;
    out.push({ t, bz, bt: fin(bt) ? bt : null, source: r.source ? String(r.source) : null });
  }
  return out.sort(byTime);
}
/** The plasma at L1 (json/rtsw/rtsw_wind_1m.json, or the summary) → [{ t, speed (km/s), density (per cm³), source }]. */
export function parseWind(doc) {
  const out = [];
  for (const r of operational(Array.isArray(doc) ? doc : [])) {
    if (!r || typeof r !== 'object') continue;
    const t = swTime(r.time_tag), speed = num(r.proton_speed, 3000), density = num(r.proton_density, 1000);
    if (!fin(t) || !fin(speed) || speed <= 0) continue;
    out.push({ t, speed, density: fin(density) && density >= 0 ? density : null, source: r.source ? String(r.source) : null });
  }
  return out.sort(byTime);
}
/** GOES X-ray flux (json/goes/primary/xrays-*.json) → the long channel (0.1-0.8 nm, the one flare classes use) as
 *  [{ t, flux (W/m²), satellite }] oldest first. */
export function parseXrays(doc) {
  const out = [];
  for (const r of Array.isArray(doc) ? doc : []) {
    if (!r || r.energy !== '0.1-0.8nm') continue;
    const t = swTime(r.time_tag), flux = num(r.flux);
    if (fin(t) && fin(flux) && flux > 0) out.push({ t, flux, satellite: r.satellite ?? null });
  }
  return out.sort(byTime);
}

/** SWPC's flare list (xray-flares-7-day.json, or -latest) → [{ cls, flux, at, begin, end }] by peak time, oldest first. */
export function parseFlares(doc) {
  const out = [];
  for (const r of Array.isArray(doc) ? doc : []) {
    if (!r || typeof r !== 'object') continue;
    const cls = String(r.max_class || '').toUpperCase(), at = swTime(r.max_time), flux = classFlux(cls);
    if (fin(at) && fin(flux)) out.push({ cls, flux, at, begin: swTime(r.begin_time) || null, end: fin(swTime(r.end_time)) ? swTime(r.end_time) : null });
  }
  return out.sort((a, b) => a.at - b.at);
}

/** A flare class from the long-channel flux: 2.2e-6 W/m² → "C2.2". X runs on past X9.9 (X12, X28). */
export function flareClass(flux) {
  if (!fin(flux) || flux <= 0) return '';
  const L = [['X', 1e-4], ['M', 1e-5], ['C', 1e-6], ['B', 1e-7], ['A', 1e-8]];
  const hit = L.find(([, b]) => flux >= b * 0.99995), [c, base] = hit || L[L.length - 1], v0 = Math.floor(flux / base * 10 + 1e-6) / 10;
  const v = hit ? Math.max(1, v0) : v0;   // a flux a hair under a decade takes the higher letter, so it reads 1.0 there, never "X0.9"
  return c + (c === 'X' && v >= 10 ? Math.floor(v) : v.toFixed(1));
}
/** Back from a class to its flux ("M2.3" → 2.3e-5), NaN for anything else. */
export function classFlux(cls) {
  const m = /^\s*([ABCMX])\s*(\d+(?:\.\d+)?)\s*$/i.exec(String(cls || '')); if (!m) return NaN;
  return +m[2] * { A: 1e-8, B: 1e-7, C: 1e-6, M: 1e-5, X: 1e-4 }[m[1].toUpperCase()];
}
/** NOAA's radio blackout scale from a flare's peak: M1 R1, M5 R2, X1 R3, X10 R4, X20 R5 (0 below M1). */
export function rScale(flux) { return !fin(flux) ? 0 : flux >= 2e-3 ? 5 : flux >= 1e-3 ? 4 : flux >= 1e-4 ? 3 : flux >= 5e-5 ? 2 : flux >= 1e-5 ? 1 : 0; }
const R_NAME = ['', 'minor', 'moderate', 'strong', 'severe', 'extreme'];
/** A class in plain words: what it does on Earth. */
export function flareWords(cls) {
  const f = classFlux(cls), r = rScale(f), c = String(cls || '').toUpperCase()[0];
  if (!fin(f)) return '';
  if (r) return `${r >= 3 ? 'a major' : 'a medium'} flare: ${R_NAME[r]} radio blackout (R${r}) on the sunlit side of Earth${r >= 3 ? ', HF radio can go silent for an hour or more' : ''}`;
  return c === 'C' ? 'a small flare, no effect on Earth' : 'the Sun is quiet in X-rays';
}

/** Bz in words: southward (negative) opens Earth's magnetic field to the solar wind and feeds the aurora. */
export function bzWords(bz) {
  if (!fin(bz)) return '';
  const v = `${bz > 0 ? '+' : bz < 0 ? '−' : ''}${Math.abs(bz).toFixed(1)} nT`;
  if (bz <= -10) return `strongly southward (${v}), aurora-friendly: a storm can build while it stays south`;
  if (bz < -2) return `southward (${v}), aurora-friendly`;
  if (bz <= 2) return `near zero (${v}), neither helping nor blocking the aurora`;
  return `northward (${v}), the solar wind mostly slides past and the aurora stays quiet`;
}
/** The wind in words, and how long it takes from L1 to Earth at that speed. */
export function windWords(speed, density) {
  if (!fin(speed)) return '';
  const pace = speed < 350 ? 'slow' : speed < 500 ? 'ordinary' : speed < 650 ? 'fast' : speed < 800 ? 'very fast' : 'extremely fast, as after a CME';
  const dense = fin(density) ? (density >= 20 ? ', very dense' : density >= 10 ? ', dense' : density < 2 ? ', thin' : '') : '';
  return `${Math.round(speed)} km/s (${pace}${dense}${fin(density) ? `, ${density.toFixed(1)} protons/cm³` : ''}); it reaches Earth about ${Math.round(L1_KM / speed / 60)} min after the spacecraft at L1`;
}

// ---- SWPC's alerts, watches and warnings -------------------------------------------------------------------------

const MON = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
/** "2026 Oct 13 2058 UTC" → ms. */
export function swpcTime(s) {
  const m = /(\d{4})\s+([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{2})(\d{2})/.exec(String(s || ''));
  return m && m[2] in MON ? Date.UTC(+m[1], MON[m[2]], +m[3], +m[4], +m[5]) : NaN;
}
const G_NAME = ['', 'minor', 'moderate', 'strong', 'severe', 'extreme'];
const kpG = kp => Math.max(0, Math.min(5, kp - 4));
const hhmm = t => fin(t) ? new Date(t).toISOString().slice(11, 16) + ' UTC' : '';
const MONTHS = Object.keys(MON);
const dayTime = t => fin(t) ? `${MONTHS[new Date(t).getUTCMonth()]} ${new Date(t).getUTCDate()} ${hhmm(t)}` : '';
const dayOnly = t => `${MONTHS[new Date(t).getUTCMonth()]} ${new Date(t).getUTCDate()}`;

/** One message's fields: "Key: value" lines, the headline and its kind. */
function fieldsOf(message) {
  const lines = String(message || '').split(/\r?\n/).map(l => l.trim()), f = {};
  let head = '', kind = '';
  for (const l of lines) {
    const h = /^(EXTENDED WARNING|CANCEL WARNING|WARNING|CANCEL WATCH|WATCH|CONTINUED ALERT|CANCEL ALERT|ALERT|SUMMARY):\s*(.*)$/.exec(l);
    if (h && !head) { kind = h[1]; head = h[2].trim(); continue; }
    const m = /^([A-Za-z][A-Za-z0-9 ]{1,40}):\s*(.*)$/.exec(l);
    if (m && !(m[1] in f)) f[m[1].toLowerCase()] = m[2].trim();
  }
  return { f, head, kind, text: lines.join('\n') };
}

/**
 * SWPC's alerts.json (the last few weeks of messages) → one entry per message still worth showing, newest first:
 * { id, code, serial, kind ('warning' | 'watch' | 'alert' | 'summary'), issued, from, until, active, scale ('G2', 'R2',
 * 'S1' or ''), cme, title (SWPC's own headline), text (plain words) }. Cancelled and superseded messages are dropped;
 * `active` means in force at `now` (a warning inside its validity, the newest watch until its last storm day ends, a
 * K-index alert until its 3-hour period ends, a particle alert for a day); the rest are kept while under `keepMs` old.
 */
export function parseAlerts(doc, { now = Date.now(), keepMs = DAY } = {}) {
  const msgs = [];
  for (const r of Array.isArray(doc) ? doc : []) {
    if (!r || typeof r.message !== 'string') continue;
    const { f, head, kind, text } = fieldsOf(r.message);
    const code = f['space weather message code'] || String(r.product_id || ''), serial = f['serial number'] || '';
    const issued = fin(swpcTime(f['issue time'])) ? swpcTime(f['issue time']) : swTime(r.issue_datetime);
    if (!kind || !fin(issued) || issued > now + 5 * MIN) continue;
    msgs.push({ r, f, head, kind, text, code, serial, issued });
  }
  msgs.sort((a, b) => b.issued - a.issued);
  const gone = new Set();   // code:serial cancelled or extended by a newer message
  for (const m of msgs) {
    if (m.f['cancel serial number']) gone.add(m.code + ':' + m.f['cancel serial number']);
    if (m.f['extension to serial number']) gone.add(m.code + ':' + m.f['extension to serial number']);
    if (m.f['continuation of serial number'] && m.f['continuation of serial number'] !== m.serial) gone.add(m.code + ':' + m.f['continuation of serial number']);
  }
  const out = [], seen = new Set();
  let watchSeen = false;   // "THIS SUPERSEDES ANY/ALL PRIOR WATCHES IN EFFECT": only the newest watch counts
  for (const m of msgs) {
    if (/^CANCEL/.test(m.kind)) { if (m.kind === 'CANCEL WATCH') watchSeen = true; continue; }
    const key = m.code + ':' + m.serial;
    if (gone.has(key) && m.kind !== 'CONTINUED ALERT') continue;
    if (seen.has(key)) continue; seen.add(key);   // a continued alert repeats its serial daily: keep the newest
    const e = describe(m);
    if (!e) continue;
    if (e.kind === 'watch') { if (watchSeen) continue; watchSeen = true; }
    e.active = fin(e.from) ? e.from <= now && now < e.until : e.issued <= now && now < e.until;
    if (!e.active && now - Math.max(e.issued, fin(e.until) ? Math.min(e.until, now) : e.issued) > keepMs) continue;
    out.push(e);
  }
  return out;
}

/** The `n` that matter most: the biggest NOAA scale (S and R and G alike by number), then CME news, then the newest.
 *  Repeated K-index alerts of one storm collapse to the strongest. */
export function topAlerts(list, n = 3) {
  const lvl = e => +(e.scale || '0').replace(/\D/g, '') || 0, seen = new Set();
  return [...(list || [])].sort((a, b) => lvl(b) - lvl(a) || (b.cme - a.cme) || b.issued - a.issued)
    .filter(e => { if (!/^ALTK/.test(e.code)) return true; if (seen.has('k')) return false; seen.add('k'); return true; }).slice(0, n);
}

/** One message in plain words. */
function describe({ f, head, kind, text, code, serial, issued }) {
  const scaleM = /\b([GRS][1-5])\b/.exec(f['noaa scale'] || ''), base = { id: code + ':' + serial, code, serial, issued, title: head, scale: scaleM ? scaleM[1] : '', cme: false, from: NaN };
  const kpM = /K-index of (\d)/.exec(head), comment = f.comment || '';
  if (kind === 'WARNING' || kind === 'EXTENDED WARNING') {
    const from = swpcTime(f['valid from']), until = swpcTime(f['now valid until'] || f['valid to']);
    const e = { ...base, kind: 'warning', from: fin(from) ? from : issued, until: fin(until) ? until : issued + 6 * HOUR };
    if (kpM) {
      const kp = +kpM[1], g = kpG(kp), more = /or greater/.test(head);
      e.scale = e.scale || (g ? 'G' + g : '');
      e.text = `Warning until ${dayTime(e.until)}: geomagnetic activity of Kp ${kp}${more ? ' or more' : ''} expected (${g ? `a G${g} ${G_NAME[g]} storm${more ? ' or stronger' : ''}` : 'active conditions'}), so the aurora can reach further from the poles than usual.`;
    } else if (/Sudden Impulse/i.test(head)) {
      e.cme = /CME/i.test(comment); e.until = e.from + 3 * HOUR;
      e.text = `Warning: a solar-wind shock is expected to hit Earth's magnetic field around ${hhmm(e.from)}${e.cme ? ', the front of a CME' : ''}.`;
    } else if (/Proton/i.test(head)) e.text = `Warning until ${dayTime(e.until)}: a solar radiation storm is expected (protons from the Sun), a risk for satellites, polar flights and astronauts.`;
    else if (/Electron/i.test(head)) e.text = `Warning until ${dayTime(e.until)}: high-energy electrons expected around geostationary satellites.`;
    else e.text = `Warning until ${dayTime(e.until)}: ${head}.`;
    return e;
  }
  if (kind === 'WATCH') {
    const days = [...text.matchAll(/([A-Z][a-z]{2})\s+(\d{1,2})\s*:\s+(None|G[1-5])/g)].map(d => {
      const y0 = new Date(issued).getUTCFullYear(), mo = MON[d[1]], y = mo < new Date(issued).getUTCMonth() - 6 ? y0 + 1 : y0;   // a December watch can name January
      return { t: Date.UTC(y, mo, +d[2]), g: d[3] === 'None' ? 0 : +d[3][1] };
    }).filter(d => fin(d.t));
    const stormy = days.filter(d => d.g > 0), top = stormy.reduce((m, d) => (d.g > m ? d.g : m), 0);
    const until = stormy.length ? Math.max(...stormy.map(d => d.t)) + DAY : issued + DAY;
    const cme = /\bCME|coronal mass ejection/i.test(comment + ' ' + head);
    const named = stormy.map(d => `${dayOnly(d.t)} G${d.g} (${G_NAME[d.g]})`).join(', ');
    return { ...base, kind: 'watch', scale: top ? 'G' + top : '', cme, until,
      text: `Storm watch: NOAA predicts ${top ? `a G${top} ${G_NAME[top]} geomagnetic storm` : 'storm conditions'}${named ? ` (${named})` : ''}${cme ? ', as a CME (a cloud of the Sun\'s gas and magnetic field) arrives' : ''}.` };
  }
  if (kind === 'ALERT' || kind === 'CONTINUED ALERT') {
    const at = fin(swpcTime(f['threshold reached'])) ? swpcTime(f['threshold reached']) : fin(swpcTime(f['begin time'])) ? swpcTime(f['begin time']) : issued;
    if (kpM) {
      const kp = +kpM[1], g = kpG(kp), per = /(\d{2})00-(\d{2})00/.exec(f['synoptic period'] || '');
      const d0 = Date.UTC(new Date(at).getUTCFullYear(), new Date(at).getUTCMonth(), new Date(at).getUTCDate());
      const until = per ? d0 + +per[2] * HOUR : at + 3 * HOUR;
      return { ...base, kind: 'alert', scale: base.scale || (g ? 'G' + g : ''), until: until > at ? until : at + 3 * HOUR,
        text: `Kp reached ${kp} at ${hhmm(at)}: ${g ? `a G${g} ${G_NAME[g]} geomagnetic storm is under way, aurora possible further from the poles` : 'active geomagnetic conditions'}.` };
    }
    if (/X-?Ray/i.test(head)) {
      const th = /exceeded\s+([MX]\d+)/i.exec(head), r = th ? rScale(classFlux(th[1])) : 0;
      return { ...base, kind: 'alert', scale: base.scale || (r ? 'R' + r : ''), until: at + 3 * HOUR,
        text: `A flare's X-rays passed ${th ? th[1].toUpperCase() : 'the alert level'} at ${hhmm(at)}${r ? `: ${R_NAME[r]} radio blackout (R${r}) on the sunlit side of Earth` : ''}.` };
    }
    if (/Type II Radio/i.test(head)) {
      const v = /(\d{3,5})\s*km\/s/.exec(f['estimate velocity'] || '');
      return { ...base, kind: 'alert', cme: true, until: at + 3 * HOUR,
        text: `Radio burst (type II) at ${hhmm(at)}: a shock leaving the Sun${v ? ` at about ${v[1]} km/s` : ''}, usually the front of a coronal mass ejection (CME).` };
    }
    if (/Type IV Radio/i.test(head)) return { ...base, kind: 'alert', cme: true, until: at + 3 * HOUR, text: `Radio burst (type IV) at ${hhmm(at)}: often comes with a big flare and a CME.` };
    if (/Electron/i.test(head)) return { ...base, kind: 'alert', until: issued + DAY, text: 'High-energy electrons around geostationary satellites are above the alert level: a hazard for satellites, harmless on the ground.' };
    if (/Proton/i.test(head)) return { ...base, kind: 'alert', until: issued + DAY, text: `A solar radiation storm${base.scale ? ` (${base.scale})` : ''}: protons from the Sun, a risk for satellites, polar flights and astronauts.` };
    if (/10cm Radio|Radio Emission/i.test(head)) return { ...base, kind: 'alert', until: at + 3 * HOUR, text: `A radio burst from the Sun at ${hhmm(at)}.` };
    return { ...base, kind: 'alert', until: at + 3 * HOUR, text: `${head} (${hhmm(at)}).` };
  }
  if (kind === 'SUMMARY') {
    const peak = swpcTime(f['maximum time']), at = fin(peak) ? peak : fin(swpcTime(f['observed'])) ? swpcTime(f['observed']) : fin(swpcTime(f['begin time'])) ? swpcTime(f['begin time']) : issued;
    const e = { ...base, kind: 'summary', until: at };
    if (/X-?ray Event/i.test(head)) {
      const cls = (f['xray class'] || '').toUpperCase(), r = rScale(classFlux(cls)), loc = f.location || '';
      e.scale = e.scale || (r ? 'R' + r : '');
      e.text = `Flare ${cls || 'event'} peaked at ${hhmm(at)}${loc ? ` (sunspot region at ${loc})` : ''}${r ? `: ${R_NAME[r]} radio blackout (R${r}) on the sunlit side` : ''}.`;
    } else if (/Sudden Impulse/i.test(head)) {
      const nt = /(\d+)\s*nT/.exec(f.deviation || '');
      e.text = `A solar-wind shock hit Earth's magnetic field at ${hhmm(at)}${nt ? ` (a ${nt[1]} nT jump)` : ''}.`;
    } else if (/10cm Radio Burst/i.test(head)) {
      const sfu = /(\d+)\s*sfu/.exec(f['peak flux'] || '');
      e.text = `A radio burst from the Sun at ${hhmm(at)}${sfu ? ` (${sfu[1]} sfu at 10.7 cm)` : ''}.`;
    } else if (/Proton/i.test(head)) e.text = `A solar radiation storm ended or peaked at ${hhmm(at)}${e.scale ? ` (${e.scale})` : ''}.`;
    else e.text = `${head} (${hhmm(at)}).`;
    return e;
  }
  return null;
}

// ---- the summary --------------------------------------------------------------------------------------------------

const src = (id, name, url, dataAt, o) => ({ id, name, url, licence: LICENCE, dataAt, fetchedAt: o.fetchedAt ?? null, cached: !!o.cached });
const mean = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN;

/**
 * "Sun now": the raw SWPC answers (any may be missing) → { wind, bz, flare, alerts, line, at } where each part is null or
 * carries `prov` (a provenance record from the feed's own time tags):
 *   wind  { speed, density, t, craft, text, arrivalMin, prov }
 *   bz    { now, bt, t, mean60, south (true when the last hour averages southward), min24, max24, series (last `sparkH`
 *           hours, 5-minute means: [{ t, bz }]), text, prov }
 *   flare { now: { cls, flux, t }, peak: { cls, flux, t } (the last 24 h, from the X-ray flux and/or the week's flare
 *           list `flares`), latest (SWPC's latest event: { cls, at,
 *           begin, end, ongoing }), text, prov }
 *   alerts { active: [...], recent: [...] }  each entry from parseAlerts with its own `prov`
 * `opts` = { now, fetchedAt, cached, sparkH }.
 */
export function sunNow({ mag, wind, xrays, flare, flares, alerts } = {}, opts = {}) {
  const now = opts.now ?? Date.now(), sparkH = opts.sparkH ?? 6, o = { fetchedAt: opts.fetchedAt, cached: opts.cached };
  const out = { wind: null, bz: null, flare: null, alerts: null, at: now };

  const W = parseWind(wind).filter(r => r.t <= now + 5 * MIN);
  if (W.length) {
    const last = W[W.length - 1], recent = W.filter(r => r.t > last.t - 10 * MIN);   // a 10-minute mean: single minutes jump
    const speed = mean(recent.map(r => r.speed)), dens = recent.map(r => r.density).filter(fin), density = dens.length ? mean(dens) : null, craft = CRAFT[last.source] || last.source || 'L1';
    out.wind = { speed: Math.round(speed), density: density == null ? null : Math.round(density * 10) / 10, t: last.t, craft, arrivalMin: Math.round(L1_KM / speed / 60), text: windWords(speed, density),
      prov: provenance([src('swpc-rtsw-plasma', `NOAA SWPC solar wind (${craft})`, PAGE.wind, last.t, o)], { now, maxAgeMs: SW_MAX_AGE.wind }) };
  }

  const M = parseMag(mag).filter(r => r.t <= now + 5 * MIN);
  if (M.length) {
    const last = M[M.length - 1], hour = M.filter(r => r.t > last.t - HOUR).map(r => r.bz), day = M.filter(r => r.t > last.t - DAY).map(r => r.bz);
    const recent = M.filter(r => r.t > last.t - 5 * MIN), bzNow = mean(recent.map(r => r.bz)), m60 = mean(hour), craft = CRAFT[last.source] || last.source || 'L1';
    const series = [], start = last.t - sparkH * HOUR;
    for (let b = Math.floor(start / (5 * MIN)) * 5 * MIN; b <= last.t; b += 5 * MIN) {
      const v = M.filter(r => r.t >= b && r.t < b + 5 * MIN).map(r => r.bz);
      if (v.length) series.push({ t: b + 2.5 * MIN, bz: Math.round(mean(v) * 10) / 10 });
    }
    const r1 = v => Math.round(v * 10) / 10;
    out.bz = { now: r1(bzNow), bt: last.bt, t: last.t, craft, mean60: r1(m60), south: m60 < -2, min24: r1(Math.min(...day)), max24: r1(Math.max(...day)), series,
      text: bzWords(bzNow) + (Math.sign(m60) === Math.sign(bzNow) && Math.abs(m60) > 2 ? `; ${m60 < 0 ? 'southward' : 'northward'} on average for the last hour (${m60 > 0 ? '+' : '−'}${Math.abs(m60).toFixed(1)} nT)` : ''),
      prov: provenance([src('swpc-rtsw-mag', `NOAA SWPC magnetic field (${craft})`, PAGE.wind, last.t, o)], { now, maxAgeMs: SW_MAX_AGE.mag }) };
  }

  const X = parseXrays(xrays).filter(r => r.t <= now + 5 * MIN);
  const F0 = Array.isArray(flare) && flare[0] && typeof flare[0] === 'object' ? flare[0] : null, F = F0 && !(swTime(F0.time_tag) > now + 5 * MIN) ? F0 : null;   // not from after `now`
  const FL = parseFlares(flares).filter(f => f.at > now - DAY && f.at <= now + 5 * MIN);
  if (X.length || F || FL.length) {
    const last = X[X.length - 1], day = X.filter(r => r.t > now - DAY), top = day.reduce((m, r) => (!m || r.flux > m.flux ? r : m), null);
    let latest = null;
    if (F) {
      const at = swTime(F.max_time), begin = swTime(F.begin_time), end = swTime(F.end_time), cls = String(F.max_class || '').toUpperCase();
      if (/^[ABCMX]\d/.test(cls)) latest = { cls, at: fin(at) ? at : null, begin: fin(begin) ? begin : null, end: fin(end) ? end : null, ongoing: !fin(end) };
    }
    const nowCls = last ? { cls: flareClass(last.flux), flux: last.flux, t: last.t } : F && /^[ABCMX]\d/.test(F.current_class || '') ? { cls: F.current_class, flux: classFlux(F.current_class), t: swTime(F.time_tag) } : null;
    let peak = top ? { cls: flareClass(top.flux), flux: top.flux, t: top.t } : null;
    for (const f of latest && latest.at ? [...FL, { ...latest, flux: classFlux(latest.cls) }] : FL) if (f.at > now - DAY && (!peak || f.flux > peak.flux)) peak = { cls: f.cls, flux: f.flux, t: f.at };
    const t = Math.max(nowCls && fin(nowCls.t) ? nowCls.t : -Infinity, F ? swTime(F.time_tag) || -Infinity : -Infinity);
    const sat = last && last.satellite != null ? `GOES-${last.satellite}` : F && F.satellite != null ? `GOES-${F.satellite}` : 'GOES';
    const bits = [];
    if (nowCls) bits.push(`X-rays now ${nowCls.cls} (${flareWords(nowCls.cls)})`);
    if (peak) bits.push(`the strongest in the last 24 h ${peak.cls} at ${hhmm(peak.t)}${rScale(peak.flux) ? ` (${flareWords(peak.cls)})` : ''}`);
    if (latest && latest.ongoing) bits.push(`a ${latest.cls} flare is still going`);
    out.flare = { now: nowCls, peak, latest, text: bits.join('; '),
      prov: provenance([src('swpc-goes-xrays', `NOAA SWPC X-rays (${sat})`, PAGE.xrays, fin(t) ? t : null, o)], { now, maxAgeMs: SW_MAX_AGE.xrays }) };
  }

  if (Array.isArray(alerts)) {
    const list = parseAlerts(alerts, { now }).map(e => ({ ...e,
      prov: provenance([src('swpc-alerts', 'NOAA SWPC alerts', PAGE.alerts, e.issued, o)], { now, maxAgeMs: e.active ? Math.max(e.until - e.issued, HOUR) : DAY }) }));
    out.alerts = { active: list.filter(e => e.active), recent: list.filter(e => !e.active) };
  }

  out.line = sunLine(out);
  return out;
}

/** One line for a dashboard: "Solar wind 548 km/s · Bz +2.9 nT northward · X-rays B7.2 now, C2.2 peak (24 h) · 1 warning". */
export function sunLine(s) {
  if (!s) return '';
  const bits = [];
  if (s.wind) bits.push(`Solar wind ${s.wind.speed} km/s`);
  if (s.bz) bits.push(`Bz ${s.bz.now > 0 ? '+' : s.bz.now < 0 ? '−' : ''}${Math.abs(s.bz.now).toFixed(1)} nT ${s.bz.now < -2 ? 'southward (aurora-friendly)' : s.bz.now > 2 ? 'northward' : 'near zero'}`);
  if (s.flare && s.flare.now) bits.push(`X-rays ${s.flare.now.cls} now${s.flare.peak && s.flare.peak.cls !== s.flare.now.cls ? `, ${s.flare.peak.cls} peak (24 h)` : ''}`);
  if (s.alerts) {
    const n = k => s.alerts.active.filter(e => e.kind === k).length, w = n('warning'), wa = n('watch'), al = n('alert');
    const parts = [wa && `${wa} storm watch${wa > 1 ? 'es' : ''}`, w && `${w} warning${w > 1 ? 's' : ''}`, al && `${al} alert${al > 1 ? 's' : ''}`].filter(Boolean);
    bits.push(parts.length ? parts.join(', ') + ' in force' : 'no SWPC warnings in force');
  }
  return bits.join(' · ');
}

/**
 * The Bz sparkline as SVG text: the last hours of 5-minute means, a zero line, southward (aurora-friendly) parts filled
 * in aurora green, northward faint. Accessible: a title and a description with the range and the latest value. Gaps over
 * 20 minutes break the line. Colours: `currentColor` and CSS variables, so it suits either theme.
 */
export function bzSpark(series, { w = 240, h = 46, id = 'bzs', title = 'Solar wind Bz, the last hours' } = {}) {
  const pts = (series || []).filter(p => p && fin(p.t) && fin(p.bz));
  if (pts.length < 2) return '';
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t, span = Math.max(1, t1 - t0), lim = Math.max(10, Math.ceil(Math.max(...pts.map(p => Math.abs(p.bz))) / 5) * 5);
  const X = t => ((t - t0) / span * (w - 2) + 1).toFixed(1), Y = v => (h / 2 - v / lim * (h / 2 - 2)).toFixed(1), y0 = Y(0);
  const runs = [[]];
  for (let i = 0; i < pts.length; i++) { if (i && pts[i].t - pts[i - 1].t > 20 * MIN) runs.push([]); runs[runs.length - 1].push(pts[i]); }
  const line = runs.filter(r => r.length).map(r => 'M' + r.map(p => `${X(p.t)},${Y(p.bz)}`).join('L')).join('');
  const fill = runs.filter(r => r.length > 1).map(r => `M${X(r[0].t)},${y0}L` + r.map(p => `${X(p.t)},${Y(Math.min(0, p.bz))}`).join('L') + `L${X(r[r.length - 1].t)},${y0}Z`).join('');
  const min = Math.min(...pts.map(p => p.bz)), max = Math.max(...pts.map(p => p.bz)), last = pts[pts.length - 1];
  const desc = `From ${hhmm(t0)} to ${hhmm(t1)}: Bz between ${min.toFixed(1)} and ${max.toFixed(1)} nT, latest ${last.bz.toFixed(1)} nT. Below the line is southward (aurora-friendly).`;
  return `<svg class="sw-spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" style="max-width:100%;height:auto" role="img" aria-labelledby="${esc(id)}t ${esc(id)}d" preserveAspectRatio="none">` +
    `<title id="${esc(id)}t">${esc(title)}</title><desc id="${esc(id)}d">${esc(desc)}</desc>` +
    `<path d="${fill}" fill="#7dffa6" fill-opacity=".35"/>` +
    `<line x1="0" x2="${w}" y1="${y0}" y2="${y0}" stroke="currentColor" stroke-opacity=".35" stroke-dasharray="3 3"/>` +
    `<path d="${line}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>` +
    `<text x="2" y="9" font-size="8" fill="currentColor" fill-opacity=".6">+${lim}</text><text x="2" y="${h - 2}" font-size="8" fill="currentColor" fill-opacity=".6">−${lim} nT</text></svg>`;
}
