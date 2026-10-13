// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// meteor_showers: the year's major meteor showers (the IMO list in src/core/meteors.js): when each peaks, how many an hour
// you could really see from a place on the peak night (the radiant's height and the Moon cut the textbook rate), when to
// look and which way, and what each is made of (its parent comet or asteroid).
import { showersFor, SHOWERS } from '../src/core/meteors.js';
import { areaProps, resolveArea, frame, globeUrl, panelUrl } from './place.mjs';
import { iso, areaData, clocks, zoneAt, plural } from './words.mjs';

export function meteorsTool(ctx) {
  const { feeds } = ctx, site = feeds.siteBase;
  return {
    name: 'meteor_showers',
    title: 'Meteor showers',
    description: "The major meteor showers coming up (Quadrantids, Lyrids, Eta Aquariids, Perseids, Orionids, Leonids, Geminids and the rest): when each peaks and, from a place, how many meteors an hour you could really expect on the peak night (the radiant's height, a suburban sky and the Moon taken into account), the best time to look and which way, and the comet or asteroid each comes from.",
    inputSchema: { type: 'object', additionalProperties: false, properties: { ...areaProps(null), days: { type: 'integer', minimum: 1, maximum: 366, description: 'How far ahead, in days (default 120).' } } },
    async run(a, { signal }) {
      const area = await resolveArea(a, feeds, { signal }), t = ctx.now(), days = a.days || 120;
      const lat = area ? area.lat : 45, lon = area ? area.lon : 0;   // without a place: rates for mid-northern latitudes, said so
      const tz = area ? await zoneAt(ctx, lat, lon, signal) : null, c = clocks(tz);
      const list = showersFor(lat, lon, t, { ahead: days, time: c.full });
      const rows = list.map(s => ({ name: s.name, peak: iso(s.peakMs), peak_date: c.date(s.peakMs), active_now: s.active, nights_to_peak: s.nights, zhr: s.zhr, per_hour_peak_night: s.ratePeak, per_hour_tonight: s.active ? s.rate : null,
        best_time: s.bestMs ? c.full(s.bestMs) : null, radiant_altitude_deg: Math.round(s.radiantAlt), look_toward: s.dir || null, moon_lit_percent: Math.round(s.moonLit * 100), speed_km_s: s.kms, parent: s.parent, text: s.text }));
      const out = [rows.length ? `${plural(rows.length, 'meteor shower')} active or peaking in the next ${days} days${area ? ` (rates from ${area.label}, times ${tz || 'UTC'})` : ' (rates for 45°N; give a place for yours)'}:` : `No major meteor shower peaks in the next ${days} days.`];
      for (const r of rows) out.push(`${r.text} (They come from ${r.parent}, at ${r.speed_km_s} km/s.)`);
      if (!rows.length) { const next = SHOWERS.map(s => s.name).join(', '); out.push(`The major showers: ${next}.`); }
      const url = area ? globeUrl(site, { camera: frame(lat, lon, 900), on: ['stations', 'visual'], time: rows[0] && list[0].bestMs ? { ms: list[0].bestMs, rate: 60 } : null }) : panelUrl(site, 'tonight');
      out.push(`${area ? 'The sky over the place on the globe' : 'Tonight\'s sky for where you are'}: ${url}`);
      return { text: out.join('\n'), data: { showers: rows, place: areaData(area), timezone: tz, url, source: 'International Meteor Organization shower list; the Open Overwatch sky maths' } };
    },
  };
}
