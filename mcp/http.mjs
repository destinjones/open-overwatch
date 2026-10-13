// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// MCP over Streamable HTTP (spec 2025-03-26 and later), stateless: one JSON-RPC message per POST to /mcp, answered with
// one JSON response (no event streams, no sessions: every tool answer is a single reply, and nothing is remembered between
// requests). Written against the web's own Request and Response only, so the same handler could run on a Cloudflare Worker
// or Deno; mcp/http-node.mjs serves it from Node, on loopback only.
//
// Guards (the spec's security warning: a local server must not be reachable from web pages the user happens to visit):
//   - Host must be a loopback name (DNS rebinding), unless `hosts` is null (behind a real domain);
//   - Origin, when a browser sends one, must be loopback or listed in `origins`; anything else gets 403;
//   - bodies over 1 MB get 413, other content types 415, clients that accept neither JSON nor event streams 406;
//   - an MCP-Protocol-Version header this server does not speak gets 400.
import { PROTOCOL_VERSIONS } from './protocol.mjs';

export const MAX_BODY = 1 << 20;
const LOOPBACK = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])$/i;
const ALLOW_HEADERS = 'Content-Type, Accept, Authorization, MCP-Protocol-Version, Mcp-Session-Id, Last-Event-ID';

const json = (status, body, headers = {}) => new Response(body == null ? null : JSON.stringify(body), { status, headers: { ...(body == null ? {} : { 'Content-Type': 'application/json' }), ...headers } });
const rpcError = (status, code, message, headers) => json(status, { jsonrpc: '2.0', id: null, error: { code, message } }, headers);
const hostName = h => { try { return new URL('http://' + h).hostname; } catch { return ''; } };

/** Is this Origin header one the server answers? Loopback pages (a local inspector, the local site) and listed origins. */
export function originAllowed(origin, origins = []) {
  if (origin == null || origin === '') return true;   // not a browser (or a same-origin GET): nothing to guard against
  let u; try { u = new URL(origin); } catch { return false; }
  if (u.origin !== origin.replace(/\/$/, '')) return false;   // "null", paths, junk
  if ((u.protocol === 'http:' || u.protocol === 'https:') && LOOPBACK.test(u.hostname)) return true;
  return origins.includes(u.origin);
}

/**
 * A fetch-style handler: (Request) -> Promise<Response>. server: createMcpServer()'s { handle }. Options: path ('/mcp'),
 * hosts (allowed Host names: loopback by default; null skips the check), origins (extra allowed Origins), maxBody,
 * name/version (for GET /).
 */
export function createHttpHandler(server, { path = '/mcp', hosts = 'loopback', origins = [], maxBody = MAX_BODY, name = 'mcp', version = '' } = {}) {
  const hostOk = h => hosts === null || (hosts === 'loopback' ? LOOPBACK.test(hostName(h)) : hosts.includes(hostName(h)));
  return async function handle(request) {
    const url = new URL(request.url), origin = request.headers.get('origin');
    if (!hostOk(request.headers.get('host') || url.host)) return rpcError(403, -32600, 'Forbidden: unexpected Host');
    if (!originAllowed(origin, origins)) return rpcError(403, -32600, 'Forbidden: this Origin may not use the server');
    const cors = origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Expose-Headers': 'Mcp-Session-Id, MCP-Protocol-Version' } : {};

    if (url.pathname === '/' && (request.method === 'GET' || request.method === 'HEAD')) {
      return new Response(request.method === 'HEAD' ? null : `${name} ${version}: a Model Context Protocol server. POST JSON-RPC to ${path} (Streamable HTTP, stateless).\n`, { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8', ...cors } });
    }
    if (url.pathname !== path) return new Response('Not found\n', { status: 404, headers: { 'Content-Type': 'text/plain', ...cors } });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS', 'Access-Control-Allow-Headers': ALLOW_HEADERS, 'Access-Control-Max-Age': '600' } });
    // no server-to-client stream (GET) and no sessions to end (DELETE): the spec's answer is 405
    if (request.method !== 'POST') return rpcError(405, -32000, 'Method not allowed: this server answers POST only (stateless, no event stream)', { Allow: 'POST, OPTIONS', ...cors });

    const accept = (request.headers.get('accept') || '').toLowerCase();
    if (accept && !/application\/json|text\/event-stream|\*\/\*|application\/\*/.test(accept)) return rpcError(406, -32600, 'Not acceptable: the answer is application/json', cors);
    const type = (request.headers.get('content-type') || '').toLowerCase();
    if (!/^application\/json\b/.test(type)) return rpcError(415, -32600, 'Unsupported media type: send application/json', cors);
    const pv = request.headers.get('mcp-protocol-version');
    if (pv && !PROTOCOL_VERSIONS.includes(pv)) return rpcError(400, -32600, `Unsupported MCP-Protocol-Version ${pv} (this server speaks ${PROTOCOL_VERSIONS.join(', ')})`, cors);
    if (+request.headers.get('content-length') > maxBody) return rpcError(413, -32600, 'Request too large', cors);

    let text;
    try { text = await request.text(); } catch { return rpcError(400, -32700, 'Parse error: unreadable body', cors); }
    if (text.length > maxBody) return rpcError(413, -32600, 'Request too large', cors);
    let m;
    try { m = JSON.parse(text); } catch { return rpcError(400, -32700, 'Parse error', cors); }
    if (Array.isArray(m)) return rpcError(400, -32600, 'Send one JSON-RPC message per POST (batches are not supported)', cors);

    const res = await server.handle(m, { signal: request.signal });
    if (res === null) return new Response(null, { status: 202, headers: cors });   // a notification or a response: accepted, nothing to say
    return json(200, res, { ...cors, ...(m && m.method === 'initialize' && res.result ? { 'MCP-Protocol-Version': res.result.protocolVersion } : {}) });
  };
}
