// What a plane is and where it is going, from adsbdb (api.adsbdb.com: keyless, CORS *, so it works on the website too):
// type, registration, owner, a photo, and the route its callsign usually flies. Asked only for a plane someone looks at
// (the card, following, the cockpit), one request at a time, each answer kept a day per hex + callsign, and after a
// "rate limited" answer nothing is asked until it says. The route data's authors don't allow copying it into other
// databases, so answers live only in this browser's cache, never in the repository.
import { store } from './env.js';
import { parseAdsbdb, routeFit, hexCountry } from '../core/actype.js';
import { normCallsign } from '../core/flight.js';

const API = 'https://api.adsbdb.com/v0';
const TTL = 24 * 3600e3, MISS_TTL = 6 * 3600e3, KEEP = 400;   // known: a day; unknown: 6 h; at most 400 kept
const GAP = 1100;   // ms between requests: one plane at a time is all a person looks at

const mem = new Map();   // key -> { t, v: { aircraft, route } }
let saved = store.get('adsbdb', {});
let blockedUntil = 0, chain = Promise.resolve(), last = 0, saveTimer = 0;

function save() {   // trimmed to the newest KEEP and written at most every 2 s
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const now = Date.now(), entries = Object.entries(saved).filter(([, e]) => now - e.t < TTL).sort((a, b) => b[1].t - a[1].t).slice(0, KEEP);
    saved = Object.fromEntries(entries); store.set('adsbdb', saved);
  }, 2000);
}
const keyOf = (hex, cs) => `${String(hex || '').replace(/^~/, '').toLowerCase()}|${cs}`;

async function ask(url) {
  const wait = Math.max(0, last + GAP - Date.now()); if (wait) await new Promise(r => setTimeout(r, wait));
  last = Date.now();
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 12000);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (r.status === 429) {   // "rate limited for N seconds"
      const body = await r.json().catch(() => null), s = +(String(body && body.response || '').match(/(\d+)\s*sec/) || [])[1] || 120;
      blockedUntil = Date.now() + s * 1000; throw new Error('adsbdb: rate limited');
    }
    if (r.status === 404) return { response: 'unknown' };
    if (!r.ok) throw new Error('adsbdb: HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

export const AcInfo = {
  /** Cached answer for a plane, or undefined if not asked yet. */
  peek(r) {
    const k = keyOf(r.hex, normCallsign(r.flight)), m = mem.get(k), e = m && m.v ? m : saved[k];
    if (!e || !e.v) return undefined;   // not asked, or still on its way (mem holds { pending } meanwhile)
    if (Date.now() - e.t > (e.v.aircraft || e.v.route ? TTL : MISS_TTL)) return undefined;
    return e.v;
  },
  /** { aircraft, route } for a feed record (asks adsbdb once, queued); also stored on r.info. Never rejects. */
  get(r) {
    const cs = normCallsign(r.flight), hex = String(r.hex || '').replace(/^~/, '').toLowerCase(), k = keyOf(hex, cs);
    const have = this.peek(r); if (have !== undefined) { r.info = have; return Promise.resolve(have); }
    if (mem.has(k) && mem.get(k).pending) return mem.get(k).pending.then(v => { if (v) r.info = v; return v; });   // another caller asked first
    if (!/^[0-9a-f]{6}$/.test(hex) || Date.now() < blockedUntil) return Promise.resolve(null);
    const url = `${API}/aircraft/${hex}${/^[A-Z0-9]{3,8}$/.test(cs) ? '?callsign=' + cs : ''}`;
    const pending = chain = chain.catch(() => {}).then(() => ask(url)).then(async j => {
      let v = parseAdsbdb(j);
      if (!v.route && /^[A-Z]{3}\d/.test(cs) && !v.aircraft) {   // an unknown airframe still has a route: ask by callsign
        const j2 = await ask(`${API}/callsign/${cs}`).catch(() => null); if (j2) v = { ...v, route: parseAdsbdb(j2).route };
      }
      const e = { t: Date.now(), v }; mem.set(k, e); saved[k] = e; save();
      r.info = v; return v;
    }).catch(e => { mem.delete(k); console.warn('adsbdb', e.message); return null; });
    mem.set(k, { pending });
    return pending;
  },
  /** Where the plane is against its route on file (core routeFit), for a live record. */
  fit(r) { const v = r.info; return v && v.route ? routeFit(v.route, { lat: r.cur?.lat ?? r.lat, lon: r.cur?.lon ?? r.lon, track: r.track, gs: r.gs, ground: r.ground }) : null; },
  country: r => r.country || hexCountry(r.hex),
  get limited() { return Date.now() < blockedUntil; },
};
