// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// "The Sun now": the solar wind at L1, its Bz, the Sun's X-ray flares and NOAA SWPC's watches and warnings, fetched
// straight from SWPC (it sends CORS) at most every 5 minutes and only when a panel asks. Shared by Tonight (the globe's
// and tonight.html) and the globe's Earth-now dashboard. The parsing and the words are core/spaceweather.js (tested).
// About 270 kB gzipped per refresh, nearly all of it the two 1-minute solar-wind files the sparkline needs.
import { esc } from './env.js';
import { SW_URLS, sunNow, bzSpark, topAlerts } from '../core/spaceweather.js';
import { provenanceHtml } from '../core/provenance.js';

const TTL = 5 * 60e3;
let at = 0, pending = null;
const get = url => fetch(url).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });

export const SunNow = {
  last: null,
  /** The summary (core/spaceweather.js sunNow), shared by every caller for 5 minutes; rejects only when every feed failed. */
  load(force = false) {
    if (pending && !force && Date.now() - at < TTL) return pending;
    at = Date.now();
    const parts = ['mag', 'wind', 'flare', 'flares', 'alerts'];
    return pending = Promise.allSettled(parts.map(k => get(SW_URLS[k]))).then(rs => {
      if (rs.every(r => r.status === 'rejected')) throw new Error('NOAA SWPC unreachable');
      const docs = Object.fromEntries(parts.map((k, i) => [k, rs[i].status === 'fulfilled' ? rs[i].value : undefined]));
      return this.last = sunNow(docs, { fetchedAt: Date.now() });
    }).catch(e => { pending = null; throw e; });
  },
};

const prov = p => p ? `<div class="sw-prov" style="font-size:11px;color:var(--faint);margin:2px 0 8px">${provenanceHtml(p)}</div>` : '';
const KIND = { warning: 'Warning', watch: 'Watch', alert: 'Alert', summary: 'Earlier' };

/** The Sun panel for Tonight's card (its tn-* classes): Bz with the sparkline, the wind, flares, then SWPC's messages. */
export function sunTonightHtml(s, err = false) {
  if (err) return '<h3>The Sun now</h3><p class="tn-p">NOAA\'s space weather feeds are unreachable right now.</p>';
  if (!s) return '<h3>The Sun now</h3><p class="tn-p">Checking the solar wind…</p>';
  const out = ['<h3>The Sun now <small>· what drives the aurora</small></h3>'];
  if (s.bz) out.push(`<p class="tn-p">Magnetic field (Bz): ${s.bz.south || s.bz.now < -2 ? `<b class="ok">${esc(s.bz.text)}</b>` : esc(s.bz.text)}.</p>`,
    `<div class="sw-spark-box" style="color:var(--ink);margin:6px 0 0">${bzSpark(s.bz.series, { id: 'tnbz', w: 320, h: 48, title: 'Solar wind Bz, the last 6 hours' })}</div>`,
    '<p class="tn-p"><small>The last 6 hours at L1; below the dashed line is southward, which lets the solar wind into Earth\'s field and feeds the aurora.</small></p>', prov(s.bz.prov));
  if (s.wind) out.push(`<p class="tn-p">Solar wind: ${esc(s.wind.text)}.</p>`, prov(s.wind.prov));
  if (s.flare) out.push(`<p class="tn-p">Flares: ${esc(s.flare.text)}.</p>`, prov(s.flare.prov));
  if (s.alerts) {
    const act = topAlerts(s.alerts.active, 4), rec = topAlerts(s.alerts.recent, act.length ? 2 : 3);
    out.push(act.length || rec.length ? `<div class="tn-list">${[...act, ...rec].map(e => `<div class="tn-row${e.active ? '' : ' dim'}"><span>${e.active ? `<b class="cl">${KIND[e.kind]}</b>` : 'Earlier'}: ${esc(e.text)}</span></div>`).join('')}</div>`
      : '<p class="tn-p">No NOAA space weather watches, warnings or alerts in the last day.</p>', prov(s.alerts.active[0] ? s.alerts.active[0].prov : null));
  }
  return out.join('');
}

/** The dashboard's one line plus the sparkline (Earth now's nw-* classes); `row` is its button maker. */
export function sunNowHtml(s, row, open) {
  const bits = [];
  if (s.flare && s.flare.now) bits.push(`X-rays ${esc(s.flare.now.cls)} now${s.flare.peak ? `, ${esc(s.flare.peak.cls)} peak in 24 h` : ''}`);
  if (s.wind) bits.push(`wind ${s.wind.speed} km/s, reaches Earth in ~${s.wind.arrivalMin} min`);
  const bz = s.bz ? `Bz <b>${s.bz.now > 0 ? '+' : s.bz.now < 0 ? '−' : ''}${Math.abs(s.bz.now).toFixed(1)} nT</b> · ${s.bz.now < -2 ? 'southward, aurora-friendly' : s.bz.now > 2 ? 'northward' : 'near zero'}` : 'The Sun now';
  let h = row(open, bz, bits.join(' · '));
  const act = s.alerts ? topAlerts(s.alerts.active, 3) : [];
  if (act.length) h += act.map(e => `<p class="nw-note">${esc(KIND[e.kind])}: ${esc(e.text)}</p>`).join('');
  else if (s.alerts) h += '<p class="nw-note">No NOAA space weather warnings in force.</p>';
  if (s.bz) h += `<div class="nw-chart-box">${bzSpark(s.bz.series, { id: 'nwbz', w: 300, h: 44, title: 'Solar wind Bz, the last 6 hours (below the line: southward)' })}</div>`;
  return h + prov(s.bz ? s.bz.prov : s.wind ? s.wind.prov : null);
}
