// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// One polite client for the public Overpass API, shared by every OpenStreetMap layer on the globe (roads for traffic,
// mapped cameras, buildings, a projected camera's street) and the 2D map's area scan. DOM-free (fetch is injectable). The servers are shared and run by volunteers, and they ask
// heavy users to slow down: so one request at a time from this page, a pause after each request at least as long as it
// took (a stand-in for what it cost the server), and the quickest server that is answering. A server that fails (an
// overloaded or rate-limited answer often has no CORS headers, so it shows up as a network error) rests for a while,
// longer each time; when every server fails, everything waits longer too.
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
const health = ENDPOINTS.map((url, i) => ({ url, ms: 3000 * (i + 1), fails: 0, until: 0 }));   // in order of preference until measured
let queue = /** @type {Promise<unknown>} */ (Promise.resolve()), lastEnd = 0, lastCost = 0, pause = 0;

/** Run an Overpass QL query (JSON output) in turn: resolves to the parsed answer. `gap`: least ms after the previous one. */
export function overpass(query, { timeout = 30000, gap = 1000, fetch: f = globalThis.fetch } = {}) {
  const run = async () => {
    const wait = lastEnd + Math.max(gap, lastCost) + pause - performance.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    const t0 = performance.now(), now = t0, ready = health.filter(h => h.until <= now);
    const order = (ready.length ? ready : health).slice().sort((a, b) => a.ms - b.ms);
    try {
      let err = null;
      for (const h of order) {
        const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), timeout), t1 = performance.now();
        try {
          const r = await f(h.url, { method: 'POST', body: 'data=' + encodeURIComponent(query),
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: ctl.signal });
          if (!r.ok) throw new Error('HTTP ' + r.status);
          const json = await r.json();
          h.ms = h.ms * 0.6 + (performance.now() - t1) * 0.4; h.fails = 0; pause = 0;
          return json;
        } catch (e) { err = e; h.fails++; h.until = performance.now() + Math.min(600e3, 20e3 * 2 ** (h.fails - 1)); }
        finally { clearTimeout(timer); }
      }
      pause = Math.min(60e3, pause ? pause * 2 : 5000);
      throw new Error('Overpass: ' + (err?.name === 'AbortError' ? 'timed out' : err?.message || 'unavailable'));
    } finally { lastEnd = performance.now(); lastCost = Math.min(20e3, lastEnd - t0); }
  };
  const p = queue.then(run, run);
  queue = p.catch(() => {});
  return p;
}
/** For the console: how each server has been doing. */
export const overpassHealth = () => health.map(h => ({ url: h.url, ms: Math.round(h.ms), fails: h.fails, restingFor: Math.max(0, Math.round((h.until - performance.now()) / 1000)) }));
