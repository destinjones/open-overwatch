// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The Streamable HTTP handler (mcp/http.mjs) served from Node, on a loopback address only: `node mcp/server.mjs --http 8793`.
// Turns Node's request into a web Request (the body read up to the size limit), and a client that hangs up cancels its call.
import { createServer } from 'node:http';
import { createHttpHandler, MAX_BODY } from './http.mjs';

/** The loopback addresses the server may listen on. */
export const LOOPBACK_HOSTS = Object.freeze(['127.0.0.1', '::1', 'localhost']);

/**
 * Listen on host:port (port 0 picks a free one) and answer MCP at /mcp. Resolves to { server, url, close() } once listening.
 * Options are createHttpHandler's (origins, path, …) plus host.
 */
export async function serveHttp(mcp, { port, host = '127.0.0.1', ...opts } = {}) {
  if (!LOOPBACK_HOSTS.includes(host)) throw new Error(`--host must be a loopback address (${LOOPBACK_HOSTS.join(', ')}): this server has no authentication`);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('--http needs a port number (0-65535)');
  const handle = createHttpHandler(mcp, opts), maxBody = opts.maxBody || MAX_BODY;
  const server = createServer(async (req, res) => {
    const ctl = new AbortController();
    res.on('close', () => { if (!res.writableFinished) ctl.abort(new Error('client went away')); });   // a dropped connection cancels its tool call
    try {
      const chunks = []; let size = 0, tooBig = false;
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        for await (const c of req) { size += c.length; if (size > maxBody) { tooBig = true; break; } chunks.push(c); }
      }
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (v != null) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
      if (tooBig) headers.set('content-length', String(size));   // the handler answers 413
      const u = new URL(req.url, 'http://localhost');   // the Host header travels in headers, where the handler checks it
      const request = new Request(new URL(u.pathname + u.search, 'http://localhost'), {
        method: req.method, headers, body: chunks.length && !tooBig ? Buffer.concat(chunks) : undefined, signal: ctl.signal });
      const r = await handle(request);
      if (ctl.signal.aborted) return;
      res.writeHead(r.status, Object.fromEntries(r.headers));
      res.end(r.body ? Buffer.from(await r.arrayBuffer()) : undefined);
    } catch (e) {
      if (ctl.signal.aborted) return;
      if (!res.headersSent) res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Bad request' } }));
    }
  });
  server.headersTimeout = 30e3; server.requestTimeout = 120e3;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, () => { server.off('error', reject); resolve(); }); });
  const a = server.address(), shown = a.family === 'IPv6' ? `[${a.address}]` : a.address;
  return { server, url: `http://${shown}:${a.port}${opts.path || '/mcp'}`, port: a.port, close: () => new Promise(r => { server.closeAllConnections?.(); server.close(() => r()); }) };
}
