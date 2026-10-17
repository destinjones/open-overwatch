// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Every request the MCP server makes goes through here. Answers are kept in memory for as long as their source takes to
// change (an earthquake feed a minute, satellite elements hours), so asking again in a conversation costs nothing, and a
// source that fails falls back to its last answer for a day. It never asks CelesTrak (it firewalls networks that download
// too often): satellite elements come from the website's own copy, refreshed every 6 h.

export const VERSION = '0.4.1';
export const SITE = 'https://destinjones.github.io/open-overwatch/';
export const USER_AGENT = `open-overwatch-mcp/${VERSION} (+https://github.com/destinjones/open-overwatch)`;
const STALE_OK_MS = 24 * 3600e3;

/**
 * A failure the person asking should hear about: `code` is 'invalid_arguments', 'not_found', 'unavailable', 'retry_later'
 * or 'unsupported' (a real place outside a source's coverage: ships_baltic, transit_vehicles, road_speeds).
 */
export class ToolError extends Error {
  constructor(message, code = 'unavailable') { super(message); this.code = code; }
}

const built = new WeakMap();   // an answer object -> what was built from it, by kind
/**
 * What make(src) builds from an answer the feeds hand out (a parsed data copy, a grid's bytes), built once per isolate:
 * the memo hands every server the same object for as long as it keeps it, and the Worker makes a server per request, so
 * an index kept in a tool's closure would be built again for every question. Not an object: built each time.
 * derive.builds counts the builds (the tests check that a second server builds nothing).
 */
export function derive(src, kind, make) {
  if (!src || typeof src !== 'object') return make(src);
  let m = built.get(src);
  if (!m) built.set(src, (m = new Map()));
  if (!m.has(kind)) { m.set(kind, make(src)); derive.builds++; }
  return m.get(kind);
}
derive.builds = 0;

const local = u => /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname);

/**
 * fetchImpl: fetch-compatible (tests pass their own). site: the Open Overwatch address links point at and the data copies
 * come from. Returns { json, text, bytes, site(path), siteBase, scope, clear() }; json/text/bytes(url, { ttl, headers, timeout, signal,
 * method, body, maxBytes }). bytes resolves to { bytes: Uint8Array, type } (a picture, a protobuf feed, a gzipped tile).
 * memo: the Map answers are kept in (pass one to share parsed answers between servers: the Worker makes a server per
 * request). shared: a cache in front of the network that outlives the process, { match(key) -> Response | undefined,
 * put(key, Response, seconds) } (the Worker's Cache API); GET answers go through it for as long as their ttl.
 */
export function createFeeds({ fetchImpl = globalThis.fetch, site = SITE, maxEntries = 150, now = Date.now, memo = new Map(), shared = null } = {}) {
  const cache = memo, inflight = new Map();
  const remember = (key, v, ttl) => {
    cache.delete(key); cache.set(key, { t: now(), ttl, v });
    while (cache.size > maxEntries) cache.delete(cache.keys().next().value);   // oldest first
  };

  async function load(url, as, headers, timeout, method, body, maxBytes, key, ttl) {
    const u = new URL(url), viaShared = shared && method === 'GET';
    let r = viaShared ? await Promise.resolve(shared.match(key)).catch(() => null) : null;
    if (!r) {
      try {
        r = await fetchImpl(url, { method, body, headers: { 'User-Agent': USER_AGENT, Accept: as === 'json' ? 'application/json' : '*/*', ...headers }, signal: AbortSignal.timeout(timeout) });
      } catch (e) {
        if (e instanceof ToolError) throw e;   // the caller's own refusal (the Worker's subrequest budget)
        throw new ToolError(`${u.hostname} did not answer${e && e.name === 'TimeoutError' ? ' in time' : ''}; try again in a minute`, 'unavailable');
      }
      if (viaShared && r.ok && (r.status === 200 || r.status === 206) && !(+r.headers.get('content-length') > maxBytes)) {   // keep a copy for every later request, then read our own
        const buf = await r.arrayBuffer().catch(() => null);
        if (buf == null) throw new ToolError(`${u.hostname} sent something unreadable`, 'unavailable');
        const type = r.headers.get('content-type') || '';
        try { shared.put(key, new Response(buf.slice(0), { status: 200, headers: type ? { 'Content-Type': type } : {} }), Math.max(1, Math.round(ttl / 1000))); } catch { /* a cache that refuses is no cache */ }
        r = new Response(buf, { status: 200, headers: type ? { 'Content-Type': type } : {} });
      }
    }
    if (!r.ok) throw new ToolError(`${u.hostname} answered HTTP ${r.status}${r.status === 429 ? ' (too many requests): try again later' : ''}`, r.status === 429 ? 'retry_later' : r.status === 404 ? 'not_found' : 'unavailable');
    if (+r.headers.get('content-length') > maxBytes) throw new ToolError(`${u.hostname} sent more than ${Math.round(maxBytes / 1e6)} MB`, 'unavailable');
    let b;
    try { b = as === 'bytes' ? new Uint8Array(await r.arrayBuffer()) : as === 'json' ? await r.json() : await r.text(); }
    catch (e) { throw new ToolError(`${u.hostname} sent something unreadable`, 'unavailable'); }
    if (as === 'bytes') { if (b.length > maxBytes) throw new ToolError(`${u.hostname} sent more than ${Math.round(maxBytes / 1e6)} MB`, 'unavailable'); return { bytes: b, type: r.headers.get('content-type') || '' }; }
    return b;
  }

  /** @param {string} url @param {{ as?: string, ttl?: number, headers?: Record<string, string>, timeout?: number, signal?: AbortSignal, method?: string, body?: any, maxBytes?: number }} [opts] */
  async function get(url, { as = 'json', ttl = 60e3, headers = {}, timeout = 20e3, signal, method = 'GET', body, maxBytes = 64e6 } = {}) {
    const u = new URL(url);
    if (/(^|\.)celestrak\.(org|com)$/i.test(u.hostname)) throw new ToolError('CelesTrak is never asked directly: satellite elements come from the website copy', 'unavailable');
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local(u))) throw new ToolError('Only https sources are used', 'unavailable');
    const range = headers.Range || headers.range;   // a byte range is a different answer
    const key = as + ' ' + method + ' ' + url + (range ? ' ' + range : '') + (body ? ' ' + body : ''), hit = cache.get(key);
    if (hit && now() - hit.t < hit.ttl) return hit.v;
    let p = inflight.get(key);
    if (!p) {
      p = load(url, as, headers, timeout, method, body, maxBytes, key, ttl).then(v => { remember(key, v, ttl); return v; },
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
    bytes: (url, o) => get(url, { ...o, as: 'bytes' }),
    /** A file on the Open Overwatch site (its data copies: data/tle/…, data/launches.json, …). */
    site: path => new URL(path, base).href,
    siteBase: base,
    /** The memo itself: what outlives this server (the Worker makes one per request), for state kept beside the answers. */
    scope: cache,
    clear: () => cache.clear(),
  };
}
