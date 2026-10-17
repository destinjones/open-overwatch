// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// "Tonight above you": what is in your own sky over the next 24 hours, in plain words. The space stations and Hubble
// when they pass in sunlight against a dark sky, Starlink launches still flying as a train, the brightest other
// satellites when they climb high, the bright planets, the Moon's phase and the aurora chance where you stand. Each
// pass can become a calendar reminder (works with the site closed) or a notification (while the page is open).
// Your location is used here and saved only on this device (rounded to ~1 km), so the next visit can say it straight away.
// Or a place typed in (only the words go to Photon, the site's geocoder), or one from a link (#at=lat,lon&name=, never saved).
import { $, esc, toast, store } from './env.js';
import { photon, PHOTON_CREDIT } from './geocode.js';
import { tonightHash, tonightHeadings, placeName } from '../core/viewlink.js';
import { state, hooks } from './state.js';
import { Alerts } from './alerts.js';
import { observer, sunEcef } from '../core/observer.js';
import { findPasses, compass, ecfAt } from '../core/passes.js';
import { showersFor } from '../core/meteors.js';
import { Crew } from './crew.js';
import { oceanAt } from '../core/explain.js';
import { haversine } from '../core/geo.js';
import { planetsTonight, darkWindow, moonPhase, auroraAt, describePass, starlinkTrains, sunAlt, riseSet, nextFullMoon, craftAt, meetings } from '../core/sky.js';
import { fetchAsset } from '../core/assets.js';
import { SunNow, sunTonightHtml } from './sunnow.js';
import { DarkSky, yourSkyHtml, deepSkyHtml, deepSkyFor } from './darksky.js';
import { moonOver, tonightQuality } from '../core/darksky.js';
import { hoursOf, cloudAt, night, sky as skyWord } from '../core/clouds.js';
import { earthPosition } from '../core/planets.js';
import { jdFromMs } from '../core/time.js';

const HOUR = 3600e3, DAY = 24 * HOUR;
const MAIN = [['25544', 'ISS (International Space Station)', 'ISS'], ['48274', "Tiangong (China's space station)", 'Tiangong'], ['20580', 'Hubble Space Telescope', 'Hubble']];
const time = ms => {
  const d = new Date(ms), t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === new Date().toDateString()) return t;
  return d.toLocaleDateString([], Math.abs(ms - Date.now()) > 6 * 86400e3 ? { day: 'numeric', month: 'short' } : { weekday: 'short' }) + ' ' + t;   // a weekday alone would read as this week
};
const samePlace = (a, b) => !!(a && b && Math.abs(a.lat - b.lat) < 0.05 && Math.abs(a.lon - b.lon) < 0.05);
// the selected object's orbit line / country outline go with its card (the globe's ui.js owns them; tonight.html has none)
const deselect = () => { if (hooks.clearSelection) hooks.clearSelection(); else state.selected = null; };
// catalogue names, made readable: "SL-16 R/B" is the spent upper stage of a Zenit rocket, bright because it is big
const friendly = n => / R\/B$/.test(n) ? `${n.replace(/ R\/B$/, '')} rocket stage` : / DEB$/.test(n) ? `${n.replace(/ DEB$/, '')} debris` : n;
const breathe = () => new Promise(r => setTimeout(r, 0));

const home = {
  get: () => { const h = store.get('home', null); return h && Number.isFinite(h.lat) && Number.isFinite(h.lon) ? { lat: h.lat, lon: h.lon, ...(placeName(h.name) ? { name: placeName(h.name) } : {}) } : null; },
  set: (lat, lon, name) => { const h = { lat: +lat.toFixed(2), lon: +lon.toFixed(2), ...(placeName(name) ? { name: placeName(name) } : {}) }; store.set('home', h); return h; },   // works even when storage is blocked
  forget: () => { try { localStorage.removeItem('oo3d.home'); localStorage.removeItem('oo3d.auroraWatch'); } catch (e) { /* private mode */ } },
};
const locate = () => new Promise(res => {
  if (!navigator.geolocation) return res(null);
  navigator.geolocation.getCurrentPosition(p => res(p.coords), () => res(null), { timeout: 10000, maximumAge: 600e3 });
});
async function satsReady(ms = 40e3) {
  const t0 = Date.now();
  if (D.sats.ready) await Promise.race([D.sats.ready, new Promise(r => setTimeout(r, ms))]);   // a page that says when all groups are in
  while (!(D.sats.list.length && window.satellite) && Date.now() - t0 < ms) await new Promise(r => setTimeout(r, 400));
  return D.sats.list.length > 0 && !!window.satellite;
}

/** Passes of one satellite (Sats entry) over the observer between t0 and t1. */
function passesOf(s, obs, t0, t1, step = 30e3) {
  const sl = window.satellite, rec = s.rec || (s.rec = sl.twoline2satrec(s.l1, s.l2));
  return findPasses(ecfAt(sl, rec), obs, t0, t1, { step, sunAt: sunEcef });
}

const S = { open: false, run: 0, loc: null, passes: [], aurora: null, iss: '', launches: [], far: [], hours: null, hoursLoc: null, passLoc: null, cloudErr: '', satErr: '', dark: null, darkErr: false, cat: null, catErr: false, dsMore: false };
// "tonight" = the dark part of the next 24 h; opened in the small hours, a stretch ending within 2 h gives way to the coming night
const NIGHT = { minLeft: 2 * HOUR };
// cloud forecast: Open-Meteo (CC BY 4.0, free, no key, sends CORS), for a point rounded to 0.1 deg (~10 km), cached an hour
const forecasts = new Map();
async function forecast(lat, lon) {
  const la = lat.toFixed(1), lo = lon.toFixed(1), k = la + ',' + lo, hit = forecasts.get(k);
  if (hit && Date.now() - hit.at < 3600e3) return hit.hours;
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${la}&longitude=${lo}&hourly=cloud_cover,precipitation_probability&forecast_days=4&timezone=GMT&timeformat=unixtime`);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const hours = hoursOf(await r.json()); forecasts.set(k, { at: Date.now(), hours }); return hours;
}
/** Tonight's clouds in words, and the next clear night if tonight isn't. */
function cloudText(lat, lon, now) {
  const H = S.hours; if (!H || !H.length) return null;
  const win = darkWindow(lat, lon, now, NIGHT); if (!win) return null;
  const n = night(H, Math.max(win.start, now), win.end, { time }); if (!n) return null;
  let next = '';
  if (!n.clear.length) for (let d = 1; d <= 3 && !next; d++) {
    const w = darkWindow(lat, lon, win.end + (d - 1) * DAY + 6 * HOUR); if (!w) break;
    const m = night(H, w.start, w.end, { time }); if (m && m.clear.length) next = `Next clear spell: ${new Date(w.start).toLocaleDateString([], { weekday: 'long' })} night from ${time(m.clear[0].from)}.`;   // the night is named for its evening
  }
  return { ...n, next };
}
const day = ms => { const d = new Date(ms), t = new Date(); return d.toDateString() === t.toDateString() ? 'today' : d.toDateString() === new Date(t.getTime() + DAY).toDateString() ? 'tomorrow' : d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' }); };

/** The Sun and Moon over the next day, in words. */
function sunMoon(lat, lon, now) {
  const sun = riseSet('sun', lat, lon, now), dusk = riseSet('sun', lat, lon, now, { h0: -6 }), dark = riseSet('sun', lat, lon, now, { h0: -18 }), moon = riseSet('moon', lat, lon, now, { h0: 0.125 });
  const sunText = sun.up === true ? 'The Sun stays up all day and night here (midnight Sun).' : sun.up === false ? 'The Sun stays down all day here (polar night).'
    : [sun.set && `Sunset ${time(sun.set)}`, dusk.set && `dark enough for satellites ${time(dusk.set)}`, dark.set ? `fully dark ${time(dark.set)}` : dark.up === false ? 'fully dark all night' : dark.rise && sunAlt(lat, lon, now) < -18 ? `fully dark now, until ${time(dark.rise)}` : 'never fully dark tonight (summer twilight)', sun.rise && `sunrise ${time(sun.rise)}`].filter(Boolean).join(' · ');
  const moonText = moon.up === true ? 'up all day and night' : moon.up === false ? 'below the horizon all day' : [moon.rise && `rises ${time(moon.rise)}`, moon.set && `sets ${time(moon.set)}`].filter(Boolean).join(' · ');
  const fm = nextFullMoon(now);
  return { sunText, moonText, full: `Next full Moon: ${day(fm.at)}, ${new Date(fm.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · the ${fm.name}${fm.supermoon ? ' (a supermoon: ' + Math.round(fm.km).toLocaleString('en-US') + ' km away, extra big and bright)' : ''}` };
}
const SILENT = { 'Pioneer 10': 2003, 'Pioneer 11': 1995 };   // last contact
/** The farthest things we built: distance from Earth now, and how long their radio signals take to arrive. */
async function farthest(now) {
  const all = await fetchAsset('data/solar/spacecraft.json', 'json'), jd = jdFromMs(now), E = earthPosition(jd), AU = 149597870.7;
  return all.map(c => { const p = craftAt(c, jd); if (!p) return null; const au = Math.hypot(p.x - E.x, p.y - E.y, p.z - E.z), s = au * 499.004784;
    const mm = Math.round(s / 60), h = Math.floor(mm / 60), m = mm % 60, km = au * AU;
    return { name: c.name, au, text: `${c.name}: ${km > 1e9 ? (km / 1e9).toFixed(1) + ' billion' : Math.round(km / 1e6) + ' million'} km away (${au.toFixed(au < 10 ? 2 : 0)} AU). ${SILENT[c.name] ? `Silent since ${SILENT[c.name]}; a signal from there would take ${h ? h + ' h ' : ''}${m} min.` : `Its radio signal takes ${h ? h + ' h ' : ''}${m} min to reach us.`}` }; })
    .filter(Boolean).sort((a, b) => b.au - a.au).slice(0, 4);
}
const bearing = (la1, lo1, la2, lo2) => { const r = Math.PI / 180, y = Math.sin((lo2 - lo1) * r) * Math.cos(la2 * r), x = Math.cos(la1 * r) * Math.sin(la2 * r) - Math.sin(la1 * r) * Math.cos(la2 * r) * Math.cos((lo2 - lo1) * r); return (Math.atan2(y, x) / r + 360) % 360; };

/** Where the ISS is right now, in words. */
async function issNow() {
  const s = D.sats.byId.get('25544'), sl = window.satellite; if (!s || !sl) return '';
  const rec = s.rec || (s.rec = sl.twoline2satrec(s.l1, s.l2)), d = new Date(), pv = sl.propagate(rec, d); if (!pv.position) return '';
  const g = sl.eciToGeodetic(pv.position, sl.gstime(d)), lat = sl.degreesLat(g.latitude), lon = sl.degreesLong(g.longitude);
  const k = await D.countryName(lon, lat).catch(() => undefined);   // null = at sea, undefined = the lookup failed
  const where = k === undefined ? `${Math.abs(lat).toFixed(0)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(0)}°${lon >= 0 ? 'E' : 'W'}` : k || oceanAt(lat, lon);
  return `Right now the ISS is over ${where}, ${Math.round(g.height)} km up, doing 28,000 km/h (a lap of the Earth every 92 minutes).`;
}
/** The next launch anywhere, and any in the next week close enough to see from here (a plume shows ~1,000 km away at dusk or night). */
async function launchesNear(loc) {
  const list = await D.launches(); const now = Date.now(), out = [];
  const precise = l => ['SEC', 'MIN', 'HR', ''].includes(String(l.precision).toUpperCase()) && l.net > now;
  const next = list.find(precise);
  for (const l of list.filter(l => precise(l) && l.net < now + 7 * DAY)) {
    const km = haversine(loc.lat, loc.lon, l.lat, l.lon) / 1000; if (km > 1000) continue;
    const dark = sunAlt(loc.lat, loc.lon, l.net) < -4, dir = compass(bearing(loc.lat, loc.lon, l.lat, l.lon));
    out.push({ l, text: `${l.rocket} from ${l.place || l.pad}, ${time(l.net)}: ${Math.round(km)} km from you, toward the ${dir}. ${km < 150 ? 'Close enough to hear it.' : ''} ${dark ? 'After dark or at dusk, so watch for the plume rising and the bright exhaust.' : 'In daylight, so it\'s hard to see unless you are close.'}` });
  }
  if (next && !out.some(x => x.l === next)) out.push({ l: next, text: `Next launch anywhere: ${next.rocket} (${next.provider}), ${time(next.net)} from ${next.place || next.pad}.` });
  return out;
}

function card(html) { const c = $('#card'); deselect(); c.innerHTML = `<button class="x" aria-label="Close">×</button><div data-tn hidden></div>${html}`; c.classList.add('show'); c.querySelector('.x').onclick = () => Tonight.close(); fold(c); return c; }
// sections fold: tap a heading to hide what's under it (remembered on this device)
const SHUT = new Set((v => Array.isArray(v) ? v.filter(x => typeof x === 'string') : ['Farthest from home'])(store.get('tnShut', null)));   // garbage in storage must not throw at module load
// an embed (tonight.html#embed=1&sections=...) opens only its chosen sections, and remembers taps for this visit only
const tapped = new Map();
function fold(c) {
  const only = D && D.embed && D.embed.sections ? tonightHeadings(D.embed.sections) : null;
  for (const h of c.querySelectorAll('h3')) {
    const name = h.firstChild ? h.firstChild.textContent.trim() : '', body = [];
    for (let n = h.nextElementSibling; n && n.tagName !== 'H3' && !n.classList.contains('acts') && !(n.tagName === 'P' && n.classList.contains('note')); n = n.nextElementSibling) body.push(n);
    if (!body.length) continue;
    const set = shut => { h.classList.toggle('shut', shut); h.setAttribute('aria-expanded', String(!shut)); for (const n of body) n.hidden = shut; };
    h.tabIndex = 0; h.setAttribute('role', 'button'); h.classList.add('fold'); set(only ? (tapped.has(name) ? tapped.get(name) : !only.has(name)) : SHUT.has(name));
    h.onclick = h.onkeydown = e => { if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return; e.preventDefault(); const shut = !h.classList.contains('shut'); set(shut);
      if (only) { tapped.set(name, shut); return; }
      shut ? SHUT.add(name) : SHUT.delete(name); store.set('tnShut', [...SHUT]); };
  }
}

function intro(msg = '') {
  S.run++; S.loc = null; clearTimeout(pending); pending = 0;   // a place's feeds still landing must not redraw over the place box
  const c = card(`<div class="k" style="--c:#7dffa6">Your sky</div><h2>Tonight above you</h2>
    <p class="note">The space station, Starlink trains, bright planets, the Moon and the aurora chance where you are, in plain words, with reminders.</p>
    ${msg ? `<p class="note warn">${esc(msg)}</p>` : ''}
    <div class="acts"><button class="chipbtn" id="tnLoc" style="color:#7dffa6">Use my location</button><button class="chipbtn" id="tnGreen">Try Greenwich</button></div>
    <form id="tnFind" role="search" style="margin-top:12px"><label for="tnQ" class="note" style="display:block;margin:0 2px 6px">Or another place: a town, an airport, an address</label>
      <span style="display:flex;gap:6px"><input id="tnQ" type="search" maxlength="80" autocomplete="off" enterkeyhint="search" style="flex:1;min-width:0;min-height:40px;padding:8px 10px;border-radius:9px;border:1px solid rgba(230,237,243,.16);background:rgba(230,237,243,.05);color:inherit;font:inherit"><button class="chipbtn" type="submit">Find</button></span></form>
    <div class="tn-list" id="tnHits" style="margin-top:6px"></div>
    <p class="note">Your location is used on this device only (saved rounded to about 1 km, so the next visit can tell you straight away). A place you type is looked up by Photon (komoot): only the words you type are sent, and the place you pick is saved on this device the same way. The cloud forecast is asked for a point rounded to about 10 km (Open-Meteo); nothing else leaves this device. <small>${esc(PHOTON_CREDIT)}</small></p>`);
  const hits = c.querySelector('#tnHits');
  c.querySelector('#tnFind').onsubmit = async e => {
    e.preventDefault();
    const q = c.querySelector('#tnQ').value.trim(); if (!q) return;
    hits.innerHTML = '<p class="note">Looking…</p>';
    const list = await photon(q, 5).catch(() => null);
    if (!c.contains(hits)) return;   // the card moved on meanwhile
    if (!list) { hits.innerHTML = '<p class="note warn">The place search (Photon) is unreachable right now. Try again in a moment.</p>'; return; }
    if (!list.length) { hits.innerHTML = `<p class="note">No place found for “${esc(q)}”.</p>`; return; }
    hits.innerHTML = list.map((pl, i) => `<button class="tn-row" data-pl="${i}" style="text-align:left;cursor:pointer;color:inherit;font:inherit"><span><b>${esc(pl.name)}</b>${pl.sub ? ` <small style="color:var(--faint,#738599)">${esc(pl.sub)}</small>` : ''}</span></button>`).join('');
    hits.querySelectorAll('[data-pl]').forEach(b => { b.onclick = () => { const pl = list[+b.dataset.pl]; show(home.set(pl.lat, pl.lon, pl.name)); }; });
  };
  c.querySelector('#tnLoc').onclick = async () => {
    c.querySelector('#tnLoc').textContent = 'Finding you…';
    const p = await locate(), mine = c.classList.contains('show') && c.querySelector('#tnLoc');   // closed or replaced while the permission prompt was up: stay quiet
    if (p) home.set(p.latitude, p.longitude);
    if (!mine) return;
    if (!p) return intro('Location was refused or unavailable. You can try Greenwich instead, or allow location for this site.');
    show(home.get() || home.set(p.latitude, p.longitude));
  };
  c.querySelector('#tnGreen').onclick = () => show({ lat: 51.48, lon: 0, demo: true });
}

const passRow = (p, i) => `<div class="tn-row"><span>${esc(describePass(p.name, p, { time }))}${S.hours && samePlace(S.hoursLoc, S.passLoc) && cloudAt(S.hours, p.rise) != null ? ` <b class="${cloudAt(S.hours, p.rise) < 45 ? 'ok' : 'cl'}">· ${esc(skyWord(cloudAt(S.hours, p.rise)))}</b>` : ''}</span><span class="tn-b"><button class="chipbtn" data-rem="${i}" title="A notification 10 minutes before, while this page is open">Remind me</button><button class="chipbtn" data-cal="${i}" title="A calendar event with a reminder: works with the site closed">Calendar</button></span></div>`;

// the ten or so feeds land within a second or two of each other: one redraw 80 ms after the last arrival, not one each
let pending = 0;
function render(initial = false) {
  if (initial) { clearTimeout(pending); pending = 0; return draw(true); }
  if (!pending) pending = setTimeout(() => { pending = 0; draw(false); }, 80);
}
function draw(initial) {
  if (!S.open || !S.loc) return;
  const cur = $('#card');   // closed, or replaced by another card (Esc, a click on the globe): stop updating it
  if (!initial && !(cur.classList.contains('show') && cur.querySelector('[data-tn]'))) { S.open = false; S.run++; return; }
  const scrolls = [cur.scrollTop, ...[...cur.querySelectorAll('.tn-list')].map(el => el.scrollTop)];   // a redraw must not throw away where the reader had scrolled to
  const { lat, lon, demo, name, shared } = S.loc, embed = !!(D && D.embed), now = Date.now(), list = S.passes.filter(p => p.set > now).sort((a, b) => a.rise - b.rise);
  const mk = `${lat},${lon},${Math.floor(now / 60e3)}`;   // the sky maths (~5 ms) is the same within a minute
  if (!S.memo || S.memo.key !== mk) S.memo = { key: mk, planets: planetsTonight(lat, lon, now, { time, ...NIGHT }), sm: sunMoon(lat, lon, now), showers: showersFor(lat, lon, now, { time, ...NIGHT }).filter(m => m.days > -2 || m.rate >= 3), moon: (w => w && moonOver(lat, lon, w))(darkWindow(lat, lon, now, NIGHT)) };
  const { planets, sm, showers } = S.memo, up = planets.filter(p => p.up), moon = moonPhase(now);
  const first = list.find(p => p.visible), sky = sunAlt(lat, lon, now);
  const cl = cloudText(lat, lon, now);
  // your sky and the deep-sky list (globe/darksky.js): the site's sky, the Moon and the clouds in one line; the list under the sky you'll really have
  const q = tonightQuality({ sky: S.dark && S.dark.sky, moon: S.memo.moon, clouds: cl, time }), gear = DarkSky.gear();
  const dk = `${lat},${lon},${gear},${Math.floor(now / 600e3)},${!!S.cat},${S.dark ? q.sqm.toFixed(1) : '-'}`;
  if (S.cat && S.dark && (!S.ds || S.ds.key !== dk)) S.ds = { key: dk, list: deepSkyFor(S.cat, lat, lon, now, { gear, sqm: S.dark.sky ? q.sqm : 21.5, time, minLeft: NIGHT.minLeft }) };
  const soon = (S.meet && S.meetAt > now - 3600e3 ? S.meet : (S.meetAt = now, S.meet = meetings(now, { days: 30 }))).filter(m => m.elong >= 15).slice(0, 5)
    .map(m => `${new Date(m.at).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}: ${m.ka === 'moon' ? `the Moon passes ${m.sep.toFixed(1)}° from ${m.b}` : `${m.a} and ${m.b} just ${m.sep.toFixed(1)}° apart`}${m.elong < 30 ? ' (low, in twilight)' : ''}. ${m.sep < 1 ? 'They\'ll fit in the same binocular view.' : 'A pretty pair to the eye.'}`);
  const head = [first ? `Next to see: <b>${esc(first.short)} at ${esc(time(first.rise))}</b>, look ${esc(compass(first.azRise))}.` : S.computing ? 'Working out the passes…' : S.satErr ? `<b class="cl">${esc(S.satErr)}</b>` : 'No bright satellite passes in a dark sky in the next 24 hours.',
    up.length ? `${esc(up.map(p => p.name).join(', '))} ${up.length > 1 ? 'are' : 'is'} up tonight.` : '',
    cl ? (/all night/.test(cl.text) && cl.clear.length ? '<b>Clear skies tonight.</b>' : cl.clear.length ? `<b>Clear from ${esc(time(cl.clear[0].from))} to ${esc(time(cl.clear[0].to))}.</b>` : `<b class="cl">${cl.mean >= 75 ? 'Cloudy tonight.' : 'Patchy cloud tonight.'}</b>`) : '',
    S.aurora && S.aurora.level >= 2 ? `<b class="ok">${esc(S.aurora.text)}</b>` : ''].filter(Boolean).join(' ');
  const watching = !!store.get('auroraWatch', null);
  S.summary = [`Tonight's sky${demo ? ' over Greenwich' : name ? ' over ' + name : ''}:`, first ? `${first.short} at ${time(first.rise)}, look ${compass(first.azRise)}` : '', cl ? (cl.clear.length ? `clear ${time(cl.clear[0].from)} to ${time(cl.clear[0].to)}` : `cloudy (${cl.mean}%)`) : '',
    up.length ? `${up.map(p => p.name).join(', ')} up` : '', S.dark && S.dark.sky ? `Bortle ${S.dark.sky.bortle} sky, ${q.word} for stars` : '', `Moon ${Math.round(moon.lit * 100)}% lit`, S.aurora && S.aurora.level >= 2 ? S.aurora.text : ''].filter(Boolean).join(' · ');
  const where = demo ? 'Greenwich, London (example)' : `${name ? esc(name) : shared ? 'The sky here' : 'Your sky'} ·${lat.toFixed(2)}, ${lon.toFixed(2)} · ${shared ? (embed ? 'Open Overwatch' : 'from a link, not saved') : 'saved on this device'}`;
  const c = card(`<div class="k" style="--c:#7dffa6">${where}</div><h2>${shared && name ? `Tonight over ${esc(name)}` : 'Tonight above you'}</h2>
    <p class="tn-head">${head}</p>
    ${S.iss ? `<p class="tn-p" style="margin-top:6px">${esc(S.iss)}${S.crew ? ` ${esc(S.crew)} <a href="#" id="tnCrew">Who?</a>` : ''}</p>` : ''}
    <h3>Clouds tonight</h3><p class="tn-p">${cl ? esc(cl.text) + (cl.next ? ' ' + esc(cl.next) : '') : S.cloudErr ? esc(S.cloudErr) : S.hours ? 'No dark sky to forecast.' : 'Checking the cloud forecast…'} <small>Forecast: Open-Meteo.com (CC BY 4.0)</small></p>
    ${yourSkyHtml(S.dark, q, S.darkErr)}
    <h3>Satellites you can see${S.computing ? ' <small>· still searching…</small>' : ''}</h3>
    <div class="tn-list">${list.filter(p => p.visible).map(p => passRow(p, S.passes.indexOf(p))).join('') || (S.satErr ? `<p class="note warn">${esc(S.satErr)} <button class="chipbtn" id="tnRetry">Try again</button></p>` : S.computing ? '' : '<p class="note">None in sunlight against a dark sky in the next 24 hours. Passes in daylight happen, but you can\'t see them.</p>')}</div>
    <h3>Planets</h3><div class="tn-list">${planets.map(p => `<div class="tn-row${p.up ? '' : ' dim'}"><span>${esc(p.text)}</span></div>`).join('')}</div>
    ${deepSkyHtml(S.ds && S.ds.list, { gear, sqm: S.dark && S.dark.sky ? q.sqm : null, err: S.catErr || S.darkErr, loading: !(S.cat && S.dark), more: S.dsMore, canFind: !!D.lookUp })}
    ${showers.length ? `<h3>Meteor showers</h3><div class="tn-list">${showers.map((m, i) => `<div class="tn-row"><span>${esc(m.text)}</span>${m.radiantAlt >= 10 && m.nights >= 1 ? `<span class="tn-b"><button class="chipbtn" data-met="${i}" title="A calendar event for the best time on the peak night">Calendar</button></span>` : ''}</div>`).join('')}</div>` : ''}
    ${S.launches.length ? `<h3>Rocket launches</h3><div class="tn-list">${S.launches.map((x, i) => `<div class="tn-row"><span>${esc(x.text)}</span><span class="tn-b"><button class="chipbtn" data-lch="${i}">Details</button></span></div>`).join('')}</div>` : ''}
    <h3>Sun</h3><p class="tn-p">${esc(sm.sunText)}</p>
    <h3>Moon</h3><p class="tn-p">${esc(moon.name)} · ${Math.round(moon.lit * 100)}% lit · ${esc(sm.moonText)}${sky > 0 ? ' · it is daytime here now' : ''}<br><small>${esc(sm.full)}</small></p>
    <h3>Aurora</h3><p class="tn-p">${S.aurora ? esc(S.aurora.text) + (S.aurora.err ? '' : ` <small>(NOAA OVATION: ${S.aurora.overhead}% overhead)</small>`) : 'Checking NOAA\'s aurora forecast…'}</p>
    ${embed ? '' : `<div class="acts"><button class="chipbtn" id="tnAur">${watching ? 'Stop aurora alerts' : 'Alert me if aurora gets likely'}</button></div>`}
    ${sunTonightHtml(S.sun, S.sunErr)}
    ${soon.length ? `<h3>Coming up in the sky</h3><div class="tn-list">${soon.map(t => `<div class="tn-row"><span>${esc(t)}</span></div>`).join('')}</div>` : ''}
    ${S.ecl ? `<h3>Next solar eclipse you can see</h3><div class="tn-list"><div class="tn-row"><span>${esc(new Date(S.ecl.at).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}, ${esc(new Date(S.ecl.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))}: ${S.ecl.kind === 'total' ? '<b class="ok">TOTAL</b> from here' : S.ecl.kind === 'annular' ? 'a ring of fire from here' : `the Moon covers ${Math.round(S.ecl.covered * 100)}% of the Sun from here`}${S.ecl.e.type === 'total' && S.ecl.kind !== 'total' ? ' (totality elsewhere)' : ''}. Never look at the Sun without eclipse glasses.</span>${D.watchEclipse ? '<span class="tn-b"><button class="chipbtn" id="tnEcl">Watch the shadow</button></span>' : ''}</div></div>` : S.ecl === false ? '<h3>Solar eclipses</h3><p class="tn-p">None visible from here in 2027–2030.</p>' : ''}
    ${S.far.length ? `<h3>Farthest from home</h3><div class="tn-list">${S.far.map(f => `<div class="tn-row"><span>${esc(f.text)}</span></div>`).join('')}</div>` : ''}
    ${embed ? '' : `<div class="acts">${D.lookUp ? '<button class="chipbtn" id="tnLook" style="color:#7dffa6">Look up</button>' : ''}<button class="chipbtn" id="tnShare">Share tonight</button>${demo || shared ? '<button class="chipbtn" id="tnLoc">Use my location</button>' : '<button class="chipbtn" id="tnForget">Forget my location</button>'}<button class="chipbtn" id="tnOther">Another place</button></div>`}
    <p class="note">Times are yours (${esc(Intl.DateTimeFormat().resolvedOptions().timeZone || 'local')}). "Calendar" adds an event that reminds you 10 minutes before, even with this site closed. "Remind me" and aurora alerts work while this page is open in a tab.</p>`);
  [c, ...c.querySelectorAll('.tn-list')].forEach((el, i) => { if (scrolls[i]) el.scrollTop = scrolls[i]; });
  bindPasses(c);
  c.querySelectorAll('[data-gear]').forEach(b => { b.onclick = () => { store.set('dsGear', b.dataset.gear); render(true); }; });
  if (c.querySelector('#dsMore')) c.querySelector('#dsMore').onclick = () => { S.dsMore = !S.dsMore; render(true); };
  c.querySelectorAll('[data-dso]').forEach(b => { b.onclick = () => { const v = S.ds.list[+b.dataset.dso]; Tonight.close(); D.lookUp({ name: v.label, ra: v.obj.ra, dec: v.obj.dec, text: v.text }); }; });
  if (c.querySelector('#tnRetry')) c.querySelector('#tnRetry').onclick = () => show(S.loc);
  if (c.querySelector('#tnCrew')) c.querySelector('#tnCrew').onclick = e => { e.preventDefault(); S.open = false; Crew.open({ back: () => Tonight.reopen() }); };
  if (c.querySelector('#tnEcl')) c.querySelector('#tnEcl').onclick = () => { S.open = false; D.watchEclipse(S.ecl.e); };
  c.querySelectorAll('[data-lch]').forEach(b => { b.onclick = () => { S.open = false; D.showLaunch(S.launches[+b.dataset.lch].l); }; });
  c.querySelectorAll('[data-met]').forEach(b => { b.onclick = () => {
    const m = showers[+b.dataset.met], night = showersFor(lat, lon, m.peakMs - 12 * HOUR, { time }).find(x => x.name === m.name), at = (night && night.bestMs) || m.peakMs;
    Alerts.calendar([{ uid: `oo-${m.name.replace(/\W+/g, '')}-${new Date(m.peakMs).getUTCFullYear()}@open-overwatch`, start: at - HOUR, end: at + HOUR, title: `${m.name} meteor shower: look up (radiant ${m.dir})`, details: `${m.text}\nFrom ${m.parent}, hitting the air at ${m.kms} km/s. Get away from lights, give your eyes 20 minutes, lie back.\nhttps://destinjones.github.io/open-overwatch/globe.html#go=tonight`, alarmMin: 30 }], `${m.name.toLowerCase().replace(/\W+/g, '-')}.ics`);
  }; });
  if (c.querySelector('#tnAur')) c.querySelector('#tnAur').onclick = async () => {
    if (watching) { try { localStorage.removeItem('oo3d.auroraWatch'); } catch (e) { /* private mode */ } toast('Aurora alerts off'); return render(); }
    if (!(await Alerts.permission())) return toast('Notifications are blocked or not supported in this browser', 4000);
    if (!store.set('auroraWatch', { lat, lon })) return toast("Can't switch that on: this browser blocks site storage, so the alert couldn't be remembered", 5000);
    toast('Aurora alerts on: checked every 10 minutes while this page is open, once a night at most', 5000); render(); Tonight.watchAurora(); Tonight.checkAurora();
  };
  if (c.querySelector('#tnShare')) c.querySelector('#tnShare').onclick = async () => {
    // a named place (typed, or from a link) is shared as itself; your own location never goes into a link
    const at = name && !demo ? tonightHash(S.loc) : '';
    const url = at ? 'https://destinjones.github.io/open-overwatch/tonight.html#' + at : 'https://destinjones.github.io/open-overwatch/globe.html#go=tonight', text = S.summary + (at ? '\nSee it live:' : '\nSee yours:');
    if (navigator.share) { try { await navigator.share({ title: "Tonight's sky", text, url }); return; } catch (e) { if (e.name === 'AbortError') return; } }
    try { await navigator.clipboard.writeText(text + ' ' + url); toast('Copied: paste it into a message', 3000); } catch (e) { window.prompt('Copy this:', text + ' ' + url); }
  };
  if (c.querySelector('#tnLook')) c.querySelector('#tnLook').onclick = () => { Tonight.close(); D.lookUp(); };
  if (c.querySelector('#tnForget')) c.querySelector('#tnForget').onclick = () => { home.forget(); toast('Location forgotten'); intro(); };
  if (c.querySelector('#tnOther')) c.querySelector('#tnOther').onclick = () => { intro(); const q = $('#tnQ'); if (q) q.focus(); };
  if (c.querySelector('#tnLoc')) c.querySelector('#tnLoc').onclick = async () => { const p = await locate(), mine = c.classList.contains('show') && c.querySelector('#tnLoc'); if (p) home.set(p.latitude, p.longitude); if (!mine) return; if (p) show(home.get() || home.set(p.latitude, p.longitude)); else toast('Location refused or unavailable', 4000); };
}

async function show(loc) {
  const run = ++S.run; S.open = true; S.loc = loc; S.passLoc = loc; S.passes = []; S.aurora = null; S.sun = null; S.sunErr = false; S.computing = true; S.satErr = ''; S.memo = null; render(true);
  const obs = observer(loc.lat, loc.lon), t0 = Date.now(), t1 = t0 + DAY;
  S.crew = '';
  Crew.load().then(() => { if (run === S.run) { S.crew = Crew.sentence(); render(); } }, () => {});
  S.ecl = null;
  (D.nextEclipse ? D.nextEclipse(loc.lat, loc.lon) : Promise.resolve(null)).then(x => { if (run === S.run) { S.ecl = x || false; render(); } }, e => console.warn('eclipse', e));
  S.iss = ''; S.launches = []; S.far = []; S.hours = null; S.cloudErr = '';
  S.dark = null; S.darkErr = false; S.ds = null;
  DarkSky.at(loc.lat, loc.lon).then(d => { if (run !== S.run) return; S.dark = d; render(); if (d.more) d.more.then(() => { if (run === S.run) render(); }); }, e => { console.warn('light pollution', e); if (run === S.run) { S.darkErr = true; render(); } });
  if (!S.cat) DarkSky.deepsky().then(c => { S.cat = c; if (run === S.run) render(); }, e => { console.warn('deep sky', e); if (run === S.run) { S.catErr = true; render(); } });
  forecast(loc.lat, loc.lon).then(h => { if (run === S.run) { S.hours = h; S.hoursLoc = loc; render(); } }, e => { console.warn('clouds', e); if (run === S.run) { S.cloudErr = 'The cloud forecast is unreachable right now.'; render(); } });
  farthest(Date.now()).then(x => { if (run === S.run) { S.far = x; render(); } }, e => console.warn('farthest', e));
  launchesNear(loc).then(x => { if (run === S.run) { S.launches = x; render(); } }, () => {});
  SunNow.load().then(x => { if (run === S.run) { S.sun = x; render(); } }, () => { if (run === S.run) { S.sunErr = true; render(); } });   // the solar wind, flares and SWPC's warnings (globe/sunnow.js)
  D.auroraGrid().then(g => { if (run === S.run) { S.aurora = auroraAt(g.coordinates, loc.lat, loc.lon); render(); } }, () => { if (run === S.run) { S.aurora = { level: 0, overhead: 0, err: true, text: 'NOAA\'s aurora forecast is unreachable right now.' }; render(); } });
  const ok = await satsReady(); if (run !== S.run) return;   // a newer show() (another place) took over while satellites loaded
  if (!ok) {   // not "no passes": the orbits never arrived. Say so, and finish the job if they turn up later
    S.computing = false; S.satErr = window.satellite ? "The satellite orbits haven't loaded (CelesTrak unreachable?)." : "The orbit library didn't load (CDN blocked?)."; render();
    satsReady(180e3).then(ok2 => { if (ok2 && run === S.run && S.open) show(S.loc); });
    return;
  }
  issNow().then(t => { if (run === S.run) { S.iss = t; render(); } }, () => {});
  const add = (s, name, short, ps) => { for (const p of ps) S.passes.push({ ...p, id: s.id, name, short }); };
  for (const [id, name, short] of MAIN) { const s = D.sats.byId.get(id); if (s) add(s, name, short, passesOf(s, obs, t0, t1)); }
  if (run !== S.run) return; render(); await breathe();
  for (const t of starlinkTrains(D.sats.list.filter(s => s.layer === 'starlink')).slice(0, 3)) {
    const s = D.sats.byId.get(t.sat.id) || t.sat; add(s, `Starlink train (launched ${t.launch}, ${t.count} satellites in a line)`, 'Starlink train', passesOf(s, obs, t0, t1)); await breathe(); if (run !== S.run) return;
  }
  if (run !== S.run) return; render();
  // the brightest other satellites, only when they climb high in a dark sky (a coarser search: there are ~150 of them)
  const bright = [];
  const visual = D.sats.list.filter(x => x.layer === 'visual' && !MAIN.some(([id]) => id === x.id));   // all ~150, newest included
  for (const [i, s] of visual.entries()) {
    for (const p of passesOf(s, obs, t0, t1, 60e3)) if (p.visible && p.maxEl >= 45) bright.push([p, s]);
    if (i % 4 === 3) { await breathe(); if (run !== S.run) return; }   // a few ms of SGP4 between yields keeps a phone responsive
  }
  bright.sort((a, b) => b[0].maxEl - a[0].maxEl);
  const seen = new Set(); for (const [p, s] of bright) { if (seen.has(s.id) || seen.size >= 4) continue; seen.add(s.id); add(s, `${friendly(s.name)} (bright satellite)`, friendly(s.name), [p]); }
  S.computing = false; render();
}

/** "When can I see it?" for one satellite: its passes over you in the next 3 days, visible ones marked, with reminders. */
async function forSat(s, loc) {
  const c = card(`<div class="k" style="--c:#7dffa6">Passes over you</div><h2>${esc(s.name)}</h2><p class="note">Working it out…</p>`);
  await new Promise(r => setTimeout(r, 30));
  const t0 = Date.now(), all = passesOf(s, observer(loc.lat, loc.lon), t0, t0 + 3 * DAY), short = friendly(s.name);
  S.passLoc = loc; S.passes = all.map(p => ({ ...p, id: s.id, name: friendly(s.name), short }));
  const vis = S.passes.filter(p => p.visible), rows = (vis.length ? vis : S.passes).slice(0, 8);
  c.innerHTML = `<button class="x" aria-label="Close">×</button><div class="k" style="--c:#7dffa6">${loc.demo ? 'From Greenwich (example)' : `From ${loc.lat.toFixed(2)}, ${loc.lon.toFixed(2)}`} · next 3 days</div><h2>${esc(s.name)}</h2>
    <p class="tn-head">${vis.length ? `${vis.length} pass${vis.length > 1 ? 'es' : ''} you can see with your eyes (in sunlight, against a dark sky).` : S.passes.length ? 'It passes over, but always in daylight or in Earth\'s shadow, so you can\'t see it. All passes:' : 'It never rises above 10° from here in the next 3 days.'}</p>
    <div class="tn-list">${rows.map(p => passRow(p, S.passes.indexOf(p))).join('')}</div>
    <p class="note">Satellites shine by reflected sunlight: the best passes are an hour or two after sunset or before sunrise. Fainter satellites may need binoculars.</p>`;
  c.querySelector('.x').onclick = () => Tonight.close();
  bindPasses(c);
}
function bindPasses(c) {
  c.querySelectorAll('[data-rem]').forEach(b => { b.onclick = () => { const p = S.passes[+b.dataset.rem], now = Date.now();
    if (p.rise - 60e3 <= now) { toast(p.set > now ? `${p.short} is up now: look ${compass(p.azRise)} to ${compass(p.azSet)}!` : `${p.short} has already passed`, 6000); return; }
    if (p.rise - 10 * 60e3 <= now) { Alerts.remind({ tag: `pass-${p.id}-${Math.round(p.rise / 60e3)}`, at: p.rise - 60e3, title: `${p.short} in 1 minute`, body: describePass(p.short, p, { time }) }); return; }   // closer than 10 minutes: a minute's warning
    Alerts.remind({ tag: `pass-${p.id}-${Math.round(p.rise / 60e3)}`, at: p.rise - 10 * 60e3, title: `${p.short} in 10 minutes`, body: describePass(p.short, p, { time }) }); }; });
  c.querySelectorAll('[data-cal]').forEach(b => { b.onclick = () => { const p = S.passes[+b.dataset.cal]; Alerts.calendar([{ uid: `oo-${p.id}-${Math.round(p.rise / 60e3)}@open-overwatch`, start: p.rise, end: p.set, title: `${p.short} passes over: look ${compass(p.azRise)}`, details: describePass(p.name, p, { time }) + '\nhttps://destinjones.github.io/open-overwatch/globe.html#go=tonight', alarmMin: 10 }], `${p.short.toLowerCase().replace(/\W+/g, '-')}-pass.ics`); }; });
}

/**
 * What this card needs from the page it lives on (the 3D globe, or the light tonight.html):
 *   sats: { list, byId }    satellites with { id, name, layer, l1, l2 }, filled as they load
 *   auroraGrid() -> Promise<OVATION json>      countryName(lon, lat) -> Promise<name | null>
 *   launches() -> Promise<[launch]>            showLaunch(launch)
 *   nextEclipse(lat, lon) -> Promise | null     watchEclipse(e)      lookUp(target?)   (optional: their buttons hide without them;
 *   target { name, ra, dec, text } is a deep-sky object to point at)
 */
let D = null;

export const Tonight = {
  use(deps) { D = deps; return this; },
  /** at: { lat, lon, name? } from a link (#at=, core/viewlink.js) answers for that place without saving it; else the saved home, or ask. */
  open(at) {
    S.open = true;
    if (at && Number.isFinite(at.lat) && Number.isFinite(at.lon)) return show({ lat: at.lat, lon: at.lon, ...(placeName(at.name) ? { name: placeName(at.name) } : {}), shared: true });
    const h = home.get(); if (h) show(h); else intro();
  },
  /** Back from a card Tonight led to: the same place, saved or not (the Greenwich example has no saved home). */
  reopen() { if (S.loc) show(S.loc); else this.open(); },
  /** Passes of one satellite over the saved location (asks for it first if there isn't one). */
  async forSat(s) {
    S.open = false; S.run++;
    const c = card(`<div class="k" style="--c:#7dffa6">Passes over you</div><h2>${esc(s.name)}</h2><p class="note" data-wait="see">Finding where you are…</p>`);
    const mine = () => !!c.querySelector('[data-wait="see"]');   // the user opened something else meanwhile: leave it be
    let h = home.get();
    if (!h) { const p = await locate(); if (p) h = home.set(p.latitude, p.longitude); else { h = { lat: 51.48, lon: 0, demo: true }; toast('Location unavailable: showing passes over Greenwich', 4000); } }
    if (!mine()) return;
    c.querySelector('[data-wait="see"]').textContent = 'Working it out…';
    if (!(await satsReady())) { if (mine()) c.querySelector('[data-wait="see"]').textContent = "The satellite orbits aren't loaded yet: try again in a moment."; return; }
    if (mine()) forSat(s, h);
  },
  close() { S.open = false; S.run++; clearTimeout(pending); pending = 0; deselect(); $('#card').classList.remove('show'); },
  /** After boot: if this device has a saved location, say the next thing worth seeing in one line. */
  async peek() {
    Alerts.init(); this.watchAurora();
    const h = home.get(); if (!h || !(await satsReady(60e3))) return;
    const iss = D.sats.byId.get('25544'); if (!iss) return;
    await new Promise(r => (window.requestIdleCallback || setTimeout)(r));   // ~15 ms of SGP4: not in the same tick the satellites landed in
    const obs = observer(h.lat, h.lon), now = Date.now();
    const issPasses = passesOf(iss, obs, now, now + DAY);   // once: the nudges and the toast both read it
    // "look up now": a nudge a minute before each visible station pass in the next 12 hours, while this page is open
    for (const [id, short] of [['25544', 'The ISS'], ['48274', 'Tiangong']]) {
      const sat = D.sats.byId.get(id); if (!sat) continue;
      const list = id === '25544' ? issPasses.filter(x => x.rise < now + 12 * HOUR) : passesOf(sat, obs, now, now + 12 * HOUR);
      for (const q of list.filter(x => x.visible && x.maxEl >= 20)) {
        const say = () => { const t = `${short} is rising in the ${compass(q.azRise)} now: up to ${Math.round(q.maxEl)}° high, bright, for about ${Math.max(1, Math.round((q.set - q.rise) / 60e3))} min. Look up!`;
          if ('Notification' in window && Notification.permission === 'granted') Alerts.now('Look up now', t, 'now-' + id); else toast(t, 15000); };
        setTimeout(say, Math.max(0, q.rise - 60e3 - now));
      }
    }
    if (S.open) return;
    const p = issPasses.find(x => x.visible);
    if (p) toast(`Tonight over you: the ISS at ${time(p.rise)}, look ${compass(p.azRise)} · tap "Tonight" for more`, 8000);
  },
  /** Aurora alerts: while the page is open, every 10 minutes, at most once in 6 hours, only when it is dark. */
  watchAurora() {
    if (this._aw) return;
    const check = async () => {
      const w = store.get('auroraWatch', null); if (!w) return;
      const now = Date.now(); if (sunAlt(w.lat, w.lon, now) > -12 || now - store.get('auroraSaid', 0) < 6 * HOUR) return;
      const a = auroraAt((await D.auroraGrid()).coordinates, w.lat, w.lon);
      if (a.level >= 2) { store.set('auroraSaid', now); Alerts.now('Aurora likely now', a.text, 'aurora'); }
    };
    this.checkAurora = () => check().catch(e => console.warn('aurora watch', e));
    this._aw = setInterval(this.checkAurora, 10 * 60e3); this.checkAurora();
  },
};
