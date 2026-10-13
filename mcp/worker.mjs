// The MCP server as a fetch handler for a Cloudflare Worker (or Deno, or any runtime with web Request/Response): the same
// tools behind the Streamable HTTP transport (mcp/http.mjs). NOT deployed: a public server needs a sign-in, so this one
// answers only requests carrying the bearer token set as the MCP_TOKEN secret, and nothing at all without one.
//   env.MCP_TOKEN       required: the shared secret clients send as "Authorization: Bearer <token>"
//   env.OO_SITE         optional: the Open Overwatch site to link to (default the public website)
//   env.ALLOW_ORIGINS   optional: comma-separated browser origins that may call it
import { createOverwatchServer, SITE } from './index.mjs';
import { createHttpHandler } from './http.mjs';

let made = null;   // one server per isolate: its caches outlive a request
const same = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };   // no early exit: no timing hint

export default {
  async fetch(request, env = {}) {
    const token = typeof env.MCP_TOKEN === 'string' ? env.MCP_TOKEN : '';
    if (token.length < 16) return new Response('This server is not set up: give it an MCP_TOKEN secret of 16 characters or more.\n', { status: 503, headers: { 'Content-Type': 'text/plain' } });
    if (request.method !== 'OPTIONS') {
      const got = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
      if (!same(got, token)) return new Response(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized' } }), { status: 401, headers: { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer' } });
    }
    const key = `${env.OO_SITE || ''}|${env.ALLOW_ORIGINS || ''}`;
    if (!made || made.key !== key) {
      const server = createOverwatchServer({ site: env.OO_SITE || SITE });
      const origins = String(env.ALLOW_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
      made = { key, handle: createHttpHandler(server, { hosts: null, origins, name: 'open-overwatch-mcp' }) };
    }
    return made.handle(request);
  },
};
