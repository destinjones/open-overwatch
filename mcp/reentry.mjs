// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// reentries: satellites and debris predicted to fall back into the atmosphere in the coming days, worked out here from the
// website's copy of CelesTrak's element sets (never CelesTrak itself) with the globe's own model (src/core/decay.js: n-dot
// and B* drag through a solar-scaled atmosphere, a window of ±25% of the time left, the ground track as a corridor). Links
// open the globe's "Falling soon" card for each object.
import { ToolError } from './feeds.mjs';
import { panelUrl } from './place.mjs';
import { loadGroup } from './sats.mjs';
import { iso, utc, r1, r2, plural, limitProp, take } from './words.mjs';
import { fallingSoon, corridor, windowWords, whereWords, uncertaintyWords, spanText, status, DEFAULT_SOLAR } from '../src/core/decay.js';
import { provLine } from '../src/core/liveprov.js';

/** The groups read: every working satellite, the stations, and the three big debris clouds (no rocket bodies: the public
 *  groups the website copies have none, so a re-entering rocket stage is missing from the list). */
export const REENTRY_GROUPS = Object.freeze(['stations', 'active', 'cosmos-2251-debris', 'iridium-33-debris', 'fengyun-1c-debris']);
const norm = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

export function reentryTool(ctx) {
  const { feeds } = ctx, site = feeds.siteBase;
  return {
    name: 'reentries',
    title: 'Falling soon: predicted re-entries',
    description: "Satellites and debris predicted to re-enter the atmosphere in the next days (up to 30), soonest first, worked out from public orbit data (CelesTrak element sets via the Open Overwatch website): how fast each orbit is shrinking and the drag it feels, flown down through a model atmosphere scaled by solar activity. Each comes with a window rather than a moment (±25% of the time it has left, the usual rule of thumb: the upper air swells and shrinks with the Sun, and tumbling changes drag), the orbit, whether it is a working satellite that could still manoeuvre, a provenance line, and optionally its ground track over the window as a re-entry corridor. Optionally one object by name or NORAD number. Links open the globe's Falling soon card.",
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        days: { type: 'integer', minimum: 1, maximum: 30, description: 'Only objects predicted to come down within this many days (default 30).' },
        satellite: { type: 'string', maxLength: 80, description: 'Only this object: a name or part of one ("STARLINK-5470", "COSMOS") or a NORAD catalogue number.' },
        corridor: { type: 'boolean', description: 'Include each object\'s re-entry corridor: its ground track over the window (or 3 orbits around the likeliest time), as lat/lon points every 2 minutes.' },
        limit: limitProp(10, 50),
      },
    },
    async run(a, { signal }) {
      const t = ctx.now(), days = a.days || 30, sats = [], missing = [];
      for (const g of REENTRY_GROUPS) {
        try { sats.push(...(await loadGroup(feeds, g, signal)).map(s => ({ ...s, source: 'mirror' }))); }
        catch (e) { if (e.name === 'AbortError') throw e; missing.push(g); }
      }
      if (!sats.length) throw new ToolError('The website\'s satellite element sets are not there just now (they are copied every 6 hours)', 'unavailable');
      const q = String(a.satellite || '').trim(), qid = /^\d{1,9}$/.test(q) ? String(+q) : null, qn = norm(q);
      const all = fallingSoon(sats, { now: t, days }).filter(p => !q || (qid ? p.id === qid : norm(p.name).includes(qn)));
      const shown = take(all, a.limit || 10);
      const rows = shown.map(p => {
        const c = corridor(p, { stepS: 120 });
        return {
          name: p.name, norad: p.id, group: p.group, working: p.working, status: status(p, t),
          likeliest: iso(p.reentryMs), window: { from: iso(p.windowMs[0]), to: iso(p.windowMs[1]), words: windowWords(p), plus_minus_percent: Math.round(p.fraction * 100) },
          where: whereWords(p, c), uncertainty: uncertaintyWords(p), days_left_at_epoch: r2(p.days), element_set_epoch: iso(p.epochMs),
          perigee_km: Math.round(p.perigeeKm), apogee_km: Math.round(p.apogeeKm), inclination_deg: r1(p.incl),
          method: p.method, ballistic_m2_per_kg: +p.ballistic.toPrecision(3), other_method_days: p.otherDays != null && Number.isFinite(p.otherDays) ? r1(p.otherDays) : null,
          provenance: provLine(p, t), url: panelUrl(site, 'reentry', p.id),
          corridor: a.corridor && c ? { from: iso(c.from), to: iso(c.to), covers_window: c.coversWindow, lat_max_deg: r1(c.latMax), segments: c.segments.map(s => s.map(x => [r2(x.lat), r2(x.lon)])) } : undefined,
        };
      });
      const lines = rows.map((r, i) => {
        const p = shown[i];
        return `${r.name} (NORAD ${r.norad}${r.working ? ', a working satellite' : ', debris'}) · likeliest ${utc(p.reentryMs)} · ${r.window.words} (±${r.window.plus_minus_percent}% of the ${spanText(p.days)} it had left)${r.status === 'window' ? ' · the window is open now' : ''} · now ${r.perigee_km} × ${r.apogee_km} km, ${r.inclination_deg}° · ${r.provenance}`;
      });
      const head = all.length ? `${plural(all.length, 'object')} predicted to re-enter in the next ${plural(days, 'day')}${q ? ` matching "${q}"` : ''}${all.length > shown.length ? `, the ${shown.length} soonest:` : ':'}`
        : `Nothing${q ? ` matching "${q}"` : ''} in the website's element sets is predicted to re-enter in the next ${plural(days, 'day')}.`;
      const url = panelUrl(site, 'reentry');
      const text = [head, ...lines,
        'Windows are ±25% of the time each object had left when its orbit was measured: the upper atmosphere swells with solar activity and an object\'s drag depends on how it tumbles. Where follows from when: until the window is a few orbits long it can come down anywhere between the latitudes its orbit reaches. Working satellites can still be kept up or brought down on purpose. Most of what re-enters burns up.',
        `Solar flux assumed: F10.7 ${DEFAULT_SOLAR.f107} sfu, Kp ${DEFAULT_SOLAR.kp}.${missing.length ? ` Not read this time: ${missing.join(', ')}.` : ''} Rocket bodies are not in the public groups the website copies.`,
        `Falling soon on the globe: ${url}`].join('\n');
      return { text, data: { total: all.length, days, reentries: rows, groups: REENTRY_GROUPS.filter(g => !missing.includes(g)), solar: { ...DEFAULT_SOLAR }, url,
        source: 'Predicted by Open Overwatch (src/core/decay.js) from CelesTrak element sets via the Open Overwatch website copy' } };
    },
  };
}
