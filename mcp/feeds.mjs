// Every request the MCP server makes goes through here. Answers are kept in memory for as long as their source takes to
// change (an earthquake feed a minute, satellite elements hours), so asking again in a conversation costs nothing, and a
// source that fails falls back to its last answer for a day. It never asks CelesTrak (it firewalls networks that download
// too often): satellite elements come from the website's own copy, refreshed every 6 h.

export const VERSION = '0.1.1';
export const SITE = 'https://destinjones.github.io/open-overwatch/';
export const USER_AGENT = `open-overwatch-mcp/${VERSION} (+https://github.com/destinjones/open-overwatch)`;
const STALE_OK_MS = 24 * 3600e3;

/** A failure the person asking should hear about: `code` is 'invalid_arguments', 'not_found', 'unavailable' or 'retry_later'. */
export class ToolError extends Error {
  constructor(message, code = 'unavailable') { super(message); this.code = code; }
}

const local = u => /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname);

/**
 * fetchImpl: fetch-compatible (tests pass their own). site: the Open Overwatch address links point at and the data copies
 * come from. Returns { json, text, bytes, site(path), siteBase, clear() }; json/text/bytes(url, { ttl, headers, timeout, signal }).
 */
export function createFeeds({ fetchImpl = globalThis.fetch, site = SITE, maxEntries = 150, now = Date.now } = {}) {
  const cache = new Map(), inflight = new Map();
  const remember = (key, v, ttl) => {
    cache.delete(key); cache.set(key, { t: now(), ttl, v });
    while (cache.size > maxEntries) cache.delete(cache.keys().next().value);   // oldest first
  };

  async function load(url, as, headers, timeout) {
    const u = new URL(url);
    let r;
    try {
      r = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT, Accept: as === 'json' ? 'application/json' : '*/*', ...headers }, signal: AbortSignal.timeout(timeout) });
    } catch (e) {
      throw new ToolError(`${u.hostname} did not answer${e && e.name === 'TimeoutError' ? ' in time' : ''}; try again in a minute`, 'unavailable');
    }
    if (!r.ok) throw new ToolError(`${u.hostname} answered HTTP ${r.status}${r.status === 429 ? ' (too many requests): try again later' : ''}`, r.status === 429 ? 'retry_later' : r.status === 404 ? 'not_found' : 'unavailable');
    try { return as === 'json' ? await r.json() : as === 'bytes' ? new Uint8Array(await r.arrayBuffer()) : await r.text(); }
    catch (e) { throw new ToolError(`${u.hostname} sent something unreadable`, 'unavailable'); }
  }

  async function get(url, { as = 'json', ttl = 60e3, headers = {}, timeout = 20e3, signal } = {}) {
    const u = new URL(url);
    if (/(^|\.)celestrak\.(org|com)$/i.test(u.hostname)) throw new ToolError('CelesTrak is never asked directly: satellite elements come from the website copy', 'unavailable');
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local(u))) throw new ToolError('Only https sources are used', 'unavailable');
    const key = as + ' ' + url, hit = cache.get(key);
    if (hit && now() - hit.t < hit.ttl) return hit.v;
    let p = inflight.get(key);
    if (!p) {
      p = load(url, as, headers, timeout).then(v => { remember(key, v, ttl); return v; },
        e => { if (hit && now() - hit.t < STALE_OK_MS) return hit.v; throw e; })   // the last good answer beats none
        .finally(() => inflight.delete(key));
      inflight.set(key, p);
    }
    if (!signal) return p;
    if (signal.aborted) throw signal.reason;
    return new Promise((res, rej) => {   // a cancelled call stops waiting; the shared request finishes for anyone else
      const stop = () => rej(signal.reason);
      signal.addEventListener('abort', stop, { once: true });
      p.then(res, rej).finally(() => signal.removeEventListener('abort', stop));
    });
  }

  const base = new URL(site).href;
  return {
    json: (url, o) => get(url, { ...o, as: 'json' }),
    text: (url, o) => get(url, { ...o, as: 'text' }),
    /** Binary (vector tiles): a Uint8Array. */
    bytes: (url, o) => get(url, { ...o, as: 'bytes' }),
    /** A file on the Open Overwatch site (its data copies: data/tle/…, data/launches.json, …). */
    site: path => new URL(path, base).href,
    siteBase: base,
    clear: () => cache.clear(),
  };
}
