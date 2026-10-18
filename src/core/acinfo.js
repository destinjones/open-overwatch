// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// What a plane is and where it is going, from adsbdb (api.adsbdb.com: keyless, CORS *, so it works on the website too):
// type, registration, owner, a photo, and the route its callsign usually flies; for the globe's and the 2D map's
// aircraft cards and airport boards alike. Asked only for a plane someone looks at (a card, a board, following), one
// request at a time, each answer kept a day per hex + callsign, and after a "rate limited" answer nothing is asked
// until it says. The route data's authors don't allow copying it into other databases, so answers live only in the
// visitor's browser (the `store` handed in), never in the repository. DOM-free (test/acinfo.test.mjs).
import { parseAdsbdb } from './actype.js';
import { normCallsign } from './flight.js';

export const ADSBDB = 'https://api.adsbdb.com/v0';
const TTL = 24 * 3600e3, MISS_TTL = 6 * 3600e3, KEEP = 400;   // known: a day; unknown: 6 h; at most 400 kept
const GAP = 1100;   // ms between requests: one plane at a time is all a person looks at

/** The cache key of a plane: its hex and its callsign. readsb's "~" (a non-ICAO address: a TIS-B track number, an
 *  anonymous address) stays, so such a track never shares an entry with the real airframe whose number it happens to be. */
export const acKey = (hex, cs) => `${String(hex || '').toLowerCase()}|${cs}`;
/** Seconds adsbdb asks us to wait in a 429 answer ("rate limited for 30 seconds"), 120 if it doesn't say. */
export const retryAfter = body => +(String(body && body.response || '').match(/(\d+)\s*sec/) || [])[1] || 120;

/**
 * An adsbdb client. opts: { store ({ get(k, d), set(k, v) }: the view's localStorage wrapper), fetch, now () → ms,
 * sleep (ms) → promise, warn (message) }. Returns { peek(r), get(r), limited } where r is any aircraft record with
 * .hex and .flight; get() also stores the answer on r.info.
 * @param {{ store?: any, fetch?: typeof globalThis.fetch, now?: () => number, sleep?: (ms: number) => Promise<any>, warn?: (msg: string) => void }} [opts]
 */
export function createAcInfo({ store = null, fetch = (url, init) => globalThis.fetch(url, init), now = () => Date.now(), sleep = ms => new Promise(res => setTimeout(res, ms)), warn = () => {} } = {}) {
  const mem = new Map();   // key -> { t, v: { aircraft, route } } or { pending }
  let saved = (store && store.get('adsbdb', {})) || {};
  let blockedUntil = 0, chain = Promise.resolve(), last = -Infinity;
  /** @type {ReturnType<typeof setTimeout>} */ let saveTimer;

  function save() {   // trimmed to the newest KEEP and written at most every 2 s
    if (!store) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const t = now(), entries = Object.entries(saved).filter(([, e]) => t - e.t < TTL).sort((a, b) => b[1].t - a[1].t).slice(0, KEEP);
      saved = Object.fromEntries(entries); store.set('adsbdb', saved);
    }, 2000);
  }
  async function ask(url) {
    const wait = Math.max(0, last + GAP - now()); if (wait) await sleep(wait);
    last = now();
    const ctl = typeof AbortController === 'function' ? new AbortController() : null, t = ctl ? setTimeout(() => ctl.abort(), 12000) : 0;
    try {
      const r = await fetch(url, ctl ? { signal: ctl.signal } : {});
      if (r.status === 429) { blockedUntil = now() + retryAfter(await r.json().catch(() => null)) * 1000; throw new Error('adsbdb: rate limited'); }
      if (r.status === 404) return { response: 'unknown' };
      if (!r.ok) throw new Error('adsbdb: HTTP ' + r.status);
      return await r.json();
    } finally { clearTimeout(t); }
  }

  return {
    /** The cached answer for a plane, or undefined if not asked yet (or still on its way). */
    peek(r) {
      const k = acKey(r.hex, normCallsign(r.flight)), m = mem.get(k), e = m && m.v ? m : saved[k];
      if (!e || !e.v) return undefined;
      if (now() - e.t > (e.v.aircraft || e.v.route ? TTL : MISS_TTL)) return undefined;
      return e.v;
    },
    /** { aircraft, route } for a record (asks adsbdb once, queued), also stored on r.info; null when it can't be had
     *  (not an ICAO address, rate limited, network trouble). Never rejects. A "~" address is not an ICAO address: its six
     *  digits belong to some other, real aircraft, so it is never looked up. */
    get(r) {
      const cs = normCallsign(r.flight), hex = String(r.hex || '').toLowerCase(), k = acKey(hex, cs);
      const have = this.peek(r); if (have !== undefined) { r.info = have; return Promise.resolve(have); }
      if (mem.has(k) && mem.get(k).pending) return mem.get(k).pending.then(v => { if (v) r.info = v; return v; });   // another caller asked first
      if (!/^[0-9a-f]{6}$/.test(hex) || now() < blockedUntil) return Promise.resolve(null);
      const url = `${ADSBDB}/aircraft/${hex}${/^[A-Z0-9]{3,8}$/.test(cs) ? '?callsign=' + cs : ''}`;
      const pending = chain = chain.catch(() => {}).then(() => ask(url)).then(async j => {
        let v = parseAdsbdb(j);
        if (!v.route && /^[A-Z]{3}\d/.test(cs) && !v.aircraft) {   // an unknown airframe still has a route: ask by callsign
          const j2 = await ask(`${ADSBDB}/callsign/${cs}`).catch(() => null); if (j2) v = { ...v, route: parseAdsbdb(j2).route };
        }
        const e = { t: now(), v }; mem.set(k, e); saved[k] = e; save();
        r.info = v; return v;
      }).catch(e => { mem.delete(k); warn('adsbdb ' + e.message); return null; });
      mem.set(k, { pending });
      return pending;
    },
    /** True while adsbdb has asked us to wait. */
    get limited() { return now() < blockedUntil; },
  };
}
