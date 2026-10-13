#!/usr/bin/env node
// Open Overwatch for Claude (and any MCP client): ask about the live Earth and get answers from public open data, each with
// a link that opens the 3D globe on it; hosts with MCP Apps (Claude Desktop) show the globe right in the conversation.
// No account, no keys, no local web server: it reads the public feeds and the website's own data copies.
//
//   npx -y open-overwatch-mcp            (once published to npm)
//   node mcp/server.mjs                  (from a checkout, after npm install)
//   --site <url>   where links point and the data copies come from (default: the website; a local copy for testing)
//   --http <port>  Streamable HTTP on http://127.0.0.1:<port>/mcp instead of stdio (loopback only, stateless)
//
// Speaks MCP over stdio by default. Diagnostics go to stderr, one line per call (the tool and its time; never the arguments).
import { createOverwatchServer, SITE, VERSION } from './index.mjs';
import { serveStdio } from './protocol.mjs';

const HELP = `open-overwatch-mcp ${VERSION}: an MCP server for the live Earth (stdio, or Streamable HTTP on loopback).
  --site <url>          the Open Overwatch site to link to and read data copies from (default ${SITE})
  --http <port>         serve Streamable HTTP at http://127.0.0.1:<port>/mcp instead of stdio (stateless JSON answers)
  --host <address>      with --http: 127.0.0.1 (default), ::1 or localhost; never a public address (no authentication)
  --allow-origin <url>  with --http: also answer browser pages from this origin (loopback pages always may); repeatable
  --version             print the version
  --help                this text
Setup for Claude Desktop, Claude Code and other clients: https://github.com/destinjones/open-overwatch/blob/main/mcp/README.md`;

try {
  const argv = process.argv.slice(2), o = { origins: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--site' && argv[i + 1]) o.site = argv[++i];
    else if (argv[i] === '--http' && argv[i + 1]) o.http = argv[++i];
    else if (argv[i] === '--host' && argv[i + 1]) o.host = argv[++i];
    else if (argv[i] === '--allow-origin' && argv[i + 1]) o.origins.push(argv[++i]);
    else if (argv[i] === '--version' || argv[i] === '-v') o.version = true;
    else if (argv[i] === '--help' || argv[i] === '-h') o.help = true;
    else throw new Error(`Unknown argument: ${argv[i]} (try --help)`);
  }
  if (o.version || o.help) console.log(o.version ? VERSION : HELP);
  else {
    const site = o.site || process.env.OO_SITE || SITE;
    if (!/^https?:\/\/[^\s]+$/.test(site)) throw new Error('--site must be an http(s) address');
    if ((o.host || o.origins.length) && o.http == null) throw new Error('--host and --allow-origin go with --http <port>');
    const origins = o.origins.map(x => { let u; try { u = new URL(x); } catch { u = null; } if (!u || !/^https?:$/.test(u.protocol) || u.origin !== x.replace(/\/$/, '')) throw new Error(`--allow-origin needs an origin like https://example.com, not ${x}`); return u.origin; });
    const server = createOverwatchServer({ site, log: line => console.error(`- ${line}`) });
    if (o.http != null) {
      if (!/^\d{1,5}$/.test(o.http)) throw new Error('--http needs a port number');
      const { serveHttp } = await import('./http-node.mjs');
      const h = await serveHttp(server, { port: +o.http, host: o.host || '127.0.0.1', origins, name: 'open-overwatch-mcp', version: VERSION });
      console.error(`open-overwatch-mcp ${VERSION} - Streamable HTTP at ${h.url} - links to ${site}`);   // plain ASCII: Claude Desktop's log reads stderr as Latin-1
      const stop = () => { h.close().then(() => process.exit(0)); };
      process.on('SIGINT', stop); process.on('SIGTERM', stop);
    } else {
      console.error(`open-overwatch-mcp ${VERSION} - links to ${site}`);
      await serveStdio(server);
    }
  }
} catch (e) {
  console.error(e.message); process.exitCode = 1;
}
