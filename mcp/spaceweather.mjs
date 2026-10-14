// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// space_weather: the Sun side of the aurora, from NOAA SWPC: the solar wind at L1 (speed, density, and Bz, the field's
// north-south part: southward feeds the aurora), the Sun's X-ray flares now and in the last 24 hours, and SWPC's watches,
// warnings and alerts in force (geomagnetic storms, CMEs on the way, radiation storms), in plain words. The parsing and
// the words are the globe's (src/core/spaceweather.js); `aurora` has the Kp index and the chance at a place.
import { ToolError } from './feeds.mjs';
import { frame, globeUrl } from './place.mjs';
import { iso } from './words.mjs';
import { SW_URLS, sunNow, topAlerts } from '../src/core/spaceweather.js';

const provData = p => p && { data_time: iso(p.dataAt), age_s: p.ageMs == null ? null : Math.round(p.ageMs / 1000), confidence: p.confidence, source: p.sources.map(s => s.name).join(' + ') };
const alertData = e => ({ kind: e.kind, active: e.active, scale: e.scale || null, cme: e.cme, issued: iso(e.issued), until: iso(e.until), text: e.text, swpc_title: e.title, swpc_code: e.code, provenance: provData(e.prov) });

export function spaceWeatherTool(ctx) {
  const { feeds } = ctx, site = feeds.siteBase;
  return {
    name: 'space_weather',
    title: 'Space weather: the solar wind, flares and storm warnings',
    description: "The Sun side of space weather from NOAA's Space Weather Prediction Center: the solar wind arriving at Earth (speed, density, and the magnetic field's Bz: southward is aurora-friendly) with the last hours of Bz, the Sun's X-ray flare class now and the strongest of the last 24 hours (with the radio blackout scale), and SWPC's watches, warnings and alerts in force, such as geomagnetic storm watches, coronal mass ejections on the way and radiation storms, in plain words. Each part says how old its data is. For the Kp index and the aurora chance at a place, use aurora.",
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    async run(_a, { signal }) {
      const t = ctx.now(), parts = ['mag', 'wind', 'flare', 'flares', 'alerts'];
      const rs = await Promise.allSettled(parts.map(k => feeds.json(SW_URLS[k], { ttl: 5 * 60e3, timeout: 45e3, signal })));
      if (rs.every(r => r.status === 'rejected')) throw new ToolError('NOAA SWPC is not answering right now', 'unavailable');
      const s = sunNow(Object.fromEntries(parts.map((k, i) => [k, rs[i].status === 'fulfilled' ? rs[i].value : undefined])), { now: t });
      const url = globeUrl(site, { camera: frame(66, -100, 2600), on: ['aurora'] });
      const act = s.alerts ? topAlerts(s.alerts.active, 6) : [], rec = s.alerts ? topAlerts(s.alerts.recent, 4) : [];
      const old = p => p && p.confidence === 'stale' ? ` (data ${Math.round(p.ageMs / 60e3)} min old: the feed may be lagging)` : '';
      const lines = [
        s.bz ? `Bz (north-south field at L1): ${s.bz.text}${old(s.bz.prov)}. Last 24 h it ranged ${s.bz.min24} to ${s.bz.max24} nT.` : 'Bz: no solar-wind field data from SWPC right now.',
        s.wind ? `Solar wind: ${s.wind.text}${old(s.wind.prov)}.` : '',
        s.flare ? `Flares: ${s.flare.text}${old(s.flare.prov)}.` : '',
        s.alerts ? (act.length ? `In force: ${act.map(e => e.text).join(' ')}` : 'No NOAA space weather watches or warnings in force.') : '',
        rec.length ? `Earlier (last day): ${rec.map(e => e.text).join(' ')}` : '',
        `The aurora oval on the globe: ${url}`].filter(Boolean);
      return { text: lines.join('\n'), data: {
        bz: s.bz && { now_nt: s.bz.now, bt_nt: s.bz.bt, mean_last_hour_nt: s.bz.mean60, southward: s.bz.now < -2, min_24h_nt: s.bz.min24, max_24h_nt: s.bz.max24, spacecraft: s.bz.craft, words: s.bz.text,
          last_hours: s.bz.series.filter((_, i, a) => (a.length - 1 - i) % 3 === 0).map(p => ({ time: iso(p.t), bz_nt: p.bz })), provenance: provData(s.bz.prov) },
        solar_wind: s.wind && { speed_km_s: s.wind.speed, density_per_cm3: s.wind.density, minutes_to_earth: s.wind.arrivalMin, spacecraft: s.wind.craft, words: s.wind.text, provenance: provData(s.wind.prov) },
        flares: s.flare && { now: s.flare.now && { class: s.flare.now.cls, time: iso(s.flare.now.t) }, peak_24h: s.flare.peak && { class: s.flare.peak.cls, time: iso(s.flare.peak.t) },
          latest: s.flare.latest && { class: s.flare.latest.cls, peak: iso(s.flare.latest.at), ongoing: s.flare.latest.ongoing }, words: s.flare.text, provenance: provData(s.flare.prov) },
        alerts_in_force: s.alerts ? s.alerts.active.map(alertData) : null, alerts_last_day: s.alerts ? s.alerts.recent.map(alertData) : null,
        summary: s.line, url, source: 'NOAA Space Weather Prediction Center (real-time solar wind, GOES X-rays, alerts), public domain' } };
    },
  };
}
