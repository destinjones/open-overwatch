// MCP over stdio: newline-delimited JSON-RPC on stdin/stdout (the transport Claude Desktop and most clients start).
// Kept apart from protocol.mjs because it needs Node's readline, which a Worker doesn't have.
import { createInterface } from 'node:readline';

const PARSE = -32700;
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);

/** Serve newline-delimited JSON-RPC on stdin/stdout until stdin closes. notifications/cancelled aborts that request (no answer). */
export async function serveStdio(server, { input = process.stdin, output = process.stdout } = {}) {
  const running = new Map(), work = new Set();
  for await (const line of createInterface({ input, crlfDelay: Infinity })) {
    if (!line.trim()) continue;
    let m;
    try { m = JSON.parse(line); } catch { output.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: PARSE, message: 'Parse error' } }) + '\n'); continue; }
    if (isObj(m) && m.method === 'notifications/cancelled') { const c = running.get(m.params && m.params.requestId); if (c) c.abort(); continue; }
    const id = isObj(m) ? m.id : undefined, ctl = new AbortController();
    if (id != null) running.set(id, ctl);
    const job = server.handle(m, { signal: ctl.signal }).then(res => { if (res && !ctl.signal.aborted) output.write(JSON.stringify(res) + '\n'); },
      () => {}).finally(() => { if (id != null && running.get(id) === ctl) running.delete(id); work.delete(job); });
    work.add(job);
  }
  await Promise.all(work);
}
