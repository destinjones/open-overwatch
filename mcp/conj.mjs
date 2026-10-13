// close_approaches: the closest coming encounters between objects in orbit (CelesTrak SOCRATES, screened every 8 hours
// over the whole public catalogue; the website's build keeps the closest in data/socrates.json, and only that copy is
// read, never CelesTrak), optionally for one satellite, with where over the Earth each happens (SGP4 on the website's
// element sets, when one of the pair is in them). Links open the globe's near-miss card, which replays the approach.
import { ToolError } from './feeds.mjs';
import { panelUrl, globeUrl, frame } from './place.mjs';
import { findSats, satState, GROUP_LAYER } from './sats.mjs';
import { iso, utc, r1, r2, coord, ago, plural, limitProp, take } from './words.mjs';

const STATUS = { '+': 'working', '-': 'not working', P: 'partly working', B: 'backup', S: 'spare', X: 'extended mission', D: 'decayed', '?': 'status unknown', '': 'debris or a rocket body' };
const dist = km => (km < 1 ? `${Math.round(km * 1000)} m` : `${r2(km)} km`);

export function conjTool(ctx) {
  const { feeds } = ctx, site = feeds.siteBase;
  return {
    name: 'close_approaches',
    title: 'Near misses in orbit',
    description: "The closest coming encounters between satellites and debris in the next 7 days (CelesTrak SOCRATES, which screens the whole public catalogue; the website keeps the closest few hundred, refreshed every 6 hours): the two objects, how close, how fast they pass, the chance of a collision where given, and where over the Earth it happens. Optionally only those involving one satellite (\"Starlink\", \"ISS\", a NORAD number). Links open the globe's near-miss card, which replays the approach.",
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        satellite: { type: 'string', maxLength: 80, description: 'Only encounters involving this object: a name or part of one ("STARLINK", "ISS", "COSMOS 2251 DEB") or a NORAD number.' },
        max_km: { type: 'number', minimum: 0.001, maximum: 5, description: 'Only those closer than this many km (default 5, the whole screened list).' },
        limit: limitProp(10, 50),
      },
    },
    async run(a, { signal }) {
      const d = await feeds.json(feeds.site('data/socrates.json'), { ttl: 60 * 60e3, timeout: 30e3, signal }), t = ctx.now();
      if (!d || !Array.isArray(d.rows)) throw new ToolError('The website\'s close-approach list is not there just now (it is built every 6 hours)', 'unavailable');
      const q = String(a.satellite || '').trim().toUpperCase(), aliases = { ISS: '25544', TIANGONG: '48274', HUBBLE: '20580' }, qid = /^\d+$/.test(q) ? String(+q) : aliases[q] || null;
      const hit = o => (qid ? o.id === qid : String(o.name || '').toUpperCase().includes(q));
      const all = d.rows.filter(r => r.tca > t && Number.isFinite(r.rangeKm) && r.rangeKm <= (a.max_km ?? 5) && (!q || hit(r.a) || hit(r.b))).sort((x, y) => x.rangeKm - y.rangeKm || x.tca - y.tca);
      const shown = take(all, a.limit || 10);
      const sl = shown.length ? await ctx.sgp4().catch(() => null) : null;
      const rows = [];
      for (const r of shown) {
        let where = null;
        if (sl) for (const o of [r.a, r.b]) {   // where it happens: either object, if the website's element sets have it
          const [s] = await findSats(feeds, o.id, { signal, max: 1 }).catch(() => []);
          const st = s && satState(sl, s, r.tca);
          if (st) { where = { lat: r2(st.lat), lon: r2(st.lon), altitude_km: Math.round(st.altKm), group: s.group }; break; }
        }
        rows.push({ a: { name: r.a.name, norad: r.a.id, status: STATUS[r.a.status] ?? r.a.status }, b: { name: r.b.name, norad: r.b.id, status: STATUS[r.b.status] ?? r.b.status }, closest: iso(r.tca),
          miss_km: r.rangeKm, relative_speed_km_s: r1(r.speedKmS), max_probability: Number.isFinite(r.maxProb) ? r.maxProb : null, where });
      }
      const lines = rows.map((r, i) => `${dist(r.miss_km)} · ${r.a.name} (${r.a.norad}, ${r.a.status}) and ${r.b.name} (${r.b.norad}, ${r.b.status}) · ${utc(shown[i].tca)} (${ago(shown[i].tca, t)}) · ${r.relative_speed_km_s} km/s${r.max_probability != null && r.max_probability >= 1e-4 ? ` · worst-case collision probability ${r.max_probability >= 0.01 ? Math.round(r.max_probability * 100) + '%' : '1 in ' + Math.round(1 / r.max_probability).toLocaleString('en-US')}` : ''}${r.where ? ` · ${r.where.altitude_km} km up over ${coord(r.where.lat, r.where.lon)}` : ''}`);
      const head = all.length ? `${plural(all.length, 'close approach', 'close approaches')} within ${a.max_km ?? 5} km in the next 7 days${q ? ` involving "${a.satellite}"` : ''}${all.length > shown.length ? `, the ${shown.length} closest:` : ':'}`
        : `No close approaches within ${a.max_km ?? 5} km in the website's list${q ? ` involving "${a.satellite}"` : ''} (it keeps the closest few hundred of the ${(d.screened || 0).toLocaleString('en-US')} SOCRATES screened).`;
      const top = rows.find(r => r.where);
      const url = panelUrl(site, 'conj'), replay = top ? globeUrl(site, { camera: frame(top.where.lat, top.where.lon, 2500), on: [GROUP_LAYER[top.where.group]].filter(Boolean), time: { ms: Date.parse(top.closest) - 45e3, rate: 1 } }) : null;
      const text = [head, ...lines, 'These are SOCRATES\'s predictions from public element sets: real misses can differ by kilometres, the probability is an upper bound (the worst case of unknown uncertainties), and working satellites that can steer (Starlink\'s do it automatically) usually move out of the way.',
        `Near misses on the globe: ${url}`, replay ? `The ${dist(top.miss_km)} pass, 45 s before: ${replay}` : ''].filter(Boolean).join('\n');
      return { text, data: { total: all.length, screened: d.screened ?? null, list_updated: d.updated || null, approaches: rows, url, replay_url: replay, source: 'CelesTrak SOCRATES via the Open Overwatch website copy; SGP4 (satellite.js)' } };
    },
  };
}
