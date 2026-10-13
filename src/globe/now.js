// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// "Earth now": one panel that sums up what is happening on the planet right now, from the feeds the globe already reads:
// earthquakes (24 h, with 7 and 30 days of history from USGS), tropical cyclones, wildfires (NASA EONET's named fires),
// launches in the next 24 hours (Launch Library 2, the site's copy), people in space, the aurora (NOAA's Kp, 3 days back
// and 1 ahead), asteroid flybys this week (NASA/JPL, the site's copy) and the weather model's extremes (hottest, coldest,
// windiest point on Earth at this hour). Every line is a button: it switches the right layer on and flies there.
// The band's "Earth now", the E key or a #go=now link open it; on phones it is a sheet that folds down to its title
// while you look at the globe. The sums and the charts are src/core/earthnow.js (tested); this file only fetches
// what isn't loaded yet, lays it out and wires the buttons. Nothing is fetched or timed while the panel is closed.
import { C, $, esc, fmt, toast, store, getJSON, PHONE, EMBED } from './env.js';
import { camera } from './viewer.js';
import { L, syncDock } from './layers.js';
import { state, hooks } from './state.js';
import { release } from './follow.js';
import { select, flyToObject } from './ui.js';
import { Quakes } from './quakes.js';
import { Storms } from './storms.js';
import { Launches } from './launches.js';
import { Crew } from './crew.js';
import { Flybys } from './flybys.js';
import { Sats } from './satellites.js';
import { Model } from './model.js';
import { Weather } from './weather.js';
import { Country } from './country.js';
import { usgsUrl, parseUsgs, quakeTitle } from '../core/quakes.js';
import { eonetUrl, parseEonet } from '../core/eonet.js';
import { countdown } from '../core/launches.js';
import { crewSentence } from '../core/crew.js';
import {
  KP_FORECAST_URL, summarizeQuakes, quakeClass, dailyCounts, kpSeries, kpSummary, kpLevel, auroraReach, summarizeStorms, summarizeWildfires,
  launchesSoon, launchesByMonth, summarizeFlybys, weatherExtremes, tempWords, windWords, latLonWords, quakeChart, kpChart, launchChart,
} from '../core/earthnow.js';

const LD_KM = 384400, AU_KM = 149597870.7;
const ago = ms => { const m = Math.round((Date.now() - ms) / 60e3); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };
const utc = ms => new Date(ms).toISOString().slice(11, 16) + ' UTC';
const day = ms => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const plural = (n, one, many = one + 's') => `${fmt(n)} ${n === 1 ? one : many}`;

// ---- the data: what the globe already holds, plus a few small history files fetched once per open (and kept 10 min)

/** A value fetched at most once per `ttl`, shared by every caller meanwhile; a failure is kept for a minute, not retried
 *  on every redraw. */
function cached(ttl, fn) {
  let at = 0, p = null, failedAt = 0;
  return {
    get(force = false) {
      const now = Date.now();
      if (p && !force && now - at < ttl) return p;
      if (!force && failedAt && now - failedAt < 60e3) return Promise.reject(new Error('backing off'));
      at = now; failedAt = 0;
      return p = fn().catch(e => { p = null; failedAt = Date.now(); throw e; });
    },
    get fresh() { return !!p && Date.now() - at < ttl; },
  };
}
const SRC = {
  week: cached(10 * 60e3, async () => parseUsgs(await getJSON(usgsUrl('2.5_week')))),          // ~0.3 MB
  month: cached(30 * 60e3, async () => parseUsgs(await getJSON(usgsUrl('4.5_month')))),       // ~0.4 MB, M4.5+ only
  fires: cached(30 * 60e3, async () => parseEonet(await getJSON(eonetUrl({ days: 20, category: 'wildfires' })))),
  kp: cached(15 * 60e3, async () => getJSON(KP_FORECAST_URL)),
  wx: cached(30 * 60e3, async () => {   // the model hour nearest now: 2 m temperature and 10 m wind (shared with weather mode's cache)
    const r = await Model.at(Date.now(), ['temp', 'wind']), f = r.w > 0.5 ? r.b : r.a;
    return { ...weatherExtremes({ temp: f.temp, wind: f.wind }), run: r.run, hour: r.w > 0.5 ? r.h1 : r.h0, model: r.model.def.short };
  }),
};

// ---- actions: switch a layer on, fly, select

function layerOn(id) {
  const l = L[id]; if (!l || l.on) return;
  l.on = true; store.set('ly.' + id, true); syncDock(); hooks.applyVisibility();
}
function fly(lon, lat, h = 1.6e6, then) {
  release(); hooks.clearPresets();
  camera.flyTo({ destination: C.Cartesian3.fromDegrees(lon, lat, h), duration: 2.2, complete: then });
  Now.fold();
}
/** A card for something that isn't a drawn object (a named wildfire, a weather extreme): select() shows it. */
const pin = (o, color, kicker, title, rows, note) => ({
  ...o, kind: 'nowpin',
  tip: () => title,
  cardHtml: () => `<div class="k" style="--c:${color}">${esc(kicker)}</div><h2>${esc(title)}</h2><dl>${rows.filter(r => r[1] != null && r[1] !== '').map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>${note ? `<div class="note" style="margin-top:8px">${esc(note)}</div>` : ''}`,
});

// ---- the panel

let el = null, body = null, opener = null, timer = 0, tab = { quakes: 'week' }, acts = [];
const act = fn => { acts.push(fn); return acts.length - 1; };
/** One row: a button that does `fn`; `main` is the headline, `sub` the small print. */
const row = (fn, main, sub = '', color = '') => `<button class="nw-row" type="button" data-a="${act(fn)}"${color ? ` style="--c:${color}"` : ''}><span class="nw-main">${main}</span>${sub ? `<span class="nw-sub">${sub}</span>` : ''}</button>`;
const section = (id, title, color, inner, source) => `<section class="nw-sec" aria-labelledby="nw-h-${id}" style="--c:${color}"><h3 id="nw-h-${id}">${esc(title)}</h3>${inner}${source ? `<p class="nw-src">${source}</p>` : ''}</section>`;
const waiting = '<p class="nw-wait">Loading…</p>';
const failed = what => `<p class="nw-wait">${esc(what)} isn't reachable right now.</p>`;

function quakesHtml(s24) {
  let h = '';
  if (!s24) h += waiting;
  else if (!s24.count) h += '<p class="nw-wait">No M2.5+ quakes in the last 24 hours (or the USGS feed is not reachable).</p>';
  else {
    const q = s24.strongest;
    h += row(() => { layerOn('quakes'); fly(q.lon, q.lat, 2.2e6, () => select(q)); },
      `<b>${fmt(s24.count)}</b> quakes M2.5+ in 24 h${s24.m6 ? ` · <b class="nw-hot">${s24.m6} M6+</b>` : ''}`,
      `Strongest: ${esc(quakeTitle(q))} · ${esc(quakeClass(q.mag))} · ${ago(q.time)}${q.tsunami ? ' · tsunami flag' : ''}`);
    h += '<div class="nw-chips" role="list" aria-label="Busiest regions">' + s24.regions.slice(0, PHONE ? 4 : 6).map(r =>
      `<span role="listitem">${row(() => { layerOn('quakes'); fly(r.q.lon, r.q.lat, 2.0e6, () => select(r.q)); }, `${esc(r.region)} <b>${r.n}</b>`, '', '')}</span>`).join('') + '</div>';
  }
  h += `<div class="nw-tabs" role="tablist" aria-label="Quake history">${[['week', '7 days · M2.5+'], ['month', '30 days · M4.5+']].map(([k, label]) =>
    `<button type="button" role="tab" class="nw-tab${tab.quakes === k ? ' on' : ''}" aria-selected="${tab.quakes === k}" data-qtab="${k}">${label}</button>`).join('')}</div>`;
  h += `<div class="nw-chart-box" id="nwQChart">${chartCache.q[tab.quakes] || waiting}</div>`;
  return section('quakes', 'Earthquakes', '#ff7b4f', h, 'USGS real-time feeds · counts per UTC day · today so far shown faint');
}

function stormsHtml(s) {
  let h;
  if (!s) h = waiting;
  else if (!s.count) h = '<p class="nw-wait">No active tropical cyclones.</p>';
  else h = s.list.slice(0, 4).map(x => row(() => { layerOn('storms'); fly(x.lon, x.lat, 3.0e6, () => select(x)); },
    `${esc(x.title || x.name)}${x.kt ? ` · <b>${x.kt} kt</b>` : ''}`, [x.movement && esc(x.movement), x.pressure && `${x.pressure} mb`].filter(Boolean).join(' · '))).join('')
    + (s.count > 4 ? `<p class="nw-wait">and ${s.count - 4} more on the globe.</p>` : '');
  return section('storms', s && s.count ? `Tropical cyclones · ${s.count}` : 'Tropical cyclones', '#7fd0ff', h, 'NOAA NHC · GDACS · NASA EONET');
}

function firesHtml(s, err) {
  let h;
  if (err) h = failed('NASA EONET');
  else if (!s) h = waiting;
  else if (!s.count) h = `<p class="nw-wait">No open named wildfires listed${s.rx ? ` (${s.rx} prescribed burns)` : ''}.</p>`;
  else {
    const big = s.largest || s.newest;
    h = row(() => showFire(big), `<b>${fmt(s.count)}</b> named wildfires burning${s.rx ? ` · ${s.rx} prescribed burns` : ''}`,
      big ? `Largest reported: ${esc(big.title.replace(/^Wildfire\s+/i, ''))}${s.largestAcres ? ` · ${fmt(s.largestAcres)} acres` : ''}` : '');
    h += '<div class="nw-chips" role="list" aria-label="Where">' + s.places.slice(0, 4).map(p => `<span role="listitem">${row(() => showFire(p.e), `${esc(p.region)} <b>${p.n}</b>`)}</span>`).join('') + '</div>';
  }
  return section('fires', 'Wildfires', '#ff7a2f', h, 'NASA EONET open events (mostly US and Canadian incident reports) · the Wildfires layer adds satellite hot spots');
}
function showFire(e) {
  if (!e) return;
  layerOn('fires');
  const acres = /^([\d.]+)\s*acres?$/i.exec(e.mag || '');
  const o = pin({ lat: e.lat, lon: e.lon }, '#ff7a2f', 'Wildfire · NASA EONET', e.title.replace(/^Wildfire\s+/i, ''),
    [['Size', acres ? `${fmt(+acres[1])} acres · ${fmt(+acres[1] * 0.404686)} ha` : e.mag], ['Last update', e.date ? e.date.slice(0, 16).replace('T', ' ') + ' UTC' : ''], ['Position', latLonWords(e.lat, e.lon)], ['Source', (e.sources || []).map(x => x.id).join(', ')]],
    "An incident report listed by NASA EONET. Satellite hot spots (the Wildfires layer) show around it once you're close.");
  fly(e.lon, e.lat, 1.2e5, () => select(o));
}

function launchesHtml(list, err) {
  let h;
  if (err) h = failed('The launch schedule');
  else if (!list) h = waiting;
  else {
    const soon = launchesSoon(list, { hours: 24 });
    h = soon.length ? soon.slice(0, 4).map(l => row(() => { layerOn('launches'); fly(l.lon, l.lat, 9e5, () => Launches.show(l)); },
      `${esc(l.rocket)} · <b class="nw-cd" data-net="${l.net}">${esc(countdown(l.net, Date.now()))}</b>`, `${esc(l.mission)} · ${esc(l.place || l.pad)}`)).join('')
      : `<p class="nw-wait">No launches in the next 24 hours.${list.length ? ` Next: ${esc(list[0].rocket)}, ${esc(day(list[0].net))}.` : ''}</p>`;
    h += row(() => { layerOn('launches'); Launches.openList(); Now.fold(); }, `All ${list.length} upcoming launches`, 'Countdowns, webcasts, reminders');
    h += `<div class="nw-chart-box">${chartCache.launches || ''}</div>`;
  }
  return section('launches', 'Launches · next 24 h', '#ff9f5c', h, 'The Space Devs, Launch Library 2 · per month: the next few dozen listed, months not yet complete shown faint');
}

function crewHtml(w, err) {
  let h;
  if (err) h = failed('The crew list');
  else if (!w) h = waiting;
  else {
    h = row(() => { Crew.open(); Now.fold(); }, esc(crewSentence(w)), 'Names, agencies, days in space');
    const ids = { ISS: '25544', Tiangong: '48274' };
    h += w.stations.map(s => row(() => {
      const o = Sats.list.find(x => x.id === ids[s.short]);
      if (!o) { toast('The station is still loading'); return; }
      layerOn('stations'); select(o); flyToObject(o); Now.fold();
    }, `${esc(s.short)} · <b>${s.crew.length}</b> aboard`, 'Fly to it')).join('');
  }
  return section('crew', 'People in space', '#7dffa6', h, 'Launch Library 2 · station inferred from the agency');
}

function auroraHtml(sum, err) {
  let h;
  if (err) h = failed("NOAA's Kp index");
  else if (!sum) h = waiting;
  else {
    const n = sum.now, lv = sum.level;
    h = row(() => { layerOn('aurora'); fly(nightPoleLon(), 68, 7.5e6); },
      `Kp <b style="color:${lv.color}">${n ? n.kp.toFixed(1) : '—'}</b> · ${esc(lv.name)}`,
      `${n ? `${esc(n.kind)} for ${utc(n.t).slice(0, 5)}–${utc(n.t + 3 * 3600e3)} ·` : ''}${esc(auroraReach(n && n.kp))}`);
    const bits = [];
    if (sum.max) bits.push(`3-day high Kp ${sum.max.kp.toFixed(1)} (${esc(kpLevel(sum.max.kp).name)}) ${esc(day(sum.max.t))}`);
    if (sum.next) bits.push(`next 24 h up to Kp ${sum.next.kp.toFixed(1)}`);
    if (bits.length) h += `<p class="nw-note">${bits.join(' · ')}</p>`;
    h += `<div class="nw-chart-box">${chartCache.kp || ''}</div>`;
  }
  return section('aurora', 'Aurora', '#7dffb0', h, 'NOAA SWPC planetary K index · 3-hour values, the last 3 days and the forecast (faint) · the dashed line is G1');
}
/** The longitude where it is about midnight now (the aurora is best seen there). */
function nightPoleLon() { const d = new Date(), h = d.getUTCHours() + d.getUTCMinutes() / 60; return ((180 - h * 15) + 540) % 360 - 180; }

function flybysHtml(s, err) {
  let h;
  if (err) h = failed('The flyby list');
  else if (!s) h = waiting;
  else if (!s.next) h = '<p class="nw-wait">No close approaches listed.</p>';
  else {
    const c = s.closest || s.next, ld = c.au * AU_KM / LD_KM;
    h = row(() => { Flybys.show(c); Now.fold(); }, s.next7 ? `<b>${s.next7}</b> asteroid flyby${s.next7 === 1 ? '' : 's'} this week` : 'No flybys this week',
      `${s.next7 ? 'Closest' : 'Next'}: ${esc(c.name)} · ${ld.toFixed(1)} lunar distances · ${esc(day(c.tca))}`);
    h += row(() => { Flybys.openList(); Now.fold(); }, `All ${s.total} in the next 60 days`, 'Within 20 lunar distances');
  }
  return section('flybys', 'Near-Earth flybys', '#ffb44d', h, 'NASA/JPL CNEOS close-approach data');
}

function weatherHtml(x, err) {
  let h;
  if (err) h = failed('The weather model');
  else if (!x) h = PHONE && !wxAsked ? row(() => { wxAsked = true; Now.refresh(); }, 'Find the hottest, coldest and windiest places', 'Downloads about 1 MB of model data') : waiting;
  else {
    const one = (label, p, words, kind, color) => p ? row(() => showExtreme(label, p, words, kind, color, x), `${label}: <b>${esc(words)}</b>`, `${p.place ? esc(p.place) + ' · ' : ''}${latLonWords(p.lat, p.lon)}`) : '';
    h = one('Hottest', x.hottest, x.hottest && tempWords(x.hottest.v), 'temp', '#ff7b4f') + one('Coldest', x.coldest, x.coldest && tempWords(x.coldest.v), 'temp', '#7fd0ff')
      + one('Windiest', x.windiest, x.windiest && windWords(x.windiest.v), 'wind', '#62e0c8');
  }
  const src = x ? `NOAA ${esc(x.model)} model, run ${esc(x.run ? `${x.run.date.slice(0, 4)}-${x.run.date.slice(4, 6)}-${x.run.date.slice(6, 8)} ${x.run.hour}Z` : '')}, +${x.hour} h · 2 m air temperature and 10 m wind on its grid, anywhere on Earth (sea included)` : 'The weather model the globe uses (NOAA GFS)';
  return section('wx', 'Weather extremes now', '#62e0c8', h, src);
}
let wxAsked = false;
async function showExtreme(label, p, words, kind, color, x) {
  const o = pin({ lat: p.lat, lon: p.lon }, color, `${label} on Earth · ${x.model} model`, `${label}: ${words}`,
    [['Position', latLonWords(p.lat, p.lon)], ['Model hour', `+${x.hour} h`], kind === 'wind' && Number.isFinite(p.from) ? ['From', `${Math.round(p.from)}°`] : ['', '']],
    `A model grid cell (${PHONE ? '1°' : '½°'} across): an average over the cell from a forecast model, not a weather station.`);
  // weather mode with the matching layer on (it flies out to the whole Earth when opened low, so open it first). On a
  // phone its panel takes the bottom of the screen: this sheet closes, and weather's own readout says what is there.
  const set = Weather.sets[kind];
  if (set && !set.on) set.on = true;
  if (PHONE) Now.close();
  if (!Weather.on) { document.querySelectorAll('#band .go').forEach(b => b.classList.toggle('on', b.dataset.go === 'weather')); await Weather.open(); }
  else { Weather.build(); Weather.show(); }
  if (!Weather.on) return;   // weather data unreachable: weather mode said so and closed
  fly(p.lon, p.lat, 4.5e6, () => { if (!PHONE) select(o); Weather.readout({ lat: p.lat, lon: p.lon }); });
  if (PHONE) toast(`${label} on Earth now: ${words}, ${latLonWords(p.lat, p.lon)} (${x.model} model)`, 6000);
}

const chartCache = { q: {}, kp: '', launches: '' };

/** Draw everything known now; sections still waiting say so. Cheap: strings only, no network. */
function render(data) {
  if (!el) return;
  acts = [];
  const scroll = body.scrollTop;
  body.innerHTML = [
    quakesHtml(data.s24), stormsHtml(data.storms), auroraHtml(data.kp, data.kpErr), launchesHtml(data.launches, data.launchErr),
    crewHtml(data.crew, data.crewErr), flybysHtml(data.flybys, data.flybyErr), firesHtml(data.fires, data.fireErr), weatherHtml(data.wx, data.wxErr),
  ].join('');
  body.scrollTop = scroll;
  $('#nwAt').textContent = `updated ${utc(Date.now())}`;
}

const data = {};
let stormsTried = false;   // the globe loads cyclones at boot; if none are in yet, ask once (an empty list is a real answer too)
async function refresh(force = false) {
  const draw = () => render(data);
  const q24 = Quakes.list.length ? Promise.resolve() : Quakes.load().catch(() => {});
  const jobs = [
    q24.then(() => { data.s24 = summarizeQuakes(Quakes.list, { since: Date.now() - 864e5 }); }),
    Promise.resolve().then(() => { if (!Storms.list.length && !stormsTried) { stormsTried = true; return Storms.load().catch(() => {}); } })
      .then(() => { data.storms = summarizeStorms(Storms.list); }),
    SRC.week.get(force).then(w => { chartCache.q.week = quakeChart(dailyCounts(w, { days: 7 }), { title: 'Earthquakes M2.5+ per day, last 7 days (UTC)', id: 'nwq7' }); }, () => { chartCache.q.week = failed('The USGS week feed'); }),
    SRC.kp.get(force).then(d => {
      const series = kpSeries(d, { pastH: 72, aheadH: 24 });
      data.kp = kpSummary(series); data.kpErr = !data.kp;
      chartCache.kp = kpChart(series, { title: 'Planetary K index, 3-hour values: the last 3 days and the next day (forecast)', id: 'nwkp' });
    }, () => { data.kpErr = true; }),
    Launches.load().then(() => {
      if (Launches.error && !Launches.list.length) { data.launchErr = true; return; }
      data.launches = Launches.list; data.launchErr = false;
      chartCache.launches = launchChart(launchesByMonth(Launches.list, { months: 3 }), { title: 'Launches listed per month (the next few dozen; faint months are incomplete)', id: 'nwln' });
    }),
    Crew.load().then(w => { data.crew = w; data.crewErr = false; }, () => { data.crewErr = !data.crew; }),
    Flybys.load().then(() => { if (Flybys.error) data.flybyErr = true; else data.flybys = summarizeFlybys(Flybys.data && Flybys.data.rows); }),
    SRC.fires.get(force).then(ev => { data.fires = summarizeWildfires(ev); data.fireErr = false; }, () => { data.fireErr = !data.fires; }),
  ];
  if (tab.quakes === 'month') jobs.push(loadMonth(force));
  if (!PHONE || wxAsked) jobs.push(SRC.wx.get(force).then(x => { data.wx = x; data.wxErr = false; return named(x); }, () => { data.wxErr = !data.wx; }));
  draw();
  for (const j of jobs) j.then(() => { if (el && el.classList.contains('show')) draw(); });   // each section fills in as it arrives
  await Promise.allSettled(jobs);
}
/** Country names for the extremes (the globe's own borders; open sea stays unnamed). */
const named = x => Promise.all([x.hottest, x.coldest, x.windiest].filter(p => p && p.place === undefined).map(p => Country.at(p.lon, p.lat).then(k => { p.place = k && k.facts ? k.facts.name : (Math.abs(p.lat) > 60 && p.lat < 0 ? 'Antarctica' : ''); }, () => { p.place = ''; })));
const loadMonth = force => SRC.month.get(force).then(m => { chartCache.q.month = quakeChart(dailyCounts(m, { days: 30 }), { title: 'Earthquakes M4.5+ per day, last 30 days (UTC)', id: 'nwq30', every: 5 }); },
  () => { chartCache.q.month = failed('The USGS month feed'); });

function build() {
  el = document.createElement('aside');
  el.id = 'now'; el.className = 'glass'; el.setAttribute('aria-labelledby', 'nwTitle'); el.tabIndex = -1;
  el.innerHTML = `<div class="nw-head"><button type="button" class="nw-fold" id="nwFold" aria-expanded="true" aria-controls="nwBody"><h2 id="nwTitle">Earth now</h2><span id="nwAt" class="nw-at" aria-live="polite"></span></button>
    <button type="button" class="nw-btn" id="nwRe" aria-label="Refresh" title="Refresh">↻</button><button type="button" class="x" id="nwX" aria-label="Close Earth now">×</button></div>
    <div class="nw-body" id="nwBody"></div>`;
  document.body.append(el);
  body = $('#nwBody');
  $('#nwX').onclick = () => Now.close();
  $('#nwRe').onclick = () => refresh(true);
  $('#nwFold').onclick = () => { if (PHONE || el.classList.contains('peek')) Now.fold(!el.classList.contains('peek')); };
  body.addEventListener('click', e => {
    const t = e.target.closest('[data-qtab]');
    if (t) { tab.quakes = t.dataset.qtab; if (tab.quakes === 'month' && !chartCache.q.month) loadMonth().then(() => render(data)); render(data); return; }
    const b = e.target.closest('[data-a]'); if (b && acts[+b.dataset.a]) acts[+b.dataset.a]();
  });
  el.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.stopPropagation(); Now.close(); }
    if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && e.target.matches('[data-qtab]')) {   // tabs: arrows move between them
      const tabs = [...el.querySelectorAll('[data-qtab]')], i = tabs.indexOf(e.target), n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      n.click(); el.querySelector(`[data-qtab="${n.dataset.qtab}"]`)?.focus();
    }
  });
}

export const Now = {
  get on() { return !!el && el.classList.contains('show'); },
  open() {
    if (EMBED) return;
    if (!el) build();
    opener = document.activeElement;
    el.classList.remove('peek'); $('#nwFold').setAttribute('aria-expanded', 'true');
    el.classList.add('show'); document.body.classList.add('nw-open');
    refresh().catch(e => console.warn('earth now', e));
    clearInterval(timer);
    timer = setInterval(() => {   // countdowns every second... only while showing, visible and unfolded; the rest every 5 minutes
      if (!this.on || document.hidden) return;
      if (!el.classList.contains('peek')) for (const c of el.querySelectorAll('.nw-cd')) c.textContent = countdown(+c.dataset.net, Date.now());
      if (Date.now() - (this.drawnAt || 0) > 5 * 60e3) { this.drawnAt = Date.now(); refresh().catch(() => {}); }
    }, 1000);
    this.drawnAt = Date.now();
    requestAnimationFrame(() => el.focus({ preventScroll: true }));   // keyboard users land in the panel (Tab reaches its rows, Esc closes)
  },
  close() {
    if (!el) return;
    el.classList.remove('show', 'peek'); document.body.classList.remove('nw-open'); clearInterval(timer);
    document.querySelector('#band [data-go="now"]')?.classList.remove('on');
    if (opener && opener.focus && document.contains(opener)) opener.focus({ preventScroll: true });
  },
  toggle() { this.on ? this.close() : this.open(); },
  /** Phones: fold the sheet down to its title (so the globe shows) or open it again. Desktop: nothing (it sits at the side). */
  fold(down = true) {
    if (!el || !PHONE) return;
    el.classList.toggle('peek', down); $('#nwFold').setAttribute('aria-expanded', String(!down));
  },
  refresh: () => refresh(),
  /** For the console and tests: the sums as last drawn. */
  get data() { return data; },
};

addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || state.lookup || /input|textarea|select/i.test(e.target.tagName)) return;
  if (e.key === 'e' || e.key === 'E') { const b = document.querySelector('#band [data-go="now"]'); if (Now.on) Now.close(); else if (b) b.click(); else Now.open(); }
});
