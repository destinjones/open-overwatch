// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// tonight.html: the Tonight card without the 3D globe, for a fast first answer on a phone. It loads only what the card
// reads: three satellite groups (stations, the brightest, Starlink) through the shared TLE source, NOAA's aurora grid,
// the launch list, the country borders for "the ISS is over ...", and the eclipse tables. Eclipses turn the Sun and Moon
// into the Earth-fixed frame with core/eclipselocal.js's precession, nutation and sidereal time (the same turn as the
// sky positions in core/sky.js; the globe uses Cesium's full IAU rotation): plenty for "how much of the Sun from here".
import { $, getText, bigStore, ON_SITE } from '../globe/env.js';
import { Tonight } from '../globe/tonight.js';
import { createTleSource, parseTle } from '../core/tle.js';
import { fetchAsset } from '../core/assets.js';
import { fromLL2, upcoming } from '../core/launches.js';
import { prepare, countryAt } from '../core/borders.js';
import { seenFrom } from '../core/eclipse.js';
import { observer } from '../core/observer.js';
import { icrfToFixed } from '../core/eclipselocal.js';
import { msFromJd } from '../core/time.js';

const sats = { list: [], byId: new Map() };
const tles = createTleSource({ fetchText: (url, o) => getText(url, o), cache: bigStore, onSite: ON_SITE });
sats.ready = Promise.all(['stations', 'visual', 'starlink'].map(async g => {   // the three groups in parallel: one round trip, not three
  try { for (const t of parseTle((await tles.load(g)).txt)) if (!sats.byId.has(t.id)) { const s = { kind: 'sat', ...t, layer: g }; sats.list.push(s); sats.byId.set(t.id, s); } }
  catch (e) { console.warn('satellites', g, e.message); }
}));

let aurora = null;
const auroraGrid = async () => {
  if (!aurora || Date.now() - aurora.at > 10 * 60e3) { const r = await fetch('https://services.swpc.noaa.gov/json/ovation_aurora_latest.json'); if (!r.ok) throw new Error('HTTP ' + r.status); aurora = { at: Date.now(), d: await r.json() }; }
  return aurora.d;
};
let borders = null;
const countryName = async (lon, lat) => {
  if (!borders) borders = Promise.all([fetchAsset('data/borders.json', 'json'), fetchAsset('data/countries.json', 'json')]).then(([b, c]) => ({ b: prepare(b), facts: c.countries })).catch(e => { borders = null; throw e; });   // retried next time
  const { b, facts } = await borders, k = countryAt(b, lon, lat);
  return k ? (facts[k.iso] && facts[k.iso].name) || k.name : null;
};
let launchList = null;
const launches = () => launchList || (launchList = (async () => {
  let d = await fetchAsset('data/launches.json', 'json').catch(() => null);
  const stale = d && d.results && (!d.t || Date.now() - d.t > 36 * 3600e3);   // the site copy is rebuilt every 6 h
  if (!d || !d.results || stale) {
    try { const r = await fetch('https://ll.thespacedevs.com/2.3.0/launches/upcoming/?limit=30&mode=normal&hide_recent_previous=true'); if (!r.ok) throw new Error('HTTP ' + r.status); d = await r.json(); }
    catch (e) { if (!stale) throw e; }
  }
  return upcoming((d.results || []).map(fromLL2).filter(Boolean), Date.now());
})().catch(e => { launchList = null; throw e; }));

/** The next eclipse (2027-2030) visible from lat/lon: { e, covered, kind, at } or null. */
async function nextEclipse(lat, lon) {
  const list = (await fetchAsset('data/eclipses.json', 'json')).eclipses, here = observer(lat, lon).pos, now = Date.now();
  const fix = (M, r) => { const [x, y, z] = M.map(m => m[0] * r[0] + m[1] * r[1] + m[2] * r[2]); return { x, y, z }; };
  for (const e of list.filter(e => msFromJd(e.jd0 + e.sun.length / 1440) > now)) {
    let best = { covered: 0 };
    for (let m = 0; m < e.sun.length; m++) { const M = icrfToFixed(e.jd0 + m / 1440), w = seenFrom(fix(M, e.sun[m]), fix(M, e.moon[m]), here); if (w.sunUp && w.covered > best.covered) best = { ...w, m }; }
    if (best.covered > 0.005) return { e, ...best, at: msFromJd(e.jd0 + best.m / 1440) };
  }
  return null;
}

Tonight.use({
  sats, auroraGrid, countryName, launches,
  showLaunch: l => { location.href = 'globe.html#go=launches&id=' + encodeURIComponent(l.id); },
  nextEclipse, watchEclipse: e => { location.href = 'globe.html#go=eclipses&id=' + encodeURIComponent(e.date); },
});
Tonight.open();
Tonight.peek().catch(() => {});
window.OOSKY = { Tonight, sats };
